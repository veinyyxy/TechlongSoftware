import assert from "node:assert/strict";
import test from "node:test";
import {
  isPaymentStatus,
  isSubscriptionStatus,
  validatePaymentInput,
  validateSubscriptionInput,
} from "../lib/billing/validation.ts";

test("validates a manual subscription period and supported status", () => {
  const valid = validateSubscriptionInput({
    workspaceId: "wsp_one",
    planId: "pln_basic",
    status: "manual_pending",
    currentPeriodStart: Date.UTC(2026, 0, 1),
    currentPeriodEnd: Date.UTC(2026, 1, 1),
    cancelAtPeriodEnd: false,
  });

  assert.equal(valid.data?.workspaceId, "wsp_one");
  assert.equal(valid.data?.status, "manual_pending");

  const invalid = validateSubscriptionInput({
    workspaceId: "",
    planId: "",
    status: "trialing",
    currentPeriodStart: Date.UTC(2026, 1, 1),
    currentPeriodEnd: Date.UTC(2026, 0, 1),
    cancelAtPeriodEnd: "no",
  });

  assert.equal(invalid.data, null);
  assert.ok(invalid.errors.workspaceId);
  assert.ok(invalid.errors.planId);
  assert.ok(invalid.errors.status);
  assert.ok(invalid.errors.currentPeriodEnd);
  assert.ok(invalid.errors.cancelAtPeriodEnd);
});

test("stores manual payment amounts as integer minor currency units", () => {
  const valid = validatePaymentInput({
    workspaceId: "wsp_one",
    subscriptionId: "sub_one",
    amount: 4900,
    currency: "cad",
    status: "paid",
    paidAt: Date.UTC(2026, 0, 2),
    paymentMethod: " Bank transfer ",
    reference: " BANK-001 ",
    note: " Recorded by an administrator ",
  });

  assert.equal(valid.data?.amount, 4900);
  assert.equal(valid.data?.currency, "CAD");
  assert.equal(valid.data?.paymentMethod, "Bank transfer");

  const invalid = validatePaymentInput({
    workspaceId: "wsp_one",
    amount: 49.5,
    currency: "C",
    status: "paid",
    paymentMethod: "",
  });

  assert.equal(invalid.data, null);
  assert.ok(invalid.errors.amount);
  assert.ok(invalid.errors.currency);
  assert.ok(invalid.errors.paidAt);
  assert.ok(invalid.errors.paymentMethod);
});

test("accepts supported manual and online payment statuses", () => {
  assert.equal(isSubscriptionStatus("paused"), true);
  assert.equal(isSubscriptionStatus("trialing"), false);
  assert.equal(isPaymentStatus("failed"), true);
  assert.equal(isPaymentStatus("canceled"), true);
  assert.equal(isPaymentStatus("refunded"), false);
});
