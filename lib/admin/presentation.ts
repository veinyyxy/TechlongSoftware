import type {
  AppInstanceStatus,
  BillingInterval,
  PlanStatus,
  SubscriptionStatus,
  WorkspaceStatus,
} from "./management";

export const workspaceStatusLabels: Record<WorkspaceStatus, string> = {
  active: "正常",
  suspended: "已暂停",
  disabled: "已停用",
};

export const planStatusLabels: Record<PlanStatus, string> = {
  active: "已启用",
  inactive: "已停用",
};

export const billingIntervalLabels: Record<BillingInterval, string> = {
  month: "月",
  year: "年",
};

export const subscriptionStatusLabels: Record<SubscriptionStatus, string> = {
  not_configured: "尚未配置",
  pending: "待生效",
  active: "有效",
  past_due: "逾期",
  paused: "已暂停",
  cancelled: "已取消",
};

export const appInstanceStatusLabels: Record<AppInstanceStatus, string> = {
  not_provisioned: "尚未开通",
  pending: "待开通",
  provisioning: "开通中",
  running: "运行中",
  failed: "开通失败",
  paused: "已暂停",
  disabled: "已停用",
};

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(amount / 100);
  } catch {
    return `${currency} ${(amount / 100).toFixed(2)}`;
  }
}

export function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(timestamp));
}
