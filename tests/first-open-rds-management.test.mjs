import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { FIRST_OPEN_BASELINE_BUCKET, FIRST_OPEN_BASELINE_OBJECTS } from "../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { deriveTenantRuntimeSecretName } from "../lib/deployments/execution/tenant-database.ts";
import { createFirstOpenRdsManagement } from "../ops/platform-hosting-v1/first-open-rds-management.ts";
import { FIRST_OPEN_TASK_ACCOUNT as account, FIRST_OPEN_TASK_REGION as region, FIRST_OPEN_TASK_ROLE as roleArn } from "../ops/platform-hosting-v1/first-open-task-identity.ts";

const now = 1_800_000_000_000;
const tenant = { schemaVersion: 1, appInstanceId: "app_fixture", workspaceId: "ws_fixture", productId: "product_fixture",
  environmentId: "env_aws_sandbox_ca_central_1", cellKey: "cell-sandbox-1", databaseName: "fixture_db",
  roleName: "fixture_role", secretName: "techlong/sandbox/tenant/fixture/runtime", stableIdentityHash: "a".repeat(64) };
const resourceFence = { schemaVersion: 1, identity: tenant, generation: 1, ownerDeploymentId: "deployment_fixture",
  ownershipMarker: `tl_owner_${"a".repeat(32)}_g1` };
const fence = { schemaVersion: 1, state: "active", resourceFence, ownerDeploymentId: resourceFence.ownerDeploymentId,
  intent: "provision", epoch: 1, operationHash: "b".repeat(64), marker: `tl_epoch_${"a".repeat(24)}_g1_e1` };
const secretPrefix = `arn:aws:secretsmanager:${region}:${account}:secret:`;
const managementSecret = { arn: secretPrefix + "fixture-manager-a12345", versionId: "1".repeat(32) };
const target = { kind: "rds", engine: "postgres", host: `fixture.abcdef.${region}.rds.amazonaws.com`,
  port: 5432, dbInstanceIdentifier: "fixture", database: tenant.databaseName, username: "fixture_owner", owner: "fixture_owner",
  databaseOid: "12345", ownershipMarker: resourceFence.ownershipMarker, isolatedEmpty: true };
const scope = { fence, managementSecret, target, writeBefore: now + 60_000,
  applicationSecretRef: secretPrefix + deriveTenantRuntimeSecretName(resourceFence) + "-a12345",
  baselineVersions: { archive: "archive-version", manifest: "manifest-version" },
  stack: { templateSha256: "c".repeat(64), parametersSha256: "d".repeat(64) } };
const databaseUrl = `postgresql://${target.username}:fixture@${target.host}/${target.database}?sslmode=verify-full`;

function makeFixture(options = {}) {
  const calls = [];
  const ports = createFirstOpenRdsManagement({ identity: { roleArn, credentials: () => assert.fail("real SDK call") },
    scope: options.scope ?? scope, now: () => now,
    assertActive: async expected => { assert.deepEqual(expected, fence); calls.push("active"); },
    readCa: async () => "fixture-ca",
    clients: {
      async identity() { calls.push("identity"); return { Account: account, Arn: options.arn ??
        `arn:aws:sts::${account}:assumed-role/TechlongSandboxFirstOpenTaskRole/fixture` }; },
      async describe() { assert.fail("unexpected describe"); },
      async create() { assert.fail("unexpected create"); },
      async secret(command) { calls.push("secret");
        assert.deepEqual(command.input, { SecretId: managementSecret.arn, VersionId: managementSecret.versionId });
        return { ARN: managementSecret.arn, VersionId: options.secretVersion ?? managementSecret.versionId,
          SecretString: JSON.stringify({ database_url: databaseUrl }) }; },
      async baseline(command) { calls.push("baseline");
        assert.deepEqual(command.input, { Bucket: FIRST_OPEN_BASELINE_BUCKET, ExpectedBucketOwner: account,
          VersionId: scope.baselineVersions.archive, Key: FIRST_OPEN_BASELINE_OBJECTS.archive.key });
        return { VersionId: scope.baselineVersions.archive, ContentLength: FIRST_OPEN_BASELINE_OBJECTS.archive.bytes,
          Body: Readable.from([new Uint8Array(FIRST_OPEN_BASELINE_OBJECTS.archive.bytes)]) }; },
    },
    openTarget(config) { assert.deepEqual(config.target, target); assert.equal(config.databaseUrl, databaseUrl);
      return { async inspectEmpty() { calls.push("empty"); return { eligibleEmpty: !options.nonempty }; },
        async initialize() { assert.fail("unverified bytes reached tenant SQL"); } }; },
  });
  const input = { context: { deployment: { id: resourceFence.ownerDeploymentId }, appInstance: {
    id: tenant.appInstanceId, workspaceId: tenant.workspaceId,
  }, environment: { id: tenant.environmentId, expectedAccountId: account, region }, binding: {
    workerRoleArn: `arn:aws:iam::${account}:role/TechlongSandboxProvisionerRole`,
  }, tenantExternalOperation: fence }, externalFence: fence, signal: new AbortController().signal };
  return { ...ports, calls, input };
}

test("Management reads the exact pinned credential and emptiness once, then consumes a bad baseline attempt", async () => {
  const f = makeFixture();
  const observation = await f.tenantDatabase.ensureTenantDatabase(f.input);
  assert.equal(observation.lifecycleState, "empty");
  assert.equal(observation.secretRef, scope.applicationSecretRef);
  assert.equal(JSON.stringify(observation).includes(databaseUrl), false);
  await assert.rejects(f.tenantDatabase.ensureTenantDatabase(f.input), /DATABASE_ALREADY_ATTESTED/);
  await assert.rejects(f.tenantDatabase.migrateTenantDatabase(f.input), /BASELINE_BYTES/);
  await assert.rejects(f.tenantDatabase.migrateTenantDatabase(f.input), /DATABASE_INITIALIZATION_STATE/);
  assert.equal(f.calls.filter(call => call === "secret" || call === "baseline" || call === "empty").length, 3);
});

test("Management rejects mismatched tenants, roles, secret versions and occupied databases", async () => {
  for (const [options, update, code, calls] of [
    [{}, input => { input.context.appInstance.workspaceId = "different"; }, /MANAGEMENT_FENCE/, []],
    [{ arn: `arn:aws:sts::${account}:assumed-role/TechlongSandboxProvisionerRole/fixture` }, () => {}, /MANAGEMENT_CALLER/, ["active", "identity"]],
    [{ secretVersion: "z".repeat(32) }, () => {}, /MANAGEMENT_SECRET/, ["active", "identity", "secret"]],
    [{ nonempty: true }, () => {}, /POSTGRES_NOT_EMPTY/, ["active", "identity", "secret", "empty"]],
  ]) {
    const f = makeFixture(options);
    update(f.input);
    await assert.rejects(f.tenantDatabase.ensureTenantDatabase(f.input), code);
    assert.deepEqual(f.calls, calls);
  }
});

test("Management has no update/delete path and never describes an unrelated or uncompiled stack", async () => {
  const f = makeFixture();
  assert.throws(() => f.aws.applyTenantStack(), /OPERATION_DISABLED/);
  assert.throws(() => f.aws.deleteTenantStack(), /OPERATION_DISABLED/);
  await assert.rejects(f.aws.describeTenantStack("unrelated", f.input), /STACK_SCOPE/);
  await assert.rejects(f.aws.applySupervisedTenantStack({}, { createOnly: true, signal: f.input.signal }));
  assert.deepEqual(f.calls, []);
});
