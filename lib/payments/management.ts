import { getD1 } from "@/db";
import { ManagementError, getPlan, type BillingInterval, type PlanView } from "@/lib/admin/management";
import {
  getSubscription,
  getWorkspaceProductCurrentSubscription,
  syncWorkspaceSubscriptionSummaryStatement,
  type PaymentStatus,
  type SubscriptionStatus,
} from "@/lib/billing/management";
import { randomId } from "@/lib/domain/ids";
import {
  preparePendingAppInstance,
  syncWorkspaceAppInstanceStatusStatement,
} from "@/lib/instances/management";
import {
  createStripeCheckoutSession,
  type StripeWebhookEvent,
} from "./stripe";

export type CheckoutStatus =
  | "creating"
  | "open"
  | "completed"
  | "failed"
  | "canceled"
  | "expired";

export interface PaymentCheckoutView {
  id: string;
  workspaceId: string;
  subscriptionId: string;
  subscriptionStatus: SubscriptionStatus;
  productId: string;
  productName: string;
  planId: string;
  planName: string;
  amount: number;
  currency: string;
  paymentStatus: PaymentStatus;
  status: CheckoutStatus;
  providerSessionId: string | null;
  checkoutUrl: string | null;
  failureReason: string | null;
  attentionNote: string | null;
  expiresAt: number | null;
  completedAt: number | null;
  createdAt: number;
}

interface CheckoutRow {
  id: string;
  workspace_id: string;
  subscription_id: string;
  subscription_status: SubscriptionStatus;
  product_id: string;
  product_name: string;
  plan_id: string;
  plan_name: string;
  amount: number;
  currency: string;
  payment_status: PaymentStatus;
  status: CheckoutStatus;
  provider_session_id: string | null;
  provider_payment_id: string | null;
  checkout_url: string | null;
  failure_reason: string | null;
  payment_note: string | null;
  expires_at: number | null;
  completed_at: number | null;
  created_at: number;
  payment_record_id: string;
  initiated_by_user_id: string;
  billing_interval: BillingInterval;
}

const checkoutSelect = `
  SELECT
    cs.id, cs.workspace_id, cs.subscription_id, s.status AS subscription_status,
    s.product_id,
    product.name AS product_name, cs.plan_id, p.name AS plan_name,
    pr.amount, pr.currency, pr.status AS payment_status, cs.status,
    cs.provider_session_id, cs.provider_payment_id, cs.checkout_url,
    pr.failure_reason, pr.note AS payment_note, cs.expires_at,
    cs.completed_at, cs.created_at,
    cs.payment_record_id, cs.initiated_by_user_id, p.billing_interval
  FROM payment_checkout_sessions cs
  INNER JOIN subscriptions s ON s.id = cs.subscription_id
  INNER JOIN plans p ON p.id = cs.plan_id AND p.product_id = s.product_id
  INNER JOIN payment_records pr ON pr.id = cs.payment_record_id
  INNER JOIN products product ON product.id = s.product_id`;

function toCheckoutView(row: CheckoutRow): PaymentCheckoutView {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    subscriptionId: row.subscription_id,
    subscriptionStatus: row.subscription_status,
    productId: row.product_id,
    productName: row.product_name,
    planId: row.plan_id,
    planName: row.plan_name,
    amount: Number(row.amount),
    currency: row.currency,
    paymentStatus: row.payment_status,
    status: row.status,
    providerSessionId: row.provider_session_id,
    checkoutUrl: row.checkout_url,
    failureReason: row.failure_reason,
    attentionNote: row.payment_note,
    expiresAt: row.expires_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

async function getCheckoutRow(checkoutId: string): Promise<CheckoutRow | null> {
  return getD1()
    .prepare(`${checkoutSelect} WHERE cs.id = ? LIMIT 1`)
    .bind(checkoutId)
    .first<CheckoutRow>();
}

export async function getPaymentCheckout(
  workspaceId: string,
  checkoutId: string,
): Promise<PaymentCheckoutView | null> {
  const row = await getD1()
    .prepare(`${checkoutSelect} WHERE cs.id = ? AND cs.workspace_id = ? LIMIT 1`)
    .bind(checkoutId, workspaceId)
    .first<CheckoutRow>();
  return row ? toCheckoutView(row) : null;
}

export async function createPaymentCheckout(input: {
  workspaceId: string;
  subscriptionId: string;
  initiatedByUserId: string;
  customerEmail: string;
  origin: string;
}): Promise<{ checkout: PaymentCheckoutView; checkoutUrl: string; reused: boolean }> {
  const subscription = await getSubscription(input.subscriptionId);
  if (!subscription || subscription.workspaceId !== input.workspaceId) {
    throw new ManagementError(
      "SUBSCRIPTION_NOT_FOUND",
      "没有找到平台为当前工作区配置的订阅。",
      404,
    );
  }
  const currentSubscription = await getWorkspaceProductCurrentSubscription(
    input.workspaceId,
    subscription.productId,
  );
  if (!currentSubscription || currentSubscription.id !== subscription.id) {
    throw new ManagementError(
      "SUBSCRIPTION_NOT_CURRENT",
      "这条订阅已经结束或已被新订阅替代，不能再发起付款。",
      409,
    );
  }
  if (
    subscription.status !== "manual_pending" &&
    subscription.status !== "past_due"
  ) {
    throw new ManagementError(
      "SUBSCRIPTION_NOT_PAYABLE",
      "当前订阅不是待付款状态，请联系平台管理员确认订阅设置。",
      409,
    );
  }
  if (subscription.productStatus !== "active") {
    throw new ManagementError(
      "PRODUCT_NOT_AVAILABLE",
      "当前订阅产品已停用，不能发起在线付款。",
      409,
    );
  }
  const plan = await getPlan(subscription.planId);
  assertPurchasablePlan(plan, subscription.productId);
  await assertActiveWorkspace(input.workspaceId);

  const reusable = await getReusableOpenCheckout(
    input.workspaceId,
    subscription.id,
  );
  if (reusable) {
    if (reusable.plan_id !== subscription.planId || !reusable.checkout_url) {
      throw new ManagementError(
        "CHECKOUT_ALREADY_OPEN",
        "当前工作区已有一笔待完成的在线付款，请先完成或取消该付款。",
        409,
      );
    }
    const checkout = await getPaymentCheckout(input.workspaceId, reusable.id);
    if (!checkout) throw new ManagementError("CHECKOUT_NOT_FOUND", "没有找到付款会话。", 404);
    return { checkout, checkoutUrl: reusable.checkout_url, reused: true };
  }

  const checkoutId = randomId("chk");
  const paymentRecordId = randomId("pay");
  const now = Date.now();
  const reservationExpiresAt = now + 10 * 60 * 1000;
  const db = getD1();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO payment_records (
            id, workspace_id, subscription_id, amount, currency, status, paid_at,
            payment_method, provider, provider_payment_id, provider_event_id,
            reference, note, failure_reason, recorded_by_user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, 'Stripe Checkout', 'stripe',
            NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
        )
        .bind(
          paymentRecordId,
          input.workspaceId,
          subscription.id,
          plan.priceAmount,
          plan.currency,
          input.initiatedByUserId,
          now,
          now,
        ),
      db
        .prepare(
          `INSERT INTO payment_checkout_sessions (
            id, workspace_id, subscription_id, plan_id, payment_record_id,
            initiated_by_user_id, provider, status, expires_at, created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'stripe', 'creating', ?, ?, ?)`,
        )
        .bind(
          checkoutId,
          input.workspaceId,
          subscription.id,
          subscription.planId,
          paymentRecordId,
          input.initiatedByUserId,
          reservationExpiresAt,
          now,
          now,
        ),
    ]);
  } catch {
    throw new ManagementError(
      "CHECKOUT_ALREADY_OPEN",
      "这条订阅已有一笔正在创建或等待完成的在线付款，请稍后重试。",
      409,
    );
  }

  const resultUrl = `${input.origin}/dashboard/billing/payment-result`;
  try {
    const stripeSession = await createStripeCheckoutSession({
      checkoutId,
      planName: plan.name,
      planDescription: plan.description,
      amount: plan.priceAmount,
      currency: plan.currency,
      customerEmail: input.customerEmail,
      successUrl: `${resultUrl}?checkout_id=${encodeURIComponent(checkoutId)}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${resultUrl}?checkout_id=${encodeURIComponent(checkoutId)}&status=cancelled`,
    });
    await db.batch([
      db
        .prepare(
          `UPDATE payment_checkout_sessions
           SET provider_session_id = ?, checkout_url = ?, status = 'open',
               expires_at = ?, updated_at = ?
           WHERE id = ? AND status = 'creating'`,
        )
        .bind(stripeSession.id, stripeSession.url, stripeSession.expiresAt, Date.now(), checkoutId),
      db
        .prepare(
          "UPDATE payment_records SET reference = ?, updated_at = ? WHERE id = ?",
        )
        .bind(stripeSession.id, Date.now(), paymentRecordId),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "无法创建在线支付页面。";
    await db.batch([
      db
        .prepare(
          `UPDATE payment_checkout_sessions
           SET status = 'failed', updated_at = ?
           WHERE id = ? AND status = 'creating'`,
        )
        .bind(Date.now(), checkoutId),
      db
        .prepare(
          `UPDATE payment_records
           SET status = 'failed', failure_reason = ?, updated_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .bind(message, Date.now(), paymentRecordId),
    ]);
    throw error;
  }

  const checkout = await getPaymentCheckout(input.workspaceId, checkoutId);
  if (!checkout?.checkoutUrl) {
    throw new ManagementError("CHECKOUT_CREATE_FAILED", "无法创建在线支付页面。", 500);
  }
  return { checkout, checkoutUrl: checkout.checkoutUrl, reused: false };
}

export async function cancelPaymentCheckout(
  workspaceId: string,
  checkoutId: string,
): Promise<PaymentCheckoutView | null> {
  const checkout = await getCheckoutRow(checkoutId);
  if (!checkout || checkout.workspace_id !== workspaceId) return null;
  if (checkout.status === "completed" || checkout.payment_status === "paid") {
    return toCheckoutView(checkout);
  }
  const now = Date.now();
  await getD1().batch([
    getD1()
      .prepare(
        `UPDATE payment_checkout_sessions
         SET status = 'canceled', updated_at = ?
         WHERE id = ? AND status IN ('creating', 'open')`,
      )
      .bind(now, checkoutId),
    getD1()
      .prepare(
        `UPDATE payment_records
         SET status = 'canceled', failure_reason = '客户取消了 Stripe Checkout 付款。', updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .bind(now, checkout.payment_record_id),
  ]);
  return getPaymentCheckout(workspaceId, checkoutId);
}

export async function processStripeWebhookEvent(input: {
  event: StripeWebhookEvent;
  payloadHash: string;
}): Promise<{ duplicate: boolean; handled: boolean }> {
  const claimedAt = Date.now();
  const staleClaimBefore = claimedAt - 5 * 60 * 1000;
  const existing = await getD1()
    .prepare(
      `SELECT id, processing_status, received_at
       FROM payment_webhook_events
       WHERE provider = 'stripe' AND provider_event_id = ?
       LIMIT 1`,
    )
    .bind(input.event.id)
    .first<{ id: string; processing_status: string; received_at: number }>();

  if (existing?.processing_status === "processed" || existing?.processing_status === "ignored") {
    return { duplicate: true, handled: false };
  }

  const eventId = existing?.id ?? randomId("evt");
  if (existing) {
    if (
      existing.processing_status === "pending" &&
      existing.received_at > staleClaimBefore
    ) {
      return { duplicate: true, handled: false };
    }
    const claim = await getD1()
      .prepare(
        `UPDATE payment_webhook_events
         SET event_type = ?, payload_hash = ?, processing_status = 'pending',
             received_at = ?, processed_at = NULL, last_error = NULL
         WHERE id = ?
           AND (
             processing_status = 'failed'
             OR (processing_status = 'pending' AND received_at <= ?)
           )`,
      )
      .bind(
        input.event.type,
        input.payloadHash,
        claimedAt,
        eventId,
        staleClaimBefore,
      )
      .run();
    if (!claim.meta.changes) {
      return { duplicate: true, handled: false };
    }
  } else {
    try {
      await getD1()
        .prepare(
          `INSERT INTO payment_webhook_events (
            id, provider, provider_event_id, event_type, payload_hash,
            processing_status, received_at
          ) VALUES (?, 'stripe', ?, ?, ?, 'pending', ?)`,
        )
        .bind(eventId, input.event.id, input.event.type, input.payloadHash, claimedAt)
        .run();
    } catch {
      return { duplicate: true, handled: false };
    }
  }

  const checkout = await findCheckoutForStripeObject(input.event.data.object);
  try {
    let handled = false;
    if (checkout) {
      if (isSuccessfulCheckoutEvent(input.event.type, input.event.data.object)) {
        await completeCheckout(checkout, input.event);
        handled = true;
      } else if (isFailedPaymentEvent(input.event.type)) {
        await failCheckout(checkout, input.event);
        handled = true;
      } else if (input.event.type === "checkout.session.expired") {
        await expireCheckout(checkout, input.event);
        handled = true;
      }
    }

    await getD1()
      .prepare(
        `UPDATE payment_webhook_events
         SET checkout_session_id = ?, processing_status = ?, processed_at = ?, last_error = NULL
         WHERE id = ? AND processing_status = 'pending'`,
      )
      .bind(checkout?.id ?? null, handled ? "processed" : "ignored", Date.now(), eventId)
      .run();
    return { duplicate: false, handled };
  } catch (error) {
    await getD1()
      .prepare(
        `UPDATE payment_webhook_events
         SET processing_status = 'failed', last_error = ?
         WHERE id = ? AND processing_status = 'pending'`,
      )
      .bind(error instanceof Error ? error.message.slice(0, 500) : "Webhook processing failed.", eventId)
      .run();
    throw error;
  }
}

async function getReusableOpenCheckout(
  workspaceId: string,
  subscriptionId: string,
): Promise<{
  id: string;
  plan_id: string;
  checkout_url: string | null;
  expires_at: number | null;
} | null> {
  const row = await getD1()
    .prepare(
      `SELECT cs.id, cs.plan_id, cs.checkout_url, cs.expires_at
       FROM payment_checkout_sessions cs
       WHERE cs.workspace_id = ? AND cs.subscription_id = ?
         AND cs.status IN ('creating', 'open')
       ORDER BY cs.created_at DESC
       LIMIT 1`,
    )
    .bind(workspaceId, subscriptionId)
    .first<{
      id: string;
      plan_id: string;
      checkout_url: string | null;
      expires_at: number | null;
    }>();
  if (!row) return null;
  if (row.expires_at && row.expires_at <= Date.now()) {
    await expireCheckoutById(row.id);
    return null;
  }
  return row;
}

function assertPurchasablePlan(
  plan: PlanView | null,
  productId: string,
): asserts plan is PlanView {
  if (!plan || plan.status !== "active") {
    throw new ManagementError("PLAN_NOT_AVAILABLE", "所选套餐当前不可购买。", 400);
  }
  if (plan.productId !== productId) {
    throw new ManagementError(
      "PLAN_PRODUCT_MISMATCH",
      "当前套餐不属于订阅产品，不能发起付款。",
      409,
    );
  }
  if (!Number.isSafeInteger(plan.priceAmount) || plan.priceAmount <= 0) {
    throw new ManagementError(
      "PLAN_NOT_PAYABLE",
      "免费或无效价格套餐不能通过在线支付购买，请联系平台管理员。",
      400,
    );
  }
}

async function assertActiveWorkspace(workspaceId: string): Promise<void> {
  const workspace = await getD1()
    .prepare("SELECT status FROM workspaces WHERE id = ? LIMIT 1")
    .bind(workspaceId)
    .first<{ status: string }>();
  if (!workspace || workspace.status !== "active") {
    throw new ManagementError("WORKSPACE_NOT_ACTIVE", "当前企业工作区不能发起在线付款。", 403);
  }
}

async function findCheckoutForStripeObject(
  stripeObject: Record<string, unknown>,
): Promise<CheckoutRow | null> {
  const metadata = asRecord(stripeObject.metadata);
  const checkoutId = asString(metadata.payment_checkout_id);
  if (checkoutId) return getCheckoutRow(checkoutId);

  const objectId = asString(stripeObject.id);
  const paymentIntentId = asString(stripeObject.payment_intent);
  const row = await getD1()
    .prepare(
      `${checkoutSelect}
       WHERE cs.provider = 'stripe'
         AND (cs.provider_session_id = ? OR cs.provider_payment_id = ? OR cs.provider_payment_id = ?)
       LIMIT 1`,
    )
    .bind(objectId, objectId, paymentIntentId)
    .first<CheckoutRow>();
  return row;
}

async function completeCheckout(
  checkout: CheckoutRow,
  event: StripeWebhookEvent,
): Promise<void> {
  const paymentAlreadyRecorded =
    checkout.status === "completed" || checkout.payment_status === "paid";
  const now = Date.now();
  const { providerSessionId, providerPaymentId } = providerIdentifiers(event, checkout);
  const subscription = await getSubscription(checkout.subscription_id);
  if (!subscription || subscription.workspaceId !== checkout.workspace_id) {
    throw new ManagementError(
      "CHECKOUT_SUBSCRIPTION_NOT_FOUND",
      "付款会话关联的订阅不存在或不属于当前客户。",
      409,
    );
  }
  const currentSubscription = await getWorkspaceProductCurrentSubscription(
    checkout.workspace_id,
    subscription.productId,
  );
  const isCurrentSubscription = currentSubscription?.id === subscription.id;
  const activationRequested =
    !paymentAlreadyRecorded &&
    isCurrentSubscription &&
    (subscription.status === "manual_pending" ||
      subscription.status === "past_due");
  const attentionNote = activationRequested
    ? null
    : "Stripe 已确认收款，但付款对应的订阅已不处于待付款状态，请平台管理员人工核对。";
  const db = getD1();
  if (!paymentAlreadyRecorded) {
    const periodEnd = addBillingPeriod(now, checkout.billing_interval);
    const statements: D1PreparedStatement[] = [];
    if (activationRequested) {
      statements.push(
        db
          .prepare(
            `UPDATE subscriptions
             SET plan_id = ?, status = 'active', current_period_start = ?,
                 current_period_end = ?, cancel_at_period_end = 0, updated_at = ?
             WHERE id = ? AND workspace_id = ? AND product_id = ?
               AND status IN ('manual_pending', 'past_due')`,
          )
          .bind(
            checkout.plan_id,
            now,
            periodEnd,
            now,
            subscription.id,
            checkout.workspace_id,
            subscription.productId,
          ),
        syncWorkspaceSubscriptionSummaryStatement(checkout.workspace_id, now),
      );
    }
    statements.push(
      db
        .prepare(
          `UPDATE payment_records
           SET subscription_id = ?, status = 'paid', paid_at = ?, provider_payment_id = ?,
               provider_event_id = ?, reference = ?, note = COALESCE(?, note),
               failure_reason = NULL, updated_at = ?
           WHERE id = ? AND status <> 'paid'`,
        )
        .bind(
          subscription.id,
          now,
          providerPaymentId,
          event.id,
          providerSessionId,
          attentionNote,
          now,
          checkout.payment_record_id,
        ),
      db
        .prepare(
          `UPDATE payment_checkout_sessions
           SET provider_session_id = ?, provider_payment_id = ?, status = 'completed',
               completed_at = ?, updated_at = ?
           WHERE id = ? AND status <> 'completed'`,
        )
        .bind(providerSessionId, providerPaymentId, now, now, checkout.id),
    );
    await db.batch(statements);
  }

  const confirmedSubscription = await getSubscription(subscription.id);
  const confirmedCurrentSubscription = confirmedSubscription
    ? await getWorkspaceProductCurrentSubscription(
        checkout.workspace_id,
        confirmedSubscription.productId,
      )
    : null;
  const canPrepareApplication =
    confirmedSubscription?.status === "active" &&
    confirmedCurrentSubscription?.id === confirmedSubscription.id;
  if (activationRequested && !canPrepareApplication) {
    await db
      .prepare(
        `UPDATE payment_records
         SET note = COALESCE(note, ?), updated_at = ?
         WHERE id = ? AND status = 'paid'`,
      )
      .bind(
        "Stripe 已确认收款，但订阅在付款确认期间发生变化，请平台管理员人工核对。",
        Date.now(),
        checkout.payment_record_id,
      )
      .run();
  }

  if (canPrepareApplication) {
    const pendingInstanceStatement = await preparePendingAppInstance({
      workspaceId: checkout.workspace_id,
      workspaceName: await getWorkspaceName(checkout.workspace_id),
      productId: confirmedSubscription.productId,
      subscriptionId: confirmedSubscription.id,
      createdByUserId: checkout.initiated_by_user_id,
      now,
    });
    if (pendingInstanceStatement) {
      await db.batch([
        pendingInstanceStatement,
        syncWorkspaceAppInstanceStatusStatement(checkout.workspace_id, now),
      ]);
    }
  }
}

async function getWorkspaceName(workspaceId: string): Promise<string> {
  const workspace = await getD1()
    .prepare("SELECT name FROM workspaces WHERE id = ? LIMIT 1")
    .bind(workspaceId)
    .first<{ name: string }>();
  if (!workspace) {
    throw new ManagementError("WORKSPACE_NOT_FOUND", "没有找到付款对应的企业客户。", 404);
  }
  return workspace.name;
}

async function failCheckout(checkout: CheckoutRow, event: StripeWebhookEvent): Promise<void> {
  if (checkout.status === "completed" || checkout.payment_status === "paid") return;
  const now = Date.now();
  const stripeObject = event.data.object;
  const { providerSessionId, providerPaymentId } = providerIdentifiers(event, checkout);
  const failureReason = getFailureReason(stripeObject) ?? "Stripe 未能完成这笔付款。";
  await getD1().batch([
    getD1()
      .prepare(
        `UPDATE payment_records
         SET status = 'failed', provider_payment_id = ?, provider_event_id = ?,
             reference = ?, failure_reason = ?, updated_at = ?
         WHERE id = ? AND status <> 'paid'`,
      )
      .bind(providerPaymentId, event.id, providerSessionId, failureReason, now, checkout.payment_record_id),
    getD1()
      .prepare(
        `UPDATE payment_checkout_sessions
         SET provider_session_id = ?, provider_payment_id = ?, status = 'failed', updated_at = ?
         WHERE id = ? AND status <> 'completed'`,
      )
      .bind(providerSessionId, providerPaymentId, now, checkout.id),
  ]);
}

async function expireCheckout(checkout: CheckoutRow, event: StripeWebhookEvent): Promise<void> {
  if (checkout.status === "completed" || checkout.payment_status === "paid") return;
  const now = Date.now();
  await getD1().batch([
    getD1()
      .prepare(
        `UPDATE payment_records
         SET status = 'canceled', provider_event_id = ?, failure_reason = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .bind(event.id, "Stripe Checkout 已过期。", now, checkout.payment_record_id),
    getD1()
      .prepare(
        `UPDATE payment_checkout_sessions
         SET status = 'expired', updated_at = ?
         WHERE id = ? AND status <> 'completed'`,
      )
      .bind(now, checkout.id),
  ]);
}

async function expireCheckoutById(checkoutId: string): Promise<void> {
  const checkout = await getCheckoutRow(checkoutId);
  if (!checkout) return;
  await expireCheckout(checkout, {
    id: `local_expire_${checkout.id}`,
    type: "checkout.session.expired",
    data: { object: {} },
  });
}

function isSuccessfulCheckoutEvent(type: string, object: Record<string, unknown>): boolean {
  return (
    (type === "checkout.session.completed" && object.payment_status === "paid") ||
    type === "checkout.session.async_payment_succeeded"
  );
}

function isFailedPaymentEvent(type: string): boolean {
  return type === "checkout.session.async_payment_failed" || type === "payment_intent.payment_failed";
}

function addBillingPeriod(start: number, interval: BillingInterval): number {
  const date = new Date(start);
  if (interval === "year") {
    date.setUTCFullYear(date.getUTCFullYear() + 1);
  } else {
    date.setUTCMonth(date.getUTCMonth() + 1);
  }
  return date.getTime();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function getFailureReason(object: Record<string, unknown>): string | null {
  const lastPaymentError = asRecord(object.last_payment_error);
  const message = asString(lastPaymentError.message) ?? asString(object.failure_message);
  return message ? message.slice(0, 500) : null;
}

function providerIdentifiers(
  event: StripeWebhookEvent,
  checkout: CheckoutRow,
): { providerSessionId: string | null; providerPaymentId: string | null } {
  const object = event.data.object;
  if (event.type.startsWith("checkout.session.")) {
    return {
      providerSessionId: asString(object.id) ?? checkout.provider_session_id,
      providerPaymentId: asString(object.payment_intent) ?? checkout.provider_payment_id,
    };
  }
  return {
    providerSessionId: checkout.provider_session_id,
    providerPaymentId: asString(object.id) ?? checkout.provider_payment_id,
  };
}
