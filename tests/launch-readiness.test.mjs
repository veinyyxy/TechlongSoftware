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

test("README documents startup, hosted admin initialization, and launch scope", async () => {
  const readme = await read("README.md");
  assert.match(readme, /PLATFORM_ADMIN_EMAILS/);
  assert.match(readme, /ChatGPT 登录/);
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
  assert.match(templateVersionForm, /source=customer/);
  assert.match(planForm, /templateVersionId/);
  assert.match(planForm, /应用实例模板参数/);
  assert.match(planForm, /templateParameter\.\$\{field\.key\}/);
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
