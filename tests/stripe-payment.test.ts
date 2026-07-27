import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateCheckoutInput } from "../lib/payments/validation.ts";
import { verifyStripeWebhook } from "../lib/payments/stripe.ts";

test("validates a customer checkout request without accepting amount or payment status", () => {
  const valid = validateCheckoutInput({
    planId: "pln_monthly",
    amount: 1,
    status: "paid",
  });
  assert.deepEqual(valid.data, { planId: "pln_monthly" });

  const invalid = validateCheckoutInput({ planId: "" });
  assert.equal(invalid.data, null);
  assert.ok(invalid.errors.planId);
});

test("accepts a correctly signed Stripe webhook and rejects a forged one", async () => {
  const secret = "whsec_test_secret";
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    id: "evt_checkout_completed",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_123",
        payment_status: "paid",
        metadata: { payment_checkout_id: "chk_123" },
      },
    },
  });
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  const event = await verifyStripeWebhook(
    payload,
    `t=${timestamp},v1=${signature}`,
    secret,
  );
  assert.equal(event.id, "evt_checkout_completed");

  await assert.rejects(
    verifyStripeWebhook(payload, `t=${timestamp},v1=${"0".repeat(64)}`, secret),
  );
});

test("keeps Stripe checkout authority on the server and verifies raw webhook payloads", async () => {
  const root = new URL("../", import.meta.url);
  const [checkoutRoute, webhookRoute, checkoutButton] = await Promise.all([
    readFile(new URL("app/api/workspaces/[workspaceId]/checkout/route.ts", root), "utf8"),
    readFile(new URL("app/api/stripe/webhook/route.ts", root), "utf8"),
    readFile(new URL("components/billing/CheckoutPlanButton.tsx", root), "utf8"),
  ]);

  assert.match(checkoutRoute, /createPaymentCheckout/);
  assert.match(checkoutRoute, /account\.membership\.role !== "owner"/);
  assert.match(checkoutButton, /JSON\.stringify\(\{ planId \}\)/);
  assert.doesNotMatch(checkoutButton, /amount|priceAmount|paymentStatus/);
  assert.match(webhookRoute, /request\.text\(\)/);
  assert.match(webhookRoute, /verifyStripeWebhook/);
  assert.match(webhookRoute, /processStripeWebhookEvent/);
});

test("creates only a pending restaurant instance from the verified payment completion path", async () => {
  const root = new URL("../", import.meta.url);
  const [paymentManagement, instanceManagement] = await Promise.all([
    readFile(new URL("lib/payments/management.ts", root), "utf8"),
    readFile(new URL("lib/instances/management.ts", root), "utf8"),
  ]);

  assert.match(paymentManagement, /preparePendingRestaurantAppInstance/);
  assert.match(paymentManagement, /syncWorkspaceAppInstanceStatusStatement/);
  assert.match(paymentManagement, /pendingInstanceStatement/);
  assert.match(instanceManagement, /restaurant-order-system/);
  assert.match(instanceManagement, /provisioning_source/);
  assert.match(instanceManagement, /'payment_success', 'pending'/);
  assert.match(instanceManagement, /WHERE workspace_id = \? AND product_id = \?/);
  assert.doesNotMatch(instanceManagement, /'payment_success', 'active'/);
});
