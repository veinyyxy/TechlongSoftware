import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import { firstOpenBuyerSignerSecretName } from "../lib/buyer-forward/signer-binding.ts";
import {
  AwsSdkDeploymentAdapter,
  createAwsSdkDeploymentAdapter,
  createAwsSdkDeploymentAdapterFromModules,
} from "../lib/deployments/execution/aws-sdk-adapter.ts";
import { EmbeddedCloudFormationCleanupSchedule } from "../lib/deployments/execution/cleanup.ts";
import { MtlsSaaSControlClient } from "../lib/deployments/execution/control-client.ts";
import type { EcsFirstOpenApproval, EcsFirstOpenPorts } from "../lib/deployments/execution/ecs-first-open.ts";
import { runFirstOpenCommand } from "../ops/platform-hosting-v1/first-open.ts";
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
  createEcsFirstOpenRdsAuthority,
  evaluateWorkerRuntimeGate,
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
  runReviewedFirstOnboarding,
  type DeploymentWorkerDependencies,
} from "../lib/deployments/execution/worker.ts";
import {
  awsSandboxTenantStackName,
  renderAwsSandboxTenantStack,
} from "../lib/deployments/cloudformation/tenant-stack.ts";
import { AwsEcsCellPlanOnlyDriver } from "../lib/deployments/drivers/aws-ecs-cell.ts";
import type { DeploymentEnvironment } from "../lib/deployments/environment.ts";
import { FIRST_ACCEPTANCE_APP_IMAGE } from "../lib/deployments/execution/single-deployment-scope.ts";
import { createFirstOnboardingWorkloadStrategy, createSingleTenantWorkloadStrategy, type SupervisedTenantStack, type SupervisedWorkloadAwsPort } from "../lib/deployments/execution/single-tenant-workload-strategy.ts";
import { attachFirstOpenTaskBinding, finalizeSupervisedTenantStack } from "../lib/deployments/execution/single-tenant-workload-strategy.ts";
import { renderSingleTenantAcceptanceWorkload } from "../lib/deployments/cloudformation/single-tenant-acceptance-workload.ts";
import { buildFirstOnboardingJob, CLAIM_FIRST_ONBOARDING, SELECT_FIRST_ONBOARDING, firstOnboardingExpressNames, loadFirstOnboardingReview, reviewFirstOnboarding, type FirstOnboardingReview, type FirstOnboardingReviewRow } from "../lib/deployments/first-onboarding.ts";
import type { InstanceReleaseObservation } from "../lib/deployments/releases/contract.ts";
import { offlineHandoffTitle, offlineRuntimeObservationSha, rebuildOfflineFirstOpenBinding } from "../ops/aws-sandbox/first-open-oidc-offline.ts";
import { firstOpenGitHubHandoff } from "../ops/aws-sandbox/first-open-github-handoff.ts";
import { bindFirstOpenPairedInspect, firstOpenRunOnceHandoff } from "../ops/aws-sandbox/first-open-paired-runtime.ts";
import { prepareFirstOpenInspectSeed, type FirstOpenInspectSeed } from "../ops/aws-sandbox/first-open-inspect-input.ts";
import { firstOpenControlledCfnTemplate } from "../ops/aws-sandbox/first-open-controlled-cfn.ts";
import { FIRST_OPEN_INSPECTOR_SQL_USER } from "../ops/aws-sandbox/first-open-express-database.ts";
import { cycleFixture } from "./instance-release-cycle-fixture.ts";
import { COMPLETE_FIRST_ONBOARDING } from "../lib/deployments/execution/first-onboarding-completion.ts";
import type { ReleaseSamplingBinding } from "../lib/deployments/releases/sampling.ts";
import type { FirstOnboardingDatabaseIdentity } from "../lib/deployments/execution/first-onboarding-express.ts";
import { FIRST_ONBOARDING_COMPLETE_ENTRY, FIRST_ONBOARDING_READ_ENTRY } from "../lib/deployments/execution/first-onboarding-completion-entry.ts";
import type { TenantSecretInspection, TenantDatabaseLifecycleState } from "../lib/deployments/execution/contracts.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { FIRST_OPEN_CELL_STACK, firstOpenExecutionWindow } from "../lib/deployments/execution/first-onboarding-window.ts";
import { bindReviewedSandboxFirstOpenRunOnce, bindSandboxFirstOpenRunOnce, predictSandboxFirstOpenG1 } from "../lib/deployments/execution/first-onboarding-run-composition.ts";
import { FIRST_OPEN_MIDDLE_RPC } from "../lib/deployments/execution/first-onboarding-middle.ts";
import { SANDBOX_FIRST_OPEN as fixedJob } from "../lib/deployments/execution/first-onboarding-run-once.ts";
import { completeFirstOpenBuyerParameters, firstOpenBuyerBinding } from "../lib/deployments/execution/first-open-buyer-binding.ts";
import { FIRST_OPEN_EXPRESS_ENDPOINT, FIRST_OPEN_MANAGEMENT_SQL_USER, compileExpressBootstrapCandidateV3,
  expressBootstrapCandidateDigestV3 } from "../lib/deployments/execution/aurora-express-bootstrap-v3.ts";
import { sandboxFirstOpenPolicyDrafts } from "../lib/deployments/execution/first-onboarding-run-permissions.ts";
import { tenantExternalOperationHash } from "../lib/deployments/execution/external-ownership-coordinator.ts";

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

async function supervisedFixture() {
  const { context } = await executionFixture();
  context.environment = structuredClone(context.environment);
  context.environment.policy.budgetLimitCents = 5000;
  context.deployment.artifactRef = FIRST_ACCEPTANCE_APP_IMAGE;
  for (const key of ["JanitorFunctionArn", "SchedulerInvokeRoleArn", "SchedulerGroupName"]) delete context.binding!.tenantStackParameters[key];
  const scope = { deploymentId: context.deployment.id, appInstanceId: context.appInstance.id, environmentId: context.environment.id,
    planHash: context.deployment.planHash, configurationHash: context.deployment.configurationHash, artifactRef: FIRST_ACCEPTANCE_APP_IMAGE };
  const readiness = { scopeSha256: await sha256Hex(scope), reviewSha256: "b".repeat(64), permissionsEvidenceSha256: "c".repeat(64),
    cellStackId: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/11111111-2222-3333-4444-555555555555",
    verifiedAt: now, expiresAt: now + 7200000, responsibleCallerArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev" as const,
    order: "workload_database_role_generation_secret_then_cell" as const };
  return { context, scope, readiness };
}

test("supervised apply and reconcile use the new workload and reach ready without fake TTL receipt", async () => {
  const { context, scope, readiness } = await supervisedFixture();
  const calls: string[] = [], patches: Record<string, unknown>[] = [];
  let applied: SupervisedTenantStack | undefined;
  const repository = inMemoryRepository({ context, onEnqueue: type => calls.push(`enqueue:${type}`) });
  const strategy = createSingleTenantWorkloadStrategy({ scope, cleanupReadiness: { verify: async () => { calls.push("cleanup-proof"); return readiness; } } });
  const base = readyAwsPort();
  const aws = { ...base,
    applyTenantStack: async () => { throw Error("legacy apply forbidden"); },
    applySupervisedTenantStack: async (stack: SupervisedTenantStack) => {
      calls.push("apply"); applied = stack;
      assert.equal("TenantCleanupSchedule" in (stack.template.Resources as object), false);
      assert.equal("cleanupScheduleFirst" in stack.safety, false);
      assert.equal(stack.resourceInventory.length, 7);
      assert.equal(Object.isFrozen(stack.parameters), true);
      return { operation: "create" as const, stackId: `arn:aws:cloudformation:ca-central-1:402010193138:stack/${stack.stackName}/11111111-2222-3333-4444-555555555555` };
    },
    describeTenantStack: async () => ({ state: "ready" as const, rawStatus: "CREATE_COMPLETE", stackId: `arn:aws:cloudformation:ca-central-1:402010193138:stack/${applied!.stackName}/11111111-2222-3333-4444-555555555555`, outputs: {}, tags: applied!.tags }),
  };
  const dependencies: DeploymentWorkerDependencies = {
    repository: { ...repository, confirmCleanupSchedule: async () => { throw Error("no scheduler confirmation"); },
      transitionDeployment: async input => { patches.push(input.outputPatch ?? {}); return repository.transitionDeployment(input); } },
    applyRuntimeReady: true, tenantWorkloadStrategy: strategy,
    tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
    awsFactory: async () => { calls.push("construct-aws"); return aws; },
    cleanupScheduler: { confirmSchedule: async () => { throw Error("no scheduler"); } },
    sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
    tenantDatabase: { ensureTenantDatabase: async () => { calls.push("database"); return tenantLifecycleOutput(context, "empty"); },
      migrateTenantDatabase: async () => tenantLifecycleOutput(context, "verified") },
    controlClient: { waitUntilHealthy: async () => ({ ready: true, desiredConfigurationHash: null, imageRevision: null }),
      provision: async () => { calls.push("control"); return { accepted: true }; },
      readConfiguration: async () => ({ ready: true, desiredConfigurationHash: scope.configurationHash, imageRevision: FIRST_ACCEPTANCE_APP_IMAGE.split("@")[1] }) },
    controlPayloadCompiler: compiledPayloadCompiler(), now: () => now,
  };
  assert.equal((await runDeploymentWorkerOnce({ workerId: "worker:acceptance-test", config: enabledConfig, dependencies })).status, "succeeded");
  assert.ok(calls.indexOf("cleanup-proof") < calls.indexOf("database"));
  assert.ok(calls.filter(call => call === "cleanup-proof").length >= 3);
  assert.equal(context.cleanupSchedule, null);
  assert.equal(calls.includes("enqueue:cleanup"), false);
  assert.equal(patches.some(patch => patch.cleanupAssuranceRef === `supervised-review:${readiness.reviewSha256}`), true);
  assert.equal(patches.some(patch => "cleanupScheduleRef" in patch), false);
  context.job.jobType = "reconcile";
  assert.equal((await runDeploymentWorkerOnce({ workerId: "worker:acceptance-test", config: enabledConfig, dependencies })).status, "succeeded");
  assert.equal(context.deployment.status, "ready"); assert.ok(calls.includes("control"));
  // DI seam above is a control-flow check, not actual cloud/approval proof.
});

test("invalid supervised scope, binding or cleanup proof fails before generation, AWS and database operations", async () => {
  for (const invalid of ["scope", "stale", "name", "permissions", "deadline", "order", "credentials", "binding"] as const) {
    const { context, scope, readiness } = await supervisedFixture(), calls: string[] = [];
    if (invalid === "scope") scope.configurationHash = "d".repeat(64);
    if (invalid === "stale") readiness.verifiedAt -= 30001;
    if (invalid === "name") readiness.cellStackId = "techlong-sandbox-cell-sandbox-1";
    if (invalid === "permissions") readiness.permissionsEvidenceSha256 = "";
    if (invalid === "deadline") readiness.expiresAt += 1000;
    if (invalid === "order") Object.assign(readiness, { order: "cell_first" });
    if (invalid === "credentials") context.binding!.tenantStackParameters.DatabaseUrlValueFrom = "forbidden";
    if (invalid === "binding") delete context.binding!.tenantStackParameters.ClusterName;
    const forbidden = async (): Promise<never> => { calls.push("forbidden"); throw Error("must not reach"); };
    const result = await runDeploymentWorkerOnce({ workerId: "worker:acceptance-test", config: enabledConfig, dependencies: {
      repository: { ...inMemoryRepository({ context }), claimTenantResourceGeneration: forbidden },
      applyRuntimeReady: true, tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
      tenantWorkloadStrategy: createSingleTenantWorkloadStrategy({ scope, cleanupReadiness: { verify: async () => readiness } }),
      awsFactory: forbidden, cleanupScheduler: { confirmSchedule: forbidden }, sharedCellSecurityPreflight: { verify: forbidden },
      tenantDatabase: { ensureTenantDatabase: forbidden, migrateTenantDatabase: forbidden },
      controlClient: { waitUntilHealthy: forbidden, provision: forbidden, readConfiguration: forbidden },
      controlPayloadCompiler: { compile: forbidden }, now: () => now,
    } });
    assert.equal(result.status, "dead_letter", invalid); assert.deepEqual(calls, [], invalid);
  }
});

test("the exact first-open renderer and cleanup proof share the new expiry without changing requestedAt", async () => {
  const { context, scope, readiness } = await supervisedFixture();
  context.job.id = FIRST_OPEN_BASELINE_BINDING.jobId;
  context.job.payload = { deploymentId: scope.deploymentId, planHash: scope.planHash };
  const originalCreatedAt = now - 3 * 3600_000;
  context.deployment.createdAt = originalCreatedAt;
  const resource = await attachTenantResource(context);
  resource.runtimeSecretRef = tenantRuntimeSecretRef;
  readiness.cellStackId = FIRST_OPEN_CELL_STACK;
  const window = firstOpenExecutionWindow(context.job.id, now + 900_000, { startAt: now, claimBefore: now + 300_000,
    workloadExpiresAt: now + 7200_000, factsExpireAt: now + 900_000, cleanupReviewSha256: readiness.reviewSha256,
    cleanupPermissionsEvidenceSha256: readiness.permissionsEvidenceSha256 })!;
  const strategy = createFirstOnboardingWorkloadStrategy({ scope, window, cleanupReadiness: { verify: async () => readiness } });
  const input = { deploymentId: scope.deploymentId, resourceGeneration: 1,
    externalOperation: { ...context.tenantExternalOperation!, intent: "provision" as const, state: "active" as const },
    runtimeSecretRef: tenantRuntimeSecretRef, runtimeSecretName: tenantRuntimeSecretName, plan: context.deployment.desiredPlan,
    environment: context.environment, imageUri: scope.artifactRef, tenantHostname: "tenant-one.sandbox.techlong.cloud", listenerPriority: 100,
    activeCellCount: 1, activeTenantCount: 0, requestedAt: originalCreatedAt };
  assert.equal(await strategy.ensureCleanup({ context, now, signal: signal() }), `supervised-review:${readiness.reviewSha256}`);
  const result = await strategy.render({ context, stackInput: input });
  const legacy = renderAwsSandboxTenantStack(input);
  assert.equal(result.tags.ExpiresAt, new Date(window.workloadExpiresAt).toISOString());
  assert.equal(legacy.tags.ExpiresAt, new Date(originalCreatedAt + 7200_000).toISOString());
  assert.equal(context.deployment.createdAt, originalCreatedAt);
  assert.equal(result.resourceInventory.length, 7);
  assert.equal(result.safety.automaticCleanupInstalled, false);
  assert.equal(result.templateSha256, await sha256Hex(result.template));
  assert.doesNotMatch(result.templateBody, new RegExp(legacy.tags.ExpiresAt.replaceAll(".", "\\.")));
  assert.match(result.templateBody, /ExpiresAt/);
  readiness.expiresAt = originalCreatedAt + 7200_000;
  await assert.rejects(strategy.ensureCleanup({ context, now, signal: signal() }), /CLEANUP_READINESS_UNPROVED/);
  context.job.id = "job_other";
  await assert.rejects(strategy.render({ context, stackInput: input }), /WINDOW_SCOPE_CHANGED/);
});

test("supervised SDK accepts only finalized immutable material and rechecks provisioner before CreateStack", async () => {
  const { context } = await supervisedFixture();
  const rendered = await renderSingleTenantAcceptanceWorkload({ deploymentId: context.deployment.id, resourceGeneration: 1,
    externalOperation: stackExternalOperation(), runtimeSecretRef: tenantRuntimeSecretRef, runtimeSecretName: tenantRuntimeSecretName,
    plan: context.deployment.desiredPlan, environment: context.environment, imageUri: FIRST_ACCEPTANCE_APP_IMAGE,
    tenantHostname: "tenant-one.sandbox.techlong.cloud", listenerPriority: 100, activeCellCount: 1, activeTenantCount: 0, requestedAt: now });
  const material = finalizeSupervisedTenantStack({ rendered, context, expectedRuntimeSecretName: tenantRuntimeSecretName });
  const calls: string[] = [];
  let stackExists = false;
  class Command { readonly input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
  class Identity extends Command {} class Describe extends Command {} class Create extends Command {} class Update extends Command {} class Delete extends Command {}
  const adapter = new AwsSdkDeploymentAdapter(environment.region, {
    stsClient: { send: async () => { calls.push("identity"); return { Account: "402010193138", Arn: "arn:aws:sts::402010193138:assumed-role/TechlongSandboxProvisionerRole/acceptance-test" }; } },
    cloudFormationClient: { send: async command => {
      if (command instanceof Describe) {
        calls.push("describe");
        if (stackExists) return { Stacks: [{ StackId: `arn:aws:cloudformation:ca-central-1:402010193138:stack/${material.stackName}/11111111-2222-3333-4444-555555555555`, StackStatus: "CREATE_COMPLETE" }] };
        throw Object.assign(Error(`Stack with id ${material.stackName} does not exist`), { name: "ValidationError" });
      }
      if (command instanceof Create) { calls.push("create"); assert.equal(command.input.OnFailure, "ROLLBACK");
        assert.equal(JSON.parse(String(command.input.TemplateBody)).Resources.TenantCleanupSchedule, undefined);
        return { StackId: `arn:aws:cloudformation:ca-central-1:402010193138:stack/${material.stackName}/11111111-2222-3333-4444-555555555555` }; }
      throw Error("Unexpected SDK call");
    } }, commands: { getCallerIdentity: Identity, describeStacks: Describe, createStack: Create, updateStack: Update, deleteStack: Delete },
  });
  await assert.rejects(adapter.applySupervisedTenantStack(structuredClone(material), { signal: signal() }));
  assert.deepEqual(calls, []);
  assert.equal((await adapter.applySupervisedTenantStack(material, { signal: signal() })).operation, "create");
  assert.deepEqual(calls, ["identity", "describe", "identity", "create"]);
  calls.length = 0;
  stackExists = true;
  await assert.rejects(adapter.applySupervisedTenantStack(material, { signal: signal(), createOnly: true }),
    { code: "FIRST_ONBOARDING_STACK_ALREADY_EXISTS" });
  assert.deepEqual(calls, ["identity", "describe"]);
  rendered.tags.ManagedBy = "changed";
  assert.throws(() => finalizeSupervisedTenantStack({ rendered, context, expectedRuntimeSecretName: tenantRuntimeSecretName }));
});

async function firstOpenFixture(expressPlan = false, fixedTask = false, postgresClock?: () => number) {
  const { context, readiness } = await supervisedFixture(), cycle = await cycleFixture();
  const clock = postgresClock ?? (() => now);
  if (postgresClock) {
    const startedAt = postgresClock();
    context.appInstance.templateVersionId = "tplver_restaurant_standard_v1";
    Object.assign(readiness, { verifiedAt: startedAt, expiresAt: startedAt + 7200_000 });
  }
  const calls: string[] = [], transitions: string[] = [];
  const release = structuredClone(cycle.planningInput.release);
  release.id = "release_" + "a".repeat(32);
  release.productId = context.appInstance.productId;
  release.image.repository = "402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast";
  context.environment.applyEnabled = false;
  if (fixedTask) {
    const workspaceId = "wsp_beb2aa5868a9d1c10c257348";
    Object.assign(context.appInstance, { id: fixedJob.instanceId, workspaceId, subscriptionId: fixedJob.subscriptionId,
      tenantKey: "pending_" + fixedJob.instanceId, slug: fixedJob.hostname.split(".")[0] });
    context.workspace.id = workspaceId;
    context.subscription!.id = fixedJob.subscriptionId;
    context.deployment.appInstanceId = fixedJob.instanceId;
    context.deployment.createdAt = now - 3 * 3600_000;
    context.deployment.desiredPlan = new AwsEcsCellPlanOnlyDriver({ region: fixedJob.region, cellKey: "cell-sandbox-1", mode: "aws_sandbox" })
      .buildPlan({ appInstanceId: fixedJob.instanceId, workspaceId, productId: fixedJob.productId, planId: "plan_basic",
        subscriptionId: fixedJob.subscriptionId, tenantKey: context.appInstance.tenantKey, deploymentProfileKey: "standard-v1" });
    context.binding!.tenantStackParameters.ControlPublicKeyValueFrom = fixedJob.controlArn;
    release.id = fixedJob.releaseId;
    Object.assign(release.image, { repository: fixedJob.imageRepository, manifestDigest: fixedJob.imageDigest, platformDigest: fixedJob.imageDigest });
    Object.assign(release.compatibility, { schemaVersions: [fixedJob.schemaVersion], clientApiVersions: [fixedJob.clientApi] });
    readiness.cellStackId = fixedJob.cellStack;
  }
  context.deployment.artifactRef = `${release.image.repository}@${release.image.manifestDigest}`;
  if (expressPlan) {
    const { databaseName, roleName } = await firstOnboardingExpressNames({ appInstanceId: context.appInstance.id, workspaceId: context.workspace.id,
      productId: context.appInstance.productId, environmentId: context.environment.id, cellKey: context.environment.cellKey });
    Object.assign(context.deployment.desiredPlan.resources.tenant.database, { databaseName, roleName });
    context.deployment.planHash = await sha256Hex(context.deployment.desiredPlan);
  }
  const scope = { appInstanceId: context.appInstance.id, workspaceId: context.workspace.id, tenantKey: context.appInstance.tenantKey,
    subscriptionId: context.subscription!.id, templateVersionId: context.appInstance.templateVersionId, environmentId: context.environment.id,
    accountId: context.environment.expectedAccountId, planId: "plan_basic", releaseId: release.id, artifactRef: context.deployment.artifactRef,
    planHash: context.deployment.planHash, configurationHash: context.deployment.configurationHash };
  const held = (await buildFirstOnboardingJob(scope))!;
  context.deployment.id = held.deploymentId;
  const bound = { deploymentId: held.deploymentId, appInstanceId: scope.appInstanceId, environmentId: scope.environmentId,
    planHash: scope.planHash, configurationHash: scope.configurationHash, artifactRef: scope.artifactRef };
  readiness.scopeSha256 = await sha256Hex(bound);
  const row: FirstOnboardingReviewRow = { ...scope, configuration: context.appInstance.configurationSnapshot, desiredPlan: context.deployment.desiredPlan,
    slug: context.appInstance.slug, subscriptionEnd: now + 3600000, instancePendingFirstOpen: true, subscriptionActiveAndCurrent: true,
    scopeStillEligible: true, noOtherDeploymentOrTenantGeneration: true,
    deployment: { id: held.deploymentId, status: "planned", planHash: scope.planHash, configurationHash: scope.configurationHash, artifactRef: scope.artifactRef },
    job: { id: held.jobId, deploymentId: held.deploymentId, status: "pending", jobType: "apply", payload: held.payload, dedupeKey: held.dedupeKey,
      attempts: 0, maxAttempts: 1, availableAt: held.availableAt, leaseOwner: null, leaseToken: null, leaseExpiresAt: null, completedAt: null } };
  const review = (await reviewFirstOnboarding({ ...row, scope, release }))!;
  const approval: Parameters<typeof runReviewedFirstOnboarding>[0]["approval"] = { jobId: held.jobId, reviewSha256: review.reviewSha256, capabilitySha256: "c".repeat(64),
    baselineDigest: "b".repeat(64), databaseSchemaVersion: "schema-v1", hostname: "tenant-one.sandbox.techlong.cloud",
    dnsTarget: "shared.elb.amazonaws.com", writeBefore: now + 120000 };
  if (fixedTask) Object.assign(approval, { hostname: fixedJob.hostname, databaseSchemaVersion: fixedJob.schemaVersion,
    dnsTarget: "synthetic-elb.ca-central-1.elb.amazonaws.com", writeBefore: now + 900_000,
    controlledWindow: { startAt: now, claimBefore: now + 300_000, workloadExpiresAt: readiness.expiresAt, factsExpireAt: now + 900_000,
      cleanupReviewSha256: readiness.reviewSha256, cleanupPermissionsEvidenceSha256: readiness.permissionsEvidenceSha256 } });
  let applied: SupervisedTenantStack | undefined, stackId = "", consumed = false;
  const options: Parameters<typeof runReviewedFirstOnboarding>[0] = { approval, approvedSha256: await sha256Hex(approval),
    config: { ...enabledConfig, workerEnabled: false, applyEnabled: false }, cleanupReadiness: { verify: async () => readiness },
    readJob: async (sql, params) => { assert.equal(sql, SELECT_FIRST_ONBOARDING); assert.deepEqual(params, [held.jobId]); return row; },
    readRelease: async id => { assert.equal(id, release.id); return release; },
    verifyEmptyExpressCapability: async () => ({ profile: "express_iam", emptyDatabaseInitializationVerified: true, evidenceSha256: "c".repeat(64) }),
    claimJob: async (sql, bindings) => {
      assert.equal(sql, CLAIM_FIRST_ONBOARDING); assert.equal(bindings[0], held.jobId); assert.equal(bindings[4], held.deploymentId);
      calls.push("claim");
      if (consumed) return null;
      consumed = true;
      return { jobId: held.jobId };
    },
    independentReader: { capture: async request => {
      calls.push("inspect");
      const stack = applied!, resource = context.tenantResources!;
      assert.equal(request.stackId, stackId);
      assert.equal(request.hostname, approval.hostname);
      assert.equal(request.databaseName, resource.identity.databaseName);
      const facts = cycle.facts();
      const observedAt = clock();
      Object.assign(facts, { observedAt, checks: facts.checks.map(c => ({ ...c, checkedAt: observedAt })), stackId, stackStatus: "CREATE_COMPLETE",
        template: stack.template, tags: stack.tags, parameters: stack.parameters, roleArn: stack.cloudFormationRoleArn,
        persistentUploadsReady: false, artifact: { ...facts.artifact, repository: release.image.repository } });
      facts.resources = Object.fromEntries(stack.resourceInventory.map(({ logicalId, type }) => [logicalId,
        facts.resources[logicalId] ?? { type, physicalId: `synthetic-${logicalId}` }])) as typeof facts.resources;
      facts.taskDefinition.containerDefinitions![0].image = scope.artifactRef;
      Object.assign(facts.tasks[0].containers![0], { image: scope.artifactRef, imageDigest: release.image.platformDigest });
      return { facts, dns: { hostname: approval.hostname, target: approval.dnsTarget },
        database: { name: resource.identity.databaseName, roleName: resource.identity.roleName, baselineDigest: approval.baselineDigest,
          ownershipMarker: resource.ownershipMarker } };
    } },
    dependencies: { repository: {
      ...inMemoryRepository({ context, transitions, onMarkReady: () => assert.fail("step 3 activation"),
        onEnqueue: () => assert.fail("no sibling job"), reserveCapacity: () => { calls.push("capacity"); return true; } }),
      claimNext: async () => assert.fail("ordinary queue"), retryJob: async () => assert.fail("no retry"),
      loadContext: async job => { context.job = job; return context; },
      finishStep: async step => { assert.equal(step.lease.jobId, held.jobId); assert.equal(step.lease.attempt, 1);
        if (step.stepId === "step_first_onboarding_independent_inspection" && step.status === "succeeded") calls.push("receipt");
        return true;
      },
      completeJob: async () => assert.fail("activation and completion belong to step 3"),
    },
      applyRuntimeReady: false, tenantExternalOperationCoordinator: readyExternalOperationCoordinator(),
      awsFactory: async () => ({ ...readyAwsPort(),
        applyTenantStack: async () => assert.fail("legacy apply"),
        applySupervisedTenantStack: async (stack: SupervisedTenantStack, { createOnly }: { createOnly?: true }) => {
          assert.equal(createOnly, true); assert.equal(stack.resourceInventory.length, 7); calls.push("create"); applied = stack;
          stackId = `arn:aws:cloudformation:ca-central-1:402010193138:stack/${stack.stackName}/11111111-2222-3333-4444-555555555555`;
          return { operation: "create" as const, stackId };
        },
        describeTenantStack: async () => applied
          ? { state: "ready" as const, rawStatus: "CREATE_COMPLETE", stackId, outputs: {}, tags: applied.tags }
          : { state: "missing" as const, rawStatus: null, stackId: null, outputs: {}, tags: {} },
      }),
      cleanupScheduler: { confirmSchedule: async () => assert.fail("no schedule writes") },
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(), controlPayloadCompiler: compiledPayloadCompiler(),
      tenantDatabase: { ensureTenantDatabase: async () => { calls.push("prepare"); return tenantLifecycleOutput(context, "empty"); },
        migrateTenantDatabase: async () => { calls.push("migrate"); return tenantLifecycleOutput(context, "verified"); } },
      controlClient: { waitUntilHealthy: async () => ({ ready: true, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => { calls.push("configure"); return { accepted: true }; },
        readConfiguration: async () => ({ ready: true, desiredConfigurationHash: scope.configurationHash, imageRevision: release.image.manifestDigest }) },
      now: clock,
    },
  };
  return { options, context, calls, transitions, row, release, readiness, stack: () => ({ applied: applied!, stackId }) };
}

test("reviewed first-open runs one held job to independent technical proof, not active/ready", async () => {
  const { options, context, calls, transitions, row } = await firstOpenFixture();
  const result = await runReviewedFirstOnboarding(options);
  assert.equal(result.jobId, row.job.id); assert.equal(result.deploymentId, row.deployment.id);
  assert.equal(result.runtime.persistentUploadsReady, false); assert.equal(result.customerActivated, false);
  assert.deepEqual(transitions, ["queued", "preflight", "database_preparing", "migrating", "infrastructure_provisioning", "waiting_healthy", "configuring", "verifying"]);
  assert.deepEqual(calls, ["claim", "capacity", "prepare", "migrate", "capacity", "create", "capacity", "configure", "inspect", "receipt"]);
  assert.equal(context.appInstance.status, "pending");
  assert.equal(context.deployment.status, "verifying");
  await assert.rejects(runReviewedFirstOnboarding(options), /FIRST_ONBOARDING_CLAIM_NOT_PROVED/);
  assert.equal(calls.filter(call => call === "create").length, 1);
});

async function ecsFirstOpenFixture() {
  const fixture = await firstOpenFixture();
  const { options, context, row, release, calls } = fixture;
  const executionId = `exec_${"9".repeat(32)}`;
  const { jobId, reviewSha256, baselineDigest, databaseSchemaVersion, dnsTarget, hostname, writeBefore } = options.approval;
  const approval: EcsFirstOpenApproval = { executionId, approvedBy: "admin_fixture", approvedAt: options.dependencies.now!() - 1,
    jobId, reviewSha256, baselineDigest, databaseSchemaVersion, dnsTarget, hostname, writeBefore,
    instanceId: context.appInstance.id, workspaceId: context.workspace.id, releaseId: release.id };
  const ports: EcsFirstOpenPorts = {
    readApproval: async id => { assert.equal(id, executionId); calls.push("approval"); return approval; },
    readOne: options.readJob,
    readRelease: options.readRelease,
    async claimApproved(stored, sql, bindings) {
      assert.deepEqual(stored, approval);
      assert.equal(bindings[1], executionId);
      assert.equal(bindings[3], writeBefore);
      const claimed = await options.claimJob(sql, bindings);
      return claimed && { executionId, ...claimed };
    },
    management: { dependencies: options.dependencies, config: options.config, cleanupReadiness: options.cleanupReadiness },
    reader: options.independentReader!,
  };
  return { ...fixture, ports, executionId, approval, row, run: () => runFirstOpenCommand([executionId], async () => ports) };
}

async function rdsFirstOpenFixture() {
  const fixture = await ecsFirstOpenFixture();
  const { ports, approval, release, row, context } = fixture;
  const identity = {
    taskArn: "arn:aws:ecs:ca-central-1:402010193138:task/techlong-sandbox-platform/" + "a".repeat(32),
    taskDefinitionArn: "arn:aws:ecs:ca-central-1:402010193138:task-definition/techlong-sandbox-first-open-v1:17",
    roleArn: "arn:aws:iam::402010193138:role/TechlongSandboxFirstOpenTaskRole",
  };
  ports.management.databaseProfile = "full_password";
  ports.management.config = { ...ports.management.config, workerRoleArn: identity.roleArn };
  release.compatibility.databaseProfiles = ["full_password"];
  const review = await loadFirstOnboardingReview(approval.jobId, {
    databaseProfile: "full_password", readOne: async () => row, readRelease: async () => release,
  });
  assert.ok(review);
  approval.reviewSha256 = review.reviewSha256;
  const scope = { ...identity, ...approval };
  const rdsApplicationSecret = { arn: tenantRuntimeSecretRef, versionId: "a".repeat(64) };
  const rdsControlPublicKey = { arn: context.binding!.tenantStackParameters.ControlPublicKeyValueFrom, versionId: "b".repeat(64) };
  const rdsPersistence = { bucket: "techlong-sandbox-synthetic-media", providerVariable: "IMAGE_STORAGE_PROVIDER" as const,
    bucketVariable: "IMAGE_S3_BUCKET" as const, verificationSha256: "c".repeat(64), mediaPublicBaseUrl: "https://synthetic.cloudfront.net" };
  const rdsPrivateSubnetIds = ["subnet-fedcba98765432101", "subnet-1234abcd"] as const;
  ports.management = { ...ports.management, rdsApplicationSecret, rdsControlPublicKey, rdsPersistence, rdsPrivateSubnetIds };
  const factory = ports.management.dependencies.awsFactory!;
  const awsRoles: string[] = [];
  ports.management.dependencies.awsFactory = async input => {
    awsRoles.push(input.workerRoleArn);
    assert.equal(input.workerRoleArn, identity.roleArn);
    const aws = await factory(input);
    return { ...aws, getCallerIdentity: async () => ({ accountId: "402010193138",
      arn: "arn:aws:sts::402010193138:assumed-role/TechlongSandboxFirstOpenTaskRole/fixture-task" }) };
  };
  return { ...fixture, scope, rdsApplicationSecret, rdsControlPublicKey, rdsPersistence, rdsPrivateSubnetIds, awsRoles };
}

test("ECS first open runs a single claim, real management and a fresh self-check in one command", async () => {
  const { run, calls, context, executionId, ports, stack } = await ecsFirstOpenFixture();
  const legacySubnetIds = context.binding!.tenantStackParameters.SubnetIds;
  const control = ports.management.dependencies.controlClient;
  const read = control.readConfiguration.bind(control);
  control.readConfiguration = async input => { calls.push("read-config"); return read(input); };
  const result = await run();
  assert.equal(result.executionId, executionId);
  assert.equal(result.outcome, "SELF_CHECK_PASSED");
  assert.equal(result.runtime.instanceId, context.appInstance.id);
  const { applied } = stack();
  const resources = applied.template.Resources as Record<string, { Properties: { NetworkConfiguration: unknown } }>;
  assert.equal(applied.parameters.SubnetIds, legacySubnetIds);
  assert.deepEqual(resources.TenantService.Properties.NetworkConfiguration, {
    AwsvpcConfiguration: { AssignPublicIp: "ENABLED", SecurityGroups: [{ Ref: "TaskSecurityGroupId" }], Subnets: { Ref: "SubnetIds" } },
  });
  assert.deepEqual(calls, ["approval", "claim", "capacity", "prepare", "migrate", "capacity", "create", "capacity", "configure",
    "read-config", "inspect", "read-config"]);
  assert.equal(context.appInstance.status, "pending");
  assert.equal(context.deployment.status, "verifying");
  await assert.rejects(run(), /ECS_FIRST_OPEN_CLAIM_UNCONFIRMED/);
  assert.equal(calls.filter(call => call === "create").length, 1);
});

test("T4.2 RDS first-open role needs the matching runtime capability and never changes the shared worker role", async () => {
  const { run, ports, scope, context, calls, rdsApplicationSecret, rdsControlPublicKey, rdsPersistence, awsRoles } = await rdsFirstOpenFixture();
  const authority = createEcsFirstOpenRdsAuthority(scope);
  assert.throws(() => createEcsFirstOpenRdsAuthority({ ...scope, roleArn: context.binding!.workerRoleArn }),
    /ECS_FIRST_OPEN_RDS_AUTHORITY_SCOPE/);
  assert.ok(evaluateWorkerRuntimeGate(ports.management.config).failures.includes("runtime_worker_role_invalid"));
  await assert.rejects(run(), /ECS_FIRST_OPEN_RDS_AUTHORITY_REQUIRED/);
  ports.management.rdsAuthority = structuredClone(authority);
  await assert.rejects(run(), /ECS_FIRST_OPEN_RDS_AUTHORITY_REQUIRED/);
  ports.management.rdsAuthority = createEcsFirstOpenRdsAuthority({ ...scope, instanceId: "app_other" });
  await assert.rejects(run(), /ECS_FIRST_OPEN_RDS_AUTHORITY_REQUIRED/);
  ports.management.rdsAuthority = authority;
  ports.management.rdsApplicationSecret = undefined;
  await assert.rejects(run(), /ECS_FIRST_OPEN_RDS_SECRET_VERSION_REQUIRED/);
  ports.management.rdsApplicationSecret = { ...rdsApplicationSecret, arn: rdsApplicationSecret.arn.replace("/g1-", "/g2-") };
  await assert.rejects(run(), /ECS_FIRST_OPEN_RDS_SECRET_SCOPE_CHANGED/);
  ports.management.rdsApplicationSecret = { ...rdsApplicationSecret, versionId: "AWSCURRENT" };
  await assert.rejects(run(), /ECS_FIRST_OPEN_RDS_SECRET_VERSION_REQUIRED/);
  ports.management.rdsApplicationSecret = rdsApplicationSecret;
  ports.management.rdsControlPublicKey = undefined;
  await assert.rejects(run(), /ECS_FIRST_OPEN_RDS_SECRET_VERSION_REQUIRED/);
  ports.management.rdsControlPublicKey = rdsControlPublicKey;
  ports.management.rdsPersistence = undefined;
  await assert.rejects(run(), /ECS_FIRST_OPEN_RDS_PERSISTENCE_REQUIRED/);
  ports.management.rdsPersistence = rdsPersistence;
  assert.ok(!calls.includes("claim"));

  const expectedSharedRole = context.binding!.workerRoleArn;
  const events: Parameters<NonNullable<EcsFirstOpenPorts["lifecycle"]>["record"]>[2][] = [];
  ports.lifecycle = {
    async record(_approval, _job, event) { events.push(event); },
    async complete() { return assert.fail("unconfirmed database cannot complete"); },
  };
  ports.management.dependencies.tenantDatabase!.migrateTenantDatabase = async () => {
    throw Object.assign(Error("TENANT_POSTGRES_INITIALIZATION_UNCONFIRMED"), {
      code: "TENANT_POSTGRES_INITIALIZATION_UNCONFIRMED", retryable: false,
    });
  };
  await assert.rejects(run(), /TENANT_POSTGRES_INITIALIZATION_UNCONFIRMED/);
  assert.deepEqual(events, [
    { step: "database_initialization", status: "started" },
    { step: "database_initialization", status: "unknown", errorCode: "RESULT_UNCONFIRMED" },
  ]);
  assert.deepEqual(awsRoles, [scope.roleArn]);
  assert.equal(context.binding!.workerRoleArn, expectedSharedRole);
  assert.equal(calls.filter(call => call === "claim").length, 1);
  assert.ok(!calls.includes("create") && !calls.includes("inspect"));
});

test("T4.2 RDS first-open rejects missing and invalid private subnet IDs before claiming", async () => {
  const { ports, scope, run, calls, rdsPrivateSubnetIds } = await rdsFirstOpenFixture();
  ports.management.rdsAuthority = createEcsFirstOpenRdsAuthority(scope);
  const [first, second] = rdsPrivateSubnetIds;
  for (const subnetIds of [undefined, [], [first], [first, second, "subnet-2345abcd"], [first, first],
    [first, "subnet-1234ABCD"], [first, "subnet-123abcd"]]) {
    ports.management.rdsPrivateSubnetIds = subnetIds;
    calls.length = 0;
    await assert.rejects(run(), /ECS_FIRST_OPEN_RDS_PRIVATE_SUBNETS_REQUIRED/);
    assert.deepEqual(calls, ["approval"]);
  }
});

test("T4.2 RDS first-open rejects overlap with the legacy subnet binding before tenant management", async () => {
  const { ports, scope, run, context, calls, rdsPrivateSubnetIds } = await rdsFirstOpenFixture();
  ports.management.rdsAuthority = createEcsFirstOpenRdsAuthority(scope);
  const [legacySubnetId] = context.binding!.tenantStackParameters.SubnetIds.split(",");
  ports.management.rdsPrivateSubnetIds = [rdsPrivateSubnetIds[0], legacySubnetId];
  await assert.rejects(run(), /ECS_FIRST_OPEN_RDS_PRIVATE_SUBNETS_SCOPE/);
  assert.deepEqual(calls, ["approval", "claim"]);
});

test("T4.2 RDS first-open renders exact private subnet order, workload Secret versions, TLS and persistence", async () => {
  const { ports, scope, run, stack, calls, context, rdsApplicationSecret, rdsControlPublicKey, rdsPersistence,
    rdsPrivateSubnetIds } = await rdsFirstOpenFixture();
  const legacySubnetIds = context.binding!.tenantStackParameters.SubnetIds;
  ports.management.rdsAuthority = createEcsFirstOpenRdsAuthority(scope);
  const originalReader = ports.reader;
  ports.reader = { async capture(target) {
    const result = await originalReader.capture(target);
    const { facts } = result;
    const { applied } = stack();
    const resources = applied.template.Resources as Record<string, unknown>;
    const resource = resources.TenantTaskDefinition as { Properties: { ContainerDefinitions: Array<{
      Name: string; Environment: { Name: string; Value: string | object }[];
      Secrets: { Name: string; ValueFrom: { "Fn::Sub": string } }[];
    }> } };
    const [app] = resource.Properties.ContainerDefinitions;
    assert.equal(app.Name, "speedfeast-backend");
    const parameters = applied.template.Parameters as Record<string, unknown>;
    assert.deepEqual(parameters.TenantRuntimeSecretArn, { Type: "String", Default: rdsApplicationSecret.arn,
      AllowedValues: [rdsApplicationSecret.arn] });
    const privateSubnetIds = rdsPrivateSubnetIds.join(",");
    assert.deepEqual(parameters.SubnetIds, { Type: "String", Default: privateSubnetIds, AllowedValues: [privateSubnetIds] });
    assert.equal(applied.parameters.SubnetIds, privateSubnetIds);
    assert.equal(context.binding!.tenantStackParameters.SubnetIds, legacySubnetIds);
    const tenantService = resources.TenantService as { Properties: { NetworkConfiguration: unknown } };
    assert.deepEqual(tenantService.Properties.NetworkConfiguration, {
      AwsvpcConfiguration: { AssignPublicIp: "DISABLED", SecurityGroups: [{ Ref: "TaskSecurityGroupId" }],
        Subnets: { "Fn::Split": [",", { Ref: "SubnetIds" }] } },
    });
    assert.equal(applied.parameters.JwtExpiresIn, "7d");
    assert.equal(applied.parameters.MerchantJwtExpiresIn, "12h");
    const secretSelectors = Object.fromEntries(app.Secrets.map(secret => [secret.Name,
      secret.ValueFrom["Fn::Sub"].replace(/\$\{([^}]+)\}/g, (_, key) => applied.parameters[key])]));
    assert.deepEqual(secretSelectors, {
      DATABASE_URL: `${rdsApplicationSecret.arn}:database_url::${rdsApplicationSecret.versionId}`,
      HMAC_SECRET_KEY: `${rdsApplicationSecret.arn}:hmac_secret_key::${rdsApplicationSecret.versionId}`,
      JWT_SECRET_KEY: `${rdsApplicationSecret.arn}:jwt_secret_key::${rdsApplicationSecret.versionId}`,
      STRIPE_SECRET_KEY: `${rdsApplicationSecret.arn}:stripe_secret_key::${rdsApplicationSecret.versionId}`,
      STRIPE_WEBHOOK_SECRET: `${rdsApplicationSecret.arn}:stripe_webhook_secret::${rdsApplicationSecret.versionId}`,
      SAAS_CONTROL_PUBLIC_KEY: `${rdsControlPublicKey.arn}:::${rdsControlPublicKey.versionId}`,
    });
    const renderedEnv = Object.fromEntries(app.Environment.map(entry => [entry.Name, entry.Value]));
    assert.equal(renderedEnv.PG_DATABASE_PROFILE, "full_password");
    assert.equal(renderedEnv.PGSSLROOTCERT, "/usr/local/share/ca-certificates/aws-rds-global-bundle.pem");
    assert.equal(renderedEnv.IMAGE_S3_BUCKET, rdsPersistence.bucket);
    assert.equal(renderedEnv.DATABASE_URL, undefined);
    facts.databaseProfile = "full_password";
    const describedApp = facts.taskDefinition.containerDefinitions![0];
    describedApp.name = facts.tasks[0].containers![0].name = facts.service.loadBalancers![0].containerName = app.Name;
    describedApp.environment = app.Environment.filter((entry): entry is { Name: string; Value: string } => typeof entry.Value === "string")
      .map(({ Name, Value }) => ({ name: Name, value: Value }));
    describedApp.secrets = Object.entries(secretSelectors).map(([name, valueFrom]) => ({ name, valueFrom }));
    return result;
  } };
  assert.equal((await run()).outcome, "SELF_CHECK_PASSED");
  assert.equal(calls.filter(call => call === "create").length, 1);
});

const firstOpenT3PgBin = process.env.FIRST_OPEN_T3_PG_BIN;
test("T3 offline approval, simulated ECS, same-process opening and native PostgreSQL readback", {
  skip: !firstOpenT3PgBin && "set FIRST_OPEN_T3_PG_BIN to the local PostgreSQL 16.14 binaries",
  timeout: 120_000,
}, async t => {
  const { verifyFirstOpenT3 } = await import(new URL("./first-open-t3.fixture.mjs", import.meta.url).href);
  const bundle = process.env.FIRST_OPEN_T3_COMPILED === "1"
    ? await import(new URL("../dist/first-open/first-open.mjs", import.meta.url).href)
    : null;
  if (bundle) {
    assert.equal(typeof bundle.runFirstOpenCommand, "function");
    assert.equal(typeof bundle.createEcsFirstOpenTaskPorts, "function");
  }
  await verifyFirstOpenT3(t, firstOpenT3PgBin, {
    createFixture: () => firstOpenFixture(true, false, Date.now),
    tenantLifecycleOutput,
    runFirstOpenCommand: bundle?.runFirstOpenCommand ?? runFirstOpenCommand,
    createTaskPorts: bundle?.createEcsFirstOpenTaskPorts,
  });
});

test("ECS first open stops before claim with no approval, a different instance, or missing dependencies", async () => {
  const { run, ports, approval, executionId } = await ecsFirstOpenFixture();
  const load = async () => { throw Error("fixture dependencies missing"); };
  await assert.rejects(runFirstOpenCommand([executionId, "extra"], load), /ECS_FIRST_OPEN_EXECUTION_ID/);
  await assert.rejects(runFirstOpenCommand([executionId], load), /fixture dependencies missing/);
  ports.claimApproved = async () => assert.fail("claim without bound approval or dependencies");
  ports.readApproval = async () => null;
  await assert.rejects(run(), /ECS_FIRST_OPEN_APPROVAL_REQUIRED/);
  ports.readApproval = async () => ({ ...approval, instanceId: "app_wrong" });
  await assert.rejects(run(), /ECS_FIRST_OPEN_APPROVAL_SCOPE/);
  ports.readApproval = async () => ({ ...approval, jobId: FIRST_OPEN_BASELINE_BINDING.jobId });
  await assert.rejects(run(), /ECS_FIRST_OPEN_LEGACY_SOURCE_BOUND/);
  ports.readApproval = async () => approval;
  ports.management.dependencies.tenantExternalOperationCoordinator = undefined;
  await assert.rejects(run(), /ECS_FIRST_OPEN_MANAGEMENT_DEPENDENCIES/);
});

test("ECS first open stops after Management fails, or before activation when self-check finds a mismatch", async () => {
  const management = await ecsFirstOpenFixture();
  management.ports.management.dependencies.tenantDatabase!.migrateTenantDatabase = async () => { throw Error("fixture migration failed"); };
  await assert.rejects(management.run(), /fixture migration failed/);
  assert.deepEqual(management.calls, ["approval", "claim", "capacity", "prepare"]);

  const inspection = await ecsFirstOpenFixture();
  const reader = inspection.ports.reader;
  inspection.ports.reader = { async capture(input) {
    const observed = await reader.capture(input);
    observed.facts.checks[1].status = 503;
    return observed;
  } };
  await assert.rejects(inspection.run(), /RELEASE_TECHNICAL_ENDPOINTS_NOT_VERIFIED/);
  assert.equal(inspection.calls.at(-1), "inspect");
  assert.equal(inspection.context.appInstance.status, "pending");
  assert.equal(inspection.context.deployment.status, "verifying");
});

async function authorizeFirstOpenCompletion(options: Parameters<typeof runReviewedFirstOnboarding>[0],
  mismatch?: "bucket" | "sampling" | "ephemeral") {
  const root = "arn:aws:cloudformation:ca-central-1:402010193138:stack/";
  const suffix = "/11111111-2222-3333-4444-555555555555";
  const ref = { arn: tenantRuntimeSecretRef, versionId: "00000000-0000-4000-8000-000000000001" };
  const sampling: ReleaseSamplingBinding = {
    cellStackId: root + "sandbox-cell" + suffix, platformStackId: root + "sandbox-platform" + suffix, hostedZoneId: "ZTEST",
    apiHostname: options.approval.hostname, cellOutputParameters: {
      ClusterName: "ClusterName", HttpsListenerArn: "HttpsListenerArn", ControlListenerArn: "ControlListenerArn",
    }, database: { kind: "cluster", identifier: "sandbox-express", profile: "express_iam", schemaVersion: "schema-v1" },
    secrets: [ref], persistence: { bucket: "sandbox-test-images", providerVariable: "IMAGE_STORAGE_PROVIDER", bucketVariable: "IMAGE_S3_BUCKET",
      verificationSha256: "5".repeat(64) },
  };
  options.approval.completion = { clientApiVersion: "v1", samplingSha256: await sha256Hex(sampling) };
  options.approvedSha256 = await sha256Hex(options.approval);
  const reader = options.independentReader!;
  options.independentReader = { capture: async req => {
    const result = await reader.capture(req), { facts } = result;
    facts.persistentUploadsReady = mismatch !== "ephemeral";
    const api = facts.taskDefinition.containerDefinitions![0];
    api.environment = [{ name: "IMAGE_STORAGE_PROVIDER", value: "s3" },
      { name: "IMAGE_S3_BUCKET", value: mismatch === "bucket" ? "wrong-bucket" : sampling.persistence.bucket }];
    api.secrets = [{ name: "JWT_SECRET", valueFrom: `${ref.arn}:jwt::${ref.versionId}` }];
    facts.relatedBindings = { database: sampling.database.identifier, schemaVersion: sampling.database.schemaVersion,
      persistenceEvidence: sampling.persistence.verificationSha256, cell: "1".repeat(64), platform: "2".repeat(64), dns: "3".repeat(64),
      [ref.arn]: ref.versionId };
    return { ...result, sampling: { ...sampling, hostedZoneId: mismatch === "sampling" ? "ZOTHER" : sampling.hostedZoneId } };
  } };
}

test("authorized completion sends exactly one proof-bound statement after independent inspection", async () => {
  const { options, calls, row } = await firstOpenFixture();
  await authorizeFirstOpenCompletion(options);
  options.completeFirstOnboarding = async (sql, [material, bindingText, token]) => {
    assert.equal(sql, COMPLETE_FIRST_ONBOARDING);
    assert.equal(calls.at(-1), "receipt");
    calls.push("atomic");
    const request = JSON.parse(material), binding = JSON.parse(bindingText);
    assert.match(token, /^lease_[a-f0-9]{32}$/);
    assert.equal(request.jobId, row.job.id);
    assert.deepEqual(request.jobPayload, row.job.payload);
    assert.equal(request.receipt.initialBindingSha256, await sha256Hex(bindingText));
    assert.equal(request.receipt.runtime.configurationSha256, binding.configurationSha256);
    assert.equal(binding.initialized, true); assert.equal(binding.stateRevision, 0);
    assert.equal(binding.currentRelease.id, request.receipt.releaseId);
    assert.equal(binding.sampling.apiHostname, options.approval.hostname);
    return { instanceId: row.appInstanceId, committed: 1 };
  };
  const outcome = await runReviewedFirstOnboarding(options);
  assert.equal(outcome.outcome, "ACTIVATED");
  assert.equal(outcome.customerActivated, true);
  assert.equal(calls.filter(c => c === "atomic").length, 1);
});

test("D2 proof mismatches do not activate; unknown commit is not retried", async () => {
  for (const mismatch of ["bucket", "sampling", "ephemeral"] as const) {
    const { options, context } = await firstOpenFixture();
    await authorizeFirstOpenCompletion(options, mismatch);
    options.completeFirstOnboarding = async () => assert.fail("must not write");
    await assert.rejects(runReviewedFirstOnboarding(options), /FIRST_ONBOARDING_D2_/);
    assert.equal(context.appInstance.status, "pending");
  }
  const { options, calls } = await firstOpenFixture();
  await authorizeFirstOpenCompletion(options);
  await assert.rejects(runReviewedFirstOnboarding(options), /COMPLETION_SCOPE_MISMATCH/);
  assert.deepEqual(calls, []);
  let writes = 0;
  options.completeFirstOnboarding = async () => { writes++; throw Error("connection lost"); };
  await assert.rejects(runReviewedFirstOnboarding(options), /COMPLETION_UNCONFIRMED/);
  await assert.rejects(runReviewedFirstOnboarding(options), /CLAIM_NOT_PROVED/);
  assert.equal(writes, 1);
});

async function derivedFirstOpenFixture(negative?: "caller" | "second-version" | "late-version" | "database-oid" | "old-bucket" | "grant" | "readback", fixedBaseline = false, fixedTask = false) {
  const f = await firstOpenFixture(true, fixedTask), { options, context, calls } = f, { approval } = options;
  const templateReader = options.independentReader!;
  delete options.independentReader;
  const n = await firstOnboardingExpressNames({ appInstanceId: context.appInstance.id, workspaceId: context.workspace.id,
    productId: context.appInstance.productId, environmentId: environment.id, cellKey: environment.cellKey });
  const archiveSha256 = "1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a";
  const manifestSha256 = "62b5dc8cadcf276df140be86e002a08b64d9b713bd0257e14ac515c12a996971";
  const cell = fixedTask ? fixedJob.cellStack : "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/11111111-2222-3333-4444-555555555555";
  const control = { arn: context.binding!.tenantStackParameters.ControlPublicKeyValueFrom, versionId: fixedTask ? fixedJob.controlVersion : "f".repeat(64) };
  const s = n.stableIdentity.slice(0,16);
  const cluster = "techlong-sandbox-express-d001", resourceId = "cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM";
  const mediaUrl = "https://firstopensynthetic.cloudfront.net";
  const bucket = `techlong-sandbox-tenant-images-402010193138-${s}`;
  const appRole = `arn:aws:iam::402010193138:role/TechlongSandboxFirstOpen-${s}`;
  const approvedBucket = negative === "old-bucket" ? "techlong-sandbox-tenant-images-402010193138-9c5ee9e64509dcad" : bucket;
  const clusterArn = "arn:aws:ecs:ca-central-1:402010193138:cluster/cell-sandbox-1";
  approval.baselineDigest = archiveSha256;
  approval.completion = { clientApiVersion: fixedTask ? fixedJob.clientApi : "v1", deriveG1Secret: true };
  approval.express = {
    target: { schema: "techlong/express-management-target/v3", clusterArn: "arn:aws:rds:ca-central-1:402010193138:cluster:" + cluster,
      clusterResourceId: resourceId, endpoint: fixedTask ? FIRST_OPEN_EXPRESS_ENDPOINT : "synthetic.ca-central-1.rds.amazonaws.com", port: 5432, observedEngineVersion: "17.9",
      managementDatabase: "postgres", managementUsername: fixedTask ? FIRST_OPEN_MANAGEMENT_SQL_USER : "postgres", stableIdentity: n.stableIdentity, resourceGeneration: 1,
      tenantDatabase: n.databaseName, tenantUsername: n.roleName },
    nonce: "a".repeat(32), baseline: { contract: "speedfeast-pg16.14-tenant-baseline-v1", archiveS3Uri: "s3://synthetic-baselines/_migration/schema.dump",
      archiveSha256, approvedArchiveSha256: archiveSha256, manifestS3Uri: "s3://synthetic-baselines/_migration/schema.manifest.json", manifestSha256,
      sourceDatabase: "speedfeast", archiveVersionId: "archive-pinned", manifestVersionId: "manifest-pinned" },
    independentRoleArn: "arn:aws:iam::402010193138:role/TechlongSandboxFirstOpenInspector",
    lifecycleRoleArn: "arn:aws:iam::402010193138:role/TechlongSandboxTenantLifecycleTaskRole", applicationRoleArn: appRole,
    mediaPublicBaseUrl: mediaUrl, environmentParametersSha256: await sha256Hex(context.binding!.tenantStackParameters),
    sampling: { cellStackId: cell, platformStackId: fixedTask ? fixedJob.platformStack : cell.replace("cell-sandbox-1","platform-hosting-v1"), hostedZoneId: fixedTask ? fixedJob.zone : "ZSYNTHETIC", apiHostname: approval.hostname,
      cellOutputParameters: Object.fromEntries(["ClusterName","VpcId","SubnetIds","HttpsListenerArn","ControlListenerArn"].map(k=>[k,k])),
      database: { kind: "cluster", profile: "express_iam", identifier: cluster, schemaVersion: approval.databaseSchemaVersion },
      secrets: [control], persistence: { bucket: approvedBucket, providerVariable: "IMAGE_STORAGE_PROVIDER", bucketVariable: "IMAGE_S3_BUCKET",
        verificationSha256: "5".repeat(64) } },
  };
  if (fixedBaseline || fixedTask) {
    const baseline = approval.express.baseline;
    const { bucket, objects } = FIRST_OPEN_BASELINE_BINDING;
    baseline.archiveS3Uri = `s3://${bucket}/${objects.archive.key}`;
    baseline.manifestS3Uri = `s3://${bucket}/${objects.manifest.key}`;
    baseline.archiveVersionId = objects.archive.versionId;
    baseline.manifestVersionId = objects.manifest.versionId;
  }
  if (fixedTask) {
    approval.express.buyerForwardSigner = { arn: `arn:aws:secretsmanager:${fixedJob.region}:${fixedJob.account}:secret:${firstOpenBuyerSignerSecretName}-Sg0001`, versionId: "7".repeat(64) };
    approval.capabilitySha256 = expressBootstrapCandidateDigestV3(compileExpressBootstrapCandidateV3({
      target: approval.express.target, nonce: approval.express.nonce, scope: { appInstanceId: context.appInstance.id,
        workspaceId: context.workspace.id, productId: context.appInstance.productId, environmentId: environment.id, cellKey: "cell-sandbox-1" },
    }));
    options.verifyEmptyExpressCapability = async () => ({ profile: "express_iam", restrictedManagementReady: true,
      evidenceSha256: approval.capabilitySha256 });
  }
  options.approvedSha256 = await sha256Hex(approval);
  options.dependencies.tenantDatabase = { ensureTenantDatabase: async () => assert.fail("generic lifecycle"),
    migrateTenantDatabase: async () => assert.fail("generic lifecycle") };
  let stage: TenantDatabaseLifecycleState = "missing", runtime: TenantSecretInspection | undefined;
  const databaseIdentity = (): FirstOnboardingDatabaseIdentity => ({ name: n.databaseName, roleName: n.roleName,
    ownershipMarker: context.tenantResources!.ownershipMarker, baselineDigest: archiveSha256, schemaVersion: approval.databaseSchemaVersion,
    clusterResourceId: resourceId, databaseOid: "50001", roleOid: "50002", otherConnectableDatabases: 0 });
  const technical: string[] = [];
  const raw = async () => {
    const { applied, stackId } = f.stack();
    const { facts } = await templateReader.capture({ stackId, hostname: approval.hostname, databaseName: n.databaseName, signal: signal() });
    facts.service.clusterArn = clusterArn;
    facts.service.loadBalancers![0].containerName = "speedfeast-backend";
    const td = (applied.template.Resources as Record<string, { Properties: {
      ContainerDefinitions: { Environment: { Name: string; Value: unknown }[]; Secrets: { Name: string; ValueFrom: unknown }[] }[];
    } }>).TenantTaskDefinition.Properties.ContainerDefinitions[0];
    const api = facts.taskDefinition.containerDefinitions![0];
    api.name = "speedfeast-backend";
    api.environment = td.Environment.filter(x => typeof x.Value === "string").map(x => ({ name: x.Name, value: x.Value as string }));
    api.secrets = td.Secrets.map(x => ({ name: x.Name, valueFrom: typeof x.ValueFrom === "string" ? x.ValueFrom : applied.parameters.ControlPublicKeyValueFrom }));
    facts.taskDefinition.taskRoleArn = applied.parameters.TaskRoleArn;
    facts.taskDefinition.executionRoleArn = applied.parameters.TaskExecutionRoleArn;
    facts.tasks[0].containers![0].name = "speedfeast-backend";
    const output = applied.parameters;
    for (const [i, key] of ["TenantBusinessControlDenyRule","TenantListenerRule","TenantControlListenerRule"].entries()) {
      const listener = i===2 ? output.ControlListenerArn : output.HttpsListenerArn;
      facts.resources[key].physicalId = listener.replace(":listener/",":listener-rule/") + "/rule" + i;
    }
    return facts;
  };
  type Facts = Awaited<ReturnType<typeof raw>>;
  let observed: Facts | undefined;
  let runtimeSecretReads = 0;
  options.expressPorts = {
    secret: {
      inspectRuntimeSecret: async x => runtime ?? { fence: x.fence, externalFence: x.externalFence, state: "missing", secretRef: null,
        versionRef: null, ownershipMarker: null },
      createInitial: async x => {
        calls.push("secret-create"); assert.equal(x.requestSha256, x.initialVersionId);
        runtime = { fence: x.fence, externalFence: x.externalFence, state: "present", secretRef:
          "arn:aws:secretsmanager:ca-central-1:402010193138:secret:" + x.name + "-abcDEF",
          versionRef: x.initialVersionId, ownershipMarker: x.fence.ownershipMarker };
        return { requestSha256: x.requestSha256, metadata: runtime };
      },
    },
    database: {
      inspect: async x => ({ fence: x.fence, externalFence: x.externalFence, state: stage,
        databaseExists: stage !== "missing", roleExists: stage !== "missing", databaseOwnershipMarker: stage === "missing" ? null : x.fence.ownershipMarker,
        roleOwnershipMarker: stage === "missing" ? null : x.fence.ownershipMarker,
        baselineDigest: ["missing", "empty"].includes(stage) ? null : archiveSha256,
        migrationContract: ["saas_migrated","verified"].includes(stage) ? "speedfeast-saas-control-v1" : null, evidenceHash: "a".repeat(64) }),
      prepare: async x => {
        calls.push("prepare-v3"); stage = "empty";
        assert.equal(x.program.target.tenantDatabase, n.databaseName); assert.equal(x.program.statementCount, fixedTask ? 9 : 15);
        return { fence: x.fence, externalFence: x.externalFence, operation: "prepare_empty_database", outcome: "applied", resultingState: stage, evidenceHash: "b".repeat(64) };
      },
      restore: async x => {
        calls.push("restore-baseline"); stage = "baseline_restored";
        assert.equal(x.archiveVersionId, approval.express!.baseline.archiveVersionId);
        assert.equal(x.manifestVersionId, approval.express!.baseline.manifestVersionId);
        return { fence: x.fence, externalFence: x.externalFence, operation: "restore_approved_baseline", outcome: "applied", resultingState: stage, evidenceHash: "b".repeat(64) };
      },
      migrateSaas: async x => {
        calls.push("migrate-saas"); stage = "saas_migrated";
        return { fence: x.fence, externalFence: x.externalFence, operation: "migrate_saas", outcome: "applied", resultingState: stage, evidenceHash: "b".repeat(64) };
      },
      activateApplication: async x => {
        calls.push("activate-db-role"); assert.equal(x.migrationEvidenceSha256, "b".repeat(64));
        return { fence: x.fence, externalFence: x.externalFence, outcome: "applied", evidenceHash: "f".repeat(64),
          databaseName: negative === "grant" ? "postgres" : x.target.tenantDatabase, roleName: x.target.tenantUsername,
          applicationRoleArn: x.applicationRoleArn, otherConnectableDatabases: 0 };
      },
      verify: async x => {
        calls.push("verify-db"); stage = "verified";
        return { receipt: { fence: x.fence, externalFence: x.externalFence, operation: "verify", outcome: "applied", resultingState: stage,
          evidenceHash: "b".repeat(64), applicationAccess: { policy: "speedfeast-application-access/v1", databaseLoginVerified: true, evidenceHash: "a".repeat(64) } },
          identity: databaseIdentity() };
      },
    },
    independent: {
      caller: async () => ({ accountId: "402010193138", arn: negative === "caller" ? workerRoleArn :
        "arn:aws:sts::402010193138:assumed-role/TechlongSandboxFirstOpenInspector/first-open" }),
      database: async () => ({ ...databaseIdentity(), ...(negative === "database-oid" ? { databaseOid: "117" } : {}),
        tlsVerified: true, transactionReadOnly: true }),
      getTechnical: async path => { technical.push(path); return { status: 200, tlsVerified: true, checkedAt: now }; },
      async read<T>(service: string, op: string, parameters: Record<string, unknown>) {
        if (op === "describe-secret") {
          const first = parameters.SecretId === runtime?.secretRef || Boolean(runtime && parameters.SecretId === fixedJob.secretName);
          assert(first || parameters.SecretId === control.arn);
          if (first) runtimeSecretReads++;
          const id = first ? runtime!.versionRef! : control.versionId;
          return { ARN: first ? runtime!.secretRef : parameters.SecretId, VersionIdsToStages: { [id]: ["AWSCURRENT"],
            ...(first && (negative === "second-version" || (negative === "late-version" && runtimeSecretReads > 1))
              ? { ["c".repeat(64)]: ["AWSPREVIOUS"] } : {}) } } as T;
        }
        const facts = observed ??= await raw();
        const { applied, stackId } = f.stack(), output = applied.parameters;
        const alb = output.HttpsListenerArn.replace(":listener/",":loadbalancer/").split("/").slice(0,-1).join("/");
        const awsPairs = (r: Record<string,string>, key: string, value: string) => Object.entries(r).map(([k,v])=>({[key]:k,[value]:v}));
        let result: unknown;
        switch (service + ":" + op) {
          case "cloudformation:describe-stacks": result = { Stacks: [{ StackId: parameters.StackName === applied.stackName ? stackId : parameters.StackName,
            StackName: applied.stackName, StackStatus: "CREATE_COMPLETE",
            RoleARN: cloudFormationRoleArn, CreationTime: new Date(now).toISOString(), Tags: awsPairs(applied.tags,"Key","Value"),
            Parameters: awsPairs(applied.parameters,"ParameterKey","ParameterValue"),
            Outputs: parameters.StackName === cell ? awsPairs(output,"OutputKey","OutputValue") : [] }] }; break;
          case "cloudformation:get-template": assert.equal(parameters.StackName,stackId); result = { TemplateBody: applied.template }; break;
          case "cloudformation:list-stack-resources": result = { StackResourceSummaries: Object.entries(facts.resources).map(([LogicalResourceId,r]) =>
            ({LogicalResourceId,ResourceType:r.type,PhysicalResourceId:r.physicalId,ResourceStatus:"CREATE_COMPLETE"})) }; break;
          case "cloudformation:list-change-sets": result = { Summaries: [] }; break;
          case "rds:describe-db-clusters": result = { DBClusters: [{ DBClusterIdentifier: cluster, Status: "available", Engine: "aurora-postgresql", IAMDatabaseAuthenticationEnabled: true }] }; break;
          case "ecs:describe-services": result = { services: [facts.service] }; break;
          case "ecs:describe-task-definition": result = { taskDefinition: facts.taskDefinition }; break;
          case "ecs:list-tasks": result = { taskArns: facts.tasks.map(t=>t.taskArn) }; break;
          case "ecs:describe-tasks": result = { tasks: facts.tasks }; break;
          case "elbv2:describe-listeners": result = { Listeners: [{ ListenerArn: output.HttpsListenerArn, LoadBalancerArn: alb, Port:443,Protocol:"HTTPS" },
            { ListenerArn: output.ControlListenerArn, LoadBalancerArn: alb, Port:8443,Protocol:"HTTPS",MutualAuthentication:{Mode:"verify"}}] }; break;
          case "elbv2:describe-load-balancers": result = { LoadBalancers: [{ LoadBalancerArn: alb, DNSName: approval.dnsTarget, State:{Code:"active"}}] }; break;
          case "elbv2:describe-target-groups": result = { TargetGroups:[{TargetGroupArn:facts.targets.groupArn,VpcId:output.VpcId,Port:3000}] }; break;
          case "elbv2:describe-target-health": result = { TargetHealthDescriptions:facts.targets.targets.map(t=>({Target:{Id:t.ip},TargetHealth:{State:t.state}})) }; break;
          case "elbv2:describe-rules": result = { Rules:["TenantBusinessControlDenyRule","TenantListenerRule","TenantControlListenerRule"].map(k=>({
            RuleArn:facts.resources[k].physicalId,Conditions:[{Field:"host-header",HostHeaderConfig:{Values:[approval.hostname]}}],
            Actions:k==="TenantBusinessControlDenyRule"?[{Type:"fixed-response"}]:[{Type:"forward",TargetGroupArn:facts.targets.groupArn}]})) }; break;
          case "route53:list-resource-record-sets": result={ResourceRecordSets:[{Name:approval.hostname+".",Type:"A",AliasTarget:{DNSName:approval.dnsTarget+"."}}]}; break;
          case "s3api:head-bucket": assert.equal(parameters.Bucket,bucket); result = {}; break;
          case "ecr:batch-get-image": result={images:[{imageManifest:facts.artifact.manifest,imageId:{imageDigest:context.deployment.artifactRef.split("@")[1]}}]}; break;
          default: assert.fail(service+":"+op);
        }
        return result as T;
      },
    },
    completionClient: { query: async (statement, [request, binding]) => {
      calls.push("limited-sql"); assert.equal(statement, FIRST_ONBOARDING_COMPLETE_ENTRY);
      assert.equal(JSON.parse(request).receipt.approvalSha256,options.approvedSha256);
      const document=JSON.parse(binding); assert.equal(document.stateRevision,0);
      assert.deepEqual(document.sampling.secrets,[control,{arn:runtime!.secretRef,versionId:runtime!.versionRef}]);
      return { rows: [{ instanceId: context.appInstance.id, committed: 1 }] };
    } },
    completionReadClient: { query: async (statement, [hash]) => {
      calls.push("readback-sql"); assert.equal(statement, FIRST_ONBOARDING_READ_ENTRY); assert.match(hash, /^[a-f0-9]{64}$/);
      return { rows: negative === "readback" ? [] : [{ instanceId: context.appInstance.id, revision: "0" }] };
    } },
  };
  return { ...f, technical, bucket, appRole, databaseIdentity, runtimeSecret: () => runtime };
}

async function scopedFixtureBinding(f: Awaited<ReturnType<typeof derivedFirstOpenFixture>>) {
  const binding = structuredClone(f.context.binding!);
  delete binding.tenantStackParameters.OneShotTaskSecurityGroupId;
  delete binding.tenantStackParameters.TaskRoleArn;
  binding.tenantStackParameters.ControlPublicKeyValueFrom = `${fixedJob.controlArn}:::${fixedJob.controlVersion}`;
  for (const name of Object.keys(firstOpenBuyerBinding.parameters)) delete binding.tenantStackParameters[name];
  binding.tenantStackParameters = completeFirstOpenBuyerParameters(binding.tenantStackParameters);
  f.context.environment = { ...f.context.environment, applyEnabled: false };
  const { approval } = f.options;
  approval.express!.environmentParametersSha256 = await sha256Hex(binding.tenantStackParameters);
  const approvedSha = f.options.approvedSha256 = await sha256Hex(approval);
  const review = (await reviewFirstOnboarding({ ...f.row, scope: (f.row.job.payload as FirstOnboardingReview["payload"]).scope, release: f.release }))!;
  const seed: FirstOpenInspectSeed = structuredClone({ plan: f.context.deployment.desiredPlan, environment: f.context.environment, binding,
    review, release: f.release, requestedAt: f.context.deployment.createdAt,
    activeCellCount: f.context.activeCellCount, activeTenantCount: f.context.activeTenantCount,
    epoch: (await predictSandboxFirstOpenG1(f.row, approvedSha)).epoch });
  return { seed, prepared: await prepareFirstOpenInspectSeed(seed, await sha256Hex(seed), approval, approvedSha, signal()) };
}

test("new first-open: V3 empty DB to one create-only Express/S3 workload, independent D2 proof and scoped RPC", async () => {
  const f = await derivedFirstOpenFixture();
  const result = await runReviewedFirstOnboarding(f.options);
  assert.equal(result.outcome, "ACTIVATED");
  assert.deepEqual(f.technical, ["/health","/ready"]);
  const steps = ["secret-create","prepare-v3","restore-baseline","migrate-saas","activate-db-role","verify-db","create","receipt","limited-sql","readback-sql"];
  assert.deepEqual(f.calls.filter(s=>steps.includes(s)), steps);
  const { applied } = f.stack();
  assert.equal(applied.parameters.TaskRoleArn, f.appRole);
  assert.equal(applied.templateBody.includes("DATABASE_URL"), false);
  assert.ok(applied.templateBody.includes(f.bucket) && applied.templateBody.includes("/bootstrap-ready"));
});

test("the sanitized Inspect projection and RunOnce-held values rebuild the real D2 binding byte for byte", async () => {
  const f = await derivedFirstOpenFixture(), ports = f.options.expressPorts!, approval = f.options.approval;
  const secret = ports.secret.createInitial, completion = ports.completionClient;
  let g1: {arn: string; versionId: string} | undefined, compared = false;
  ports.secret.createInitial = async x => {
    const result = await secret(x);
    g1 = { arn: result.metadata.secretRef!, versionId: result.metadata.versionRef! };
    return result;
  };
  ports.completionClient = { async query(statement, args) {
    const [request, bindingText] = args, { applied, stackId } = f.stack();
    const original = JSON.parse(request) as { jobPayload: FirstOnboardingReview["payload"];
      receipt: { runtime: InstanceReleaseObservation; initialBindingSha256: string } };
    const { runtime, initialBindingSha256 } = original.receipt, fixed = approval.express!.sampling;
    assert.ok(g1);
    const sampling = { ...fixed, secrets: [...fixed.secrets, g1] };
    const local = { scope: original.jobPayload.scope, release: f.release, sampling, clientApiVersion: approval.completion!.clientApiVersion,
      stackId, expectedTemplateSha256: applied.templateSha256,
      expectedRuntimeScopeSha256: await sha256Hex({ parameters: applied.parameters, tags: applied.tags }),
      epochSha256: await sha256Hex(f.context.tenantExternalOperation),
      databaseIdentitySha256: await sha256Hex({ databaseOid: "50001", roleOid: "50002" }),
      // CFN can return the same parameter map in a different order.
      parameterKeys: Object.keys(applied.parameters).reverse() };
    const projection = { stackIdSha256: await sha256Hex(stackId), expectedRuntimeScopeSha256: local.expectedRuntimeScopeSha256,
      samplingSha256: await sha256Hex(sampling), g1e1FenceSha256: local.epochSha256, databaseIdentitySha256: local.databaseIdentitySha256,
      runtimeConfigurationSha256: runtime.configurationSha256, runtimeTemplateSha256: runtime.templateSha256,
      runtimeObservationSha256: await offlineRuntimeObservationSha(runtime), initialBindingSha256,
      releaseId: f.release.id, observedAtUtc: new Date(runtime.observedAt).toISOString() };
    const wireText = canonicalJson(projection);
    for (const privateString of [bindingText, g1.arn, g1.versionId, local.scope.workspaceId, stackId, args[2]]) assert.ok(!wireText.includes(privateString));
    assert.equal((await rebuildOfflineFirstOpenBinding(local, JSON.parse(wireText))).text, bindingText);
    await assert.rejects(rebuildOfflineFirstOpenBinding({ ...local, parameterKeys: local.parameterKeys.slice(1) }, projection), /RUNTIME_PROJECTION/);
    await assert.rejects(rebuildOfflineFirstOpenBinding({ ...local, sampling: { ...sampling, hostedZoneId: "ZOTHER" } }, projection), /BINDING_COORDINATE/);
    await assert.rejects(rebuildOfflineFirstOpenBinding(local, { ...projection, runtimeConfigurationSha256: "0".repeat(64) }), /RUNTIME_PROJECTION/);
    await assert.rejects(rebuildOfflineFirstOpenBinding(local, { ...projection, initialBindingSha256: "0".repeat(64) }), /BINDING_BYTES/);
    compared = true;
    return completion.query(statement, args);
  } };
  const result = await runReviewedFirstOnboarding(f.options);
  assert.equal(result.outcome, "ACTIVATED");
  assert.equal(compared, true);
});

test("paired first open uses bounded GitHub handoffs at the real worker gates, never raw facts or a second claim", async t => {
  // The fixed release pins the real manifest; only this synthetic manifest's
  // preimage is simulated. All handoff and binding digests remain real.
  const manifest = '{"schemaVersion":2,"synthetic":"paired-first-open"}', hash = crypto.subtle.digest.bind(crypto.subtle);
  t.mock.method(crypto.subtle, "digest", (algorithm: AlgorithmIdentifier, bytes: BufferSource) =>
    new TextDecoder().decode(bytes) === manifest
      ? Promise.resolve(Uint8Array.from(Buffer.from(fixedJob.imageDigest.slice(7), "hex")).buffer)
      : hash(algorithm, bytes));
  for (const failure of [null, "missing-ready", "bad-g1-zip", "bad-final-zip", "observed-template-drift"] as const) {
    const f = await derivedFirstOpenFixture(undefined, true, true), { options, row } = f;
    f.context.binding = (await scopedFixtureBinding(f)).prepared.binding;
    const approval = options.approval, approvedSha256 = options.approvedSha256, raw = options.expressPorts!.independent!;
    const predictedG1 = await predictSandboxFirstOpenG1(row, approvedSha256);
    const backup = await derivedFirstOpenFixture(undefined, true, true);
    const { seed } = await scopedFixtureBinding(backup);
    assert.equal(backup.options.approvedSha256, approvedSha256);
    const identity = { ...await raw.caller(signal()),
      arn: `arn:aws:sts::${fixedJob.account}:assumed-role/TechlongSandboxFirstOpenInspector/first-open-fc41597f-inspector-g1` };
    const pair = { pairSha256: "a".repeat(64), approvalSha256: approvedSha256, runtimeSourceSha256: "b".repeat(64),
      callerCommit: "c".repeat(40), workflowId: "555", actorId: "14145707", inspectId: "41", runOnceId: "42", startAt: now,
      writeBefore: approval.writeBefore, phaseCutoffs: [30, 60, 90, 400, 800].map(seconds => now + seconds * 1_000),
      inspectorSessionArnSha256: await sha256Hex(identity.arn) };
    let time = now, afterWriter!: () => void, inspectorStillRunning = true;
    const writerDone = new Promise<void>(resolve => { afterWriter = resolve; });
    options.dependencies.now = () => time;
    options.cleanupReadiness.verifyBeforeClaim = async () => f.readiness;
    const repository = options.dependencies.repository;
    options.dependencies.repository = { ...repository, async claimTenantResourceGeneration(request) {
      const before = f.context.tenantExternalOperation, result = await repository.claimTenantResourceGeneration(request);
      f.context.tenantExternalOperation = before;
      return result;
    } };
    options.dependencies.tenantExternalOperationCoordinator = { async prepareAndActivate(x) {
      assert.deepEqual(x.resourceFence, predictedG1.epoch.resourceFence);
      f.context.tenantExternalOperation = predictedG1.epoch;
      return predictedG1.epoch;
    } };
    const totalReported = new Set<string>();
    const actions = "https://api.github.com/repos/veinyyxy/TechlongSoftware/actions";
    const artifacts: { name: string; id: number; owner: string; zip: Uint8Array; digest: string; created: string }[] = [];
    const wire = (role: "inspect" | "runonce") => {
      const own = role === "inspect" ? pair.inspectId : pair.runOnceId;
      return firstOpenGitHubHandoff({ pair, role, ownRunId: own, token: "synthetic_gh_token", now: () => time,
        async pause(ms) {
          if (ms > 10_000) return writerDone;
          await new Promise(resolve => setTimeout(resolve, 5));
        },
        async uploadOwn({ name, member, bytes }) {
          assert.equal(member, "handoff.json");
          const body = new TextDecoder().decode(bytes);
          for (const privateString of [identity.arn, row.workspaceId, f.runtimeSecret()?.secretRef, f.runtimeSecret()?.versionRef, f.stack().stackId]) {
            if (privateString) assert.ok(!body.includes(privateString));
          }
          const zip = zipSync({ [member]: bytes }), digest = createHash("sha256").update(zip).digest("hex");
          const id = 200 + artifacts.length;
          artifacts.push({ id, name, owner: own, zip, digest, created: new Date(time).toISOString() });
          time += 100;
          return { artifactId: String(id) };
        },
        async fetch(url, init) {
          const target = new URL(String(url));
          const match = /\/runs\/(\d+)(\/artifacts)?$/.exec(target.pathname);
          const repository = { id: 1323312747, full_name: "veinyyxy/TechlongSoftware", owner: { id: 14145707 } };
          if (target.origin === "https://api.github.com") {
            assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic_gh_token");
            if (match?.[2]) {
              const row = artifacts.find(x => x.name === target.searchParams.get("name") && x.owner === match[1]);
              if (!row) return Response.json({ total_count: 0, artifacts: [] });
              const key = own + ":" + row.id, once = totalReported.has(key);
              totalReported.add(key);
              return Response.json({ total_count: once ? 1 : 2, artifacts: [{
                id: row.id, name: row.name, expired: false, created_at: row.created, expires_at: new Date(pair.writeBefore + 10_000).toISOString(),
                digest: "sha256:" + row.digest, size_in_bytes: row.zip.length, archive_download_url: actions + "/artifacts/" + row.id + "/zip",
                workflow_run: { id: Number(row.owner), repository_id: repository.id, head_repository_id: repository.id, head_branch: "main", head_sha: pair.callerCommit },
              }] });
            }
            if (match) {
              const writer = match[1] === pair.runOnceId;
              return Response.json({ id: Number(match[1]), workflow_id: Number(pair.workflowId), run_attempt: 1, event: "workflow_dispatch",
                path: ".github/workflows/sandbox-first-open-v1.yml", head_branch: "main", head_sha: pair.callerCommit,
                repository, head_repository: repository, actor: { id: 14145707 }, triggering_actor: { id: 14145707 },
                display_title: offlineHandoffTitle(pair, writer), status: writer || inspectorStillRunning ? "in_progress" : "completed",
                conclusion: writer || inspectorStillRunning ? null : "success" });
            }
            const id = /\/artifacts\/(\d+)\/zip$/.exec(target.pathname)![1];
            return new Response(null, { status: 302, headers: { location: "https://fixture.blob.core.windows.net/" + id } });
          }
          assert.equal(target.origin, "https://fixture.blob.core.windows.net");
          assert.equal(new Headers(init?.headers).has("authorization"), false);
          const a = artifacts.find(x => String(x.id) === target.pathname.slice(1))!;
          const bytes = Uint8Array.from(a.zip);
          if (role === "runonce" && ((failure === "bad-g1-zip" && a.name.endsWith("-02-g1-metadata-observed")) ||
            (failure === "bad-final-zip" && a.name.endsWith("-03-runtime-observed")))) bytes[0] ^= 1;
          return new Response(bytes);
        },
      });
    };
    const writer = wire("runonce");
    const { independent: _rawOnlyOnInspector, ...writePorts } = options.expressPorts!;
    void _rawOnlyOnInspector;
    options.expressPorts = { ...writePorts, handoff: firstOpenRunOnceHandoff(writer) };
    let databaseSessions = 0;
    const inspector = bindFirstOpenPairedInspect({ approval, approvalSha256: approvedSha256, expectedSeed: seed,
      expectedSeedSha256: await sha256Hex(seed), wire: wire("inspect"),
      identify: async () => ({ ...identity, roleId: "AROAV3GNMXTZONT55QARZ", credentialExpiresAt: approval.writeBefore + 1_000 }),
      readOnly: {
        async read<T>(service: string, op: string, parameters: Record<string, unknown>) {
          if (op === "batch-get-image") return { images: [{ imageManifest: manifest, imageId: { imageDigest: fixedJob.imageDigest } }] } as T;
          if (op === "get-template" && failure === "observed-template-drift") {
            const actual = await raw.read<{ TemplateBody: Record<string, unknown> }>(service, op, parameters);
            return { TemplateBody: { ...actual.TemplateBody, Description: "provider template drift" } } as T;
          }
          return raw.read<T>(service, op, parameters);
        },
        async getTechnical(...args) { return { ...await raw.getTechnical(...args), checkedAt: time }; },
      },
      database: { roleDirectorySql: "fixture-role", session: async (_signal, run) => {
        databaseSessions++;
        return run(async sql => {
        const id = { name: fixedJob.tenantDatabase, databaseOid: "50001", roleOid: "50002", clusterResourceId: fixedJob.clusterId,
          ownershipMarker: "tl_owner_" + fixedJob.stableIdentity.slice(0, 32) + "_g1",
          baselineDigest: FIRST_OPEN_BASELINE_BINDING.objects.archive.sha256, schemaVersion: fixedJob.schemaVersion };
        const result = sql === "fixture-role" ? { oid: id.roleOid, name: fixedJob.tenantRole, login: true, iam_role_oid: "16389",
          inherit: false, superuser: false, create_db: false, create_role: false, replication: false, bypass_rls: false, settings: false,
          owns_objects: false, connection_limit: -1, valid_until: null, config: null, other_connectable_databases: 0,
          parents: [{ name: "rds_iam", oid: "16389", grantor: "sf_fc41597f_lifecycle_definer", admin: false, inherit: false, set: false }],
          members: [{ name: "sf_fc41597f_lifecycle_definer", grantor: "rdsadmin", admin: true, inherit: false, set: false }] }
          : sql.includes("current_database()") ? { database: id.name, username: FIRST_OPEN_INSPECTOR_SQL_USER, session_username: FIRST_OPEN_INSPECTOR_SQL_USER,
            owner: FIRST_OPEN_MANAGEMENT_SQL_USER, owner_oid: "50003", session_role_oid: "16411", session_other_connectable_databases: 0, version: 170009, tls: true, read_only: "on",
            database_oid: id.databaseOid, marker: canonicalJson({ schema: "techlong/first-open-express-ready/v1", jobId: fixedJob.jobId,
              approvalSha256: approvedSha256, clusterResourceId: id.clusterResourceId, ownershipMarker: id.ownershipMarker,
              baselineDigest: id.baselineDigest, schemaVersion: id.schemaVersion, databaseOid: id.databaseOid, roleOid: id.roleOid }) }
          : { singleton: true };
        return { rows: [result], rowCount: 1 };
      }); } },
    }, () => time);
    const work = runReviewedFirstOnboarding(options).finally(afterWriter);
    if (failure === "missing-ready") {
      await assert.rejects(work, /LIST_NOT_VISIBLE/);
      assert.deepEqual(f.calls, []);
      continue;
    }
    const inspect = inspector(signal()).finally(() => { inspectorStillRunning = false; });
    const result = await Promise.allSettled([work, inspect]);
    if (failure === "bad-g1-zip") {
      assert.ok(result[0].status === "rejected" && /ZIP_DIGEST/.test(String(result[0].reason)));
      assert.ok(result[1].status === "rejected" && /LIST_NOT_VISIBLE/.test(String(result[1].reason)));
      assert.equal(artifacts.length, 3);
      assert.ok(f.calls.includes("secret-create") && !f.calls.includes("prepare-v3") && !f.calls.includes("limited-sql"));
      assert.equal(databaseSessions, 0);
      continue;
    }
    assert.equal(databaseSessions, 1);
    if (failure === "observed-template-drift") {
      assert.ok(result[1].status === "rejected" && /RELEASE_/.test(String(result[1].reason)), String((result[1] as PromiseRejectedResult).reason));
      assert.ok(result[0].status === "rejected" && /LIST_NOT_VISIBLE/.test(String(result[0].reason)));
      assert.equal(artifacts.length, 4);
      assert.ok(!f.calls.includes("limited-sql"));
      continue;
    }
    assert.equal(result[1].status, "fulfilled", result[1].status === "rejected" ? String(result[1].reason) : undefined);
    assert.equal(artifacts.length, 5);
    assert.equal(f.calls.filter(x => x === "claim").length, 1);
    if (failure) {
      assert.ok(result[0].status === "rejected" && /ZIP_DIGEST/.test(String(result[0].reason)), String((result[0] as PromiseRejectedResult).reason));
      assert.ok(!f.calls.includes("limited-sql"));
    } else {
      assert.ok(result[0].status === "fulfilled", String((result[0] as PromiseRejectedResult).reason));
      assert.equal(result[0].value.outcome, "ACTIVATED");
      assert.deepEqual(f.calls.slice(-3), ["receipt", "limited-sql", "readback-sql"]);
    }
  }
});

async function boundFixedFirstOpen(negative?: "grant" | "epoch" | "claim-ack" | "create-ack", mode?: "scoped" | "conflict") {
  const f = await derivedFirstOpenFixture(undefined, true, true), { options, context, calls } = f;
  const scoped = mode && await scopedFixtureBinding(f);
  if (mode === "scoped") context.binding = null;
  const { dependencies: d, expressPorts: express, approval, approvedSha256 } = options;
  const aws = await d.awsFactory!({ region: fixedJob.region, workerRoleArn: fixedJob.workerRole }) as SupervisedWorkloadAwsPort;
  const planned = await predictSandboxFirstOpenG1(f.row, approvedSha256);
  const evidenceSha256 = "4".repeat(64);
  const checkpoints = new Map<string, Record<string, unknown>>();
  const run = bindSandboxFirstOpenRunOnce({ approval, approvedSha256, runtimeGrantEvidenceSha256: evidenceSha256,
    reviewedTaskBinding: scoped?.prepared.binding,
    sql: { review: { async query(sql, p) {
      assert.deepEqual(p, []);
      if (sql === "SELECT techlong_first_onboarding_claim.review() AS result") return { rows: [{ result: f.row }] };
      assert.equal(sql, "SELECT techlong_first_onboarding_claim.release() AS result"); return { rows: [{ result: f.release }] };
    } }, claim: { async query(sql, p) {
      assert.equal(sql, "SELECT * FROM techlong_first_onboarding_claim.claim($1::text,$2::jsonb)");
      assert.equal(p[0], approvedSha256); assert.equal(JSON.parse(p[1]).length, 8);
      calls.push("claim"); if (negative === "claim-ack") throw Error("CLAIM_ACK_UNKNOWN");
      return { rows: [{ jobId: fixedJob.jobId }] };
    } }, completion: express!.completionClient, inspection: express!.completionReadClient },
    aws: { ...aws, async applySupervisedTenantStack(stack, x) {
      assert.equal(x.createOnly, true);
      const result = await aws.applySupervisedTenantStack(stack, x);
      if (negative === "create-ack") throw Error("CREATE_ACK_UNKNOWN");
      return result;
    } },
    ports: { repository: { ...d.repository, async claimTenantResourceGeneration(x) {
      // The older fixture installs a synthetic active epoch on first claim.
      // For this test leave it absent until the actual composition invokes provisionEpoch.
      const prior = context.tenantExternalOperation;
      const result = await d.repository.claimTenantResourceGeneration(x);
      context.tenantExternalOperation = prior;
      return result;
    }, async beginStep(x) {
      const id = `step_${x.stepKey}:${x.inputHash}`, previousOutput = checkpoints.get(id);
      return { id, alreadySucceeded: previousOutput !== undefined, previousOutput: previousOutput ?? {} };
    }, async finishStep(x) {
      if (x.status === "succeeded") checkpoints.set(x.stepId, x.output);
      return d.repository.finishStep(x);
    } }, control: d.controlClient, cellPreflight: d.sharedCellSecurityPreflight,
      controlPayloadCompiler: d.controlPayloadCompiler, verifyEmptyExpressCapability: options.verifyEmptyExpressCapability,
      cleanupReadiness: { ...options.cleanupReadiness, async verifyBeforeClaim() { return f.readiness; } },
      async provisionEpoch(x) {
        assert.deepEqual(x.resourceFence, planned.epoch.resourceFence);
        const e = activeProvisionExternalFence(x.resourceFence);
        e.operationHash = await tenantExternalOperationHash("provision", x.resourceFence, context.deployment);
        if (negative === "epoch") e.epoch = 2;
        context.tenantExternalOperation = e;
        return e;
      }, express: { ...express!, secret: { ...express!.secret, async createInitial(x) {
        assert.equal(x.initialVersionId, planned.versionId);
        return express!.secret.createInitial(x);
      } } },
    },
    async verifyRuntimeGrant(x) {
      calls.push("fixed-grant"); assert.deepEqual(x.grant, planned.grant);
      return { approvalSha256: approvedSha256, roleArn: fixedJob.executionRole,
        grantSha256: negative === "grant" ? "f".repeat(64) : await sha256Hex(x.grant), evidenceSha256,
        independentlyVerifiedEffective: true, observedAt: now };
    },
  }, () => now);
  return { ...f, run, planned, scoped };
}

test("the fixed writer and independent Inspector render the same sealed parameters without a shared binding row", async () => {
  const f = await boundFixedFirstOpen(undefined, "scoped");
  await assert.rejects(f.run(), /RELEASE_ARTIFACT_MISMATCH/); // No real ECR artifact is used here.
  const { applied, stackId } = f.stack();
  assert.equal(f.context.binding, null);
  assert.equal(f.context.environment.applyEnabled, false);
  assert.equal(f.calls.filter(x => x === "claim").length, 1);
  assert.equal(f.calls.filter(x => x === "create").length, 1);
  assert.equal(applied.parameters.TaskRoleArn, fixedJob.applicationRole);
  for (const [name, value] of Object.entries(firstOpenBuyerBinding.parameters)) assert.equal(applied.parameters[name], value);
  assert.equal("OneShotTaskSecurityGroupId" in applied.parameters, false);
  const expected = await f.scoped!.prepared.assemble({ stackId, arn: f.runtimeSecret()!.secretRef!, identity: f.databaseIdentity() }, signal());
  assert.deepEqual(expected.stack.parameters, applied.parameters);
  assert.equal(expected.stack.templateSha256, applied.templateSha256);
  const rebuilt = await f.scoped!.prepared.renderStack({ arn: f.runtimeSecret()!.secretRef!, identity: f.databaseIdentity() }, signal());
  const broker = await firstOpenControlledCfnTemplate(f.options.approvedSha256, rebuilt.stack);
  assert.equal(broker.requestSha256, (await firstOpenControlledCfnTemplate(f.options.approvedSha256, applied)).requestSha256);
  assert.equal(broker.sha256, applied.templateSha256);
});

test("a late shared binding, rehashed legacy field or copied binding cannot substitute for the sealed task binding", async () => {
  const f = await boundFixedFirstOpen(undefined, "conflict"), { seed, prepared } = f.scoped!;
  await assert.rejects(f.run(), /FIRST_OPEN_TASK_BINDING_CONTEXT_CHANGED/);
  assert.ok(f.context.binding);
  assert.equal(f.calls.some(x => ["secret-create", "create"].includes(x)), false);
  const context = { ...f.context, binding: null };
  const { approval, approvedSha256 } = f.options;
  assert.throws(() => attachFirstOpenTaskBinding(context, prepared.binding, "0".repeat(64)), /FIRST_OPEN_TASK_BINDING_CONTEXT_CHANGED/);
  assert.throws(() => attachFirstOpenTaskBinding(context, structuredClone(prepared.binding), approvedSha256), /FIRST_OPEN_TASK_BINDING_CONTEXT_CHANGED/);
  assert.throws(() => attachFirstOpenTaskBinding({ ...context, job: { ...context.job, id: "another-job" } }, prepared.binding, approvedSha256), /FIRST_OPEN_TASK_BINDING_CONTEXT_CHANGED/);
  await assert.rejects(prepareFirstOpenInspectSeed(seed, "0".repeat(64), approval, approvedSha256, signal()), /FIRST_OPEN_INSPECT_INPUT_SEED/);
  const wrongVersion = structuredClone(seed);
  wrongVersion.binding.tenantStackParameters.ControlPublicKeyValueFrom = fixedJob.controlArn;
  const versionApproval = structuredClone(approval);
  versionApproval.express!.environmentParametersSha256 = await sha256Hex(wrongVersion.binding.tenantStackParameters);
  await assert.rejects(prepareFirstOpenInspectSeed(wrongVersion, await sha256Hex(wrongVersion), versionApproval, await sha256Hex(versionApproval), signal()), /FIRST_OPEN_TASK_BINDING_SEAL/);
  const borrowedBuyer = structuredClone(seed), borrowedBuyerApproval = structuredClone(approval);
  borrowedBuyer.binding.tenantStackParameters.CorsAllowedOrigins = "https://buyer.sandbox.techlong.cloud";
  borrowedBuyerApproval.express!.environmentParametersSha256 = await sha256Hex(borrowedBuyer.binding.tenantStackParameters);
  await assert.rejects(prepareFirstOpenInspectSeed(borrowedBuyer, await sha256Hex(borrowedBuyer), borrowedBuyerApproval,
    await sha256Hex(borrowedBuyerApproval), signal()), /FIRST_OPEN_BUYER_PARAMETERS_CHANGED/);
  seed.binding.tenantStackParameters.OneShotTaskSecurityGroupId = "sg-0123456789abcdef3";
  approval.express!.environmentParametersSha256 = await sha256Hex(seed.binding.tenantStackParameters);
  await assert.rejects(prepareFirstOpenInspectSeed(seed, await sha256Hex(seed), approval, await sha256Hex(approval), signal()), /SUPERVISED_PARAMETER_SET_INVALID/);
});

test("fixed first-open composition claims and creates once, and does not complete on an unproved A manifest", async () => {
  const f = await boundFixedFirstOpen();
  assert.equal(f.planned.grant.Resource, `arn:aws:secretsmanager:${fixedJob.region}:${fixedJob.account}:secret:${fixedJob.secretName}-??????`);
  const { objects } = FIRST_OPEN_BASELINE_BINDING;
  const iam = sandboxFirstOpenPolicyDrafts({ archiveVersionId: objects.archive.versionId, manifestVersionId: objects.manifest.versionId,
    plannedRuntimeSecretVersionId: f.planned.versionId });
  assert.equal(iam.runtimeSecretReadPending, true);
  assert.deepEqual(iam.execution.Statement.filter(x => x.Effect === "Allow").at(-1), f.planned.grant);
  assert.notEqual((await predictSandboxFirstOpenG1(f.row, "0".repeat(64))).versionId, f.planned.versionId);
  await assert.rejects(f.run(), /RELEASE_ARTIFACT_MISMATCH/); // Only a digest, not A's raw ECR manifest, is in the offline fixture.
  await assert.rejects(f.run(), /ENTRY_ALREADY_USED/);
  assert.deepEqual(f.calls.filter(x => ["fixed-grant", "claim", "secret-create", "restore-baseline", "create", "configure"].includes(x)),
    ["fixed-grant", "claim", "secret-create", "restore-baseline", "create", "configure"]);
  assert.equal(f.calls.includes("limited-sql"), false);
  assert.equal(f.calls.includes("readback-sql"), false);
});

test("fixed composition stops at a bad grant, changed epoch, or unknown claim/create response without retrying", async () => {
  for (const [bad, code, last] of [["grant", /G1_GRANT_UNPROVED/, "fixed-grant"], ["epoch", /G1_EPOCH_MISMATCH/, "claim"],
    ["claim-ack", /CLAIM_ACK_UNKNOWN/, "claim"], ["create-ack", /CREATE_ACK_UNKNOWN/, "create"]] as const) {
    const f = await boundFixedFirstOpen(bad);
    await assert.rejects(f.run(), code);
    await assert.rejects(f.run(), /ENTRY_ALREADY_USED/);
    const writes = f.calls.filter(x => ["fixed-grant", "claim", "secret-create", "create", "configure", "limited-sql", "readback-sql"].includes(x));
    assert.equal(writes.at(-1), last);
    assert.equal(writes.filter(x => x === last).length, 1);
  }
});

test("reviewed first-open stops before the claim if the narrow middle RPC is not proved", async () => {
  const f = await derivedFirstOpenFixture(undefined, true, true), { options, row, calls } = f;
  const { dependencies: d, expressPorts: express, approval, approvedSha256 } = options;
  const aws = await d.awsFactory!({ region: fixedJob.region, workerRoleArn: fixedJob.workerRole }) as SupervisedWorkloadAwsPort;
  const evidenceSha256 = "4".repeat(64);
  const run = bindReviewedSandboxFirstOpenRunOnce({ approval, approvedSha256, runtimeGrantEvidenceSha256: evidenceSha256,
    sql: { review: { async query(sql) { return { rows: [{ result: sql.includes(".review()") ? row : f.release }] }; } },
      claim: { async query() { assert.fail("claim must not be called"); } }, completion: express!.completionClient, inspection: express!.completionReadClient },
    middle: { planHash: row.deployment.planHash, configurationHash: row.deployment.configurationHash,
      sql: { async query(sql, params) {
        assert.equal(sql, FIRST_OPEN_MIDDLE_RPC); assert.deepEqual(params, [approvedSha256, "", "readiness", "[]"]);
        calls.push("middle-readiness"); return { rows: [] };
      } }, dynamo: { commands: { get: class {}, put: class {} }, client: { async send() { assert.fail("authority must not be called"); } } } },
    aws, ports: { control: d.controlClient, cellPreflight: d.sharedCellSecurityPreflight, controlPayloadCompiler: d.controlPayloadCompiler,
      verifyEmptyExpressCapability: options.verifyEmptyExpressCapability, express: express!,
      cleanupReadiness: { ...options.cleanupReadiness, async verifyBeforeClaim() { return f.readiness; } } },
    async verifyRuntimeGrant(x) { return { approvalSha256: approvedSha256, roleArn: fixedJob.executionRole,
      grantSha256: await sha256Hex(x.grant), evidenceSha256, independentlyVerifiedEffective: true, observedAt: now }; },
  }, () => now);
  await assert.rejects(run(), /FIRST_OPEN_MIDDLE_READY_UNPROVED/);
  assert.ok(calls.includes("middle-readiness") && !calls.includes("secret-create"));
});

test("the reviewed worker never claims a different first-open job with the pinned copies", async () => {
  const f = await derivedFirstOpenFixture(undefined, true);
  assert.notEqual(f.options.approval.jobId, FIRST_OPEN_BASELINE_BINDING.jobId);
  await assert.rejects(runReviewedFirstOnboarding(f.options), { code: "TENANT_BASELINE_INVALID" });
  assert.deepEqual(f.calls, []);
});

test("new first-open stops on non-independent caller, old bucket, second Secret version, wrong application grant or wrong observed DB OID", async () => {
  for (const [x, expected] of [["caller", /INDEPENDENT_ROLE_REQUIRED/], ["old-bucket", /EXPRESS_SCOPE_CHANGED/],
    ["second-version", /SECRET_VERSION_CHANGED/], ["late-version", /SECRET_VERSION_CHANGED/],
    ["grant", /APPLICATION_GRANT_CHANGED/], ["database-oid", /INDEPENDENT_DATABASE_CHANGED/]] as const) {
    const f = await derivedFirstOpenFixture(x);
    await assert.rejects(runReviewedFirstOnboarding(f.options), expected);
    assert.equal(f.calls.includes("limited-sql"), false);
    if (x === "caller" || x === "old-bucket") assert.deepEqual(f.calls, []);
    if (x === "second-version") assert.equal(f.calls.includes("prepare-v3"), false);
    if (x === "grant") assert.equal(f.calls.includes("create"), false);
  }
});

test("new first-open failed independent readback does not resubmit an acknowledged completion", async () => {
  const f = await derivedFirstOpenFixture("readback");
  await assert.rejects(runReviewedFirstOnboarding(f.options), /COMPLETION_COMMITTED_READBACK_UNCONFIRMED/);
  assert.equal(f.calls.filter(x => x === "limited-sql").length, 1);
  assert.equal(f.calls.filter(x => x === "readback-sql").length, 1);
});

test("missing empty-Express proof or changed/expired review stops before claim", async () => {
  const { options, calls, row } = await firstOpenFixture();
  await assert.rejects(runReviewedFirstOnboarding({ ...options, verifyEmptyExpressCapability: async () => null }), /EMPTY_EXPRESS_UNPROVED/);
  await assert.rejects(runReviewedFirstOnboarding({ ...options, approval: { ...options.approval, writeBefore: now } }), /WINDOW_CLOSED/);
  row.subscriptionActiveAndCurrent = false;
  await assert.rejects(runReviewedFirstOnboarding(options), /REVIEW_CHANGED/);
  assert.deepEqual(calls, []);
});

test("first-open refuses initialized DB and holds activation on independent DNS, DB, or digest mismatch", async () => {
  const base = await firstOpenFixture();
  base.options.dependencies.tenantDatabase.ensureTenantDatabase = async () => tenantLifecycleOutput(base.context, "verified");
  await assert.rejects(runReviewedFirstOnboarding(base.options), /DATABASE_NOT_EMPTY/);
  assert.equal(base.calls.includes("create"), false);
  for (const mismatch of ["dns", "database", "digest"]) {
    const { options, context, calls } = await firstOpenFixture(), reader = options.independentReader!;
    options.independentReader = { capture: async request => {
      const result = await reader.capture(request);
      if (mismatch === "dns") result.dns.target = "another.elb.amazonaws.com";
      if (mismatch === "database") result.database.ownershipMarker = "foreign";
      if (mismatch === "digest") result.facts.tasks[0].containers![0].imageDigest = "sha256:" + "0".repeat(64);
      return result;
    } };
    await assert.rejects(runReviewedFirstOnboarding(options));
    assert.equal(context.appInstance.status, "pending");
    assert.equal(calls.includes("receipt"), false);
    assert.equal(calls.filter(call => call === "create").length, 1);
  }
});

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
    OneShotTaskSecurityGroupId: "sg-0123456789abcdef3",
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
  assert.equal(
    Object.hasOwn(stack.parameters, "OneShotTaskSecurityGroupId"),
    false,
  );
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
            OneShotTaskSecurityGroupId: "sg-public",
          },
        },
      }),
    /OneShotTaskSecurityGroupId is invalid/,
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
  const oneShotTaskSecurityGroupId =
    binding.tenantStackParameters.OneShotTaskSecurityGroupId;
  const databaseSubnetIds = [
    "subnet-0123456789abcdef2",
    "subnet-0123456789abcdef3",
  ];
  const internetGatewayId = "igw-0123456789abcdef0";
  const publicRouteTableId = "rtb-0123456789abcdef0";
  const mainRouteTableId = "rtb-0123456789abcdef1";
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
    routeTables: [
      {
        id: publicRouteTableId,
        vpcId: binding.tenantStackParameters.VpcId,
        associations: binding.tenantStackParameters.SubnetIds.split(",").map(
          (subnetId, index) => ({
            id: `rtbassoc-public-${index}`,
            subnetId,
            main: false,
            state: "associated",
          }),
        ),
        routes: [
          {
            destinationCidrIpv4: "10.88.0.0/16",
            state: "active",
            targetType: "local",
            targetId: "local",
          },
          {
            destinationCidrIpv4: "0.0.0.0/0",
            state: "active",
            targetType: "internet_gateway",
            targetId: internetGatewayId,
          },
        ],
        tags: resourceTags,
      },
      {
        id: mainRouteTableId,
        vpcId: binding.tenantStackParameters.VpcId,
        associations: [
          {
            id: "rtbassoc-main",
            main: true,
            state: "associated",
          },
        ],
        routes: [
          {
            destinationCidrIpv4: "10.88.0.0/16",
            state: "active",
            targetType: "local",
            targetId: "local",
          },
        ],
        tags: {},
      },
    ],
    internetGateway: {
      id: internetGatewayId,
      attachments: [
        {
          vpcId: binding.tenantStackParameters.VpcId,
          state: "available",
        },
      ],
      tags: resourceTags,
    },
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
        egress: [],
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
      egress: [],
      tags: resourceTags,
    },
    oneShotTaskSecurityGroup: {
      id: oneShotTaskSecurityGroupId,
      vpcId: binding.tenantStackParameters.VpcId,
      ingress: [],
      egress: [
        {
          protocol: "tcp",
          fromPort: 443,
          toPort: 443,
          cidrIpv4: "0.0.0.0/0",
        },
        {
          protocol: "tcp",
          fromPort: 5432,
          toPort: 5432,
          destinationSecurityGroupId: databaseSecurityGroupId,
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
        {
          protocol: "tcp",
          fromPort: 5432,
          toPort: 5432,
          sourceSecurityGroupId: oneShotTaskSecurityGroupId,
        },
      ],
      egress: [],
      tags: resourceTags,
    },
    database: {
      arn:
        `arn:aws:rds:${environment.region}:${environment.expectedAccountId}:cluster:techlong-sandbox-cell-sandbox-1`,
      identifier: "techlong-sandbox-cell-sandbox-1",
      endpoint:
        "techlong-sandbox-cell-sandbox-1.cluster-abcdefghijkl." +
        "ca-central-1.rds.amazonaws.com",
      masterSecretArn:
        `arn:aws:secretsmanager:${environment.region}:` +
        `${environment.expectedAccountId}:secret:` +
        "rds!cluster-01234567-89ab-cdef-0123-456789abcdef-ABCDEF",
      masterSecretStatus: "active",
      masterUsername: "cell_admin",
      databaseName: "cell_admin",
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
  assert.throws(
    () =>
      assertSharedCellSecurityObservation({
        environment,
        binding,
        observation: {
          ...observation,
          oneShotTaskSecurityGroup: {
            ...observation.oneShotTaskSecurityGroup,
            ingress: [
              {
                protocol: "tcp",
                fromPort: 22,
                toPort: 22,
                cidrIpv4: "0.0.0.0/0",
              },
            ],
          },
        },
      }),
    /zero ingress/,
  );
  assert.throws(
    () =>
      assertSharedCellSecurityObservation({
        environment,
        binding,
        observation: {
          ...observation,
          routeTables: observation.routeTables.map((routeTable) =>
            routeTable.id === mainRouteTableId
              ? {
                  ...routeTable,
                  routes: [
                    ...routeTable.routes,
                    {
                      destinationCidrIpv4: "0.0.0.0/0",
                      state: "active",
                      targetType: "nat_gateway",
                      targetId: "nat-0123456789abcdef0",
                    },
                  ],
                }
              : routeTable,
          ),
        },
      }),
    /database subnet .* must not have a public default/,
  );
  assert.throws(
    () =>
      assertSharedCellSecurityObservation({
        environment,
        binding,
        observation: {
          ...observation,
          subnets: observation.subnets.map((subnet) =>
            observation.subnetIds.includes(subnet.id)
              ? { ...subnet, mapPublicIpOnLaunch: false }
              : subnet,
          ),
        },
      }),
    /must be public/,
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
          throw Object.assign(
            new Error(`Stack with id ${stack.stackName} does not exist`),
            { name: "ValidationError" },
          );
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
        verifyCaller: async () => {},
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

test("AWS SDK adapter factory gives STS and CloudFormation one shared credential provider", () => {
  class TestCommand {
    readonly input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  let providerCalls = 0;
  const sharedCredentials = async () => ({ accessKeyId: "test", secretAccessKey: "test" });
  const clientConfigurations: Record<string, Record<string, unknown>> = {};
  class STSClient {
    constructor(configuration: Record<string, unknown>) {
      clientConfigurations.sts = configuration;
    }
    async send(): Promise<Record<string, unknown>> {
      return {};
    }
  }
  class CloudFormationClient {
    constructor(configuration: Record<string, unknown>) {
      clientConfigurations.cloudFormation = configuration;
    }
    async send(): Promise<Record<string, unknown>> {
      return {};
    }
  }

  const adapter = createAwsSdkDeploymentAdapterFromModules(
    environment.region,
    {
      STSClient,
      GetCallerIdentityCommand: TestCommand,
    },
    {
      CloudFormationClient,
      DescribeStacksCommand: TestCommand,
      CreateStackCommand: TestCommand,
      UpdateStackCommand: TestCommand,
      DeleteStackCommand: TestCommand,
    },
    {
      defaultProvider: () => {
        providerCalls += 1;
        return sharedCredentials;
      },
    },
  );

  assert.equal(adapter.region, environment.region);
  assert.equal(providerCalls, 1);
  assert.equal(clientConfigurations.sts.credentials, sharedCredentials);
  assert.equal(clientConfigurations.cloudFormation.credentials, sharedCredentials);
});

test("CloudFormation adapter resumes owned creates and treats delete-in-progress as idempotent", async () => {
  const { stack } = await executionFixture();
  const exactStackId = `arn:aws:cloudformation:ca-central-1:402010193138:stack/${stack.stackName}/11111111-2222-3333-4444-555555555555`;
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
                StackId: exactStackId,
                StackStatus: status,
                Tags: Object.entries(stack.tags).map(([Key, Value]) => ({ Key, Value })),
              },
            ],
          };
        }
        if (command instanceof CreateStackCommand) calls.creates += 1;
        else if (command instanceof UpdateStackCommand) calls.updates += 1;
        else if (command instanceof DeleteStackCommand) {
          assert.equal(command.input.StackName, exactStackId);
          calls.deletes += 1;
        }
        return { StackId: exactStackId };
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
        verifyCaller: async () => {},
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
        verifyCaller: async () => {},
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
