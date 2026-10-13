import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { CELL_RESERVATION_V5 as t, CELL_RESERVATION_SCOPE_V5, CELL_RESERVATION_RISKS_V5, reservationRequestV5,
  reservationParentCommonHashV5, decodeReservationReviewV5, prepareReservationReviewV5, runReservationOnceV5, assertReservedEvidenceV5,
  type CellReservationReviewV5, type ReservationPortV5 } from "../lib/deployments/execution/cell-reservation-v5.ts";
import { CELL_PARENT_LOCK_GUARDS_V5, CELL_PARENT_LOCKED_UPDATE_V5 as artifact, type CellParentLockedSnapshotV5 } from "../lib/deployments/execution/cell-parent-locked-update-v5.ts";
import { v3Fixture, v3Now, v3StackId } from "./fixtures/cell-stack-v3.ts";

// Pure request/approval/transport tests; no provider, credentials, isolated DB,
// cloud probe or mocked live deployment. Synthetic hashes are NOT AWS proof.
const code = "b".repeat(64);
async function fixture() {
  const f = await v3Fixture("RESERVED", "CREATE_COMPLETE", "source_inspection"), plan = f.plan;
  const parent: CellParentLockedSnapshotV5 = { observedAt: v3Now,
    function: { FunctionArn: `${artifact.functionArn}:$LATEST`, FunctionName: artifact.functionName, Version: "$LATEST", RevisionId: t.parentRevisionId, CodeSha256: artifact.zipCodeSha256Base64 },
    async: { FunctionArn: artifact.functionArn, MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0, DestinationConfig: { OnSuccess: {}, OnFailure: {} } },
    guards: Object.fromEntries(CELL_PARENT_LOCK_GUARDS_V5.map(k => [k, true])), facts: { exact: "fake-transport-facts" } };
  const foundation = { role: { Arn: t.roleArn, RoleId: t.roleId, AssumeRolePolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "cloudformation.amazonaws.com" }, Action: "sts:AssumeRole" }] },
    PermissionsBoundary: { PermissionsBoundaryArn: t.boundaryArn }, inline: [], attached: [] }, boundary: { arn: t.boundaryArn, defaultVersion: "v1", document: { Version: "2012-10-17", Statement: [] }, versions: [] },
    foundationMetadataVerified: true, sourceCreateAllowed: true, sourcePassRoleAllowed: true };
  const request = reservationRequestV5(plan);
  const body = { schemaVersion: 5 as const, protocol: "cell-reserved-identity-create-review-v5" as const, reviewedAt: v3Now, expiresAt: v3Now + 3600000,
    targets: t, codeBindingSha256: code, plan, request, requestSha256: await sha256Hex(request), parentCommonSha256: await reservationParentCommonHashV5(parent, true, v3Now),
    foundation, foundationSha256: await sha256Hex(foundation), scope: CELL_RESERVATION_SCOPE_V5, risks: CELL_RESERVATION_RISKS_V5 };
  const review: CellReservationReviewV5 = { ...body, manifestSha256: await sha256Hex(body) };
  let clock = v3Now, claims = 0, writes = 0;
  const markers: string[] = [], port: ReservationPortV5 = { verifyFilesAndSource: async () => {},
    readBefore: async () => ({ parent, foundation, absence: true }), claimOnce: async () => ++claims === 1,
    marker: async name => { markers.push(name); }, createOnce: async actual => { writes++; assert.equal(canonicalJson(actual), canonicalJson(request)); return v3StackId; }, waitReadOnly: async () => {} };
  return { f, plan, parent, foundation, review, port, markers, claims: () => claims, writes: () => writes, now: () => clock, time: (value: number) => { clock = value; } };
}

test("RESERVED uses the full deterministic blueprint but no resource, IAM capability, S3 upload or future phase", async () => {
  const f = await fixture(), request = reservationRequestV5(f.plan);
  assert.equal(request.RoleARN, t.roleArn); assert.equal(request.DisableRollback, true); assert.equal(request.EnableTerminationProtection, false);
  assert.equal(request.ClientRequestToken, f.plan.reservationClientToken); assert.equal(request.TimeoutInMinutes, 5);
  assert.equal(request.Parameters.find(x => x.ParameterKey === "LifecyclePhase")?.ParameterValue, "RESERVED");
  for (const key of ["Capabilities", "TemplateURL", "OnFailure", "NotificationARNs", "StackPolicyBody"]) assert.equal(Object.hasOwn(request, key), false);
  assert.ok(f.plan.resourceLogicalIds.length > 1); assert.equal(f.plan.safety.reservedResourceCount, 0);
  assert.throws(() => reservationRequestV5(structuredClone(f.plan)), /PROVENANCE/);
  // A synthetic transport cannot pass the live-installed snapshot binding.
  await assert.rejects(prepareReservationReviewV5(f.plan, f.parent, f.foundation, code, v3Now));
});
test("cold decoding reconstructs all conditions and exact request; changed or rehashed expanded scope rejects", async () => {
  const f = await fixture(); assert.equal((await decodeReservationReviewV5(f.review)).manifestSha256, f.review.manifestSha256);
  for (const mutate of [(r: CellReservationReviewV5) => { r.request.DisableRollback = false as never; },
    (r: CellReservationReviewV5) => { r.request.Parameters.find(x => x.ParameterKey === "LifecyclePhase")!.ParameterValue = "PAID"; },
    (r: CellReservationReviewV5) => { r.scope.maximumWriteCalls = 2 as never; },
    (r: CellReservationReviewV5) => { r.foundation.role = { ...(r.foundation.role as object), inline: ["new-policy"] }; },
    (r: CellReservationReviewV5) => { r.expiresAt++; },
    (r: CellReservationReviewV5) => { r.plan.template.Conditions = {}; }]) {
    const bad = structuredClone(f.review); mutate(bad); const { manifestSha256: ignored, ...body } = bad; void ignored;
    bad.manifestSha256 = await sha256Hex(body); await assert.rejects(decodeReservationReviewV5(bad));
  }
});
test("wrong/expired SHA or changed code stops before slot claim or write", async () => {
  for (const kind of ["approval", "code", "expired", "before-window"]) {
    const f = await fixture(); if (kind === "expired") f.time(f.review.expiresAt); if (kind === "before-window") f.time(v3Now - 1);
    const r = await runReservationOnceV5(f.review, kind === "approval" ? "0".repeat(64) : f.review.manifestSha256, kind === "code" ? "0".repeat(64) : code, f.port, f.now);
    assert.equal(r.createCallEntered, false); assert.equal(f.claims(), 0); assert.equal(f.writes(), 0);
  }
});
test("locked state/foundation/absence drift stops before consuming permanent slot", async () => {
  for (const kind of ["parent", "foundation", "absence", "files"]) {
    const f = await fixture(); if (kind === "parent") f.parent.guards.concurrencyZero = false;
    if (kind === "foundation") f.foundation.role.inline = ["policy"] as never;
    const port = { ...f.port, ...(kind === "absence" ? { readBefore: async () => ({ parent: f.parent, foundation: f.foundation, absence: false }) } : {}),
      ...(kind === "files" ? { verifyFilesAndSource: async () => { throw Error("private detail"); } } : {}) };
    const r = await runReservationOnceV5(f.review, f.review.manifestSha256, code, port, f.now);
    assert.equal(r.slotConsumed, false); assert.equal(f.claims(), 0); assert.equal(f.writes(), 0);
  }
});
test("one exact create is preceded by permanent claim/marker; second run cannot replay it", async () => {
  const f = await fixture(), r = await runReservationOnceV5(f.review, f.review.manifestSha256, code, f.port, f.now);
  assert.match(r.outcome, /INDEPENDENT_INSPECT_REQUIRED/); assert.equal(r.slotConsumed, true); assert.equal(r.stackId, v3StackId); assert.equal(f.writes(), 1);
  assert.deepEqual(f.markers, ["create-attempt.json", "create-response.json"]);
  const again = await runReservationOnceV5(f.review, f.review.manifestSha256, code, f.port, f.now);
  assert.match(again.outcome, /SLOT_OCCUPIED/); assert.equal(f.writes(), 1); assert.equal(again.retryAuthorized, false);
});
test("lost create response and readiness failure do not retry, compensate or hide permanent consumption", async () => {
  for (const kind of ["response", "readiness", "marker", "late-window"]) {
    const f = await fixture(); let calls = 0;
    const port = { ...f.port, createOnce: async () => { calls++; if (kind === "response") throw Error("PRIVATE_PROVIDER_DETAIL"); return v3StackId; },
      waitReadOnly: async () => { if (kind === "readiness") throw Error("read failed"); },
      marker: async (name: string) => { if (kind === "marker") throw Error("disk failed"); if (kind === "late-window" && name === "create-attempt.json") f.time(f.review.expiresAt); } };
    const r = await runReservationOnceV5(f.review, f.review.manifestSha256, code, port, f.now);
    assert.equal(r.slotConsumed, true); assert.equal(calls, ["marker", "late-window"].includes(kind) ? 0 : 1);
    assert.equal(r.retryAuthorized, false); assert.equal(r.runtimeEnabled, false); assert.doesNotMatch(JSON.stringify(r), /PRIVATE_PROVIDER/);
  }
});
test("post-create parent comparison truthfully requires absent=false; every other fact/revision remains exact", async () => {
  const f = await fixture(), s = structuredClone(f.parent); s.guards.cellStackAbsent = false;
  assert.equal(await reservationParentCommonHashV5(s, false, v3Now), f.review.parentCommonSha256);
  await assert.rejects(reservationParentCommonHashV5(s, true, v3Now));
  s.guards.emptyRolePolicies = false; await assert.rejects(reservationParentCommonHashV5(s, false, v3Now));
  s.guards.emptyRolePolicies = true; s.function.RevisionId = "changed"; await assert.rejects(reservationParentCommonHashV5(s, false, v3Now));
});
test("independent acceptance needs genuine V3 proof, exact source/phase/template/token and zero resources", async () => {
  const f = await fixture(), proof = await f.f.read(); assert.ok("protocol" in proof);
  assert.doesNotThrow(() => assertReservedEvidenceV5(f.review, proof));
  assert.throws(() => assertReservedEvidenceV5(f.review, structuredClone(proof)), /PROVENANCE/);
  for (const phase of ["ARMED", "PAID"] as const) {
    const other = await v3Fixture(phase, "CREATE_COMPLETE", "source_inspection"), evidence = await other.read(); assert.ok("protocol" in evidence);
    assert.throws(() => assertReservedEvidenceV5(f.review, evidence));
  }
});
test("AWS adapter exposes no second cloud mutation family and explicitly disables SDK retries", async () => {
  const source = await readFile(new URL("../ops/aws-sandbox/scripts/cell-reservation-aws-v5.mjs", import.meta.url), "utf8");
  assert.equal((source.match(/call\(cfn, CreateStackCommand/g) ?? []).length, 1); assert.match(source, /maxAttempts: 1/);
  assert.doesNotMatch(source, /new (?:Update|Delete|Put|Invoke|CreateChangeSet|ExecuteChangeSet)[A-Za-z]*Command/);
  assert.match(source, /if \(entered \|\|/); assert.match(source, /entered = true/);
});
