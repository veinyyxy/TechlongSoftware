import { canonicalJson, sha256Hex } from "./hash.ts";
import { cellV3Exact, cellV3Fail, cellV3Freeze } from "../cloudformation/shared-cell-stack-v3.ts";
import { decodeFailedCellBirthFenceV1, type FailedCellBirthFenceIntentV1 } from "./failed-cell-birth-fence-v1.ts";
import { SEALED_CELL_OWNERSHIP_SQL_V3, type SealedPlanCertificateV1 } from "./neon-sealed-cell-ownership-source-v3.ts";
import { validateSealedCertificateV3 } from "./sealed-cell-cleanup-authority-v3.ts";
import type { NeonSerializableSnapshotSqlClient } from "./neon-shared-cell-zero-tenant-source.ts";
import { neon } from "@neondatabase/serverless";
import { NeonFailedCellBirthFenceWriterV1, type FailedCellBirthFenceSqlV1 } from "./failed-cell-birth-fence-v1.ts";
import { REGISTERED_SEALED_CERTIFICATE_SHA256_V3 } from "./sealed-cell-cleanup-lambda-context-v3.ts";

// The environment is deliberately outside the historical sealed catalog. New
// protection is independently fingerprinted, never substituted into old certs.
export const FAILED_BIRTH_PROTECTION_CATALOG_V1 = `WITH tables AS (
 SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',c.relname,'owner',c.relowner::pg_catalog.regrole::text,
 'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
 'columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
 'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',k.conname,'definition',pg_catalog.pg_get_constraintdef(k.oid)) ORDER BY k.conname)
 FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid),
 'indexes',(SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_indexdef(i.indexrelid) ORDER BY pg_catalog.pg_get_indexdef(i.indexrelid)) FROM pg_catalog.pg_index i WHERE i.indrelid=c.oid),
 'triggers',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_catalog.pg_get_triggerdef(t.oid),
 'function',pg_catalog.pg_get_functiondef(t.tgfoid),'owner',p.proowner::pg_catalog.regrole::text) ORDER BY t.tgname)
 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)) ORDER BY c.relname) AS value
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
 AND c.relname IN ('deployment_environments','deployment_failed_cell_birth_fences_v1')
),functions AS (
 SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',p.proname,'definition',pg_catalog.pg_get_functiondef(p.oid),'owner',p.proowner::pg_catalog.regrole::text) ORDER BY p.proname) AS value
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND p.proname IN ('enforce_deployment_environment_admission_transition','reject_failed_cell_birth_fence_mutation_v1','guard_failed_cell_birth_environment_v1','begin_failed_cell_birth_fence_v1')
) SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object('tables',tables.value,'functions',functions.value)::text,'UTF8')),'hex') AS protection_sha256 FROM tables,functions`;
export const FAILED_BIRTH_ENVIRONMENT_IDENTITY_V1 = `SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
 'id',e.id,'key',e.key,'name',e.name,'kind',e.kind,'driver',e.driver,'expected_account_id',e.expected_account_id,'region',e.region,'cell_key',e.cell_key,
 'base_domain',e.base_domain,'apply_enabled',e.apply_enabled,'policy',e.policy,'status',e.status,'created_at',e.created_at,'updated_at',e.updated_at)::text,'UTF8')),'hex') AS identity_sha256
 FROM public.deployment_environments e WHERE e.id=$1`;
const extraSql = Object.freeze({
 fence: "SELECT environment_id,fence_json,fence_sha256,created_at FROM public.deployment_failed_cell_birth_fences_v1 WHERE environment_id=$1",
 identity: FAILED_BIRTH_ENVIRONMENT_IDENTITY_V1,
 catalog: FAILED_BIRTH_PROTECTION_CATALOG_V1,
 jobs: "SELECT j.id FROM public.deployment_jobs j JOIN public.app_instance_deployments d ON d.id=j.deployment_id WHERE d.environment_id=$1 AND j.status IN ('queued','running') ORDER BY j.id",
 steps: "SELECT s.id FROM public.deployment_step_runs s JOIN public.app_instance_deployments d ON d.id=s.deployment_id WHERE d.environment_id=$1 AND s.status IN ('pending','running') ORDER BY s.id",
});
const proofs = new WeakSet<object>(), digest = /^[a-f0-9]{64}$/, id = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/;
const certFields = ["deployment_id", "environment_id", "app_instance_id", "original_row_sha256", "original_plan_bytes_sha256", "original_plan_hash", "business_state_sha256", "approved_registration_sha256", "protection_schema_sha256", "sealed_at"];
function rows(raw: unknown): Record<string, unknown>[] { const r = (raw as { rows?: unknown })?.rows; if (!Array.isArray(r) || r.some(x => !x || typeof x !== "object" || Array.isArray(x))) cellV3Fail("FAILED_BIRTH_SOURCE_ROWS_INVALID"); return r; }
function one(raw: unknown) { const r = rows(raw); if (r.length !== 1) cellV3Fail("FAILED_BIRTH_SOURCE_SINGLE_ROW_REQUIRED"); return r[0]; }
function integer(raw: unknown) { const n = typeof raw === "number" ? raw : typeof raw === "string" && /^(0|[1-9][0-9]*)$/.test(raw) ? Number(raw) : NaN; if (!Number.isSafeInteger(n) || n < 0) cellV3Fail("FAILED_BIRTH_SOURCE_CLOCK_INVALID"); return n; }
function ids(raw: unknown) { const r = rows(raw); if (r.length > 10000 || r.some(x => !cellV3Exact(x, ["id"]) || typeof x.id !== "string" || !id.test(x.id))) cellV3Fail("FAILED_BIRTH_SOURCE_IDS_INVALID");
  const values = r.map(x => x.id as string); if (new Set(values).size !== values.length || canonicalJson(values) !== canonicalJson([...values].sort())) cellV3Fail("FAILED_BIRTH_SOURCE_IDS_INVALID"); return values; }

/** Independent failed/unadmitted protocol. It NEVER manufactures successful
 * provision, due/draining, old v3 ownership or cloud deletion authority. */
export class NeonFailedCellBirthSourceV1 {
  private readonly sql: NeonSerializableSnapshotSqlClient; private readonly certificate: Readonly<SealedPlanCertificateV1>; private readonly protectionSha256: string;
  constructor(sql: NeonSerializableSnapshotSqlClient, expectedCertificate: SealedPlanCertificateV1, approvedProtectionSha256: string) {
    if (typeof sql?.transaction !== "function" || !digest.test(approvedProtectionSha256)) cellV3Fail("FAILED_BIRTH_SOURCE_CAPABILITIES_INVALID");
    this.sql = Object.freeze({ transaction: sql.transaction.bind(sql) }); this.certificate = validateSealedCertificateV3(expectedCertificate); this.protectionSha256 = approvedProtectionSha256;
  }
  async readCertifiedUnadmittedSnapshot(input: { intent: FailedCellBirthFenceIntentV1; fenceSha256: string; signal: AbortSignal }) {
    if (!cellV3Exact(input, ["intent", "fenceSha256", "signal"])) cellV3Fail("FAILED_BIRTH_SOURCE_INPUT_INVALID");
    const intent = await decodeFailedCellBirthFenceV1(input.intent, input.fenceSha256); input.signal.throwIfAborted();
    let result: unknown[];
    try { result = await this.sql.transaction(tx => [
      ...Object.entries(SEALED_CELL_OWNERSHIP_SQL_V3).map(([kind, sql]) => tx.query(sql, kind === "searchPath" ? [] : [intent.environmentId])),
      ...Object.entries(extraSql).map(([kind, sql]) => tx.query(sql, kind === "catalog" ? [] : [intent.environmentId])),
    ], { isolationLevel: "Serializable", readOnly: true, deferrable: true, fullResults: true, fetchOptions: { signal: input.signal } }); }
    catch { input.signal.throwIfAborted(); return cellV3Fail("FAILED_BIRTH_SOURCE_READ_FAILED"); }
    input.signal.throwIfAborted(); if (!Array.isArray(result) || result.length !== 14) cellV3Fail("FAILED_BIRTH_SOURCE_TRANSACTION_INVALID");
    const setting = one(result[0]), e = one(result[1]), c = one(result[2]), f = one(result[9]), identity = one(result[10]), catalog = one(result[11]);
    if (!cellV3Exact(setting, ["search_path", "row_security"]) || setting.search_path !== "pg_catalog" || setting.row_security !== "off" ||
      !cellV3Exact(identity, ["identity_sha256"]) || identity.identity_sha256 !== intent.environmentIdentitySha256 ||
      !cellV3Exact(catalog, ["protection_sha256"]) || catalog.protection_sha256 !== this.protectionSha256) cellV3Fail("FAILED_BIRTH_SOURCE_PROTECTION_CHANGED");
    if (!cellV3Exact(e, ["environment_id", "account_id", "region", "cell_key", "admission_state", "admission_epoch", "admission_fence_sha256", "admission_provision_operation_hash", "admission_stack_id", "admission_cell_expires_at", "admission_changed_at", "observed_at", "reader_role", "limited_reader", "no_owner_or_table_write"]) ||
      e.environment_id !== intent.environmentId || e.account_id !== intent.accountId || e.region !== intent.region || e.cell_key !== intent.cellId ||
      e.reader_role !== "techlong_cell_cleanup_reader" || e.limited_reader !== true || e.no_owner_or_table_write !== true || e.admission_state !== "failed_unadmitted" ||
      integer(e.admission_epoch) !== 1 || e.admission_fence_sha256 !== input.fenceSha256 || e.admission_provision_operation_hash !== null || e.admission_stack_id !== intent.stackId ||
      integer(e.admission_cell_expires_at) !== intent.cellExpiresAt) cellV3Fail("FAILED_BIRTH_SOURCE_ENVIRONMENT_OR_ROLE_INVALID");
    const observedAt = integer(e.observed_at), changedAt = integer(e.admission_changed_at);
    if (changedAt < 1 || observedAt < changedAt || observedAt < this.certificate.sealed_at || !cellV3Exact(f, ["environment_id", "fence_json", "fence_sha256", "created_at"]) ||
      f.environment_id !== intent.environmentId || f.fence_sha256 !== input.fenceSha256 || f.fence_json !== canonicalJson(intent) || integer(f.created_at) !== changedAt) cellV3Fail("FAILED_BIRTH_SOURCE_EXACT_FENCE_REQUIRED");
    if (!cellV3Exact(c, [...certFields, "fence_sealed", "fence_sealed_at", "fence_revision", "live_row_sha256", "live_plan_bytes_sha256", "live_plan_hash", "fingerprint_body_sha256", "fingerprint_function_safe", "live_protection_sha256"])) cellV3Fail("FAILED_BIRTH_SOURCE_CERTIFICATE_FIELDS_INVALID");
    const certificate = validateSealedCertificateV3({ ...Object.fromEntries(certFields.map(k => [k, c[k]])), sealed_at: integer(c.sealed_at) });
    if (canonicalJson(certificate) !== canonicalJson(this.certificate) || c.fence_sealed !== true || integer(c.fence_sealed_at) !== certificate.sealed_at || integer(c.fence_revision) < 1 ||
      c.live_row_sha256 !== certificate.original_row_sha256 || c.live_plan_bytes_sha256 !== certificate.original_plan_bytes_sha256 || c.live_plan_hash !== certificate.original_plan_hash ||
      c.fingerprint_body_sha256 !== "16e82ac1c8b9589a332cd64dbd93f4b197c5062a9c655c7b0f5d88b1302d8e66" || c.fingerprint_function_safe !== true || c.live_protection_sha256 !== certificate.protection_schema_sha256)
      cellV3Fail("FAILED_BIRTH_SOURCE_HISTORICAL_SEAL_CHANGED");
    const rawActive = ids(result[3]), associations = rows(result[4]), associationKeys = associations.map(a => {
      if (!cellV3Exact(a, ["instance_id", "deployment_id"]) || typeof a.instance_id !== "string" || !id.test(a.instance_id) || typeof a.deployment_id !== "string" || !id.test(a.deployment_id)) cellV3Fail("FAILED_BIRTH_SOURCE_ASSOCIATION_INVALID");
      if (a.deployment_id === certificate.deployment_id && a.instance_id !== certificate.app_instance_id) cellV3Fail("FAILED_BIRTH_SOURCE_ASSOCIATION_INVALID"); return `${a.instance_id}\0${a.deployment_id}`;
    });
    if (associationKeys.length > 10000 || new Set(associationKeys).size !== associationKeys.length || canonicalJson(associationKeys) !== canonicalJson([...associationKeys].sort()) ||
      canonicalJson(rawActive) !== canonicalJson([...new Set(associations.map(a => a.instance_id))].sort())) cellV3Fail("FAILED_BIRTH_SOURCE_ASSOCIATIONS_INCOMPLETE");
    const rawDeployments = ids(result[6]); if (!rawDeployments.includes(certificate.deployment_id)) cellV3Fail("FAILED_BIRTH_SOURCE_ORIGINAL_NOT_VISIBLE");
    const active = rawActive.filter(i => associations.some(a => a.instance_id === i && a.deployment_id !== certificate.deployment_id));
    const capacity = ids(result[5]), deployments = rawDeployments.filter(x => x !== certificate.deployment_id), resources = ids(result[7]), schedules = ids(result[8]), jobs = ids(result[12]), steps = ids(result[13]);
    if ([active, capacity, deployments, resources, schedules, jobs, steps].some(x => x.length)) cellV3Fail("FAILED_BIRTH_SOURCE_NOT_ZERO");
    const state = { schemaVersion: 1 as const, protocol: "certified-failed-cell-birth-unadmitted-zero-v1" as const, intent, fenceSha256: input.fenceSha256,
      protectionSha256: this.protectionSha256, certificate, admissionState: "failed_unadmitted" as const, admissionEpoch: 1, changedAt,
      activeTenantIds: active, capacityIds: capacity, nonterminalDeploymentIds: deployments, liveResourceIds: resources, nonterminalScheduleIds: schedules,
      nonterminalJobIds: jobs, nonterminalStepIds: steps, rawWitness: { activeTenantIds: rawActive, deploymentIds: rawDeployments, associations } };
    const snapshot = cellV3Freeze({ ...state, stateSha256: await sha256Hex(state), dbObservedAt: observedAt, isolationLevel: "Serializable" as const,
      readOnly: true as const, deferrable: true as const, runtimeActivationAuthorized: false as const, cloudDeletionAuthorized: false as const }); proofs.add(snapshot); return snapshot;
  }
}
export type CertifiedFailedCellBirthSnapshotV1 = Awaited<ReturnType<NeonFailedCellBirthSourceV1["readCertifiedUnadmittedSnapshot"]>>;
export function assertCertifiedFailedCellBirthSnapshotV1(value: CertifiedFailedCellBirthSnapshotV1, now: number) {
  if (!proofs.has(value)) cellV3Fail("FAILED_BIRTH_SOURCE_PROVENANCE_REQUIRED");
  if (!Number.isSafeInteger(now) || now <= 0 || value.dbObservedAt > now || now - value.dbObservedAt > 30000) cellV3Fail("FAILED_BIRTH_SOURCE_EVIDENCE_STALE");
}

/** Real Neon runtime adapters from already reviewed IN-MEMORY control material.
 * Construction is inert. No env lookup, password creation, AWS Secret read,
 * schema install, approval issuance or cloud DeleteStack capability. */
export async function createNeonFailedCellBirthControlV1(input: { readerDatabaseUrl: string; writerDatabaseUrl?: string;
  expectedRegisteredCertificate: SealedPlanCertificateV1; approvedProtectionSha256: string }) {
  if (!cellV3Exact(input, input.writerDatabaseUrl === undefined ? ["readerDatabaseUrl", "expectedRegisteredCertificate", "approvedProtectionSha256"] :
    ["readerDatabaseUrl", "writerDatabaseUrl", "expectedRegisteredCertificate", "approvedProtectionSha256"]) || !digest.test(input.approvedProtectionSha256) ||
    await sha256Hex(validateSealedCertificateV3(input.expectedRegisteredCertificate)) !== REGISTERED_SEALED_CERTIFICATE_SHA256_V3) cellV3Fail("FAILED_BIRTH_CONTROL_BINDING_INVALID");
  const url = (raw: string, user: string) => { try { const v = new URL(raw);
    if (raw.length > 4096 || !["postgres:", "postgresql:"].includes(v.protocol) || !v.hostname.endsWith(".neon.tech") ||
      decodeURIComponent(v.username) !== user || !v.password || (v.port && v.port !== "5432") || v.pathname.length < 2 ||
      !["require", "verify-full"].includes(v.searchParams.get("sslmode") ?? "")) throw Error(); return v;
    } catch { return cellV3Fail("FAILED_BIRTH_CONTROL_ENDPOINT_INVALID"); } };
  const reader = url(input.readerDatabaseUrl, "techlong_cell_cleanup_reader");
  if (input.writerDatabaseUrl !== undefined) { const writer = url(input.writerDatabaseUrl, "techlong_cell_drain");
    if (reader.hostname !== writer.hostname || reader.pathname !== writer.pathname) cellV3Fail("FAILED_BIRTH_CONTROL_ENDPOINT_MISMATCH"); }
  const source = new NeonFailedCellBirthSourceV1(neon(input.readerDatabaseUrl, { fullResults: true }) as unknown as NeonSerializableSnapshotSqlClient,
    input.expectedRegisteredCertificate, input.approvedProtectionSha256);
  const writer = input.writerDatabaseUrl === undefined ? null : new NeonFailedCellBirthFenceWriterV1(neon(input.writerDatabaseUrl, { fullResults: true }) as unknown as FailedCellBirthFenceSqlV1);
  return Object.freeze({ source, writer, installationAuthorized: false, cloudDeletionAuthorized: false, cloudRuntimeInstalled: false });
}
