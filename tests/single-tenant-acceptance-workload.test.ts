import test from "node:test";
import assert from "node:assert/strict";
import { AwsEcsCellPlanOnlyDriver } from "../lib/deployments/drivers/aws-ecs-cell.ts";
import { renderAwsSandboxTenantStack, type AwsSandboxTenantStackInput } from "../lib/deployments/cloudformation/tenant-stack.ts";
import { renderSingleTenantAcceptanceWorkload } from "../lib/deployments/cloudformation/single-tenant-acceptance-workload.ts";
import { FIRST_ACCEPTANCE_APP_IMAGE } from "../lib/deployments/execution/single-deployment-scope.ts";
import { v3Environment, v3Now } from "./fixtures/cell-stack-v3.ts";

function input(): AwsSandboxTenantStackInput {
  const environment = v3Environment();
  const plan = new AwsEcsCellPlanOnlyDriver({ mode: "aws_sandbox", region: environment.region, cellKey: environment.cellKey }).buildPlan({
    appInstanceId: "app_first_acceptance", workspaceId: "workspace_first", productId: "prd_restaurant_order_system",
    planId: "plan_first", subscriptionId: "sub_first", tenantKey: "first_acceptance", deploymentProfileKey: "standard-v1" });
  return { deploymentId: "dep_first_acceptance", resourceGeneration: 1,
    externalOperation: { epoch: 1, intent: "provision", ownerDeploymentId: "dep_first_acceptance",
      operationHash: "c".repeat(64), marker: `tl_epoch_${"d".repeat(24)}_g1_e1`, state: "active" },
    runtimeSecretName: "techlong/sandbox/tenant/first_acceptance/runtime/g1",
    runtimeSecretRef: "arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/tenant/first_acceptance/runtime/g1-AbCdEf",
    plan, environment, imageUri: FIRST_ACCEPTANCE_APP_IMAGE, tenantHostname: "first-acceptance.sandbox.techlong.cloud",
    listenerPriority: 100, activeCellCount: 1, activeTenantCount: 0, requestedAt: v3Now };
}

test("single workload removes old schedule, preserves epoch tags, mTLS and ready checks; standard Fargate", async () => {
  const draft = input(), before = structuredClone(draft), plan = await renderSingleTenantAcceptanceWorkload(draft);
  assert.deepEqual(draft, before); assert.equal(plan.resourceInventory.length, 7);
  assert.equal(plan.resourceInventory.some(resource => /Scheduler|IAM|Lambda/.test(String(resource.type))), false);
  assert.equal(plan.safety.executionAuthorized, false); assert.equal(plan.safety.supervisedExactArnCleanupRequired, true);
  assert.equal(plan.tags.ExternalOperationMarker, draft.externalOperation.marker);
  assert.equal(plan.tags.ResourceGeneration, "1");
  const resources = plan.template.Resources as Record<string, { DependsOn?: string[]; Properties: Record<string, unknown> }>;
  assert.deepEqual(resources.TenantService.Properties.CapacityProviderStrategy, [{ CapacityProvider: "FARGATE", Base: 1, Weight: 1 }]);
  assert.equal(resources.TenantService.Properties.DesiredCount, 1);
  for (const resource of Object.values(resources)) for (const id of resource.DependsOn ?? []) assert.ok(id in resources);
  assert.ok(plan.templateBody.includes("SAAS_REQUIRE_MTLS")); assert.ok(plan.templateBody.includes("/ready"));
  assert.ok(plan.templateBody.includes("TenantRuntimeSecretArn"));
  assert.equal(plan.templateBody.includes("delete_cloudformation_stack"), false);
  assert.equal(plan.requiredExternalParameters.includes("SchedulerInvokeRoleArn"), false);
});

test("legacy workload remains scheduled, SPOT and unchanged", async () => {
  const old = renderAwsSandboxTenantStack(input()); await renderSingleTenantAcceptanceWorkload(input());
  const resources = old.template.Resources as Record<string, { Properties: Record<string, unknown> }>;
  assert.ok("TenantCleanupSchedule" in resources);
  assert.deepEqual(resources.TenantService.Properties.CapacityProviderStrategy, [{ CapacityProvider: "FARGATE_SPOT", Base: 0, Weight: 1 }]);
  assert.equal(old.safety.cleanupScheduleFirst, true);
});

test("old ownership/Secret validation and new single-tenant image/budget limits reject invalid candidates", async () => {
  for (const patch of [
    (i: AwsSandboxTenantStackInput) => { i.externalOperation.ownerDeploymentId = "other"; },
    (i: AwsSandboxTenantStackInput) => { i.runtimeSecretRef = i.runtimeSecretRef.replace("/g1-", "/g2-"); },
    (i: AwsSandboxTenantStackInput) => { i.imageUri = i.imageUri.replace(/@sha256:.*/, ":latest"); },
    (i: AwsSandboxTenantStackInput) => { i.environment.policy.budgetLimitCents = 1000; },
  ]) { const i = input(); patch(i); await assert.rejects(() => renderSingleTenantAcceptanceWorkload(i)); }
});
