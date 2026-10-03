import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { compileSharedCellAuthorCompensationMigrationReview, SHARED_CELL_AUTHOR_COMPENSATION_MIGRATION_SUFFIX } from "../lib/deployments/execution/neon-shared-cell-author-compensation-migration-review.ts";
import { COMPENSATION_MIGRATION_FINAL_CATALOG, COMPENSATION_MIGRATION_SCHEMA_SHA256,
  authorizeCompensationMigrationApply, validateCompensationMigrationReceipt, type CompensationMigrationObservation,
} from "../lib/deployments/execution/neon-shared-cell-author-compensation-migration-apply.ts";
import { applyReviewedCompensationMigrations, recoverCompensationMigrationState,
  type CompensationMigrationClient, type CompensationLocalMigration,
} from "../scripts/apply-reviewed-author-compensation-migrations.ts";
import { COMPENSATION_SCHEMA_QUERIES } from "../scripts/shared-cell-author-compensation-schema.ts";
import type { SharedCellPostgresMigrationReceipt } from "../lib/deployments/execution/neon-shared-cell-migration-apply.ts";
const predecessor = JSON.parse(await readFile(new URL("./fixtures/j5ge2-neon-postcheck.json", import.meta.url), "utf8")) as SharedCellPostgresMigrationReceipt;
const baseline = JSON.parse(await readFile(new URL("./fixtures/j5gj7-compensation-schema.json", import.meta.url), "utf8"));
const catalog: CompensationLocalMigration[] = await Promise.all(COMPENSATION_MIGRATION_FINAL_CATALOG.map(async (item) => ({ ...item,
  sql: await readFile(new URL(`../db/postgres-migrations/${item.filename}`, import.meta.url), "utf8") })));
async function review(age = 1000) {
  const time = Date.now() - age;
  return compileSharedCellAuthorCompensationMigrationReview({ predecessorReceipt: predecessor,
    targetFingerprintSha256: predecessor.targetFingerprintSha256, localMigrations: COMPENSATION_MIGRATION_FINAL_CATALOG,
    appliedMigrations: predecessor.finalMigrations, schema: predecessor.schema, counts: predecessor.counts, postState: predecessor.postState,
    compensationObjects: [], postgresVersionNumber: predecessor.postgresVersionNumber,
    databaseObservedAt: new Date(time).toISOString(), hostClockStartedAt: new Date(time - 50).toISOString(), hostClockCompletedAt: new Date(time + 50).toISOString() });
}
interface Options { state?: number; failSecondDdl?: boolean; loseCommit?: boolean; commitNotApplied?: boolean; failRead?: boolean; driftCounts?: boolean; schemaDrift?: boolean }
function ports(options: Options = {}) {
  const state = { stage: options.state ?? 0 };
  const writes: string[] = [], reads: string[] = [];
  const connections = { writer: 0, verifier: 0, destroyedWriter: 0 };
  const row = (value: object) => Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), item]));
  function client(readOnly: boolean): CompensationMigrationClient {
    let stage = state.stage;
    const statements = readOnly ? reads : writes;
    return { release(destroy) { if (!readOnly && destroy) connections.destroyedWriter++; }, async query(sql, values) {
      const statement = sql.trim(); statements.push(statement);
      if (/^(BEGIN|SET LOCAL|LOCK TABLE|ROLLBACK)/.test(statement)) return { rows: [] };
      if (statement === "COMMIT") {
        if (!options.commitNotApplied) state.stage = stage;
        if (options.loseCommit) throw new Error("Simulated provider response loss");
        return { rows: [] };
      }
      if (sql.startsWith("-- J5g-j2") || sql.startsWith("-- J5g-j3")) {
        if (sql.startsWith("-- J5g-j3") && options.failSecondDdl) throw new Error("second DDL rejected");
        stage++; return { rows: [] };
      }
      if (statement.startsWith("INSERT INTO public.schema_migrations")) {
        assert.equal((values ?? []).length, 3); return { rows: [] };
      }
      if (statement.includes("pg_try_advisory_xact_lock")) return { rows: [{ acquired: true }] };
      const key = Object.entries(COMPENSATION_SCHEMA_QUERIES).find(([, query]) => query === sql)?.[0];
      if (key) {
        if (readOnly && options.failRead) throw new Error("fresh read unavailable");
        let result = stage === 0 ? [] : baseline.schema[key];
        if (stage === 1 && key === "objects") result = [{ kind: "relation", name: "partial" }];
        if (options.schemaDrift && stage === 2 && key === "functions") result = result.map((item: object, i: number) => i ? item : { ...item, source: "BEGIN RETURN NEW; END;" });
        return { rows: structuredClone(result) };
      }
      if (sql.includes("AS row_count")) return { rows: [{ row_count: 0 }] };
      if (sql.includes("AS cutover_data_row_count")) return { rows: [row(predecessor.postState)] };
      if (sql.includes("SELECT filename, checksum")) return { rows: structuredClone([...predecessor.finalMigrations, ...SHARED_CELL_AUTHOR_COMPENSATION_MIGRATION_SUFFIX.slice(0, stage)]) };
      if (sql.includes("critical_trigger_count")) return { rows: [row({ ...predecessor.schema, transactionReadOnly: readOnly, transactionDeferrable: readOnly })] };
      if (sql.includes("environment_count")) return { rows: [row({ ...predecessor.counts, ...(options.driftCounts ? { runningJobCount: 1 } : {}) })] };
      if (sql.includes("server_version_num")) return { rows: [{ postgres_version_number: predecessor.postgresVersionNumber, database_observed_at: new Date().toISOString() }] };
      throw new Error("Unexpected statement");
    } };
  }
  return { writes, reads, connections, state,
    writer: { async connect() { connections.writer++; return client(false); } },
    verifier: { async connect() { connections.verifier++; return client(true); } } };
}
async function input(age = 1000) { const r = await review(age); return { review: r, expectedReviewSha256: r.manifestSha256, targetFingerprintSha256: predecessor.targetFingerprintSha256, catalog }; }

test("j7 schema baseline binds every definition and the new receipt rejects tampering", async () => {
  assert.equal(await sha256Hex(baseline.schema), COMPENSATION_MIGRATION_SCHEMA_SHA256);
  assert.equal(baseline.version, "180003");
  assert.equal(baseline.schema.columns.length, 77);
  assert.equal(baseline.schema.triggers.length, 7);
  const args = await input(); const db = ports();
  const receipt = await applyReviewedCompensationMigrations(db, args);
  assert.equal(receipt.outcome, "APPLIED");
  assert.equal(receipt.mutationPerformed, true);
  assert.equal(receipt.runtimeEnabled, false);
  assert.equal(receipt.cloudApplyEnabled, false);
  assert.deepEqual(await validateCompensationMigrationReceipt(receipt, args.review, args.expectedReviewSha256), receipt);
  const tampered = structuredClone(receipt); tampered.observation.compensationSchema.functions[0].source = "RETURN NEW";
  await assert.rejects(validateCompensationMigrationReceipt(tampered, args.review, args.expectedReviewSha256));
});

test("j7 locks before the first snapshot and commits the exact two migrations once", async () => {
  const db = ports(); await applyReviewedCompensationMigrations(db, await input());
  const firstSelect = db.writes.findIndex((sql) => sql.startsWith("SELECT"));
  assert.ok(db.writes.findIndex((sql) => sql.includes("ACCESS EXCLUSIVE MODE")) < firstSelect);
  assert.ok(db.writes.findIndex((sql) => sql.includes("IN SHARE ROW EXCLUSIVE MODE")) < firstSelect);
  assert.equal(db.writes.filter((sql) => sql.startsWith("-- J5g-j")).length, 2);
  assert.equal(db.writes.filter((sql) => sql.startsWith("INSERT INTO public.schema_migrations")).length, 2);
  assert.equal(db.writes.filter((sql) => sql === "COMMIT").length, 1);
  assert.equal(db.connections.writer, 1); assert.equal(db.connections.verifier, 1);
  assert.equal(db.connections.destroyedWriter, 1);
  assert.equal(db.reads.at(-1), "ROLLBACK");
  assert.ok(db.reads.findIndex((sql) => sql.includes("ACCESS SHARE MODE")) < db.reads.findIndex((sql) => sql.startsWith("SELECT")));
  assert.ok(db.reads.every((sql) => /^(BEGIN|SET LOCAL|LOCK TABLE public.schema_migrations IN ACCESS SHARE MODE$|SELECT|ROLLBACK)/.test(sql)));
});

test("j7 stale review, altered bytes, target and applied/partial state all stop without DDL", async () => {
  const expired = ports(); await assert.rejects(applyReviewedCompensationMigrations(expired, await input(30 * 60_000)), /failed closed/);
  assert.equal(expired.connections.writer, 0);
  for (const change of ["sql", "target", "sha", "samePool"] as const) {
    const db = ports(), args = await input();
    if (change === "sql") args.catalog = catalog.map((m, i) => i === 9 ? { ...m, sql: m.sql + "\nSELECT 1;" } : m);
    if (change === "target") args.targetFingerprintSha256 = "a".repeat(64);
    if (change === "sha") args.expectedReviewSha256 = "b".repeat(64);
    const executionPorts = change === "samePool" ? { writer: db.writer, verifier: db.writer } : db;
    await assert.rejects(applyReviewedCompensationMigrations(executionPorts, args));
    assert.equal(db.connections.writer, 0);
  }
  for (const options of [{ state: 1 }, { state: 2 }, { driftCounts: true }]) {
    const db = ports(options); await assert.rejects(applyReviewedCompensationMigrations(db, await input()));
    assert.equal(db.writes.filter((sql) => sql.startsWith("-- J5g-j")).length, 0);
    assert.equal(db.writes.at(-1), "ROLLBACK");
  }
});

test("j7 second DDL or exact post-schema drift rolls back instead of partial commit", async () => {
  for (const options of [{ failSecondDdl: true }, { schemaDrift: true }]) {
    const db = ports(options); await assert.rejects(applyReviewedCompensationMigrations(db, await input()));
    assert.equal(db.writes.at(-1), "ROLLBACK"); assert.equal(db.state.stage, 0);
    assert.equal(db.writes.includes("COMMIT"), false); assert.equal(db.connections.verifier, 0);
  }
});

test("j7 lost COMMIT response reconciles through fresh reads and never replays DDL", async () => {
  const db = ports({ loseCommit: true });
  const receipt = await applyReviewedCompensationMigrations(db, await input());
  assert.equal(receipt.outcome, "RECONCILED_APPLIED"); assert.equal(receipt.mutationPerformed, "unknown");
  assert.equal(db.writes.filter((sql) => sql.startsWith("-- J5g-j")).length, 2);
  assert.equal(db.writes.filter((sql) => sql === "COMMIT").length, 1);
  const missing = ports({ loseCommit: true, commitNotApplied: true });
  await assert.rejects(applyReviewedCompensationMigrations(missing, await input()), (e: unknown) => (e as { mutationPerformed: string }).mutationPerformed === "unknown");
  assert.equal(missing.writes.filter((sql) => sql === "COMMIT").length, 1);
  const unavailable = ports({ failRead: true });
  await assert.rejects(applyReviewedCompensationMigrations(unavailable, await input()), (e: unknown) => (e as { mutationPerformed: boolean }).mutationPerformed === true);
});

test("j7 expired review is accepted by mutation-free recovery but never authorizes replay", async () => {
  const args = await input(30 * 60_000);
  for (const applied of [false, true]) {
    const db = ports({ state: applied ? 2 : 0 });
    const receipt = await recoverCompensationMigrationState(db.verifier, args.review, args.expectedReviewSha256, args.targetFingerprintSha256);
    assert.equal(receipt.outcome, applied ? "RECOVERED_APPLIED" : "RECOVERED_NOT_APPLIED");
    assert.equal(receipt.mutationPerformed, false); assert.equal(receipt.databaseMutationPresent, applied);
    assert.equal(db.connections.writer, 0); assert.equal(db.reads.includes("COMMIT"), false);
  }
  const partial = ports({ state: 1 });
  await assert.rejects(recoverCompensationMigrationState(partial.verifier, args.review, args.expectedReviewSha256, args.targetFingerprintSha256));
  assert.equal(partial.reads.at(-1), "ROLLBACK");
});

test("j7 locked authorization rejects expiry, flags, clocks and state drift", async () => {
  const args = await input(); const db = ports();
  const receipt = await recoverCompensationMigrationState(db.verifier, args.review, args.expectedReviewSha256, args.targetFingerprintSha256);
  const observation = structuredClone(receipt.observation); observation.schema.transactionReadOnly = false; observation.schema.transactionDeferrable = false;
  const planInput = { review: args.review, expectedReviewSha256: args.expectedReviewSha256, targetFingerprintSha256: args.targetFingerprintSha256,
    localMigrations: COMPENSATION_MIGRATION_FINAL_CATALOG, observation };
  assert.equal((await authorizeCompensationMigrationApply(planInput)).migrations.length, 2);
  for (const change of [(o: CompensationMigrationObservation) => { o.schema.transactionReadOnly = true; },
    (o: CompensationMigrationObservation) => { o.compensationRowCount = 1; },
    (o: CompensationMigrationObservation) => { o.databaseObservedAt = new Date(Date.now() + 60000).toISOString(); },
    (o: CompensationMigrationObservation) => { o.counts.runningJobCount = 1; }]) {
    const altered = structuredClone(planInput); change(altered.observation); await assert.rejects(authorizeCompensationMigrationApply(altered));
  }
  assert.notEqual(canonicalJson(baseline.schema), canonicalJson({ ...baseline.schema, functions: [] }));
});

test("j7 CLI import is inert and unauthorized apply cannot reach a provider", () => {
  const imported = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", "await import('./scripts/apply-reviewed-author-compensation-migrations.ts'); console.log('IMPORT_ONLY');"], { encoding: "utf8" });
  assert.equal(imported.status, 0, imported.stderr); assert.equal(imported.stdout.trim(), "IMPORT_ONLY");
  const direct = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/apply-reviewed-author-compensation-migrations.ts", "--mode", "apply-reviewed"], { encoding: "utf8" });
  assert.equal(direct.status, 1); assert.equal(JSON.parse(direct.stderr.trim()).mutationPerformed, false); assert.equal(direct.stdout, "");
});
