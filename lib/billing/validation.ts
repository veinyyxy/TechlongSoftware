export type FieldErrors = Record<string, string[]>;

export type SubscriptionStatus =
  | "manual_pending"
  | "active"
  | "past_due"
  | "paused"
  | "canceled";

export type PaymentStatus = "pending" | "paid" | "failed";

export interface SubscriptionInput {
  workspaceId: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
}

export interface PaymentInput {
  workspaceId: string;
  subscriptionId: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paidAt: number | null;
  paymentMethod: string;
  reference: string | null;
  note: string | null;
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

function validId(value: string): boolean {
  return value.length >= 4 && value.length <= 100;
}

function validTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value < 4_102_444_800_000
  );
}

export function isSubscriptionStatus(
  value: unknown,
): value is SubscriptionStatus {
  return (
    value === "manual_pending" ||
    value === "active" ||
    value === "past_due" ||
    value === "paused" ||
    value === "canceled"
  );
}

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return value === "pending" || value === "paid" || value === "failed";
}

export function validateSubscriptionInput(
  value: unknown,
): ValidationResult<SubscriptionInput> {
  const input = asRecord(value);
  const errors: FieldErrors = {};
  const workspaceId = asTrimmedString(input.workspaceId);
  const planId = asTrimmedString(input.planId);
  const status = input.status;
  const currentPeriodStart = input.currentPeriodStart;
  const currentPeriodEnd = input.currentPeriodEnd;

  if (!validId(workspaceId)) {
    addError(errors, "workspaceId", "请选择企业客户。");
  }
  if (!validId(planId)) {
    addError(errors, "planId", "请选择套餐。");
  }
  if (!isSubscriptionStatus(status)) {
    addError(errors, "status", "请选择有效的订阅状态。");
  }
  if (!validTimestamp(currentPeriodStart)) {
    addError(errors, "currentPeriodStart", "请选择有效的周期开始时间。");
  }
  if (!validTimestamp(currentPeriodEnd)) {
    addError(errors, "currentPeriodEnd", "请选择有效的周期结束时间。");
  }
  if (
    validTimestamp(currentPeriodStart) &&
    validTimestamp(currentPeriodEnd) &&
    currentPeriodEnd <= currentPeriodStart
  ) {
    addError(errors, "currentPeriodEnd", "周期结束时间必须晚于开始时间。");
  }
  if (typeof input.cancelAtPeriodEnd !== "boolean") {
    addError(errors, "cancelAtPeriodEnd", "到期取消设置不正确。");
  }

  return {
    data:
      Object.keys(errors).length === 0
        ? {
            workspaceId,
            planId,
            status: status as SubscriptionStatus,
            currentPeriodStart: currentPeriodStart as number,
            currentPeriodEnd: currentPeriodEnd as number,
            cancelAtPeriodEnd: input.cancelAtPeriodEnd as boolean,
          }
        : null,
    errors,
  };
}

export function validatePaymentInput(
  value: unknown,
): ValidationResult<PaymentInput> {
  const input = asRecord(value);
  const errors: FieldErrors = {};
  const workspaceId = asTrimmedString(input.workspaceId);
  const rawSubscriptionId = asTrimmedString(input.subscriptionId);
  const currency = asTrimmedString(input.currency).toUpperCase();
  const status = input.status;
  const amount = input.amount;
  const paymentMethod = asTrimmedString(input.paymentMethod);
  const reference = asTrimmedString(input.reference);
  const note = asTrimmedString(input.note);
  const paidAt = input.paidAt;

  if (!validId(workspaceId)) {
    addError(errors, "workspaceId", "请选择企业客户。");
  }
  if (rawSubscriptionId && !validId(rawSubscriptionId)) {
    addError(errors, "subscriptionId", "订阅标识不正确。");
  }
  if (
    typeof amount !== "number" ||
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    amount > 1_000_000_000
  ) {
    addError(errors, "amount", "金额必须是有效的非负最小货币单位整数。");
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    addError(errors, "currency", "币种必须是三个字母的 ISO 代码。");
  }
  if (!isPaymentStatus(status)) {
    addError(errors, "status", "请选择有效的付款状态。");
  }
  if (status === "paid" && !validTimestamp(paidAt)) {
    addError(errors, "paidAt", "已付款记录必须填写付款时间。");
  } else if (
    paidAt !== null &&
    paidAt !== undefined &&
    !validTimestamp(paidAt)
  ) {
    addError(errors, "paidAt", "付款时间不正确。");
  }
  if (paymentMethod.length < 2 || paymentMethod.length > 60) {
    addError(errors, "paymentMethod", "付款方式需要为 2–60 个字符。");
  }
  if (reference.length > 120) {
    addError(errors, "reference", "付款参考号不能超过 120 个字符。");
  }
  if (note.length > 500) {
    addError(errors, "note", "备注不能超过 500 个字符。");
  }

  return {
    data:
      Object.keys(errors).length === 0
        ? {
            workspaceId,
            subscriptionId: rawSubscriptionId || null,
            amount: amount as number,
            currency,
            status: status as PaymentStatus,
            paidAt: validTimestamp(paidAt) ? paidAt : null,
            paymentMethod,
            reference: reference || null,
            note: note || null,
          }
        : null,
    errors,
  };
}
