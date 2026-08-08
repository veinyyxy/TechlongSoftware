import assert from "node:assert/strict";
import test from "node:test";
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
  assert.equal(standard.database.isolation, "schema");

  assert.ok(large.ecs.desiredCount >= 2);
  assert.ok(large.autoScaling.minCapacity >= 2);
  assert.ok(large.ecs.cpu > standard.ecs.cpu);
  assert.ok(large.ecs.memoryMiB > standard.ecs.memoryMiB);
  assert.ok(
    large.autoScaling.maxCapacity > standard.autoScaling.maxCapacity,
  );
  assert.equal(large.database.isolation, "schema");

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
  assert.ok(plan.resources.tenant.database.schemaName);
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
