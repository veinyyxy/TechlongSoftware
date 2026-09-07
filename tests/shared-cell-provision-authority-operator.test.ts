import assert from "node:assert/strict";
import test from "node:test";
import type { AwsSandboxSharedCellStackInput } from "../lib/deployments/cloudformation/shared-cell-stack.ts";
import { renderAwsSandboxSharedCellStack } from "../lib/deployments/cloudformation/shared-cell-stack.ts";
import type { DeploymentEnvironment } from "../lib/deployments/environment.ts";
import type { DeploymentExecutionBinding } from "../lib/deployments/execution/contracts.ts";
import {
  executeReviewedSharedCellProvisionAuthorityInstall,
  inspectSharedCellProvisionAuthorityCandidate,
  recoverReviewedSharedCellProvisionAuthorityInstall,
  type SharedCellProvisionAuthorityOperatorManifest,
} from "../lib/deployments/execution/shared-cell-provision-authority-operator.ts";
import {
  SHARED_CELL_CLEANUP_AUTHORITY_KEY,
  type SharedCellAuthorityItem,
} from "../lib/deployments/execution/shared-cell-cleanup-authority.ts";
import type {
  AtomicSharedCellProvisionAuthorityPort,
  SharedCellProvisionAuthoritySnapshot,
} from "../lib/deployments/execution/shared-cell-provision-authority.ts";
import {
  AwsSdkSharedCellProvisionEvidenceAdapter,
  type AwsSdkSharedCellProvisionEvidenceDependencies,
} from "../lib/deployments/execution/shared-cell-provision-evidence.ts";

const now = Date.UTC(2026, 8, 6, 12, 0, 0);
const accountId = "402010193138";
const region = "ca-central-1";
const stackName = "techlong-sandbox-cell-sandbox-1";
const stackUuid = "12345678-1234-1234-1234-123456789012";
const cloudFormationRoleArn =
  "arn:aws:iam::402010193138:role/TechlongSandboxCloudFormationExecutionRole";

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
    "arn:aws:iam::402010193138:role/TechlongSandboxProvisionerRole",
  cloudFormationRoleArn,
  tenantStackParameters: {
    ClusterName: "cell-sandbox-1",
    VpcId: "vpc-0123456789abcdef0",
    SubnetIds: "subnet-0123456789abcdef0,subnet-0123456789abcdef1",
    TaskSecurityGroupId: "sg-0123456789abcdef0",
    OneShotTaskSecurityGroupId: "sg-0123456789abcdef1",
    HttpsListenerArn:
      "arn:aws:elasticloadbalancing:ca-central-1:402010193138:listener/app/" +
      "techlong-sandbox-cell/0123456789abcdef/0123456789abcdef",
    ControlListenerArn:
      "arn:aws:elasticloadbalancing:ca-central-1:402010193138:listener/app/" +
      "techlong-sandbox-cell/0123456789abcdef/fedcba9876543210",
  },
  status: "active",
};

function stackInput(): AwsSandboxSharedCellStackInput {
  return {
    environment,
    requestedAt: now - 60_000,
    availabilityZones: ["ca-central-1a", "ca-central-1b"],
    certificateArn:
      "arn:aws:acm:ca-central-1:402010193138:certificate/" +
      "12345678-1234-1234-1234-123456789012",
    controlTrustStoreArn:
      "arn:aws:elasticloadbalancing:ca-central-1:402010193138:" +
      "truststore/techlong-sandbox-control/0123456789abcdef",
    cellJanitorFunctionArn:
      "arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-janitor",
    cellSchedulerInvokeRoleArn:
      "arn:aws:iam::402010193138:role/TechlongSandboxCellSchedulerInvokeRole",
    cellSchedulerGroupName: "techlong-sandbox-cell",
  };
}

function manifest(): SharedCellProvisionAuthorityOperatorManifest {
  const input = stackInput();
  return {
    environment,
    binding,
    stackInput: input,
    coordinate: {
      ownerDeploymentId: "deployment_cell_owner_1",
      generation: 1,
      epoch: 1,
    },
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

function liveEvidence(input: {
  stackUuid?: string;
  physicalSuffix?: string;
  observedAt?: number;
} = {}) {
  const stack = stackInput();
  const plan = renderAwsSandboxSharedCellStack(stack);
  const selectedStackId =
    `arn:aws:cloudformation:${region}:${accountId}:stack/${stackName}/` +
    (input.stackUuid ?? stackUuid);
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
    DatabaseEndpoint:
      `${stackName}.cluster-abcdefghijkl.${region}.rds.amazonaws.com`,
    DatabaseMasterSecretArn:
      `arn:aws:secretsmanager:${region}:${accountId}:secret:` +
      "rds!cluster-01234567-89ab-cdef-0123-456789abcdef-ABCDEF",
    CellExpiresAt: plan.tags.ExpiresAt,
  };
  const stackDescription = {
    StackId: selectedStackId,
    StackName: stackName,
    StackStatus: "CREATE_COMPLETE",
    RoleARN: cloudFormationRoleArn,
    EnableTerminationProtection: false,
    CreationTime: new Date(stack.requestedAt + 1_000),
    Tags: Object.entries(plan.tags).map(([Key, Value]) => ({ Key, Value })),
    Parameters: Object.entries(plan.parameters).map(
      ([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue }),
    ),
    Outputs: Object.entries(outputs).map(([OutputKey, OutputValue]) => ({
      OutputKey,
      OutputValue,
    })),
  };
  const resources = Object.entries(
    plan.template.Resources as Record<string, { Type: string }>,
  ).map(([LogicalResourceId, resource]) => ({
    LogicalResourceId,
    PhysicalResourceId:
      `physical-${LogicalResourceId}${input.physicalSuffix ?? ""}`,
    ResourceStatus: "CREATE_COMPLETE",
    ResourceType: resource.Type,
  }));
  let calls = 0;
  const client = {
    async send(value: unknown): Promise<Record<string, unknown>> {
      calls += 1;
      const request = value as { kind: string; input: Record<string, unknown> };
      switch (request.kind) {
        case "GetCallerIdentity":
          return {
            Account: accountId,
            Arn:
              "arn:aws:sts::402010193138:assumed-role/" +
              "TechlongSandboxProvisionerRole/techlong-sandbox-provisioner",
          };
        case "DescribeStacks":
          return { Stacks: [{ ...stackDescription }] };
        case "GetTemplate":
          return { TemplateBody: plan.template };
        case "ListStackResources":
          return { StackResourceSummaries: resources };
        default:
          throw new Error(`unexpected evidence command ${request.kind}`);
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
    now: () => input.observedAt ?? now,
  };
  return {
    port: new AwsSdkSharedCellProvisionEvidenceAdapter(region, dependencies),
    calls: () => calls,
  };
}

class MemoryAuthority implements AtomicSharedCellProvisionAuthorityPort {
  item: SharedCellAuthorityItem | null = null;
  observeCalls = 0;
  installCalls = 0;
  throwAfterStore = false;

  async observe(): Promise<SharedCellProvisionAuthoritySnapshot> {
    this.observeCalls += 1;
    return this.item
      ? {
          authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
          revision: this.item.revision,
          item: this.item,
        }
      : {
          authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
          revision: 0,
          item: null,
        };
  }

  async installIfAbsent(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    next: SharedCellAuthorityItem;
    signal: AbortSignal;
  }): Promise<{
    applied: boolean;
    snapshot: SharedCellProvisionAuthoritySnapshot;
  }> {
    this.installCalls += 1;
    if (this.item) {
      return {
        applied: false,
        snapshot: {
          authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
          revision: this.item.revision,
          item: this.item,
        },
      };
    }
    this.item = input.next;
    if (this.throwAfterStore) throw new Error("timeout after possible commit");
    return {
      applied: true,
      snapshot: {
        authorityKey: input.authorityKey,
        revision: input.next.revision,
        item: input.next,
      },
    };
  }
}

test("J5f inspect is read-only, absent-only and emits a stable canonical candidate digest", async () => {
  const authority = new MemoryAuthority();
  const firstEvidence = liveEvidence();
  const first = await inspectSharedCellProvisionAuthorityCandidate({
    evidence: firstEvidence.port,
    authority,
    manifest: manifest(),
    signal: new AbortController().signal,
    now: () => now,
  });
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.phase, "INSPECTED");
  assert.equal(first.mutationPerformed, false);
  assert.equal(first.generation, 1);
  assert.equal(first.provisionEpoch, 1);
  assert.equal(first.revision, 1);
  assert.match(first.candidateItemSha256, /^[a-f0-9]{64}$/);
  assert.match(first.recordHash, /^[a-f0-9]{64}$/);
  assert.equal(authority.observeCalls, 2);
  assert.equal(authority.installCalls, 0);
  assert.equal(firstEvidence.calls(), 5);

  const repeated = await inspectSharedCellProvisionAuthorityCandidate({
    evidence: liveEvidence({ observedAt: now + 1_000 }).port,
    authority,
    manifest: manifest(),
    signal: new AbortController().signal,
    now: () => now + 1_000,
  });
  assert.equal(repeated.candidateItemSha256, first.candidateItemSha256);
  assert.equal(repeated.recordHash, first.recordHash);
  assert.notEqual(repeated.evidenceObservedAt, first.evidenceObservedAt);
  assert.equal(authority.installCalls, 0);
});

test("J5f execute recompiles fresh evidence, installs once, and recover is strictly read-only", async () => {
  const authority = new MemoryAuthority();
  const inspected = await inspectSharedCellProvisionAuthorityCandidate({
    evidence: liveEvidence().port,
    authority,
    manifest: manifest(),
    signal: new AbortController().signal,
    now: () => now,
  });
  const installed = await executeReviewedSharedCellProvisionAuthorityInstall({
    evidence: liveEvidence({ observedAt: now + 2_000 }).port,
    authority,
    manifest: manifest(),
    approvedCandidateItemSha256: inspected.candidateItemSha256,
    signal: new AbortController().signal,
    now: () => now + 2_000,
  });
  assert.equal(installed.phase, "INSTALLED");
  assert.equal(installed.mutationPerformed, true);
  assert.equal(installed.candidateItemSha256, inspected.candidateItemSha256);
  assert.equal(authority.installCalls, 1);

  const readsBeforeRecovery = authority.observeCalls;
  const recovered = await recoverReviewedSharedCellProvisionAuthorityInstall({
    authority,
    approvedCandidateItemSha256: inspected.candidateItemSha256,
    expectedOwnerDeploymentId: "deployment_cell_owner_1",
    signal: new AbortController().signal,
  });
  assert.equal(recovered.phase, "RECOVERED");
  assert.equal(recovered.mutationPerformed, false);
  assert.equal(recovered.evidenceObservedAt, null);
  assert.equal(recovered.candidateItemSha256, inspected.candidateItemSha256);
  assert.equal(authority.observeCalls, readsBeforeRecovery + 1);
  assert.equal(authority.installCalls, 1);
});

test("J5f execute rejects unreviewed or drifting candidates before Put", async (t) => {
  await t.test("malformed approval makes no authority or evidence call", async () => {
    const authority = new MemoryAuthority();
    const evidence = liveEvidence();
    await assert.rejects(
      executeReviewedSharedCellProvisionAuthorityInstall({
        evidence: evidence.port,
        authority,
        manifest: manifest(),
        approvedCandidateItemSha256: "NOT-A-DIGEST",
        signal: new AbortController().signal,
        now: () => now,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_PROVISION_OPERATOR_DIGEST_INVALID",
    );
    assert.equal(authority.observeCalls, 0);
    assert.equal(authority.installCalls, 0);
    assert.equal(evidence.calls(), 0);
  });

  const reviewedAuthority = new MemoryAuthority();
  const reviewed = await inspectSharedCellProvisionAuthorityCandidate({
    evidence: liveEvidence().port,
    authority: reviewedAuthority,
    manifest: manifest(),
    signal: new AbortController().signal,
    now: () => now,
  });

  await t.test("wrong digest performs no Put", async () => {
    const authority = new MemoryAuthority();
    const wrong = `${reviewed.candidateItemSha256.slice(0, -1)}${
      reviewed.candidateItemSha256.endsWith("0") ? "1" : "0"
    }`;
    await assert.rejects(
      executeReviewedSharedCellProvisionAuthorityInstall({
        evidence: liveEvidence().port,
        authority,
        manifest: manifest(),
        approvedCandidateItemSha256: wrong,
        signal: new AbortController().signal,
        now: () => now,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_PROVISION_OPERATOR_CANDIDATE_MISMATCH",
    );
    assert.equal(authority.installCalls, 0);
  });

  await t.test("fresh Stack identity drift performs no Put", async () => {
    const authority = new MemoryAuthority();
    await assert.rejects(
      executeReviewedSharedCellProvisionAuthorityInstall({
        evidence: liveEvidence({
          stackUuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        }).port,
        authority,
        manifest: manifest(),
        approvedCandidateItemSha256: reviewed.candidateItemSha256,
        signal: new AbortController().signal,
        now: () => now,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_PROVISION_OPERATOR_CANDIDATE_MISMATCH",
    );
    assert.equal(authority.installCalls, 0);
  });

  await t.test("inventory drift performs no Put", async () => {
    const authority = new MemoryAuthority();
    await assert.rejects(
      executeReviewedSharedCellProvisionAuthorityInstall({
        evidence: liveEvidence({ physicalSuffix: "-replacement" }).port,
        authority,
        manifest: manifest(),
        approvedCandidateItemSha256: reviewed.candidateItemSha256,
        signal: new AbortController().signal,
        now: () => now,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_PROVISION_OPERATOR_CANDIDATE_MISMATCH",
    );
    assert.equal(authority.installCalls, 0);
  });
});

test("J5f lineage gates reject non-genesis and direct execute replay", async () => {
  const invalidManifest = manifest();
  invalidManifest.coordinate.generation = 2;
  const authority = new MemoryAuthority();
  const evidence = liveEvidence();
  await assert.rejects(
    inspectSharedCellProvisionAuthorityCandidate({
      evidence: evidence.port,
      authority,
      manifest: invalidManifest,
      signal: new AbortController().signal,
      now: () => now,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_PROVISION_OPERATOR_MANIFEST_INVALID",
  );
  assert.equal(authority.observeCalls, 0);
  assert.equal(evidence.calls(), 0);

  const cleanManifest = manifest();
  const reviewed = await inspectSharedCellProvisionAuthorityCandidate({
    evidence: liveEvidence().port,
    authority,
    manifest: cleanManifest,
    signal: new AbortController().signal,
    now: () => now,
  });
  await executeReviewedSharedCellProvisionAuthorityInstall({
    evidence: liveEvidence().port,
    authority,
    manifest: cleanManifest,
    approvedCandidateItemSha256: reviewed.candidateItemSha256,
    signal: new AbortController().signal,
    now: () => now,
  });
  const writes = authority.installCalls;
  await assert.rejects(
    executeReviewedSharedCellProvisionAuthorityInstall({
      evidence: liveEvidence().port,
      authority,
      manifest: cleanManifest,
      approvedCandidateItemSha256: reviewed.candidateItemSha256,
      signal: new AbortController().signal,
      now: () => now,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_PROVISION_OPERATOR_EXECUTE_ALREADY_PRESENT",
  );
  assert.equal(authority.installCalls, writes);
});

test("J5f uncertain execute is never success and can be resolved only by exact read recovery", async () => {
  const authority = new MemoryAuthority();
  const reviewed = await inspectSharedCellProvisionAuthorityCandidate({
    evidence: liveEvidence().port,
    authority,
    manifest: manifest(),
    signal: new AbortController().signal,
    now: () => now,
  });
  authority.throwAfterStore = true;
  await assert.rejects(
    executeReviewedSharedCellProvisionAuthorityInstall({
      evidence: liveEvidence().port,
      authority,
      manifest: manifest(),
      approvedCandidateItemSha256: reviewed.candidateItemSha256,
      signal: new AbortController().signal,
      now: () => now,
    }),
    (error: unknown) =>
      (error as { code?: string; retryable?: boolean }).code ===
        "SHARED_CELL_PROVISION_AUTHORITY_WRITE_UNCERTAIN" &&
      (error as { retryable?: boolean }).retryable === true,
  );
  assert.equal(authority.installCalls, 1);

  await assert.rejects(
    recoverReviewedSharedCellProvisionAuthorityInstall({
      authority,
      approvedCandidateItemSha256:
        "0000000000000000000000000000000000000000000000000000000000000000",
      expectedOwnerDeploymentId: "deployment_cell_owner_1",
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_PROVISION_OPERATOR_RECOVERY_DIGEST_MISMATCH",
  );
  const recovered = await recoverReviewedSharedCellProvisionAuthorityInstall({
    authority,
    approvedCandidateItemSha256: reviewed.candidateItemSha256,
    expectedOwnerDeploymentId: "deployment_cell_owner_1",
    signal: new AbortController().signal,
  });
  assert.equal(recovered.phase, "RECOVERED");
  assert.equal(recovered.mutationPerformed, false);
  assert.equal(authority.installCalls, 1);
});

test("J5f recovery rejects absence and owner drift without any Put", async () => {
  const authority = new MemoryAuthority();
  await assert.rejects(
    recoverReviewedSharedCellProvisionAuthorityInstall({
      authority,
      approvedCandidateItemSha256:
        "0000000000000000000000000000000000000000000000000000000000000000",
      expectedOwnerDeploymentId: "deployment_cell_owner_1",
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_PROVISION_OPERATOR_RECOVERY_ABSENT",
  );
  assert.equal(authority.installCalls, 0);
});

test("J5f rejects non-text owner identifiers before every provider call", async () => {
  const inspectAuthority = new MemoryAuthority();
  const evidence = liveEvidence();
  const invalidManifest = manifest() as unknown as {
    coordinate: { ownerDeploymentId: unknown };
  };
  invalidManifest.coordinate.ownerDeploymentId = 123;
  await assert.rejects(
    inspectSharedCellProvisionAuthorityCandidate({
      evidence: evidence.port,
      authority: inspectAuthority,
      manifest:
        invalidManifest as unknown as SharedCellProvisionAuthorityOperatorManifest,
      signal: new AbortController().signal,
      now: () => now,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_PROVISION_OPERATOR_MANIFEST_INVALID",
  );
  assert.equal(evidence.calls(), 0);
  assert.equal(inspectAuthority.observeCalls, 0);
  assert.equal(inspectAuthority.installCalls, 0);

  const recoverAuthority = new MemoryAuthority();
  await assert.rejects(
    recoverReviewedSharedCellProvisionAuthorityInstall({
      authority: recoverAuthority,
      approvedCandidateItemSha256:
        "0000000000000000000000000000000000000000000000000000000000000000",
      expectedOwnerDeploymentId: 123 as unknown as string,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_PROVISION_OPERATOR_OWNER_INVALID",
  );
  assert.equal(recoverAuthority.observeCalls, 0);
  assert.equal(recoverAuthority.installCalls, 0);
});
