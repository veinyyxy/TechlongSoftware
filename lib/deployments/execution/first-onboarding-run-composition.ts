import { buildFirstOnboardingJob, type FirstOnboardingReviewRow } from "../first-onboarding.ts";
import type { AwsEcsCellDeploymentPlan } from "../types.ts";
import type { AwsSdkDeploymentAdapter } from "./aws-sdk-adapter.ts";
import type { DeploymentExecutionBinding, TenantExternalOperationFence, TenantResourceFence } from "./contracts.ts";
import { tenantExternalOperationHash } from "./external-ownership-coordinator.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "./first-onboarding-baseline-versions.ts";
import { sandboxFirstOpenClaimPorts } from "./first-onboarding-claim-entry.ts";
import { firstOnboardingInitialSecretVersion } from "./first-onboarding-express.ts";
import { createSandboxFirstOpenRunOnce, SANDBOX_FIRST_OPEN as s, type SandboxFirstOpenPorts } from "./first-onboarding-run-once.ts";
import { sandboxFirstOpenPlannedSecretGrant } from "./first-onboarding-run-permissions.ts";
import { bindSandboxFirstOpenMiddle, type FirstOpenMiddleSql } from "./first-onboarding-middle.ts";
import type { AwsSdkDynamoDbEpochAuthorityDependencies } from "./aws-sdk-dynamodb-epoch-authority.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { firstOpenVersion, type FirstOpenTaskRelease } from "./first-onboarding-version.ts";
import { deriveTenantOwnershipMarker, deriveTenantResourceIdentityFromPlan, deriveTenantRuntimeSecretName } from "./tenant-database.ts";

const hex = /^[a-f0-9]{64}$/;
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
type Approval = Parameters<ReturnType<typeof createSandboxFirstOpenRunOnce>>[0];
type SqlPort = Parameters<typeof sandboxFirstOpenClaimPorts>[0];
type Express = SandboxFirstOpenPorts["express"];
type WithoutCompletion<T extends Express = Express> = T extends Express ? Omit<T, "completionClient" | "completionReadClient"> : never;

/** Valid only for the exact held task with no generation or external epoch.
 * This predicts a first epoch; it neither claims nor proves its live absence. */
export async function predictSandboxFirstOpenG1(held: FirstOnboardingReviewRow, approvalSha256: string, taskRelease?: FirstOpenTaskRelease) {
  const d = held.deployment, j = held.job, plan = held.desiredPlan as AwsEcsCellDeploymentPlan;
  const { artifactRef, releaseId } = firstOpenVersion(taskRelease);
  if (!hex.test(approvalSha256) || d.id !== s.deploymentId || d.artifactRef !== artifactRef || d.status !== "planned" ||
    j.id !== s.jobId || j.deploymentId !== d.id || j.status !== "pending" || j.attempts !== 0 || j.maxAttempts !== 1 ||
    j.leaseOwner !== null || j.leaseToken !== null || j.leaseExpiresAt !== null || j.completedAt !== null ||
    !held.instancePendingFirstOpen || !held.subscriptionActiveAndCurrent || !held.scopeStillEligible || !held.noOtherDeploymentOrTenantGeneration ||
    held.appInstanceId !== s.instanceId || held.subscriptionId !== s.subscriptionId ||
    held.environmentId !== s.environmentId || held.accountId !== s.account || plan?.cellKey !== "cell-sandbox-1" ||
    plan.resources?.tenant?.database?.isolation !== "tenant_database" || await sha256Hex(held.workspaceId) !== s.workspaceSha256 ||
    await sha256Hex(plan) !== d.planHash || await sha256Hex(held.configuration) !== d.configurationHash) {
    throw Error("FIRST_OPEN_G1_HELD_SCOPE");
  }
  const expected = await buildFirstOnboardingJob({ appInstanceId: held.appInstanceId, workspaceId: held.workspaceId,
    subscriptionId: held.subscriptionId, environmentId: held.environmentId, planId: held.planId, templateVersionId: held.templateVersionId,
    tenantKey: held.tenantKey, planHash: d.planHash, configurationHash: d.configurationHash, releaseId, artifactRef, accountId: s.account });
  if (!expected || j.jobType !== "apply" || j.dedupeKey !== expected.dedupeKey || j.availableAt !== expected.availableAt ||
    !equal(j.payload, expected.payload)) throw Error("FIRST_OPEN_G1_HELD_SCOPE");
  const identity = await deriveTenantResourceIdentityFromPlan({ appInstanceId: held.appInstanceId, workspaceId: held.workspaceId,
    productId: s.productId, environmentId: held.environmentId, cellKey: plan.cellKey }, plan.resources.tenant.database);
  const resourceFence: TenantResourceFence = { schemaVersion: 1, identity, generation: 1, ownerDeploymentId: d.id,
    ownershipMarker: deriveTenantOwnershipMarker(identity, 1) };
  const name = deriveTenantRuntimeSecretName(resourceFence);
  if (identity.stableIdentityHash !== s.stableIdentity || identity.databaseName !== s.tenantDatabase ||
    identity.roleName !== s.tenantRole || name !== s.secretName) throw Error("FIRST_OPEN_G1_IDENTITY");
  const epoch: TenantExternalOperationFence = { schemaVersion: 1, resourceFence, epoch: 1, intent: "provision", ownerDeploymentId: d.id,
    operationHash: await tenantExternalOperationHash("provision", resourceFence, { ...d, artifactRef }),
    marker: `tl_epoch_${identity.stableIdentityHash.slice(0, 24)}_g1_e1`, state: "active" };
  const versionId = await firstOnboardingInitialSecretVersion({ approvalSha256, name, jobId: j.id, epoch,
    baselineDigest: FIRST_OPEN_BASELINE_BINDING.objects.archive.sha256 });
  return { name, epoch, versionId, grant: sandboxFirstOpenPlannedSecretGrant(versionId) };
}

interface RuntimeGrantProof {
  approvalSha256: string;
  evidenceSha256: string;
  roleArn: string;
  grantSha256: string;
  independentlyVerifiedEffective: true;
  observedAt: number;
}

/** Composition only. Callers provide separated, already-reviewed transports;
 * nothing is read, opened, granted or dispatched at construction time. */
export function bindSandboxFirstOpenRunOnce(input: {
  approval: Approval;
  approvedSha256: string;
  formalApprovalSha256?: string;
  sql: { review: SqlPort; claim: SqlPort; completion: SqlPort; inspection: SqlPort };
  aws: Pick<AwsSdkDeploymentAdapter, "region" | "getCallerIdentity" | "describeTenantStack" | "applySupervisedTenantStack">;
  ports: Omit<SandboxFirstOpenPorts, "readHeldJob" | "readFixedRelease" | "claimHeldJob" | "cloud" | "express"> & {
    express: WithoutCompletion;
  };
  runtimeGrantEvidenceSha256: string;
  reviewedTaskBinding?: DeploymentExecutionBinding;
  validateHeldBeforeClaim?: (held: FirstOnboardingReviewRow) => void;
  verifyRuntimeGrant(expected: { approvalSha256: string; roleArn: string; grant: ReturnType<typeof sandboxFirstOpenPlannedSecretGrant> },
    signal: AbortSignal): Promise<RuntimeGrantProof>;
}, now: () => number = Date.now) {
  const { approval: original, approvedSha256, formalApprovalSha256, sql, aws, ports, runtimeGrantEvidenceSha256, verifyRuntimeGrant } = input;
  if (new Set([sql.review, sql.claim, sql.completion, sql.inspection]).size !== 4 || !hex.test(runtimeGrantEvidenceSha256) ||
    !ports.cleanupReadiness.verifyBeforeClaim) throw Error("FIRST_OPEN_COMPOSITION_SCOPE");
  const approval = structuredClone(original);
  const rpc = sandboxFirstOpenClaimPorts(sql.review, sql.claim, approvedSha256);
  let predicted: Awaited<ReturnType<typeof predictSandboxFirstOpenG1>> | undefined, grantVerified = false;
  const guardedEpoch = (actual: TenantExternalOperationFence) => {
    if (!predicted || !grantVerified || !equal(actual, predicted.epoch)) throw Error("FIRST_OPEN_G1_EPOCH_MISMATCH");
  };
  const run = createSandboxFirstOpenRunOnce({
    ...ports, ...rpc,
    async readHeldJob() {
      const row = await rpc.readHeldJob();
      if (row) {
        input.validateHeldBeforeClaim?.(row);
        predicted = await predictSandboxFirstOpenG1(row, approvedSha256, approval.taskRelease);
      }
      return row;
    },
    async claimHeldJob(bindings) {
      if (!grantVerified) throw Error("FIRST_OPEN_G1_GRANT_UNPROVED");
      return rpc.claimHeldJob(bindings);
    },
    cleanupReadiness: {
      verify: x => ports.cleanupReadiness.verify(x),
      async verifyBeforeClaim(x) {
        if (!predicted) throw Error("FIRST_OPEN_G1_GRANT_UNPROVED");
        const expected = { approvalSha256: approvedSha256, roleArn: s.executionRole, grant: structuredClone(predicted.grant) };
        const grantSha256 = await sha256Hex(expected.grant);
        const observed = await verifyRuntimeGrant(expected, x.signal), checkedAt = now();
        x.signal.throwIfAborted();
        if (!observed || observed.approvalSha256 !== approvedSha256 || observed.roleArn !== s.executionRole ||
          observed.grantSha256 !== grantSha256 || observed.evidenceSha256 !== runtimeGrantEvidenceSha256 ||
          observed.independentlyVerifiedEffective !== true || !Number.isSafeInteger(observed.observedAt) ||
          observed.observedAt > checkedAt || checkedAt - observed.observedAt >= 5 * 3600_000) throw Error("FIRST_OPEN_G1_GRANT_UNPROVED");
        const cleanup = await ports.cleanupReadiness.verifyBeforeClaim!(x);
        grantVerified = true; // The worker separately validates cleanup and the time before it calls claim.
        return cleanup;
      },
    },
    async provisionEpoch(x) {
      if (!grantVerified || !predicted || !equal(x.resourceFence, predicted.epoch.resourceFence)) throw Error("FIRST_OPEN_G1_EPOCH_MISMATCH");
      const actual = await ports.provisionEpoch(x);
      guardedEpoch(actual);
      return actual;
    },
    cloud: { region: aws.region, getCallerIdentity: x => aws.getCallerIdentity(x),
      describeTenantStack: (id, x) => aws.describeTenantStack(id, x),
      createStack: (stack, x) => aws.applySupervisedTenantStack(stack, { signal: x.signal, createOnly: true }) },
    express: { ...ports.express, completionClient: sql.completion, completionReadClient: sql.inspection,
      secret: { inspectRuntimeSecret: x => ports.express.secret.inspectRuntimeSecret(x), async createInitial(x) {
        guardedEpoch(x.externalFence);
        if (!predicted || x.name !== predicted.name || x.initialVersionId !== predicted.versionId ||
          x.requestSha256 !== predicted.versionId || !equal(x.fence, predicted.epoch.resourceFence)) throw Error("FIRST_OPEN_G1_VERSION_MISMATCH");
        return ports.express.secret.createInitial(x);
      } },
    },
  }, now, input.reviewedTaskBinding);
  return () => run(approval, approvedSha256, formalApprovalSha256);
}

type InjectedRun = Parameters<typeof bindSandboxFirstOpenRunOnce>[0];

/** Reviewed first-open binding: replace supplied generic middle ports with the
 * one fixed task's Neon RPC + exact DynamoDB g1/e1 authority. No live root or
 * credentials are loaded by this assembly. */
export function bindReviewedSandboxFirstOpenRunOnce(input: Omit<InjectedRun, "ports" | "validateHeldBeforeClaim"> & {
  ports: Omit<InjectedRun["ports"], "repository" | "provisionEpoch">;
  middle: { sql: FirstOpenMiddleSql; dynamo: AwsSdkDynamoDbEpochAuthorityDependencies; planHash: string; configurationHash: string };
}, now: () => number = Date.now) {
  const { middle, approval, approvedSha256, sql, ports, aws } = input;
  const originalCheck = ports.cleanupReadiness.verifyBeforeClaim;
  if (!approval.controlledWindow || !originalCheck || Object.values(sql).some(p => Object.is(p, middle.sql))) {
    throw Error("FIRST_OPEN_REVIEWED_MIDDLE_SCOPE");
  }
  const { planHash, configurationHash } = middle;
  const bound = bindSandboxFirstOpenMiddle({ scope: { approvalSha256: approvedSha256, planHash,
    configurationHash, writeBefore: approval.writeBefore, window: approval.controlledWindow, taskRelease: approval.taskRelease },
    sql: middle.sql, dynamo: middle.dynamo, cloud: aws, now });
  return bindSandboxFirstOpenRunOnce({ ...input, validateHeldBeforeClaim(held) {
    if (held.deployment.planHash !== planHash || held.deployment.configurationHash !== configurationHash) throw Error("FIRST_OPEN_MIDDLE_HELD_CHANGED");
  }, ports: { ...ports, repository: bound.repository, provisionEpoch: bound.provisionEpoch,
    cleanupReadiness: { verify: x => ports.cleanupReadiness.verify(x), async verifyBeforeClaim(x) {
      await bound.verifyMiddleReadyBeforeClaim(x.signal);
      await bound.verifyAuthorityVacantBeforeClaim(x.signal);
      return originalCheck.call(ports.cleanupReadiness, x);
    } },
  } }, now);
}
