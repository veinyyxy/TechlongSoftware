import test from "node:test";
import assert from "node:assert/strict";
import { AwsEcsCellPlanOnlyDriver } from "../lib/deployments/drivers/aws-ecs-cell.ts";
import { compileSingleTenantAcceptanceAccess, compileAcceptanceLifecycleRegistration, FIRST_ACCEPTANCE_LIFECYCLE_LOG_GROUP } from "../lib/deployments/execution/single-tenant-acceptance-access.ts";
import { FIRST_ACCEPTANCE_APP_IMAGE } from "../lib/deployments/execution/single-deployment-scope.ts";
import { PUBLISHED_F3_IMAGES_V1 } from "../lib/deployments/execution/cell-launch-readiness-v1.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import type { PreparedLifecycleDeploymentReviewInput } from "../lib/deployments/execution/tenant-lifecycle-prepared-review.ts";

const now = Date.parse("2026-10-13T15:00:00.000Z"), kms = "arn:aws:kms:ca-central-1:402010193138:key/12345678-1234-1234-1234-123456789012";
async function input() {
  const plan = new AwsEcsCellPlanOnlyDriver({ mode: "aws_sandbox", cellKey: "cell-sandbox-1" }).buildPlan({ appInstanceId: "app_first_acceptance", workspaceId: "workspace_first",
    productId: "prd_restaurant_order_system", planId: "plan_first", subscriptionId: "sub_first", tenantKey: "first_acceptance", deploymentProfileKey: "standard-v1" });
  const owner = { appInstanceId: "app_first_acceptance", workspaceId: "workspace_first", productId: "prd_restaurant_order_system", environmentId: "env_aws_sandbox_ca_central_1", cellKey: "cell-sandbox-1" };
  const hash = await sha256Hex(owner);
  const identity = { schemaVersion: 1 as const, ...owner, databaseName: plan.resources.tenant.database.databaseName,
    roleName: plan.resources.tenant.database.roleName, stableIdentityHash: hash, secretName: `techlong/sandbox/tenant/appfirstacceptance_${hash.slice(0, 10)}/runtime` };
  const deployment: PreparedLifecycleDeploymentReviewInput = {
    imageUri: FIRST_ACCEPTANCE_APP_IMAGE.replace(PUBLISHED_F3_IMAGES_V1[0].digest, PUBLISHED_F3_IMAGES_V1[1].digest),
    taskDefinitionArn: "arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-lifecycle:999",
    notBefore: new Date(now).toISOString(), expiresAt: new Date(now + 3600000).toISOString(),
    tenantFence: { schemaVersion: 1, generation: 1, ownerDeploymentId: "dep_first_acceptance", ownershipMarker: `tl_owner_${hash.slice(0, 32)}_g1`, identity },
    managementTarget: { cellId: "cell-sandbox-1", clusterArn: "arn:aws:ecs:ca-central-1:402010193138:cluster/cell-sandbox-1", databaseClusterIdentifier: "techlong-sandbox-cell-sandbox-1",
      managementEndpoint: "techlong-sandbox-cell-sandbox-1.cluster-fixture123.ca-central-1.rds.amazonaws.com", managementPort: 5432, managementDatabase: "cell_admin", managementUsername: "cell_admin",
      managementSecretArn: "arn:aws:secretsmanager:ca-central-1:402010193138:secret:rds!cluster-fixture123-ABC123", sharedCellEvidenceHash: "d".repeat(64) },
  };
  return { scope: { deploymentId: deployment.tenantFence.ownerDeploymentId, appInstanceId: identity.appInstanceId, environmentId: identity.environmentId,
    planHash: await sha256Hex(plan), configurationHash: "e".repeat(64), artifactRef: FIRST_ACCEPTANCE_APP_IMAGE }, plan,
    lifecycle: { deployment, generationSecretArn: `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${identity.secretName}/g1-ABC123`, managementKmsKeyArn: kms, generationKmsKeyArn: kms },
    controlPublicKeySecretArn: "arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/control/first-public-key-ABC123", controlPublicKeyKmsKeyArn: kms };
}

test("one package reuses exact lifecycle boundary, v2 activation and registration, adding scoped execution Secret/KMS/log access", async () => {
  const i = await input(), packageDraft = await compileSingleTenantAcceptanceAccess(i, now);
  assert.equal(packageDraft.runtimeEnabled, false); assert.equal(packageDraft.executionAuthorized, false);
  assert.equal(packageDraft.activationInstallationAuthorized, false);
  assert.equal(packageDraft.existingExecutionRolePoliciesAndSharedBoundaryMustBePreserved, true);
  assert.deepEqual(packageDraft.lifecycleRole.inlinePolicyDocument.Statement.find(s => s.Sid === "ReadCurrentDatabaseSecrets")?.Resource,
    [i.lifecycle.deployment.managementTarget.managementSecretArn, i.lifecycle.generationSecretArn]);
  assert.equal(JSON.parse(packageDraft.activationItemDraft.record_json.S).taskDefinitionArn, i.lifecycle.deployment.taskDefinitionArn);
  const container = packageDraft.taskDefinitionDraft.containerDefinitions[0] as { logConfiguration?: { options: Record<string, string> } };
  assert.equal(container.logConfiguration?.options["awslogs-group"], FIRST_ACCEPTANCE_LIFECYCLE_LOG_GROUP);
  const statements = packageDraft.executionRoleSupplement.policyDocument.Statement;
  assert.deepEqual(statements[0].Resource, [i.lifecycle.generationSecretArn, i.controlPublicKeySecretArn]);
  assert.ok(statements[2].Resource.every(resource => resource.includes(":log-stream:")));
  assert.equal(statements.flatMap(s => s.Action).some(action => /Delete|PutItem|CreateSecret|RunTask/.test(action)), false);
});

test("foreign owner, altered plan, unpinned image and foreign control key/Secret cannot compile", async () => {
  for (const change of [
    (i: Awaited<ReturnType<typeof input>>) => { i.lifecycle.deployment.tenantFence.ownerDeploymentId = "other"; },
    (i: Awaited<ReturnType<typeof input>>) => { i.plan.resources.tenant.logs.logGroupName = "/foreign"; },
    (i: Awaited<ReturnType<typeof input>>) => { i.lifecycle.deployment.imageUri = i.lifecycle.deployment.imageUri.replace(/@sha256:.*/, ":latest"); },
    (i: Awaited<ReturnType<typeof input>>) => { i.controlPublicKeySecretArn = i.controlPublicKeySecretArn.replace("techlong/sandbox/control", "other"); },
    (i: Awaited<ReturnType<typeof input>>) => { i.controlPublicKeyKmsKeyArn = i.controlPublicKeyKmsKeyArn.replace("ca-central-1", "us-east-1"); },
  ]) { const i = await input(); change(i); await assert.rejects(() => compileSingleTenantAcceptanceAccess(i, now)); }
});

test("initial registration has no invented revision or activation, preserving prepared-v2 runtime shape", async () => {
  const i = await input(), registration = compileAcceptanceLifecycleRegistration(i.lifecycle.deployment.managementTarget);
  assert.equal(registration.registrationAuthorized, false);
  assert.equal(registration.requiresPostRegistrationReadback, true);
  assert.equal(JSON.stringify(registration).includes("task-definition/tenant-lifecycle:"), false);
  assert.equal("activationItemDraft" in registration, false);
  const definition = registration.definition;
  assert.equal(definition.family, "tenant-lifecycle");
  assert.deepEqual(definition.volumes, [{ name: "tenant-lifecycle-workspace" }]);
  assert.equal(definition.containerDefinitions[0].readonlyRootFilesystem, true);
  assert.deepEqual(definition.containerDefinitions[0].entryPoint, ["/usr/local/bin/node", "db/tenant_lifecycle_prepared.js"]);
  assert.throws(() => compileAcceptanceLifecycleRegistration({ ...i.lifecycle.deployment.managementTarget, managementEndpoint: "localhost" }));
});
