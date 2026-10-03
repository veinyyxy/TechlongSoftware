import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (name) => readFile(path.join(root, name), "utf8");
const [contract, runner, wrapper, runtime] = await Promise.all([
  read("lib/deployments/execution/neon-shared-cell-author-compensation-migration-review.ts"),
  read("scripts/review-shared-cell-author-compensation-migrations.ts"),
  read("ops/aws-sandbox/scripts/s3-b5-author-compensation-migration-review.ps1"),
  read("lib/deployments/execution/runtime-composition.ts"),
]);
for (const value of ["MIGRATION_REVIEW_DEFAULT_ENABLED = false", "READY_FOR_SEPARATE_WRITE_REVIEW", "applyEnabled: false", "mutationPerformed: false"]) assert.ok(contract.includes(value));
for (const value of ["beginSealedSharedCellPostgresReadOnly", "readSealedSharedCellPostgresSnapshot", "ROLLBACK", 'open(outputPath, "wx"', "default_transaction_read_only=on"]) assert.ok(runner.includes(value));
assert.doesNotMatch(runner, /client\.query\(\s*[`"']\s*(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|COMMIT|GRANT)\b/i);
assert.ok(wrapper.includes("[ValidateSet('LocalValidate', 'OnlineInspect')]"));
assert.doesNotMatch(runtime, /neon-shared-cell-author-compensation-migration-review/);
const test = spawnSync(process.execPath, ["--experimental-loader", "./tests/cloudflare-loader.mjs", "--test", "tests/neon-shared-cell-author-compensation-migration-review.test.ts"], { cwd: root, encoding: "utf8" });
assert.equal(test.status, 0, `${test.stdout}\n${test.stderr}`);
console.log("J5g-j6 migration review validated (sealed predecessor, exact 0009/0010 suffix, one read-only snapshot, no apply mode or runtime wiring).");
