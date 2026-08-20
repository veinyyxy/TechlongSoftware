import assert from "node:assert/strict";
import test from "node:test";
import {
  AwsSdkDeploymentAdapter,
  createAwsSdkDeploymentAdapter,
} from "../lib/deployments/execution/aws-sdk-adapter.ts";
import { EmbeddedCloudFormationCleanupSchedule } from "../lib/deployments/execution/cleanup.ts";
import { MtlsSaaSControlClient } from "../lib/deployments/execution/control-client.ts";
import type {
  ApplyReadyTenantStack,
  ClaimedDeploymentJob,
  DeploymentExecutionContext,
  DeploymentExecutionRepository,
  DeploymentTenantResourceRecord,
  TenantExternalOperationFence,
  TenantResourceFence,
} from "../lib/deployments/execution/contracts.ts";
import {
  AWS_SANDBOX_CONFIRMATION_PHRASE,
  type DeploymentWorkerRuntimeConfig,
} from "../lib/deployments/execution/gates.ts";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { finalizeTenantStackForApply } from "../lib/deployments/execution/parameters.ts";
import { assertSharedCellSecurityObservation } from "../lib/deployments/execution/shared-cell-preflight.ts";
import {
  deriveTenantOwnershipMarker,
  deriveTenantResourceIdentity,
  deriveTenantRuntimeSecretName,
} from "../lib/deployments/execution/tenant-database.ts";
import {
  runDeploymentWorkerOnce,
  type DeploymentWorkerDependencies,
} from "../lib/deployments/execution/worker.ts";
import {
  awsSandboxTenantStackName,
  renderAwsSandboxTenantStack,
} from "../lib/deployments/cloudformation/tenant-stack.ts";
import { AwsEcsCellPlanOnlyDriver } from "../lib/deployments/drivers/aws-ecs-cell.ts";
import type { DeploymentEnvironment } from "../lib/deployments/environment.ts";

const now = Date.UTC(2026, 7, 9);
const workerRoleArn =
  "arn:aws:iam::402010193138:role/TechlongSandboxProvisionerRole";
const cloudFormationRoleArn =
  "arn:aws:iam::402010193138:role/TechlongSandboxCloudFormationExecutionRole";
const tenantRuntimeSecretName =
  "techlong/sandbox/tenant/apptenantone_04d32d8f09/runtime/g1";
const tenantRuntimeSecretRef =
  "arn:aws:secretsmanager:ca-central-1:402010193138:secret:" +
  `${tenantRuntimeSecretName}-abcdef`;
const signal = () => new AbortController().signal;

function stackExternalOperation(
  deploymentId = "dep_tenant_one",
  generation = 1,
  epoch = 1,
) {
  return {
    epoch,
    intent: "provision" as const,
    ownerDeploymentId: deploymentId,
    operationHash: "9".repeat(64),
    marker: `tl_epoch_${"8".repeat(24)}_g${generation}_e${epoch}`,
    state: "active" as const,
  };
}

test("loads the AWS SDK clients required by the standalone worker", async () => {
  const [{ STSClient }, { CloudFormationClient }] = await Promise.all([
    import("@aws-sdk/client-sts"),
    import("@aws-sdk/client-cloudformation"),
  ]);

  assert.equal(typeof STSClient, "function");
  assert.equal(typeof CloudFormationClient, "function");
});

const environment: DeploymentEnvironment = {
  id: "env_aws_sandbox_ca_central_1",
  key: "aws-sandbox-ca-central-1",
  name: "AWS Sandbox ca-central-1",
  kind: "aws_sandbox",
  driver: "aws_ecs_cell",
  expectedAccountId: "402010193138",
  region: "ca-central-1",
  cellKey: "cell-sandbox-1",
  baseDomain: "sandbox.techlong.cloud",
  applyEnabled: true,
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

function externalParameters(): Record<string, string> {
  const account = environment.expectedAccountId;
  const region = environment.region;
  const secret = (name: string) =>
    `arn:aws:secretsmanager:${region}:${account}:secret:techlong/sandbox/${name}-abcdef`;
  return {
    ClusterName: "cell-sandbox-1",
    VpcId: "vpc-0123456789abcdef0",
    SubnetIds: "subnet-0123456789abcdef0,subnet-0123456789abcdef1",
    TaskSecurityGroupId: "sg-0123456789abcdef0",
    HttpsListenerArn: `arn:aws:elasticloadbalancing:${region}:${account}:listener/app/techlong-sandbox-cell/0123456789abcdef/0123456789abcdef`,
    ControlListenerArn: `arn:aws:elasticloadbalancing:${region}:${account}:listener/app/techlong-sandbox-cell/0123456789abcdef/fedcba9876543210`,
    TaskExecutionRoleArn: `arn:aws:iam::${account}:role/TechlongSandboxTaskExecutionRole`,
    TaskRoleArn: `arn:aws:iam::${account}:role/TechlongSandboxTaskRole`,
    ControlPublicKeyValueFrom: secret("control-public-key"),
    ControlIssuer: "https://console.techlong.cloud",
    CorsAllowedOrigins: "https://tenant-one.sandbox.techlong.cloud",
    StripePublishableKey: `pk_test_${"a".repeat(24)}`,
    StripeSuccessUrl: "https://console.techlong.cloud/dashboard/billing/success",
    StripeCancelUrl: "https://console.techlong.cloud/dashboard/billing/canceled",
    ImageS3Bucket: "techlong-sandbox-images",
    ImagePublicBaseUrl: "https://downloads.techlong.cloud",
    JanitorFunctionArn: `arn:aws:lambda:${region}:${account}:function:techlong-sandbox-janitor`,
    SchedulerInvokeRoleArn: `arn:aws:iam::${account}:role/TechlongSandboxSchedulerInvokeRole`,
    SchedulerGroupName: "techlong-sandbox",
  };
}

async function executionFixture(): Promise<{
  context: DeploymentExecutionContext;
  stack: ApplyReadyTenantStack;
}> {
  const configurationSnapshot = { store_name: "Tenant One" };
  const plan = new AwsEcsCellPlanOnlyDriver({
    region: environment.region,
    cellKey: environment.cellKey,
    mode: "aws_sandbox",
  }).buildPlan({
    appInstanceId: "app_tenant_one",
    workspaceId: "wsp_one",
    productId: "prd_restaurant_order_system",
    planId: "plan_basic",
    subscriptionId: "sub_one",
    tenantKey: "tenant_one",
    deploymentProfileKey: "standard-v1",
  });
  const planHash = await sha256Hex(canonicalJson(plan));
  const configurationHash = await sha256Hex(canonicalJson(configurationSnapshot));
  const job: ClaimedDeploymentJob = {
    id: "job_tenant_one",
    deploymentId: "dep_tenant_one",
    jobType: "apply",
    payload: {
      schemaVersion: 1,
      deploymentId: "dep_tenant_one",
      planHash,
    },
    attempt: 1,
    maxAttempts: 5,
    leaseExpiresAt: now + 120_000,
    leaseToken: "lease_00000000000000000000000000000001",
  };
  const context: DeploymentExecutionContext = {
    job,
    deployment: {
      id: "dep_tenant_one",
      appInstanceId: "app_tenant_one",
      environmentId: environment.id,
      status: "planned",
      planHash,
      configurationHash,
      artifactRef: `402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:${"a".repeat(64)}`,
      desiredPlan: plan,
      createdAt: now,
    },
    environment,
    binding: {
      environmentId: environment.id,
      workerRoleArn,
      cloudFormationRoleArn,
      tenantStackParameters: externalParameters(),
      status: "active",
    },
    cleanupSchedule: null,
    workspace: { id: "wsp_one", status: "active" },
    subscription: { id: "sub_one", status: "active" },
    appInstance: {
      id: "app_tenant_one",
      workspaceId: "wsp_one",
      productId: "prd_restaurant_order_system",
      subscriptionId: "sub_one",
      templateVersionId: "tplver_restaurant_v2",
      status: "pending",
      slug: "tenant-one",
      tenantKey: "tenant_one",
      configurationSnapshot,
    },
    tenantResources: null,
    tenantExternalOperation: null,
    activeCellCount: 1,
    activeTenantCount: 0,
  };
  const rendered = renderAwsSandboxTenantStack({
    deploymentId: context.deployment.id,
    resourceGeneration: 1,
    externalOperation: stackExternalOperation(context.deployment.id),
    runtimeSecretRef: tenantRuntimeSecretRef,
    runtimeSecretName: tenantRuntimeSecretName,
    plan,
    environment,
    imageUri: context.deployment.artifactRef,
    tenantHostname: "tenant-one.sandbox.techlong.cloud",
    listenerPriority: 100,
    activeCellCount: 1,
    activeTenantCount: 0,
    requestedAt: now,
  });
  const stack = finalizeTenantStackForApply({
    rendered,
    environment,
    binding: context.binding!,
    expectedRuntimeSecretName: tenantRuntimeSecretName,
  });
  return { context, stack };
}

async function attachTenantResource(
  context: DeploymentExecutionContext,
  input: {
    ownerDeploymentId?: string;
    generation?: number;
    lifecycleStatus?: DeploymentTenantResourceRecord["lifecycleStatus"];
  } = {},
): Promise<DeploymentTenantResourceRecord> {
  const identity = await deriveTenantResourceIdentity(context);
  const generation = input.generation ?? 1;
  const record: DeploymentTenantResourceRecord = {
    identity,
    generation,
    ownershipMarker: deriveTenantOwnershipMarker(identity, generation),
    createdByDeploymentId: context.deployment.id,
    ownerDeploymentId: input.ownerDeploymentId ?? context.deployment.id,
    runtimeSecretRef: null,
    lifecycleStatus: input.lifecycleStatus ?? "planned",
    baselineDigest: null,
    migrationContract: null,
    evidenceHash: null,
    evidence: {},
    lastError: null,
    createdAt: now,
    updatedAt: now,
    destroyedAt:
      input.lifecycleStatus === "destroyed" ? now : null,
  };
  context.tenantResources = record;
  context.tenantExternalOperation = ["cleanup", "rollback"].includes(
    context.job.jobType,
  )
    ? activeCleanupExternalFence(fenceOf(record))
    : activeProvisionExternalFence(fenceOf(record));
  return record;
}

async function expiredCleanupContext(): Promise<DeploymentExecutionContext> {
  const { context } = await executionFixture();
  context.job.jobType = "cleanup";
  context.deployment.status = "ready";
  context.deployment.createdAt =
    now - context.environment.policy.ttlSeconds * 1_000;
  context.appInstance.status = "active";
  context.environment = {
    ...context.environment,
    applyEnabled: false,
    status: "inactive",
  };
  context.binding = { ...context.binding!, status: "inactive" };
  context.subscription = { id: "sub_one", status: "canceled" };
  await attachTenantResource(context);
  context.cleanupSchedule = {
    id: "clean_expired",
    deploymentId: context.deployment.id,
    status: "confirmed",
    expiresAt: now,
    providerScheduleRef:
      `cloudformation:${awsSandboxTenantStackName(context.appInstance.id)}:TenantCleanupSchedule`,
    confirmedAt: now - 1_000,
  };
  return context;
}

function fenceOf(record: DeploymentTenantResourceRecord): TenantResourceFence {
  return {
    schemaVersion: 1,
    identity: record.identity,
    generation: record.generation,
    ownerDeploymentId: record.ownerDeploymentId,
    ownershipMarker: record.ownershipMarker,
  };
}

function activeCleanupExternalFence(
  resourceFence: TenantResourceFence,
): TenantExternalOperationFence {
  return {
    schemaVersion: 1,
    resourceFence,
    epoch: 2,
    intent: "cleanup",
    ownerDeploymentId: resourceFence.ownerDeploymentId,
    operationHash: "f".repeat(64),
    marker:
      `tl_epoch_${resourceFence.identity.stableIdentityHash.slice(0, 24)}` +
      `_g${resourceFence.generation}_e2`,
    state: "active",
  };
}

function activeProvisionExternalFence(
  resourceFence: TenantResourceFence,
): TenantExternalOperationFence {
  return {
    ...activeCleanupExternalFence(resourceFence),
    epoch: 1,
    intent: "provision",
    marker:
      `tl_epoch_${resourceFence.identity.stableIdentityHash.slice(0, 24)}` +
      `_g${resourceFence.generation}_e1`,
  };
}

function readyExternalOperationCoordinator() {
  return {
    prepareAndActivate: async (input: {
      intent: "provision" | "cleanup";
      context: DeploymentExecutionContext;
      resourceFence: TenantResourceFence;
      signal: AbortSignal;
    }) => {
      input.signal.throwIfAborted();
      const active =
        input.intent === "cleanup"
          ? activeCleanupExternalFence(input.resourceFence)
          : activeProvisionExternalFence(input.resourceFence);
      input.context.tenantExternalOperation = active;
      return active;
    },
  };
}

function tenantLifecycleOutput(
  context: DeploymentExecutionContext,
  lifecycleState: "empty" | "baseline_restored" | "saas_migrated" | "verified",
): Record<string, unknown> {
  const fence = fenceOf(context.tenantResources!);
  const externalFence =
    context.tenantExternalOperation ?? activeProvisionExternalFence(fence);
  const hasBaseline = lifecycleState !== "empty";
  const hasMigration =
    lifecycleState === "saas_migrated" || lifecycleState === "verified";
  return {
    externalEpoch: externalFence.epoch,
    externalMarker: externalFence.marker,
    externalOperationHash: externalFence.operationHash,
    databaseName: fence.identity.databaseName,
    roleName: fence.identity.roleName,
    ownershipMarker: fence.ownershipMarker,
    resourceGeneration: fence.generation,
    resourceOwnerDeploymentId: fence.ownerDeploymentId,
    secretRef:
      `arn:aws:secretsmanager:${context.environment.region}:` +
      `${context.environment.expectedAccountId}:secret:${deriveTenantRuntimeSecretName(fence)}-abcdef`,
    lifecycleState,
    baselineDigest: hasBaseline ? "b".repeat(64) : null,
    migrationContract: hasMigration ? "speedfeast-saas-control-v1" : null,
    evidenceHash: "e".repeat(64),
  };
}

const enabledConfig: DeploymentWorkerRuntimeConfig = {
  workerEnabled: true,
  applyEnabled: true,
  environmentKey: environment.key,
  expectedAccountId: environment.expectedAccountId,
  expectedRegion: environment.region,
  workerRoleArn,
  confirmation: AWS_SANDBOX_CONFIRMATION_PHRASE,
  leaseDurationMs: 120_000,
  pollIntervalMs: 10_000,
};

function inMemoryRepository(input: {
  context: DeploymentExecutionContext;
  transitions?: string[];
  reserveCapacity?: () => boolean;
  onMarkReady?: () => void;
  onMarkUnavailable?: () => void;
  onEnqueue?: (jobType: string) => void;
}): DeploymentExecutionRepository {
  return {
    claimNext: async () => input.context.job,
    loadContext: async () => input.context,
    reserveEnvironmentCapacity: async () => input.reserveCapacity?.() ?? true,
    confirmCleanupSchedule: async (scheduleInput) => {
      const schedule = {
        id: "clean_one",
        deploymentId: scheduleInput.lease.deploymentId,
        status: "confirmed" as const,
        expiresAt: scheduleInput.expiresAt,
        providerScheduleRef: scheduleInput.providerScheduleRef,
        confirmedAt: scheduleInput.confirmedAt,
      };
      input.context.cleanupSchedule = schedule;
      return schedule;
    },
    heartbeat: async () => true,
    transitionDeployment: async (transition) => {
      input.transitions?.push(transition.to);
      input.context.deployment.status = transition.to;
      return true;
    },
    beginStep: async (step) => ({
      id: `step_${step.stepKey}`,
      alreadySucceeded: false,
      previousOutput: {},
    }),
    finishStep: async () => true,
    enqueueJob: async (job) => {
      input.onEnqueue?.(job.jobType);
      return {
        outcome: "inserted",
        jobId: `job_${job.jobType}`,
        status: "pending",
        availableAt: job.availableAt,
        attempts: 0,
        maxAttempts: job.maxAttempts,
      };
    },
    completeJob: async () => true,
    retryJob: async (retry) => retry.retryable ? "retry_wait" : "dead_letter",
    markReady: async () => {
      input.onMarkReady?.();
      input.context.deployment.status = "ready";
      return true;
    },
    markInstanceUnavailable: async () => {
      input.onMarkUnavailable?.();
      return true;
    },
    markCleanupStatus: async () => true,
    recordTenantResourceLifecycle: async (write) => {
      const record = input.context.tenantResources;
      if (!record || canonicalJson(fenceOf(record)) !== canonicalJson(write.fence)) {
        return false;
      }
      record.runtimeSecretRef = write.runtimeSecretRef;
      record.lifecycleStatus = write.lifecycleStatus;
      record.baselineDigest = write.baselineDigest;
      record.migrationContract = write.migrationContract;
      record.evidenceHash = write.evidenceHash;
      record.evidence = write.evidence;
      record.lastError = write.lastError ?? null;
      record.updatedAt = write.now;
      return true;
    },
    claimTenantResourceGeneration: async (claim) => {
      const existing = input.context.tenantResources;
      const previousOwnerDeploymentId = existing?.ownerDeploymentId ?? null;
      if (
        existing &&
        existing.ownerDeploymentId !== claim.lease.deploymentId &&
        existing.lifecycleStatus !== "destroyed"
      ) {
        throw Object.assign(
          new Error("Live tenant resource handoff requires an ownership epoch."),
          {
            code: "TENANT_RESOURCE_HANDOFF_REQUIRES_OWNERSHIP_EPOCH",
            retryable: false,
          },
        );
      }
      const reopening = existing?.lifecycleStatus === "destroyed";
      const generation = reopening
        ? existing.generation + 1
        : existing?.generation ?? 1;
      const record: DeploymentTenantResourceRecord = {
        identity: claim.identity,
        generation,
        ownershipMarker: deriveTenantOwnershipMarker(claim.identity, generation),
        createdByDeploymentId:
          existing?.createdByDeploymentId ?? claim.lease.deploymentId,
        ownerDeploymentId: claim.lease.deploymentId,
        runtimeSecretRef: reopening ? null : existing?.runtimeSecretRef ?? null,
        lifecycleStatus: reopening
          ? "reopening"
          : existing?.lifecycleStatus ?? "planned",
        baselineDigest: reopening ? null : existing?.baselineDigest ?? null,
        migrationContract: reopening ? null : existing?.migrationContract ?? null,
        evidenceHash: reopening ? null : existing?.evidenceHash ?? null,
        evidence: reopening ? {} : existing?.evidence ?? {},
        lastError: null,
        createdAt: existing?.createdAt ?? claim.now,
        updatedAt: claim.now,
        destroyedAt: null,
      };
      input.context.tenantResources = record;
      input.context.tenantExternalOperation ??=
        activeProvisionExternalFence(fenceOf(record));
      return {
        outcome: existing ? (reopening ? "reopened" : "reused") : "created",
        previousOwnerDeploymentId,
        fence: fenceOf(record),
        record,
      };
    },
    beginTenantResourceCleanup: async (cleanup) => {
      const record = input.context.tenantResources;
      if (!record || canonicalJson(fenceOf(record)) !== canonicalJson(cleanup.fence)) {
        return null;
      }
      if (record.lifecycleStatus !== "destroyed") {
        record.lifecycleStatus = "destroying";
      }
      return cleanup.fence;
    },
    assertTenantResourceCleanupFence: async (cleanup) => {
      const record = input.context.tenantResources;
      return Boolean(
        record &&
          ["destroying", "destroyed"].includes(record.lifecycleStatus) &&
          canonicalJson(fenceOf(record)) === canonicalJson(cleanup.fence),
      );
    },
    completeTenantResourceCleanup: async (cleanup) => {
      const record = input.context.tenantResources;
      if (!record || canonicalJson(fenceOf(record)) !== canonicalJson(cleanup.fence)) {
        return false;
      }
      record.lifecycleStatus = "destroyed";
      record.destroyedAt = cleanup.now;
      return true;
    },
    prepareTenantExternalOperation: async () => {
      if (!input.context.tenantExternalOperation) {
        throw new Error("test fixture has no external operation");
      }
      return { outcome: "reused", fence: input.context.tenantExternalOperation };
    },
    activateTenantExternalOperation: async ({ proof }) => ({
      ...proof.pendingFence,
      state: "active" as const,
    }),
    assertTenantExternalOperation: async ({ externalFence }) =>
      Boolean(
        input.context.tenantExternalOperation &&
          canonicalJson(input.context.tenantExternalOperation) ===
            canonicalJson(externalFence) &&
          externalFence.state === "active",
      ),
    beginOrResumeTenantResourceCleanup: async () => null,
    beginTenantResourceCleanupPhase: async () => null,
    completeTenantResourceCleanupPhase: async () => null,
    finalizeTenantResourceCleanup: async () => false,
  };
}

function readyAwsPort(input?: {
  onDescribe?: () => void;
  onDelete?: () => void;
  onApply?: (stack: ApplyReadyTenantStack) => void;
  observationState?: "missing" | "in_progress" | "ready" | "failed" | "delete_in_progress";
  tags?: Record<string, string>;
}) {
  return {
    region: environment.region,
    getCallerIdentity: async () => ({
      accountId: environment.expectedAccountId,
      arn: "arn:aws:sts::402010193138:assumed-role/TechlongSandboxProvisionerRole/test-session",
    }),
    applyTenantStack: async (stack: ApplyReadyTenantStack) => {
      input?.onApply?.(stack);
      return { operation: "create" as const, stackId: "stack-one" };
    },
    describeTenantStack: async () => {
      input?.onDescribe?.();
      const state = input?.observationState ?? "ready";
      return {
        state,
        rawStatus: state === "ready" ? "CREATE_COMPLETE" : null,
        stackId: state === "missing" ? null : "stack-one",
        outputs: {},
        tags: input?.tags ?? {
          Environment: "aws-sandbox",
          ManagedBy: "techlong-provisioner",
          DeploymentId: "dep_tenant_one",
          AppInstanceId: "app_tenant_one",
          CellId: environment.cellKey,
          ResourceGeneration: "1",
          ExternalOperationEpoch: "1",
          ExternalOperationIntent: "provision",
          ExternalOperationMarker:
            "tl_epoch_04d32d8f09087a2ca0f1a379_g1_e1",
          ExternalOperationHash: "f".repeat(64),
        },
      };
    },
    deleteTenantStack: async () => {
      input?.onDelete?.();
      return { operation: "already_deleted" as const };
    },
  };
}

function readyTenantResourceCleanup(onDestroy?: () => void) {
  return {
    destroy: async ({ fence }: { fence: TenantResourceFence }) => {
      onDestroy?.();
      return {
        fence,
        order: ["workload", "database", "secret"] as const,
        workloadOutcome: "deleted" as const,
        databaseOutcome: "deleted" as const,
        secretOutcome: "deleted" as const,
        databaseEvidenceHash: "d".repeat(64),
      };
    },
  };
}

function verifiedSharedCellSecurityPreflight() {
  return {
    verify: async () => ({ verified: true as const, evidenceHash: "c".repeat(64) }),
  };
}

function compiledPayloadCompiler() {
  return {
    compile: async (input: {
      context: DeploymentExecutionContext;
      configurationHash: string;
    }) => ({
      configurationHash: input.configurationHash,
      compiledPayload: {
        instance: {
          external_instance_id: input.context.appInstance.id,
          metadata: { configuration_hash: input.configurationHash },
        },
        entitlements: {},
        default_store: { name: "Tenant One" },
        first_owner: {
          username: "owner",
          password: "temporary-test-password",
          display_name: "Owner",
        },
      },
    }),
  };
}

test("closed apply and cleanup gates preserve queued work and never construct AWS", async () => {
  let repositoryCalls = 0;
  let awsCalls = 0;
  let claimedTypes: string[] = [];
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:disabled",
    config: { ...enabledConfig, applyEnabled: false },
    dependencies: {
      repository: {
        claimNext: async (
          claim: Parameters<DeploymentExecutionRepository["claimNext"]>[0],
        ) => {
          repositoryCalls += 1;
          claimedTypes = [...claim.jobTypes];
          return null;
        },
      } as unknown as DeploymentExecutionRepository,
      applyRuntimeReady: true,
      tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
      awsFactory: async () => {
        awsCalls += 1;
        throw new Error("must not construct AWS adapter");
      },
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => ({}),
        migrateTenantDatabase: async () => ({}),
      },
      controlClient: {
        waitUntilHealthy: async () => ({ ready: true, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: true, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now,
    },
  });
  assert.equal(result.status, "disabled");
  assert.equal(repositoryCalls, 0);
  assert.deepEqual(claimedTypes, []);
  assert.equal(awsCalls, 0);
});

for (const unusableCleanup of [
  { outcome: "existing_unusable" as const, status: "dead_letter" as const, offset: 0 },
  { outcome: "existing_unusable" as const, status: "canceled" as const, offset: 0 },
  { outcome: "existing_succeeded" as const, status: "succeeded" as const, offset: 0 },
  { outcome: "existing_active" as const, status: "pending" as const, offset: 1 },
]) {
  test(`an ${unusableCleanup.status} or mismatched cleanup job blocks every external write`, async () => {
    const { context } = await executionFixture();
    const baseRepository = inMemoryRepository({ context });
    let awsFactoryCalls = 0;
    let databaseCalls = 0;
    const repository: DeploymentExecutionRepository = {
      ...baseRepository,
      enqueueJob: async (job) => ({
        outcome: unusableCleanup.outcome,
        jobId: "job_cleanup_existing",
        status: unusableCleanup.status,
        availableAt: job.availableAt + unusableCleanup.offset,
        attempts: unusableCleanup.status === "pending" ? 0 : job.maxAttempts,
        maxAttempts: job.maxAttempts,
      }),
    };
    const result = await runDeploymentWorkerOnce({
      workerId: `worker:test:cleanup-enqueue-${unusableCleanup.status}-${unusableCleanup.offset}`,
      config: enabledConfig,
      dependencies: {
        repository,
        applyRuntimeReady: true,
        tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
        awsFactory: async () => {
          awsFactoryCalls += 1;
          throw new Error("an unusable cleanup job must block AWS adapter creation");
        },
        cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
        sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
        tenantDatabase: {
          ensureTenantDatabase: async () => {
            databaseCalls += 1;
            return {};
          },
          migrateTenantDatabase: async () => {
            databaseCalls += 1;
            return {};
          },
        },
        controlClient: {
          waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
          provision: async () => ({ accepted: true as const }),
          readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        },
        controlPayloadCompiler: compiledPayloadCompiler(),
        now: () => now,
      },
    });
    assert.equal(result.status, "dead_letter");
    assert.equal(result.errorCode, "CLEANUP_JOB_UNAVAILABLE");
    assert.equal(awsFactoryCalls, 0);
    assert.equal(databaseCalls, 0);
  });
}

test("an exact pending deduplicated cleanup job permits the guarded apply path", async () => {
  const { context } = await executionFixture();
  const baseRepository = inMemoryRepository({ context });
  let awsFactoryCalls = 0;
  let cloudFormationCalls = 0;
  const repository: DeploymentExecutionRepository = {
    ...baseRepository,
    enqueueJob: async (job) =>
      job.jobType === "cleanup"
        ? {
            outcome: "existing_active",
            jobId: "job_cleanup_existing",
            status: "pending",
            availableAt: job.availableAt,
            attempts: 0,
            maxAttempts: job.maxAttempts,
          }
        : {
            outcome: "inserted",
            jobId: `job_${job.jobType}`,
            status: "pending",
            availableAt: job.availableAt,
            attempts: 0,
            maxAttempts: job.maxAttempts,
          },
  };
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:cleanup-enqueue-existing-pending",
    config: enabledConfig,
    dependencies: {
      repository,
      applyRuntimeReady: true,
      tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
      awsFactory: async () => {
        awsFactoryCalls += 1;
        return readyAwsPort({
          onApply: () => {
            cloudFormationCalls += 1;
          },
        });
      },
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => tenantLifecycleOutput(context, "empty"),
        migrateTenantDatabase: async () => tenantLifecycleOutput(context, "verified"),
      },
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now,
    },
  });
  assert.equal(result.status, "succeeded");
  assert.equal(awsFactoryCalls, 1);
  assert.equal(cloudFormationCalls, 1);
});

test("disabled apply adapters cannot be bypassed by an infrastructure_provisioning resume", async () => {
  const { context } = await executionFixture();
  context.deployment.status = "infrastructure_provisioning";
  let awsFactoryCalls = 0;
  let databaseCalls = 0;
  let claimedTypes: string[] = [];
  let retries = 0;
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:runtime-disabled",
    config: enabledConfig,
    dependencies: {
      repository: {
        claimNext: async (
          claim: Parameters<DeploymentExecutionRepository["claimNext"]>[0],
        ) => {
          claimedTypes = [...claim.jobTypes];
          // Deliberately violate the repository contract to verify the worker's
          // second defensive check still prevents an apply path.
          return context.job;
        },
        retryJob: async () => {
          retries += 1;
          return "retry_wait" as const;
        },
      } as unknown as DeploymentExecutionRepository,
      applyRuntimeReady: false,
      cleanupRuntimeReady: true,
      tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
      awsFactory: async () => {
        awsFactoryCalls += 1;
        throw new Error("disabled apply must not construct AWS");
      },
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
      sharedCellSecurityPreflight: {
        verify: async () => {
          throw new Error("disabled apply must not run preflight");
        },
      },
      tenantDatabase: {
        ensureTenantDatabase: async () => {
          databaseCalls += 1;
          return {};
        },
        migrateTenantDatabase: async () => {
          databaseCalls += 1;
          return {};
        },
      },
      tenantResourceCleanup: readyTenantResourceCleanup(),
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now,
    },
  });
  assert.equal(result.status, "retry_scheduled");
  assert.equal(result.errorCode, "APPLY_RUNTIME_ADAPTERS_DISABLED");
  assert.deepEqual(claimedTypes, ["cleanup", "rollback"]);
  assert.equal(retries, 1);
  assert.equal(awsFactoryCalls, 0);
  assert.equal(databaseCalls, 0);
});

test("renders the allowlisted stack prefix, ownership tag, and cleanup-before-service guardrail", async () => {
  const { stack } = await executionFixture();
  const { context } = await executionFixture();
  const nextDeployment = renderAwsSandboxTenantStack({
    deploymentId: "dep_tenant_two",
    resourceGeneration: 1,
    externalOperation: stackExternalOperation("dep_tenant_two"),
    runtimeSecretRef: tenantRuntimeSecretRef,
    runtimeSecretName: tenantRuntimeSecretName,
    plan: context.deployment.desiredPlan,
    environment,
    imageUri: context.deployment.artifactRef,
    tenantHostname: "tenant-one.sandbox.techlong.cloud",
    listenerPriority: 100,
    activeCellCount: 1,
    activeTenantCount: 0,
    requestedAt: now + 60_000,
  });
  assert.match(stack.stackName, /^techlong-sandbox-tenant-/);
  assert.equal(nextDeployment.stackName, stack.stackName);
  assert.equal(nextDeployment.tags.DeploymentId, "dep_tenant_two");
  assert.equal(stack.tags.Environment, "aws-sandbox");
  assert.equal(stack.tags.AppInstanceId, "app_tenant_one");
  assert.equal(stack.tags.CellId, environment.cellKey);
  assert.equal(stack.tags.DeploymentId, "dep_tenant_one");
  assert.equal(stack.tags.ResourceGeneration, "1");
  assert.equal(stack.safety.cleanupScheduleFirst, true);
  const resources = stack.template.Resources as Record<
    string,
    { Type: string; DependsOn?: string[]; Properties?: Record<string, unknown> }
  >;
  assert.equal(resources.TenantCleanupSchedule.Type, "AWS::Scheduler::Schedule");
  assert.equal(resources.TenantCleanupSchedule.Properties?.GroupName instanceof Object, true);
  const cleanupTarget = resources.TenantCleanupSchedule.Properties?.Target as
    | Record<string, unknown>
    | undefined;
  assert.deepEqual(JSON.parse(String(cleanupTarget?.Input)), {
    schemaVersion: 1,
    action: "delete_cloudformation_stack",
    stackName: stack.stackName,
    deploymentId: "dep_tenant_one",
    appInstanceId: "app_tenant_one",
    resourceGeneration: 1,
  });
  assert.ok(resources.TenantService.DependsOn?.includes("TenantCleanupSchedule"));
  const referencedResources = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.flatMap(referencedResources);
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const refs = typeof record.Ref === "string" ? [record.Ref] : [];
    return refs.concat(Object.values(record).flatMap(referencedResources));
  };
  const dependsOnCleanup = (name: string, visited = new Set<string>()): boolean => {
    if (name === "TenantCleanupSchedule") return true;
    if (visited.has(name)) return false;
    visited.add(name);
    const resource = resources[name];
    if (!resource) return false;
    const dependencies = [
      ...(resource.DependsOn ?? []),
      ...referencedResources(resource.Properties).filter((refName) => refName in resources),
    ];
    return dependencies.some((dependency) => dependsOnCleanup(dependency, visited));
  };
  for (const resourceName of Object.keys(resources)) {
    if (resourceName !== "TenantCleanupSchedule") {
      assert.equal(
        dependsOnCleanup(resourceName),
        true,
        `${resourceName} must be created after the cleanup schedule`,
      );
    }
  }
  assert.equal(resources.TenantService.Properties?.DeploymentConfiguration instanceof Object, true);
  assert.equal(
    (resources.TenantService.Properties?.DeploymentConfiguration as Record<string, unknown>)
      .MaximumPercent,
    100,
  );
  assert.equal(
    Object.values(resources).some((resource) =>
      resource.Type.startsWith("AWS::ApplicationAutoScaling::"),
    ),
    false,
  );
  assert.equal(stack.parameters.CleanupAt, "2026-08-09T02:00:00");
  assert.equal(stack.parameters.SchedulerGroupName, "techlong-sandbox");
});

test("requires an exact, validated CloudFormation parameter set", async () => {
  const { context } = await executionFixture();
  const rendered = renderAwsSandboxTenantStack({
    deploymentId: context.deployment.id,
    resourceGeneration: 1,
    externalOperation: stackExternalOperation(context.deployment.id),
    runtimeSecretRef: tenantRuntimeSecretRef,
    runtimeSecretName: tenantRuntimeSecretName,
    plan: context.deployment.desiredPlan,
    environment,
    imageUri: context.deployment.artifactRef,
    tenantHostname: "tenant-one.sandbox.techlong.cloud",
    listenerPriority: 100,
    activeCellCount: 1,
    activeTenantCount: 0,
    requestedAt: now,
  });
  assert.throws(
    () =>
      finalizeTenantStackForApply({
        rendered,
        environment,
        expectedRuntimeSecretName: tenantRuntimeSecretName,
        binding: {
          ...context.binding!,
          tenantStackParameters: {
            ...context.binding!.tenantStackParameters,
            DatabaseUrlValueFrom: "postgresql://owner:password@example/db",
          },
        },
      }),
    /allowlist|parameter/i,
  );
  assert.throws(
    () =>
      finalizeTenantStackForApply({
        rendered: {
          ...rendered,
          parameters: {
            ...rendered.parameters,
            TenantRuntimeSecretArn: tenantRuntimeSecretRef.replace(
              ":402010193138:",
              ":999999999999:",
            ),
          },
        },
        environment,
        binding: context.binding!,
        expectedRuntimeSecretName: tenantRuntimeSecretName,
      }),
    /runtime Secret.*account and region/i,
  );
  assert.throws(
    () =>
      finalizeTenantStackForApply({
        rendered: {
          ...rendered,
          parameters: {
            ...rendered.parameters,
            TenantRuntimeSecretArn:
              "arn:aws:secretsmanager:ca-central-1:402010193138:secret:" +
              "techlong/sandbox/tenant/tenant_two_123/runtime/g1-abcdef",
          },
        },
        environment,
        binding: context.binding!,
        expectedRuntimeSecretName: tenantRuntimeSecretName,
      }),
    /Tenant runtime Secret/i,
  );
  assert.throws(
    () =>
      finalizeTenantStackForApply({
        rendered,
        environment,
        expectedRuntimeSecretName: tenantRuntimeSecretName,
        binding: {
          ...context.binding!,
          tenantStackParameters: {
            ...context.binding!.tenantStackParameters,
            UnexpectedParameter: "true",
          },
        },
      }),
    /not exact/,
  );
  assert.throws(
    () =>
      finalizeTenantStackForApply({
        rendered,
        environment,
        expectedRuntimeSecretName: tenantRuntimeSecretName,
        binding: {
          ...context.binding!,
          tenantStackParameters: {
            ...context.binding!.tenantStackParameters,
            JanitorFunctionArn:
              `${context.binding!.tenantStackParameters.JanitorFunctionArn}-shadow`,
          },
        },
      }),
    /allowlist/,
  );
  assert.throws(
    () =>
      finalizeTenantStackForApply({
        rendered,
        environment,
        expectedRuntimeSecretName: tenantRuntimeSecretName,
        binding: {
          ...context.binding!,
          tenantStackParameters: {
            ...context.binding!.tenantStackParameters,
            ClusterName: "cell-sandbox-1 ",
          },
        },
      }),
    /ClusterName is invalid/,
  );
});

test("Shared Cell security proof rejects a non-mTLS listener and public task ingress", () => {
  const binding: NonNullable<DeploymentExecutionContext["binding"]> = {
    environmentId: environment.id,
    workerRoleArn,
    cloudFormationRoleArn,
    tenantStackParameters: externalParameters(),
    status: "active",
  };
  const loadBalancerSecurityGroupId = "sg-0123456789abcdef1";
  const databaseSecurityGroupId = "sg-0123456789abcdef2";
  const databaseSubnetIds = [
    "subnet-0123456789abcdef2",
    "subnet-0123456789abcdef3",
  ];
  const resourceTags = {
    Environment: "aws-sandbox",
    ManagedBy: "techlong-cell-operator",
    CellId: environment.cellKey,
    ExpiresAt: new Date(now + 10_800_000).toISOString(),
  };
  const loadBalancerArn =
    `arn:aws:elasticloadbalancing:${environment.region}:${environment.expectedAccountId}:loadbalancer/app/techlong-sandbox-cell/0123456789abcdef`;
  const observation = {
    observedAt: now,
    accountId: environment.expectedAccountId,
    callerArn:
      `arn:aws:sts::${environment.expectedAccountId}:assumed-role/TechlongSandboxProvisionerRole/techlong-sandbox-provisioner`,
    region: environment.region,
    clusterName: "cell-sandbox-1",
    clusterArn:
      `arn:aws:ecs:${environment.region}:${environment.expectedAccountId}:cluster/cell-sandbox-1`,
    clusterStatus: "ACTIVE",
    clusterTags: resourceTags,
    vpcId: binding.tenantStackParameters.VpcId,
    vpcState: "available",
    vpcTags: resourceTags,
    subnetIds: binding.tenantStackParameters.SubnetIds.split(","),
    subnets: [
      ...binding.tenantStackParameters.SubnetIds.split(",").map(
        (id, index) => ({
          id,
          vpcId: binding.tenantStackParameters.VpcId,
          availabilityZone: `ca-central-1${index === 0 ? "a" : "b"}`,
          state: "available",
          mapPublicIpOnLaunch: true,
          tags: resourceTags,
        }),
      ),
      ...databaseSubnetIds.map((id, index) => ({
        id,
        vpcId: binding.tenantStackParameters.VpcId,
        availabilityZone: `ca-central-1${index === 0 ? "a" : "b"}`,
        state: "available",
        mapPublicIpOnLaunch: false,
        tags: resourceTags,
      })),
    ],
    httpsListener: {
      arn: binding.tenantStackParameters.HttpsListenerArn,
      loadBalancerArn,
      protocol: "HTTPS" as const,
      port: 443,
      mutualAuthenticationMode: "off" as const,
      trustStoreArn: null,
      trustStoreStatus: null,
      defaultActionType: "fixed-response",
      deniesSaasControlPaths: true,
    },
    controlListener: {
      arn: binding.tenantStackParameters.ControlListenerArn,
      loadBalancerArn,
      protocol: "HTTPS" as const,
      port: 8443,
      mutualAuthenticationMode: "verify" as const,
      trustStoreArn:
        `arn:aws:elasticloadbalancing:${environment.region}:${environment.expectedAccountId}:truststore/techlong-sandbox-control/0123456789abcdef`,
      trustStoreStatus: "ACTIVE",
      defaultActionType: "fixed-response",
      deniesSaasControlPaths: false,
    },
    loadBalancer: {
      arn: loadBalancerArn,
      name: "techlong-sandbox-cell-sandbox-1",
      type: "application",
      scheme: "internet-facing",
      state: "active",
      vpcId: binding.tenantStackParameters.VpcId,
      subnetIds: binding.tenantStackParameters.SubnetIds.split(","),
      securityGroupIds: [loadBalancerSecurityGroupId],
      tags: resourceTags,
    },
    loadBalancerSecurityGroups: [
      {
        id: loadBalancerSecurityGroupId,
        vpcId: binding.tenantStackParameters.VpcId,
        ingress: [
          { protocol: "tcp", fromPort: 443, toPort: 443, cidrIpv4: "0.0.0.0/0" },
          { protocol: "tcp", fromPort: 8443, toPort: 8443, cidrIpv4: "0.0.0.0/0" },
        ],
        tags: resourceTags,
      },
    ],
    taskSecurityGroup: {
      id: binding.tenantStackParameters.TaskSecurityGroupId,
      vpcId: binding.tenantStackParameters.VpcId,
      ingress: [
        {
          protocol: "tcp",
          fromPort: 3000,
          toPort: 3000,
          sourceSecurityGroupId: loadBalancerSecurityGroupId,
        },
      ],
      tags: resourceTags,
    },
    databaseSecurityGroup: {
      id: databaseSecurityGroupId,
      vpcId: binding.tenantStackParameters.VpcId,
      ingress: [
        {
          protocol: "tcp",
          fromPort: 5432,
          toPort: 5432,
          sourceSecurityGroupId: binding.tenantStackParameters.TaskSecurityGroupId,
        },
      ],
      tags: resourceTags,
    },
    database: {
      arn:
        `arn:aws:rds:${environment.region}:${environment.expectedAccountId}:cluster:techlong-sandbox-cell-sandbox-1`,
      identifier: "techlong-sandbox-cell-sandbox-1",
      status: "available",
      engine: "aurora-postgresql",
      engineVersion: "16.14",
      engineMode: "provisioned",
      port: 5432,
      storageEncrypted: true,
      deletionProtection: false,
      serverlessMinAcu: 0,
      serverlessMaxAcu: 1,
      secondsUntilAutoPause: 300,
      vpcSecurityGroupIds: [databaseSecurityGroupId],
      subnetIds: databaseSubnetIds,
      tags: resourceTags,
      instances: [
        {
          arn:
            `arn:aws:rds:${environment.region}:${environment.expectedAccountId}:db:techlong-sandbox-cell-sandbox-1-writer`,
          identifier: "techlong-sandbox-cell-sandbox-1-writer",
          status: "available",
          instanceClass: "db.serverless",
          publiclyAccessible: false,
          clusterIdentifier: "techlong-sandbox-cell-sandbox-1",
        },
      ],
    },
  };
  assert.doesNotThrow(() =>
    assertSharedCellSecurityObservation({ environment, binding, observation }),
  );
  assert.throws(
    () =>
      assertSharedCellSecurityObservation({
        environment,
        binding,
        observation: {
          ...observation,
          controlListener: {
            ...observation.controlListener,
            mutualAuthenticationMode: "off",
          },
        },
      }),
    /mTLS verify/,
  );
  assert.throws(
    () =>
      assertSharedCellSecurityObservation({
        environment,
        binding,
        observation: {
          ...observation,
          taskSecurityGroup: {
            ...observation.taskSecurityGroup,
            ingress: [
              {
                protocol: "tcp",
                fromPort: 3000,
                toPort: 3000,
                cidrIpv4: "0.0.0.0/0",
              },
            ],
          },
        },
      }),
    /only from an observed ALB security group/,
  );
});

test("mTLS control client reads body.control and sends only a compiled provisioning payload", async () => {
  const { context } = await executionFixture();
  await attachTenantResource(context);
  const externalFence = context.tenantExternalOperation!;
  const externalFields = {
    external_operation_epoch: externalFence.epoch,
    external_operation_intent: externalFence.intent,
    external_operation_marker: externalFence.marker,
    external_operation_hash: externalFence.operationHash,
  };
  const configurationHash = "b".repeat(64);
  const imageRevision = `sha256:${"a".repeat(64)}`;
  const requests: Array<{ url: string; body?: string }> = [];
  const client = new MtlsSaaSControlClient(
    {
      send: async (request) => {
        requests.push({ url: request.url, ...(request.body ? { body: request.body } : {}) });
        if (request.method === "GET") {
          return {
            status: 200,
            body: {
              success: true,
              control: {
                control_api_version: "1.1",
                desired_configuration_hash: configurationHash,
                image_revision: imageRevision,
                ...externalFields,
                instance: {
                  status: "active",
                  external_instance_id: "app_tenant_one",
                },
              },
            },
          };
        }
        return {
          status: 201,
          body: { success: true, replayed: false, ...externalFields },
        };
      },
    },
    { issue: async () => "test.jwt.signature" },
    { baseDomain: "sandbox.techlong.cloud" },
  );
  const observed = await client.readConfiguration({
    appInstanceId: "app_tenant_one",
    hostname: "tenant-one.sandbox.techlong.cloud",
    externalFence,
    signal: signal(),
  });
  assert.equal(observed.desiredConfigurationHash, configurationHash);
  assert.equal(observed.imageRevision, imageRevision);
  assert.equal(requests[0].url.endsWith("/api/saas/control"), true);

  const compiledPayload = {
    instance: {
      external_instance_id: "app_tenant_one",
      metadata: { configuration_hash: configurationHash, ...externalFields },
    },
    entitlements: { "stores.max": 1 },
    default_store: { name: "Tenant One" },
    first_owner: {
      username: "owner",
      password: "temporary-test-password",
      display_name: "Owner",
    },
  };
  const expectedRequestPayload = structuredClone(compiledPayload);
  await assert.doesNotReject(() =>
    client.provision({
      appInstanceId: "app_tenant_one",
      hostname: "tenant-one.sandbox.techlong.cloud",
      idempotencyKey: `dep:${configurationHash}`,
      compiledPayload,
      externalFence,
      signal: signal(),
    }),
  );
  assert.equal(requests[1].url.endsWith("/api/saas/provision"), true);
  assert.deepEqual(JSON.parse(requests[1].body ?? "{}"), expectedRequestPayload);
  assert.equal(Object.hasOwn(compiledPayload.first_owner, "password"), false);
  await assert.rejects(
    () =>
      client.provision({
        appInstanceId: "app_tenant_one",
        hostname: "tenant-one.sandbox.techlong.cloud",
        idempotencyKey: `dep:${configurationHash}`,
        compiledPayload: {
          instance_id: "app_tenant_one",
          desired_configuration_hash: configurationHash,
          configuration: { store_name: "raw snapshot" },
        },
        externalFence,
        signal: signal(),
      }),
    /compiled v2 control shape/i,
  );
});

test("CloudFormation adapter creates once and treats a repeated no-update request as idempotent", async () => {
  const { stack } = await executionFixture();
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
  let exists = false;
  let creates = 0;
  let updates = 0;
  const observedSignals: AbortSignal[] = [];
  const cloudFormationClient = {
    async send(
      command: unknown,
      options?: { abortSignal?: AbortSignal },
    ): Promise<Record<string, unknown>> {
      if (options?.abortSignal) observedSignals.push(options.abortSignal);
      if (command instanceof DescribeStacksCommand) {
        if (!exists) {
          throw Object.assign(new Error("Stack does not exist"), { name: "ValidationError" });
        }
        return {
          Stacks: [
            {
              StackId: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-one/id",
              StackStatus: "CREATE_COMPLETE",
              Tags: Object.entries(stack.tags).map(([Key, Value]) => ({ Key, Value })),
            },
          ],
        };
      }
      if (command instanceof CreateStackCommand) {
        creates += 1;
        exists = true;
        return { StackId: "stack-id-one" };
      }
      if (command instanceof UpdateStackCommand) {
        updates += 1;
        throw Object.assign(new Error("No updates are to be performed."), {
          name: "ValidationError",
        });
      }
      throw new Error("unexpected command");
    },
  };
  const adapter = new AwsSdkDeploymentAdapter(environment.region, {
    stsClient: { send: async () => ({ Account: environment.expectedAccountId }) },
    cloudFormationClient,
    commands: {
      getCallerIdentity: GetCallerIdentityCommand,
      describeStacks: DescribeStacksCommand,
      createStack: CreateStackCommand,
      updateStack: UpdateStackCommand,
      deleteStack: DeleteStackCommand,
    },
  });
  const firstSignal = signal();
  assert.equal(
    (await adapter.applyTenantStack(stack, { signal: firstSignal })).operation,
    "create",
  );
  assert.deepEqual(observedSignals.splice(0), [firstSignal, firstSignal]);
  const secondSignal = signal();
  assert.equal(
    (await adapter.applyTenantStack(stack, { signal: secondSignal })).operation,
    "no_change",
  );
  assert.deepEqual(observedSignals, [secondSignal, secondSignal]);
  assert.equal(creates, 1);
  assert.equal(updates, 1);
});

test("an already-aborted CloudFormation operation makes zero AWS SDK calls", async () => {
  const { stack } = await executionFixture();
  class TestCommand {
    readonly input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  let calls = 0;
  const client = {
    send: async () => {
      calls += 1;
      throw new Error("must not call AWS SDK");
    },
  };
  const adapter = new AwsSdkDeploymentAdapter(environment.region, {
    stsClient: client,
    cloudFormationClient: client,
    commands: {
      getCallerIdentity: TestCommand,
      describeStacks: TestCommand,
      createStack: TestCommand,
      updateStack: TestCommand,
      deleteStack: TestCommand,
    },
  });
  const controller = new AbortController();
  controller.abort(new Error("lease lost"));
  await assert.rejects(
    adapter.applyTenantStack(stack, { signal: controller.signal }),
    /lease lost/,
  );
  assert.equal(calls, 0);
});

test("a different deployment cannot update or delete the durable app stack", async () => {
  const { stack: currentStack } = await executionFixture();
  const stack: ApplyReadyTenantStack = currentStack;
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
  let stackStatus = "UPDATE_COMPLETE";
  let updates = 0;
  let deletes = 0;
  const previousOperationTags: Record<string, string> = {
    ...stack.tags,
    DeploymentId: "dep_previous",
  };
  const adapter = new AwsSdkDeploymentAdapter(environment.region, {
    stsClient: { send: async () => ({ Account: environment.expectedAccountId }) },
    cloudFormationClient: {
      async send(command: unknown): Promise<Record<string, unknown>> {
        if (command instanceof DescribeStacksCommand) {
          return {
            Stacks: [
              {
                StackId: "stack-id-one",
                StackStatus: stackStatus,
                Tags: Object.entries(previousOperationTags).map(([Key, Value]) => ({
                  Key,
                  Value,
                })),
              },
            ],
          };
        }
        if (command instanceof UpdateStackCommand) {
          updates += 1;
          return { StackId: "stack-id-one" };
        }
        if (command instanceof DeleteStackCommand) {
          deletes += 1;
          return {};
        }
        throw new Error("unexpected command");
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

  await assert.rejects(
    () => adapter.applyTenantStack(stack, { signal: signal() }),
    (error: unknown) =>
      (error as { code?: string }).code === "STACK_OPERATION_FENCE_MISMATCH",
  );
  assert.equal(updates, 0);

  previousOperationTags.ResourceGeneration = "2";
  await assert.rejects(
    () => adapter.applyTenantStack(stack, { signal: signal() }),
    (error: unknown) =>
      (error as { code?: string }).code === "STACK_OWNERSHIP_MISMATCH",
  );
  assert.equal(updates, 0);
  previousOperationTags.ResourceGeneration = stack.tags.ResourceGeneration;

  stackStatus = "UPDATE_IN_PROGRESS";
  await assert.rejects(
    () => adapter.applyTenantStack(stack, { signal: signal() }),
    (error: unknown) =>
      (error as { code?: string }).code === "STACK_OPERATION_FENCE_MISMATCH",
  );
  assert.equal(updates, 0);

  stackStatus = "UPDATE_COMPLETE";
  await assert.rejects(
    () =>
      adapter.deleteTenantStack({
        stackName: stack.stackName,
        clientRequestToken: "delete-current-deployment",
        expectedTags: stack.tags,
        cloudFormationRoleArn: stack.cloudFormationRoleArn,
        signal: signal(),
      }),
    (error: unknown) =>
      (error as { code?: string }).code === "STACK_OWNERSHIP_MISMATCH",
  );
  assert.equal(deletes, 0);
});

test("a live tenant generation cannot hand off to a new deployment", async () => {
  const { context } = await executionFixture();
  await attachTenantResource(context, { ownerDeploymentId: "dep_tenant_one" });
  context.deployment.id = "dep_tenant_two";
  context.deployment.status = "infrastructure_provisioning";
  context.job.deploymentId = "dep_tenant_two";
  context.job.payload = {
    schemaVersion: 1,
    deploymentId: "dep_tenant_two",
    planHash: context.deployment.planHash,
  };
  const repository = inMemoryRepository({ context });
  const originalClaim = repository.claimTenantResourceGeneration.bind(repository);
  let claimCalls = 0;
  repository.claimTenantResourceGeneration = async (claim) => {
    claimCalls += 1;
    return originalClaim(claim);
  };
  let awsFactoryCalls = 0;
  const appliedStacks: ApplyReadyTenantStack[] = [];
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:durable-handoff",
    config: enabledConfig,
    dependencies: {
      repository,
      applyRuntimeReady: true,
      tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
      awsFactory: async () => {
        awsFactoryCalls += 1;
        return readyAwsPort({
          onApply: (stack) => {
            appliedStacks.push(stack);
          },
        });
      },
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => {
          throw new Error("infrastructure resume must not prepare a database");
        },
        migrateTenantDatabase: async () => {
          throw new Error("infrastructure resume must not migrate a database");
        },
      },
      tenantResourceCleanup: readyTenantResourceCleanup(),
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now,
    },
  });
  assert.equal(result.status, "dead_letter");
  assert.equal(result.errorCode, "TENANT_RESOURCE_HANDOFF_REQUIRES_OWNERSHIP_EPOCH");
  assert.equal(claimCalls, 1);
  assert.equal(awsFactoryCalls, 0);
  assert.equal(appliedStacks.length, 0);
});

test("declared AWS SDK runtime packages construct the adapter without making a request", async () => {
  const adapter = await createAwsSdkDeploymentAdapter(environment.region);
  assert.equal(adapter.region, environment.region);
});

test("CloudFormation adapter resumes owned creates and treats delete-in-progress as idempotent", async () => {
  const { stack } = await executionFixture();
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
  const makeAdapter = (status: string) => {
    const calls = { creates: 0, updates: 0, deletes: 0 };
    const cloudFormationClient = {
      async send(command: unknown): Promise<Record<string, unknown>> {
        if (command instanceof DescribeStacksCommand) {
          return {
            Stacks: [
              {
                StackId: "stack-id-one",
                StackStatus: status,
                Tags: Object.entries(stack.tags).map(([Key, Value]) => ({ Key, Value })),
              },
            ],
          };
        }
        if (command instanceof CreateStackCommand) calls.creates += 1;
        else if (command instanceof UpdateStackCommand) calls.updates += 1;
        else if (command instanceof DeleteStackCommand) calls.deletes += 1;
        return { StackId: "stack-id-one" };
      },
    };
    return {
      calls,
      adapter: new AwsSdkDeploymentAdapter(environment.region, {
        stsClient: { send: async () => ({ Account: environment.expectedAccountId }) },
        cloudFormationClient,
        commands: {
          getCallerIdentity: GetCallerIdentityCommand,
          describeStacks: DescribeStacksCommand,
          createStack: CreateStackCommand,
          updateStack: UpdateStackCommand,
          deleteStack: DeleteStackCommand,
        },
      }),
    };
  };

  const creating = makeAdapter("CREATE_IN_PROGRESS");
  assert.equal(
    (await creating.adapter.applyTenantStack(stack, { signal: signal() })).operation,
    "existing_in_progress",
  );
  assert.deepEqual(creating.calls, { creates: 0, updates: 0, deletes: 0 });

  const deleting = makeAdapter("DELETE_IN_PROGRESS");
  assert.equal(
    (
      await deleting.adapter.deleteTenantStack({
        stackName: stack.stackName,
        clientRequestToken: `delete-${stack.clientRequestToken}`.slice(0, 128),
        expectedTags: stack.tags,
        cloudFormationRoleArn: stack.cloudFormationRoleArn,
        signal: signal(),
      })
    ).operation,
    "delete_in_progress",
  );
  assert.equal(deleting.calls.deletes, 0);

  const deleteFailed = makeAdapter("DELETE_FAILED");
  assert.equal(
    (
      await deleteFailed.adapter.deleteTenantStack({
        stackName: stack.stackName,
        clientRequestToken: `delete-${stack.clientRequestToken}`.slice(0, 128),
        expectedTags: stack.tags,
        cloudFormationRoleArn: stack.cloudFormationRoleArn,
        signal: signal(),
      })
    ).operation,
    "delete",
  );
  assert.equal(deleteFailed.calls.deletes, 1);

  const failedApply = makeAdapter("ROLLBACK_COMPLETE");
  await assert.rejects(
    () => failedApply.adapter.applyTenantStack(stack, { signal: signal() }),
    /terminal state ROLLBACK_COMPLETE/,
  );
  assert.equal(failedApply.calls.updates, 0);
});

test("records a retry without calling CloudFormation when tenant database preparation fails", async () => {
  const { context } = await executionFixture();
  let awsFactoryCalls = 0;
  let cloudFormationCalls = 0;
  let retryable: boolean | null = null;
  const repository: DeploymentExecutionRepository = {
    claimNext: async () => context.job,
    loadContext: async () => context,
    reserveEnvironmentCapacity: async () => true,
    confirmCleanupSchedule: async (input) => {
      const schedule = {
        id: "clean_one",
        deploymentId: input.lease.deploymentId,
        status: "confirmed" as const,
        expiresAt: input.expiresAt,
        providerScheduleRef: input.providerScheduleRef,
        confirmedAt: input.confirmedAt,
      };
      context.cleanupSchedule = schedule;
      return schedule;
    },
    heartbeat: async () => true,
    transitionDeployment: async (input) => {
      context.deployment.status = input.to;
      return true;
    },
    beginStep: async (input) => ({
      id: `step_${input.stepKey}`,
      alreadySucceeded: false,
      previousOutput: {},
    }),
    finishStep: async () => true,
    enqueueJob: async (job) => ({
      outcome: "inserted",
      jobId: `job_${job.jobType}`,
      status: "pending",
      availableAt: job.availableAt,
      attempts: 0,
      maxAttempts: job.maxAttempts,
    }),
    completeJob: async () => true,
    retryJob: async (input) => {
      retryable = input.retryable;
      return "retry_wait";
    },
    markReady: async () => true,
    markInstanceUnavailable: async () => true,
    markCleanupStatus: async () => true,
    recordTenantResourceLifecycle: async () => true,
    claimTenantResourceGeneration: async (claim) => {
      const existing = context.tenantResources;
      const generation = existing?.generation ?? 1;
      const record: DeploymentTenantResourceRecord = {
        identity: claim.identity,
        generation,
        ownershipMarker: deriveTenantOwnershipMarker(claim.identity, generation),
        createdByDeploymentId:
          existing?.createdByDeploymentId ?? claim.lease.deploymentId,
        ownerDeploymentId: claim.lease.deploymentId,
        runtimeSecretRef: existing?.runtimeSecretRef ?? null,
        lifecycleStatus: existing?.lifecycleStatus ?? "planned",
        baselineDigest: existing?.baselineDigest ?? null,
        migrationContract: existing?.migrationContract ?? null,
        evidenceHash: existing?.evidenceHash ?? null,
        evidence: existing?.evidence ?? {},
        lastError: null,
        createdAt: existing?.createdAt ?? claim.now,
        updatedAt: claim.now,
        destroyedAt: existing?.destroyedAt ?? null,
      };
      context.tenantResources = record;
      context.tenantExternalOperation ??=
        activeProvisionExternalFence(fenceOf(record));
      return {
        outcome: existing ? "reused" : "created",
        previousOwnerDeploymentId: existing?.ownerDeploymentId ?? null,
        fence: fenceOf(record),
        record,
      };
    },
    beginTenantResourceCleanup: async () => null,
    assertTenantResourceCleanupFence: async () => false,
    completeTenantResourceCleanup: async () => false,
    prepareTenantExternalOperation: async () => {
      throw new Error("not used");
    },
    activateTenantExternalOperation: async () => null,
    assertTenantExternalOperation: async ({ externalFence }) =>
      Boolean(
        context.tenantExternalOperation &&
          canonicalJson(context.tenantExternalOperation) === canonicalJson(externalFence),
      ),
    beginOrResumeTenantResourceCleanup: async () => null,
    beginTenantResourceCleanupPhase: async () => null,
    completeTenantResourceCleanupPhase: async () => null,
    finalizeTenantResourceCleanup: async () => false,
  };
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:retry",
    config: enabledConfig,
    dependencies: {
      repository,
      applyRuntimeReady: true,
      tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
      awsFactory: async () => {
        awsFactoryCalls += 1;
        return {
          region: environment.region,
          getCallerIdentity: async () => ({
            accountId: environment.expectedAccountId,
            arn: "arn:aws:sts::402010193138:assumed-role/TechlongSandboxProvisionerRole/test-session",
          }),
          applyTenantStack: async () => {
            cloudFormationCalls += 1;
            return { operation: "create", stackId: "stack-one" };
          },
          describeTenantStack: async () => ({
            state: "missing",
            rawStatus: null,
            stackId: null,
            outputs: {},
            tags: {},
          }),
          deleteTenantStack: async () => ({ operation: "already_deleted" }),
        };
      },
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now + 1_000),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => {
          throw Object.assign(new Error("temporary database lock"), {
            code: "DATABASE_BUSY",
            retryable: true,
          });
        },
        migrateTenantDatabase: async () => ({}),
      },
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now + 1_000,
    },
  });
  assert.equal(result.status, "retry_scheduled");
  assert.equal(result.errorCode, "DATABASE_BUSY");
  assert.equal(retryable, true);
  assert.equal(awsFactoryCalls, 1);
  assert.equal(cloudFormationCalls, 0);
});

test("a lost lease aborts a long operation and discards its late result", async () => {
  const { context } = await executionFixture();
  context.deployment.status = "database_preparing";
  await attachTenantResource(context);
  let heartbeatCalls = 0;
  let lifecycleWrites = 0;
  let succeededStepWrites = 0;
  let databaseResolved = false;
  let databaseSignal: AbortSignal | null = null;
  const baseRepository = inMemoryRepository({ context });
  const repository: DeploymentExecutionRepository = {
    ...baseRepository,
    heartbeat: async () => {
      heartbeatCalls += 1;
      // Identity and Shared Cell checkpoints each renew before and after their
      // fast calls. Lose the lease only after the database operation starts.
      return heartbeatCalls < 6;
    },
    finishStep: async (input) => {
      if (
        input.stepId === "step_tenant_database_prepare" &&
        input.status === "succeeded"
      ) {
        succeededStepWrites += 1;
      }
      return input.stepId !== "step_tenant_database_prepare";
    },
    recordTenantResourceLifecycle: async () => {
      lifecycleWrites += 1;
      return true;
    },
    retryJob: async () => "lease_lost",
  };
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:lease-loss",
    config: enabledConfig,
    dependencies: {
      repository,
      applyRuntimeReady: true,
      tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
      leaseHeartbeatIntervalMs: 5,
      awsFactory: async () => readyAwsPort(),
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async ({ signal: operationSignal }) => {
          databaseSignal = operationSignal;
          await new Promise<void>((resolve) => setTimeout(resolve, 30));
          databaseResolved = true;
          return tenantLifecycleOutput(context, "empty");
        },
        migrateTenantDatabase: async () => ({}),
      },
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now,
    },
  });

  assert.equal(result.status, "lease_lost");
  assert.equal(result.errorCode, "DEPLOYMENT_LEASE_LOST");
  assert.ok(heartbeatCalls >= 6);
  assert.equal(lifecycleWrites, 0);
  assert.equal(succeededStepWrites, 0);
  assert.equal((databaseSignal as AbortSignal | null)?.aborted, true);

  // The adapter observes the exact aborted Signal but intentionally resolves
  // late in this fixture. The result must remain detached from durable writes.
  await new Promise<void>((resolve) => setTimeout(resolve, 40));
  assert.equal(databaseResolved, true);
  assert.equal(lifecycleWrites, 0);
  assert.equal(succeededStepWrites, 0);
});

test("persists fenced tenant lifecycle evidence before CloudFormation apply", async () => {
  const { context } = await executionFixture();
  context.deployment.status = "database_preparing";
  await attachTenantResource(context);
  const transitions: string[] = [];
  const lifecycleStatuses: string[] = [];
  let databasePrepareCalls = 0;
  let databaseMigrateCalls = 0;
  let cloudFormationCalls = 0;
  const enqueuedJobTypes: string[] = [];
  const baseRepository = inMemoryRepository({
    context,
    transitions,
    onEnqueue: (jobType) => {
      enqueuedJobTypes.push(jobType);
    },
  });
  const repository: DeploymentExecutionRepository = {
    ...baseRepository,
    recordTenantResourceLifecycle: async (write) => {
      const record = context.tenantResources!;
      assert.equal(write.fence.ownerDeploymentId, context.deployment.id);
      assert.equal(write.fence.generation, record.generation);
      lifecycleStatuses.push(write.lifecycleStatus);
      record.runtimeSecretRef = write.runtimeSecretRef;
      record.lifecycleStatus = write.lifecycleStatus;
      record.baselineDigest = write.baselineDigest;
      record.migrationContract = write.migrationContract;
      record.evidenceHash = write.evidenceHash;
      record.evidence = write.evidence;
      record.updatedAt = write.now;
      return true;
    },
  };
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:lifecycle-persistence",
    config: enabledConfig,
    dependencies: {
      repository,
      applyRuntimeReady: true,
      tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
      awsFactory: async () =>
        readyAwsPort({
          onApply: () => {
            cloudFormationCalls += 1;
          },
        }),
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => {
          databasePrepareCalls += 1;
          return tenantLifecycleOutput(context, "empty");
        },
        migrateTenantDatabase: async () => {
          databaseMigrateCalls += 1;
          return tenantLifecycleOutput(context, "verified");
        },
      },
      tenantResourceCleanup: readyTenantResourceCleanup(),
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now,
    },
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(lifecycleStatuses, ["database_empty", "verified"]);
  assert.equal(databasePrepareCalls, 1);
  assert.equal(databaseMigrateCalls, 1);
  assert.equal(cloudFormationCalls, 1);
  assert.deepEqual(enqueuedJobTypes, ["cleanup", "cleanup", "reconcile"]);
  assert.deepEqual(transitions, [
    "migrating",
    "infrastructure_provisioning",
    "waiting_healthy",
  ]);
});

for (const lifecycleState of ["empty", "saas_migrated"] as const) {
  test(`blocks CloudFormation when migration persists ${lifecycleState} instead of verified`, async () => {
    const { context } = await executionFixture();
    context.deployment.status = "migrating";
    await attachTenantResource(context);
    let cloudFormationCalls = 0;
    const loadedLifecycleStatuses: string[] = [];
    const baseRepository = inMemoryRepository({ context });
    const repository: DeploymentExecutionRepository = {
      ...baseRepository,
      loadContext: async (job) => {
        const loaded = await baseRepository.loadContext(job);
        loadedLifecycleStatuses.push(
          loaded.tenantResources?.lifecycleStatus ?? "missing",
        );
        return loaded;
      },
    };

    const result = await runDeploymentWorkerOnce({
      workerId: `worker:test:migration-${lifecycleState}`,
      config: enabledConfig,
      dependencies: {
        repository,
        applyRuntimeReady: true,
        tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
        awsFactory: async () =>
          readyAwsPort({
            onApply: () => {
              cloudFormationCalls += 1;
            },
          }),
        cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
        sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
        tenantDatabase: {
          ensureTenantDatabase: async () => {
            throw new Error("migration resume must not prepare the database");
          },
          migrateTenantDatabase: async () =>
            tenantLifecycleOutput(context, lifecycleState),
        },
        tenantResourceCleanup: readyTenantResourceCleanup(),
        controlClient: {
          waitUntilHealthy: async () => ({
            ready: false,
            desiredConfigurationHash: null,
            imageRevision: null,
          }),
          provision: async () => ({ accepted: true as const }),
          readConfiguration: async () => ({
            ready: false,
            desiredConfigurationHash: null,
            imageRevision: null,
          }),
        },
        controlPayloadCompiler: compiledPayloadCompiler(),
        now: () => now,
      },
    });

    const expectedPersistedStatus =
      lifecycleState === "empty" ? "database_empty" : "saas_migrated";
    assert.equal(result.status, "dead_letter");
    assert.equal(result.errorCode, "TENANT_DATABASE_VERIFICATION_REQUIRED");
    assert.equal(context.deployment.status, "migrating");
    assert.equal(context.tenantResources?.lifecycleStatus, expectedPersistedStatus);
    assert.ok(loadedLifecycleStatuses.includes(expectedPersistedStatus));
    assert.equal(cloudFormationCalls, 0);
  });
}

test("an unverified Shared Cell stops before capacity, tenant database, or CloudFormation writes", async () => {
  const { context } = await executionFixture();
  let capacityCalls = 0;
  let databaseCalls = 0;
  let cloudFormationCalls = 0;
  const aws = readyAwsPort();
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:cell-preflight-disabled",
    config: enabledConfig,
    dependencies: {
      repository: inMemoryRepository({
        context,
        reserveCapacity: () => {
          capacityCalls += 1;
          return true;
        },
      }),
      applyRuntimeReady: true,
      tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
      awsFactory: async () => ({
        ...aws,
        applyTenantStack: async () => {
          cloudFormationCalls += 1;
          return { operation: "create" as const, stackId: "stack-one" };
        },
      }),
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now + 1_000),
      sharedCellSecurityPreflight: {
        verify: async () => {
          throw Object.assign(new Error("Shared Cell proof unavailable"), {
            code: "SHARED_CELL_SECURITY_PREFLIGHT_DISABLED",
            retryable: false,
          });
        },
      },
      tenantDatabase: {
        ensureTenantDatabase: async () => {
          databaseCalls += 1;
          return {};
        },
        migrateTenantDatabase: async () => {
          databaseCalls += 1;
          return {};
        },
      },
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now + 1_000,
    },
  });
  assert.equal(result.status, "dead_letter");
  assert.equal(capacityCalls, 0);
  assert.equal(databaseCalls, 0);
  assert.equal(cloudFormationCalls, 0);
});

test("an atomic capacity reservation loser stops before tenant database and CloudFormation writes", async () => {
  const { context } = await executionFixture();
  let databaseCalls = 0;
  let cloudFormationCalls = 0;
  const aws = readyAwsPort();
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:capacity-loser",
    config: enabledConfig,
    dependencies: {
      repository: inMemoryRepository({
        context,
        reserveCapacity: () => false,
      }),
      applyRuntimeReady: true,
      tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
      awsFactory: async () => ({
        ...aws,
        applyTenantStack: async () => {
          cloudFormationCalls += 1;
          return { operation: "create" as const, stackId: "stack-one" };
        },
      }),
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now + 1_000),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => {
          databaseCalls += 1;
          return {};
        },
        migrateTenantDatabase: async () => {
          databaseCalls += 1;
          return {};
        },
      },
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now + 1_000,
    },
  });
  assert.equal(result.status, "retry_scheduled");
  assert.equal(databaseCalls, 0);
  assert.equal(cloudFormationCalls, 0);
});

test("a persisted gate flip is re-read before tenant database or CloudFormation writes", async () => {
  const { context } = await executionFixture();
  const baseRepository = inMemoryRepository({ context });
  let contextLoads = 0;
  let databaseCalls = 0;
  let cloudFormationCalls = 0;
  const repository: DeploymentExecutionRepository = {
    ...baseRepository,
    loadContext: async () => {
      contextLoads += 1;
      if (contextLoads === 1) return context;
      return {
        ...context,
        environment: {
          ...context.environment,
          applyEnabled: false,
        },
      };
    },
  };
  const aws = readyAwsPort();
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:prewrite-gate-flip",
    config: enabledConfig,
    dependencies: {
      repository,
      applyRuntimeReady: true,
      tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
      awsFactory: async () => ({
        ...aws,
        applyTenantStack: async () => {
          cloudFormationCalls += 1;
          return { operation: "create" as const, stackId: "stack-one" };
        },
      }),
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now + 1_000),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => {
          databaseCalls += 1;
          return {};
        },
        migrateTenantDatabase: async () => {
          databaseCalls += 1;
          return {};
        },
      },
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now + 1_000,
    },
  });
  assert.equal(result.status, "retry_scheduled");
  assert.equal(contextLoads, 2);
  assert.equal(databaseCalls, 0);
  assert.equal(cloudFormationCalls, 0);
});

test("reconcile advances health, configuration and verification without entering cancellation", async () => {
  const { context } = await executionFixture();
  context.job.jobType = "reconcile";
  context.deployment.status = "waiting_healthy";
  const tenantResource = await attachTenantResource(context, {
    lifecycleStatus: "verified",
  });
  tenantResource.runtimeSecretRef = tenantRuntimeSecretRef;
  const transitions: string[] = [];
  let markedReady = 0;
  let controlCalls = 0;
  const imageRevision = context.deployment.artifactRef.split("@").at(-1) ?? null;
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:reconcile",
    config: enabledConfig,
    dependencies: {
      repository: inMemoryRepository({
        context,
        transitions,
        onMarkReady: () => {
          markedReady += 1;
        },
      }),
      applyRuntimeReady: true,
      tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
      awsFactory: async () => readyAwsPort(),
      cleanupScheduler: {
        confirmSchedule: async () => {
          throw new Error("reconcile must not recreate a cleanup schedule");
        },
      },
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => ({}),
        migrateTenantDatabase: async () => ({}),
      },
      controlClient: {
        waitUntilHealthy: async () => {
          controlCalls += 1;
          return { ready: true, desiredConfigurationHash: null, imageRevision };
        },
        provision: async () => {
          controlCalls += 1;
          return { accepted: true as const };
        },
        readConfiguration: async () => {
          controlCalls += 1;
          return {
            ready: true,
            desiredConfigurationHash: context.deployment.configurationHash,
            imageRevision,
          };
        },
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now + 1_000,
    },
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(transitions, ["configuring", "verifying"]);
  assert.equal(transitions.includes("cancel_requested"), false);
  assert.equal(transitions.includes("rolling_back"), false);
  assert.equal(markedReady, 1);
  assert.equal(controlCalls, 3);
});

test("reconcile rejects a stack with mismatched ownership tags before control calls", async () => {
  const { context } = await executionFixture();
  context.job.jobType = "reconcile";
  context.deployment.status = "waiting_healthy";
  const tenantResource = await attachTenantResource(context, {
    lifecycleStatus: "verified",
  });
  tenantResource.runtimeSecretRef = tenantRuntimeSecretRef;
  let controlCalls = 0;
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:ownership-mismatch",
    config: enabledConfig,
    dependencies: {
      repository: inMemoryRepository({ context }),
      applyRuntimeReady: true,
      tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
      awsFactory: async () =>
        readyAwsPort({
          tags: {
            Environment: "aws-sandbox",
            ManagedBy: "techlong-provisioner",
            DeploymentId: "dep_another_tenant",
            AppInstanceId: context.appInstance.id,
          },
        }),
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => ({}),
        migrateTenantDatabase: async () => ({}),
      },
      controlClient: {
        waitUntilHealthy: async () => {
          controlCalls += 1;
          return { ready: true, desiredConfigurationHash: null, imageRevision: null };
        },
        provision: async () => {
          controlCalls += 1;
          return { accepted: true as const };
        },
        readConfiguration: async () => {
          controlCalls += 1;
          return { ready: true, desiredConfigurationHash: null, imageRevision: null };
        },
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now + 1_000,
    },
  });
  assert.equal(result.status, "dead_letter");
  assert.equal(controlCalls, 0);
});

test("a ready reconcile is an idempotent success without delete or control calls", async () => {
  const { context } = await executionFixture();
  context.job.jobType = "reconcile";
  context.deployment.status = "ready";
  context.appInstance.status = "active";
  const tenantResource = await attachTenantResource(context, {
    lifecycleStatus: "verified",
  });
  tenantResource.runtimeSecretRef = tenantRuntimeSecretRef;
  const transitions: string[] = [];
  let describes = 0;
  let controlCalls = 0;
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:ready-reconcile",
    config: enabledConfig,
    dependencies: {
      repository: inMemoryRepository({ context, transitions }),
      applyRuntimeReady: true,
      tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
      awsFactory: async () =>
        readyAwsPort({
          onDescribe: () => {
            describes += 1;
          },
        }),
      cleanupScheduler: {
        confirmSchedule: async () => {
          throw new Error("ready reconcile must not recreate cleanup");
        },
      },
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => ({}),
        migrateTenantDatabase: async () => ({}),
      },
      controlClient: {
        waitUntilHealthy: async () => {
          controlCalls += 1;
          return { ready: true, desiredConfigurationHash: null, imageRevision: null };
        },
        provision: async () => {
          controlCalls += 1;
          return { accepted: true as const };
        },
        readConfiguration: async () => {
          controlCalls += 1;
          return { ready: true, desiredConfigurationHash: null, imageRevision: null };
        },
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now + 1_000,
    },
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(transitions, []);
  assert.equal(describes, 0);
  assert.equal(controlCalls, 0);
});

test("apply capability without an ownership coordinator stays disabled before claim", async () => {
  const { context } = await executionFixture();
  context.job.jobType = "reconcile";
  context.deployment.status = "waiting_healthy";
  await attachTenantResource(context, { lifecycleStatus: "verified" });
  context.tenantExternalOperation = null;
  const baseRepository = inMemoryRepository({ context });
  let awsFactoryCalls = 0;
  let controlCalls = 0;
  let claimCalls = 0;
  const repository: DeploymentExecutionRepository = {
    ...baseRepository,
    claimNext: async () => {
      claimCalls += 1;
      return context.job;
    },
    claimTenantResourceGeneration: async (claim) => {
      const result = await baseRepository.claimTenantResourceGeneration(claim);
      context.tenantExternalOperation = null;
      return result;
    },
  };
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:reconcile-no-provision-epoch",
    config: enabledConfig,
    dependencies: {
      repository,
      applyRuntimeReady: true,
      awsFactory: async () => {
        awsFactoryCalls += 1;
        return readyAwsPort();
      },
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => ({}),
        migrateTenantDatabase: async () => ({}),
      },
      controlClient: {
        waitUntilHealthy: async () => {
          controlCalls += 1;
          return { ready: true, desiredConfigurationHash: null, imageRevision: null };
        },
        provision: async () => {
          controlCalls += 1;
          return { accepted: true as const };
        },
        readConfiguration: async () => {
          controlCalls += 1;
          return { ready: true, desiredConfigurationHash: null, imageRevision: null };
        },
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now,
    },
  });
  assert.equal(result.status, "disabled");
  assert.equal(claimCalls, 0);
  assert.equal(awsFactoryCalls, 0);
  assert.equal(controlCalls, 0);
});

for (const jobType of ["cleanup", "rollback"] as const) {
  test(`expired ${jobType} reaches delete handling without recreating cleanup`, async () => {
    const { context } = await executionFixture();
    context.job.jobType = jobType;
    context.deployment.status = "ready";
    context.appInstance.status = "active";
    context.environment = {
      ...context.environment,
      applyEnabled: false,
      status: "inactive",
    };
    context.binding = { ...context.binding!, status: "inactive" };
    context.subscription = { id: "sub_one", status: "canceled" };
    await attachTenantResource(context);
    context.appInstance.configurationSnapshot = { drifted_after_expiry: true };
    context.deployment.createdAt = now - context.environment.policy.ttlSeconds * 1_000;
    context.cleanupSchedule = {
      id: "clean_expired",
      deploymentId: context.deployment.id,
      status: "confirmed",
      expiresAt: now,
      providerScheduleRef:
        `cloudformation:${awsSandboxTenantStackName(context.appInstance.id)}:TenantCleanupSchedule`,
      confirmedAt: now - 1_000,
    };
    const transitions: string[] = [];
    let unavailable = 0;
    let cleanupEnqueues = 0;
    let cleanupConfirmations = 0;
    let resourceCleanupCalls = 0;
    let awsFactoryCalls = 0;
    const result = await runDeploymentWorkerOnce({
      workerId: `worker:test:${jobType}`,
      config: { ...enabledConfig, applyEnabled: false, confirmation: "" },
      dependencies: {
        repository: inMemoryRepository({
          context,
          transitions,
          onMarkUnavailable: () => {
            unavailable += 1;
          },
          onEnqueue: () => {
            cleanupEnqueues += 1;
          },
        }),
        applyRuntimeReady: false,
        cleanupRuntimeReady: true,
        tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
        awsFactory: async () => {
          awsFactoryCalls += 1;
          throw new Error("fenced cleanup must own the workload boundary");
        },
        cleanupScheduler: {
          confirmSchedule: async () => {
            cleanupConfirmations += 1;
            throw new Error("expired delete work must not recreate cleanup");
          },
        },
        sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
        tenantDatabase: {
          ensureTenantDatabase: async () => ({}),
          migrateTenantDatabase: async () => ({}),
        },
        tenantResourceCleanup: readyTenantResourceCleanup(() => {
          resourceCleanupCalls += 1;
        }),
        controlClient: {
          waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
          provision: async () => ({ accepted: true as const }),
          readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        },
        controlPayloadCompiler: compiledPayloadCompiler(),
        now: () => now,
      },
    });
    assert.equal(result.status, "succeeded");
    // Deployment, schedule, instance and capacity state now converge inside
    // the coordinator's single fenced finalize transaction.
    assert.deepEqual(transitions, []);
    assert.equal(unavailable, 0);
    assert.equal(cleanupEnqueues, 0);
    assert.equal(cleanupConfirmations, 0);
    assert.equal(resourceCleanupCalls, 1);
    assert.equal(awsFactoryCalls, 0);
  });
}

test("cleanup does not use the legacy standalone schedule status CAS", async () => {
  const context = await expiredCleanupContext();
  const baseRepository = inMemoryRepository({ context });
  let cleanupCalls = 0;
  let instanceWrites = 0;
  let completedJobs = 0;
  const repository: DeploymentExecutionRepository = {
    ...baseRepository,
    markCleanupStatus: async () => false,
    markInstanceUnavailable: async () => {
      instanceWrites += 1;
      return true;
    },
    completeJob: async () => {
      completedJobs += 1;
      return true;
    },
  };
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:cleanup-status-zero-rows",
    config: { ...enabledConfig, applyEnabled: false, confirmation: "" },
    dependencies: {
      repository,
      applyRuntimeReady: false,
      cleanupRuntimeReady: true,
      tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
      awsFactory: async () => {
        throw new Error("fenced cleanup must not construct the apply AWS adapter");
      },
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => ({}),
        migrateTenantDatabase: async () => ({}),
      },
      tenantResourceCleanup: readyTenantResourceCleanup(() => {
        cleanupCalls += 1;
      }),
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now,
    },
  });
  assert.equal(result.status, "succeeded");
  assert.equal(cleanupCalls, 1);
  assert.equal(instanceWrites, 0);
  assert.equal(completedJobs, 1);
});

test("cleanup does not use the legacy standalone instance status CAS", async () => {
  const context = await expiredCleanupContext();
  const baseRepository = inMemoryRepository({ context });
  let instanceWriteAttempts = 0;
  let completedJobs = 0;
  const repository: DeploymentExecutionRepository = {
    ...baseRepository,
    markInstanceUnavailable: async () => {
      instanceWriteAttempts += 1;
      return false;
    },
    completeJob: async () => {
      completedJobs += 1;
      return true;
    },
  };
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:instance-unavailable-zero-rows",
    config: { ...enabledConfig, applyEnabled: false, confirmation: "" },
    dependencies: {
      repository,
      applyRuntimeReady: false,
      cleanupRuntimeReady: true,
      tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
      awsFactory: async () => {
        throw new Error("fenced cleanup must not construct the apply AWS adapter");
      },
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => ({}),
        migrateTenantDatabase: async () => ({}),
      },
      tenantResourceCleanup: readyTenantResourceCleanup(),
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now,
    },
  });
  assert.equal(result.status, "succeeded");
  assert.equal(instanceWriteAttempts, 0);
  assert.equal(completedJobs, 1);
});

test("cleanup converges when atomic finalization commits before job completion", async () => {
  const { context } = await executionFixture();
  context.job.jobType = "cleanup";
  context.deployment.status = "ready";
  context.appInstance.status = "active";
  await attachTenantResource(context);
  let rejectFirstJobCompletion = true;
  let cleanupCalls = 0;
  const baseRepository = inMemoryRepository({ context });
  const repository: DeploymentExecutionRepository = {
    ...baseRepository,
    completeJob: async () => {
      if (rejectFirstJobCompletion) {
        rejectFirstJobCompletion = false;
        return false;
      }
      return true;
    },
  };
  const cleanup = {
    destroy: async ({ fence }: { fence: TenantResourceFence }) => {
      cleanupCalls += 1;
      context.tenantResources!.lifecycleStatus = "destroyed";
      context.tenantResources!.destroyedAt = now;
      context.deployment.status = "rolled_back";
      context.appInstance.status = "suspended";
      if (context.cleanupSchedule) context.cleanupSchedule.status = "succeeded";
      context.tenantExternalOperation = null;
      return {
        fence,
        order: ["workload", "database", "secret"] as const,
        workloadOutcome: "deleted" as const,
        databaseOutcome: "deleted" as const,
        secretOutcome: "deleted" as const,
        databaseEvidenceHash: "d".repeat(64),
      };
    },
  };
  const dependencies: DeploymentWorkerDependencies = {
    repository,
    applyRuntimeReady: false,
    cleanupRuntimeReady: true,
    tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
    awsFactory: async () => {
      throw new Error("fenced cleanup must not construct AWS here");
    },
    cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
    sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
    tenantDatabase: {
      ensureTenantDatabase: async () => ({}),
      migrateTenantDatabase: async () => ({}),
    },
    tenantResourceCleanup: cleanup,
    controlClient: {
      waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      provision: async () => ({ accepted: true as const }),
      readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
    },
    controlPayloadCompiler: compiledPayloadCompiler(),
    now: () => now,
  };
  const first = await runDeploymentWorkerOnce({
    workerId: "worker:test:cleanup-crash-window",
    config: { ...enabledConfig, applyEnabled: false, confirmation: "" },
    dependencies,
  });
  assert.equal(first.status, "lease_lost");

  const second = await runDeploymentWorkerOnce({
    workerId: "worker:test:cleanup-crash-window",
    config: { ...enabledConfig, applyEnabled: false, confirmation: "" },
    dependencies,
  });
  assert.equal(second.status, "succeeded");
  assert.equal(cleanupCalls, 1);
});

test("cleanup waits idempotently while CloudFormation deletion is already in progress", async () => {
  const { context } = await executionFixture();
  context.job.jobType = "cleanup";
  context.deployment.status = "rolling_back";
  context.appInstance.status = "active";
  await attachTenantResource(context);
  let cleanupCalls = 0;
  let awsFactoryCalls = 0;
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:delete-in-progress",
    config: { ...enabledConfig, applyEnabled: false, confirmation: "" },
    dependencies: {
      repository: inMemoryRepository({ context }),
      applyRuntimeReady: false,
      cleanupRuntimeReady: true,
      tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
      awsFactory: async () => {
        awsFactoryCalls += 1;
        throw new Error("cleanup retry must not construct an AWS adapter");
      },
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
      sharedCellSecurityPreflight: {
        verify: async () => {
          throw new Error("cleanup must bypass Shared Cell apply preflight");
        },
      },
      tenantDatabase: {
        ensureTenantDatabase: async () => {
          throw new Error("cleanup must bypass tenant database");
        },
        migrateTenantDatabase: async () => {
          throw new Error("cleanup must bypass tenant database");
        },
      },
      tenantResourceCleanup: {
        destroy: async () => {
          cleanupCalls += 1;
          throw Object.assign(
            new Error("CloudFormation workload deletion is still in progress."),
            {
              code: "CLOUDFORMATION_DELETE_IN_PROGRESS",
              retryable: true,
            },
          );
        },
      },
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now,
    },
  });
  assert.equal(result.status, "retry_scheduled");
  assert.equal(cleanupCalls, 1);
  assert.equal(awsFactoryCalls, 0);
});

test("a stale cleanup job makes zero external calls and cannot delete a newer generation", async () => {
  const { context } = await executionFixture();
  context.job.jobType = "cleanup";
  context.deployment.status = "ready";
  context.environment = {
    ...context.environment,
    applyEnabled: false,
    status: "inactive",
  };
  context.binding = { ...context.binding!, status: "inactive" };
  context.subscription = { id: "sub_one", status: "canceled" };
  await attachTenantResource(context, {
    ownerDeploymentId: "dep_new_generation_owner",
    generation: 2,
  });
  let cleanupCalls = 0;
  let awsFactoryCalls = 0;
  let databaseCalls = 0;
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:stale-cleanup-generation",
    config: { ...enabledConfig, applyEnabled: false, confirmation: "" },
    dependencies: {
      repository: inMemoryRepository({ context }),
      applyRuntimeReady: false,
      cleanupRuntimeReady: true,
      tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
      awsFactory: async () => {
        awsFactoryCalls += 1;
        throw new Error("stale cleanup must not construct an AWS adapter");
      },
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => {
          databaseCalls += 1;
          return {};
        },
        migrateTenantDatabase: async () => {
          databaseCalls += 1;
          return {};
        },
      },
      tenantResourceCleanup: {
        destroy: async () => {
          cleanupCalls += 1;
          throw new Error("stale cleanup reached an external adapter");
        },
      },
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now,
    },
  });
  assert.equal(result.status, "dead_letter");
  assert.equal(result.errorCode, "TENANT_RESOURCE_OWNER_STALE");
  assert.equal(cleanupCalls, 0);
  assert.equal(awsFactoryCalls, 0);
  assert.equal(databaseCalls, 0);
});

test("cleanup capability without an ownership coordinator stays disabled before claim", async () => {
  const context = await expiredCleanupContext();
  context.tenantExternalOperation = null;
  let cleanupCalls = 0;
  let awsFactoryCalls = 0;
  let claimCalls = 0;
  const baseRepository = inMemoryRepository({ context });
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:cleanup-epoch-inactive",
    config: { ...enabledConfig, applyEnabled: false, confirmation: "" },
    dependencies: {
      repository: {
        ...baseRepository,
        claimNext: async () => {
          claimCalls += 1;
          return context.job;
        },
      },
      applyRuntimeReady: false,
      cleanupRuntimeReady: true,
      awsFactory: async () => {
        awsFactoryCalls += 1;
        throw new Error("inactive cleanup epoch must not construct AWS");
      },
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => ({}),
        migrateTenantDatabase: async () => ({}),
      },
      tenantResourceCleanup: readyTenantResourceCleanup(() => {
        cleanupCalls += 1;
      }),
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now,
    },
  });
  assert.equal(result.status, "disabled");
  assert.equal(claimCalls, 0);
  assert.equal(cleanupCalls, 0);
  assert.equal(awsFactoryCalls, 0);
});

test("cleanup first installs and reloads an externally proven epoch before adapters", async () => {
  const context = await expiredCleanupContext();
  const activeFence = context.tenantExternalOperation!;
  context.tenantExternalOperation = null;
  const baseRepository = inMemoryRepository({ context });
  let coordinatorCalls = 0;
  let cleanupCalls = 0;
  const repository: DeploymentExecutionRepository = {
    ...baseRepository,
    loadContext: async () => context,
  };
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:cleanup-epoch-first-install",
    config: { ...enabledConfig, applyEnabled: false, confirmation: "" },
    dependencies: {
      repository,
      applyRuntimeReady: false,
      cleanupRuntimeReady: true,
      tenantExternalOperationCoordinator: {
        prepareAndActivate: async ({ intent, resourceFence, signal }) => {
          coordinatorCalls += 1;
          assert.equal(intent, "cleanup");
          assert.equal(signal.aborted, false);
          assert.deepEqual(resourceFence, activeFence.resourceFence);
          context.tenantExternalOperation = activeFence;
          return activeFence;
        },
      },
      awsFactory: async () => {
        throw new Error("cleanup coordinator owns all destructive adapters");
      },
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => ({}),
        migrateTenantDatabase: async () => ({}),
      },
      tenantResourceCleanup: readyTenantResourceCleanup(() => {
        cleanupCalls += 1;
      }),
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now,
    },
  });
  assert.equal(result.status, "succeeded");
  assert.equal(coordinatorCalls, 1);
  assert.equal(cleanupCalls, 1);
});

test("cleanup rejects an epoch that was returned but not durably reloaded", async () => {
  const context = await expiredCleanupContext();
  const activeFence = context.tenantExternalOperation!;
  context.tenantExternalOperation = null;
  let cleanupCalls = 0;
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:cleanup-epoch-not-persisted",
    config: { ...enabledConfig, applyEnabled: false, confirmation: "" },
    dependencies: {
      repository: inMemoryRepository({ context }),
      applyRuntimeReady: false,
      cleanupRuntimeReady: true,
      tenantExternalOperationCoordinator: {
        prepareAndActivate: async () => activeFence,
      },
      awsFactory: async () => {
        throw new Error("unpersisted epoch must not construct AWS");
      },
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => ({}),
        migrateTenantDatabase: async () => ({}),
      },
      tenantResourceCleanup: readyTenantResourceCleanup(() => {
        cleanupCalls += 1;
      }),
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now,
    },
  });
  assert.equal(result.status, "retry_scheduled");
  assert.equal(result.errorCode, "TENANT_CLEANUP_EXTERNAL_EPOCH_NOT_PERSISTED");
  assert.equal(cleanupCalls, 0);
});

test("standalone cleanup fails closed before AWS when the full coordinator is disabled", async () => {
  const { context } = await executionFixture();
  context.job.jobType = "cleanup";
  context.deployment.status = "ready";
  context.environment = {
    ...context.environment,
    applyEnabled: false,
    status: "inactive",
  };
  context.binding = { ...context.binding!, status: "inactive" };
  context.subscription = { id: "sub_one", status: "canceled" };
  await attachTenantResource(context);
  let awsFactoryCalls = 0;
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:cleanup-disabled",
    config: { ...enabledConfig, applyEnabled: false, confirmation: "" },
    dependencies: {
      repository: inMemoryRepository({ context }),
      applyRuntimeReady: false,
      cleanupRuntimeReady: true,
      awsFactory: async () => {
        awsFactoryCalls += 1;
        throw new Error("disabled cleanup must not construct AWS");
      },
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => ({}),
        migrateTenantDatabase: async () => ({}),
      },
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now,
    },
  });
  assert.equal(result.status, "disabled");
  assert.equal(awsFactoryCalls, 0);
});

test("cleanup with a non-allowlisted CloudFormation role makes zero AWS calls", async () => {
  const { context } = await executionFixture();
  context.job.jobType = "cleanup";
  context.deployment.status = "ready";
  context.binding = {
    ...context.binding!,
    cloudFormationRoleArn:
      "arn:aws:iam::402010193138:role/UnexpectedCloudFormationRole",
  };
  let awsFactoryCalls = 0;
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:cleanup-role-mismatch",
    config: { ...enabledConfig, applyEnabled: false, confirmation: "" },
    dependencies: {
      repository: inMemoryRepository({ context }),
      applyRuntimeReady: false,
      cleanupRuntimeReady: true,
      tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
      awsFactory: async () => {
        awsFactoryCalls += 1;
        return readyAwsPort();
      },
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => ({}),
        migrateTenantDatabase: async () => ({}),
      },
      tenantResourceCleanup: readyTenantResourceCleanup(),
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now,
    },
  });
  assert.equal(result.status, "retry_scheduled");
  assert.equal(awsFactoryCalls, 0);
});
