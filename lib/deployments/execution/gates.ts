import {
  validateDeploymentEnvironment,
  type DeploymentEnvironment,
} from "../environment.ts";
import type {
  AwsCallerIdentity,
  DeploymentExecutionBinding,
  DeploymentExecutionContext,
} from "./contracts.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "./first-onboarding-baseline-versions.ts";
import { FIRST_OPEN_SECOND_SLOT, type FirstOpenSecondSlotApproval } from "./first-open-second-slot.ts";

export const AWS_SANDBOX_CONFIRMATION_PHRASE =
  "I_ACKNOWLEDGE_AWS_SANDBOX_COST_AND_TTL";
export const AWS_SANDBOX_PROVISIONER_ROLE_NAME =
  "TechlongSandboxProvisionerRole";
export const AWS_SANDBOX_CLOUDFORMATION_ROLE_NAME =
  "TechlongSandboxCloudFormationExecutionRole";

const ecsFirstOpenAccount = "402010193138";
const ecsFirstOpenRegion = "ca-central-1";
const ecsFirstOpenEnvironmentKey = "aws-sandbox-ca-central-1";
export const ECS_FIRST_OPEN_RDS_ENVIRONMENT_ID = "env_aws_sandbox_ca_central_1";
const ecsFirstOpenRdsRole = `arn:aws:iam::${ecsFirstOpenAccount}:role/TechlongSandboxFirstOpenTaskRole`;
const ecsFirstOpenSharedRole = `arn:aws:iam::${ecsFirstOpenAccount}:role/${AWS_SANDBOX_PROVISIONER_ROLE_NAME}`;
const ecsFirstOpenAuthorityBrand: unique symbol = Symbol("ecs-first-open-rds");
const ecsFirstOpenAuthorities = new WeakSet<object>();

type EcsFirstOpenExecutionScope = Readonly<{
  executionId: string;
  jobId: string;
  instanceId: string;
  workspaceId: string;
  writeBefore: number;
}>;
type EcsFirstOpenTaskScope = Readonly<{ taskArn: string; taskDefinitionArn: string; roleArn: string }>;
export type EcsFirstOpenRdsAuthority = EcsFirstOpenExecutionScope & EcsFirstOpenTaskScope &
  { readonly [ecsFirstOpenAuthorityBrand]: true };

/** Only the prepared ECS entry calls this after local task attestation, the
 * exact durable dispatch ACK and reviewed resource binding. */
export function createEcsFirstOpenRdsAuthority(input: EcsFirstOpenExecutionScope & EcsFirstOpenTaskScope): EcsFirstOpenRdsAuthority {
  const { taskArn, taskDefinitionArn, roleArn, executionId, jobId, instanceId, workspaceId, writeBefore } = input;
  if (roleArn !== ecsFirstOpenRdsRole ||
      !/^arn:aws:ecs:ca-central-1:402010193138:task\/techlong-sandbox-platform\/[a-f0-9]{32}$/.test(taskArn) ||
      !/^arn:aws:ecs:ca-central-1:402010193138:task-definition\/techlong-sandbox-first-open-v1:[1-9][0-9]{0,8}$/.test(taskDefinitionArn) ||
      !/^exec_[a-f0-9]{32}$/.test(executionId) || !/^job_[a-f0-9]{24}$/.test(jobId) ||
      jobId === FIRST_OPEN_BASELINE_BINDING.jobId || jobId === FIRST_OPEN_SECOND_SLOT.jobId ||
      ![taskArn, taskDefinitionArn, executionId, jobId, instanceId, workspaceId].every(value => typeof value === "string" && value.trim() === value) ||
      ![instanceId, workspaceId].every(value => /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(value)) ||
      !Number.isSafeInteger(writeBefore) || writeBefore <= 0) throw Error("ECS_FIRST_OPEN_RDS_AUTHORITY_SCOPE");
  const authority: EcsFirstOpenRdsAuthority = Object.freeze({
    taskArn, taskDefinitionArn, roleArn, executionId, jobId, instanceId, workspaceId, writeBefore,
    [ecsFirstOpenAuthorityBrand]: true as const,
  });
  ecsFirstOpenAuthorities.add(authority);
  return authority;
}

export function assertEcsFirstOpenRdsApproval(authority: EcsFirstOpenRdsAuthority | undefined,
  config: DeploymentWorkerRuntimeConfig, approval: EcsFirstOpenExecutionScope, now: number) {
  if (!authority || !ecsFirstOpenAuthorities.has(authority) || config.workerEnabled !== false || config.applyEnabled !== false ||
      config.expectedAccountId !== ecsFirstOpenAccount || config.expectedRegion !== ecsFirstOpenRegion ||
      config.environmentKey !== ecsFirstOpenEnvironmentKey || config.workerRoleArn !== authority.roleArn ||
      !Number.isSafeInteger(now) || authority.writeBefore <= now || authority.writeBefore > now + 3_600_000 ||
      authority.executionId !== approval.executionId || authority.jobId !== approval.jobId ||
      authority.instanceId !== approval.instanceId || authority.workspaceId !== approval.workspaceId ||
      authority.writeBefore !== approval.writeBefore) throw Error("ECS_FIRST_OPEN_RDS_AUTHORITY_REQUIRED");
  return authority;
}

/** Preserve the stored environment binding for ordinary and Express workers. */
export function assertEcsFirstOpenRdsContext(authority: EcsFirstOpenRdsAuthority, context: DeploymentExecutionContext) {
  const { environment, binding, job, deployment, appInstance, workspace } = context;
  if (!ecsFirstOpenAuthorities.has(authority) || environment.id !== ECS_FIRST_OPEN_RDS_ENVIRONMENT_ID ||
      environment.key !== ecsFirstOpenEnvironmentKey || environment.kind !== "aws_sandbox" ||
      environment.expectedAccountId !== ecsFirstOpenAccount || environment.region !== ecsFirstOpenRegion ||
      environment.cellKey !== "cell-sandbox-1" || environment.applyEnabled !== false || environment.status !== "active" ||
      binding?.environmentId !== environment.id || binding.status !== "active" || binding.workerRoleArn !== ecsFirstOpenSharedRole ||
      job.id !== authority.jobId || job.jobType !== "apply" || job.attempt !== 1 || job.maxAttempts !== 1 ||
      job.leaseExpiresAt !== authority.writeBefore || !job.leaseToken || deployment.id !== job.deploymentId ||
      deployment.environmentId !== environment.id || deployment.appInstanceId !== authority.instanceId ||
      appInstance.id !== authority.instanceId || appInstance.workspaceId !== authority.workspaceId ||
      workspace.id !== authority.workspaceId) throw Error("ECS_FIRST_OPEN_RDS_CONTEXT_SCOPE");
  return binding;
}

export interface DeploymentWorkerRuntimeConfig {
  workerEnabled: boolean;
  applyEnabled: boolean;
  environmentKey: string;
  expectedAccountId: string;
  expectedRegion: string;
  workerRoleArn: string;
  confirmation: string;
  leaseDurationMs: number;
  pollIntervalMs: number;
}

export interface ExecutionGateResult {
  ok: boolean;
  failures: string[];
}

const iamRolePattern = /^arn:aws:iam::(\d{12}):role\/(?!.*\.\.)([A-Za-z0-9+=,.@_\/-]{1,512})$/;

function parseBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

export function loadDeploymentWorkerRuntimeConfig(
  values: Record<string, string | undefined>,
): DeploymentWorkerRuntimeConfig {
  return {
    workerEnabled: parseBoolean(values.DEPLOYMENT_WORKER_ENABLED),
    applyEnabled: parseBoolean(values.AWS_APPLY_ENABLED),
    environmentKey: values.AWS_DEPLOYMENT_ENVIRONMENT_KEY?.trim() ?? "",
    expectedAccountId: values.AWS_SANDBOX_ACCOUNT_ID?.trim() ?? "",
    expectedRegion: (values.AWS_REGION ?? values.AWS_DEFAULT_REGION)?.trim() ?? "",
    workerRoleArn: values.AWS_SANDBOX_EXECUTION_ROLE_ARN?.trim() ?? "",
    confirmation: values.AWS_SANDBOX_EXECUTION_CONFIRMATION?.trim() ?? "",
    leaseDurationMs: parseBoundedInteger(
      values.DEPLOYMENT_WORKER_LEASE_MS,
      120_000,
      15_000,
      15 * 60_000,
    ),
    pollIntervalMs: parseBoundedInteger(
      values.DEPLOYMENT_WORKER_POLL_MS,
      10_000,
      1_000,
      60_000,
    ),
  };
}

export function evaluateStaticExecutionGate(
  config: DeploymentWorkerRuntimeConfig,
): ExecutionGateResult {
  const failures = [...evaluateWorkerRuntimeGate(config).failures];
  if (!config.applyEnabled) failures.push("aws_apply_disabled");
  if (config.confirmation !== AWS_SANDBOX_CONFIRMATION_PHRASE) {
    failures.push("execution_confirmation_missing");
  }
  return { ok: failures.length === 0, failures: [...new Set(failures)] };
}

export function evaluateWorkerRuntimeGate(
  config: DeploymentWorkerRuntimeConfig,
): ExecutionGateResult {
  const failures: string[] = [];
  if (!config.workerEnabled) failures.push("worker_disabled");
  if (!/^\d{12}$/.test(config.expectedAccountId)) {
    failures.push("runtime_account_invalid");
  }
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(config.expectedRegion)) {
    failures.push("runtime_region_invalid");
  }
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(config.environmentKey)) {
    failures.push("runtime_environment_invalid");
  }
  const expectedRole = /^\d{12}$/.test(config.expectedAccountId)
    ? `arn:aws:iam::${config.expectedAccountId}:role/${AWS_SANDBOX_PROVISIONER_ROLE_NAME}`
    : "";
  if (config.workerRoleArn !== expectedRole) {
    failures.push("runtime_worker_role_invalid");
  }
  return { ok: failures.length === 0, failures };
}

export function evaluatePersistedExecutionGate(input: {
  config: DeploymentWorkerRuntimeConfig;
  environment: DeploymentEnvironment;
  binding: DeploymentExecutionBinding | null;
  firstOpenSecondSlot?: FirstOpenSecondSlotApproval;
}): ExecutionGateResult {
  const failures = [...evaluateStaticExecutionGate(input.config).failures];
  const { environment, binding, config } = input;
  const environmentErrors = validateDeploymentEnvironment(environment, input.firstOpenSecondSlot);
  if (environmentErrors.length > 0) {
    failures.push(...environmentErrors.map((error) => `environment_${error}`));
  }
  if (environment.status !== "active") failures.push("environment_inactive");
  if (!environment.applyEnabled) failures.push("database_apply_disabled");
  if (environment.key !== config.environmentKey) failures.push("environment_key_mismatch");
  if (environment.expectedAccountId !== config.expectedAccountId) {
    failures.push("environment_account_mismatch");
  }
  if (environment.region !== config.expectedRegion) {
    failures.push("environment_region_mismatch");
  }
  if (!binding || binding.status !== "active") {
    failures.push("execution_binding_inactive");
  } else {
    if (binding.environmentId !== environment.id) {
      failures.push("execution_binding_environment_mismatch");
    }
    if (binding.workerRoleArn !== config.workerRoleArn) {
      failures.push("worker_role_not_allowlisted");
    }
    const workerRole = binding.workerRoleArn.match(iamRolePattern);
    const cloudFormationRole = binding.cloudFormationRoleArn.match(iamRolePattern);
    if (!workerRole || workerRole[1] !== environment.expectedAccountId) {
      failures.push("binding_worker_role_invalid");
    }
    if (!cloudFormationRole || cloudFormationRole[1] !== environment.expectedAccountId) {
      failures.push("binding_cloudformation_role_invalid");
    }
    if (
      binding.cloudFormationRoleArn !==
      `arn:aws:iam::${environment.expectedAccountId}:role/${AWS_SANDBOX_CLOUDFORMATION_ROLE_NAME}`
    ) {
      failures.push("binding_cloudformation_role_not_allowlisted");
    }
  }
  return { ok: failures.length === 0, failures: [...new Set(failures)] };
}

export function evaluateCleanupExecutionGate(input: {
  config: DeploymentWorkerRuntimeConfig;
  environment: DeploymentEnvironment;
  binding: DeploymentExecutionBinding | null;
}): ExecutionGateResult {
  const failures = [...evaluateWorkerRuntimeGate(input.config).failures];
  const { environment, binding, config } = input;
  if (environment.key !== config.environmentKey) failures.push("environment_key_mismatch");
  if (environment.expectedAccountId !== config.expectedAccountId) {
    failures.push("environment_account_mismatch");
  }
  if (environment.region !== config.expectedRegion) {
    failures.push("environment_region_mismatch");
  }
  if (!binding) {
    failures.push("execution_binding_missing");
  } else {
    if (binding.environmentId !== environment.id) {
      failures.push("execution_binding_environment_mismatch");
    }
    if (binding.workerRoleArn !== config.workerRoleArn) {
      failures.push("worker_role_not_allowlisted");
    }
    if (
      binding.cloudFormationRoleArn !==
      `arn:aws:iam::${environment.expectedAccountId}:role/${AWS_SANDBOX_CLOUDFORMATION_ROLE_NAME}`
    ) {
      failures.push("binding_cloudformation_role_not_allowlisted");
    }
  }
  return { ok: failures.length === 0, failures: [...new Set(failures)] };
}

function roleNameFromIamArn(roleArn: string): string | null {
  const match = roleArn.match(iamRolePattern);
  if (!match) return null;
  const parts = match[2].split("/");
  return parts.at(-1) ?? null;
}

export function evaluateAwsIdentityGate(input: {
  config: DeploymentWorkerRuntimeConfig;
  environment: DeploymentEnvironment;
  binding: DeploymentExecutionBinding;
  identity: AwsCallerIdentity;
  adapterRegion: string;
}): ExecutionGateResult {
  const failures: string[] = [];
  if (input.identity.accountId !== input.environment.expectedAccountId) {
    failures.push("sts_account_mismatch");
  }
  if (input.adapterRegion !== input.environment.region) {
    failures.push("sdk_region_mismatch");
  }
  const roleName = roleNameFromIamArn(input.binding.workerRoleArn);
  const assumedRolePattern = roleName
    ? new RegExp(
        `^arn:aws:sts::${input.environment.expectedAccountId}:assumed-role/${roleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[^/]{2,128}$`,
      )
    : null;
  if (!assumedRolePattern?.test(input.identity.arn)) {
    failures.push("sts_role_mismatch");
  }
  if (input.config.workerRoleArn !== input.binding.workerRoleArn) {
    failures.push("runtime_role_mismatch");
  }
  return { ok: failures.length === 0, failures };
}

export class DeploymentExecutionGateError extends Error {
  readonly code = "DEPLOYMENT_EXECUTION_GATE_CLOSED";
  readonly failures: string[];

  constructor(failures: string[]) {
    super(`Deployment execution gate is closed: ${failures.join(", ")}.`);
    this.failures = failures;
  }
}

export function assertExecutionGate(result: ExecutionGateResult): void {
  if (!result.ok) throw new DeploymentExecutionGateError(result.failures);
}
