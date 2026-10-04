import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { compileArnProbeComparisonWorkflow, assertArnProbeComparisonWorkflow, reviewArnProbeComparisonWorkflow, runArnProbeComparisonWorkflow,
  recoverArnProbeComparisonRevoke, inspectArnProbeComparisonWorkflow, ARN_PROBE_COMPARISON_STEPS } from "../lib/deployments/execution/arn-probe-read-comparison-workflow.ts";
import { createArnProbeComparisonFsSlot } from "../lib/deployments/execution/arn-probe-read-comparison-slot.ts";
import { AwsSdkArnProbeComparisonOperatorReadAdapter, AwsSdkArnProbeComparisonWorkflowReadAdapter, AwsSdkArnProbeComparisonWorkflowWriteAdapter } from "../lib/deployments/execution/aws-sdk-arn-probe-read-comparison-workflow.ts";
import { comparisonWorkflowFixture, comparisonTestAt as at, comparisonTestId as id, testSignal } from "./fixtures/arn-probe-comparison-workflow.ts";

async function temp(run: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "techlong-j18-test-")));
  try { await run(root); } finally { const resolved = await realpath(root), base = await realpath(os.tmpdir()); assert.equal(path.dirname(resolved), base); assert.match(path.basename(resolved), /^techlong-j18-test-/); await rm(resolved, { recursive: true, force: true }); }
}
class Command { input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }

test("J18 deterministically binds one read candidate, permanent claim, full Grant ARN and independent exact Locked revoke", async () => {
  const f = await comparisonWorkflowFixture(); await assertArnProbeComparisonWorkflow(f.manifest);
  assert.deepEqual(f.manifest, await compileArnProbeComparisonWorkflow(f.manifest.input)); assert.equal(Object.isFrozen(f.manifest.actions.operatorReads.cases), true);
  assert.equal(f.manifest.actions.operatorReads.cases.length, 2); assert.equal(f.manifest.actions.operatorReads.maxTotalSubmissions, 2);
  assert.equal(f.manifest.actions.revoke.createRequest.TemplateBody, f.review.plan.revokeTarget.templateBody);
  assert.equal(f.manifest.actions.grantExecute.request.ChangeSetName, f.grantArn); assert.equal(f.manifest.grantInstallationApproved, false);
  assert.doesNotMatch(JSON.stringify(f.manifest.actions), /DeleteChangeSet|DeleteStack|DeleteProbe/);
});
test("manifest rejects unclaimed/foreign ARN, extended window, insufficient cleanup margin and rehashed scope drift", async () => {
  const f = await comparisonWorkflowFixture();
  for (const input of [{ ...f.manifest.input, grantChangeSetArn: "wrong" }, { ...f.manifest.input, expiresAt: new Date(at + 300_001).toISOString() },
    { ...f.manifest.input, reviewedAt: new Date(at + 1_500_000).toISOString(), expiresAt: new Date(at + 1_600_000).toISOString() },
    { ...f.manifest.input, claim: { ...f.claim, claimSha256: "0".repeat(64) } }]) await assert.rejects(compileArnProbeComparisonWorkflow(input));
  const value = JSON.parse(canonicalJson(f.manifest)); value.actions.operatorReads.cases[1].request.ChangeSetName = "*"; delete value.manifestSha256; value.manifestSha256 = await sha256Hex(canonicalJson(value)); await assert.rejects(assertArnProbeComparisonWorkflow(value));
});
test("Source review without real creation claim/Grant returns no executable manifest and does not reserve anything", async () => {
  const f = await comparisonWorkflowFixture(), reads = { ...f.reads, readGrant: async () => ({ state: "MISSING" as const, proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY" as const, observedAt: new Date(at).toISOString() }) };
  const missing = await reviewArnProbeComparisonWorkflow({ ...f, creationReview: f.review, readClaim: async () => null, reads });
  assert.equal(missing.outcome, "PREPARE_FENCED_GRANT_REQUIRED"); assert.equal(missing.manifest, null); assert.equal(missing.mutationPerformed, false); assert.equal(f.events.length, 0);
  await assert.rejects(reviewArnProbeComparisonWorkflow({ ...f, creationReview: f.review, readClaim: async () => null }), /Unclaimed/);
  const consumed = await reviewArnProbeComparisonWorkflow({ ...f, creationReview: f.review, reads }); assert.equal(consumed.outcome, "MISSING_GRANT_SLOT_CONSUMED");
});
test("fresh Source execution review uses a real exact claimed Grant; expired policy cannot issue a new Run manifest", async () => {
  const f = await comparisonWorkflowFixture(), result = await reviewArnProbeComparisonWorkflow({ ...f, creationReview: f.review });
  assert.equal(result.outcome, "EXECUTION_REVIEW_READY_NOT_APPROVED"); assert.deepEqual(result.manifest, f.manifest);
  f.setTime(at + 1_300_000); await assert.rejects(reviewArnProbeComparisonWorkflow({ ...f, creationReview: f.review }), /cleanup margin/);
});
test("bad independent action approval, expired window, cancellation and stale ledger fail before MFA/Grant/intents", async () => {
  const f = await comparisonWorkflowFixture();
  for (const changes of [{ approval: { ...f.approval, approvedReadsSha256: "0".repeat(64) } }, { approval: { ...f.approval, acknowledgeLowCostNotZero: false } },
    { signal: AbortSignal.abort() }, { now: () => at + 300_000 }, { readClaim: async () => null }]) await assert.rejects(runArnProbeComparisonWorkflow({ ...f, ...changes }));
  assert.deepEqual(f.events, []); assert.equal(f.intents.size, 0);
});
test("fixed MFA identity and post-MFA fresh Source review are mandatory before installation", async () => {
  const f = await comparisonWorkflowFixture();
  await assert.rejects(runArnProbeComparisonWorkflow({ ...f, writes: { ...f.writes, prepareOperator: async () => ({ callerArn: "foreign", account: "402010193138", expiresAt: new Date(at + 900_000).toISOString() }) } }));
  assert.equal(f.intents.size, 0);
  let afterMfa = false;
  const reads = { ...f.reads, readManagement: async (...args: Parameters<typeof f.reads.readManagement>) => { const v = await f.reads.readManagement(...args); return afterMfa ? { ...v, authorityState: "PRESENT" } as unknown as typeof v : v; } };
  await assert.rejects(runArnProbeComparisonWorkflow({ ...f, reads, writes: { ...f.writes, prepareOperator: async () => { afterMfa = true; return f.writes.prepareOperator(); } } })); assert.equal(f.intents.size, 0);
});
test("successful Run persists every intent first, performs one read per style, brackets exact Grant, then restores Locked", async () => {
  const f = await comparisonWorkflowFixture(), receipt = await runArnProbeComparisonWorkflow(f);
  assert.equal(receipt.outcome, "LOCKED_READ_COMPARISON_RECORDED"); assert.equal(receipt.results.length, 2); assert.equal(receipt.sourceReadBrackets.length, 2);
  assert.equal(receipt.cleanup?.outcome, "LOCKED_VERIFIED"); assert.equal(receipt.fixtureAfter?.state, "READY_UNEXECUTED");
  assert.deepEqual([...f.intents.keys()], [...ARN_PROBE_COMPARISON_STEPS]);
  for (const [intent, action] of [["intent:grant-execute", "grant"], ["intent:read-full-arn", "read:FULL_ARN_REQUEST"], ["intent:read-exact-name", "read:EXACT_NAME_REQUEST"], ["intent:revoke-create", "revoke-create"], ["intent:revoke-execute", "revoke-execute"]]) assert.ok(f.events.indexOf(intent) < f.events.indexOf(action));
  const snapshot = [...f.events]; await assert.rejects(runArnProbeComparisonWorkflow(f), /consumed/); assert.deepEqual(f.events, snapshot);
  assert.equal(receipt.productionCompatibilityVerified, false); assert.equal(receipt.probeDeleted, false); assert.equal(receipt.authorizationContextObserved, false);
});
test("AccessDenied records each once, never propagates/retries/infers deletion and still immediately revokes", async () => {
  const f = await comparisonWorkflowFixture(), operatorReads = { readCase: async (...args: Parameters<typeof f.operatorReads.readCase>) => ({ ...await f.operatorReads.readCase(...args), outcome: "READ_DENIED" as const, providerEvidenceSha256: null, failure: f.denied() }) };
  const receipt = await runArnProbeComparisonWorkflow({ ...f, operatorReads }); assert.deepEqual(receipt.results.map((r) => r.outcome), ["READ_DENIED", "READ_DENIED"]);
  assert.equal(receipt.cleanup?.outcome, "LOCKED_VERIFIED"); assert.equal(f.events.filter((v) => v.startsWith("read:")).length, 2);
  assert.equal(receipt.retryAuthorized, false); assert.doesNotMatch(JSON.stringify(receipt), /never serialize/);
});
test("lost Grant response still reconciles terminal grant and withdraws without retry", async () => {
  const f = await comparisonWorkflowFixture(), writes = { ...f.writes, executeGrant: async () => { await f.writes.executeGrant(); throw new Error("PRIVATE-MFA-123456"); } };
  const receipt = await runArnProbeComparisonWorkflow({ ...f, writes }); assert.equal(receipt.cleanup?.outcome, "LOCKED_VERIFIED"); assert.equal(f.events.filter((e) => e === "grant").length, 1); assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE-MFA/);
});
test("cancellation or approval expiry after Grant cannot suppress independent Revoke; no Operator reads submitted", async () => {
  for (const action of ["cancel", "expire"]) {
    const f = await comparisonWorkflowFixture(), cancelled = new AbortController();
    const writes = { ...f.writes, executeGrant: async () => { const r = await f.writes.executeGrant(); if (action === "cancel") cancelled.abort(); else f.setTime(at + 300_000); return r; },
      createRevoke: async (_r: unknown, signal: AbortSignal) => { assert.equal(signal.aborted, false); return f.writes.createRevoke(); } };
    const receipt = await runArnProbeComparisonWorkflow({ ...f, writes, signal: cancelled.signal }); assert.equal(receipt.cleanup?.outcome, "LOCKED_VERIFIED"); assert.equal(receipt.results.length, 0); assert.ok(f.events.includes("revoke-execute"));
  }
});
test("unsettled Grant is not discharged by an early Locked read and reports explicit Revoke required", async () => {
  const f = await comparisonWorkflowFixture(), reads = { ...f.reads, waitGrantSettlement: async () => { throw new Error("still AVAILABLE or EXECUTE_IN_PROGRESS"); } };
  const receipt = await runArnProbeComparisonWorkflow({ ...f, reads }); assert.equal(receipt.outcome, "REVOKE_REQUIRED"); assert.equal(receipt.cleanup, null); assert.equal(receipt.results.length, 0);
  assert.equal(f.events.includes("revoke-create"), false);
});
test("Operator transport/drift uncertainty stops after the one consumed request and revokes", async () => {
  const f = await comparisonWorkflowFixture(), operatorReads = { readCase: async () => { throw new Error("transport uncertainty"); } };
  const receipt = await runArnProbeComparisonWorkflow({ ...f, operatorReads }); assert.equal(receipt.cleanup?.outcome, "LOCKED_VERIFIED"); assert.ok(f.intents.has("read-full-arn")); assert.equal(f.intents.has("read-exact-name"), false);
});
test("unrecognized secret fields in an injected read receipt fail validation and never enter the saved receipt", async () => {
  const f = await comparisonWorkflowFixture(), operatorReads = { readCase: async (...args: Parameters<typeof f.operatorReads.readCase>) => ({ ...await f.operatorReads.readCase(...args), secretAccessKey: "MUST-NOT-PERSIST" }) };
  const receipt = await runArnProbeComparisonWorkflow({ ...f, operatorReads }); assert.equal(receipt.results.length, 0); assert.equal(receipt.cleanup?.outcome, "LOCKED_VERIFIED"); assert.doesNotMatch(JSON.stringify(receipt), /MUST-NOT-PERSIST/);
});
test("lost Revoke Create/Execute replies are reconciled only, with no duplicate mutations", async () => {
  for (const step of ["create", "execute"]) {
    const f = await comparisonWorkflowFixture(), writes = { ...f.writes,
      createRevoke: async () => { const r = await f.writes.createRevoke(); if (step === "create") throw new Error("lost"); return r; },
      executeRevoke: async () => { const r = await f.writes.executeRevoke(); if (step === "execute") throw new Error("lost"); return r; } };
    const receipt = await runArnProbeComparisonWorkflow({ ...f, writes }); assert.equal(receipt.cleanup?.outcome, "LOCKED_VERIFIED"); assert.equal(f.events.filter((v) => v === "revoke-create").length, 1); assert.equal(f.events.filter((v) => v === "revoke-execute").length, 1);
  }
});
test("write-ahead failure never submits that action; a missing revoke after durable intent is not recreated", async () => {
  const f = await comparisonWorkflowFixture(), journal = { ...f.journal, reserve: async (...args: Parameters<typeof f.journal.reserve>) => { if (args[0] === "grant-execute") throw new Error("fsync failed"); return f.journal.reserve(...args); } };
  const blocked = await runArnProbeComparisonWorkflow({ ...f, journal }); assert.equal(blocked.outcome, "NO_GRANT_SUBMITTED"); assert.equal(f.events.includes("grant"), false);
  const r = await comparisonWorkflowFixture(); r.setGranted(true); await r.journal.reserve("run", r.manifest.actions, new Date(at).toISOString()); await r.journal.reserve("grant-execute", r.manifest.actions.grantExecute.request, new Date(at).toISOString()); await r.journal.reserve("revoke-create", r.manifest.actions.revoke.createRequest, new Date(at).toISOString());
  const result = await recoverArnProbeComparisonRevoke({ ...r, approval: { ...r.approval, executionPhrase: "I_CONFIRM_J5GJ18_REVOKE_ONLY" } }); assert.equal(result.outcome, "REVOKE_REQUIRED"); assert.equal(r.events.includes("revoke-create"), false);
});
test("expired explicit revoke-only recovery cannot install Grant or call Operator", async () => {
  const f = await comparisonWorkflowFixture(); f.setGranted(true); await f.journal.reserve("run", f.manifest.actions, new Date(at).toISOString()); await f.journal.reserve("grant-execute", f.manifest.actions.grantExecute.request, new Date(at).toISOString()); f.setTime(at + 3_600_000);
  const result = await recoverArnProbeComparisonRevoke({ ...f, writes: { createRevoke: f.writes.createRevoke, executeRevoke: f.writes.executeRevoke }, approval: { ...f.approval, approvedGrantSha256: "", approvedReadsSha256: "", executionPhrase: "I_CONFIRM_J5GJ18_REVOKE_ONLY" } });
  assert.equal(result.outcome, "LOCKED_VERIFIED"); assert.equal(result.grantReplayed, false); assert.equal(result.operatorReadReplayed, false); assert.equal(f.events.includes("grant"), false); assert.equal(f.events.some((v) => v.startsWith("read:")), false);
});
test("Source-only Inspect recognizes exact Grant and Locked without creating intents or calling Operator", async () => {
  const f = await comparisonWorkflowFixture(); assert.equal((await inspectArnProbeComparisonWorkflow({ ...f, creationReview: f.review })).outcome, "LOCKED_VERIFIED");
  f.setGranted(true); assert.equal((await inspectArnProbeComparisonWorkflow({ ...f, creationReview: f.review })).outcome, "REVOKE_REQUIRED"); assert.deepEqual(f.events, []); assert.equal(f.intents.size, 0);
});
test("filesystem journal binds claim and one manifest, prevents concurrent/restarted replay and preserves files", async () => {
  const f = await comparisonWorkflowFixture(); await temp(async (root) => {
    const slot = await createArnProbeComparisonFsSlot(root, f.fence); assert.deepEqual(await readdir(root), []); await slot.reserve(f.review, "f".repeat(64), new Date(at).toISOString());
    const journal = await slot.workflowJournal(f.manifest); await journal.reserve("run", f.manifest.actions, new Date(at).toISOString());
    const results = await Promise.allSettled([journal.reserve("grant-execute", f.manifest.actions.grantExecute.request, new Date(at).toISOString()), journal.reserve("grant-execute", f.manifest.actions.grantExecute.request, new Date(at).toISOString())]); assert.equal(results.filter((v) => v.status === "fulfilled").length, 1);
    const again = await (await createArnProbeComparisonFsSlot(root, f.fence)).workflowJournal(f.manifest); assert.ok(await again.load("grant-execute"));
    const later = await compileArnProbeComparisonWorkflow({ ...f.manifest.input, reviewedAt: new Date(at + 1000).toISOString(), expiresAt: new Date(at + 301_000).toISOString() }); await assert.rejects(slot.workflowJournal(later));
    const filename = path.join(root, ...f.fence.slotRelativePath.split("/"), "grant-execute-intent.json"); await writeFile(filename, "{partial"); await assert.rejects(again.load("grant-execute")); assert.equal(await readFile(filename, "utf8"), "{partial");
  });
});
test("filesystem journal forbids missing prerequisites, exact-name before full ARN, wrong revoke ARN and late new Grant", async () => {
  const f = await comparisonWorkflowFixture(); await temp(async (root) => {
    const slot = await createArnProbeComparisonFsSlot(root, f.fence); await slot.reserve(f.review, "f".repeat(64), new Date(at).toISOString()); const journal = await slot.workflowJournal(f.manifest);
    await assert.rejects(journal.reserve("grant-execute", f.manifest.actions.grantExecute.request, new Date(at).toISOString())); await journal.reserve("run", f.manifest.actions, new Date(at).toISOString());
    await assert.rejects(journal.reserve("grant-execute", f.manifest.actions.grantExecute.request, new Date(at + 300_000).toISOString())); await journal.reserve("grant-execute", f.manifest.actions.grantExecute.request, new Date(at).toISOString());
    await assert.rejects(journal.reserve("read-exact-name", f.manifest.actions.operatorReads.cases[1].request, new Date(at).toISOString()));
    await journal.reserve("revoke-create", f.manifest.actions.revoke.createRequest, new Date(at + 3_600_000).toISOString());
    await assert.rejects(journal.reserve("revoke-execute", { StackName: f.review.plan.request.StackName, ChangeSetName: "wrong", ClientRequestToken: f.manifest.actions.revoke.executeClientToken, DisableRollback: false }, new Date(at + 3_600_000).toISOString()));
  });
});
test("SDK Operator issues one exact Describe per style; name requests still require full returned IDs and no automatic retry", async () => {
  const f = await comparisonWorkflowFixture(), calls: Record<string, unknown>[] = [];
  const response = { StackId: f.prior.input.fixtureStackId, StackName: "techlong-sandbox-arn-compatibility-probe", ChangeSetId: f.prior.input.fixtureChangeSetArn, ChangeSetName: f.prior.input.fixturePlan.request.ChangeSetName,
    RoleARN: f.prior.input.fixturePlan.request.RoleARN, Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", Description: f.prior.input.fixturePlan.request.Description, OnStackFailure: "DELETE", Tags: f.prior.input.fixturePlan.request.Tags,
    Capabilities: [], Parameters: [], NotificationARNs: [], Changes: [{ Type: "Resource", ResourceChange: { Action: "Add", LogicalResourceId: "ProbeHandle", ResourceType: "AWS::CloudFormation::WaitConditionHandle" } }], $metadata: { requestId: id, httpStatusCode: 200 } };
  const adapter = new AwsSdkArnProbeComparisonOperatorReadAdapter({ operator: { send: async (command) => { calls.push((command as Command).input); return response; } }, describeChangeSet: Command, verifyIdentity: f.writes.prepareOperator }, f.now);
  for (const c of f.manifest.actions.operatorReads.cases) { const r = await adapter.readCase(f.manifest, c.requestStyle, testSignal()); assert.equal(r.outcome, "READ_SUCCEEDED"); await assert.rejects(adapter.readCase(f.manifest, c.requestStyle, testSignal()), /consumed/); }
  assert.equal(calls.length, 2); assert.equal(calls[0].ChangeSetName, f.prior.input.fixtureChangeSetArn); assert.equal(calls[1].ChangeSetName, f.prior.input.fixturePlan.request.ChangeSetName);
  const bad = new AwsSdkArnProbeComparisonOperatorReadAdapter({ operator: { send: async () => ({ ...response, ChangeSetId: "wrong" }) }, describeChangeSet: Command, verifyIdentity: f.writes.prepareOperator }, f.now);
  assert.equal((await bad.readCase(f.manifest, "EXACT_NAME_REQUEST", testSignal())).outcome, "READ_UNCERTAIN");
});
test("SDK Source cannot discharge early Locked until terminal Grant; revoke-only write adapter cannot install or repeat", async () => {
  const f = await comparisonWorkflowFixture(); let observations = 0, polling = 0;
  const commands = { describeStacks: Command, describeChangeSet: Command, getTemplate: Command, listChangeSets: Command };
  const reads = new AwsSdkArnProbeComparisonWorkflowReadAdapter({ client: { send: async (command) => { const request = (command as Command).input; if (request.ChangeSetName) { polling++; return { StackId: f.review.plan.request.StackName, ChangeSetId: f.grantArn, ChangeSetName: f.review.plan.request.ChangeSetName, Description: f.review.plan.request.Description, ExecutionStatus: polling < 3 ? "EXECUTE_IN_PROGRESS" : "EXECUTE_COMPLETE" }; }
      return { Stacks: [{ StackId: f.review.plan.request.StackName, StackName: "techlong-s3-b5-cell-lifecycle-management", StackStatus: "UPDATE_COMPLETE", EnableTerminationProtection: false }] }; } }, commands,
    readManagement: async (...a) => { observations++; return f.reads.readManagement(...a); }, readFixture: f.reads.readFixture, pause: async () => { assert.equal(observations, 0); } }, f.now);
  await reads.waitGrantSettlement(f.manifest, testSignal()); assert.equal(polling, 3); assert.equal(observations, 1);
  let mutations = 0; const write = new AwsSdkArnProbeComparisonWorkflowWriteAdapter(f.manifest, { source: { send: async () => { mutations++; return {}; } }, createChangeSet: Command, executeChangeSet: Command, grantCapabilityEnabled: false });
  assert.throws(() => write.executeGrant(f.manifest.actions.grantExecute.request, testSignal()), /Revoke-only/); await write.createRevoke(f.manifest.actions.revoke.createRequest, testSignal()); await assert.rejects(write.createRevoke(f.manifest.actions.revoke.createRequest, testSignal()), /single-submit/); assert.equal(mutations, 1);
});
test("J18 CLI rejects cross-mode/duplicate/ambient option authority and has no Delete/IAM write/child API", async () => {
  const cli = await readFile(new URL("../ops/aws-sandbox/scripts/s3-b5-arn-probe-read-comparison-workflow.ts", import.meta.url), "utf8"), sdk = await readFile(new URL("../lib/deployments/execution/aws-sdk-arn-probe-read-comparison-workflow.ts", import.meta.url), "utf8");
  assert.doesNotMatch(cli + sdk, /\b(?:Delete|Put|Update|Attach|Detach)\w*Command/); assert.match(cli, /"wx"/); assert.match(cli, /maxAttempts: 1/);
  for (const args of [["--mode", "RunReviewed"], ["--mode", "Review", "--acknowledge-aws-write"], ["--mode", "RecoverRevoke", "--approved-reads-sha", "x"], ["--acknowledge-read-only", "--acknowledge-read-only"]]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "ops/aws-sandbox/scripts/s3-b5-arn-probe-read-comparison-workflow.ts", ...args], { cwd: fileURLToPath(new URL("../", import.meta.url)), windowsHide: true, encoding: "utf8" }); assert.notEqual(result.status, 0); assert.doesNotMatch(result.stdout, /digest|receiptSha256/);
  }
});
