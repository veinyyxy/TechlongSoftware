import type { CloudFormationTenantStackPlan } from "../cloudformation/tenant-stack.ts";
import type { DeploymentEnvironment } from "../environment.ts";
import type {
  DeploymentJobStatus,
  DeploymentJobType,
  DeploymentStatus,
} from "../state-machine.ts";
import type { AwsEcsCellDeploymentPlan } from "../types.ts";

export interface DeploymentExecutionBinding {
  environmentId: string;
  workerRoleArn: string;
  cloudFormationRoleArn: string;
  tenantStackParameters: Record<string, string>;
  status: "active" | "inactive";
}

export interface DeploymentCleanupSchedule {
  id: string;
  deploymentId: string;
  status: "pending" | "confirmed" | "running" | "succeeded" | "failed" | "canceled";
  expiresAt: number;
  providerScheduleRef: string | null;
  confirmedAt: number | null;
}

export interface ClaimedDeploymentJob {
  id: string;
  deploymentId: string;
  jobType: DeploymentJobType;
  payload: Record<string, unknown>;
  attempt: number;
  maxAttempts: number;
  leaseExpiresAt: number;
  /** Unique incarnation generated for every successful claim/takeover. */
  leaseToken: string;
}

/**
 * Exact database lease incarnation required by every state-changing repository
 * call. `workerId` alone is deliberately insufficient because a process name
 * may be reused after a crash or restart.
 */
export interface DeploymentJobLeaseFence {
  jobId: string;
  deploymentId: string;
  workerId: string;
  attempt: number;
  leaseToken: string;
}

export interface DeploymentExecutionContext {
  job: ClaimedDeploymentJob;
  deployment: {
    id: string;
    appInstanceId: string;
    environmentId: string;
    status: DeploymentStatus;
    planHash: string;
    configurationHash: string;
    artifactRef: string;
    desiredPlan: AwsEcsCellDeploymentPlan;
    createdAt: number;
  };
  environment: DeploymentEnvironment;
  binding: DeploymentExecutionBinding | null;
  cleanupSchedule: DeploymentCleanupSchedule | null;
  workspace: {
    id: string;
    status: string;
  };
  subscription: {
    id: string;
    status: string;
  } | null;
  appInstance: {
    id: string;
    workspaceId: string;
    productId: string;
    subscriptionId: string | null;
    /** Immutable schema/configuration binding captured before deployment. */
    templateVersionId: string;
    status: string;
    slug: string;
    tenantKey: string;
    configurationSnapshot: Record<string, unknown>;
  };
  /** Durable, reference-only lifecycle checkpoint for tenant-owned resources. */
  tenantResources: DeploymentTenantResourceRecord | null;
  activeCellCount: number;
  activeTenantCount: number;
}

export interface DeploymentStepHandle {
  id: string;
  alreadySucceeded: boolean;
  previousOutput: Record<string, unknown>;
}

export interface DeploymentJobEnqueueResult {
  outcome:
    | "inserted"
    | "existing_active"
    | "existing_succeeded"
    | "existing_unusable"
    | "lease_lost"
    | "rejected";
  jobId: string | null;
  status: DeploymentJobStatus | null;
  availableAt: number | null;
  attempts: number | null;
  maxAttempts: number | null;
}

export interface DeploymentExecutionRepository {
  claimNext(input: {
    workerId: string;
    now: number;
    leaseDurationMs: number;
    jobTypes: DeploymentJobType[];
  }): Promise<ClaimedDeploymentJob | null>;
  loadContext(job: ClaimedDeploymentJob): Promise<DeploymentExecutionContext>;
  reserveEnvironmentCapacity(input: {
    lease: DeploymentJobLeaseFence;
    environmentId: string;
    maxTenants: number;
    now: number;
  }): Promise<boolean>;
  confirmCleanupSchedule(input: {
    lease: DeploymentJobLeaseFence;
    environmentId: string;
    stackName: string;
    expiresAt: number;
    providerScheduleRef: string;
    confirmedAt: number;
    now: number;
  }): Promise<DeploymentCleanupSchedule>;
  heartbeat(input: {
    lease: DeploymentJobLeaseFence;
    now: number;
    leaseDurationMs: number;
  }): Promise<boolean>;
  transitionDeployment(input: {
    lease: DeploymentJobLeaseFence;
    from: DeploymentStatus[];
    to: DeploymentStatus;
    currentStep: string;
    outputPatch?: Record<string, unknown>;
    now: number;
  }): Promise<boolean>;
  beginStep(input: {
    lease: DeploymentJobLeaseFence;
    stepKey: string;
    inputHash: string;
    now: number;
  }): Promise<DeploymentStepHandle>;
  finishStep(input: {
    lease: DeploymentJobLeaseFence;
    stepId: string;
    status: "succeeded" | "failed" | "skipped";
    output: Record<string, unknown>;
    errorCode?: string;
    errorMessage?: string;
    now: number;
  }): Promise<boolean>;
  enqueueJob(input: {
    lease: DeploymentJobLeaseFence;
    deploymentId: string;
    jobType: DeploymentJobType;
    planHash: string;
    availableAt: number;
    maxAttempts: number;
    now: number;
  }): Promise<DeploymentJobEnqueueResult>;
  completeJob(input: {
    lease: DeploymentJobLeaseFence;
    now: number;
  }): Promise<boolean>;
  retryJob(input: {
    lease: DeploymentJobLeaseFence;
    cleanupScheduleId?: string | null;
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
    retryDelayMs: number;
    now: number;
  }): Promise<"retry_wait" | "dead_letter" | "lease_lost">;
  markReady(input: {
    lease: DeploymentJobLeaseFence;
    appInstanceId: string;
    subscriptionId: string;
    accessUrl: string;
    controlPayloadHash: string;
    outputPatch: Record<string, unknown>;
    now: number;
  }): Promise<boolean>;
  markInstanceUnavailable(input: {
    lease: DeploymentJobLeaseFence;
    fence: TenantResourceFence;
    appInstanceId: string;
    reason: "ttl_cleanup" | "rollback";
    now: number;
  }): Promise<boolean>;
  markCleanupStatus(input: {
    lease: DeploymentJobLeaseFence;
    scheduleId: string;
    status: "running" | "succeeded" | "failed";
    errorMessage?: string;
    now: number;
  }): Promise<boolean>;
  /**
   * Atomically persists a sanitized lifecycle checkpoint while the caller owns
   * the live deployment-job lease. Immutable identity conflicts fail closed.
   */
  recordTenantResourceLifecycle(
    input: DeploymentTenantResourceLifecycleWrite,
  ): Promise<boolean>;
  claimTenantResourceGeneration(input: {
    lease: DeploymentJobLeaseFence;
    identity: TenantResourceIdentity;
    now: number;
  }): Promise<TenantResourceGenerationClaim>;
  beginTenantResourceCleanup(input: {
    fence: TenantResourceFence;
    lease: DeploymentJobLeaseFence;
    now: number;
  }): Promise<TenantResourceFence | null>;
  assertTenantResourceCleanupFence(input: {
    fence: TenantResourceFence;
    lease: DeploymentJobLeaseFence;
    phase: TenantResourceCleanupFencePhase;
    now: number;
  }): Promise<boolean>;
  completeTenantResourceCleanup(input: {
    fence: TenantResourceFence;
    lease: DeploymentJobLeaseFence;
    receipt: TenantResourceCleanupReceipt;
    now: number;
  }): Promise<boolean>;
}

export interface AwsCallerIdentity {
  accountId: string;
  arn: string;
}

export type CloudFormationStackState =
  | "missing"
  | "in_progress"
  | "ready"
  | "failed"
  | "delete_in_progress";

export interface CloudFormationStackObservation {
  state: CloudFormationStackState;
  rawStatus: string | null;
  stackId: string | null;
  outputs: Record<string, string>;
  tags: Record<string, string>;
}

export interface ApplyReadyTenantStack
  extends Omit<CloudFormationTenantStackPlan, "safety"> {
  parameters: Record<string, string>;
  cloudFormationRoleArn: string;
  safety: Omit<
    CloudFormationTenantStackPlan["safety"],
    "renderOnly" | "applyReady"
  > & {
    renderOnly: false;
    applyReady: true;
  };
}

export interface AwsDeploymentPort {
  readonly region: string;
  getCallerIdentity(): Promise<AwsCallerIdentity>;
  applyTenantStack(stack: ApplyReadyTenantStack): Promise<{
    operation: "create" | "update" | "no_change" | "existing_in_progress";
    stackId: string;
  }>;
  describeTenantStack(stackName: string): Promise<CloudFormationStackObservation>;
  deleteTenantStack(input: {
    stackName: string;
    clientRequestToken: string;
    expectedTags: Record<string, string>;
    cloudFormationRoleArn: string;
  }): Promise<{ operation: "delete" | "delete_in_progress" | "already_deleted" }>;
}

export interface TenantDatabasePort {
  ensureTenantDatabase(input: {
    context: DeploymentExecutionContext;
    idempotencyKey: string;
  }): Promise<Record<string, unknown>>;
  migrateTenantDatabase(input: {
    context: DeploymentExecutionContext;
    idempotencyKey: string;
  }): Promise<Record<string, unknown>>;
}

/**
 * Immutable tenant ownership data used at every database and Secret boundary.
 * Only references and evidence may leave an adapter; secret material is never
 * part of this contract.
 */
export interface TenantResourceIdentity {
  schemaVersion: 1;
  appInstanceId: string;
  workspaceId: string;
  productId: string;
  environmentId: string;
  cellKey: string;
  databaseName: string;
  roleName: string;
  secretName: string;
  stableIdentityHash: string;
}

/**
 * Generation is an external-resource incarnation, not a deployment attempt.
 * This offline foundation deliberately forbids a live resource from handing
 * ownerDeploymentId to another deployment. Only a fully destroyed resource
 * may reopen under the same stable names with generation + 1 and a new marker.
 * A future live handoff requires an externally observable ownership epoch.
 */
export interface TenantResourceFence {
  schemaVersion: 1;
  identity: TenantResourceIdentity;
  generation: number;
  ownerDeploymentId: string;
  ownershipMarker: string;
}

export type DeploymentTenantResourceLifecycleStatus =
  | "planned"
  | "reopening"
  | "secret_ready"
  | "database_empty"
  | "baseline_restored"
  | "saas_migrated"
  | "verified"
  | "destroying"
  | "destroyed"
  | "failed";

/**
 * Safe persisted checkpoint. runtimeSecretRef is a provider reference only;
 * evidence must never contain a secret value, credential, password, or URL.
 */
export interface DeploymentTenantResourceRecord {
  identity: TenantResourceIdentity;
  generation: number;
  ownershipMarker: string;
  createdByDeploymentId: string;
  ownerDeploymentId: string;
  runtimeSecretRef: string | null;
  lifecycleStatus: DeploymentTenantResourceLifecycleStatus;
  baselineDigest: string | null;
  migrationContract: "speedfeast-saas-control-v1" | null;
  evidenceHash: string | null;
  evidence: Record<string, unknown>;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  destroyedAt: number | null;
}

export interface DeploymentTenantResourceLifecycleWrite {
  lease: DeploymentJobLeaseFence;
  fence: TenantResourceFence;
  runtimeSecretRef: string | null;
  lifecycleStatus: DeploymentTenantResourceLifecycleStatus;
  baselineDigest: string | null;
  migrationContract: "speedfeast-saas-control-v1" | null;
  evidenceHash: string | null;
  evidence: Record<string, unknown>;
  lastError?: string | null;
  now: number;
}

export interface TenantResourceGenerationClaim {
  outcome: "created" | "reused" | "reopened";
  /**
   * Durable owner observed by the atomic claim. It is retained for audit of a
   * destroyed-generation reopen; live same-generation handoff is forbidden.
   */
  previousOwnerDeploymentId: string | null;
  fence: TenantResourceFence;
  record: DeploymentTenantResourceRecord;
}

export type TenantResourceCleanupFencePhase =
  | "before_workload"
  | "before_database"
  | "before_secret"
  | "before_complete";

export type TenantDatabaseLifecycleState =
  | "missing"
  | "partial"
  | "empty"
  | "baseline_restored"
  | "saas_migrated"
  | "verified";

export interface TenantDatabaseInspection {
  fence: TenantResourceFence;
  state: TenantDatabaseLifecycleState;
  databaseExists: boolean;
  roleExists: boolean;
  databaseOwnershipMarker: string | null;
  roleOwnershipMarker: string | null;
  baselineDigest: string | null;
  migrationContract: string | null;
  evidenceHash: string;
}

export interface TenantApprovedBaseline {
  contract: "speedfeast-pg16.14-tenant-baseline-v1";
  archiveS3Uri: string;
  archiveSha256: string;
  approvedArchiveSha256: string;
  manifestS3Uri: string;
  manifestSha256: string;
  sourceDatabase: string;
}

export interface TenantDatabaseMutationReceipt {
  fence: TenantResourceFence;
  operation:
    | "prepare_empty_database"
    | "restore_approved_baseline"
    | "migrate_saas"
    | "verify";
  outcome: "applied" | "already_applied";
  resultingState: Exclude<TenantDatabaseLifecycleState, "missing" | "partial">;
  evidenceHash: string;
}

export interface TenantDatabaseDestroyReceipt {
  fence: TenantResourceFence;
  outcome: "deleted" | "already_missing";
  databaseDeleted: boolean;
  roleDeleted: boolean;
  evidenceHash: string;
}

export interface TenantSecretReceipt {
  fence: TenantResourceFence;
  outcome: "created" | "already_exists";
  secretRef: string;
  ownershipMarker: string;
  versionRef: string;
}

export interface TenantSecretInspection {
  fence: TenantResourceFence;
  state: "missing" | "present";
  secretRef: string | null;
  ownershipMarker: string | null;
  versionRef: string | null;
}

export interface TenantSecretDestroyReceipt {
  fence: TenantResourceFence;
  outcome: "deleted" | "already_missing";
  ownershipMarker: string;
}

/**
 * Reviewed Cell database adapter boundary. Implementations may use an RDS
 * administrator connection or one-shot ECS migration tasks, but accept only
 * secret references and must never return passwords, URLs, or secret values.
 */
export interface TenantDatabaseLifecyclePort {
  inspect(input: {
    fence: TenantResourceFence;
  }): Promise<TenantDatabaseInspection>;
  prepareEmptyDatabase(input: {
    fence: TenantResourceFence;
    runtimeSecretRef: string;
    idempotencyKey: string;
  }): Promise<TenantDatabaseMutationReceipt>;
  restoreApprovedBaseline(input: {
    fence: TenantResourceFence;
    runtimeSecretRef: string;
    baseline: TenantApprovedBaseline;
    idempotencyKey: string;
  }): Promise<TenantDatabaseMutationReceipt>;
  migrateSaas(input: {
    fence: TenantResourceFence;
    runtimeSecretRef: string;
    command: "/usr/local/bin/node db/apply_saas_control.js";
    migrationContract: "speedfeast-saas-control-v1";
    idempotencyKey: string;
  }): Promise<TenantDatabaseMutationReceipt>;
  verify(input: {
    fence: TenantResourceFence;
    expectedBaselineDigest: string;
    expectedMigrationContract: "speedfeast-saas-control-v1";
  }): Promise<TenantDatabaseMutationReceipt>;
  destroy(input: {
    fence: TenantResourceFence;
    idempotencyKey: string;
  }): Promise<TenantDatabaseDestroyReceipt>;
}

/**
 * The adapter generates and stores material inside the secret provider. Its
 * API intentionally has no raw secret input/output shape.
 */
export interface TenantSecretStorePort {
  inspectRuntimeSecret(input: {
    fence: TenantResourceFence;
  }): Promise<TenantSecretInspection>;
  ensureRuntimeSecret(input: {
    fence: TenantResourceFence;
    idempotencyKey: string;
  }): Promise<TenantSecretReceipt>;
  destroyRuntimeSecret(input: {
    fence: TenantResourceFence;
    idempotencyKey: string;
  }): Promise<TenantSecretDestroyReceipt>;
}

export interface TenantWorkloadDestroyReceipt {
  fence: TenantResourceFence;
  outcome: "deleted" | "already_missing";
  ownershipMarker: string;
}

export interface TenantWorkloadLifecyclePort {
  destroy(input: {
    fence: TenantResourceFence;
    idempotencyKey: string;
  }): Promise<TenantWorkloadDestroyReceipt>;
}

export interface TenantResourceCleanupReceipt {
  fence: TenantResourceFence;
  order: readonly ["workload", "database", "secret"];
  workloadOutcome: TenantWorkloadDestroyReceipt["outcome"];
  databaseOutcome: TenantDatabaseDestroyReceipt["outcome"];
  secretOutcome: TenantSecretDestroyReceipt["outcome"];
  databaseEvidenceHash: string;
}

export interface TenantResourceCleanupFencePort {
  beginTenantResourceCleanup(input: {
    fence: TenantResourceFence;
    lease: DeploymentJobLeaseFence;
    now: number;
  }): Promise<TenantResourceFence | null>;
  assertTenantResourceCleanupFence(input: {
    fence: TenantResourceFence;
    lease: DeploymentJobLeaseFence;
    phase: TenantResourceCleanupFencePhase;
    now: number;
  }): Promise<boolean>;
  completeTenantResourceCleanup(input: {
    fence: TenantResourceFence;
    lease: DeploymentJobLeaseFence;
    receipt: TenantResourceCleanupReceipt;
    now: number;
  }): Promise<boolean>;
}

export interface SharedCellSecurityPreflightPort {
  verify(input: {
    environment: DeploymentEnvironment;
    binding: DeploymentExecutionBinding;
  }): Promise<{ verified: true; evidenceHash: string }>;
}

export interface SaaSControlObservation {
  ready: boolean;
  desiredConfigurationHash: string | null;
  imageRevision: string | null;
}

export interface SaaSControlPort {
  waitUntilHealthy(input: {
    appInstanceId: string;
    hostname: string;
  }): Promise<SaaSControlObservation>;
  provision(input: {
    appInstanceId: string;
    hostname: string;
    idempotencyKey: string;
    compiledPayload: Record<string, unknown>;
  }): Promise<{ accepted: true }>;
  readConfiguration(input: {
    appInstanceId: string;
    hostname: string;
  }): Promise<SaaSControlObservation>;
}

export interface SaaSControlPayloadCompilerPort {
  compile(input: {
    context: DeploymentExecutionContext;
    configurationHash: string;
  }): Promise<{
    compiledPayload: Record<string, unknown>;
    configurationHash: string;
  }>;
}

export interface CleanupSchedulePort {
  confirmSchedule(input: {
    deploymentId: string;
    stackName: string;
    expiresAt: number;
    expectedTags: Record<string, string>;
  }): Promise<{ providerScheduleRef: string; confirmedAt: number }>;
}
