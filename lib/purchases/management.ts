import { getDatabase } from "@/db";
import {
  getPlan,
  ManagementError,
  type BillingInterval,
  type PlanView,
} from "@/lib/admin/management";
import {
  getSubscription,
  getWorkspaceProductCurrentSubscription,
  syncWorkspaceSubscriptionSummaryStatement,
  type PaymentStatus,
  type SubscriptionStatus,
} from "@/lib/billing/management";
import { randomId } from "@/lib/domain/ids";
import { upsertWorkspaceProductEntitlementStatement } from "@/lib/entitlements/management";
import {
  preparePendingAppInstance,
  syncWorkspaceAppInstanceStatusStatement,
  type AppInstanceStatus,
} from "@/lib/instances/management";
import {
  createStripeCheckoutSession,
  retrieveStripeCheckoutSession,
  type StripeWebhookEvent,
} from "@/lib/payments/stripe";
import {
  resolveTemplateConfiguration,
  type TemplateConfiguration,
} from "@/lib/templates/validation";
import type { CustomerPurchaseInput } from "./validation";

export type PurchaseOrderStatus =
  | "draft"
  | "checkout_pending"
  | "paid"
  | "failed"
  | "canceled"
  | "expired";

export type PurchaseOrderType = "new_subscription" | "renewal";

export interface PurchaseOrderView {
  id: string;
  workspaceId: string;
  workspaceName: string;
  productId: string;
  productName: string;
  planId: string;
  planName: string;
  templateVersionId: string;
  templateName: string;
  templateVersion: number;
  subscriptionId: string | null;
  renewalSubscriptionId: string | null;
  paymentRecordId: string | null;
  paymentStatus: PaymentStatus | null;
  orderType: PurchaseOrderType;
  configurationSnapshot: TemplateConfiguration;
  amount: number;
  currency: string;
  billingInterval: BillingInterval;
  status: PurchaseOrderStatus;
  provider: string;
  providerSessionId: string | null;
  providerPaymentId: string | null;
  checkoutUrl: string | null;
  failureReason: string | null;
  createdByUserId: string;
  createdByName: string;
  expiresAt: number | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface PurchaseOrderRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  product_id: string;
  product_name: string;
  plan_id: string;
  plan_name: string;
  template_version_id: string;
  template_name: string;
  template_version: number;
  subscription_id: string | null;
  renewal_subscription_id: string | null;
  payment_record_id: string | null;
  payment_status: PaymentStatus | null;
  order_type: PurchaseOrderType;
  configuration_snapshot: string;
  amount: number;
  currency: string;
  billing_interval: BillingInterval;
  status: PurchaseOrderStatus;
  provider: string;
  provider_session_id: string | null;
  provider_payment_id: string | null;
  checkout_url: string | null;
  failure_reason: string | null;
  created_by_user_id: string;
  created_by_name: string;
  expires_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

const purchaseOrderSelect = `
  SELECT
    purchase.id, purchase.workspace_id, workspace.name AS workspace_name,
    purchase.product_id, product.name AS product_name,
    purchase.plan_id, plan.name AS plan_name,
    purchase.template_version_id, template.name AS template_name,
    template_version.version AS template_version,
    purchase.subscription_id, purchase.renewal_subscription_id,
    purchase.payment_record_id, payment.status AS payment_status,
    purchase.order_type, purchase.configuration_snapshot,
    purchase.amount, purchase.currency, purchase.billing_interval,
    purchase.status, purchase.provider, purchase.provider_session_id,
    purchase.provider_payment_id, purchase.checkout_url,
    purchase.failure_reason, purchase.created_by_user_id,
    user.name AS created_by_name, purchase.expires_at,
    purchase.completed_at, purchase.created_at, purchase.updated_at
  FROM subscription_purchase_orders purchase
  INNER JOIN workspaces workspace ON workspace.id = purchase.workspace_id
  INNER JOIN products product ON product.id = purchase.product_id
  INNER JOIN plans plan ON plan.id = purchase.plan_id
  INNER JOIN app_instance_template_versions template_version
    ON template_version.id = purchase.template_version_id
  INNER JOIN app_instance_templates template
    ON template.id = template_version.template_id
  INNER JOIN users user ON user.id = purchase.created_by_user_id
  LEFT JOIN payment_records payment ON payment.id = purchase.payment_record_id`;

function parseConfiguration(value: string): TemplateConfiguration {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, item]) =>
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean"
      ),
    ) as TemplateConfiguration;
  } catch {
    return {};
  }
}

function toPurchaseOrderView(row: PurchaseOrderRow): PurchaseOrderView {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    productId: row.product_id,
    productName: row.product_name,
    planId: row.plan_id,
    planName: row.plan_name,
    templateVersionId: row.template_version_id,
    templateName: row.template_name,
    templateVersion: Number(row.template_version),
    subscriptionId: row.subscription_id,
    renewalSubscriptionId: row.renewal_subscription_id,
    paymentRecordId: row.payment_record_id,
    paymentStatus: row.payment_status,
    orderType: row.order_type,
    configurationSnapshot: parseConfiguration(row.configuration_snapshot),
    amount: Number(row.amount),
    currency: row.currency,
    billingInterval: row.billing_interval,
    status: row.status,
    provider: row.provider,
    providerSessionId: row.provider_session_id,
    providerPaymentId: row.provider_payment_id,
    checkoutUrl: row.checkout_url,
    failureReason: row.failure_reason,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    expiresAt: row.expires_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getPurchaseOrderRow(
  purchaseOrderId: string,
): Promise<PurchaseOrderRow | null> {
  return getDatabase()
    .prepare(`${purchaseOrderSelect} WHERE purchase.id = ? LIMIT 1`)
    .bind(purchaseOrderId)
    .first<PurchaseOrderRow>();
}

export async function getWorkspacePurchaseOrder(
  workspaceId: string,
  purchaseOrderId: string,
): Promise<PurchaseOrderView | null> {
  const row = await getDatabase()
    .prepare(
      `${purchaseOrderSelect}
       WHERE purchase.id = ? AND purchase.workspace_id = ?
       LIMIT 1`,
    )
    .bind(purchaseOrderId, workspaceId)
    .first<PurchaseOrderRow>();
  return row ? toPurchaseOrderView(row) : null;
}

export async function listPurchaseOrders(input?: {
  query?: string;
  status?: PurchaseOrderStatus | "";
  workspaceId?: string;
}): Promise<PurchaseOrderView[]> {
  const clauses: string[] = [];
  const bindings: string[] = [];
  const query = input?.query?.trim() ?? "";
  if (query) {
    const pattern = `%${query}%`;
    clauses.push(
      "(workspace.name LIKE ? OR product.name LIKE ? OR plan.name LIKE ? OR purchase.provider_session_id LIKE ?)",
    );
    bindings.push(pattern, pattern, pattern, pattern);
  }
  if (input?.status) {
    clauses.push("purchase.status = ?");
    bindings.push(input.status);
  }
  if (input?.workspaceId) {
    clauses.push("purchase.workspace_id = ?");
    bindings.push(input.workspaceId);
  }
  const statement = getDatabase().prepare(
    `${purchaseOrderSelect}
     ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
     ORDER BY purchase.created_at DESC
     LIMIT 200`,
  );
  const result = await (bindings.length
    ? statement.bind(...bindings)
    : statement
  ).all<PurchaseOrderRow>();
  return result.results.map(toPurchaseOrderView);
}

export async function reconcileWorkspaceExpiredSubscriptions(
  workspaceId: string,
): Promise<void> {
  const result = await getDatabase()
    .prepare(
      `SELECT product_id
       FROM subscriptions
       WHERE workspace_id = ? AND status = 'active'
         AND current_period_end <= ?
       GROUP BY product_id`,
    )
    .bind(workspaceId, Date.now())
    .all<{ product_id: string }>();
  for (const row of result.results) {
    await reconcileEndedSubscription(workspaceId, row.product_id);
  }
}

export async function createCustomerPurchaseCheckout(input: {
  workspaceId: string;
  initiatedByUserId: string;
  customerEmail: string;
  origin: string;
  purchase: CustomerPurchaseInput;
}): Promise<{
  order: PurchaseOrderView;
  checkoutUrl: string;
  reused: boolean;
}> {
  await assertActiveWorkspace(input.workspaceId);
  const plan = await getPlan(input.purchase.planId);
  assertPurchasablePlan(plan);

  let orderType: PurchaseOrderType = "new_subscription";
  let renewalSubscriptionId: string | null = null;
  let configuration: TemplateConfiguration;
  if (input.purchase.renewalSubscriptionId) {
    const subscription = await getSubscription(
      input.purchase.renewalSubscriptionId,
    );
    if (!subscription || subscription.workspaceId !== input.workspaceId) {
      throw new ManagementError(
        "SUBSCRIPTION_NOT_FOUND",
        "没有找到当前工作区可以续费的订阅。",
        404,
      );
    }
    if (
      subscription.planId !== plan.id ||
      subscription.productId !== plan.productId
    ) {
      throw new ManagementError(
        "RENEWAL_PLAN_MISMATCH",
        "续费必须使用当前订阅原有的产品和套餐。",
        409,
      );
    }
    if (subscription.status !== "active" && subscription.status !== "past_due") {
      throw new ManagementError(
        "SUBSCRIPTION_NOT_RENEWABLE",
        "当前订阅状态不能直接续费。",
        409,
      );
    }
    orderType = "renewal";
    renewalSubscriptionId = subscription.id;
    configuration = subscription.instanceConfiguration;
  } else {
    await reconcileEndedSubscription(input.workspaceId, plan.productId);
    const current = await getWorkspaceProductCurrentSubscription(
      input.workspaceId,
      plan.productId,
    );
    if (current) {
      throw new ManagementError(
        "CURRENT_SUBSCRIPTION_EXISTS",
        current.status === "active" || current.status === "past_due"
          ? "这个产品已有当前订阅，请使用续费入口。"
          : "这个产品已有正在处理的订阅，请先联系平台管理员。",
        409,
      );
    }
    const existingInstance = await getDatabase()
      .prepare(
        `SELECT template_version_id
         FROM app_instances
         WHERE workspace_id = ? AND product_id = ?
         LIMIT 1`,
      )
      .bind(input.workspaceId, plan.productId)
      .first<{ template_version_id: string | null }>();
    if (
      existingInstance?.template_version_id &&
      existingInstance.template_version_id !== plan.templateVersionId
    ) {
      throw new ManagementError(
        "EXISTING_INSTANCE_TEMPLATE_MISMATCH",
        "现有应用实例使用不同模板版本，重新购买前请联系平台管理员处理套餐变更。",
        409,
      );
    }
    const resolved = resolveTemplateConfiguration({
      schema: plan.templateConfigurationSchema,
      defaults: {
        ...plan.templateDefaultConfiguration,
        ...plan.templateConfiguration,
      },
      planLimits: plan.limits,
      requested: input.purchase.instanceConfiguration,
    });
    if (!resolved.data) {
      throw new ManagementError(
        "INSTANCE_CONFIGURATION_INVALID",
        Object.values(resolved.errors)[0]?.[0] ?? "实例配置不符合套餐要求。",
        400,
      );
    }
    configuration = resolved.data;
  }

  const reusable = await getReusableOrder(input.workspaceId, plan.productId);
  if (reusable) {
    if (
      reusable.plan_id !== plan.id ||
      reusable.order_type !== orderType ||
      reusable.renewal_subscription_id !== renewalSubscriptionId ||
      reusable.configuration_snapshot !== JSON.stringify(configuration) ||
      !reusable.checkout_url
    ) {
      throw new ManagementError(
        "PURCHASE_ORDER_ALREADY_OPEN",
        "该产品已有一笔待完成订单，请先完成或取消原订单。",
        409,
      );
    }
    const order = await getWorkspacePurchaseOrder(
      input.workspaceId,
      reusable.id,
    );
    if (!order) {
      throw new ManagementError(
        "PURCHASE_ORDER_NOT_FOUND",
        "没有找到购买订单。",
        404,
      );
    }
    return {
      order,
      checkoutUrl: reusable.checkout_url,
      reused: true,
    };
  }

  const orderId = randomId("ord");
  const paymentRecordId = randomId("pay");
  const now = Date.now();
  const reservationExpiresAt = now + 10 * 60 * 1000;
  const db = getDatabase();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO payment_records (
            id, workspace_id, subscription_id, amount, currency, status,
            paid_at, payment_method, provider, provider_payment_id,
            provider_event_id, reference, note, failure_reason,
            recorded_by_user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, 'Stripe Checkout',
            'stripe', NULL, NULL, NULL, '客户自助购买', NULL, ?, ?, ?)`,
        )
        .bind(
          paymentRecordId,
          input.workspaceId,
          renewalSubscriptionId,
          plan.priceAmount,
          plan.currency,
          input.initiatedByUserId,
          now,
          now,
        ),
      db
        .prepare(
          `INSERT INTO subscription_purchase_orders (
            id, workspace_id, product_id, plan_id, template_version_id,
            subscription_id, renewal_subscription_id, payment_record_id,
            order_type, configuration_snapshot, amount, currency,
            billing_interval, status, provider, created_by_user_id,
            expires_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?,
            'draft', 'stripe', ?, ?, ?, ?)`,
        )
        .bind(
          orderId,
          input.workspaceId,
          plan.productId,
          plan.id,
          plan.templateVersionId,
          renewalSubscriptionId,
          paymentRecordId,
          orderType,
          JSON.stringify(configuration),
          plan.priceAmount,
          plan.currency,
          plan.billingInterval,
          input.initiatedByUserId,
          reservationExpiresAt,
          now,
          now,
        ),
    ]);
  } catch {
    throw new ManagementError(
      "PURCHASE_ORDER_ALREADY_OPEN",
      "该产品已有一笔正在创建或等待付款的订单，请稍后重试。",
      409,
    );
  }

  const resultUrl = `${input.origin}/dashboard/billing/payment-result`;
  try {
    const stripeSession = await createStripeCheckoutSession({
      checkoutId: orderId,
      metadataKey: "subscription_purchase_order_id",
      planName: `${plan.productName} · ${plan.name}`,
      planDescription: plan.description,
      amount: plan.priceAmount,
      currency: plan.currency,
      customerEmail: input.customerEmail,
      successUrl: `${resultUrl}?order_id=${encodeURIComponent(orderId)}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${resultUrl}?order_id=${encodeURIComponent(orderId)}&status=cancelled`,
    });
    await db.batch([
      db
        .prepare(
          `UPDATE subscription_purchase_orders
           SET provider_session_id = ?, checkout_url = ?,
               status = 'checkout_pending', expires_at = ?, updated_at = ?
           WHERE id = ? AND status = 'draft'`,
        )
        .bind(
          stripeSession.id,
          stripeSession.url,
          stripeSession.expiresAt,
          Date.now(),
          orderId,
        ),
      db
        .prepare(
          `UPDATE payment_records
           SET reference = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(stripeSession.id, Date.now(), paymentRecordId),
    ]);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.slice(0, 500)
        : "无法创建在线支付页面。";
    await db.batch([
      db
        .prepare(
          `UPDATE subscription_purchase_orders
           SET status = 'failed', failure_reason = ?, updated_at = ?
           WHERE id = ? AND status = 'draft'`,
        )
        .bind(message, Date.now(), orderId),
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

  const order = await getWorkspacePurchaseOrder(input.workspaceId, orderId);
  if (!order?.checkoutUrl) {
    throw new ManagementError(
      "PURCHASE_ORDER_CREATE_FAILED",
      "无法创建在线支付页面。",
      500,
    );
  }
  return {
    order,
    checkoutUrl: order.checkoutUrl,
    reused: false,
  };
}

export async function cancelWorkspacePurchaseOrder(
  workspaceId: string,
  purchaseOrderId: string,
): Promise<PurchaseOrderView | null> {
  const order = await getPurchaseOrderRow(purchaseOrderId);
  if (!order || order.workspace_id !== workspaceId) return null;
  if (order.status === "paid" || order.payment_status === "paid") {
    return toPurchaseOrderView(order);
  }
  const now = Date.now();
  await getDatabase().batch([
    getDatabase()
      .prepare(
        `UPDATE subscription_purchase_orders
         SET status = 'canceled',
             failure_reason = '客户取消了 Stripe Checkout 付款。',
             updated_at = ?
         WHERE id = ? AND status IN ('draft', 'checkout_pending')`,
      )
      .bind(now, purchaseOrderId),
    getDatabase()
      .prepare(
        `UPDATE payment_records
         SET status = 'canceled',
             failure_reason = '客户取消了 Stripe Checkout 付款。',
             updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .bind(now, order.payment_record_id),
  ]);
  return getWorkspacePurchaseOrder(workspaceId, purchaseOrderId);
}

export async function reconcilePurchaseOrderFromStripe(
  workspaceId: string,
  purchaseOrderId: string,
  returnedSessionId?: string,
): Promise<PurchaseOrderView | null> {
  const order = await getPurchaseOrderRow(purchaseOrderId);
  if (!order || order.workspace_id !== workspaceId) return null;
  if (order.status === "paid" || order.payment_status === "paid") {
    await ensureApplicationEntitlement(order);
    return getWorkspacePurchaseOrder(workspaceId, purchaseOrderId);
  }
  if (!order.provider_session_id) return toPurchaseOrderView(order);
  if (returnedSessionId && returnedSessionId !== order.provider_session_id) {
    return toPurchaseOrderView(order);
  }
  const session = await retrieveStripeCheckoutSession(order.provider_session_id);
  if (
    asString(session.metadata.subscription_purchase_order_id) !== order.id
  ) {
    return toPurchaseOrderView(order);
  }
  if (session.paymentStatus === "paid" && session.status === "complete") {
    await completePurchaseOrder(order, {
      id: `stripe_order_sync_${session.id}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: session.id,
          payment_status: session.paymentStatus,
          status: session.status,
          payment_intent: session.paymentIntentId,
          amount_total: session.amountTotal,
          currency: session.currency,
          metadata: session.metadata,
        },
      },
    });
  }
  return getWorkspacePurchaseOrder(workspaceId, purchaseOrderId);
}

export async function findPurchaseOrderForStripeObject(
  stripeObject: Record<string, unknown>,
): Promise<PurchaseOrderRow | null> {
  const metadata = asRecord(stripeObject.metadata);
  const purchaseOrderId = asString(
    metadata.subscription_purchase_order_id,
  );
  if (purchaseOrderId) return getPurchaseOrderRow(purchaseOrderId);

  const objectId = asString(stripeObject.id);
  const paymentIntentId = asString(stripeObject.payment_intent);
  return getDatabase()
    .prepare(
      `${purchaseOrderSelect}
       WHERE purchase.provider = 'stripe'
         AND (
           purchase.provider_session_id = ?
           OR purchase.provider_payment_id = ?
           OR purchase.provider_payment_id = ?
         )
       LIMIT 1`,
    )
    .bind(objectId, objectId, paymentIntentId)
    .first<PurchaseOrderRow>();
}

export async function processPurchaseOrderStripeEvent(
  order: PurchaseOrderRow,
  event: StripeWebhookEvent,
): Promise<boolean> {
  if (isSuccessfulCheckoutEvent(event.type, event.data.object)) {
    await completePurchaseOrder(order, event);
    return true;
  }
  if (isFailedPaymentEvent(event.type)) {
    await failPurchaseOrder(order, event);
    return true;
  }
  if (event.type === "checkout.session.expired") {
    await expirePurchaseOrder(order, event);
    return true;
  }
  return false;
}

async function completePurchaseOrder(
  order: PurchaseOrderRow,
  event: StripeWebhookEvent,
): Promise<void> {
  const fresh = (await getPurchaseOrderRow(order.id)) ?? order;
  if (fresh.status !== "paid" || fresh.payment_status !== "paid") {
    assertStripeAmountMatches(fresh, event.data.object);
    const now = Date.now();
    const { providerSessionId, providerPaymentId } =
      providerIdentifiers(event, fresh);
    let subscriptionId = fresh.renewal_subscription_id;
    const statements: DatabasePreparedStatement[] = [];

    if (fresh.order_type === "renewal") {
      const subscription = subscriptionId
        ? await getSubscription(subscriptionId)
        : null;
      if (
        !subscription ||
        subscription.workspaceId !== fresh.workspace_id ||
        subscription.productId !== fresh.product_id ||
        subscription.planId !== fresh.plan_id ||
        (subscription.status !== "active" &&
          subscription.status !== "past_due")
      ) {
        throw new ManagementError(
          "RENEWAL_SUBSCRIPTION_CHANGED",
          "付款已确认，但续费订阅在付款期间发生变化，请平台管理员人工核对。",
          409,
        );
      }
      const periodAnchor = Math.max(now, subscription.currentPeriodEnd);
      const periodStart =
        subscription.currentPeriodEnd > now
          ? subscription.currentPeriodStart
          : now;
      statements.push(
        getDatabase()
          .prepare(
            `UPDATE subscriptions
             SET status = 'active', current_period_start = ?,
                 current_period_end = ?, cancel_at_period_end = 0,
                 updated_at = ?
             WHERE id = ? AND workspace_id = ? AND product_id = ?
               AND status IN ('active', 'past_due')`,
          )
          .bind(
            periodStart,
            addBillingPeriod(periodAnchor, fresh.billing_interval),
            now,
            subscription.id,
            fresh.workspace_id,
            fresh.product_id,
          ),
      );
    } else {
      const current = await getWorkspaceProductCurrentSubscription(
        fresh.workspace_id,
        fresh.product_id,
      );
      if (current) {
        throw new ManagementError(
          "CURRENT_SUBSCRIPTION_EXISTS",
          "付款已确认，但该产品在付款期间出现了另一条当前订阅，请平台管理员人工核对。",
          409,
        );
      }
      subscriptionId = randomId("sub");
      statements.push(
        getDatabase()
          .prepare(
            `INSERT INTO subscriptions (
              id, workspace_id, product_id, plan_id, template_version_id,
              instance_configuration, status, current_period_start,
              current_period_end, cancel_at_period_end, creation_source,
              created_by_user_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 0,
              'customer_checkout', ?, ?, ?)`,
          )
          .bind(
            subscriptionId,
            fresh.workspace_id,
            fresh.product_id,
            fresh.plan_id,
            fresh.template_version_id,
            fresh.configuration_snapshot,
            now,
            addBillingPeriod(now, fresh.billing_interval),
            fresh.created_by_user_id,
            now,
            now,
          ),
      );
    }

    if (!subscriptionId) {
      throw new ManagementError(
        "PURCHASE_SUBSCRIPTION_CREATE_FAILED",
        "付款已确认，但没有生成订阅标识。",
        500,
      );
    }
    statements.push(
      getDatabase()
        .prepare(
          `UPDATE payment_records
           SET subscription_id = ?, status = 'paid', paid_at = ?,
               provider_payment_id = ?, provider_event_id = ?,
               reference = ?, failure_reason = NULL, updated_at = ?
           WHERE id = ? AND status <> 'paid'`,
        )
        .bind(
          subscriptionId,
          now,
          providerPaymentId,
          event.id,
          providerSessionId,
          now,
          fresh.payment_record_id,
        ),
      getDatabase()
        .prepare(
          `UPDATE subscription_purchase_orders
           SET subscription_id = ?, provider_session_id = ?,
               provider_payment_id = ?, status = 'paid',
               completed_at = ?, failure_reason = NULL, updated_at = ?
           WHERE id = ? AND status <> 'paid'`,
        )
        .bind(
          subscriptionId,
          providerSessionId,
          providerPaymentId,
          now,
          now,
          fresh.id,
        ),
      syncWorkspaceSubscriptionSummaryStatement(fresh.workspace_id, now),
    );
    await getDatabase().batch(statements);
  }

  const confirmed = await getPurchaseOrderRow(fresh.id);
  if (confirmed) await ensureApplicationEntitlement(confirmed);
}

async function ensureApplicationEntitlement(
  order: PurchaseOrderRow,
): Promise<void> {
  const subscriptionId =
    order.subscription_id ?? order.renewal_subscription_id;
  if (!subscriptionId) return;
  const subscription = await getSubscription(subscriptionId);
  if (!subscription || subscription.status !== "active") return;
  const workspace = await getDatabase()
    .prepare("SELECT name FROM workspaces WHERE id = ? LIMIT 1")
    .bind(order.workspace_id)
    .first<{ name: string }>();
  if (!workspace) return;

  const now = Date.now();
  const pendingStatement = await preparePendingAppInstance({
    workspaceId: order.workspace_id,
    workspaceName: workspace.name,
    productId: order.product_id,
    subscriptionId,
    templateVersionId: order.template_version_id,
    configurationSnapshot: parseConfiguration(order.configuration_snapshot),
    createdByUserId: order.created_by_user_id,
    now,
  });
  if (pendingStatement) {
    await getDatabase().batch([
      pendingStatement,
      syncWorkspaceAppInstanceStatusStatement(order.workspace_id, now),
    ]);
  }
  const instance = await getDatabase()
    .prepare(
      `SELECT id, status
       FROM app_instances
       WHERE workspace_id = ? AND product_id = ?
       LIMIT 1`,
    )
    .bind(order.workspace_id, order.product_id)
    .first<{ id: string; status: AppInstanceStatus }>();
  await upsertWorkspaceProductEntitlementStatement({
    workspaceId: order.workspace_id,
    productId: order.product_id,
    currentSubscriptionId: subscriptionId,
    appInstanceId: instance?.id ?? null,
    status:
      instance?.status === "active"
        ? "active"
        : instance?.status === "suspended"
          ? "suspended"
          : "pending",
    now,
  }).run();
}

async function failPurchaseOrder(
  order: PurchaseOrderRow,
  event: StripeWebhookEvent,
): Promise<void> {
  if (order.status === "paid" || order.payment_status === "paid") return;
  const now = Date.now();
  const { providerSessionId, providerPaymentId } =
    providerIdentifiers(event, order);
  const failureReason =
    getFailureReason(event.data.object) ?? "Stripe 未能完成这笔付款。";
  await getDatabase().batch([
    getDatabase()
      .prepare(
        `UPDATE payment_records
         SET status = 'failed', provider_payment_id = ?,
             provider_event_id = ?, reference = ?, failure_reason = ?,
             updated_at = ?
         WHERE id = ? AND status <> 'paid'`,
      )
      .bind(
        providerPaymentId,
        event.id,
        providerSessionId,
        failureReason,
        now,
        order.payment_record_id,
      ),
    getDatabase()
      .prepare(
        `UPDATE subscription_purchase_orders
         SET provider_session_id = ?, provider_payment_id = ?,
             status = 'failed', failure_reason = ?, updated_at = ?
         WHERE id = ? AND status <> 'paid'`,
      )
      .bind(
        providerSessionId,
        providerPaymentId,
        failureReason,
        now,
        order.id,
      ),
  ]);
}

async function expirePurchaseOrder(
  order: PurchaseOrderRow,
  event: StripeWebhookEvent,
): Promise<void> {
  if (order.status === "paid" || order.payment_status === "paid") return;
  const now = Date.now();
  await getDatabase().batch([
    getDatabase()
      .prepare(
        `UPDATE payment_records
         SET status = 'canceled', provider_event_id = ?,
             failure_reason = 'Stripe Checkout 已过期。', updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .bind(event.id, now, order.payment_record_id),
    getDatabase()
      .prepare(
        `UPDATE subscription_purchase_orders
         SET status = 'expired', failure_reason = 'Stripe Checkout 已过期。',
             updated_at = ?
         WHERE id = ? AND status <> 'paid'`,
      )
      .bind(now, order.id),
  ]);
}

async function getReusableOrder(
  workspaceId: string,
  productId: string,
): Promise<{
  id: string;
  plan_id: string;
  order_type: PurchaseOrderType;
  renewal_subscription_id: string | null;
  configuration_snapshot: string;
  checkout_url: string | null;
  expires_at: number | null;
} | null> {
  const row = await getDatabase()
    .prepare(
      `SELECT id, plan_id, order_type, renewal_subscription_id,
        configuration_snapshot, checkout_url, expires_at
       FROM subscription_purchase_orders
       WHERE workspace_id = ? AND product_id = ?
         AND status IN ('draft', 'checkout_pending')
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(workspaceId, productId)
    .first<{
      id: string;
      plan_id: string;
      order_type: PurchaseOrderType;
      renewal_subscription_id: string | null;
      configuration_snapshot: string;
      checkout_url: string | null;
      expires_at: number | null;
    }>();
  if (!row) return null;
  if (row.expires_at && row.expires_at <= Date.now()) {
    const order = await getPurchaseOrderRow(row.id);
    if (order) {
      await expirePurchaseOrder(order, {
        id: `local_order_expire_${row.id}`,
        type: "checkout.session.expired",
        data: { object: {} },
      });
    }
    return null;
  }
  return row;
}

async function reconcileEndedSubscription(
  workspaceId: string,
  productId: string,
): Promise<void> {
  const current = await getWorkspaceProductCurrentSubscription(
    workspaceId,
    productId,
  );
  if (
    !current ||
    current.status !== "active" ||
    current.currentPeriodEnd > Date.now()
  ) {
    return;
  }
  const now = Date.now();
  const nextStatus: SubscriptionStatus = current.cancelAtPeriodEnd
    ? "canceled"
    : "past_due";
  await getDatabase().batch([
    getDatabase()
      .prepare(
        `UPDATE subscriptions
         SET status = ?, updated_at = ?
         WHERE id = ? AND status = 'active' AND current_period_end <= ?`,
      )
      .bind(nextStatus, now, current.id, now),
    syncWorkspaceSubscriptionSummaryStatement(workspaceId, now),
    upsertWorkspaceProductEntitlementStatement({
      workspaceId,
      productId,
      currentSubscriptionId:
        nextStatus === "canceled" ? null : current.id,
      appInstanceId: null,
      status: nextStatus === "canceled" ? "ended" : "pending",
      now,
    }),
  ]);
}

function assertPurchasablePlan(
  plan: PlanView | null,
): asserts plan is PlanView {
  if (
    !plan ||
    plan.status !== "active" ||
    plan.productStatus !== "active" ||
    plan.templateStatus !== "active" ||
    plan.templateVersionStatus !== "published"
  ) {
    throw new ManagementError(
      "PLAN_NOT_AVAILABLE",
      "所选套餐当前不可购买。",
      400,
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
  const workspace = await getDatabase()
    .prepare("SELECT status FROM workspaces WHERE id = ? LIMIT 1")
    .bind(workspaceId)
    .first<{ status: string }>();
  if (!workspace || workspace.status !== "active") {
    throw new ManagementError(
      "WORKSPACE_NOT_ACTIVE",
      "当前企业工作区不能发起在线付款。",
      403,
    );
  }
}

function assertStripeAmountMatches(
  order: PurchaseOrderRow,
  object: Record<string, unknown>,
): void {
  const amountTotal = object.amount_total;
  const currency = asString(object.currency);
  if (
    typeof amountTotal !== "number" ||
    !Number.isSafeInteger(amountTotal) ||
    amountTotal !== Number(order.amount) ||
    !currency ||
    currency.toUpperCase() !== order.currency.toUpperCase()
  ) {
    throw new ManagementError(
      "STRIPE_AMOUNT_MISMATCH",
      "Stripe 返回的金额或币种与服务器订单不一致，已停止自动入账。",
      409,
    );
  }
}

function isSuccessfulCheckoutEvent(
  type: string,
  object: Record<string, unknown>,
): boolean {
  return (
    (type === "checkout.session.completed" &&
      object.payment_status === "paid") ||
    type === "checkout.session.async_payment_succeeded"
  );
}

function isFailedPaymentEvent(type: string): boolean {
  return (
    type === "checkout.session.async_payment_failed" ||
    type === "payment_intent.payment_failed"
  );
}

function addBillingPeriod(
  start: number,
  interval: BillingInterval,
): number {
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
  const message =
    asString(lastPaymentError.message) ??
    asString(object.failure_message);
  return message ? message.slice(0, 500) : null;
}

function providerIdentifiers(
  event: StripeWebhookEvent,
  order: PurchaseOrderRow,
): {
  providerSessionId: string | null;
  providerPaymentId: string | null;
} {
  const object = event.data.object;
  if (event.type.startsWith("checkout.session.")) {
    return {
      providerSessionId:
        asString(object.id) ?? order.provider_session_id,
      providerPaymentId:
        asString(object.payment_intent) ?? order.provider_payment_id,
    };
  }
  return {
    providerSessionId: order.provider_session_id,
    providerPaymentId:
      asString(object.id) ?? order.provider_payment_id,
  };
}
