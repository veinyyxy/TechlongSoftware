import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compileBusinessInstallManifestV1, validateBusinessInstallManifestV1, runBusinessInstallV1, SEALED_BUSINESS_INSTALL_SCOPE_V1 as scope,
  type BusinessInstallPortsV1, type BusinessInstallStateV1 } from "../lib/deployments/execution/sealed-business-install-v1.ts";
const now = Date.parse("2026-10-11T18:00:00Z"), code = "c".repeat(64), anchor = "a".repeat(64);
const revision = (n: number) => `12345678-1234-1234-1234-${String(n).padStart(12, "0")}`;
async function fixture() {
  const state: BusinessInstallStateV1 = { drainBoundary: "v2", drainInline: "BASE", functions: [0, 1].map(index => ({ index, code: "OLD", revisionId: revision(index + 1) })) };
  const inventory = (withPermissions = false) => ({ observedAt: now, stableAnchorSha256: anchor, state: structuredClone(state), sourcePermissionsAllowed: withPermissions });
  const m = await compileBusinessInstallManifestV1({ inventory: inventory(true), now, codeSha256: code, artifactDirectory: "F:/ChatGPT_workshop/techlong-f3b3-sealed-runtime-v3-20261011-p1" }), calls: string[] = [];
  const p: BusinessInstallPortsV1 = { now: () => now, inventory: async flag => inventory(flag), claimSlot: async () => { calls.push("slot"); }, marker: async name => { calls.push(name); },
    createDefaultV3: async () => { calls.push("boundary"); state.drainBoundary = "v3"; return { versionId: "v3", isDefault: true }; },
    putDrainInline: async () => { calls.push("inline"); state.drainInline = "CANDIDATE"; },
    updateCodeOnce: async i => { calls.push(`code-${i}`); state.functions[i] = { index: i, code: "CANDIDATE", revisionId: revision(i + 11) }; return { revisionId: revision(i + 21), zipSha256: m.artifacts[i].zipSha256 }; },
    waitForReadyReadonly: async i => { calls.push(`read-wait-${i}`); return { revisionId: state.functions[i].revisionId, zipSha256: m.artifacts[i].zipSha256, readyObservations: 2 }; } };
  return { state, m, p, calls, run: (approved = m.manifestSha256) => runBusinessInstallV1(m, approved, code, p) };
}
test("exact four writes, no invokes; async response/completed revisions deliberately distinguished", async () => {
  const f = await fixture(), r = await f.run(); assert.equal(r.failureStage, null); assert.equal(r.iamWrites, 2); assert.equal(r.codeUpdates, 2); assert.equal(r.invocations, 0);
  assert.equal(r.businessInvocationAuthorized, false); assert.equal(r.retryAuthorized, false); assert.deepEqual(f.calls.filter(c => ["boundary", "inline", "code-0", "code-1"].includes(c)), ["boundary", "inline", "code-0", "code-1"]);
  assert.equal(r.expectedState.functions[0].revisionId, revision(11)); assert.ok(r.confirmed.some(c => c.responseRevisionId === revision(21) && c.revisionId === revision(11)));
});
test("wrong or expired approval has no slot, metadata reads or writes", async () => {
  for (const expired of [false, true]) { const f = await fixture(); let reads = 0; f.p.inventory = async () => { reads++; throw Error(); }; if (expired) f.p.now = () => now + 3600000;
    const r = await f.run(expired ? f.m.manifestSha256 : "0".repeat(64)); assert.equal(r.slotConsumed, false); assert.equal(reads, 0); assert.equal(f.calls.length, 0); }
});
test("source permission or anchor drift blocks before permanent slot", async () => {
  for (const change of ["permission", "anchor", "revision", "stale"]) { const f = await fixture(); f.p.inventory = async () => ({ observedAt: change === "stale" ? now - 31000 : now,
      stableAnchorSha256: change === "anchor" ? "b".repeat(64) : anchor, state: { ...structuredClone(f.m.originalState), functions: f.m.originalState.functions.map(x => ({ ...x, revisionId: change === "revision" ? revision(99) : x.revisionId })) }, sourcePermissionsAllowed: change !== "permission" });
    const r = await f.run(); assert.equal(r.slotConsumed, false); assert.equal(r.iamWrites, 0); assert.equal(f.calls.length, 0); }
});
test("consumed slot rejects every later Run without filling partial resources", async () => {
  const f = await fixture(); f.p.claimSlot = async () => { throw Error("EEXIST"); }; const r = await f.run(); assert.equal(r.iamWrites, 0); assert.equal(r.codeUpdates, 0); assert.equal(r.retryAuthorized, false);
});
test("lost first IAM response cannot submit inline/code or roll back", async () => {
  const f = await fixture(); f.p.createDefaultV3 = async () => { f.calls.push("boundary-uncertain"); throw Error("RAW_PROVIDER_DIAGNOSTIC"); }; const r = await f.run();
  assert.equal(r.slotConsumed, true); assert.equal(r.iamWrites, 1); assert.equal(r.codeUpdates, 0); assert.equal(r.failureCode, "BUSINESS_INSTALL_RESULT_UNVERIFIED"); assert.ok(!f.calls.includes("inline")); assert.ok(!JSON.stringify(r).includes("RAW_PROVIDER"));
});
test("marker failure before a write cannot call the mutator", async () => {
  const f = await fixture(); f.p.marker = async name => { if (name === "boundary-v3-attempt.json") throw Error(); }; const r = await f.run(); assert.equal(r.iamWrites, 0); assert.equal(r.codeUpdates, 0);
});
test("boundary/inline non-CAS drift is detected between steps", async () => {
  const f = await fixture(); f.p.createDefaultV3 = async () => ({ versionId: "v3", isDefault: true }); const r = await f.run(); assert.equal(r.iamWrites, 1); assert.equal(r.codeUpdates, 0); assert.equal(r.failureCode, "BUSINESS_INSTALL_PRESTATE_DRIFT");
});
test("lost code response stops after one update attempt, no wait/second update/retry", async () => {
  const f = await fixture(); f.p.updateCodeOnce = async () => { throw Error("lost"); }; const r = await f.run(); assert.equal(r.codeUpdates, 1); assert.equal(r.invocations, 0); assert.equal(r.failureStage, "code-0"); assert.ok(!f.calls.includes("read-wait-0"));
});
test("unverified ready revision stops without the drain update", async () => {
  const f = await fixture(); f.p.waitForReadyReadonly = async i => ({ revisionId: f.m.originalState.functions[i].revisionId, zipSha256: f.m.artifacts[i].zipSha256, readyObservations: 2 });
  const r = await f.run(); assert.equal(r.codeUpdates, 1); assert.equal(r.failureCode, "BUSINESS_INSTALL_COMPLETED_REVISION_UNVERIFIED");
});
test("post-ready config drift never proceeds to the second update", async () => {
  const f = await fixture(), original = f.p.inventory; f.p.inventory = async flag => ({ ...await original(flag), stableAnchorSha256: f.state.functions[0].code === "CANDIDATE" ? "b".repeat(64) : anchor });
  const r = await f.run(); assert.equal(r.codeUpdates, 1); assert.equal(r.failureCode, "BUSINESS_INSTALL_PRESTATE_DRIFT");
});
test("manifest scope/resources/documents tamper or extra event rejects before ports", async () => {
  const f = await fixture(); for (const m of [{ ...f.m, scope: { ...scope, invocationsMaximum: 1 } }, { ...f.m, approvedBusinessEvent: {} }, { ...f.m, codeSha256: "d".repeat(64) }])
    await assert.rejects(validateBusinessInstallManifestV1(m as typeof f.m, code));
  assert.equal(f.calls.length, 0);
});
test("production installer has no Invoke, SecretValue, database or automatic destructive SDK capability", async () => {
  const runtime = await readFile(new URL("../ops/aws-sandbox/scripts/sealed-business-install-aws-runtime-v1.mjs", import.meta.url), "utf8");
  assert.ok(!/InvokeCommand|InvokeFunctionCommand|GetSecretValueCommand|DeletePolicyVersionCommand|DeleteStackCommand|\.query\(|\/invocations/.test(runtime));
  assert.ok(runtime.includes("RevisionId:expected.functions[index].revisionId")); assert.ok(runtime.includes("maxAttempts:1")); assert.equal(scope.invocationsMaximum, 0); assert.equal(scope.totalWriteCallsMaximum, 4);
});
