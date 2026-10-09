import assert from "node:assert/strict";
import test from "node:test";
import { compileReadonlyLambdaManifestV1, readonlyLambdaTargetsV1, runReadonlyLambdaInstallV1, validateReadonlyProbeResponseV1,
  type ReadonlyLambdaInventoryV1, type ReadonlyLambdaInstallPortsV1 } from "../lib/deployments/execution/readonly-lambda-install-v1.ts";

const now = 1791509000000, code = "a".repeat(64), foundation = "b".repeat(64);
const targets = readonlyLambdaTargetsV1([{ index: 0, zipSha256: "c".repeat(64), zipBytes: 1000 }, { index: 1, zipSha256: "d".repeat(64), zipBytes: 1000 }]);
const events = ["e", "f"].map(x => ({ schemaVersion: 1 as const, action: "verify_readonly_runtime_v1" as const, nonce: x.repeat(64) }));
function inventory(ready = false): ReadonlyLambdaInventoryV1 {
  return { observedAt: now, foundationSha256: foundation, resources: targets.map(t => ({ index: t.index, functionState: ready ? "OWN_READY" : "ABSENT", logState: ready ? "OWN_READY" : "ABSENT" })),
    sourcePermissions: Array.from({ length: 14 }, () => ({ action: "test", resource: "exact", decision: "allowed" })) };
}
async function fixture() {
  const calls: string[] = []; let installed = false;
  const manifest = await compileReadonlyLambdaManifestV1({ reviewedAt: now, codeSha256: code, artifactsDirectory: "F:/ChatGPT_workshop/test", artifactReportFileSha256: code, targets, events, inventory: inventory() });
  const ports: ReadonlyLambdaInstallPortsV1 = { now: () => now + 1, inventory: async () => inventory(installed),
    claimSlot: async () => { calls.push("slot"); }, marker: async name => { calls.push(name); },
    createLog: async i => { calls.push(`log-${i}`); }, retainLog: async i => { calls.push(`retention-${i}`); }, createFunction: async i => { calls.push(`function-${i}`); },
    waitAndInspect: async () => { installed = true; return inventory(true); }, invokeOnce: async i => { calls.push(`invoke-${i}`); return { safe: true }; } };
  return { manifest, ports, calls };
}
test("valid one-shot installs exactly six writes, independently inspects, invokes once each", async () => {
  const f = await fixture(), r = await runReadonlyLambdaInstallV1({ ...f, approvedSha: f.manifest.manifestSha256, codeSha256: code });
  assert.equal(r.installationCalls, 6); assert.equal(r.invocationCalls, 2); assert.equal(r.failureStage, null);
  assert.deepEqual(f.calls.filter(x => /^(log|retention|function|invoke)-\d$/.test(x)), ["log-0", "retention-0", "log-1", "retention-1", "function-0", "function-1", "invoke-0", "invoke-1"]);
});
test("expired/wrong approval never consumes slot", async () => {
  const f = await fixture(); f.ports.now = () => now + 3600000;
  await assert.rejects(runReadonlyLambdaInstallV1({ ...f, approvedSha: f.manifest.manifestSha256, codeSha256: code }), /FRESH_APPROVAL/); assert.deepEqual(f.calls, []);
});
test("existing resource or denied Source leaves slot empty", async () => {
  for (const existing of [true, false]) {
    const f = await fixture(); f.ports.inventory = async () => { const r = inventory(); if (existing) r.resources[0].logState = "OTHER"; else r.sourcePermissions[0].decision = "explicitDeny"; return r; };
    const r = await runReadonlyLambdaInstallV1({ ...f, approvedSha: f.manifest.manifestSha256, codeSha256: code }); assert.equal(r.slotConsumed, false); assert.deepEqual(f.calls, []);
  }
});
test("lost creation response stops without fill/delete/invoke/retry", async () => {
  const f = await fixture(); f.ports.createFunction = async i => { f.calls.push(`function-${i}`); throw new Error("RAW_DIAGNOSTIC"); };
  const r = await runReadonlyLambdaInstallV1({ ...f, approvedSha: f.manifest.manifestSha256, codeSha256: code });
  assert.equal(r.slotConsumed, true); assert.equal(r.installationCalls, 5); assert.equal(r.invocationCalls, 0); assert.equal(r.retryAuthorized, false);
  assert.equal(f.calls.filter(x => x === "function-0").length, 1); assert.doesNotMatch(JSON.stringify(r), /RAW_DIAGNOSTIC/);
});
test("post-install drift cannot cause an invocation", async () => {
  const f = await fixture(); f.ports.waitAndInspect = async () => { const r = inventory(true); r.resources[1].functionState = "OTHER"; return r; };
  const r = await runReadonlyLambdaInstallV1({ ...f, approvedSha: f.manifest.manifestSha256, codeSha256: code }); assert.equal(r.invocationCalls, 0); assert.equal(r.failureStage, "READONLY_INSTALL_INSPECT");
});
test("uncertain invocation never retried or followed by second invocation", async () => {
  const f = await fixture(); f.ports.invokeOnce = async i => { f.calls.push(`invoke-${i}`); throw new Error("uncertain"); };
  const r = await runReadonlyLambdaInstallV1({ ...f, approvedSha: f.manifest.manifestSha256, codeSha256: code }); assert.equal(r.invocationCalls, 1); assert.equal(r.retryAuthorized, false);
  assert.deepEqual(f.calls.filter(x => /^invoke-\d$/.test(x)), ["invoke-0"]);
});
test("response validator rejects extra secrets, raw diagnostics and incorrect bindings", () => {
  const good = { schemaVersion: 1, functionArn: targets[1].functionArn, nonce: events[1].nonce, requestId: "12345678-1234-1234-1234-123456789abc", outcome: "READONLY_PROBE_READS_VERIFIED",
    steps: [{ label: "exact-runtime-identity", passed: true }, { label: "exact-secret-awscurrent", passed: true }, { label: "provision-authority", passed: true, observation: "ABSENT" }],
    runtimeEnabled: false, databaseConnected: false, mutationPerformed: false };
  assert.deepEqual(validateReadonlyProbeResponseV1(1, events[1], good), good);
  for (const bad of [{ ...good, SecretString: "do not save" }, { ...good, nonce: "0".repeat(64) }, { ...good, steps: [{ label: "exact-runtime-identity", passed: false, errorCode: "RAW_SECRET_PASSWORD" }] }])
    assert.throws(() => validateReadonlyProbeResponseV1(1, events[1], bad), /RESPONSE_NOT_VERIFIED/);
});
