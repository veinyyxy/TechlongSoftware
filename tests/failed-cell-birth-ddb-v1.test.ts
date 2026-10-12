import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { compileFailedCellBirthFenceV1 } from "../lib/deployments/execution/failed-cell-birth-fence-v1.ts";
import { NeonFailedCellBirthSourceV1 } from "../lib/deployments/execution/neon-failed-cell-birth-source-v1.ts";
import { FAILED_BIRTH_DDB_KEYS_V1 as keys, prepareFailedBirthDdbMarkerV1, approveFailedBirthDdbMarkerV1, decodeFailedBirthDdbMarkerV1,
  prepareFailedBirthGuardedPublicationV1, prepareFailedBirthCompensationJournalIntentV1, type FailedBirthCompensationJournalIntentV1 } from "../lib/deployments/execution/failed-cell-birth-ddb-v1.ts";
import { AwsSdkFailedBirthDdbReaderV1, AwsSdkFailedBirthDdbMarkerWriterV1, AwsSdkFailedBirthCompensationJournalV1,
  assertFailedBirthDdbSnapshotV1 } from "../lib/deployments/execution/aws-sdk-failed-cell-birth-ddb-v1.ts";
import { AwsSdkFailedBirthDeletionRecoveryV1, assertFailedBirthDeletionObservationV1, type FailedBirthRecoverySdkV1 } from "../lib/deployments/execution/aws-sdk-failed-cell-birth-recovery-v1.ts";
import type { CellBirthRegistrySdkV3 } from "../lib/deployments/execution/aws-sdk-cell-birth-registry-v3.ts";
import { v3Fixture, v3Now, v3StackId } from "./fixtures/cell-stack-v3.ts";
import { sealedEvidenceFixture } from "./fixtures/sealed-cell-ownership-v3.ts";

const signal = () => new AbortController().signal, now = v3Now + 2000;
type Json = Record<string, unknown>;
// Atomic SDK transport fixture only. It deliberately models DynamoDB's same-
// token successful replay. It is not a real AWS/Neon acceptance proof.
function transport() {
  const items = new Map<string, Json>(), calls: { kind: string; input: Json }[] = [], tokens = new Map<string, string>();
  let lost = false, wrongIdentity = false;
  const commands = Object.fromEntries(["identity", "get", "transactGet", "transactWrite"].map(kind => [kind, class { kind = kind; input: Json; constructor(input: Json) { this.input = input; } }])) as unknown as CellBirthRegistrySdkV3["commands"];
  const send = async (raw: unknown) => {
    const c = raw as { kind: string; input: Json }; calls.push(structuredClone(c));
    if (c.kind === "identity") return { Account: "402010193138", Arn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev", UserId: wrongIdentity ? "WRONG" : "AIDAV3GNMXTZEO7SHLC2X" };
    const key = (x: Json) => String((x.Key as Json).authority_key);
    if (c.kind === "transactGet") return { Responses: (c.input.TransactItems as Json[]).map(x => { const v = items.get(key(x.Get as Json)); return v ? { Item: structuredClone(v) } : {}; }) };
    assert.equal(c.kind, "transactWrite"); const token = String(c.input.ClientRequestToken), fingerprint = canonicalJson(c.input);
    assert.match(token, /^[a-f0-9-]{36}$/);
    if (tokens.has(token)) { assert.equal(tokens.get(token), fingerprint); return {}; }
    const actions = c.input.TransactItems as Json[], touched: string[] = [];
    for (const a of actions) {
      const p = a.Put as Json | undefined, x = (a.ConditionCheck ?? p) as Json;
      const k = p ? String((p.Item as Json).authority_key) : key(x), existing = items.get(k); touched.push(k);
      if (x.ConditionExpression === "attribute_not_exists(#key)") { if (existing) throw Error("occupied"); }
      else { const vals = x.ExpressionAttributeValues as Json; if (!existing || existing.schema_version !== vals[":schema"] || existing.record_json !== vals[":json"]) throw Error("changed"); }
    }
    assert.equal(new Set(touched).size, touched.length, "a transaction must not touch one key twice");
    for (const a of actions) if (a.Put) { const v = (a.Put as Json).Item as Json; items.set(String(v.authority_key), structuredClone(v)); }
    tokens.set(token, fingerprint); if (lost) throw Error("provider secret detail must not escape"); return {};
  };
  const sdk: CellBirthRegistrySdkV3 = { ddb: { send }, sts: { send }, commands };
  return { sdk, items, calls, send, loseReply: () => { lost = true; }, wrongIdentity: () => { wrongIdentity = true; } };
}
async function context() {
  const failed = await v3Fixture("ARMED", "UPDATE_FAILED", "source_inspection"), f = await failed.read(); assert.ok("protocol" in f);
  const fence = await compileFailedCellBirthFenceV1({ plan: failed.plan, failure: f, environmentIdentitySha256: "e".repeat(64), expectedAdmissionEpoch: 0, now });
  const old = await sealedEvidenceFixture(), results = structuredClone(old.results);
  Object.assign(results[1].rows[0], { admission_state: "failed_unadmitted", admission_fence_sha256: fence.fenceSha256, admission_provision_operation_hash: null,
    admission_stack_id: v3StackId, admission_cell_expires_at: fence.intent.cellExpiresAt, admission_changed_at: now - 1000, observed_at: now });
  results.push({ rows: [{ environment_id: fence.intent.environmentId, fence_json: canonicalJson(fence.intent), fence_sha256: fence.fenceSha256, created_at: now - 1000 }] },
    { rows: [{ identity_sha256: "e".repeat(64) }] }, { rows: [{ protection_sha256: "f".repeat(64) }] }, { rows: [] }, { rows: [] });
  const zeroSource = new NeonFailedCellBirthSourceV1({ async transaction() { return structuredClone(results); } }, old.cert, "f".repeat(64));
  const zero = await zeroSource.readCertifiedUnadmittedSnapshot({ intent: fence.intent, fenceSha256: fence.fenceSha256, signal: signal() });
  const marker = await prepareFailedBirthDdbMarkerV1({ plan: failed.plan, failure: f, zero, now });
  const approval = await approveFailedBirthDdbMarkerV1({ marker, approvedMarkerSha256: marker.markerSha256, now });
  const t = transport(), reader = new AwsSdkFailedBirthDdbReaderV1(t.sdk, () => now), writer = new AwsSdkFailedBirthDdbMarkerWriterV1(t.sdk, failed.reader, zeroSource, () => now), journal = new AwsSdkFailedBirthCompensationJournalV1(t.sdk, () => now);
  return { failed, f, fence, zero, zeroSource, results, marker, approval, t, reader, writer, journal,
    install: () => writer.installOnce({ approval, plan: failed.plan, signal: signal() }) };
}
async function installed() { const c = await context(); assert.equal((await c.install()).outcome, "MARKER_SUBMITTED_REQUIRES_INDEPENDENT_READ");
  const snapshot = await c.reader.readStrong(signal()), intent = await prepareFailedBirthCompensationJournalIntentV1(c.marker, now); return { ...c, snapshot, intent }; }
function recoveryTransport(intent: FailedBirthCompensationJournalIntentV1) {
  const requests: { kind: string; input: Json }[] = [], events: Json[] = [{ StackId: v3StackId, EventId: "delete-final", PhysicalResourceId: v3StackId,
    LogicalResourceId: "techlong-sandbox-cell-sandbox-1", ResourceType: "AWS::CloudFormation::Stack", ResourceStatus: "DELETE_COMPLETE",
    Timestamp: new Date(now), ClientRequestToken: intent.request.ClientRequestToken }];
  const stack = { StackId: v3StackId, StackName: "techlong-sandbox-cell-sandbox-1", RoleARN: intent.request.RoleARN, StackStatus: "DELETE_COMPLETE" };
  let missing = false, changeStatus = false, repeatPage = false;
  const commands = Object.fromEntries(["identity", "describe", "events"].map(kind => [kind, class { kind = kind; input: Json; constructor(input: Json) { this.input = input; } }])) as unknown as FailedBirthRecoverySdkV1["commands"];
  let describes = 0;
  const send = async (raw: unknown) => { const c = raw as { kind: string; input: Json }; requests.push(structuredClone(c));
    if (c.kind === "identity") return { Account: "402010193138", Arn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev", UserId: "AIDAV3GNMXTZEO7SHLC2X" };
    assert.equal(c.input.StackName, v3StackId);
    if (missing) throw Error("Stack not found is not proof of deletion");
    if (c.kind === "describe") { describes++; return { Stacks: [{ ...stack, ...(changeStatus && describes > 1 ? { StackStatus: "DELETE_FAILED" } : {}) }] }; }
    if (c.kind === "events") return { StackEvents: structuredClone(events), ...(repeatPage ? { NextToken: "same-token" } : {}) };
    throw Error("no actuator in recovery SDK");
  };
  const sdk = { sts: { send }, cfn: { send }, commands }, reader = new AwsSdkFailedBirthDeletionRecoveryV1(sdk, () => now);
  return { reader, events, stack, requests, missing: () => { missing = true; }, drift: () => { changeStatus = true; }, repeatPage: () => { repeatPage = true; } };
}

test("marker review binds genuine fresh failed Stack and certified zero; never grants cloud deletion", async () => {
  const c = await context(); assert.equal(c.marker.scope.cloudDeletionAuthorized, false); assert.equal(c.marker.scope.legacyPublisherIsolationProved, false);
  const cold = await decodeFailedBirthDdbMarkerV1(structuredClone(c.marker)); assert.equal(cold.markerSha256, c.marker.markerSha256);
  await assert.rejects(() => prepareFailedBirthDdbMarkerV1({ plan: c.failed.plan, failure: structuredClone(c.f), zero: c.zero, now }));
  await assert.rejects(() => prepareFailedBirthDdbMarkerV1({ plan: c.failed.plan, failure: c.f, zero: structuredClone(c.zero), now }));
  await assert.rejects(() => approveFailedBirthDdbMarkerV1({ marker: c.marker, approvedMarkerSha256: "a".repeat(64), now }));
  await assert.rejects(() => approveFailedBirthDdbMarkerV1({ marker: c.marker, approvedMarkerSha256: c.marker.markerSha256, now: c.marker.expiresAt }));
  await assert.rejects(() => c.writer.installOnce({ approval: structuredClone(c.approval), plan: c.failed.plan, signal: signal() }));
  assert.equal(c.t.calls.some(x => x.kind === "transactWrite"), false);
});
test("marker CAS and guarded provision/activation publications exclude each other in both orders", async () => {
  for (const kind of ["provision", "activation"] as const) for (const first of ["marker", "publication"]) {
    const c = await context(), key = keys[kind], item = { authority_key: key, schema_version: 2, revision: 1, record_json: "{}" };
    const p = prepareFailedBirthGuardedPublicationV1(kind, item); assert.equal(p.publicationAuthorized, false);
    const publish = () => c.t.send(new c.t.sdk.commands.transactWrite({ ClientRequestToken: crypto.randomUUID(), TransactItems: p.TransactItems }));
    if (first === "marker") { await c.install(); await assert.rejects(publish); assert.equal(c.t.items.has(key), false); }
    else { await publish(); await assert.rejects(c.install); assert.equal(c.t.items.has(keys.marker), false); }
  }
});
test("marker catches authority introduced after pre-read, plus DB/CFN/source identity drift before mutation", async () => {
  for (const fault of ["concurrent", "db", "cfn", "identity"]) {
    const c = await context();
    if (fault === "db") c.results[11].rows[0].protection_sha256 = "a".repeat(64);
    if (fault === "cfn") c.failed.stack.StackStatus = "UPDATE_COMPLETE";
    if (fault === "identity") c.t.wrongIdentity();
    if (fault === "concurrent") {
      const oldSend = c.t.sdk.ddb.send; c.t.sdk.ddb.send = async (raw, options) => { const x = raw as { kind: string };
        if (x.kind === "transactWrite") c.t.items.set(keys.activation, { authority_key: keys.activation, schema_version: 2, revision: 1, record_json: "{}" }); return oldSend(raw, options); };
      // Writer pins methods at construction, so use a fresh writer for this test.
      const w = new AwsSdkFailedBirthDdbMarkerWriterV1(c.t.sdk, c.failed.reader, c.zeroSource, () => now);
      assert.equal((await w.installOnce({ approval: c.approval, plan: c.failed.plan, signal: signal() })).outcome, "MARKER_UNCERTAIN_INSPECT_ONLY");
    } else await assert.rejects(c.install);
    assert.equal(c.t.items.has(keys.marker), false);
  }
});
test("lost marker response leaves permanent marker readable, without success ownership or write retry", async () => {
  const c = await context(); c.t.loseReply(); const r = await c.install(); assert.equal(r.outcome, "MARKER_UNCERTAIN_INSPECT_ONLY"); assert.equal(r.deletionAuthorized, false);
  const s = await c.reader.readStrong(signal()); assert.ok(s.marker); assertFailedBirthDdbSnapshotV1(s, now, true);
  assert.throws(() => assertFailedBirthDdbSnapshotV1(structuredClone(s), now, true));
  const writes = c.t.calls.filter(x => x.kind === "transactWrite").length; await assert.rejects(c.install); assert.equal(c.t.calls.filter(x => x.kind === "transactWrite").length, writes);
});
test("one fixed journal slot wins concurrent reservation; payload/time changes never buy another slot", async () => {
  const c = await installed(), reserve = (intent = c.intent) => c.journal.reserveIntentOnce({ snapshot: c.snapshot, intent, approvedIntentSha256: intent.intentSha256, signal: signal() });
  const r = await Promise.all([reserve(), reserve()]); assert.equal(r.filter(x => x.outcome === "INTENT_RESERVED_REQUIRES_INDEPENDENT_READ").length, 1);
  assert.ok(r.every(x => x.deletionAuthorized === false && x.retryAuthorized === false)); assert.equal(c.t.items.size, 2);
  const changed = await prepareFailedBirthCompensationJournalIntentV1(c.marker, now + 1);
  const laterJournal = new AwsSdkFailedBirthCompensationJournalV1(c.t.sdk, () => now + 1);
  assert.equal((await laterJournal.reserveIntentOnce({ snapshot: c.snapshot, intent: changed, approvedIntentSha256: changed.intentSha256, signal: signal() })).outcome, "INTENT_UNCERTAIN_INSPECT_ONLY");
  const transactions = c.t.calls.filter(x => x.kind === "transactWrite"); assert.equal(new Set(transactions.map(x => x.input.ClientRequestToken)).size, transactions.length);
});
test("lost journal reply is recovered read-only, never converted into DeleteStack ownership", async () => {
  const c = await installed(); c.t.loseReply(); const r = await c.journal.reserveIntentOnce({ snapshot: c.snapshot, intent: c.intent, approvedIntentSha256: c.intent.intentSha256, signal: signal() });
  assert.equal(r.outcome, "INTENT_UNCERTAIN_INSPECT_ONLY"); const s = await c.reader.readStrong(signal()); assert.equal(s.intent?.intentSha256, c.intent.intentSha256);
  await assert.rejects(() => c.journal.reserveIntentOnce({ snapshot: s, intent: c.intent, approvedIntentSha256: c.intent.intentSha256, signal: signal() }), /OCCUPIED/);
  assert.equal(canonicalJson([...c.t.items.values()]).includes("provider secret detail"), false);
});
test("a legacy unguarded publisher can bypass a draft fence; strong journal read refuses its authority", async () => {
  const c = await installed();
  await c.t.send(new c.t.sdk.commands.transactWrite({ ClientRequestToken: crypto.randomUUID(), TransactItems: [
    { Put: { Item: { authority_key: keys.provision, schema_version: 2, revision: 1, record_json: "{}" }, ConditionExpression: "attribute_not_exists(#key)" } },
  ] }));
  const s = await c.reader.readStrong(signal()); assert.equal(s.provisionPresent, true); assert.equal(s.marker?.scope.legacyPublisherIsolationProved, false);
  await assert.rejects(() => c.journal.reserveIntentOnce({ snapshot: s, intent: c.intent, approvedIntentSha256: c.intent.intentSha256, signal: signal() }), /EXCLUSION_NOT_PROVED/);
});
test("cold journal request forbids name-only, wrong role, FORCE_DELETE and payload changes", async () => {
  const c = await installed();
  for (const request of [{ ...c.intent.request, StackName: "techlong-sandbox-cell-sandbox-1" }, { ...c.intent.request, DeletionMode: "FORCE_DELETE_STACK" },
    { ...c.intent.request, RoleARN: "other" }, { ...c.intent.request, RetainResources: ["CellVpc"] }]) {
    const draft = { ...c.intent, request }, intentSha256 = await sha256Hex(Object.fromEntries(Object.entries(draft).filter(([k]) => k !== "intentSha256")));
    await assert.rejects(() => c.journal.reserveIntentOnce({ snapshot: c.snapshot, intent: { ...draft, intentSha256 } as FailedBirthCompensationJournalIntentV1, approvedIntentSha256: intentSha256, signal: signal() }));
  }
  assert.equal(c.t.calls.filter(x => x.kind === "transactWrite").length, 1);
});
test("exact ARN recovery needs two stable latest matching token events; copy/foreign/newer/missing/drift rejects attribution", async () => {
  const c = await installed(), good = recoveryTransport(c.intent), o = await good.reader.inspect(c.marker, c.intent, signal());
  assert.equal(o.outcome, "DELETE_COMPLETE_TOKEN_MATCHED"); assertFailedBirthDeletionObservationV1(o, c.intent, now);
  assert.throws(() => assertFailedBirthDeletionObservationV1(structuredClone(o), c.intent, now));
  assert.ok(good.requests.every(x => ["identity", "describe", "events"].includes(x.kind)));
  for (const fault of ["foreign", "newer", "missing", "drift", "page", "old"]) {
    const t = recoveryTransport(c.intent);
    if (fault === "foreign") t.events[0].ClientRequestToken = "other-token";
    if (fault === "newer") t.events.push({ ...t.events[0], EventId: "newer", Timestamp: new Date(now + 1), ClientRequestToken: "other-token" });
    if (fault === "old") t.events[0].Timestamp = new Date(now - 1);
    if (fault === "missing") t.missing(); if (fault === "drift") t.drift(); if (fault === "page") t.repeatPage();
    if (["missing", "drift", "page"].includes(fault)) await assert.rejects(() => t.reader.inspect(c.marker, c.intent, signal()));
    else assert.equal((await t.reader.inspect(c.marker, c.intent, signal())).outcome, "PRESENT_NOT_ATTRIBUTED");
  }
});
test("only genuine terminal recovery writes immutable receipt, uncertain commit recovers without another write", async () => {
  const c = await installed(); await c.journal.reserveIntentOnce({ snapshot: c.snapshot, intent: c.intent, approvedIntentSha256: c.intent.intentSha256, signal: signal() });
  const s = await c.reader.readStrong(signal()), r = recoveryTransport(c.intent), o = await r.reader.inspect(c.marker, c.intent, signal());
  await assert.rejects(() => c.journal.publishReadOnlyReceiptOnce({ snapshot: s, observation: structuredClone(o), signal: signal() }));
  c.t.loseReply(); assert.equal((await c.journal.publishReadOnlyReceiptOnce({ snapshot: s, observation: o, signal: signal() })).outcome, "RECEIPT_UNCERTAIN_INSPECT_ONLY");
  const recovered = await c.reader.readStrong(signal()); assert.equal(recovered.receipt?.outcome, "DELETE_COMPLETE_TOKEN_MATCHED");
  await assert.rejects(() => c.journal.publishReadOnlyReceiptOnce({ snapshot: recovered, observation: o, signal: signal() }));
  assert.equal(c.t.items.size, 3);
});
test("orphan/drifted records and expired copied proofs never admit journal writes", async () => {
  const c = await installed(); c.t.items.set(keys.intent, { authority_key: keys.intent, schema_version: 3, record_json: "{}" }); await assert.rejects(() => c.reader.readStrong(signal()));
  c.t.items.delete(keys.marker); await assert.rejects(() => c.reader.readStrong(signal()), /ORPHAN/);
  const fresh = await installed(); assert.throws(() => assertFailedBirthDdbSnapshotV1(fresh.snapshot, now + 30001));
  await assert.rejects(() => fresh.journal.reserveIntentOnce({ snapshot: structuredClone(fresh.snapshot), intent: fresh.intent, approvedIntentSha256: fresh.intent.intentSha256, signal: signal() }));
});
