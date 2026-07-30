import { cache } from "react";
import { redirect } from "next/navigation";
import {
  getAuthenticatedUser,
  requireAuthenticatedUser,
  type AuthenticatedUser,
} from "./session";
import { getDatabase } from "@/db";
import {
  canAccessWorkspace,
  type WorkspaceRole,
} from "./permissions";

type UserStatus = "active" | "disabled";
type WorkspaceStatus = "active" | "suspended" | "disabled";

interface UserRow {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  is_platform_admin: number;
  created_at: number;
  updated_at: number;
}

interface MembershipRow {
  membership_id: string;
  workspace_id: string;
  workspace_name: string;
  workspace_status: WorkspaceStatus;
  role: WorkspaceRole;
  joined_at: number;
}

export interface AccountContext {
  user: {
    id: string;
    email: string;
    name: string;
    status: UserStatus;
    isPlatformAdmin: boolean;
  };
  workspace: {
    id: string;
    name: string;
    status: WorkspaceStatus;
  };
  membership: {
    id: string;
    role: WorkspaceRole;
    joinedAt: number;
  };
}

export interface WorkspaceMemberView {
  id: string;
  email: string;
  name: string;
  role: WorkspaceRole;
  status: UserStatus;
  joinedAt: number;
}

export interface AdminUserView {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  isPlatformAdmin: boolean;
  createdAt: number;
}

export interface AdminWorkspaceView {
  id: string;
  name: string;
  status: WorkspaceStatus;
  ownerName: string;
  ownerEmail: string;
  memberCount: number;
  createdAt: number;
}

async function loadAccount(
  identity: AuthenticatedUser,
): Promise<AccountContext> {
  const db = getDatabase();
  const user = await db
    .prepare(
      `SELECT id, email, name, status, is_platform_admin, created_at, updated_at
       FROM users
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(identity.id)
    .first<UserRow>();

  if (!user) {
    throw new Error("Authenticated user no longer exists.");
  }

  const membership = await findPrimaryMembership(user.id);
  if (!membership) {
    throw new Error("Authenticated user does not belong to a workspace.");
  }

  return toAccountContext(user, membership);
}

async function findPrimaryMembership(
  userId: string,
): Promise<MembershipRow | null> {
  return getDatabase()
    .prepare(
      `SELECT
        wm.id AS membership_id,
        wm.workspace_id,
        w.name AS workspace_name,
        w.status AS workspace_status,
        wm.role,
        wm.joined_at
      FROM workspace_members wm
      INNER JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = ?
      ORDER BY CASE wm.role WHEN 'owner' THEN 0 ELSE 1 END, wm.joined_at ASC
      LIMIT 1`,
    )
    .bind(userId)
    .first<MembershipRow>();
}

function toAccountContext(
  user: UserRow,
  membership: MembershipRow,
): AccountContext {
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      isPlatformAdmin: Boolean(user.is_platform_admin),
    },
    workspace: {
      id: membership.workspace_id,
      name: membership.workspace_name,
      status: membership.workspace_status,
    },
    membership: {
      id: membership.membership_id,
      role: membership.role,
      joinedAt: membership.joined_at,
    },
  };
}

export const getDashboardAccount = cache(async (): Promise<AccountContext> => {
  const identity = await requireAuthenticatedUser("/dashboard");
  const account = await loadAccount(identity);

  if (account.user.status !== "active") {
    redirect("/unauthorized?reason=user_status");
  }
  if (account.workspace.status !== "active") {
    redirect("/unauthorized?reason=workspace_status");
  }

  return account;
});

export const getAdminAccount = cache(async (): Promise<AccountContext> => {
  const identity = await requireAuthenticatedUser("/admin");
  const account = await loadAccount(identity);

  if (!account.user.isPlatformAdmin) {
    redirect("/unauthorized?reason=platform_admin");
  }
  if (account.user.status !== "active") {
    redirect("/unauthorized?reason=user_status");
  }

  return account;
});

export async function getApiAccount(): Promise<AccountContext | null> {
  const identity = await getAuthenticatedUser();
  if (!identity) return null;

  const account = await loadAccount(identity);
  if (account.user.status !== "active") return null;
  return account;
}

export async function assertWorkspaceAccess(
  account: AccountContext,
  requestedWorkspaceId: string,
): Promise<boolean> {
  if (
    canAccessWorkspace({
      isPlatformAdmin: account.user.isPlatformAdmin,
      membershipWorkspaceIds: [account.workspace.id],
      requestedWorkspaceId,
    })
  ) {
    return true;
  }

  const membership = await getDatabase()
    .prepare(
      `SELECT workspace_id
       FROM workspace_members
       WHERE user_id = ? AND workspace_id = ?
       LIMIT 1`,
    )
    .bind(account.user.id, requestedWorkspaceId)
    .first<{ workspace_id: string }>();

  return Boolean(membership);
}

export async function listWorkspaceMembers(
  workspaceId: string,
): Promise<WorkspaceMemberView[]> {
  const result = await getDatabase()
    .prepare(
      `SELECT
        u.id,
        u.email,
        u.name,
        u.status,
        wm.role,
        wm.joined_at
      FROM workspace_members wm
      INNER JOIN users u ON u.id = wm.user_id
      WHERE wm.workspace_id = ?
      ORDER BY CASE wm.role WHEN 'owner' THEN 0 ELSE 1 END, wm.joined_at ASC`,
    )
    .bind(workspaceId)
    .all<{
      id: string;
      email: string;
      name: string;
      status: UserStatus;
      role: WorkspaceRole;
      joined_at: number;
    }>();

  return result.results.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    status: row.status,
    role: row.role,
    joinedAt: row.joined_at,
  }));
}

export async function getPlatformOverview() {
  const db = getDatabase();
  const [
    usersResult,
    workspacesResult,
    membersResult,
    activePlansResult,
    suspendedWorkspacesResult,
    activeSubscriptionsResult,
    failedPaymentsResult,
    appInstancesResult,
    activeAppInstancesResult,
  ] = await db.batch([
    db.prepare("SELECT COUNT(*) AS count FROM users"),
    db.prepare("SELECT COUNT(*) AS count FROM workspaces"),
    db.prepare("SELECT COUNT(*) AS count FROM workspace_members"),
    db.prepare("SELECT COUNT(*) AS count FROM plans WHERE status = 'active'"),
    db.prepare(
      "SELECT COUNT(*) AS count FROM workspaces WHERE status = 'suspended'",
    ),
    db.prepare(
      "SELECT COUNT(*) AS count FROM subscriptions WHERE status = 'active'",
    ),
    db.prepare(
      "SELECT COUNT(*) AS count FROM payment_records WHERE status = 'failed'",
    ),
    db.prepare("SELECT COUNT(*) AS count FROM app_instances"),
    db.prepare("SELECT COUNT(*) AS count FROM app_instances WHERE status = 'active'"),
  ]);

  const count = (result: DatabaseResult<unknown>) =>
    Number((result.results[0] as { count?: number } | undefined)?.count ?? 0);

  return {
    users: count(usersResult),
    workspaces: count(workspacesResult),
    memberships: count(membersResult),
    activePlans: count(activePlansResult),
    suspendedWorkspaces: count(suspendedWorkspacesResult),
    activeSubscriptions: count(activeSubscriptionsResult),
    failedPayments: count(failedPaymentsResult),
    appInstances: count(appInstancesResult),
    activeAppInstances: count(activeAppInstancesResult),
  };
}

export async function listAdminUsers(): Promise<AdminUserView[]> {
  const result = await getDatabase()
    .prepare(
      `SELECT id, email, name, status, is_platform_admin, created_at
       FROM users
       ORDER BY created_at DESC
       LIMIT 100`,
    )
    .all<{
      id: string;
      email: string;
      name: string;
      status: UserStatus;
      is_platform_admin: number;
      created_at: number;
    }>();

  return result.results.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    status: row.status,
    isPlatformAdmin: Boolean(row.is_platform_admin),
    createdAt: row.created_at,
  }));
}

export async function listAdminWorkspaces(): Promise<AdminWorkspaceView[]> {
  const result = await getDatabase()
    .prepare(
      `SELECT
        w.id,
        w.name,
        w.status,
        w.created_at,
        u.name AS owner_name,
        u.email AS owner_email,
        COUNT(wm.id) AS member_count
      FROM workspaces w
      INNER JOIN users u ON u.id = w.owner_id
      LEFT JOIN workspace_members wm ON wm.workspace_id = w.id
      GROUP BY w.id, w.name, w.status, w.created_at, u.name, u.email
      ORDER BY w.created_at DESC
      LIMIT 100`,
    )
    .all<{
      id: string;
      name: string;
      status: WorkspaceStatus;
      created_at: number;
      owner_name: string;
      owner_email: string;
      member_count: number;
    }>();

  return result.results.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    memberCount: Number(row.member_count),
    createdAt: row.created_at,
  }));
}
