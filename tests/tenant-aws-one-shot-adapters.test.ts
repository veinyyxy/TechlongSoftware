import assert from "node:assert/strict";
import test from "node:test";
import type {
  TenantApprovedBaseline,
  TenantExternalOperationFence,
  TenantResourceFence,
} from "../lib/deployments/execution/contracts.ts";
import {
  approvedTenantDatabaseOneShotCommands,
  EcsOneShotTaskRunner,
  tenantOneShotReceiptHash,
  tenantOneShotRequestHash,
  type EcsOneShotTaskApi,
  type EcsOneShotTaskObservation,
  type EcsOneShotTaskRequest,
  type EcsOneShotTaskRunnerConfig,
  type TenantDatabaseOneShotOperation,
  type TenantDatabaseOneShotOutput,
  type TenantDatabaseOneShotReceipt,
} from "../lib/deployments/execution/ecs-one-shot-task.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import {
  createTenantSecretProviderEvidenceHash,
  createTenantSecretProviderReceiptHash,
  EcsOneShotTenantDatabaseLifecycleAdapter,
  ExactTenantRuntimeSecretAdapter,
  tenantRuntimeSecretExactJsonKeys,
  type TenantRuntimeSecretOwnershipEvidence,
  type TenantRuntimeSecretProviderApi,
  type TenantRuntimeSecretProviderMutationReceipt,
  type TenantRuntimeSecretProviderObservation,
} from "../lib/deployments/execution/tenant-aws-one-shot-adapters.ts";

const stableIdentityHash = "8".repeat(64);
const operationHash = "9".repeat(64);
const evidenceHash = "a".repeat(64);
const baselineDigest = "b".repeat(64);
const taskArn =
  "arn:aws:ecs:ca-central-1:402010193138:task/techlong-sandbox/0123456789abcdef";
const secretArn =
  "arn:aws:secretsmanager:ca-central-1:402010193138:secret:" +
  "techlong/sandbox/tenant/tenant_one_123/runtime/g1-ABC123";

function resourceFence(generation = 1): TenantResourceFence {
  return {
    schemaVersion: 1,
    identity: {
      schemaVersion: 1,
      appInstanceId: "app_tenant_one",
      workspaceId: "wsp_one",
      productId: "prd_restaurant_order_system",
      environmentId: "env_aws_sandbox_ca_central_1",
      cellKey: "cell-sandbox-1",
      databaseName: "tenant_one_db",
      roleName: "tenant_one_role",
      secretName: "techlong/sandbox/tenant/tenant_one_123/runtime",
      stableIdentityHash,
    },
    generation,
    ownerDeploymentId: "dep_tenant_one",
    ownershipMarker: `tl_owner_${stableIdentityHash.slice(0, 32)}_g${generation}`,
  };
}

function externalFence(
  fence = resourceFence(),
  intent: "provision" | "cleanup" = "provision",
): TenantExternalOperationFence {
  return {
    schemaVersion: 1,
    resourceFence: fence,
    epoch: intent === "provision" ? 3 : 4,
    intent,
    ownerDeploymentId: fence.ownerDeploymentId,
    operationHash,
    marker:
      `tl_epoch_${stableIdentityHash.slice(0, 24)}` +
      `_g${fence.generation}_e${intent === "provision" ? 3 : 4}`,
    state: "active",
  };
}

function runnerConfig(
  overrides: Partial<EcsOneShotTaskRunnerConfig> = {},
): EcsOneShotTaskRunnerConfig {
  const taskDefinitions = Object.fromEntries(
    Object.keys(approvedTenantDatabaseOneShotCommands).map((operation, index) => [
      operation,
      `arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-${index + 1}:1`,
    ]),
  ) as unknown as EcsOneShotTaskRunnerConfig["taskDefinitionArnByOperation"];
  return {
    clusterArn:
      "arn:aws:ecs:ca-central-1:402010193138:cluster/techlong-sandbox-cell-one",
    taskDefinitionArnByOperation: taskDefinitions,
    containerName: "tenant-database-lifecycle",
    subnetIds: ["subnet-0123456789abcdef0"],
    securityGroupIds: ["sg-0123456789abcdef0"],
    commandByOperation: approvedTenantDatabaseOneShotCommands,
    pollIntervalMs: 0,
    maximumDescribeAttempts: 3,
    abortCleanupTimeoutMs: 1_000,
    ...overrides,
  };
}

async function successfulTaskReceipt(input: {
  request: EcsOneShotTaskRequest;
  operation: TenantDatabaseOneShotOperation;
  fence: TenantResourceFence;
  external: TenantExternalOperationFence;
  output: TenantDatabaseOneShotOutput;
}): Promise<TenantDatabaseOneShotReceipt> {
  const outputHash = await sha256Hex(input.output);
  const withoutReceiptHash = {
    schemaVersion: 1 as const,
    taskArn,
    operation: input.operation,
    outcome: "succeeded" as const,
    resourceGeneration: input.fence.generation,
    ownershipMarker: input.fence.ownershipMarker,
    externalEpoch: input.external.epoch,
    externalMarker: input.external.marker,
    externalOperationHash: input.external.operationHash,
    requestHash: await tenantOneShotRequestHash(input.request),
    output: input.output,
    outputHash,
  };
  return {
    ...withoutReceiptHash,
    receiptHash: await tenantOneShotReceiptHash(withoutReceiptHash),
  };
}

function runningObservation(): EcsOneShotTaskObservation {
  return {
    taskArn,
    lastStatus: "RUNNING",
    desiredStatus: "RUNNING",
    exitCode: null,
    stoppedReason: null,
    receipt: null,
  };
}

function stoppedObservation(
  receipt: TenantDatabaseOneShotReceipt | null,
  exitCode = receipt ? 0 : 137,
): EcsOneShotTaskObservation {
  return {
    taskArn,
    lastStatus: "STOPPED",
    desiredStatus: "STOPPED",
    exitCode,
    stoppedReason: receipt ? "Essential container exited" : "Deployment lease lost",
    receipt,
  };
}

test("runs an allowlisted one-shot task using only a Secret ARN and active epoch", async () => {
  const fence = resourceFence();
  const external = externalFence(fence);
  const apiSignals: AbortSignal[] = [];
  let request: EcsOneShotTaskRequest | null = null;
  const output = {
    state: "missing",
    databaseExists: false,
    roleExists: false,
    databaseOwnershipMarker: null,
    roleOwnershipMarker: null,
    baselineDigest: null,
    migrationContract: null,
    evidenceHash,
  };
  const api: EcsOneShotTaskApi = {
    runTask: async (input) => {
      request = input.request;
      apiSignals.push(input.signal);
      return { taskArn };
    },
    listTaskArnsByStartedBy: async () =>
      assert.fail("successful RunTask must not use recovery"),
    describeTask: async (input) => {
      apiSignals.push(input.signal);
      return stoppedObservation(
        await successfulTaskReceipt({
          request: request!,
          operation: "inspect",
          fence,
          external,
          output,
        }),
      );
    },
    stopTask: async () => assert.fail("successful task must not be stopped"),
  };
  const runner = new EcsOneShotTaskRunner({
    api,
    waiter: { wait: async () => undefined },
    config: runnerConfig(),
  });
  const receipt = await runner.execute({
    operation: "inspect",
    fence,
    externalFence: external,
    runtimeSecretRef: secretArn,
    approvedBaselineDigest: null,
    idempotencyKey: "dep_tenant_one:inspect",
    signal: new AbortController().signal,
  });

  assert.equal(receipt.outputHash, await sha256Hex(output));
  assert.equal(apiSignals.every((value) => value instanceof AbortSignal), true);
  assert.deepEqual(Object.keys(request!.container.environment).sort(), [
    "TENANT_DATABASE_OPERATION",
    "TENANT_EXTERNAL_OPERATION_EPOCH",
    "TENANT_EXTERNAL_OPERATION_HASH",
    "TENANT_EXTERNAL_OPERATION_MARKER",
    "TENANT_OWNERSHIP_MARKER",
    "TENANT_RESOURCE_GENERATION",
    "TENANT_RUNTIME_SECRET_ARN",
  ]);
  const encoded = JSON.stringify(request);
  assert.equal(encoded.includes("DATABASE_URL"), false);
  assert.equal(encoded.includes("postgresql://"), false);
  assert.equal(/password/i.test(encoded), false);
  assert.equal(/secret[_-]?value/i.test(encoded), false);
  assert.match(encoded, /runtime\/g1-ABC123/);
});

test("stops and observes STOPPED before surfacing a lost lease", async () => {
  const fence = resourceFence();
  const external = externalFence(fence);
  const controller = new AbortController();
  const leaseLost = new Error("lease lost");
  const events: string[] = [];
  let describeCount = 0;
  const api: EcsOneShotTaskApi = {
    runTask: async ({ signal }) => {
      assert.equal(signal.aborted, false);
      events.push("run");
      return { taskArn };
    },
    listTaskArnsByStartedBy: async () =>
      assert.fail("known task ARN must not use recovery"),
    describeTask: async ({ signal }) => {
      assert.equal(signal instanceof AbortSignal, true);
      describeCount += 1;
      events.push(`describe:${describeCount}`);
      return describeCount === 1
        ? runningObservation()
        : stoppedObservation(null);
    },
    stopTask: async ({ signal, reason }) => {
      assert.equal(signal.aborted, false);
      assert.equal(reason, "deployment_lease_lost");
      events.push("stop");
    },
  };
  const runner = new EcsOneShotTaskRunner({
    api,
    waiter: {
      wait: async ({ signal }) => {
        assert.equal(signal, controller.signal);
        controller.abort(leaseLost);
        signal.throwIfAborted();
      },
    },
    config: runnerConfig(),
  });

  await assert.rejects(
    runner.execute({
      operation: "inspect",
      fence,
      externalFence: external,
      runtimeSecretRef: secretArn,
      approvedBaselineDigest: null,
      idempotencyKey: "dep_tenant_one:abort",
      signal: controller.signal,
    }),
    (error) => error === leaseLost,
  );
  assert.deepEqual(events, ["run", "describe:1", "stop", "describe:2"]);
});

test("keeps the RunTask deadline independent when the lease is lost during launch", async () => {
  const fence = resourceFence();
  const external = externalFence(fence);
  const controller = new AbortController();
  const leaseLost = new Error("lease lost during launch");
  const events: string[] = [];
  const runner = new EcsOneShotTaskRunner({
    api: {
      runTask: async ({ signal }) => {
        events.push("run");
        controller.abort(leaseLost);
        assert.equal(signal.aborted, false);
        return { taskArn };
      },
      listTaskArnsByStartedBy: async () =>
        assert.fail("known task ARN must not use recovery"),
      stopTask: async ({ reason, signal }) => {
        assert.equal(reason, "deployment_lease_lost");
        assert.equal(signal.aborted, false);
        events.push("stop");
      },
      describeTask: async () => {
        events.push("describe-stopped");
        return stoppedObservation(null);
      },
    },
    waiter: { wait: async () => undefined },
    config: runnerConfig(),
  });

  await assert.rejects(
    runner.execute({
      operation: "inspect",
      fence,
      externalFence: external,
      runtimeSecretRef: secretArn,
      approvedBaselineDigest: null,
      idempotencyKey: "dep_tenant_one:abort-during-launch",
      signal: controller.signal,
    }),
    (error) => error === leaseLost,
  );
  assert.deepEqual(events, ["run", "stop", "describe-stopped"]);
});

test("stops a still-running task on polling timeout instead of orphaning it", async () => {
  const fence = resourceFence();
  const external = externalFence(fence);
  const events: string[] = [];
  let describeCount = 0;
  const runner = new EcsOneShotTaskRunner({
    api: {
      runTask: async () => ({ taskArn }),
      listTaskArnsByStartedBy: async () =>
        assert.fail("known task ARN must not use recovery"),
      describeTask: async () => {
        describeCount += 1;
        events.push(`describe:${describeCount}`);
        return describeCount === 1
          ? runningObservation()
          : stoppedObservation(null);
      },
      stopTask: async ({ reason }) => {
        assert.equal(reason, "task_timeout");
        events.push("stop");
      },
    },
    waiter: { wait: async () => undefined },
    config: runnerConfig({ maximumDescribeAttempts: 1 }),
  });

  await assert.rejects(
    runner.execute({
      operation: "inspect",
      fence,
      externalFence: external,
      runtimeSecretRef: secretArn,
      approvedBaselineDigest: null,
      idempotencyKey: "dep_tenant_one:timeout",
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "TENANT_ONE_SHOT_TASK_TIMEOUT",
  );
  assert.deepEqual(events, ["describe:1", "stop", "describe:2"]);
});

test("recovers an accepted RunTask after its response is lost, then stops it", async () => {
  const fence = resourceFence();
  const external = externalFence(fence);
  const responseLost = new Error("RunTask response lost");
  const events: string[] = [];
  let request: EcsOneShotTaskRequest | null = null;
  let recoveryAttempts = 0;
  let describeAttempts = 0;
  const idempotencyKey = "dep_tenant_one:uncertain-run";
  const api: EcsOneShotTaskApi = {
    runTask: async (input) => {
      request = input.request;
      events.push("run-accepted-response-lost");
      throw responseLost;
    },
    listTaskArnsByStartedBy: async ({ startedBy, signal }) => {
      assert.equal(signal instanceof AbortSignal, true);
      assert.equal(startedBy, request!.startedBy);
      const idempotencyHash = await sha256Hex(idempotencyKey);
      const requestHash = await tenantOneShotRequestHash(request!);
      assert.equal(
        startedBy,
        `tl-${idempotencyHash.slice(0, 12)}-${requestHash.slice(0, 16)}`,
      );
      recoveryAttempts += 1;
      events.push(`recover:${recoveryAttempts}`);
      return { taskArns: recoveryAttempts === 1 ? [] : [taskArn] };
    },
    stopTask: async ({ signal, reason }) => {
      assert.equal(signal instanceof AbortSignal, true);
      assert.equal(reason, "run_task_outcome_unknown");
      events.push("stop");
    },
    describeTask: async ({ signal, expectedRequest }) => {
      assert.equal(signal instanceof AbortSignal, true);
      assert.equal(expectedRequest, request);
      describeAttempts += 1;
      events.push(`describe:${describeAttempts}`);
      return describeAttempts === 1
        ? runningObservation()
        : stoppedObservation(null);
    },
  };
  const runner = new EcsOneShotTaskRunner({
    api,
    waiter: { wait: async () => undefined },
    config: runnerConfig(),
  });

  await assert.rejects(
    runner.execute({
      operation: "inspect",
      fence,
      externalFence: external,
      runtimeSecretRef: secretArn,
      approvedBaselineDigest: null,
      idempotencyKey,
      signal: new AbortController().signal,
    }),
    (error) => error === responseLost,
  );
  assert.deepEqual(events, [
    "run-accepted-response-lost",
    "recover:1",
    "recover:2",
    "describe:1",
    "stop",
    "describe:2",
  ]);
});

test("never stops a recovered task when independent identity readback fails", async () => {
  const fence = resourceFence();
  const external = externalFence(fence);
  let stopCalls = 0;
  let describeCalls = 0;
  const identityError = Object.assign(new Error("recovered task identity drift"), {
    code: "TENANT_ONE_SHOT_TASK_OWNERSHIP_INVALID",
  });
  const runner = new EcsOneShotTaskRunner({
    api: {
      runTask: async () => {
        throw new Error("RunTask response lost");
      },
      listTaskArnsByStartedBy: async () => ({ taskArns: [taskArn] }),
      describeTask: async () => {
        describeCalls += 1;
        throw identityError;
      },
      stopTask: async () => {
        stopCalls += 1;
      },
    },
    waiter: { wait: async () => undefined },
    config: runnerConfig(),
  });

  await assert.rejects(
    runner.execute({
      operation: "inspect",
      fence,
      externalFence: external,
      runtimeSecretRef: secretArn,
      approvedBaselineDigest: null,
      idempotencyKey: "dep_tenant_one:uncertain-foreign-task",
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "TENANT_ONE_SHOT_ABORT_CLEANUP_FAILED" &&
      error.message.includes("recovered task identity drift"),
  );
  assert.equal(describeCalls, 1);
  assert.equal(stopCalls, 0);
});

test("fails closed when an uncertain RunTask stays invisible for the recovery bound", async () => {
  const fence = resourceFence();
  const external = externalFence(fence);
  let recoveryAttempts = 0;
  let stopCalls = 0;
  const runner = new EcsOneShotTaskRunner({
    api: {
      runTask: async () => {
        throw new Error("RunTask response lost");
      },
      listTaskArnsByStartedBy: async () => {
        recoveryAttempts += 1;
        return { taskArns: [] };
      },
      describeTask: async () => assert.fail("no task ARN was recovered"),
      stopTask: async () => {
        stopCalls += 1;
      },
    },
    waiter: { wait: async () => undefined },
    config: runnerConfig({ maximumDescribeAttempts: 3 }),
  });

  await assert.rejects(
    runner.execute({
      operation: "inspect",
      fence,
      externalFence: external,
      runtimeSecretRef: secretArn,
      approvedBaselineDigest: null,
      idempotencyKey: "dep_tenant_one:uncertain-invisible",
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "TENANT_ONE_SHOT_RUN_TASK_OUTCOME_UNKNOWN" &&
      "retryable" in error &&
      error.retryable === true,
  );
  assert.equal(recoveryAttempts, 3);
  assert.equal(stopCalls, 0);
});

test("public runner rejects destroy before any ECS API call", async () => {
  const fence = resourceFence();
  let calls = 0;
  const runner = new EcsOneShotTaskRunner({
    api: new Proxy({} as EcsOneShotTaskApi, {
      get: () => () => {
        calls += 1;
      },
    }),
    waiter: { wait: async () => undefined },
    config: runnerConfig(),
  });

  await assert.rejects(
    runner.execute({
      operation: "destroy",
      fence,
      externalFence: externalFence(fence, "cleanup"),
      runtimeSecretRef: secretArn,
      approvedBaselineDigest: null,
      idempotencyKey: "dep_tenant_one:direct-destroy",
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "TENANT_DATABASE_CLEANUP_PREDECESSOR_UNAVAILABLE" &&
      "retryable" in error &&
      error.retryable === false,
  );
  assert.equal(calls, 0);
});

test("rejects configurable command injection before calling an ECS API", () => {
  let calls = 0;
  assert.throws(
    () =>
      new EcsOneShotTaskRunner({
        api: new Proxy({} as EcsOneShotTaskApi, {
          get: () => () => {
            calls += 1;
          },
        }),
        waiter: { wait: async () => undefined },
        config: runnerConfig({
          commandByOperation: {
            ...approvedTenantDatabaseOneShotCommands,
            inspect: ["/bin/sh", "-c", "echo unsafe"],
          },
        }),
      }),
    /command vector|allowlist/i,
  );
  assert.equal(calls, 0);
});

test("rejects cross-account task definitions and cross-generation Secret ARNs before RunTask", async () => {
  assert.throws(
    () =>
      new EcsOneShotTaskRunner({
        api: {} as EcsOneShotTaskApi,
        waiter: { wait: async () => undefined },
        config: runnerConfig({
          taskDefinitionArnByOperation: {
            ...runnerConfig().taskDefinitionArnByOperation,
            inspect:
              "arn:aws:ecs:ca-central-1:999999999999:task-definition/tenant-inspect:1",
          },
        }),
      }),
    /one AWS account and region/i,
  );

  let calls = 0;
  const runner = new EcsOneShotTaskRunner({
    api: new Proxy({} as EcsOneShotTaskApi, {
      get: () => () => {
        calls += 1;
      },
    }),
    waiter: { wait: async () => undefined },
    config: runnerConfig(),
  });
  const fence = resourceFence(2);
  await assert.rejects(
    runner.execute({
      operation: "inspect",
      fence,
      externalFence: externalFence(fence),
      runtimeSecretRef: secretArn,
      approvedBaselineDigest: null,
      idempotencyKey: "dep_tenant_one:wrong-generation",
      signal: new AbortController().signal,
    }),
    /physical generation|Secret ARN/i,
  );
  assert.equal(calls, 0);
});

function ownership(
  fence: TenantResourceFence,
  external: TenantExternalOperationFence,
): TenantRuntimeSecretOwnershipEvidence {
  return {
    resourceGeneration: fence.generation,
    ownershipMarker: fence.ownershipMarker,
    externalEpoch: external.epoch,
    externalMarker: external.marker,
    externalOperationHash: external.operationHash,
  };
}

async function secretObservation(input: {
  fence: TenantResourceFence;
  external: TenantExternalOperationFence;
  jsonKeys?: readonly string[];
  secretArnOverride?: string;
}): Promise<TenantRuntimeSecretProviderObservation> {
  const base = {
    schemaVersion: 1 as const,
    state: "present" as const,
    secretArn:
      input.secretArnOverride ??
      secretArn.replace("/g1-", `/g${input.fence.generation}-`),
    versionRef: "version-one",
    jsonKeys:
      (input.jsonKeys ?? tenantRuntimeSecretExactJsonKeys) as typeof tenantRuntimeSecretExactJsonKeys,
    ownership: ownership(input.fence, input.external),
  };
  const withEvidence = {
    ...base,
    evidenceHash: await createTenantSecretProviderEvidenceHash(base),
  };
  return {
    ...withEvidence,
    receiptHash: await createTenantSecretProviderReceiptHash(withEvidence),
  };
}

async function secretMutation(input: {
  fence: TenantResourceFence;
  external: TenantExternalOperationFence;
}): Promise<TenantRuntimeSecretProviderMutationReceipt> {
  const base = {
    schemaVersion: 1 as const,
    outcome: "created" as const,
    secretArn: secretArn.replace("/g1-", `/g${input.fence.generation}-`),
    versionRef: "version-one",
    jsonKeys: tenantRuntimeSecretExactJsonKeys,
    ownership: ownership(input.fence, input.external),
  };
  const withEvidence = {
    ...base,
    evidenceHash: await createTenantSecretProviderEvidenceHash(base),
  };
  return {
    ...withEvidence,
    receiptHash: await createTenantSecretProviderReceiptHash(withEvidence),
  };
}

test("requires an exact five-key Secret and re-observed generation plus epoch", async () => {
  const fence = resourceFence();
  const external = externalFence(fence);
  const calls: Array<Record<string, unknown>> = [];
  const provider: TenantRuntimeSecretProviderApi = {
    inspectSecret: async (input) => {
      calls.push(input);
      return secretObservation({ fence, external });
    },
    ensureGeneratedSecret: async (input) => {
      calls.push(input);
      return secretMutation({ fence, external });
    },
    deleteSecret: async () => assert.fail("delete is outside this test"),
  };
  const adapter = new ExactTenantRuntimeSecretAdapter({
    provider,
    expectedAccountId: "402010193138",
    expectedRegion: "ca-central-1",
  });
  const inspected = await adapter.inspectRuntimeSecret({
    fence,
    externalFence: external,
    signal: new AbortController().signal,
  });
  const ensured = await adapter.ensureRuntimeSecret({
    fence,
    externalFence: external,
    idempotencyKey: "dep_tenant_one:secret",
    signal: new AbortController().signal,
  });

  assert.equal(inspected.secretRef, secretArn);
  assert.equal(ensured.secretRef, secretArn);
  assert.equal(calls[0].secretName, `${fence.identity.secretName}/g1`);
  assert.deepEqual(calls[0].expectedJsonKeys, tenantRuntimeSecretExactJsonKeys);
  assert.deepEqual(calls[0].expectedOwnership, ownership(fence, external));
  const encoded = JSON.stringify(calls);
  assert.equal(encoded.includes("database_url\":"), false);
  assert.equal(/postgres(?:ql)?:\/\//i.test(encoded), false);
  assert.equal(/password/i.test(encoded), false);
});

test("rejects a sixth Secret JSON key and rotates the physical name on reopen", async () => {
  const fence = resourceFence();
  const external = externalFence(fence);
  const adapter = new ExactTenantRuntimeSecretAdapter({
    expectedAccountId: "402010193138",
    expectedRegion: "ca-central-1",
    provider: {
      inspectSecret: async () =>
        secretObservation({
          fence,
          external,
          jsonKeys: [...tenantRuntimeSecretExactJsonKeys, "unexpected_key"],
        }),
      ensureGeneratedSecret: async () => assert.fail("ensure is outside this test"),
      deleteSecret: async () => assert.fail("delete is outside this test"),
    },
  });
  await assert.rejects(
    adapter.inspectRuntimeSecret({
      fence,
      externalFence: external,
      signal: new AbortController().signal,
    }),
    /exactly the reviewed five JSON keys/i,
  );

  const reopened = resourceFence(2);
  const reopenedExternal = externalFence(reopened);
  let physicalName = "";
  const reopenedAdapter = new ExactTenantRuntimeSecretAdapter({
    expectedAccountId: "402010193138",
    expectedRegion: "ca-central-1",
    provider: {
      inspectSecret: async (input) => {
        physicalName = input.secretName;
        return secretObservation({
          fence: reopened,
          external: reopenedExternal,
        });
      },
      ensureGeneratedSecret: async () => assert.fail("ensure is outside this test"),
      deleteSecret: async () => assert.fail("delete is outside this test"),
    },
  });
  await reopenedAdapter.inspectRuntimeSecret({
    fence: reopened,
    externalFence: reopenedExternal,
    signal: new AbortController().signal,
  });
  assert.equal(physicalName, `${fence.identity.secretName}/g2`);
  assert.notEqual(physicalName, `${fence.identity.secretName}/g1`);
});

test("rejects Secret evidence from another tenant, generation, account, or region", async () => {
  const fence = resourceFence();
  const external = externalFence(fence);
  for (const foreignArn of [
    secretArn.replace("tenant_one_123", "tenant_two_456"),
    secretArn.replace("/g1-", "/g2-"),
    secretArn.replace(":402010193138:", ":999999999999:"),
    secretArn.replace(":ca-central-1:", ":us-east-1:"),
  ]) {
    const adapter = new ExactTenantRuntimeSecretAdapter({
      expectedAccountId: "402010193138",
      expectedRegion: "ca-central-1",
      provider: {
        inspectSecret: async () =>
          secretObservation({
            fence,
            external,
            secretArnOverride: foreignArn,
          }),
        ensureGeneratedSecret: async () =>
          assert.fail("ensure is outside this test"),
        deleteSecret: async () => assert.fail("delete is outside this test"),
      },
    });
    await assert.rejects(
      adapter.inspectRuntimeSecret({
        fence,
        externalFence: external,
        signal: new AbortController().signal,
      }),
      /Secret ARN|reference|account|region|generation/i,
      foreignArn,
    );
  }
});

test("Secret cleanup fails closed before provider calls without a provision predecessor", async () => {
  const fence = resourceFence();
  let calls = 0;
  const provider = new Proxy({} as TenantRuntimeSecretProviderApi, {
    get: () => () => {
      calls += 1;
    },
  });
  const adapter = new ExactTenantRuntimeSecretAdapter({
    provider,
    expectedAccountId: "402010193138",
    expectedRegion: "ca-central-1",
  });
  await assert.rejects(
    adapter.destroyRuntimeSecret({
      fence,
      externalFence: externalFence(fence, "cleanup"),
      idempotencyKey: "dep_tenant_one:cleanup:secret",
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "TENANT_SECRET_CLEANUP_PREDECESSOR_UNAVAILABLE" &&
      "retryable" in error &&
      error.retryable === false,
  );
  assert.equal(calls, 0);
});

test("database cleanup also fails closed before task or Secret resolution", async () => {
  const fence = resourceFence();
  let ecsCalls = 0;
  let secretResolutionCalls = 0;
  const runner = new EcsOneShotTaskRunner({
    api: new Proxy({} as EcsOneShotTaskApi, {
      get: () => () => {
        ecsCalls += 1;
      },
    }),
    waiter: { wait: async () => undefined },
    config: runnerConfig(),
  });
  const lifecycle = new EcsOneShotTenantDatabaseLifecycleAdapter({
    runner,
    secretRefs: {
      resolve: async () => {
        secretResolutionCalls += 1;
        return secretArn;
      },
    },
    approvedBaselineDigest: baselineDigest,
  });
  await assert.rejects(
    lifecycle.destroy({
      fence,
      externalFence: externalFence(fence, "cleanup"),
      idempotencyKey: "dep_tenant_one:cleanup:database",
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "TENANT_DATABASE_CLEANUP_PREDECESSOR_UNAVAILABLE" &&
      "retryable" in error &&
      error.retryable === false,
  );
  assert.equal(secretResolutionCalls, 0);
  assert.equal(ecsCalls, 0);
});

test("database lifecycle sends only a Secret ARN and approved digest and rejects extra output", async () => {
  const fence = resourceFence();
  const external = externalFence(fence);
  let request: EcsOneShotTaskRequest | null = null;
  let addUnexpectedOutput = false;
  const api: EcsOneShotTaskApi = {
    runTask: async (input) => {
      request = input.request;
      return { taskArn };
    },
    listTaskArnsByStartedBy: async () =>
      assert.fail("successful RunTask must not use recovery"),
    describeTask: async () => {
      const output = {
        outcome: "applied",
        resultingState: "baseline_restored",
        evidenceHash,
        ...(addUnexpectedOutput ? { debug: "not allowed" } : {}),
      };
      return stoppedObservation(
        await successfulTaskReceipt({
          request: request!,
          operation: "restore_approved_baseline",
          fence,
          external,
          output,
        }),
      );
    },
    stopTask: async () => assert.fail("already STOPPED task must not be stopped"),
  };
  const runner = new EcsOneShotTaskRunner({
    api,
    waiter: { wait: async () => undefined },
    config: runnerConfig(),
  });
  const lifecycle = new EcsOneShotTenantDatabaseLifecycleAdapter({
    runner,
    secretRefs: {
      resolve: async ({ signal }) => {
        assert.equal(signal instanceof AbortSignal, true);
        return secretArn;
      },
    },
    approvedBaselineDigest: baselineDigest,
  });
  const baseline: TenantApprovedBaseline = {
    contract: "speedfeast-pg16.14-tenant-baseline-v1",
    archiveS3Uri: "s3://private-baseline/_migration/tenant-v1.dump",
    archiveSha256: baselineDigest,
    approvedArchiveSha256: baselineDigest,
    manifestS3Uri:
      "s3://private-baseline/_migration/tenant-v1.manifest.json",
    manifestSha256: "c".repeat(64),
    sourceDatabase: "speedfeast_empty_template",
  };
  const applied = await lifecycle.restoreApprovedBaseline({
    fence,
    externalFence: external,
    runtimeSecretRef: secretArn,
    baseline,
    idempotencyKey: "dep_tenant_one:baseline",
    signal: new AbortController().signal,
  });
  assert.equal(applied.resultingState, "baseline_restored");
  assert.deepEqual(Object.keys(request!.container.environment).sort(), [
    "APPROVED_TENANT_BASELINE_SHA256",
    "TENANT_DATABASE_OPERATION",
    "TENANT_EXTERNAL_OPERATION_EPOCH",
    "TENANT_EXTERNAL_OPERATION_HASH",
    "TENANT_EXTERNAL_OPERATION_MARKER",
    "TENANT_OWNERSHIP_MARKER",
    "TENANT_RESOURCE_GENERATION",
    "TENANT_RUNTIME_SECRET_ARN",
  ]);
  const encoded = JSON.stringify(request);
  assert.equal(encoded.includes(baseline.archiveS3Uri), false);
  assert.equal(encoded.includes(baseline.manifestS3Uri), false);
  assert.equal(encoded.includes("DATABASE_URL"), false);
  assert.equal(/password/i.test(encoded), false);

  addUnexpectedOutput = true;
  await assert.rejects(
    lifecycle.restoreApprovedBaseline({
      fence,
      externalFence: external,
      runtimeSecretRef: secretArn,
      baseline,
      idempotencyKey: "dep_tenant_one:baseline:retry",
      signal: new AbortController().signal,
    }),
    /missing or unexpected fields/i,
  );
});
