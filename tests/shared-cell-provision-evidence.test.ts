import assert from "node:assert/strict";
import test from "node:test";
import type { DeploymentEnvironment } from "../lib/deployments/environment.ts";
import type { DeploymentExecutionBinding } from "../lib/deployments/execution/contracts.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import {
  AwsSdkSharedCellProvisionAuthority,
  type AwsSdkSharedCellProvisionAuthorityDependencies,
} from "../lib/deployments/execution/aws-sdk-shared-cell-provision-authority.ts";
import {
  createAwsSdkSharedCellProvisionRuntime,
  createAwsSdkSharedCellProvisionRuntimeFromModules,
} from "../lib/deployments/execution/aws-sdk-shared-cell-provision-runtime.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN } from "../lib/deployments/execution/aws-sdk-shared-cell-cleanup-authority.ts";
import {
  compileSharedCellCleanupAuthorityCandidateItem,
  SHARED_CELL_CLEANUP_AUTHORITY_KEY,
  validateSharedCellAuthorityItem,
  validateSharedCellCleanupAuthorityTransition,
  type SharedCellAuthorityItem,
} from "../lib/deployments/execution/shared-cell-cleanup-authority.ts";
import {
  compileSharedCellProvisionAuthorityCandidateItem,
  DisabledAtomicSharedCellProvisionAuthority,
  installInitialSharedCellProvisionAuthority,
  type AtomicSharedCellProvisionAuthorityPort,
  type SharedCellProvisionAuthoritySnapshot,
} from "../lib/deployments/execution/shared-cell-provision-authority.ts";
import {
  assertVerifiedSharedCellProvisionEvidence,
  AwsSdkSharedCellProvisionEvidenceAdapter,
  type AwsSdkSharedCellProvisionEvidenceDependencies,
} from "../lib/deployments/execution/shared-cell-provision-evidence.ts";
import {
  renderAwsSandboxSharedCellStack,
  type AwsSandboxSharedCellStackInput,
} from "../lib/deployments/cloudformation/shared-cell-stack.ts";

const now = Date.UTC(2026, 7, 31, 12, 0, 0);
const accountId = "402010193138";
const region = "ca-central-1";
const stackName = "techlong-sandbox-cell-sandbox-1";
const stackId =
  `arn:aws:cloudformation:${region}:${accountId}:stack/${stackName}/` +
  "12345678-1234-1234-1234-123456789012";
const cloudFormationRoleArn =
  `arn:aws:iam::${accountId}:role/TechlongSandboxCloudFormationExecutionRole`;
const databaseEndpoint =
  `${stackName}.cluster-abcdefghijkl.${region}.rds.amazonaws.com`;
const databaseSecretArn =
  `arn:aws:secretsmanager:${region}:${accountId}:secret:` +
  "rds!cluster-01234567-89ab-cdef-0123-456789abcdef-ABCDEF";

const environment: DeploymentEnvironment = {
  id: "env_aws_sandbox_ca_central_1",
  key: "aws-sandbox-ca-central-1",
  name: "AWS Sandbox ca-central-1",
  kind: "aws_sandbox",
  driver: "aws_ecs_cell",
  expectedAccountId: accountId,
  region,
  cellKey: "cell-sandbox-1",
  baseDomain: "sandbox.techlong.cloud",
  applyEnabled: false,
  status: "active",
  policy: {
    budgetLimitCents: 1_000,
    ttlSeconds: 7_200,
    maxCells: 1,
    maxTenants: 1,
    maxTaskCount: 1,
    allowedProfiles: ["standard-v1"],
    allowNatGateway: false,
    allowInterfaceEndpoints: false,
    databaseEngine: "aurora-postgresql-serverless-v2",
    auroraPostgresMinimumVersion: "16.3",
    auroraPostgresEngineVersion: "16.14",
    auroraEngineMode: "provisioned",
    allowLimitlessDatabase: false,
    databaseMode: "tenant_database",
    auroraServerlessMinAcu: 0,
    auroraServerlessMaxAcu: 1,
    auroraSecondsUntilAutoPause: 300,
    allowDedicatedDatabase: false,
    allowMultiAzDatabase: false,
    allowRdsProxy: false,
    allowGlobalDatabase: false,
    logRetentionDays: 1,
  },
};

const binding: DeploymentExecutionBinding = {
  environmentId: environment.id,
  workerRoleArn:
    `arn:aws:iam::${accountId}:role/TechlongSandboxProvisionerRole`,
  cloudFormationRoleArn,
  tenantStackParameters: {
    ClusterName: "cell-sandbox-1",
    VpcId: "vpc-0123456789abcdef0",
    SubnetIds:
      "subnet-0123456789abcdef0,subnet-0123456789abcdef1",
    TaskSecurityGroupId: "sg-0123456789abcdef0",
    OneShotTaskSecurityGroupId: "sg-0123456789abcdef1",
    HttpsListenerArn:
      `arn:aws:elasticloadbalancing:${region}:${accountId}:listener/app/` +
      "techlong-sandbox-cell/0123456789abcdef/0123456789abcdef",
    ControlListenerArn:
      `arn:aws:elasticloadbalancing:${region}:${accountId}:listener/app/` +
      "techlong-sandbox-cell/0123456789abcdef/fedcba9876543210",
  },
  status: "active",
};

function stackInput(requestedAt = now - 60_000): AwsSandboxSharedCellStackInput {
  return {
    environment,
    requestedAt,
    availabilityZones: ["ca-central-1a", "ca-central-1b"],
    certificateArn:
      `arn:aws:acm:${region}:${accountId}:certificate/` +
      "12345678-1234-1234-1234-123456789012",
    controlTrustStoreArn:
      `arn:aws:elasticloadbalancing:${region}:${accountId}:` +
      "truststore/techlong-sandbox-control/0123456789abcdef",
    cellJanitorFunctionArn:
      `arn:aws:lambda:${region}:${accountId}:function:techlong-sandbox-cell-janitor`,
    cellSchedulerInvokeRoleArn:
      `arn:aws:iam::${accountId}:role/TechlongSandboxCellSchedulerInvokeRole`,
    cellSchedulerGroupName: "techlong-sandbox-cell",
  };
}

function command(kind: string) {
  return class {
    readonly kind = kind;
    readonly input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  };
}

interface Call {
  kind: string;
  input: Record<string, unknown>;
  signal: AbortSignal | undefined;
}

interface FixtureOverrides {
  account?: string;
  firstStack?: Record<string, unknown>;
  finalStack?: Record<string, unknown>;
  template?: unknown;
  resources?: Record<string, unknown>[];
  paginated?: boolean;
  repeatedToken?: boolean;
  clock?: number[];
  providerError?: Error & { $metadata?: { httpStatusCode: number } };
}

function fixture(
  input: AwsSandboxSharedCellStackInput = stackInput(),
  overrides: FixtureOverrides = {},
) {
  const plan = renderAwsSandboxSharedCellStack(input);
  const outputs = {
    ClusterName: "cell-sandbox-1",
    VpcId: binding.tenantStackParameters.VpcId,
    SubnetIds: binding.tenantStackParameters.SubnetIds,
    TaskSecurityGroupId: binding.tenantStackParameters.TaskSecurityGroupId,
    OneShotTaskSecurityGroupId:
      binding.tenantStackParameters.OneShotTaskSecurityGroupId,
    HttpsListenerArn: binding.tenantStackParameters.HttpsListenerArn,
    ControlListenerArn: binding.tenantStackParameters.ControlListenerArn,
    DatabaseClusterIdentifier: stackName,
    DatabaseEndpoint: databaseEndpoint,
    DatabaseMasterSecretArn: databaseSecretArn,
    CellExpiresAt: plan.tags.ExpiresAt,
  };
  const baseStack: Record<string, unknown> = {
    StackId: stackId,
    StackName: stackName,
    StackStatus: "CREATE_COMPLETE",
    RoleARN: cloudFormationRoleArn,
    EnableTerminationProtection: false,
    CreationTime: new Date(input.requestedAt + 1_000),
    Tags: Object.entries(plan.tags).map(([Key, Value]) => ({ Key, Value })),
    Parameters: Object.entries(plan.parameters).map(
      ([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue }),
    ),
    Outputs: Object.entries(outputs).map(([OutputKey, OutputValue]) => ({
      OutputKey,
      OutputValue,
    })),
  };
  const resources =
    overrides.resources ??
    Object.entries(
      plan.template.Resources as Record<string, { Type: string }>,
    ).map(([LogicalResourceId, resource]) => ({
      LogicalResourceId,
      PhysicalResourceId: `physical-${LogicalResourceId}`,
      ResourceStatus: "CREATE_COMPLETE",
      ResourceType: resource.Type,
    }));
  const midpoint = Math.ceil(resources.length / 2);
  const calls: Call[] = [];
  let describeCount = 0;
  const clock = [...(overrides.clock ?? [now, now])];
  const client = {
    send: async (
      value: unknown,
      options?: { abortSignal?: AbortSignal },
    ): Promise<Record<string, unknown>> => {
      const item = value as { kind: string; input: Record<string, unknown> };
      calls.push({ kind: item.kind, input: item.input, signal: options?.abortSignal });
      if (overrides.providerError) throw overrides.providerError;
      switch (item.kind) {
        case "GetCallerIdentity":
          return {
            Account: overrides.account ?? accountId,
            Arn:
              `arn:aws:sts::${accountId}:assumed-role/` +
              "TechlongSandboxProvisionerRole/techlong-sandbox-provisioner",
          };
        case "DescribeStacks": {
          describeCount += 1;
          const selected =
            describeCount === 1 ? overrides.firstStack : overrides.finalStack;
          return { Stacks: [{ ...baseStack, ...selected }] };
        }
        case "GetTemplate":
          return { TemplateBody: overrides.template ?? plan.template };
        case "ListStackResources": {
          if (!overrides.paginated) {
            return { StackResourceSummaries: [...resources].reverse() };
          }
          if (item.input.NextToken === undefined) {
            return {
              StackResourceSummaries: resources.slice(0, midpoint),
              NextToken: "page-two",
            };
          }
          return {
            StackResourceSummaries: resources.slice(midpoint),
            ...(overrides.repeatedToken ? { NextToken: "page-two" } : {}),
          };
        }
        default:
          throw new Error(`unexpected command ${item.kind}`);
      }
    },
  };
  const dependencies: AwsSdkSharedCellProvisionEvidenceDependencies = {
    clients: { sts: client, cloudFormation: client },
    commands: {
      getCallerIdentity: command("GetCallerIdentity"),
      describeStacks: command("DescribeStacks"),
      getTemplate: command("GetTemplate"),
      listStackResources: command("ListStackResources"),
    },
    now: () => clock.shift() as number,
  };
  return {
    adapter: new AwsSdkSharedCellProvisionEvidenceAdapter(region, dependencies),
    calls,
    input,
    plan,
    resources,
  };
}

test("live provision evidence binds the exact template, full paginated inventory and stable Stack", async () => {
  const setup = fixture(stackInput(), { paginated: true });
  const controller = new AbortController();
  const evidence = await setup.adapter.readVerifiedProvisionEvidence({
    environment,
    binding,
    stackInput: setup.input,
    signal: controller.signal,
  });

  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(evidence.verified, true);
  assert.equal(evidence.stackId, stackId);
  assert.equal(evidence.cellExpiresAt, setup.plan.tags.ExpiresAt);
  assert.equal(
    evidence.templateCanonicalSha256,
    await sha256Hex(setup.plan.template),
  );
  assert.match(evidence.resourceInventorySha256, /^[a-f0-9]{64}$/);
  assert.doesNotThrow(() => assertVerifiedSharedCellProvisionEvidence(evidence));
  assert.throws(
    () => assertVerifiedSharedCellProvisionEvidence({ ...evidence }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_PROVISION_EVIDENCE_UNVERIFIED",
  );

  assert.deepEqual(
    setup.calls.map((call) => call.kind),
    [
      "GetCallerIdentity",
      "DescribeStacks",
      "GetTemplate",
      "ListStackResources",
      "ListStackResources",
      "DescribeStacks",
    ],
  );
  assert.equal(setup.calls[1].input.StackName, stackName);
  assert.equal(setup.calls[2].input.StackName, stackId);
  assert.equal(setup.calls[2].input.TemplateStage, "Original");
  assert.equal(setup.calls.at(-1)?.input.StackName, stackId);
  assert.equal(setup.calls.every((call) => call.signal === controller.signal), true);

  const reordered = fixture();
  const repeated = await reordered.adapter.readVerifiedProvisionEvidence({
    environment,
    binding,
    stackInput: reordered.input,
    signal: new AbortController().signal,
  });
  assert.equal(
    evidence.resourceInventorySha256,
    repeated.resourceInventorySha256,
  );
});

test("caller, Stack, template and complete inventory drift fail closed", async (t) => {
  const cases: Array<{
    name: string;
    overrides: FixtureOverrides;
    code: string;
  }> = [
    {
      name: "foreign caller",
      overrides: { account: "111111111111" },
      code: "SHARED_CELL_PROVISION_EVIDENCE_CALLER_INVALID",
    },
    {
      name: "nested Stack",
      overrides: { firstStack: { ParentId: stackId } },
      code: "SHARED_CELL_PROVISION_EVIDENCE_STACK_INVALID",
    },
    {
      name: "ownership tag",
      overrides: {
        firstStack: {
          Tags: [
            { Key: "Environment", Value: "production" },
            { Key: "ManagedBy", Value: "techlong-cell-operator" },
            { Key: "CellId", Value: "cell-sandbox-1" },
            {
              Key: "ExpiresAt",
              Value: stackInput().requestedAt
                ? new Date(stackInput().requestedAt + 10_800_000).toISOString()
                : "",
            },
          ],
        },
      },
      code: "SHARED_CELL_PROVISION_EVIDENCE_STACK_DRIFT",
    },
    {
      name: "original template",
      overrides: { template: { AWSTemplateFormatVersion: "2010-09-09" } },
      code: "SHARED_CELL_PROVISION_EVIDENCE_TEMPLATE_MISMATCH",
    },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const setup = fixture(stackInput(), item.overrides);
      await assert.rejects(
        setup.adapter.readVerifiedProvisionEvidence({
          environment,
          binding,
          stackInput: setup.input,
          signal: new AbortController().signal,
        }),
        (error: unknown) => (error as { code?: string }).code === item.code,
      );
    });
  }

  await t.test("missing resource", async () => {
    const base = fixture();
    const setup = fixture(stackInput(), { resources: base.resources.slice(1) });
    await assert.rejects(
      setup.adapter.readVerifiedProvisionEvidence({
        environment,
        binding,
        stackInput: setup.input,
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_PROVISION_EVIDENCE_INVENTORY_INVALID",
    );
  });

  await t.test("resource type and terminal status", async () => {
    const base = fixture();
    const resources = base.resources.map((resource, index) =>
      index === 0
        ? { ...resource, ResourceType: "AWS::IAM::Role", ResourceStatus: "CREATE_IN_PROGRESS" }
        : resource,
    );
    const setup = fixture(stackInput(), { resources });
    await assert.rejects(
      setup.adapter.readVerifiedProvisionEvidence({
        environment,
        binding,
        stackInput: setup.input,
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_PROVISION_EVIDENCE_INVENTORY_INVALID",
    );
  });

  await t.test("repeated pagination token", async () => {
    const setup = fixture(stackInput(), { paginated: true, repeatedToken: true });
    await assert.rejects(
      setup.adapter.readVerifiedProvisionEvidence({
        environment,
        binding,
        stackInput: setup.input,
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_PROVISION_EVIDENCE_PAGINATION_INVALID",
    );
  });
});

test("Stack stability, bounded collection time, expiry, abort and provider errors are fail closed", async (t) => {
  await t.test("Stack changes during collection", async () => {
    const setup = fixture(stackInput(), {
      finalStack: { LastUpdatedTime: new Date(now - 10_000) },
    });
    await assert.rejects(
      setup.adapter.readVerifiedProvisionEvidence({
        environment,
        binding,
        stackInput: setup.input,
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        (error as { code?: string; retryable?: boolean }).code ===
          "SHARED_CELL_PROVISION_EVIDENCE_STACK_CHANGED" &&
        (error as { retryable?: boolean }).retryable === true,
    );
  });

  await t.test("collection exceeds the evidence window", async () => {
    const setup = fixture(stackInput(), { clock: [now, now + 300_001] });
    await assert.rejects(
      setup.adapter.readVerifiedProvisionEvidence({
        environment,
        binding,
        stackInput: setup.input,
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_PROVISION_EVIDENCE_STALE",
    );
  });

  await t.test("expired Cell", async () => {
    const expiredInput = stackInput(now - 10_800_000);
    const setup = fixture(expiredInput);
    await assert.rejects(
      setup.adapter.readVerifiedProvisionEvidence({
        environment,
        binding,
        stackInput: expiredInput,
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_PROVISION_EVIDENCE_CELL_EXPIRED",
    );
  });

  await t.test("pre-abort performs no SDK call", async () => {
    const setup = fixture();
    const controller = new AbortController();
    controller.abort(new Error("lease lost"));
    await assert.rejects(
      setup.adapter.readVerifiedProvisionEvidence({
        environment,
        binding,
        stackInput: setup.input,
        signal: controller.signal,
      }),
      /lease lost/,
    );
    assert.deepEqual(setup.calls, []);
  });

  await t.test("provider error is sanitized and retryable", async () => {
    const providerError = Object.assign(new Error("secret provider payload"), {
      name: "Throttling Exception!",
      $metadata: { httpStatusCode: 429 },
    });
    const setup = fixture(stackInput(), { providerError });
    await assert.rejects(
      setup.adapter.readVerifiedProvisionEvidence({
        environment,
        binding,
        stackInput: setup.input,
        signal: new AbortController().signal,
      }),
      (error: unknown) => {
        const value = error as {
          code?: string;
          retryable?: boolean;
          message?: string;
        };
        return (
          value.code === "Throttling_Exception_" &&
          value.retryable === true &&
          !String(value.message).includes("secret provider payload")
        );
      },
    );
  });
});

async function liveEvidence() {
  const setup = fixture();
  return setup.adapter.readVerifiedProvisionEvidence({
    environment,
    binding,
    stackInput: setup.input,
    signal: new AbortController().signal,
  });
}

class MemoryProvisionAuthority
  implements AtomicSharedCellProvisionAuthorityPort
{
  snapshot: SharedCellProvisionAuthoritySnapshot = {
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    revision: 0,
    item: null,
  };
  observeCalls = 0;
  installCalls = 0;
  conflict: SharedCellAuthorityItem | null = null;
  loseReadback = false;
  malformedInstallSnapshot = false;
  malformedReadback = false;
  throwOnInstall: Error | null = null;
  abortOnInstall: AbortController | null = null;

  async observe(): Promise<SharedCellProvisionAuthoritySnapshot> {
    this.observeCalls += 1;
    if (this.malformedReadback && this.installCalls > 0) {
      return { authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY, revision: 1, item: null };
    }
    if (this.loseReadback && this.installCalls > 0) {
      return {
        authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
        revision: 0,
        item: null,
      };
    }
    return this.snapshot;
  }

  async installIfAbsent(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    next: SharedCellAuthorityItem;
  }): Promise<{
    applied: boolean;
    snapshot: SharedCellProvisionAuthoritySnapshot;
  }> {
    this.installCalls += 1;
    if (this.throwOnInstall) throw this.throwOnInstall;
    this.abortOnInstall?.abort(new Error("lease lost"));
    if (this.conflict) {
      this.snapshot = {
        authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
        revision: this.conflict.revision,
        item: this.conflict,
      };
      return { applied: false, snapshot: this.snapshot };
    }
    this.snapshot = {
      authorityKey: input.authorityKey,
      revision: input.next.revision,
      item: input.next,
    };
    return {
      applied: true,
      snapshot: this.malformedInstallSnapshot
        ? { authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY, revision: 1, item: null }
        : this.snapshot,
    };
  }
}

test("provision compiler emits a branded-evidence-bound exact predecessor and cleanup can advance it", async () => {
  const evidence = await liveEvidence();
  const candidate = await compileSharedCellProvisionAuthorityCandidateItem({
    evidence,
    coordinate: {
      ownerDeploymentId: "deployment_cell_owner_1",
      generation: 1,
      epoch: 1,
    },
    revision: 1,
    now,
  });
  const validated = await validateSharedCellAuthorityItem(candidate);
  assert.equal(validated.record.state, "provision_verified");
  assert.equal(Object.keys(validated.record).length, 18);
  assert.match(validated.record.provisionOperationHash, /^[a-f0-9]{64}$/);

  await assert.rejects(
    compileSharedCellProvisionAuthorityCandidateItem({
      evidence: { ...evidence },
      coordinate: {
        ownerDeploymentId: "deployment_cell_owner_1",
        generation: 1,
        epoch: 1,
      },
      revision: 1,
      now,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_PROVISION_AUTHORITY_EVIDENCE_UNVERIFIED",
  );

  const cleanupNow = Date.parse(evidence.cellExpiresAt) + 1;
  const cleanup = await compileSharedCellCleanupAuthorityCandidateItem({
    cell: {
      stackName: evidence.stackName,
      stackId: evidence.stackId,
      stackStatus: evidence.stackStatus,
      cellExpiresAt: evidence.cellExpiresAt,
      templateCanonicalSha256: evidence.templateCanonicalSha256,
      resourceInventorySha256: evidence.resourceInventorySha256,
    },
    provision: {
      ownerDeploymentId: validated.record.ownerDeploymentId,
      generation: validated.record.generation,
      epoch: validated.record.provisionEpoch,
      operationHash: validated.record.provisionOperationHash,
    },
    cleanup: {
      epoch: 2,
      expiresAt: new Date(cleanupNow + 15 * 60_000).toISOString(),
    },
    revision: 2,
    now: cleanupNow,
  });
  const transition = await validateSharedCellCleanupAuthorityTransition({
    expected: candidate,
    next: cleanup,
  });
  assert.equal(transition.kind, "advance");
  assert.equal(transition.next.record.state, "cleanup_authorized");
});

test("initial provision installer is absent-only, exact-readback and replay safe", async () => {
  const evidence = await liveEvidence();
  const coordinate = {
    ownerDeploymentId: "deployment_cell_owner_1",
    generation: 1,
    epoch: 1,
  };
  const port = new MemoryProvisionAuthority();
  const clock = [now, now + 1, now + 2];
  const installed = await installInitialSharedCellProvisionAuthority({
    port,
    evidence,
    coordinate,
    signal: new AbortController().signal,
    now: () => clock.shift() as number,
  });
  assert.equal(installed.revision, 1);
  assert.equal(port.installCalls, 1);
  assert.equal(port.observeCalls, 2);

  const replay = await installInitialSharedCellProvisionAuthority({
    port,
    evidence,
    coordinate,
    signal: new AbortController().signal,
    now: () => now + 3,
  });
  assert.deepEqual(replay, installed);
  assert.equal(port.installCalls, 1);
  assert.equal(port.observeCalls, 3);

  const staleReplayClock = [now, now + 30_001];
  await assert.rejects(
    installInitialSharedCellProvisionAuthority({
      port,
      evidence,
      coordinate,
      signal: new AbortController().signal,
      now: () => staleReplayClock.shift() as number,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_PROVISION_AUTHORITY_EVIDENCE_STALE",
  );
});

test("initial provision replay rejects every non-genesis revision", async () => {
  const evidence = await liveEvidence();
  const coordinate = {
    ownerDeploymentId: "deployment_cell_owner_1",
    generation: 1,
    epoch: 1,
  };
  const revisionTwo = await compileSharedCellProvisionAuthorityCandidateItem({
    evidence,
    coordinate,
    revision: 2,
    now,
  });
  const port = new MemoryProvisionAuthority();
  port.snapshot = {
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    revision: 2,
    item: revisionTwo,
  };

  await assert.rejects(
    installInitialSharedCellProvisionAuthority({
      port,
      evidence,
      coordinate,
      signal: new AbortController().signal,
      now: () => now,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_PROVISION_AUTHORITY_ALREADY_EXISTS",
  );
  assert.equal(port.installCalls, 0);
});

test("provision installer rejects forged evidence, conflicts, readback drift and post-submit abort", async (t) => {
  const evidence = await liveEvidence();
  const coordinate = {
    ownerDeploymentId: "deployment_cell_owner_1",
    generation: 1,
    epoch: 1,
  };

  await t.test("forged evidence makes zero port calls", async () => {
    const port = new MemoryProvisionAuthority();
    await assert.rejects(
      installInitialSharedCellProvisionAuthority({
        port,
        evidence: { ...evidence },
        coordinate,
        signal: new AbortController().signal,
        now: () => now,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_PROVISION_AUTHORITY_EVIDENCE_UNVERIFIED",
    );
    assert.equal(port.observeCalls, 0);
    assert.equal(port.installCalls, 0);
  });

  await t.test("conditional conflict is never success", async () => {
    const port = new MemoryProvisionAuthority();
    port.conflict = await compileSharedCellProvisionAuthorityCandidateItem({
      evidence,
      coordinate: { ...coordinate, ownerDeploymentId: "another_owner" },
      revision: 1,
      now,
    });
    await assert.rejects(
      installInitialSharedCellProvisionAuthority({
        port,
        evidence,
        coordinate,
        signal: new AbortController().signal,
        now: () => now,
      }),
      (error: unknown) =>
        (error as { code?: string; retryable?: boolean }).code ===
          "SHARED_CELL_PROVISION_AUTHORITY_INSTALL_CONFLICT" &&
        (error as { retryable?: boolean }).retryable === true,
    );
  });

  await t.test("missing independent readback is uncertain", async () => {
    const port = new MemoryProvisionAuthority();
    port.loseReadback = true;
    await assert.rejects(
      installInitialSharedCellProvisionAuthority({
        port,
        evidence,
        coordinate,
        signal: new AbortController().signal,
        now: () => now,
      }),
      (error: unknown) =>
        (error as { code?: string; retryable?: boolean }).code ===
          "SHARED_CELL_PROVISION_AUTHORITY_READBACK_MISMATCH" &&
        (error as { retryable?: boolean }).retryable === true,
    );
  });

  await t.test("abort after submission is uncertain", async () => {
    const port = new MemoryProvisionAuthority();
    const controller = new AbortController();
    port.abortOnInstall = controller;
    await assert.rejects(
      installInitialSharedCellProvisionAuthority({
        port,
        evidence,
        coordinate,
        signal: controller.signal,
        now: () => now,
      }),
      (error: unknown) =>
        (error as { code?: string; retryable?: boolean }).code ===
          "SHARED_CELL_PROVISION_AUTHORITY_ABORTED_AFTER_WRITE" &&
        (error as { retryable?: boolean }).retryable === true,
    );
  });

  await t.test("abort during final readback validation is uncertain", async () => {
    const controller = new AbortController();
    let stored: SharedCellAuthorityItem | null = null;
    const port: AtomicSharedCellProvisionAuthorityPort = {
      async observe() {
        if (!stored) {
          return {
            authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
            revision: 0,
            item: null,
          };
        }
        const item = stored;
        const delayed = {
          authority_key: item.authority_key,
          schema_version: item.schema_version,
          revision: item.revision,
        } as SharedCellAuthorityItem;
        Object.defineProperty(delayed, "record_json", {
          enumerable: true,
          get() {
            queueMicrotask(() => controller.abort(new Error("lease lost")));
            return item.record_json;
          },
        });
        return {
          authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
          revision: item.revision,
          item: delayed,
        };
      },
      async installIfAbsent(input) {
        stored = input.next;
        return {
          applied: true,
          snapshot: {
            authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
            revision: input.next.revision,
            item: input.next,
          },
        };
      },
    };

    await assert.rejects(
      installInitialSharedCellProvisionAuthority({
        port,
        evidence,
        coordinate,
        signal: controller.signal,
        now: () => now,
      }),
      (error: unknown) =>
        (error as { code?: string; retryable?: boolean }).code ===
          "SHARED_CELL_PROVISION_AUTHORITY_ABORTED_AFTER_WRITE" &&
        (error as { retryable?: boolean }).retryable === true,
    );
  });

  for (const scenario of [
    {
      name: "provider exception after submission",
      configure(port: MemoryProvisionAuthority) {
        port.throwOnInstall = new Error("timeout after possible commit");
      },
      code: "SHARED_CELL_PROVISION_AUTHORITY_WRITE_UNCERTAIN",
    },
    {
      name: "malformed install snapshot",
      configure(port: MemoryProvisionAuthority) {
        port.malformedInstallSnapshot = true;
      },
      code: "SHARED_CELL_PROVISION_AUTHORITY_INSTALL_RESULT_INVALID",
    },
    {
      name: "malformed independent readback",
      configure(port: MemoryProvisionAuthority) {
        port.malformedReadback = true;
      },
      code: "SHARED_CELL_PROVISION_AUTHORITY_READBACK_INVALID_AFTER_WRITE",
    },
  ]) {
    await t.test(scenario.name, async () => {
      const port = new MemoryProvisionAuthority();
      scenario.configure(port);
      await assert.rejects(
        installInitialSharedCellProvisionAuthority({
          port,
          evidence,
          coordinate,
          signal: new AbortController().signal,
          now: () => now,
        }),
        (error: unknown) =>
          (error as { code?: string; retryable?: boolean }).code ===
            scenario.code &&
          (error as { retryable?: boolean }).retryable === true,
      );
    });
  }

  await assert.rejects(
    new DisabledAtomicSharedCellProvisionAuthority().observe({
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_PROVISION_AUTHORITY_INSTALLER_DISABLED",
  );
});

class AuthorityGetCommand {
  readonly kind = "get-item";
  readonly input: Record<string, unknown>;
  constructor(input: Record<string, unknown>) {
    this.input = input;
  }
}

class AuthorityPutCommand {
  readonly kind = "put-item";
  readonly input: Record<string, unknown>;
  constructor(input: Record<string, unknown>) {
    this.input = input;
  }
}

function dynamoProvisionAuthority(
  send: AwsSdkSharedCellProvisionAuthorityDependencies["client"]["send"],
  clock: () => number = () => now,
) {
  return new AwsSdkSharedCellProvisionAuthority(
    { tableArn: SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN },
    {
      client: { send },
      commands: { get: AuthorityGetCommand, put: AuthorityPutCommand },
      now: clock,
    },
  );
}

async function genesisCandidate(ownerDeploymentId = "deployment_cell_owner_1") {
  const evidence = await liveEvidence();
  return compileSharedCellProvisionAuthorityCandidateItem({
    evidence,
    coordinate: { ownerDeploymentId, generation: 1, epoch: 1 },
    revision: 1,
    now,
  });
}

async function genesisCandidateAt(candidateNow: number) {
  const setup = fixture(stackInput(candidateNow - 60_000), {
    clock: [candidateNow, candidateNow],
  });
  const evidence = await setup.adapter.readVerifiedProvisionEvidence({
    environment,
    binding,
    stackInput: setup.input,
    signal: new AbortController().signal,
  });
  return compileSharedCellProvisionAuthorityCandidateItem({
    evidence,
    coordinate: {
      ownerDeploymentId: "deployment_cell_owner_1",
      generation: 1,
      epoch: 1,
    },
    revision: 1,
    now: candidateNow,
  });
}

test("DynamoDB provision adapter performs one absent-only Put and full consistent readbacks", async () => {
  const evidence = await liveEvidence();
  let stored: SharedCellAuthorityItem | null = null;
  const calls: Array<{
    kind: string;
    input: Record<string, unknown>;
    signal: AbortSignal | undefined;
  }> = [];
  const controller = new AbortController();
  const adapter = dynamoProvisionAuthority(async (command, options) => {
    const value = command as {
      kind: string;
      input: Record<string, unknown>;
    };
    calls.push({ kind: value.kind, input: value.input, signal: options?.abortSignal });
    if (value.kind === "put-item") {
      stored = value.input.Item as SharedCellAuthorityItem;
      return {};
    }
    return stored ? { Item: stored } : {};
  });

  const installed = await installInitialSharedCellProvisionAuthority({
    port: adapter,
    evidence,
    coordinate: {
      ownerDeploymentId: "deployment_cell_owner_1",
      generation: 1,
      epoch: 1,
    },
    signal: controller.signal,
    now: () => now,
  });
  assert.deepEqual(
    calls.map((call) => call.kind),
    ["get-item", "put-item", "get-item", "get-item"],
  );
  assert.equal(calls.every((call) => call.signal === controller.signal), true);
  assert.deepEqual(calls[0].input, {
    TableName: SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN,
    Key: { authority_key: SHARED_CELL_CLEANUP_AUTHORITY_KEY },
    ConsistentRead: true,
  });
  assert.deepEqual(calls[1].input, {
    TableName: SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN,
    Item: stored,
    ConditionExpression: "attribute_not_exists(#authorityKey)",
    ExpressionAttributeNames: { "#authorityKey": "authority_key" },
    ReturnValuesOnConditionCheckFailure: "NONE",
  });
  assert.deepEqual(stored, installed);
  assert.deepEqual(Object.keys(stored as object).sort(), [
    "authority_key",
    "record_json",
    "revision",
    "schema_version",
  ]);
});

test("DynamoDB provision adapter rejects invalid capability use before Put", async () => {
  let sends = 0;
  assert.throws(
    () =>
      new AwsSdkSharedCellProvisionAuthority(
        {
          tableArn:
            "arn:aws:dynamodb:ca-central-1:402010193138:table/foreign",
        },
        {
          client: {
            send: async () => {
              sends += 1;
              return {};
            },
          },
          commands: { get: AuthorityGetCommand, put: AuthorityPutCommand },
        },
      ),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_PROVISION_AUTHORITY_CONFIG_INVALID",
  );

  const candidate = await genesisCandidate();
  await assert.rejects(
    dynamoProvisionAuthority(async () => {
      sends += 1;
      return {};
    }).installIfAbsent({
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      next: { ...candidate },
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_PROVISION_AUTHORITY_CANDIDATE_UNVERIFIED",
  );
  assert.equal(sends, 0);
});

test("DynamoDB provision adapter pins one candidate across asynchronous validation", async () => {
  const stale = await genesisCandidateAt(now);
  const freshNow = now + 30_001;
  const fresh = await genesisCandidateAt(freshNow);
  let sends = 0;
  const mutableInput = {
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    next: stale as SharedCellAuthorityItem,
    signal: new AbortController().signal,
  };
  const installing = dynamoProvisionAuthority(async () => {
    sends += 1;
    return {};
  }, () => freshNow).installIfAbsent(mutableInput);
  mutableInput.next = fresh;

  await assert.rejects(
    installing,
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_PROVISION_AUTHORITY_EVIDENCE_STALE",
  );
  assert.equal(sends, 0);
});

test("DynamoDB provision adapter rejects a clock behind candidate compilation", async () => {
  const evidence = await liveEvidence();
  const candidate = await compileSharedCellProvisionAuthorityCandidateItem({
    evidence,
    coordinate: {
      ownerDeploymentId: "deployment_cell_owner_1",
      generation: 1,
      epoch: 1,
    },
    revision: 1,
    now: now + 1_000,
  });
  let sends = 0;
  await assert.rejects(
    dynamoProvisionAuthority(async () => {
      sends += 1;
      return {};
    }, () => now + 500).installIfAbsent({
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      next: candidate,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_PROVISION_AUTHORITY_CLOCK_REGRESSED",
  );
  assert.equal(sends, 0);
});

test("DynamoDB provision adapter returns a fresh winner and never overwrites on conflict", async () => {
  const candidate = await genesisCandidate();
  const winner = await genesisCandidate("another_owner");
  let gets = 0;
  let puts = 0;
  const adapter = dynamoProvisionAuthority(async (command) => {
    if ((command as AuthorityPutCommand).kind === "put-item") {
      puts += 1;
      throw Object.assign(new Error("occupied"), {
        name: "ConditionalCheckFailedException",
      });
    }
    gets += 1;
    return { Item: winner };
  });
  const result = await adapter.installIfAbsent({
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    next: candidate,
    signal: new AbortController().signal,
  });
  assert.equal(result.applied, false);
  assert.deepEqual(result.snapshot.item, winner);
  assert.equal(puts, 1);
  assert.equal(gets, 1);
});

test("DynamoDB provision adapter treats every post-submit uncertainty as retryable", async (t) => {
  await t.test("provider failure is sanitized", async () => {
    const candidate = await genesisCandidate();
    await assert.rejects(
      dynamoProvisionAuthority(async () => {
        throw Object.assign(new Error("secret provider payload"), {
          name: "Timeout Exception!",
        });
      }).installIfAbsent({
        authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
        next: candidate,
        signal: new AbortController().signal,
      }),
      (error: unknown) => {
        const value = error as {
          cause?: unknown;
          code?: string;
          retryable?: boolean;
          message?: string;
        };
        return (
          value.code === "SHARED_CELL_PROVISION_AUTHORITY_WRITE_UNCERTAIN" &&
          value.retryable === true &&
          value.cause === undefined &&
          !String(value.message).includes("secret provider payload")
        );
      },
    );
  });

  await t.test("successful Put with missing readback", async () => {
    const candidate = await genesisCandidate();
    await assert.rejects(
      dynamoProvisionAuthority(async (command) =>
        (command as AuthorityPutCommand).kind === "put-item" ? {} : {},
      ).installIfAbsent({
        authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
        next: candidate,
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        (error as { code?: string; retryable?: boolean }).code ===
          "SHARED_CELL_PROVISION_AUTHORITY_READBACK_MISMATCH" &&
        (error as { retryable?: boolean }).retryable === true,
    );
  });

  await t.test("successful Put with failed readback", async () => {
    const candidate = await genesisCandidate();
    await assert.rejects(
      dynamoProvisionAuthority(async (command) => {
        if ((command as AuthorityPutCommand).kind === "put-item") return {};
        throw new Error("read unavailable");
      }).installIfAbsent({
        authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
        next: candidate,
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        (error as { code?: string; retryable?: boolean }).code ===
          "SHARED_CELL_PROVISION_AUTHORITY_READBACK_FAILED_AFTER_WRITE" &&
        (error as { retryable?: boolean }).retryable === true,
    );
  });

  await t.test("successful Put with a different valid readback", async () => {
    const candidate = await genesisCandidate();
    const winner = await genesisCandidate("another_owner");
    await assert.rejects(
      dynamoProvisionAuthority(async (command) =>
        (command as AuthorityPutCommand).kind === "put-item"
          ? {}
          : { Item: winner },
      ).installIfAbsent({
        authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
        next: candidate,
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        (error as { code?: string; retryable?: boolean }).code ===
          "SHARED_CELL_PROVISION_AUTHORITY_READBACK_MISMATCH" &&
        (error as { retryable?: boolean }).retryable === true,
    );
  });

  for (const item of [
    {
      name: "clock failure after exact readback",
      clock() {
        let calls = 0;
        return () => {
          calls += 1;
          if (calls === 1) return now;
          throw new Error("clock unavailable");
        };
      },
      code: "SHARED_CELL_PROVISION_AUTHORITY_CLOCK_INVALID_AFTER_WRITE",
    },
    {
      name: "clock regression after exact readback",
      clock() {
        const values = [now, now - 1];
        return () => values.shift() as number;
      },
      code: "SHARED_CELL_PROVISION_AUTHORITY_CLOCK_REGRESSED_AFTER_WRITE",
    },
    {
      name: "evidence expiry after exact readback",
      clock() {
        const values = [now, now + 30_001];
        return () => values.shift() as number;
      },
      code: "SHARED_CELL_PROVISION_AUTHORITY_EVIDENCE_STALE_AFTER_WRITE",
    },
  ]) {
    await t.test(item.name, async () => {
      const candidate = await genesisCandidate();
      let stored: SharedCellAuthorityItem | null = null;
      await assert.rejects(
        dynamoProvisionAuthority(async (command) => {
          const value = command as AuthorityPutCommand;
          if (value.kind === "put-item") {
            stored = value.input.Item as SharedCellAuthorityItem;
            return {};
          }
          return { Item: stored };
        }, item.clock()).installIfAbsent({
          authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
          next: candidate,
          signal: new AbortController().signal,
        }),
        (error: unknown) =>
          (error as { code?: string; retryable?: boolean }).code === item.code &&
          (error as { retryable?: boolean }).retryable === true,
      );
    });
  }

  await t.test("abort during strong readback", async () => {
    const candidate = await genesisCandidate();
    const controller = new AbortController();
    let stored: SharedCellAuthorityItem | null = null;
    await assert.rejects(
      dynamoProvisionAuthority(async (command) => {
        const value = command as AuthorityPutCommand;
        if (value.kind === "put-item") {
          stored = value.input.Item as SharedCellAuthorityItem;
          return {};
        }
        controller.abort(new Error("lease lost"));
        return { Item: stored };
      }).installIfAbsent({
        authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
        next: candidate,
        signal: controller.signal,
      }),
      (error: unknown) =>
        (error as { code?: string; retryable?: boolean }).code ===
          "SHARED_CELL_PROVISION_AUTHORITY_ABORTED_AFTER_WRITE" &&
        (error as { retryable?: boolean }).retryable === true,
    );
  });

  await t.test("abort after Put starts", async () => {
    const candidate = await genesisCandidate();
    const controller = new AbortController();
    await assert.rejects(
      dynamoProvisionAuthority(async (command) => {
        if ((command as AuthorityPutCommand).kind === "put-item") {
          controller.abort(new Error("lease lost"));
        }
        return {};
      }).installIfAbsent({
        authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
        next: candidate,
        signal: controller.signal,
      }),
      (error: unknown) =>
        (error as { code?: string; retryable?: boolean }).code ===
          "SHARED_CELL_PROVISION_AUTHORITY_ABORTED_AFTER_WRITE" &&
        (error as { retryable?: boolean }).retryable === true,
    );
  });
});

test("production provision construction shares one lazy identity and performs no AWS call", async () => {
  const configurations: Array<{
    name: string;
    value: Record<string, unknown>;
  }> = [];
  const sends: string[] = [];
  const documentCalls: Array<{
    client: unknown;
    options: Record<string, unknown> | undefined;
  }> = [];
  let providerCalls = 0;
  let credentialOptions: Record<string, unknown> | undefined;
  let mfaPrompts = 0;
  let mfaCode = "123456";
  const credentials = async () => ({
    accessKeyId: "test-only",
    secretAccessKey: "test-only",
  });

  function client(name: string) {
    return class {
      readonly name = name;
      constructor(value: Record<string, unknown>) {
        configurations.push({ name, value });
      }
      async send(): Promise<Record<string, unknown>> {
        sends.push(name);
        return {};
      }
    };
  }
  class FakeCommand {
    readonly input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  const STSClient = client("sts");
  const CloudFormationClient = client("cloudformation");
  const DynamoDBClient = client("dynamodb");
  const documentClient = {
    async send(): Promise<Record<string, unknown>> {
      sends.push("document");
      return {};
    },
  };

  const runtime = createAwsSdkSharedCellProvisionRuntimeFromModules({
    sts: {
      STSClient,
      GetCallerIdentityCommand: FakeCommand,
    },
    cloudFormation: {
      CloudFormationClient,
      DescribeStacksCommand: FakeCommand,
      GetTemplateCommand: FakeCommand,
      ListStackResourcesCommand: FakeCommand,
    },
    dynamo: { DynamoDBClient },
    document: {
      DynamoDBDocumentClient: {
        from(clientValue: unknown, options?: Record<string, unknown>) {
          documentCalls.push({ client: clientValue, options });
          return documentClient;
        },
      },
      GetCommand: FakeCommand,
      PutCommand: FakeCommand,
    },
    credentialProvider: {
      defaultProvider(options: Record<string, unknown>) {
        providerCalls += 1;
        credentialOptions = options;
        return credentials;
      },
    },
  }, {
    mfaCodeProvider: async (serial) => {
      mfaPrompts += 1;
      assert.equal(
        serial,
        "arn:aws:iam::402010193138:mfa/techlong-sandbox-dev",
      );
      return mfaCode;
    },
  });

  assert.equal(Object.isFrozen(runtime), true);
  assert.equal(providerCalls, 1);
  assert.equal(sends.length, 0);
  assert.deepEqual(
    configurations.map(({ name }) => name),
    ["sts", "cloudformation", "dynamodb"],
  );
  for (const { value } of configurations) {
    assert.deepEqual(value, {
      region: "ca-central-1",
      credentials,
      ignoreConfiguredEndpointUrls: true,
    });
  }
  assert.equal(credentialOptions?.profile, "techlong-sandbox-provisioner");
  assert.deepEqual(credentialOptions?.clientConfig, {
    region: "ca-central-1",
    ignoreConfiguredEndpointUrls: true,
  });
  assert.equal(typeof credentialOptions?.mfaCodeProvider, "function");
  assert.equal(mfaPrompts, 0);
  const checkedMfaCodeProvider = credentialOptions?.mfaCodeProvider as (
    serial: string,
  ) => Promise<string>;
  assert.equal(
    await checkedMfaCodeProvider(
      "arn:aws:iam::402010193138:mfa/techlong-sandbox-dev",
    ),
    "123456",
  );
  assert.equal(mfaPrompts, 1);
  mfaCode = "12A456";
  await assert.rejects(
    checkedMfaCodeProvider(
      "arn:aws:iam::402010193138:mfa/techlong-sandbox-dev",
    ),
    /MFA code is invalid/,
  );
  assert.equal(mfaPrompts, 2);
  await assert.rejects(
    checkedMfaCodeProvider(
      "arn:aws:iam::402010193138:mfa/not-the-reviewed-device",
    ),
    /outside the allowlist/,
  );
  assert.equal(mfaPrompts, 2);
  assert.equal(documentCalls.length, 1);
  assert.equal(documentCalls[0].client instanceof DynamoDBClient, true);
  assert.deepEqual(documentCalls[0].options, {
    marshallOptions: {
      removeUndefinedValues: false,
      convertClassInstanceToMap: false,
    },
  });
  assert.ok(runtime.evidence instanceof AwsSdkSharedCellProvisionEvidenceAdapter);
  assert.ok(runtime.authority instanceof AwsSdkSharedCellProvisionAuthority);
  assert.deepEqual(Object.getOwnPropertyNames(runtime.authority), []);
});

test("production provision construction rejects malformed MFA input before provider use", () => {
  let providerCalls = 0;
  assert.throws(
    () =>
      createAwsSdkSharedCellProvisionRuntimeFromModules(
        {
          sts: {},
          cloudFormation: {},
          dynamo: {},
          document: {},
          credentialProvider: {
            defaultProvider() {
              providerCalls += 1;
              return async () => ({});
            },
          },
        },
        {
          mfaCodeProvider: async () => "123456",
          unexpected: true,
        } as unknown as { mfaCodeProvider: () => Promise<string> },
      ),
    /MFA provider input is invalid/,
  );
  assert.equal(providerCalls, 0);
});

test("installed AWS SDK modules construct the dormant provision bundle", async () => {
  let mfaPrompts = 0;
  const runtime = await createAwsSdkSharedCellProvisionRuntime({
    mfaCodeProvider: async () => {
      mfaPrompts += 1;
      return "123456";
    },
  });
  assert.equal(Object.isFrozen(runtime), true);
  assert.equal(mfaPrompts, 0);
  assert.ok(runtime.evidence instanceof AwsSdkSharedCellProvisionEvidenceAdapter);
  assert.ok(runtime.authority instanceof AwsSdkSharedCellProvisionAuthority);
});
