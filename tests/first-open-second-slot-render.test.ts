import assert from "node:assert/strict";
import test from "node:test";
import { renderAwsSandboxTenantStack, type AwsSandboxTenantStackInput } from "../lib/deployments/cloudformation/tenant-stack.ts";
import { AwsEcsCellPlanOnlyDriver } from "../lib/deployments/drivers/aws-ecs-cell.ts";
import { validateDeploymentEnvironment } from "../lib/deployments/environment.ts";
import { FIRST_OPEN_EXPRESS_ENDPOINT, FIRST_OPEN_MANAGEMENT_SQL_USER } from "../lib/deployments/execution/aurora-express-bootstrap-v3.ts";
import type { TenantExternalOperationFence } from "../lib/deployments/execution/contracts.ts";
import { renderFirstOpenExpressTemplate, type FirstOnboardingExpressApproval } from "../lib/deployments/execution/first-onboarding-express.ts";
import { SANDBOX_FIRST_OPEN as s } from "../lib/deployments/execution/first-onboarding-run-once.ts";
import { completeFirstOpenBuyerParameters } from "../lib/deployments/execution/first-open-buyer-binding.ts";
import type { FirstOpenSecondSlotApproval } from "../lib/deployments/execution/first-open-second-slot.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { deriveTenantOwnershipMarker, deriveTenantResourceIdentityFromPlan } from "../lib/deployments/execution/tenant-database.ts";
import { buildFirstOnboardingJob, reviewFirstOnboarding } from "../lib/deployments/first-onboarding.ts";
import { prepareFirstOpenInspectSeed, type FirstOpenInspectSeed } from "../ops/aws-sandbox/first-open-inspect-input.ts";
import { firstOpenTaskReleaseFixture } from "./first-open-task-release-fixture.ts";
import { v3Environment, v3Now } from "./fixtures/cell-stack-v3.ts";

async function fixture() {
  const environment = v3Environment();
  environment.policy.maxTenants = 2;
  const secondSlot: FirstOpenSecondSlotApproval = { schema: "techlong/fc41597f-second-slot/v1", admissionEpoch: 7,
    environmentPolicy: structuredClone(environment.policy), listenerPriority: 204 };
  const scope = { appInstanceId: s.instanceId, workspaceId: "wsp_beb2aa5868a9d1c10c257348", productId: s.productId,
    environmentId: s.environmentId, cellKey: "cell-sandbox-1" };
  const planning = { ...scope, subscriptionId: s.subscriptionId, planId: "plan_basic", tenantKey: `pending_${s.instanceId}` };
  const plan = new AwsEcsCellPlanOnlyDriver({ region: s.region, cellKey: scope.cellKey, mode: "aws_sandbox" })
    .buildPlan({ ...planning, deploymentProfileKey: "standard-v1" });
  const database = { databaseName: s.tenantDatabase, roleName: s.tenantRole };
  Object.assign(plan.resources.tenant.database, database);
  const identity = await deriveTenantResourceIdentityFromPlan(scope, database);
  const fence = { schemaVersion: 1 as const, identity, generation: 1, ownerDeploymentId: s.deploymentId,
    ownershipMarker: deriveTenantOwnershipMarker(identity, 1) };
  const epoch: TenantExternalOperationFence = { schemaVersion: 1, resourceFence: fence, ownerDeploymentId: s.deploymentId,
    epoch: 1, intent: "provision", marker: `tl_epoch_${s.stableIdentity.slice(0, 24)}_g1_e1`, operationHash: "c".repeat(64), state: "active" };
  const arn = `arn:aws:secretsmanager:${s.region}:${s.account}:secret:${s.secretName}-AbCdEf`;
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  const imageUri = `${taskRelease.image.repository}@${taskRelease.image.manifestDigest}`;
  const workload: AwsSandboxTenantStackInput = { deploymentId: s.deploymentId, resourceGeneration: 1,
    externalOperation: { ownerDeploymentId: s.deploymentId, epoch: 1, intent: "provision", state: "active",
      marker: epoch.marker, operationHash: epoch.operationHash },
    runtimeSecretRef: arn, runtimeSecretName: s.secretName, plan, environment, imageUri, tenantHostname: s.hostname,
    listenerPriority: secondSlot.listenerPriority, activeCellCount: 1, activeTenantCount: 1, requestedAt: v3Now };
  const held = (await buildFirstOnboardingJob({ ...planning, accountId: s.account, templateVersionId: "tpl_fixture",
    planHash: await sha256Hex(plan), configurationHash: "d".repeat(64), artifactRef: imageUri, releaseId: taskRelease.id }))!;
  const fields = held.payload.scope;
  const review = (await reviewFirstOnboarding({ scope: fields, instancePendingFirstOpen: true, subscriptionActiveAndCurrent: true,
    scopeStillEligible: true, noOtherDeploymentOrTenantGeneration: true,
    deployment: { id: held.deploymentId, status: "planned", artifactRef: imageUri, planHash: fields.planHash, configurationHash: fields.configurationHash },
    job: { id: held.jobId, deploymentId: held.deploymentId, dedupeKey: held.dedupeKey, jobType: "apply", status: "pending", payload: held.payload,
      attempts: 0, maxAttempts: 1, availableAt: held.availableAt, leaseOwner: null, leaseToken: null, leaseExpiresAt: null, completedAt: null },
    release: taskRelease }, taskRelease))!;
  const listener = `arn:aws:elasticloadbalancing:${s.region}:${s.account}:listener/app/techlong-sandbox-fixture/12345678/`;
  const parameters = completeFirstOpenBuyerParameters({ ClusterName: scope.cellKey, VpcId: "vpc-0123456789abcdef0",
    SubnetIds: "subnet-0123456789abcdef0,subnet-0123456789abcdef1", TaskSecurityGroupId: "sg-0123456789abcdef0",
    HttpsListenerArn: listener + "aaaaaaaa", ControlListenerArn: listener + "bbbbbbbb", TaskExecutionRoleArn: s.executionRole,
    ControlPublicKeyValueFrom: `${s.controlArn}:::${s.controlVersion}`, StripePublishableKey: `pk_test_${"a".repeat(24)}` });
  const baselineDigest = "a".repeat(64), control = { arn: s.controlArn, versionId: s.controlVersion };
  const express: FirstOnboardingExpressApproval = {
    secondSlot, target: { schema: "techlong/express-management-target/v3", clusterArn: s.clusterArn,
      clusterResourceId: s.clusterId, endpoint: FIRST_OPEN_EXPRESS_ENDPOINT, observedEngineVersion: "17.9", port: 5432,
      managementDatabase: "postgres", managementUsername: FIRST_OPEN_MANAGEMENT_SQL_USER, stableIdentity: s.stableIdentity,
      resourceGeneration: 1, tenantDatabase: s.tenantDatabase, tenantUsername: s.tenantRole }, nonce: "fixture",
    baseline: { contract: "speedfeast-pg16.14-tenant-baseline-v1", archiveS3Uri: "s3://fixture/baseline.dump", archiveSha256: baselineDigest,
      approvedArchiveSha256: baselineDigest, manifestS3Uri: "s3://fixture/baseline.json", manifestSha256: "b".repeat(64),
      archiveVersionId: "fixture-version", manifestVersionId: "fixture-version", sourceDatabase: "fixture" },
    independentRoleArn: s.inspectorRole, lifecycleRoleArn: s.lifecycleRole, applicationRoleArn: s.applicationRole,
    environmentParametersSha256: await sha256Hex(parameters), mediaPublicBaseUrl: "https://fixture.cloudfront.net",
    sampling: { platformStackId: s.platformStack, cellStackId: s.cellStack, hostedZoneId: s.zone, apiHostname: s.hostname,
      cellOutputParameters: {}, database: { kind: "cluster", identifier: "techlong-sandbox-express-d001", profile: "express_iam", schemaVersion: s.schemaVersion },
      secrets: [control], persistence: { bucket: s.bucket, providerVariable: "IMAGE_STORAGE_PROVIDER", bucketVariable: "IMAGE_S3_BUCKET", verificationSha256: "a".repeat(64) } },
  };
  const databaseIdentity = { name: s.tenantDatabase, roleName: s.tenantRole, ownershipMarker: fence.ownershipMarker, baselineDigest,
    schemaVersion: s.schemaVersion, databaseOid: "16459", roleOid: "16456", clusterResourceId: s.clusterId, otherConnectableDatabases: 0 as const };
  const seed: FirstOpenInspectSeed = { plan, environment, epoch, requestedAt: workload.requestedAt, review, release: taskRelease,
    activeCellCount: 1, activeTenantCount: 1, secondSlot: { admissionEpoch: secondSlot.admissionEpoch, listenerPriority: secondSlot.listenerPriority },
    binding: { environmentId: s.environmentId, workerRoleArn: s.workerRole, cloudFormationRoleArn: s.cfnRole, status: "active", tenantStackParameters: parameters } };
  const approval: Parameters<typeof prepareFirstOpenInspectSeed>[2] = { jobId: s.jobId, reviewSha256: review.reviewSha256,
    capabilitySha256: "d".repeat(64), baselineDigest, databaseSchemaVersion: s.schemaVersion, hostname: s.hostname, dnsTarget: "fixture.elb.amazonaws.com",
    writeBefore: v3Now + 900_000, controlledWindow: { startAt: v3Now, claimBefore: v3Now + 60_000, workloadExpiresAt: v3Now + 7_200_000,
      factsExpireAt: v3Now + 900_000, cleanupReviewSha256: "a".repeat(64), cleanupPermissionsEvidenceSha256: "a".repeat(64) },
    express, taskRelease };
  return { workload, seed, approval, express, secondSlot, arn, databaseIdentity };
}

function priorities(template: Record<string, unknown>) {
  const resources = template.Resources as Record<string, { Properties: { Priority: number } }>;
  return ["TenantBusinessControlDenyRule", "TenantListenerRule", "TenantControlListenerRule"].map(x => resources[x].Properties.Priority);
}

test("ordinary sandbox still rejects cap two; only the exact approved environment can render the second slot", async () => {
  const f = await fixture();
  assert.deepEqual(validateDeploymentEnvironment(v3Environment()), []);
  assert.deepEqual(validateDeploymentEnvironment(f.workload.environment), ["sandbox_tenant_limit_invalid"]);
  assert.deepEqual(validateDeploymentEnvironment(f.workload.environment, f.secondSlot), []);
  assert.ok(validateDeploymentEnvironment({ ...f.workload.environment, applyEnabled: true }, f.secondSlot).length);
  assert.ok(validateDeploymentEnvironment(v3Environment(), f.secondSlot).length);
  assert.throws(() => renderAwsSandboxTenantStack(f.workload), /sandbox_tenant_limit_invalid/);
  assert.deepEqual(priorities(renderAwsSandboxTenantStack({ ...f.workload, environment: v3Environment(),
    activeTenantCount: 0, listenerPriority: 100 }).template), [100, 101, 100]);

  const render = (workload: AwsSandboxTenantStackInput, approval = f.express) => renderFirstOpenExpressTemplate(workload, approval,
    { identity: f.databaseIdentity, sampling: { ...f.express.sampling, secrets: [...f.express.sampling.secrets, { arn: f.arn, versionId: "a".repeat(64) }] } }, "d".repeat(64));
  const before = structuredClone(f.workload);
  const result = await render(f.workload);
  assert.deepEqual(f.workload, before);
  assert.deepEqual(priorities(result.template), [204, 205, 204]);
  assert.equal(result.safety.applyReady, false);
  await assert.rejects(render(f.workload, { ...f.express, secondSlot: undefined }), /sandbox_tenant_limit_invalid/);
  for (const bad of [{ listenerPriority: 100 }, { activeCellCount: 0 }, { activeTenantCount: 0 }, { activeTenantCount: 2 },
    { deploymentId: "dep_foreign" }, { tenantHostname: "other.sandbox.techlong.cloud" },
    { environment: { ...f.workload.environment, policy: { ...f.workload.environment.policy, logRetentionDays: 2 } } }]) {
    await assert.rejects(render({ ...f.workload, ...bad }), /FIRST_OPEN_SECOND_SLOT_RENDER_SCOPE/);
  }
  const foreign = structuredClone(f.workload);
  foreign.plan.resources.tenant.costTags.AppInstanceId = "app_foreign";
  await assert.rejects(render(foreign), /FIRST_OPEN_SECOND_SLOT_RENDER_SCOPE/);
});

test("Inspector binds independent policy, counts, admission epoch and priority and renders the same three rules", async () => {
  const f = await fixture(), signal = new AbortController().signal;
  const prepare = async (seed: FirstOpenInspectSeed) => prepareFirstOpenInspectSeed(seed, await sha256Hex(seed), f.approval, await sha256Hex(f.approval), signal);
  const inspection = await prepare(f.seed);
  const result = await inspection.renderStack({ arn: f.arn, identity: f.databaseIdentity }, signal);
  assert.deepEqual(priorities(result.stack.template), [204, 205, 204]);
  for (const bad of [{ secondSlot: undefined }, { activeCellCount: 0 }, { activeTenantCount: 2 },
    { secondSlot: { admissionEpoch: 6, listenerPriority: 204 } }, { secondSlot: { admissionEpoch: 7, listenerPriority: 214 } },
    { environment: { ...f.seed.environment, policy: { ...f.seed.environment.policy, logRetentionDays: 2 } } }]) {
    await assert.rejects(prepare({ ...f.seed, ...bad }), /FIRST_OPEN_INSPECT_INPUT_SECOND_SLOT/);
  }
  await assert.rejects(prepareFirstOpenInspectSeed({ ...f.seed, secondSlot: { admissionEpoch: 7, listenerPriority: 214 } },
    await sha256Hex(f.seed), f.approval, await sha256Hex(f.approval), signal), /FIRST_OPEN_INSPECT_INPUT_SEED/);
});
