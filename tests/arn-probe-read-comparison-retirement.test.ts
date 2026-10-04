import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, readdir, rm, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { READ_COMPARISON_RETIREMENT as r, compileReadComparisonRetirement, assertReadComparisonRetirement, assertRetirementObservation,
  retireReviewedReadComparison, inspectReadComparisonRetirement, makeRetirementIntent, assertReadComparisonRetirementProof,
  type RetirementObservation } from "../lib/deployments/execution/arn-probe-read-comparison-retirement.ts";
import { createReadComparisonRetirementLedger } from "../lib/deployments/execution/arn-probe-read-comparison-retirement-evidence.ts";
import { AwsSdkReadComparisonRetirementInventory, AwsSdkReadComparisonRetirementDelete } from "../lib/deployments/execution/aws-sdk-arn-probe-read-comparison-retirement.ts";
import { arnProbeComparisonFence, assertArnProbeComparisonCreatePlan as assertG3Plan, compileArnProbeComparisonCreatePlan,
  createReviewedArnProbeComparison } from "../lib/deployments/execution/arn-probe-read-comparison-generation3-create.ts";
import { assertArnProbeComparisonCreatePlan as assertG2Plan } from "../lib/deployments/execution/arn-probe-read-comparison-create.ts";
import { createArnProbeComparisonFsSlot } from "../lib/deployments/execution/arn-probe-read-comparison-generation3-slot.ts";
import { AwsSdkArnProbeComparisonGrantReadAdapter } from "../lib/deployments/execution/aws-sdk-arn-probe-read-comparison-generation3-create.ts";
import { retirementFixture, retirementObservation, retirementProofFixture, retirementTestAt as at, generation1 } from "./fixtures/arn-probe-retirement.ts";
import { comparisonWorkflowFixture } from "./fixtures/arn-probe-generation3-workflow.ts";
import { comparisonWorkflowFixture as generation2Fixture } from "./fixtures/arn-probe-comparison-workflow.ts";

async function temp(run: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "techlong-retirement-test-")));
  try { await run(root); } finally { const resolved = await realpath(root), base = await realpath(os.tmpdir());
    assert.equal(path.dirname(resolved), base); assert.match(path.basename(resolved), /^techlong-retirement-test-/); await rm(resolved, { recursive: true, force: true }); }
}
function field(value: unknown, ...keys: (string | number)[]): Record<string, unknown> {
  let current = value; for (const key of keys) current = (current as Record<string, unknown>)[key];
  return current as Record<string, unknown>;
}
class Command { input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
test("retirement manifest is deterministic, expires in five minutes, and names only the old full Grant ARN", async () => {
  const f = await retirementFixture(); await assertReadComparisonRetirement(f.manifest);
  assert.deepEqual(await compileReadComparisonRetirement(f.manifest.input), f.manifest);
  assert.deepEqual(f.manifest.request, { StackName: r.stackId, ChangeSetName: r.grantArn });
  assert.equal(f.manifest.maxSubmissions, 1); assert.equal(f.manifest.creationAllowed, false); assert.equal(f.manifest.iamMutationAllowed, false);
  assert.equal(Date.parse(f.manifest.input.expiresAt) - Date.parse(f.manifest.input.reviewedAt), 300000);
});
test("rehashed deletion scope, expiry, predecessor and old claim mutations are rejected", async () => {
  const f = await retirementFixture();
  for (const mutate of [(m: Record<string, unknown>) => { field(m, "request").ChangeSetName = field(m, "input", "observation", "recovery", "observation", "fixtureAfter").changeSetArn; },
    (m: Record<string, unknown>) => { field(m, "request").StackName = "foreign"; }, (m: Record<string, unknown>) => { field(m, "request").IncludeNestedStacks = true; },
    (m: Record<string, unknown>) => { m.maxSubmissions = 2; }, (m: Record<string, unknown>) => { field(m, "input", "predecessor").workflowIntentCount = 1; }]) {
    const value = JSON.parse(canonicalJson(f.manifest)); mutate(value); delete value.manifestSha256; value.manifestSha256 = await sha256Hex(canonicalJson(value));
    await assert.rejects(assertReadComparisonRetirement(value));
  }
  await assert.rejects(compileReadComparisonRetirement({ ...f.manifest.input, expiresAt: new Date(at + 300001).toISOString() }));
  await assert.rejects(compileReadComparisonRetirement({ ...f.manifest.input, reviewedAt: "2026-10-04T04:45:00.000Z" }));
});
for (const [label, mutate] of Object.entries({
  "IAM version drift": (v: Record<string, unknown>) => { field(v, "recovery", "observation", "managementAfter", "policies", 0).defaultVersionId = "v6"; },
  "role trust drift": (v: Record<string, unknown>) => { field(v, "recovery", "observation", "managementBefore", "roles", 0).trustPolicySha256 = "0".repeat(64); },
  "fixture drift": (v: Record<string, unknown>) => { field(v, "recovery", "observation", "fixtureAfter").resourceCount = 1; },
  "wrong Grant UUID": (v: Record<string, unknown>) => { field(v, "recovery", "observation", "grant").changeSetArn += "1"; },
  "wrong Grant template": (v: Record<string, unknown>) => { field(v, "recovery", "observation", "grant").templateCanonicalSha256 = "0".repeat(64); },
  "short deletion name": (v: Record<string, unknown>) => { field(v, "inventoryAfter").changeSetArns = [r.grantName]; },
  "competing terminal change": (v: Record<string, unknown>) => { (field(v, "inventoryBefore").changeSetArns as string[]).push("foreign"); },
  "incomplete inventory": (v: Record<string, unknown>) => { field(v, "inventoryAfter").complete = false; },
  "stale observation": (v: Record<string, unknown>) => { field(v, "recovery", "observation", "managementAfter").observedAt = new Date(at - 60001).toISOString(); },
  "unknown secret field": (v: Record<string, unknown>) => { field(v, "recovery", "observation", "grant").credential = "must not enter receipt"; },
})) test(`retirement blocks ${label} even with a recomputed local recovery digest`, async () => {
  const v = JSON.parse(canonicalJson(await retirementObservation("PRESENT"))); mutate(v);
  delete v.recovery.receiptSha256; v.recovery.receiptSha256 = await sha256Hex(canonicalJson(v.recovery));
  await assert.rejects(assertRetirementObservation(v as RetirementObservation, "PRESENT", at));
});
test("durable complete archive precedes exactly one delete; separate Inspect proves retirement", async () => {
  const f = await retirementFixture(); const result = await retireReviewedReadComparison({ ...f, ...f.approval });
  assert.deepEqual(f.events, ["durable-intent", "one-delete"]); assert.equal(result.independentInspectionRequired, true);
  const intent = (await f.ledger.read())!; assert.deepEqual(intent.preflight, f.manifest.input.observation);
  const proof = await inspectReadComparisonRetirement(f); await assertReadComparisonRetirementProof(proof);
  assert.equal(proof.outcome, "RETIRED_LOCKED_VERIFIED"); await assert.rejects(retireReviewedReadComparison({ ...f, ...f.approval }), /consumed/);
});
test("lost reply consumes intent; independent missing proof is sufficient, never a duplicate delete", async () => {
  const f = await retirementFixture();
  const result = await retireReviewedReadComparison({ ...f, ...f.approval, deleteChangeSet: async () => { f.events.push("lost-delete"); f.setAbsent(true); throw new Error("raw secret must not persist"); } });
  assert.equal(result.failures.length, 1); assert.doesNotMatch(JSON.stringify(result), /raw secret/);
  assert.equal((await inspectReadComparisonRetirement(f)).outcome, "RETIRED_LOCKED_VERIFIED");
  await assert.rejects(retireReviewedReadComparison({ ...f, ...f.approval })); assert.deepEqual(f.events, ["durable-intent", "lost-delete"]);
});
test("denied or unsubmitted deletion cannot admit generation3; absence without intent is not adopted", async () => {
  const f = await retirementFixture();
  await retireReviewedReadComparison({ ...f, ...f.approval, deleteChangeSet: async () => { throw Object.assign(new Error(), { name: "AccessDenied" }); } });
  const unproved = await inspectReadComparisonRetirement(f); assert.equal(unproved.outcome, "RETIREMENT_UNPROVED");
  await assert.rejects(assertReadComparisonRetirementProof(unproved)); await assert.rejects(arnProbeComparisonFence(generation1, unproved));
  const missing = await retirementFixture(); missing.setAbsent(true); await assert.rejects(inspectReadComparisonRetirement(missing), /No durable/);
});
test("wrong SHA, wrong phrase, missing acknowledgement, expiry and cancellation do not reserve or write", async () => {
  for (const override of [{ approvedManifestSha256: "0".repeat(64) }, { executionPhrase: "wrong" }, { acknowledgeDeletionIrreversible: false },
    { signal: AbortSignal.abort() }]) { const f = await retirementFixture(); await assert.rejects(retireReviewedReadComparison({ ...f, ...f.approval, ...override })); assert.deepEqual(f.events, []); }
  const f = await retirementFixture(); f.setTime(at + 300000); await assert.rejects(retireReviewedReadComparison({ ...f, ...f.approval })); assert.deepEqual(f.events, []);
});
test("retirement filesystem reads never mkdir, all reviews compete for one durable slot", async () => temp(async (root) => {
  const f = await retirementFixture(), ledger = await createReadComparisonRetirementLedger(root);
  assert.equal(await ledger.read(), null); assert.deepEqual(await readdir(root), []);
  const intent = await makeRetirementIntent(f.manifest, new Date(at).toISOString(), await f.observe());
  await ledger.reserve(intent); assert.deepEqual(await ledger.read(), intent); await assert.rejects(ledger.reserve(intent));
  assert.deepEqual(await (await createReadComparisonRetirementLedger(root)).read(), intent);
}));
test("partial and unknown retirement directories remain consumed without repair", async () => temp(async (root) => {
  await mkdir(path.join(root, r.retirementSlot), { recursive: true });
  const ledger = await createReadComparisonRetirementLedger(root); await assert.rejects(ledger.read());
  assert.deepEqual(await readdir(path.join(root, r.retirementSlot)), []);
}));
test("SDK complete inventory blocks nested, executed, partial and foreign targets", async () => {
  const exact = { StackId: r.stackId, StackName: "techlong-s3-b5-cell-lifecycle-management", ChangeSetId: r.grantArn, ChangeSetName: r.grantName, Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE" };
  for (const reply of [{ Summaries: [{ ...exact, IncludeNestedStacks: true }] }, { Summaries: [{ ...exact, RootChangeSetId: "root" }] },
    { Summaries: [{ ...exact, ExecutionStatus: "EXECUTE_COMPLETE" }] }, { Summaries: [exact, exact] }, { Summaries: [exact], NextToken: "more" },
    { Summaries: [{ ...exact, ChangeSetId: "foreign" }] }]) await assert.rejects(new AwsSdkReadComparisonRetirementInventory({ send: async () => reply }, Command, () => at).read(new AbortController().signal));
  assert.deepEqual((await new AwsSdkReadComparisonRetirementInventory({ send: async () => ({ Summaries: [exact] }) }, Command, () => at).read(new AbortController().signal)).changeSetArns, [r.grantArn]);
});
test("SDK deletion refuses extra flags, is exact full ARN and never replays even on transport loss", async () => {
  const f = await retirementFixture(), requests: unknown[] = [], write = new AwsSdkReadComparisonRetirementDelete(f.manifest, { send: async (c) => { requests.push((c as Command).input); throw new Error("lost"); } }, Command);
  await assert.rejects(write.submit({ ...f.manifest.request, IncludeNestedStacks: true } as typeof f.manifest.request, f.signal)); assert.equal(requests.length, 0);
  await assert.rejects(write.submit(f.manifest.request, f.signal)); await assert.rejects(write.submit(f.manifest.request, f.signal)); assert.deepEqual(requests, [f.manifest.request]);
});
test("generation3 fence binds both old generations and exact retirement proof, never arbitrary generation4", async () => temp(async (root) => {
  const proof = await retirementProofFixture(), fence = await arnProbeComparisonFence(generation1, proof);
  assert.equal(fence.generation, 3); assert.equal(fence.priorGeneration, 2); assert.equal(fence.retirementProofSha256, proof.receiptSha256);
  assert.match(fence.slotRelativePath, /j5gj19-read-comparison\/.+\/slot-000003$/);
  const slot = await createArnProbeComparisonFsSlot(root, fence, proof); assert.equal(await slot.readClaim(), null); assert.deepEqual(await readdir(root), []);
  await assert.rejects(createArnProbeComparisonFsSlot(root, { ...fence, generation: 4 } as unknown as typeof fence, proof));
}));
test("generation2 and generation3 compilers reject each other's plans", async () => {
  const old = await generation2Fixture(), fresh = await comparisonWorkflowFixture();
  await assert.rejects(assertG3Plan(old.review.plan as unknown as Parameters<typeof assertG3Plan>[0]));
  await assert.rejects(assertG2Plan(fresh.review.plan as unknown as Parameters<typeof assertG2Plan>[0]));
  await assertG3Plan(fresh.review.plan);
});
test("generation3 allows only one exact-name candidate and requires retirement to precede the new policy window", async () => {
  const f = await comparisonWorkflowFixture();
  await assert.rejects(compileArnProbeComparisonCreatePlan({ ...f.review.plan.input, variant: "FULL_ARN_CONDITION" }));
  const proof = JSON.parse(canonicalJson(f.review.plan.input.retirementProof)); proof.outcome = "RETIREMENT_UNPROVED";
  await assert.rejects(compileArnProbeComparisonCreatePlan({ ...f.review.plan.input, retirementProof: proof }));
});
test("generation3 fresh preflight preserves retired baseline, consumes the fixed slot, and creates only once", async () => temp(async (root) => {
  const f = await comparisonWorkflowFixture(), slot = await createArnProbeComparisonFsSlot(root, f.fence, f.review.plan.input.retirementProof);
  const source = f.review.sourceReview.observation, requests: unknown[] = [];
  const input = { review: f.review, slot, readPredecessor: f.readPredecessor, now: f.now, signal: f.signal,
    reads: { readManagement: async () => source.managementAfter, readFixture: async () => source.fixtureAfter,
      readEmptyManagementInventory: async () => source.inventoryAfter },
    approvedReviewSha256: f.review.reviewSha256, executionPhrase: f.review.requiredPhrase, acknowledgeAwsWrite: true,
    acknowledgeNamedIamChangeSetOnly: true, acknowledgeLowCostNotZero: true, acknowledgePreservesPredecessorAndConsumesGeneration3: true,
    create: async (request: typeof f.review.plan.request) => { requests.push(request); return { StackId: r.stackId, Id: f.grantArn, $metadata: { requestId: "11111111-2222-4333-8444-555555555555" } }; } };
  const result = await createReviewedArnProbeComparison(input); assert.equal(result.outcome, "CREATE_SUBMITTED"); assert.equal(result.grantInstalled, false);
  assert.deepEqual(requests, [f.review.plan.request]); await assert.rejects(createReviewedArnProbeComparison(input), /consumed/);
  assert.equal((await slot.readClaim())!.fence.generation, 3);
}));
test("local approval wrapper requires full SHA parameters and does not prompt for, fill or refresh approval", async () => {
  const source = await readFile(new URL("../ops/aws-sandbox/scripts/Invoke-ReviewedReadComparison.ps1", import.meta.url), "utf8");
  for (const name of ["ApprovedRetirementManifestSha", "ApprovedCreationReviewSha", "ApprovedManifestSha"]) assert.match(source, new RegExp(`Parameter\\(Mandatory[^\\n]*\\).*\\n?[^\\n]*\\$${name}`));
  assert.doesNotMatch(source.replace(/^#.*$/gm, ""), /Read-Host|Get-Credential/);
  assert.match(source, /--mode RecoverCreate/); assert.match(source, /--mode Inspect/);
  assert.match(source, /Display a command; never invoke it/);
});
test("generation3 creation settlement reads only the singleton target and refuses missing, competing or nested adoption", async () => {
  const f = await comparisonWorkflowFixture(), plan = f.review.plan, requests: Record<string, unknown>[] = [];
  const summary = { StackId: r.stackId, ChangeSetName: plan.request.ChangeSetName, ChangeSetId: f.grantArn, Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE" };
  const describe = { ...summary, StackName: "techlong-s3-b5-cell-lifecycle-management", Description: plan.request.Description,
    Parameters: [{ ParameterKey: "ExpectedAccountId", ParameterValue: "402010193138" }, { ParameterKey: "ExpectedRegion", ParameterValue: "ca-central-1" },
      { ParameterKey: "ManagementPrincipalArn", ParameterValue: "arn:aws:iam::402010193138:user/techlong-sandbox-dev" }], Capabilities: ["CAPABILITY_NAMED_IAM"],
    Changes: [{ Type: "Resource", ResourceChange: { Action: "Modify", LogicalResourceId: "CellOperatorBoundary", ResourceType: "AWS::IAM::ManagedPolicy",
      PhysicalResourceId: "arn:aws:iam::402010193138:policy/TechlongSandboxCellOperatorBoundary", Replacement: "False" } }] };
  const commands = { listChangeSets: Command, describeChangeSet: Command, getTemplate: Command };
  const reader = new AwsSdkArnProbeComparisonGrantReadAdapter({ send: async (c) => {
    const request = (c as Command).input; requests.push(request);
    return request.TemplateStage ? { TemplateBody: plan.request.TemplateBody } : request.ChangeSetName ? describe : { Summaries: [summary] };
  } }, commands, f.now);
  assert.equal((await reader.waitReady(plan, f.signal)).state, "READY_UNEXECUTED");
  assert.ok(requests.every((v) => v.StackName === r.stackId && (!v.ChangeSetName || v.ChangeSetName === f.grantArn)));
  const absent = new AwsSdkArnProbeComparisonGrantReadAdapter({ send: async () => ({ Summaries: [] }) }, commands, f.now);
  assert.equal((await absent.waitReady(plan, f.signal)).state, "MISSING");
  for (const Summaries of [[summary, summary], [{ ...summary, IncludeNestedStacks: true }], [{ ...summary, Status: "FAILED" }]])
    await assert.rejects(new AwsSdkArnProbeComparisonGrantReadAdapter({ send: async () => ({ Summaries }) }, commands, f.now).waitReady(plan, f.signal));
});
