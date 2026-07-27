import assert from "node:assert/strict";
import test from "node:test";
import {
  canActivateAppInstance,
  isAppInstanceStatus,
  validateAppInstanceInput,
} from "../lib/instances/validation.ts";

test("validates an application instance with a stored HTTP access URL", () => {
  const valid = validateAppInstanceInput({
    workspaceId: "wsp_one",
    productId: "prd_restaurant_order_system",
    subscriptionId: "sub_one",
    name: " Northshore Orders ",
    slug: "Northshore-Orders",
    domain: "orders.example.com",
    accessUrl: "https://orders.example.com/admin",
    tenantKey: "Northshore_01",
    status: "pending",
  });

  assert.deepEqual(valid.errors, {});
  assert.equal(valid.data?.slug, "northshore-orders");
  assert.equal(valid.data?.tenantKey, "northshore_01");
  assert.equal(valid.data?.accessUrl, "https://orders.example.com/admin");
});

test("rejects invalid instance identifiers and unsafe access addresses", () => {
  const invalid = validateAppInstanceInput({
    workspaceId: "",
    productId: "",
    name: "x",
    slug: "North shore",
    domain: "orders example.com",
    accessUrl: "javascript:alert(1)",
    tenantKey: "A",
    status: "provisioning",
  });

  assert.equal(invalid.data, null);
  assert.ok(invalid.errors.workspaceId);
  assert.ok(invalid.errors.productId);
  assert.ok(invalid.errors.name);
  assert.ok(invalid.errors.slug);
  assert.ok(invalid.errors.domain);
  assert.ok(invalid.errors.accessUrl);
  assert.ok(invalid.errors.tenantKey);
  assert.ok(invalid.errors.status);
});

test("only active subscriptions may activate application instances", () => {
  assert.equal(isAppInstanceStatus("active"), true);
  assert.equal(isAppInstanceStatus("provisioning"), false);
  assert.equal(canActivateAppInstance("active"), true);
  assert.equal(canActivateAppInstance("past_due"), false);
  assert.equal(canActivateAppInstance(null), false);
});

test("permits a pending instance without an entry URL but never activates it without one", () => {
  const pending = validateAppInstanceInput({
    workspaceId: "wsp_one",
    productId: "prd_restaurant_order_system",
    subscriptionId: "sub_one",
    name: "Northshore Orders",
    slug: "northshore-orders",
    domain: "",
    accessUrl: "",
    tenantKey: "northshore_pending",
    status: "pending",
  });
  assert.deepEqual(pending.errors, {});
  assert.equal(pending.data?.accessUrl, "");

  const active = validateAppInstanceInput({
    ...pending.data,
    status: "active",
  });
  assert.equal(active.data, null);
  assert.ok(active.errors.accessUrl);
});
