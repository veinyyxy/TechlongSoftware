import type { FieldErrors, ValidationResult } from "@/lib/billing/validation";

export interface CheckoutInput {
  planId: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function validateCheckoutInput(value: unknown): ValidationResult<CheckoutInput> {
  const input = asRecord(value);
  const planId = typeof input.planId === "string" ? input.planId.trim() : "";
  const errors: FieldErrors = {};
  if (planId.length < 4 || planId.length > 100) {
    errors.planId = ["请选择有效的套餐。"];
  }
  return {
    data: Object.keys(errors).length ? null : { planId },
    errors,
  };
}
