import type { PaymentStatus, SubscriptionStatus } from "./management";

export const subscriptionStatusLabels: Record<SubscriptionStatus, string> = {
  manual_pending: "人工待确认",
  active: "有效",
  past_due: "逾期",
  paused: "已暂停",
  canceled: "已取消",
};

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  pending: "待确认",
  paid: "已付款",
  failed: "付款失败",
};

export function subscriptionStatusTone(
  status: SubscriptionStatus,
): "active" | "warning" | "danger" | "neutral" {
  if (status === "active") return "active";
  if (status === "manual_pending" || status === "paused") return "warning";
  if (status === "past_due" || status === "canceled") return "danger";
  return "neutral";
}

export function paymentStatusTone(
  status: PaymentStatus,
): "active" | "warning" | "danger" {
  if (status === "paid") return "active";
  if (status === "failed") return "danger";
  return "warning";
}
