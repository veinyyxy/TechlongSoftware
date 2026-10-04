import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { createReviewedArnProbeComparison, recoverArnProbeComparisonCreate, arnProbeComparisonClaimBinding,
  type ArnProbeComparisonClaim, type ArnProbeComparisonSlot } from "../lib/deployments/execution/arn-probe-read-comparison-generation4-create.ts";
import { AwsSdkArnProbeComparisonGrantCreateAdapter, AwsSdkArnProbeComparisonGrantReadAdapter,
  validateArnProbeComparisonGrant } from "../lib/deployments/execution/aws-sdk-arn-probe-read-comparison-generation4-create.ts";
import { comparisonWorkflowFixture, comparisonTestId as id } from "./fixtures/arn-probe-generation4-workflow.ts";
import { comparisonWorkflowFixture as oldFixture } from "./fixtures/arn-probe-generation3-workflow.ts";

class Command { input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
async function temp(run: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "techlong-j20-create-test-")));
  try { await run(root); } finally {
    const resolved = await realpath(root), base = await realpath(os.tmpdir());
    assert.equal(path.dirname(resolved), base); assert.match(path.basename(resolved), /^techlong-j20-create-test-/);
    await rm(resolved, { recursive: true, force: true });
  }
}
async function createPorts() {
  const f = await comparisonWorkflowFixture(), events: string[] = [];
  let claim: ArnProbeComparisonClaim | null = null;
  const slot: ArnProbeComparisonSlot = { fence: f.fence, readClaim: async () => claim,
    reserve: async (review, preflightEvidenceSha256, reservedAt) => {
      if (claim) throw new Error("Consumed");
      const body = { schemaVersion: 1 as const, action: "CLAIM_GENERATION4_BEFORE_CREATE" as const, fence: f.fence,
        binding: await arnProbeComparisonClaimBinding(review), preflightEvidenceSha256, reservedAt };
      claim = { ...body, claimSha256: await sha256Hex(canonicalJson(body)) }; events.push("durable-claim"); return claim;
    } };
  const reads = { readManagement: async () => ({ ...f.review.sourceReview.observation.managementAfter, observedAt: new Date(f.now()).toISOString() }),
    readFixture: async () => ({ ...f.review.sourceReview.observation.fixtureAfter, observedAt: new Date(f.now()).toISOString() }),
    readEmptyManagementInventory: async () => ({ state: "EMPTY" as const, changeSetCount: 0 as const, stackId: f.prior.managementStackId,
      providerEvidenceSha256: "f".repeat(64), observedAt: new Date(f.now()).toISOString() }) };
  return { ...f, slot, reads, events, approvedReviewSha256: f.review.reviewSha256, executionPhrase: f.review.requiredPhrase,
    acknowledgeAwsWrite: true, acknowledgeNamedIamChangeSetOnly: true, acknowledgeLowCostNotZero: true,
    acknowledgePreservesPredecessorAndConsumesGeneration4: true,
    create: async (request: typeof f.review.plan.request) => {
      assert.ok(await slot.readClaim()); assert.deepEqual(request, f.review.plan.request); events.push("one-create");
      return { StackId: request.StackName, Id: f.grantArn, $metadata: { requestId: id } };
    }, readGrant: f.reads.readGrant };
}
function reply(f: Awaited<ReturnType<typeof createPorts>>) {
  return { StackId: f.review.plan.request.StackName, StackName: "techlong-s3-b5-cell-lifecycle-management", ChangeSetId: f.grantArn,
    ChangeSetName: f.review.plan.request.ChangeSetName, Description: f.review.plan.request.Description,
    Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", IncludeNestedStacks: false, ImportExistingResources: false,
    Capabilities: ["CAPABILITY_NAMED_IAM"], NotificationARNs: [], Parameters: [
      { ParameterKey: "ExpectedAccountId", ParameterValue: "402010193138" }, { ParameterKey: "ExpectedRegion", ParameterValue: "ca-central-1" },
      { ParameterKey: "ManagementPrincipalArn", ParameterValue: "arn:aws:iam::402010193138:user/techlong-sandbox-dev" }],
    Changes: [{ Type: "Resource", ResourceChange: { Action: "Modify", LogicalResourceId: "CellOperatorBoundary",
      ResourceType: "AWS::IAM::ManagedPolicy", PhysicalResourceId: "arn:aws:iam::402010193138:policy/TechlongSandboxCellOperatorBoundary", Replacement: "False" } }] };
}
test("generation4 exact creation approval preserves its original request and saves a claim before the single Create", async () => {
  const f = await createPorts(); f.setTime(f.now() + 1000);
  const receipt = await createReviewedArnProbeComparison(f);
  assert.equal(receipt.outcome, "CREATE_SUBMITTED"); assert.deepEqual(f.events, ["durable-claim", "one-create"]);
  assert.equal(receipt.grantInstalled, false); assert.equal(receipt.childExecuted, false); assert.equal(receipt.probeDeleted, false);
  assert.equal(receipt.claim.fence.slotRelativePath.endsWith("slot-000004"), true);
  await assert.rejects(createReviewedArnProbeComparison(f), /consumed/);
  assert.equal(f.events.filter((v) => v === "one-create").length, 1);
});
test("creation rejects old generation3 approval, wrong digest/phrase/ack, expiry and cancellation before reservation or cloud", async () => {
  const f = await createPorts(), old = await oldFixture();
  for (const change of [{ review: old.review }, { approvedReviewSha256: "0".repeat(64) }, { executionPhrase: "I_CONFIRM_J5GJ19_CREATE_GENERATION3_READ_COMPARISON_GRANT_ONLY" },
    { acknowledgePreservesPredecessorAndConsumesGeneration4: false }, { acknowledgeLowCostNotZero: false },
    { now: () => Date.parse(f.review.expiresAt) }, { signal: AbortSignal.abort() }]) {
    await assert.rejects(createReviewedArnProbeComparison({ ...f, ...change } as typeof f));
  }
  assert.deepEqual(f.events, []); assert.equal(await f.slot.readClaim(), null);
});
test("lost Create reply consumes the slot; independent recovery may prove ready but never retries", async () => {
  const f = await createPorts();
  const result = await createReviewedArnProbeComparison({ ...f, create: async (request) => { await f.create(request); throw new Error("DO_NOT_SAVE_PRIVATE_ERROR"); } });
  assert.equal(result.outcome, "CREATE_UNCERTAIN"); assert.doesNotMatch(JSON.stringify(result), /DO_NOT_SAVE/);
  const recovered = await recoverArnProbeComparisonCreate(f); assert.equal(recovered.outcome, "READY_UNEXECUTED");
  assert.equal(recovered.mutationPerformed, false); await assert.rejects(createReviewedArnProbeComparison(f));
  assert.deepEqual(f.events, ["durable-claim", "one-create"]);
});
test("approval expiry after durable claim consumes generation4 without Create; missing recovery cannot reclaim it", async () => {
  const f = await createPorts(), reserve = f.slot.reserve;
  f.slot.reserve = async (...args) => { const c = await reserve(...args); f.setTime(Date.parse(f.review.expiresAt)); return c; };
  const receipt = await createReviewedArnProbeComparison(f); assert.equal(receipt.outcome, "NO_CREATE_SUBMITTED_SLOT_CONSUMED");
  const recovered = await recoverArnProbeComparisonCreate({ ...f, readGrant: async () => ({ state: "MISSING", proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY", observedAt: new Date(f.now()).toISOString() }) });
  assert.equal(recovered.outcome, "MISSING_SLOT_CONSUMED"); assert.deepEqual(f.events, ["durable-claim"]);
});
test("foreign Create response stays uncertain and cannot authorize installation", async () => {
  const f = await createPorts();
  const receipt = await createReviewedArnProbeComparison({ ...f, create: async () => ({ StackId: "foreign", Id: f.grantArn, $metadata: { requestId: id } }) });
  assert.equal(receipt.outcome, "CREATE_UNCERTAIN"); assert.equal(receipt.target, null); assert.equal(receipt.grantExecutionAuthorized, false);
});
test("fresh Source drift blocks creation before claiming; recovery requires its exact permanent claim and stable full Locked evidence", async () => {
  const f = await createPorts();
  await assert.rejects(createReviewedArnProbeComparison({ ...f, reads: { ...f.reads, readManagement: async () => {
    const m = await f.reads.readManagement(); return { ...m, roles: m.roles.map((r, i) => i === 0 ? { ...r, trustPolicySha256: "0".repeat(64) } : r) };
  } } }));
  assert.deepEqual(f.events, []); await assert.rejects(recoverArnProbeComparisonCreate(f), /durable claim/);
  await createReviewedArnProbeComparison(f);
  await assert.rejects(recoverArnProbeComparisonCreate({ ...f, reads: { ...f.reads, readManagement: async () => {
    const m = await f.reads.readManagement(); return { ...m, roles: m.roles.map((r, i) => i === 0 ? { ...r, trustPolicySha256: "0".repeat(64) } : r) };
  } } }), /Locked management/);
});
test("SDK creation is exact one-submit and excludes old plans", async () => {
  const f = await createPorts(); let calls = 0;
  const sdk = new AwsSdkArnProbeComparisonGrantCreateAdapter(f.review.plan, { send: async () => { calls++; throw new Error("lost"); } }, Command);
  await assert.rejects(sdk.create({ ...f.review.plan.request, ChangeSetName: "foreign" }, f.signal)); assert.equal(calls, 0);
  await assert.rejects(sdk.create(f.review.plan.request, f.signal)); await assert.rejects(sdk.create(f.review.plan.request, f.signal), /single-submit/); assert.equal(calls, 1);
  const old = await oldFixture();
  const foreign = new AwsSdkArnProbeComparisonGrantCreateAdapter(old.review.plan as unknown as typeof f.review.plan, { send: async () => { calls++; return {}; } }, Command);
  await assert.rejects(foreign.create(old.review.plan.request, f.signal)); assert.equal(calls, 1);
});
test("SDK Grant double-Describe validates Original template, one policy Modify and strict nested/import flags", async () => {
  const f = await createPorts(), exact = reply(f), original = { TemplateBody: f.review.plan.request.TemplateBody };
  assert.equal((await validateArnProbeComparisonGrant(f.review.plan, exact, exact, original, new Date(f.now()).toISOString())).state, "READY_UNEXECUTED");
  for (const flag of [true, null, "false", 0]) for (const key of ["IncludeNestedStacks", "ImportExistingResources"]) {
    const bad = { ...exact, [key]: flag }; await assert.rejects(validateArnProbeComparisonGrant(f.review.plan, bad, bad, original, new Date(f.now()).toISOString()));
  }
  await assert.rejects(validateArnProbeComparisonGrant(f.review.plan, exact, { ...exact, Description: "drift" }, original, new Date(f.now()).toISOString()));
  await assert.rejects(validateArnProbeComparisonGrant(f.review.plan, exact, exact, { TemplateBody: "{}" }, new Date(f.now()).toISOString()));
});
test("SDK complete singleton inventory rejects terminal competitors, duplicate or paginated objects before Describe", async () => {
  const f = await createPorts(), summary = { StackId: f.review.plan.request.StackName, ChangeSetId: f.grantArn, ChangeSetName: f.review.plan.request.ChangeSetName };
  const commands = { listChangeSets: Command, describeChangeSet: Command, getTemplate: Command };
  for (const inventory of [{ Summaries: [summary, { ...summary, ChangeSetName: "foreign", ExecutionStatus: "OBSOLETE" }] }, { Summaries: [summary, summary] }, { Summaries: [], NextToken: "page2" }]) {
    let calls = 0; const read = new AwsSdkArnProbeComparisonGrantReadAdapter({ send: async () => { calls++; return inventory; } }, commands, f.now);
    await assert.rejects(read.readGrant(f.review.plan, f.signal)); assert.equal(calls, 1);
  }
  const missing = new AwsSdkArnProbeComparisonGrantReadAdapter({ send: async () => ({ Summaries: [] }) }, commands, f.now);
  assert.equal((await missing.readGrant(f.review.plan, f.signal)).state, "MISSING");
});
test("generation4 creation CLI requires an explicit mode and has no execute/delete/Operator capability", async () => {
  const cli = await readFile(new URL("../ops/aws-sandbox/scripts/s3-b5-arn-probe-read-comparison-generation4-create.ts", import.meta.url), "utf8");
  assert.doesNotMatch(cli, /\b(?:Execute|Delete|Put|Attach|AssumeRole)\w*Command/); assert.match(cli, /maxAttempts: 1/);
  for (const args of [[], ["--mode", "CreateReviewed"], ["--mode", "ReviewCreate", "--acknowledge-aws-write"], ["--acknowledge-read-only", "--acknowledge-read-only"]]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "ops/aws-sandbox/scripts/s3-b5-arn-probe-read-comparison-generation4-create.ts", ...args], { cwd: fileURLToPath(new URL("../", import.meta.url)), windowsHide: true, encoding: "utf8" });
    assert.notEqual(result.status, 0); assert.doesNotMatch(result.stdout, /digest|receiptSha256/);
  }
});
test("real local generation4 wrapper rejects a legacy creation review before Node/output and never defaults a full approval SHA", async () => {
  const f = await createPorts(), old = await oldFixture();
  await temp(async (root) => {
    const evidence = path.join(root, "evidence.json"), proof = path.join(root, "proof.json"), review = path.join(root, "legacy-review.json"), output = path.join(root, "output.json");
    await writeFile(evidence, "{}"); await writeFile(proof, JSON.stringify(f.review.plan.input.retirementProof)); await writeFile(review, JSON.stringify(old.review));
    const result = spawnSync("C:/Program Files/PowerShell/7/pwsh.exe", ["-NoLogo", "-NoProfile", "-File", "ops/aws-sandbox/scripts/Invoke-ReviewedGeneration4ReadComparison.ps1", "-Evidence", evidence, "-RetirementProof", proof, "-CreationReview", review, "-Output", output, "-ApprovedCreationReviewSha", old.review.reviewSha256], { cwd: fileURLToPath(new URL("../", import.meta.url)), windowsHide: true, encoding: "utf8" });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Generation4 requires its own/); await assert.rejects(readFile(output), { code: "ENOENT" });
  });
  const wrapper = await readFile(new URL("../ops/aws-sandbox/scripts/Invoke-ReviewedGeneration4ReadComparison.ps1", import.meta.url), "utf8");
  assert.doesNotMatch(wrapper, /Read-Host|RetireReviewed|ApprovedManifestSha\s*=|ApprovedCreationReviewSha\s*=/);
  assert.match(wrapper, /Select-Object -First 1/); assert.match(wrapper, /Display only/); assert.match(wrapper, /RecoverRevoke/);
});
