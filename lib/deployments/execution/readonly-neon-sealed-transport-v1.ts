import { AsyncLocalStorage } from "node:async_hooks";
import { neon, neonConfig } from "@neondatabase/serverless";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { NeonSealedCellOwnershipSourceV3, SEALED_CELL_OWNERSHIP_SQL_V3, type SealedPlanCertificateV1 } from "./neon-sealed-cell-ownership-source-v3.ts";
import type { NeonSerializableSnapshotSqlClient } from "./neon-shared-cell-zero-tenant-source.ts";
import type { NeonSealedDatabaseProofV1 } from "./readonly-neon-sealed-probe-v1.ts";

const environment = "env_aws_sandbox_ca_central_1", bodySha = "16e82ac1c8b9589a332cd64dbd93f4b197c5062a9c655c7b0f5d88b1302d8e66";
const settingsSql = "SELECT current_setting('transaction_read_only') AS read_only,current_setting('transaction_isolation') AS isolation,current_setting('transaction_deferrable') AS deferrable";
const sourceStatements = Object.entries(SEALED_CELL_OWNERSHIP_SQL_V3).map(([kind, query]) => ({ query, params: kind === "searchPath" ? [] : [environment] }));
export const NEON_SEALED_PROBE_QUERIES_V1 = Object.freeze([sourceStatements[0], { query: settingsSql, params: [] }, ...sourceStatements.slice(1)]);
function fail(code: string): never { throw new Error(code); }
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function rows(value: unknown): Record<string, unknown>[] {
  const r = value as { rows?: unknown; command?: string };
  if (r?.command !== "SELECT" || !Array.isArray(r.rows) || r.rows.length > 10000 || r.rows.some(x => x === null || typeof x !== "object" || Array.isArray(x))) fail("NEON_PROBE_ROWS_INVALID");
  return r.rows as Record<string, unknown>[];
}
function integer(value: unknown): number { const n = typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(n) || (n as number) < 0) fail("NEON_PROBE_INTEGER_INVALID"); return n as number; }
function ids(value: unknown) { const result = rows(value).map(r => { if (!equal(Object.keys(r), ["id"]) || typeof r.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/.test(r.id)) fail("NEON_PROBE_IDS_INVALID"); return r.id; });
  if (new Set(result).size !== result.length || !equal(result, [...result].sort())) fail("NEON_PROBE_IDS_INVALID"); return result; }
export async function verifyNeonSealedProbeRowsV1(results: unknown[], expected: SealedPlanCertificateV1, sourceGate: NeonSealedDatabaseProofV1["sourceGate"]): Promise<NeonSealedDatabaseProofV1> {
  if (!Array.isArray(results) || results.length !== 10) fail("NEON_PROBE_RESULT_COUNT_INVALID");
  const setting = rows(results[1]); if (!equal(setting, [{ read_only: "on", isolation: "serializable", deferrable: "on" }])) fail("NEON_PROBE_TRANSACTION_NOT_READONLY");
  if (!equal(rows(results[0]), [{ search_path: "pg_catalog", row_security: "off" }])) fail("NEON_PROBE_SETTINGS_INVALID");
  const envRows = rows(results[2]), certRows = rows(results[3]); if (envRows.length !== 1 || certRows.length !== 1) fail("NEON_PROBE_ORIGINAL_NOT_VISIBLE");
  const e = envRows[0], r = certRows[0];
  if (e.environment_id !== environment || e.account_id !== "402010193138" || e.region !== "ca-central-1" || e.cell_key !== "cell-sandbox-1" ||
    e.reader_role !== "techlong_cell_cleanup_reader" || e.limited_reader !== true || e.no_owner_or_table_write !== true ||
    !["open", "draining"].includes(String(e.admission_state)) || integer(e.observed_at) < expected.sealed_at ||
    (sourceGate === "ADMISSION_NOT_DRAINING" && e.admission_state !== "open") || (sourceGate === "CERTIFIED_V3_SNAPSHOT" && e.admission_state !== "draining")) fail("NEON_PROBE_READER_OR_GATE_INVALID");
  const certificate = Object.fromEntries(Object.keys(expected).map(k => [k, k === "sealed_at" ? integer(r[k]) : r[k]]));
  if (!equal(certificate, expected) || r.fence_sealed !== true || integer(r.fence_sealed_at) !== expected.sealed_at || integer(r.fence_revision) < 1 ||
    r.live_row_sha256 !== expected.original_row_sha256 || r.live_plan_bytes_sha256 !== expected.original_plan_bytes_sha256 || r.live_plan_hash !== expected.original_plan_hash ||
    r.fingerprint_body_sha256 !== bodySha || r.fingerprint_function_safe !== true || r.live_protection_sha256 !== expected.protection_schema_sha256) fail("NEON_PROBE_SEALED_ORIGINAL_MISMATCH");
  const active = ids(results[4]), associations = rows(results[5]);
  const associationKeys = associations.map(a => { if (!equal(Object.keys(a).sort(), ["deployment_id", "instance_id"]) || typeof a.instance_id !== "string" || typeof a.deployment_id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/.test(a.instance_id) || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/.test(a.deployment_id) ||
    (a.deployment_id === expected.deployment_id && a.instance_id !== expected.app_instance_id)) fail("NEON_PROBE_ASSOCIATIONS_INVALID"); return `${a.instance_id}\u0000${a.deployment_id}`; });
  if (new Set(associationKeys).size !== associationKeys.length || !equal(associationKeys, [...associationKeys].sort()) || !equal([...new Set(associations.map(a => a.instance_id))].sort(), active)) fail("NEON_PROBE_ASSOCIATIONS_INVALID");
  const capacity = ids(results[6]), deployments = ids(results[7]), resources = ids(results[8]), schedules = ids(results[9]);
  if (!deployments.includes(expected.deployment_id)) fail("NEON_PROBE_ORIGINAL_NOT_VISIBLE");
  return { tlsReadVerified: true, transactionSettingsVerified: true, limitedReaderVerified: true, sealedCertificateVerified: true, queryCount: 10, sourceGate,
    counts: { rawActiveTenants: active.length, rawNonterminalDeployments: deployments.length, capacityReservations: capacity.length, liveResources: resources.length, cleanupSchedules: schedules.length } };
}
type Lease = { databaseUrl: string; endpoint: string; signal: AbortSignal; calls: number };
const leases = new AsyncLocalStorage<Lease>();
// Dedicated probe bundle: this guard is the only Neon fetch path. Per-invocation lease avoids shared credentials.
export async function guardedNeonSealedProbeFetchV1(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const l = leases.getStore(); if (!l || l.calls !== 0 || String(input) !== l.endpoint || init?.method !== "POST" || typeof init.body !== "string") fail("NEON_PROBE_TRANSPORT_REJECTED");
  const headers = new Headers(init.headers);
  if (headers.get("Neon-Connection-String") !== l.databaseUrl || headers.get("Neon-Batch-Read-Only") !== "true" || headers.get("Neon-Batch-Isolation-Level") !== "Serializable" ||
    headers.get("Neon-Batch-Deferrable") !== "true" || headers.has("Authorization") || !equal(JSON.parse(init.body), { queries: NEON_SEALED_PROBE_QUERIES_V1 })) fail("NEON_PROBE_TRANSPORT_REJECTED");
  l.signal.throwIfAborted(); l.calls++;
  const response = await fetch(l.endpoint, { method: "POST", headers, body: init.body, signal: l.signal, redirect: "error" });
  const reader = response.body?.getReader(); if (!reader) fail("NEON_PROBE_TRANSPORT_REJECTED");
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 8_000_000) { await reader.cancel(); fail("NEON_PROBE_RESPONSE_TOO_LARGE"); } chunks.push(chunk.value); }
  const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  // Raw provider payload lives only in RAM. No debug/error/body/URL logging, fallback or retry.
  return new Response(bytes, { status: response.status, headers: { "Content-Type": "application/json" } });
}
neonConfig.fetchEndpoint = (host: string) => `https://${host.replace(/^[^.]+\./, "api.")}/sql`;
neonConfig.fetchFunction = guardedNeonSealedProbeFetchV1;
export async function readNeonSealedProbeDatabaseV1(databaseUrl: string, expected: SealedPlanCertificateV1, signal: AbortSignal) {
  const host = new URL(databaseUrl).hostname;
  if (!/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(host) || await sha256Hex(expected) !== "dc093614188a8f0a086b4fc6a7e251c43312495a60db2efffc654cf3d48b066f") fail("NEON_PROBE_TRANSPORT_REJECTED");
  return leases.run({ databaseUrl, endpoint: `https://${host.replace(/^[^.]+\./, "api.")}/sql`, signal, calls: 0 }, async () => {
    const sql = neon(databaseUrl, { fullResults: true }); let captured: unknown[] | null = null;
    const port: NeonSerializableSnapshotSqlClient = { async transaction(build, options) {
      // Assert production source still builds its exact nine queries and guarded read-only options.
      const requested: { query: string; params: unknown[] }[] = [];
      build({ query: (query, params = []) => { requested.push({ query, params }); return {}; } });
      if (!equal(requested, sourceStatements) || options.isolationLevel !== "Serializable" || options.readOnly !== true || options.deferrable !== true || options.fullResults !== true) fail("NEON_PROBE_SOURCE_PROTOCOL_DRIFT");
      captured = await sql.transaction(tx => NEON_SEALED_PROBE_QUERIES_V1.map(q => tx.query(q.query, q.params)), options);
      if (captured.length !== 10) fail("NEON_PROBE_RESULT_COUNT_INVALID"); return [captured[0], ...captured.slice(2)];
    } };
    const source = new NeonSealedCellOwnershipSourceV3(port, expected); let sourceGate: NeonSealedDatabaseProofV1["sourceGate"] = "CERTIFIED_V3_SNAPSHOT";
    try { await source.readCertifiedSerializableSnapshot({ accountId: "402010193138", region: "ca-central-1", cellId: "cell-sandbox-1", environmentId: environment, signal }); }
    catch (error) {
      const e = error as { code?: string };
      if (e.code !== "SEALED_SOURCE_ENVIRONMENT_OR_READER_INVALID" || !captured || rows(captured[2])[0]?.admission_state !== "open") fail("NEON_PROBE_SOURCE_OR_QUERY_UNVERIFIED");
      sourceGate = "ADMISSION_NOT_DRAINING";
    }
    if (!captured || leases.getStore()?.calls !== 1) fail("NEON_PROBE_TRANSPORT_REJECTED");
    return verifyNeonSealedProbeRowsV1(captured, expected, sourceGate);
  });
}
