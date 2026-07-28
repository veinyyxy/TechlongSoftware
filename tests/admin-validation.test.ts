import assert from "node:assert/strict";
import test from "node:test";
import {
  isPlanStatus,
  isWorkspaceStatus,
  validateCustomerInput,
  validatePlanInput,
} from "../lib/admin/validation.ts";

test("accepts normalized customer input and rejects invalid email", () => {
  const valid = validateCustomerInput({
    name: " 北岸餐饮 ",
    contactName: " Ethan Yang ",
    contactEmail: " OWNER@EXAMPLE.COM ",
  });
  assert.deepEqual(valid.data, {
    name: "北岸餐饮",
    contactName: "Ethan Yang",
    contactEmail: "owner@example.com",
  });

  const invalid = validateCustomerInput({
    name: "A",
    contactName: "",
    contactEmail: "not-an-email",
  });
  assert.equal(invalid.data, null);
  assert.ok(invalid.errors.name);
  assert.ok(invalid.errors.contactEmail);
});

test("validates database-backed plan fields without floating point prices", () => {
  const valid = validatePlanInput({
    name: "Basic",
    description: "单店套餐",
    priceAmount: 4900,
    currency: "cad",
    billingInterval: "month",
    features: ["订单管理", "菜单配置"],
    limits: { 门店数: "1", 成员数: "5" },
  });
  assert.equal(valid.data?.currency, "CAD");
  assert.equal(valid.data?.priceAmount, 4900);
  assert.deepEqual(valid.data?.features, ["订单管理", "菜单配置"]);

  const invalid = validatePlanInput({
    name: "",
    description: "",
    priceAmount: 49.5,
    currency: "C",
    billingInterval: "weekly",
    features: "hard-coded",
    limits: {},
  });
  assert.equal(invalid.data, null);
  assert.ok(invalid.errors.priceAmount);
  assert.ok(invalid.errors.billingInterval);
  assert.ok(invalid.errors.features);
});

test("accepts only supported customer and plan status values", () => {
  assert.equal(isWorkspaceStatus("suspended"), true);
  assert.equal(isWorkspaceStatus("deleted"), false);
  assert.equal(isPlanStatus("inactive"), true);
  assert.equal(isPlanStatus("archived"), false);
});
