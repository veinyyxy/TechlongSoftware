import {
  awsSandboxTenantStackName,
  renderAwsSandboxTenantStack,
} from "../cloudformation/tenant-stack.ts";
import { assertSafeDeploymentOutput, normalizeDeploymentError } from "../safety.ts";
import type { DeploymentStatus } from "../state-machine.ts";
import type {
  ApplyReadyTenantStack,
  AwsDeploymentPort,
  CleanupSchedulePort,
  DeploymentExecutionContext,
  DeploymentExecutionRepository,
  SaaSControlPort,
  SaaSControlPayloadCompilerPort,
  SharedCellSecurityPreflightPort,
  TenantDatabasePort,
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

export interface DeploymentWorkerDependencies {
  repository: DeploymentExecutionRepository;
  /**
   * Explicit, state-independent capability gate. This may only be true when
   * the tenant database, Shared Cell security, control client and payload
   * compiler adapters are all production-ready.
   */
  applyRuntimeReady: boolean;
  awsFactory(input: {
    region: string;
    workerRoleArn: string;
  }): Promise<AwsDeploymentPort>;
  cleanupScheduler: CleanupSchedulePort;
  sharedCellSecurityPreflight: SharedCellSecurityPreflightPort;
  tenantDatabase: TenantDatabasePort;
  controlClient: SaaSControlPort;
  controlPayloadCompiler: SaaSControlPayloadCompilerPort;
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

interface TenantStackDeleteDescriptor {
  stackName: string;
  tags: Record<string, string>;
  cloudFormationRoleArn: string;
}

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

function deleteDescriptor(
  context: DeploymentExecutionContext,
): TenantStackDeleteDescriptor {
  if (!context.binding) {
    throw new DeploymentExecutionError(
      "EXECUTION_BINDING_MISSING",
      "Cleanup requires the persisted CloudFormation role binding.",
      false,
    );
  }
  return {
    stackName: awsSandboxTenantStackName(
      context.deployment.desiredPlan.resources.tenant.ecsService,
    ),
    tags: {
      Environment: "aws-sandbox",
      DeploymentId: context.deployment.id,
      AppInstanceId: context.appInstance.id,
      ManagedBy: "techlong-provisioner",
    },
    cloudFormationRoleArn: context.binding.cloudFormationRoleArn,
  };
}

function assertStackOwnership(input: {
  observation: { state: string; tags: Record<string, string> };
  expectedTags: Record<string, string>;
}): void {
  if (input.observation.state === "missing") return;
  for (const key of ["Environment", "ManagedBy", "DeploymentId", "AppInstanceId"] as const) {
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
  if (!context.binding) {
    throw new DeploymentExecutionError(
      "EXECUTION_BINDING_MISSING",
      "Deployment environment has no active execution binding.",
      false,
    );
  }
  const rendered = renderAwsSandboxTenantStack({
    deploymentId: context.deployment.id,
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
  });
}

async function ensureApplyCleanupSchedule(input: {
  context: DeploymentExecutionContext;
  stack: ApplyReadyTenantStack;
  cleanupScheduler: CleanupSchedulePort;
  repository: DeploymentExecutionRepository;
  now: number;
}): Promise<void> {
  const { context } = input;
  const expiresAt = context.deployment.createdAt + context.environment.policy.ttlSeconds * 1_000;
  const expectedScheduleRef = `cloudformation:${input.stack.stackName}:TenantCleanupSchedule`;
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
      stackName: input.stack.stackName,
      expiresAt,
      expectedTags: input.stack.tags,
    });
    if (confirmation.providerScheduleRef !== expectedScheduleRef) {
      throw new DeploymentExecutionError(
        "CLEANUP_SCHEDULE_UNCONFIRMED",
        "Cleanup schedule provider reference does not match the rendered guardrail.",
        false,
      );
    }
    schedule = await input.repository.confirmCleanupSchedule({
      deploymentId: context.deployment.id,
      environmentId: context.environment.id,
      stackName: input.stack.stackName,
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
  await input.repository.enqueueJob({
    deploymentId: context.deployment.id,
    jobType: "cleanup",
    planHash: context.deployment.planHash,
    availableAt: expiresAt,
    maxAttempts: 20,
    now: input.now,
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
    jobId: input.context.job.id,
    workerId: input.workerId,
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

async function checkpoint<T extends object>(input: {
  dependencies: DeploymentWorkerDependencies;
  context: DeploymentExecutionContext;
  config: DeploymentWorkerRuntimeConfig;
  workerId: string;
  stepKey: string;
  stepInput: Record<string, unknown>;
  execute(): Promise<T>;
}): Promise<T> {
  const now = (input.dependencies.now ?? Date.now)();
  const inputHash = await sha256Hex(input.stepInput);
  const handle = await input.dependencies.repository.beginStep({
    deploymentId: input.context.deployment.id,
    jobId: input.context.job.id,
    workerId: input.workerId,
    stepKey: input.stepKey,
    inputHash,
    attempt: input.context.job.attempt,
    now,
  });
  if (handle.alreadySucceeded) return handle.previousOutput as unknown as T;
  await heartbeat({
    dependencies: input.dependencies,
    context: input.context,
    config: input.config,
    workerId: input.workerId,
    now,
  });
  try {
    const output = await input.execute();
    assertSafeDeploymentOutput(output as unknown as Record<string, unknown>);
    const finished = await input.dependencies.repository.finishStep({
      stepId: handle.id,
      workerId: input.workerId,
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
      stepId: handle.id,
      workerId: input.workerId,
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
    deploymentId: input.context.deployment.id,
    jobId: input.context.job.id,
    workerId: input.workerId,
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
    execute: () => input.aws.getCallerIdentity(),
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
    execute: () =>
      input.dependencies.sharedCellSecurityPreflight.verify({
        environment: input.context.environment,
        binding: input.context.binding!,
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
}): Promise<void> {
  const reserved = await input.dependencies.repository.reserveEnvironmentCapacity({
    deploymentId: input.context.deployment.id,
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

async function handleApply(input: {
  dependencies: DeploymentWorkerDependencies;
  context: DeploymentExecutionContext;
  config: DeploymentWorkerRuntimeConfig;
  workerId: string;
  aws: AwsDeploymentPort;
  stack: ApplyReadyTenantStack;
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
  await reserveEnvironmentCapacity(input);
  if (["waiting_healthy", "configuring", "verifying", "ready"].includes(input.context.deployment.status)) {
    await input.dependencies.repository.enqueueJob({
      deploymentId: input.context.deployment.id,
      jobType: "reconcile",
      planHash: input.context.deployment.planHash,
      availableAt: (input.dependencies.now ?? Date.now)(),
      maxAttempts: 20,
      now: (input.dependencies.now ?? Date.now)(),
    });
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
    await checkpoint({
      ...input,
      stepKey: "tenant_database_prepare",
      stepInput: {
        databaseName: input.context.deployment.desiredPlan.resources.tenant.database.databaseName,
        roleName: input.context.deployment.desiredPlan.resources.tenant.database.roleName,
        planHash: input.context.deployment.planHash,
      },
      execute: () =>
        input.dependencies.tenantDatabase.ensureTenantDatabase({
          context: input.context,
          idempotencyKey: `${input.context.deployment.id}:database`,
        }),
    });
    await moveState({
      ...input,
      from: ["database_preparing"],
      to: "migrating",
      currentStep: "migrating",
    });
  }
  if (input.context.deployment.status === "migrating") {
    await checkpoint({
      ...input,
      stepKey: "tenant_database_migrate",
      stepInput: {
        databaseName: input.context.deployment.desiredPlan.resources.tenant.database.databaseName,
        migrationContract: "speedfeast-pg16.14-baseline-plus-migrate-saas-v1",
      },
      execute: () =>
        input.dependencies.tenantDatabase.migrateTenantDatabase({
          context: input.context,
          idempotencyKey: `${input.context.deployment.id}:migration:v1`,
        }),
    });
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
  const refreshed = await input.dependencies.repository.loadContext(input.context.job);
  assertContextIntegrity(refreshed, { destructive: false });
  await assertHashes(refreshed, { configuration: true });
  assertExecutionGate(
    evaluatePersistedExecutionGate({
      config: input.config,
      environment: refreshed.environment,
      binding: refreshed.binding,
    }),
  );
  if (refreshed.deployment.status !== "infrastructure_provisioning") {
    throw new DeploymentExecutionError(
      "DEPLOYMENT_STATE_CONFLICT",
      "Deployment state changed before the CloudFormation write boundary.",
      true,
    );
  }
  input.context = refreshed;
  input.stack = renderApplyReadyStack({ context: refreshed });
  await ensureApplyCleanupSchedule({
    context: refreshed,
    stack: input.stack,
    cleanupScheduler: input.dependencies.cleanupScheduler,
    repository: input.dependencies.repository,
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
      stepInput: { stackName: input.stack.stackName, expiresAt },
      execute: () => input.aws.describeTenantStack(input.stack.stackName),
    });
    assertStackOwnership({ observation: existing, expectedTags: input.stack.tags });
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
        stackName: input.stack.stackName,
        stackId: existing.stackId,
        stackOperation: "existing_near_ttl",
      },
    });
    await input.dependencies.repository.enqueueJob({
      deploymentId: input.context.deployment.id,
      jobType: "reconcile",
      planHash: input.context.deployment.planHash,
      availableAt: currentTime,
      maxAttempts: 20,
      now: currentTime,
    });
    return;
  }
  const applied = await checkpoint({
    ...input,
    stepKey: "cloudformation_apply",
    stepInput: {
      stackName: input.stack.stackName,
      clientRequestToken: input.stack.clientRequestToken,
      templateHash: await sha256Hex(input.stack.templateBody),
      parameterHash: await sha256Hex(input.stack.parameters),
    },
    execute: () => input.aws.applyTenantStack(input.stack),
  });
  await moveState({
    ...input,
    from: ["infrastructure_provisioning"],
    to: "waiting_healthy",
    currentStep: "cloudformation_wait",
    outputPatch: {
      stackName: input.stack.stackName,
      stackId: applied.stackId,
      stackOperation: applied.operation,
      cleanupScheduleRef: `cloudformation:${input.stack.stackName}:TenantCleanupSchedule`,
    },
  });
  await input.dependencies.repository.enqueueJob({
    deploymentId: input.context.deployment.id,
    jobType: "reconcile",
    planHash: input.context.deployment.planHash,
    availableAt: (input.dependencies.now ?? Date.now)() + 15_000,
    maxAttempts: 20,
    now: (input.dependencies.now ?? Date.now)(),
  });
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
  await reserveEnvironmentCapacity(input);
  const observation = await checkpoint({
    ...input,
    stepKey: "cloudformation_observe",
    stepInput: {
      stackName: input.stack.stackName,
      reconcileAttempt: input.context.job.attempt,
    },
    execute: () => input.aws.describeTenantStack(input.stack.stackName),
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
      execute: () =>
        input.dependencies.controlClient.waitUntilHealthy({
          appInstanceId: input.context.appInstance.id,
          hostname: input.stack.parameters.TenantHostname,
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
    await checkpoint({
      ...input,
      stepKey: "control_provision",
      stepInput: {
        configurationHash: input.context.deployment.configurationHash,
        hostname: input.stack.parameters.TenantHostname,
      },
      execute: async () => {
        const compiled = await input.dependencies.controlPayloadCompiler.compile({
          context: input.context,
          configurationHash: input.context.deployment.configurationHash,
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
    execute: () =>
      input.dependencies.controlClient.readConfiguration({
        appInstanceId: input.context.appInstance.id,
        hostname: input.stack.parameters.TenantHostname,
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
    deploymentId: input.context.deployment.id,
    appInstanceId: input.context.appInstance.id,
    subscriptionId: input.context.subscription?.id ?? "",
    jobId: input.context.job.id,
    workerId: input.workerId,
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
  aws: AwsDeploymentPort;
  stack: TenantStackDeleteDescriptor;
}): Promise<void> {
  await validateIdentity(input);
  const cancellable: DeploymentStatus[] = [
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
  ];
  if (cancellable.includes(input.context.deployment.status)) {
    await moveState({
      ...input,
      from: cancellable,
      to: "cancel_requested",
      currentStep: "cleanup_requested",
    });
  }
  if (["cancel_requested", "failed", "rollback_failed"].includes(input.context.deployment.status)) {
    await moveState({
      ...input,
      from: ["cancel_requested", "failed", "rollback_failed"],
      to: "rolling_back",
      currentStep: "cloudformation_delete",
    });
  }
  if (input.context.cleanupSchedule) {
    await input.dependencies.repository.markCleanupStatus({
      scheduleId: input.context.cleanupSchedule.id,
      status: "running",
      now: (input.dependencies.now ?? Date.now)(),
    });
  }
  const observed = await input.aws.describeTenantStack(input.stack.stackName);
  assertStackOwnership({ observation: observed, expectedTags: input.stack.tags });
  if (observed.state === "delete_in_progress") {
    throw new DeploymentExecutionError(
      "CLOUDFORMATION_DELETE_IN_PROGRESS",
      "CloudFormation stack deletion is still in progress.",
      true,
    );
  }
  if (observed.state !== "missing") {
    await checkpoint({
      ...input,
      stepKey: "cloudformation_delete",
      stepInput: { stackName: input.stack.stackName },
      execute: () =>
        input.aws.deleteTenantStack({
          stackName: input.stack.stackName,
          clientRequestToken: `delete-${input.context.deployment.id}`.slice(0, 128),
          expectedTags: input.stack.tags,
          cloudFormationRoleArn: input.stack.cloudFormationRoleArn,
        }),
    });
    throw new DeploymentExecutionError(
      "CLOUDFORMATION_DELETE_IN_PROGRESS",
      "CloudFormation stack deletion has been submitted.",
      true,
    );
  }
  if (input.context.cleanupSchedule) {
    await input.dependencies.repository.markCleanupStatus({
      scheduleId: input.context.cleanupSchedule.id,
      status: "succeeded",
      now: (input.dependencies.now ?? Date.now)(),
    });
  }
  if (input.context.deployment.status === "rolling_back") {
    await moveState({
      ...input,
      from: ["rolling_back"],
      to: "rolled_back",
      currentStep: "rolled_back",
    });
  }
  if (["rolled_back", "canceled"].includes(input.context.deployment.status)) {
    await input.dependencies.repository.markInstanceUnavailable({
      deploymentId: input.context.deployment.id,
      appInstanceId: input.context.appInstance.id,
      reason: input.context.job.jobType === "cleanup" ? "ttl_cleanup" : "rollback",
      now: (input.dependencies.now ?? Date.now)(),
    });
  }
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
    staticApplyGate.ok && input.dependencies.applyRuntimeReady;
  const allowedJobTypes = applicationExecutionReady
    ? (["apply", "reconcile", "cleanup", "rollback"] as const)
    : (["cleanup", "rollback"] as const);
  const now = (input.dependencies.now ?? Date.now)();
  const job = await input.dependencies.repository.claimNext({
    workerId: input.workerId,
    now,
    leaseDurationMs: input.config.leaseDurationMs,
    jobTypes: [...allowedJobTypes],
  });
  if (!job) return { status: "idle" };
  if (
    (job.jobType === "apply" || job.jobType === "reconcile") &&
    !applicationExecutionReady
  ) {
    const result = await input.dependencies.repository.retryJob({
      jobId: job.id,
      workerId: input.workerId,
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
    const stack = destructive
      ? deleteDescriptor(context)
      : renderApplyReadyStack({ context });
    if (
      job.jobType === "apply" &&
      !["waiting_healthy", "configuring", "verifying", "ready"].includes(
        context.deployment.status,
      )
    ) {
      await ensureApplyCleanupSchedule({
        context,
        stack: stack as ApplyReadyTenantStack,
        cleanupScheduler: input.dependencies.cleanupScheduler,
        repository: input.dependencies.repository,
        now,
      });
    }
    if (!context.binding) throw new Error("Execution binding is missing.");
    // The SDK adapter is intentionally not constructed until every local,
    // persisted, parameter and cleanup gate above has passed.
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
      stack,
    };
    if (job.jobType === "apply") {
      await handleApply({ ...handlerInput, stack: stack as ApplyReadyTenantStack });
    } else if (job.jobType === "reconcile") {
      await handleReconcile({ ...handlerInput, stack: stack as ApplyReadyTenantStack });
    } else {
      await handleDelete({ ...handlerInput, stack: stack as TenantStackDeleteDescriptor });
    }
    const completed = await input.dependencies.repository.completeJob({
      jobId: job.id,
      workerId: input.workerId,
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
      jobId: job.id,
      workerId: input.workerId,
      errorCode: normalized.code,
      errorMessage: normalized.message,
      retryable: normalized.retryable,
      retryDelayMs: retryDelay(job.attempt),
      now: (input.dependencies.now ?? Date.now)(),
    });
    if (context?.cleanupSchedule && !normalized.retryable) {
      await input.dependencies.repository.markCleanupStatus({
        scheduleId: context.cleanupSchedule.id,
        status: "failed",
        errorMessage: normalized.message,
        now: (input.dependencies.now ?? Date.now)(),
      });
    }
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
