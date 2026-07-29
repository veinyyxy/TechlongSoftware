import type { TemplateConfiguration } from "@/lib/templates/validation";

export interface CustomerPurchaseInput {
  planId: string;
  renewalSubscriptionId: string | null;
  instanceConfiguration: TemplateConfiguration;
}

export interface ValidationResult<T> {
  data: T | null;
  errors: Record<string, string[]>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(value);
}

export function validateCustomerPurchaseInput(
  value: unknown,
): ValidationResult<CustomerPurchaseInput> {
  const input = asRecord(value);
  const errors: Record<string, string[]> = {};
  const planId = typeof input.planId === "string" ? input.planId.trim() : "";
  const renewalSubscriptionId =
    typeof input.renewalSubscriptionId === "string"
      ? input.renewalSubscriptionId.trim()
      : "";
  const rawConfiguration = asRecord(input.instanceConfiguration);
  const instanceConfiguration: TemplateConfiguration = {};

  if (!validId(planId)) {
    errors.planId = ["请选择平台提供的有效套餐。"];
  }
  if (renewalSubscriptionId && !validId(renewalSubscriptionId)) {
    errors.renewalSubscriptionId = ["续费订阅标识不正确。"];
  }
  if (Object.keys(rawConfiguration).length > 30) {
    errors.instanceConfiguration = ["实例配置最多 30 项。"];
  }
  for (const [key, fieldValue] of Object.entries(rawConfiguration)) {
    if (!/^[a-z][A-Za-z0-9_]{1,63}$/.test(key)) {
      errors.instanceConfiguration = ["实例配置字段名称不正确。"];
      break;
    }
    if (
      typeof fieldValue !== "string" &&
      typeof fieldValue !== "number" &&
      typeof fieldValue !== "boolean"
    ) {
      errors.instanceConfiguration = ["实例配置只支持文字、数字或布尔值。"];
      break;
    }
    if (typeof fieldValue === "string" && fieldValue.length > 200) {
      errors.instanceConfiguration = ["实例配置文字不能超过 200 个字符。"];
      break;
    }
    instanceConfiguration[key] = fieldValue;
  }

  return {
    data:
      Object.keys(errors).length === 0
        ? {
            planId,
            renewalSubscriptionId: renewalSubscriptionId || null,
            instanceConfiguration,
          }
        : null,
    errors,
  };
}
