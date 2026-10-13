import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { RESERVED_RETIREMENT_V6 as t, prepareRetirementReviewV6, decodeRetirementReviewV6, runRetirementOnceV6,
  assertRetirementBeforeV6, classifyRetirementHistoryV6, type ReservedRetirementBeforeV6, type ReservedRetirementPortV6,
  type RetirementHistoryFrameV6 } from "../lib/deployments/execution/cell-reserved-retirement-v6.ts";

// Small pure approval/once-transport tests. These fixtures are NOT live AWS
// evidence, credential simulation, or effective permission/paid deployment proof.
const code = "b".repeat(64), at = Date.parse(t.cellExpiresAt) + 60000;
async function fixture() {
  const before: ReservedRetirementBeforeV6 = { observedAt: at, stackId: t.stackId, stableStackSha256: t.stableStackSha256,
    parentCommonSha256: t.parentCommonSha256, foundationSha256: t.foundationSha256,
    zeroResourcesReservedAndFlagsVerified: true, noChangeSetsOrNonCreationEvents: true, sourceDeleteAndPassRoleSimulated: true };
  const manifest = await prepareRetirementReviewV6(before, code, at);
  let clock = at, claims = 0, calls = 0, reads = 0;
  const markers: string[] = [], port: ReservedRetirementPortV6 = { verifyFilesAndSource: async () => {},
    readBefore: async () => { reads++; return { ...before, observedAt: clock }; }, claimOnce: async () => ++claims === 1,
    marker: async name => { markers.push(name); }, deleteOnce: async request => { calls++; assert.deepEqual(request, manifest.request); } };
  return { before, manifest, port, now: () => clock, time: (v: number) => { clock = v; }, claims: () => claims, calls: () => calls, reads: () => reads, markers };
}
test("retirement request binds exact irreversible old UUID, existing role and STANDARD only", async () => {
  const f = await fixture(), r = await decodeRetirementReviewV6(f.manifest);
  assert.equal(r.request.StackName, t.stackId); assert.equal(r.request.RoleARN, t.roleArn); assert.equal(r.request.DeletionMode, "STANDARD");
  assert.match(r.request.ClientRequestToken, /^cell-v6-retire-[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(r.request).sort(), ["ClientRequestToken", "DeletionMode", "RoleARN", "StackName"]);
  assert.notEqual(t.permanentSlot, "techlong-f3c9h-reserved-identity-create.permanent-slot.json");
  assert.equal(r.scope.maximumWriteCalls, 1); assert.equal(r.risks.concurrentPhaseUpdateCouldCauseResourceDeletion, true);
});
test("rehashed expanded requests, scope, old identity, risk and clocks do not cold-decode", async () => {
  const f = await fixture();
  for (const kind of ["name", "otherUUID", "force", "retain", "scope", "risk", "clock", "history"]) {
    const bad = structuredClone(f.manifest);
    if (kind === "name") bad.request.StackName = t.stackName;
    if (kind === "otherUUID") bad.request.StackName = t.stackId.slice(0, -1) + "a";
    if (kind === "force") bad.request.DeletionMode = "FORCE_DELETE_STACK" as never;
    if (kind === "retain") Object.assign(bad.request, { RetainResources: [] });
    if (kind === "scope") bad.scope.maximumWriteCalls = 2 as never;
    if (kind === "risk") bad.risks.exactIdentityUuidIrrecoverable = false as never;
    if (kind === "clock") bad.expiresAt++;
    if (kind === "history") bad.before.stableStackSha256 = code;
    bad.requestSha256 = await sha256Hex(bad.request); const { manifestSha256: unused, ...body } = bad; void unused;
    bad.manifestSha256 = await sha256Hex(body); await assert.rejects(decodeRetirementReviewV6(bad));
  }
});
test("live birth, stale evidence, lock/role/template/resource/event/simulation drift reject", async () => {
  const f = await fixture();
  assert.throws(() => assertRetirementBeforeV6({ ...f.before, observedAt: Date.parse(t.cellExpiresAt) - 1 }, Date.parse(t.cellExpiresAt) - 1));
  assert.throws(() => assertRetirementBeforeV6(f.before, at + 30001));
  for (const key of ["stableStackSha256", "parentCommonSha256", "foundationSha256", "stackId"]) assert.throws(() => assertRetirementBeforeV6({ ...f.before, [key]: code }, at));
  for (const key of ["zeroResourcesReservedAndFlagsVerified", "noChangeSetsOrNonCreationEvents", "sourceDeleteAndPassRoleSimulated"]) assert.throws(() => assertRetirementBeforeV6({ ...f.before, [key]: false }, at));
});
test("wrong SHA, code or expired approval never consumes slot or enters deletion", async () => {
  for (const kind of ["sha", "code", "expired", "early"]) {
    const f = await fixture(); if (kind === "expired") f.time(f.manifest.expiresAt); if (kind === "early") f.time(at - 1);
    const r = await runRetirementOnceV6(f.manifest, kind === "sha" ? code : f.manifest.manifestSha256, kind === "code" ? "a".repeat(64) : code, f.port, f.now);
    assert.equal(r.slotConsumed, false); assert.equal(r.deleteCallEntered, false); assert.equal(f.claims(), 0); assert.equal(f.calls(), 0);
  }
});
test("exact single submission requires two live prechecks and saved permanent claim; replay stops", async () => {
  const f = await fixture(), r = await runRetirementOnceV6(f.manifest, f.manifest.manifestSha256, code, f.port, f.now);
  assert.equal(r.outcome, "RETIREMENT_DELETE_SUBMITTED_INDEPENDENT_INSPECT_REQUIRED"); assert.equal(r.slotConsumed, true); assert.equal(r.responseReceived, true);
  assert.equal(f.calls(), 1); assert.equal(f.reads(), 2); assert.deepEqual(f.markers, ["delete-attempt.json", "delete-response.json"]);
  const again = await runRetirementOnceV6(f.manifest, f.manifest.manifestSha256, code, f.port, f.now);
  assert.equal(again.outcome, "RETIREMENT_SLOT_OCCUPIED_INSPECT_ONLY"); assert.equal(f.calls(), 1);
});
test("response loss, marker/file failure, late expiry and post-claim drift never retry or compensate", async () => {
  for (const kind of ["response", "marker", "files", "late", "drift"]) {
    const f = await fixture(); let calls = 0, reads = 0, checks = 0;
    const port = { ...f.port,
      verifyFilesAndSource: async () => { checks++; if (kind === "files" && checks === 3) throw Error("private data"); },
      readBefore: async () => { reads++; return { ...f.before, observedAt: f.now(), ...(kind === "drift" && reads === 2 ? { zeroResourcesReservedAndFlagsVerified: false } : {}) }; },
      marker: async (name: string) => { if (kind === "marker") throw Error("disk"); if (kind === "late" && name === "delete-attempt.json") f.time(f.manifest.expiresAt); },
      deleteOnce: async () => { calls++; if (kind === "response") throw Error("PRIVATE_PROVIDER_DETAIL"); } };
    const r = await runRetirementOnceV6(f.manifest, f.manifest.manifestSha256, code, port, f.now);
    assert.equal(r.slotConsumed, true); assert.equal(calls, kind === "response" ? 1 : 0); assert.equal(r.retryAuthorized, false);
    assert.equal(r.runtimeEnabled, false); assert.doesNotMatch(JSON.stringify(r), /PRIVATE_PROVIDER_DETAIL/);
  }
});
test("partial slot-save failure reports claim uncertainty and never submits deletion", async () => {
  const f = await fixture();
  const r = await runRetirementOnceV6(f.manifest, f.manifest.manifestSha256, code, { ...f.port, claimOnce: async () => { throw Error("partial save"); } }, f.now);
  assert.equal(r.slotClaimAttempted, true); assert.equal(r.slotConsumed, false); assert.equal(r.deleteCallEntered, false); assert.equal(f.calls(), 0);
  // slotConsumed=false only means the runner did not receive a successful
  // save, not evidence that no partial permanent file exists on disk.
  assert.equal(r.retryAuthorized, false);
});
test("deleted acceptance requires exact historical UUID, zero inventory, original birth and matching deletion attribution", () => {
  const frame: RetirementHistoryFrameV6 = { stackId: t.stackId, stackName: t.stackName, status: "DELETE_COMPLETE", zeroResourcesAndOriginalBindingsVerified: true,
    noOtherLiveCell: true, birthEventsVerified: true, deletionEventsVerified: true, deletionTime: new Date(at).toISOString() };
  assert.equal(classifyRetirementHistoryV6(frame, true), "RETIREMENT_ZERO_RESOURCE_DELETION_INDEPENDENTLY_VERIFIED");
  assert.throws(() => classifyRetirementHistoryV6(frame, false));
  for (const key of ["zeroResourcesAndOriginalBindingsVerified", "noOtherLiveCell", "birthEventsVerified", "deletionEventsVerified"]) assert.throws(() => classifyRetirementHistoryV6({ ...frame, [key]: false }, true));
  for (const status of ["ABSENT", "DELETE_FAILED", "UPDATE_COMPLETE", "CREATE_FAILED"]) assert.throws(() => classifyRetirementHistoryV6({ ...frame, status }, true));
  assert.throws(() => classifyRetirementHistoryV6({ ...frame, deletionTime: null }, true));
  assert.throws(() => classifyRetirementHistoryV6({ ...frame, stackId: t.stackName }, true));
  assert.equal(classifyRetirementHistoryV6({ ...frame, status: "DELETE_IN_PROGRESS", deletionTime: null }, true), "RETIREMENT_DELETE_PENDING_INSPECT_ONLY");
  assert.equal(classifyRetirementHistoryV6({ ...frame, status: "CREATE_COMPLETE", deletionEventsVerified: false, deletionTime: null }, false), "RETIREMENT_NOT_DELETED_INSPECT_ONLY");
});
test("native actuator has one DeleteStack call, maxAttempts1, exact reviewed input and no other writes", async () => {
  const source = await readFile(new URL("../ops/aws-sandbox/scripts/cell-reserved-retirement-aws-v6.mjs", import.meta.url), "utf8");
  assert.equal((source.match(/call\(cfn, DeleteStackCommand/g) ?? []).length, 1); assert.match(source, /maxAttempts: 1/);
  assert.match(source, /if \(entered \|\|/); assert.match(source, /entered = true/);
  assert.doesNotMatch(source, /(?:CreateStack|UpdateStack|CreateChangeSet|ExecuteChangeSet|PutRolePolicy|CreatePolicyVersion|Invoke|UpdateFunctionCode)Command/);
  assert.match(source, /StackName: t\.stackId/); assert.match(source, /TemplateStage: "Original"/); assert.match(source, /HISTORY_DOUBLE_READ_DRIFT/);
});
