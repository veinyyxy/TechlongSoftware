export type FieldErrors = Record<string, string[]>;
export type TemplateStatus = "active" | "inactive";
export type TemplateVersionStatus = "draft" | "published" | "archived";
export type TemplateFieldType =
  | "text"
  | "select"
  | "number"
  | "boolean"
  | "color";
export type TemplateFieldSource = "customer" | "plan_limit";
export type TemplateConfigurationValue = string | number | boolean;
export type TemplateConfiguration = Record<string, TemplateConfigurationValue>;

export interface TemplateConfigurationField {
  key: string;
  label: string;
  type: TemplateFieldType;
  source: TemplateFieldSource;
  required: boolean;
  options?: string[];
  limitKey?: string;
  min?: number;
  max?: number;
}

export interface TemplateConfigurationSchema {
  fields: TemplateConfigurationField[];
}

export interface AppInstanceTemplateInput {
  productId: string;
  name: string;
  description: string;
  status: TemplateStatus;
}

export interface AppInstanceTemplateVersionInput {
  version: number;
  configurationSchema: TemplateConfigurationSchema;
  defaultConfiguration: TemplateConfiguration;
  deploymentDriver: string;
  deploymentWorkflowVersion: string;
  status: "draft" | "published";
}

export interface ValidationResult<T> {
  data: T | null;
  errors: FieldErrors;
}

const sensitiveKeyPattern =
  /(?:^|_)(?:secret|password|token|credential|private_key|api_key)(?:_|$)/i;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function addError(errors: FieldErrors, field: string, message: string) {
  errors[field] = [...(errors[field] ?? []), message];
}

function validId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(value);
}

export function isTemplateStatus(value: unknown): value is TemplateStatus {
  return value === "active" || value === "inactive";
}

export function isTemplateVersionStatus(
  value: unknown,
): value is TemplateVersionStatus {
  return value === "draft" || value === "published" || value === "archived";
}

function isTemplateFieldType(value: unknown): value is TemplateFieldType {
  return (
    value === "text" ||
    value === "select" ||
    value === "number" ||
    value === "boolean" ||
    value === "color"
  );
}

function isTemplateFieldSource(value: unknown): value is TemplateFieldSource {
  return value === "customer" || value === "plan_limit";
}

export function parseConfigurationSchema(
  value: string,
): TemplateConfigurationSchema {
  try {
    const parsed = JSON.parse(value) as unknown;
    const validated = validateConfigurationSchema(parsed);
    return validated.data ?? { fields: [] };
  } catch {
    return { fields: [] };
  }
}

export function parseTemplateConfiguration(
  value: string,
): TemplateConfiguration {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: TemplateConfiguration = {};
    for (const [key, fieldValue] of Object.entries(parsed)) {
      if (
        typeof fieldValue === "string" ||
        typeof fieldValue === "number" ||
        typeof fieldValue === "boolean"
      ) {
        result[key] = fieldValue;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function validateConfigurationSchema(
  value: unknown,
): ValidationResult<TemplateConfigurationSchema> {
  const input = asRecord(value);
  const errors: FieldErrors = {};
  if (!Array.isArray(input.fields)) {
    addError(errors, "configurationSchema", "配置字段必须是 fields 数组。");
    return { data: null, errors };
  }
  if (input.fields.length > 30) {
    addError(errors, "configurationSchema", "配置字段最多 30 项。");
  }

  const fields: TemplateConfigurationField[] = [];
  const keys = new Set<string>();
  input.fields.forEach((rawField, index) => {
    const field = asRecord(rawField);
    const prefix = `configurationSchema.fields.${index}`;
    const key = asTrimmedString(field.key);
    const label = asTrimmedString(field.label);
    const type = field.type;
    const source = field.source;
    const required = field.required;
    const limitKey = asTrimmedString(field.limitKey);

    if (!/^[a-z][A-Za-z0-9_]{1,63}$/.test(key)) {
      addError(errors, prefix, "字段 key 必须以小写字母开头，只能包含字母、数字和下划线。");
    } else if (sensitiveKeyPattern.test(key)) {
      addError(errors, prefix, "模板配置不能保存密码、令牌或密钥字段。");
    } else if (keys.has(key)) {
      addError(errors, prefix, "配置字段 key 不能重复。");
    }
    keys.add(key);

    if (label.length < 1 || label.length > 80) {
      addError(errors, prefix, "字段名称需要为 1–80 个字符。");
    }
    if (!isTemplateFieldType(type)) {
      addError(errors, prefix, "字段类型不受支持。");
    }
    if (!isTemplateFieldSource(source)) {
      addError(errors, prefix, "字段来源必须是 customer 或 plan_limit。");
    }
    if (typeof required !== "boolean") {
      addError(errors, prefix, "required 必须是布尔值。");
    }

    const options = Array.isArray(field.options)
      ? field.options.map(asTrimmedString).filter(Boolean)
      : undefined;
    if (type === "select" && (!options?.length || options.length > 30)) {
      addError(errors, prefix, "下拉字段必须提供 1–30 个选项。");
    }
    if (options?.some((option) => option.length > 80)) {
      addError(errors, prefix, "选项名称不能超过 80 个字符。");
    }
    if (source === "plan_limit" && (!limitKey || limitKey.length > 60)) {
      addError(errors, prefix, "套餐限制字段必须提供有效的 limitKey。");
    }
    if (source === "plan_limit" && type !== "number") {
      addError(errors, prefix, "套餐限制字段当前只支持 number 类型。");
    }

    const min = typeof field.min === "number" ? field.min : undefined;
    const max = typeof field.max === "number" ? field.max : undefined;
    if (
      (min !== undefined && !Number.isFinite(min)) ||
      (max !== undefined && !Number.isFinite(max)) ||
      (min !== undefined && max !== undefined && max < min)
    ) {
      addError(errors, prefix, "数字字段的 min/max 范围不正确。");
    }

    if (
      key &&
      label &&
      isTemplateFieldType(type) &&
      isTemplateFieldSource(source) &&
      typeof required === "boolean"
    ) {
      fields.push({
        key,
        label,
        type,
        source,
        required,
        ...(options?.length ? { options } : {}),
        ...(limitKey ? { limitKey } : {}),
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
      });
    }
  });

  return {
    data: Object.keys(errors).length ? null : { fields },
    errors,
  };
}

function normalizeValue(
  field: TemplateConfigurationField,
  value: unknown,
): TemplateConfigurationValue | null {
  if (field.type === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "on" || value === "1") return true;
    if (value === "false" || value === "0" || value === "") return false;
    return null;
  }
  if (field.type === "number") {
    const numberValue =
      typeof value === "number" ? value : Number(String(value ?? "").trim());
    if (!Number.isFinite(numberValue)) return null;
    if (field.min !== undefined && numberValue < field.min) return null;
    if (field.max !== undefined && numberValue > field.max) return null;
    return numberValue;
  }
  if (typeof value !== "string") return null;
  const stringValue = value.trim();
  if (stringValue.length > 200) return null;
  if (field.type === "color" && !/^#[0-9a-fA-F]{6}$/.test(stringValue)) {
    return null;
  }
  if (
    field.type === "select" &&
    !field.options?.includes(stringValue)
  ) {
    return null;
  }
  return stringValue;
}

export function resolveTemplateConfiguration(input: {
  schema: TemplateConfigurationSchema;
  defaults: TemplateConfiguration;
  planLimits: Record<string, string>;
  requested: Record<string, unknown>;
}): ValidationResult<TemplateConfiguration> {
  const errors: FieldErrors = {};
  const allowedKeys = new Set(input.schema.fields.map((field) => field.key));
  for (const key of Object.keys(input.requested)) {
    if (!allowedKeys.has(key)) {
      addError(errors, "instanceConfiguration", `不允许提交未知配置字段：${key}。`);
    }
  }

  const resolved: TemplateConfiguration = {};
  for (const field of input.schema.fields) {
    const rawValue =
      field.source === "plan_limit"
        ? input.planLimits[field.limitKey ?? ""]
        : Object.hasOwn(input.requested, field.key)
          ? input.requested[field.key]
          : input.defaults[field.key];
    const normalized = normalizeValue(field, rawValue);
    const empty = normalized === null || normalized === "";
    if (empty && field.required) {
      const message =
        field.source === "plan_limit"
          ? `套餐限制中缺少“${field.limitKey}”，不能生成“${field.label}”。`
          : `请填写“${field.label}”。`;
      addError(
        errors,
        field.source === "plan_limit" ? "limits" : `instanceConfiguration.${field.key}`,
        message,
      );
      continue;
    }
    if (normalized === null) {
      addError(
        errors,
        `instanceConfiguration.${field.key}`,
        `“${field.label}”的值不符合模板要求。`,
      );
      continue;
    }
    resolved[field.key] = normalized;
  }

  return {
    data: Object.keys(errors).length ? null : resolved,
    errors,
  };
}

export function validateTemplatePlanLimits(input: {
  schema: TemplateConfigurationSchema;
  planLimits: Record<string, string>;
}): ValidationResult<TemplateConfiguration> {
  const errors: FieldErrors = {};
  const resolved: TemplateConfiguration = {};
  for (const field of input.schema.fields) {
    if (field.source !== "plan_limit") continue;
    const normalized = normalizeValue(
      field,
      input.planLimits[field.limitKey ?? ""],
    );
    if (normalized === null || normalized === "") {
      addError(
        errors,
        "limits",
        `套餐限制必须提供符合模板要求的“${field.limitKey ?? field.label}”。`,
      );
      continue;
    }
    resolved[field.key] = normalized;
  }
  return {
    data: Object.keys(errors).length ? null : resolved,
    errors,
  };
}

export function validateAppInstanceTemplateInput(
  value: unknown,
): ValidationResult<AppInstanceTemplateInput> {
  const input = asRecord(value);
  const errors: FieldErrors = {};
  const productId = asTrimmedString(input.productId);
  const name = asTrimmedString(input.name);
  const description = asTrimmedString(input.description);
  const status = input.status;

  if (!validId(productId)) {
    addError(errors, "productId", "请选择模板所属产品。");
  }
  if (name.length < 2 || name.length > 100) {
    addError(errors, "name", "模板名称需要为 2–100 个字符。");
  }
  if (description.length > 500) {
    addError(errors, "description", "模板说明不能超过 500 个字符。");
  }
  if (!isTemplateStatus(status)) {
    addError(errors, "status", "请选择有效的模板状态。");
  }

  return {
    data:
      Object.keys(errors).length === 0
        ? {
            productId,
            name,
            description,
            status: status as TemplateStatus,
          }
        : null,
    errors,
  };
}

export function validateAppInstanceTemplateVersionInput(
  value: unknown,
): ValidationResult<AppInstanceTemplateVersionInput> {
  const input = asRecord(value);
  const errors: FieldErrors = {};
  const version = input.version;
  const schemaResult = validateConfigurationSchema(input.configurationSchema);
  const rawDefaults = asRecord(input.defaultConfiguration);
  const deploymentDriver =
    asTrimmedString(input.deploymentDriver) || "manual";
  const deploymentWorkflowVersion =
    asTrimmedString(input.deploymentWorkflowVersion) || "v1";
  const status = input.status;

  if (
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    version > 10_000
  ) {
    addError(errors, "version", "模板版本必须是 1–10000 的整数。");
  }
  Object.assign(errors, schemaResult.errors);
  if (deploymentDriver !== "manual") {
    addError(
      errors,
      "deploymentDriver",
      "当前版本只允许 manual 部署驱动；自动部署流程将在后续阶段单独实现。",
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(deploymentWorkflowVersion)) {
    addError(errors, "deploymentWorkflowVersion", "部署流程版本格式不正确。");
  }
  if (status !== "draft" && status !== "published") {
    addError(errors, "status", "新版本只能保存为草稿或已发布。");
  }

  const defaultConfiguration: TemplateConfiguration = {};
  const schema = schemaResult.data;
  if (schema) {
    const fields = new Map(schema.fields.map((field) => [field.key, field]));
    for (const [key, rawValue] of Object.entries(rawDefaults)) {
      const field = fields.get(key);
      if (!field) {
        addError(errors, "defaultConfiguration", `默认配置包含未知字段：${key}。`);
        continue;
      }
      if (field.source !== "customer") {
        addError(errors, "defaultConfiguration", `套餐限制字段“${key}”不能设置模板默认值。`);
        continue;
      }
      const normalized = normalizeValue(field, rawValue);
      if (normalized === null) {
        addError(errors, "defaultConfiguration", `字段“${key}”的默认值不正确。`);
      } else {
        defaultConfiguration[key] = normalized;
      }
    }
  }

  return {
    data:
      Object.keys(errors).length === 0 && schema
        ? {
            version: version as number,
            configurationSchema: schema,
            defaultConfiguration,
            deploymentDriver,
            deploymentWorkflowVersion,
            status: status as "draft" | "published",
          }
        : null,
    errors,
  };
}
