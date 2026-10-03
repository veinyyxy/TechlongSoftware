import { open, readFile, readdir, stat, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { migrationChecksum, normalizeMigrationSql } from "./migration-checksum.mjs";
import { readCompensationSchema, COMPENSATION_TABLES } from "./shared-cell-author-compensation-schema.ts";
import { beginSealedSharedCellPostgresReadOnly, readSealedSharedCellPostgresSnapshot,
  readSealedSharedCellPostgresPostState, sealedSharedCellPostgresTargetFingerprint,
} from "./apply-reviewed-shared-cell-postgres-cutover.ts";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { authorizeCompensationMigrationApply, compileCompensationMigrationReceipt,
  assertCompensationMigrationReviewFresh, reviewedCompensationMigration,
  validateCompensationMigrationObservation, COMPENSATION_MIGRATION_SCHEMA_SHA256,
  COMPENSATION_MIGRATION_FINAL_CATALOG, COMPENSATION_MIGRATION_EMPTY_SCHEMA,
  CompensationMigrationApplyError, type CompensationMigrationMutation,
  type CompensationMigrationObservation, type CompensationMigrationOutcome,
} from "../lib/deployments/execution/neon-shared-cell-author-compensation-migration-apply.ts";
import type { SharedCellAuthorCompensationMigrationReview } from "../lib/deployments/execution/neon-shared-cell-author-compensation-migration-review.ts";
import type { SharedCellPostgresMigrationDigest } from "../lib/deployments/execution/neon-shared-cell-migration-readiness.ts";

export interface CompensationMigrationClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(destroy?: boolean): void;
}
export interface CompensationMigrationPool { connect(): Promise<CompensationMigrationClient> }
export interface CompensationLocalMigration extends SharedCellPostgresMigrationDigest { sql: string }
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const confirmation = "I_CONFIRM_J5GJ7_APPLY_NEON_MIGRATIONS_0009_AND_0010";
const guardVariable = "TECHLONG_J5GJ7_MIGRATION_APPLY_GUARD_NONCE";
const lockTables = ["app_instances", "app_instance_deployments", "deployment_environments", "deployment_jobs",
  "deployment_step_runs", "deployment_cleanup_schedules", "deployment_environment_capacity_reservations",
  "deployment_tenant_resources", "deployment_tenant_resource_events", "deployment_tenant_external_operations",
  "deployment_tenant_external_operation_events", "deployment_tenant_cleanup_runs", "deployment_tenant_cleanup_phases", "deployment_tenant_cleanup_events"];
function fail(code: string, mutation: CompensationMigrationMutation = false): never {
  throw new CompensationMigrationApplyError(`COMPENSATION_MIGRATION_${code}`, mutation);
}
function same(actual: unknown, expected: unknown, code: string) {
  if (canonicalJson(actual) !== canonicalJson(expected)) fail(code);
}
function boundedClient(client: CompensationMigrationClient, maximumMs: number, readOnly: boolean): CompensationMigrationClient {
  const started = Date.now();
  return { release() {}, query(sql, values) {
    const statement = sql.trim();
    if (statement !== "ROLLBACK" && Date.now() - started > maximumMs) fail("DEADLINE_EXCEEDED");
    if (readOnly && !/^(SELECT\b|SET LOCAL\b|BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE$|LOCK TABLE public\.schema_migrations IN ACCESS SHARE MODE$|ROLLBACK$)/i.test(statement)) fail("READ_ONLY_STATEMENT_INVALID");
    return client.query(sql, values);
  } };
}
async function collect(client: CompensationMigrationClient): Promise<CompensationMigrationObservation> {
  const compensationSchema = await readCompensationSchema(client);
  const schemaHash = await sha256Hex(compensationSchema);
  let compensationRowCount = 0;
  if (schemaHash === COMPENSATION_MIGRATION_SCHEMA_SHA256) {
    const result = await client.query(`SELECT (${COMPENSATION_TABLES.map((table) => `(SELECT count(*) FROM public.${table})`).join(" + ")})::integer AS row_count`);
    compensationRowCount = Number(result.rows[0]?.row_count);
    if (!Number.isSafeInteger(compensationRowCount) || compensationRowCount < 0) fail("ROW_COUNT_INVALID");
  } else same(compensationSchema, COMPENSATION_MIGRATION_EMPTY_SCHEMA, "PARTIAL_OR_DRIFTED_SCHEMA");
  const postState = await readSealedSharedCellPostgresPostState(client);
  const snapshot = await readSealedSharedCellPostgresSnapshot(client);
  return { ...snapshot, postState, compensationSchema, compensationRowCount };
}
async function beginLocked(client: CompensationMigrationClient) {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE NOT DEFERRABLE");
  await client.query("SET LOCAL statement_timeout = '120000ms'");
  await client.query("SET LOCAL lock_timeout = '5000ms'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout = '30000ms'");
  await client.query("SET LOCAL search_path = public, pg_catalog");
  // Establish all data locks BEFORE the first SELECT establishes a serializable snapshot.
  await client.query("LOCK TABLE public.schema_migrations IN ACCESS EXCLUSIVE MODE");
  await client.query(`LOCK TABLE ${lockTables.map((table) => `public.${table}`).join(", ")} IN SHARE ROW EXCLUSIVE MODE`);
  const lock = await client.query("SELECT pg_try_advisory_xact_lock($1, $2) AS acquired", [1_246_841_221, 1_245_955_122]);
  if (lock.rows[0]?.acquired !== true) fail("LOCK_UNAVAILABLE");
}
async function verify(pool: CompensationMigrationPool, review: SharedCellAuthorCompensationMigrationReview,
  targetFingerprintSha256: string, requestedOutcome?: "APPLIED" | "RECONCILED_APPLIED") {
  const client = await pool.connect();
  const reads = boundedClient(client, 30_000, true);
  let began = true, destroy = false;
  try {
    await beginSealedSharedCellPostgresReadOnly(reads);
    // Wait for any writer's catalog fence before taking the read snapshot; never infer rollback from a stale snapshot.
    await reads.query("LOCK TABLE public.schema_migrations IN ACCESS SHARE MODE");
    const observation = await collect(reads);
    const applied = canonicalJson(observation.appliedMigrations) === canonicalJson(COMPENSATION_MIGRATION_FINAL_CATALOG);
    if (!applied && requestedOutcome) fail("COMMIT_NOT_PROVEN");
    const outcome: CompensationMigrationOutcome = requestedOutcome ?? (applied ? "RECOVERED_APPLIED" : "RECOVERED_NOT_APPLIED");
    const receipt = await compileCompensationMigrationReceipt({ review, expectedReviewSha256: review.manifestSha256,
      targetFingerprintSha256, observation, outcome,
      mutationPerformed: outcome === "APPLIED" ? true : outcome === "RECONCILED_APPLIED" ? "unknown" : false });
    await reads.query("ROLLBACK"); began = false;
    return receipt;
  } catch (error) { destroy = true; throw error; }
  finally {
    if (began) try { await reads.query("ROLLBACK"); } catch { destroy = true; }
    client.release(destroy);
  }
}
/** Recovery has no writer port. Expired review is historical binding only, never a renewed write authorization. */
export async function recoverCompensationMigrationState(pool: CompensationMigrationPool, reviewValue: unknown,
  expectedReviewSha256: string, targetFingerprintSha256: string) {
  const review = await reviewedCompensationMigration(reviewValue, expectedReviewSha256);
  same(targetFingerprintSha256, review.evidence.targetFingerprintSha256, "TARGET_MISMATCH");
  return verify(pool, review, targetFingerprintSha256);
}
export async function applyReviewedCompensationMigrations(ports: {
  writer: CompensationMigrationPool; verifier: CompensationMigrationPool;
}, input: { review: unknown; expectedReviewSha256: string; targetFingerprintSha256: string; catalog: readonly CompensationLocalMigration[] }) {
  if (ports.writer === ports.verifier) fail("INDEPENDENT_VERIFIER_REQUIRED");
  const review = await reviewedCompensationMigration(input.review, input.expectedReviewSha256);
  assertCompensationMigrationReviewFresh(review);
  same(input.targetFingerprintSha256, review.evidence.targetFingerprintSha256, "TARGET_MISMATCH");
  const catalog = input.catalog.map((item) => ({ ...item, sql: normalizeMigrationSql(item.sql) }));
  same(catalog.map(({ filename, checksum }) => ({ filename, checksum })), COMPENSATION_MIGRATION_FINAL_CATALOG, "LOCAL_CATALOG_MISMATCH");
  for (const item of catalog) if (migrationChecksum(item.sql) !== item.checksum) fail("IN_MEMORY_SQL_DRIFT");
  let raw: CompensationMigrationClient | undefined;
  let began = false, ddlSent = false, commitSent = false, commitConfirmed = false;
  try {
    raw = await ports.writer.connect();
    const client = boundedClient(raw, 300_000, false);
    began = true; await beginLocked(client);
    const observation = await collect(client);
    const plan = await authorizeCompensationMigrationApply({ review, expectedReviewSha256: review.manifestSha256,
      targetFingerprintSha256: input.targetFingerprintSha256,
      localMigrations: catalog.map(({ filename, checksum }) => ({ filename, checksum })), observation });
    const appliedAt = Date.parse(observation.databaseObservedAt);
    for (const migration of plan.migrations) {
      const local = catalog.find((item) => item.filename === migration.filename)!;
      assertCompensationMigrationReviewFresh(review);
      ddlSent = true; await client.query(local.sql);
      await client.query("INSERT INTO public.schema_migrations (filename, checksum, applied_at) VALUES ($1, $2, $3)",
        [migration.filename, migration.checksum, appliedAt]);
    }
    const after = await collect(client);
    await validateCompensationMigrationObservation(review, after, "locked", "after", true);
    assertCompensationMigrationReviewFresh(review);
    commitSent = true; await client.query("COMMIT"); commitConfirmed = true; began = false;
    raw.release(true); raw = undefined; // Force disposal; verifier is a different physical pool/session.
    return await verify(ports.verifier, review, input.targetFingerprintSha256, "APPLIED");
  } catch (error) {
    let rollbackConfirmed = false;
    if (!commitSent && began && raw) try { await raw.query("ROLLBACK"); rollbackConfirmed = true; } catch { /* Recovery only if rollback is uncertain. */ }
    raw?.release(true); raw = undefined;
    if (commitSent && !commitConfirmed) {
      try { return await verify(ports.verifier, review, input.targetFingerprintSha256, "RECONCILED_APPLIED"); }
      catch { fail("COMMIT_OUTCOME_UNKNOWN_RECOVERY_REQUIRED", "unknown"); }
    }
    if (commitConfirmed) fail("POSTCOMMIT_VERIFICATION_FAILED_RECOVERY_REQUIRED", true);
    if (ddlSent && !rollbackConfirmed) fail("ROLLBACK_UNKNOWN_RECOVERY_REQUIRED", "unknown");
    if (error instanceof CompensationMigrationApplyError) throw error;
    fail("APPLY_FAILED_ROLLED_BACK");
  } finally { raw?.release(true); }
}

function externalJson(value: string) {
  if (!path.isAbsolute(value) || path.extname(value) !== ".json") fail("EXTERNAL_JSON_REQUIRED");
  const resolved = path.resolve(value), relative = path.relative(repoRoot, resolved);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) fail("EXTERNAL_JSON_REQUIRED");
  return resolved;
}
async function loadReview(filename: string) {
  const info = await stat(filename);
  if (!info.isFile() || info.size < 1 || info.size > 65_536) fail("REVIEW_FILE_INVALID");
  return JSON.parse(await readFile(filename, "utf8"));
}
async function localCatalog(): Promise<CompensationLocalMigration[]> {
  const directory = path.join(repoRoot, "db/postgres-migrations");
  const files = (await readdir(directory)).filter((filename) => filename.endsWith(".sql")).sort();
  return Promise.all(files.map(async (filename) => {
    const sql = normalizeMigrationSql(await readFile(path.join(directory, filename), "utf8"));
    return { filename, checksum: migrationChecksum(sql), sql };
  }));
}
async function save(handle: FileHandle, value: unknown) {
  await handle.truncate(0); await handle.write(`${JSON.stringify(value)}\n`, 0, "utf8"); await handle.sync();
}
async function main() {
  const args = new Map<string, string>();
  const accepted = ["--mode", "--review", "--review-sha256", "--output", "--guard-nonce", "--confirm-apply"];
  if ((process.argv.length - 2) % 2) fail("ARGUMENTS_INVALID");
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i], value = process.argv[i + 1];
    if (!accepted.includes(key) || args.has(key) || !value || value.startsWith("--")) fail("ARGUMENTS_INVALID");
    args.set(key, value);
  }
  const apply = args.get("--mode") === "apply-reviewed";
  if ((!apply && args.get("--mode") !== "recover-state") || args.size !== (apply ? 6 : 5) ||
      (apply ? args.get("--confirm-apply") !== confirmation : args.has("--confirm-apply"))) fail("MODE_OR_ACKNOWLEDGEMENT_INVALID");
  const nonce = args.get("--guard-nonce")!;
  if (!/^[a-f0-9]{64}$/.test(nonce) || process.env[guardVariable] !== nonce) fail("WRAPPER_GUARD_REQUIRED");
  delete process.env[guardVariable];
  const review = await reviewedCompensationMigration(await loadReview(externalJson(args.get("--review")!)), args.get("--review-sha256")!);
  if (apply) assertCompensationMigrationReviewFresh(review);
  const outputPath = externalJson(args.get("--output")!);
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl || process.env.NEON_DATABASE_URL) fail("LOCAL_DATABASE_URL_REQUIRED");
  const targetFingerprintSha256 = await sealedSharedCellPostgresTargetFingerprint(databaseUrl);
  same(targetFingerprintSha256, review.evidence.targetFingerprintSha256, "TARGET_MISMATCH");
  const catalog = await localCatalog();
  same(catalog.map(({ filename, checksum }) => ({ filename, checksum })), COMPENSATION_MIGRATION_FINAL_CATALOG, "LOCAL_CATALOG_MISMATCH");
  const output = await open(outputPath, "wx", 0o600);
  neonConfig.webSocketConstructor = WebSocket;
  const verifier = new Pool({ connectionString: databaseUrl, options: "-c default_transaction_read_only=on", max: 1, connectionTimeoutMillis: 10000, idleTimeoutMillis: 1000 });
  const writer = apply ? new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10000, idleTimeoutMillis: 1000 }) : undefined;
  verifier.on("error", () => {}); writer?.on("error", () => {});
  let mutation: CompensationMigrationMutation = false;
  const marker = async (code: string, phase: string) => {
    const body = { schemaVersion: 1, stage: "B5-J5g-j7", intent: "record_compensation_migration_recovery_requirement",
      reviewManifestSha256: review.manifestSha256, targetFingerprintSha256, phase, code, mutationPerformed: mutation };
    await save(output, { ...body, markerSha256: await sha256Hex(body) });
  };
  try {
    // Durable before delegating to any writer. A crash leaves an exact digest-bound Recover-only handoff.
    mutation = apply ? "unknown" : false;
    await marker("OPERATION_STARTED", apply ? "WRITE_REVIEW_DELEGATION_PENDING" : "READ_ONLY_RECOVERY_PENDING");
    const receipt = apply ? await applyReviewedCompensationMigrations({ writer: writer!, verifier },
      { review, expectedReviewSha256: review.manifestSha256, targetFingerprintSha256, catalog }) :
      await recoverCompensationMigrationState(verifier, review, review.manifestSha256, targetFingerprintSha256);
    mutation = receipt.mutationPerformed;
    await save(output, receipt);
    console.log(JSON.stringify({ mode: args.get("--mode"), outcome: receipt.outcome, receiptSha256: receipt.receiptSha256,
      databaseMutationPresent: receipt.databaseMutationPresent, mutationPerformed: receipt.mutationPerformed, output: outputPath }));
  } catch (error) {
    if (error instanceof CompensationMigrationApplyError) mutation = error.mutationPerformed;
    const code = error instanceof CompensationMigrationApplyError ? error.code : "COMPENSATION_MIGRATION_OPERATION_OR_EVIDENCE_FAILED";
    try { await marker(code, "STOPPED_RECOVERY_REQUIRED"); } catch { /* Stderr remains available if local storage failed. */ }
    throw new CompensationMigrationApplyError(code, mutation);
  } finally {
    try { await Promise.all([writer?.end(), verifier.end()]); }
    catch { throw new CompensationMigrationApplyError("COMPENSATION_MIGRATION_CONNECTION_CLEANUP_FAILED", mutation); }
    finally {
      try { await output.close(); }
      catch { throw new CompensationMigrationApplyError("COMPENSATION_MIGRATION_EVIDENCE_CLOSE_FAILED", mutation); }
    }
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main().catch((error) => {
  console.error(JSON.stringify({ code: error instanceof CompensationMigrationApplyError ? error.code : "COMPENSATION_MIGRATION_ARGUMENT_OR_PREFLIGHT_FAILED",
    message: "Compensation migration operation stopped; no automatic replay or down migration. Provider details are withheld.",
    mutationPerformed: error instanceof CompensationMigrationApplyError ? error.mutationPerformed : false }));
  process.exitCode = 1;
});
