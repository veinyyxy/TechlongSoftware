import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../lib/deployments/execution/hash.ts";
import { readonlyRuntimeIamDocumentsV1, READONLY_RUNTIME_IAM_TARGETS_V1 } from "../lib/deployments/execution/readonly-runtime-iam-v1.ts";
import { readonlyKmsRepairDocumentsV1, READONLY_KMS_KEY_ARN_V1, compileKmsRepairManifestV1, runKmsReadRepairV1,
  type KmsRepairPortsV1, type KmsRepairStateV1 } from "../lib/deployments/execution/readonly-kms-read-repair-v1.ts";

test("boundary quota and identity parity; original source/region/read constraints preserved", () => {
  for (const index of [0, 1]) {
    const old = readonlyRuntimeIamDocumentsV1(index), next = readonlyKmsRepairDocumentsV1(index);
    assert.ok(canonicalJson(next.boundary).length <= 6144); assert.deepEqual(next.identity, next.boundary); assert.deepEqual(next.trust, old.trust);
    const expected: Record<string, unknown>[] = old.identity.Statement.map(s => {
      const c = structuredClone(s); delete c.Sid;
      if (s.Sid === "DenyAllOtherActions") c.NotAction = [...s.NotAction as string[], "kms:Decrypt"];
      if (s.Sid === "DenyOtherOrMissingSourceFunction") { delete c.Action; c.NotAction = "kms:Decrypt"; }
      return c;
    });
    if (index === 0) { const a = old.identity.Statement.findIndex(s => s.Sid === "Identity"), b = old.identity.Statement.findIndex(s => s.Sid === "ReadAllStackNamesForDependencyChecks");
      expected[a].Action = ["sts:GetCallerIdentity", "cloudformation:ListStacks"]; expected.splice(b, 1); }
    assert.deepEqual(next.boundary.Statement.slice(0, expected.length), expected);
  }
});
test("KMS key, ViaService, caller, Secret ARN and version have separate explicit denies including missing fields", () => {
  for (const index of [0, 1]) {
    const t = READONLY_RUNTIME_IAM_TARGETS_V1[index], statements = readonlyKmsRepairDocumentsV1(index).boundary.Statement;
    assert.ok(statements.some(s => s.Effect === "Deny" && s.Action === "kms:Decrypt" && s.NotResource === READONLY_KMS_KEY_ARN_V1));
    for (const [key, value] of Object.entries({ "kms:ViaService": "secretsmanager.ca-central-1.amazonaws.com", "kms:CallerAccount": "402010193138",
      "kms:EncryptionContext:SecretARN": t.secretArn, "kms:EncryptionContext:SecretVersionId": t.secretVersionId })) {
      assert.ok(statements.some(s => s.Effect === "Deny" && s.Action === "kms:Decrypt" && canonicalJson(s.Condition) === canonicalJson({ StringNotEquals: { [key]: value } })));
    }
    assert.equal(statements.filter(s => s.Effect === "Allow" && s.Action === "kms:Decrypt").length, 1);
    assert.equal(statements.find(s => s.Effect === "Allow" && s.Action === "kms:Decrypt")?.Resource, READONLY_KMS_KEY_ARN_V1);
  }
});
const now = 1791726000000, code = "a".repeat(64), anchor = "b".repeat(64);
async function fixture() {
  const calls: string[] = [], states: KmsRepairStateV1[] = [0, 1].map(index => ({ index, boundary: "BASE_V1", inline: "BASE" }));
  const inventory = async () => ({ observedAt: now, anchorSha256: anchor, states: structuredClone(states), sourcePermissionsAllowed: true });
  const events = ["c", "d"].map(x => ({ schemaVersion: 1 as const, action: "verify_readonly_runtime_v1" as const, nonce: x.repeat(64) }));
  const manifest = await compileKmsRepairManifestV1({ inventory: await inventory(), codeSha256: code, now, events });
  const ports: KmsRepairPortsV1 = { now: () => now + 1, inventory, claimSlot: async () => { calls.push("slot"); }, marker: async name => { calls.push(name); },
    createDefaultV2: async i => { calls.push(`boundary-${i}`); states[i].boundary = "OWN_V2"; return { versionId: "v2", isDefault: true }; },
    putInline: async i => { calls.push(`inline-${i}`); states[i].inline = "OWN_REPAIRED"; }, waitForPropagation: async () => { calls.push("wait"); },
    invokeOnce: async i => { calls.push(`invoke-${i}`); return { schemaVersion: 1, functionArn: `arn:aws:lambda:ca-central-1:402010193138:function:${READONLY_RUNTIME_IAM_TARGETS_V1[i].functionName}`,
      nonce: events[i].nonce, requestId: "12345678-1234-1234-1234-123456789abc", outcome: "READONLY_PROBE_IDENTITY_NOT_VERIFIED",
      steps: [{ label: "exact-runtime-identity", passed: false, errorCode: "READONLY_PROBE_READ_NOT_VERIFIED" }], runtimeEnabled: false, databaseConnected: false, mutationPerformed: false }; },
  };
  return { manifest, ports, calls, states };
}
test("one new slot, exactly four IAM writes and two new synchronous probes; no old slot API", async () => {
  const f = await fixture(), r = await runKmsReadRepairV1({ ...f, approvedSha: f.manifest.manifestSha256, codeSha256: code });
  assert.equal(r.iamWrites, 4); assert.equal(r.invocations, 2); assert.equal(r.failureStage, null); assert.equal(r.retryAuthorized, false);
  assert.deepEqual(f.calls.filter(s => /^(boundary|inline|invoke)-\d$|^wait$/.test(s)), ["boundary-0", "inline-0", "boundary-1", "inline-1", "wait", "invoke-0", "invoke-1"]);
});
test("expired or wrong SHA rejects before preflight or slot consumption", async () => {
  const f = await fixture(); f.ports.now = () => now + 3600000;
  await assert.rejects(runKmsReadRepairV1({ ...f, approvedSha: f.manifest.manifestSha256, codeSha256: code }), /FRESH_APPROVAL/); assert.deepEqual(f.calls, []);
  f.ports.now = () => now + 1; await assert.rejects(runKmsReadRepairV1({ ...f, approvedSha: "0".repeat(64), codeSha256: code }), /FRESH_APPROVAL/);
});
test("preexisting version or inline drift cannot be adopted or repaired", async () => {
  const f = await fixture(); f.states[0].boundary = "OWN_V2";
  const r = await runKmsReadRepairV1({ ...f, approvedSha: f.manifest.manifestSha256, codeSha256: code }); assert.equal(r.slotConsumed, false); assert.deepEqual(f.calls, []);
});
test("lost version response stops without put, fill, reset, delete or retry", async () => {
  const f = await fixture(); f.ports.createDefaultV2 = async i => { f.calls.push(`boundary-${i}`); f.states[i].boundary = "OWN_V2"; throw new Error("RAW_PASSWORD"); };
  const r = await runKmsReadRepairV1({ ...f, approvedSha: f.manifest.manifestSha256, codeSha256: code }); assert.equal(r.slotConsumed, true); assert.equal(r.iamWrites, 1); assert.equal(r.invocations, 0);
  assert.deepEqual(f.calls.filter(s => /^(boundary|inline)-\d$/.test(s)), ["boundary-0"]); assert.doesNotMatch(JSON.stringify(r), /RAW_PASSWORD/);
});
test("unexpected version ID stops without continuation", async () => {
  const f = await fixture(); f.ports.createDefaultV2 = async () => ({ versionId: "v3", isDefault: true });
  const r = await runKmsReadRepairV1({ ...f, approvedSha: f.manifest.manifestSha256, codeSha256: code }); assert.equal(r.iamWrites, 1); assert.equal(r.invocations, 0); assert.match(r.failureCode!, /RESPONSE_UNCERTAIN/);
});
test("failed inline update leaves partial state, never restores v1 or fills second role", async () => {
  const f = await fixture(); f.ports.putInline = async i => { f.calls.push(`inline-${i}`); throw new Error("uncertain"); };
  const r = await runKmsReadRepairV1({ ...f, approvedSha: f.manifest.manifestSha256, codeSha256: code }); assert.equal(r.iamWrites, 2); assert.equal(r.invocations, 0); assert.equal(f.states[0].boundary, "OWN_V2");
});
test("invocation uncertainty is not retried and does not schedule a second call", async () => {
  const f = await fixture(); f.ports.invokeOnce = async i => { f.calls.push(`invoke-${i}`); throw new Error("uncertain"); };
  const r = await runKmsReadRepairV1({ ...f, approvedSha: f.manifest.manifestSha256, codeSha256: code }); assert.equal(r.iamWrites, 4); assert.equal(r.invocations, 1);
  assert.deepEqual(f.calls.filter(s => /^invoke-\d$/.test(s)), ["invoke-0"]);
});
