import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { prepareCellBirthRegistrationReviewV3, approveCellBirthRegistrationV3, decodeCellBirthRegistrationV3, CELL_BIRTH_REGISTRATION_KEY_V3 as key } from "../lib/deployments/execution/cell-birth-registration-v3.ts";
import { AwsSdkCellBirthRegistryReaderV3, AwsSdkCellBirthRegistrarV3, AwsSdkCellBirthDrainJournalV3, assertInstalledCellBirthRegistrationV3,
  compileCellBirthDrainIntentV3, type CellBirthRegistrySdkV3 } from "../lib/deployments/execution/aws-sdk-cell-birth-registry-v3.ts";
import { compileCellBirthDelegationV3, prepareBirthBoundDrainV3 } from "../lib/deployments/execution/cell-birth-lifecycle-v3.ts";
import { compileV3ProvisionPredecessor } from "../lib/deployments/execution/aws-sdk-cell-stack-evidence-v3.ts";
import { createPreparedCellBirthCoordinatorV3 } from "../lib/deployments/execution/prepared-cell-birth-coordinator-v3.ts";
import { v3Fixture, v3Now, v3StackId } from "./fixtures/cell-stack-v3.ts";

const roleId = "AROAV3GNMXTZTESTROLEID", codeSha = "b".repeat(64), signal = () => new AbortController().signal;
type Json = Record<string, unknown>;
/** Atomic transport fixture, not an AWS/Neon acceptance proof. */
function transport() {
  const items = new Map<string, Json>(), requests: { kind: string; input: Json }[] = [], committedTokens = new Map<string, string>();
  let profile = "source_inspection", uncertainClaim = false, uncertainReceipt = false;
  const commands = Object.fromEntries(["identity", "get", "transactGet", "transactWrite"].map(kind => [kind, class { kind = kind; input: Json; constructor(input: Json) { this.input = input; } }])) as unknown as CellBirthRegistrySdkV3["commands"];
  const send = async (raw: unknown) => {
    const c = raw as { kind: string; input: Json }; requests.push(structuredClone(c));
    if (c.kind === "identity") return profile === "source_inspection" ? { Account: "402010193138", Arn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev", UserId: "AIDAV3GNMXTZEO7SHLC2X" } :
      { Account: "402010193138", Arn: "arn:aws:sts::402010193138:assumed-role/TechlongSandboxCellLifecycleCoordinatorRoleV3/fixture-session", UserId: `${profile === "wrong_role_id" ? "AROAV3GNMXTZWRONGROLEI" : roleId}:fixture-session` };
    const k = (x: Json) => String((x.Key as Json).authority_key);
    if (c.kind === "get") { assert.equal(c.input.ConsistentRead, true); const value = items.get(k(c.input)); return value ? { Item: structuredClone(value) } : {}; }
    if (c.kind === "transactGet") return { Responses: (c.input.TransactItems as Json[]).map(x => { const value = items.get(k(x.Get as Json)); return value ? { Item: structuredClone(value) } : {}; }) };
    if (c.kind !== "transactWrite") throw Error("unexpected fixture API");
    assert.ok(String(c.input.ClientRequestToken).length <= 36);
    const token = String(c.input.ClientRequestToken), fingerprint = canonicalJson(c.input);
    // AWS replays the original successful transaction for the same token/body.
    if (committedTokens.has(token)) { assert.equal(committedTokens.get(token), fingerprint); return {}; }
    const actions = c.input.TransactItems as Json[];
    for (const a of actions) {
      if (a.ConditionCheck) { const x = a.ConditionCheck as Json, old = items.get(k(x)), values = x.ExpressionAttributeValues as Json;
        if (!old || old.schema_version !== values[":schema"] || old.record_json !== values[":json"]) throw Error("fixture condition failed"); }
      else { const next = (a.Put as Json).Item as Json; if (items.has(String(next.authority_key))) throw Error("fixture slot occupied"); }
    }
    for (const a of actions) if (a.Put) { const next = (a.Put as Json).Item as Json; items.set(String(next.authority_key), structuredClone(next)); }
    committedTokens.set(token, fingerprint);
    if (actions.some(x => String(((x.Put as Json)?.Item as Json)?.authority_key).includes("drain-intent")) && uncertainClaim) throw Error("lost claim response");
    if (actions.some(x => String(((x.Put as Json)?.Item as Json)?.authority_key).includes("drain-receipt")) && uncertainReceipt) throw Error("lost receipt response");
    return {};
  };
  const sdk: CellBirthRegistrySdkV3 = { ddb: { send }, sts: { send }, commands };
  return { sdk, items, requests, useSource: () => { profile = "source_inspection"; }, useRuntime: () => { profile = "lifecycle_coordinator"; }, wrongRole: () => { profile = "wrong_role_id"; },
    loseClaim: () => { uncertainClaim = true; }, loseReceipt: () => { uncertainReceipt = true; } };
}
async function context(phase: "RESERVED" | "ARMED" | "PAID" = "PAID", status = "UPDATE_COMPLETE") {
  const source = await v3Fixture("RESERVED", "CREATE_COMPLETE", "source_inspection"), reserved = await source.read(); assert.ok("protocol" in reserved);
  const delegation = await compileCellBirthDelegationV3({ plan: source.plan, reserved, coordinatorCodeSha256: codeSha, coordinatorRoleId: roleId, now: v3Now + 2000 });
  const review = await prepareCellBirthRegistrationReviewV3({ plan: source.plan, delegation, reserved, now: v3Now + 2000 });
  const record = await approveCellBirthRegistrationV3({ review, approvedManifestSha256: review.manifestSha256, now: v3Now + 2000 });
  const store = transport(), registrar = new AwsSdkCellBirthRegistrarV3(store.sdk, source.reader, () => v3Now + 2000);
  const installed = await registrar.installOnce({ record, approvedManifestSha256: review.manifestSha256, signal: signal() }); assert.equal(installed.outcome, "SUBMITTED_REQUIRES_INDEPENDENT_READ");
  const paid = await v3Fixture(), complete = await paid.read(); assert.ok("protocol" in complete); const predecessor = await compileV3ProvisionPredecessor(paid.plan, complete, v3Now + 2000);
  let time = v3Now + 10800000, invocations = 0, actuatorFails = false, observedItem = predecessor.item;
  const current = await v3Fixture(phase, status, "lifecycle_coordinator"); current.setTime(time);
  store.useRuntime(); const reader = new AwsSdkCellBirthRegistryReaderV3(store.sdk, "lifecycle_coordinator", () => time), journal = new AwsSdkCellBirthDrainJournalV3(store.sdk, () => time);
  const root = createPreparedCellBirthCoordinatorV3({ registry: reader, journal, stack: current.reader, coordinatorCodeSha256: codeSha, now: () => time,
    authority: { async observe() { return { authorityKey: "cell:cell-sandbox-1", item: structuredClone(observedItem), revision: 1 }; } },
    drain: { async run(e) { invocations++; if (actuatorFails) throw Error("provider diagnostics must not be journaled"); return { schemaVersion: 3, mode: "prepared_not_installed", outcome: "ZERO_TENANT_READY_FOR_AUTHORITY_REVIEW_V3",
      expectedProvisionItemSha256: e.expectedProvisionItemSha256, drainIntentSha256: e.approvedDrainIntentSha256, certificateSha256: e.certificateSha256,
      drainReceipt: { fixture: "not a real database receipt" }, jobReceipt: { fixture: "not a real job receipt" }, ownershipCounts: { activeTenantCount: 0, activeCapacityReservationCount: 0,
        nonterminalDeploymentCount: 0, liveTenantResourceCount: 0, nonterminalTenantCleanupScheduleCount: 0 }, ownershipStateSha256: "c".repeat(64), rawOwnershipWitnessSha256: "d".repeat(64),
      authorityWritePerformed: false, cellDeletionPerformed: false, runtimeActivationAuthorized: false }; } } });
  const event = { schemaVersion: 3, action: "reconcile_approved_cell_birth_v3", birthIntentSha256: source.plan.birthIntentSha256, stackId: v3StackId };
  return { source, reserved, delegation, review, record, store, registrar, reader, journal, root, current, predecessor, event,
    invocations: () => invocations, failActuator: () => { actuatorFails = true; }, setTime: (n: number) => { time = n; current.setTime(n); },
    driftPredecessor: () => { observedItem = { ...observedItem, record_json: "{}" }; } };
}
test("registration requires fresh exact approval and RESERVED evidence; cold decoding is not installed proof", async () => {
  const c = await context(); assert.equal(c.record.manifest.scope.beginAdmissionDrainOnce, true); assert.equal(c.record.manifest.scope.deleteFailedBirth, false);
  await assert.rejects(() => approveCellBirthRegistrationV3({ review: c.review, approvedManifestSha256: "a".repeat(64), now: v3Now + 2000 }));
  await assert.rejects(() => approveCellBirthRegistrationV3({ review: structuredClone(c.review), approvedManifestSha256: c.review.manifestSha256, now: v3Now + 2000 }));
  await assert.rejects(() => approveCellBirthRegistrationV3({ review: c.review, approvedManifestSha256: c.review.manifestSha256, now: c.review.manifest.expiresAt }));
  const cold = await decodeCellBirthRegistrationV3(c.record); assert.equal(cold.registrationSha256, c.record.registrationSha256);
  const proof = await c.reader.readStrong({ signal: signal() }); assert.ok(proof); assert.throws(() => assertInstalledCellBirthRegistrationV3(structuredClone(proof), v3Now + 10800000, codeSha));
  assert.throws(() => assertInstalledCellBirthRegistrationV3(proof, v3Now + 10800000, "a".repeat(64)));
  const modified = JSON.parse(canonicalJson(c.record)); modified.manifest.scope.deleteFailedBirth = true; await assert.rejects(() => decodeCellBirthRegistrationV3(modified));
});
test("Source registrar cannot replace permanent registration or run under coordinator credentials", async () => {
  const c = await context(), count = c.store.requests.filter(x => x.kind === "transactWrite").length;
  await assert.rejects(() => c.registrar.installOnce({ record: c.record, approvedManifestSha256: c.review.manifestSha256, signal: signal() }), /IDENTITY/);
  assert.equal(c.store.requests.filter(x => x.kind === "transactWrite").length, count);
  c.store.useSource(); assert.equal((await c.registrar.installOnce({ record: c.record, approvedManifestSha256: c.review.manifestSha256, signal: signal() })).outcome, "UNKNOWN_OR_REJECTED_INSPECT_ONLY");
  assert.equal(c.store.items.size, 1);
  const late = new AwsSdkCellBirthRegistrarV3(c.store.sdk, c.source.reader, () => c.review.manifest.expiresAt);
  await assert.rejects(() => late.installOnce({ record: c.record, approvedManifestSha256: c.review.manifestSha256, signal: signal() }), /EXPIRED/);
});
test("durable once slot permits one concurrent drain, duplicate tick never invokes again", async () => {
  const c = await context(); const results = await Promise.all([c.root.run(c.event, signal()), c.root.run(c.event, signal())]);
  assert.equal(c.invocations(), 1); assert.ok(results.some(x => x.outcome === "RETURNED_REQUIRES_FRESH_CENSUS"));
  const again = await c.root.run(c.event, signal()); assert.equal(again.outcome, "IMMUTABLE_DRAIN_RECEIPT_REPLAYED"); assert.equal(c.invocations(), 1);
  assert.equal(again.cellDeletionPerformed, false); assert.equal(again.authorityWritePerformed, false);
  assert.equal(c.store.items.size, 3); assert.ok([...c.store.items.keys()].every(k => k.startsWith("cell-birth-v3:")));
  const claimTransactions = c.store.requests.filter(x => x.kind === "transactWrite" && (x.input.TransactItems as Json[]).some(a => String(((a.Put as Json)?.Item as Json)?.authority_key).includes("drain-intent")));
  assert.equal(claimTransactions.length, 2); assert.equal(new Set(claimTransactions.map(x => x.input.ClientRequestToken)).size, 2);
});
test("lost claim response persists consumed slot but never obtains actuator ownership", async () => {
  const c = await context(); c.store.loseClaim(); const first = await c.root.run(c.event, signal()); assert.equal(first.outcome, "DRAIN_SLOT_NOT_OWNED_INSPECT_ONLY");
  const again = await c.root.run(c.event, signal()); assert.equal(again.outcome, "DRAIN_SLOT_OCCUPIED_INSPECT_ONLY"); assert.equal(c.invocations(), 0); assert.equal(c.store.items.size, 2);
});
test("actuator failure or lost receipt response is inspect-only, never a write retry", async () => {
  for (const failure of ["actuator", "receipt"]) {
    const c = await context(); if (failure === "actuator") c.failActuator(); else c.store.loseReceipt();
    const first = await c.root.run(c.event, signal()); assert.equal(first.outcome, failure === "actuator" ? "INVOCATION_UNCERTAIN_INSPECT_ONLY" : "DRAIN_RECEIPT_UNCERTAIN_INSPECT_ONLY");
    assert.equal((await c.root.run(c.event, signal())).outcome, "IMMUTABLE_DRAIN_RECEIPT_REPLAYED"); assert.equal(c.invocations(), 1);
    assert.equal(canonicalJson([...c.store.items.values()]).includes("provider diagnostics"), false);
  }
});
test("wrong RoleId, Stack event, absent approval, predecessor drift and early clock reject before claim", async () => {
  for (const fault of ["role", "event", "absent", "predecessor", "early"]) {
    const c = await context(), event = structuredClone(c.event);
    if (fault === "role") c.store.wrongRole(); if (fault === "event") event.stackId = event.stackId.replace("123456789012", "123456789013");
    if (fault === "absent") c.store.items.delete(key); if (fault === "predecessor") c.driftPredecessor(); if (fault === "early") c.setTime(v3Now + 5000);
    if (fault === "early") assert.equal((await c.root.run(event, signal())).outcome, "CELL_BIRTH_NOT_DUE"); else await assert.rejects(() => c.root.run(event, signal()));
    assert.equal(c.invocations(), 0); assert.equal([...c.store.items.keys()].some(k => k.includes("drain-intent")), false);
  }
});
test("partial failure and nonpaid phase never obtain a drain/delete capability", async () => {
  for (const phase of ["RESERVED", "ARMED", "PAID"] as const) {
    const c = await context(phase, phase === "PAID" ? "UPDATE_FAILED" : "UPDATE_COMPLETE");
    if (phase === "PAID") { c.current.resources.splice(1); c.current.resources[0].ResourceStatus = "CREATE_FAILED"; }
    const r = await c.root.run(c.event, signal()); assert.equal(r.outcome, phase === "PAID" ? "FAILED_BIRTH_BLOCKED_ON_EXCLUSION_PROOF" : "NONPAID_BIRTH_REQUIRES_SEPARATE_REVIEW");
    assert.equal(c.invocations(), 0); assert.equal(c.store.items.size, 1);
  }
});
test("payload changes cannot obtain a second action slot; expired history is readable but not claimable", async () => {
  const c = await context(); await c.root.run(c.event, signal()); const proof = await c.reader.readStrong({ signal: signal() }); assert.ok(proof);
  const d = await prepareBirthBoundDrainV3({ plan: proof.record.manifest.plan, delegation: proof.record.manifest.delegation, provisionItem: c.predecessor.item, now: v3Now + 10800000 });
  const intent = await compileCellBirthDrainIntentV3(proof, { ...d.event, expectedProvisionItemSha256: await sha256Hex("different") }, v3Now + 10800000);
  assert.equal(await c.journal.claimOnce(proof, intent, signal()), null); assert.equal(c.invocations(), 1);
  c.setTime(v3Now + 14400000); const expired = await c.reader.readStrong({ signal: signal() }); assert.ok(expired);
  assert.ok((await c.journal.readStrong(expired, signal())).receipt); await assert.rejects(() => c.journal.claimOnce(expired, intent, signal()), /WINDOW/);
});
