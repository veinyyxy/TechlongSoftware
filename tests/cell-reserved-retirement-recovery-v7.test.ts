import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { RESERVED_RETIREMENT_RECOVERY_V7 as t, prepareRetirementRecoveryV7, decodeRetirementRecoveryV7, runRetirementRecoveryV7,
  assertRecoveryCompleteReadV7, assertRecoveryLightFrameV7, assertRecoveryFinalReadV7, boundedRecoveryErrorV7,
  type RecoveryCompleteReadV7, type RecoveryLightFrameV7, type RetirementRecoveryPortV7 } from "../lib/deployments/execution/cell-reserved-retirement-recovery-v7.ts";

// Focused pure transport/approval tests only; no DB simulation, credentials,
// provider proof or live cloud deletion. Synthetic frames cannot assert cloud state.
const at = Date.parse(t.cellExpiresAt) + 3600000, code = "b".repeat(64);
async function fixture() {
  let clock = at, claims = 0, deletes = 0, completeCalls = 0, finalCalls = 0;
  const full = (): RecoveryCompleteReadV7 => ({ startedAt: clock - 1000, completedAt: clock, before: { observedAt: clock, stackId: t.stackId,
    stableStackSha256: t.stableStackSha256, parentCommonSha256: t.parentCommonSha256, foundationSha256: t.foundationSha256,
    zeroResourcesReservedAndFlagsVerified: true, noChangeSetsOrNonCreationEvents: true, sourceDeleteAndPassRoleSimulated: true } });
  const frame: RecoveryLightFrameV7 = { stackId: t.stackId, stackStatus: "CREATE_COMPLETE", stableOriginalSha256: t.stableStackSha256,
    templateCanonicalSha256: t.templateCanonicalSha256, resourceCount: 0, changeSetCount: 0, flagsVerified: true };
  const review = await prepareRetirementRecoveryV7(full(), code, at), markers: string[] = [];
  const port: RetirementRecoveryPortV7 = { verifyFilesAndSource: async () => {}, readComplete: async () => { completeCalls++; return full(); },
    claimOnce: async () => ++claims === 1, marker: async name => { markers.push(name); },
    readFinalStack: async () => { finalCalls++; return { startedAt: clock, completedAt: clock, frame, sourceVerified: true }; },
    deleteOnce: async request => { deletes++; assert.deepEqual(request, review.request); } };
  return { review, port, frame, full, now: () => clock, time: (v: number) => { clock = v; }, claims: () => claims, deletes: () => deletes,
    completeCalls: () => completeCalls, finalCalls: () => finalCalls, markers };
}
test("recovery is a new separately approved slot/token but same exact old UUID and STANDARD only", async () => {
  const f = await fixture(), r = await decodeRetirementRecoveryV7(f.review);
  assert.notEqual(t.permanentSlot, t.oldRetirementSlot); assert.equal(r.targets.oldRetirementSlotFileSha256, "7b31496eac7f43265faa0043a50b0c9df1af70b61d7076794b2ef0b1534d7898");
  assert.equal(r.request.StackName, t.stackId); assert.equal(r.request.RoleARN, t.roleArn); assert.equal(r.request.DeletionMode, "STANDARD");
  assert.match(r.request.ClientRequestToken, /^cell-v7-retire-[a-f0-9]{64}$/); assert.equal(r.scope.maximumWriteCalls, 1);
  assert.equal(r.risks.fullIamParentAndSourceSimulationFactsNotRereadAfterClaim, true);
});
test("rehashed changed slot/history, expanded scope, risk removal, name/force/retain/expiry all reject", async () => {
  const f = await fixture();
  for (const kind of ["oldSlot", "newSlot", "scope", "risk", "name", "force", "retain", "expiry"]) {
    const r = structuredClone(f.review);
    if (kind === "oldSlot") r.targets.oldRetirementSlotFileSha256 = code;
    if (kind === "newSlot") r.targets.permanentSlot = t.oldRetirementSlot;
    if (kind === "scope") r.scope.maximumWriteCalls = 2 as never;
    if (kind === "risk") r.risks.fullIamParentAndSourceSimulationFactsNotRereadAfterClaim = false as never;
    if (kind === "name") r.request.StackName = t.stackName;
    if (kind === "force") r.request.DeletionMode = "FORCE_DELETE_STACK" as never;
    if (kind === "retain") Object.assign(r.request, { RetainResources: [] });
    if (kind === "expiry") r.expiresAt++;
    r.requestSha256 = await sha256Hex(r.request); const { manifestSha256: unused, ...body } = r; void unused;
    r.manifestSha256 = await sha256Hex(body); await assert.rejects(decodeRetirementRecoveryV7(r));
  }
});
test("wrong SHA/code and expired window stop at APPROVAL before local claim or cloud write", async () => {
  for (const kind of ["sha", "code", "expiry"]) {
    const f = await fixture(); if (kind === "expiry") f.time(f.review.expiresAt);
    const r = await runRetirementRecoveryV7(f.review, kind === "sha" ? code : f.review.manifestSha256, kind === "code" ? "a".repeat(64) : code, f.port, f.now);
    assert.equal(r.stage, "APPROVAL"); assert.equal(r.phases[0].failure?.safeCode, "RECOVERY_FRESH_EXACT_APPROVAL_REQUIRED");
    assert.equal(f.claims(), 0); assert.equal(f.deletes(), 0);
  }
});
test("single complete precheck is saved before claim; final is stack-only; successful API response is submission not deletion proof", async () => {
  const f = await fixture(), r = await runRetirementRecoveryV7(f.review, f.review.manifestSha256, code, f.port, f.now);
  assert.equal(r.outcome, "RECOVERY_DELETE_SUBMITTED_INDEPENDENT_INSPECT_REQUIRED"); assert.equal(r.slotConsumed, true); assert.equal(r.responseReceived, true);
  assert.equal(f.completeCalls(), 1); assert.equal(f.finalCalls(), 1); assert.equal(f.deletes(), 1);
  assert.deepEqual(f.markers, ["complete-precheck.json", "delete-attempt.json", "final-stack-guard.json", "delete-response.json"]);
  assert.equal(r.phases.every(p => p.completedAt !== undefined && !p.failure), true);
  const again = await runRetirementRecoveryV7(f.review, f.review.manifestSha256, code, f.port, f.now);
  assert.equal(again.outcome, "RECOVERY_SLOT_OCCUPIED_INSPECT_ONLY"); assert.equal(f.deletes(), 1);
});
test("full evidence age starts before all full reads; final checks exact zero-resource bindings and ten-second age", async () => {
  const f = await fixture(), full = f.full(); assert.doesNotThrow(() => assertRecoveryCompleteReadV7(full, at));
  assert.throws(() => assertRecoveryCompleteReadV7(full, full.startedAt + 30001));
  assert.throws(() => assertRecoveryCompleteReadV7({ ...full, startedAt: full.completedAt + 1 }, at));
  for (const patch of [{ stackId: t.stackName }, { stackStatus: "UPDATE_COMPLETE" }, { stableOriginalSha256: code }, { templateCanonicalSha256: code },
    { resourceCount: 1 }, { changeSetCount: 1 }, { flagsVerified: false }]) assert.throws(() => assertRecoveryLightFrameV7({ ...f.frame, ...patch }));
  const final = { startedAt: at, completedAt: at, frame: f.frame, sourceVerified: true };
  assert.throws(() => assertRecoveryFinalReadV7(final, full, at + 10001));
  assert.throws(() => assertRecoveryFinalReadV7({ ...final, sourceVerified: false }, full, at));
});
test("failed complete read or precheck save records exact phase before any claim", async () => {
  for (const kind of ["read", "save"]) {
    const f = await fixture(), error = Object.assign(Error("raw provider secret://private"), { name: "ThrottlingException", recoveryOperation: "CompleteRead", $metadata: { requestId: "req-123", httpStatusCode: 429 } });
    const r = await runRetirementRecoveryV7(f.review, f.review.manifestSha256, code, { ...f.port,
      ...(kind === "read" ? { readComplete: async () => { throw error; } } : { marker: async () => { throw Error("private disk path"); } }) }, f.now);
    assert.equal(r.stage, kind === "read" ? "COMPLETE_READONLY_PRECONDITIONS" : "SAVE_COMPLETE_PRECHECK");
    assert.equal(f.claims(), 0); assert.equal(f.deletes(), 0); assert.doesNotMatch(JSON.stringify(r), /secret:\/\/|private disk path/);
    if (kind === "read") assert.deepEqual(r.phases.at(-1)?.failure, { safeCode: "ThrottlingException", operation: "CompleteRead", providerRequestId: "req-123", httpStatusCode: 429 });
  }
});
test("post-claim final API failure, drift and age expiry preserve slot and diagnosis without full reread or deletion", async () => {
  for (const kind of ["read", "drift", "age"]) {
    const f = await fixture(), port = { ...f.port,
      marker: async (name: string) => { if (kind === "age" && name === "delete-attempt.json") f.time(at + 30000); },
      readFinalStack: async () => {
        if (kind === "read") throw Object.assign(Error("private provider content"), { name: "AccessDeniedException", recoveryOperation: "GetTemplate" });
        return { startedAt: f.now(), completedAt: f.now(), sourceVerified: true, frame: { ...f.frame, resourceCount: kind === "drift" ? 1 : 0 } };
      } };
    const r = await runRetirementRecoveryV7(f.review, f.review.manifestSha256, code, port, f.now);
    assert.equal(r.slotConsumed, true); assert.equal(r.stage, "FINAL_LIGHTWEIGHT_STACK_GUARD"); assert.equal(f.completeCalls(), 1); assert.equal(f.deletes(), 0);
    assert.equal(r.retryAuthorized, false); assert.ok(r.phases.at(-1)?.failure); assert.doesNotMatch(JSON.stringify(r), /private provider/);
  }
});
test("claim partial failure and response loss retain distinct phases and never compensate or retry", async () => {
  for (const kind of ["claim", "response", "saveResponse"]) {
    const f = await fixture(); let calls = 0;
    const r = await runRetirementRecoveryV7(f.review, f.review.manifestSha256, code, { ...f.port,
      claimOnce: kind === "claim" ? async () => { throw Error("RECOVERY_PERMANENT_SLOT_SAVE_FAILED"); } : f.port.claimOnce,
      deleteOnce: async () => { calls++; if (kind === "response") throw Object.assign(Error("private detail"), { name: "TimeoutError", recoveryOperation: "DeleteStack" }); },
      marker: async (name: string) => { if (kind === "saveResponse" && name === "delete-response.json") throw Error("disk"); } }, f.now);
    assert.equal(r.stage, kind === "claim" ? "NEW_PERMANENT_SLOT" : kind === "response" ? "DELETE_SUBMISSION" : "SAVE_DELETE_RESPONSE");
    assert.equal(r.slotClaimAttempted, true); assert.equal(r.slotConsumed, kind !== "claim"); assert.equal(calls, kind === "claim" ? 0 : 1);
    assert.equal(r.responseReceived, kind === "saveResponse"); assert.equal(r.retryAuthorized, false);
  }
});
test("provider diagnostics omit arbitrary messages, stack traces, operations and malformed metadata", () => {
  const error = { name: "secret://password", message: "postgres://private-password", stack: "private stack", recoveryOperation: "postgres://private", $metadata: { requestId: "secret/private", httpStatusCode: 999 } };
  assert.deepEqual(boundedRecoveryErrorV7(error), { safeCode: "ProviderError", operation: null, providerRequestId: null, httpStatusCode: null });
});
test("native adapter has exactly one guarded DeleteStack, retries disabled, and final identity+age checks immediately before send", async () => {
  const text = await readFile(new URL("../ops/aws-sandbox/scripts/cell-reserved-retirement-recovery-aws-v7.mjs", import.meta.url), "utf8");
  assert.equal((text.match(/call\(DeleteStackCommand/g) ?? []).length, 1); assert.match(text, /maxAttempts: 1/);
  assert.match(text, /createReservedRetirementAwsV6\(original, undefined\)/); assert.match(text, /entered = true; await identity\(\)/);
  assert.match(text, /assertRecoveryFinalReadV7\(finalCache, fullCache, Date\.now\(\)\); assertRecoveryApprovalV7/);
  assert.doesNotMatch(text, /(?:CreateStack|UpdateStack|PutRolePolicy|CreatePolicyVersion|Invoke|UpdateFunctionCode)Command/);
});
