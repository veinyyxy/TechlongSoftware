import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrationChecksum } from "../../../scripts/migration-checksum.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const read = (relative) => readFile(path.join(repositoryRoot, relative), "utf8");

const [
  readiness,
  applyContract,
  inspectRunner,
  applyRunner,
  wrapper,
  rootPackage,
  opsPackage,
  runtime,
  janitor,
] = await Promise.all([
  read("lib/deployments/execution/neon-shared-cell-migration-readiness.ts"),
  read("lib/deployments/execution/neon-shared-cell-migration-apply.ts"),
  read("scripts/run-shared-cell-postgres-cutover.ts"),
  read("scripts/apply-reviewed-shared-cell-postgres-cutover.ts"),
  read("ops/aws-sandbox/scripts/s3-b5-shared-cell-postgres-migration-apply.ps1"),
  read("package.json"),
  read("ops/aws-sandbox/package.json"),
  read("lib/deployments/execution/runtime-composition.ts"),
  read("ops/aws-sandbox/lambda/cell-janitor.cjs"),
]);

const expectedMigrations = [
  [
    "0001_local_auth.sql",
    "c9bc42440c3fb8e71fd6ff8a46d82f19766dd3214c365ae26b34ea0bd56c6d1a",
  ],
  [
    "0002_app_instance_deployment_planning.sql",
    "f7add4988ce35cb04bf5edc6855e7bf615899e6ddd4ea122a2eed025128d69ad",
  ],
  [
    "0003_deployment_execution_foundation.sql",
    "ba1ba68ec2d4a3c85124b1ccdfd3f19188bca84b9f4a9013e70c7727231dd6bd",
  ],
  [
    "0004_aws_sandbox_worker.sql",
    "523e35a9b326367747aba794b6acf3f8790108fef32f3b0a41e77503b6eb242d",
  ],
  [
    "0005_tenant_resource_lifecycle.sql",
    "bd36678d6e6f0030c0254475b6a21be89a1adebea8883b99f2ce2014e9f60e05",
  ],
  [
    "0006_deployment_lease_fencing.sql",
    "b6b48b8d0c298d354909a335cc91205632a6fa28097c0e901e734fb8ebcd0574",
  ],
  [
    "0007_external_ownership_epoch_cleanup_phases.sql",
    "402b083c10f2740c6c3ac8089b0b4d0bf47e26acad4ac0cbc70ec86fa11e1540",
  ],
  [
    "0008_shared_cell_admission_fence.sql",
    "0b8c161c4ba7e9f9cd9154ba9f008ec534b4b8b97023de9b8f8a63f8d2756c90",
  ],
];

for (const [filename, checksum] of expectedMigrations) {
  assert.equal(
    migrationChecksum(await read(`db/postgres-migrations/${filename}`)),
    checksum,
    `${filename} checksum drifted from the J5g-e2 reviewed catalog`,
  );
}

for (const value of [
  "staleNonrunningLeaseCount",
  "leaseExhaustedCleanupRewriteCount",
  "environmentCount",
]) {
  assert.ok(readiness.includes(value), `readiness contract is missing ${value}`);
  assert.ok(inspectRunner.includes(value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)) || inspectRunner.includes(value));
}
assert.ok(inspectRunner.includes("external_operation_epoch"));
assert.doesNotMatch(
  inspectRunner,
  /client\.query\(\s*[`"']\s*(?:ALTER|COMMIT|CREATE|DELETE|DROP|GRANT|INSERT|REVOKE|TRUNCATE|UPDATE)\b/i,
  "J5g-e1 must remain strictly read-only",
);

for (const value of [
  "authorizeSharedCellPostgresMigrationApply",
  "compileSharedCellPostgresMigrationReceipt",
  'intent: "apply_reviewed_shared_cell_postgres_cutover"',
  'intent: "prove_shared_cell_postgres_cutover"',
  "NEON_SHARED_CELL_MIGRATION_APPLY_REVIEW_EXPIRED",
  "NEON_SHARED_CELL_MIGRATION_APPLY_ACTIVITY_DRIFT",
  "NEON_SHARED_CELL_MIGRATION_APPLY_PRE_SCHEMA_DRIFT",
  "NEON_SHARED_CELL_MIGRATION_APPLY_POST_SCHEMA_INVALID",
  "criticalTriggerEnabledCount",
  "criticalIndexCount",
  "legacyStepRunAttemptIndexPresent",
  "cutoverStepRunAttemptIndexPresent",
  "criticalConstraintValidatedCount",
  "cutoverDataRowCount",
  "sandboxAdmissionDefaultCount",
  "receiptSha256",
]) {
  assert.ok(applyContract.includes(value), `apply contract is missing ${value}`);
}
assert.doesNotMatch(applyContract, /DATABASE_URL|postgres(?:ql)?:\/\//i);

for (const value of [
  "I_CONFIRM_J5GE2_APPLY_NEON_MIGRATIONS_0005_TO_0008",
  "TECHLONG_J5GE2_POSTGRES_GUARD_NONCE",
  "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE NOT DEFERRABLE",
  "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE",
  "SET LOCAL search_path = public, pg_catalog",
  "SELECT pg_try_advisory_xact_lock($1, $2) AS acquired",
  "LOCK TABLE public.schema_migrations IN ACCESS EXCLUSIVE MODE",
  "IN SHARE ROW EXCLUSIVE MODE",
  "INSERT INTO public.schema_migrations",
  'await client.query("COMMIT")',
  'await client.query("ROLLBACK")',
  "SHARED_CELL_POSTGRES_CUTOVER_MIGRATIONS",
  "SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG",
  "external_operation_epoch",
  "critical_trigger_enabled_count",
  "trigger.tgenabled IN ('O', 'A')",
  "critical_index_count",
  "legacy_step_run_attempt_index_present",
  "cutover_step_run_attempt_index_present",
  "pg_catalog.pg_get_indexdef",
  "critical_constraint_validated_count",
  "criticalTriggerFunctions",
  "criticalConstraintRelations",
  "environment_admission_default_count",
  "NEON_SHARED_CELL_MIGRATION_COMMIT_OUTCOME_UNKNOWN",
  '"already_applied"',
  '"reconciled"',
  'open(resolved, "wx", 0o600)',
  "operationMutation = receipt.mutationPerformed",
  "NEON_SHARED_CELL_MIGRATION_EVIDENCE_WRITE_FAILED",
  "await handle.truncate(0)",
  'await handle.write(`${JSON.stringify(marker)}\\n`, 0, "utf8")',
]) {
  assert.ok(applyRunner.includes(value), `apply runner is missing ${value}`);
}
assert.doesNotMatch(
  applyRunner,
  /apply-postgres-migrations|@aws-sdk|DeleteStack|PutItem|CreateChangeSet|ExecuteChangeSet|RunTask|node:child_process/i,
);
assert.doesNotMatch(applyRunner, /console\.(?:log|error)/);

assert.match(
  wrapper,
  /\[ValidateSet\('LocalValidate', 'ApplyReviewedMigrations', 'RecoverAppliedState'\)\]/,
);
for (const value of [
  "AcknowledgeNeonDatabaseWrite",
  "AcknowledgeAtomicDdlNoAutomaticDownMigration",
  "I_CONFIRM_J5GE2_APPLY_NEON_MIGRATIONS_0005_TO_0008",
  "Refusing an online migration operation while a database URL environment override is set.",
  "because .env.local is tracked by Git",
  "must be outside the repository",
  "already exists; refusing to overwrite it",
  "LOCAL_ONLY_SHARED_CELL_POSTGRES_MIGRATION_APPLY_DEFAULT_OFF",
]) {
  assert.ok(wrapper.includes(value), `apply wrapper is missing ${value}`);
}

const parsedRootPackage = JSON.parse(rootPackage);
const parsedOpsPackage = JSON.parse(opsPackage);
assert.match(
  parsedRootPackage.scripts.test,
  /tests\/neon-shared-cell-migration-apply\.test\.ts/,
);
assert.equal(
  parsedOpsPackage.scripts["test:b5-shared-cell-postgres-migration-apply"],
  "node ./scripts/validate-b5-shared-cell-postgres-migration-apply.mjs",
);
assert.match(
  parsedOpsPackage.scripts.test,
  /test:b5-shared-cell-postgres-migration-apply/,
);

for (const value of [
  'mode: "offline_only" as const',
  "applyRuntimeReady: false as const",
  "cleanupRuntimeReady: false as const",
]) {
  assert.ok(runtime.includes(value), `default runtime is missing ${value}`);
}
assert.doesNotMatch(runtime, /postgres-migration-apply|postgres-cutover/);
assert.match(janitor, /const PLAN_ONLY_MODE = "PLAN_ONLY"/);
assert.match(janitor, /const DELETE_INTENT_ACTION = "delete_shared_cell_stack"/);
assert.doesNotMatch(janitor, /DeleteStackCommand|PutCommand|UpdateCommand/);

const tests = spawnSync(
  process.execPath,
  [
    "--experimental-loader",
    "./tests/cloudflare-loader.mjs",
    "--test",
    "tests/neon-shared-cell-migration-readiness.test.ts",
    "tests/neon-shared-cell-migration-apply.test.ts",
  ],
  { cwd: repositoryRoot, encoding: "utf8" },
);
assert.equal(
  tests.status,
  0,
  `J5g-e2 migration tests failed.\n${tests.stdout}\n${tests.stderr}`,
);

console.log(
  "B5-J5g-e2 reviewed Neon migration apply validated locally (fresh manifest binding, one atomic 0005-0008 transaction, exact post-readback and commit reconciliation).",
);
