import { getD1 } from "@/db";
import { getPlan, ManagementError } from "@/lib/admin/management";
import { randomId } from "@/lib/domain/ids";
import {
  parseTemplateConfiguration,
  resolveTemplateConfiguration,
  type TemplateConfiguration,
} from "@/lib/templates/validation";
import type {
  PaymentInput,
  PaymentStatus,
  SubscriptionInput,
  SubscriptionStatus,
} from "./validation";
import {
  isCurrentSubscriptionStatus,
  isHistoricalSubscriptionStatus,
} from "./validation";

export type {
  PaymentStatus,
  SubscriptionStatus,
} from "./validation";

export interface SubscriptionView {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceStatus: "active" | "suspended" | "disabled";
  productId: string;
  productName: string;
  productSlug: string;
  productStatus: "active" | "inactive";
  planId: string;
  planName: string;
  planPriceAmount: number;
  planCurrency: string;
  planBillingInterval: "month" | "year";
  templateVersionId: string;
  templateName: string;
  templateVersion: number;
  instanceConfiguration: TemplateConfiguration;
  status: SubscriptionStatus;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  createdByUserId: string;
  createdByName: string;
  createdAt: number;
  updatedAt: number;
}

export interface PaymentRecordView {
  id: string;
  workspaceId: string;
  workspaceName: string;
  subscriptionId: string | null;
  productId: string | null;
  productName: string | null;
  planName: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paidAt: number | null;
  paymentMethod: string;
  provider: string;
  providerPaymentId: string | null;
  failureReason: string | null;
  reference: string | null;
  note: string | null;
  recordedByUserId: string;
  recordedByName: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceBillingSummary {
  subscriptions: SubscriptionView[];
  currentSubscriptions: SubscriptionView[];
  historicalSubscriptions: SubscriptionView[];
  payments: PaymentRecordView[];
  recentPayment: PaymentRecordView | null;
}

type SubscriptionRow = {
  id: string;
  workspace_id: string;
  workspace_name: string;
  workspace_status: "active" | "suspended" | "disabled";
  product_id: string;
  product_name: string;
  product_slug: string;
  product_status: "active" | "inactive";
  plan_id: string;
  plan_name: string;
  plan_price_amount: number;
  plan_currency: string;
  plan_billing_interval: "month" | "year";
  template_version_id: string;
  template_name: string;
  template_version: number;
  instance_configuration: string;
  status: SubscriptionStatus;
  current_period_start: number;
  current_period_end: number;
  cancel_at_period_end: number;
  created_by_user_id: string;
  created_by_name: string;
  created_at: number;
  updated_at: number;
};

type PaymentRow = {
  id: string;
  workspace_id: string;
  workspace_name: string;
  subscription_id: string | null;
  product_id: string | null;
  product_name: string | null;
  plan_name: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paid_at: number | null;
  payment_method: string;
  provider: string;
  provider_payment_id: string | null;
  failure_reason: string | null;
  reference: string | null;
  note: string | null;
  recorded_by_user_id: string;
  recorded_by_name: string;
  created_at: number;
  updated_at: number;
};

function toSubscriptionView(row: SubscriptionRow): SubscriptionView {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    workspaceStatus: row.workspace_status,
    productId: row.product_id,
    productName: row.product_name,
    productSlug: row.product_slug,
    productStatus: row.product_status,
    planId: row.plan_id,
    planName: row.plan_name,
    planPriceAmount: Number(row.plan_price_amount),
    planCurrency: row.plan_currency,
    planBillingInterval: row.plan_billing_interval,
    templateVersionId: row.template_version_id,
    templateName: row.template_name,
    templateVersion: Number(row.template_version),
    instanceConfiguration: parseTemplateConfiguration(
      row.instance_configuration,
    ),
    status: row.status,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPaymentView(row: PaymentRow): PaymentRecordView {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    subscriptionId: row.subscription_id,
    productId: row.product_id,
    productName: row.product_name,
    planName: row.plan_name,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    paidAt: row.paid_at,
    paymentMethod: row.payment_method,
    provider: row.provider,
    providerPaymentId: row.provider_payment_id,
    failureReason: row.failure_reason,
    reference: row.reference,
    note: row.note,
    recordedByUserId: row.recorded_by_user_id,
    recordedByName: row.recorded_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const subscriptionSelect = `
  SELECT
    s.id, s.workspace_id, w.name AS workspace_name,
    w.status AS workspace_status, s.product_id, product.name AS product_name,
    product.slug AS product_slug, product.status AS product_status,
    s.plan_id, p.name AS plan_name,
    p.price_amount AS plan_price_amount, p.currency AS plan_currency,
    p.billing_interval AS plan_billing_interval, s.template_version_id,
    template.name AS template_name, template_version.version AS template_version,
    s.instance_configuration, s.status,
    s.current_period_start, s.current_period_end, s.cancel_at_period_end,
    s.created_by_user_id, u.name AS created_by_name,
    s.created_at, s.updated_at
  FROM subscriptions s
  INNER JOIN workspaces w ON w.id = s.workspace_id
  INNER JOIN products product ON product.id = s.product_id
  INNER JOIN plans p ON p.id = s.plan_id
  INNER JOIN app_instance_template_versions template_version
    ON template_version.id = s.template_version_id
  INNER JOIN app_instance_templates template
    ON template.id = template_version.template_id
  INNER JOIN users u ON u.id = s.created_by_user_id`;

const paymentSelect = `
  SELECT
    pr.id, pr.workspace_id, w.name AS workspace_name,
    pr.subscription_id, product.id AS product_id,
    product.name AS product_name, p.name AS plan_name, pr.amount, pr.currency,
    pr.status, pr.paid_at, pr.payment_method, pr.provider,
    pr.provider_payment_id, pr.failure_reason, pr.reference, pr.note,
    pr.recorded_by_user_id, u.name AS recorded_by_name,
    pr.created_at, pr.updated_at
  FROM payment_records pr
  INNER JOIN workspaces w ON w.id = pr.workspace_id
  LEFT JOIN subscriptions s ON s.id = pr.subscription_id
  LEFT JOIN products product ON product.id = s.product_id
  LEFT JOIN plans p ON p.id = s.plan_id
  INNER JOIN users u ON u.id = pr.recorded_by_user_id`;

export async function listSubscriptions(input?: {
  query?: string;
  status?: SubscriptionStatus | "";
}): Promise<SubscriptionView[]> {
  const query = input?.query?.trim() ?? "";
  const status = input?.status ?? "";
  const clauses: string[] = [];
  const bindings: string[] = [];

  if (query) {
    const pattern = `%${query}%`;
    clauses.push(
      "(w.name LIKE ? OR w.contact_email LIKE ? OR p.name LIKE ? OR product.name LIKE ?)",
    );
    bindings.push(pattern, pattern, pattern, pattern);
  }
  if (status) {
    clauses.push("s.status = ?");
    bindings.push(status);
  }

  const statement = getD1().prepare(
    `${subscriptionSelect}
     ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
     ORDER BY s.created_at DESC
     LIMIT 200`,
  );
  const result = await (bindings.length
    ? statement.bind(...bindings)
    : statement
  ).all<SubscriptionRow>();

  return result.results.map(toSubscriptionView);
}

export async function getSubscription(
  subscriptionId: string,
): Promise<SubscriptionView | null> {
  const row = await getD1()
    .prepare(`${subscriptionSelect} WHERE s.id = ? LIMIT 1`)
    .bind(subscriptionId)
    .first<SubscriptionRow>();
  return row ? toSubscriptionView(row) : null;
}

export async function listWorkspaceSubscriptions(
  workspaceId: string,
): Promise<SubscriptionView[]> {
  const result = await getD1()
    .prepare(
      `${subscriptionSelect}
       WHERE s.workspace_id = ?
       ORDER BY s.created_at DESC`,
    )
    .bind(workspaceId)
    .all<SubscriptionRow>();
  return result.results.map(toSubscriptionView);
}

export async function getWorkspaceProductCurrentSubscription(
  workspaceId: string,
  productId: string,
): Promise<SubscriptionView | null> {
  const row = await getD1()
    .prepare(
      `${subscriptionSelect}
       WHERE s.workspace_id = ? AND s.product_id = ?
         AND s.status IN ('manual_pending', 'active', 'past_due', 'paused')
       ORDER BY s.created_at DESC
       LIMIT 1`,
    )
    .bind(workspaceId, productId)
    .first<SubscriptionRow>();
  return row ? toSubscriptionView(row) : null;
}

async function assertWorkspaceExists(workspaceId: string): Promise<void> {
  const workspace = await getD1()
    .prepare("SELECT id FROM workspaces WHERE id = ? LIMIT 1")
    .bind(workspaceId)
    .first<{ id: string }>();
  if (!workspace) {
    throw new ManagementError(
      "CUSTOMER_NOT_FOUND",
      "所选企业客户不存在。",
      400,
    );
  }
}

async function resolvePlanConfiguration(
  planId: string,
  productId: string,
  requestedConfiguration: Record<string, unknown>,
  currentPlanId?: string,
): Promise<{
  templateVersionId: string;
  configuration: TemplateConfiguration;
}> {
  const plan = await getPlan(planId);
  if (!plan) {
    throw new ManagementError("PLAN_NOT_FOUND", "所选套餐不存在。", 400);
  }
  if (plan.productId !== productId) {
    throw new ManagementError(
      "PLAN_PRODUCT_MISMATCH",
      "所选套餐不属于当前订阅产品。",
      400,
    );
  }
  if (plan.status !== "active" && plan.id !== currentPlanId) {
    throw new ManagementError(
      "PLAN_INACTIVE",
      "不能为订阅选择已停用的套餐。",
      400,
    );
  }
  if (
    (plan.templateVersionStatus !== "published" ||
      plan.templateStatus !== "active") &&
    plan.id !== currentPlanId
  ) {
    throw new ManagementError(
      "TEMPLATE_VERSION_UNAVAILABLE",
      "所选套餐绑定的实例模板版本当前不可用于新订阅。",
      400,
    );
  }
  const resolved = resolveTemplateConfiguration({
    schema: plan.templateConfigurationSchema,
    defaults: {
      ...plan.templateDefaultConfiguration,
      ...plan.templateConfiguration,
    },
    planLimits: plan.limits,
    requested: requestedConfiguration,
  });
  if (!resolved.data) {
    throw new ManagementError(
      "INSTANCE_CONFIGURATION_INVALID",
      Object.values(resolved.errors)[0]?.[0] ?? "实例配置不符合模板要求。",
      400,
    );
  }
  return {
    templateVersionId: plan.templateVersionId,
    configuration: resolved.data,
  };
}

async function assertProductAssignable(
  productId: string,
  currentProductId?: string,
): Promise<void> {
  const product = await getD1()
    .prepare("SELECT id, status FROM products WHERE id = ? LIMIT 1")
    .bind(productId)
    .first<{ id: string; status: "active" | "inactive" }>();
  if (!product) {
    throw new ManagementError("PRODUCT_NOT_FOUND", "所选产品不存在。", 400);
  }
  if (product.status !== "active" && product.id !== currentProductId) {
    throw new ManagementError(
      "PRODUCT_INACTIVE",
      "不能为订阅选择已停用的产品。",
      400,
    );
  }
}

async function assertNoOtherCurrentSubscription(
  workspaceId: string,
  productId: string,
  excludeSubscriptionId?: string,
): Promise<void> {
  const statement = getD1().prepare(
    `SELECT id
     FROM subscriptions
     WHERE workspace_id = ? AND product_id = ?
       AND status IN ('manual_pending', 'active', 'past_due', 'paused')
       ${excludeSubscriptionId ? "AND id <> ?" : ""}
     LIMIT 1`,
  );
  const row = await (
    excludeSubscriptionId
      ? statement.bind(workspaceId, productId, excludeSubscriptionId)
      : statement.bind(workspaceId, productId)
  ).first<{ id: string }>();
  if (row) {
    throw new ManagementError(
      "CURRENT_SUBSCRIPTION_EXISTS",
      "该客户的这个产品已经有当前订阅，请先处理现有订阅。",
      409,
    );
  }
}

export function syncWorkspaceSubscriptionSummaryStatement(
  workspaceId: string,
  now: number,
) {
  return getD1()
    .prepare(
      `UPDATE workspaces
       SET plan_id = (
         SELECT plan_id FROM subscriptions
         WHERE workspace_id = ?
           AND status IN ('manual_pending', 'active', 'past_due', 'paused')
         ORDER BY CASE status
           WHEN 'active' THEN 0
           WHEN 'manual_pending' THEN 1
           WHEN 'past_due' THEN 2
           WHEN 'paused' THEN 3
           ELSE 4
         END, created_at DESC
         LIMIT 1
       ),
       subscription_status = COALESCE((
         SELECT status FROM subscriptions
         WHERE workspace_id = ?
           AND status IN ('manual_pending', 'active', 'past_due', 'paused')
         ORDER BY CASE status
           WHEN 'active' THEN 0
           WHEN 'manual_pending' THEN 1
           WHEN 'past_due' THEN 2
           WHEN 'paused' THEN 3
           ELSE 4
         END, created_at DESC
         LIMIT 1
       ), 'not_configured'),
       updated_at = ?
       WHERE id = ?`,
    )
    .bind(workspaceId, workspaceId, now, workspaceId);
}

function cancelOpenCheckoutStatements(
  subscriptionId: string,
  now: number,
): D1PreparedStatement[] {
  const db = getD1();
  return [
    db
      .prepare(
        `UPDATE payment_checkout_sessions
         SET status = 'canceled', updated_at = ?
         WHERE subscription_id = ? AND status IN ('creating', 'open')`,
      )
      .bind(now, subscriptionId),
    db
      .prepare(
        `UPDATE payment_records
         SET status = 'canceled',
             failure_reason = '关联订阅已由管理员取消。',
             updated_at = ?
         WHERE subscription_id = ? AND provider = 'stripe' AND status = 'pending'`,
      )
      .bind(now, subscriptionId),
  ];
}

export async function createSubscription(
  input: SubscriptionInput,
  createdByUserId: string,
): Promise<SubscriptionView> {
  const [, , planConfiguration] = await Promise.all([
    assertWorkspaceExists(input.workspaceId),
    assertProductAssignable(input.productId),
    resolvePlanConfiguration(
      input.planId,
      input.productId,
      input.instanceConfiguration,
    ),
    assertNoOtherCurrentSubscription(input.workspaceId, input.productId),
  ]);

  const id = randomId("sub");
  const now = Date.now();
  const db = getD1();

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO subscriptions (
            id, workspace_id, product_id, plan_id, template_version_id,
            instance_configuration, status, current_period_start,
            current_period_end, cancel_at_period_end, created_by_user_id,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          input.workspaceId,
          input.productId,
          input.planId,
          planConfiguration.templateVersionId,
          JSON.stringify(planConfiguration.configuration),
          input.status,
          input.currentPeriodStart,
          input.currentPeriodEnd,
          input.cancelAtPeriodEnd ? 1 : 0,
          createdByUserId,
          now,
          now,
        ),
      syncWorkspaceSubscriptionSummaryStatement(input.workspaceId, now),
    ]);
  } catch (error) {
    if (error instanceof ManagementError) throw error;
    throw new ManagementError(
      "SUBSCRIPTION_CREATE_FAILED",
      "订阅创建失败，该客户的这个产品可能已经有当前订阅。",
      409,
    );
  }

  const subscription = await getSubscription(id);
  if (!subscription) {
    throw new ManagementError(
      "SUBSCRIPTION_CREATE_FAILED",
      "订阅创建失败。",
      500,
    );
  }
  return subscription;
}

export async function updateSubscription(
  subscriptionId: string,
  input: SubscriptionInput,
): Promise<SubscriptionView> {
  const existing = await getSubscription(subscriptionId);
  if (!existing) {
    throw new ManagementError(
      "SUBSCRIPTION_NOT_FOUND",
      "没有找到该订阅。",
      404,
    );
  }
  if (existing.status === "canceled") {
    throw new ManagementError(
      "HISTORICAL_SUBSCRIPTION_IMMUTABLE",
      "已取消订阅属于历史记录，不能修改；请创建一条新订阅。",
      409,
    );
  }
  if (input.workspaceId !== existing.workspaceId) {
    throw new ManagementError(
      "WORKSPACE_CHANGE_NOT_ALLOWED",
      "不能把订阅转移到其他客户。",
      400,
    );
  }
  if (input.productId !== existing.productId) {
    throw new ManagementError(
      "PRODUCT_CHANGE_NOT_ALLOWED",
      "不能修改订阅所属产品；请保留历史记录并创建新订阅。",
      400,
    );
  }
  const linkedInstance = await getD1()
    .prepare("SELECT id FROM app_instances WHERE subscription_id = ? LIMIT 1")
    .bind(subscriptionId)
    .first<{ id: string }>();
  const [, planConfiguration] = await Promise.all([
    assertProductAssignable(input.productId, existing.productId),
    resolvePlanConfiguration(
      input.planId,
      existing.productId,
      input.instanceConfiguration,
      existing.planId,
    ),
    isCurrentSubscriptionStatus(input.status)
      ? assertNoOtherCurrentSubscription(
          existing.workspaceId,
          existing.productId,
          subscriptionId,
        )
      : Promise.resolve(),
  ]);
  if (
    linkedInstance &&
    (input.planId !== existing.planId ||
      JSON.stringify(planConfiguration.configuration) !==
        JSON.stringify(existing.instanceConfiguration))
  ) {
    throw new ManagementError(
      "INSTANCE_SNAPSHOT_IMMUTABLE",
      "该订阅已经生成应用实例，不能再修改套餐或实例配置。",
      409,
    );
  }

  const now = Date.now();
  try {
    const statements = [
      getD1()
        .prepare(
          `UPDATE subscriptions
           SET plan_id = ?, template_version_id = ?,
             instance_configuration = ?, status = ?, current_period_start = ?,
             current_period_end = ?, cancel_at_period_end = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          input.planId,
          planConfiguration.templateVersionId,
          JSON.stringify(planConfiguration.configuration),
          input.status,
          input.currentPeriodStart,
          input.currentPeriodEnd,
          input.cancelAtPeriodEnd ? 1 : 0,
          now,
          subscriptionId,
        ),
      syncWorkspaceSubscriptionSummaryStatement(existing.workspaceId, now),
    ];
    if (input.status === "canceled") {
      statements.push(...cancelOpenCheckoutStatements(subscriptionId, now));
    }
    await getD1().batch(statements);
  } catch (error) {
    if (error instanceof ManagementError) throw error;
    throw new ManagementError(
      "CURRENT_SUBSCRIPTION_EXISTS",
      "该客户的这个产品已经有当前订阅，不能恢复或重复启用历史订阅。",
      409,
    );
  }

  const subscription = await getSubscription(subscriptionId);
  if (!subscription) {
    throw new ManagementError(
      "SUBSCRIPTION_NOT_FOUND",
      "没有找到该订阅。",
      404,
    );
  }
  return subscription;
}

export async function updateSubscriptionStatus(
  subscriptionId: string,
  status: SubscriptionStatus,
): Promise<SubscriptionView> {
  const existing = await getSubscription(subscriptionId);
  if (!existing) {
    throw new ManagementError(
      "SUBSCRIPTION_NOT_FOUND",
      "没有找到该订阅。",
      404,
    );
  }

  if (existing.status === "canceled") {
    if (status === "canceled") return existing;
    throw new ManagementError(
      "HISTORICAL_SUBSCRIPTION_IMMUTABLE",
      "已取消订阅属于历史记录，不能恢复；请创建一条新订阅。",
      409,
    );
  }

  if (isCurrentSubscriptionStatus(status)) {
    await assertNoOtherCurrentSubscription(
      existing.workspaceId,
      existing.productId,
      subscriptionId,
    );
  }
  const now = Date.now();
  try {
    const statements = [
      getD1()
        .prepare("UPDATE subscriptions SET status = ?, updated_at = ? WHERE id = ?")
        .bind(status, now, subscriptionId),
      syncWorkspaceSubscriptionSummaryStatement(existing.workspaceId, now),
    ];
    if (status === "canceled") {
      statements.push(...cancelOpenCheckoutStatements(subscriptionId, now));
    }
    await getD1().batch(statements);
  } catch (error) {
    if (error instanceof ManagementError) throw error;
    throw new ManagementError(
      "CURRENT_SUBSCRIPTION_EXISTS",
      "该客户的这个产品已经有当前订阅，不能恢复这条历史订阅。",
      409,
    );
  }

  const subscription = await getSubscription(subscriptionId);
  if (!subscription) {
    throw new ManagementError(
      "SUBSCRIPTION_NOT_FOUND",
      "没有找到该订阅。",
      404,
    );
  }
  return subscription;
}

export async function listPaymentRecords(input?: {
  query?: string;
  status?: PaymentStatus | "";
  workspaceId?: string;
  subscriptionId?: string;
}): Promise<PaymentRecordView[]> {
  const query = input?.query?.trim() ?? "";
  const status = input?.status ?? "";
  const clauses: string[] = [];
  const bindings: string[] = [];

  if (query) {
    const pattern = `%${query}%`;
    clauses.push(
      "(w.name LIKE ? OR pr.reference LIKE ? OR pr.payment_method LIKE ?)",
    );
    bindings.push(pattern, pattern, pattern);
  }
  if (status) {
    clauses.push("pr.status = ?");
    bindings.push(status);
  }
  if (input?.workspaceId) {
    clauses.push("pr.workspace_id = ?");
    bindings.push(input.workspaceId);
  }
  if (input?.subscriptionId) {
    clauses.push("pr.subscription_id = ?");
    bindings.push(input.subscriptionId);
  }

  const statement = getD1().prepare(
    `${paymentSelect}
     ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
     ORDER BY pr.created_at DESC
     LIMIT 200`,
  );
  const result = await (bindings.length
    ? statement.bind(...bindings)
    : statement
  ).all<PaymentRow>();

  return result.results.map(toPaymentView);
}

export async function createPaymentRecord(
  input: PaymentInput,
  recordedByUserId: string,
): Promise<PaymentRecordView> {
  await assertWorkspaceExists(input.workspaceId);
  if (input.subscriptionId) {
    const subscription = await getSubscription(input.subscriptionId);
    if (!subscription) {
      throw new ManagementError(
        "SUBSCRIPTION_NOT_FOUND",
        "所选订阅不存在。",
        400,
      );
    }
    if (subscription.workspaceId !== input.workspaceId) {
      throw new ManagementError(
        "SUBSCRIPTION_WORKSPACE_MISMATCH",
        "付款记录的客户与订阅不属于同一工作区。",
        400,
      );
    }
  }

  const id = randomId("pay");
  const now = Date.now();
  await getD1()
    .prepare(
      `INSERT INTO payment_records (
        id, workspace_id, subscription_id, amount, currency, status, paid_at,
        payment_method, reference, note, recorded_by_user_id, created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.workspaceId,
      input.subscriptionId,
      input.amount,
      input.currency,
      input.status,
      input.paidAt,
      input.paymentMethod,
      input.reference,
      input.note,
      recordedByUserId,
      now,
      now,
    )
    .run();

  const row = await getD1()
    .prepare(`${paymentSelect} WHERE pr.id = ? LIMIT 1`)
    .bind(id)
    .first<PaymentRow>();
  if (!row) {
    throw new ManagementError(
      "PAYMENT_CREATE_FAILED",
      "付款记录创建失败。",
      500,
    );
  }
  return toPaymentView(row);
}

export async function getWorkspaceBillingSummary(
  workspaceId: string,
): Promise<WorkspaceBillingSummary> {
  const [subscriptions, payments] = await Promise.all([
    listWorkspaceSubscriptions(workspaceId),
    listPaymentRecords({ workspaceId }),
  ]);
  const currentSubscriptions = subscriptions.filter((subscription) =>
    isCurrentSubscriptionStatus(subscription.status),
  );
  const historicalSubscriptions = subscriptions.filter((subscription) =>
    isHistoricalSubscriptionStatus(subscription.status),
  );
  return {
    subscriptions,
    currentSubscriptions,
    historicalSubscriptions,
    payments,
    recentPayment: payments[0] ?? null,
  };
}
