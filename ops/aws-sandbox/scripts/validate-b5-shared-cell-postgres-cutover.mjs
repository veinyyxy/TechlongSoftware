import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrationChecksum } from "../../../scripts/migration-checksum.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const read = (relative) => readFile(path.join(repositoryRoot, relative), "utf8");

const [contract, runner, wrapper, rootPackage, opsPackage, runtime, janitor] =
  await Promise.all([
    read("lib/deployments/execution/neon-shared-cell-migration-readiness.ts"),
    read("scripts/run-shared-cell-postgres-cutover.ts"),
    read("ops/aws-sandbox/scripts/s3-b5-shared-cell-postgres-cutover.ps1"),
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

for (const [filename, expectedChecksum] of expectedMigrations) {
  const sql = await read(`db/postgres-migrations/${filename}`);
  assert.equal(
    migrationChecksum(sql),
    expectedChecksum,
    `${filename} checksum drifted from the J5g-e1 reviewed catalog`,
  );
}

for (const value of [
  "SHARED_CELL_POSTGRES_CUTOVER_MIGRATIONS",
  "SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG",
  '"0005_tenant_resource_lifecycle.sql"',
  '"0006_deployment_lease_fencing.sql"',
  '"0007_external_ownership_epoch_cleanup_phases.sql"',
  '"0008_shared_cell_admission_fence.sql"',
  "SHARED_CELL_POSTGRES_CUTOVER_MAX_REVIEW_AGE_MS = 15 * 60_000",
  "SHARED_CELL_POSTGRES_CUTOVER_MAX_CLOCK_RTT_MS = 10_000",
  "SHARED_CELL_POSTGRES_CUTOVER_MAX_CLOCK_SKEW_MS = 5_000",
  'intent: "review_shared_cell_postgres_cutover"',
  "mutationPerformed: false",
  "NEON_SHARED_CELL_APPLIED_MIGRATION_DRIFT",
  "NEON_SHARED_CELL_PARTIAL_CUTOVER_SCHEMA",
  "NEON_SHARED_CELL_CUTOVER_ACTIVITY_PRESENT",
  "NEON_SHARED_CELL_CUTOVER_COORDINATE_MISMATCH",
  "NEON_SHARED_CELL_CLOCK_SKEW_EXCEEDED",
  "manifestSha256",
]) {
  assert.ok(contract.includes(value), `cutover contract is missing ${value}`);
}
assert.doesNotMatch(contract, /DATABASE_URL|postgres(?:ql)?:\/\//i);

for (const value of [
  "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE",
  "current_setting('transaction_read_only') = 'on'",
  "current_setting('transaction_isolation') = 'serializable'",
  "current_setting('transaction_deferrable') = 'on'",
  "SET LOCAL statement_timeout = '10000ms'",
  "SET LOCAL lock_timeout = '1000ms'",
  "SET LOCAL idle_in_transaction_session_timeout = '15000ms'",
  "SET LOCAL search_path = public, pg_catalog",
  'client.query("ROLLBACK")',
  "SELECT filename, checksum FROM schema_migrations ORDER BY filename",
  "current_setting('server_version_num')",
  "clock_timestamp() AT TIME ZONE 'UTC'",
  ".endsWith(\".neon.tech\")",
  'parsed.searchParams.get("sslmode") !== "require"',
  "stale_nonrunning_lease_count",
  "lease_exhausted_cleanup_rewrite_count",
  "external_operation_epoch",
  'flag: "wx"',
  "mode: 0o600",
  "mutationPerformed: false",
]) {
  assert.ok(runner.includes(value), `online inspector is missing ${value}`);
}
assert.doesNotMatch(
  runner,
  /client\.query\(\s*[`"']\s*(?:ALTER|COMMIT|CREATE|DELETE|DROP|GRANT|INSERT|REVOKE|TRUNCATE|UPDATE)\b/i,
  "J5g-e1 may not contain a database mutation query",
);
assert.doesNotMatch(
  runner,
  /apply-postgres-migrations|DeleteStack|PutItem|CreateChangeSet|ExecuteChangeSet|RunTask|@aws-sdk|node:child_process/i,
);

assert.match(wrapper, /\[ValidateSet\('LocalValidate', 'OnlineInspect'\)\]/);
for (const value of [
  "I_ACKNOWLEDGE_NEON_READ_ONLY_INSPECTION",
  "AcknowledgeReadOnlyNeonAccess",
  "Refusing OnlineInspect while a database URL environment override is set.",
  "The online review manifest must be written outside the repository.",
  "Refusing OnlineInspect because .env.local is tracked by Git.",
  "ONLINE_INSPECT_COMPLETE_MUTATION_PERFORMED_FALSE",
]) {
  assert.ok(wrapper.includes(value), `cutover wrapper is missing ${value}`);
}
assert.doesNotMatch(
  wrapper,
  /ApplyReviewed|AcknowledgeAwsWrite|DeleteStack|PutItem|CreateChangeSet|ExecuteChangeSet|RunTask/i,
);

const parsedRootPackage = JSON.parse(rootPackage);
const parsedOpsPackage = JSON.parse(opsPackage);
assert.match(
  parsedRootPackage.scripts.test,
  /tests\/neon-shared-cell-migration-readiness\.test\.ts/,
);
assert.match(
  parsedOpsPackage.scripts.test,
  /test:b5-shared-cell-postgres-cutover/,
);
assert.equal(
  parsedOpsPackage.scripts["test:b5-shared-cell-postgres-cutover"],
  "node ./scripts/validate-b5-shared-cell-postgres-cutover.mjs",
);

for (const value of [
  'mode: "offline_only" as const',
  "applyRuntimeReady: false as const",
  "cleanupRuntimeReady: false as const",
]) {
  assert.ok(runtime.includes(value), `default runtime is missing ${value}`);
}
assert.doesNotMatch(runtime, /shared-cell-postgres-cutover|migration-readiness/);
assert.match(janitor, /const PLAN_ONLY_MODE = "PLAN_ONLY"/);
assert.doesNotMatch(janitor, /DeleteStackCommand|PutCommand|UpdateCommand/);

const tests = spawnSync(
  process.execPath,
  [
    "--experimental-loader",
    "./tests/cloudflare-loader.mjs",
    "--test",
    "tests/neon-shared-cell-migration-readiness.test.ts",
  ],
  { cwd: repositoryRoot, encoding: "utf8" },
);
assert.equal(
  tests.status,
  0,
  `J5g-e1 cutover readiness tests failed.\n${tests.stdout}\n${tests.stderr}`,
);

console.log(
  "B5-J5g-e1 Shared Cell PostgreSQL cutover OnlineInspect validated locally (exact 0005-0008 suffix, read-only transaction, clock bound, no mutation mode).",
);
