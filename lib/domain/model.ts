export type PlatformRole = "platform_admin";
export type WorkspaceRole = "owner" | "member";

export type SubscriptionStatus =
  | "not_configured"
  | "manual_pending"
  | "active"
  | "past_due"
  | "paused"
  | "canceled";

export type PaymentStatus =
  | "pending"
  | "paid"
  | "failed";

export type AppInstanceStatus =
  | "not_provisioned"
  | "pending"
  | "provisioning"
  | "running"
  | "failed"
  | "paused"
  | "disabled";

export interface WorkspaceScopedEntity {
  id: string;
  workspaceId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceContext {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}

export const PLATFORM_PERMISSIONS = [
  "platform:read",
  "users:read",
  "workspaces:read",
  "customers:manage",
  "plans:manage",
  "subscriptions:manage",
  "payments:manage",
] as const;

export const WORKSPACE_PERMISSIONS = [
  "workspace:read",
  "workspace:update",
  "members:manage",
] as const;
