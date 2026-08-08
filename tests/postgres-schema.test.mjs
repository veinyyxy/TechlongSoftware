import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

test("runtime uses Neon PostgreSQL through the server-only DATABASE_URL", async () => {
  const [databaseEntry, adapter, example, homepage] = await Promise.all([
    read("db/index.ts"),
    read("db/postgres.ts"),
    read(".env.example"),
    read("app/page.tsx"),
  ]);

  assert.match(databaseEntry, /getPostgresDatabase/);
  assert.match(databaseEntry, /export function getDatabase/);
  assert.doesNotMatch(databaseEntry, /drizzle-orm\/d1/);
  assert.match(adapter, /@neondatabase\/serverless/);
  assert.match(adapter, /DATABASE_URL/);
  assert.match(example, /^DATABASE_URL=/m);
  assert.doesNotMatch(example, /neondb_owner|npg_/);
  assert.match(homepage, /Neon PostgreSQL/);
});

test("PostgreSQL schema contains all business tables and core integrity rules", async () => {
  const sql = await read("db/postgres-schema.sql");
  const expectedTables = [
    "users",
    "user_credentials",
    "auth_sessions",
    "auth_invitations",
    "products",
    "app_instance_templates",
    "app_instance_template_versions",
    "plans",
    "workspaces",
    "subscriptions",
    "payment_records",
    "payment_checkout_sessions",
    "app_instances",
    "subscription_purchase_orders",
    "app_instance_deployments",
    "payment_webhook_events",
    "workspace_members",
    "workspace_product_entitlements",
  ];

  for (const table of expectedTables) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table}\\b`));
  }

  assert.match(sql, /subscriptions_workspace_product_current_unique/);
  assert.match(sql, /auth_sessions_token_hash_unique/);
  assert.match(sql, /auth_invitations_token_hash_unique/);
  assert.match(sql, /app_instances_workspace_product_unique/);
  assert.match(sql, /app_instance_deployments_idempotency_unique/);
  assert.match(
    sql,
    /CREATE TABLE plans[\s\S]*?deployment_profile_key text NOT NULL DEFAULT 'standard-v1'/,
  );
  assert.match(
    sql,
    /CREATE TABLE subscriptions[\s\S]*?deployment_profile_key text NOT NULL DEFAULT 'standard-v1'/,
  );
  assert.match(
    sql,
    /CREATE TABLE subscription_purchase_orders[\s\S]*?deployment_profile_key text NOT NULL DEFAULT 'standard-v1'/,
  );
  assert.match(
    sql,
    /CREATE TABLE app_instance_deployments[\s\S]*?mode text NOT NULL DEFAULT 'plan_only'/,
  );
  assert.match(
    sql,
    /CREATE TABLE app_instance_deployments[\s\S]*?status text NOT NULL DEFAULT 'planned'/,
  );
  assert.match(sql, /jsonb_typeof\(desired_plan::jsonb\) = 'object'/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION enforce_subscription_relationships/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION enforce_template_version_immutability/);
  assert.match(sql, /::jsonb/);
  assert.match(sql, /\bbigint\b/i);
  assert.doesNotMatch(sql, /PRAGMA|AUTOINCREMENT|INSERT OR IGNORE/);
});

test("deployment planning migration snapshots the profile and idempotent plan record", async () => {
  const migration = await read(
    "db/postgres-migrations/0002_app_instance_deployment_planning.sql",
  );

  for (const table of [
    "plans",
    "subscriptions",
    "subscription_purchase_orders",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `ALTER TABLE ${table}[\\s\\S]*?ADD COLUMN deployment_profile_key`,
      ),
    );
  }
  assert.match(migration, /CREATE TABLE app_instance_deployments\b/);
  assert.match(migration, /CHECK \(mode = 'plan_only'\)/);
  assert.match(migration, /app_instance_deployments_idempotency_unique/);
  assert.match(migration, /ON app_instance_deployments \(idempotency_key\)/);
});

test("temporary browser migration endpoint is removed after cutover", async () => {
  await assert.rejects(
    read("app/api/admin/database-migration/route.ts"),
    /ENOENT/,
  );
});

test("purchase-order queries avoid PostgreSQL reserved aliases", async () => {
  const purchases = await read("lib/purchases/management.ts");

  assert.match(purchases, /INNER JOIN users creator ON creator\.id/);
  assert.match(purchases, /creator\.name AS created_by_name/);
  assert.doesNotMatch(purchases, /INNER JOIN users user\b/);
});
