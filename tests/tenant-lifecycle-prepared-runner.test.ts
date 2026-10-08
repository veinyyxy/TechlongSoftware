import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EcsOneShotTaskRunner, approvedTenantDatabaseOneShotCommands,
  type EcsOneShotTaskRequest, type EcsOneShotTaskRunnerConfig, type TenantDatabaseOneShotOperation } from "../lib/deployments/execution/ecs-one-shot-task.ts";
import { AwsSdkEcsOneShotTaskApi, type AwsSdkEcsOneShotConfig } from "../lib/deployments/execution/aws-sdk-ecs-one-shot-api.ts";
import { AwsSdkS3OneShotReceiptReader } from "../lib/deployments/execution/aws-sdk-s3-one-shot-receipt-reader.ts";
import { preparedLifecycleCommands, preparedBaselinePins } from "../lib/deployments/execution/tenant-lifecycle-prepared-contract.ts";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import type { TenantExternalOperationFence, TenantResourceFence } from "../lib/deployments/execution/contracts.ts";

const account = "402010193138", region = "ca-central-1";
const clusterArn = `arn:aws:ecs:${region}:${account}:cluster/cell-sandbox-1`;
const taskArn = `arn:aws:ecs:${region}:${account}:task/cell-sandbox-1/${"1".repeat(32)}`;
const bucket = `techlong-sandbox-${account}-${region}-tenant-receipts`;
const taskDefinitionArn = `arn:aws:ecs:${region}:${account}:task-definition/tenant-lifecycle:999`;
class Command {
  input: Record<string, unknown>;
  constructor(input: Record<string, unknown>) { this.input = input; }
}
class Run extends Command {}
class Describe extends Command {}
class List extends Command {}
class Stop extends Command {}
function configs() {
  const runner: EcsOneShotTaskRunnerConfig = { lifecycleProtocol: "prepared_v2", receiptSchemaVersion: 2,
    environmentKind: "aws_sandbox", expectedAccountId: account, expectedRegion: region, clusterArn,
    receiptBucketArn: `arn:aws:s3:::${bucket}`, taskDefinitionArn, containerName: "tenant-database-lifecycle",
    assignPublicIp: "ENABLED", subnetIds: ["subnet-0123456789abcdef0"], securityGroupIds: ["sg-0123456789abcdef0"],
    commandByOperation: preparedLifecycleCommands, pollIntervalMs: 0, maximumDescribeAttempts: 3, abortCleanupTimeoutMs: 1000 };
  const sdk: AwsSdkEcsOneShotConfig = { ...runner, allowedTaskDefinitionArn: taskDefinitionArn,
    allowedCommandByOperation: preparedLifecycleCommands, expectedContainerName: runner.containerName,
    allowedSubnetIds: runner.subnetIds, allowedSecurityGroupIds: runner.securityGroupIds };
  return { runner, sdk };
}
async function fences(operation: TenantDatabaseOneShotOperation) {
  const ownership = { appInstanceId: "prepared-instance", workspaceId: "workspace", productId: "product",
    environmentId: "environment", cellKey: "cell-sandbox-1" };
  const hash = await sha256Hex(ownership);
  const fence: TenantResourceFence = { schemaVersion: 1, generation: 1, ownerDeploymentId: "deployment",
    ownershipMarker: `tl_owner_${hash.slice(0, 32)}_g1`, identity: { schemaVersion: 1, ...ownership,
      stableIdentityHash: hash, databaseName: "tenant_test_db", roleName: "tenant_test_role",
      secretName: `techlong/sandbox/tenant/preparedinstance_${hash.slice(0, 10)}/runtime` } };
  const predecessor = { schemaVersion: 1 as const, generation: 1, epoch: 1, intent: "provision" as const,
    ownerDeploymentId: "deployment", operationHash: "a".repeat(64), marker: `tl_epoch_${hash.slice(0, 24)}_g1_e1` };
  const cleanup = operation === "destroy";
  const externalFence: TenantExternalOperationFence = { schemaVersion: 1, resourceFence: fence,
    state: "active", epoch: cleanup ? 2 : 1, intent: cleanup ? "cleanup" : "provision",
    ownerDeploymentId: "deployment", operationHash: "b".repeat(64),
    marker: `tl_epoch_${hash.slice(0, 24)}_g1_e${cleanup ? 2 : 1}`,
    ...(cleanup ? { provisionPredecessor: predecessor } : {}) };
  return { fence, externalFence, predecessor };
}
async function harness(operation: TenantDatabaseOneShotOperation = "inspect", unknownRun = false) {
  const { runner: runnerConfig, sdk: sdkConfig } = configs();
  const { fence, externalFence, predecessor } = await fences(operation);
  let captured: EcsOneShotTaskRequest | undefined;
  const calls: string[] = [];
  const receiptReader = new AwsSdkS3OneShotReceiptReader({ expectedBucketOwner: account, expectedRegion: region,
    receiptBucketArn: runnerConfig.receiptBucketArn, receiptSchemaVersion: 2 }, {
    commands: { getObject: Command }, client: { send: async (command, options) => {
      options?.abortSignal?.throwIfAborted(); calls.push("receipt");
      assert.equal((command as Command).input.Key, captured!.receipt.key);
      const env = captured!.container.environment;
      const output = operation === "verify" ? { outcome: "applied", resultingState: "verified", evidenceHash: "d".repeat(64),
        applicationAccess: { policy: "speedfeast-application-access/v1", databaseLoginVerified: true, evidenceHash: "e".repeat(64) } } : { state: "missing" };
      const raw = { schemaVersion: 2, operation, resourceGeneration: 1, ownershipMarker: fence.ownershipMarker,
        externalEpoch: externalFence.epoch, externalMarker: env.TENANT_EXTERNAL_OPERATION_MARKER,
        externalOperationHash: env.TENANT_EXTERNAL_OPERATION_HASH, output, outputHash: await sha256Hex(output) };
      const bytes = Buffer.from(canonicalJson(raw));
      return { Body: bytes, ContentLength: bytes.length, ContentType: "application/json", ServerSideEncryption: "AES256",
        ChecksumType: "FULL_OBJECT", ChecksumSHA256: createHash("sha256").update(bytes).digest("base64") };
    } } });
  const api = new AwsSdkEcsOneShotTaskApi(sdkConfig, { receiptReader,
    commands: { runTask: Run, describeTasks: Describe, listTasks: List, stopTask: Stop },
    client: { send: async command => {
      if (command instanceof Run) {
        calls.push("run");
        const args = command.input, overrides = args.overrides as { containerOverrides: Array<{ command: string[]; environment: Array<{ name: string; value: string }> }> };
        assert.deepEqual(overrides.containerOverrides[0].command, [operation]);
        const environment = Object.fromEntries(overrides.containerOverrides[0].environment.map(e => [e.name, e.value]));
        assert.equal(environment.TENANT_EXTERNAL_AUTHORITY_KEY, `tenant:${fence.identity.stableIdentityHash}`);
        assert.equal(environment.TENANT_DATABASE_NAME, fence.identity.databaseName);
        assert.equal(environment.TENANT_DATABASE_ROLE_NAME, fence.identity.roleName);
        assert.equal(args.enableExecuteCommand, false); assert.equal(args.count, 1);
        if (unknownRun) throw Object.assign(new Error("response lost"), { name: "TimeoutError" });
        return { tasks: [{ taskArn }] };
      }
      if (command instanceof List) { calls.push("list"); return { taskArns: [taskArn] }; }
      if (command instanceof Describe) {
        calls.push("describe"); const r = captured!;
        return { tasks: [{ taskArn, clusterArn, taskDefinitionArn, startedBy: r.startedBy, launchType: "FARGATE",
          platformVersion: "1.4.0", enableExecuteCommand: false, lastStatus: "STOPPED", desiredStatus: "STOPPED",
          containers: [{ name: r.container.name, exitCode: 0 }], overrides: { containerOverrides: [{ name: r.container.name,
            command: r.container.command, environment: Object.entries(r.container.environment).map(([name, value]) => ({ name, value })) }] },
          tags: Object.entries(r.tags).map(([key, value]) => ({ key, value })) }] };
      }
      assert.fail("Stopped successful task must never be stopped again.");
    } } });
  const runner = new EcsOneShotTaskRunner({ config: runnerConfig, waiter: { wait: async () => {} },
    api: { runTask: input => { captured = structuredClone(input.request); return api.runTask(input); },
      describeTask: input => api.describeTask(input), listTaskArnsByStartedBy: input => api.listTaskArnsByStartedBy(input),
      stopTask: input => api.stopTask(input) } });
  const common = { fence, externalFence, runtimeSecretRef: `arn:aws:secretsmanager:${region}:${account}:secret:${fence.identity.secretName}/g1-ABC123`,
    approvedBaselineDigest: ["restore_approved_baseline", "migrate_saas", "verify"].includes(operation) ? preparedBaselinePins.archiveSha256 : null,
    idempotencyKey: `test:${operation}`, signal: new AbortController().signal };
  const promise = runner.execute(operation === "destroy" ? { ...common, operation, provisionPredecessor: predecessor } : { ...common, operation });
  let result: Awaited<typeof promise> | null = null;
  if (unknownRun) await assert.rejects(promise, (e: unknown) => Boolean(e && typeof e === "object" && "code" in e && e.code === "TimeoutError"));
  else result = await promise;
  return { result, request: captured!, calls, api, runnerConfig, sdkConfig };
}
test("prepared runner → strict SDK → raw S3 v2 preserves all six fence-bound operations", async t => {
  for (const operation of Object.keys(preparedLifecycleCommands) as TenantDatabaseOneShotOperation[]) {
    await t.test(operation, async () => {
      const h = await harness(operation);
      assert.ok(h.result);
      assert.equal(h.result.schemaVersion, 1); // trusted platform envelope is not the raw receipt protocol
      assert.equal(h.result.operation, operation);
      assert.deepEqual(h.calls, ["run", "describe", "receipt"]);
      if (operation === "destroy") assert.equal(h.request.container.environment.TENANT_PREDECESSOR_PROVISION_EPOCH, "1");
      if (operation === "verify") assert.equal((h.result.output.applicationAccess as { databaseLoginVerified: boolean }).databaseLoginVerified, true);
    });
  }
});
test("prepared unknown RunTask checks exact stopped task and v2 receipt, then fails closed without launch retry", async () => {
  const h = await harness("inspect", true);
  assert.equal(h.result, null);
  assert.equal(h.calls.filter(c => c === "run").length, 1);
  assert.ok(h.calls.includes("list"));
});
test("prepared/legacy command, receipt and Sandbox scope mismatch fails at construction", () => {
  const { runner, sdk } = configs();
  const dependencies = { receiptReader: { receiptSchemaVersion: 2 as const, read: async () => null },
    commands: { runTask: Run, describeTasks: Describe, listTasks: List, stopTask: Stop }, client: { send: async () => assert.fail("no SDK call") } };
  for (const patch of [{ receiptSchemaVersion: 1 as const }, { lifecycleProtocol: "legacy_v1" as const },
    { commandByOperation: approvedTenantDatabaseOneShotCommands }, { clusterArn: clusterArn.replace("cell-sandbox-1", "other") }]) {
    assert.throws(() => new EcsOneShotTaskRunner({ config: { ...runner, ...patch }, api: {} as never, waiter: {} as never }));
  }
  assert.throws(() => new AwsSdkEcsOneShotTaskApi({ ...sdk, receiptSchemaVersion: 1 }, dependencies));
  assert.throws(() => new AwsSdkEcsOneShotTaskApi({ ...sdk, allowedCommandByOperation: approvedTenantDatabaseOneShotCommands }, dependencies));
  assert.throws(() => new AwsSdkEcsOneShotTaskApi(sdk, { ...dependencies, receiptReader: { read: async () => null } }));
});
test("SDK rejects prepared identity/owner/target drift and legacy extra fields before RunTask", async () => {
  const h = await harness();
  for (const patch of [{ TENANT_OWNER_DEPLOYMENT_ID: "bad\nowner" }, { TENANT_EXTERNAL_AUTHORITY_KEY: `tenant:${"0".repeat(64)}` },
    { TENANT_DATABASE_NAME: "tenant_other_db" }, { TENANT_DATABASE_ROLE_NAME: "tenant_other_role" },
    { TENANT_RESOURCE_IDENTITY_JSON: h.request.container.environment.TENANT_RESOURCE_IDENTITY_JSON!.replace("workspace", "other") }]) {
    const r = structuredClone(h.request); Object.assign(r.container.environment, patch);
    await assert.rejects(h.api.runTask({ request: r, expectedOperation: "inspect", signal: new AbortController().signal }));
  }
  const r = structuredClone(h.request); delete r.container.environment.TENANT_EXTERNAL_AUTHORITY_KEY;
  await assert.rejects(h.api.runTask({ request: r, expectedOperation: "inspect", signal: new AbortController().signal }));
  const wrongHash = structuredClone(h.request); wrongHash.startedBy = `tl-${wrongHash.clientToken.slice(0, 12)}-${"0".repeat(16)}`;
  await assert.rejects(h.api.runTask({ request: wrongHash, expectedOperation: "inspect", signal: new AbortController().signal }));
  const legacy = new AwsSdkEcsOneShotTaskApi({ ...h.sdkConfig, lifecycleProtocol: "legacy_v1", receiptSchemaVersion: 1,
    allowedCommandByOperation: approvedTenantDatabaseOneShotCommands }, {
    receiptReader: { read: async () => null }, commands: { runTask: Run, describeTasks: Describe, listTasks: List, stopTask: Stop },
    client: { send: async () => assert.fail("legacy must not accept prepared overrides") } });
  r.container.command = approvedTenantDatabaseOneShotCommands.inspect;
  await assert.rejects(legacy.runTask({ request: r, expectedOperation: "inspect", signal: new AbortController().signal }));
  assert.equal(h.calls.filter(c => c === "run").length, 1);
});
