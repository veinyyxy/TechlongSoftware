import {
  awsSandboxTenantStackName,
  renderAwsSandboxTenantStack,
  tenantStackExternalOperationTagKeys,
  tenantStackOperationTagKey,
  tenantStackStableOwnershipTagKeys,
} from "../cloudformation/tenant-stack.ts";
import { assertSafeDeploymentOutput, normalizeDeploymentError } from "../safety.ts";
import type { DeploymentJobType, DeploymentStatus } from "../state-machine.ts";
import type {
  ApplyReadyTenantStack,
  AwsDeploymentPort,
  CleanupSchedulePort,
  DeploymentJobLeaseFence,
  DeploymentExecutionContext,
  DeploymentExecutionRepository,
  DeploymentJobEnqueueResult,
  DeploymentTenantResourceLifecycleStatus,
  SaaSControlPort,
  SaaSControlPayloadCompilerPort,
  SharedCellSecurityPreflightPort,
  TenantDatabasePort,
  TenantExternalOperationFence,
  TenantResourceCleanupReceipt,
  TenantResourceFence,
} from "./contracts.ts";
import {
  assertExecutionGate,
  evaluateCleanupExecutionGate,
  evaluateAwsIdentityGate,
  evaluatePersistedExecutionGate,
  evaluateStaticExecutionGate,
  evaluateWorkerRuntimeGate,
  type DeploymentWorkerRuntimeConfig,
} from "./gates.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { finalizeTenantStackForApply } from "./parameters.ts";
import {
  assertTenantResourceFence,
  deriveTenantResourceIdentity,
} from "./tenant-database.ts";

export interface TenantExternalOwnershipCoordinatorPort {
  /**
   * Prepare a monotonic epoch, install it on the external resources, observe
   * the exact marker there, then activate the durable record. Provision can
   * reuse this boundary in the next slice; this slice only requests cleanup.
   */
  prepareAndActivate(input: {
    context: DeploymentExecutionContext;
    resourceFence: TenantResourceFence;
    lease: DeploymentJobLeaseFence;
    signal: AbortSignal;
  } & (
    | { intent: "provision" }
    | { intent: "cleanup"; cleanupReason: "ttl_cleanup" | "rollback" }
  )): Promise<TenantExternalOperationFence>;
}

export interface DeploymentWorkerDependencies {
  repository: DeploymentExecutionRepository;
  /**
   * Explicit, state-independent capability gate. This may only be true when
   * the tenant database, Shared Cell security, control client and payload
   * compiler adapters are all production-ready.
   */
  applyRuntimeReady: boolean;
  /** Explicit capability gate for the complete fenced cleanup coordinator. */
  cleanupRuntimeReady?: boolean;
  awsFactory(input: {
    region: string;
    workerRoleArn: string;
  }): Promise<AwsDeploymentPort>;
  cleanupScheduler: CleanupSchedulePort;
  sharedCellSecurityPreflight: SharedCellSecurityPreflightPort;
  tenantDatabase: TenantDatabasePort;
  /**
   * Full workload -> database/role -> secret cleanup boundary. When omitted,
   * cleanup and rollback fail closed before constructing an AWS adapter.
   */
  tenantResourceCleanup?: {
    destroy(input: {
      fence: TenantResourceFence;
      externalFence: TenantExternalOperationFence;
      lease: DeploymentJobLeaseFence;
      idempotencyKey: string;
      scheduleId: string | null;
      appInstanceId: string;
      reason: "ttl_cleanup" | "rollback";
      signal: AbortSignal;
    }): Promise<TenantResourceCleanupReceipt>;
  };
  /**
   * Provider-backed ownership epoch handoff. An implementation must prepare
   * the DB epoch, propagate it to every external resource, independently
   * observe the exact marker, and only then activate it in the repository.
   * The Worker never treats a prepared DB row as external proof.
   */
  tenantExternalOperationCoordinator?: TenantExternalOwnershipCoordinatorPort;
  controlClient: SaaSControlPort;
  controlPayloadCompiler: SaaSControlPayloadCompilerPort;
  /** Test seam; production cadence is capped at one third of the lease. */
  leaseHeartbeatIntervalMs?: number;
  now?: () => number;
}

export type DeploymentWorkerRunResult =
  | { status: "disabled"; failures: string[] }
  | { status: "idle" }
  | { status: "succeeded"; jobId: string; deploymentId: string }
  | {
      status: "retry_scheduled" | "dead_letter" | "lease_lost";
      jobId: string;
      deploymentId: string;
      errorCode: string;
    };

class DeploymentExecutionError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function executionError(error: unknown): DeploymentExecutionError {
  if (error instanceof DeploymentExecutionError) return error;
  const record =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const code =
    typeof record.code === "string"
      ? record.code.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100)
      : "DEPLOYMENT_EXECUTION_FAILED";
  const retryable = record.retryable !== false;
  return new DeploymentExecutionError(
    code,
    normalizeDeploymentError(
      error instanceof Error ? error.message : String(error),
      "Deployment execution failed.",
    ),
    retryable,
  );
}

function retryDelay(attempt: number): number {
  return Math.min(15 * 60_000, 15_000 * 2 ** Math.max(0, attempt - 1));
}

function assertContextIntegrity(
  context: DeploymentExecutionContext,
  options: { destructive: boolean },
): void {
  const payload = context.job.payload;
  if (
    payload.schemaVersion !== 1 ||
    payload.deploymentId !== context.deployment.id ||
    payload.planHash !== context.deployment.planHash
  ) {
    throw new DeploymentExecutionError(
      "JOB_PAYLOAD_MISMATCH",
      "Deployment job payload does not match the immutable deployment plan.",
      false,
    );
  }
  if (
    context.deployment.desiredPlan.mode !== "aws_sandbox" ||
    context.deployment.desiredPlan.safety.createsAwsResources ||
    context.deployment.desiredPlan.safety.storesSecretValues
  ) {
    throw new DeploymentExecutionError(
      "DEPLOYMENT_PLAN_UNSAFE",
      "Only a secret-free AWS Sandbox desired plan can execute.",
      false,
    );
  }
  const tags = context.deployment.desiredPlan.resources.tenant.costTags;
  if (
    tags.AppInstanceId !== context.appInstance.id ||
    tags.WorkspaceId !== context.workspace.id ||
    tags.ProductId !== context.appInstance.productId ||
    context.deployment.appInstanceId !== context.appInstance.id
  ) {
    throw new DeploymentExecutionError(
      "DEPLOYMENT_OWNERSHIP_MISMATCH",
      "Deployment plan ownership does not match its application instance.",
      false,
    );
  }
  if (!options.destructive) {
    if (
      context.workspace.status !== "active" ||
      !context.subscription ||
      context.subscription.status !== "active" ||
      context.subscription.id !== context.appInstance.subscriptionId
    ) {
      throw new DeploymentExecutionError(
        "SUBSCRIPTION_NOT_ACTIVE",
        "Workspace and matching subscription must remain active during deployment.",
        false,
      );
    }
    if (!["pending", "active"].includes(context.appInstance.status)) {
      throw new DeploymentExecutionError(
        "APP_INSTANCE_STATE_INVALID",
        "Application instance is not eligible for deployment execution.",
        false,
      );
    }
  }
  if (options.destructive) return;
  if (!/^[a-f0-9]{64}$/.test(context.deployment.configurationHash)) {
    throw new DeploymentExecutionError(
      "CONFIGURATION_HASH_INVALID",
      "Deployment configuration hash is invalid.",
      false,
    );
  }
  if (!context.deployment.artifactRef) {
    throw new DeploymentExecutionError(
      "IMAGE_DIGEST_MISSING",
      "Deployment has no immutable ECR image digest.",
      false,
    );
  }
}

async function assertHashes(
  context: DeploymentExecutionContext,
  options: { configuration: boolean },
): Promise<void> {
  const planHash = await sha256Hex(canonicalJson(context.deployment.desiredPlan));
  if (planHash !== context.deployment.planHash) {
    throw new DeploymentExecutionError(
      "PLAN_HASH_MISMATCH",
      "Stored deployment plan failed its integrity hash.",
      false,
    );
  }
  if (
    options.configuration &&
    await sha256Hex(canonicalJson(context.appInstance.configurationSnapshot)) !==
      context.deployment.configurationHash
  ) {
    throw new DeploymentExecutionError(
      "CONFIGURATION_DRIFT",
      "Application configuration changed after the deployment snapshot was created.",
      false,
    );
  }
}

function deploymentLease(
  context: DeploymentExecutionContext,
  workerId: string,
): DeploymentJobLeaseFence {
  return claimedJobLease(context.job, workerId);
}

function claimedJobLease(
  job: DeploymentExecutionContext["job"],
  workerId: string,
): DeploymentJobLeaseFence {
  return {
    jobId: job.id,
    deploymentId: job.deploymentId,
    workerId,
    attempt: job.attempt,
    leaseToken: job.leaseToken,
  };
}

function currentTenantResourceFence(
  context: DeploymentExecutionContext,
): TenantResourceFence {
  const record = context.tenantResources;
  if (!record) {
    throw new DeploymentExecutionError(
      "TENANT_RESOURCE_GENERATION_UNCLAIMED",
      "Tenant resources have no current generation fence.",
      false,
    );
  }
  const fence: TenantResourceFence = {
    schemaVersion: 1,
    identity: record.identity,
    generation: record.generation,
    ownerDeploymentId: record.ownerDeploymentId,
    ownershipMarker: record.ownershipMarker,
  };
  assertTenantResourceFence(fence);
  if (fence.ownerDeploymentId !== context.deployment.id) {
    throw new DeploymentExecutionError(
      "TENANT_RESOURCE_OWNER_STALE",
      "The deployment no longer owns the current tenant resource generation.",
      false,
    );
  }
  return fence;
}

interface PersistableTenantLifecycleOutput {
  externalEpoch: number;
  externalMarker: string;
  externalOperationHash: string;
  databaseName: string;
  roleName: string;
  ownershipMarker: string;
  resourceGeneration: number;
  resourceOwnerDeploymentId: string;
  secretRef: string;
  lifecycleState: "empty" | "baseline_restored" | "saas_migrated" | "verified";
  baselineDigest: string | null;
  migrationContract: "speedfeast-saas-control-v1" | null;
  evidenceHash: string;
}

function parseTenantLifecycleOutput(input: {
  output: Record<string, unknown>;
  context: DeploymentExecutionContext;
  fence: TenantResourceFence;
}): PersistableTenantLifecycleOutput {
  assertSafeDeploymentOutput(input.output);
  const expectedKeys = [
    "baselineDigest",
    "databaseName",
    "evidenceHash",
    "externalEpoch",
    "externalMarker",
    "externalOperationHash",
    "lifecycleState",
    "migrationContract",
    "ownershipMarker",
    "resourceGeneration",
    "resourceOwnerDeploymentId",
    "roleName",
    "secretRef",
  ].sort();
  if (canonicalJson(Object.keys(input.output).sort()) !== canonicalJson(expectedKeys)) {
    throw new DeploymentExecutionError(
      "TENANT_DATABASE_OUTPUT_INVALID",
      "Tenant database adapter returned missing or unexpected lifecycle fields.",
      false,
    );
  }
  const output = input.output as unknown as PersistableTenantLifecycleOutput;
  const stateToStatus: Record<
    PersistableTenantLifecycleOutput["lifecycleState"],
    DeploymentTenantResourceLifecycleStatus
  > = {
    empty: "database_empty",
    baseline_restored: "baseline_restored",
    saas_migrated: "saas_migrated",
    verified: "verified",
  };
  if (!(output.lifecycleState in stateToStatus)) {
    throw new DeploymentExecutionError(
      "TENANT_DATABASE_OUTPUT_INVALID",
      "Tenant database adapter returned an unsupported lifecycle state.",
      false,
    );
  }
  const escapedSecretName = input.fence.identity.secretName.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const expectedSecretRef = new RegExp(
    `^arn:aws:secretsmanager:${input.context.environment.region}:` +
      `${input.context.environment.expectedAccountId}:secret:` +
      `${escapedSecretName}-[A-Za-z0-9]{6}$`,
  );
  const externalFence = input.context.tenantExternalOperation;
  const expectedExternalMarker =
    `tl_epoch_${input.fence.identity.stableIdentityHash.slice(0, 24)}` +
    `_g${input.fence.generation}_e${externalFence?.epoch ?? 0}`;
  if (
    !externalFence ||
    externalFence.schemaVersion !== 1 ||
    externalFence.intent !== "provision" ||
    externalFence.state !== "active" ||
    externalFence.ownerDeploymentId !== input.fence.ownerDeploymentId ||
    !Number.isSafeInteger(externalFence.epoch) ||
    externalFence.epoch < 1 ||
    !/^[a-f0-9]{64}$/.test(externalFence.operationHash) ||
    canonicalJson(externalFence.resourceFence) !== canonicalJson(input.fence) ||
    externalFence.marker !== expectedExternalMarker ||
    output.externalEpoch !== externalFence.epoch ||
    output.externalMarker !== externalFence.marker ||
    output.externalOperationHash !== externalFence.operationHash ||
    output.databaseName !== input.fence.identity.databaseName ||
    output.roleName !== input.fence.identity.roleName ||
    output.ownershipMarker !== input.fence.ownershipMarker ||
    output.resourceGeneration !== input.fence.generation ||
    output.resourceOwnerDeploymentId !== input.fence.ownerDeploymentId ||
    typeof output.secretRef !== "string" ||
    !expectedSecretRef.test(output.secretRef) ||
    typeof output.evidenceHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(output.evidenceHash)
  ) {
    throw new DeploymentExecutionError(
      "TENANT_DATABASE_OUTPUT_FENCE_MISMATCH",
      "Tenant database lifecycle output does not match the current resource fence.",
      false,
    );
  }
  const hasBaseline = output.lifecycleState !== "empty";
  const hasMigration =
    output.lifecycleState === "saas_migrated" || output.lifecycleState === "verified";
  if (
    (hasBaseline
      ? typeof output.baselineDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(output.baselineDigest)
      : output.baselineDigest !== null) ||
    (hasMigration
      ? output.migrationContract !== "speedfeast-saas-control-v1"
      : output.migrationContract !== null)
  ) {
    throw new DeploymentExecutionError(
      "TENANT_DATABASE_OUTPUT_EVIDENCE_INVALID",
      "Tenant database lifecycle output has inconsistent baseline or migration evidence.",
      false,
    );
  }
  return output;
}

async function persistTenantLifecycleCheckpoint(input: {
  dependencies: DeploymentWorkerDependencies;
  context: DeploymentExecutionContext;
  workerId: string;
  output: Record<string, unknown>;
}): Promise<void> {
  const fence = currentTenantResourceFence(input.context);
  const parsed = parseTenantLifecycleOutput({
    output: input.output,
    context: input.context,
    fence,
  });
  const lifecycleStatus: DeploymentTenantResourceLifecycleStatus =
    parsed.lifecycleState === "empty"
      ? "database_empty"
      : parsed.lifecycleState;
  const persisted = await input.dependencies.repository.recordTenantResourceLifecycle({
    lease: deploymentLease(input.context, input.workerId),
    fence,
    externalFence: input.context.tenantExternalOperation!,
    runtimeSecretRef: parsed.secretRef,
    lifecycleStatus,
    baselineDigest: parsed.baselineDigest,
    migrationContract: parsed.migrationContract,
    evidenceHash: parsed.evidenceHash,
    evidence: {
      databaseName: parsed.databaseName,
      roleName: parsed.roleName,
      ownershipMarker: parsed.ownershipMarker,
      resourceGeneration: parsed.resourceGeneration,
      resourceOwnerDeploymentId: parsed.resourceOwnerDeploymentId,
      externalEpoch: parsed.externalEpoch,
      externalMarker: parsed.externalMarker,
      externalOperationHash: parsed.externalOperationHash,
      lifecycleState: parsed.lifecycleState,
      baselineDigest: parsed.baselineDigest,
      migrationContract: parsed.migrationContract,
    },
    now: (input.dependencies.now ?? Date.now)(),
  });
  if (!persisted) {
    throw new DeploymentExecutionError(
      "TENANT_RESOURCE_CHECKPOINT_REJECTED",
      "Tenant resource lifecycle checkpoint lost its lease or generation fence.",
      true,
    );
  }
}

/**
 * Claims (or revalidates) the durable app-instance generation under the live
 * job lease, then reloads the context. Every provisioning write boundary calls
 * this immediately before using a tenant database, Secret, control, or AWS
 * adapter. A superseded deployment therefore fails before the adapter call.
 */
async function claimAndReloadTenantResource(input: {
  dependencies: DeploymentWorkerDependencies;
  context: DeploymentExecutionContext;
  config: DeploymentWorkerRuntimeConfig;
  workerId: string;
}): Promise<{ context: DeploymentExecutionContext }> {
  const identity = await deriveTenantResourceIdentity(input.context);
  const claim = await input.dependencies.repository.claimTenantResourceGeneration({
    lease: deploymentLease(input.context, input.workerId),
    identity,
    now: (input.dependencies.now ?? Date.now)(),
  });
  assertTenantResourceFence(claim.fence);
  if (claim.fence.ownerDeploymentId !== input.context.deployment.id) {
    throw new DeploymentExecutionError(
      "TENANT_RESOURCE_CLAIM_REJECTED",
      "Tenant resource generation was not claimed by this deployment.",
      false,
    );
  }

  const refreshed = await input.dependencies.repository.loadContext(
    input.context.job,
  );
  assertContextIntegrity(refreshed, { destructive: false });
  await assertHashes(refreshed, { configuration: true });
  assertExecutionGate(
    evaluatePersistedExecutionGate({
      config: input.config,
      environment: refreshed.environment,
      binding: refreshed.binding,
    }),
  );
  assertTenantResourceFence(currentTenantResourceFence(refreshed), claim.fence);
  return {
    context: refreshed,
  };
}

function assertStackOwnership(input: {
  observation: { state: string; tags: Record<string, string> };
  expectedTags: Record<string, string>;
}): void {
  if (input.observation.state === "missing") return;
  for (const key of [
    ...tenantStackStableOwnershipTagKeys,
    ...tenantStackExternalOperationTagKeys,
    tenantStackOperationTagKey,
  ] as const) {
    if (input.observation.tags[key] !== input.expectedTags[key]) {
      throw new DeploymentExecutionError(
        "STACK_OWNERSHIP_MISMATCH",
        `Observed CloudFormation stack tag ${key} does not match the deployment.`,
        false,
      );
    }
  }
}

function tenantHostname(context: DeploymentExecutionContext): string {
  const slug = context.appInstance.slug.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) {
    throw new DeploymentExecutionError(
      "TENANT_SLUG_INVALID",
      "Tenant slug cannot be used as a sandbox hostname.",
      false,
    );
  }
  return `${slug}.${context.environment.baseDomain}`;
}

function listenerPriority(context: DeploymentExecutionContext): number {
  if (context.environment.kind === "aws_sandbox") return 100;
  throw new DeploymentExecutionError(
    "LISTENER_PRIORITY_ALLOCATOR_MISSING",
    "A production listener-priority allocator is not configured.",
    false,
  );
}

function renderApplyReadyStack(input: {
  context: DeploymentExecutionContext;
}): ApplyReadyTenantStack {
  const { context } = input;
  const fence = currentTenantResourceFence(context);
  const runtimeSecretRef = requireVerifiedRuntimeSecretRef(context, fence);
  if (!context.binding) {
    throw new DeploymentExecutionError(
      "EXECUTION_BINDING_MISSING",
      "Deployment environment has no active execution binding.",
      false,
    );
  }
  const rendered = renderAwsSandboxTenantStack({
    deploymentId: context.deployment.id,
    resourceGeneration: fence.generation,
    externalOperation: {
      epoch: context.tenantExternalOperation!.epoch,
      intent: "provision",
      ownerDeploymentId: context.tenantExternalOperation!.ownerDeploymentId,
      operationHash: context.tenantExternalOperation!.operationHash,
      marker: context.tenantExternalOperation!.marker,
      state: "active",
    },
    runtimeSecretRef,
    runtimeSecretName: fence.identity.secretName,
    plan: context.deployment.desiredPlan,
    environment: context.environment,
    imageUri: context.deployment.artifactRef,
    tenantHostname: tenantHostname(context),
    listenerPriority: listenerPriority(context),
    activeCellCount: context.activeCellCount,
    activeTenantCount: context.activeTenantCount,
    requestedAt: context.deployment.createdAt,
  });
  return finalizeTenantStackForApply({
    rendered,
    environment: context.environment,
    binding: context.binding,
    expectedRuntimeSecretName: fence.identity.secretName,
  });
}

function requireCurrentRuntimeSecretRef(
  context: DeploymentExecutionContext,
  fence: TenantResourceFence,
): string {
  const record = context.tenantResources;
  if (
    !record?.runtimeSecretRef ||
    record.ownerDeploymentId !== fence.ownerDeploymentId ||
    record.generation !== fence.generation ||
    record.ownershipMarker !== fence.ownershipMarker
  ) {
    throw new DeploymentExecutionError(
      "TENANT_RUNTIME_SECRET_UNAVAILABLE",
      "The current tenant resource generation has no verified runtime Secret reference.",
      true,
    );
  }
  return record.runtimeSecretRef;
}

function assertEnqueueOwnership(result: DeploymentJobEnqueueResult): void {
  if (result.outcome === "lease_lost") {
    throw new DeploymentExecutionError(
      "DEPLOYMENT_LEASE_LOST",
      "Deployment worker lost its lease while enqueueing follow-up work.",
      true,
    );
  }
  if (result.outcome === "rejected") {
    throw new DeploymentExecutionError(
      "DEPLOYMENT_JOB_ENQUEUE_REJECTED",
      "The follow-up deployment job could not be inserted or revalidated.",
      true,
    );
  }
}

function assertUsableCleanupJob(input: {
  result: DeploymentJobEnqueueResult;
  expiresAt: number;
  maxAttempts: number;
}): void {
  assertEnqueueOwnership(input.result);
  const usablePendingJob =
    (input.result.outcome === "inserted" ||
      input.result.outcome === "existing_active") &&
    input.result.status === "pending" &&
    input.result.availableAt === input.expiresAt &&
    input.result.attempts === 0 &&
    input.result.maxAttempts !== null &&
    input.result.maxAttempts >= input.maxAttempts;
  if (!usablePendingJob) {
    throw new DeploymentExecutionError(
      "CLEANUP_JOB_UNAVAILABLE",
      "A live pending cleanup job for the exact deployment deadline is required before external writes.",
      false,
    );
  }
}

function assertUsableFollowUpJob(result: DeploymentJobEnqueueResult): void {
  assertEnqueueOwnership(result);
  const activeStatuses = ["pending", "running", "retry_wait"];
  const usable =
    (result.outcome === "inserted" && result.status === "pending") ||
    (result.outcome === "existing_active" &&
      result.status !== null &&
      activeStatuses.includes(result.status) &&
      result.attempts !== null &&
      result.maxAttempts !== null &&
      result.attempts <= result.maxAttempts) ||
    (result.outcome === "existing_succeeded" && result.status === "succeeded");
  if (!usable) {
    throw new DeploymentExecutionError(
      "DEPLOYMENT_FOLLOWUP_JOB_UNAVAILABLE",
      "The deduplicated follow-up job is canceled, dead-lettered, or inconsistent.",
      false,
    );
  }
}

function requireVerifiedRuntimeSecretRef(
  context: DeploymentExecutionContext,
  fence: TenantResourceFence,
): string {
  const runtimeSecretRef = requireCurrentRuntimeSecretRef(context, fence);
  if (context.tenantResources?.lifecycleStatus !== "verified") {
    throw new DeploymentExecutionError(
      "TENANT_DATABASE_VERIFICATION_REQUIRED",
      "CloudFormation cannot run until the current tenant resource generation has a persisted verified database lifecycle checkpoint.",
      false,
    );
  }
  return runtimeSecretRef;
}

async function ensureApplyCleanupSchedule(input: {
  context: DeploymentExecutionContext;
  cleanupScheduler: CleanupSchedulePort;
  repository: DeploymentExecutionRepository;
  workerId: string;
  now: number;
}): Promise<void> {
  const { context } = input;
  const expiresAt = context.deployment.createdAt + context.environment.policy.ttlSeconds * 1_000;
  const stackName = awsSandboxTenantStackName(context.appInstance.id);
  const expectedScheduleRef = `cloudformation:${stackName}:TenantCleanupSchedule`;
  let schedule = context.cleanupSchedule;
  const confirmed =
    schedule?.status === "confirmed" &&
    schedule.providerScheduleRef === expectedScheduleRef &&
    schedule.expiresAt === expiresAt &&
    schedule.confirmedAt !== null;
  if (!confirmed && expiresAt <= input.now + 5 * 60_000) {
    throw new DeploymentExecutionError(
      "SANDBOX_TTL_EXPIRED",
      "Deployment is too close to its cleanup deadline to create AWS resources.",
      false,
    );
  }
  if (!confirmed) {
    const confirmation = await input.cleanupScheduler.confirmSchedule({
      deploymentId: context.deployment.id,
      stackName,
      expiresAt,
      expectedTags: {
        Environment: "aws-sandbox",
        ManagedBy: "techlong-provisioner",
        DeploymentId: context.deployment.id,
        ExpiresAt: new Date(expiresAt).toISOString(),
      },
    });
    if (confirmation.providerScheduleRef !== expectedScheduleRef) {
      throw new DeploymentExecutionError(
        "CLEANUP_SCHEDULE_UNCONFIRMED",
        "Cleanup schedule provider reference does not match the rendered guardrail.",
        false,
      );
    }
    schedule = await input.repository.confirmCleanupSchedule({
      lease: deploymentLease(context, input.workerId),
      environmentId: context.environment.id,
      stackName,
      expiresAt,
      providerScheduleRef: confirmation.providerScheduleRef,
      confirmedAt: confirmation.confirmedAt,
      now: input.now,
    });
    context.cleanupSchedule = schedule;
  }
  if (
    !schedule ||
    schedule.status !== "confirmed" ||
    schedule.providerScheduleRef !== expectedScheduleRef ||
    schedule.expiresAt !== expiresAt ||
    schedule.confirmedAt === null
  ) {
    throw new DeploymentExecutionError(
      "CLEANUP_SCHEDULE_UNCONFIRMED",
      "A confirmed two-hour cleanup schedule is required before AWS execution.",
      false,
    );
  }
  const cleanupJob = await input.repository.enqueueJob({
    lease: deploymentLease(context, input.workerId),
    deploymentId: context.deployment.id,
    jobType: "cleanup",
    planHash: context.deployment.planHash,
    availableAt: expiresAt,
    maxAttempts: 20,
    now: input.now,
  });
  assertUsableCleanupJob({
    result: cleanupJob,
    expiresAt,
    maxAttempts: 20,
  });
}

async function heartbeat(input: {
  dependencies: DeploymentWorkerDependencies;
  context: DeploymentExecutionContext;
  config: DeploymentWorkerRuntimeConfig;
  workerId: string;
  now: number;
}): Promise<void> {
  const renewed = await input.dependencies.repository.heartbeat({
    lease: deploymentLease(input.context, input.workerId),
    now: input.now,
    leaseDurationMs: input.config.leaseDurationMs,
  });
  if (!renewed) {
    throw new DeploymentExecutionError(
      "DEPLOYMENT_LEASE_LOST",
      "Deployment worker lost its lease before an external operation.",
      true,
    );
  }
}

async function withLeaseGuard<T>(input: {
  dependencies: DeploymentWorkerDependencies;
  context: DeploymentExecutionContext;
  config: DeploymentWorkerRuntimeConfig;
  workerId: string;
  execute(signal: AbortSignal): Promise<T>;
}): Promise<T> {
  const controller = new AbortController();
  const intervalMs = Math.max(
    5,
    Math.min(
      Math.floor(input.config.leaseDurationMs / 3),
      input.dependencies.leaseHeartbeatIntervalMs ?? Number.POSITIVE_INFINITY,
    ),
  );
  let stopped = false;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  let renewal: Promise<void> | null = null;
  let rejectLost!: (error: DeploymentExecutionError) => void;
  const lost = new Promise<never>((_resolve, reject) => {
    rejectLost = reject;
  });
  // Initial renewal happens before Promise.race is installed. Keep the loss
  // promise observed so a very slow first renewal cannot surface as an
  // unhandled rejection while still failing the renewal itself below.
  void lost.catch(() => undefined);
  const leaseLost = () =>
    new DeploymentExecutionError(
      "DEPLOYMENT_LEASE_LOST",
      "Deployment worker lost its lease during an external operation.",
      true,
    );
  const stop = (): void => {
    stopped = true;
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    if (deadlineTimer) clearTimeout(deadlineTimer);
    heartbeatTimer = null;
    deadlineTimer = null;
  };
  const lose = (error: DeploymentExecutionError): void => {
    if (stopped || controller.signal.aborted) return;
    controller.abort(error);
    stop();
    rejectLost(error);
  };
  const armDeadline = (remainingMs: number): void => {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    deadlineTimer = setTimeout(
      () => lose(leaseLost()),
      Math.max(1, Math.floor(remainingMs)),
    );
  };
  const renew = (): Promise<void> => {
    if (renewal) return renewal;
    // The database starts the new lease from its own clock when it processes
    // the heartbeat. Measuring from request dispatch is conservative: network
    // and query latency are subtracted instead of accidentally extending the
    // local deadline beyond the database lease.
    const requestedAt = globalThis.performance.now();
    renewal = heartbeat({
      dependencies: input.dependencies,
      context: input.context,
      config: input.config,
      workerId: input.workerId,
      now: (input.dependencies.now ?? Date.now)(),
    })
      .then(() => {
        const elapsedMs = Math.max(0, globalThis.performance.now() - requestedAt);
        const remainingMs = input.config.leaseDurationMs - elapsedMs;
        if (remainingMs <= 0) {
          const error = leaseLost();
          lose(error);
          throw error;
        }
        if (!stopped) armDeadline(remainingMs);
      })
      .finally(() => {
        renewal = null;
      });
    return renewal;
  };
  const schedule = (): void => {
    if (stopped) return;
    heartbeatTimer = setTimeout(() => {
      void renew().then(schedule).catch((error) => lose(executionError(error)));
    }, intervalMs);
  };

  await renew();
  schedule();
  try {
    const output = await Promise.race([input.execute(controller.signal), lost]);
    await renew();
    if (controller.signal.aborted) throw leaseLost();
    return output;
  } finally {
    stop();
  }
}

async function checkpoint<T extends object>(input: {
  dependencies: DeploymentWorkerDependencies;
  context: DeploymentExecutionContext;
  config: DeploymentWorkerRuntimeConfig;
  workerId: string;
  stepKey: string;
  stepInput: Record<string, unknown>;
  execute(signal: AbortSignal): Promise<T>;
}): Promise<T> {
  const now = (input.dependencies.now ?? Date.now)();
  const inputHash = await sha256Hex(input.stepInput);
  const handle = await input.dependencies.repository.beginStep({
    lease: deploymentLease(input.context, input.workerId),
    stepKey: input.stepKey,
    inputHash,
    now,
  });
  if (handle.alreadySucceeded) return handle.previousOutput as unknown as T;
  try {
    const output = await withLeaseGuard({
      dependencies: input.dependencies,
      context: input.context,
      config: input.config,
      workerId: input.workerId,
      execute: input.execute,
    });
    assertSafeDeploymentOutput(output as unknown as Record<string, unknown>);
    const finished = await input.dependencies.repository.finishStep({
      lease: deploymentLease(input.context, input.workerId),
      stepId: handle.id,
      status: "succeeded",
      output: output as unknown as Record<string, unknown>,
      now: (input.dependencies.now ?? Date.now)(),
    });
    if (!finished) {
      throw new DeploymentExecutionError(
        "DEPLOYMENT_LEASE_LOST",
        "Deployment worker lost its lease while finishing a checkpoint.",
        true,
      );
    }
    return output;
  } catch (error) {
    const normalized = executionError(error);
    await input.dependencies.repository.finishStep({
      lease: deploymentLease(input.context, input.workerId),
      stepId: handle.id,
      status: "failed",
      output: {},
      errorCode: normalized.code,
      errorMessage: normalized.message,
      now: (input.dependencies.now ?? Date.now)(),
    });
    throw normalized;
  }
}

async function moveState(input: {
  dependencies: DeploymentWorkerDependencies;
  context: DeploymentExecutionContext;
  workerId: string;
  from: DeploymentStatus[];
  to: DeploymentStatus;
  currentStep: string;
  outputPatch?: Record<string, unknown>;
}): Promise<void> {
  if (input.context.deployment.status === input.to) return;
  if (!input.from.includes(input.context.deployment.status)) {
    throw new DeploymentExecutionError(
      "DEPLOYMENT_STATE_CONFLICT",
      `Deployment is ${input.context.deployment.status}, expected ${input.from.join(" or ")}.`,
      true,
    );
  }
  const changed = await input.dependencies.repository.transitionDeployment({
    lease: deploymentLease(input.context, input.workerId),
    from: input.from,
    to: input.to,
    currentStep: input.currentStep,
    outputPatch: input.outputPatch,
    now: (input.dependencies.now ?? Date.now)(),
  });
  if (!changed) {
    throw new DeploymentExecutionError(
      "DEPLOYMENT_LEASE_LOST",
      "Deployment transition failed because the state or lease changed.",
      true,
    );
  }
  input.context.deployment.status = input.to;
}

async function validateIdentity(input: {
  dependencies: DeploymentWorkerDependencies;
  context: DeploymentExecutionContext;
  config: DeploymentWorkerRuntimeConfig;
  workerId: string;
  aws: AwsDeploymentPort;
  phase?: "initial" | "prewrite";
}): Promise<void> {
  if (!input.context.binding) throw new Error("Execution binding is missing.");
  const identity = await checkpoint({
    ...input,
    stepKey:
      input.phase === "prewrite"
        ? "sts_identity_prewrite"
        : "sts_identity_preflight",
    stepInput: {
      accountId: input.context.environment.expectedAccountId,
      region: input.context.environment.region,
      workerRoleArn: input.context.binding.workerRoleArn,
    },
    execute: (signal) => input.aws.getCallerIdentity({ signal }),
  });
  assertExecutionGate(
    evaluateAwsIdentityGate({
      config: input.config,
      environment: input.context.environment,
      binding: input.context.binding,
      identity,
      adapterRegion: input.aws.region,
    }),
  );
}

async function validateSharedCellSecurity(input: {
  dependencies: DeploymentWorkerDependencies;
  context: DeploymentExecutionContext;
  config: DeploymentWorkerRuntimeConfig;
  workerId: string;
  phase?: "initial" | "prewrite";
}): Promise<void> {
  if (!input.context.binding) throw new Error("Execution binding is missing.");
  const proof = await checkpoint({
    ...input,
    stepKey:
      input.phase === "prewrite"
        ? "shared_cell_security_prewrite"
        : "shared_cell_security_preflight",
    stepInput: {
      environmentId: input.context.environment.id,
      accountId: input.context.environment.expectedAccountId,
      region: input.context.environment.region,
      bindingHash: await sha256Hex(input.context.binding.tenantStackParameters),
    },
    execute: (signal) =>
      input.dependencies.sharedCellSecurityPreflight.verify({
        environment: input.context.environment,
        binding: input.context.binding!,
        signal,
      }),
  });
  if (proof.verified !== true || !/^[a-f0-9]{64}$/.test(proof.evidenceHash)) {
    throw new DeploymentExecutionError(
      "SHARED_CELL_SECURITY_PREFLIGHT_INVALID",
      "Shared Cell security preflight did not return a valid verified proof.",
      false,
    );
  }
}

async function reserveEnvironmentCapacity(input: {
  dependencies: DeploymentWorkerDependencies;
  context: DeploymentExecutionContext;
  workerId: string;
}): Promise<void> {
  const reserved = await input.dependencies.repository.reserveEnvironmentCapacity({
    lease: deploymentLease(input.context, input.workerId),
    environmentId: input.context.environment.id,
    maxTenants: input.context.environment.policy.maxTenants,
    now: (input.dependencies.now ?? Date.now)(),
  });
  if (!reserved) {
    throw new DeploymentExecutionError(
      "SANDBOX_CAPACITY_UNAVAILABLE",
      "The deployment environment has no atomically reserved tenant capacity.",
      true,
    );
  }
}

async function requireActiveProvisionEpoch(input: {
  dependencies: DeploymentWorkerDependencies;
  context: DeploymentExecutionContext;
  config: DeploymentWorkerRuntimeConfig;
  workerId: string;
}): Promise<DeploymentExecutionContext> {
  let context = input.context;
  const resourceFence = currentTenantResourceFence(context);
  const exactActive = (candidate: TenantExternalOperationFence | null): boolean =>
    Boolean(
      candidate &&
        candidate.intent === "provision" &&
        candidate.state === "active" &&
        canonicalJson(candidate.resourceFence) === canonicalJson(resourceFence),
    );
  if (!exactActive(context.tenantExternalOperation)) {
    const coordinator = input.dependencies.tenantExternalOperationCoordinator;
    if (!coordinator) {
      throw new DeploymentExecutionError(
        "TENANT_PROVISION_EXTERNAL_EPOCH_INACTIVE",
        "Provisioning requires an externally proven active epoch for the current tenant resource generation.",
        false,
      );
    }
    const activated = await withLeaseGuard({
      dependencies: input.dependencies,
      context,
      config: input.config,
      workerId: input.workerId,
      execute: (signal) =>
        coordinator.prepareAndActivate({
          intent: "provision",
          context,
          resourceFence,
          lease: deploymentLease(context, input.workerId),
          signal,
        }),
    });
    if (!exactActive(activated)) {
      throw new DeploymentExecutionError(
        "TENANT_PROVISION_EXTERNAL_EPOCH_UNVERIFIED",
        "The ownership coordinator did not return the exact active provision epoch.",
        false,
      );
    }
    context = await input.dependencies.repository.loadContext(context.job);
    if (
      !exactActive(context.tenantExternalOperation) ||
      canonicalJson(context.tenantExternalOperation) !== canonicalJson(activated)
    ) {
      throw new DeploymentExecutionError(
        "TENANT_PROVISION_EXTERNAL_EPOCH_NOT_PERSISTED",
        "The externally proven provision epoch was not durably reloaded.",
        true,
      );
    }
  }
  const activeFence = context.tenantExternalOperation;
  if (!activeFence || !exactActive(activeFence)) {
    throw new DeploymentExecutionError(
      "TENANT_PROVISION_EXTERNAL_EPOCH_INACTIVE",
      "Provisioning has no exact active external-operation epoch.",
      false,
    );
  }
  const stillOwned = await input.dependencies.repository.assertTenantExternalOperation({
    lease: deploymentLease(context, input.workerId),
    externalFence: activeFence,
    requiredState: "active",
    now: (input.dependencies.now ?? Date.now)(),
  });
  if (!stillOwned) {
    throw new DeploymentExecutionError(
      "TENANT_PROVISION_EXTERNAL_EPOCH_LOST",
      "Provisioning no longer owns its active external-operation epoch.",
      true,
    );
  }
  return context;
}

async function guardProvisionEpochBeforeAdapterFactory(input: {
  dependencies: DeploymentWorkerDependencies;
  context: DeploymentExecutionContext;
  workerId: string;
  jobType: DeploymentJobType;
}): Promise<void> {
  const resourceFence = currentTenantResourceFence(input.context);
  const candidate = input.context.tenantExternalOperation;
  const exactActive = Boolean(
    candidate &&
      candidate.intent === "provision" &&
      candidate.state === "active" &&
      canonicalJson(candidate.resourceFence) === canonicalJson(resourceFence),
  );
  const firstApplyStage =
    input.jobType === "apply" &&
    ["planned", "queued", "preflight", "database_preparing"].includes(
      input.context.deployment.status,
    );
  if (!exactActive) {
    if (firstApplyStage && input.dependencies.tenantExternalOperationCoordinator) {
      // Provider installation must occur only after STS identity and Shared
      // Cell read-only preflight inside handleApply.
      return;
    }
    throw new DeploymentExecutionError(
      "TENANT_PROVISION_EXTERNAL_EPOCH_INACTIVE",
      "This deployment stage requires an already active provision epoch before constructing runtime adapters.",
      false,
    );
  }
  const current = await input.dependencies.repository.assertTenantExternalOperation({
    lease: deploymentLease(input.context, input.workerId),
    externalFence: candidate!,
    requiredState: "active",
    now: (input.dependencies.now ?? Date.now)(),
  });
  if (!current) {
    throw new DeploymentExecutionError(
      "TENANT_PROVISION_EXTERNAL_EPOCH_LOST",
      "The persisted provision epoch is no longer active under this lease.",
      true,
    );
  }
}

async function handleApply(input: {
  dependencies: DeploymentWorkerDependencies;
  context: DeploymentExecutionContext;
  config: DeploymentWorkerRuntimeConfig;
  workerId: string;
  aws: AwsDeploymentPort;
  stack?: ApplyReadyTenantStack;
}): Promise<void> {
  if (["planned", "retry_wait"].includes(input.context.deployment.status)) {
    await moveState({
      ...input,
      from: ["planned", "retry_wait"],
      to: "queued",
      currentStep: "queued",
    });
  }
  if (input.context.deployment.status === "queued") {
    await moveState({
      ...input,
      from: ["queued"],
      to: "preflight",
      currentStep: "preflight",
    });
  }
  await validateIdentity(input);
  await validateSharedCellSecurity(input);
  input.context = await requireActiveProvisionEpoch(input);
  await reserveEnvironmentCapacity(input);
  if (["waiting_healthy", "configuring", "verifying", "ready"].includes(input.context.deployment.status)) {
    const reconcileJob = await input.dependencies.repository.enqueueJob({
      lease: deploymentLease(input.context, input.workerId),
      deploymentId: input.context.deployment.id,
      jobType: "reconcile",
      planHash: input.context.deployment.planHash,
      availableAt: (input.dependencies.now ?? Date.now)(),
      maxAttempts: 20,
      now: (input.dependencies.now ?? Date.now)(),
    });
    assertUsableFollowUpJob(reconcileJob);
    return;
  }
  if (input.context.deployment.status === "preflight") {
    await moveState({
      ...input,
      from: ["preflight"],
      to: "database_preparing",
      currentStep: "database_preparing",
    });
  }
  if (input.context.deployment.status === "database_preparing") {
    input.context = (await claimAndReloadTenantResource(input)).context;
    input.context = await requireActiveProvisionEpoch(input);
    const prepared = await checkpoint({
      ...input,
      stepKey: "tenant_database_prepare",
      stepInput: {
        databaseName: input.context.deployment.desiredPlan.resources.tenant.database.databaseName,
        roleName: input.context.deployment.desiredPlan.resources.tenant.database.roleName,
        planHash: input.context.deployment.planHash,
      },
      execute: (signal) =>
        input.dependencies.tenantDatabase.ensureTenantDatabase({
          context: input.context,
          externalFence: input.context.tenantExternalOperation!,
          idempotencyKey: `${input.context.deployment.id}:database`,
          signal,
        }),
    });
    await persistTenantLifecycleCheckpoint({
      dependencies: input.dependencies,
      context: input.context,
      workerId: input.workerId,
      output: prepared,
    });
    await moveState({
      ...input,
      from: ["database_preparing"],
      to: "migrating",
      currentStep: "migrating",
    });
  }
  if (input.context.deployment.status === "migrating") {
    input.context = (await claimAndReloadTenantResource(input)).context;
    input.context = await requireActiveProvisionEpoch(input);
    const migrated = await checkpoint({
      ...input,
      stepKey: "tenant_database_migrate",
      stepInput: {
        databaseName: input.context.deployment.desiredPlan.resources.tenant.database.databaseName,
        migrationContract: "speedfeast-pg16.14-baseline-plus-migrate-saas-v1",
      },
      execute: (signal) =>
        input.dependencies.tenantDatabase.migrateTenantDatabase({
          context: input.context,
          externalFence: input.context.tenantExternalOperation!,
          idempotencyKey: `${input.context.deployment.id}:migration:v1`,
          signal,
        }),
    });
    await persistTenantLifecycleCheckpoint({
      dependencies: input.dependencies,
      context: input.context,
      workerId: input.workerId,
      output: migrated,
    });
    input.context = (await claimAndReloadTenantResource(input)).context;
    requireVerifiedRuntimeSecretRef(
      input.context,
      currentTenantResourceFence(input.context),
    );
    await moveState({
      ...input,
      from: ["migrating"],
      to: "infrastructure_provisioning",
      currentStep: "cloudformation_apply",
    });
  }
  if (input.context.deployment.status !== "infrastructure_provisioning") {
    throw new DeploymentExecutionError(
      "DEPLOYMENT_STATE_CONFLICT",
      `Apply job cannot resume from ${input.context.deployment.status}.`,
      false,
    );
  }
  await heartbeat({
    dependencies: input.dependencies,
    context: input.context,
    config: input.config,
    workerId: input.workerId,
    now: (input.dependencies.now ?? Date.now)(),
  });
  const claimed = await claimAndReloadTenantResource(input);
  const refreshed = claimed.context;
  if (refreshed.deployment.status !== "infrastructure_provisioning") {
    throw new DeploymentExecutionError(
      "DEPLOYMENT_STATE_CONFLICT",
      "Deployment state changed before the CloudFormation write boundary.",
      true,
    );
  }
  input.context = refreshed;
  input.context = await requireActiveProvisionEpoch(input);
  const stack = renderApplyReadyStack({
    context: input.context,
  });
  await ensureApplyCleanupSchedule({
    context: input.context,
    cleanupScheduler: input.dependencies.cleanupScheduler,
    repository: input.dependencies.repository,
    workerId: input.workerId,
    now: (input.dependencies.now ?? Date.now)(),
  });
  await validateIdentity({ ...input, phase: "prewrite" });
  await validateSharedCellSecurity({ ...input, phase: "prewrite" });
  await reserveEnvironmentCapacity(input);
  const currentTime = (input.dependencies.now ?? Date.now)();
  const expiresAt =
    input.context.deployment.createdAt +
    input.context.environment.policy.ttlSeconds * 1_000;
  if (expiresAt <= currentTime + 5 * 60_000) {
    const existing = await checkpoint({
      ...input,
      stepKey: "cloudformation_precreate_observe",
      stepInput: { stackName: stack.stackName, expiresAt },
      execute: (signal) =>
        input.aws.describeTenantStack(stack.stackName, { signal }),
    });
    assertStackOwnership({ observation: existing, expectedTags: stack.tags });
    if (existing.state !== "ready" && existing.state !== "in_progress") {
      throw new DeploymentExecutionError(
        "SANDBOX_TTL_EXPIRED",
        "Refusing to create or update a tenant stack near or after its cleanup deadline.",
        false,
      );
    }
    await moveState({
      ...input,
      from: ["infrastructure_provisioning"],
      to: "waiting_healthy",
      currentStep: "cloudformation_wait",
      outputPatch: {
        stackName: stack.stackName,
        stackId: existing.stackId,
        stackOperation: "existing_near_ttl",
      },
    });
    const reconcileJob = await input.dependencies.repository.enqueueJob({
      lease: deploymentLease(input.context, input.workerId),
      deploymentId: input.context.deployment.id,
      jobType: "reconcile",
      planHash: input.context.deployment.planHash,
      availableAt: currentTime,
      maxAttempts: 20,
      now: currentTime,
    });
    assertUsableFollowUpJob(reconcileJob);
    return;
  }
  const applied = await checkpoint({
    ...input,
    stepKey: "cloudformation_apply",
    stepInput: {
      stackName: stack.stackName,
      clientRequestToken: stack.clientRequestToken,
      templateHash: await sha256Hex(stack.templateBody),
      parameterHash: await sha256Hex(stack.parameters),
    },
    execute: (signal) => input.aws.applyTenantStack(stack, { signal }),
  });
  await moveState({
    ...input,
    from: ["infrastructure_provisioning"],
    to: "waiting_healthy",
    currentStep: "cloudformation_wait",
    outputPatch: {
      stackName: stack.stackName,
      stackId: applied.stackId,
      stackOperation: applied.operation,
      cleanupScheduleRef: `cloudformation:${stack.stackName}:TenantCleanupSchedule`,
    },
  });
  const reconcileJob = await input.dependencies.repository.enqueueJob({
    lease: deploymentLease(input.context, input.workerId),
    deploymentId: input.context.deployment.id,
    jobType: "reconcile",
    planHash: input.context.deployment.planHash,
    availableAt: (input.dependencies.now ?? Date.now)() + 15_000,
    maxAttempts: 20,
    now: (input.dependencies.now ?? Date.now)(),
  });
  assertUsableFollowUpJob(reconcileJob);
}

async function handleReconcile(input: {
  dependencies: DeploymentWorkerDependencies;
  context: DeploymentExecutionContext;
  config: DeploymentWorkerRuntimeConfig;
  workerId: string;
  aws: AwsDeploymentPort;
  stack: ApplyReadyTenantStack;
}): Promise<void> {
  if (input.context.deployment.status === "ready") return;
  await validateIdentity(input);
  await validateSharedCellSecurity(input);
  input.context = await requireActiveProvisionEpoch(input);
  input.stack = renderApplyReadyStack({ context: input.context });
  await reserveEnvironmentCapacity(input);
  const observation = await checkpoint({
    ...input,
    stepKey: "cloudformation_observe",
    stepInput: {
      stackName: input.stack.stackName,
      reconcileAttempt: input.context.job.attempt,
    },
    execute: (signal) =>
      input.aws.describeTenantStack(input.stack.stackName, { signal }),
  });
  assertStackOwnership({ observation, expectedTags: input.stack.tags });
  if (observation.state === "in_progress") {
    throw new DeploymentExecutionError(
      "CLOUDFORMATION_IN_PROGRESS",
      `CloudFormation is still ${observation.rawStatus ?? "in progress"}.`,
      true,
    );
  }
  if (observation.state !== "ready") {
    throw new DeploymentExecutionError(
      "CLOUDFORMATION_NOT_READY",
      `CloudFormation stack is ${observation.rawStatus ?? observation.state}.`,
      observation.state === "delete_in_progress",
    );
  }
  if (input.context.deployment.status === "infrastructure_provisioning") {
    await moveState({
      ...input,
      from: ["infrastructure_provisioning"],
      to: "waiting_healthy",
      currentStep: "waiting_healthy",
      outputPatch: { stackName: input.stack.stackName, stackId: observation.stackId },
    });
  }
  if (input.context.deployment.status === "waiting_healthy") {
    const health = await checkpoint({
      ...input,
      stepKey: "control_health",
      stepInput: { hostname: input.stack.parameters.TenantHostname },
      execute: (signal) =>
        input.dependencies.controlClient.waitUntilHealthy({
          appInstanceId: input.context.appInstance.id,
          hostname: input.stack.parameters.TenantHostname,
          externalFence: input.context.tenantExternalOperation!,
          signal,
        }),
    });
    if (!health.ready) {
      throw new DeploymentExecutionError(
        "TENANT_NOT_HEALTHY",
        "Tenant control endpoint is not healthy yet.",
        true,
      );
    }
    await moveState({
      ...input,
      from: ["waiting_healthy"],
      to: "configuring",
      currentStep: "control_provision",
    });
  }
  if (input.context.deployment.status === "configuring") {
    const claimed = await claimAndReloadTenantResource(input);
    input.context = await requireActiveProvisionEpoch({
      dependencies: input.dependencies,
      context: claimed.context,
      config: input.config,
      workerId: input.workerId,
    });
    if (input.context.deployment.status !== "configuring") {
      throw new DeploymentExecutionError(
        "DEPLOYMENT_STATE_CONFLICT",
        "Deployment state changed before the SaaS control write boundary.",
        true,
      );
    }
    input.stack = renderApplyReadyStack({
      context: input.context,
    });
    await checkpoint({
      ...input,
      stepKey: "control_provision",
      stepInput: {
        configurationHash: input.context.deployment.configurationHash,
        hostname: input.stack.parameters.TenantHostname,
      },
      execute: async (signal) => {
        const compiled = await input.dependencies.controlPayloadCompiler.compile({
          context: input.context,
          configurationHash: input.context.deployment.configurationHash,
          externalFence: input.context.tenantExternalOperation!,
          signal,
        });
        if (compiled.configurationHash !== input.context.deployment.configurationHash) {
          throw new DeploymentExecutionError(
            "CONTROL_PAYLOAD_HASH_MISMATCH",
            "Compiled SaaS payload does not match the immutable configuration hash.",
            false,
          );
        }
        await input.dependencies.controlClient.provision({
          appInstanceId: input.context.appInstance.id,
          hostname: input.stack.parameters.TenantHostname,
          idempotencyKey: `${input.context.deployment.id}:${input.context.deployment.configurationHash}`,
          compiledPayload: compiled.compiledPayload,
          externalFence: input.context.tenantExternalOperation!,
          signal,
        });
        return { accepted: true };
      },
    });
    await moveState({
      ...input,
      from: ["configuring"],
      to: "verifying",
      currentStep: "control_verify",
    });
  }
  if (input.context.deployment.status !== "verifying") {
    throw new DeploymentExecutionError(
      "DEPLOYMENT_STATE_CONFLICT",
      `Reconcile job cannot verify from ${input.context.deployment.status}.`,
      false,
    );
  }
  const verified = await checkpoint({
    ...input,
    stepKey: "control_verify",
    stepInput: {
      configurationHash: input.context.deployment.configurationHash,
      imageRevision: input.context.deployment.artifactRef.split("@").at(-1),
    },
    execute: (signal) =>
      input.dependencies.controlClient.readConfiguration({
        appInstanceId: input.context.appInstance.id,
        hostname: input.stack.parameters.TenantHostname,
        externalFence: input.context.tenantExternalOperation!,
        signal,
      }),
  });
  const expectedImageRevision = input.context.deployment.artifactRef.split("@").at(-1) ?? null;
  if (
    !verified.ready ||
    verified.desiredConfigurationHash !== input.context.deployment.configurationHash ||
    verified.imageRevision !== expectedImageRevision
  ) {
    throw new DeploymentExecutionError(
      "CONTROL_RECONCILIATION_FAILED",
      "Health, configuration hash, or image revision did not reconcile.",
      true,
    );
  }
  const accessUrl = `https://${input.stack.parameters.TenantHostname}`;
  const ready = await input.dependencies.repository.markReady({
    lease: deploymentLease(input.context, input.workerId),
    appInstanceId: input.context.appInstance.id,
    subscriptionId: input.context.subscription?.id ?? "",
    accessUrl,
    controlPayloadHash: input.context.deployment.configurationHash,
    outputPatch: {
      stackName: input.stack.stackName,
      stackId: observation.stackId,
      tenantHostname: input.stack.parameters.TenantHostname,
      imageRevision: verified.imageRevision,
      desiredConfigurationHash: verified.desiredConfigurationHash,
    },
    now: (input.dependencies.now ?? Date.now)(),
  });
  if (!ready) {
    throw new DeploymentExecutionError(
      "DEPLOYMENT_READY_COMMIT_FAILED",
      "Atomic ready/active commit was rejected by current state or lease.",
      true,
    );
  }
  input.context.deployment.status = "ready";
}

async function handleDelete(input: {
  dependencies: DeploymentWorkerDependencies;
  context: DeploymentExecutionContext;
  config: DeploymentWorkerRuntimeConfig;
  workerId: string;
}): Promise<void> {
  const cleanup = input.dependencies.tenantResourceCleanup;
  if (!cleanup) {
    throw new DeploymentExecutionError(
      "TENANT_RESOURCE_CLEANUP_DISABLED",
      "The complete fenced workload, database, and secret cleanup boundary is not configured.",
      false,
    );
  }
  let context = input.context;
  const fence = currentTenantResourceFence(context);
  if (
    input.context.tenantResources?.lifecycleStatus === "destroyed" &&
    ["rolled_back", "canceled"].includes(input.context.deployment.status) &&
    input.context.appInstance.status === "suspended" &&
    (!input.context.cleanupSchedule ||
      input.context.cleanupSchedule.status === "succeeded")
  ) {
    // The coordinator finalizes resource, schedule, deployment, instance and
    // capacity in one transaction. A worker may crash immediately afterward,
    // before completing the queue job; that retry has no external work left.
    return;
  }
  let externalFence = context.tenantExternalOperation;
  const exactActiveCleanupFence = (
    candidate: TenantExternalOperationFence | null,
  ): candidate is TenantExternalOperationFence =>
    Boolean(
      candidate &&
        candidate.intent === "cleanup" &&
        candidate.state === "active" &&
        canonicalJson(candidate.resourceFence) === canonicalJson(fence),
    );
  if (!exactActiveCleanupFence(externalFence)) {
    const coordinator = input.dependencies.tenantExternalOperationCoordinator;
    if (!coordinator) {
      throw new DeploymentExecutionError(
        "TENANT_CLEANUP_EXTERNAL_EPOCH_INACTIVE",
        "Cleanup requires an externally proven active cleanup epoch for the current tenant resource generation.",
        false,
      );
    }
    const activated = await withLeaseGuard({
      dependencies: input.dependencies,
      context,
      config: input.config,
      workerId: input.workerId,
      execute: (signal) =>
        coordinator.prepareAndActivate({
          intent: "cleanup",
          cleanupReason:
            context.job.jobType === "cleanup" ? "ttl_cleanup" : "rollback",
          context,
          resourceFence: fence,
          lease: deploymentLease(context, input.workerId),
          signal,
        }),
    });
    if (!exactActiveCleanupFence(activated)) {
      throw new DeploymentExecutionError(
        "TENANT_CLEANUP_EXTERNAL_EPOCH_UNVERIFIED",
        "The ownership coordinator did not return the exact active cleanup epoch.",
        false,
      );
    }
    context = await input.dependencies.repository.loadContext(context.job);
    externalFence = context.tenantExternalOperation;
    if (
      !exactActiveCleanupFence(externalFence) ||
      canonicalJson(externalFence) !== canonicalJson(activated)
    ) {
      throw new DeploymentExecutionError(
        "TENANT_CLEANUP_EXTERNAL_EPOCH_NOT_PERSISTED",
        "The externally proven cleanup epoch was not durably reloaded under the current job.",
        true,
      );
    }
  }
  if (
    !exactActiveCleanupFence(externalFence)
  ) {
    throw new DeploymentExecutionError(
      "TENANT_CLEANUP_EXTERNAL_EPOCH_INACTIVE",
      "Cleanup requires an externally proven active cleanup epoch for the current tenant resource generation.",
      false,
    );
  }
  const lease = deploymentLease(context, input.workerId);
  await withLeaseGuard({
    dependencies: input.dependencies,
    context,
    config: input.config,
    workerId: input.workerId,
    execute: (signal) =>
      cleanup.destroy({
        fence,
        externalFence,
        lease,
        idempotencyKey: `${context.deployment.id}:generation:${fence.generation}:cleanup`,
        scheduleId: context.cleanupSchedule?.id ?? null,
        appInstanceId: context.appInstance.id,
        reason: context.job.jobType === "cleanup" ? "ttl_cleanup" : "rollback",
        signal,
      }),
  });
}

export async function runDeploymentWorkerOnce(input: {
  workerId: string;
  config: DeploymentWorkerRuntimeConfig;
  dependencies: DeploymentWorkerDependencies;
}): Promise<DeploymentWorkerRunResult> {
  const workerGate = evaluateWorkerRuntimeGate(input.config);
  if (!workerGate.ok) return { status: "disabled", failures: workerGate.failures };
  const staticApplyGate = evaluateStaticExecutionGate(input.config);
  const applicationExecutionReady =
    staticApplyGate.ok &&
    input.dependencies.applyRuntimeReady &&
    Boolean(input.dependencies.tenantExternalOperationCoordinator);
  const cleanupExecutionReady =
    input.dependencies.cleanupRuntimeReady === true &&
    Boolean(input.dependencies.tenantResourceCleanup) &&
    Boolean(input.dependencies.tenantExternalOperationCoordinator);
  if (!applicationExecutionReady && !cleanupExecutionReady) {
    return {
      status: "disabled",
      failures: [
        "No apply/reconcile or complete fenced cleanup runtime is enabled.",
      ],
    };
  }
  const allowedJobTypes: DeploymentJobType[] = [];
  if (applicationExecutionReady) allowedJobTypes.push("apply", "reconcile");
  if (cleanupExecutionReady) allowedJobTypes.push("cleanup", "rollback");
  const now = (input.dependencies.now ?? Date.now)();
  const job = await input.dependencies.repository.claimNext({
    workerId: input.workerId,
    now,
    leaseDurationMs: input.config.leaseDurationMs,
    jobTypes: allowedJobTypes,
  });
  if (!job) return { status: "idle" };
  if (
    (job.jobType === "apply" || job.jobType === "reconcile") &&
    !applicationExecutionReady
  ) {
    const result = await input.dependencies.repository.retryJob({
      lease: claimedJobLease(job, input.workerId),
      errorCode: "APPLY_RUNTIME_ADAPTERS_DISABLED",
      errorMessage:
        "Apply/reconcile adapters are not configured; only cleanup work is enabled.",
      retryable: true,
      retryDelayMs: retryDelay(job.attempt),
      now: (input.dependencies.now ?? Date.now)(),
    });
    return {
      status:
        result === "retry_wait"
          ? "retry_scheduled"
          : result === "dead_letter"
            ? "dead_letter"
            : "lease_lost",
      jobId: job.id,
      deploymentId: job.deploymentId,
      errorCode: "APPLY_RUNTIME_ADAPTERS_DISABLED",
    };
  }
  let context: DeploymentExecutionContext | null = null;
  try {
    context = await input.dependencies.repository.loadContext(job);
    const destructive = job.jobType === "cleanup" || job.jobType === "rollback";
    assertContextIntegrity(context, { destructive });
    await assertHashes(context, { configuration: !destructive });
    assertExecutionGate(
      destructive
        ? evaluateCleanupExecutionGate({
            config: input.config,
            environment: context.environment,
            binding: context.binding,
          })
        : evaluatePersistedExecutionGate({
            config: input.config,
            environment: context.environment,
            binding: context.binding,
          }),
    );
    if (destructive) {
      // The coordinator performs its atomic begin/assert/complete CAS before
      // each workload, database, and secret adapter call. No AWS adapter is
      // even constructed for a stale generation or an unconfigured cleanup.
      await handleDelete({
        dependencies: input.dependencies,
        context,
        config: input.config,
        workerId: input.workerId,
      });
    } else {
      const claimed = await claimAndReloadTenantResource({
        dependencies: input.dependencies,
        context,
        config: input.config,
        workerId: input.workerId,
      });
      context = claimed.context;
      await guardProvisionEpochBeforeAdapterFactory({
        dependencies: input.dependencies,
        context,
        workerId: input.workerId,
        jobType: job.jobType,
      });
      if (
        job.jobType === "apply" &&
        !["waiting_healthy", "configuring", "verifying", "ready"].includes(
          context.deployment.status,
        )
      ) {
        await ensureApplyCleanupSchedule({
          context,
          cleanupScheduler: input.dependencies.cleanupScheduler,
          repository: input.dependencies.repository,
          workerId: input.workerId,
          now,
        });
      }
      if (!context.binding) throw new Error("Execution binding is missing.");
      // The SDK adapter is intentionally not constructed until every local,
      // persisted, parameter, generation and cleanup gate above has passed.
      const aws = await input.dependencies.awsFactory({
        region: context.environment.region,
        workerRoleArn: context.binding.workerRoleArn,
      });
      const handlerInput = {
        dependencies: input.dependencies,
        context,
        config: input.config,
        workerId: input.workerId,
        aws,
      };
      if (job.jobType === "apply") {
        await handleApply(handlerInput);
      } else {
        await handleReconcile({
          ...handlerInput,
          stack: renderApplyReadyStack({ context }),
        });
      }
    }
    const completed = await input.dependencies.repository.completeJob({
      lease: claimedJobLease(job, input.workerId),
      now: (input.dependencies.now ?? Date.now)(),
    });
    if (!completed) {
      return {
        status: "lease_lost",
        jobId: job.id,
        deploymentId: job.deploymentId,
        errorCode: "DEPLOYMENT_LEASE_LOST",
      };
    }
    return { status: "succeeded", jobId: job.id, deploymentId: job.deploymentId };
  } catch (error) {
    const normalized = executionError(error);
    const result = await input.dependencies.repository.retryJob({
      lease: claimedJobLease(job, input.workerId),
      cleanupScheduleId: context?.cleanupSchedule?.id ?? null,
      errorCode: normalized.code,
      errorMessage: normalized.message,
      retryable: normalized.retryable,
      retryDelayMs: retryDelay(job.attempt),
      now: (input.dependencies.now ?? Date.now)(),
    });
    return {
      status:
        result === "retry_wait"
          ? "retry_scheduled"
          : result === "dead_letter"
            ? "dead_letter"
            : "lease_lost",
      jobId: job.id,
      deploymentId: job.deploymentId,
      errorCode: normalized.code,
    };
  }
}
