import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { planInstanceRelease, RELEASE_SNAPSHOT_MAX_AGE_MS } from "../lib/deployments/releases/planning.ts";
import type { ReleasePlanBlocker, ReleasePlanningInput } from "../lib/deployments/releases/contract.ts";
import {
  deploymentProfileOptions,
  getDeploymentProfile,
  isDeploymentProfileKey,
} from "../lib/deployments/profiles.ts";
import {
  AwsEcsCellPlanOnlyDriver,
  DeploymentAutomationDisabledError,
} from "../lib/deployments/drivers/aws-ecs-cell.ts";

test("publishes the supported deployment profiles through one allowlist", () => {
  assert.deepEqual(
    deploymentProfileOptions.map((option) => option.key),
    ["standard-v1", "large-v1", "large-dedicated-db-v1"],
  );
  assert.equal(isDeploymentProfileKey("standard-v1"), true);
  assert.equal(isDeploymentProfileKey("large-v1"), true);
  assert.equal(isDeploymentProfileKey("large-dedicated-db-v1"), true);
  assert.equal(isDeploymentProfileKey("customer-supplied-profile"), false);
});

test("maps standard and large tenants to isolated, progressively larger resources", () => {
  const standard = getDeploymentProfile("standard-v1");
  const large = getDeploymentProfile("large-v1");
  const dedicated = getDeploymentProfile("large-dedicated-db-v1");

  assert.equal(standard.ecs.desiredCount, 1);
  assert.equal(standard.autoScaling.minCapacity, 1);
  assert.equal(standard.database.isolation, "tenant_database");

  assert.ok(large.ecs.desiredCount >= 2);
  assert.ok(large.autoScaling.minCapacity >= 2);
  assert.ok(large.ecs.cpu > standard.ecs.cpu);
  assert.ok(large.ecs.memoryMiB > standard.ecs.memoryMiB);
  assert.ok(
    large.autoScaling.maxCapacity > standard.autoScaling.maxCapacity,
  );
  assert.equal(large.database.isolation, "tenant_database");

  assert.ok(dedicated.ecs.desiredCount >= 2);
  assert.equal(dedicated.database.isolation, "dedicated_database");

  const dedicatedPlan = new AwsEcsCellPlanOnlyDriver().buildPlan({
    appInstanceId: "app_dedicated_tenant",
    workspaceId: "wsp_dedicated",
    productId: "prd_restaurant_order_system",
    planId: "plan_dedicated",
    subscriptionId: "sub_dedicated",
    tenantKey: "tenant_dedicated",
    deploymentProfileKey: "large-dedicated-db-v1",
  });
  assert.match(
    dedicatedPlan.resources.tenant.database.dedicatedClusterLogicalName ?? "",
    /dedicated-aurora-rds$/,
  );
});

test("builds a plan-only AWS cell manifest with shared, cell and tenant resources", () => {
  const driver = new AwsEcsCellPlanOnlyDriver();
  const firstOwnerPassword = "must-never-enter-the-deployment-plan";
  const storeName = "Northshore Secret Test Store";
  const inputWithUntrustedExtras = {
    appInstanceId: "app_restaurant_one",
    workspaceId: "wsp_one",
    productId: "prd_restaurant_order_system",
    planId: "plan_basic",
    subscriptionId: "sub_one",
    tenantKey: "tenant_one",
    deploymentProfileKey: "standard-v1",
    cellKey: "cell-ca-central-1-a",
    region: "ca-central-1",
    configurationSnapshot: {
      defaultStoreName: storeName,
      firstOwnerUsername: "owner",
    },
    runtimeSecrets: { firstOwnerPassword },
  } as Parameters<AwsEcsCellPlanOnlyDriver["buildPlan"]>[0];
  const plan = driver.buildPlan(inputWithUntrustedExtras);

  assert.equal(plan.driver, "aws_ecs_cell");
  assert.equal(plan.workflowVersion, "v1");
  assert.equal(plan.mode, "plan_only");
  assert.equal(plan.deploymentProfileKey, "standard-v1");

  assert.deepEqual(Object.keys(plan.resources).sort(), [
    "cell",
    "shared",
    "tenant",
  ]);
  assert.ok(plan.resources.shared.buyerWeb.cloudFront);
  assert.ok(plan.resources.shared.buyerWeb.s3);
  assert.ok(plan.resources.shared.controlPlane);

  assert.ok(plan.resources.cell.alb);
  assert.ok(plan.resources.cell.databaseCluster);
  assert.ok(plan.resources.cell.network.vpc);
  assert.ok(plan.resources.cell.network.egress);

  assert.ok(plan.resources.tenant.ecsService);
  assert.ok(plan.resources.tenant.taskDefinition);
  assert.ok(plan.resources.tenant.targetGroup);
  assert.ok(plan.resources.tenant.listenerRule);
  assert.ok(plan.resources.tenant.database.roleName);
  assert.ok(plan.resources.tenant.database.databaseName);
  assert.ok(plan.resources.tenant.secret.logicalName);
  assert.equal(Object.hasOwn(plan.resources.tenant.secret, "value"), false);
  assert.ok(plan.resources.tenant.autoScaling);
  assert.ok(plan.resources.tenant.logs.logGroupName);
  assert.ok(plan.resources.tenant.costTags.AppInstanceId);

  const serialized = JSON.stringify(plan);
  assert.doesNotMatch(serialized, /arn:aws:/i);
  assert.doesNotMatch(serialized, new RegExp(firstOwnerPassword, "i"));
  assert.doesNotMatch(serialized, new RegExp(storeName, "i"));
  assert.doesNotMatch(serialized, /firstOwnerPassword/i);
});

test("refuses to apply a plan while AWS deployment automation is disabled", async () => {
  const driver = new AwsEcsCellPlanOnlyDriver();
  const plan = driver.buildPlan({
    appInstanceId: "app_restaurant_one",
    workspaceId: "wsp_one",
    productId: "prd_restaurant_order_system",
    planId: "plan_large",
    subscriptionId: "sub_one",
    tenantKey: "tenant_one",
    deploymentProfileKey: "large-v1",
    cellKey: "cell-ca-central-1-a",
    region: "ca-central-1",
    configurationSnapshot: {},
  });

  await assert.rejects(
    () => driver.apply(plan),
    (error: unknown) => {
      assert.ok(error instanceof DeploymentAutomationDisabledError);
      assert.equal(error.code, "AUTOMATION_DISABLED");
      return true;
    },
  );
});

const releaseHash = (letter: string) => letter.repeat(64);
const releaseDigest = (letter: string) => `sha256:${releaseHash(letter)}`;

function releasePlanningInput(suffix = "one"): ReleasePlanningInput {
  const accountId = "111111111111", region = "ca-central-1";
  const repository = `${accountId}.dkr.ecr.${region}.amazonaws.com/example-api`;
  const instanceId = `app_${suffix}`;
  const stackId = `arn:aws:cloudformation:${region}:${accountId}:stack/tenant-${suffix}/00000000-0000-4000-8000-000000000001`;
  return {
    selection: {
      requestId: `release_request_${suffix}`, requestedBy: "operator_one", workspaceId: `wsp_${suffix}`,
      instanceId, environmentId: "sandbox", releaseId: "release_v2",
    },
    binding: {
      instanceId, workspaceId: `wsp_${suffix}`, productId: "product_api", environmentId: "sandbox",
      accountId, region, stackId, initialized: true, status: "active", sourceRepository: "example/backend",
      imageRepository: repository, runtimePlatform: "linux/amd64", applicationPort: 3000,
      clientApiVersion: "v1", desiredCount: 1, templateSha256: releaseHash("c"),
      configurationSha256: releaseHash("d"), stateRevision: 3,
      currentRelease: { id: "release_v1", manifestDigest: releaseDigest("a"), platformDigest: releaseDigest("a") },
    },
    observation: {
      instanceId, stackId, observedAt: 1_000, state: "RUNNING", templateSha256: releaseHash("c"),
      configurationSha256: releaseHash("d"), imageUri: `${repository}@${releaseDigest("a")}`,
      platformDigest: releaseDigest("a"), parameterKeys: ["ImageUri", "JwtExpiresIn", "RuntimeSecretValueFrom", "ClusterName"],
      servicePresent: true, albPresent: true, databaseAvailable: true, databaseProfile: "express_iam",
      databaseSchemaVersion: "schema-v1", desiredCount: 1, runningCount: 1, pendingCount: 0,
      operationInProgress: false, persistentUploadsReady: true,
    },
    release: {
      id: "release_v2", productId: "product_api", component: "tenant_api", version: "2.0.0", status: "ecr_verified",
      source: { repository: "example/backend", commit: "1".repeat(40), buildRunId: "12345", buildAttempt: 1, artifactSha256: releaseHash("e") },
      image: { repository, manifestDigest: releaseDigest("b"), platformDigest: releaseDigest("b"), verificationSha256: releaseHash("f"), runtimePlatform: "linux/amd64" },
      compatibility: { databaseProfiles: ["express_iam", "full_password"], schemaVersions: ["schema-v1"], clientApiVersions: ["v1"], applicationPort: 3000, requiresMigration: false, startupWrites: false },
    },
    now: 10_000,
  };
}

async function rejectsReleasePlan(change: (input: ReleasePlanningInput) => void, reason: ReleasePlanBlocker) {
  const input = releasePlanningInput();
  change(input);
  const result = await planInstanceRelease(input);
  assert.ok(result.status === "BLOCKED" || result.status === "BLOCKED_RESTORE_REQUIRED");
  assert.equal(result.reason, reason);
  assert.equal(result.status, reason === "RESTORE_REQUIRED" ? "BLOCKED_RESTORE_REQUIRED" : "BLOCKED");
  assert.equal(result.executionAuthorized, false);
  assert.equal(Object.hasOwn(result, "plan"), false);
}

test("instance release: plans only ImageUri and leaves all other parameters at their previous values", async () => {
  const input = releasePlanningInput(), before = canonicalJson(input), result = await planInstanceRelease(input);
  assert.ok(result.status === "PLANNED");
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.requiresLivePreflight, true);
  assert.equal(result.planSha256, await sha256Hex(result.plan));
  assert.equal(result.plan.changeSet.StackName, input.binding.stackId);
  assert.equal(result.plan.changeSet.ChangeSetType, "UPDATE");
  assert.equal(result.plan.changeSet.UsePreviousTemplate, true);
  assert.deepEqual(result.plan.changeSet.Parameters, [
    { ParameterKey: "ClusterName", UsePreviousValue: true },
    { ParameterKey: "ImageUri", ParameterValue: `${input.binding.imageRepository}@${releaseDigest("b")}` },
    { ParameterKey: "JwtExpiresIn", UsePreviousValue: true },
    { ParameterKey: "RuntimeSecretValueFrom", UsePreviousValue: true },
  ]);
  assert.deepEqual(Object.keys(result.plan.changeSet).sort(), ["ChangeSetType", "Parameters", "StackName", "UsePreviousTemplate"]);
  assert.deepEqual(result.plan.expectedChanges, [
    { logicalId: "TenantTaskDefinition", action: "Modify", replacement: "True" },
    { logicalId: "TenantService", action: "Modify", replacement: "False" },
  ]);
  assert.equal(result.plan.expectedStateRevision, 3);
  assert.equal(result.plan.compatibility.databaseProfile, "express_iam");
  assert.equal(result.plan.desiredCount, 1);
  assert.equal(canonicalJson(input), before);
});

test("instance release: produces a deterministic hash regardless of parameter order", async () => {
  const first = releasePlanningInput(), second = structuredClone(first);
  second.observation.parameterKeys = [...second.observation.parameterKeys].reverse();
  const a = await planInstanceRelease(first), b = await planInstanceRelease(second);
  assert.ok(a.status === "PLANNED" && b.status === "PLANNED");
  assert.equal(a.planSha256, b.planSha256);
  assert.equal((await planInstanceRelease(first)).status, "PLANNED");
});

test("instance release: the same planner supports different registered instances without fixed sandbox IDs", async () => {
  const first = await planInstanceRelease(releasePlanningInput("one"));
  const second = await planInstanceRelease(releasePlanningInput("two"));
  assert.ok(first.status === "PLANNED" && second.status === "PLANNED");
  assert.notEqual(first.plan.changeSet.StackName, second.plan.changeSet.StackName);
  assert.notEqual(first.planSha256, second.planSha256);
  assert.equal(first.plan.to.imageUri, second.plan.to.imageUri);
});

test("instance release: stopped, partial or missing dependencies never produce an update or restore command", async () => {
  await rejectsReleasePlan(i => { i.observation.state = "STOPPED"; }, "RESTORE_REQUIRED");
  await rejectsReleasePlan(i => { i.observation.state = "PARTIAL"; }, "RESTORE_REQUIRED");
  for (const key of ["servicePresent", "albPresent", "databaseAvailable"] as const) {
    await rejectsReleasePlan(i => { i.observation[key] = false; }, "RESTORE_REQUIRED");
  }
});

test("instance release: rejects a different selected instance, workspace, environment, release or observation", async () => {
  for (const key of ["instanceId", "workspaceId", "environmentId", "releaseId"] as const) {
    await rejectsReleasePlan(i => { i.selection[key] = "other"; }, "SELECTION_MISMATCH");
  }
  await rejectsReleasePlan(i => { i.observation.stackId += "other"; }, "SELECTION_MISMATCH");
  await rejectsReleasePlan(i => { i.observation.instanceId = "other"; }, "SELECTION_MISMATCH");
  await rejectsReleasePlan(i => { i.release.productId = "other"; }, "PRODUCT_MISMATCH");
});

test("instance release: uninitialized, suspended, unstable or busy instances remain blocked", async () => {
  await rejectsReleasePlan(i => { i.binding.initialized = false; }, "INSTANCE_NOT_READY");
  await rejectsReleasePlan(i => { i.binding.status = "suspended"; }, "INSTANCE_NOT_READY");
  await rejectsReleasePlan(i => { i.binding.currentRelease = null; }, "INSTANCE_NOT_READY");
  await rejectsReleasePlan(i => { i.observation.operationInProgress = true; }, "OPERATION_IN_PROGRESS");
  for (const key of ["desiredCount", "runningCount", "pendingCount"] as const) {
    await rejectsReleasePlan(i => { i.observation[key] = key === "pendingCount" ? 1 : 0; }, "INSTANCE_NOT_READY");
  }
});

test("instance release: changed template, configuration or source image is not silently adopted", async () => {
  for (const key of ["templateSha256", "configurationSha256", "platformDigest", "imageUri"] as const) {
    await rejectsReleasePlan(i => { i.observation[key] = "changed"; }, "BASELINE_CHANGED");
  }
});

test("instance release: fresh plans preserve the original five-hour observation deadline", async () => {
  const input = releasePlanningInput();
  input.now = input.observation.observedAt + RELEASE_SNAPSHOT_MAX_AGE_MS - 1;
  const result = await planInstanceRelease(input);
  assert.ok(result.status === "PLANNED");
  assert.equal(result.plan.writeBefore, input.observation.observedAt + RELEASE_SNAPSHOT_MAX_AGE_MS);
  assert.notEqual(result.plan.writeBefore, input.now + RELEASE_SNAPSHOT_MAX_AGE_MS);
  await rejectsReleasePlan(i => { i.now = i.observation.observedAt + RELEASE_SNAPSHOT_MAX_AGE_MS; }, "STALE_OBSERVATION");
  await rejectsReleasePlan(i => { i.observation.observedAt = i.now + 1; }, "STALE_OBSERVATION");
});

test("instance release: stack/account/repository binding and immutable artifact digests are necessary", async () => {
  await rejectsReleasePlan(i => { i.binding.accountId = "222222222222"; }, "INVALID_BINDING");
  await rejectsReleasePlan(i => { i.binding.imageRepository = "https://example.invalid/image"; }, "INVALID_BINDING");
  await rejectsReleasePlan(i => { i.release.image.repository += "-other"; }, "INVALID_ARTIFACT");
  await rejectsReleasePlan(i => { i.release.source.repository = "other/backend"; }, "INVALID_ARTIFACT");
  await rejectsReleasePlan(i => { i.release.image.manifestDigest = "latest"; }, "INVALID_ARTIFACT");
  await rejectsReleasePlan(i => { i.release.image.platformDigest = "not-a-digest"; }, "INVALID_ARTIFACT");
  await rejectsReleasePlan(i => { i.release.image.verificationSha256 = ""; }, "INVALID_ARTIFACT");
  await rejectsReleasePlan(i => { i.release.source.artifactSha256 = ""; }, "INVALID_ARTIFACT");
  await rejectsReleasePlan(i => { i.release.source.commit = "main"; }, "INVALID_ARTIFACT");
});

test("instance release: candidate and revoked versions cannot be planned for deployment", async () => {
  await rejectsReleasePlan(i => { i.release.status = "candidate"; }, "RELEASE_NOT_AVAILABLE");
  await rejectsReleasePlan(i => { i.release.status = "revoked"; }, "RELEASE_NOT_AVAILABLE");
});

test("instance release: missing ImageUri or duplicate parameter names cannot generate ambiguous updates", async () => {
  await rejectsReleasePlan(i => { i.observation.parameterKeys = ["ClusterName"]; }, "INVALID_PARAMETERS");
  await rejectsReleasePlan(i => { i.observation.parameterKeys = ["ImageUri", "ImageUri"]; }, "INVALID_PARAMETERS");
});

test("instance release: database, schema, client API and application port must remain compatible", async () => {
  await rejectsReleasePlan(i => { i.release.compatibility.databaseProfiles = ["full_password"]; }, "INCOMPATIBLE_RELEASE");
  await rejectsReleasePlan(i => { i.release.compatibility.schemaVersions = ["schema-v2"]; }, "INCOMPATIBLE_RELEASE");
  await rejectsReleasePlan(i => { i.release.compatibility.clientApiVersions = ["v2"]; }, "INCOMPATIBLE_RELEASE");
  await rejectsReleasePlan(i => { i.release.compatibility.applicationPort = 4000; }, "INCOMPATIBLE_RELEASE");
  const full = releasePlanningInput(); full.observation.databaseProfile = "full_password";
  assert.equal((await planInstanceRelease(full)).status, "PLANNED");
});

test("instance release: database writes, migration requirements and ephemeral uploads are separate changes", async () => {
  await rejectsReleasePlan(i => { i.release.compatibility.requiresMigration = true; }, "REQUIRES_SEPARATE_CHANGE");
  await rejectsReleasePlan(i => { i.release.compatibility.startupWrites = true; }, "REQUIRES_SEPARATE_CHANGE");
  await rejectsReleasePlan(i => { i.observation.persistentUploadsReady = false; }, "PERSISTENCE_NOT_READY");
});

test("instance release: an already verified image is a no-change result, not a forced deployment", async () => {
  const input = releasePlanningInput();
  input.release.image.manifestDigest = releaseDigest("a");
  input.release.image.platformDigest = releaseDigest("a");
  const result = await planInstanceRelease(input);
  assert.equal(result.status, "NO_CHANGE");
  assert.equal(Object.hasOwn(result, "plan"), false);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.requiresLivePreflight, true);
  await rejectsReleasePlan(i => { i.release.image.manifestDigest = releaseDigest("a"); }, "INVALID_ARTIFACT");
});

test("instance release: an index digest and its verified platform digest stay distinct in the plan", async () => {
  const input = releasePlanningInput(); input.release.image.platformDigest = releaseDigest("9");
  const result = await planInstanceRelease(input);
  assert.ok(result.status === "PLANNED");
  assert.equal(result.plan.to.imageUri, `${input.binding.imageRepository}@${releaseDigest("b")}`);
  assert.equal(result.plan.to.platformDigest, releaseDigest("9"));
});

test("instance release: extra caller fields are not copied into the plan or rejection result", async () => {
  const input = releasePlanningInput(), canary = "secret-canary-never-persist";
  Object.assign(input.binding, { privatePassword: canary });
  Object.assign(input.release, { hmacSecret: canary });
  Object.assign(input.selection, { arbitraryCommand: canary });
  assert.ok(!(JSON.stringify(await planInstanceRelease(input))).includes(canary));
  input.release.status = "revoked";
  assert.ok(!(JSON.stringify(await planInstanceRelease(input))).includes(canary));
});
