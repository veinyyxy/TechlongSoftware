import type { CloudFormationTenantStackPlan } from "../cloudformation/tenant-stack.ts";
import type { DeploymentEnvironment } from "../environment.ts";
import type { DeploymentJobType, DeploymentStatus } from "../state-machine.ts";
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
    status: string;
    slug: string;
    tenantKey: string;
    configurationSnapshot: Record<string, unknown>;
  };
  activeCellCount: number;
  activeTenantCount: number;
}

export interface DeploymentStepHandle {
  id: string;
  alreadySucceeded: boolean;
  previousOutput: Record<string, unknown>;
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
    deploymentId: string;
    environmentId: string;
    maxTenants: number;
    now: number;
  }): Promise<boolean>;
  confirmCleanupSchedule(input: {
    deploymentId: string;
    environmentId: string;
    stackName: string;
    expiresAt: number;
    providerScheduleRef: string;
    confirmedAt: number;
    now: number;
  }): Promise<DeploymentCleanupSchedule>;
  heartbeat(input: {
    jobId: string;
    workerId: string;
    now: number;
    leaseDurationMs: number;
  }): Promise<boolean>;
  transitionDeployment(input: {
    deploymentId: string;
    jobId: string;
    workerId: string;
    from: DeploymentStatus[];
    to: DeploymentStatus;
    currentStep: string;
    outputPatch?: Record<string, unknown>;
    now: number;
  }): Promise<boolean>;
  beginStep(input: {
    deploymentId: string;
    jobId: string;
    workerId: string;
    stepKey: string;
    inputHash: string;
    attempt: number;
    now: number;
  }): Promise<DeploymentStepHandle>;
  finishStep(input: {
    stepId: string;
    workerId: string;
    status: "succeeded" | "failed" | "skipped";
    output: Record<string, unknown>;
    errorCode?: string;
    errorMessage?: string;
    now: number;
  }): Promise<boolean>;
  enqueueJob(input: {
    deploymentId: string;
    jobType: DeploymentJobType;
    planHash: string;
    availableAt: number;
    maxAttempts: number;
    now: number;
  }): Promise<void>;
  completeJob(input: {
    jobId: string;
    workerId: string;
    now: number;
  }): Promise<boolean>;
  retryJob(input: {
    jobId: string;
    workerId: string;
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
    retryDelayMs: number;
    now: number;
  }): Promise<"retry_wait" | "dead_letter" | "lease_lost">;
  markReady(input: {
    deploymentId: string;
    appInstanceId: string;
    subscriptionId: string;
    jobId: string;
    workerId: string;
    accessUrl: string;
    controlPayloadHash: string;
    outputPatch: Record<string, unknown>;
    now: number;
  }): Promise<boolean>;
  markInstanceUnavailable(input: {
    deploymentId: string;
    appInstanceId: string;
    reason: "ttl_cleanup" | "rollback";
    now: number;
  }): Promise<void>;
  markCleanupStatus(input: {
    scheduleId: string;
    status: "running" | "succeeded" | "failed";
    errorMessage?: string;
    now: number;
  }): Promise<void>;
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
