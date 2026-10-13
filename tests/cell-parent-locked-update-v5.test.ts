import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalJson } from "../lib/deployments/execution/hash.ts";
import { CELL_PARENT_BOOTSTRAP_V4 as old } from "../lib/deployments/execution/cell-parent-bootstrap-v4.ts";
import { CELL_PARENT_LOCKED_UPDATE_V5 as t, CELL_PARENT_LOCK_GUARDS_V5, cellParentFunctionInvariantV5,
  cellParentAsyncStateV5, prepareCellParentLockedUpdateReviewV5, decodeCellParentLockedUpdateReviewV5,
  inspectCellParentLockedSnapshotV5, runCellParentLockedUpdateV5, cellParentLockedUpdateRequestsV5,
  decodeCellParentUpdateSimulationV5,
  type CellParentLockedSnapshotV5, type CellParentLockedUpdatePortV5 } from "../lib/deployments/execution/cell-parent-locked-update-v5.ts";
const at = Date.parse("2026-10-13T02:50:00Z"), code = "b".repeat(64);
// Fake metadata/native transports only, no credentials/provider calls or
// isolated DB/Cell simulation. These tests do not prove effective AWS deny.
const snapshot = (): CellParentLockedSnapshotV5 => ({ observedAt: at,
  function: { FunctionArn: `${t.functionArn}:$LATEST`, FunctionName: t.functionName, Version: "$LATEST", Role: old.roleArn,
    CodeSha256: t.beforeZipCodeSha256Base64, CodeSize: 429713, RevisionId: t.beforeRevisionId, Runtime: "nodejs22.x",
    Handler: "cell-birth-coordinator-v4.handler", State: "Active", LastUpdateStatus: "Successful", PackageType: "Zip", Timeout: 120, MemorySize: 256,
    Architectures: ["x86_64"], Layers: null, EphemeralStorage: { Size: 512 }, TracingConfig: { Mode: "PassThrough" },
    RuntimeVersionConfig: { RuntimeVersionArn: "arn:aws:lambda:ca-central-1::runtime:" + "a".repeat(64), Error: null } },
  async: null, guards: Object.fromEntries(CELL_PARENT_LOCK_GUARDS_V5.map(k => [k, true])), facts: { roleId: t.roleId, runtimeManagement: { UpdateRuntimeOn: "Auto" } },
});
async function fixture() {
  let now = at, state = snapshot(), claims = 0, reads = 0, loseAt: number | null = null, failWait = false;
  const writes: number[] = [], markers: string[] = [], review = await prepareCellParentLockedUpdateReviewV5(state, code, now);
  const port: CellParentLockedUpdatePortV5 = {
    verifySourceAndFiles: async () => {}, readStable: async () => { reads++; return structuredClone(state); },
    claimPermanentOnce: async () => { claims++; return claims === 1; }, marker: async name => { markers.push(name); },
    write: async index => {
      writes.push(index);
      if (index === 0) Object.assign(state.function, { CodeSha256: t.zipCodeSha256Base64, CodeSize: t.zipBytes, RevisionId: "completion-revision-123456",
        LastModified: new Date(now).toISOString(), RuntimeVersionConfig: { RuntimeVersionArn: "arn:aws:lambda:ca-central-1::runtime:" + "c".repeat(64) } });
      else state.async = { FunctionArn: `${t.functionArn}:$LATEST`, MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0, DestinationConfig: { OnSuccess: {}, OnFailure: {} }, LastModified: now / 1000 };
      if (loseAt === index) throw Error("PRIVATE_DIAGNOSTIC");
    }, waitCodeReady: async () => { if (failWait) throw Error("uncertain readiness"); },
  };
  return { review, port, writes, markers, now: () => now, state: () => state, claims: () => claims, reads: () => reads,
    setState: (s: CellParentLockedSnapshotV5) => { state = s; }, setTime: (n: number) => { now = n; }, lose: (index: number) => { loseAt = index; }, waitFails: () => { failWait = true; } };
}
test("cold review is exact scope/artifact/old Revision/time/code binding, not a generic update capability", async () => {
  const f = await fixture(); assert.equal((await decodeCellParentLockedUpdateReviewV5(JSON.parse(JSON.stringify(f.review)))).manifestSha256, f.review.manifestSha256);
  for (const drift of [{ ...f.review, scope: { ...f.review.scope, maximumWriteCalls: 3 } }, { ...f.review, targets: { ...f.review.targets, functionArn: t.functionArn + "-other" } },
    { ...f.review, expiresAt: f.review.expiresAt + 1 }, { ...f.review, codeBindingSha256: "0".repeat(64) }, { ...f.review, manifestSha256: "0".repeat(64) }])
    await assert.rejects(decodeCellParentLockedUpdateReviewV5(drift));
  assert.equal(f.review.scope.noIamTableSecretDatabaseOrCellWrite, true); assert.equal(f.review.risks.asyncApiHasNoRevisionCas, true);
});
test("only the two fixed requests exist: existing Revision code/Publish false then exact latest async", () => {
  const requests = cellParentLockedUpdateRequestsV5(); assert.equal(requests.length, 2);
  assert.equal(requests[0].input.RevisionId, t.beforeRevisionId); assert.equal(requests[0].input.Publish, false);
  assert.equal(requests[0].input.FunctionName, t.functionArn); assert.equal(requests[1].input.Qualifier, "$LATEST");
  assert.equal(requests[1].input.MaximumEventAgeInSeconds, 60); assert.equal(requests[1].input.MaximumRetryAttempts, 0);
  assert.doesNotMatch(canonicalJson(requests), /InvokeFunction|PutRole|Delete|Create|ReservedConcurrentExecutions/);
});
test("metadata and zero-concurrency/deny-all/source/slots gates are fail-closed and fresh", async () => {
  for (const key of CELL_PARENT_LOCK_GUARDS_V5) { const s = snapshot(); s.guards[key] = false; await assert.rejects(inspectCellParentLockedSnapshotV5(s, "before", at)); }
  for (const drift of [{ CodeSha256: "wrong" }, { RevisionId: "other-revision-1234" }, { FunctionArn: `${t.functionArn}:current` }, { Environment: { Variables: { secret: "private" } } },
    { Timeout: 121 }, { Layers: [{ Arn: "layer" }] }, { RuntimeVersionConfig: { Error: { Message: "private" } } }]) {
    const s = snapshot(); Object.assign(s.function, drift); await assert.rejects(inspectCellParentLockedSnapshotV5(s, "before", at));
  }
  await assert.rejects(inspectCellParentLockedSnapshotV5(snapshot(), "before", at + 30001));
});
test("all application config and unknown config fields are preserved, provider outputs are distinguished", () => {
  const s = snapshot(), changed = structuredClone(s.function);
  Object.assign(changed, { CodeSha256: t.zipCodeSha256Base64, CodeSize: t.zipBytes, RevisionId: "other-revision-1234", LastModified: "new", LastUpdateStatus: "Successful",
    RuntimeVersionConfig: { RuntimeVersionArn: "arn:aws:lambda:ca-central-1::runtime:" + "c".repeat(64) } });
  assert.deepEqual(cellParentFunctionInvariantV5(changed), cellParentFunctionInvariantV5(s.function));
  for (const drift of [{ EphemeralStorage: { Size: 1024 } }, { LoggingConfig: { LogFormat: "JSON" } }, { UnknownNewConfig: "value" }])
    assert.notDeepEqual(cellParentFunctionInvariantV5({ ...changed, ...drift }), cellParentFunctionInvariantV5(s.function));
});
test("wrong or expired approval and code binding cannot consume a slot or dispatch a write", async () => {
  const f = await fixture(); await assert.rejects(runCellParentLockedUpdateV5(f.review, "0".repeat(64), code, f.port, f.now));
  await assert.rejects(runCellParentLockedUpdateV5(f.review, f.review.manifestSha256, "0".repeat(64), f.port, f.now));
  f.setTime(f.review.expiresAt); const r = await runCellParentLockedUpdateV5(f.review, f.review.manifestSha256, code, f.port, f.now);
  assert.equal(r.writesAttempted, 0); assert.equal(f.claims(), 0); assert.equal(f.reads(), 0);
});
test("same runner performs code then async while recording the stable completion Revision, no enablement", async () => {
  const f = await fixture(), r = await runCellParentLockedUpdateV5(f.review, f.review.manifestSha256, code, f.port, f.now);
  assert.equal(r.outcome, "LOCKED_CODE_ASYNC_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT"); assert.deepEqual(f.writes, [0, 1]);
  assert.equal(r.slotConsumed, true); assert.equal(r.candidateRevision, "completion-revision-123456"); assert.equal(r.retryAuthorized, false); assert.equal(r.runtimeEnabled, false);
  assert.deepEqual(f.markers, ["approved-manifest.json", "1-attempt.json", "1-response-received.json", "2-attempt.json", "2-response-received.json", "final-metadata.json"]);
});
test("source/prestate/file drift before claim leaves slot empty; occupied slot dispatches nothing", async () => {
  const f = await fixture(), s = f.state(); s.function.EphemeralStorage = { Size: 1024 };
  const r = await runCellParentLockedUpdateV5(f.review, f.review.manifestSha256, code, f.port, f.now);
  assert.equal(r.writesAttempted, 0); assert.equal(f.claims(), 0);
  f.setState(snapshot()); const occupied = await runCellParentLockedUpdateV5(f.review, f.review.manifestSha256, code, { ...f.port, claimPermanentOnce: async () => false }, f.now);
  assert.equal(occupied.writesAttempted, 0); assert.match(occupied.outcome, /SLOT_OCCUPIED/);
});
test("lost code response or read-only wait failure stops after one dispatch, without async or rollback", async () => {
  for (const failure of ["response", "wait"]) {
    const f = await fixture(); if (failure === "response") f.lose(0); else f.waitFails();
    const r = await runCellParentLockedUpdateV5(f.review, f.review.manifestSha256, code, f.port, f.now);
    assert.deepEqual(f.writes, [0]); assert.equal(r.slotConsumed, true); assert.equal(r.writesAttempted, 1); assert.equal(r.retryAuthorized, false);
    assert.equal(f.state().function.CodeSha256, t.zipCodeSha256Base64); assert.equal(f.state().async, null); assert.doesNotMatch(JSON.stringify(r), /PRIVATE_DIAGNOSTIC/);
  }
});
test("late async-prestate, role or concurrency drift cannot be overwritten by the second call", async () => {
  for (const change of ["async", "role", "concurrency"]) {
    const f = await fixture(), wait = f.port.waitCodeReady;
    const r = await runCellParentLockedUpdateV5(f.review, f.review.manifestSha256, code, { ...f.port, waitCodeReady: async () => {
      await wait(); if (change === "async") f.state().async = { FunctionArn: t.functionArn, MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 2, DestinationConfig: {} };
      else f.state().guards[change === "role" ? "emptyRolePolicies" : "concurrencyZero"] = false;
    } }, f.now);
    assert.deepEqual(f.writes, [0]); assert.equal(r.writesAttempted, 1); assert.equal(r.retryAuthorized, false);
  }
});
test("lost async response stops after two dispatches and does not replay either write", async () => {
  const f = await fixture(); f.lose(1); const r = await runCellParentLockedUpdateV5(f.review, f.review.manifestSha256, code, f.port, f.now);
  assert.deepEqual(f.writes, [0, 1]); assert.equal(r.writesAttempted, 2); assert.equal(r.retryAuthorized, false);
  assert.equal(f.state().async?.MaximumRetryAttempts, 0);
});
test("async state binds exact latest target; absent state is not silently replaced in the review", () => {
  assert.equal(cellParentAsyncStateV5(null), null);
  assert.deepEqual(cellParentAsyncStateV5({ FunctionArn: `${t.functionArn}:$LATEST`, LastModified: 1, MaximumRetryAttempts: 2 }), { FunctionArn: t.functionArn, MaximumRetryAttempts: 2 });
  assert.throws(() => cellParentAsyncStateV5({ FunctionArn: `${t.functionArn}:current` }));
});
test("CLI uses fixed durable slot and single native dispatch, no alternative AWS/DB mutation constructors", async () => {
  const cli = await readFile(new URL("../ops/aws-sandbox/scripts/review-cell-parent-locked-update-v5.mjs", import.meta.url), "utf8"), aws = await readFile(new URL("../ops/aws-sandbox/scripts/cell-parent-locked-update-aws-v5.mjs", import.meta.url), "utf8");
  assert.match(cli, /flag: "wx", flush: true/); assert.match(cli, /mode === "Review"/); assert.match(cli, /mode === "Inspect"/);
  assert.match(aws, /attempted\.has\(index\)/); assert.match(aws, /attempted\.add\(index\)/); assert.match(aws, /AWS_MAX_ATTEMPTS: "1"/);
  assert.doesNotMatch(cli + aws, /InvokeCommand|PutRolePolicyCommand|CreatePolicyCommand|DeleteFunctionCommand|DeleteStackCommand|PutItemCommand|GetSecretValueCommand|neon\(/);
});
test("simulator accepts exact four pairs in grouped or flat form, never aggregate-template-only/missing/duplicate/deny", () => {
  const grouped = { EvaluationResults: ["lambda:UpdateFunctionCode", "lambda:PutFunctionEventInvokeConfig"].map(EvalActionName => ({ EvalActionName, EvalResourceName: "arn:aws:lambda:${Region}:${Account}:${ResourceType}:${ResourceId}", EvalDecision: "allowed", MissingContextValues: [],
    ResourceSpecificResults: [t.functionArn, `${t.functionArn}:$LATEST`].map(EvalResourceName => ({ EvalResourceName, EvalResourceDecision: "allowed" })) })) };
  assert.equal(decodeCellParentUpdateSimulationV5(grouped).length, 4);
  const flat = { EvaluationResults: decodeCellParentUpdateSimulationV5(grouped).map(x => ({ EvalActionName: x.action, EvalResourceName: x.resource, EvalDecision: x.decision })) };
  assert.equal(decodeCellParentUpdateSimulationV5(flat).length, 4);
  const denied = structuredClone(grouped); denied.EvaluationResults[0].ResourceSpecificResults[0].EvalResourceDecision = "implicitDeny";
  const duplicate = structuredClone(grouped); duplicate.EvaluationResults[0].ResourceSpecificResults[1] = duplicate.EvaluationResults[0].ResourceSpecificResults[0];
  for (const raw of [{ IsTruncated: true, ...grouped }, { EvaluationResults: grouped.EvaluationResults.slice(0, 1) }, denied, duplicate,
    { EvaluationResults: grouped.EvaluationResults.map(x => ({ ...x, ResourceSpecificResults: undefined })) }]) assert.throws(() => decodeCellParentUpdateSimulationV5(raw));
});
