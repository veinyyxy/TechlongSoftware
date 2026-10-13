import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CELL_PARENT_BOOTSTRAP_V4 as parent } from "../lib/deployments/execution/cell-parent-bootstrap-v4.ts";
import { CELL_PARENT_LOCK_GUARDS_V5, type CellParentLockedSnapshotV5 } from "../lib/deployments/execution/cell-parent-locked-update-v5.ts";
import { CELL_PARENT_V6_CODE_UPDATE_V9 as t, prepareV6CodeReviewV9, decodeV6CodeReviewV9, inspectLockedV6CodeSnapshotV9,
  v6CodeRequestV9, decodeV6UpdateSimulationV9, runV6CodeUpdateV9, type V6CodeUpdatePortV9 } from "../lib/deployments/execution/cell-parent-v6-code-update-v9.ts";

// Pure approval/transport tests, not credentials, live AWS metadata proof,
// Lambda invocation, DB simulation or deployment acceptance.
const at = Date.parse("2026-10-13T14:00:00Z"), code = "b".repeat(64);
const snapshot = (): CellParentLockedSnapshotV5 => ({ observedAt: at, function: { FunctionArn: `${t.functionArn}:$LATEST`, FunctionName: t.functionName, Version: "$LATEST", Role: parent.roleArn,
  CodeSha256: t.beforeCodeSha256, CodeSize: t.beforeZipBytes, RevisionId: t.beforeRevisionId, Runtime: "nodejs22.x", Handler: "cell-birth-coordinator-v4.handler",
  PackageType: "Zip", State: "Active", LastUpdateStatus: "Successful", Timeout: 120, MemorySize: 256, Architectures: ["x86_64"], Layers: null,
  EphemeralStorage: { Size: 512 }, RuntimeVersionConfig: { RuntimeVersionArn: "arn:aws:lambda:ca-central-1::runtime:" + "a".repeat(64), Error: null } },
  async: { FunctionArn: t.functionArn, MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0, DestinationConfig: { OnSuccess: {}, OnFailure: {} } },
  guards: Object.fromEntries(CELL_PARENT_LOCK_GUARDS_V5.map(k => [k, true])), facts: { roleId: t.roleId, runtimeManagement: { UpdateRuntimeOn: "Auto" } } });
async function fixture() {
  let clock = at, claims = 0, writes = 0; const state = snapshot();
  const review = await prepareV6CodeReviewV9(state, code, at), markers: string[] = [];
  const port: V6CodeUpdatePortV9 = { verifySourceAndFiles: async () => {}, readStable: async () => ({ ...structuredClone(state), observedAt: clock }), claimOnce: async () => ++claims === 1,
    marker: async name => { markers.push(name); }, updateOnce: async r => { writes++; assert.deepEqual(r.request, v6CodeRequestV9());
      Object.assign(state.function, { CodeSha256: t.zipCodeSha256, CodeSize: t.zipBytes, RevisionId: "new-code-revision-1234567", RuntimeVersionConfig: { RuntimeVersionArn: "arn:aws:lambda:ca-central-1::runtime:" + "c".repeat(64) } }); }, waitReady: async () => {} };
  return { review, port, now: () => clock, time: (n: number) => { clock = n; }, state: () => state, claims: () => claims, writes: () => writes, markers };
}
test("review cold-decodes exact single code request; no async rewrite, PublishTo, S3 or permission scope", async () => {
  const f = await fixture(); assert.equal((await decodeV6CodeReviewV9(f.review)).manifestSha256, f.review.manifestSha256);
  assert.deepEqual(v6CodeRequestV9(), { FunctionName: t.functionArn, RevisionId: t.beforeRevisionId, Architectures: ["x86_64"], Publish: false, DryRun: false });
  assert.equal(f.review.scope.maximumWriteCalls, 1); assert.equal(f.review.scope.existingAsyncConfigurationNotWritten, true);
  for (const r of [{ ...f.review, targets: { ...f.review.targets, zipSha256: code } }, { ...f.review, request: { ...f.review.request, RevisionId: "other" } },
    { ...f.review, scope: { ...f.review.scope, maximumWriteCalls: 2 } }, { ...f.review, risks: { ...f.review.risks, revisionCasDoesNotLockIamConcurrencyTableOrOtherServices: false } },
    { ...f.review, request: { ...f.review.request, Publish: true } }, { ...f.review, request: { ...f.review.request, S3Bucket: "other" } }]) await assert.rejects(decodeV6CodeReviewV9(r));
});
test("all lock gates, exact initial Revision/code, application config and existing async remain mandatory", async () => {
  for (const key of CELL_PARENT_LOCK_GUARDS_V5) { const s = snapshot(); s.guards[key] = false; await assert.rejects(inspectLockedV6CodeSnapshotV9(s, "before", at)); }
  for (const patch of [{ CodeSha256: "wrong" }, { RevisionId: "other-revision-12345" }, { CodeSize: 1 }, { Timeout: 121 }, { Environment: { Variables: { key: "private" } } }]) {
    const s = snapshot(); Object.assign(s.function, patch); await assert.rejects(inspectLockedV6CodeSnapshotV9(s, "before", at));
  }
  const s = snapshot(); s.async!.MaximumRetryAttempts = 1; await assert.rejects(inspectLockedV6CodeSnapshotV9(s, "before", at));
  await assert.rejects(inspectLockedV6CodeSnapshotV9(snapshot(), "before", at + 30001));
});
test("source simulation accepts exact two resources grouped or flat and rejects absent/denied/extra/duplicate results", () => {
  const resources = [t.functionArn, `${t.functionArn}:$LATEST`], flat = { EvaluationResults: resources.map(EvalResourceName => ({ EvalActionName: "lambda:UpdateFunctionCode", EvalResourceName, EvalDecision: "allowed" })) };
  assert.equal(decodeV6UpdateSimulationV9(flat).length, 2);
  assert.equal(decodeV6UpdateSimulationV9({ EvaluationResults: [{ EvalActionName: "lambda:UpdateFunctionCode", EvalDecision: "allowed", ResourceSpecificResults: resources.map(EvalResourceName => ({ EvalResourceName, EvalResourceDecision: "allowed" })) }] }).length, 2);
  for (const bad of [{ EvaluationResults: flat.EvaluationResults.slice(0, 1) }, { EvaluationResults: [...flat.EvaluationResults, flat.EvaluationResults[0]] },
    { IsTruncated: true, ...flat }, { EvaluationResults: flat.EvaluationResults.map(e => ({ ...e, EvalDecision: "implicitDeny" })) },
    { EvaluationResults: flat.EvaluationResults.map(e => ({ ...e, MissingContextValues: ["missing"] })) }]) assert.throws(() => decodeV6UpdateSimulationV9(bad));
});
test("wrong or expired approval and before drift stop without claiming or writing", async () => {
  for (const kind of ["sha", "code", "expiry", "drift"]) {
    const f = await fixture(); if (kind === "expiry") f.time(f.review.expiresAt); if (kind === "drift") f.state().facts = { changed: true };
    const r = await runV6CodeUpdateV9(f.review, kind === "sha" ? code : f.review.manifestSha256, kind === "code" ? "a".repeat(64) : code, f.port, f.now);
    assert.equal(f.claims(), 0); assert.equal(f.writes(), 0); assert.equal(r.updateCallEntered, false); assert.ok(r.phases.at(-1)?.failure);
  }
});
test("one code update preserves locks/async, accepts completion Revision/runtime patch difference, and cannot replay", async () => {
  const f = await fixture(), r = await runV6CodeUpdateV9(f.review, f.review.manifestSha256, code, f.port, f.now);
  assert.equal(r.outcome, "V6_CODE_SUBMITTED_INDEPENDENT_INSPECT_REQUIRED"); assert.equal(f.writes(), 1); assert.equal(r.responseReceived, true);
  assert.deepEqual(f.markers, ["locked-precheck.json", "code-attempt.json", "code-response.json", "code-final-metadata.json"]);
  const again = await runV6CodeUpdateV9(f.review, f.review.manifestSha256, code, { ...f.port, readStable: async () => snapshot() }, f.now);
  assert.equal(again.outcome, "V6_CODE_SLOT_OCCUPIED_INSPECT_ONLY"); assert.equal(f.writes(), 1);
});
test("lost response, readiness failure, post-update async drift and late age retain exact stop stage without retry", async () => {
  for (const kind of ["response", "ready", "async", "age"]) {
    const f = await fixture(); let calls = 0;
    const port = { ...f.port, marker: async (name: string) => { if (kind === "age" && name === "code-attempt.json") f.time(at + 30001); },
      updateOnce: async (r: typeof f.review) => { calls++; await f.port.updateOnce(r); if (kind === "response") throw Object.assign(Error("private detail"), { name: "PreconditionFailedException", codeUpdateOperation: "UpdateFunctionCode" }); },
      waitReady: async () => { if (kind === "ready") throw Error("V6_UPDATE_CODE_READY_NOT_OBSERVED"); if (kind === "async") f.state().async!.MaximumEventAgeInSeconds = 61; } };
    const r = await runV6CodeUpdateV9(f.review, f.review.manifestSha256, code, port, f.now);
    assert.equal(r.slotConsumed, true); assert.equal(calls, kind === "age" ? 0 : 1); assert.equal(r.retryAuthorized, false);
    assert.equal(r.stage, kind === "response" ? "CODE_SUBMISSION" : kind === "ready" ? "READONLY_READY" : kind === "async" ? "FINAL_FULL_LOCKED_READ" : "FINAL_WINDOW_AND_AGE");
    assert.doesNotMatch(JSON.stringify(r), /private detail/);
  }
});
test("partial slot save is uncertain but never enters code call or resets old slots", async () => {
  const f = await fixture(), r = await runV6CodeUpdateV9(f.review, f.review.manifestSha256, code, { ...f.port, claimOnce: async () => { throw Error("V6_UPDATE_SLOT_SAVE_FAILED"); } }, f.now);
  assert.equal(r.slotClaimAttempted, true); assert.equal(r.slotConsumed, false); assert.equal(r.updateCallEntered, false); assert.equal(r.stage, "PERMANENT_SLOT");
});
test("only one fixed signed PUT exists, redirect/retry disabled, ZIP stays in memory and no invoke/async/IAM/CFN write is present", async () => {
  const text = await readFile(new URL("../ops/aws-sandbox/scripts/cell-parent-v6-code-update-aws-v9.mjs", import.meta.url), "utf8");
  assert.equal((text.match(/\(\) => fetch\(/g) ?? []).length, 1); assert.match(text, /method: "PUT"/); assert.match(text, /redirect: "error"/); assert.match(text, /maxAttempts: 1/);
  assert.match(text, /ZipFile: zip\.toString\("base64"\)/); assert.match(text, /Date\.now\(\) - latestFull\.startedAt > 30000/);
  assert.doesNotMatch(text, /(?:Invoke|PutFunctionEventInvokeConfig|CreateStack|PutRolePolicy|CreatePolicyVersion)Command/);
});
