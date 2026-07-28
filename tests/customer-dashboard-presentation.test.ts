import assert from "node:assert/strict";
import test from "node:test";
import {
  canEnterCustomerApplication,
  getCustomerServiceNotice,
  hasRecordedAccessUrl,
  selectCurrentProductSubscription,
} from "../lib/customer-dashboard/presentation.ts";

const now = Date.UTC(2026, 6, 27);

function service(input: Partial<Parameters<typeof getCustomerServiceNotice>[0]>) {
  return getCustomerServiceNotice(
    {
      productName: "餐饮订单系统",
      subscriptionStatus: "active",
      currentPeriodEnd: now + 86_400_000,
      latestPaymentStatus: null,
      appInstanceStatus: "pending",
      accessUrl: "https://orders.example.com",
      ...input,
    },
    now,
  );
}

test("shows the required customer service messages for subscription and application states", () => {
  assert.equal(
    service({ subscriptionStatus: "manual_pending" }).message,
    "平台已为您设置待付款订阅。请确认套餐选项并完成付款，付款确认后将为您开通餐饮订单系统。",
  );
  assert.equal(
    service({ latestPaymentStatus: "paid", appInstanceStatus: "pending" }).message,
    "您的付款已确认，系统正在开通中。",
  );
  assert.equal(
    service({ appInstanceStatus: "active" }).message,
    "您的餐饮订单系统已开通。",
  );
  assert.equal(
    service({ subscriptionStatus: "past_due" }).message,
    "您的订阅状态异常，请联系平台管理员。",
  );
  assert.equal(
    service({ currentPeriodEnd: now - 1, appInstanceStatus: "active" }).message,
    "您的订阅状态异常，请联系平台管理员。",
  );
  assert.equal(
    service({ appInstanceStatus: "suspended" }).message,
    "您的餐饮订单系统当前已暂停。",
  );
  assert.equal(
    service({ appInstanceStatus: "failed" }).message,
    "开通失败，请联系平台管理员。",
  );
  assert.equal(
    service({ appInstanceStatus: null }).message,
    "您的餐饮订单系统尚未开通。",
  );
});

test("selects the requested current product subscription with a generic fallback", () => {
  const subscriptions = [
    {
      id: "sub_restaurant",
      productId: "prd_restaurant",
      productName: "餐饮订单系统",
    },
    {
      id: "sub_inventory",
      productId: "prd_inventory",
      productName: "库存管理系统",
    },
  ];

  assert.equal(
    selectCurrentProductSubscription(subscriptions, "prd_inventory")?.id,
    "sub_inventory",
  );
  assert.equal(
    selectCurrentProductSubscription(subscriptions, "missing")?.id,
    "sub_restaurant",
  );
  assert.equal(selectCurrentProductSubscription([], "prd_inventory"), null);
});

test("uses the selected product name instead of hardcoding the restaurant product", () => {
  assert.equal(
    service({
      productName: "库存管理系统",
      appInstanceStatus: "active",
    }).message,
    "您的库存管理系统已开通。",
  );
  assert.equal(
    service({
      productName: "库存管理系统",
      appInstanceStatus: null,
    }).message,
    "您的库存管理系统尚未开通。",
  );
});

test("only exposes an application entry when subscription, instance, period, and URL are valid", () => {
  const eligible = {
    subscriptionStatus: "active" as const,
    currentPeriodEnd: now + 86_400_000,
    appInstanceStatus: "active" as const,
    accessUrl: "https://orders.example.com",
  };

  assert.equal(hasRecordedAccessUrl(eligible.accessUrl), true);
  assert.equal(hasRecordedAccessUrl(""), false);
  assert.equal(hasRecordedAccessUrl("javascript:alert(1)"), false);
  assert.equal(canEnterCustomerApplication(eligible, now), true);
  assert.equal(
    canEnterCustomerApplication({ ...eligible, currentPeriodEnd: now - 1 }, now),
    false,
  );
  assert.equal(
    canEnterCustomerApplication({ ...eligible, appInstanceStatus: "suspended" }, now),
    false,
  );
  assert.equal(
    canEnterCustomerApplication({ ...eligible, accessUrl: "" }, now),
    false,
  );
});
