import assert from "node:assert/strict";
import { rootCertificates } from "node:tls";
import test from "node:test";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { awsSandboxTenantStackName } from "../lib/deployments/cloudformation/tenant-stack.ts";
import { tenantExternalOperationHash } from "../lib/deployments/execution/external-ownership-coordinator.ts";
import { deriveTenantOwnershipMarker, deriveTenantResourceIdentityFromPlan } from "../lib/deployments/execution/tenant-database.ts";
import { createFirstOpenRdsOwnership, createFirstOpenRdsRepository, FIRST_OPEN_RDS_AUTHORITY_TABLE_ARN } from "../ops/platform-hosting-v1/first-open-rds-ownership.ts";
import { FIRST_OPEN_TASK_ACCOUNT as account, FIRST_OPEN_TASK_REGION as region, FIRST_OPEN_TASK_ROLE as roleArn } from "../ops/platform-hosting-v1/first-open-task-identity.ts";
import { createFirstOpenTaskRds } from "../ops/platform-hosting-v1/first-open-task-rds.mjs";

const now = () => 1_800_000_000_000, writeBefore = now() + 30_000;
const appInstanceId = "app_ownership", workspaceId = "workspace_ownership", deploymentId = "dep_ownership";
const environmentId = "env_aws_sandbox_ca_central_1", cellKey = "cell-sandbox-1", productId = "prd_restaurant_order_system";
const scope = { deploymentId, appInstanceId, environmentId, planHash: "a".repeat(64), configurationHash: "b".repeat(64),
  artifactRef: account + ".dkr.ecr." + region + ".amazonaws.com/techlong-sandbox-speedfeast@sha256:" + "c".repeat(64) };
const approval = { executionId: "exec_" + "d".repeat(32), jobId: "job_" + "e".repeat(24), instanceId: appInstanceId, workspaceId };
const lease = { jobId: approval.jobId, deploymentId, workerId: approval.executionId, attempt: 1, leaseToken: "lease_" + "f".repeat(32) };
const databaseIdentity = await deriveTenantResourceIdentityFromPlan({ appInstanceId, workspaceId, productId, environmentId, cellKey },
  { databaseName: "tenant_ownership_db", roleName: "tenant_ownership_role" });
const resourceFence = { schemaVersion: 1, identity: databaseIdentity, generation: 1, ownerDeploymentId: deploymentId,
  ownershipMarker: deriveTenantOwnershipMarker(databaseIdentity, 1) };
const deployment = { id: deploymentId, appInstanceId, environmentId, planHash: scope.planHash, configurationHash: scope.configurationHash,
  artifactRef: scope.artifactRef };
const fence = { schemaVersion: 1, state: "active", resourceFence, epoch: 1, intent: "provision", ownerDeploymentId: deploymentId,
  marker: "tl_epoch_" + databaseIdentity.stableIdentityHash.slice(0, 24) + "_g1_e1",
  operationHash: await tenantExternalOperationHash("provision", resourceFence, deployment) };
const context = { deployment, job: { id: approval.jobId, deploymentId, attempt: 1, leaseToken: lease.leaseToken, leaseExpiresAt: writeBefore },
  appInstance: { id: appInstanceId, workspaceId, productId }, workspace: { id: workspaceId },
  environment: { id: environmentId, cellKey, region, expectedAccountId: account } };
const binding = { scope, approval, fence, writeBefore, now };
const pendingFence = { ...fence, state: "pending_external" };

function fixture({ loseWriteResponse = false, loseReadback = false, moved = false, startWith } = {}) {
  const calls = [], signal = new AbortController().signal;
  let item = startWith;
  const make = (overrides = {}) => createFirstOpenRdsOwnership({ ...binding,
    identity: { roleArn, credentials: async () => assert.fail("no live credentials") }, tableArn: FIRST_OPEN_RDS_AUTHORITY_TABLE_ARN,
    dynamo: { commands: { get: GetCommand, put: PutCommand }, client: {
      async send(command) {
        assert.equal(command.input.TableName, FIRST_OPEN_RDS_AUTHORITY_TABLE_ARN);
        const key = "tenant:" + databaseIdentity.stableIdentityHash;
        if (command instanceof GetCommand) {
          calls.push("consistent-get");
          assert.deepEqual(command.input.Key, { authority_key: key });
          assert.equal(command.input.ConsistentRead, true);
          return item && !loseReadback ? { Item: item } : {};
        }
        assert.ok(command instanceof PutCommand);
        calls.push("vacancy-cas");
        assert.equal(command.input.ConditionExpression, "attribute_not_exists(#authorityKey)");
        assert.equal(command.input.Item.authority_key, key);
        assert.equal(item, undefined);
        item = structuredClone(command.input.Item);
        if (loseWriteResponse) throw Error("simulated acknowledgement lost");
        return {};
      },
    } },
    async describeTenantStack(name, x) {
      calls.push("describe-exact-stack");
      assert.equal(name, awsSandboxTenantStackName(appInstanceId));
      assert.equal(x.signal, signal);
      return { state: "missing", rawStatus: null, stackId: null, outputs: {}, tags: {} };
    },
    repository: {
      async prepareTenantExternalOperation(x) {
        calls.push("prepare-sql");
        assert.equal(x.operationHash, fence.operationHash);
        assert.deepEqual(x.lease, lease);
        return { fence: pendingFence };
      },
      async activateTenantExternalOperation(x) {
        calls.push("activate-sql");
        assert.deepEqual(x.proof.pendingFence, pendingFence);
        assert.equal(x.proof.evidence.authorityRecord.operationHash, fence.operationHash);
        assert.deepEqual(x.lease, lease);
        return fence;
      },
      async assertTenantExternalOperation(x) {
        calls.push("assert-active-sql");
        assert.deepEqual(x, { lease, externalFence: fence, requiredState: "active", now: now() });
        return !moved;
      },
    }, ...overrides });
  return { make, calls, signal, item: () => item, input: { context, lease, resourceFence, intent: "provision", signal } };
}

test("T4.2 exact G1/e1 authority vacancy is written once and strongly read back before activation", async () => {
  const f = fixture(), { coordinator, assertActive } = f.make();
  await assert.rejects(assertActive(fence, f.signal), /OWNERSHIP_FENCE/);
  await assert.rejects(coordinator.prepareAndActivate({ ...f.input, lease: { ...lease, workerId: "exec_" + "0".repeat(32) } }), /OWNERSHIP_LEASE/);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(await coordinator.prepareAndActivate(f.input), fence);
  assert.deepEqual(f.calls, ["prepare-sql", "consistent-get", "describe-exact-stack", "vacancy-cas", "consistent-get", "describe-exact-stack", "activate-sql"]);
  await assert.rejects(coordinator.prepareAndActivate(f.input), /OWNERSHIP_ALREADY_ATTEMPTED/);
  await assert.rejects(assertActive({ ...fence, epoch: 2 }, f.signal), /OWNERSHIP_FENCE/);
  await assertActive(fence, f.signal);
  assert.deepEqual(f.calls.slice(-2), ["consistent-get", "assert-active-sql"]);
  assert.equal(f.calls.filter(x => x === "vacancy-cas").length, 1);
});

test("T4.2 authority retries neither an unknown CAS nor a lost provider readback and refuses an occupied epoch", async () => {
  for (const options of [{ loseWriteResponse: true }, { loseReadback: true }]) {
    const f = fixture(options), { coordinator, assertActive } = f.make();
    await assert.rejects(coordinator.prepareAndActivate(f.input));
    await assert.rejects(coordinator.prepareAndActivate(f.input), /OWNERSHIP_ALREADY_ATTEMPTED/);
    await assert.rejects(assertActive(fence, f.signal), /OWNERSHIP_FENCE/);
    assert.equal(f.calls.filter(x => x === "vacancy-cas").length, 1);
    assert.equal(f.calls.includes("activate-sql"), false);
    const next = fixture({ startWith: f.item() });
    await assert.rejects(next.make().coordinator.prepareAndActivate(next.input), /OWNERSHIP_READBACK/);
    assert.deepEqual(next.calls, ["prepare-sql", "consistent-get"]);
  }
  const f = fixture({ moved: true });
  const owned = f.make();
  await owned.coordinator.prepareAndActivate(f.input);
  await assert.rejects(owned.assertActive(fence, f.signal), /OWNERSHIP_ACTIVE_LOST/);
  assert.throws(() => f.make({ tableArn: FIRST_OPEN_RDS_AUTHORITY_TABLE_ARN + "-other" }), /OWNERSHIP_AUTHORITY/);
  assert.throws(() => f.make({ identity: { roleArn: roleArn + "-other", credentials: () => assert.fail() } }), /OWNERSHIP_AUTHORITY/);
});

test("T4.2 control repository refuses unheld leases and the ordinary worker entry", async () => {
  const repository = createFirstOpenRdsRepository({ query: async () => assert.fail("SQL called") }, binding);
  await assert.rejects(repository.loadContext({ ...context.job, id: "job_" + "0".repeat(24) }), /OWNERSHIP_LEASE/);
  assert.throws(() => repository.claimNext({}), /REPOSITORY_OPERATION_DISABLED/);
  assert.throws(() => repository.reserveEnvironmentCapacity({ lease, environmentId }), /OWNERSHIP_LEASE/);
});

test("T4.2 native RDS repository verifies the writer session and commits one PostgreSQL statement with array bindings", async () => {
  const controlHost = "control-db.abcdef." + region + ".rds.amazonaws.com", controlDatabase = "control_fixture";
  const writeDbRole = "task_writer", readDbRole = "task_reader";
  const dsn = user => "postgres://" + user + ":fixture@" + controlHost + "/" + controlDatabase + "?sslmode=verify-full";
  const env = { AWS_EXECUTION_ENV: "AWS_ECS_FARGATE", AWS_REGION: region,
    ECS_CONTAINER_METADATA_URI_V4: "http://169.254.170.2/v4/test", TECHLONG_SAAS_CONTROL_DATABASE_MODE: "rds-postgresql",
    TECHLONG_SAAS_CONTROL_RDS_HOST: controlHost, TECHLONG_SAAS_CONTROL_RDS_DATABASE: controlDatabase,
    TECHLONG_SAAS_CONTROL_RDS_URL: dsn(writeDbRole), TECHLONG_FIRST_OPEN_CONTROL_READ_RDS_URL: dsn(readDbRole) };
  for (const mode of ["valid", "unknown-commit", "commit-rolled-back", "wrong-session"]) {
    const calls = [];
    const connections = createFirstOpenTaskRds(env, { controlHost, controlDatabase, writeDbRole, readDbRole }, {
      readCa: () => rootCertificates[0],
      openPool: config => ({ async connect() {
        assert.equal(config.user, writeDbRole);
        return { async query(text, values) {
          if (text.startsWith("SELECT current_database()")) {
            calls.push("SESSION");
            return { rows: [{ database: mode === "wrong-session" ? "foreign" : controlDatabase, username: writeDbRole, login: writeDbRole,
              serverVersionNum: 160014, readOnly: "off", inRecovery: false, port: 5432, tls: true }] };
          }
          calls.push(values ? [text, values] : text);
          if (text === "COMMIT" && mode === "unknown-commit") throw Error("ack unknown");
          if (text === "COMMIT") return { command: mode === "commit-rolled-back" ? "ROLLBACK" : "COMMIT" };
          return { rows: [{ prepared: true }] };
        }, release(destroy) { assert.equal(destroy, true); calls.push("RELEASE"); } };
      }, async end() {} }),
    });
    const query = "SELECT $1::text[]";
    const bindings = [["planned", "queued"]];
    if (mode === "valid") assert.deepEqual(await connections.repositorySql.query(query, bindings), { rows: [{ prepared: true }] });
    else await assert.rejects(connections.repositorySql.query(query, bindings), mode === "wrong-session" ? /RDS_SESSION/ : /COMMIT_UNCONFIRMED/);
    assert.deepEqual(calls, ["BEGIN", "SET LOCAL search_path = pg_catalog, public", "SESSION",
      ...(mode === "wrong-session" ? ["ROLLBACK"] : [[query, bindings], "COMMIT"]), "RELEASE"]);
    await connections.close();
  }
});
