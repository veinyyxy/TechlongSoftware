import { getDatabase } from "@/db";
import { ManagementError } from "@/lib/admin/management";
import { randomId } from "@/lib/domain/ids";
import type {
  AppInstanceTemplateInput,
  AppInstanceTemplateVersionInput,
  TemplateConfiguration,
  TemplateConfigurationSchema,
  TemplateStatus,
  TemplateVersionStatus,
} from "./validation";
import {
  parseConfigurationSchema,
  parseTemplateConfiguration,
} from "./validation";

export interface AppInstanceTemplateView {
  id: string;
  productId: string;
  productName: string;
  productStatus: "active" | "inactive";
  name: string;
  description: string;
  status: TemplateStatus;
  versionCount: number;
  publishedVersionCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface AppInstanceTemplateVersionView {
  id: string;
  templateId: string;
  templateName: string;
  templateStatus: TemplateStatus;
  productId: string;
  productName: string;
  productStatus: "active" | "inactive";
  version: number;
  configurationSchema: TemplateConfigurationSchema;
  defaultConfiguration: TemplateConfiguration;
  deploymentDriver: string;
  deploymentWorkflowVersion: string;
  status: TemplateVersionStatus;
  createdAt: number;
  updatedAt: number;
}

type TemplateRow = {
  id: string;
  product_id: string;
  product_name: string;
  product_status: "active" | "inactive";
  name: string;
  description: string;
  status: TemplateStatus;
  version_count: number;
  published_version_count: number;
  created_at: number;
  updated_at: number;
};

type TemplateVersionRow = {
  id: string;
  template_id: string;
  template_name: string;
  template_status: TemplateStatus;
  product_id: string;
  product_name: string;
  product_status: "active" | "inactive";
  version: number;
  configuration_schema: string;
  default_configuration: string;
  deployment_driver: string;
  deployment_workflow_version: string;
  status: TemplateVersionStatus;
  created_at: number;
  updated_at: number;
};

function toTemplateView(row: TemplateRow): AppInstanceTemplateView {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    productStatus: row.product_status,
    name: row.name,
    description: row.description,
    status: row.status,
    versionCount: Number(row.version_count),
    publishedVersionCount: Number(row.published_version_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTemplateVersionView(
  row: TemplateVersionRow,
): AppInstanceTemplateVersionView {
  return {
    id: row.id,
    templateId: row.template_id,
    templateName: row.template_name,
    templateStatus: row.template_status,
    productId: row.product_id,
    productName: row.product_name,
    productStatus: row.product_status,
    version: Number(row.version),
    configurationSchema: parseConfigurationSchema(row.configuration_schema),
    defaultConfiguration: parseTemplateConfiguration(
      row.default_configuration,
    ),
    deploymentDriver: row.deployment_driver,
    deploymentWorkflowVersion: row.deployment_workflow_version,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const templateSelect = `
  SELECT template.id, template.product_id, product.name AS product_name,
    product.status AS product_status, template.name, template.description,
    template.status,
    COUNT(version.id) AS version_count,
    SUM(CASE WHEN version.status = 'published' THEN 1 ELSE 0 END)
      AS published_version_count,
    template.created_at, template.updated_at
  FROM app_instance_templates template
  INNER JOIN products product ON product.id = template.product_id
  LEFT JOIN app_instance_template_versions version
    ON version.template_id = template.id`;

const templateVersionSelect = `
  SELECT version.id, version.template_id, template.name AS template_name,
    template.status AS template_status, template.product_id,
    product.name AS product_name, product.status AS product_status,
    version.version, version.configuration_schema,
    version.default_configuration, version.deployment_driver,
    version.deployment_workflow_version, version.status,
    version.created_at, version.updated_at
  FROM app_instance_template_versions version
  INNER JOIN app_instance_templates template ON template.id = version.template_id
  INNER JOIN products product ON product.id = template.product_id`;

export async function listAppInstanceTemplates(input?: {
  query?: string;
  status?: TemplateStatus | "";
  productId?: string;
}): Promise<AppInstanceTemplateView[]> {
  const query = input?.query?.trim() ?? "";
  const status = input?.status ?? "";
  const productId = input?.productId?.trim() ?? "";
  const clauses: string[] = [];
  const bindings: string[] = [];
  if (query) {
    const pattern = `%${query}%`;
    clauses.push(
      "(template.name LIKE ? OR template.description LIKE ? OR product.name LIKE ?)",
    );
    bindings.push(pattern, pattern, pattern);
  }
  if (status) {
    clauses.push("template.status = ?");
    bindings.push(status);
  }
  if (productId) {
    clauses.push("template.product_id = ?");
    bindings.push(productId);
  }

  const statement = getDatabase().prepare(
    `${templateSelect}
     ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
     GROUP BY template.id, template.product_id, product.name, product.status,
       template.name, template.description, template.status,
       template.created_at, template.updated_at
     ORDER BY template.created_at DESC
     LIMIT 200`,
  );
  const result = await (bindings.length
    ? statement.bind(...bindings)
    : statement
  ).all<TemplateRow>();
  return result.results.map(toTemplateView);
}

export async function getAppInstanceTemplate(
  templateId: string,
): Promise<AppInstanceTemplateView | null> {
  const row = await getDatabase()
    .prepare(
      `${templateSelect}
       WHERE template.id = ?
       GROUP BY template.id, template.product_id, product.name, product.status,
         template.name, template.description, template.status,
         template.created_at, template.updated_at
       LIMIT 1`,
    )
    .bind(templateId)
    .first<TemplateRow>();
  return row ? toTemplateView(row) : null;
}

async function assertTemplateProduct(
  productId: string,
  currentProductId?: string,
): Promise<void> {
  const product = await getDatabase()
    .prepare("SELECT id, status FROM products WHERE id = ? LIMIT 1")
    .bind(productId)
    .first<{ id: string; status: "active" | "inactive" }>();
  if (!product) {
    throw new ManagementError("PRODUCT_NOT_FOUND", "所选产品不存在。", 400);
  }
  if (product.status !== "active" && product.id !== currentProductId) {
    throw new ManagementError(
      "PRODUCT_INACTIVE",
      "不能为模板选择已停用的产品。",
      400,
    );
  }
}

export async function createAppInstanceTemplate(
  input: AppInstanceTemplateInput,
): Promise<AppInstanceTemplateView> {
  await assertTemplateProduct(input.productId);
  const id = randomId("tpl");
  const now = Date.now();
  try {
    await getDatabase()
      .prepare(
        `INSERT INTO app_instance_templates
          (id, product_id, name, description, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.productId,
        input.name,
        input.description,
        input.status,
        now,
        now,
      )
      .run();
  } catch {
    throw new ManagementError(
      "TEMPLATE_NAME_CONFLICT",
      "这个产品已经存在同名实例模板。",
      409,
    );
  }
  const template = await getAppInstanceTemplate(id);
  if (!template) {
    throw new ManagementError("TEMPLATE_CREATE_FAILED", "实例模板创建失败。", 500);
  }
  return template;
}

export async function updateAppInstanceTemplate(
  templateId: string,
  input: AppInstanceTemplateInput,
): Promise<AppInstanceTemplateView> {
  const existing = await getAppInstanceTemplate(templateId);
  if (!existing) {
    throw new ManagementError("TEMPLATE_NOT_FOUND", "没有找到该实例模板。", 404);
  }
  if (input.productId !== existing.productId) {
    throw new ManagementError(
      "TEMPLATE_PRODUCT_CHANGE_NOT_ALLOWED",
      "模板创建后不能转移到其他产品。",
      400,
    );
  }
  await assertTemplateProduct(input.productId, existing.productId);
  try {
    await getDatabase()
      .prepare(
        `UPDATE app_instance_templates
         SET name = ?, description = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        input.name,
        input.description,
        input.status,
        Date.now(),
        templateId,
      )
      .run();
  } catch {
    throw new ManagementError(
      "TEMPLATE_NAME_CONFLICT",
      "这个产品已经存在同名实例模板。",
      409,
    );
  }
  const template = await getAppInstanceTemplate(templateId);
  if (!template) {
    throw new ManagementError("TEMPLATE_NOT_FOUND", "没有找到该实例模板。", 404);
  }
  return template;
}

export async function updateAppInstanceTemplateStatus(
  templateId: string,
  status: TemplateStatus,
): Promise<AppInstanceTemplateView> {
  const result = await getDatabase()
    .prepare(
      "UPDATE app_instance_templates SET status = ?, updated_at = ? WHERE id = ?",
    )
    .bind(status, Date.now(), templateId)
    .run();
  if (!result.meta.changes) {
    throw new ManagementError("TEMPLATE_NOT_FOUND", "没有找到该实例模板。", 404);
  }
  const template = await getAppInstanceTemplate(templateId);
  if (!template) {
    throw new ManagementError("TEMPLATE_NOT_FOUND", "没有找到该实例模板。", 404);
  }
  return template;
}

export async function listAppInstanceTemplateVersions(input?: {
  templateId?: string;
  productId?: string;
  status?: TemplateVersionStatus | "";
}): Promise<AppInstanceTemplateVersionView[]> {
  const clauses: string[] = [];
  const bindings: string[] = [];
  if (input?.templateId) {
    clauses.push("version.template_id = ?");
    bindings.push(input.templateId);
  }
  if (input?.productId) {
    clauses.push("template.product_id = ?");
    bindings.push(input.productId);
  }
  if (input?.status) {
    clauses.push("version.status = ?");
    bindings.push(input.status);
  }
  const statement = getDatabase().prepare(
    `${templateVersionSelect}
     ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
     ORDER BY version.version DESC, version.created_at DESC
     LIMIT 300`,
  );
  const result = await (bindings.length
    ? statement.bind(...bindings)
    : statement
  ).all<TemplateVersionRow>();
  return result.results.map(toTemplateVersionView);
}

export async function getAppInstanceTemplateVersion(
  versionId: string,
): Promise<AppInstanceTemplateVersionView | null> {
  const row = await getDatabase()
    .prepare(`${templateVersionSelect} WHERE version.id = ? LIMIT 1`)
    .bind(versionId)
    .first<TemplateVersionRow>();
  return row ? toTemplateVersionView(row) : null;
}

export async function createAppInstanceTemplateVersion(
  templateId: string,
  input: AppInstanceTemplateVersionInput,
): Promise<AppInstanceTemplateVersionView> {
  const template = await getAppInstanceTemplate(templateId);
  if (!template) {
    throw new ManagementError("TEMPLATE_NOT_FOUND", "没有找到该实例模板。", 404);
  }
  if (
    input.status === "published" &&
    (template.status !== "active" || template.productStatus !== "active")
  ) {
    throw new ManagementError(
      "TEMPLATE_NOT_ACTIVE",
      "只有启用产品下的启用模板可以发布版本。",
      400,
    );
  }
  const id = randomId("tplver");
  const now = Date.now();
  try {
    await getDatabase()
      .prepare(
        `INSERT INTO app_instance_template_versions (
          id, template_id, version, configuration_schema,
          default_configuration, deployment_driver,
          deployment_workflow_version, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        templateId,
        input.version,
        JSON.stringify(input.configurationSchema),
        JSON.stringify(input.defaultConfiguration),
        input.deploymentDriver,
        input.deploymentWorkflowVersion,
        input.status,
        now,
        now,
      )
      .run();
  } catch {
    throw new ManagementError(
      "TEMPLATE_VERSION_CONFLICT",
      `模板版本 v${input.version} 已经存在。`,
      409,
    );
  }
  const version = await getAppInstanceTemplateVersion(id);
  if (!version) {
    throw new ManagementError(
      "TEMPLATE_VERSION_CREATE_FAILED",
      "模板版本创建失败。",
      500,
    );
  }
  return version;
}

export async function updateDraftAppInstanceTemplateVersion(
  versionId: string,
  input: AppInstanceTemplateVersionInput,
): Promise<AppInstanceTemplateVersionView> {
  const existing = await getAppInstanceTemplateVersion(versionId);
  if (!existing) {
    throw new ManagementError(
      "TEMPLATE_VERSION_NOT_FOUND",
      "没有找到该模板版本。",
      404,
    );
  }
  if (existing.status !== "draft") {
    throw new ManagementError(
      "TEMPLATE_VERSION_IMMUTABLE",
      "已发布或已归档的模板版本不能修改，请创建新版本。",
      409,
    );
  }
  if (input.version !== existing.version) {
    throw new ManagementError(
      "TEMPLATE_VERSION_NUMBER_IMMUTABLE",
      "模板版本号创建后不能修改。",
      400,
    );
  }
  if (
    input.status === "published" &&
    (existing.templateStatus !== "active" ||
      existing.productStatus !== "active")
  ) {
    throw new ManagementError(
      "TEMPLATE_NOT_ACTIVE",
      "只有启用产品下的启用模板可以发布版本。",
      400,
    );
  }
  await getDatabase()
    .prepare(
      `UPDATE app_instance_template_versions
       SET configuration_schema = ?, default_configuration = ?,
         deployment_driver = ?, deployment_workflow_version = ?,
         status = ?, updated_at = ?
       WHERE id = ? AND status = 'draft'`,
    )
    .bind(
      JSON.stringify(input.configurationSchema),
      JSON.stringify(input.defaultConfiguration),
      input.deploymentDriver,
      input.deploymentWorkflowVersion,
      input.status,
      Date.now(),
      versionId,
    )
    .run();
  const version = await getAppInstanceTemplateVersion(versionId);
  if (!version) {
    throw new ManagementError(
      "TEMPLATE_VERSION_NOT_FOUND",
      "没有找到该模板版本。",
      404,
    );
  }
  return version;
}

export async function archiveAppInstanceTemplateVersion(
  versionId: string,
): Promise<AppInstanceTemplateVersionView> {
  const existing = await getAppInstanceTemplateVersion(versionId);
  if (!existing) {
    throw new ManagementError(
      "TEMPLATE_VERSION_NOT_FOUND",
      "没有找到该模板版本。",
      404,
    );
  }
  if (existing.status === "draft") {
    throw new ManagementError(
      "TEMPLATE_VERSION_NOT_PUBLISHED",
      "草稿版本无需归档，可以继续编辑。",
      400,
    );
  }
  await getDatabase()
    .prepare(
      `UPDATE app_instance_template_versions
       SET status = 'archived', updated_at = ?
       WHERE id = ?`,
    )
    .bind(Date.now(), versionId)
    .run();
  const version = await getAppInstanceTemplateVersion(versionId);
  if (!version) {
    throw new ManagementError(
      "TEMPLATE_VERSION_NOT_FOUND",
      "没有找到该模板版本。",
      404,
    );
  }
  return version;
}
