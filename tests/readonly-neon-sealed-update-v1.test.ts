import assert from "node:assert/strict";
import test from "node:test";
import { compileNeonSealedUpdateManifestV1, runNeonSealedUpdateV1, type NeonSealedUpdateInventoryV1, type NeonSealedUpdatePortsV1 } from "../lib/deployments/execution/readonly-neon-sealed-update-v1.ts";
const now = Date.parse("2026-10-11T16:00:00Z"), code = "c".repeat(64), oldRevision = "12345678-1234-1234-1234-123456789012", newRevision = "12345678-1234-1234-1234-123456789013";
const inventory = (candidate = false): NeonSealedUpdateInventoryV1 => ({ observedAt: now, stableAnchorSha256: "a".repeat(64), state: candidate ? "CANDIDATE_READY" : "OLD_READY", revisionId: candidate ? newRevision : oldRevision, sourcePermissionsAllowed: true });
async function fixture() {
  const m = await compileNeonSealedUpdateManifestV1({ inventory: inventory(), now, codeSha256: code, artifactDirectory: "F:/ChatGPT_workshop/techlong-f3b3-neon-sealed-artifacts-test",
    artifactReportFileSha256: "b".repeat(64), artifact: { zipSha256: "d".repeat(64), zipBytes: 100, bundleSha256: "e".repeat(64), file: "ttl-neon.zip" }, nonce: "f".repeat(64) });
  const calls: string[] = []; const p: NeonSealedUpdatePortsV1 = { now: () => now, inventory: async candidate => inventory(candidate), claimSlot: async () => { calls.push("slot"); },
    marker: async name => { calls.push(name); }, updateCodeOnce: async () => { calls.push("update"); return { revisionId: newRevision, zipSha256: m.artifact.zipSha256 }; },
    waitForReadyReadonly: async () => { calls.push("wait-readonly"); }, invokeOnce: async () => { calls.push("invoke"); return { schemaVersion: 1, protocol: "neon-sealed-readonly-probe-v1",
      functionArn: "arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-ttl-executor-v3", nonce: m.event.nonce, requestId: newRevision,
      outcome: "NEON_SEALED_READONLY_PREFLIGHT_NOT_VERIFIED", stage: "readonly-database", errorCode: "NEON_PROBE_READ_UNVERIFIED", databaseReadAttempted: true, proof: null,
      runtimeEnabled: false, mutationPerformed: false, deletionAuthorized: false }; } };
  return { m, p, calls };
}
test("one update and one invocation remain inspect-only even when the database proof is negative", async () => {
  const f = await fixture(), r = await runNeonSealedUpdateV1(f.m, f.m.manifestSha256, code, f.p);
  assert.equal(r.codeUpdates, 1); assert.equal(r.invocations, 1); assert.equal(r.failureStage, null); assert.equal(r.retryAuthorized, false); assert.equal(r.runtimeEnabled, false);
});
test("expired/wrong approval rejects before slot and any cloud API", async () => {
  for (const expired of [false, true]) { const f = await fixture(); if (expired) f.p.now = () => now + 3600000;
    const r = await runNeonSealedUpdateV1(f.m, expired ? f.m.manifestSha256 : "0".repeat(64), code, f.p); assert.equal(r.slotConsumed, false); assert.equal(f.calls.length, 0); }
});
test("consumed slot never updates or invokes", async () => {
  const f = await fixture(); f.p.claimSlot = async () => { throw new Error("EEXIST"); }; const r = await runNeonSealedUpdateV1(f.m, f.m.manifestSha256, code, f.p);
  assert.equal(r.codeUpdates, 0); assert.equal(r.invocations, 0); assert.equal(r.retryAuthorized, false);
});
test("lost update response stops without invocation, rollback or fill", async () => {
  const f = await fixture(); f.p.updateCodeOnce = async () => { f.calls.push("update-uncertain"); throw new Error("lost"); };
  const r = await runNeonSealedUpdateV1(f.m, f.m.manifestSha256, code, f.p); assert.equal(r.codeUpdates, 1); assert.equal(r.invocations, 0);
  assert.equal(r.slotConsumed, true); assert.equal(r.failureStage, "UPDATE_CODE"); assert.ok(!f.calls.includes("invoke"));
});
test("concurrent revision/config drift blocks before the one invocation", async () => {
  const f = await fixture(); f.p.inventory = async candidate => ({ ...inventory(candidate), revisionId: candidate ? "99999999-9999-9999-9999-999999999999" : oldRevision });
  const r = await runNeonSealedUpdateV1(f.m, f.m.manifestSha256, code, f.p); assert.equal(r.failureCode, "NEON_UPDATE_POSTSTATE_DRIFT"); assert.equal(r.invocations, 0);
});
test("marker persistence failure cannot cause an unrecorded invocation", async () => {
  const f = await fixture(); f.p.marker = async name => { if (name === "invoke-attempt.json") throw new Error("disk unavailable"); };
  const r = await runNeonSealedUpdateV1(f.m, f.m.manifestSha256, code, f.p); assert.equal(r.codeUpdates, 1); assert.equal(r.invocations, 0); assert.equal(r.retryAuthorized, false);
});
