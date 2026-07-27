import type { FieldErrors, ValidationResult } from "@/lib/billing/validation";

export interface CheckoutInput {
  subscriptionId: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function validateCheckoutInput(value: unknown): ValidationResult<CheckoutInput> {
  const input = asRecord(value);
  const subscriptionId =
    typeof input.subscriptionId === "string" ? input.subscriptionId.trim() : "";
  const errors: FieldErrors = {};
  if (subscriptionId.length < 4 || subscriptionId.length > 100) {
    errors.subscriptionId = ["请选择平台为当前工作区配置的订阅。"];
  }
  return {
    data: Object.keys(errors).length ? null : { subscriptionId },
    errors,
  };
}
