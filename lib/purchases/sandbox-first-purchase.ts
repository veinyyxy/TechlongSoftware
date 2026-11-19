import { AwsEcsCellPlanOnlyDriver } from "../deployments/drivers/aws-ecs-cell.ts";
import { firstOnboardingExpressNames } from "../deployments/first-onboarding.ts";
import { canonicalJson } from "../deployments/execution/hash.ts";
import { stableId } from "../domain/ids.ts";
import { createStripeCheckoutSession, sha256Hex, verifyStripeWebhook, type StripeWebhookEvent } from "../payments/stripe.ts";
import { SANDBOX_PURCHASE_ENVIRONMENT, SANDBOX_PURCHASE_ORIGIN, SANDBOX_PURCHASE_PRODUCT,
  sandboxCheckoutSessionIdFromUrl, type SandboxPurchaseScope } from "./sandbox-first-purchase-config.ts";

export const SANDBOX_PURCHASE_SQL = {
  reserve: "SELECT sandbox_first_purchase.reserve(?, ?, ?, ?, ?, ?, ?, ?, ?) AS value",
  attach: "SELECT sandbox_first_purchase.attach(?, ?, ?, ?, ?) AS value",
  read: "SELECT sandbox_first_purchase.read_order(?, ?) AS value",
  webhookOrder: "SELECT sandbox_first_purchase.webhook_order($1) AS value",
  complete: "SELECT sandbox_first_purchase.complete($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS value",
} as const;
type Web = <T>(stmt: string, args: (string | number)[]) => Promise<T | null>;
type Webhook = Web;
export type SandboxPurchaseOrder = { orderId: string; status: string; amount: number; currency: string };
export async function sandboxPurchaseOrderId(workspaceId: string) {
  return stableId("ord", "sandbox-first-purchase:v1:" + workspaceId);
}

export async function startSandboxFirstCheckout(input: {
  scope: SandboxPurchaseScope; workspaceId: string; planId: string; testKey: string;
  actor: string; customerEmail: string; templateId: string; configuration: unknown;
  amount: number; currency: string; planName: string; planDescription: string; web: Web;
}) {
  if (input.workspaceId !== input.scope.workspaceId || input.planId !== input.scope.planId) return null;
  const orderId = await sandboxPurchaseOrderId(input.workspaceId);
  const r = await input.web<{ orderId: string; created: boolean; checkoutUrl?: string }>(SANDBOX_PURCHASE_SQL.reserve,
    [input.actor, input.workspaceId, input.planId, input.scope.releaseId, input.scope.imageUri,
      input.templateId, canonicalJson(input.configuration), input.amount, input.currency]);
  if (r?.orderId !== orderId) return null;
  if (!r.created) {
    // The database only returns an attached, unexpired checkout for this exact order.
    return r.checkoutUrl && sandboxCheckoutSessionIdFromUrl(r.checkoutUrl)
      ? { purchaseOrderId: orderId, checkoutUrl: r.checkoutUrl, reused: true } : null;
  }
  const resultUrl = SANDBOX_PURCHASE_ORIGIN + "/dashboard/billing/payment-result";
  const session = await createStripeCheckoutSession({
    checkoutId: orderId, metadataKey: "subscription_purchase_order_id", planName: input.planName,
    planDescription: input.planDescription, amount: input.amount, currency: input.currency, customerEmail: input.customerEmail,
    successUrl: resultUrl + "?order_id=" + orderId + "&session_id={CHECKOUT_SESSION_ID}",
    cancelUrl: resultUrl + "?order_id=" + orderId + "&status=cancelled",
  }, { testKey: input.testKey });
  if (session.expiresAt === null || !await input.web<boolean>(SANDBOX_PURCHASE_SQL.attach,
    [input.actor, orderId, session.id, session.url, session.expiresAt])) {
    // A lost or rejected attachment does not release the reservation for another checkout.
    throw Error("Sandbox checkout was not attached");
  }
  return { purchaseOrderId: orderId, checkoutUrl: session.url, reused: false };
}

export async function finishSandboxFirstCheckout(input: {
  scope: SandboxPurchaseScope; payload: string; signature: string | null; signingSecret: string; webhook: Webhook;
}) {
  const event = await verifyStripeWebhook(input.payload, input.signature, input.signingSecret);
  return finishVerifiedSandboxFirstCheckout({ ...input, event });
}

type SharedWebhookRoute =
  | { kind: "first-purchase"; event: StripeWebhookEvent }
  | { kind: "existing"; event: StripeWebhookEvent }
  | { kind: "ignored" }
  | { kind: "invalid" };

export async function authenticateSharedStripeWebhook(input: {
  workspaceId: string; payload: string; signature: string | null;
  sandboxSecret: string; existingSecret: string | null;
}): Promise<SharedWebhookRoute> {
  const verify = (secret: string) => verifyStripeWebhook(input.payload, input.signature, secret).catch(() => null);
  const reservedOrder = await sandboxPurchaseOrderId(input.workspaceId);
  const refersToReservedOrder = (event: StripeWebhookEvent) => {
    const object = event.data.object;
    const metadata = object.metadata as Record<string, unknown> | null | undefined;
    // Even one matching marker keeps a conflicting or incomplete event out of the old payment path.
    return metadata?.subscription_purchase_order_id === reservedOrder || object.client_reference_id === reservedOrder;
  };
  const sandboxEvent = await verify(input.sandboxSecret);
  if (sandboxEvent && refersToReservedOrder(sandboxEvent)) {
    return sandboxEvent.livemode === false ? { kind: "first-purchase", event: sandboxEvent } : { kind: "ignored" };
  }
  if (!input.existingSecret) return { kind: sandboxEvent ? "ignored" : "invalid" };
  const sameSecret = input.existingSecret === input.sandboxSecret;
  const existingEvent = sameSecret ? sandboxEvent : await verify(input.existingSecret);
  if (!existingEvent || refersToReservedOrder(existingEvent) || (sameSecret && existingEvent.livemode !== false)) {
    return { kind: "invalid" };
  }
  return { kind: "existing", event: existingEvent };
}

export async function finishVerifiedSandboxFirstCheckout(input: {
  scope: SandboxPurchaseScope; payload: string; event: StripeWebhookEvent; webhook: Webhook;
}) {
  const { event } = input;
  if (event.livemode !== false) return "ignored";
  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) return "ignored";
  const checkout = event.data.object;
  const orderId = await sandboxPurchaseOrderId(input.scope.workspaceId);
  const sessionId = checkout.id, intent = checkout.payment_intent, currency = checkout.currency, amount = checkout.amount_total;
  const metadata = checkout.metadata as Record<string, unknown> | null | undefined;
  if (checkout.livemode !== false || checkout.mode !== "payment" || checkout.payment_status !== "paid" ||
      checkout.status !== "complete" || metadata?.subscription_purchase_order_id !== orderId ||
      checkout.client_reference_id !== orderId || typeof sessionId !== "string" || !/^cs_test_[A-Za-z0-9]{1,200}$/.test(sessionId) ||
      typeof intent !== "string" || !/^pi_[A-Za-z0-9]{1,200}$/.test(intent) ||
      typeof currency !== "string" || !/^[a-z]{3}$/.test(currency) ||
      typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0 || amount > 2147483647) return "ignored";
  const r = await input.webhook<{ sessionId: string | null; templateId: string; status: string }>(SANDBOX_PURCHASE_SQL.webhookOrder, [orderId]);
  if (!r || (r.sessionId && r.sessionId !== sessionId)) return "ignored";
  // Stripe can deliver before the browser request finishes persisting its session.
  // Do not acknowledge this as processed; no new application-side checkout retry.
  if (!r.sessionId || !["checkout_pending", "paid"].includes(r.status)) throw Error("Sandbox checkout not attached");
  const [instance, subscription] = await Promise.all([stableId("app", orderId), stableId("sub", orderId)]);
  const scope = { appInstanceId: instance, workspaceId: input.scope.workspaceId, productId: SANDBOX_PURCHASE_PRODUCT,
    environmentId: SANDBOX_PURCHASE_ENVIRONMENT, cellKey: "cell-sandbox-1" };
  const desired = new AwsEcsCellPlanOnlyDriver({ mode: "aws_sandbox", region: "ca-central-1", cellKey: scope.cellKey }).buildPlan({
    ...scope, planId: input.scope.planId, subscriptionId: subscription, tenantKey: "pending_" + instance,
    deploymentProfileKey: "standard-v1",
  });
  const { databaseName, roleName } = await firstOnboardingExpressNames(scope);
  Object.assign(desired.resources.tenant.database, { databaseName, roleName });
  const outcome = await input.webhook<string>(SANDBOX_PURCHASE_SQL.complete,
    [event.id, event.type, orderId, sessionId, intent, amount, currency, await sha256Hex(input.payload),
      canonicalJson(desired), input.scope.releaseId, input.scope.imageUri]);
  if (outcome !== "accepted" && outcome !== "duplicate" && outcome !== "ignored") throw Error("Sandbox completion not proved");
  return outcome;
}
