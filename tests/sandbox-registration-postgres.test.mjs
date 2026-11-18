import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import {
  SANDBOX_REGISTER_ACCOUNT,
  SANDBOX_REGISTRATION_WORKSPACE,
  usesSandboxRegistration,
} from "../lib/auth/sandbox-registration.ts";
import { normalizeAuthEmail } from "../lib/auth/validation.ts";
import { PASSWORD_ITERATIONS } from "../lib/auth/security.ts";
import { stableId } from "../lib/domain/ids.ts";
import { sandboxRegistrationDdl } from "../ops/platform-web-database-role-v1/sandbox-registration-ddl.ts";

const email = normalizeAuthEmail(" Sandbox-Trial@Example.Invalid ");
const fingerprint = createHash("sha256").update(email, "utf8").digest("hex");
const webRole = "techlong_platform_web_acceptance_v1";
const definer = "techlong_sandbox_registration_definer";
const tables = ["users", "workspaces", "workspace_members", "user_credentials"];

test("sandbox registration only uses the fixed server ingress and accepts only a SHA-256 binding", () => {
  const settings = {
    TECHLONG_PLATFORM_INGRESS: "alb-https-v1",
    TECHLONG_PLATFORM_PUBLIC_ORIGIN: "https://console.sandbox.techlong.cloud",
  };
  assert.equal(usesSandboxRegistration(settings), true);
  assert.equal(usesSandboxRegistration({ ...settings, TECHLONG_PLATFORM_INGRESS: "" }), false);
  assert.equal(usesSandboxRegistration({ ...settings, TECHLONG_PLATFORM_PUBLIC_ORIGIN: "https://example.invalid" }), false);
  assert.equal(usesSandboxRegistration({}), false);
  for (const invalid of [email, "", null, fingerprint + "\n", fingerprint.slice(0, -1) + "'"]) {
    assert.throws(() => sandboxRegistrationDdl(invalid), /normalized-email SHA-256/);
  }
  const ddl = sandboxRegistrationDdl(fingerprint);
  assert.ok(ddl.includes(fingerprint));
  assert.ok(!ddl.includes(email));
});

const testUrl = process.env.INSTANCE_RELEASE_TEST_DATABASE_URL;
test("disposable PostgreSQL: four atomic inserts through the restricted function, no new Web table writes", { skip: !testUrl }, async () => {
  // Only the existing synthetic CI service. Never use DATABASE_URL or .env.
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.CI, "true");
  const url = new URL(testUrl);
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/instance_release_ci");
  assert.equal(url.username, "postgres");
  assert.equal(url.password, "synthetic-ci-only");
  assert.equal(url.search, "");
  const connect = (uri) => new pg.Client({ connectionString: String(uri), statement_timeout: 5000 });
  const admin = connect(url);
  const dbUrl = new URL(url);
  dbUrl.pathname = "/sandbox_registration_ci";
  const db = connect(dbUrl);
  const login = (username) => {
    const roleUrl = new URL(dbUrl);
    roleUrl.username = username;
    return connect(roleUrl);
  };
  const web = login(webRole);
  const outsider = login("sandbox_registration_outsider_ci");
  try {
    await admin.connect();
    await admin.query("CREATE DATABASE sandbox_registration_ci");
    await db.connect();
    await db.query(await readFile(new URL("../db/postgres-schema.sql", import.meta.url), "utf8"));
    await db.query(`CREATE ROLE ${webRole} LOGIN NOINHERIT PASSWORD 'synthetic-ci-only';
      CREATE ROLE sandbox_registration_outsider_ci LOGIN PASSWORD 'synthetic-ci-only';
      GRANT SELECT ON public.users, public.workspaces, public.workspace_members TO ${webRole};
      GRANT SELECT (user_id, password_hash, password_salt, password_iterations, failed_attempts, locked_until),
        UPDATE (failed_attempts, locked_until, updated_at) ON public.user_credentials TO ${webRole};
      GRANT SELECT, INSERT, DELETE ON public.auth_sessions TO ${webRole};
      ALTER TABLE public.user_credentials ADD CHECK (password_hash <> repeat('f', 64));`);
    await db.query(sandboxRegistrationDdl(fingerprint));
    await web.connect();
    await outsider.connect();

    let parameter = 0;
    const sql = SANDBOX_REGISTER_ACCOUNT.replaceAll("?", () => `$${++parameter}`);
    const args = [email, "测试用户", "a".repeat(64), "b".repeat(32)];
    const assertCounts = async (expected) => {
      for (const table of tables) {
        assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.${table}`)).rows[0].n, expected, table);
      }
      for (const table of ["auth_sessions", "subscriptions", "app_instances", "deployment_jobs"]) {
        assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.${table}`)).rows[0].n, 0, table);
      }
    };
    // Check effective privileges, including any column grant inherited from PUBLIC.
    for (const table of tables) {
      const { rows: [grants] } = await db.query(`SELECT
        has_any_column_privilege($1, $2, 'INSERT') AS web_insert,
        has_column_privilege($1, 'public.users', 'is_platform_admin', 'UPDATE') AS admin_update,
        has_any_column_privilege($3, $2, 'INSERT') AS definer_insert,
        has_any_column_privilege($3, $2, 'SELECT,UPDATE') AS definer_read_update,
        has_table_privilege($3, $2, 'INSERT,DELETE,TRUNCATE') AS definer_table_write`,
      [webRole, `public.${table}`, definer]);
      assert.deepEqual(grants, { web_insert: false, admin_update: false, definer_insert: true,
        definer_read_update: false, definer_table_write: false });
    }
    assert.deepEqual((await db.query("SELECT rolcanlogin, rolinherit, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1", [definer])).rows[0],
      { rolcanlogin: false, rolinherit: false, rolbypassrls: false, rolsuper: false });
    const access = (await db.query(`SELECT has_schema_privilege('sandbox_registration_outsider_ci', 'sandbox_registration', 'USAGE') AS usage,
      has_function_privilege('sandbox_registration_outsider_ci', 'sandbox_registration.register_account(text,text,text,text)', 'EXECUTE') AS execute`)).rows[0];
    assert.deepEqual(access, { usage: false, execute: false });
    await assert.rejects(outsider.query(sql, args), { code: "42501" });
    await assert.rejects(web.query(`SET ROLE ${definer}`), { code: "42501" });
    await assert.rejects(web.query("INSERT INTO public.users (id, email, name, is_platform_admin, created_at, updated_at) VALUES ('x', 'x', 'x', 1, 0, 0)"), { code: "42501" });
    await assert.rejects(web.query("UPDATE public.users SET is_platform_admin = 1"), { code: "42501" });
    await assert.rejects(web.query("SELECT sandbox_registration.register_account($1,$2,$3,$4, 'admin')", args), { code: "42883" });
    for (const invalid of [["other@example.invalid", ...args.slice(1)], [email.toUpperCase(), ...args.slice(1)],
      [email, null, ...args.slice(2)], [email, "  ", ...args.slice(2)], [email, args[1], "plaintext", args[3]], [...args.slice(0, 3), "bad-salt"]]) {
      await assert.rejects(web.query(sql, invalid), { code: "22023" });
    }
    // A valid-shaped hash violates the fourth INSERT's synthetic constraint.
    await assert.rejects(web.query(sql, [email, args[1], "f".repeat(64), args[3]]), { code: "23514" });
    await assertCounts(0);

    const userId = await stableId("usr", email);
    const workspaceId = await stableId("wsp", userId);
    const membershipId = await stableId("wsm", `${workspaceId}:${userId}`);
    assert.deepEqual((await web.query(sql, args)).rows, [{ user_id: userId }]);
    await assert.rejects(web.query(sql, [email, "Not a replacement", args[2], args[3]]), { code: "23505" });
    await assertCounts(1);
    assert.deepEqual((await web.query("SELECT id,email,name,status,is_platform_admin FROM public.users")).rows,
      [{ id: userId, email, name: args[1], status: "active", is_platform_admin: 0 }]);
    assert.deepEqual((await web.query("SELECT id,name,owner_id,status,subscription_status,app_instance_status FROM public.workspaces")).rows,
      [{ id: workspaceId, name: SANDBOX_REGISTRATION_WORKSPACE, owner_id: userId, status: "active",
        subscription_status: "not_configured", app_instance_status: "not_provisioned" }]);
    assert.deepEqual((await web.query("SELECT id,workspace_id,user_id,role FROM public.workspace_members")).rows,
      [{ id: membershipId, workspace_id: workspaceId, user_id: userId, role: "owner" }]);
    assert.deepEqual((await web.query("SELECT user_id,password_hash,password_salt,password_iterations,failed_attempts,locked_until FROM public.user_credentials")).rows,
      [{ user_id: userId, password_hash: args[2], password_salt: args[3], password_iterations: PASSWORD_ITERATIONS,
        failed_attempts: 0, locked_until: null }]);
  } finally {
    await Promise.allSettled([web.end(), outsider.end(), db.end(), admin.end()]);
  }
});
