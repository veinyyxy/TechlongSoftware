import { getD1 } from "@/db";
import { ManagementError } from "@/lib/admin/management";
import {
  getSubscription,
  type SubscriptionStatus,
} from "@/lib/billing/management";
import { randomId } from "@/lib/domain/ids";
import type {
  AppInstanceInput,
  AppInstanceStatus,
} from "./validation";
import {
  canActivateAppInstance,
  isValidAppInstanceAccessUrl,
} from "./validation";

export type { AppInstanceStatus } from "./validation";

export type ProductStatus = "active" | "inactive";
export type AppInstanceProvisioningSource = "manual" | "payment_success";

export interface ProductView {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: ProductStatus;
  createdAt: number;
  updatedAt: number;
}

export interface AppInstanceView {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceStatus: "active" | "suspended" | "disabled";
  productId: string;
  productName: string;
  productSlug: string;
  subscriptionId: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  subscriptionPlanId: string | null;
  subscriptionPlanName: string | null;
  name: string;
  slug: string;
  domain: string | null;
  accessUrl: string;
  sellerApkUrl: string;
  tenantKey: string;
  provisioningSource: AppInstanceProvisioningSource;
  status: AppInstanceStatus;
  provisionedAt: number | null;
  suspendedAt: number | null;
  createdByUserId: string;
  createdByName: string;
  createdAt: number;
  updatedAt: number;
}

type ProductRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: ProductStatus;
  created_at: number;
  updated_at: number;
};

type AppInstanceRow = {
  id: string;
  workspace_id: string;
  workspace_name: string;
  workspace_status: "active" | "suspended" | "disabled";
  product_id: string;
  product_name: string;
  product_slug: string;
  subscription_id: string | null;
  subscription_status: SubscriptionStatus | null;
  subscription_plan_id: string | null;
  subscription_plan_name: string | null;
  name: string;
  slug: string;
  domain: string | null;
  access_url: string;
  seller_apk_url: string;
  tenant_key: string;
  provisioning_source: AppInstanceProvisioningSource;
  status: AppInstanceStatus;
  provisioned_at: number | null;
  suspended_at: number | null;
  created_by_user_id: string;
  created_by_name: string;
  created_at: number;
  updated_at: number;
};

function toProductView(row: ProductRow): ProductView {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAppInstanceView(row: AppInstanceRow): AppInstanceView {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    workspaceStatus: row.workspace_status,
    productId: row.product_id,
    productName: row.product_name,
    productSlug: row.product_slug,
    subscriptionId: row.subscription_id,
    subscriptionStatus: row.subscription_status,
    subscriptionPlanId: row.subscription_plan_id,
    subscriptionPlanName: row.subscription_plan_name,
    name: row.name,
    slug: row.slug,
    domain: row.domain,
    accessUrl: row.access_url,
    sellerApkUrl: row.seller_apk_url,
    tenantKey: row.tenant_key,
    provisioningSource: row.provisioning_source,
    status: row.status,
    provisionedAt: row.provisioned_at,
    suspendedAt: row.suspended_at,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const appInstanceSelect = `
  SELECT
    ai.id, ai.workspace_id, w.name AS workspace_name,
    w.status AS workspace_status, ai.product_id, p.name AS product_name,
    p.slug AS product_slug, ai.subscription_id,
    s.status AS subscription_status, subscription_plan.id AS subscription_plan_id,
    subscription_plan.name AS subscription_plan_name,
    ai.name, ai.slug, ai.domain,
    ai.access_url, ai.seller_apk_url, ai.tenant_key, ai.provisioning_source,
    ai.status, ai.provisioned_at,
    ai.suspended_at, ai.created_by_user_id, u.name AS created_by_name,
    ai.created_at, ai.updated_at
  FROM app_instances ai
  INNER JOIN workspaces w ON w.id = ai.workspace_id
  INNER JOIN products p ON p.id = ai.product_id
  LEFT JOIN subscriptions s ON s.id = ai.subscription_id
  LEFT JOIN plans subscription_plan
    ON subscription_plan.id = s.plan_id
   AND subscription_plan.product_id = ai.product_id
  INNER JOIN users u ON u.id = ai.created_by_user_id`;

export async function listProducts(input?: {
  status?: ProductStatus | "";
}): Promise<ProductView[]> {
  const status = input?.status ?? "";
  const statement = getD1().prepare(
    `SELECT id, name, slug, description, status, created_at, updated_at
     FROM products
     ${status ? "WHERE status = ?" : ""}
     ORDER BY created_at ASC`,
  );
  const result = await (status ? statement.bind(status) : statement).all<ProductRow>();
  return result.results.map(toProductView);
}

export async function getProduct(productId: string): Promise<ProductView | null> {
  const row = await getD1()
    .prepare(
      `SELECT id, name, slug, description, status, created_at, updated_at
       FROM products WHERE id = ? LIMIT 1`,
    )
    .bind(productId)
    .first<ProductRow>();
  return row ? toProductView(row) : null;
}

export async function listAppInstances(input?: {
  query?: string;
  status?: AppInstanceStatus | "";
  workspaceId?: string;
}): Promise<AppInstanceView[]> {
  const query = input?.query?.trim() ?? "";
  const status = input?.status ?? "";
  const clauses: string[] = [];
  const bindings: string[] = [];

  if (query) {
    const pattern = `%${query}%`;
    clauses.push(
      "(ai.name LIKE ? OR ai.slug LIKE ? OR ai.domain LIKE ? OR ai.tenant_key LIKE ? OR w.name LIKE ? OR w.contact_email LIKE ?)",
    );
    bindings.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }
  if (status) {
    clauses.push("ai.status = ?");
    bindings.push(status);
  }
  if (input?.workspaceId) {
    clauses.push("ai.workspace_id = ?");
    bindings.push(input.workspaceId);
  }

  const statement = getD1().prepare(
    `${appInstanceSelect}
     ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
     ORDER BY ai.created_at DESC
     LIMIT 200`,
  );
  const result = await (bindings.length
    ? statement.bind(...bindings)
    : statement
  ).all<AppInstanceRow>();
  return result.results.map(toAppInstanceView);
}

export async function getAppInstance(
  instanceId: string,
): Promise<AppInstanceView | null> {
  const row = await getD1()
    .prepare(`${appInstanceSelect} WHERE ai.id = ? LIMIT 1`)
    .bind(instanceId)
    .first<AppInstanceRow>();
  return row ? toAppInstanceView(row) : null;
}

export async function listWorkspaceAppInstances(
  workspaceId: string,
): Promise<AppInstanceView[]> {
  return listAppInstances({ workspaceId });
}

async function assertWorkspaceExists(workspaceId: string): Promise<void> {
  const workspace = await getD1()
    .prepare("SELECT id FROM workspaces WHERE id = ? LIMIT 1")
    .bind(workspaceId)
    .first<{ id: string }>();
  if (!workspace) {
    throw new ManagementError("CUSTOMER_NOT_FOUND", "所选企业客户不存在。", 400);
  }
}

async function assertProductAssignable(
  productId: string,
  currentProductId?: string,
): Promise<void> {
  const product = await getProduct(productId);
  if (!product) {
    throw new ManagementError("PRODUCT_NOT_FOUND", "所选产品不存在。", 400);
  }
  if (product.status !== "active" && product.id !== currentProductId) {
    throw new ManagementError("PRODUCT_INACTIVE", "不能为实例选择已停用的产品。", 400);
  }
}

async function assertSubscriptionForInstance(
  workspaceId: string,
  productId: string,
  subscriptionId: string | null,
  status: AppInstanceStatus,
): Promise<void> {
  if (!subscriptionId) {
    if (status === "active" && !canActivateAppInstance(null)) {
      throw new ManagementError(
        "ACTIVE_SUBSCRIPTION_REQUIRED",
        "只有关联有效订阅的客户才能将实例标记为已开通。",
        400,
      );
    }
    return;
  }

  const subscription = await getSubscription(subscriptionId);
  if (!subscription) {
    throw new ManagementError("SUBSCRIPTION_NOT_FOUND", "所选订阅不存在。", 400);
  }
  if (subscription.workspaceId !== workspaceId) {
    throw new ManagementError(
      "SUBSCRIPTION_WORKSPACE_MISMATCH",
      "所选订阅不属于当前企业客户。",
      400,
    );
  }
  if (subscription.productId !== productId) {
    throw new ManagementError(
      "SUBSCRIPTION_PRODUCT_MISMATCH",
      "所选订阅不属于当前应用产品。",
      400,
    );
  }
  if (status === "active" && !canActivateAppInstance(subscription.status)) {
    throw new ManagementError(
      "ACTIVE_SUBSCRIPTION_REQUIRED",
      "只有有效订阅的客户才能将实例标记为已开通。",
      400,
    );
  }
}

export function syncWorkspaceAppInstanceStatusStatement(
  workspaceId: string,
  now: number,
) {
  return getD1()
    .prepare(
      `UPDATE workspaces
       SET app_instance_status = COALESCE((
         SELECT status
         FROM app_instances
         WHERE workspace_id = ?
         ORDER BY CASE status
           WHEN 'active' THEN 0
           WHEN 'pending' THEN 1
           WHEN 'failed' THEN 2
           WHEN 'suspended' THEN 3
           ELSE 4
         END, updated_at DESC
         LIMIT 1
       ), 'not_provisioned'), updated_at = ?
       WHERE id = ?`,
    )
    .bind(workspaceId, now, workspaceId);
}

export async function preparePendingAppInstance(input: {
  workspaceId: string;
  workspaceName: string;
  productId: string;
  subscriptionId: string;
  createdByUserId: string;
  now: number;
}): Promise<D1PreparedStatement | null> {
  const db = getD1();
  const product = await db
    .prepare(
      `SELECT id, name
       FROM products
       WHERE id = ? AND status = 'active'
       LIMIT 1`,
    )
    .bind(input.productId)
    .first<{ id: string; name: string }>();
  if (!product) {
    throw new ManagementError(
      "PRODUCT_NOT_FOUND",
      "未找到订阅对应的启用产品，无法准备待开通实例。",
      500,
    );
  }

  const existing = await db
    .prepare(
      `SELECT id, subscription_id, status
       FROM app_instances
       WHERE workspace_id = ? AND product_id = ?
       LIMIT 1`,
    )
    .bind(input.workspaceId, product.id)
    .first<{
      id: string;
      subscription_id: string | null;
      status: AppInstanceStatus;
  }>();
  if (existing) {
    if (existing.subscription_id === input.subscriptionId) {
      return null;
    }
    return db
      .prepare(
        `UPDATE app_instances
         SET subscription_id = ?, status = 'pending', provisioned_at = NULL,
             suspended_at = NULL, updated_at = ?
         WHERE id = ?
           AND (
             subscription_id IS NULL
             OR subscription_id <> ?
             OR status <> 'active'
           )
           AND EXISTS (
             SELECT 1 FROM subscriptions subscription
             WHERE subscription.id = ?
               AND subscription.workspace_id = ?
               AND subscription.product_id = ?
               AND subscription.status = 'active'
           )`,
      )
      .bind(
        input.subscriptionId,
        input.now,
        existing.id,
        input.subscriptionId,
        input.subscriptionId,
        input.workspaceId,
        product.id,
      );
  }

  const id = randomId("app");
  const slug = `pending-${id.replaceAll("_", "-")}`;
  const tenantKey = `pending_${id}`;
  return db
    .prepare(
      `INSERT INTO app_instances (
        id, workspace_id, product_id, subscription_id, name, slug, domain,
        access_url, seller_apk_url, tenant_key, provisioning_source, status, provisioned_at,
        suspended_at, created_by_user_id, created_at, updated_at
      )
      SELECT ?, ?, ?, ?, ?, ?, NULL, '', '', ?, 'payment_success', 'pending',
        NULL, NULL, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM subscriptions subscription
        WHERE subscription.id = ?
          AND subscription.workspace_id = ?
          AND subscription.product_id = ?
          AND subscription.status = 'active'
      )`,
    )
    .bind(
      id,
      input.workspaceId,
      product.id,
      input.subscriptionId,
      `${input.workspaceName} - ${product.name}`,
      slug,
      tenantKey,
      input.createdByUserId,
      input.now,
      input.now,
      input.subscriptionId,
      input.workspaceId,
      product.id,
    );
}

export async function createAppInstance(
  input: AppInstanceInput,
  createdByUserId: string,
): Promise<AppInstanceView> {
  await Promise.all([
    assertWorkspaceExists(input.workspaceId),
    assertProductAssignable(input.productId),
    assertSubscriptionForInstance(
      input.workspaceId,
      input.productId,
      input.subscriptionId,
      input.status,
    ),
  ]);

  const id = randomId("app");
  const now = Date.now();
  const db = getD1();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO app_instances (
            id, workspace_id, product_id, subscription_id, name, slug, domain,
            access_url, seller_apk_url, tenant_key, status, provisioned_at, suspended_at,
            created_by_user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          input.workspaceId,
          input.productId,
          input.subscriptionId,
          input.name,
          input.slug,
          input.domain,
          input.accessUrl,
          input.sellerApkUrl,
          input.tenantKey,
          input.status,
          input.status === "active" ? now : null,
          input.status === "suspended" ? now : null,
          createdByUserId,
          now,
          now,
        ),
      syncWorkspaceAppInstanceStatusStatement(input.workspaceId, now),
    ]);
  } catch (error) {
    if (error instanceof ManagementError) throw error;
    throw new ManagementError(
      "APP_INSTANCE_CONFLICT",
      "实例路径或租户标识已经存在，请使用其他值。",
      409,
    );
  }

  const instance = await getAppInstance(id);
  if (!instance) {
    throw new ManagementError("APP_INSTANCE_CREATE_FAILED", "实例创建失败。", 500);
  }
  return instance;
}

export async function updateAppInstance(
  instanceId: string,
  input: AppInstanceInput,
): Promise<AppInstanceView> {
  const existing = await getAppInstance(instanceId);
  if (!existing) {
    throw new ManagementError("APP_INSTANCE_NOT_FOUND", "没有找到该应用实例。", 404);
  }
  if (input.workspaceId !== existing.workspaceId) {
    throw new ManagementError(
      "WORKSPACE_CHANGE_NOT_ALLOWED",
      "不能将应用实例转移到其他客户。",
      400,
    );
  }
  await Promise.all([
    assertProductAssignable(input.productId, existing.productId),
    assertSubscriptionForInstance(
      input.workspaceId,
      input.productId,
      input.subscriptionId,
      input.status,
    ),
  ]);

  const now = Date.now();
  const provisionedAt =
    input.status === "active" ? existing.provisionedAt ?? now : existing.provisionedAt;
  const suspendedAt = input.status === "suspended" ? now : null;
  try {
    await getD1().batch([
      getD1()
        .prepare(
          `UPDATE app_instances
           SET product_id = ?, subscription_id = ?, name = ?, slug = ?,
             domain = ?, access_url = ?, seller_apk_url = ?, tenant_key = ?, status = ?,
             provisioned_at = ?, suspended_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          input.productId,
          input.subscriptionId,
          input.name,
          input.slug,
          input.domain,
          input.accessUrl,
          input.sellerApkUrl,
          input.tenantKey,
          input.status,
          provisionedAt,
          suspendedAt,
          now,
          instanceId,
        ),
      syncWorkspaceAppInstanceStatusStatement(existing.workspaceId, now),
    ]);
  } catch (error) {
    if (error instanceof ManagementError) throw error;
    throw new ManagementError(
      "APP_INSTANCE_CONFLICT",
      "实例路径或租户标识已经存在，请使用其他值。",
      409,
    );
  }

  const instance = await getAppInstance(instanceId);
  if (!instance) {
    throw new ManagementError("APP_INSTANCE_NOT_FOUND", "没有找到该应用实例。", 404);
  }
  return instance;
}

export async function updateAppInstanceStatus(
  instanceId: string,
  status: AppInstanceStatus,
): Promise<AppInstanceView> {
  const existing = await getAppInstance(instanceId);
  if (!existing) {
    throw new ManagementError("APP_INSTANCE_NOT_FOUND", "没有找到该应用实例。", 404);
  }
  await assertSubscriptionForInstance(
    existing.workspaceId,
    existing.productId,
    existing.subscriptionId,
    status,
  );
  if (status === "active" && !isValidAppInstanceAccessUrl(existing.accessUrl)) {
    throw new ManagementError(
      "ACCESS_URL_REQUIRED",
      "填写有效访问地址后，才能将实例标记为已开通。",
      400,
    );
  }

  const now = Date.now();
  const provisionedAt = status === "active" ? existing.provisionedAt ?? now : existing.provisionedAt;
  const suspendedAt = status === "suspended" ? now : null;
  await getD1().batch([
    getD1()
      .prepare(
        `UPDATE app_instances
         SET status = ?, provisioned_at = ?, suspended_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(status, provisionedAt, suspendedAt, now, instanceId),
    syncWorkspaceAppInstanceStatusStatement(existing.workspaceId, now),
  ]);

  const instance = await getAppInstance(instanceId);
  if (!instance) {
    throw new ManagementError("APP_INSTANCE_NOT_FOUND", "没有找到该应用实例。", 404);
  }
  return instance;
}
