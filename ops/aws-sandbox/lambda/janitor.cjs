"use strict";

const STACK_PREFIX = "techlong-sandbox-tenant-";
const EXPECTED_ENVIRONMENT = "aws-sandbox";
const EXPECTED_MANAGER = "techlong-provisioner";
const MAX_DELETIONS_PER_SCAN = 1;
const ISO_UTC_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/;
const SAFE_STACK_NAME_PATTERN = /^techlong-sandbox-tenant-[a-z0-9]{1,16}$/;

function parseExpiresAt(value) {
  if (typeof value !== "string") return null;
  const match = value.match(ISO_UTC_PATTERN);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, milliseconds = "000"] = match;
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(milliseconds),
  );
  if (!Number.isFinite(timestamp)) return null;
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day) ||
    parsed.getUTCHours() !== Number(hour) ||
    parsed.getUTCMinutes() !== Number(minute) ||
    parsed.getUTCSeconds() !== Number(second) ||
    parsed.getUTCMilliseconds() !== Number(milliseconds)
  ) {
    return null;
  }
  return timestamp;
}

function tagsToMap(tags) {
  if (!Array.isArray(tags)) return {};
  return Object.fromEntries(
    tags
      .filter(
        (tag) =>
          tag && typeof tag.Key === "string" && typeof tag.Value === "string",
      )
      .map((tag) => [tag.Key, tag.Value]),
  );
}

function isEligibleStack(stack, nowMs, expectedDeploymentId) {
  if (!stack || typeof stack !== "object") return false;
  if (
    typeof stack.StackName !== "string" ||
    !SAFE_STACK_NAME_PATTERN.test(stack.StackName) ||
    !stack.StackName.startsWith(STACK_PREFIX)
  ) {
    return false;
  }
  if (stack.ParentId || stack.RootId) return false;
  if (
    typeof stack.StackStatus !== "string" ||
    stack.StackStatus === "REVIEW_IN_PROGRESS" ||
    stack.StackStatus === "DELETE_IN_PROGRESS" ||
    stack.StackStatus === "DELETE_COMPLETE"
  ) {
    return false;
  }
  const tags = tagsToMap(stack.Tags);
  if (
    tags.Environment !== EXPECTED_ENVIRONMENT ||
    tags.ManagedBy !== EXPECTED_MANAGER ||
    !tags.DeploymentId ||
    !tags.AppInstanceId
  ) {
    return false;
  }
  if (
    expectedDeploymentId !== undefined &&
    tags.DeploymentId !== expectedDeploymentId
  ) {
    return false;
  }
  const expiresAt = parseExpiresAt(tags.ExpiresAt);
  return expiresAt !== null && expiresAt <= nowMs;
}

function isMissingStackError(error) {
  return (
    error &&
    (error.name === "ValidationError" || error.Code === "ValidationError") &&
    /does not exist/i.test(String(error.message ?? ""))
  );
}

function createHandler(api, now = () => Date.now()) {
  if (!api || typeof api !== "object") throw new Error("api is required");
  return async function handle(event = {}) {
    const action = event?.action ?? "scan_expired_cloudformation_stacks";
    if (
      action !== "scan_expired_cloudformation_stacks" &&
      action !== "delete_cloudformation_stack"
    ) {
      throw new Error("unsupported janitor action");
    }

    const requestedStackName = event?.stackName;
    const expectedDeploymentId = event?.deploymentId;
    if (action === "delete_cloudformation_stack") {
      if (
        typeof requestedStackName !== "string" ||
        !SAFE_STACK_NAME_PATTERN.test(requestedStackName) ||
        typeof expectedDeploymentId !== "string" ||
        expectedDeploymentId.length < 3
      ) {
        throw new Error("invalid targeted cleanup request");
      }
      let stack;
      try {
        stack = await api.describeStack(requestedStackName);
      } catch (error) {
        if (isMissingStackError(error)) {
          return { checked: 1, deleted: [], skipped: [requestedStackName] };
        }
        throw error;
      }
      if (!isEligibleStack(stack, now(), expectedDeploymentId)) {
        return { checked: 1, deleted: [], skipped: [requestedStackName] };
      }
      await api.deleteStack(requestedStackName);
      return { checked: 1, deleted: [requestedStackName], skipped: [] };
    }

    const names = await api.listStackNames();
    const deleted = [];
    const skipped = [];
    let checked = 0;
    for (const stackName of names) {
      if (deleted.length >= MAX_DELETIONS_PER_SCAN) break;
      if (
        typeof stackName !== "string" ||
        !SAFE_STACK_NAME_PATTERN.test(stackName)
      ) {
        continue;
      }
      checked += 1;
      let stack;
      try {
        stack = await api.describeStack(stackName);
      } catch (error) {
        if (isMissingStackError(error)) continue;
        console.error("janitor describe failed", { stackName, error: String(error) });
        skipped.push(stackName);
        continue;
      }
      if (!isEligibleStack(stack, now())) {
        skipped.push(stackName);
        continue;
      }
      try {
        await api.deleteStack(stackName);
        deleted.push(stackName);
      } catch (error) {
        console.error("janitor delete failed", { stackName, error: String(error) });
        skipped.push(stackName);
      }
    }
    return { checked, deleted, skipped };
  };
}

async function createAwsApi() {
  // Lambda inline Node.js runtimes include AWS SDK v3; keep this lazy so the
  // pure eligibility contract remains locally testable without AWS packages.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cloudFormationSdk = require("@aws-sdk/client-cloudformation");
  const {
    CloudFormationClient,
    DeleteStackCommand,
    DescribeStacksCommand,
    ListStacksCommand,
  } = cloudFormationSdk;
  const client = new CloudFormationClient({ region: process.env.AWS_REGION });
  return {
    async listStackNames() {
      const names = [];
      let NextToken;
      do {
        const response = await client.send(new ListStacksCommand({ NextToken }));
        for (const summary of response.StackSummaries ?? []) {
          if (
            typeof summary.StackName === "string" &&
            summary.StackName.startsWith(STACK_PREFIX) &&
            summary.StackStatus !== "DELETE_IN_PROGRESS" &&
            summary.StackStatus !== "DELETE_COMPLETE"
          ) {
            names.push(summary.StackName);
          }
        }
        NextToken = response.NextToken;
      } while (NextToken);
      return names;
    },
    async describeStack(stackName) {
      const response = await client.send(
        new DescribeStacksCommand({ StackName: stackName }),
      );
      const stack = response.Stacks?.[0];
      if (!stack) throw new Error("stack description was empty");
      return stack;
    },
    async deleteStack(stackName) {
      await client.send(new DeleteStackCommand({ StackName: stackName }));
    },
  };
}

exports.handler = async (event) => {
  const api = await createAwsApi();
  const result = await createHandler(api)(event);
  console.log("janitor result", JSON.stringify(result));
  return result;
};
exports.createHandler = createHandler;
exports.isEligibleStack = isEligibleStack;
exports.parseExpiresAt = parseExpiresAt;
