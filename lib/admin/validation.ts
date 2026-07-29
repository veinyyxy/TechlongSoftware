export type FieldErrors = Record<string, string[]>;

export interface CustomerInput {
  name: string;
  contactName: string;
  contactEmail: string;
}

export interface PlanInput {
  productId: string;
  templateVersionId: string;
  name: string;
  description: string;
  priceAmount: number;
  currency: string;
  billingInterval: "month" | "year";
  features: string[];
  limits: Record<string, string>;
  templateConfiguration: Record<string, unknown>;
}

export interface ValidationResult<T> {
  data: T | null;
  errors: FieldErrors;
}

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

export function validateCustomerInput(
  value: unknown,
): ValidationResult<CustomerInput> {
  const input = asRecord(value);
  const errors: FieldErrors = {};
  const name = asTrimmedString(input.name);
  const contactName = asTrimmedString(input.contactName);
  const contactEmail = asTrimmedString(input.contactEmail).toLowerCase();

  if (name.length < 2 || name.length > 100) {
    addError(errors, "name", "企业名称需要为 2–100 个字符。");
  }
  if (contactName.length < 2 || contactName.length > 100) {
    addError(errors, "contactName", "联系人需要为 2–100 个字符。");
  }
  if (
    contactEmail.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)
  ) {
    addError(errors, "contactEmail", "请输入有效的联系人邮箱。");
  }
  return {
    data:
      Object.keys(errors).length === 0
        ? {
            name,
            contactName,
            contactEmail,
          }
        : null,
    errors,
  };
}

export function validatePlanInput(value: unknown): ValidationResult<PlanInput> {
  const input = asRecord(value);
  const errors: FieldErrors = {};
  const productId = asTrimmedString(input.productId);
  const templateVersionId = asTrimmedString(input.templateVersionId);
  const name = asTrimmedString(input.name);
  const description = asTrimmedString(input.description);
  const currency = asTrimmedString(input.currency).toUpperCase();
  const billingInterval = asTrimmedString(input.billingInterval);
  const priceAmount =
    typeof input.priceAmount === "number" ? input.priceAmount : Number.NaN;

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(productId)) {
    addError(errors, "productId", "请选择套餐所属产品。");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(templateVersionId)) {
    addError(errors, "templateVersionId", "请选择已发布的实例模板版本。");
  }
  if (name.length < 2 || name.length > 80) {
    addError(errors, "name", "套餐名称需要为 2–80 个字符。");
  }
  if (description.length > 500) {
    addError(errors, "description", "套餐说明不能超过 500 个字符。");
  }
  if (
    !Number.isSafeInteger(priceAmount) ||
    priceAmount < 0 ||
    priceAmount > 100_000_000
  ) {
    addError(errors, "priceAmount", "价格必须是有效的非负金额。");
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    addError(errors, "currency", "币种必须是三个字母的 ISO 代码。");
  }
  if (billingInterval !== "month" && billingInterval !== "year") {
    addError(errors, "billingInterval", "请选择月付或年付周期。");
  }

  const features = Array.isArray(input.features)
    ? input.features
        .map(asTrimmedString)
        .filter(Boolean)
    : [];
  if (
    !Array.isArray(input.features) ||
    features.length > 30 ||
    features.some((feature) => feature.length > 120)
  ) {
    addError(errors, "features", "功能最多 30 项，每项不超过 120 个字符。");
  }

  const rawLimits = asRecord(input.limits);
  const limits: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(rawLimits)) {
    const key = rawKey.trim();
    const limitValue = asTrimmedString(rawValue);
    if (
      !key ||
      key.length > 60 ||
      !limitValue ||
      limitValue.length > 120
    ) {
      addError(errors, "limits", "限制项名称和值不能为空，且长度需要合理。");
      break;
    }
    limits[key] = limitValue;
  }
  if (Object.keys(rawLimits).length > 30) {
    addError(errors, "limits", "限制项最多 30 项。");
  }

  const rawTemplateConfiguration = asRecord(input.templateConfiguration);
  if (Object.keys(rawTemplateConfiguration).length > 30) {
    addError(
      errors,
      "templateConfiguration",
      "套餐模板参数最多 30 项。",
    );
  }
  for (const [key, parameterValue] of Object.entries(
    rawTemplateConfiguration,
  )) {
    if (!/^[a-z][A-Za-z0-9_]{1,63}$/.test(key)) {
      addError(
        errors,
        "templateConfiguration",
        "套餐模板参数名称不正确。",
      );
      break;
    }
    if (
      typeof parameterValue !== "string" &&
      typeof parameterValue !== "number" &&
      typeof parameterValue !== "boolean"
    ) {
      addError(
        errors,
        "templateConfiguration",
        "套餐模板参数只支持文字、数字或布尔值。",
      );
      break;
    }
    if (typeof parameterValue === "string" && parameterValue.length > 200) {
      addError(
        errors,
        "templateConfiguration",
        "套餐模板参数文字不能超过 200 个字符。",
      );
      break;
    }
  }

  return {
    data:
      Object.keys(errors).length === 0
        ? {
            productId,
            templateVersionId,
            name,
            description,
            priceAmount,
            currency,
            billingInterval: billingInterval as "month" | "year",
            features,
            limits,
            templateConfiguration: rawTemplateConfiguration,
          }
        : null,
    errors,
  };
}

export function isWorkspaceStatus(
  value: unknown,
): value is "active" | "suspended" | "disabled" {
  return (
    value === "active" || value === "suspended" || value === "disabled"
  );
}

export function isPlanStatus(
  value: unknown,
): value is "active" | "inactive" {
  return value === "active" || value === "inactive";
}
