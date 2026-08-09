export const deploymentStatuses = [
  "planned",
  "queued",
  "preflight",
  "database_preparing",
  "migrating",
  "infrastructure_provisioning",
  "waiting_healthy",
  "configuring",
  "verifying",
  "ready",
  "retry_wait",
  "failed",
  "cancel_requested",
  "rolling_back",
  "rolled_back",
  "rollback_failed",
  "canceled",
] as const;

export type DeploymentStatus = (typeof deploymentStatuses)[number];

export const deploymentJobStatuses = [
  "pending",
  "running",
  "retry_wait",
  "succeeded",
  "dead_letter",
  "canceled",
] as const;

export type DeploymentJobStatus = (typeof deploymentJobStatuses)[number];
export type DeploymentJobType = "apply" | "rollback" | "reconcile";

const deploymentTransitions: Record<DeploymentStatus, readonly DeploymentStatus[]> = {
  planned: ["queued", "cancel_requested", "canceled"],
  queued: ["preflight", "retry_wait", "cancel_requested", "failed"],
  preflight: ["database_preparing", "retry_wait", "cancel_requested", "failed"],
  database_preparing: ["migrating", "retry_wait", "cancel_requested", "failed"],
  migrating: [
    "infrastructure_provisioning",
    "retry_wait",
    "cancel_requested",
    "failed",
  ],
  infrastructure_provisioning: [
    "waiting_healthy",
    "retry_wait",
    "cancel_requested",
    "failed",
  ],
  waiting_healthy: ["configuring", "retry_wait", "cancel_requested", "failed"],
  configuring: ["verifying", "retry_wait", "cancel_requested", "failed"],
  verifying: ["ready", "retry_wait", "cancel_requested", "failed"],
  ready: ["cancel_requested"],
  retry_wait: ["queued", "cancel_requested", "failed"],
  failed: ["queued", "cancel_requested", "rolling_back"],
  cancel_requested: ["rolling_back", "canceled"],
  rolling_back: ["rolled_back", "rollback_failed"],
  rolled_back: [],
  rollback_failed: ["rolling_back"],
  canceled: [],
};

const jobTransitions: Record<DeploymentJobStatus, readonly DeploymentJobStatus[]> = {
  pending: ["running", "canceled"],
  running: ["retry_wait", "succeeded", "dead_letter", "canceled"],
  retry_wait: ["running", "dead_letter", "canceled"],
  succeeded: [],
  dead_letter: [],
  canceled: [],
};

export class InvalidDeploymentTransitionError extends Error {
  readonly code = "INVALID_DEPLOYMENT_TRANSITION";

  constructor(from: DeploymentStatus, to: DeploymentStatus) {
    super(`Deployment cannot transition from ${from} to ${to}.`);
  }
}

export class InvalidDeploymentJobTransitionError extends Error {
  readonly code = "INVALID_DEPLOYMENT_JOB_TRANSITION";

  constructor(from: DeploymentJobStatus, to: DeploymentJobStatus) {
    super(`Deployment job cannot transition from ${from} to ${to}.`);
  }
}

export function canTransitionDeployment(
  from: DeploymentStatus,
  to: DeploymentStatus,
): boolean {
  return deploymentTransitions[from].includes(to);
}

export function assertDeploymentTransition(
  from: DeploymentStatus,
  to: DeploymentStatus,
): void {
  if (!canTransitionDeployment(from, to)) {
    throw new InvalidDeploymentTransitionError(from, to);
  }
}

export function canTransitionDeploymentJob(
  from: DeploymentJobStatus,
  to: DeploymentJobStatus,
): boolean {
  return jobTransitions[from].includes(to);
}

export function assertDeploymentJobTransition(
  from: DeploymentJobStatus,
  to: DeploymentJobStatus,
): void {
  if (!canTransitionDeploymentJob(from, to)) {
    throw new InvalidDeploymentJobTransitionError(from, to);
  }
}
