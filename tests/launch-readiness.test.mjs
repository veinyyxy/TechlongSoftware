import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

test("health status reports the current released platform phase", async () => {
  const source = await read("app/api/health/route.ts");
  assert.match(source, /platformConfig/);
  assert.match(source, /phase: platformConfig\.phase/);
  assert.doesNotMatch(source, /phase:\s*["']foundation["']/);
});

test("suspended and disabled customers are not sent into a dashboard redirect loop", async () => {
  const source = await read("app/unauthorized/page.tsx");
  assert.match(source, /reason !== "workspace_status"/);
  assert.match(source, /canReturnToDashboard/);
});

test("README documents startup, local admin initialization, and launch scope", async () => {
  const readme = await read("README.md");
  assert.match(readme, /auth:bootstrap-admin/);
  assert.match(readme, /邮箱密码/);
  assert.match(readme, /一次性激活链接/);
  assert.match(readme, /Stripe Webhook/);
  assert.match(readme, /Paddle、自动续扣/);
});

test("multi-product subscription pages expose current and historical records", async () => {
  const [
    dashboard,
    billing,
    apps,
    appDetail,
    customerDetail,
    customerList,
    customerForm,
    subscriptionDetail,
    subscriptionForm,
    newSubscription,
    planForm,
    instanceManagement,
    instanceDetail,
    templateList,
    templateVersionForm,
  ] =
    await Promise.all([
      read("app/dashboard/page.tsx"),
      read("app/dashboard/billing/page.tsx"),
      read("app/dashboard/apps/page.tsx"),
      read("app/dashboard/apps/[instanceId]/page.tsx"),
      read("app/admin/customers/[customerId]/page.tsx"),
      read("app/admin/customers/page.tsx"),
      read("components/admin/CustomerForm.tsx"),
      read("app/admin/subscriptions/[subscriptionId]/page.tsx"),
      read("components/admin/SubscriptionForm.tsx"),
      read("app/admin/subscriptions/new/page.tsx"),
      read("components/admin/PlanForm.tsx"),
      read("lib/instances/management.ts"),
      read("app/admin/instances/[instanceId]/page.tsx"),
      read("app/admin/templates/page.tsx"),
      read("components/admin/AppInstanceTemplateVersionForm.tsx"),
  ]);

  assert.match(dashboard, /billing\.currentSubscriptions/);
  assert.match(dashboard, /selectCurrentProductSubscription/);
  assert.match(dashboard, /订阅产品切换/);
  assert.match(billing, /当前订阅/);
  assert.match(billing, /历史订阅/);
  assert.match(customerDetail, /billing\.currentSubscriptions/);
  assert.match(customerDetail, /billing\.historicalSubscriptions/);
  assert.match(customerList, /currentSubscriptionCount/);
  assert.doesNotMatch(customerForm, /name="planId"/);
  assert.ok(
    apps.indexOf("billing.currentSubscriptions.find") <
      apps.indexOf("billing.subscriptions.find"),
  );
  assert.ok(
    appDetail.indexOf("billing.currentSubscriptions.find") <
      appDetail.indexOf("billing.subscriptions.find"),
  );
  assert.match(subscriptionDetail, /subscription\.status !== "canceled"/);
  assert.match(subscriptionForm, /name="productId"/);
  assert.match(subscriptionForm, /plan\.productId === selectedProductId/);
  assert.match(planForm, /name="productId"/);
  assert.match(instanceManagement, /subscription_plan\.product_id = ai\.product_id/);
  assert.match(instanceDetail, /instance\.subscriptionPlanName/);
  assert.match(templateList, /应用实例模板管理/);
  assert.match(templateVersionForm, /动态参数定义/);
  assert.match(templateVersionForm, /outputPath/);
  assert.match(templateVersionForm, /value="customer"/);
  assert.match(planForm, /templateVersionId/);
  assert.match(planForm, /应用实例模板参数/);
  assert.match(planForm, /templateParameter\.\$\{field\.key\}/);
  assert.doesNotMatch(planForm, /其他额度与限制/);
  assert.doesNotMatch(planForm, /name="limits"/);
  assert.match(planForm, /limits: planLimits/);
  assert.match(planForm, /field\.source === "plan_limit"/);
  assert.match(subscriptionForm, /instanceConfiguration/);
  assert.match(instanceDetail, /configurationSnapshot/);
  assert.doesNotMatch(newSubscription, /subscribedWorkspaceIds/);
});

test("manual instance fallback derives customer and product from the subscription", async () => {
  const [newInstancePage, instanceForm, instanceRoute, instanceManagement] =
    await Promise.all([
      read("app/admin/instances/new/page.tsx"),
      read("components/admin/AppInstanceForm.tsx"),
      read("app/api/admin/instances/route.ts"),
      read("lib/instances/management.ts"),
    ]);

  assert.doesNotMatch(newInstancePage, /listCustomers/);
  assert.match(newInstancePage, /eligibleSubscriptions/);
  assert.match(newInstancePage, /企业、产品和套餐由所选订阅自动确定/);
  assert.match(instanceForm, /mode === "create"/);
  assert.match(instanceForm, /请选择需要补建实例的订阅/);
  assert.match(instanceForm, /企业、产品和套餐归属由订阅自动确定/);
  assert.match(instanceRoute, /validateCreateAppInstanceInput/);
  assert.match(instanceRoute, /createAppInstanceForSubscription/);
  assert.match(instanceManagement, /workspaceId: subscription\.workspaceId/);
  assert.match(instanceManagement, /productId: subscription\.productId/);
});

test("customer purchase is primary while administrator recovery paths remain available", async () => {
  const [plans, purchasePage, adminSubscriptions, adminInstances] =
    await Promise.all([
      read("app/dashboard/plans/page.tsx"),
      read("app/dashboard/plans/[planId]/purchase/page.tsx"),
      read("app/admin/subscriptions/page.tsx"),
      read("app/admin/instances/page.tsx"),
    ]);

  assert.match(plans, /选择并配置|配置并购买/);
  assert.match(purchasePage, /CustomerPurchaseForm/);
  assert.match(purchasePage, /自动(?:创建|生成)/);
  assert.match(adminSubscriptions, /应急|补录|人工/);
  assert.match(adminInstances, /应急|补建|人工/);
});

test("AWS deployment remains an inspectable plan-only demo", async () => {
  const [example, instanceDetail, management, driver] = await Promise.all([
    read(".env.example"),
    read("app/admin/instances/[instanceId]/page.tsx"),
    read("lib/deployments/management.ts"),
    read("lib/deployments/drivers/aws-ecs-cell.ts"),
  ]);

  assert.match(example, /^AWS_REGION=/m);
  assert.match(example, /^AWS_DEFAULT_CELL_KEY=/m);
  assert.match(instanceDetail, /getLatestAppInstanceDeployment/);
  assert.match(instanceDetail, /plan_only|仅生成|部署计划/);
  assert.match(management, /status, desired_plan, plan_hash, idempotency_key/);
  assert.match(driver, /applyEnabled:\s*false/);
  assert.doesNotMatch(driver, /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/);
});

test("plan selection distinguishes the subscribed plan from other product plans", async () => {
  const plans = await read("app/dashboard/plans/page.tsx");

  assert.match(plans, /current\?\.planId === plan\.id/);
  assert.match(plans, /当前订阅套餐/);
  assert.match(plans, /未订阅此套餐/);
  assert.match(plans, /当前订阅的是 \{current\.planName\}/);
  assert.doesNotMatch(plans, />\s*已有当前订阅\s*</);
});
