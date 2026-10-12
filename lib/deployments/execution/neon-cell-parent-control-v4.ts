import { neon } from "@neondatabase/serverless";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { cellV3Clock, cellV3Exact, cellV3Fail, cellV3Freeze } from "../cloudformation/shared-cell-stack-v3.ts";
import { SEALED_CELL_OWNERSHIP_SQL_V3, NeonSealedCellOwnershipSourceV3, isCertifiedSealedCellOwnershipSnapshotV3, type SealedPlanCertificateV1 } from "./neon-sealed-cell-ownership-source-v3.ts";
import { FAILED_BIRTH_PROTECTION_CATALOG_V1, FAILED_BIRTH_ENVIRONMENT_IDENTITY_V1, NeonFailedCellBirthSourceV1, assertCertifiedFailedCellBirthSnapshotV1, type CertifiedFailedCellBirthSnapshotV1 } from "./neon-failed-cell-birth-source-v1.ts";
import { NeonFailedCellBirthFenceWriterV1 } from "./failed-cell-birth-fence-v1.ts";
import { NeonSharedCellAdmissionFenceWriter, type NeonSharedCellAdmissionFenceSqlClient } from "./neon-shared-cell-admission-fence.ts";
import { NeonCellTtlCleanupJobProducer } from "./neon-cell-ttl-cleanup-jobs.ts";
import { compileSharedCellAdmissionDrainIntent, type SharedCellAdmissionDrainReceipt } from "./shared-cell-admission-fence.ts";
import { type SharedCellProvisionAuthorityRecord } from "./shared-cell-cleanup-authority.ts";
import { validateSealedCertificateV3 } from "./sealed-cell-cleanup-authority-v3.ts";
import type { NeonSerializableSnapshotSqlClient } from "./neon-shared-cell-zero-tenant-source.ts";

const env = "env_aws_sandbox_ca_central_1", proofs = new WeakSet<object>(), openProofs = new WeakSet<object>(), failedProofs = new WeakSet<object>();
const jobsSql = "SELECT j.id FROM public.deployment_jobs j JOIN public.app_instance_deployments d ON d.id=j.deployment_id WHERE d.environment_id=$1 AND j.status IN ('pending','running','retry_wait') ORDER BY j.id";
const stepsSql = "SELECT s.id FROM public.deployment_step_runs s JOIN public.app_instance_deployments d ON d.id=s.deployment_id WHERE d.environment_id=$1 AND s.status IN ('pending','running') ORDER BY s.id";
const fenceSql = "SELECT environment_id,fence_json,fence_sha256,created_at FROM public.deployment_failed_cell_birth_fences_v1 WHERE environment_id=$1";
const certFields = ["deployment_id", "environment_id", "app_instance_id", "original_row_sha256", "original_plan_bytes_sha256", "original_plan_hash", "business_state_sha256", "approved_registration_sha256", "protection_schema_sha256", "sealed_at"];
function rows(raw: unknown) { const r = (raw as { rows?: Record<string, unknown>[] })?.rows; if (!Array.isArray(r) || r.some(v => !v || typeof v !== "object" || Array.isArray(v))) cellV3Fail("CELL_PARENT_DB_ROWS_INVALID"); return r; }
function one(raw: unknown) { const r = rows(raw); if (r.length !== 1) cellV3Fail("CELL_PARENT_DB_SINGLE_ROW_REQUIRED"); return r[0]; }
function integer(v: unknown) { const n = typeof v === "number" ? v : typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v) ? Number(v) : NaN; if (!Number.isSafeInteger(n) || n < 0) cellV3Fail("CELL_PARENT_DB_INTEGER_INVALID"); return n; }
function ids(raw: unknown) { const r = rows(raw); if (r.length > 10000 || r.some(v => !cellV3Exact(v, ["id"]) || typeof v.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/.test(v.id))) cellV3Fail("CELL_PARENT_DB_IDS_INVALID");
  const a = r.map(v => v.id as string); if (new Set(a).size !== a.length || canonicalJson(a) !== canonicalJson([...a].sort())) cellV3Fail("CELL_PARENT_DB_IDS_INVALID"); return a; }
export function assertCellParentOpenDatabaseV4(v: CellParentOpenDatabaseV4, now: number, zero = false) {
  cellV3Clock(now); if (!openProofs.has(v) || v.observedAt > now || now - v.observedAt > 30000 || (zero && !v.certifiedZero)) cellV3Fail("CELL_PARENT_DB_OPEN_PROOF_REQUIRED");
}
export function assertCellParentTtlZeroV4(v: CellParentTtlZeroV4, predecessor: SharedCellProvisionAuthorityRecord, now: number) {
  cellV3Clock(now); if (!proofs.has(v) || !isCertifiedSealedCellOwnershipSnapshotV3(v.snapshot) || v.snapshot.dbObservedAt > now || now - v.snapshot.dbObservedAt > 30000 ||
    v.predecessorRecordHash !== predecessor.recordHash || now < Date.parse(predecessor.cellExpiresAt)) cellV3Fail("CELL_PARENT_TTL_CERTIFIED_ZERO_REQUIRED");
}
export function assertCellParentFailedZeroV4(v: CertifiedFailedCellBirthSnapshotV1, now: number) {
  assertCertifiedFailedCellBirthSnapshotV1(v, now); if (!failedProofs.has(v)) cellV3Fail("CELL_PARENT_FAILED_JOB_COVERAGE_REQUIRED");
}
/** New DB composition; old parsers are never weakened. TTL's original nine
 * genuine queries and four additional protection/jobs/steps queries execute in
 * the SAME Serializable read-only transaction. The original parser receives
 * exactly its real nine results; a separate private brand covers the extras. */
export class NeonCellParentDatabaseV4 {
  readonly failedWriter: NeonFailedCellBirthFenceWriterV1;
  readonly admissions: NeonSharedCellAdmissionFenceWriter; readonly jobs: NeonCellTtlCleanupJobProducer;
  private readonly sql: NeonSerializableSnapshotSqlClient; private readonly cert: Readonly<SealedPlanCertificateV1>; private readonly protection: string;
  constructor(sql: NeonSerializableSnapshotSqlClient, writer: NeonSharedCellAdmissionFenceSqlClient, certificate: SealedPlanCertificateV1, protectionSha256: string) {
    if (typeof sql?.transaction !== "function" || typeof writer?.query !== "function" || !/^[a-f0-9]{64}$/.test(protectionSha256)) cellV3Fail("CELL_PARENT_DB_CAPABILITIES_INVALID");
    this.sql = Object.freeze({ transaction: sql.transaction.bind(sql) }); this.cert = validateSealedCertificateV3(certificate); this.protection = protectionSha256;
    const w = Object.freeze({ query: writer.query.bind(writer) });
    this.failedWriter = new NeonFailedCellBirthFenceWriterV1(w); this.admissions = new NeonSharedCellAdmissionFenceWriter(w); this.jobs = new NeonCellTtlCleanupJobProducer(w);
  }
  async readOpen(signal: AbortSignal, requireZero: boolean) {
    signal.throwIfAborted(); const r = await this.sql.transaction(tx => [
      ...Object.entries(SEALED_CELL_OWNERSHIP_SQL_V3).map(([k, s]) => tx.query(s, k === "searchPath" ? [] : [env])),
      tx.query(fenceSql, [env]), tx.query(FAILED_BIRTH_ENVIRONMENT_IDENTITY_V1, [env]), tx.query(FAILED_BIRTH_PROTECTION_CATALOG_V1, []), tx.query(jobsSql, [env]), tx.query(stepsSql, [env]),
    ], { isolationLevel: "Serializable", readOnly: true, deferrable: true, fullResults: true, fetchOptions: { signal } }); signal.throwIfAborted();
    if (!Array.isArray(r) || r.length !== 14) cellV3Fail("CELL_PARENT_DB_OPEN_TRANSACTION_INVALID");
    const settings = one(r[0]), e = one(r[1]), c = one(r[2]), identity = one(r[10]), catalog = one(r[11]);
    if (!cellV3Exact(settings, ["search_path", "row_security"]) || settings.search_path !== "pg_catalog" || settings.row_security !== "off" ||
      !cellV3Exact(e, ["environment_id", "account_id", "region", "cell_key", "admission_state", "admission_epoch", "admission_fence_sha256", "admission_provision_operation_hash", "admission_stack_id", "admission_cell_expires_at", "admission_changed_at", "observed_at", "reader_role", "limited_reader", "no_owner_or_table_write"]) ||
      e.environment_id !== env || e.account_id !== "402010193138" || e.region !== "ca-central-1" || e.cell_key !== "cell-sandbox-1" || e.admission_state !== "open" || integer(e.admission_epoch) !== 0 ||
      [e.admission_fence_sha256, e.admission_provision_operation_hash, e.admission_stack_id, e.admission_cell_expires_at, e.admission_changed_at].some(x => x !== null) ||
      e.reader_role !== "techlong_cell_cleanup_reader" || e.limited_reader !== true || e.no_owner_or_table_write !== true || rows(r[9]).length ||
      !cellV3Exact(identity, ["identity_sha256"]) || !/^[a-f0-9]{64}$/.test(String(identity.identity_sha256)) || !cellV3Exact(catalog, ["protection_sha256"]) || catalog.protection_sha256 !== this.protection) cellV3Fail("CELL_PARENT_DB_OPEN_OR_PROTECTION_DRIFT");
    const actual = validateSealedCertificateV3(Object.fromEntries(certFields.map(k => [k, k === "sealed_at" ? integer(c[k]) : c[k]])));
    if (!cellV3Exact(c, [...certFields, "fence_sealed", "fence_sealed_at", "fence_revision", "live_row_sha256", "live_plan_bytes_sha256", "live_plan_hash", "fingerprint_body_sha256", "fingerprint_function_safe", "live_protection_sha256"]) ||
      canonicalJson(actual) !== canonicalJson(this.cert) || c.fence_sealed !== true || integer(c.fence_sealed_at) !== actual.sealed_at || integer(c.fence_revision) < 1 ||
      c.live_row_sha256 !== actual.original_row_sha256 || c.live_plan_bytes_sha256 !== actual.original_plan_bytes_sha256 || c.live_plan_hash !== actual.original_plan_hash ||
      c.fingerprint_body_sha256 !== "16e82ac1c8b9589a332cd64dbd93f4b197c5062a9c655c7b0f5d88b1302d8e66" || c.fingerprint_function_safe !== true || c.live_protection_sha256 !== actual.protection_schema_sha256) cellV3Fail("CELL_PARENT_DB_OPEN_HISTORICAL_SEAL_DRIFT");
    const active = ids(r[3]), association = rows(r[4]), deployment = ids(r[6]), associationIds = association.map(a => {
      if (!cellV3Exact(a, ["instance_id", "deployment_id"]) || typeof a.instance_id !== "string" || typeof a.deployment_id !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/.test(a.instance_id) || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/.test(a.deployment_id) ||
        (a.deployment_id === actual.deployment_id && a.instance_id !== actual.app_instance_id)) cellV3Fail("CELL_PARENT_DB_OPEN_ASSOCIATION_INVALID"); return `${a.instance_id}\0${a.deployment_id}`;
    });
    if (!deployment.includes(actual.deployment_id) || association.length > 10000 || new Set(associationIds).size !== associationIds.length ||
      canonicalJson(associationIds) !== canonicalJson([...associationIds].sort()) || canonicalJson(active) !== canonicalJson([...new Set(association.map(a => a.instance_id))].sort())) cellV3Fail("CELL_PARENT_DB_OPEN_WITNESS_INCOMPLETE");
    const effectiveActive = active.filter(i => association.some(a => a.instance_id === i && a.deployment_id !== actual.deployment_id));
    const counts = [effectiveActive.length, ids(r[5]).length, deployment.filter(i => i !== actual.deployment_id).length, ids(r[7]).length, ids(r[8]).length, ids(r[12]).length, ids(r[13]).length];
    const zero = counts.every(n => n === 0); if (requireZero && !zero) cellV3Fail("CELL_PARENT_DB_OPEN_NOT_ZERO");
    const observedAt = integer(e.observed_at); if (observedAt < actual.sealed_at) cellV3Fail("CELL_PARENT_DB_OPEN_CLOCK_INVALID");
    const body = { schemaVersion: 4 as const, protocol: "cell-parent-open-db-prestate-v4" as const, environmentIdentitySha256: identity.identity_sha256 as string,
      protectionSha256: this.protection, certificateSha256: await sha256Hex(actual), rawWitnessSha256: await sha256Hex({ active, association, deployment }), counts, certifiedZero: zero };
    const proof = cellV3Freeze({ ...body, stateSha256: await sha256Hex(body), observedAt }); openProofs.add(proof); return proof;
  }
  async readFailedZero(input: Parameters<NeonFailedCellBirthSourceV1["readCertifiedUnadmittedSnapshot"]>[0]) {
    let extra: unknown;
    // Keep the historical 14 genuine results and parser intact, but cover the
    // actual pending/running/retry_wait job states in the SAME transaction.
    const sql: NeonSerializableSnapshotSqlClient = { transaction: async (fn, options) => {
      const r = await this.sql.transaction(tx => [...fn(tx), tx.query(jobsSql, [env])], options);
      if (!Array.isArray(r) || r.length !== 15) cellV3Fail("CELL_PARENT_FAILED_TRANSACTION_INVALID"); extra = r[14]; return r.slice(0, 14);
    } };
    const source = new NeonFailedCellBirthSourceV1(sql, this.cert, this.protection), snapshot = await source.readCertifiedUnadmittedSnapshot(input);
    input.signal.throwIfAborted(); if (ids(extra).length) cellV3Fail("CELL_PARENT_FAILED_PENDING_JOBS_PRESENT"); failedProofs.add(snapshot); return snapshot;
  }
  async readTtlZero(predecessor: SharedCellProvisionAuthorityRecord, signal: AbortSignal) {
    let extra: unknown[] | null = null;
    const sql: NeonSerializableSnapshotSqlClient = { transaction: async (fn, options) => {
      const r = await this.sql.transaction(tx => [...fn(tx), tx.query(FAILED_BIRTH_PROTECTION_CATALOG_V1, []), tx.query(fenceSql, [env]), tx.query(jobsSql, [env]), tx.query(stepsSql, [env])], options);
      if (!Array.isArray(r) || r.length !== 13) cellV3Fail("CELL_PARENT_TTL_TRANSACTION_INVALID"); extra = r.slice(9); return r.slice(0, 9);
    } };
    const original = new NeonSealedCellOwnershipSourceV3(sql, this.cert), snapshot = await original.readCertifiedSerializableSnapshot({ accountId: "402010193138", region: "ca-central-1", cellId: "cell-sandbox-1", environmentId: env, signal });
    signal.throwIfAborted(); const x = extra as unknown[] | null;
    if (!x || one(x[0]).protection_sha256 !== this.protection || rows(x[1]).length || ids(x[2]).length || ids(x[3]).length ||
      [snapshot.activeTenantIds, snapshot.activeCapacityReservationIds, snapshot.nonterminalDeploymentIds, snapshot.liveTenantResourceIds, snapshot.nonterminalTenantCleanupScheduleIds].some(a => a.length)) cellV3Fail("CELL_PARENT_TTL_NOT_CERTIFIED_ZERO");
    const d = await compileSharedCellAdmissionDrainIntent(predecessor);
    if (snapshot.admissionFenceSha256 !== d.fenceSha256 || snapshot.admissionProvisionOperationHash !== predecessor.provisionOperationHash || snapshot.admissionStackId !== predecessor.stackId || snapshot.admissionCellExpiresAt !== Date.parse(predecessor.cellExpiresAt)) cellV3Fail("CELL_PARENT_TTL_DB_LINEAGE_DRIFT");
    const body = { schemaVersion: 4 as const, protocol: "cell-parent-certified-ttl-zero-v4" as const, predecessorRecordHash: predecessor.recordHash,
      snapshot, protectionSha256: this.protection, nonterminalJobCount: 0, nonterminalStepCount: 0 };
    const proof = cellV3Freeze({ ...body, stateSha256: await sha256Hex({ ...body, snapshot: { ...snapshot, dbObservedAt: undefined } }) }); proofs.add(proof); return proof;
  }
  async drainAndQueueOnce(predecessor: SharedCellProvisionAuthorityRecord, signal: AbortSignal): Promise<{ drain: SharedCellAdmissionDrainReceipt; jobs: unknown }> {
    const drain = await this.admissions.beginAdmissionDrain({ predecessor, signal }); signal.throwIfAborted();
    const jobs = await this.jobs.enqueueOwnedCleanupJobs({ drain, signal }); return { drain, jobs };
  }
}
export type CellParentOpenDatabaseV4 = Awaited<ReturnType<NeonCellParentDatabaseV4["readOpen"]>>;
export type CellParentTtlZeroV4 = Awaited<ReturnType<NeonCellParentDatabaseV4["readTtlZero"]>>;
export function createNeonCellParentDatabaseV4(readerUrl: string, writerUrl: string, cert: SealedPlanCertificateV1, protectionSha256: string) {
  const reader = new URL(readerUrl), writer = new URL(writerUrl);
  if (decodeURIComponent(reader.username) !== "techlong_cell_cleanup_reader" || decodeURIComponent(writer.username) !== "techlong_cell_drain" || reader.hostname !== writer.hostname || reader.pathname !== writer.pathname ||
    [reader, writer].some(u => !["postgres:", "postgresql:"].includes(u.protocol) || !u.hostname.endsWith(".neon.tech") || !u.password || (u.port && u.port !== "5432") || !["require", "verify-full"].includes(u.searchParams.get("sslmode") ?? ""))) cellV3Fail("CELL_PARENT_DB_RUNTIME_MATERIAL_INVALID");
  return new NeonCellParentDatabaseV4(neon(readerUrl, { fullResults: true }) as unknown as NeonSerializableSnapshotSqlClient,
    neon(writerUrl, { fullResults: true }) as unknown as NeonSharedCellAdmissionFenceSqlClient, cert, protectionSha256);
}
