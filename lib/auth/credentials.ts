import { env } from "cloudflare:workers";
import { getDatabase } from "@/db";
import { randomId, stableId } from "@/lib/domain/ids";
import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  PASSWORD_ITERATIONS,
  verifyPassword,
} from "./security.ts";
import { normalizeAuthEmail } from "./validation.ts";

const SESSION_DAYS_DEFAULT = 7;
const INVITATION_HOURS = 48;
const MAX_FAILED_ATTEMPTS = 5;
const LOGIN_LOCK_MINUTES = 15;
const DUMMY_SALT = "00000000000000000000000000000000";
const DUMMY_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";

export class AuthenticationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

interface CredentialRow {
  user_id: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  failed_attempts: number;
  locked_until: number | null;
}

interface LoginUserRow extends CredentialRow {
  email: string;
  name: string;
  status: "active" | "disabled";
}

interface InvitationRow {
  id: string;
  user_id: string;
  email: string;
  name: string;
  workspace_name: string;
  expires_at: number;
  accepted_at: number | null;
}

export interface SessionResult {
  token: string;
  expiresAt: number;
}

export interface InvitationPreview {
  email: string;
  name: string;
  workspaceName: string;
  expiresAt: number;
}

export async function loginWithPassword(
  emailValue: string,
  password: string,
): Promise<{ userId: string; session: SessionResult }> {
  const email = normalizeAuthEmail(emailValue);
  const credential = await getDatabase()
    .prepare(
      `SELECT
        credential.user_id,
        credential.password_hash,
        credential.password_salt,
        credential.password_iterations,
        credential.failed_attempts,
        credential.locked_until,
        users.email,
        users.name,
        users.status
       FROM user_credentials credential
       INNER JOIN users ON users.id = credential.user_id
       WHERE users.email = ?
       LIMIT 1`,
    )
    .bind(email)
    .first<LoginUserRow>();

  if (!credential) {
    await verifyPassword(password, {
      hash: DUMMY_HASH,
      salt: DUMMY_SALT,
      iterations: PASSWORD_ITERATIONS,
    });
    throw invalidCredentials();
  }

  const now = Date.now();
  if (credential.locked_until && credential.locked_until > now) {
    throw new AuthenticationError(
      "LOGIN_TEMPORARILY_LOCKED",
      "登录尝试过多，请稍后再试。",
      429,
    );
  }

  const valid = await verifyPassword(password, {
    hash: credential.password_hash,
    salt: credential.password_salt,
    iterations: Number(credential.password_iterations),
  });
  if (!valid) {
    const failedAttempts =
      credential.locked_until && credential.locked_until <= now
        ? 1
        : Number(credential.failed_attempts) + 1;
    const lockedUntil =
      failedAttempts >= MAX_FAILED_ATTEMPTS
        ? now + LOGIN_LOCK_MINUTES * 60 * 1000
        : null;
    await getDatabase()
      .prepare(
        `UPDATE user_credentials
         SET failed_attempts = ?, locked_until = ?, updated_at = ?
         WHERE user_id = ?`,
      )
      .bind(failedAttempts, lockedUntil, now, credential.user_id)
      .run();
    throw invalidCredentials();
  }

  if (credential.status !== "active") {
    throw new AuthenticationError(
      "ACCOUNT_DISABLED",
      "该账号已停用，请联系平台管理员。",
      403,
    );
  }

  await getDatabase()
    .prepare(
      `UPDATE user_credentials
       SET failed_attempts = 0, locked_until = NULL, updated_at = ?
       WHERE user_id = ?`,
    )
    .bind(now, credential.user_id)
    .run();

  return {
    userId: credential.user_id,
    session: await createSession(credential.user_id),
  };
}

export async function registerAccount(input: {
  email: string;
  name: string;
  workspaceName: string;
  password: string;
}): Promise<{ userId: string; session: SessionResult }> {
  const db = getDatabase();
  const email = normalizeAuthEmail(input.email);
  const existing = await db
    .prepare("SELECT id FROM users WHERE email = ? LIMIT 1")
    .bind(email)
    .first<{ id: string }>();
  if (existing) {
    throw new AuthenticationError(
      "EMAIL_ALREADY_EXISTS",
      "该邮箱已存在。请直接登录，或联系管理员获取邀请链接。",
      409,
    );
  }

  const digest = await hashPassword(input.password);
  const userId = await stableId("usr", email);
  const workspaceId = await stableId("wsp", userId);
  const membershipId = await stableId("wsm", `${workspaceId}:${userId}`);
  const now = Date.now();

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO users (
            id, email, name, status, is_platform_admin, created_at, updated_at
          ) VALUES (?, ?, ?, 'active', 0, ?, ?)`,
        )
        .bind(userId, email, input.name.trim(), now, now),
      db
        .prepare(
          `INSERT INTO workspaces (
            id, name, owner_id, status, contact_name, contact_email,
            subscription_status, app_instance_status, created_at, updated_at
          ) VALUES (?, ?, ?, 'active', ?, ?, 'not_configured',
            'not_provisioned', ?, ?)`,
        )
        .bind(
          workspaceId,
          input.workspaceName.trim(),
          userId,
          input.name.trim(),
          email,
          now,
          now,
        ),
      db
        .prepare(
          `INSERT INTO workspace_members (
            id, workspace_id, user_id, role, joined_at
          ) VALUES (?, ?, ?, 'owner', ?)`,
        )
        .bind(membershipId, workspaceId, userId, now),
      db
        .prepare(
          `INSERT INTO user_credentials (
            user_id, password_hash, password_salt, password_iterations,
            password_changed_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          userId,
          digest.hash,
          digest.salt,
          digest.iterations,
          now,
          now,
          now,
        ),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AuthenticationError(
        "EMAIL_ALREADY_EXISTS",
        "该邮箱已存在。请直接登录，或联系管理员获取邀请链接。",
        409,
      );
    }
    throw error;
  }

  return { userId, session: await createSession(userId) };
}

export async function acceptInvitation(input: {
  token: string;
  email: string;
  name: string;
  password: string;
}): Promise<{ userId: string; session: SessionResult }> {
  const db = getDatabase();
  const tokenHash = await hashOpaqueToken(input.token);
  const invitation = await findInvitation(tokenHash);
  const now = Date.now();

  if (
    !invitation ||
    invitation.accepted_at ||
    invitation.expires_at <= now ||
    normalizeAuthEmail(invitation.email) !== normalizeAuthEmail(input.email)
  ) {
    throw new AuthenticationError(
      "INVITATION_INVALID",
      "邀请链接无效、已使用或已过期。",
      400,
    );
  }

  const existingCredential = await db
    .prepare("SELECT user_id FROM user_credentials WHERE user_id = ? LIMIT 1")
    .bind(invitation.user_id)
    .first<{ user_id: string }>();
  if (existingCredential) {
    throw new AuthenticationError(
      "ACCOUNT_ALREADY_ACTIVATED",
      "该账号已经设置密码，请直接登录。",
      409,
    );
  }

  const digest = await hashPassword(input.password);
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO user_credentials (
            user_id, password_hash, password_salt, password_iterations,
            password_changed_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          invitation.user_id,
          digest.hash,
          digest.salt,
          digest.iterations,
          now,
          now,
          now,
        ),
      db
        .prepare(
          `UPDATE users
           SET name = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(input.name.trim(), now, invitation.user_id),
      db
        .prepare(
          `UPDATE auth_invitations
           SET accepted_at = ?
           WHERE id = ? AND accepted_at IS NULL`,
        )
        .bind(now, invitation.id),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AuthenticationError(
        "ACCOUNT_ALREADY_ACTIVATED",
        "该账号已经设置密码，请直接登录。",
        409,
      );
    }
    throw error;
  }

  return {
    userId: invitation.user_id,
    session: await createSession(invitation.user_id),
  };
}

export async function getInvitationPreview(
  token: string,
): Promise<InvitationPreview | null> {
  if (!/^[a-f0-9]{64}$/i.test(token)) return null;
  const invitation = await findInvitation(await hashOpaqueToken(token));
  if (
    !invitation ||
    invitation.accepted_at ||
    invitation.expires_at <= Date.now()
  ) {
    return null;
  }
  return {
    email: invitation.email,
    name: invitation.name,
    workspaceName: invitation.workspace_name,
    expiresAt: invitation.expires_at,
  };
}

export async function createUserInvitation(
  userId: string,
  createdByUserId: string,
): Promise<{ token: string; expiresAt: number }> {
  const db = getDatabase();
  const user = await db
    .prepare(
      `SELECT users.id,
        EXISTS (
          SELECT 1 FROM user_credentials WHERE user_credentials.user_id = users.id
        ) AS has_password
       FROM users
       WHERE users.id = ?
       LIMIT 1`,
    )
    .bind(userId)
    .first<{ id: string; has_password: boolean | number }>();
  if (!user) {
    throw new AuthenticationError("USER_NOT_FOUND", "没有找到该用户。", 404);
  }
  if (Boolean(user.has_password)) {
    throw new AuthenticationError(
      "ACCOUNT_ALREADY_ACTIVATED",
      "该账号已经设置密码，可以直接登录。",
      409,
    );
  }

  const token = createOpaqueToken();
  const tokenHash = await hashOpaqueToken(token);
  const id = randomId("inv");
  const now = Date.now();
  const expiresAt = now + INVITATION_HOURS * 60 * 60 * 1000;

  await db.batch([
    db
      .prepare(
        `UPDATE auth_invitations
         SET expires_at = ?
         WHERE user_id = ? AND accepted_at IS NULL AND expires_at > ?`,
      )
      .bind(now, userId, now),
    db
      .prepare(
        `INSERT INTO auth_invitations (
          id, user_id, token_hash, expires_at, accepted_at,
          created_by_user_id, created_at
        ) VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      )
      .bind(id, userId, tokenHash, expiresAt, createdByUserId, now),
  ]);

  return { token, expiresAt };
}

export async function userHasPassword(userId: string): Promise<boolean> {
  const row = await getDatabase()
    .prepare("SELECT user_id FROM user_credentials WHERE user_id = ? LIMIT 1")
    .bind(userId)
    .first<{ user_id: string }>();
  return Boolean(row);
}

export async function createSession(userId: string): Promise<SessionResult> {
  const db = getDatabase();
  const token = createOpaqueToken();
  const tokenHash = await hashOpaqueToken(token);
  const id = randomId("ses");
  const now = Date.now();
  const expiresAt = now + sessionDays() * 24 * 60 * 60 * 1000;

  await db.batch([
    db
      .prepare("DELETE FROM auth_sessions WHERE expires_at <= ?")
      .bind(now),
    db
      .prepare(
        `INSERT INTO auth_sessions (
          id, user_id, token_hash, expires_at, last_seen_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, userId, tokenHash, expiresAt, now, now),
  ]);
  return { token, expiresAt };
}

export async function deleteSession(token: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/i.test(token)) return;
  const tokenHash = await hashOpaqueToken(token);
  await getDatabase()
    .prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
    .bind(tokenHash)
    .run();
}

function findInvitation(tokenHash: string): Promise<InvitationRow | null> {
  return getDatabase()
    .prepare(
      `SELECT
        invitation.id,
        invitation.user_id,
        invitation.expires_at,
        invitation.accepted_at,
        users.email,
        users.name,
        workspaces.name AS workspace_name
       FROM auth_invitations invitation
       INNER JOIN users ON users.id = invitation.user_id
       INNER JOIN workspaces ON workspaces.owner_id = users.id
       WHERE invitation.token_hash = ?
       ORDER BY workspaces.created_at ASC
       LIMIT 1`,
    )
    .bind(tokenHash)
    .first<InvitationRow>();
}

function sessionDays(): number {
  const bindings = env as unknown as Record<string, unknown>;
  const value = Number(
    typeof bindings.AUTH_SESSION_DAYS === "string"
      ? bindings.AUTH_SESSION_DAYS
      : typeof process !== "undefined"
        ? process.env.AUTH_SESSION_DAYS
        : Number.NaN,
  );
  return Number.isInteger(value) && value >= 1 && value <= 30
    ? value
    : SESSION_DAYS_DEFAULT;
}

function invalidCredentials(): AuthenticationError {
  return new AuthenticationError(
    "INVALID_CREDENTIALS",
    "邮箱或密码不正确。",
    401,
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (/unique/i.test(error.message) || /duplicate key/i.test(error.message))
  );
}
