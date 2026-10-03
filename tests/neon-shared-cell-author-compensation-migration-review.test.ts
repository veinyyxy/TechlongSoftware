import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  compileSharedCellAuthorCompensationMigrationReview,
  validateSharedCellAuthorCompensationMigrationReview,
  SHARED_CELL_AUTHOR_COMPENSATION_MIGRATION_SUFFIX,
  type SharedCellAuthorCompensationMigrationReviewInput,
} from "../lib/deployments/execution/neon-shared-cell-author-compensation-migration-review.ts";
import { inspectSharedCellAuthorCompensationMigrationReadiness } from "../scripts/review-shared-cell-author-compensation-migrations.ts";
import { migrationChecksum } from "../scripts/migration-checksum.mjs";
import type { SharedCellPostgresMigrationReceipt } from "../lib/deployments/execution/neon-shared-cell-migration-apply.ts";
import { SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG } from "../lib/deployments/execution/neon-shared-cell-migration-readiness.ts";

const predecessor = JSON.parse(await readFile(new URL("./fixtures/j5ge2-neon-postcheck.json", import.meta.url), "utf8")) as SharedCellPostgresMigrationReceipt;
function input(): SharedCellAuthorCompensationMigrationReviewInput {
  return structuredClone({ predecessorReceipt: predecessor, targetFingerprintSha256: predecessor.targetFingerprintSha256,
    localMigrations: [...SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG, ...SHARED_CELL_AUTHOR_COMPENSATION_MIGRATION_SUFFIX],
    appliedMigrations: predecessor.finalMigrations, schema: predecessor.schema, counts: predecessor.counts, postState: predecessor.postState,
    compensationObjects: [], postgresVersionNumber: predecessor.postgresVersionNumber,
    databaseObservedAt: "2026-10-03T12:00:00.050Z", hostClockStartedAt: "2026-10-03T12:00:00.000Z", hostClockCompletedAt: "2026-10-03T12:00:00.100Z" });
}

test("j6 new review preserves the sealed e2 receipt and binds only exact pending 0009/0010 bytes", async () => {
  const source = input();
  const manifest = await compileSharedCellAuthorCompensationMigrationReview(source);
  assert.equal(manifest.applyEnabled, false);
  assert.equal(manifest.mutationPerformed, false);
  assert.deepEqual(manifest.pendingMigrations, SHARED_CELL_AUTHOR_COMPENSATION_MIGRATION_SUFFIX);
  assert.equal(manifest.predecessorReceiptSha256, predecessor.receiptSha256);
  assert.equal(manifest.reviewExpiresAt, "2026-10-03T12:15:00.100Z");
  assert.equal(manifest.clockSkewMs, 0);
  assert.ok(Object.isFrozen(manifest.evidence.schema));
  assert.deepEqual(await validateSharedCellAuthorCompensationMigrationReview(structuredClone(manifest)), manifest);
  source.localMigrations = [];
  assert.equal(manifest.evidence.localMigrations.length, 10);
  for (const expected of SHARED_CELL_AUTHOR_COMPENSATION_MIGRATION_SUFFIX) {
    assert.equal(migrationChecksum(await readFile(new URL(`../db/postgres-migrations/${expected.filename}`, import.meta.url), "utf8")), expected.checksum);
  }
  const altered = structuredClone(manifest);
  (altered as unknown as { applyEnabled: boolean }).applyEnabled = true;
  await assert.rejects(validateSharedCellAuthorCompensationMigrationReview(altered));
});

test("j6 rejects catalog, target, partial namespace, schema, ownership and clock drift", async () => {
  const cases: Array<(value: SharedCellAuthorCompensationMigrationReviewInput) => void> = [
    (value) => { value.targetFingerprintSha256 = "a".repeat(64); },
    (value) => { value.localMigrations = [...value.localMigrations, { filename: "0011_other.sql", checksum: "b".repeat(64) }]; },
    (value) => { value.appliedMigrations = [...value.appliedMigrations, SHARED_CELL_AUTHOR_COMPENSATION_MIGRATION_SUFFIX[0]]; },
    (value) => { value.compensationObjects = [{ object_kind: "function", object_name: "prevent_scac_append_only_mutation" }]; },
    (value) => { value.schema.criticalTriggerEnabledCount = 22; },
    (value) => { value.schema.transactionReadOnly = false; },
    (value) => { value.counts.runningJobCount = 1; },
    (value) => { value.postState.cutoverDataRowCount = 1; },
    (value) => { value.postgresVersionNumber = 190_001; },
    (value) => { value.hostClockCompletedAt = "2026-10-03T12:00:20.000Z"; },
    (value) => { value.databaseObservedAt = "2026-10-03T12:00:10.000Z"; },
  ];
  for (const change of cases) { const value = input(); change(value); await assert.rejects(compileSharedCellAuthorCompensationMigrationReview(value)); }
  const patch = input(); patch.postgresVersionNumber++;
  assert.equal((await compileSharedCellAuthorCompensationMigrationReview(patch)).evidence.postgresVersionNumber, patch.postgresVersionNumber);
});

function fakeClient(partial = false) {
  const statements: string[] = [];
  const toRow = (value: object) => Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`), item]));
  return { statements, release() {}, async query(sql: string) {
    statements.push(sql.trim());
    if (/^(BEGIN|SET|ROLLBACK)/.test(sql.trim())) return { rows: [] };
    if (sql.includes("object_kind, object_name")) return { rows: partial ? [{ object_kind: "relation", object_name: "shared_cell_author_compensation_operations" }] : [] };
    if (sql.includes("AS cutover_data_row_count")) return { rows: [toRow(predecessor.postState)] };
    if (sql.includes("SELECT filename, checksum")) return { rows: predecessor.finalMigrations as unknown as Record<string, unknown>[] };
    if (sql.includes("critical_trigger_count")) return { rows: [toRow(predecessor.schema)] };
    if (sql.includes("environment_count")) return { rows: [toRow(predecessor.counts)] };
    if (sql.includes("server_version_num")) return { rows: [{ postgres_version_number: predecessor.postgresVersionNumber, database_observed_at: new Date().toISOString() }] };
    throw new Error("Unexpected database statement");
  } };
}

test("j6 collector reuses sealed readbacks in one read-only snapshot and always rolls back", async () => {
  const client = fakeClient();
  const args = { predecessorReceipt: predecessor, targetFingerprintSha256: predecessor.targetFingerprintSha256, localMigrations: input().localMigrations };
  const manifest = await inspectSharedCellAuthorCompensationMigrationReadiness(client, args);
  assert.equal(manifest.mutationPerformed, false);
  assert.equal(client.statements[0], "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE");
  assert.equal(client.statements.at(-1), "ROLLBACK");
  assert.ok(client.statements.every((sql) => /^(BEGIN TRANSACTION|SET LOCAL|SELECT|ROLLBACK)/.test(sql)));
  assert.ok(client.statements.some((sql) => sql.includes("'function'")));
  const drifted = fakeClient(true);
  await assert.rejects(inspectSharedCellAuthorCompensationMigrationReadiness(drifted, args), /namespace absence/);
  assert.equal(drifted.statements.at(-1), "ROLLBACK");
});

test("importing e2 and j6 collectors does not run either CLI and j6 exposes no write mode", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const imports = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e",
    "await import('./scripts/apply-reviewed-shared-cell-postgres-cutover.ts'); await import('./scripts/review-shared-cell-author-compensation-migrations.ts'); console.log('IMPORT_ONLY_NO_NETWORK');"], { cwd: root, encoding: "utf8" });
  assert.equal(imports.status, 0, imports.stderr);
  assert.equal(imports.stdout.trim(), "IMPORT_ONLY_NO_NETWORK");
  const write = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/review-shared-cell-author-compensation-migrations.ts", "--mode", "apply-reviewed"], { cwd: root, encoding: "utf8" });
  assert.equal(write.status, 1);
  assert.equal(JSON.parse(write.stderr.trim()).mutationPerformed, false);
  assert.equal(write.stdout.trim(), "");
});
