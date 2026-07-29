import { getD1 } from "@/db";
import { randomId, stableId } from "@/lib/domain/ids";
import type { CustomerInput, PlanInput } from "./validation";

export type WorkspaceStatus = "active" | "suspended" | "disabled";
export type PlanStatus = "active" | "inactive";
export type BillingInterval = "month" | "year";
export type SubscriptionStatus =
  | "not_configured"
  | "manual_pending"
  | "pending"
  | "active"
  | "past_due"
  | "paused"
  | "canceled"
  | "cancelled";
export type AppInstanceStatus =
  | "not_provisioned"
  | "pending"
  | "provisioning"
  | "active"
  | "running"
  | "failed"
  | "suspended"
  | "paused"
  | "disabled";

export class ManagementError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export interface PlanView {
  id: string;
  productId: string;
  productName: string;
  productStatus: "active" | "inactive";
  name: string;
  description: string;
  priceAmount: number;
  currency: string;
  billingInterval: BillingInterval;
  status: PlanStatus;
  features: string[];
  limits: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface CustomerListItem {
  id: string;
  name: string;
  contactName: string;
  contactEmail: string;
  status: WorkspaceStatus;
  planName: string | null;
  subscriptionStatus: SubscriptionStatus;
  currentSubscriptionCount: number;
  appInstanceStatus: AppInstanceStatus;
  memberCount: number;
  createdAt: number;
}

export interface CustomerDetail extends CustomerListItem {
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  planId: string | null;
  plan: PlanView | null;
  updatedAt: number;
}

function safeStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function safeStringRecord(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
    );
  } catch {
    return {};
  }
}

function toPlanView(row: {
  id: string;
  product_id: string;
  product_name: string;
  product_status: "active" | "inactive";
  name: string;
  description: string;
  price_amount: number;
  currency: string;
  billing_interval: BillingInterval;
  status: PlanStatus;
  features: string;
  limits: string;
  created_at: number;
  updated_at: number;
}): PlanView {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    productStatus: row.product_status,
    name: row.name,
    description: row.description,
    priceAmount: Number(row.price_amount),
    currency: row.currency,
    billingInterval: row.billing_interval,
    status: row.status,
    features: safeStringArray(row.features),
    limits: safeStringRecord(row.limits),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPlans(input?: {
  query?: string;
  status?: PlanStatus | "";
  productId?: string;
}): Promise<PlanView[]> {
  const query = input?.query?.trim() ?? "";
  const status = input?.status ?? "";
  const productId = input?.productId?.trim() ?? "";
  const clauses: string[] = [];
  const bindings: string[] = [];

  if (query) {
    clauses.push(
      "(plan.name LIKE ? OR plan.description LIKE ? OR product.name LIKE ?)",
    );
    const pattern = `%${query}%`;
    bindings.push(pattern, pattern, pattern);
  }
  if (status) {
    clauses.push("plan.status = ?");
    bindings.push(status);
  }
  if (productId) {
    clauses.push("plan.product_id = ?");
    bindings.push(productId);
  }

  const statement = getD1().prepare(
    `SELECT plan.id, plan.product_id, product.name AS product_name,
      product.status AS product_status, plan.name, plan.description,
      plan.price_amount, plan.currency, plan.billing_interval, plan.status,
      plan.features, plan.limits, plan.created_at, plan.updated_at
     FROM plans plan
     INNER JOIN products product ON product.id = plan.product_id
     ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
     ORDER BY plan.created_at DESC
     LIMIT 200`,
  );
  const result = await (bindings.length
    ? statement.bind(...bindings)
    : statement
  ).all<{
    id: string;
    product_id: string;
    product_name: string;
    product_status: "active" | "inactive";
    name: string;
    description: string;
    price_amount: number;
    currency: string;
    billing_interval: BillingInterval;
    status: PlanStatus;
    features: string;
    limits: string;
    created_at: number;
    updated_at: number;
  }>();

  return result.results.map(toPlanView);
}

export async function getPlan(planId: string): Promise<PlanView | null> {
  const row = await getD1()
    .prepare(
      `SELECT plan.id, plan.product_id, product.name AS product_name,
        product.status AS product_status, plan.name, plan.description,
        plan.price_amount, plan.currency, plan.billing_interval, plan.status,
        plan.features, plan.limits, plan.created_at, plan.updated_at
       FROM plans plan
       INNER JOIN products product ON product.id = plan.product_id
       WHERE plan.id = ?
       LIMIT 1`,
    )
    .bind(planId)
    .first<{
      id: string;
      product_id: string;
      product_name: string;
      product_status: "active" | "inactive";
      name: string;
      description: string;
      price_amount: number;
      currency: string;
      billing_interval: BillingInterval;
      status: PlanStatus;
      features: string;
      limits: string;
      created_at: number;
      updated_at: number;
    }>();

  return row ? toPlanView(row) : null;
}

async function assertPlanProductAssignable(
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
      "不能为套餐选择已停用的产品。",
      400,
    );
  }
}

export async function createPlan(input: PlanInput): Promise<PlanView> {
  await assertPlanProductAssignable(input.productId);
  const id = randomId("pln");
  const now = Date.now();

  try {
    await getD1()
      .prepare(
        `INSERT INTO plans (
          id, product_id, name, description, price_amount, currency, billing_interval,
          status, features, limits, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.productId,
        input.name,
        input.description,
        input.priceAmount,
        input.currency,
        input.billingInterval,
        JSON.stringify(input.features),
        JSON.stringify(input.limits),
        now,
        now,
      )
      .run();
  } catch {
    throw new ManagementError(
      "PLAN_NAME_CONFLICT",
      "这个产品已经存在同名套餐，请使用其他名称。",
      409,
    );
  }

  const plan = await getPlan(id);
  if (!plan) {
    throw new ManagementError("PLAN_CREATE_FAILED", "套餐创建失败。", 500);
  }
  return plan;
}

export async function updatePlan(
  planId: string,
  input: PlanInput,
): Promise<PlanView> {
  const existing = await getPlan(planId);
  if (!existing) {
    throw new ManagementError("PLAN_NOT_FOUND", "没有找到该套餐。", 404);
  }
  if (input.productId !== existing.productId) {
    throw new ManagementError(
      "PLAN_PRODUCT_CHANGE_NOT_ALLOWED",
      "套餐创建后不能转移到其他产品。",
      400,
    );
  }
  await assertPlanProductAssignable(input.productId, existing.productId);

  try {
    const result = await getD1()
      .prepare(
        `UPDATE plans
         SET name = ?, description = ?, price_amount = ?, currency = ?,
           billing_interval = ?, features = ?, limits = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        input.name,
        input.description,
        input.priceAmount,
        input.currency,
        input.billingInterval,
        JSON.stringify(input.features),
        JSON.stringify(input.limits),
        Date.now(),
        planId,
      )
      .run();
    if (!result.meta.changes) {
      throw new ManagementError("PLAN_NOT_FOUND", "没有找到该套餐。", 404);
    }
  } catch (error) {
    if (error instanceof ManagementError) throw error;
    throw new ManagementError(
      "PLAN_NAME_CONFLICT",
      "这个产品已经存在同名套餐，请使用其他名称。",
      409,
    );
  }

  const plan = await getPlan(planId);
  if (!plan) {
    throw new ManagementError("PLAN_NOT_FOUND", "没有找到该套餐。", 404);
  }
  return plan;
}

export async function updatePlanStatus(
  planId: string,
  status: PlanStatus,
): Promise<PlanView> {
  const result = await getD1()
    .prepare("UPDATE plans SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, Date.now(), planId)
    .run();
  if (!result.meta.changes) {
    throw new ManagementError("PLAN_NOT_FOUND", "没有找到该套餐。", 404);
  }

  const plan = await getPlan(planId);
  if (!plan) {
    throw new ManagementError("PLAN_NOT_FOUND", "没有找到该套餐。", 404);
  }
  return plan;
}

export async function listCustomers(input?: {
  query?: string;
  status?: WorkspaceStatus | "";
}): Promise<CustomerListItem[]> {
  const query = input?.query?.trim() ?? "";
  const status = input?.status ?? "";
  const clauses: string[] = [];
  const bindings: string[] = [];

  if (query) {
    clauses.push(
      "(w.name LIKE ? OR w.contact_name LIKE ? OR w.contact_email LIKE ? OR u.email LIKE ?)",
    );
    const pattern = `%${query}%`;
    bindings.push(pattern, pattern, pattern, pattern);
  }
  if (status) {
    clauses.push("w.status = ?");
    bindings.push(status);
  }

  const statement = getD1().prepare(
    `SELECT
      w.id, w.name, w.status, w.subscription_status, w.app_instance_status,
      w.created_at, COALESCE(w.contact_name, u.name) AS contact_name,
      COALESCE(w.contact_email, u.email) AS contact_email,
      p.name AS plan_name, COUNT(wm.id) AS member_count,
      (
        SELECT COUNT(*)
        FROM subscriptions subscription
        WHERE subscription.workspace_id = w.id
          AND subscription.status IN ('manual_pending', 'active', 'past_due', 'paused')
      ) AS current_subscription_count
     FROM workspaces w
     INNER JOIN users u ON u.id = w.owner_id
     LEFT JOIN plans p ON p.id = w.plan_id
     LEFT JOIN workspace_members wm ON wm.workspace_id = w.id
     ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
     GROUP BY w.id, w.name, w.status, w.subscription_status,
       w.app_instance_status, w.created_at, w.contact_name, w.contact_email,
       u.name, u.email, p.name
     ORDER BY w.created_at DESC
     LIMIT 200`,
  );
  const result = await (bindings.length
    ? statement.bind(...bindings)
    : statement
  ).all<{
    id: string;
    name: string;
    status: WorkspaceStatus;
    subscription_status: SubscriptionStatus;
    app_instance_status: AppInstanceStatus;
    created_at: number;
    contact_name: string;
    contact_email: string;
    plan_name: string | null;
    member_count: number;
    current_subscription_count: number;
  }>();

  return result.results.map((row) => ({
    id: row.id,
    name: row.name,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    status: row.status,
    planName: row.plan_name,
    subscriptionStatus: row.subscription_status,
    currentSubscriptionCount: Number(row.current_subscription_count),
    appInstanceStatus: row.app_instance_status,
    memberCount: Number(row.member_count),
    createdAt: row.created_at,
  }));
}

export async function getCustomer(
  workspaceId: string,
): Promise<CustomerDetail | null> {
  const row = await getD1()
    .prepare(
      `SELECT
        w.id, w.name, w.status, w.contact_name, w.contact_email, w.plan_id,
        w.subscription_status, w.app_instance_status, w.created_at, w.updated_at,
        u.id AS owner_id, u.name AS owner_name, u.email AS owner_email,
        p.name AS plan_name, p.description AS plan_description,
        p.price_amount AS plan_price_amount, p.currency AS plan_currency,
        p.billing_interval AS plan_billing_interval, p.status AS plan_status,
        p.features AS plan_features, p.limits AS plan_limits,
        p.created_at AS plan_created_at, p.updated_at AS plan_updated_at,
        pp.id AS plan_product_id, pp.name AS plan_product_name,
        pp.status AS plan_product_status,
        COUNT(wm.id) AS member_count,
        (
          SELECT COUNT(*)
          FROM subscriptions subscription
          WHERE subscription.workspace_id = w.id
            AND subscription.status IN ('manual_pending', 'active', 'past_due', 'paused')
        ) AS current_subscription_count
       FROM workspaces w
       INNER JOIN users u ON u.id = w.owner_id
       LEFT JOIN plans p ON p.id = w.plan_id
       LEFT JOIN products pp ON pp.id = p.product_id
       LEFT JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE w.id = ?
       GROUP BY w.id, w.name, w.status, w.contact_name, w.contact_email,
         w.plan_id, w.subscription_status, w.app_instance_status, w.created_at,
         w.updated_at, u.id, u.name, u.email, p.id
       LIMIT 1`,
    )
    .bind(workspaceId)
    .first<{
      id: string;
      name: string;
      status: WorkspaceStatus;
      contact_name: string | null;
      contact_email: string | null;
      plan_id: string | null;
      subscription_status: SubscriptionStatus;
      app_instance_status: AppInstanceStatus;
      created_at: number;
      updated_at: number;
      owner_id: string;
      owner_name: string;
      owner_email: string;
      plan_name: string | null;
      plan_description: string | null;
      plan_price_amount: number | null;
      plan_currency: string | null;
      plan_billing_interval: BillingInterval | null;
      plan_status: PlanStatus | null;
      plan_features: string | null;
      plan_limits: string | null;
      plan_created_at: number | null;
      plan_updated_at: number | null;
      plan_product_id: string | null;
      plan_product_name: string | null;
      plan_product_status: "active" | "inactive" | null;
      member_count: number;
      current_subscription_count: number;
    }>();

  if (!row) return null;

  const plan =
    row.plan_id &&
    row.plan_name &&
    row.plan_price_amount !== null &&
    row.plan_currency &&
    row.plan_billing_interval &&
    row.plan_status &&
    row.plan_features !== null &&
    row.plan_limits !== null &&
    row.plan_created_at !== null &&
    row.plan_updated_at !== null &&
    row.plan_product_id &&
    row.plan_product_name &&
    row.plan_product_status
      ? toPlanView({
          id: row.plan_id,
          product_id: row.plan_product_id,
          product_name: row.plan_product_name,
          product_status: row.plan_product_status,
          name: row.plan_name,
          description: row.plan_description ?? "",
          price_amount: row.plan_price_amount,
          currency: row.plan_currency,
          billing_interval: row.plan_billing_interval,
          status: row.plan_status,
          features: row.plan_features,
          limits: row.plan_limits,
          created_at: row.plan_created_at,
          updated_at: row.plan_updated_at,
        })
      : null;

  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name ?? row.owner_name,
    contactEmail: row.contact_email ?? row.owner_email,
    status: row.status,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    planId: row.plan_id,
    planName: row.plan_name,
    plan,
    subscriptionStatus: row.subscription_status,
    currentSubscriptionCount: Number(row.current_subscription_count),
    appInstanceStatus: row.app_instance_status,
    memberCount: Number(row.member_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createCustomer(
  input: CustomerInput,
): Promise<CustomerDetail> {
  const email = input.contactEmail.toLowerCase();
  const ownerId = await stableId("usr", email);
  const workspaceId = randomId("wsp");
  const membershipId = await stableId("wsm", `${workspaceId}:${ownerId}`);
  const now = Date.now();
  const db = getD1();

  await db.batch([
    db
      .prepare(
        `INSERT INTO users (
          id, email, name, status, is_platform_admin, created_at, updated_at
        ) VALUES (?, ?, ?, 'active', 0, ?, ?)
        ON CONFLICT(email) DO UPDATE SET updated_at = excluded.updated_at`,
      )
      .bind(ownerId, email, input.contactName, now, now),
    db
      .prepare(
        `INSERT INTO workspaces (
          id, name, owner_id, status, contact_name, contact_email,
          subscription_status, app_instance_status, created_at, updated_at
        ) VALUES (?, ?, ?, 'active', ?, ?, 'not_configured',
          'not_provisioned', ?, ?)`,
      )
      .bind(
        workspaceId,
        input.name,
        ownerId,
        input.contactName,
        email,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO workspace_members (
          id, workspace_id, user_id, role, joined_at
        ) VALUES (?, ?, ?, 'owner', ?)`,
      )
      .bind(membershipId, workspaceId, ownerId, now),
  ]);

  const customer = await getCustomer(workspaceId);
  if (!customer) {
    throw new ManagementError(
      "CUSTOMER_CREATE_FAILED",
      "客户工作区创建失败。",
      500,
    );
  }
  return customer;
}

export async function updateCustomer(
  workspaceId: string,
  input: CustomerInput,
): Promise<CustomerDetail> {
  const result = await getD1()
    .prepare(
      `UPDATE workspaces
       SET name = ?, contact_name = ?, contact_email = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.name,
      input.contactName,
      input.contactEmail.toLowerCase(),
      Date.now(),
      workspaceId,
    )
    .run();
  if (!result.meta.changes) {
    throw new ManagementError("CUSTOMER_NOT_FOUND", "没有找到该客户。", 404);
  }

  const customer = await getCustomer(workspaceId);
  if (!customer) {
    throw new ManagementError("CUSTOMER_NOT_FOUND", "没有找到该客户。", 404);
  }
  return customer;
}

export async function updateCustomerStatus(
  workspaceId: string,
  status: WorkspaceStatus,
): Promise<CustomerDetail> {
  const result = await getD1()
    .prepare("UPDATE workspaces SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, Date.now(), workspaceId)
    .run();
  if (!result.meta.changes) {
    throw new ManagementError("CUSTOMER_NOT_FOUND", "没有找到该客户。", 404);
  }

  const customer = await getCustomer(workspaceId);
  if (!customer) {
    throw new ManagementError("CUSTOMER_NOT_FOUND", "没有找到该客户。", 404);
  }
  return customer;
}
