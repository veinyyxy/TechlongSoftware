export type UserRole = "platform_admin" | "owner" | "admin" | "member";

export type SubscriptionStatus =
  | "pending"
  | "active"
  | "past_due"
  | "paused"
  | "cancelled";

export type PaymentStatus =
  | "pending"
  | "paid"
  | "failed"
  | "refunded";

export type AppInstanceStatus =
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
  role: Exclude<UserRole, "platform_admin">;
}

export const PLATFORM_PERMISSIONS = [
  "platform:read",
  "customers:manage",
  "plans:manage",
  "billing:manage",
  "instances:manage",
  "audit:read",
] as const;

export const WORKSPACE_PERMISSIONS = [
  "workspace:read",
  "workspace:update",
  "members:manage",
  "billing:read",
  "apps:read",
] as const;
