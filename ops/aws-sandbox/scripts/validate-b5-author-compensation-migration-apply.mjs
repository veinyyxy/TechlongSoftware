import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = new URL("../../../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");
const [contract, runner, wrapper, runtime] = await Promise.all([
  read("lib/deployments/execution/neon-shared-cell-author-compensation-migration-apply.ts"),
  read("scripts/apply-reviewed-author-compensation-migrations.ts"),
  read("ops/aws-sandbox/scripts/s3-b5-author-compensation-migration-apply.ps1"),
  read("lib/deployments/execution/runtime-composition.ts"),
]);
assert.ok(contract.includes("COMPENSATION_MIGRATION_APPLY_DEFAULT_ENABLED = false"));
for (const value of ["runtimeEnabled: false", "cloudApplyEnabled: false", "REVIEW_EXPIRED", "COMPENSATION_SCHEMA_DRIFT"]) assert.ok(contract.includes(value));
for (const value of ["LOCK TABLE public.schema_migrations IN ACCESS EXCLUSIVE MODE", "LOCK TABLE public.schema_migrations IN ACCESS SHARE MODE",
  "default_transaction_read_only=on", 'open(outputPath, "wx"', "WRITE_REVIEW_DELEGATION_PENDING", "COMMIT_OUTCOME_UNKNOWN_RECOVERY_REQUIRED",
  "ROLLBACK_UNKNOWN_RECOVERY_REQUIRED", "IN_MEMORY_SQL_DRIFT"]) assert.ok(runner.includes(value));
assert.doesNotMatch(runner, /@aws-sdk|apply-postgres-migrations|node:child_process|DELETE FROM|DROP TABLE|TRUNCATE TABLE/);
assert.ok(wrapper.includes("[ValidateSet('LocalValidate', 'ApplyReviewedMigrations', 'RecoverState')]"));
assert.doesNotMatch(runtime, /neon-shared-cell-author-compensation-migration-(apply|review)/);
const result = spawnSync(process.execPath, ["--experimental-loader", "./tests/cloudflare-loader.mjs", "--test", "tests/neon-shared-cell-author-compensation-migration-apply.test.ts"], { cwd: fileURLToPath(root), encoding: "utf8" });
assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
console.log("J5g-j7 migration apply/recovery validated (exact atomic suffix, lock-before-snapshot, sealed schema, independent verification, no replay or runtime wiring).");
