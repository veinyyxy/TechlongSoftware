import assert from "node:assert/strict";
import test from "node:test";
import {
  createPreparedDeploymentWorkerRuntime,
  PREPARED_RUNTIME_BLOCKERS,
  type PreparedWorkerRuntimeInput,
} from "../lib/deployments/execution/prepared-runtime-composition.ts";
import { approvedTenantDatabaseOneShotCommands } from "../lib/deployments/execution/ecs-one-shot-task.ts";
import { GuardedTenantDatabasePort } from "../lib/deployments/execution/tenant-database.ts";
import { OrderedTenantResourceCleanup } from "../lib/deployments/execution/cleanup.ts";
import { RepositoryTenantExternalOwnershipCoordinator } from "../lib/deployments/execution/external-ownership-coordinator.ts";
import { MtlsSaaSControlClient } from "../lib/deployments/execution/control-client.ts";
import { runDeploymentWorkerOnce } from "../lib/deployments/execution/worker.ts";

function input(calls: string[]): PreparedWorkerRuntimeInput {
  const forbidden = async () => { calls.push("io"); throw new Error("Assembly must not call providers"); };
  return {
    repository: { claimNext: forbidden } as never,
    aws: { region: "ca-central-1", getCallerIdentity: forbidden } as never,
    taskApi: { runTask: forbidden, listTaskArnsByStartedBy: forbidden, describeTask: forbidden, stopTask: forbidden },
    waiter: { wait: forbidden },
    taskConfig: {
      environmentKind: "aws_sandbox", expectedAccountId: "402010193138", expectedRegion: "ca-central-1",
      clusterArn: "arn:aws:ecs:ca-central-1:402010193138:cluster/cell-sandbox-1",
      receiptBucketArn: "arn:aws:s3:::techlong-sandbox-402010193138-ca-central-1-tenant-receipts",
      taskDefinitionArn: "arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-lifecycle:7",
      containerName: "tenant-database-lifecycle", assignPublicIp: "ENABLED",
      subnetIds: ["subnet-0123456789abcdef0"], securityGroupIds: ["sg-0123456789abcdef0"],
      commandByOperation: approvedTenantDatabaseOneShotCommands,
      pollIntervalMs: 0, maximumDescribeAttempts: 3, abortCleanupTimeoutMs: 1_000,
    },
    secretConfig: {
      expectedAccountId: "402010193138", expectedRegion: "ca-central-1",
      expectedWorkerRoleArn: "arn:aws:iam::402010193138:role/TechlongSandboxProvisionerRole",
    },
    materialConfig: {
      expectedRegion: "ca-central-1", databasePort: 5432,
      databaseEndpoint: "cell.cluster-123456789012.ca-central-1.rds.amazonaws.com",
    },
    paymentCredentials: { lease: forbidden },
    approvedBaseline: {
      contract: "speedfeast-pg16.14-tenant-baseline-v1",
      archiveS3Uri: "s3://techlong-sandbox-artifacts/_migration/empty.dump",
      archiveSha256: "1".repeat(64), approvedArchiveSha256: "1".repeat(64),
      manifestS3Uri: "s3://techlong-sandbox-artifacts/_migration/empty.manifest.json",
      manifestSha256: "2".repeat(64), sourceDatabase: "empty_baseline",
    },
    epochAuthority: { observe: forbidden, compareAndSet: forbidden },
    workloadConfig: {
      expectedAccountId: "402010193138", expectedRegion: "ca-central-1",
      cloudFormationRoleArn: "arn:aws:iam::402010193138:role/TechlongSandboxCloudFormationExecutionRole",
    },
    sharedCellSecurityPreflight: { verify: forbidden } as never,
    controlTransport: { send: forbidden } as never,
    controlTokens: { issue: forbidden },
    controlEndpoint: { baseDomain: "sandbox.techlong.cloud" },
    controlPayloadCompiler: { compile: forbidden },
    async secretProviderFactory(generator, config) {
      calls.push("construct-secret-provider");
      assert.equal(typeof generator.generate, "function");
      assert.equal(config.expectedRegion, "ca-central-1");
      return { inspectSecret: forbidden, ensureGeneratedSecret: forbidden, deleteSecret: forbidden };
    },
  };
}

test("prepared root composes real guarded adapters without I/O or activation", async () => {
  const calls: string[] = [];
  const source = input(calls);
  const runtime = await createPreparedDeploymentWorkerRuntime(source);
  assert.equal(runtime.mode, "prepared_not_activated");
  assert.equal(Object.isFrozen(runtime), true);
  assert.equal(runtime.applyRuntimeReady, false);
  assert.equal(runtime.cleanupRuntimeReady, false);
  assert.deepEqual(runtime.blockers, PREPARED_RUNTIME_BLOCKERS);
  assert.ok(runtime.tenantDatabase instanceof GuardedTenantDatabasePort);
  assert.ok(runtime.tenantResourceCleanup instanceof OrderedTenantResourceCleanup);
  assert.ok(runtime.tenantExternalOperationCoordinator instanceof RepositoryTenantExternalOwnershipCoordinator);
  assert.ok(runtime.controlClient instanceof MtlsSaaSControlClient);
  assert.equal(runtime.controlPayloadCompiler, source.controlPayloadCompiler);
  assert.equal(runtime.sharedCellSecurityPreflight, source.sharedCellSecurityPreflight);
  assert.deepEqual(calls, ["construct-secret-provider"]);
});

test("prepared capabilities still cannot claim jobs when environment enables Apply", async () => {
  const calls: string[] = [];
  const source = input(calls);
  const runtime = await createPreparedDeploymentWorkerRuntime(source);
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:prepared-test",
    config: {
      workerEnabled: true, applyEnabled: true, environmentKey: "aws-sandbox-ca-central-1",
      expectedAccountId: "402010193138", expectedRegion: "ca-central-1",
      workerRoleArn: "arn:aws:iam::402010193138:role/TechlongSandboxProvisionerRole",
      confirmation: "I_ACKNOWLEDGE_AWS_SANDBOX_COST_AND_TTL", leaseDurationMs: 120_000, pollIntervalMs: 10_000,
    },
    dependencies: { ...runtime, repository: source.repository, awsFactory: async () => { throw new Error("must not construct"); }, cleanupScheduler: {} as never },
  });
  assert.equal(result.status, "disabled");
  assert.deepEqual(calls, ["construct-secret-provider"]);
});

test("foreign account, region, worker role or control domain is rejected before SDK construction", async () => {
  for (const field of ["account", "region", "role", "domain", "material", "workload"] as const) {
    const calls: string[] = [];
    const source = input(calls);
    if (field === "account") source.taskConfig.expectedAccountId = "123456789012";
    if (field === "region") source.taskConfig.expectedRegion = "us-east-1";
    if (field === "role") source.secretConfig.expectedWorkerRoleArn = "arn:aws:iam::402010193138:role/OtherRole";
    if (field === "domain") source.controlEndpoint.baseDomain = "techlong.cloud";
    if (field === "material") source.materialConfig.expectedRegion = "us-east-1";
    if (field === "workload") source.workloadConfig.expectedAccountId = "123456789012";
    await assert.rejects(createPreparedDeploymentWorkerRuntime(source), { code: "TENANT_RUNTIME_COMPOSITION_SCOPE_INVALID" });
    assert.deepEqual(calls, []);
  }
});

test("missing baseline approval and unapproved task command fail before SDK construction", async () => {
  for (const invalid of ["baseline", "command"] as const) {
    const calls: string[] = [];
    const source = input(calls);
    if (invalid === "baseline") source.approvedBaseline.approvedArchiveSha256 = "3".repeat(64);
    else source.taskConfig.commandByOperation = { ...approvedTenantDatabaseOneShotCommands, inspect: ["sh", "-c", "anything"] };
    await assert.rejects(createPreparedDeploymentWorkerRuntime(source));
    assert.deepEqual(calls, []);
  }
});
