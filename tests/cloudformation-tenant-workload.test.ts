import assert from "node:assert/strict";
import test from "node:test";
import { awsSandboxTenantStackName } from "../lib/deployments/cloudformation/tenant-stack.ts";
import {
  CloudFormationTenantWorkloadLifecycleAdapter,
  type CloudFormationTenantWorkloadLifecycleConfig,
} from "../lib/deployments/execution/cloudformation-tenant-workload.ts";
import { AwsSdkDeploymentAdapter } from "../lib/deployments/execution/aws-sdk-adapter.ts";
import type {
  AwsDeploymentPort,
  CloudFormationStackObservation,
  TenantExternalOperationFence,
  TenantProvisionPredecessor,
  TenantResourceFence,
} from "../lib/deployments/execution/contracts.ts";

const accountId = "402010193138";
const region = "ca-central-1";
const stableIdentityHash = "a".repeat(64);
const appInstanceId = "app_workload_cleanup_1";
const stackName = awsSandboxTenantStackName(appInstanceId);
const stackId =
  `arn:aws:cloudformation:${region}:${accountId}:stack/${stackName}/` +
  "12345678-1234-1234-1234-123456789012";
const cloudFormationRoleArn =
  `arn:aws:iam::${accountId}:role/TechlongSandboxCloudFormationExecutionRole`;

const fence: TenantResourceFence = {
  schemaVersion: 1,
  identity: {
    schemaVersion: 1,
    appInstanceId,
    workspaceId: "workspace_cleanup_1",
    productId: "speedfeast",
    environmentId: "environment_cleanup_1",
    cellKey: "cell-sandbox-1",
    databaseName: "tenant_cleanup_db",
    roleName: "tenant_cleanup_role",
    secretName: "techlong/sandbox/tenant/cleanup/runtime",
    stableIdentityHash,
  },
  generation: 1,
  ownerDeploymentId: "deployment_cleanup_owner_1",
  ownershipMarker: `tl_owner_${stableIdentityHash.slice(0, 32)}_g1`,
};

const provisionPredecessor: TenantProvisionPredecessor = {
  schemaVersion: 1,
  generation: 1,
  epoch: 1,
  intent: "provision",
  ownerDeploymentId: fence.ownerDeploymentId,
  operationHash: "b".repeat(64),
  marker: `tl_epoch_${stableIdentityHash.slice(0, 24)}_g1_e1`,
};

const cleanupFence: TenantExternalOperationFence = {
  schemaVersion: 1,
  resourceFence: fence,
  epoch: 2,
  intent: "cleanup",
  ownerDeploymentId: fence.ownerDeploymentId,
  operationHash: "c".repeat(64),
  marker: `tl_epoch_${stableIdentityHash.slice(0, 24)}_g1_e2`,
  state: "active",
  provisionPredecessor,
};

const expectedTags = {
  Environment: "aws-sandbox",
  ManagedBy: "techlong-provisioner",
  AppInstanceId: fence.identity.appInstanceId,
  CellId: fence.identity.cellKey,
  ResourceGeneration: "1",
  DeploymentId: provisionPredecessor.ownerDeploymentId,
  ExternalOperationEpoch: "1",
  ExternalOperationIntent: "provision",
  ExternalOperationMarker: provisionPredecessor.marker,
  ExternalOperationHash: provisionPredecessor.operationHash,
};

function observation(
  state: CloudFormationStackObservation["state"],
  rawStatus: string | null,
  tags: Record<string, string> = expectedTags,
): CloudFormationStackObservation {
  if (state === "missing") {
    return { state, rawStatus: null, stackId: null, outputs: {}, tags: {} };
  }
  return { state, rawStatus, stackId, outputs: {}, tags };
}

function config(
  patch: Partial<CloudFormationTenantWorkloadLifecycleConfig> = {},
): CloudFormationTenantWorkloadLifecycleConfig {
  return {
    expectedAccountId: accountId,
    expectedRegion: region,
    cloudFormationRoleArn,
    readbackAttempts: 3,
    readbackDelayMs: 0,
    ...patch,
  };
}

function adapter(input: {
  observations: CloudFormationStackObservation[];
  onDelete?: AwsDeploymentPort["deleteTenantStack"];
  deleteInputs?: Parameters<AwsDeploymentPort["deleteTenantStack"]>[0][];
  describeCalls?: string[];
  callerIdentity?: { accountId: string; arn: string };
  callerIdentities?: { accountId: string; arn: string }[];
  callerCalls?: number[];
  events?: string[];
  config?: Partial<CloudFormationTenantWorkloadLifecycleConfig>;
}): CloudFormationTenantWorkloadLifecycleAdapter {
  let observationIndex = 0;
  let identityIndex = 0;
  const aws = {
    region,
    getCallerIdentity: async ({ signal }: { signal: AbortSignal }) => {
      signal.throwIfAborted();
      input.callerCalls?.push(identityIndex + 1);
      input.events?.push("identity");
      const sequencedIdentity = input.callerIdentities?.[identityIndex];
      if (input.callerIdentities && !sequencedIdentity) {
        throw new Error("unexpected STS caller-identity readback");
      }
      identityIndex += 1;
      return sequencedIdentity ?? input.callerIdentity ?? {
        accountId,
        arn: `arn:aws:sts::${accountId}:assumed-role/TechlongSandboxProvisionerRole/test-session`,
      };
    },
    applyTenantStack: async () => {
      throw new Error("apply is outside this cleanup test");
    },
    describeTenantStack: async (requestedStackName: string) => {
      input.describeCalls?.push(requestedStackName);
      input.events?.push("describe");
      const value = input.observations[observationIndex];
      observationIndex += 1;
      if (!value) throw new Error("unexpected CloudFormation readback");
      return value;
    },
    deleteTenantStack: async (
      deleteInput: Parameters<AwsDeploymentPort["deleteTenantStack"]>[0],
    ) => {
      input.deleteInputs?.push(deleteInput);
      await deleteInput.verifyCaller(deleteInput.signal);
      input.events?.push("delete");
      if (input.onDelete) return input.onDelete(deleteInput);
      return { operation: "delete" as const };
    },
  } as AwsDeploymentPort;
  return new CloudFormationTenantWorkloadLifecycleAdapter({
    aws,
    config: config(input.config),
    wait: async (_delayMs, signal) => signal.throwIfAborted(),
  });
}

function destroyInput(signal: AbortSignal = new AbortController().signal) {
  return {
    fence,
    externalFence: cleanupFence,
    provisionPredecessor,
    idempotencyKey: "cleanup:tenant:generation:1",
    signal,
  };
}

test("CloudFormation workload cleanup deletes only predecessor-tagged stack and proves missing", async () => {
  const deleteInputs: Parameters<AwsDeploymentPort["deleteTenantStack"]>[0][] = [];
  const describeCalls: string[] = [];
  const workload = adapter({
    observations: [
      observation("ready", "CREATE_COMPLETE"),
      observation("delete_in_progress", "DELETE_IN_PROGRESS"),
      observation("missing", null),
    ],
    deleteInputs,
    describeCalls,
  });

  const receipt = await workload.destroy(destroyInput());

  assert.equal(receipt.outcome, "deleted");
  assert.equal(receipt.ownershipMarker, fence.ownershipMarker);
  assert.deepEqual(receipt.externalFence, cleanupFence);
  assert.deepEqual(describeCalls, [stackName, stackName, stackName]);
  assert.equal(deleteInputs.length, 1);
  assert.equal(deleteInputs[0].stackName, stackName);
  assert.equal(deleteInputs[0].cloudFormationRoleArn, cloudFormationRoleArn);
  assert.deepEqual(deleteInputs[0].expectedTags, expectedTags);
  assert.match(deleteInputs[0].clientRequestToken, /^cleanup-[a-f0-9]{64}$/);
  assert.ok(deleteInputs[0].clientRequestToken.length <= 128);
});

test("CloudFormation workload cleanup verifies the exact caller before accepting every missing readback", async () => {
  const events: string[] = [];
  const callerCalls: number[] = [];
  const workload = adapter({
    observations: [
      observation("ready", "CREATE_COMPLETE"),
      observation("delete_in_progress", "DELETE_IN_PROGRESS"),
      observation("missing", null),
    ],
    events,
    callerCalls,
  });

  const receipt = await workload.destroy(destroyInput());

  assert.equal(receipt.outcome, "deleted");
  assert.deepEqual(callerCalls, [1, 2, 3, 4, 5]);
  assert.deepEqual(events, [
    "identity",
    "describe",
    "identity",
    "identity",
    "delete",
    "identity",
    "describe",
    "identity",
    "describe",
  ]);
});

test("CloudFormation workload cleanup re-verifies the exact caller immediately before DeleteStack", async () => {
  const events: string[] = [];
  const deleteInputs: Parameters<AwsDeploymentPort["deleteTenantStack"]>[0][] = [];
  const workload = adapter({
    observations: [observation("ready", "CREATE_COMPLETE")],
    events,
    deleteInputs,
    callerIdentities: [
      {
        accountId,
        arn: `arn:aws:sts::${accountId}:assumed-role/TechlongSandboxProvisionerRole/first-session`,
      },
      {
        accountId: "000000000000",
        arn: "arn:aws:sts::000000000000:assumed-role/TechlongSandboxProvisionerRole/refreshed-session",
      },
    ],
  });

  await assert.rejects(workload.destroy(destroyInput()), (error: unknown) => {
    assert.equal(
      (error as { code?: string }).code,
      "TENANT_WORKLOAD_CLEANUP_CALLER_MISMATCH",
    );
    return true;
  });
  assert.deepEqual(events, ["identity", "describe", "identity"]);
  assert.equal(deleteInputs.length, 0);
});

test("CloudFormation workload cleanup caller callback fences the destructive provider boundary", async () => {
  const events: string[] = [];
  const workload = adapter({
    observations: [observation("ready", "CREATE_COMPLETE")],
    events,
    callerIdentities: [
      {
        accountId,
        arn: `arn:aws:sts::${accountId}:assumed-role/TechlongSandboxProvisionerRole/first-session`,
      },
      {
        accountId,
        arn: `arn:aws:sts::${accountId}:assumed-role/TechlongSandboxProvisionerRole/pre-delete-session`,
      },
      {
        accountId: "000000000000",
        arn: "arn:aws:sts::000000000000:assumed-role/TechlongSandboxProvisionerRole/refreshed-session",
      },
    ],
  });

  await assert.rejects(workload.destroy(destroyInput()), (error: unknown) => {
    assert.equal(
      (error as { code?: string }).code,
      "TENANT_WORKLOAD_CLEANUP_CALLER_MISMATCH",
    );
    return true;
  });
  assert.deepEqual(events, ["identity", "describe", "identity", "identity"]);
});

test("AWS SDK adapter invokes the caller fence after its ownership readback and before DeleteStack", async () => {
  class TestCommand {
    readonly input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class GetCallerIdentityCommand extends TestCommand {}
  class DescribeStacksCommand extends TestCommand {}
  class CreateStackCommand extends TestCommand {}
  class UpdateStackCommand extends TestCommand {}
  class DeleteStackCommand extends TestCommand {}
  const events: string[] = [];
  const sdkAdapter = new AwsSdkDeploymentAdapter(region, {
    stsClient: { send: async () => ({ Account: accountId }) },
    cloudFormationClient: {
      send: async (command: unknown) => {
        if (command instanceof DescribeStacksCommand) {
          events.push("describe");
          return {
            Stacks: [{
              StackId: stackId,
              StackStatus: "CREATE_COMPLETE",
              Tags: Object.entries(expectedTags).map(([Key, Value]) => ({ Key, Value })),
            }],
          };
        }
        if (command instanceof DeleteStackCommand) {
          events.push("delete");
          return {};
        }
        throw new Error("unexpected SDK command");
      },
    },
    commands: {
      getCallerIdentity: GetCallerIdentityCommand,
      describeStacks: DescribeStacksCommand,
      createStack: CreateStackCommand,
      updateStack: UpdateStackCommand,
      deleteStack: DeleteStackCommand,
    },
  });

  const missingVerifier = {
    stackName,
    clientRequestToken: "cleanup-without-verifier",
    expectedTags,
    cloudFormationRoleArn,
    signal: new AbortController().signal,
  } as unknown as Parameters<AwsDeploymentPort["deleteTenantStack"]>[0];
  await assert.rejects(
    sdkAdapter.deleteTenantStack(missingVerifier),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "AWS_CALLER_VERIFIER_REQUIRED");
      return true;
    },
  );
  assert.equal(events.length, 0);

  await assert.rejects(
    sdkAdapter.deleteTenantStack({
      stackName,
      clientRequestToken: "cleanup-boundary-test",
      expectedTags,
      cloudFormationRoleArn,
      verifyCaller: async () => {
        events.push("verify");
        throw Object.assign(new Error("caller drifted"), {
          code: "TENANT_WORKLOAD_CLEANUP_CALLER_MISMATCH",
        });
      },
      signal: new AbortController().signal,
    }),
    (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "TENANT_WORKLOAD_CLEANUP_CALLER_MISMATCH",
      );
      return true;
    },
  );
  assert.deepEqual(events, ["describe", "verify"]);

  events.length = 0;
  const result = await sdkAdapter.deleteTenantStack({
    stackName,
    clientRequestToken: "cleanup-boundary-success",
    expectedTags,
    cloudFormationRoleArn,
    verifyCaller: async () => {
      events.push("verify");
    },
    signal: new AbortController().signal,
  });
  assert.deepEqual(result, { operation: "delete" });
  assert.deepEqual(events, ["describe", "verify", "delete"]);
});

test("AWS SDK adapter never maps a malformed successful DescribeStacks response to missing", async () => {
  class TestCommand {
    readonly input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class GetCallerIdentityCommand extends TestCommand {}
  class DescribeStacksCommand extends TestCommand {}
  class CreateStackCommand extends TestCommand {}
  class UpdateStackCommand extends TestCommand {}
  class DeleteStackCommand extends TestCommand {}
  let stacks: unknown = [];
  let describeError: unknown;
  const sdkAdapter = new AwsSdkDeploymentAdapter(region, {
    stsClient: { send: async () => ({ Account: accountId }) },
    cloudFormationClient: {
      send: async () => {
        if (describeError) throw describeError;
        return { Stacks: stacks };
      },
    },
    commands: {
      getCallerIdentity: GetCallerIdentityCommand,
      describeStacks: DescribeStacksCommand,
      createStack: CreateStackCommand,
      updateStack: UpdateStackCommand,
      deleteStack: DeleteStackCommand,
    },
  });

  for (const malformed of [
    undefined,
    [],
    [{}],
    [{ StackId: stackId }],
    [{ StackStatus: "CREATE_COMPLETE" }],
    [
      { StackId: stackId, StackStatus: "CREATE_COMPLETE" },
      { StackId: `${stackId}-other`, StackStatus: "CREATE_COMPLETE" },
    ],
  ]) {
    stacks = malformed;
    await assert.rejects(
      sdkAdapter.describeTenantStack(stackName, {
        signal: new AbortController().signal,
      }),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "CLOUDFORMATION_DESCRIBE_INVALID",
        );
        return true;
      },
    );
  }

  describeError = Object.assign(
    new Error(`Stack with id ${stackName} does not exist`),
    { name: "ValidationError" },
  );
  assert.deepEqual(
    await sdkAdapter.describeTenantStack(stackName, {
      signal: new AbortController().signal,
    }),
    { state: "missing", rawStatus: null, stackId: null, outputs: {}, tags: {} },
  );

  for (const impostor of [
    Object.assign(new Error(`Stack with id ${stackName} does not exist`), {
      Code: "ValidationError",
    }),
    Object.assign(new Error("Stack with id another-stack does not exist"), {
      name: "ValidationError",
    }),
    Object.assign(new Error("Stack does not exist"), { name: "ValidationError" }),
  ]) {
    describeError = impostor;
    await assert.rejects(
      sdkAdapter.describeTenantStack(stackName, {
        signal: new AbortController().signal,
      }),
    );
  }
});

test("CloudFormation workload cleanup verifies caller identity before an initial already-missing receipt", async () => {
  const events: string[] = [];
  const workload = adapter({
    observations: [observation("missing", null)],
    events,
  });

  const receipt = await workload.destroy(destroyInput());

  assert.equal(receipt.outcome, "already_missing");
  assert.deepEqual(events, ["identity", "describe"]);
});

test("CloudFormation workload cleanup configuration is pinned to the reviewed Sandbox account", () => {
  assert.throws(
    () =>
      adapter({
        observations: [],
        config: {
          expectedAccountId: "000000000000",
          cloudFormationRoleArn:
            "arn:aws:iam::000000000000:role/TechlongSandboxCloudFormationExecutionRole",
        },
      }),
    (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "TENANT_WORKLOAD_CLEANUP_CONFIG_INVALID",
      );
      return true;
    },
  );
});

test("CloudFormation workload cleanup configuration is pinned to ca-central-1", () => {
  const aws = {
    region: "us-east-1",
  } as AwsDeploymentPort;
  assert.throws(
    () =>
      new CloudFormationTenantWorkloadLifecycleAdapter({
        aws,
        config: config({ expectedRegion: "us-east-1" }),
      }),
    (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "TENANT_WORKLOAD_CLEANUP_CONFIG_INVALID",
      );
      return true;
    },
  );
});

test("CloudFormation workload cleanup rejects non-exact provisioner assumed-role ARNs before DescribeStacks", async () => {
  const invalidCallerArns = [
    `arn:aws:iam::${accountId}:user/techlong-sandbox-dev`,
    `arn:aws:sts::${accountId}:assumed-role/OtherRole/test-session`,
    `arn:aws:sts::${accountId}:assumed-role/TechlongSandboxProvisionerRole/x`,
    `arn:aws:sts::${accountId}:assumed-role/TechlongSandboxProvisionerRole/path/session`,
    `arn:aws:sts::${accountId}:assumed-role/TechlongSandboxProvisionerRole/${"x".repeat(65)}`,
  ];

  for (const arn of invalidCallerArns) {
    const describeCalls: string[] = [];
    const workload = adapter({
      observations: [observation("missing", null)],
      describeCalls,
      callerIdentity: { accountId, arn },
    });
    await assert.rejects(workload.destroy(destroyInput()), (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "TENANT_WORKLOAD_CLEANUP_CALLER_MISMATCH",
      );
      return true;
    });
    assert.equal(describeCalls.length, 0);
  }
});

test("CloudFormation workload cleanup rejects tag drift before DeleteStack", async () => {
  const deleteInputs: Parameters<AwsDeploymentPort["deleteTenantStack"]>[0][] = [];
  const workload = adapter({
    observations: [
      observation("ready", "CREATE_COMPLETE", {
        ...expectedTags,
        ExternalOperationEpoch: "2",
      }),
    ],
    deleteInputs,
  });

  await assert.rejects(workload.destroy(destroyInput()), (error: unknown) => {
    assert.equal(
      (error as { code?: string }).code,
      "TENANT_WORKLOAD_OWNERSHIP_MISMATCH",
    );
    return true;
  });
  assert.equal(deleteInputs.length, 0);
});

test("CloudFormation workload cleanup rejects a stale or non-cleanup epoch before AWS", async () => {
  const describeCalls: string[] = [];
  const workload = adapter({ observations: [], describeCalls });
  const driftingFence = {
    ...cleanupFence,
    intent: "provision" as const,
    provisionPredecessor: undefined,
  };

  await assert.rejects(
    workload.destroy({ ...destroyInput(), externalFence: driftingFence }),
    (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "TENANT_CLEANUP_EXTERNAL_EPOCH_INVALID",
      );
      return true;
    },
  );
  assert.equal(describeCalls.length, 0);
});

test("CloudFormation workload cleanup never treats missing in another account as success", async () => {
  const describeCalls: string[] = [];
  const deleteInputs: Parameters<AwsDeploymentPort["deleteTenantStack"]>[0][] = [];
  const workload = adapter({
    observations: [observation("missing", null)],
    describeCalls,
    deleteInputs,
    callerIdentity: {
      accountId: "000000000000",
      arn: "arn:aws:sts::000000000000:assumed-role/TechlongSandboxProvisionerRole/test-session",
    },
  });

  await assert.rejects(workload.destroy(destroyInput()), (error: unknown) => {
    assert.equal(
      (error as { code?: string }).code,
      "TENANT_WORKLOAD_CLEANUP_CALLER_MISMATCH",
    );
    return true;
  });
  assert.equal(describeCalls.length, 0);
  assert.equal(deleteInputs.length, 0);
});

test("CloudFormation workload cleanup rejects caller drift before a later missing readback", async () => {
  const describeCalls: string[] = [];
  const workload = adapter({
    observations: [
      observation("ready", "CREATE_COMPLETE"),
      observation("missing", null),
    ],
    describeCalls,
    callerIdentities: [
      {
        accountId,
        arn: `arn:aws:sts::${accountId}:assumed-role/TechlongSandboxProvisionerRole/first-session`,
      },
      {
        accountId,
        arn: `arn:aws:sts::${accountId}:assumed-role/TechlongSandboxProvisionerRole/delete-session`,
      },
      {
        accountId,
        arn: `arn:aws:sts::${accountId}:assumed-role/TechlongSandboxProvisionerRole/delete-boundary-session`,
      },
      {
        accountId: "000000000000",
        arn: "arn:aws:sts::000000000000:assumed-role/TechlongSandboxProvisionerRole/second-session",
      },
    ],
  });

  await assert.rejects(workload.destroy(destroyInput()), (error: unknown) => {
    assert.equal(
      (error as { code?: string }).code,
      "TENANT_WORKLOAD_CLEANUP_CALLER_MISMATCH",
    );
    return true;
  });
  assert.deepEqual(describeCalls, [stackName]);
});

test("CloudFormation workload cleanup accepts only a strict empty missing observation", async () => {
  const malformedMissing = {
    state: "missing",
    rawStatus: null,
    stackId: null,
    outputs: [],
    tags: {},
  } as unknown as CloudFormationStackObservation;
  const workload = adapter({ observations: [malformedMissing] });

  await assert.rejects(workload.destroy(destroyInput()), (error: unknown) => {
    assert.equal(
      (error as { code?: string }).code,
      "TENANT_WORKLOAD_READBACK_INVALID",
    );
    return true;
  });
});

test("CloudFormation workload cleanup fails closed on DELETE_FAILED", async () => {
  const workload = adapter({
    observations: [
      observation("ready", "CREATE_COMPLETE"),
      observation("failed", "DELETE_FAILED"),
    ],
  });

  await assert.rejects(workload.destroy(destroyInput()), (error: unknown) => {
    assert.equal(
      (error as { code?: string }).code,
      "CLOUDFORMATION_DELETE_FAILED",
    );
    assert.equal((error as { retryable?: boolean }).retryable, true);
    return true;
  });
});

test("CloudFormation workload cleanup retries a lost DeleteStack response with one stable token", async () => {
  const deleteInputs: Parameters<AwsDeploymentPort["deleteTenantStack"]>[0][] = [];
  let deletes = 0;
  const workload = adapter({
    observations: [
      observation("ready", "CREATE_COMPLETE"),
      observation("ready", "CREATE_COMPLETE"),
      observation("ready", "CREATE_COMPLETE"),
      observation("missing", null),
    ],
    deleteInputs,
    config: { readbackAttempts: 1 },
    onDelete: async () => {
      deletes += 1;
      if (deletes === 1) {
        throw Object.assign(new Error("DeleteStack response was lost"), {
          code: "TimeoutError",
          retryable: true,
        });
      }
      return { operation: "delete" };
    },
  });

  await assert.rejects(workload.destroy(destroyInput()), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "TimeoutError");
    return true;
  });
  const receipt = await workload.destroy(destroyInput());

  assert.equal(receipt.outcome, "deleted");
  assert.equal(deleteInputs.length, 2);
  assert.equal(
    deleteInputs[0].clientRequestToken,
    deleteInputs[1].clientRequestToken,
  );
});

test("CloudFormation workload cleanup recovers a lost DeleteStack response when bounded readback proves missing", async () => {
  const workload = adapter({
    observations: [
      observation("ready", "CREATE_COMPLETE"),
      observation("missing", null),
    ],
    onDelete: async () => {
      throw Object.assign(new Error("DeleteStack response was lost"), {
        code: "TimeoutError",
        retryable: true,
      });
    },
  });

  const receipt = await workload.destroy(destroyInput());

  assert.equal(receipt.outcome, "deleted");
});

test("CloudFormation workload cleanup uses bounded readback and never treats a present stack as deleted", async () => {
  const describeCalls: string[] = [];
  const workload = adapter({
    observations: [
      observation("ready", "CREATE_COMPLETE"),
      observation("ready", "CREATE_COMPLETE"),
      observation("ready", "CREATE_COMPLETE"),
    ],
    describeCalls,
    config: { readbackAttempts: 2 },
  });

  await assert.rejects(workload.destroy(destroyInput()), (error: unknown) => {
    assert.equal(
      (error as { code?: string }).code,
      "CLOUDFORMATION_DELETE_UNCONFIRMED",
    );
    assert.equal((error as { retryable?: boolean }).retryable, true);
    return true;
  });
  assert.deepEqual(describeCalls, [stackName, stackName, stackName]);
});

test("CloudFormation workload cleanup preserves an abort and makes zero AWS calls", async () => {
  const describeCalls: string[] = [];
  const workload = adapter({ observations: [], describeCalls });
  const controller = new AbortController();
  const reason = Object.assign(new Error("lease lost"), {
    code: "DEPLOYMENT_LEASE_LOST",
  });
  controller.abort(reason);

  await assert.rejects(workload.destroy(destroyInput(controller.signal)), reason);
  assert.equal(describeCalls.length, 0);
});

test("CloudFormation workload cleanup stops bounded readback as soon as its lease signal aborts", async () => {
  const events: string[] = [];
  const controller = new AbortController();
  const reason = Object.assign(new Error("lease lost during readback"), {
    code: "DEPLOYMENT_LEASE_LOST",
  });
  const aws = {
    region,
    getCallerIdentity: async ({ signal }: { signal: AbortSignal }) => {
      signal.throwIfAborted();
      events.push("identity");
      return {
        accountId,
        arn: `arn:aws:sts::${accountId}:assumed-role/TechlongSandboxProvisionerRole/test-session`,
      };
    },
    applyTenantStack: async () => {
      throw new Error("apply is outside this cleanup test");
    },
    describeTenantStack: async () => {
      events.push("describe");
      return observation("ready", "CREATE_COMPLETE");
    },
    deleteTenantStack: async () => {
      events.push("delete");
      return { operation: "delete" as const };
    },
  } as AwsDeploymentPort;
  const workload = new CloudFormationTenantWorkloadLifecycleAdapter({
    aws,
    config: config({ readbackAttempts: 3, readbackDelayMs: 1 }),
    wait: async (_delayMs, signal) => {
      events.push("wait");
      controller.abort(reason);
      signal.throwIfAborted();
    },
  });

  await assert.rejects(workload.destroy(destroyInput(controller.signal)), reason);
  assert.deepEqual(events, [
    "identity",
    "describe",
    "identity",
    "delete",
    "identity",
    "describe",
    "wait",
  ]);
});
