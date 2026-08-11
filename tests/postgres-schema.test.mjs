import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { migrationChecksum } from "../scripts/migration-checksum.mjs";

const root = new URL("../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

test("PostgreSQL migration checksums are stable across Windows line endings", () => {
  const lf = "CREATE TABLE example (id text);\nSELECT 1;\n";
  const crlf = lf.replaceAll("\n", "\r\n");
  assert.equal(migrationChecksum(lf), migrationChecksum(crlf));
});

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
    "deployment_tenant_resources",
    "deployment_tenant_resource_events",
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

test("tenant resource migration persists reference-only lifecycle checkpoints", async () => {
  const [migration, lifecycle] = await Promise.all([
    read("db/postgres-migrations/0005_tenant_resource_lifecycle.sql"),
    read("lib/deployments/execution/tenant-database.ts"),
  ]);
  assert.match(migration, /CREATE TABLE deployment_tenant_resources\b/);
  assert.match(migration, /app_instance_id text PRIMARY KEY/);
  assert.match(migration, /created_by_deployment_id text NOT NULL/);
  assert.match(migration, /owner_deployment_id text NOT NULL/);
  assert.match(migration, /generation bigint NOT NULL DEFAULT 1/);
  assert.match(migration, /stable_identity_hash text NOT NULL/);
  assert.doesNotMatch(migration, /deployment_id text PRIMARY KEY/);
  assert.doesNotMatch(migration, /last_deployment_id/);
  assert.match(migration, /environment_id text NOT NULL/);
  assert.match(migration, /workspace_id text NOT NULL/);
  assert.match(migration, /product_id text NOT NULL/);
  assert.match(migration, /database_name ~ '\^\[a-z\]\[a-z0-9_\]\{2,62\}\$'/);
  assert.match(migration, /role_name ~ '\^\[a-z\]\[a-z0-9_\]\{2,62\}\$'/);
  assert.match(migration, /runtime_secret_ref text/);
  assert.match(migration, /arn:aws:secretsmanager/);
  assert.match(migration, /'planned', 'reopening', 'secret_ready'/);
  assert.match(migration, /'baseline_restored'/);
  assert.match(migration, /'saas_migrated'/);
  assert.match(migration, /'verified'/);
  assert.match(migration, /'destroying', 'destroyed', 'failed'/);
  assert.match(migration, /deployment_tenant_resources_database_unique/);
  assert.match(migration, /deployment_tenant_resources_role_unique/);
  assert.match(migration, /deployment_tenant_resources_secret_name_unique/);
  assert.match(migration, /deployment_tenant_resources_secret_ref_unique/);
  assert.match(migration, /deployment_tenant_resources_created_deployment_idx/);
  assert.match(migration, /deployment_tenant_resources_owner_deployment_idx/);
  assert.match(migration, /CREATE TABLE deployment_tenant_resource_events\b/);
  assert.match(migration, /'claimed', 'handed_off', 'reopened'/);
  assert.match(migration, /'cleanup_started', 'workload_destroyed'/);
  assert.match(migration, /deployment_tenant_resource_events_instance_generation_idx/);
  assert.match(migration, /deployment_tenant_resource_events_deployment_idx/);
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION enforce_deployment_tenant_resource_relationships/,
  );
  assert.match(migration, /deployment tenant resource ownership mismatch/);
  assert.match(migration, /NEW\.owner_deployment_id/);
  assert.match(migration, /NEW\.created_by_deployment_id/);
  assert.match(migration, /deployment tenant resource stable identity is immutable/);
  assert.match(migration, /deployment tenant resource owner cannot move backward/);
  assert.match(
    migration,
    /non-destroyed tenant resource owner handoff is disabled/,
  );
  assert.match(migration, /deployment tenant resource owner still has a live lease/);
  assert.match(migration, /deployment tenant resource cleanup fence cannot regress/);
  assert.match(migration, /deployment tenant resource lifecycle cannot regress/);
  assert.match(
    migration,
    /candidate_owner_created_at = previous_owner_created_at[\s\S]*?NEW\.owner_deployment_id <= OLD\.owner_deployment_id/,
  );
  assert.match(
    migration,
    /OLD\.lifecycle_status = 'destroyed'[\s\S]*?NEW\.lifecycle_status = 'reopening'[\s\S]*?NEW\.generation = OLD\.generation \+ 1/,
  );
  assert.match(
    migration,
    /substring\(stable_identity_hash FROM 1 FOR 32\)[\s\S]*?generation::text/,
  );
  assert.match(
    lifecycle,
    /tl_owner_\$\{identity\.stableIdentityHash\.slice\(0, 32\)\}_g\$\{generation\}/,
  );
  assert.match(
    migration,
    /WHEN 'verified' THEN 5[\s\S]*?next_lifecycle_rank > previous_lifecycle_rank/,
  );
  assert.match(migration, /BEFORE INSERT OR UPDATE ON deployment_tenant_resources/);
  assert.match(migration, /deployment tenant resource events are append-only/);
  assert.match(
    migration,
    /BEFORE UPDATE OR DELETE ON deployment_tenant_resource_events/,
  );
  assert.match(migration, /DROP INDEX deployment_step_runs_attempt_unique/);
  assert.match(
    migration,
    /ON deployment_step_runs \(job_id, step_key, input_hash, attempt\)/,
  );
  assert.match(
    migration,
    /lifecycle_status = 'destroyed' AND destroyed_at IS NOT NULL/,
  );
  assert.match(migration, /'verified', 'destroyed'[\s\S]*?evidence_hash IS NOT NULL/);
  assert.doesNotMatch(migration, /password|database_url|secret_value/i);
});

test("S3 execution repository reserves capacity atomically and commits ready state as one statement", async () => {
  const repository = await read("lib/deployments/execution/neon-repository.ts");
  assert.match(
    repository,
    /ON CONFLICT \(job_id, step_key, input_hash, attempt\) DO NOTHING/,
  );
  assert.doesNotMatch(
    repository,
    /ON CONFLICT \(deployment_id, step_key, input_hash, attempt\) DO NOTHING/,
  );
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

test("deployment step identities are scoped to the owning job", async () => {
  const jobs = await read("lib/deployments/jobs.ts");
  assert.match(
    jobs,
    /\$\{input\.deploymentId\}:\$\{input\.jobId\}:\$\{input\.stepKey\}:\$\{input\.inputHash\}:\$\{input\.attempt\}/,
  );
});

test("S3 execution repository binds immutable templates and tenant lifecycle writes to the live lease", async () => {
  const repository = await read("lib/deployments/execution/neon-repository.ts");
  assert.match(repository, /ai\.template_version_id/);
  assert.match(
    repository,
    /LEFT JOIN deployment_tenant_resources tr[\s\S]*?ON tr\.app_instance_id = ai\.id/,
  );
  assert.doesNotMatch(
    repository,
    /ON tr\.app_instance_id = ai\.id\s+AND tr\.environment_id/,
  );
  assert.match(repository, /templateVersionId/);
  assert.match(repository, /tenantResources/);
  assert.match(
    repository,
    /recordTenantResourceLifecycle[\s\S]*?assertSafeTenantResourceEvidence\(input\.evidence\)/,
  );
  assert.match(
    repository,
    /recordTenantResourceLifecycle[\s\S]*?job\.status = 'running'[\s\S]*?job\.lease_owner = \$3[\s\S]*?job\.lease_expires_at > \$4/,
  );
  assert.match(
    repository,
    /recordTenantResourceLifecycle[\s\S]*?resource\.owner_deployment_id = \$1[\s\S]*?resource\.generation = \$6[\s\S]*?resource\.ownership_marker = \$7/,
  );
  assert.match(
    repository,
    /claimTenantResourceGeneration[\s\S]*?candidate_created_at[\s\S]*?owner_created_at/,
  );
  assert.match(
    repository,
    /claimTenantResourceGeneration[\s\S]*?candidate\.candidate_created_at > existing\.owner_created_at[\s\S]*?candidate\.deployment_id > existing\.owner_deployment_id/,
  );
  assert.match(
    repository,
    /claimTenantResourceGeneration[\s\S]*?previous_status = 'destroyed'[\s\S]*?candidate_is_newer[\s\S]*?NOT owner_has_live_job/,
  );
  assert.match(
    repository,
    /previous_status = 'destroyed'[\s\S]*?previous_generation \+ 1[\s\S]*?'reopening'/,
  );
  assert.match(
    repository,
    /deployment_tenant_resource_events[\s\S]*?previousOwnerDeploymentId/,
  );
  assert.match(
    repository,
    /beginTenantResourceCleanup[\s\S]*?lifecycle_status = 'destroying'[\s\S]*?already_completed[\s\S]*?locked\.lifecycle_status = 'destroyed'[\s\S]*?cleanup_started/,
  );
  assert.match(
    repository,
    /assertTenantResourceCleanupFence[\s\S]*?resource\.generation = \$4[\s\S]*?resource\.lifecycle_status IN \('destroying', 'destroyed'\)/,
  );
  assert.match(
    repository,
    /completeTenantResourceCleanup[\s\S]*?lifecycle_status = 'destroyed'[\s\S]*?resource\.owner_deployment_id = \$1[\s\S]*?resource\.generation = \$6/,
  );
  assert.match(
    repository,
    /sha256Hex\(`\$\{input\.deploymentId\}:\$\{input\.jobId\}:\$\{input\.stepKey\}/,
  );
  assert.match(repository, /TENANT_RESOURCE_IDENTITY_MISMATCH/);
  assert.match(
    repository,
    /TENANT_RESOURCE_HANDOFF_REQUIRES_OWNERSHIP_EPOCH/,
  );
  assert.match(repository, /must not contain URLs or URIs/);
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
