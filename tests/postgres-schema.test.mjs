import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { migrationChecksum } from "../scripts/migration-checksum.mjs";

const root = new URL("../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

function postgresFunction(source, name) {
  const marker = `CREATE OR REPLACE FUNCTION ${name}()`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing PostgreSQL function ${name}`);
  const terminator = "$$ LANGUAGE plpgsql;";
  const end = source.indexOf(terminator, start);
  assert.notEqual(end, -1, `unterminated PostgreSQL function ${name}`);
  return source.slice(start, end + terminator.length);
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
    "deployment_tenant_external_operations",
    "deployment_tenant_external_operation_events",
    "deployment_tenant_cleanup_runs",
    "deployment_tenant_cleanup_phases",
    "deployment_tenant_cleanup_events",
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

test("lease fencing migration invalidates old claims and requires a unique incarnation token", async () => {
  const migration = await read(
    "db/postgres-migrations/0006_deployment_lease_fencing.sql",
  );
  assert.match(migration, /ADD COLUMN lease_token text/);
  assert.match(
    migration,
    /UPDATE deployment_jobs[\s\S]*?ELSE 'retry_wait'[\s\S]*?WHERE status = 'running'/,
  );
  assert.match(migration, /WHEN attempts >= max_attempts THEN 'dead_letter'/);
  assert.match(migration, /FROM pg_constraint/);
  assert.match(migration, /pg_get_constraintdef/);
  assert.doesNotMatch(
    migration,
    /DROP CONSTRAINT deployment_jobs_lease_check\s*;/,
  );
  assert.match(migration, /lease_\[a-f0-9\]\{32\}/);
  assert.match(
    migration,
    /status = 'running'[\s\S]*?lease_owner IS NOT NULL[\s\S]*?lease_expires_at IS NOT NULL[\s\S]*?lease_token IS NOT NULL/,
  );
  assert.match(
    migration,
    /status <> 'running'[\s\S]*?lease_owner IS NULL[\s\S]*?lease_expires_at IS NULL[\s\S]*?lease_token IS NULL/,
  );
});

test("B5-E migration persists external ownership epochs and resumable cleanup phases", async () => {
  const [migration, schema, drizzleSchema, drizzleRelations, repository] = await Promise.all([
    read("db/postgres-migrations/0007_external_ownership_epoch_cleanup_phases.sql"),
    read("db/postgres-schema.sql"),
    read("db/postgres-schema.ts"),
    read("db/postgres-relations.ts"),
    read("lib/deployments/execution/neon-repository.ts"),
  ]);

  for (const source of [migration, schema]) {
    assert.match(source, /CREATE TABLE deployment_tenant_external_operations\b/);
    assert.match(source, /CREATE TABLE deployment_tenant_cleanup_runs\b/);
    assert.match(source, /CREATE TABLE deployment_tenant_cleanup_phases\b/);
    assert.match(source, /external_operation_epoch bigint\s+CHECK \(external_operation_epoch > 0\)/);
    assert.match(source, /WHERE state = 'active'/);
    assert.match(source, /WHERE state = 'pending_external'/);
    assert.match(source, /tenant resource external operation pointer is not active/);
    assert.match(
      source,
      /CREATE CONSTRAINT TRIGGER deployment_tenant_resources_external_operation_pointer[\s\S]*?AFTER UPDATE[\s\S]*?DEFERRABLE INITIALLY IMMEDIATE/,
    );
    assert.doesNotMatch(
      source,
      /CREATE TRIGGER deployment_tenant_resources_external_operation_pointer[\s\S]*?BEFORE UPDATE/,
    );
    assert.match(source, /B5 ownership and cleanup events are append-only/);
    assert.doesNotMatch(source, /external_operation_epoch bigint NOT NULL/);
    assert.match(
      source,
      /deployment_tenant_resources_external_operation_fkey[\s\S]*?FOREIGN KEY \(app_instance_id, generation, external_operation_epoch\)/,
    );
    assert.match(
      source,
      /deployment_tenant_external_operations_owner_epoch_unique[\s\S]*?app_instance_id, generation, epoch, owner_deployment_id/,
    );
    assert.match(
      source,
      /deployment_tenant_cleanup_runs_operation_fkey FOREIGN KEY \([\s\S]*?app_instance_id, generation, external_epoch, owner_deployment_id[\s\S]*?app_instance_id, generation, epoch, owner_deployment_id/,
    );
    assert.match(source, /tenant external operation proof is immutable within a state/);
    assert.match(source, /active tenant external operation proof is immutable/);
    assert.match(source, /provision tenant external operation cannot overtake cleanup/);
    assert.match(
      source,
      /CREATE TRIGGER deployment_tenant_cleanup_runs_transition[\s\S]*?BEFORE INSERT OR UPDATE/,
    );
    assert.match(
      source,
      /CREATE TRIGGER deployment_tenant_cleanup_phases_transition[\s\S]*?BEFORE INSERT OR UPDATE/,
    );
    assert.match(source, /tenant cleanup run phase cannot regress or skip/);
    assert.match(source, /succeeded tenant cleanup phase is immutable/);
    assert.doesNotMatch(
      source,
      /UNIQUE \(app_instance_id, generation, intent, operation_hash\)/,
    );
    assert.doesNotMatch(source, /operation_id text NOT NULL UNIQUE/);
  }

  for (const name of [
    "deployment_tenant_external_operations_identity_unique",
    "deployment_tenant_external_operations_owner_epoch_unique",
    "deployment_tenant_external_operations_state_timestamps_check",
    "deployment_tenant_external_operations_active_evidence_check",
    "deployment_tenant_external_operations_timestamp_order_check",
    "deployment_tenant_external_operation_events_transition_check",
    "deployment_tenant_cleanup_runs_operation_unique",
    "deployment_tenant_cleanup_runs_state_timestamps_check",
    "deployment_tenant_cleanup_runs_timestamp_order_check",
    "deployment_tenant_cleanup_phases_operation_unique",
    "deployment_tenant_cleanup_phases_state_receipt_check",
    "deployment_tenant_cleanup_phases_timestamp_order_check",
    "deployment_tenant_cleanup_events_phase_event_check",
  ]) {
    assert.match(drizzleSchema, new RegExp(name));
  }
  assert.match(
    drizzleSchema,
    /reverse composite pointer FK[\s\S]*?postgres-schema\.sql\/0007/,
  );
  for (const relation of [
    "deploymentTenantExternalOperationsRelations",
    "deploymentTenantExternalOperationEventsRelations",
    "deploymentTenantCleanupRunsRelations",
    "deploymentTenantCleanupPhasesRelations",
    "deploymentTenantCleanupEventsRelations",
  ]) {
    assert.match(drizzleRelations, new RegExp(relation));
  }

  assert.match(
    repository,
    /prepareTenantExternalOperation[\s\S]*?superseded_pending AS[\s\S]*?\$8 = 'cleanup'[\s\S]*?conflict\.intent = 'provision'[\s\S]*?next_epoch/,
  );
  assert.match(
    repository,
    /activateTenantExternalOperation[\s\S]*?input\.proof[\s\S]*?retired AS[\s\S]*?previous\.state = 'active'[\s\S]*?activated AS[\s\S]*?pointed AS/,
  );
  assert.match(
    repository,
    /assertTenantExternalOperation[\s\S]*?operation\.epoch = resource\.external_operation_epoch[\s\S]*?job\.lease_token/,
  );
  for (const method of [
    "beginOrResumeTenantResourceCleanup",
    "beginTenantResourceCleanupPhase",
    "completeTenantResourceCleanupPhase",
    "finalizeTenantResourceCleanup",
  ]) {
    assert.match(
      repository,
      new RegExp(`${method}[\\s\\S]*?db_clock AS MATERIALIZED[\\s\\S]*?job\\.lease_token[\\s\\S]*?job\\.attempts[\\s\\S]*?FOR UPDATE`),
    );
  }
  assert.match(
    repository,
    /finalizeTenantResourceCleanup[\s\S]*?phase_evidence\.phase_count = 3[\s\S]*?destroyed_resource AS[\s\S]*?completed_run AS[\s\S]*?completed_schedule AS[\s\S]*?rolled_back AS[\s\S]*?suspended AS[\s\S]*?released AS/,
  );
});

test("J5g-d migration persists a one-way DB-clock drain and fences every ownership source", async () => {
  const [migration, schema, drizzleSchema, repository, ownershipSource] =
    await Promise.all([
      read("db/postgres-migrations/0008_shared_cell_admission_fence.sql"),
      read("db/postgres-schema.sql"),
      read("db/postgres-schema.ts"),
      read("lib/deployments/execution/neon-repository.ts"),
      read("lib/deployments/execution/neon-shared-cell-zero-tenant-source.ts"),
    ]);

  for (const source of [migration, schema]) {
    const admissionInitialState = postgresFunction(
      source,
      "enforce_deployment_environment_admission_initial_state",
    );
    const environmentTombstone = postgresFunction(
      source,
      "enforce_draining_deployment_environment_tombstone",
    );
    const ownershipTombstone = postgresFunction(
      source,
      "enforce_draining_environment_ownership_tombstone",
    );
    const capacityAdmission = postgresFunction(
      source,
      "enforce_deployment_environment_admission_fence",
    );
    const deploymentAdmission = postgresFunction(
      source,
      "enforce_app_instance_deployment_admission",
    );
    const tenantResourceAdmission = postgresFunction(
      source,
      "enforce_deployment_tenant_resource_admission",
    );
    const cleanupScheduleAdmission = postgresFunction(
      source,
      "enforce_deployment_cleanup_schedule_admission",
    );
    const cleanupScheduleTerminal = postgresFunction(
      source,
      "enforce_deployment_cleanup_schedule_terminal_status",
    );
    const appInstanceActivation = postgresFunction(
      source,
      "enforce_app_instance_activation_admission",
    );

    assert.match(source, /admission_state text NOT NULL DEFAULT 'open'/);
    assert.match(source, /admission_epoch bigint NOT NULL DEFAULT 0/);
    assert.match(source, /admission_fence_sha256/);
    assert.match(source, /admission_provision_operation_hash/);
    assert.match(source, /admission_cell_expires_at/);
    assert.match(
      source,
      /admission_changed_at bigint(?: NOT NULL)?[\s\S]*?(?:ALTER COLUMN admission_changed_at SET NOT NULL|created_at bigint)/,
    );
    assert.match(
      source,
      /admission_state = 'open'[\s\S]*?admission_epoch >= 0[\s\S]*?admission_state = 'draining'[\s\S]*?admission_epoch > 0/,
    );
    assert.match(
      source,
      /CREATE OR REPLACE FUNCTION enforce_deployment_environment_admission_transition\(\)[\s\S]*?transaction_timestamp\(\)[\s\S]*?OLD\.admission_state = 'draining'[\s\S]*?admission fence is immutable[\s\S]*?NEW\.admission_epoch <> OLD\.admission_epoch \+ 1[\s\S]*?NEW\.admission_changed_at <> database_now[\s\S]*?NEW\.admission_cell_expires_at > database_now/,
    );
    assert.match(
      admissionInitialState,
      /NEW\.admission_state IS DISTINCT FROM 'open'[\s\S]*?NEW\.admission_epoch IS DISTINCT FROM 0[\s\S]*?NEW\.admission_fence_sha256 IS NOT NULL[\s\S]*?NEW\.admission_provision_operation_hash IS NOT NULL[\s\S]*?NEW\.admission_stack_id IS NOT NULL[\s\S]*?NEW\.admission_cell_expires_at IS NOT NULL[\s\S]*?new deployment environment admission must start open/,
    );
    assert.match(
      source,
      /CREATE TRIGGER deployment_environments_admission_initial_state\s+BEFORE INSERT ON deployment_environments/,
    );
    assert.match(
      source,
      /CREATE TRIGGER deployment_environments_admission_transition[\s\S]*?BEFORE UPDATE OF[\s\S]*?admission_state[\s\S]*?ON deployment_environments/,
    );
    assert.match(
      environmentTombstone,
      /TG_OP = 'DELETE'[\s\S]*?OLD\.admission_state = 'draining'[\s\S]*?RETURN OLD[\s\S]*?OLD\.admission_state = 'draining' AND NEW IS DISTINCT FROM OLD/,
    );
    assert.match(
      environmentTombstone,
      /NEW\.admission_state = 'draining' AND ROW\([\s\S]*?NEW\.id[\s\S]*?NEW\.expected_account_id[\s\S]*?NEW\.cell_key[\s\S]*?NEW\.status[\s\S]*?IS DISTINCT FROM ROW\([\s\S]*?OLD\.id[\s\S]*?deployment environment identity cannot change while entering drain/,
    );
    assert.match(
      source,
      /CREATE TRIGGER deployment_environments_draining_tombstone\s+BEFORE UPDATE OR DELETE ON deployment_environments/,
    );
    assert.match(
      ownershipTombstone,
      /WHERE environment\.id = OLD\.environment_id[\s\S]*?FOR UPDATE[\s\S]*?current_admission_state IS DISTINCT FROM 'open'[\s\S]*?RETURN OLD/,
    );
    for (const table of [
      "app_instance_deployments",
      "deployment_tenant_resources",
      "deployment_cleanup_schedules",
    ]) {
      assert.match(
        source,
        new RegExp(
          `CREATE TRIGGER ${table}_draining_tombstone\\s+BEFORE DELETE ON ${table}\\s+FOR EACH ROW\\s+EXECUTE FUNCTION enforce_draining_environment_ownership_tombstone\\(\\)`,
        ),
      );
    }
    assert.doesNotMatch(
      source,
      /CREATE TRIGGER deployment_environment_capacity_reservations_draining_tombstone/,
    );
    assert.match(
      capacityAdmission,
      /ROW\([\s\S]*?NEW\.deployment_id[\s\S]*?NEW\.environment_id[\s\S]*?NEW\.slot[\s\S]*?NEW\.reserved_at[\s\S]*?IS DISTINCT FROM ROW\([\s\S]*?OLD\.deployment_id[\s\S]*?capacity reservation is immutable/,
    );
    assert.match(
      capacityAdmission,
      /SELECT deployment\.environment_id[\s\S]*?deployment\.id = NEW\.deployment_id[\s\S]*?FOR UPDATE[\s\S]*?owning_deployment_environment_id IS DISTINCT FROM NEW\.environment_id[\s\S]*?current_admission_state IS DISTINCT FROM 'open'/,
    );
    assert.match(
      source,
      /CREATE TRIGGER deployment_environment_capacity_admission_fence[\s\S]*?BEFORE INSERT OR UPDATE\s+ON deployment_environment_capacity_reservations/,
    );
    assert.match(
      source,
      /CREATE TRIGGER app_instance_deployments_admission_insert_fence\s+AFTER INSERT ON app_instance_deployments/,
    );
    assert.doesNotMatch(
      source,
      /CREATE TRIGGER app_instance_deployments_admission_insert_fence\s+BEFORE INSERT/,
    );
    assert.match(
      deploymentAdmission,
      /enforce_app_instance_deployment_admission\(\)[\s\S]*?NEW\.app_instance_id IS DISTINCT FROM OLD\.app_instance_id[\s\S]*?NEW\.environment_id IS DISTINCT FROM OLD\.environment_id[\s\S]*?deployment application instance and environment are immutable[\s\S]*?OLD\.status IN \('rolled_back', 'canceled'\)[\s\S]*?NEW\.status NOT IN \('rolled_back', 'canceled'\)/,
    );
    assert.match(
      deploymentAdmission,
      /SELECT environment\.id, environment\.admission_state[\s\S]*?WHERE environment\.id = NEW\.environment_id[\s\S]*?FOR UPDATE[\s\S]*?admission_state IS DISTINCT FROM 'open'[\s\S]*?new or reopened deployment ownership is not admitted by the environment/,
    );
    assert.match(
      source,
      /CREATE TRIGGER app_instance_deployments_admission_reopen_fence\s+AFTER UPDATE OF app_instance_id, environment_id, status\s+ON app_instance_deployments/,
    );
    assert.match(
      tenantResourceAdmission,
      /enforce_deployment_tenant_resource_admission\(\)[\s\S]*?NEW\.app_instance_id IS DISTINCT FROM OLD\.app_instance_id[\s\S]*?NEW\.environment_id IS DISTINCT FROM OLD\.environment_id[\s\S]*?tenant resource application instance and environment are immutable[\s\S]*?OLD\.lifecycle_status = 'destroyed'[\s\S]*?NEW\.lifecycle_status <> 'destroyed'[\s\S]*?deployment_environment_capacity_reservations[\s\S]*?reservation\.deployment_id = NEW\.owner_deployment_id[\s\S]*?FOR UPDATE/,
    );
    assert.match(
      tenantResourceAdmission,
      /NEW\.environment_id IS NOT DISTINCT FROM OLD\.environment_id[\s\S]*?NEW\.owner_deployment_id IS NOT DISTINCT FROM OLD\.owner_deployment_id[\s\S]*?NEW\.generation IS NOT DISTINCT FROM OLD\.generation[\s\S]*?RETURN NEW/,
    );
    assert.match(
      tenantResourceAdmission,
      /reservation\.deployment_id = NEW\.owner_deployment_id[\s\S]*?reservation\.environment_id = NEW\.environment_id/,
    );
    assert.match(
      tenantResourceAdmission,
      /SELECT deployment\.environment_id, deployment\.app_instance_id[\s\S]*?deployment\.id = NEW\.owner_deployment_id[\s\S]*?FOR UPDATE[\s\S]*?owning_deployment_environment_id IS DISTINCT FROM NEW\.environment_id[\s\S]*?owning_deployment_app_instance_id IS DISTINCT FROM NEW\.app_instance_id[\s\S]*?tenant resource ownership does not match its deployment/,
    );
    assert.match(
      source,
      /CREATE TRIGGER deployment_tenant_resources_admission_insert_fence\s+AFTER INSERT ON deployment_tenant_resources/,
    );
    assert.match(
      source,
      /CREATE TRIGGER deployment_tenant_resources_admission_reopen_fence\s+AFTER UPDATE OF\s+app_instance_id,\s+environment_id,\s+owner_deployment_id,\s+generation,\s+lifecycle_status\s+ON deployment_tenant_resources/,
    );
    assert.doesNotMatch(
      source,
      /CREATE TRIGGER deployment_tenant_resources_admission_insert_fence\s+BEFORE INSERT/,
    );
    assert.match(
      cleanupScheduleAdmission,
      /enforce_deployment_cleanup_schedule_admission\(\)[\s\S]*?owning_deployment_status IN \('rolled_back', 'canceled'\)[\s\S]*?reservation\.deployment_id = NEW\.deployment_id[\s\S]*?reservation\.environment_id = NEW\.environment_id/,
    );
    assert.match(
      cleanupScheduleAdmission,
      /TG_OP = 'UPDATE'[\s\S]*?NEW\.environment_id IS DISTINCT FROM OLD\.environment_id[\s\S]*?NEW\.deployment_id IS DISTINCT FROM OLD\.deployment_id[\s\S]*?cleanup schedule deployment and environment are immutable[\s\S]*?RETURN NEW/,
    );
    assert.match(
      cleanupScheduleAdmission,
      /SELECT deployment\.environment_id, deployment\.status[\s\S]*?owning_deployment_environment_id IS DISTINCT FROM NEW\.environment_id[\s\S]*?SELECT environment\.admission_state[\s\S]*?current_admission_state = 'open'[\s\S]*?RETURN NEW/,
    );
    assert.match(
      source,
      /CREATE TRIGGER deployment_cleanup_schedules_admission_insert_fence\s+AFTER INSERT ON deployment_cleanup_schedules/,
    );
    assert.doesNotMatch(
      source,
      /CREATE TRIGGER deployment_cleanup_schedules_admission_insert_fence\s+BEFORE INSERT/,
    );
    assert.match(
      source,
      /CREATE TRIGGER deployment_cleanup_schedules_admission_move_fence\s+AFTER UPDATE OF environment_id, deployment_id ON deployment_cleanup_schedules/,
    );
    assert.match(
      cleanupScheduleTerminal,
      /enforce_deployment_cleanup_schedule_terminal_status\(\)[\s\S]*?OLD\.status IN \('succeeded', 'canceled'\)[\s\S]*?NEW\.status IS DISTINCT FROM OLD\.status[\s\S]*?terminal cleanup schedule status is immutable/,
    );
    assert.match(
      source,
      /CREATE TRIGGER deployment_cleanup_schedules_terminal_status_fence\s+BEFORE UPDATE OF status ON deployment_cleanup_schedules/,
    );
    assert.match(
      appInstanceActivation,
      /enforce_app_instance_activation_admission\(\)[\s\S]*?OLD\.status IN \('pending', 'active'\)[\s\S]*?NEW\.status NOT IN \('pending', 'active'\)[\s\S]*?deployment\.app_instance_id = NEW\.id[\s\S]*?ORDER BY environment\.id[\s\S]*?FOR UPDATE OF environment[\s\S]*?admission_state IS DISTINCT FROM 'open'/,
    );
    assert.match(
      source,
      /CREATE TRIGGER app_instances_activation_admission_fence\s+AFTER UPDATE OF status ON app_instances/,
    );
    assert.match(
      source,
      /deployment_environments_admission_provision_hash_check/,
    );
    assert.match(
      source,
      /LOCK TABLE\s+app_instance_deployments,\s+deployment_tenant_resources,\s+deployment_environment_capacity_reservations,\s+deployment_cleanup_schedules\s+IN SHARE ROW EXCLUSIVE MODE/,
    );
    assert.match(
      source,
      /DO \$admission_relationships\$[\s\S]*?reservation\.environment_id IS DISTINCT FROM deployment\.environment_id[\s\S]*?resource\.environment_id IS DISTINCT FROM deployment\.environment_id[\s\S]*?resource\.app_instance_id IS DISTINCT FROM deployment\.app_instance_id[\s\S]*?schedule\.environment_id IS DISTINCT FROM deployment\.environment_id/,
    );
  }
  for (const name of [
    "enforce_deployment_environment_admission_initial_state",
    "enforce_deployment_environment_admission_transition",
    "enforce_draining_deployment_environment_tombstone",
    "enforce_draining_environment_ownership_tombstone",
    "enforce_deployment_environment_admission_fence",
    "enforce_app_instance_deployment_admission",
    "enforce_deployment_tenant_resource_admission",
    "enforce_deployment_cleanup_schedule_admission",
    "enforce_deployment_cleanup_schedule_terminal_status",
    "enforce_app_instance_activation_admission",
  ]) {
    assert.equal(postgresFunction(migration, name), postgresFunction(schema, name));
  }
  for (const field of [
    "admissionState",
    "admissionEpoch",
    "admissionFenceSha256",
    "admissionProvisionOperationHash",
    "admissionStackId",
    "admissionCellExpiresAt",
    "admissionChangedAt",
  ]) {
    assert.match(drizzleSchema, new RegExp(field));
  }
  assert.match(
    drizzleSchema,
    /deployment_environments_admission_epoch_check[\s\S]*?admission_epoch >= 0/,
  );
  assert.match(
    drizzleSchema,
    /deployment_environments_admission_provision_hash_check/,
  );
  assert.match(
    repository,
    /reserveEnvironmentCapacity[\s\S]*?environment\.admission_state = 'open'[\s\S]*?FOR UPDATE OF environment/,
  );
  assert.match(
    repository,
    /INSERT INTO deployment_environment_capacity_reservations[\s\S]*?SELECT now_ms FROM db_clock/,
  );
  assert.match(
    ownershipSource,
    /database_cell_expired[\s\S]*?environment\.admission_state = 'draining'/,
  );
});

test("S3 execution repository reserves capacity atomically and commits ready state as one statement", async () => {
  const repository = await read("lib/deployments/execution/neon-repository.ts");
  assert.doesNotMatch(repository, /lease_expires_at\s*>\s*\$\d+/);
  assert.match(
    repository,
    /claimNext[\s\S]*?db_clock AS MATERIALIZED[\s\S]*?blocked\.job_type <> ALL\(\$1::text\[\]\)[\s\S]*?allowed_sibling\.job_type = ANY\(\$1::text\[\]\)[\s\S]*?candidate_job\.job_type = ANY\(\$1::text\[\]\)[\s\S]*?sibling\.status = 'running'[\s\S]*?FOR UPDATE OF candidate_job, candidate_deployment SKIP LOCKED/,
  );
  assert.match(
    repository,
    /heartbeat[\s\S]*?db_clock AS MATERIALIZED[\s\S]*?owned_job AS MATERIALIZED[\s\S]*?lease_token = \$5[\s\S]*?attempts = \$6[\s\S]*?lease_expires_at > db_clock\.now_ms[\s\S]*?FOR UPDATE OF job/,
  );
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
    /enqueueJob[\s\S]*?db_clock AS MATERIALIZED[\s\S]*?owned_job AS MATERIALIZED[\s\S]*?lease_expires_at > db_clock\.now_ms[\s\S]*?FOR UPDATE OF owner[\s\S]*?ON CONFLICT \(dedupe_key\) DO NOTHING[\s\S]*?existing_job AS MATERIALIZED[\s\S]*?status IN \('dead_letter', 'canceled'\)[\s\S]*?'existing_unusable'/,
  );
  assert.match(
    repository,
    /markInstanceUnavailable[\s\S]*?lease_expires_at > db_clock\.now_ms[\s\S]*?return integer\(rows\[0\]\?\.suspended_count \?\? 0\) === 1/,
  );
  assert.match(
    repository,
    /markCleanupStatus[\s\S]*?owned_job AS MATERIALIZED[\s\S]*?FOR UPDATE OF job[\s\S]*?RETURNING schedule\.id[\s\S]*?return rows\.length === 1/,
  );
  assert.match(
    repository,
    /markReady[\s\S]*?db_clock AS MATERIALIZED[\s\S]*?eligible AS MATERIALIZED[\s\S]*?lease_expires_at > db_clock\.now_ms[\s\S]*?FOR UPDATE OF deployment, instance, subscription, job[\s\S]*?activated_instance AS[\s\S]*?ready_deployment AS[\s\S]*?FROM eligible, activated_instance[\s\S]*?1 \/ CASE/,
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
    /recordTenantResourceLifecycle[\s\S]*?db_clock AS MATERIALIZED[\s\S]*?job\.status = 'running'[\s\S]*?job\.lease_owner = \$3[\s\S]*?job\.lease_token = \$24[\s\S]*?job\.attempts = \$25[\s\S]*?job\.lease_expires_at > db_clock\.now_ms[\s\S]*?FOR UPDATE OF deployment, job/,
  );
  assert.match(
    repository,
    /recordTenantResourceLifecycle[\s\S]*?assertTenantExternalOperationFenceInput\(input\.externalFence\)[\s\S]*?operation\.epoch = resource\.external_operation_epoch[\s\S]*?operation\.intent = 'provision'[\s\S]*?operation\.state = 'active'[\s\S]*?FOR UPDATE OF resource, operation[\s\S]*?resource\.owner_deployment_id = \$1[\s\S]*?resource\.generation = \$6[\s\S]*?resource\.ownership_marker = \$7[\s\S]*?resource\.external_operation_epoch = \$26/,
  );
  assert.match(
    repository,
    /claimTenantResourceGeneration[\s\S]*?candidate_created_at[\s\S]*?owner_created_at/,
  );
  assert.match(
    repository,
    /claimTenantResourceGeneration[\s\S]*?existing AS MATERIALIZED \([\s\S]*?lease_expires_at > db_clock\.now_ms[\s\S]*?CROSS JOIN db_clock[\s\S]*?FOR UPDATE OF resource, owner/,
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
    /sha256Hex\(`\$\{input\.lease\.deploymentId\}:\$\{input\.lease\.jobId\}:\$\{input\.stepKey\}/,
  );
  assert.match(repository, /TENANT_RESOURCE_IDENTITY_MISMATCH/);
  assert.match(
    repository,
    /TENANT_RESOURCE_HANDOFF_REQUIRES_OWNERSHIP_EPOCH/,
  );
  assert.match(repository, /must not contain URLs or URIs/);
  assert.match(
    repository,
    /completeTenantResourceCleanupPhase[\s\S]*?cleanupPhaseReceiptEvidence\([\s\S]*?JSON\.stringify\(persistedReceipt\)/,
  );
  assert.match(
    repository,
    /hydrateCleanupPhaseReceipt\(phase, receipt, externalFence\)/,
  );
  assert.doesNotMatch(
    repository,
    /completeTenantResourceCleanupPhase[\s\S]*?JSON\.stringify\(input\.receipt\)/,
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
