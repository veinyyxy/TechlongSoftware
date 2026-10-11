import assert from "node:assert/strict";
import test from "node:test";
import { runNeonSealedProbeV1, validateNeonProbeResponseV1, NEON_SEALED_PROBE_FUNCTION_ARN_V1, NEON_SEALED_PROBE_ACTION_V1, type NeonSealedDatabaseProofV1 } from "../lib/deployments/execution/readonly-neon-sealed-probe-v1.ts";
import { verifyNeonSealedProbeRowsV1, guardedNeonSealedProbeFetchV1, NEON_SEALED_PROBE_QUERIES_V1, readNeonSealedProbeDatabaseV1 } from "../lib/deployments/execution/readonly-neon-sealed-transport-v1.ts";
import { registeredSealedCertificateV1 as registered } from "./fixtures/registered-sealed-certificate-v1.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { sealedEvidenceFixture } from "./fixtures/sealed-cell-ownership-v3.ts";
import { READONLY_RUNTIME_IAM_TARGETS_V1 } from "../lib/deployments/execution/readonly-runtime-iam-v1.ts";
const event = { schemaVersion: 1, action: NEON_SEALED_PROBE_ACTION_V1, nonce: "a".repeat(64) };
const context = { functionName: READONLY_RUNTIME_IAM_TARGETS_V1[0].functionName, invokedFunctionArn: NEON_SEALED_PROBE_FUNCTION_ARN_V1, awsRequestId: "12345678-1234-1234-1234-123456789012" };
const signal = () => new AbortController().signal;
const proof: NeonSealedDatabaseProofV1 = { tlsReadVerified: true, transactionSettingsVerified: true, limitedReaderVerified: true, sealedCertificateVerified: true, queryCount: 10,
  sourceGate: "ADMISSION_NOT_DRAINING", counts: { rawActiveTenants: 1, rawNonterminalDeployments: 1, capacityReservations: 0, liveResources: 0, cleanupSchedules: 0 } };
function ports() { let reads = 0; const logs: string[] = []; return { reads: () => reads, logs, port: {
  identity: async () => ({ Account: "402010193138", Arn: "arn:aws:sts::402010193138:assumed-role/TechlongSandboxCellTtlExecutorRole/session" }),
  secret: async () => ({ ARN: READONLY_RUNTIME_IAM_TARGETS_V1[0].secretArn, VersionId: READONLY_RUNTIME_IAM_TARGETS_V1[0].secretVersionId, VersionStages: ["AWSCURRENT"], SecretString: "password-MUST-NOT-LEAK" }),
  read: async () => { reads++; return proof; }, log: (v: string) => logs.push(v),
} }; }
test("malformed event and wrong context reject before looking up any credential", async () => {
  const f = ports(); await assert.rejects(runNeonSealedProbeV1({ ...event, delete: true }, context, signal(), f.port), /NEON_PROBE_EVENT_INVALID/);
  await assert.rejects(runNeonSealedProbeV1(event, { ...context, invokedFunctionArn: context.invokedFunctionArn + ":1" }, signal(), f.port), /NEON_PROBE_CONTEXT_INVALID/); assert.equal(f.logs.length, 0);
});
test("bad Secret never connects and errors/logs cannot expose its raw payload", async () => {
  const f = ports(), r = await runNeonSealedProbeV1(event, context, signal(), f.port);
  assert.equal(r.stage, "secret"); assert.equal(r.databaseReadAttempted, false); assert.equal(f.reads(), 0);
  assert.ok(!JSON.stringify([r, ...f.logs]).includes("MUST-NOT-LEAK")); assert.deepEqual(validateNeonProbeResponseV1(event, r), r);
});
test("identity mismatch stops before Secret/database", async () => {
  const f = ports(); f.port.identity = async () => ({ Account: "000000000000", Arn: "not-allowed" });
  const r = await runNeonSealedProbeV1(event, context, signal(), f.port); assert.equal(r.stage, "identity"); assert.equal(f.reads(), 0);
});
test("closed response schema rejects extra secret fields, gate fabrication and unsafe error text", () => {
  const response = { schemaVersion: 1, protocol: "neon-sealed-readonly-probe-v1", functionArn: context.invokedFunctionArn, nonce: event.nonce, requestId: context.awsRequestId,
    outcome: "NEON_SEALED_READONLY_PREFLIGHT_VERIFIED", stage: "verified", errorCode: null, databaseReadAttempted: true, proof, runtimeEnabled: false, mutationPerformed: false, deletionAuthorized: false };
  assert.deepEqual(validateNeonProbeResponseV1(event, response), response);
  for (const value of [{ ...response, databaseUrl: "secret" }, { ...response, runtimeEnabled: true }, { ...response, proof: { ...proof, sourceGate: "READY_TO_DELETE" } }, { ...response, outcome: "NEON_SEALED_READONLY_PREFLIGHT_NOT_VERIFIED", errorCode: "password", proof: null }]) assert.throws(() => validateNeonProbeResponseV1(event, value));
});
async function databaseFixture() { const f = await sealedEvidenceFixture(); const results = f.results.map(r => ({ ...r, command: "SELECT" })); results.splice(1, 0, { command: "SELECT", rows: [{ read_only: "on", isolation: "serializable", deferrable: "on" }] }); return { ...f, results }; }
test("exact live rows certify read-only transport and closed admission is not a deletion proof", async () => {
  const f = await databaseFixture(); f.results[2].rows[0].admission_state = "open";
  const p = await verifyNeonSealedProbeRowsV1(f.results, f.cert, "ADMISSION_NOT_DRAINING"); assert.equal(p.sourceGate, "ADMISSION_NOT_DRAINING"); assert.equal(p.counts.rawNonterminalDeployments, 1);
  assert.ok(!JSON.stringify(p).includes(f.cert.deployment_id));
});
test("read-only flags must be observed from PostgreSQL, not merely requested by the driver", async () => {
  const f = await databaseFixture(); f.results[1].rows[0].read_only = "off";
  await assert.rejects(verifyNeonSealedProbeRowsV1(f.results, f.cert, "CERTIFIED_V3_SNAPSHOT"), /NEON_PROBE_TRANSACTION_NOT_READONLY/);
});
test("certificate, live original/catalog and limited-reader mismatches all fail closed", async () => {
  for (const change of [(r: Awaited<ReturnType<typeof databaseFixture>>["results"]) => { r[3].rows[0].live_protection_sha256 = "0".repeat(64); },
    (r: Awaited<ReturnType<typeof databaseFixture>>["results"]) => { r[2].rows[0].no_owner_or_table_write = false; },
    (r: Awaited<ReturnType<typeof databaseFixture>>["results"]) => { r[3].rows[0].fence_sealed = false; },
    (r: Awaited<ReturnType<typeof databaseFixture>>["results"]) => { r[5].rows.length = 0; }]) {
    const f = await databaseFixture(); change(f.results); await assert.rejects(verifyNeonSealedProbeRowsV1(f.results, f.cert, "CERTIFIED_V3_SNAPSHOT"));
  }
});
test("fixed batch contains only ten SELECTs; no SQL caller input or unlocked read modes", async () => {
  assert.equal(NEON_SEALED_PROBE_QUERIES_V1.length, 10); assert.ok(NEON_SEALED_PROBE_QUERIES_V1.every(q => /^SELECT /.test(q.query)));
  await assert.rejects(guardedNeonSealedProbeFetchV1("https://untrusted.invalid/sql", { method: "POST", body: "{}" }), /NEON_PROBE_TRANSPORT_REJECTED/);
});
test("actual Neon HTTP driver sends exactly one fixed TLS readonly batch and never certifies open admission", async () => {
  const f = await sealedEvidenceFixture(registered), results = f.results.map(r => ({ ...r, command: "SELECT" }));
  results[1].rows[0].admission_state = "open";
  results.splice(1, 0, { command: "SELECT", rows: [{ read_only: "on", isolation: "serializable", deferrable: "on" }] });
  const wire = results.map(r => { const keys = Object.keys(r.rows[0] ?? {}); return { command: "SELECT", rowCount: r.rows.length,
    fields: keys.map(name => ({ name, dataTypeID: typeof r.rows[0][name] === "boolean" ? 16 : 25 })),
    rows: r.rows.map(row => keys.map(k => typeof row[k] === "boolean" ? (row[k] ? "t" : "f") : String(row[k]))) }; });
  let fetches = 0; const originalFetch = globalThis.fetch;
  try { globalThis.fetch = async (url, init) => { fetches++; assert.equal(String(url), "https://api.us-east-1.aws.neon.tech/sql"); assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("Neon-Batch-Read-Only"), "true"); return new Response(JSON.stringify({ results: wire }), { status: 200 }); };
    const p = await readNeonSealedProbeDatabaseV1("postgresql://techlong_cell_cleanup_reader:TEST_ONLY@ep-test.us-east-1.aws.neon.tech/neondb?sslmode=require", registered, signal());
    assert.equal(p.sourceGate, "ADMISSION_NOT_DRAINING"); assert.equal(fetches, 1);
  } finally { globalThis.fetch = originalFetch; }
});
test("fixed Secret payload reaches only the reader port and produces a closed successful marker", async () => {
  const f = ports(), t = READONLY_RUNTIME_IAM_TARGETS_V1[0], certificateSha256 = await sha256Hex(registered);
  f.port.secret = async () => ({ ARN: t.secretArn, VersionId: t.secretVersionId, VersionStages: ["AWSCURRENT"], SecretString: JSON.stringify({
    schemaVersion: 3, protocol: "sealed-cell-cleanup-control-v3", certificateSha256, expectedRegisteredCertificate: registered,
    databaseUrl: "postgresql://techlong_cell_cleanup_reader:TEST_ONLY@ep-test.us-east-1.aws.neon.tech/neondb?sslmode=require" }) });
  const r = await runNeonSealedProbeV1(event, context, signal(), f.port); assert.equal(r.outcome, "NEON_SEALED_READONLY_PREFLIGHT_VERIFIED");
  assert.equal(f.reads(), 1); assert.ok(!JSON.stringify([r, f.logs]).includes("TEST_ONLY")); assert.deepEqual(validateNeonProbeResponseV1(event, r), r);
});
