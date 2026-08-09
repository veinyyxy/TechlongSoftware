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
    "deployment_environments",
    "deployment_environment_bindings",
    "app_instance_deployments",
    "deployment_cleanup_schedules",
    "deployment_environment_capacity_reservations",
    "deployment_jobs",
    "deployment_step_runs",
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
    /CREATE TABLE app_instance_deployments[\s\S]*?mode text NOT NULL DEFAULT 'plan_only'[\s\S]*?'aws_sandbox'/,
  );
  assert.match(
    sql,
    /CREATE TABLE app_instance_deployments[\s\S]*?status text NOT NULL DEFAULT 'planned'/,
  );
  assert.match(sql, /jsonb_typeof\(desired_plan::jsonb\) = 'object'/);
  assert.match(sql, /sandbox\.techlong\.cloud/);
  assert.match(sql, /"auroraPostgresEngineVersion": "16\.14"/);
  assert.match(sql, /FOR UPDATE SKIP LOCKED|deployment_jobs_claim_idx/);
  assert.match(sql, /deployment_jobs_one_running_per_deployment/);
  assert.match(
    sql,
    /mode <> 'plan_only'[\s\S]*?configuration_hash IS NOT NULL/,
  );
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

test("deployment execution migration adds sandbox policy, jobs, leases and step checkpoints", async () => {
  const migration = await read(
    "db/postgres-migrations/0003_deployment_execution_foundation.sql",
  );
  assert.match(migration, /CREATE TABLE deployment_environments\b/);
  assert.match(migration, /CREATE TABLE deployment_jobs\b/);
  assert.match(migration, /CREATE TABLE deployment_step_runs\b/);
  assert.match(migration, /sandbox\.techlong\.cloud/);
  assert.match(migration, /"auroraPostgresEngineVersion": "16\.14"/);
  assert.match(migration, /'database_preparing'/);
  assert.match(migration, /'migrating'/);
  assert.match(migration, /'infrastructure_provisioning'/);
  assert.match(migration, /configuration_hash text/);
  assert.match(migration, /deployment_jobs_one_running_per_deployment/);
  assert.match(
    migration,
    /mode <> 'plan_only'[\s\S]*?configuration_hash IS NOT NULL/,
  );
  assert.doesNotMatch(migration, /repeat\('0',\s*64\)/);
});

test("S3 worker migration adds role bindings and a confirmed TTL cleanup boundary", async () => {
  const migration = await read(
    "db/postgres-migrations/0004_aws_sandbox_worker.sql",
  );
  assert.match(migration, /CREATE TABLE deployment_environment_bindings\b/);
  assert.match(migration, /worker_role_arn <> cloudformation_role_arn/);
  assert.match(migration, /CREATE TABLE deployment_cleanup_schedules\b/);
  assert.match(migration, /CREATE TABLE deployment_environment_capacity_reservations\b/);
  assert.match(migration, /deployment_environment_capacity_reservations_slot_unique/);
  assert.match(migration, /FOR UPDATE|ON CONFLICT|slot/);
  assert.match(migration, /techlong-sandbox-tenant-/);
  assert.match(migration, /provider_schedule_ref IS NOT NULL/);
  assert.match(migration, /'cleanup'/);
});

test("S3 execution repository reserves capacity atomically and commits ready state as one statement", async () => {
  const repository = await read("lib/deployments/execution/neon-repository.ts");
  assert.match(
    repository,
    /reserveEnvironmentCapacity[\s\S]*?locked_environment AS MATERIALIZED[\s\S]*?FOR UPDATE[\s\S]*?deployment_environment_capacity_reservations[\s\S]*?ON CONFLICT DO NOTHING/,
  );
  assert.match(
    repository,
    /markInstanceUnavailable[\s\S]*?DELETE FROM deployment_environment_capacity_reservations/,
  );
  assert.match(
    repository,
    /markReady[\s\S]*?WITH eligible AS MATERIALIZED[\s\S]*?FOR UPDATE OF deployment, instance, subscription, job[\s\S]*?activated_instance AS[\s\S]*?ready_deployment AS[\s\S]*?FROM eligible, activated_instance[\s\S]*?1 \/ CASE/,
  );
  assert.doesNotMatch(
    repository,
    /markReady[\s\S]{0,500}?\.transaction\s*\(/,
  );
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
