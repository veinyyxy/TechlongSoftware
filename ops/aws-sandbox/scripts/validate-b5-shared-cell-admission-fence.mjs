import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const read = (relative) => readFile(path.join(repositoryRoot, relative), "utf8");

const [
  migration,
  schema,
  repository,
  contract,
  writer,
  zeroTenantAdapter,
  zeroTenantSource,
  deletionCore,
  runtime,
  janitor,
  wrapper,
] = await Promise.all([
  read("db/postgres-migrations/0008_shared_cell_admission_fence.sql"),
  read("db/postgres-schema.sql"),
  read("lib/deployments/execution/neon-repository.ts"),
  read("lib/deployments/execution/shared-cell-admission-fence.ts"),
  read("lib/deployments/execution/neon-shared-cell-admission-fence.ts"),
  read("lib/deployments/execution/shared-cell-zero-tenant-evidence.ts"),
  read("lib/deployments/execution/neon-shared-cell-zero-tenant-source.ts"),
  read("lib/deployments/execution/shared-cell-cleanup-deletion.ts"),
  read("lib/deployments/execution/runtime-composition.ts"),
  read("ops/aws-sandbox/lambda/cell-janitor.cjs"),
  read("ops/aws-sandbox/scripts/s3-b5-shared-cell-admission-fence.ps1"),
]);

function includesAll(source, values, label) {
  for (const value of values) {
    assert.ok(source.includes(value), `${label} is missing ${value}`);
  }
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

for (const source of [migration, schema]) {
  includesAll(
    source,
    [
      "admission_state",
      "admission_epoch",
      "admission_fence_sha256",
      "admission_provision_operation_hash",
      "admission_stack_id",
      "admission_cell_expires_at",
      "admission_changed_at",
      "enforce_deployment_environment_admission_initial_state",
      "deployment_environments_admission_initial_state",
      "new deployment environment admission must start open",
      "enforce_deployment_environment_admission_transition",
      "deployment_environments_admission_transition",
      "enforce_draining_deployment_environment_tombstone",
      "deployment_environments_draining_tombstone",
      "enforce_draining_environment_ownership_tombstone",
      "app_instance_deployments_draining_tombstone",
      "deployment_tenant_resources_draining_tombstone",
      "deployment_cleanup_schedules_draining_tombstone",
      "enforce_deployment_environment_admission_fence",
      "deployment_environment_capacity_admission_fence",
      "enforce_app_instance_deployment_admission",
      "app_instance_deployments_admission_insert_fence",
      "AFTER INSERT ON app_instance_deployments",
      "AFTER UPDATE OF app_instance_id, environment_id, status",
      "deployment application instance and environment are immutable",
      "enforce_deployment_tenant_resource_admission",
      "deployment_tenant_resources_admission_insert_fence",
      "deployment_tenant_resources_admission_reopen_fence",
      "tenant resource application instance and environment are immutable",
      "tenant resource ownership does not match its deployment",
      "reservation.deployment_id = NEW.owner_deployment_id",
      "enforce_deployment_cleanup_schedule_admission",
      "deployment_cleanup_schedules_admission_insert_fence",
      "deployment_cleanup_schedules_admission_move_fence",
      "reservation.deployment_id = NEW.deployment_id",
      "enforce_deployment_cleanup_schedule_terminal_status",
      "terminal cleanup schedule status is immutable",
      "enforce_app_instance_activation_admission",
      "app_instances_activation_admission_fence",
      "deployment.app_instance_id = NEW.id",
      "admission_epoch >= 0",
      "OLD.admission_state = 'draining'",
      "NEW.admission_epoch <> OLD.admission_epoch + 1",
      "NEW.admission_changed_at <> database_now",
      "NEW.admission_cell_expires_at > database_now",
      "transaction_timestamp()",
      "BEFORE INSERT OR UPDATE",
      "FOR UPDATE",
      "current_admission_state IS DISTINCT FROM 'open'",
      "capacity reservation environment does not match its deployment",
      "existing tenant resource ownership does not match its deployment",
      "cleanup schedule environment does not match its deployment",
      "$admission_relationships$",
    ],
    "durable admission schema",
  );
  assert.doesNotMatch(
    source,
    /CREATE TRIGGER app_instance_deployments_admission_insert_fence\s+BEFORE INSERT/,
  );
  assert.doesNotMatch(
    source,
    /CREATE TRIGGER (?:deployment_tenant_resources|deployment_cleanup_schedules)_admission_insert_fence\s+BEFORE INSERT/,
  );
  assert.match(
    source,
    /CREATE TRIGGER app_instance_deployments_admission_reopen_fence\s+AFTER UPDATE OF app_instance_id, environment_id, status\s+ON app_instance_deployments/,
  );

  const admissionInitialState = postgresFunction(
    source,
    "enforce_deployment_environment_admission_initial_state",
  );
  assert.match(
    admissionInitialState,
    /NEW\.admission_state IS DISTINCT FROM 'open'[\s\S]*?NEW\.admission_epoch IS DISTINCT FROM 0[\s\S]*?NEW\.admission_fence_sha256 IS NOT NULL[\s\S]*?NEW\.admission_provision_operation_hash IS NOT NULL[\s\S]*?NEW\.admission_stack_id IS NOT NULL[\s\S]*?NEW\.admission_cell_expires_at IS NOT NULL/,
  );
  assert.match(
    source,
    /deployment_environments_admission_initial_state\s+BEFORE INSERT ON deployment_environments/,
  );

  const environmentTombstone = postgresFunction(
    source,
    "enforce_draining_deployment_environment_tombstone",
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
    /deployment_environments_draining_tombstone\s+BEFORE UPDATE OR DELETE ON deployment_environments/,
  );
  const ownershipTombstone = postgresFunction(
    source,
    "enforce_draining_environment_ownership_tombstone",
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
    source,
    /LOCK TABLE\s+app_instance_deployments,\s+deployment_tenant_resources,\s+deployment_environment_capacity_reservations,\s+deployment_cleanup_schedules\s+IN SHARE ROW EXCLUSIVE MODE;[\s\S]*?DO \$admission_relationships\$/,
  );
  assert.match(
    source,
    /DO \$admission_relationships\$[\s\S]*?deployment_tenant_resources AS resource[\s\S]*?deployment\.id = resource\.owner_deployment_id[\s\S]*?resource\.environment_id IS DISTINCT FROM deployment\.environment_id[\s\S]*?resource\.app_instance_id IS DISTINCT FROM deployment\.app_instance_id[\s\S]*?existing tenant resource ownership does not match its deployment/,
  );

  const capacityAdmission = postgresFunction(
    source,
    "enforce_deployment_environment_admission_fence",
  );
  assert.match(
    capacityAdmission,
    /NEW\.deployment_id[\s\S]*?NEW\.environment_id[\s\S]*?NEW\.slot[\s\S]*?NEW\.reserved_at[\s\S]*?IS DISTINCT FROM ROW\([\s\S]*?OLD\.deployment_id[\s\S]*?capacity reservation is immutable/,
  );
  assert.match(
    capacityAdmission,
    /SELECT deployment\.environment_id[\s\S]*?owning_deployment_environment_id IS DISTINCT FROM NEW\.environment_id[\s\S]*?current_admission_state IS DISTINCT FROM 'open'/,
  );

  const deploymentAdmission = postgresFunction(
    source,
    "enforce_app_instance_deployment_admission",
  );
  assert.match(
    deploymentAdmission,
    /NEW\.app_instance_id IS DISTINCT FROM OLD\.app_instance_id[\s\S]*?OR NEW\.environment_id IS DISTINCT FROM OLD\.environment_id[\s\S]*?deployment application instance and environment are immutable[\s\S]*?OLD\.status IN \('rolled_back', 'canceled'\)[\s\S]*?NEW\.status NOT IN \('rolled_back', 'canceled'\)/,
  );
  assert.match(
    deploymentAdmission,
    /WHERE environment\.id = NEW\.environment_id[\s\S]*?FOR UPDATE[\s\S]*?admission_state IS DISTINCT FROM 'open'/,
  );

  const tenantResourceAdmission = postgresFunction(
    source,
    "enforce_deployment_tenant_resource_admission",
  );
  assert.match(
    tenantResourceAdmission,
    /NEW\.app_instance_id IS DISTINCT FROM OLD\.app_instance_id[\s\S]*?NEW\.environment_id IS DISTINCT FROM OLD\.environment_id[\s\S]*?tenant resource application instance and environment are immutable[\s\S]*?OLD\.lifecycle_status = 'destroyed'[\s\S]*?NEW\.lifecycle_status <> 'destroyed'[\s\S]*?SELECT deployment\.environment_id, deployment\.app_instance_id[\s\S]*?deployment\.id = NEW\.owner_deployment_id[\s\S]*?owning_deployment_environment_id IS DISTINCT FROM NEW\.environment_id[\s\S]*?owning_deployment_app_instance_id IS DISTINCT FROM NEW\.app_instance_id[\s\S]*?reservation\.deployment_id = NEW\.owner_deployment_id[\s\S]*?reservation\.environment_id = NEW\.environment_id/,
  );
  assert.match(
    source,
    /CREATE TRIGGER deployment_tenant_resources_admission_reopen_fence\s+AFTER UPDATE OF\s+app_instance_id,\s+environment_id,\s+owner_deployment_id,\s+generation,\s+lifecycle_status\s+ON deployment_tenant_resources/,
  );

  const cleanupScheduleAdmission = postgresFunction(
    source,
    "enforce_deployment_cleanup_schedule_admission",
  );
  assert.match(
    cleanupScheduleAdmission,
    /TG_OP = 'UPDATE'[\s\S]*?NEW\.environment_id IS DISTINCT FROM OLD\.environment_id[\s\S]*?NEW\.deployment_id IS DISTINCT FROM OLD\.deployment_id[\s\S]*?cleanup schedule deployment and environment are immutable[\s\S]*?RETURN NEW/,
  );
  assert.match(
    cleanupScheduleAdmission,
    /SELECT deployment\.environment_id, deployment\.status[\s\S]*?owning_deployment_environment_id IS DISTINCT FROM NEW\.environment_id[\s\S]*?SELECT environment\.admission_state[\s\S]*?owning_deployment_status IN \('rolled_back', 'canceled'\)[\s\S]*?reservation\.deployment_id = NEW\.deployment_id[\s\S]*?reservation\.environment_id = NEW\.environment_id/,
  );

  const cleanupScheduleTerminal = postgresFunction(
    source,
    "enforce_deployment_cleanup_schedule_terminal_status",
  );
  assert.match(
    cleanupScheduleTerminal,
    /OLD\.status IN \('succeeded', 'canceled'\)[\s\S]*?NEW\.status IS DISTINCT FROM OLD\.status/,
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
  assert.equal(
    postgresFunction(migration, name),
    postgresFunction(schema, name),
    `${name} differs between migration and canonical schema`,
  );
}

includesAll(
  repository,
  [
    "reserveEnvironmentCapacity",
    "environment.admission_state = 'open'",
    "FOR UPDATE OF environment",
    "(SELECT now_ms FROM db_clock)",
  ],
  "capacity reservation fence",
);

includesAll(
  contract,
  [
    'action: "drain_shared_cell_admissions"',
    "compileSharedCellAdmissionDrainIntent",
    "assertSharedCellAdmissionDrainReceipt",
    "admissionFenceSha256",
    "databaseCellExpired",
  ],
  "admission-fence contract",
);

includesAll(
  writer,
  [
    "NeonSharedCellAdmissionFenceWriter",
    "transaction_timestamp()",
    "locked_environment AS MATERIALIZED",
    "FOR UPDATE OF environment",
    "$6::bigint <= db_clock.now_ms",
    "environment.admission_state = 'open'",
    "environment.admission_state = 'draining'",
    "createNeonSharedCellAdmissionFenceWriter",
  ],
  "Neon admission writer",
);
assert.doesNotMatch(writer, /\b(?:INSERT|DELETE|TRUNCATE|DROP)\b/i);

includesAll(
  zeroTenantAdapter,
  [
    "compileSharedCellAdmissionDrainIntent",
    "compiled.fenceSha256",
    "snapshot.admissionState !== \"draining\"",
    "snapshot.databaseCellExpired !== true",
  ],
  "fenced zero-tenant adapter",
);
assert.doesNotMatch(
  zeroTenantAdapter,
  /beginAdmissionDrain|SharedCellAdmissionFenceWriter|NeonSharedCellAdmissionFenceWriter/,
  "Inspect/evidence reads must not mutate admission state implicitly.",
);
includesAll(
  zeroTenantSource,
  [
    "environment.admission_state = 'draining'",
    "database_cell_expired",
    'schemaVersion: 2 as const',
    'isolationLevel: "Serializable"',
    "readOnly: true",
    "deferrable: true",
  ],
  "fenced ownership snapshot",
);
assert.doesNotMatch(
  zeroTenantSource,
  /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i,
);

includesAll(
  deletionCore,
  [
    "sharedCellAdmissionDrainIntent",
    "evidenceAtDelegate",
    "Live Shared Cell evidence changed after the final zero-tenant snapshot.",
    "authorityAtDelegate",
    "delegateNow - zeroTenantAfter.observedAt",
  ],
  "caller-adjacent deletion boundary",
);

includesAll(
  runtime,
  [
    'mode: "offline_only" as const',
    "applyRuntimeReady: false as const",
    "cleanupRuntimeReady: false as const",
  ],
  "default runtime",
);
assert.doesNotMatch(
  runtime,
  /neon-shared-cell-admission-fence|neon-shared-cell-zero-tenant/,
);
includesAll(
  janitor,
  [
    'const PLAN_ACTION = "inspect_cell_cleanup_plan"',
    'const DELETE_INTENT_ACTION = "delete_shared_cell_stack"',
    'const PLAN_ONLY_MODE = "PLAN_ONLY"',
  ],
  "reviewed Janitor target",
);
assert.match(
  janitor,
  /exactKeys\(event, \["action", "cellId", "schemaVersion", "stackName"\]\)/,
);
assert.doesNotMatch(janitor, /DeleteStackCommand|PutCommand|UpdateCommand/);

assert.match(wrapper, /\[ValidateSet\('LocalValidate'\)\]/);
assert.doesNotMatch(
  wrapper,
  /CreateChangeSet|ExecuteChangeSet|DeleteStack|PutItem|RunTask/i,
);

const tests = spawnSync(
  process.execPath,
  [
    "--experimental-loader",
    "./tests/cloudflare-loader.mjs",
    "--test",
    "tests/postgres-schema.test.mjs",
    "tests/neon-shared-cell-admission-fence.test.ts",
    "tests/neon-shared-cell-zero-tenant-source.test.ts",
    "tests/shared-cell-cleanup-evidence-adapters.test.ts",
    "tests/shared-cell-cleanup-deletion-zero-tenant.test.ts",
    "tests/shared-cell-cleanup-deletion.test.ts",
  ],
  { cwd: repositoryRoot, encoding: "utf8" },
);
assert.equal(
  tests.status,
  0,
  `J5g-d admission-fence tests failed.\n${tests.stdout}\n${tests.stderr}`,
);

console.log(
  "B5-J5g-d durable Shared Cell admission fence validated locally (DB clock, ownership triggers, fenced snapshots, default off, no provider call).",
);
