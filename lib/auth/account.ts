import { cache } from "react";
import { env } from "cloudflare:workers";
import { redirect } from "next/navigation";
import {
  getChatGPTUser,
  requireChatGPTUser,
  type ChatGPTUser,
} from "@/app/chatgpt-auth";
import { getD1 } from "@/db";
import { stableId } from "@/lib/domain/ids";
import {
  canAccessWorkspace,
  isPlatformAdminEmail,
  normalizeEmail,
  parseAdminEmailAllowlist,
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

function getPlatformAdminEmails(): string[] {
  const bindings = env as unknown as Record<string, unknown>;
  const value =
    typeof bindings.PLATFORM_ADMIN_EMAILS === "string"
      ? bindings.PLATFORM_ADMIN_EMAILS
      : undefined;

  return parseAdminEmailAllowlist(value);
}

function defaultWorkspaceName(identity: ChatGPTUser): string {
  const baseName =
    identity.fullName?.trim() ||
    normalizeEmail(identity.email).split("@")[0] ||
    "新客户";
  return `${baseName.slice(0, 60)}的企业工作区`;
}

export async function ensureAccount(
  identity: ChatGPTUser,
): Promise<AccountContext> {
  const db = getD1();
  const email = normalizeEmail(identity.email);
  const userId = await stableId("usr", email);
  const workspaceId = await stableId("wsp", userId);
  const membershipId = await stableId("wsm", `${workspaceId}:${userId}`);
  const now = Date.now();
  const isPlatformAdmin = isPlatformAdminEmail(
    email,
    getPlatformAdminEmails(),
  );

  await db
    .prepare(
      `INSERT INTO users (
        id, email, name, status, is_platform_admin, created_at, updated_at
      ) VALUES (?, ?, ?, 'active', ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        name = excluded.name,
        is_platform_admin = MAX(users.is_platform_admin, excluded.is_platform_admin),
        updated_at = excluded.updated_at`,
    )
    .bind(
      userId,
      email,
      identity.fullName?.trim() || identity.displayName,
      isPlatformAdmin ? 1 : 0,
      now,
      now,
    )
    .run();

  const user = await db
    .prepare(
      `SELECT id, email, name, status, is_platform_admin, created_at, updated_at
       FROM users
       WHERE email = ?
       LIMIT 1`,
    )
    .bind(email)
    .first<UserRow>();

  if (!user) {
    throw new Error("Unable to create or load the authenticated user.");
  }

  let membership = await findPrimaryMembership(user.id);
  if (!membership) {
    await db.batch([
      db
        .prepare(
          `INSERT OR IGNORE INTO workspaces (
            id, name, owner_id, status, created_at, updated_at
          ) VALUES (?, ?, ?, 'active', ?, ?)`,
        )
        .bind(
          workspaceId,
          defaultWorkspaceName(identity),
          user.id,
          now,
          now,
        ),
      db
        .prepare(
          `INSERT OR IGNORE INTO workspace_members (
            id, workspace_id, user_id, role, joined_at
          ) VALUES (?, ?, ?, 'owner', ?)`,
        )
        .bind(membershipId, workspaceId, user.id, now),
    ]);

    membership = await findPrimaryMembership(user.id);
  }

  if (!membership) {
    throw new Error("Unable to create or load the user's workspace.");
  }

  return toAccountContext(user, membership);
}

async function findPrimaryMembership(
  userId: string,
): Promise<MembershipRow | null> {
  return getD1()
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
  const identity = await requireChatGPTUser("/dashboard");
  const account = await ensureAccount(identity);

  if (account.user.status !== "active") {
    redirect("/unauthorized?reason=user_status");
  }
  if (account.workspace.status !== "active") {
    redirect("/unauthorized?reason=workspace_status");
  }

  return account;
});

export const getAdminAccount = cache(async (): Promise<AccountContext> => {
  const identity = await requireChatGPTUser("/admin");
  const account = await ensureAccount(identity);

  if (!account.user.isPlatformAdmin) {
    redirect("/unauthorized?reason=platform_admin");
  }
  if (account.user.status !== "active") {
    redirect("/unauthorized?reason=user_status");
  }

  return account;
});

export async function getApiAccount(): Promise<AccountContext | null> {
  const identity = await getChatGPTUser();
  if (!identity) return null;

  const account = await ensureAccount(identity);
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

  const membership = await getD1()
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
  const result = await getD1()
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
  const db = getD1();
  const [
    usersResult,
    workspacesResult,
    membersResult,
    activePlansResult,
    suspendedWorkspacesResult,
  ] = await db.batch([
    db.prepare("SELECT COUNT(*) AS count FROM users"),
    db.prepare("SELECT COUNT(*) AS count FROM workspaces"),
    db.prepare("SELECT COUNT(*) AS count FROM workspace_members"),
    db.prepare("SELECT COUNT(*) AS count FROM plans WHERE status = 'active'"),
    db.prepare(
      "SELECT COUNT(*) AS count FROM workspaces WHERE status = 'suspended'",
    ),
  ]);

  const count = (result: D1Result<unknown>) =>
    Number((result.results[0] as { count?: number } | undefined)?.count ?? 0);

  return {
    users: count(usersResult),
    workspaces: count(workspacesResult),
    memberships: count(membersResult),
    activePlans: count(activePlansResult),
    suspendedWorkspaces: count(suspendedWorkspacesResult),
  };
}

export async function listAdminUsers(): Promise<AdminUserView[]> {
  const result = await getD1()
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
  const result = await getD1()
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
