import { getD1 } from "@/db";
import { ManagementError } from "@/lib/admin/management";
import { randomId } from "@/lib/domain/ids";
import type {
  PaymentInput,
  PaymentStatus,
  SubscriptionInput,
  SubscriptionStatus,
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
  planId: string;
  planName: string;
  planPriceAmount: number;
  planCurrency: string;
  planBillingInterval: "month" | "year";
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
  planName: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paidAt: number | null;
  paymentMethod: string;
  reference: string | null;
  note: string | null;
  recordedByUserId: string;
  recordedByName: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceBillingSummary {
  subscription: SubscriptionView | null;
  payments: PaymentRecordView[];
  recentPayment: PaymentRecordView | null;
}

type SubscriptionRow = {
  id: string;
  workspace_id: string;
  workspace_name: string;
  workspace_status: "active" | "suspended" | "disabled";
  plan_id: string;
  plan_name: string;
  plan_price_amount: number;
  plan_currency: string;
  plan_billing_interval: "month" | "year";
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
  plan_name: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paid_at: number | null;
  payment_method: string;
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
    planId: row.plan_id,
    planName: row.plan_name,
    planPriceAmount: Number(row.plan_price_amount),
    planCurrency: row.plan_currency,
    planBillingInterval: row.plan_billing_interval,
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
    planName: row.plan_name,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    paidAt: row.paid_at,
    paymentMethod: row.payment_method,
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
    w.status AS workspace_status, s.plan_id, p.name AS plan_name,
    p.price_amount AS plan_price_amount, p.currency AS plan_currency,
    p.billing_interval AS plan_billing_interval, s.status,
    s.current_period_start, s.current_period_end, s.cancel_at_period_end,
    s.created_by_user_id, u.name AS created_by_name,
    s.created_at, s.updated_at
  FROM subscriptions s
  INNER JOIN workspaces w ON w.id = s.workspace_id
  INNER JOIN plans p ON p.id = s.plan_id
  INNER JOIN users u ON u.id = s.created_by_user_id`;

const paymentSelect = `
  SELECT
    pr.id, pr.workspace_id, w.name AS workspace_name,
    pr.subscription_id, p.name AS plan_name, pr.amount, pr.currency,
    pr.status, pr.paid_at, pr.payment_method, pr.reference, pr.note,
    pr.recorded_by_user_id, u.name AS recorded_by_name,
    pr.created_at, pr.updated_at
  FROM payment_records pr
  INNER JOIN workspaces w ON w.id = pr.workspace_id
  LEFT JOIN subscriptions s ON s.id = pr.subscription_id
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
      "(w.name LIKE ? OR w.contact_email LIKE ? OR p.name LIKE ?)",
    );
    bindings.push(pattern, pattern, pattern);
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

export async function getWorkspaceSubscription(
  workspaceId: string,
): Promise<SubscriptionView | null> {
  const row = await getD1()
    .prepare(`${subscriptionSelect} WHERE s.workspace_id = ? LIMIT 1`)
    .bind(workspaceId)
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

async function assertPlanAssignable(
  planId: string,
  currentPlanId?: string,
): Promise<void> {
  const plan = await getD1()
    .prepare("SELECT id, status FROM plans WHERE id = ? LIMIT 1")
    .bind(planId)
    .first<{ id: string; status: "active" | "inactive" }>();
  if (!plan) {
    throw new ManagementError("PLAN_NOT_FOUND", "所选套餐不存在。", 400);
  }
  if (plan.status !== "active" && plan.id !== currentPlanId) {
    throw new ManagementError(
      "PLAN_INACTIVE",
      "不能为订阅选择已停用的套餐。",
      400,
    );
  }
}

export async function createSubscription(
  input: SubscriptionInput,
  createdByUserId: string,
): Promise<SubscriptionView> {
  await Promise.all([
    assertWorkspaceExists(input.workspaceId),
    assertPlanAssignable(input.planId),
  ]);

  if (await getWorkspaceSubscription(input.workspaceId)) {
    throw new ManagementError(
      "SUBSCRIPTION_EXISTS",
      "该客户已经有订阅，请编辑现有订阅。",
      409,
    );
  }

  const id = randomId("sub");
  const now = Date.now();
  const db = getD1();

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO subscriptions (
            id, workspace_id, plan_id, status, current_period_start,
            current_period_end, cancel_at_period_end, created_by_user_id,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          input.workspaceId,
          input.planId,
          input.status,
          input.currentPeriodStart,
          input.currentPeriodEnd,
          input.cancelAtPeriodEnd ? 1 : 0,
          createdByUserId,
          now,
          now,
        ),
      db
        .prepare(
          `UPDATE workspaces
           SET plan_id = ?, subscription_status = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(input.planId, input.status, now, input.workspaceId),
    ]);
  } catch {
    throw new ManagementError(
      "SUBSCRIPTION_CREATE_FAILED",
      "订阅创建失败，该客户可能已经有订阅。",
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
  if (input.workspaceId !== existing.workspaceId) {
    throw new ManagementError(
      "WORKSPACE_CHANGE_NOT_ALLOWED",
      "不能把订阅转移到其他客户。",
      400,
    );
  }
  await assertPlanAssignable(input.planId, existing.planId);

  const now = Date.now();
  await getD1().batch([
    getD1()
      .prepare(
        `UPDATE subscriptions
         SET plan_id = ?, status = ?, current_period_start = ?,
           current_period_end = ?, cancel_at_period_end = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        input.planId,
        input.status,
        input.currentPeriodStart,
        input.currentPeriodEnd,
        input.cancelAtPeriodEnd ? 1 : 0,
        now,
        subscriptionId,
      ),
    getD1()
      .prepare(
        `UPDATE workspaces
         SET plan_id = ?, subscription_status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(input.planId, input.status, now, existing.workspaceId),
  ]);

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

  const now = Date.now();
  await getD1().batch([
    getD1()
      .prepare("UPDATE subscriptions SET status = ?, updated_at = ? WHERE id = ?")
      .bind(status, now, subscriptionId),
    getD1()
      .prepare(
        "UPDATE workspaces SET subscription_status = ?, updated_at = ? WHERE id = ?",
      )
      .bind(status, now, existing.workspaceId),
  ]);

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
  const [subscription, payments] = await Promise.all([
    getWorkspaceSubscription(workspaceId),
    listPaymentRecords({ workspaceId }),
  ]);
  return {
    subscription,
    payments,
    recentPayment: payments[0] ?? null,
  };
}
