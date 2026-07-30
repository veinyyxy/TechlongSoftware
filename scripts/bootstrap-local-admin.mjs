import { createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { Pool, neonConfig } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL?.trim();
const email = process.env.AUTH_BOOTSTRAP_EMAIL?.trim().toLowerCase();
const password = process.env.AUTH_BOOTSTRAP_PASSWORD ?? "";
const name = process.env.AUTH_BOOTSTRAP_NAME?.trim() || "平台管理员";
const iterations = 600_000;

if (!connectionString) throw new Error("DATABASE_URL is required.");
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error("AUTH_BOOTSTRAP_EMAIL must be a valid email.");
}
if (password.length < 12 || password.length > 128) {
  throw new Error(
    "AUTH_BOOTSTRAP_PASSWORD must contain 12 to 128 characters.",
  );
}

neonConfig.webSocketConstructor = WebSocket;

const salt = randomBytes(16);
const passwordHash = pbkdf2Sync(
  password,
  salt,
  iterations,
  32,
  "sha256",
).toString("hex");
const saltHex = salt.toString("hex");
const now = Date.now();
const pool = new Pool({ connectionString });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  const existing = await client.query(
    "SELECT id FROM users WHERE lower(email) = $1 LIMIT 1",
    [email],
  );
  const userId = existing.rows[0]?.id ?? stableId("usr", email);

  if (existing.rows.length) {
    await client.query(
      `UPDATE users
       SET name = $1, status = 'active', is_platform_admin = 1, updated_at = $2
       WHERE id = $3`,
      [name, now, userId],
    );
  } else {
    await client.query(
      `INSERT INTO users (
        id, email, name, status, is_platform_admin, created_at, updated_at
      ) VALUES ($1, $2, $3, 'active', 1, $4, $4)`,
      [userId, email, name, now],
    );
  }

  const membership = await client.query(
    "SELECT id FROM workspace_members WHERE user_id = $1 LIMIT 1",
    [userId],
  );
  if (!membership.rows.length) {
    const workspaceId = stableId("wsp", userId);
    const membershipId = stableId("wsm", `${workspaceId}:${userId}`);
    await client.query(
      `INSERT INTO workspaces (
        id, name, owner_id, status, contact_name, contact_email,
        subscription_status, app_instance_status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, 'active', $4, $5,
        'not_configured', 'not_provisioned', $6, $6
      ) ON CONFLICT (id) DO NOTHING`,
      [workspaceId, `${name}的管理工作区`, userId, name, email, now],
    );
    await client.query(
      `INSERT INTO workspace_members (
        id, workspace_id, user_id, role, joined_at
      ) VALUES ($1, $2, $3, 'owner', $4)
      ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [membershipId, workspaceId, userId, now],
    );
  }

  await client.query(
    `INSERT INTO user_credentials (
      user_id, password_hash, password_salt, password_iterations,
      failed_attempts, locked_until, password_changed_at, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, 0, NULL, $5, $5, $5)
    ON CONFLICT (user_id) DO UPDATE SET
      password_hash = excluded.password_hash,
      password_salt = excluded.password_salt,
      password_iterations = excluded.password_iterations,
      failed_attempts = 0,
      locked_until = NULL,
      password_changed_at = excluded.password_changed_at,
      updated_at = excluded.updated_at`,
    [userId, passwordHash, saltHex, iterations, now],
  );
  await client.query("DELETE FROM auth_sessions WHERE user_id = $1", [userId]);
  await client.query("COMMIT");

  console.log(
    JSON.stringify({
      userId,
      email,
      role: "platform_admin",
      passwordReset: Boolean(existing.rows.length),
    }),
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}

function stableId(prefix, value) {
  const hash = createHash("sha256")
    .update(`${prefix}:${value}`)
    .digest("hex");
  return `${prefix}_${hash.slice(0, 24)}`;
}
