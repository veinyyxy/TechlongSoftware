"use strict";

const { createHash } = require("node:crypto");

const EXPECTED_ACCOUNT_ID = "402010193138";
const EXPECTED_REGION = "ca-central-1";
const EXPECTED_CELL_ID = "cell-sandbox-1";
const EXPECTED_CELL_STACK_NAME = "techlong-sandbox-cell-sandbox-1";
const EXPECTED_CELL_CLOUD_FORMATION_ROLE_ARN =
  "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole";
const CELL_STACK_PREFIX = "techlong-sandbox-cell-";
const TENANT_STACK_PREFIX = "techlong-sandbox-tenant-";
const TENANT_PREFIX_SUPPORT_STACK_NAMES = Object.freeze(new Set([
  "techlong-sandbox-tenant-b5j3",
  "techlong-sandbox-tenant-b5j4logs",
]));
const AUTHORITY_KEY = "cell:cell-sandbox-1";
const AUTHORITY_TABLE_NAME = "techlong-sandbox-tenant-external-epoch-authority";
const AUTHORITY_TABLE_ARN =
  "arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority";
const PLAN_ACTION = "inspect_cell_cleanup_plan";
const DELETE_INTENT_ACTION = "delete_shared_cell_stack";
const PLAN_ONLY_MODE = "PLAN_ONLY";
const MAX_AUTHORITY_LIFETIME_MS = 60 * 60 * 1000;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const STACK_ID_PATTERN =
  /^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[0-9a-f-]{36}$/;
const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const AUTHORITY_ITEM_KEYS = Object.freeze([
  "authority_key",
  "record_json",
  "revision",
  "schema_version",
]);
const AUTHORITY_RECORD_KEYS = Object.freeze([
  "accountId",
  "cellId",
  "cellExpiresAt",
  "cloudFormationRoleArn",
  "cleanupEpoch",
  "cleanupMarker",
  "cleanupOperationHash",
  "expiresAt",
  "generation",
  "ownerDeploymentId",
  "provisionEpoch",
  "provisionMarker",
  "provisionOperationHash",
  "recordHash",
  "region",
  "resourceInventorySha256",
  "revision",
  "schemaVersion",
  "stackId",
  "stackName",
  "stackStatus",
  "state",
  "templateCanonicalSha256",
]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function exactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("CELL_CLEANUP_CANONICAL_INVALID", "Non-finite JSON number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  fail("CELL_CLEANUP_CANONICAL_INVALID", "Unsupported canonical JSON value.");
}

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Canonical(value) {
  return sha256Text(canonicalJson(value));
}

function provisionOperationIntent(source) {
  return {
    schemaVersion: 2,
    intent: "provision_shared_cell",
    accountId: source.accountId,
    region: source.region,
    cellId: source.cellId,
    stackName: source.stackName,
    stackId: source.stackId,
    stackStatus: source.stackStatus,
    cellExpiresAt: source.cellExpiresAt,
    cloudFormationRoleArn: source.cloudFormationRoleArn,
    templateCanonicalSha256: source.templateCanonicalSha256,
    resourceInventorySha256: source.resourceInventorySha256,
    ownerDeploymentId: source.ownerDeploymentId,
    generation: source.generation,
    provisionEpoch: source.provisionEpoch,
    provisionMarker: source.provisionMarker,
  };
}

function cleanupOperationIntent(source) {
  return {
    schemaVersion: 2,
    intent: "cleanup_shared_cell",
    accountId: source.accountId,
    region: source.region,
    cellId: source.cellId,
    stackName: source.stackName,
    stackId: source.stackId,
    stackStatus: source.stackStatus,
    cellExpiresAt: source.cellExpiresAt,
    cloudFormationRoleArn: source.cloudFormationRoleArn,
    templateCanonicalSha256: source.templateCanonicalSha256,
    resourceInventorySha256: source.resourceInventorySha256,
    ownerDeploymentId: source.ownerDeploymentId,
    generation: source.generation,
    provisionEpoch: source.provisionEpoch,
    provisionMarker: source.provisionMarker,
    provisionOperationHash: source.provisionOperationHash,
    cleanupEpoch: source.cleanupEpoch,
    cleanupMarker: source.cleanupMarker,
    expiresAt: source.expiresAt,
  };
}

function parseUtc(value, label) {
  if (typeof value !== "string" || !UTC_PATTERN.test(value)) {
    fail("CELL_CLEANUP_AUTHORITY_INVALID", `${label} is not canonical UTC.`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    fail("CELL_CLEANUP_AUTHORITY_INVALID", `${label} is not a real UTC instant.`);
  }
  return timestamp;
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail("CELL_CLEANUP_AUTHORITY_INVALID", `${label} must be a positive integer.`);
  }
}

function assertRuntimeEnvironment(environment) {
  if (
    !environment ||
    environment.EXPECTED_ACCOUNT_ID !== EXPECTED_ACCOUNT_ID ||
    environment.EXPECTED_REGION !== EXPECTED_REGION ||
    environment.EXPECTED_CELL_ID !== EXPECTED_CELL_ID ||
    environment.CELL_CLEANUP_AUTHORITY_KEY !== AUTHORITY_KEY ||
    environment.CELL_CLEANUP_AUTHORITY_TABLE_ARN !== AUTHORITY_TABLE_ARN ||
    environment.CELL_CLEANUP_COORDINATOR_MODE !== PLAN_ONLY_MODE ||
    environment.AWS_REGION !== EXPECTED_REGION
  ) {
    fail("CELL_CLEANUP_RUNTIME_INVALID", "Invalid plan-only Cell cleanup runtime environment.");
  }
}

function assertPlanEvent(event) {
  const isExactPlanRequest =
    exactKeys(event, ["action", "schemaVersion"]) &&
    event.schemaVersion === 1 &&
    event.action === PLAN_ACTION;
  const isExactDeleteIntentRequest =
    exactKeys(event, ["action", "cellId", "schemaVersion", "stackName"]) &&
    event.schemaVersion === 1 &&
    event.action === DELETE_INTENT_ACTION &&
    event.stackName === EXPECTED_CELL_STACK_NAME &&
    event.cellId === EXPECTED_CELL_ID;
  if (!isExactPlanRequest && !isExactDeleteIntentRequest) {
    fail("CELL_CLEANUP_REQUEST_INVALID", "Invalid plan-only Cell cleanup request.");
  }
}

function decodeStringAttribute(attribute, label) {
  if (!exactKeys(attribute, ["S"]) || typeof attribute.S !== "string") {
    fail("CELL_CLEANUP_AUTHORITY_INVALID", `${label} is not an exact DynamoDB string.`);
  }
  return attribute.S;
}

function decodeIntegerAttribute(attribute, label) {
  if (!exactKeys(attribute, ["N"]) || typeof attribute.N !== "string" || !/^[1-9][0-9]*$/.test(attribute.N)) {
    fail("CELL_CLEANUP_AUTHORITY_INVALID", `${label} is not an exact DynamoDB integer.`);
  }
  const value = Number(attribute.N);
  assertPositiveInteger(value, label);
  return value;
}

function decodeAuthorityItem(item) {
  if (item === undefined) return null;
  if (!exactKeys(item, AUTHORITY_ITEM_KEYS)) {
    fail("CELL_CLEANUP_AUTHORITY_INVALID", "Authority item keys drifted.");
  }
  const schemaVersion = decodeIntegerAttribute(item.schema_version, "schema_version");
  if (schemaVersion !== 2) {
    fail("CELL_CLEANUP_AUTHORITY_INVALID", "Authority item schema version is invalid.");
  }
  return {
    authority_key: decodeStringAttribute(item.authority_key, "authority_key"),
    schema_version: schemaVersion,
    revision: decodeIntegerAttribute(item.revision, "revision"),
    record_json: decodeStringAttribute(item.record_json, "record_json"),
  };
}

function validateAuthorityItem(item, nowMs) {
  if (item === null || item === undefined) {
    fail("CELL_CLEANUP_AUTHORITY_MISSING", "Cell cleanup authority record is missing.");
  }
  if (
    !exactKeys(item, AUTHORITY_ITEM_KEYS) ||
    item.authority_key !== AUTHORITY_KEY ||
    item.schema_version !== 2 ||
    !Number.isSafeInteger(item.revision) ||
    item.revision < 1 ||
    typeof item.record_json !== "string" ||
    item.record_json.length > 16_384
  ) {
    fail("CELL_CLEANUP_AUTHORITY_INVALID", "Cell cleanup authority item is invalid.");
  }
  let record;
  try {
    record = JSON.parse(item.record_json);
  } catch {
    fail("CELL_CLEANUP_AUTHORITY_INVALID", "Cell cleanup authority JSON is invalid.");
  }
  if (!exactKeys(record, AUTHORITY_RECORD_KEYS)) {
    fail("CELL_CLEANUP_AUTHORITY_INVALID", "Cell cleanup authority record keys drifted.");
  }
  if (canonicalJson(record) !== item.record_json) {
    fail("CELL_CLEANUP_AUTHORITY_INVALID", "Cell cleanup authority record is not canonical JSON.");
  }
  for (const [value, label] of [
    [record.generation, "generation"],
    [record.provisionEpoch, "provisionEpoch"],
    [record.cleanupEpoch, "cleanupEpoch"],
    [record.revision, "revision"],
  ]) assertPositiveInteger(value, label);
  if (
    record.schemaVersion !== 2 ||
    record.accountId !== EXPECTED_ACCOUNT_ID ||
    record.region !== EXPECTED_REGION ||
    record.cellId !== EXPECTED_CELL_ID ||
    record.stackName !== EXPECTED_CELL_STACK_NAME ||
    record.cloudFormationRoleArn !== EXPECTED_CELL_CLOUD_FORMATION_ROLE_ARN ||
    !STACK_ID_PATTERN.test(record.stackId) ||
    !DIGEST_PATTERN.test(record.templateCanonicalSha256) ||
    !DIGEST_PATTERN.test(record.resourceInventorySha256) ||
    !OWNER_PATTERN.test(record.ownerDeploymentId) ||
    record.cleanupEpoch <= record.provisionEpoch ||
    record.provisionMarker !==
      `tl_cell_epoch_${EXPECTED_CELL_ID}_g${record.generation}_e${record.provisionEpoch}` ||
    record.cleanupMarker !==
      `tl_cell_epoch_${EXPECTED_CELL_ID}_g${record.generation}_e${record.cleanupEpoch}` ||
    !DIGEST_PATTERN.test(record.provisionOperationHash) ||
    !DIGEST_PATTERN.test(record.cleanupOperationHash) ||
    record.revision !== item.revision ||
    !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(record.stackStatus) ||
    record.state !== "cleanup_authorized" ||
    !DIGEST_PATTERN.test(record.recordHash)
  ) {
    fail("CELL_CLEANUP_AUTHORITY_INVALID", "Cell cleanup authority fields are invalid.");
  }
  const expiresAt = parseUtc(record.expiresAt, "expiresAt");
  const cellExpiresAt = parseUtc(record.cellExpiresAt, "cellExpiresAt");
  if (expiresAt <= nowMs || expiresAt - nowMs > MAX_AUTHORITY_LIFETIME_MS) {
    fail("CELL_CLEANUP_AUTHORITY_EXPIRED", "Cell cleanup authority is expired or too long-lived.");
  }
  if (cellExpiresAt > nowMs) {
    fail("CELL_CLEANUP_CELL_NOT_EXPIRED", "Authority does not bind an expired Shared Cell.");
  }
  const unsigned = Object.fromEntries(
    AUTHORITY_RECORD_KEYS.filter((key) => key !== "recordHash").map((key) => [key, record[key]]),
  );
  if (sha256Canonical(unsigned) !== record.recordHash) {
    fail("CELL_CLEANUP_AUTHORITY_HASH_MISMATCH", "Cell cleanup authority hash drifted.");
  }
  if (
    sha256Canonical(provisionOperationIntent(record)) !== record.provisionOperationHash ||
    sha256Canonical(cleanupOperationIntent(record)) !== record.cleanupOperationHash ||
    record.provisionOperationHash === record.cleanupOperationHash
  ) {
    fail(
      "CELL_CLEANUP_AUTHORITY_OPERATION_HASH_MISMATCH",
      "Cell cleanup authority operation hash drifted.",
    );
  }
  return record;
}

function tagsToMap(tags) {
  if (!Array.isArray(tags)) fail("CELL_CLEANUP_CELL_INVALID", "Cell tags are missing.");
  const result = {};
  for (const tag of tags) {
    if (!tag || typeof tag.Key !== "string" || typeof tag.Value !== "string" || Object.hasOwn(result, tag.Key)) {
      fail("CELL_CLEANUP_CELL_INVALID", "Cell tags are malformed or duplicated.");
    }
    result[tag.Key] = tag.Value;
  }
  return result;
}

function validateCellStack(stack, nowMs) {
  if (
    !stack ||
    typeof stack !== "object" ||
    stack.StackName !== EXPECTED_CELL_STACK_NAME ||
    !STACK_ID_PATTERN.test(stack.StackId ?? "") ||
    stack.RoleARN !== EXPECTED_CELL_CLOUD_FORMATION_ROLE_ARN ||
    stack.ParentId ||
    stack.RootId ||
    typeof stack.StackStatus !== "string" ||
    !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(stack.StackStatus)
  ) {
    fail("CELL_CLEANUP_CELL_INVALID", "Exact Shared Cell Stack evidence is invalid.");
  }
  const tags = tagsToMap(stack.Tags);
  if (
    tags.Environment !== "aws-sandbox" ||
    tags.ManagedBy !== "techlong-cell-operator" ||
    tags.CellId !== EXPECTED_CELL_ID
  ) {
    fail("CELL_CLEANUP_CELL_OWNERSHIP_MISMATCH", "Shared Cell ownership tags drifted.");
  }
  if (parseUtc(tags.ExpiresAt, "Cell ExpiresAt") > nowMs) {
    fail("CELL_CLEANUP_CELL_NOT_EXPIRED", "Shared Cell has not expired.");
  }
  return stack;
}

function canonicalTemplateBody(templateBody) {
  let parsed = templateBody;
  if (typeof templateBody === "string") {
    try {
      parsed = JSON.parse(templateBody);
    } catch {
      fail("CELL_CLEANUP_TEMPLATE_INVALID", "Shared Cell template is not JSON.");
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("CELL_CLEANUP_TEMPLATE_INVALID", "Shared Cell template is invalid.");
  }
  return sha256Canonical(parsed);
}

function resourceInventoryHash(resources) {
  if (!Array.isArray(resources) || resources.length === 0) {
    fail("CELL_CLEANUP_INVENTORY_INVALID", "Shared Cell resource inventory is empty.");
  }
  const seen = new Set();
  const projection = resources.map((resource) => {
    const projected = {
      logicalResourceId: resource?.LogicalResourceId,
      physicalResourceId: resource?.PhysicalResourceId,
      resourceStatus: resource?.ResourceStatus,
      resourceType: resource?.ResourceType,
    };
    if (
      Object.values(projected).some((value) => typeof value !== "string" || value.length === 0) ||
      seen.has(projected.logicalResourceId)
    ) {
      fail("CELL_CLEANUP_INVENTORY_INVALID", "Shared Cell resource inventory drifted.");
    }
    seen.add(projected.logicalResourceId);
    return projected;
  });
  projection.sort((left, right) => left.logicalResourceId.localeCompare(right.logicalResourceId));
  return sha256Canonical(projection);
}

function planResult(decision, details = {}) {
  return {
    schemaVersion: 1,
    action: PLAN_ACTION,
    coordinatorMode: PLAN_ONLY_MODE,
    decision,
    mutationPerformed: false,
    ...details,
  };
}

function validateStackNames(names) {
  if (!Array.isArray(names)) fail("CELL_CLEANUP_INVENTORY_INVALID", "Stack inventory is not an array.");
  const seen = new Set();
  for (const name of names) {
    if (typeof name !== "string" || name.length === 0 || seen.has(name)) {
      fail("CELL_CLEANUP_INVENTORY_INVALID", "Stack inventory is malformed or duplicated.");
    }
    seen.add(name);
  }
  return [...seen].sort();
}

function createHandler(api, now = () => Date.now()) {
  if (!api || typeof api !== "object") fail("CELL_CLEANUP_API_INVALID", "api is required.");
  return async function handle(event) {
    assertPlanEvent(event);
    const names = validateStackNames(await api.listStackNames());
    const tenantStacks = names.filter(
      (name) =>
        name.startsWith(TENANT_STACK_PREFIX) &&
        !TENANT_PREFIX_SUPPORT_STACK_NAMES.has(name),
    );
    if (tenantStacks.length > 0) {
      return planResult("BLOCKED_TENANT_STACKS", { tenantStacks });
    }
    const unexpectedCellStacks = names.filter(
      (name) => name.startsWith(CELL_STACK_PREFIX) && name !== EXPECTED_CELL_STACK_NAME,
    );
    if (unexpectedCellStacks.length > 0) {
      return planResult("BLOCKED_UNEXPECTED_CELL_STACKS", { unexpectedCellStacks });
    }
    if (!names.includes(EXPECTED_CELL_STACK_NAME)) {
      return planResult("ABSENT_SAFE", { cellStack: "MISSING", tenantStacks: [] });
    }

    const observedAt = now();
    const stack = validateCellStack(await api.describeStack(), observedAt);
    const [templateBody, resources, authorityItem] = await Promise.all([
      api.getTemplate(),
      api.listStackResources(),
      api.getAuthorityItem(),
    ]);
    const templateCanonicalSha256 = canonicalTemplateBody(templateBody);
    const resourceInventorySha256 = resourceInventoryHash(resources);
    const authority = validateAuthorityItem(authorityItem, observedAt);
    if (
      authority.stackId !== stack.StackId ||
      authority.stackStatus !== stack.StackStatus ||
      authority.cellExpiresAt !== tagsToMap(stack.Tags).ExpiresAt ||
      authority.cloudFormationRoleArn !== stack.RoleARN ||
      authority.templateCanonicalSha256 !== templateCanonicalSha256 ||
      authority.resourceInventorySha256 !== resourceInventorySha256
    ) {
      fail("CELL_CLEANUP_AUTHORITY_DRIFT", "Authority does not bind the observed Shared Cell.");
    }
    return planResult("PLAN_READY_MUTATION_DISABLED", {
      cellStack: stack.StackId,
      authorityRevision: authority.revision,
      authorityRecordHash: authority.recordHash,
      cloudFormationRoleArn: authority.cloudFormationRoleArn,
      generation: authority.generation,
      provisionEpoch: authority.provisionEpoch,
      cleanupEpoch: authority.cleanupEpoch,
      templateCanonicalSha256,
      resourceInventorySha256,
      tenantStacks: [],
    });
  };
}

async function createAwsApi() {
  // The deployed coordinator deliberately imports no mutating AWS command.
  const cloudFormation = require("@aws-sdk/client-cloudformation");
  const dynamoDb = require("@aws-sdk/client-dynamodb");
  const cloudFormationClient = new cloudFormation.CloudFormationClient({ region: EXPECTED_REGION });
  const dynamoDbClient = new dynamoDb.DynamoDBClient({ region: EXPECTED_REGION });
  return {
    async listStackNames() {
      const names = [];
      let NextToken;
      do {
        const response = await cloudFormationClient.send(
          new cloudFormation.ListStacksCommand({ NextToken }),
        );
        for (const summary of response.StackSummaries ?? []) {
          if (
            typeof summary.StackName === "string" &&
            summary.StackStatus !== "DELETE_COMPLETE" &&
            (summary.StackName.startsWith(CELL_STACK_PREFIX) ||
              summary.StackName.startsWith(TENANT_STACK_PREFIX))
          ) names.push(summary.StackName);
        }
        NextToken = response.NextToken;
      } while (NextToken);
      return names;
    },
    async describeStack() {
      const response = await cloudFormationClient.send(
        new cloudFormation.DescribeStacksCommand({ StackName: EXPECTED_CELL_STACK_NAME }),
      );
      if (!response.Stacks?.[0]) fail("CELL_CLEANUP_CELL_INVALID", "Cell Stack description is empty.");
      return response.Stacks[0];
    },
    async getTemplate() {
      const response = await cloudFormationClient.send(
        new cloudFormation.GetTemplateCommand({
          StackName: EXPECTED_CELL_STACK_NAME,
          TemplateStage: "Original",
        }),
      );
      return response.TemplateBody;
    },
    async listStackResources() {
      const resources = [];
      let NextToken;
      do {
        const response = await cloudFormationClient.send(
          new cloudFormation.ListStackResourcesCommand({
            StackName: EXPECTED_CELL_STACK_NAME,
            NextToken,
          }),
        );
        resources.push(...(response.StackResourceSummaries ?? []));
        NextToken = response.NextToken;
      } while (NextToken);
      return resources;
    },
    async getAuthorityItem() {
      const response = await dynamoDbClient.send(
        new dynamoDb.GetItemCommand({
          TableName: AUTHORITY_TABLE_NAME,
          Key: { authority_key: { S: AUTHORITY_KEY } },
          ConsistentRead: true,
        }),
      );
      return decodeAuthorityItem(response.Item);
    },
  };
}

exports.handler = async (event) => {
  assertRuntimeEnvironment(process.env);
  const result = await createHandler(await createAwsApi())(event);
  console.log("cell cleanup plan", JSON.stringify(result));
  return result;
};
exports.createHandler = createHandler;
exports.canonicalJson = canonicalJson;
exports.sha256Canonical = sha256Canonical;
exports.validateAuthorityItem = validateAuthorityItem;
exports.decodeAuthorityItem = decodeAuthorityItem;
exports.resourceInventoryHash = resourceInventoryHash;
exports.assertRuntimeEnvironment = assertRuntimeEnvironment;
