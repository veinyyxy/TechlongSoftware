import type { AppInstanceStatus } from "./management";

export const appInstanceStatusLabels: Record<AppInstanceStatus, string> = {
  pending: "等待开通",
  active: "已开通",
  suspended: "服务已暂停",
  failed: "开通失败",
};

export function appInstanceStatusTone(
  status: AppInstanceStatus,
): "active" | "warning" | "danger" | "neutral" {
  if (status === "active") return "active";
  if (status === "pending") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
}
