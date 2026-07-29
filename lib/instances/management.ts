import { getDatabase } from "@/db";
import { ManagementError } from "@/lib/admin/management";
import {
  getSubscription,
  type SubscriptionStatus,
} from "@/lib/billing/management";
import { randomId } from "@/lib/domain/ids";
import { upsertWorkspaceProductEntitlementStatement } from "@/lib/entitlements/management";
import {
  parseTemplateConfiguration,
  type TemplateConfiguration,
} from "@/lib/templates/validation";
import type {
  AppInstanceInput,
  AppInstanceStatus,
  CreateAppInstanceInput,
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
  currentSubscriptionId: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  subscriptionPlanId: string | null;
  subscriptionPlanName: string | null;
  templateVersionId: string | null;
  templateName: string | null;
  templateVersion: number | null;
  configurationSnapshot: TemplateConfiguration;
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
  current_subscription_id: string | null;
  subscription_status: SubscriptionStatus | null;
  subscription_plan_id: string | null;
  subscription_plan_name: string | null;
  template_version_id: string | null;
  template_name: string | null;
  template_version: number | null;
  configuration_snapshot: string;
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
    currentSubscriptionId: row.current_subscription_id,
    subscriptionStatus: row.subscription_status,
    subscriptionPlanId: row.subscription_plan_id,
    subscriptionPlanName: row.subscription_plan_name,
    templateVersionId: row.template_version_id,
    templateName: row.template_name,
    templateVersion:
      row.template_version === null ? null : Number(row.template_version),
    configurationSnapshot: parseTemplateConfiguration(
      row.configuration_snapshot,
    ),
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
    entitlement.current_subscription_id,
    COALESCE(current_subscription.status, s.status) AS subscription_status,
    COALESCE(current_plan.id, subscription_plan.id) AS subscription_plan_id,
    COALESCE(current_plan.name, subscription_plan.name) AS subscription_plan_name,
    ai.template_version_id, template.name AS template_name,
    template_version.version AS template_version,
    ai.configuration_snapshot,
    ai.name, ai.slug, ai.domain,
    ai.access_url, ai.seller_apk_url, ai.tenant_key, ai.provisioning_source,
    ai.status, ai.provisioned_at,
    ai.suspended_at, ai.created_by_user_id, u.name AS created_by_name,
    ai.created_at, ai.updated_at
  FROM app_instances ai
  INNER JOIN workspaces w ON w.id = ai.workspace_id
  INNER JOIN products p ON p.id = ai.product_id
  LEFT JOIN subscriptions s ON s.id = ai.subscription_id
  LEFT JOIN workspace_product_entitlements entitlement
    ON entitlement.workspace_id = ai.workspace_id
   AND entitlement.product_id = ai.product_id
  LEFT JOIN subscriptions current_subscription
    ON current_subscription.id = entitlement.current_subscription_id
  LEFT JOIN plans current_plan
    ON current_plan.id = current_subscription.plan_id
   AND current_plan.product_id = ai.product_id
  LEFT JOIN plans subscription_plan
    ON subscription_plan.id = s.plan_id
   AND subscription_plan.product_id = ai.product_id
  LEFT JOIN app_instance_template_versions template_version
    ON template_version.id = ai.template_version_id
  LEFT JOIN app_instance_templates template
    ON template.id = template_version.template_id
  INNER JOIN users u ON u.id = ai.created_by_user_id`;

export async function listProducts(input?: {
  status?: ProductStatus | "";
}): Promise<ProductView[]> {
  const status = input?.status ?? "";
  const statement = getDatabase().prepare(
    `SELECT id, name, slug, description, status, created_at, updated_at
     FROM products
     ${status ? "WHERE status = ?" : ""}
     ORDER BY created_at ASC`,
  );
  const result = await (status ? statement.bind(status) : statement).all<ProductRow>();
  return result.results.map(toProductView);
}

export async function getProduct(productId: string): Promise<ProductView | null> {
  const row = await getDatabase()
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

  const statement = getDatabase().prepare(
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
  const row = await getDatabase()
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
  const workspace = await getDatabase()
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
  return getDatabase()
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
  templateVersionId: string;
  configurationSnapshot: TemplateConfiguration;
  createdByUserId: string;
  now: number;
}): Promise<DatabasePreparedStatement | null> {
  const db = getDatabase();
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
    return null;
  }

  const id = randomId("app");
  const slug = `pending-${id.replaceAll("_", "-")}`;
  const tenantKey = `pending_${id}`;
  return db
    .prepare(
      `INSERT INTO app_instances (
        id, workspace_id, product_id, subscription_id, template_version_id,
        configuration_snapshot, name, slug, domain,
        access_url, seller_apk_url, tenant_key, provisioning_source, status, provisioned_at,
        suspended_at, created_by_user_id, created_at, updated_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, NULL, '', '', ?, 'payment_success', 'pending',
        NULL, NULL, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM subscriptions subscription
        WHERE subscription.id = ?
          AND subscription.workspace_id = ?
          AND subscription.product_id = ?
          AND subscription.status = 'active'
      )
      ON CONFLICT (id) DO NOTHING`,
    )
    .bind(
      id,
      input.workspaceId,
      product.id,
      input.subscriptionId,
      input.templateVersionId,
      JSON.stringify(input.configurationSnapshot),
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
  const subscription = input.subscriptionId
    ? await getSubscription(input.subscriptionId)
    : null;
  if (input.subscriptionId && !subscription) {
    throw new ManagementError(
      "SUBSCRIPTION_NOT_FOUND",
      "所选订阅不存在。",
      400,
    );
  }

  const id = randomId("app");
  const now = Date.now();
  const db = getDatabase();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO app_instances (
            id, workspace_id, product_id, subscription_id, template_version_id,
            configuration_snapshot, name, slug, domain,
            access_url, seller_apk_url, tenant_key, status, provisioned_at, suspended_at,
            created_by_user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          input.workspaceId,
          input.productId,
          input.subscriptionId,
          subscription?.templateVersionId ?? null,
          JSON.stringify(subscription?.instanceConfiguration ?? {}),
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
      upsertWorkspaceProductEntitlementStatement({
        workspaceId: input.workspaceId,
        productId: input.productId,
        currentSubscriptionId: input.subscriptionId,
        appInstanceId: id,
        status:
          input.status === "active"
            ? "active"
            : input.status === "suspended"
              ? "suspended"
              : "pending",
        now,
      }),
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

export async function createAppInstanceForSubscription(
  input: CreateAppInstanceInput,
  createdByUserId: string,
): Promise<AppInstanceView> {
  const subscription = await getSubscription(input.subscriptionId);
  if (!subscription) {
    throw new ManagementError(
      "SUBSCRIPTION_NOT_FOUND",
      "所选订阅不存在。",
      400,
    );
  }
  if (subscription.status === "canceled") {
    throw new ManagementError(
      "SUBSCRIPTION_NOT_CURRENT",
      "已取消的历史订阅不能用于创建应用实例。",
      400,
    );
  }

  return createAppInstance(
    {
      ...input,
      workspaceId: subscription.workspaceId,
      productId: subscription.productId,
      subscriptionId: subscription.id,
    },
    createdByUserId,
  );
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
  if (input.productId !== existing.productId) {
    throw new ManagementError(
      "PRODUCT_CHANGE_NOT_ALLOWED",
      "应用实例创建后不能更换所属产品。",
      400,
    );
  }
  if (input.subscriptionId !== existing.subscriptionId) {
    throw new ManagementError(
      "SUBSCRIPTION_CHANGE_NOT_ALLOWED",
      "应用实例创建后不能更换订阅或模板快照。",
      400,
    );
  }
  await Promise.all([
    assertProductAssignable(input.productId, existing.productId),
    assertSubscriptionForInstance(
      input.workspaceId,
      input.productId,
      existing.currentSubscriptionId ?? input.subscriptionId,
      input.status,
    ),
  ]);

  const now = Date.now();
  const provisionedAt =
    input.status === "active" ? existing.provisionedAt ?? now : existing.provisionedAt;
  const suspendedAt = input.status === "suspended" ? now : null;
  try {
    await getDatabase().batch([
      getDatabase()
        .prepare(
          `UPDATE app_instances
           SET name = ?, slug = ?,
             domain = ?, access_url = ?, seller_apk_url = ?, tenant_key = ?, status = ?,
             provisioned_at = ?, suspended_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(
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
      upsertWorkspaceProductEntitlementStatement({
        workspaceId: existing.workspaceId,
        productId: existing.productId,
        currentSubscriptionId:
          existing.currentSubscriptionId ?? existing.subscriptionId,
        appInstanceId: existing.id,
        status:
          input.status === "active"
            ? "active"
            : input.status === "suspended"
              ? "suspended"
              : "pending",
        now,
      }),
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
    existing.currentSubscriptionId ?? existing.subscriptionId,
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
  await getDatabase().batch([
    getDatabase()
      .prepare(
        `UPDATE app_instances
         SET status = ?, provisioned_at = ?, suspended_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(status, provisionedAt, suspendedAt, now, instanceId),
    upsertWorkspaceProductEntitlementStatement({
      workspaceId: existing.workspaceId,
      productId: existing.productId,
      currentSubscriptionId:
        existing.currentSubscriptionId ?? existing.subscriptionId,
      appInstanceId: existing.id,
      status:
        status === "active"
          ? "active"
          : status === "suspended"
            ? "suspended"
            : "pending",
      now,
    }),
    syncWorkspaceAppInstanceStatusStatement(existing.workspaceId, now),
  ]);

  const instance = await getAppInstance(instanceId);
  if (!instance) {
    throw new ManagementError("APP_INSTANCE_NOT_FOUND", "没有找到该应用实例。", 404);
  }
  return instance;
}
