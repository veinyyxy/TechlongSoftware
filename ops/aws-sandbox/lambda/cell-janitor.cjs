"use strict";

const STACK_PREFIX = "techlong-sandbox-cell-";
const SAFE_STACK_NAME_PATTERN = /^techlong-sandbox-cell-[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const SAFE_TENANT_STACK_NAME_PATTERN = /^techlong-sandbox-tenant-[a-z0-9]{1,16}$/;
const EXPECTED_ENVIRONMENT = "aws-sandbox";
const EXPECTED_MANAGER = "techlong-cell-operator";
const MAX_DELETIONS_PER_SCAN = 1;

function tagsToMap(tags) {
  if (!Array.isArray(tags)) return {};
  return Object.fromEntries(
    tags
      .filter((tag) => tag && typeof tag.Key === "string" && typeof tag.Value === "string")
      .map((tag) => [tag.Key, tag.Value]),
  );
}

function parseExpiresAt(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
    ? timestamp
    : null;
}

function isEligibleCellStack(stack, nowMs, expectedCellId) {
  if (!stack || typeof stack !== "object") return false;
  if (
    typeof stack.StackName !== "string" ||
    !stack.StackName.startsWith(STACK_PREFIX) ||
    !SAFE_STACK_NAME_PATTERN.test(stack.StackName) ||
    stack.ParentId ||
    stack.RootId ||
    typeof stack.StackStatus !== "string" ||
    ["REVIEW_IN_PROGRESS", "DELETE_IN_PROGRESS", "DELETE_COMPLETE"].includes(stack.StackStatus)
  ) {
    return false;
  }
  const tags = tagsToMap(stack.Tags);
  if (
    tags.Environment !== EXPECTED_ENVIRONMENT ||
    tags.ManagedBy !== EXPECTED_MANAGER ||
    tags.CellId !== "cell-sandbox-1" ||
    (expectedCellId !== undefined && tags.CellId !== expectedCellId)
  ) {
    return false;
  }
  const expiresAt = parseExpiresAt(tags.ExpiresAt);
  return expiresAt !== null && expiresAt <= nowMs;
}

function isOwnedTenantStackForCell(stack, expectedCellId) {
  if (
    !stack ||
    typeof stack !== "object" ||
    typeof stack.StackName !== "string" ||
    !SAFE_TENANT_STACK_NAME_PATTERN.test(stack.StackName) ||
    stack.ParentId ||
    stack.RootId ||
    typeof stack.StackStatus !== "string" ||
    stack.StackStatus === "DELETE_COMPLETE"
  ) {
    return false;
  }
  const tags = tagsToMap(stack.Tags);
  return (
    tags.Environment === EXPECTED_ENVIRONMENT &&
    tags.ManagedBy === "techlong-provisioner" &&
    tags.CellId === expectedCellId
  );
}

async function drainOwnedTenantStacks(api, cellId) {
  const tenants = (await api.listTenantStacks(cellId)).filter((stack) =>
    isOwnedTenantStackForCell(stack, cellId),
  );
  if (tenants.length === 0) return false;
  for (const tenant of tenants.slice(0, 1)) {
    if (tenant.StackStatus !== "DELETE_IN_PROGRESS") {
      await api.deleteTenantStack(tenant.StackName);
    }
  }
  const error = new Error(
    "owned tenant cleanup must finish before Shared Cell deletion",
  );
  error.code = "CELL_TENANT_DRAIN_IN_PROGRESS";
  throw error;
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
    const action = event?.action ?? "scan_expired_shared_cell_stacks";
    if (
      action !== "scan_expired_shared_cell_stacks" &&
      action !== "delete_shared_cell_stack"
    ) {
      throw new Error("unsupported cell janitor action");
    }
    if (action === "delete_shared_cell_stack") {
      if (
        typeof event.stackName !== "string" ||
        !SAFE_STACK_NAME_PATTERN.test(event.stackName) ||
        event.cellId !== "cell-sandbox-1"
      ) {
        throw new Error("invalid targeted cell cleanup request");
      }
      let stack;
      try {
        stack = await api.describeStack(event.stackName);
      } catch (error) {
        if (isMissingStackError(error)) {
          return { checked: 1, deleted: [], skipped: [event.stackName] };
        }
        throw error;
      }
      if (!isEligibleCellStack(stack, now(), event.cellId)) {
        return { checked: 1, deleted: [], skipped: [event.stackName] };
      }
      await drainOwnedTenantStacks(api, event.cellId);
      await api.deleteStack(event.stackName);
      return { checked: 1, deleted: [event.stackName], skipped: [] };
    }
    const deleted = [];
    const skipped = [];
    let checked = 0;
    for (const stackName of await api.listStackNames()) {
      if (deleted.length >= MAX_DELETIONS_PER_SCAN) break;
      if (typeof stackName !== "string" || !SAFE_STACK_NAME_PATTERN.test(stackName)) continue;
      checked += 1;
      try {
        const stack = await api.describeStack(stackName);
        if (!isEligibleCellStack(stack, now())) {
          skipped.push(stackName);
          continue;
        }
        await drainOwnedTenantStacks(api, "cell-sandbox-1");
        await api.deleteStack(stackName);
        deleted.push(stackName);
      } catch (error) {
        if (!isMissingStackError(error)) skipped.push(stackName);
      }
    }
    return { checked, deleted, skipped };
  };
}

async function createAwsApi() {
  // Lambda Node.js runtimes provide SDK v3. Lazy loading keeps the eligibility
  // contract locally testable and guarantees no AWS call merely by importing it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sdk = require("@aws-sdk/client-cloudformation");
  const client = new sdk.CloudFormationClient({ region: process.env.AWS_REGION });
  return {
    async listStackNames() {
      const names = [];
      let NextToken;
      do {
        const response = await client.send(new sdk.ListStacksCommand({ NextToken }));
        for (const stack of response.StackSummaries ?? []) {
          if (
            typeof stack.StackName === "string" &&
            stack.StackName.startsWith(STACK_PREFIX) &&
            !["DELETE_IN_PROGRESS", "DELETE_COMPLETE"].includes(stack.StackStatus)
          ) names.push(stack.StackName);
        }
        NextToken = response.NextToken;
      } while (NextToken);
      return names;
    },
    async describeStack(stackName) {
      const response = await client.send(new sdk.DescribeStacksCommand({ StackName: stackName }));
      if (!response.Stacks?.[0]) throw new Error("cell stack description was empty");
      return response.Stacks[0];
    },
    async listTenantStacks(cellId) {
      const stacks = [];
      let NextToken;
      do {
        const response = await client.send(new sdk.ListStacksCommand({ NextToken }));
        for (const summary of response.StackSummaries ?? []) {
          if (
            typeof summary.StackName === "string" &&
            SAFE_TENANT_STACK_NAME_PATTERN.test(summary.StackName) &&
            summary.StackStatus !== "DELETE_COMPLETE"
          ) {
            const described = await client.send(
              new sdk.DescribeStacksCommand({ StackName: summary.StackName }),
            );
            const stack = described.Stacks?.[0];
            if (stack && isOwnedTenantStackForCell(stack, cellId)) stacks.push(stack);
          }
        }
        NextToken = response.NextToken;
      } while (NextToken);
      return stacks;
    },
    async deleteTenantStack(stackName) {
      await client.send(new sdk.DeleteStackCommand({ StackName: stackName }));
    },
    async deleteStack(stackName) {
      await client.send(new sdk.DeleteStackCommand({ StackName: stackName }));
    },
  };
}

exports.handler = async (event) => {
  const result = await createHandler(await createAwsApi())(event);
  console.log("cell janitor result", JSON.stringify(result));
  return result;
};
exports.createHandler = createHandler;
exports.isEligibleCellStack = isEligibleCellStack;
exports.isOwnedTenantStackForCell = isOwnedTenantStackForCell;
exports.parseExpiresAt = parseExpiresAt;
