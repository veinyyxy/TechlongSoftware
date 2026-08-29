import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const {
  assertRuntimeEnvironment,
  canonicalJson,
  createHandler,
  decodeAuthorityItem,
  resourceInventoryHash,
  sha256Canonical,
  validateAuthorityItem,
} = require("../ops/aws-sandbox/lambda/cell-janitor.cjs");

const now = Date.UTC(2026, 7, 27, 6, 0, 0);
const cellExpiresAt = new Date(now - 60_000).toISOString();
const authorizationExpiresAt = new Date(now + 15 * 60_000).toISOString();
const stackName = "techlong-sandbox-cell-sandbox-1";
const stackId =
  "arn:aws:cloudformation:ca-central-1:402010193138:stack/" +
  `${stackName}/12345678-1234-1234-1234-123456789012`;
const template = {
  AWSTemplateFormatVersion: "2010-09-09",
  Resources: { Cluster: { Type: "AWS::ECS::Cluster" } },
};
const resources = [
  {
    LogicalResourceId: "Cluster",
    PhysicalResourceId: "cell-sandbox-1",
    ResourceStatus: "CREATE_COMPLETE",
    ResourceType: "AWS::ECS::Cluster",
  },
];

function stack(overrides = {}) {
  return {
    StackName: stackName,
    StackId: stackId,
    StackStatus: "CREATE_COMPLETE",
    Tags: [
      { Key: "Environment", Value: "aws-sandbox" },
      { Key: "ManagedBy", Value: "techlong-cell-operator" },
      { Key: "CellId", Value: "cell-sandbox-1" },
      { Key: "ExpiresAt", Value: cellExpiresAt },
    ],
    ...overrides,
  };
}

function authorityRecord(overrides = {}) {
  const unsigned = {
    schemaVersion: 1,
    accountId: "402010193138",
    region: "ca-central-1",
    cellId: "cell-sandbox-1",
    stackName,
    stackId,
    stackStatus: "CREATE_COMPLETE",
    cellExpiresAt,
    templateCanonicalSha256: sha256Canonical(template),
    resourceInventorySha256: resourceInventoryHash(resources),
    ownerDeploymentId: "deployment_cell_owner_1",
    generation: 1,
    provisionEpoch: 1,
    provisionMarker: "tl_cell_epoch_cell-sandbox-1_g1_e1",
    provisionOperationHash: "a".repeat(64),
    cleanupEpoch: 2,
    cleanupMarker: "tl_cell_epoch_cell-sandbox-1_g1_e2",
    cleanupOperationHash: "b".repeat(64),
    revision: 7,
    expiresAt: authorizationExpiresAt,
    state: "cleanup_authorized",
    ...overrides,
  };
  return { ...unsigned, recordHash: sha256Canonical(unsigned) };
}

function authorityItem(overrides = {}) {
  const record = authorityRecord(overrides);
  return {
    authority_key: "cell:cell-sandbox-1",
    schema_version: 1,
    revision: record.revision,
    record_json: canonicalJson(record),
  };
}

function api(overrides = {}) {
  const calls = [];
  return {
    calls,
    value: {
      listStackNames: async () => {
        calls.push("listStackNames");
        return [stackName];
      },
      describeStack: async () => {
        calls.push("describeStack");
        return stack();
      },
      getTemplate: async () => {
        calls.push("getTemplate");
        return template;
      },
      listStackResources: async () => {
        calls.push("listStackResources");
        return resources;
      },
      getAuthorityItem: async () => {
        calls.push("getAuthorityItem");
        return authorityItem();
      },
      ...overrides,
    },
  };
}

const request = { schemaVersion: 1, action: "inspect_cell_cleanup_plan" };
const tenantPrefixSupportStacks = [
  "techlong-sandbox-tenant-b5j3",
  "techlong-sandbox-tenant-b5j4logs",
];

test("plan-only coordinator returns ABSENT_SAFE without authority or mutation calls", async () => {
  const fixture = api({ listStackNames: async () => [] });
  const result = await createHandler(fixture.value, () => now)(request);
  assert.deepEqual(result, {
    schemaVersion: 1,
    action: "inspect_cell_cleanup_plan",
    coordinatorMode: "PLAN_ONLY",
    decision: "ABSENT_SAFE",
    mutationPerformed: false,
    cellStack: "MISSING",
    tenantStacks: [],
  });
  assert.deepEqual(fixture.calls, []);
});

test("plan-only coordinator excludes only the two exact tenant-prefixed support Stacks", async () => {
  const fixture = api({ listStackNames: async () => tenantPrefixSupportStacks });
  const result = await createHandler(fixture.value, () => now)(request);
  assert.equal(result.decision, "ABSENT_SAFE");
  assert.deepEqual(result.tenantStacks, []);
  assert.deepEqual(fixture.calls, []);
});

test("support Stack exclusions never hide a real or similarly named tenant Stack", async () => {
  const fixture = api({
    listStackNames: async () => [
      ...tenantPrefixSupportStacks,
      "techlong-sandbox-tenant-app-one",
      "techlong-sandbox-tenant-b5j3-copy",
      "techlong-sandbox-tenant-b5j4logs-extra",
    ],
  });
  const result = await createHandler(fixture.value, () => now)(request);
  assert.equal(result.decision, "BLOCKED_TENANT_STACKS");
  assert.deepEqual(result.tenantStacks, [
    "techlong-sandbox-tenant-app-one",
    "techlong-sandbox-tenant-b5j3-copy",
    "techlong-sandbox-tenant-b5j4logs-extra",
  ]);
  assert.deepEqual(fixture.calls, []);
});

test("plan-only coordinator blocks every tenant Stack before Cell evidence reads", async () => {
  const fixture = api({
    listStackNames: async () => [
      stackName,
      "techlong-sandbox-tenant-app-one",
      "techlong-sandbox-tenant-app-two",
    ],
  });
  const result = await createHandler(fixture.value, () => now)(request);
  assert.equal(result.decision, "BLOCKED_TENANT_STACKS");
  assert.deepEqual(result.tenantStacks, [
    "techlong-sandbox-tenant-app-one",
    "techlong-sandbox-tenant-app-two",
  ]);
  assert.equal(result.mutationPerformed, false);
  assert.deepEqual(fixture.calls, []);
});

test("plan-only coordinator blocks unexpected Cell names", async () => {
  const fixture = api({
    listStackNames: async () => [stackName, "techlong-sandbox-cell-foreign"],
  });
  const result = await createHandler(fixture.value, () => now)(request);
  assert.equal(result.decision, "BLOCKED_UNEXPECTED_CELL_STACKS");
  assert.deepEqual(result.unexpectedCellStacks, ["techlong-sandbox-cell-foreign"]);
  assert.equal(result.mutationPerformed, false);
});

test("plan-only coordinator binds exact Stack, template, inventory and authority", async () => {
  const fixture = api();
  const result = await createHandler(fixture.value, () => now)(request);
  assert.deepEqual(result, {
    schemaVersion: 1,
    action: "inspect_cell_cleanup_plan",
    coordinatorMode: "PLAN_ONLY",
    decision: "PLAN_READY_MUTATION_DISABLED",
    mutationPerformed: false,
    cellStack: stackId,
    authorityRevision: 7,
    authorityRecordHash: authorityRecord().recordHash,
    generation: 1,
    provisionEpoch: 1,
    cleanupEpoch: 2,
    templateCanonicalSha256: sha256Canonical(template),
    resourceInventorySha256: resourceInventoryHash(resources),
    tenantStacks: [],
  });
  assert.deepEqual(new Set(fixture.calls), new Set([
    "listStackNames",
    "describeStack",
    "getTemplate",
    "listStackResources",
    "getAuthorityItem",
  ]));
});

test("authority record rejects missing, expired, noncanonical and drifted evidence", async () => {
  const cases = [
    { item: null, code: "CELL_CLEANUP_AUTHORITY_MISSING" },
    {
      item: authorityItem({ expiresAt: new Date(now - 1).toISOString() }),
      code: "CELL_CLEANUP_AUTHORITY_EXPIRED",
    },
    {
      item: { ...authorityItem(), record_json: JSON.stringify(authorityRecord()) },
      code: "CELL_CLEANUP_AUTHORITY_INVALID",
    },
    {
      item: authorityItem({ stackId: stackId.replace(/12345678/, "87654321") }),
      code: "CELL_CLEANUP_AUTHORITY_DRIFT",
    },
    {
      item: authorityItem({ templateCanonicalSha256: "c".repeat(64) }),
      code: "CELL_CLEANUP_AUTHORITY_DRIFT",
    },
  ];
  for (const entry of cases) {
    const fixture = api({ getAuthorityItem: async () => entry.item });
    await assert.rejects(
      createHandler(fixture.value, () => now)(request),
      (error) => {
        assert.equal(error.code, entry.code);
        return true;
      },
    );
  }
});

test("authority hash and epoch marker drift fail closed", () => {
  const item = authorityItem();
  const record = JSON.parse(item.record_json);
  assert.throws(
    () => validateAuthorityItem({ ...item, record_json: canonicalJson({ ...record, recordHash: "f".repeat(64) }) }, now),
    (error) => error.code === "CELL_CLEANUP_AUTHORITY_HASH_MISMATCH",
  );
  const markerDrift = authorityRecord({ cleanupMarker: "tl_cell_epoch_cell-sandbox-1_g1_e9" });
  assert.throws(
    () => validateAuthorityItem({ ...item, record_json: canonicalJson(markerDrift) }, now),
    (error) => error.code === "CELL_CLEANUP_AUTHORITY_INVALID",
  );
});

test("DynamoDB item decoder accepts only the four exact projected attributes", () => {
  const item = authorityItem();
  assert.deepEqual(decodeAuthorityItem({
    authority_key: { S: item.authority_key },
    schema_version: { N: String(item.schema_version) },
    revision: { N: String(item.revision) },
    record_json: { S: item.record_json },
  }), item);
  assert.throws(
    () => decodeAuthorityItem({
      authority_key: { S: item.authority_key },
      schema_version: { N: "1" },
      revision: { N: "7" },
      record_json: { S: item.record_json },
      foreign: { S: "no" },
    }),
    (error) => error.code === "CELL_CLEANUP_AUTHORITY_INVALID",
  );
});

test("request and runtime configuration are exact and planner source has no delete command", async () => {
  const fixture = api();
  for (const event of [
    {},
    { schemaVersion: "1", action: "inspect_cell_cleanup_plan" },
    { schemaVersion: 1, action: "delete_shared_cell_stack" },
    { schemaVersion: 1, action: "inspect_cell_cleanup_plan", stackName },
  ]) {
    await assert.rejects(
      createHandler(fixture.value, () => now)(event),
      (error) => error.code === "CELL_CLEANUP_REQUEST_INVALID",
    );
  }
  const environment = {
    EXPECTED_ACCOUNT_ID: "402010193138",
    EXPECTED_REGION: "ca-central-1",
    EXPECTED_CELL_ID: "cell-sandbox-1",
    CELL_CLEANUP_AUTHORITY_KEY: "cell:cell-sandbox-1",
    CELL_CLEANUP_AUTHORITY_TABLE_ARN:
      "arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority",
    CELL_CLEANUP_COORDINATOR_MODE: "PLAN_ONLY",
    AWS_REGION: "ca-central-1",
  };
  assert.doesNotThrow(() => assertRuntimeEnvironment(environment));
  assert.throws(
    () => assertRuntimeEnvironment({ ...environment, CELL_CLEANUP_COORDINATOR_MODE: "MUTATE" }),
    (error) => error.code === "CELL_CLEANUP_RUNTIME_INVALID",
  );
  const source = await readFile(
    new URL("../ops/aws-sandbox/lambda/cell-janitor.cjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /DeleteStackCommand|UpdateStackCommand|CreateChangeSetCommand/);
  assert.doesNotMatch(source, /delete_shared_cell_stack|scan_expired_shared_cell_stacks/);
  assert.match(source, /ConsistentRead:\s*true/);
  assert.match(source, /mutationPerformed:\s*false/);
});
