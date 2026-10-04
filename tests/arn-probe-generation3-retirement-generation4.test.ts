import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, readdir, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { READ_COMPARISON_RETIREMENT as r, checkReadComparisonRetirementPreparation, assertRetirementObservation, assertReadComparisonRetirement,
  compileReadComparisonRetirement, retireReviewedReadComparison, inspectReadComparisonRetirement, makeRetirementIntent,
  assertReadComparisonRetirementProof, type RetirementObservation } from "../lib/deployments/execution/arn-probe-read-comparison-generation3-retirement.ts";
import { createReadComparisonRetirementLedger } from "../lib/deployments/execution/arn-probe-read-comparison-generation3-retirement-evidence.ts";
import { guardRetirementReadClient, AwsSdkReadComparisonRetirementInventory, AwsSdkReadComparisonRetirementDelete } from "../lib/deployments/execution/aws-sdk-arn-probe-read-comparison-generation3-retirement.ts";
import { arnProbeComparisonFence, compileArnProbeComparisonCreatePlan, assertArnProbeComparisonCreatePlan, assertArnProbeComparisonCreateReview,
  reviewArnProbeComparisonCreate, GENERATION4_LIVE_EXECUTION_IMPLEMENTED } from "../lib/deployments/execution/arn-probe-read-comparison-generation4-create.ts";
import { createArnProbeComparisonFsSlot } from "../lib/deployments/execution/arn-probe-read-comparison-generation4-slot.ts";
import { assertArnProbeComparisonCreatePlan as assertGeneration3Plan } from "../lib/deployments/execution/arn-probe-read-comparison-generation3-create.ts";
import { retirementFixture as generation2Fixture, generation1 } from "./fixtures/arn-probe-retirement.ts";
import { comparisonWorkflowFixture as generation3Fixture } from "./fixtures/arn-probe-generation3-workflow.ts";
import { generation3RetirementFixture, generation3Observation, generation3RetiredProof, retiredGeneration2, generation4Fixture, generation3RetirementTestAt as at } from "./fixtures/arn-probe-generation3-retirement.ts";

async function temp(run: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "techlong-g4-test-")));
  try { await run(root); } finally {
    const resolved = await realpath(root), base = await realpath(os.tmpdir());
    assert.equal(path.dirname(resolved), base); assert.match(path.basename(resolved), /^techlong-g4-test-/);
    await rm(resolved, { recursive: true, force: true });
  }
}
function field(value: unknown, ...keys: (string | number)[]): Record<string, unknown> {
  let current = value; for (const key of keys) current = (current as Record<string, unknown>)[key]; return current as Record<string, unknown>;
}
class Command { input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
test("preparation is non-executable, opens no window, and consumes no retirement intent", async () => {
  const f = await generation3RetirementFixture(), checked = await checkReadComparisonRetirementPreparation(f);
  assert.equal(checked.mutationPerformed, false); assert.equal(checked.approvalWindowOpened, false); assert.equal(checked.manifestCreated, false);
  assert.equal(checked.deletionAuthorized, false); assert.equal(checked.creationAuthorized, false); assert.deepEqual(f.events, []);
  await assert.rejects(assertReadComparisonRetirement(checked as unknown as typeof f.manifest));
});
test("generation3 retirement names only the exact sealed Grant, has five-minute approval, and rejects generation2 approval", async () => {
  const f = await generation3RetirementFixture(); await assertReadComparisonRetirement(f.manifest);
  assert.deepEqual(await compileReadComparisonRetirement(f.manifest.input), f.manifest);
  assert.deepEqual(f.manifest.request, { StackName: r.stackId, ChangeSetName: r.grantArn });
  assert.equal(f.manifest.maxSubmissions, 1); assert.equal(f.manifest.creationAllowed, false); assert.equal(f.manifest.iamMutationAllowed, false);
  assert.equal(Date.parse(f.manifest.input.expiresAt) - Date.parse(f.manifest.input.reviewedAt), 300000);
  const old = await generation2Fixture(); await assert.rejects(assertReadComparisonRetirement(old.manifest as unknown as typeof f.manifest));
});
test("generation3 retirement rejects rehashed scope changes and a still-live old policy", async () => {
  const f = await generation3RetirementFixture();
  for (const mutate of [(v: Record<string, unknown>) => { field(v, "request").ChangeSetName = r.grantName; },
    (v: Record<string, unknown>) => { field(v, "request").IncludeNestedStacks = true; }, (v: Record<string, unknown>) => { v.maxSubmissions = 2; },
    (v: Record<string, unknown>) => { field(v, "input", "predecessor").workflowIntentCount = 1; }]) {
    const v = JSON.parse(canonicalJson(f.manifest)); mutate(v); delete v.manifestSha256; v.manifestSha256 = await sha256Hex(canonicalJson(v));
    await assert.rejects(assertReadComparisonRetirement(v));
  }
  const early = Date.parse(r.policyExpiresAt) - 1;
  await assert.rejects(compileReadComparisonRetirement({ ...f.manifest.input, observation: await generation3Observation("PRESENT", early), reviewedAt: new Date(early).toISOString(), expiresAt: new Date(early + 300000).toISOString() }));
});
for (const [name, mutate] of Object.entries({
  "policy version drift": (v: Record<string, unknown>) => { field(v, "recovery", "observation", "managementAfter", "policies", 0).defaultVersionId = "v6"; },
  "role trust drift": (v: Record<string, unknown>) => { field(v, "recovery", "observation", "managementBefore", "roles", 0).trustPolicySha256 = "0".repeat(64); },
  "original fixture changed": (v: Record<string, unknown>) => { field(v, "recovery", "observation", "fixtureAfter").resourceCount = 1; },
  "another UUID": (v: Record<string, unknown>) => { field(v, "recovery", "observation", "grant").changeSetArn = r.grantArn + "1"; },
  "another template": (v: Record<string, unknown>) => { field(v, "recovery", "observation", "grant").templateCanonicalSha256 = "0".repeat(64); },
  "old claim changed": (v: Record<string, unknown>) => { field(v, "recovery", "claim").claimSha256 = "0".repeat(64); },
  "unknown recovery credential": (v: Record<string, unknown>) => { field(v, "recovery").credential = "not-persisted"; },
  "competing terminal object": (v: Record<string, unknown>) => { (field(v, "inventoryBefore").changeSetArns as string[]).push("foreign"); },
  "incomplete inventory": (v: Record<string, unknown>) => { field(v, "inventoryAfter").complete = false; },
  "stale snapshot": (v: Record<string, unknown>) => { field(v, "recovery", "observation", "managementAfter").observedAt = new Date(at - 60001).toISOString(); },
})) test(`generation3 retirement blocks ${name} even after recovery digest recomputation`, async () => {
  const f = await generation3RetirementFixture(), v = JSON.parse(canonicalJson(await f.observe())); mutate(v);
  delete v.recovery.receiptSha256; v.recovery.receiptSha256 = await sha256Hex(canonicalJson(v.recovery));
  await assert.rejects(assertRetirementObservation(v as RetirementObservation, "PRESENT", at, await f.readPredecessor()));
});
test("exact approval, permanent archive and readback precede one delete; separate missing inspection admits a proof", async () => {
  const f = await generation3RetirementFixture(), submitted = await retireReviewedReadComparison({ ...f, ...f.approval });
  assert.deepEqual(f.events, ["durable-intent", "one-delete"]); assert.equal(submitted.independentInspectionRequired, true);
  const proof = await inspectReadComparisonRetirement(f); await assertReadComparisonRetirementProof(proof);
  assert.equal(proof.outcome, "RETIRED_LOCKED_VERIFIED"); await assert.rejects(retireReviewedReadComparison({ ...f, ...f.approval }), /consumed/);
});
test("lost delete reply consumes the slot forever, missing without an intent cannot be adopted", async () => {
  const f = await generation3RetirementFixture();
  const result = await retireReviewedReadComparison({ ...f, ...f.approval, deleteChangeSet: async () => { f.events.push("lost-delete"); f.setAbsent(true); throw new Error("raw-sensitive-error"); } });
  assert.equal(result.failures.length, 1); assert.doesNotMatch(JSON.stringify(result), /raw-sensitive-error/);
  await assertReadComparisonRetirementProof(await inspectReadComparisonRetirement(f));
  await assert.rejects(retireReviewedReadComparison({ ...f, ...f.approval })); assert.deepEqual(f.events, ["durable-intent", "lost-delete"]);
  const missing = await generation3RetirementFixture(); missing.setAbsent(true); await assert.rejects(inspectReadComparisonRetirement(missing), /No durable/);
});
test("approval expiry after intent consumes the slot without submitting or allowing a replay", async () => {
  const f = await generation3RetirementFixture(), originalReserve = f.ledger.reserve;
  f.ledger.reserve = async (intent) => { await originalReserve(intent); f.setTime(at + 300000); };
  const result = await retireReviewedReadComparison({ ...f, ...f.approval });
  assert.equal(result.deletionAttempted, false); assert.equal(result.outcome, "NO_DELETE_SUBMITTED_SLOT_CONSUMED");
  assert.deepEqual(f.events, ["durable-intent"]); assert.ok(await f.ledger.read());
  await assert.rejects(retireReviewedReadComparison({ ...f, ...f.approval }));
});
test("denied retirement cannot authorize generation4; wrong SHA/phrase/acknowledgement/expiry reserve nothing", async () => {
  for (const override of [{ approvedManifestSha256: "0".repeat(64) }, { executionPhrase: "wrong" }, { acknowledgeDeletionIrreversible: false }, { signal: AbortSignal.abort() }]) {
    const f = await generation3RetirementFixture(); await assert.rejects(retireReviewedReadComparison({ ...f, ...f.approval, ...override })); assert.deepEqual(f.events, []);
  }
  const expired = await generation3RetirementFixture(); expired.setTime(at + 300000); await assert.rejects(retireReviewedReadComparison({ ...expired, ...expired.approval })); assert.deepEqual(expired.events, []);
  const denied = await generation3RetirementFixture(); await retireReviewedReadComparison({ ...denied, ...denied.approval, deleteChangeSet: async () => { throw Object.assign(new Error(), { name: "AccessDenied" }); } });
  const unproved = await inspectReadComparisonRetirement(denied); assert.equal(unproved.outcome, "RETIREMENT_UNPROVED");
  await assert.rejects(arnProbeComparisonFence(generation1, unproved));
});
test("retirement filesystem reads do not mkdir; one fixed winner, partial and unknown slots block", async () => temp(async (root) => {
  const f = await generation3RetirementFixture(), ledger = await createReadComparisonRetirementLedger(root);
  assert.equal(await ledger.read(), null); assert.deepEqual(await readdir(root), []);
  const intent = await makeRetirementIntent(f.manifest, new Date(at).toISOString(), await f.observe());
  const winners = await Promise.allSettled([ledger.reserve(intent), ledger.reserve(intent)]);
  assert.equal(winners.filter((v) => v.status === "fulfilled").length, 1); assert.deepEqual(await ledger.read(), intent);
  await assert.rejects(ledger.reserve(intent));
}));
test("partial retirement archive remains consumed and is never repaired", async () => temp(async (root) => {
  await mkdir(path.join(root, r.retirementSlot), { recursive: true }); const ledger = await createReadComparisonRetirementLedger(root);
  await assert.rejects(ledger.read()); assert.deepEqual(await readdir(path.join(root, r.retirementSlot)), []);
}));
test("SDK inventory refuses nested, executed, incomplete or foreign targets; delete is exact and single-submit", async () => {
  const summary = { StackId: r.stackId, StackName: "techlong-s3-b5-cell-lifecycle-management", ChangeSetId: r.grantArn, ChangeSetName: r.grantName, Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE" };
  for (const reply of [{ Summaries: [{ ...summary, IncludeNestedStacks: true }] }, { Summaries: [{ ...summary, ParentChangeSetId: "parent" }] },
    { Summaries: [{ ...summary, ExecutionStatus: "EXECUTE_COMPLETE" }] }, { Summaries: [summary], NextToken: "more" }, { Summaries: [summary, summary] }])
    await assert.rejects(new AwsSdkReadComparisonRetirementInventory({ send: async () => reply }, Command, () => at).read(new AbortController().signal));
  assert.deepEqual((await new AwsSdkReadComparisonRetirementInventory({ send: async () => ({ Summaries: [summary] }) }, Command, () => at).read(new AbortController().signal)).changeSetArns, [r.grantArn]);
  const f = await generation3RetirementFixture(), requests: unknown[] = [];
  const deletion = new AwsSdkReadComparisonRetirementDelete(f.manifest, { send: async (command) => { requests.push((command as Command).input); throw new Error("lost"); } }, Command);
  await assert.rejects(deletion.submit({ ...f.manifest.request, IncludeNestedStacks: true } as typeof f.manifest.request, f.signal));
  assert.equal(requests.length, 0); await assert.rejects(deletion.submit(f.manifest.request, f.signal)); await assert.rejects(deletion.submit(f.manifest.request, f.signal));
  assert.deepEqual(requests, [f.manifest.request]);
});
test("retirement Describe guard rejects true or ambiguous nested/import flags", async () => {
  for (const value of [true, "false", "true", 0, null]) for (const key of ["IncludeNestedStacks", "ImportExistingResources"])
    await assert.rejects(guardRetirementReadClient({ send: async () => ({ [key]: value }) }).send(new Command({}), { abortSignal: new AbortController().signal }));
  assert.deepEqual(await guardRetirementReadClient({ send: async () => ({ IncludeNestedStacks: false }) }).send(new Command({}), { abortSignal: new AbortController().signal }), { IncludeNestedStacks: false });
});
test("generation4 fence binds all three preserved generations and only independent generation3 retirement", async () => {
  const proof = await generation3RetiredProof(), fence = await arnProbeComparisonFence(generation1, proof);
  assert.equal(fence.generation, 4); assert.equal(fence.priorGeneration, 3); assert.equal(fence.generation2RetirementProofSha256, r.generation2RetirementProofSha256);
  assert.equal(fence.generation3SlotRelativePath, r.oldSlot); assert.equal(fence.retirementProofSha256, proof.receiptSha256);
  assert.match(fence.slotRelativePath, /j5gj20-read-comparison\/.+\/slot-000004$/);
  await assert.rejects(arnProbeComparisonFence(generation1, await retiredGeneration2() as unknown as typeof proof));
});
test("generation4 compilation is isolated, exact-name only and keeps 30/5/10 boundaries without live capability", async () => {
  const f = await generation4Fixture(), old = await generation3Fixture(); await assertArnProbeComparisonCreatePlan(f.review.plan); await assertArnProbeComparisonCreateReview(f.review);
  assert.match(f.review.plan.request.ChangeSetName, /^techlong-j5gj20-read-grant-/); assert.equal(f.review.plan.request.ChangeSetType, "UPDATE");
  assert.equal(f.review.plan.candidatePolicyDurationMs, 1800000); assert.equal(f.review.plan.maximumApprovalDurationMs, 300000); assert.equal(f.review.plan.minimumRevokeMarginMs, 600000);
  assert.equal(f.review.grantExecutionAuthorized, false); assert.equal(GENERATION4_LIVE_EXECUTION_IMPLEMENTED, false);
  assert.ok(Buffer.byteLength(canonicalJson(f.review), "utf8") < 600000);
  await assert.rejects(compileArnProbeComparisonCreatePlan({ ...f.review.plan.input, variant: "FULL_ARN_CONDITION" }));
  await assert.rejects(assertArnProbeComparisonCreatePlan(old.review.plan as unknown as typeof f.review.plan));
  await assert.rejects(assertGeneration3Plan(f.review.plan as unknown as typeof old.review.plan));
});
test("generation4 fixed slot reads never mkdir, rejects foreign generations, and all reviews share one winner", async () => temp(async (root) => {
  const f = await generation4Fixture(), slot = await createArnProbeComparisonFsSlot(root, f.fence, f.proof);
  assert.equal(await slot.readClaim(), null); assert.deepEqual(await readdir(root), []);
  await assert.rejects(createArnProbeComparisonFsSlot(root, { ...f.fence, generation: 5 } as unknown as typeof f.fence, f.proof));
  const next = await reviewArnProbeComparisonCreate({ sourceReview: f.review.sourceReview, variant: "EXACT_NAME_CONDITION", retirementProof: f.proof,
    slot, signal: new AbortController().signal, now: () => f.at + 1 });
  assert.notEqual(next.reviewSha256, f.review.reviewSha256); assert.equal(next.fence.slotRelativePath, f.fence.slotRelativePath);
  const winner = await slot.reserve(f.review, "f".repeat(64), new Date(f.at).toISOString()); assert.equal(winner.action, "CLAIM_GENERATION4_BEFORE_CREATE");
  await assert.rejects(slot.reserve(next, "f".repeat(64), new Date(f.at + 1).toISOString()));
  assert.deepEqual(await slot.readClaim(), winner); assert.deepEqual(await readdir(path.join(root, f.fence.slotRelativePath)), ["claim.json"]);
}));
test("generation4 partial slots and extra files remain blocked without repair", async () => temp(async (root) => {
  const f = await generation4Fixture(); await mkdir(path.join(root, f.fence.slotRelativePath), { recursive: true });
  const slot = await createArnProbeComparisonFsSlot(root, f.fence, f.proof); await assert.rejects(slot.readClaim());
  assert.deepEqual(await readdir(path.join(root, f.fence.slotRelativePath)), []);
}));
test("generation4 rejects expired/foreign reservation before creating directories, and rejects unexpected files", async () => temp(async (root) => {
  const f = await generation4Fixture(), slot = await createArnProbeComparisonFsSlot(root, f.fence, f.proof), old = await generation3Fixture();
  await assert.rejects(slot.reserve(f.review, "f".repeat(64), f.review.expiresAt));
  await assert.rejects(slot.reserve(old.review as unknown as typeof f.review, "f".repeat(64), new Date(f.at).toISOString()));
  assert.deepEqual(await readdir(root), []);
  await slot.reserve(f.review, "f".repeat(64), new Date(f.at).toISOString());
  await writeFile(path.join(root, f.fence.slotRelativePath, "unexpected-intent.json"), "{}");
  await assert.rejects(slot.readClaim());
  assert.deepEqual((await readdir(path.join(root, f.fence.slotRelativePath))).sort(), ["claim.json", "unexpected-intent.json"]);
}));
test("local retirement wrapper requires new full SHA, has no prompt or successor operation", async () => {
  const source = await readFile(new URL("../ops/aws-sandbox/scripts/Invoke-ReviewedGeneration3Retirement.ps1", import.meta.url), "utf8");
  assert.match(source, /Parameter\(Mandatory\).*ValidatePattern[^\n]*\$ApprovedManifestSha/);
  assert.match(source, /Select-Object -First 1/); assert.match(source, /Assert-ReadComparisonApprovalWindow/);
  assert.doesNotMatch(source, /Read-Host|Get-Credential|--mode CreateReviewed|--mode RunReviewed/);
  assert.match(source, /--mode RetireReviewed/); assert.match(source, /--mode Inspect/);
});
test("real PowerShell wrapper rejects a legacy generation2 approval before Node or output", { skip: process.platform !== "win32" }, async () => temp(async (root) => {
  const f = await generation2Fixture(), manifest = path.join(root, "old.json"), evidence = path.join(root, "evidence.json"), output = path.join(root, "not-created.json");
  await writeFile(manifest, JSON.stringify(f.manifest)); await writeFile(evidence, "{}");
  const child = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", fileURLToPath(new URL("../ops/aws-sandbox/scripts/Invoke-ReviewedGeneration3Retirement.ps1", import.meta.url)),
    "-Evidence", evidence, "-Manifest", manifest, "-Output", output, "-ApprovedManifestSha", f.manifest.manifestSha256], { encoding: "utf8", timeout: 15000, windowsHide: true });
  assert.notEqual(child.status, 0); assert.match(`${child.stdout}\n${child.stderr}`, /New exact generation3 retirement approval not supplied/);
  assert.deepEqual((await readdir(root)).sort(), ["evidence.json", "old.json"]);
}));
