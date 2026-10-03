import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, realpath, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { compileArnProbeFixturePlan } from "../lib/deployments/execution/arn-compatibility-probe-fixture.ts";
import { compileArnProbeGrantPlan } from "../lib/deployments/execution/arn-compatibility-probe-grant.ts";
import { ARN_PROBE_READ_COMPARISON_ANCHORS as anchors, ARN_PROBE_CONSUMED_SLOT_FILES, reviewArnProbeReadComparison,
  type ArnProbeReadComparisonPredecessor, type ArnProbeReadComparisonObservation } from "../lib/deployments/execution/arn-compatibility-probe-read-comparison.ts";
import { arnProbeComparisonFence, reviewArnProbeComparisonCreate, assertArnProbeComparisonCreateReview, assertArnProbeComparisonCreatePlan,
  createReviewedArnProbeComparison, recoverArnProbeComparisonCreate, type ArnProbeComparisonSlot, type ArnProbeComparisonCreateReview } from "../lib/deployments/execution/arn-probe-read-comparison-create.ts";
import { createArnProbeComparisonFsSlot } from "../lib/deployments/execution/arn-probe-read-comparison-slot.ts";
import { AwsSdkArnProbeComparisonGrantCreateAdapter, AwsSdkArnProbeComparisonGrantReadAdapter, validateArnProbeComparisonGrant } from "../lib/deployments/execution/aws-sdk-arn-probe-read-comparison-create.ts";

const at = Date.parse("2026-10-03T23:00:00.000Z"), signal = () => new AbortController().signal;
function predecessor(): ArnProbeReadComparisonPredecessor { return { anchors, consumedGeneration: 1,
  consumedSlotRelativePath: `.aws-sandbox/j5gj13-arn-probe/${anchors.targetFenceKey}/slot-000001`, slotFiles: ARN_PROBE_CONSUMED_SLOT_FILES,
  consumed: true, probeDeleteIntentPresent: false, replayAllowed: false }; }
// Public reviewed identities reconstructed deterministically. All observations
// are test doubles, never live evidence or access to the real local ledger.
async function setup() {
  const fixturePlan = await compileArnProbeFixturePlan({ nonce: "8f1ff840c31f4ad49721de90bbc80271", reviewedAt: "2026-10-03T14:59:32.448Z", expiresAt: "2026-10-03T15:59:32.448Z" });
  const prior = await compileArnProbeGrantPlan({ fixturePlan,
    fixtureStackId: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-arn-compatibility-probe/e5fcb450-bf3d-11f1-8f15-02cdaaa60ec7",
    fixtureChangeSetArn: "arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-sandbox-arn-compatibility-probe-08b7955eb7029b3a/ffac6957-44d4-4485-9d08-d018a0be3f11",
    nonce: "3ccad1207bf042a5a71a23058cd28ad3", reviewedAt: "2026-10-03T20:54:10.050Z", expiresAt: "2026-10-03T21:54:10.050Z" });
  assert.equal(prior.planSha256, anchors.planSha256);
  const management: ArnProbeReadComparisonObservation["managementBefore"] = { schemaVersion: 1, accountId: "402010193138", region: "ca-central-1",
    callerArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev", rendererShape: "Locked", cellStackState: "MISSING", authorityState: "ABSENT",
    policies: [], roles: [], observedAt: new Date(at).toISOString(), stack: { id: prior.managementStackId, name: "techlong-s3-b5-cell-lifecycle-management", status: "UPDATE_COMPLETE", roleArn: null,
      parentId: null, rootId: null, terminationProtection: false, templateRawSha256: prior.revokeTarget.templateRawSha256, templateCanonicalSha256: prior.revokeTarget.templateCanonicalSha256, safetyState: "LOCKED", resources: [] } };
  const fixture = { state: "READY_UNEXECUTED" as const, stackId: prior.input.fixtureStackId, changeSetArn: prior.input.fixtureChangeSetArn,
    resourceCount: 0 as const, templateCanonicalSha256: fixturePlan.templateCanonicalSha256, observedAt: new Date(at).toISOString() };
  const reads = { readManagement: async () => structuredClone(management), readFixture: async () => structuredClone(fixture),
    readEmptyManagementInventory: async () => ({ state: "EMPTY" as const, changeSetCount: 0 as const, stackId: prior.managementStackId, observedAt: new Date(at).toISOString(), providerEvidenceSha256: "f".repeat(64) }) };
  const readPredecessor = async () => predecessor(), sourceReview = await reviewArnProbeReadComparison({ priorPlan: prior, reads, readPredecessor, signal: signal(), now: () => at });
  const fence = await arnProbeComparisonFence(predecessor());
  const review = await reviewArnProbeComparisonCreate({ sourceReview, variant: "EXACT_NAME_CONDITION", slot: { fence, readClaim: async () => null }, signal: signal(), now: () => at });
  return { prior, sourceReview, review, fence, reads, readPredecessor };
}
async function temp(run: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "techlong-j17-test-")));
  try { await run(root); } finally {
    const resolved = await realpath(root), base = await realpath(os.tmpdir()); assert.equal(path.dirname(resolved), base); assert.match(path.basename(resolved), /^techlong-j17-test-/);
    await rm(resolved, { recursive: true, force: true });
  }
}
function approve(review: ArnProbeComparisonCreateReview) { return { approvedReviewSha256: review.reviewSha256, executionPhrase: review.requiredPhrase,
  acknowledgeAwsWrite: true, acknowledgeNamedIamChangeSetOnly: true, acknowledgeLowCostNotZero: true, acknowledgePreservesPredecessorAndConsumesGeneration2: true }; }
const providerArn = (r: ArnProbeComparisonCreateReview) => `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${r.plan.request.ChangeSetName}/11111111-2222-4333-8444-555555555555`;
function provider(r: ArnProbeComparisonCreateReview) { return { StackId: r.plan.request.StackName, StackName: "techlong-s3-b5-cell-lifecycle-management", ChangeSetId: providerArn(r), ChangeSetName: r.plan.request.ChangeSetName,
  Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", Description: r.plan.request.Description, Capabilities: ["CAPABILITY_NAMED_IAM"],
  Parameters: [{ ParameterKey: "ExpectedAccountId", ParameterValue: "402010193138" }, { ParameterKey: "ExpectedRegion", ParameterValue: "ca-central-1" },
    { ParameterKey: "ManagementPrincipalArn", ParameterValue: "arn:aws:iam::402010193138:user/techlong-sandbox-dev" }],
  Changes: [{ Type: "Resource", ResourceChange: { Action: "Modify", LogicalResourceId: "CellOperatorBoundary", ResourceType: "AWS::IAM::ManagedPolicy",
    PhysicalResourceId: "arn:aws:iam::402010193138:policy/TechlongSandboxCellOperatorBoundary", Replacement: "False" } }] }; }

test("deterministic exact candidate is immutable creation-only, never an installation or Operator approval", async () => {
  const { review } = await setup(); await assertArnProbeComparisonCreateReview(review); await assertArnProbeComparisonCreatePlan(review.plan);
  assert.equal(review.plan.request.TemplateBody, review.sourceReview.plan.candidates[1].proposedTemplateBody);
  assert.deepEqual(review.plan.request.Capabilities, ["CAPABILITY_NAMED_IAM"]); assert.equal(review.plan.request.ChangeSetType, "UPDATE");
  assert.equal("RoleARN" in review.plan.request, false); assert.equal(review.operatorReadAuthorized, false); assert.equal(review.grantExecutionAuthorized, false);
  assert.equal(review.creationApproved, false); assert.equal(review.consumesSlotPermanently, true); assert.equal(Object.isFrozen(review.plan.request), true);
});
test("both candidates and changed review window use exactly the same fixed generation2 path", async () => {
  const { sourceReview, fence, prior, reads, readPredecessor } = await setup();
  const later = at + 600_000, stamp = new Date(later).toISOString();
  const laterReads = { readManagement: async () => ({ ...await reads.readManagement(), observedAt: stamp }),
    readFixture: async () => ({ ...await reads.readFixture(), observedAt: stamp }),
    readEmptyManagementInventory: async () => ({ ...await reads.readEmptyManagementInventory(), observedAt: stamp }) };
  const laterSource = await reviewArnProbeReadComparison({ priorPlan: prior, reads: laterReads, readPredecessor, signal: signal(), now: () => later });
  assert.notEqual(laterSource.plan.planSha256, sourceReview.plan.planSha256);
  const full = await reviewArnProbeComparisonCreate({ sourceReview: laterSource, variant: "FULL_ARN_CONDITION", slot: { fence, readClaim: async () => null }, signal: signal(), now: () => later });
  assert.deepEqual(full.fence, fence); assert.match(fence.slotRelativePath, /j5gj17-read-comparison\/[a-f0-9]{64}\/slot-000002$/); assert.notEqual(fence.slotRelativePath, fence.priorSlotRelativePath);
  await temp(async (root) => { await assert.rejects(createArnProbeComparisonFsSlot(root, { ...fence, generation: 3 } as unknown as typeof fence)); });
});
test("rehashed template/request/fence/authority tampering fails strict recompilation", async () => {
  for (const field of ["request", "fence", "authority", "candidate"]) {
    const value = JSON.parse(canonicalJson((await setup()).review));
    if (field === "request") value.plan.request.RoleARN = "arn:aws:iam::402010193138:role/admin";
    if (field === "fence") value.fence.slotRelativePath += "-retry";
    if (field === "authority") value.operatorReadAuthorized = true;
    if (field === "candidate") value.plan.input.variant = "FULL_ARN_CONDITION";
    delete value.reviewSha256; value.reviewSha256 = await sha256Hex(canonicalJson(value)); await assert.rejects(assertArnProbeComparisonCreateReview(value));
  }
});
test("slot reads and ReviewCreate do not mkdir or modify any ledger", async () => {
  const { sourceReview, fence } = await setup(); await temp(async (root) => { const slot = await createArnProbeComparisonFsSlot(root, fence); assert.equal(await slot.readClaim(), null);
    await reviewArnProbeComparisonCreate({ sourceReview, variant: "EXACT_NAME_CONDITION", slot, signal: signal(), now: () => at }); assert.deepEqual(await readdir(root), []); });
});
test("simultaneous candidate reservations have one durable winner, and fresh reviews cannot replay", async () => {
  const { sourceReview, review, fence } = await setup(); await temp(async (root) => {
    const slot = await createArnProbeComparisonFsSlot(root, fence), full = await reviewArnProbeComparisonCreate({ sourceReview, variant: "FULL_ARN_CONDITION", slot, signal: signal(), now: () => at });
    const results = await Promise.allSettled([slot.reserve(review, "f".repeat(64), new Date(at).toISOString()), slot.reserve(full, "f".repeat(64), new Date(at).toISOString())]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1); const claim = await slot.readClaim(); assert.ok(claim);
    const again = await createArnProbeComparisonFsSlot(root, fence); assert.deepEqual(await again.readClaim(), claim);
    await assert.rejects(reviewArnProbeComparisonCreate({ sourceReview, variant: "FULL_ARN_CONDITION", slot: again, signal: signal(), now: () => at }), /consumed/);
  });
});
test("partial/corrupt slot remains consumed and is never repaired", async () => {
  const { fence } = await setup(); await temp(async (root) => { const folder = path.join(root, ...fence.slotRelativePath.split("/")); await mkdir(folder, { recursive: true });
    const slot = await createArnProbeComparisonFsSlot(root, fence); await assert.rejects(slot.readClaim(), /inventory/);
    await writeFile(path.join(folder, "claim.json"), "{partial"); await assert.rejects(slot.readClaim()); assert.equal(await readFile(path.join(folder, "claim.json"), "utf8"), "{partial"); });
});
test("unknown targets/generations/files and linked registry fail closed", async () => {
  const { fence } = await setup();
  for (const suffix of ["other-target", `${anchors.targetFenceKey}/slot-000003`, `${anchors.targetFenceKey}/slot-000002/unknown.json`]) await temp(async (root) => {
    const target = path.join(root, ".aws-sandbox", "j5gj17-read-comparison", ...suffix.split("/"));
    if (suffix.endsWith(".json")) { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, "{}"); } else await mkdir(target, { recursive: true });
    await assert.rejects((await createArnProbeComparisonFsSlot(root, fence)).readClaim());
  });
  await temp(async (root) => { const outside = path.join(root, "other"); await mkdir(outside); await mkdir(path.join(root, ".aws-sandbox"));
    await symlink(outside, path.join(root, ".aws-sandbox", "j5gj17-read-comparison"), "junction"); await assert.rejects((await createArnProbeComparisonFsSlot(root, fence)).readClaim(), /ordinary/); });
});
test("bad SHA, incomplete approval, expiry and cancellation fail before reserve/Create", async () => {
  const data = await setup(); let reservations = 0, submissions = 0;
  const slot: ArnProbeComparisonSlot = { fence: data.fence, readClaim: async () => null, reserve: async () => { reservations++; throw new Error("unexpected reserve"); } };
  for (const changes of [{ approvedReviewSha256: "0".repeat(64) }, { acknowledgeAwsWrite: false }, { acknowledgePreservesPredecessorAndConsumesGeneration2: false },
    { executionPhrase: "different" }, { now: () => at + 300_000 }, { signal: AbortSignal.abort() }]) await assert.rejects(createReviewedArnProbeComparison({ ...data, slot, ...approve(data.review), signal: signal(), now: () => at,
      create: async () => { submissions++; return {}; }, ...changes }));
  assert.equal(reservations, 0); assert.equal(submissions, 0);
});
test("fresh Locked IAM drift fails before a durable claim", async () => {
  const data = await setup(); await temp(async (root) => { const slot = await createArnProbeComparisonFsSlot(root, data.fence); let calls = 0;
    const reads = { ...data.reads, readManagement: async () => ({ ...await data.reads.readManagement(), policies: [{ changed: true }] }) };
    await assert.rejects(createReviewedArnProbeComparison({ ...data, reads: reads as unknown as typeof data.reads, slot, ...approve(data.review), now: () => at, signal: signal(), create: async () => { calls++; return {}; } }));
    assert.equal(await slot.readClaim(), null); assert.equal(calls, 0); assert.deepEqual(await readdir(root), []); });
});
test("fsync/readback claim precedes single exact create; restart cannot replay", async () => {
  const data = await setup(); await temp(async (root) => { const slot = await createArnProbeComparisonFsSlot(root, data.fence); let calls = 0;
    const create = async (request: typeof data.review.plan.request) => { calls++; assert.ok(await slot.readClaim()); assert.deepEqual(request, data.review.plan.request);
      return { StackId: request.StackName, Id: providerArn(data.review), $metadata: { requestId: "11111111-2222-4333-8444-555555555555" } }; };
    const input = { ...data, slot, ...approve(data.review), now: () => at, signal: signal(), create };
    const receipt = await createReviewedArnProbeComparison(input); assert.equal(receipt.outcome, "CREATE_SUBMITTED"); assert.equal(receipt.mutationPerformed, true);
    await assert.rejects(createReviewedArnProbeComparison({ ...input, slot: await createArnProbeComparisonFsSlot(root, data.fence) }), /consumed/); assert.equal(calls, 1); });
});
test("lost/malformed response permanently consumes slot, reporting uncertain AWS mutation", async () => {
  const data = await setup(); for (const create of [async () => { throw new Error("lost response"); }, async () => ({ Id: "wrong" })]) await temp(async (root) => {
    const slot = await createArnProbeComparisonFsSlot(root, data.fence), receipt = await createReviewedArnProbeComparison({ ...data, slot, ...approve(data.review), now: () => at, signal: signal(), create });
    assert.equal(receipt.outcome, "CREATE_UNCERTAIN"); assert.equal(receipt.mutationPerformed, null); assert.ok(await slot.readClaim()); assert.equal(receipt.retryAuthorized, false); });
});
test("cancellation after reserve consumes slot with zero Create submissions", async () => {
  const data = await setup(), cancelled = new AbortController(); let calls = 0; await temp(async (root) => {
    const fs = await createArnProbeComparisonFsSlot(root, data.fence), slot = { ...fs, reserve: async (...args: Parameters<typeof fs.reserve>) => { const claim = await fs.reserve(...args); cancelled.abort(); return claim; } };
    const receipt = await createReviewedArnProbeComparison({ ...data, slot, ...approve(data.review), now: () => at, signal: cancelled.signal, create: async () => { calls++; return {}; } });
    assert.equal(receipt.outcome, "NO_CREATE_SUBMITTED_SLOT_CONSUMED"); assert.equal(receipt.mutationPerformed, false); assert.ok(await fs.readClaim()); assert.equal(calls, 0); });
});
test("read-only recovery keeps missing consumed, verifies ready exact Grant, and never writes", async () => {
  const data = await setup(); await temp(async (root) => { const slot = await createArnProbeComparisonFsSlot(root, data.fence); await slot.reserve(data.review, "f".repeat(64), new Date(at).toISOString()); const claim = await slot.readClaim();
    const ready = await validateArnProbeComparisonGrant(data.review.plan, provider(data.review), provider(data.review), { TemplateBody: data.review.plan.request.TemplateBody }, new Date(at).toISOString());
    for (const grant of [{ state: "MISSING" as const, proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY" as const, observedAt: new Date(at).toISOString() }, ready]) {
      const receipt = await recoverArnProbeComparisonCreate({ ...data, slot, signal: signal(), now: () => at, readGrant: async () => grant });
      assert.equal(receipt.outcome, grant.state === "MISSING" ? "MISSING_SLOT_CONSUMED" : "READY_UNEXECUTED"); assert.equal(receipt.mutationPerformed, false); assert.equal(receipt.retryAuthorized, false); }
    assert.deepEqual(await slot.readClaim(), claim); });
});
test("recovery without claim or with foreign candidate binding cannot read cloud/reconstruct claim", async () => {
  const data = await setup(); await temp(async (root) => { const slot = await createArnProbeComparisonFsSlot(root, data.fence); let reads = 0;
    const input = { ...data, slot, signal: signal(), now: () => at, readGrant: async () => { reads++; throw new Error("unexpected cloud"); } };
    await assert.rejects(recoverArnProbeComparisonCreate(input)); assert.equal(reads, 0);
    const other = await reviewArnProbeComparisonCreate({ sourceReview: data.sourceReview, variant: "FULL_ARN_CONDITION", slot, signal: signal(), now: () => at });
    await slot.reserve(other, "f".repeat(64), new Date(at).toISOString()); await assert.rejects(recoverArnProbeComparisonCreate(input), /binding/); assert.equal(reads, 0); });
});
test("expired approved window permits only read-only recovery, never a new Create or slot reset", async () => {
  const data = await setup(), later = at + 3_600_000, stamp = new Date(later).toISOString();
  await temp(async (root) => { const slot = await createArnProbeComparisonFsSlot(root, data.fence); await slot.reserve(data.review, "f".repeat(64), new Date(at).toISOString());
    const reads = { readManagement: async () => ({ ...await data.reads.readManagement(), observedAt: stamp }), readFixture: async () => ({ ...await data.reads.readFixture(), observedAt: stamp }) };
    const receipt = await recoverArnProbeComparisonCreate({ ...data, reads, slot, now: () => later, signal: signal(), readGrant: async () => ({ state: "MISSING", proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY", observedAt: stamp }) });
    assert.equal(receipt.outcome, "MISSING_SLOT_CONSUMED"); assert.equal(receipt.mutationPerformed, false); assert.ok(await slot.readClaim());
  });
});
test("provider validation refuses executed/foreign/paginated/nested/second resource and template drift", async () => {
  const { review } = await setup(); for (const changes of [{ ExecutionStatus: "EXECUTE_COMPLETE" }, { StackId: "other" }, { RoleARN: "other" }, { IncludeNestedStacks: true }, { NextToken: "more" },
    { Changes: [...provider(review).Changes, ...provider(review).Changes] }, { ChangeSetId: "arn:wrong" }, { Capabilities: [] }]) {
    const value = { ...provider(review), ...changes }; await assert.rejects(validateArnProbeComparisonGrant(review.plan, value, value, { TemplateBody: review.plan.request.TemplateBody }, new Date(at).toISOString())); }
  await assert.rejects(validateArnProbeComparisonGrant(review.plan, provider(review), provider(review), { TemplateBody: "{}" }, new Date(at).toISOString()));
});
test("SDK refuses request drift/repeated submission and incomplete/competing read inventory", async () => {
  const { review } = await setup(); let calls = 0; class Command { input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
  const create = new AwsSdkArnProbeComparisonGrantCreateAdapter(review.plan, { send: async () => { calls++; return {}; } }, Command);
  await assert.rejects(create.create({ ...review.plan.request, StackName: "other" } as unknown as typeof review.plan.request, signal())); assert.equal(calls, 0);
  await create.create(review.plan.request, signal()); await assert.rejects(create.create(review.plan.request, signal()), /single-submit/); assert.equal(calls, 1);
  for (const inventory of [{ NextToken: "more", Summaries: [] }, { Summaries: [{ StackId: review.plan.request.StackName, ChangeSetName: "other", ChangeSetId: "other", ExecutionStatus: "AVAILABLE" }] }]) {
    const read = new AwsSdkArnProbeComparisonGrantReadAdapter({ send: async () => inventory }, { listChangeSets: Command, describeChangeSet: Command, getTemplate: Command }, () => at); await assert.rejects(read.readGrant(review.plan, signal())); }
});
test("entry exposes no Execute/Delete/Operator, rejecting cross-mode and incomplete approval before output", async () => {
  const cli = await readFile(new URL("../ops/aws-sandbox/scripts/s3-b5-arn-probe-read-comparison-create.ts", import.meta.url), "utf8"), runtime = await readFile(new URL("../lib/deployments/execution/aws-sdk-arn-probe-source-read-runtime.ts", import.meta.url), "utf8");
  assert.doesNotMatch(cli + runtime, /\b(?:Execute|Delete|Put|Update|Attach|Detach|AssumeRole)\w*Command/); assert.doesNotMatch(runtime, /\bCreate\w*Command/); assert.match(cli, /"wx"/); assert.match(runtime, /maxAttempts: 1/);
  for (const args of [["--mode", "RunReviewed"], ["--mode", "ReviewCreate", "--acknowledge-aws-write"], ["--mode", "CreateReviewed"], ["--acknowledge-read-only", "--acknowledge-read-only"]]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "ops/aws-sandbox/scripts/s3-b5-arn-probe-read-comparison-create.ts", ...args], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", windowsHide: true });
    assert.notEqual(result.status, 0); assert.doesNotMatch(result.stdout, /digest|receiptSha256/); }
});
