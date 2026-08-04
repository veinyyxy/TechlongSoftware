import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateCheckoutInput } from "../lib/payments/validation.ts";
import { verifyStripeWebhook } from "../lib/payments/stripe.ts";
import { validateCustomerPurchaseInput } from "../lib/purchases/validation.ts";

test("validates a configured subscription checkout without accepting a client price or plan", () => {
  const valid = validateCheckoutInput({
    subscriptionId: "sub_monthly",
    planId: "forged_plan",
    amount: 1,
    status: "paid",
  });
  assert.deepEqual(valid.data, { subscriptionId: "sub_monthly" });

  const invalid = validateCheckoutInput({ subscriptionId: "" });
  assert.equal(invalid.data, null);
  assert.ok(invalid.errors.subscriptionId);
});

test("accepts customer configuration without trusting a client price or payment status", () => {
  const valid = validateCustomerPurchaseInput({
    planId: "pln_customer",
    renewalSubscriptionId: null,
    instanceConfiguration: {
      storeName: "示例餐厅",
      theme: "warm",
      visitorLimit: 100,
      storesMax: null,
      customTheme: false,
    },
    amount: 1,
    paymentStatus: "paid",
  });
  assert.deepEqual(valid.data, {
    planId: "pln_customer",
    renewalSubscriptionId: null,
    instanceConfiguration: {
      storeName: "示例餐厅",
      theme: "warm",
      visitorLimit: 100,
      storesMax: null,
      customTheme: false,
    },
  });
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
  const [checkoutRoute, webhookRoute, checkoutButton, paymentManagement, stripeGateway] = await Promise.all([
    readFile(new URL("app/api/workspaces/[workspaceId]/checkout/route.ts", root), "utf8"),
    readFile(new URL("app/api/stripe/webhook/route.ts", root), "utf8"),
    readFile(new URL("components/billing/CheckoutSubscriptionButton.tsx", root), "utf8"),
    readFile(new URL("lib/payments/management.ts", root), "utf8"),
    readFile(new URL("lib/payments/stripe.ts", root), "utf8"),
  ]);

  assert.match(checkoutRoute, /createPaymentCheckout/);
  assert.match(checkoutRoute, /account\.membership\.role !== "owner"/);
  assert.match(checkoutButton, /JSON\.stringify\(\{ subscriptionId \}\)/);
  assert.doesNotMatch(checkoutButton, /amount|priceAmount|paymentStatus|planId/);
  assert.match(paymentManagement, /getSubscription\(input\.subscriptionId\)/);
  assert.match(paymentManagement, /getWorkspaceProductCurrentSubscription/);
  assert.match(paymentManagement, /currentSubscription\.id !== subscription\.id/);
  assert.match(paymentManagement, /subscription\.status !== "manual_pending"/);
  assert.match(paymentManagement, /subscription\.productStatus !== "active"/);
  assert.match(paymentManagement, /plan\.productId !== productId/);
  assert.match(paymentManagement, /PLAN_PRODUCT_MISMATCH/);
  assert.match(
    paymentManagement,
    /p\.id = cs\.plan_id AND p\.product_id = s\.product_id/,
  );
  assert.match(paymentManagement, /subscription_id/);
  assert.match(paymentManagement, /cs\.status IN \('creating', 'open'\)/);
  assert.match(paymentManagement, /getReusableOpenCheckout\(\s*input\.workspaceId,\s*subscription\.id/);
  assert.doesNotMatch(paymentManagement, /SELECT id, status FROM subscriptions WHERE workspace_id = \? LIMIT 1/);
  assert.match(paymentManagement, /staleClaimBefore/);
  assert.match(paymentManagement, /WHERE id = \? AND status <> 'paid'/);
  assert.match(paymentManagement, /WHERE id = \? AND status <> 'completed'/);
  assert.match(paymentManagement, /reconcilePaymentCheckoutFromStripe/);
  assert.match(paymentManagement, /retrieveStripeCheckoutSession/);
  assert.match(paymentManagement, /session\.paymentStatus === "paid"/);
  assert.match(stripeGateway, /checkout\/sessions\/\$\{encodeURIComponent\(sessionId\)\}/);
  assert.match(stripeGateway, /"idempotency-key": `checkout_\$\{input\.checkoutId\}`/);
  assert.match(webhookRoute, /request\.text\(\)/);
  assert.match(webhookRoute, /verifyStripeWebhook/);
  assert.match(webhookRoute, /processStripeWebhookEvent/);
});

test("creates one pending instance snapshot from the verified payment completion path", async () => {
  const root = new URL("../", import.meta.url);
  const [paymentManagement, instanceManagement] = await Promise.all([
    readFile(new URL("lib/payments/management.ts", root), "utf8"),
    readFile(new URL("lib/instances/management.ts", root), "utf8"),
  ]);

  assert.match(paymentManagement, /preparePendingAppInstance/);
  assert.match(paymentManagement, /productId: confirmedSubscription\.productId/);
  assert.match(paymentManagement, /templateVersionId: confirmedSubscription\.templateVersionId/);
  assert.match(paymentManagement, /configurationSnapshot: confirmedSubscription\.instanceConfiguration/);
  assert.match(paymentManagement, /syncWorkspaceAppInstanceStatusStatement/);
  assert.match(paymentManagement, /pendingInstanceStatement/);
  assert.match(instanceManagement, /provisioning_source/);
  assert.match(instanceManagement, /'payment_success', 'pending'/);
  assert.match(instanceManagement, /WHERE workspace_id = \? AND product_id = \?/);
  assert.match(instanceManagement, /if \(existing\) \{\s*return null;/);
  assert.match(instanceManagement, /configuration_snapshot/);
  assert.match(instanceManagement, /JSON\.stringify\(input\.configurationSnapshot\)/);
  assert.doesNotMatch(instanceManagement, /'payment_success', 'active'/);
});

test("customer purchase orders create subscriptions only after verified Stripe completion", async () => {
  const root = new URL("../", import.meta.url);
  const [
    purchaseRoute,
    purchaseManagement,
    purchaseForm,
    billingManagement,
    themeEditor,
    themeFields,
  ] = await Promise.all([
    readFile(
      new URL(
        "app/api/workspaces/[workspaceId]/purchase-orders/route.ts",
        root,
      ),
      "utf8",
    ),
    readFile(new URL("lib/purchases/management.ts", root), "utf8"),
    readFile(
      new URL("components/billing/CustomerPurchaseForm.tsx", root),
      "utf8",
    ),
    readFile(new URL("lib/billing/management.ts", root), "utf8"),
    readFile(
      new URL("components/billing/ThemeConfigurationEditor.tsx", root),
      "utf8",
    ),
    readFile(new URL("lib/templates/theme-fields.ts", root), "utf8"),
  ]);

  assert.match(purchaseRoute, /account\.membership\.role !== "owner"/);
  assert.match(purchaseRoute, /createCustomerPurchaseCheckout/);
  assert.doesNotMatch(purchaseForm, /priceAmount|paymentStatus/);
  assert.match(purchaseForm, /partitionTemplateFields/);
  assert.match(purchaseForm, /ThemeConfigurationEditor/);
  assert.match(purchaseForm, /if \(!renewalSubscriptionId\)/);
  assert.doesNotMatch(purchaseForm, /buyerThemePrimary|merchantThemePrimary/);
  assert.match(themeEditor, /type="color"/);
  assert.match(themeEditor, /instanceConfiguration\.\$\{field\.key\}/);
  assert.match(themeEditor, /theme-preview-extra-colors/);
  assert.match(themeEditor, /浅色（Light）/);
  assert.match(themeEditor, /深色（Dark）/);
  assert.match(themeFields, /buyer_theme\|merchant_theme/);
  assert.match(
    purchaseManagement,
    /const plan = await getPlan\(input\.purchase\.planId\)/,
  );
  assert.match(purchaseManagement, /resolveTemplateConfiguration/);
  assert.match(purchaseManagement, /subscription_purchase_order_id/);
  assert.match(purchaseManagement, /assertStripeAmountMatches/);
  assert.match(purchaseManagement, /creation_source/);
  assert.match(purchaseManagement, /'customer_checkout'/);
  assert.match(purchaseManagement, /preparePendingAppInstance/);
  assert.match(
    purchaseManagement,
    /upsertWorkspaceProductEntitlementStatement/,
  );
  assert.match(
    billingManagement,
    /setCustomerSubscriptionCancelAtPeriodEnd/,
  );
});
