import { randomUUID } from "node:crypto";
import {
  CLAIM_FIRST_ONBOARDING, SELECT_FIRST_ONBOARDING, firstOnboardingClaimBindings, loadFirstOnboardingReview,
} from "../first-onboarding.ts";
import { assertAwsSandboxTenantRuntimeSecretRef } from "../cloudformation/tenant-stack.ts";
import type { SoftwareRelease } from "../releases/contract.ts";
import type { ClaimedDeploymentJob, DeploymentExecutionContext } from "./contracts.ts";
import type { EcsFirstOpenCompletionInput, createEcsFirstOpenCompletion } from "./ecs-first-open-completion.ts";
import { inspectEcsFirstOpen } from "./ecs-first-open-inspector.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "./first-onboarding-baseline-versions.ts";
import type { FirstOnboardingExpressComposition } from "./first-onboarding-express.ts";
import type { FirstOnboardingRuntimeReader } from "./first-onboarding-inspection.ts";
import { assertEcsFirstOpenRdsApproval, ECS_FIRST_OPEN_RDS_ENVIRONMENT_ID,
  type DeploymentWorkerRuntimeConfig, type EcsFirstOpenRdsAuthority } from "./gates.ts";
import { createFirstOnboardingWorkloadStrategy, type FirstOpenRdsControlPublicKey, type FirstOpenRdsPersistence,
  type FirstOpenRdsSecretVersion, type FirstOpenRdsWorkload,
  type SupervisedCleanupReadinessPort } from "./single-tenant-workload-strategy.ts";
import { deriveTenantOwnershipMarker, deriveTenantResourceIdentityFromPlan, deriveTenantRuntimeSecretName } from "./tenant-database.ts";
import { runFirstOnboardingManagement, type DeploymentWorkerDependencies } from "./worker.ts";

const executionIdPattern = /^exec_[a-f0-9]{32}$/;
const digestPattern = /^[a-f0-9]{64}$/;

export function isFirstOpenExecutionId(value: string): boolean {
  return executionIdPattern.test(value);
}

export interface EcsFirstOpenApproval {
  executionId: string;
  approvedBy: string;
  approvedAt: number;
  writeBefore: number;
  jobId: string;
  instanceId: string;
  workspaceId: string;
  releaseId: string;
  reviewSha256: string;
  baselineDigest: string;
  databaseSchemaVersion: string;
  hostname: string;
  dnsTarget: string;
}

type ReviewPorts = Parameters<typeof loadFirstOnboardingReview>[1];
type TaskStep = "database_initialization" | "api_deployment" | "self_check";
type TaskStepFailure = "AccessDenied" | "DATABASE_INITIALIZATION_FAILED" | "API_DEPLOYMENT_FAILED" | "SELF_CHECK_FAILED";

export interface EcsFirstOpenTaskEvent {
  step: TaskStep;
  status: "started" | "completed" | "failed" | "unknown";
  errorCode?: TaskStepFailure | "RESULT_UNCONFIRMED";
}

export interface EcsFirstOpenPorts extends ReviewPorts {
  readApproval(executionId: string): Promise<EcsFirstOpenApproval | null>;
  /** Compare the same active approval again while atomically claiming the job. */
  claimApproved(approval: Readonly<EcsFirstOpenApproval>, sql: typeof CLAIM_FIRST_ONBOARDING,
    bindings: ReturnType<typeof firstOnboardingClaimBindings>): Promise<{ executionId: string; jobId: string } | null>;
  management: {
    dependencies: DeploymentWorkerDependencies;
    config: DeploymentWorkerRuntimeConfig;
    cleanupReadiness: SupervisedCleanupReadinessPort;
    express?: FirstOnboardingExpressComposition;
    databaseProfile?: "full_password";
    rdsAuthority?: EcsFirstOpenRdsAuthority;
    rdsApplicationSecret?: FirstOpenRdsSecretVersion;
    rdsControlPublicKey?: FirstOpenRdsControlPublicKey;
    rdsPersistence?: FirstOpenRdsPersistence;
  };
  reader: FirstOnboardingRuntimeReader;
  lifecycle?: {
    record(approval: Readonly<EcsFirstOpenApproval>, job: ClaimedDeploymentJob, event: EcsFirstOpenTaskEvent): Promise<void>;
    complete(input: EcsFirstOpenCompletionInput): ReturnType<ReturnType<typeof createEcsFirstOpenCompletion>>;
  };
}

const selfCheckMismatches = new Set([
  "ECS_FIRST_OPEN_CONFIGURATION_EXPECTATION_INVALID", "ECS_FIRST_OPEN_CONFIGURATION_MISMATCH", "ECS_FIRST_OPEN_INSPECTION_SCOPE",
  "ECS_FIRST_OPEN_RDS_WORKLOAD_READBACK_MISMATCH",
  "FIRST_ONBOARDING_INSPECTION_SCOPE_MISMATCH", "FIRST_ONBOARDING_INSPECTION_BINDING_MISMATCH", "RELEASE_ARTIFACT_MISMATCH",
  "RELEASE_PLATFORM_DIGEST_MISMATCH", "RELEASE_RESTORE_REQUIRED", "RELEASE_RUNTIME_BINDING_CHANGED", "RELEASE_RUNTIME_NOT_STABLE",
  "RELEASE_IMAGE_OR_COMPATIBILITY_CHANGED", "RELEASE_RUNNING_DIGEST_MISMATCH", "RELEASE_TARGETS_UNHEALTHY",
  "RELEASE_TECHNICAL_ENDPOINTS_NOT_VERIFIED",
]);

function stepFailure(step: TaskStep, error: unknown): EcsFirstOpenTaskEvent {
  const details = error as { code?: unknown; name?: unknown; message?: unknown; retryable?: unknown } | null;
  if (step === "database_initialization" &&
      [details?.code, details?.message].includes("TENANT_POSTGRES_INITIALIZATION_UNCONFIRMED")) {
    return { step, status: "unknown", errorCode: "RESULT_UNCONFIRMED" };
  }
  let errorCode: TaskStepFailure | undefined;
  if ([details?.code, details?.name].some(code => code === "AccessDenied" || code === "AccessDeniedException")) {
    errorCode = "AccessDenied";
  } else if (step === "self_check" && selfCheckMismatches.has(String(details?.message))) {
    errorCode = "SELF_CHECK_FAILED";
  } else if (step === "database_initialization" && (details?.retryable === false ||
    details?.code === "TENANT_MIGRATION_FAILED" || details?.message === "FIRST_ONBOARDING_DATABASE_BASELINE_UNVERIFIED")) {
    errorCode = "DATABASE_INITIALIZATION_FAILED";
  } else if (step === "api_deployment" && details?.retryable === false) {
    errorCode = "API_DEPLOYMENT_FAILED";
  }
  return errorCode ? { step, status: "failed", errorCode } : { step, status: "unknown", errorCode: "RESULT_UNCONFIRMED" };
}

/** One task uses one approved execution and one claim. */
export async function runEcsFirstOpen(executionId: string, ports: EcsFirstOpenPorts) {
  if (!isFirstOpenExecutionId(executionId)) throw Error("ECS_FIRST_OPEN_EXECUTION_ID");
  const now = ports.management.dependencies.now ?? Date.now;
  const databaseProfile = ports.management.databaseProfile ?? "express_iam";

  // Worker: load the stored approval, compare the exact held job and release, then claim once.
  const approval = Object.freeze(structuredClone(await ports.readApproval(executionId)));
  const startedAt = now();
  if (!approval || approval.executionId !== executionId || !/^[A-Za-z0-9_-]{3,128}$/.test(approval.approvedBy) ||
    !Number.isSafeInteger(approval.approvedAt) || approval.approvedAt <= 0 || approval.approvedAt > startedAt ||
    !Number.isSafeInteger(approval.writeBefore) || approval.writeBefore <= startedAt || approval.writeBefore > startedAt + 3_600_000 ||
    !/^job_[a-f0-9]{24}$/.test(approval.jobId) || !digestPattern.test(approval.reviewSha256) || !digestPattern.test(approval.baselineDigest) ||
    !/^[A-Za-z0-9._-]{1,100}$/.test(approval.databaseSchemaVersion) || !/^[a-z0-9][a-z0-9.-]{2,252}$/.test(approval.dnsTarget)) {
    throw Error("ECS_FIRST_OPEN_APPROVAL_REQUIRED");
  }
  // This task still belongs to the historical protected-window strategy.
  if (approval.jobId === FIRST_OPEN_BASELINE_BINDING.jobId) throw Error("ECS_FIRST_OPEN_LEGACY_SOURCE_BOUND");
  const checkWindow = () => {
    if (now() >= approval.writeBefore) throw Error("ECS_FIRST_OPEN_WINDOW_CLOSED");
  };
  const row = await ports.readOne(SELECT_FIRST_ONBOARDING, [approval.jobId]);
  let release: SoftwareRelease | null = null;
  const review = row && await loadFirstOnboardingReview(approval.jobId, {
    readOne: async () => row,
    databaseProfile,
    async readRelease(id) {
      if (id !== approval.releaseId) return null;
      const candidate = await ports.readRelease(id);
      if (candidate?.compatibility.applicationPort !== 3000 ||
        !candidate.compatibility.schemaVersions.includes(approval.databaseSchemaVersion)) return null;
      release = candidate;
      return release;
    },
  });
  const scope = review?.payload.scope;
  if (!row || !review || !release || !scope || review.reviewSha256 !== approval.reviewSha256 || scope.appInstanceId !== approval.instanceId ||
    scope.workspaceId !== approval.workspaceId || scope.releaseId !== approval.releaseId || !scope.artifactRef ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(row.slug) || approval.hostname !== `${row.slug}.sandbox.techlong.cloud` ||
    !(Number(row.subscriptionEnd) > approval.writeBefore)) {
    throw Error("ECS_FIRST_OPEN_APPROVAL_SCOPE");
  }
  const workerId = executionId;
  const leaseToken = `lease_${randomUUID().replaceAll("-", "")}`;
  const { dependencies, cleanupReadiness, express, rdsAuthority, rdsApplicationSecret, rdsControlPublicKey, rdsPersistence } = ports.management;
  const config = { ...ports.management.config, firstOnboardingDeadline: approval.writeBefore, firstOnboardingHostname: approval.hostname,
    firstOpenRdsAuthority: rdsAuthority };
  if (config.workerEnabled || config.applyEnabled || !dependencies.tenantExternalOperationCoordinator ||
    (databaseProfile === "full_password" && (express || !dependencies.tenantDatabase))) {
    throw Error("ECS_FIRST_OPEN_MANAGEMENT_DEPENDENCIES");
  }
  let rdsWorkload: FirstOpenRdsWorkload | undefined;
  if (databaseProfile === "full_password") {
    assertEcsFirstOpenRdsApproval(rdsAuthority, config, approval, now());
    if (scope.environmentId !== ECS_FIRST_OPEN_RDS_ENVIRONMENT_ID) throw Error("ECS_FIRST_OPEN_RDS_AUTHORITY_SCOPE");
    const plan = row.desiredPlan as DeploymentExecutionContext["deployment"]["desiredPlan"] | null;
    const database = plan?.resources?.tenant?.database;
    if (!rdsApplicationSecret || !rdsControlPublicKey || plan?.cellKey !== "cell-sandbox-1" || database?.isolation !== "tenant_database") {
      throw Error("ECS_FIRST_OPEN_RDS_SECRET_VERSION_REQUIRED");
    }
    if (!rdsPersistence) throw Error("ECS_FIRST_OPEN_RDS_PERSISTENCE_REQUIRED");
    rdsWorkload = Object.freeze({ application: Object.freeze({ ...rdsApplicationSecret }), control: Object.freeze({ ...rdsControlPublicKey }),
      persistence: Object.freeze({ ...rdsPersistence }) });
    const identity = await deriveTenantResourceIdentityFromPlan({ appInstanceId: scope.appInstanceId, workspaceId: scope.workspaceId,
      productId: scope.productId, environmentId: scope.environmentId, cellKey: plan.cellKey }, database);
    const expectedSecretName = deriveTenantRuntimeSecretName({ schemaVersion: 1, identity, generation: 1,
      ownerDeploymentId: scope.deploymentId, ownershipMarker: deriveTenantOwnershipMarker(identity, 1) });
    try {
      assertAwsSandboxTenantRuntimeSecretRef({ runtimeSecretRef: rdsWorkload.application.arn, expectedSecretName,
        accountId: scope.accountId, region: config.expectedRegion });
    } catch { throw Error("ECS_FIRST_OPEN_RDS_SECRET_SCOPE_CHANGED"); }
  } else if (rdsAuthority || rdsApplicationSecret || rdsControlPublicKey || rdsPersistence) {
    throw Error("ECS_FIRST_OPEN_RDS_AUTHORITY_SCOPE");
  }
  const strategy = createFirstOnboardingWorkloadStrategy({ cleanupReadiness, express, rdsAuthority,
    rdsApplicationSecret: rdsWorkload?.application, rdsControlPublicKey: rdsWorkload?.control, rdsPersistence: rdsWorkload?.persistence, scope: {
    deploymentId: scope.deploymentId, appInstanceId: scope.appInstanceId, environmentId: scope.environmentId,
    planHash: scope.planHash, configurationHash: scope.configurationHash, artifactRef: scope.artifactRef,
  } });
  checkWindow();
  const claim = await ports.claimApproved(approval, CLAIM_FIRST_ONBOARDING,
    firstOnboardingClaimBindings(review, row, workerId, leaseToken, approval.writeBefore));
  if (claim?.executionId !== executionId || claim.jobId !== approval.jobId) throw Error("ECS_FIRST_OPEN_CLAIM_UNCONFIRMED");

  const job: ClaimedDeploymentJob = { id: approval.jobId, deploymentId: scope.deploymentId, jobType: "apply",
    attempt: 1, maxAttempts: 1, leaseToken, leaseExpiresAt: approval.writeBefore,
    payload: { ...review.payload, schemaVersion: 1, deploymentId: scope.deploymentId, planHash: scope.planHash } };
  const assertScope = async (context: DeploymentExecutionContext) => {
    strategy.assertScope(context);
    await express?.assertContext(context);
    if (context.job.id !== job.id || context.job.leaseToken !== leaseToken || context.job.attempt !== 1 ||
      context.appInstance.workspaceId !== scope.workspaceId || context.appInstance.tenantKey !== scope.tenantKey ||
      context.appInstance.templateVersionId !== scope.templateVersionId || context.subscription?.id !== scope.subscriptionId) {
      throw Error("ECS_FIRST_OPEN_CLAIM_SCOPE");
    }
  };
  const record = async (event: EcsFirstOpenTaskEvent) => ports.lifecycle?.record(approval, job, event);

  // Management: reuse the existing tenant lifecycle, stack and configuration steps directly.
  let managementStep: TaskStep = "database_initialization";
  await record({ step: managementStep, status: "started" });
  let managed;
  try {
    managed = await runFirstOnboardingManagement({ dependencies: { ...dependencies, tenantWorkloadStrategy: strategy,
      ...(express ? { tenantDatabase: express.database } : {}) }, config, workerId,
      loadContext: () => dependencies.repository.loadContext(job), assertScope, baselineDigest: approval.baselineDigest, checkWindow,
      onWorkloadStart: ports.lifecycle && (async () => {
        await record({ step: managementStep, status: "completed" });
        managementStep = "api_deployment";
        await record({ step: managementStep, status: "started" });
      }),
    });
  } catch (error) {
    await record(stepFailure(managementStep, error));
    throw error;
  }
  await record({ step: "api_deployment", status: "completed" });

  // Inspector: sample again through the read ports in this process.
  checkWindow();
  await record({ step: "self_check", status: "started" });
  let runtime;
  try {
    const externalFence = managed.context.tenantExternalOperation;
    if (!externalFence) throw Error("ECS_FIRST_OPEN_INSPECTION_SCOPE");
    const signal = AbortSignal.timeout(Math.max(1, approval.writeBefore - now()));
    runtime = await inspectEcsFirstOpen({ ...managed, reader: ports.reader, now, signal,
      dnsTarget: approval.dnsTarget, databaseSchemaVersion: approval.databaseSchemaVersion,
      databaseProfile, rdsWorkload, baselineDigest: approval.baselineDigest, platformDigest: review.platformDigest,
      readConfiguration: signal => dependencies.controlClient.readConfiguration({
        appInstanceId: scope.appInstanceId, hostname: approval.hostname, externalFence, signal,
      }),
    });
    checkWindow();
  } catch (error) {
    await record(stepFailure("self_check", error));
    throw error;
  }
  await record({ step: "self_check", status: "completed" });
  const completion = await ports.lifecycle?.complete({ approval, job, context: managed.context, review, release, databaseProfile,
    target: { configuration: row.configuration, desiredPlan: row.desiredPlan }, runtime });
  return { executionId, jobId: job.id, instanceId: scope.appInstanceId, outcome: "SELF_CHECK_PASSED" as const, runtime,
    ...(completion && { completion }) };
}
