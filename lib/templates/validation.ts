export type FieldErrors = Record<string, string[]>;
export type TemplateStatus = "active" | "inactive";
export type TemplateVersionStatus = "draft" | "published" | "archived";
export type TemplateFieldType =
  | "text"
  | "select"
  | "number"
  | "integer"
  | "boolean"
  | "color";
export type TemplateFieldSource = "customer" | "plan" | "plan_limit";
export type TemplateFieldFormat = "merchant_username";
export type TemplateConfigurationValue = string | number | boolean | null;
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
  minLength?: number;
  maxLength?: number;
  nullable?: boolean;
  nullLabel?: string;
  group?: string;
  description?: string;
  placeholder?: string;
  unit?: string;
  outputPath?: string;
  format?: TemplateFieldFormat;
}

export interface TemplateLessThanRule {
  type: "less_than";
  leftKey: string;
  rightKey: string;
  message?: string;
}

export type TemplateConfigurationRule = TemplateLessThanRule;

export interface TemplateConfigurationSchema {
  schemaVersion?: 1 | 2;
  contract?: string;
  fields: TemplateConfigurationField[];
  rules?: TemplateConfigurationRule[];
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

interface NormalizedValue {
  valid: boolean;
  empty: boolean;
  value?: TemplateConfigurationValue;
}

const forbiddenNamePattern =
  /(?:secret|password|passwd|token|credential|privatekey|apikey|mtls|stripekey)/i;
const outputRootPattern = /^\/(?:entitlements|default_store|first_owner)\//;
const pointerSegmentPattern = /^[A-Za-z0-9._-]+$/;
const reservedPointerSegments = new Set(["__proto__", "prototype", "constructor"]);
const speedFeastQuotaMinimums = new Map<string, number>([
  ["/entitlements/buyer.accounts.max", 0],
  ["/entitlements/buyer.concurrent_access.max", 0],
  ["/entitlements/stores.max", 1],
  ["/entitlements/merchant.active_users.max", 1],
]);
const speedFeastPolicyRanges = new Map<string, { min: number; max: number }>([
  ["/entitlements/buyer.access.lease_seconds", { min: 60, max: 86400 }],
  ["/entitlements/buyer.access.heartbeat_seconds", { min: 30, max: 3600 }],
]);
const speedFeastControlV1Paths = new Map<
  string,
  { source: TemplateFieldSource; type: TemplateFieldType }
>([
  ["/entitlements/buyer.accounts.max", { source: "plan", type: "integer" }],
  ["/entitlements/buyer.concurrent_access.max", { source: "plan", type: "integer" }],
  ["/entitlements/stores.max", { source: "plan", type: "integer" }],
  ["/entitlements/merchant.active_users.max", { source: "plan", type: "integer" }],
  ["/entitlements/branding.custom_theme.enabled", { source: "plan", type: "boolean" }],
  ["/entitlements/branding.merchant_editable", { source: "plan", type: "boolean" }],
  ["/entitlements/buyer.access.lease_seconds", { source: "plan", type: "integer" }],
  ["/entitlements/buyer.access.heartbeat_seconds", { source: "plan", type: "integer" }],
  ["/default_store/name", { source: "customer", type: "text" }],
  ["/default_store/buyer_theme/brightness", { source: "customer", type: "select" }],
  ["/default_store/buyer_theme/primary", { source: "customer", type: "color" }],
  ["/default_store/buyer_theme/secondary", { source: "customer", type: "color" }],
  ["/default_store/buyer_theme/surface", { source: "customer", type: "color" }],
  ["/default_store/buyer_theme/background", { source: "customer", type: "color" }],
  ["/default_store/buyer_theme/error", { source: "customer", type: "color" }],
  ["/default_store/merchant_theme/brightness", { source: "customer", type: "select" }],
  ["/default_store/merchant_theme/primary", { source: "customer", type: "color" }],
  ["/default_store/merchant_theme/secondary", { source: "customer", type: "color" }],
  ["/default_store/merchant_theme/surface", { source: "customer", type: "color" }],
  ["/default_store/merchant_theme/background", { source: "customer", type: "color" }],
  ["/default_store/merchant_theme/error", { source: "customer", type: "color" }],
  ["/first_owner/username", { source: "customer", type: "text" }],
  ["/first_owner/display_name", { source: "customer", type: "text" }],
]);

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

function containsForbiddenName(value: string): boolean {
  return forbiddenNamePattern.test(value.replace(/[^A-Za-z0-9]/g, ""));
}

function isSafeOutputPath(value: string): boolean {
  if (!outputRootPattern.test(value)) return false;
  const segments = value.slice(1).split("/");
  return (
    segments.length >= 2 &&
    segments.length <= 8 &&
    value.length <= 180 &&
    segments.every(
      (segment) =>
        pointerSegmentPattern.test(segment) &&
        !reservedPointerSegments.has(segment.toLowerCase()),
    )
  );
}

function isTemplateFieldFormat(value: unknown): value is TemplateFieldFormat {
  return value === "merchant_username";
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
    value === "integer" ||
    value === "boolean" ||
    value === "color"
  );
}

function isTemplateFieldSource(value: unknown): value is TemplateFieldSource {
  return value === "customer" || value === "plan" || value === "plan_limit";
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
        fieldValue === null ||
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
  const schemaVersion = input.schemaVersion === 2 ? 2 : 1;
  const contract = asTrimmedString(input.contract);
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1 && input.schemaVersion !== 2) {
    addError(errors, "configurationSchema", "schemaVersion 只支持 1 或 2。");
  }
  if (contract && !/^[a-z][a-z0-9._-]{2,79}$/.test(contract)) {
    addError(errors, "configurationSchema", "部署参数契约标识格式不正确。");
  }
  if (!Array.isArray(input.fields)) {
    addError(errors, "configurationSchema", "配置字段必须是 fields 数组。");
    return { data: null, errors };
  }
  if (input.fields.length > 100) {
    addError(errors, "configurationSchema", "配置字段最多 100 项。");
  }

  const fields: TemplateConfigurationField[] = [];
  const keys = new Set<string>();
  const outputPaths = new Set<string>();
  input.fields.forEach((rawField, index) => {
    const field = asRecord(rawField);
    const prefix = `configurationSchema.fields.${index}`;
    const key = asTrimmedString(field.key);
    const label = asTrimmedString(field.label);
    const type = field.type;
    const source = field.source;
    const required = field.required;
    const limitKey = asTrimmedString(field.limitKey);
    const group = asTrimmedString(field.group);
    const description = asTrimmedString(field.description);
    const placeholder = asTrimmedString(field.placeholder);
    const unit = asTrimmedString(field.unit);
    const outputPath = asTrimmedString(field.outputPath);
    const nullLabel = asTrimmedString(field.nullLabel);
    const nullable = field.nullable === true;
    const format = field.format;

    if (!/^[a-z][A-Za-z0-9_]{1,63}$/.test(key)) {
      addError(errors, prefix, "字段 key 必须以小写字母开头，只能包含字母、数字和下划线。");
    } else if (containsForbiddenName(key)) {
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
      addError(errors, prefix, "字段来源必须是 customer、plan 或兼容模式 plan_limit。");
    }
    if (typeof required !== "boolean") {
      addError(errors, prefix, "required 必须是布尔值。");
    }

    const options = Array.isArray(field.options)
      ? field.options.map(asTrimmedString).filter(Boolean)
      : undefined;
    if (type === "select" && (!options?.length || options.length > 50)) {
      addError(errors, prefix, "下拉字段必须提供 1–50 个选项。");
    }
    if (options?.some((option) => option.length > 80)) {
      addError(errors, prefix, "选项名称不能超过 80 个字符。");
    }
    if (options && new Set(options).size !== options.length) {
      addError(errors, prefix, "下拉选项不能重复。");
    }
    if (source === "plan_limit" && (!limitKey || limitKey.length > 60)) {
      addError(errors, prefix, "兼容套餐限制字段必须提供有效的 limitKey。");
    }
    if (source === "plan_limit" && type !== "number" && type !== "integer") {
      addError(errors, prefix, "兼容套餐限制字段只支持 number 或 integer 类型。");
    }

    const numeric = type === "number" || type === "integer";
    if (nullable && !numeric) {
      addError(errors, prefix, "只有数字或整数字段可以设置为可为空（不限）。");
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
    if (type === "integer" && [min, max].some((item) => item !== undefined && !Number.isSafeInteger(item))) {
      addError(errors, prefix, "整数字段的 min/max 必须是安全整数。");
    }

    const minLength = typeof field.minLength === "number" ? field.minLength : undefined;
    const maxLength = typeof field.maxLength === "number" ? field.maxLength : undefined;
    if (
      (minLength !== undefined && (!Number.isSafeInteger(minLength) || minLength < 0)) ||
      (maxLength !== undefined && (!Number.isSafeInteger(maxLength) || maxLength < 1 || maxLength > 500)) ||
      (minLength !== undefined && maxLength !== undefined && maxLength < minLength)
    ) {
      addError(errors, prefix, "文字字段的最小/最大长度范围不正确。");
    }

    if (group.length > 60 || description.length > 300 || placeholder.length > 120 || unit.length > 24 || nullLabel.length > 30) {
      addError(errors, prefix, "字段分组、说明、占位文字或单位过长。");
    }
    if (outputPath) {
      if (!isSafeOutputPath(outputPath) || containsForbiddenName(outputPath)) {
        addError(errors, prefix, "输出路径不安全，或不是允许的订单系统 JSON 路径。");
      } else if (outputPaths.has(outputPath)) {
        addError(errors, prefix, "输出路径不能重复。");
      } else if (
        [...outputPaths].some(
          (existing) =>
            existing.startsWith(`${outputPath}/`) ||
            outputPath.startsWith(`${existing}/`),
        )
      ) {
        addError(errors, prefix, "输出路径不能与另一个字段形成父子覆盖关系。");
      }
      outputPaths.add(outputPath);
      if (contract === "speedfeast-saas-control-v1") {
        const specification = speedFeastControlV1Paths.get(outputPath);
        if (!specification) {
          addError(errors, prefix, "这个输出路径不属于当前餐饮订单系统控制契约。");
        } else if (specification.source !== source || specification.type !== type) {
          addError(errors, prefix, "字段来源或类型与餐饮订单系统控制契约不一致。");
        }
        const quotaMinimum = speedFeastQuotaMinimums.get(outputPath);
        if (quotaMinimum !== undefined && (min === undefined || min < quotaMinimum)) {
          addError(errors, prefix, `这个额度字段的最小值不能低于 ${quotaMinimum}。`);
        }
        const policyRange = speedFeastPolicyRanges.get(outputPath);
        if (
          policyRange &&
          (min === undefined ||
            max === undefined ||
            min < policyRange.min ||
            max > policyRange.max)
        ) {
          addError(
            errors,
            prefix,
            `访问策略范围必须位于 ${policyRange.min}–${policyRange.max}。`,
          );
        }
        if (
          outputPath.endsWith("_theme/brightness") &&
          options?.some((option) => option !== "light" && option !== "dark")
        ) {
          addError(errors, prefix, "主题明暗模式只允许 light 或 dark。");
        }
        if (
          outputPath === "/default_store/name" &&
          (minLength === undefined || minLength < 1 || maxLength === undefined || maxLength > 120)
        ) {
          addError(errors, prefix, "默认主店名称长度必须限制在 1–120 个字符内。");
        }
        if (
          outputPath === "/first_owner/username" &&
          (format !== "merchant_username" ||
            minLength === undefined ||
            minLength < 3 ||
            maxLength === undefined ||
            maxLength > 64)
        ) {
          addError(errors, prefix, "首位管理员用户名必须使用 3–64 位商户用户名格式。");
        }
      }
    } else if (schemaVersion === 2) {
      addError(errors, prefix, "Schema v2 的每个字段都必须设置输出路径。");
    }
    if (format !== undefined && !isTemplateFieldFormat(format)) {
      addError(errors, prefix, "字段格式不受支持。");
    }
    if (format === "merchant_username" && type !== "text") {
      addError(errors, prefix, "商户用户名格式只能用于文字字段。");
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
        ...(minLength !== undefined ? { minLength } : {}),
        ...(maxLength !== undefined ? { maxLength } : {}),
        ...(nullable ? { nullable: true } : {}),
        ...(nullLabel ? { nullLabel } : {}),
        ...(group ? { group } : {}),
        ...(description ? { description } : {}),
        ...(placeholder ? { placeholder } : {}),
        ...(unit ? { unit } : {}),
        ...(outputPath ? { outputPath } : {}),
        ...(isTemplateFieldFormat(format) ? { format } : {}),
      });
    }
  });

  const rawRules = input.rules === undefined ? [] : input.rules;
  const rules: TemplateConfigurationRule[] = [];
  if (!Array.isArray(rawRules) || rawRules.length > 20) {
    addError(errors, "configurationSchema.rules", "字段间校验规则最多 20 项。");
  } else {
    rawRules.forEach((rawRule, index) => {
      const rule = asRecord(rawRule);
      const prefix = `configurationSchema.rules.${index}`;
      const leftKey = asTrimmedString(rule.leftKey);
      const rightKey = asTrimmedString(rule.rightKey);
      const message = asTrimmedString(rule.message);
      const left = fields.find((field) => field.key === leftKey);
      const right = fields.find((field) => field.key === rightKey);
      if (rule.type !== "less_than") {
        addError(errors, prefix, "当前只支持“小于另一个字段”规则。");
      }
      if (!left || !right || leftKey === rightKey) {
        addError(errors, prefix, "规则必须引用两个不同且已存在的字段。");
      } else if (
        !["number", "integer"].includes(left.type) ||
        !["number", "integer"].includes(right.type)
      ) {
        addError(errors, prefix, "小于规则只能比较数字字段。");
      }
      if (message.length > 160) {
        addError(errors, prefix, "规则提示不能超过 160 个字符。");
      }
      if (rule.type === "less_than" && left && right && leftKey !== rightKey) {
        rules.push({
          type: "less_than",
          leftKey,
          rightKey,
          ...(message ? { message } : {}),
        });
      }
    });
  }

  if (contract === "speedfeast-saas-control-v1") {
    const heartbeat = fields.find(
      (field) =>
        field.outputPath ===
        "/entitlements/buyer.access.heartbeat_seconds",
    );
    const lease = fields.find(
      (field) =>
        field.outputPath === "/entitlements/buyer.access.lease_seconds",
    );
    if (
      heartbeat &&
      lease &&
      !rules.some(
        (rule) =>
          rule.type === "less_than" &&
          rule.leftKey === heartbeat.key &&
          rule.rightKey === lease.key,
      )
    ) {
      addError(
        errors,
        "configurationSchema.rules",
        "餐饮订单系统要求心跳间隔严格小于访问租约时长。",
      );
    }
  }

  return {
    data: Object.keys(errors).length
      ? null
      : {
          schemaVersion,
          ...(contract ? { contract } : {}),
          fields,
          ...(rules.length ? { rules } : {}),
        },
    errors,
  };
}

function normalizeValue(
  field: TemplateConfigurationField,
  value: unknown,
): NormalizedValue {
  const missing = value === undefined || (typeof value === "string" && value.trim() === "");
  if (missing) return { valid: true, empty: true };
  if (value === null || (field.nullable && value === "unlimited")) {
    return field.nullable
      ? { valid: true, empty: false, value: null }
      : { valid: false, empty: false };
  }
  if (field.type === "boolean") {
    if (typeof value === "boolean") return { valid: true, empty: false, value };
    if (value === "true" || value === "on" || value === "1") {
      return { valid: true, empty: false, value: true };
    }
    if (value === "false" || value === "0") {
      return { valid: true, empty: false, value: false };
    }
    return { valid: false, empty: false };
  }
  if (field.type === "number" || field.type === "integer") {
    const numberValue =
      typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isFinite(numberValue)) return { valid: false, empty: false };
    if (field.type === "integer" && !Number.isSafeInteger(numberValue)) {
      return { valid: false, empty: false };
    }
    if (field.min !== undefined && numberValue < field.min) {
      return { valid: false, empty: false };
    }
    if (field.max !== undefined && numberValue > field.max) {
      return { valid: false, empty: false };
    }
    return { valid: true, empty: false, value: numberValue };
  }
  if (typeof value !== "string") return { valid: false, empty: false };
  const stringValue = value.trim();
  const maxLength = field.maxLength ?? 200;
  if (stringValue.length < (field.minLength ?? 0) || stringValue.length > maxLength) {
    return { valid: false, empty: false };
  }
  if (field.type === "color" && !/^#[0-9a-fA-F]{6}$/.test(stringValue)) {
    return { valid: false, empty: false };
  }
  if (field.type === "select" && !field.options?.includes(stringValue)) {
    return { valid: false, empty: false };
  }
  if (
    field.format === "merchant_username" &&
    !/^[A-Za-z0-9._-]{3,64}$/.test(stringValue)
  ) {
    return { valid: false, empty: false };
  }
  return {
    valid: true,
    empty: false,
    value: field.type === "color" ? stringValue.toUpperCase() : stringValue,
  };
}

function applyRules(
  schema: TemplateConfigurationSchema,
  values: TemplateConfiguration,
  errors: FieldErrors,
): void {
  for (const rule of schema.rules ?? []) {
    const left = values[rule.leftKey];
    const right = values[rule.rightKey];
    if (typeof left !== "number" || typeof right !== "number") continue;
    if (left >= right) {
      addError(
        errors,
        `instanceConfiguration.${rule.leftKey}`,
        rule.message ?? `“${rule.leftKey}”必须小于“${rule.rightKey}”。`,
      );
    }
  }
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
        : field.source === "plan"
          ? input.defaults[field.key]
          : Object.hasOwn(input.requested, field.key)
            ? input.requested[field.key]
            : input.defaults[field.key];
    const normalized = normalizeValue(field, rawValue);
    if (normalized.empty && field.required) {
      const message =
        field.source === "plan_limit"
          ? `套餐限制中缺少“${field.limitKey}”，不能生成“${field.label}”。`
          : field.source === "plan"
            ? `套餐中缺少“${field.label}”。`
            : `请填写“${field.label}”。`;
      addError(
        errors,
        field.source === "plan_limit" ? "limits" : `instanceConfiguration.${field.key}`,
        message,
      );
      continue;
    }
    if (normalized.empty) continue;
    if (!normalized.valid || normalized.value === undefined) {
      addError(
        errors,
        `instanceConfiguration.${field.key}`,
        `“${field.label}”的值不符合模板要求。`,
      );
      continue;
    }
    resolved[field.key] = normalized.value;
  }
  applyRules(input.schema, resolved, errors);

  return {
    data: Object.keys(errors).length ? null : resolved,
    errors,
  };
}

export function validateResolvedTemplateConfiguration(input: {
  schema: TemplateConfigurationSchema;
  configuration: Record<string, unknown>;
}): ValidationResult<TemplateConfiguration> {
  const errors: FieldErrors = {};
  const fields = new Map(input.schema.fields.map((field) => [field.key, field]));
  for (const key of Object.keys(input.configuration)) {
    if (!fields.has(key)) {
      addError(errors, "configuration", `配置快照包含未知字段：${key}。`);
    }
  }
  const resolved: TemplateConfiguration = {};
  for (const field of input.schema.fields) {
    const rawValue = input.configuration[field.key];
    const normalized = normalizeValue(field, rawValue);
    if (normalized.empty) {
      if (field.required) {
        addError(errors, field.key, `配置快照缺少“${field.label}”。`);
      }
      continue;
    }
    if (!normalized.valid || normalized.value === undefined) {
      addError(errors, field.key, `“${field.label}”的快照值不符合模板要求。`);
      continue;
    }
    resolved[field.key] = normalized.value;
  }
  applyRules(input.schema, resolved, errors);
  return { data: Object.keys(errors).length ? null : resolved, errors };
}

export function validateTemplatePlanLimits(input: {
  schema: TemplateConfigurationSchema;
  planLimits: Record<string, string>;
}): ValidationResult<TemplateConfiguration> {
  const errors: FieldErrors = {};
  const resolved: TemplateConfiguration = {};
  for (const field of input.schema.fields) {
    if (field.source !== "plan_limit") continue;
    const normalized = normalizeValue(field, input.planLimits[field.limitKey ?? ""]);
    if (normalized.empty && !field.required) continue;
    if (normalized.empty || !normalized.valid || normalized.value === undefined) {
      addError(
        errors,
        "limits",
        `套餐限制必须提供符合模板要求的“${field.limitKey ?? field.label}”。`,
      );
      continue;
    }
    resolved[field.key] = normalized.value;
  }
  applyRules(input.schema, resolved, errors);
  return {
    data: Object.keys(errors).length ? null : resolved,
    errors,
  };
}

export function resolvePlanTemplateConfiguration(input: {
  schema: TemplateConfigurationSchema;
  defaults?: TemplateConfiguration;
  requested: Record<string, unknown>;
}): ValidationResult<TemplateConfiguration> {
  const errors: FieldErrors = {};
  const configurableFields = new Map(
    input.schema.fields
      .filter((field) => field.source === "customer" || field.source === "plan")
      .map((field) => [field.key, field]),
  );
  const resolved: TemplateConfiguration = {};

  for (const key of Object.keys(input.requested)) {
    if (!configurableFields.has(key)) {
      addError(
        errors,
        "templateConfiguration",
        `“${key}”不是允许在套餐中配置的参数。`,
      );
    }
  }

  for (const field of configurableFields.values()) {
    const hasRequested = Object.hasOwn(input.requested, field.key);
    const rawValue = hasRequested
      ? input.requested[field.key]
      : input.defaults?.[field.key];
    const normalized = normalizeValue(field, rawValue);
    if (normalized.empty) {
      if (field.source === "plan" && field.required) {
        addError(
          errors,
          `templateConfiguration.${field.key}`,
          `套餐必须配置“${field.label}”。`,
        );
      }
      continue;
    }
    if (!normalized.valid || normalized.value === undefined) {
      addError(
        errors,
        `templateConfiguration.${field.key}`,
        `“${field.label}”的套餐配置不符合模板要求。`,
      );
      continue;
    }
    resolved[field.key] = normalized.value;
  }
  applyRules(input.schema, { ...(input.defaults ?? {}), ...resolved }, errors);

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

  if (!validId(productId)) addError(errors, "productId", "请选择模板所属产品。");
  if (name.length < 2 || name.length > 100) {
    addError(errors, "name", "模板名称需要为 2–100 个字符。");
  }
  if (description.length > 500) {
    addError(errors, "description", "模板说明不能超过 500 个字符。");
  }
  if (!isTemplateStatus(status)) addError(errors, "status", "请选择有效的模板状态。");

  return {
    data:
      Object.keys(errors).length === 0
        ? { productId, name, description, status: status as TemplateStatus }
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
  const deploymentDriver = asTrimmedString(input.deploymentDriver) || "manual";
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
      if (field.source === "plan_limit") {
        addError(errors, "defaultConfiguration", `兼容套餐限制字段“${key}”不能设置模板默认值。`);
        continue;
      }
      const normalized = normalizeValue(field, rawValue);
      if (normalized.empty || !normalized.valid || normalized.value === undefined) {
        addError(errors, "defaultConfiguration", `字段“${key}”的默认值不正确。`);
      } else {
        defaultConfiguration[key] = normalized.value;
      }
    }
    applyRules(schema, defaultConfiguration, errors);
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
