import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, mkdir, readFile, writeFile, readdir, link, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { retireReviewedStackControl, inspectStackControlRetirement, stackControlGeneration6Fence, STACK_CONTROL_RETIREMENT_PATHS } from "../lib/deployments/execution/arn-probe-stack-control-generation5-retirement.ts";
import { compileGeneration6Candidate, assertGeneration6Context, compileGeneration6CreatePlan, assertGeneration6CreateReview, reviewGeneration6Create,
  createReviewedGeneration6, recoverGeneration6Create, generation6ClaimBinding, type Generation6Context, type Generation6Claim,
  type Generation6Slot, type Generation6CreatePlan, type Generation6CreationObservation } from "../lib/deployments/execution/arn-probe-stack-control-generation6.ts";
import { createGeneration6FsSlot } from "../lib/deployments/execution/arn-probe-stack-control-generation6-storage.ts";
import { AwsSdkGeneration6InventoryReader, AwsSdkGeneration6CreateAdapter } from "../lib/deployments/execution/aws-sdk-arn-probe-stack-control-generation6-create.ts";
import { assertStackControlCreateReview } from "../lib/deployments/execution/arn-probe-stack-scoped-read-control-create.ts";
import { generation5RetirementFixture } from "./fixtures/arn-probe-generation5-retirement.ts";
import { renderB5CellLifecycleManagementTemplate } from "../ops/aws-sandbox/scripts/render-b5-cell-lifecycle-management.mjs";

const uuid = "66666666-2222-4333-8444-555555555555", provider = "a".repeat(64);
const arnFor = (name: string) => `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${name}/${uuid}`;
let cached: Promise<Generation6Context> | undefined;
async function contextFixture() {
  return cached ??= (async () => {
    const f = await generation5RetirementFixture(); await retireReviewedStackControl(f); f.setTime(f.now() + 60_000);
    const retirementProof = await inspectStackControlRetirement(f), templateBody = await renderB5CellLifecycleManagementTemplate({ shape: "Locked" });
    return { retirementProof, revokeTarget: { templateBody, templateRawSha256: await sha256Hex(templateBody), templateCanonicalSha256: await sha256Hex(canonicalJson(JSON.parse(templateBody))) } };
  })();
}
async function temp(run: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "techlong-j23-generation6-test-")));
  try { await run(root); } finally { const resolved = await realpath(root), base = await realpath(os.tmpdir());
    assert.equal(path.dirname(resolved), base); assert.match(path.basename(resolved), /^techlong-j23-generation6-test-/); await rm(resolved, { recursive: true, force: true }); }
}
async function ports() {
  const context = await contextFixture(), fence = await stackControlGeneration6Fence(context.retirementProof); let time = Date.parse(context.retirementProof.observedAt) + 1000;
  let claim: Generation6Claim | null = null, exists = false; const events: string[] = [], stamp = () => new Date(time += 10).toISOString();
  const slot: Generation6Slot = { fence, readClaim: async () => claim, reserve: async (review, preflightEvidenceSha256, reservedAt) => {
    if (claim) throw new Error("Consumed"); const body = { schemaVersion: 1 as const, action: "CLAIM_GENERATION6_STACK_CONTROL_BEFORE_CREATE" as const,
      fence, binding: await generation6ClaimBinding(review), preflightEvidenceSha256, reservedAt };
    claim = { ...body, claimSha256: await sha256Hex(canonicalJson(body)) }; events.push("claim"); return claim;
  } };
  const reads = { observe: async (plan: Generation6CreatePlan): Promise<Generation6CreationObservation> => {
    const o = context.retirementProof.observation, managementBefore = { ...o.managementBefore, observedAt: stamp() }, fixtureBefore = { ...o.fixture, observedAt: stamp() },
      fixtureInventoryBefore = { ...o.fixtureInventory, observedAt: stamp() }, observedAt = stamp();
    return { managementBefore, fixtureBefore, fixtureInventoryBefore, inventory: { stackId: plan.request.StackName, complete: true, count: exists ? 1 : 0,
      target: exists ? { state: "READY_UNEXECUTED", stackId: plan.request.StackName, changeSetArn: arnFor(plan.request.ChangeSetName), templateCanonicalSha256: plan.templateCanonicalSha256,
        providerEvidenceSha256: provider, observedAt } : { state: "MISSING", proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY", observedAt }, providerEvidenceSha256: provider, observedAt },
      fixtureInventoryAfter: { ...o.fixtureInventory, observedAt: stamp() }, fixtureAfter: { ...o.fixture, observedAt: stamp() }, managementAfter: { ...o.managementAfter, observedAt: stamp() } };
  } };
  const common = { readContext: async () => context, reads, slot, signal: new AbortController().signal, now: () => time }, review = await reviewGeneration6Create(common);
  const approval = { approvedReviewSha256: review.reviewSha256, executionPhrase: review.requiredPhrase, acknowledgeAwsWrite: true,
    acknowledgeNamedIamUnexecutedOnly: true, acknowledgePermanentSlotAndOldRecords: true, acknowledgeLowCostNotZero: true };
  const create = async (request: Generation6CreatePlan["request"]) => { assert.ok(claim); events.push("create"); exists = true;
    return { StackId: request.StackName, Id: arnFor(request.ChangeSetName), $metadata: { requestId: uuid } }; };
  return { ...common, context, review, approval, create, events, setTime: (v: number) => { time = v; }, setExists: () => { exists = true; } };
}
test("generation6 compiler binds successful retirement, exact Locked resources and only the same Stack read Allow", async () => {
  const f = await ports(), candidate = f.review.plan.input.candidate; await assertGeneration6CreateReview(f.review);
  assert.equal(candidate.fence.generation, 6); assert.equal(candidate.fence.retirementProofSha256, f.context.retirementProof.receiptSha256);
  assert.equal(candidate.fence.slotRelativePath, STACK_CONTROL_RETIREMENT_PATHS.successorSlot);
  const before = JSON.parse(f.context.revokeTarget.templateBody), after = JSON.parse(candidate.proposedTemplateBody), oldStatements = before.Resources.CellOperatorBoundary.Properties.PolicyDocument.Statement;
  const nextStatements = after.Resources.CellOperatorBoundary.Properties.PolicyDocument.Statement;
  assert.deepEqual(nextStatements.slice(0, -1), oldStatements); assert.deepEqual(nextStatements.at(-1), candidate.proposedStatement);
  before.Resources.CellOperatorBoundary.Properties.PolicyDocument = after.Resources.CellOperatorBoundary.Properties.PolicyDocument;
  assert.deepEqual(after.Resources, before.Resources); assert.equal(after.Metadata.SafetyBoundary.ReadControlGeneration, 6);
  assert.equal("cloudformation:ChangeSetName" in candidate.proposedStatement.Condition.StringEquals, false);
  assert.deepEqual(candidate.allowedWriteActions, []); assert.equal(f.review.installationToolsImplemented, false);
  assert.equal(f.review.grantExecutionAuthorized, false); assert.equal(f.review.operatorReadAuthorized, false);
  await assert.rejects(assertStackControlCreateReview(f.review as unknown as Parameters<typeof assertStackControlCreateReview>[0]));
  assert.equal(await f.slot.readClaim(), null);
});
test("generation6 rejects altered proof, baseline, proposal times and re-signed broadened request", async () => {
  const f = await ports(), candidate = f.review.plan.input.candidate;
  await assert.rejects(assertGeneration6Context({ ...f.context, revokeTarget: { ...f.context.revokeTarget, templateBody: "{}" } }));
  await assert.rejects(assertGeneration6Context({ ...f.context, retirementProof: { ...f.context.retirementProof, outcome: "RETIREMENT_UNPROVED" } }));
  await assert.rejects(compileGeneration6Candidate({ ...candidate.input, expiresAt: candidate.input.reviewedAt }));
  await assert.rejects(compileGeneration6CreatePlan({ candidate: { ...candidate, proposedStatement: { ...candidate.proposedStatement, Resource: "*" } } }));
  const changed = structuredClone(f.review); changed.plan.request.Capabilities.push("CAPABILITY_AUTO_EXPAND");
  const { reviewSha256: ignored, ...body } = changed; void ignored;
  await assert.rejects(assertGeneration6CreateReview({ ...body, reviewSha256: await sha256Hex(canonicalJson(body)) }));
});
test("generation6 creates once after permanent claim then independent recovery, without installation approval", async () => {
  const f = await ports(), run = await createReviewedGeneration6(f); assert.equal(run.outcome, "CREATE_SUBMITTED"); assert.deepEqual(f.events, ["claim", "create"]);
  f.setTime(Date.parse(f.review.plan.input.candidate.input.expiresAt) + 1000);
  const recovered = await recoverGeneration6Create(f); assert.equal(recovered.outcome, "READY_UNEXECUTED"); assert.equal(recovered.mutationPerformed, false);
  await assert.rejects(createReviewedGeneration6(f)); assert.deepEqual(f.events, ["claim", "create"]);
});
test("wrong SHA/phrase, expired approval, cancellation and external target reject before reservation", async () => {
  for (const update of [{ approvedReviewSha256: "b".repeat(64) }, { executionPhrase: "I_CONFIRM_J5GJ22_CREATE_STACK_SCOPED_READ_GRANT_ONLY" }, { acknowledgeLowCostNotZero: false }]) {
    const f = await ports(); await assert.rejects(createReviewedGeneration6({ ...f, approval: { ...f.approval, ...update } })); assert.deepEqual(f.events, []);
  }
  const expired = await ports(); expired.setTime(Date.parse(expired.review.expiresAt)); await assert.rejects(createReviewedGeneration6(expired)); assert.deepEqual(expired.events, []);
  const cancelled = await ports(); await assert.rejects(createReviewedGeneration6({ ...cancelled, signal: AbortSignal.abort() })); assert.deepEqual(cancelled.events, []);
  const exists = await ports(); exists.setExists(); await assert.rejects(createReviewedGeneration6(exists)); assert.deepEqual(exists.events, []);
});
test("loss of reply consumes claim and never retries; independent missing recovery cannot authorize reconstruction", async () => {
  const f = await ports(); let submits = 0;
  const run = await createReviewedGeneration6({ ...f, create: async () => { submits++; throw new Error("Lost response"); } });
  assert.equal(run.outcome, "CREATE_UNCERTAIN"); assert.equal(run.retryAuthorized, false); assert.equal(submits, 1);
  const recovery = await recoverGeneration6Create(f); assert.equal(recovery.outcome, "MISSING_SLOT_CONSUMED");
  await assert.rejects(createReviewedGeneration6(f)); assert.equal(submits, 1);
});
test("expiry or claim readback drift after reservation prevents a cloud submission and leaves consumed state", async () => {
  const f = await ports(), reserve = f.slot.reserve; let submits = 0;
  f.slot.reserve = async (...args) => { const result = await reserve(...args); f.setTime(Date.parse(f.review.expiresAt)); return result; };
  const run = await createReviewedGeneration6({ ...f, create: async () => { submits++; return {}; } });
  assert.equal(run.outcome, "NO_CREATE_SUBMITTED_SLOT_CONSUMED"); assert.equal(submits, 0); assert.ok(await f.slot.readClaim());
  const corrupt = await ports(), original = corrupt.slot.reserve;
  corrupt.slot.reserve = async (...args) => { const claim = await original(...args); corrupt.slot.readClaim = async () => ({ ...claim, preflightEvidenceSha256: "b".repeat(64) }); return claim; };
  const other = await createReviewedGeneration6(corrupt); assert.equal(other.creationAttempted, false); assert.deepEqual(corrupt.events, ["claim"]);
});
test("Source full snapshot/chronology, actual predecessor and complete inventory drift reject before claim", async () => {
  for (const edit of [
    (o: Generation6CreationObservation) => ({ ...o, managementAfter: { ...o.managementAfter, authorityState: "PRESENT" } }),
    (o: Generation6CreationObservation) => ({ ...o, inventory: { ...o.inventory, count: 1 } }),
    (o: Generation6CreationObservation) => ({ ...o, fixtureInventoryAfter: { ...o.fixtureInventoryAfter, count: 2 } }),
    (o: Generation6CreationObservation) => ({ ...o, managementAfter: { ...o.managementAfter, observedAt: o.managementBefore.observedAt } }),
  ]) {
    const f = await ports(), observe = f.reads.observe;
    await assert.rejects(createReviewedGeneration6({ ...f, reads: { observe: async p => edit(await observe(p)) as Generation6CreationObservation } })); assert.deepEqual(f.events, []);
  }
  const f = await ports(); await assert.rejects(createReviewedGeneration6({ ...f, readContext: async () => ({ ...f.context, revokeTarget: { ...f.context.revokeTarget, templateRawSha256: provider } }) }));
  assert.deepEqual(f.events, []);
});
test("independent physical generation6 slot has one durable concurrent winner and preserves predecessor paths", async () => {
  const f = await ports(); await temp(async root => {
    const old = path.join(root, STACK_CONTROL_RETIREMENT_PATHS.oldSlot); await mkdir(old, { recursive: true }); await writeFile(path.join(old, "claim.json"), "preserved");
    const first = await createGeneration6FsSlot(root, f.context), second = await createGeneration6FsSlot(root, f.context);
    assert.equal(await first.readClaim(), null); assert.deepEqual(await readdir(root), [".aws-sandbox"]);
    const at = new Date(f.now()).toISOString(), results = await Promise.allSettled([first.reserve(f.review, provider, at), second.reserve(f.review, provider, at)]);
    assert.equal(results.filter(v => v.status === "fulfilled").length, 1); assert.ok(await first.readClaim());
    assert.deepEqual(await readdir(path.join(root, f.review.fence.slotRelativePath)), ["claim.json"]); assert.equal(await readFile(path.join(old, "claim.json"), "utf8"), "preserved");
    await assert.rejects(first.reserve(f.review, provider, at));
  });
});
test("partial/corrupt/foreign generation6 slots, unknown generations, hardlinks and junctions remain fail-closed", async () => {
  const f = await ports();
  for (const state of ["partial", "corrupt", "foreign", "hardlink", "unknown", "junction"] as const) await temp(async root => {
    const slotPath = path.join(root, f.review.fence.slotRelativePath), target = path.dirname(slotPath);
    if (state === "junction") {
      const outside = path.join(root, "outside"); await mkdir(outside); await mkdir(target, { recursive: true }); await symlink(outside, slotPath, "junction");
    } else if (state === "unknown") { await mkdir(path.join(target, "slot-000007"), { recursive: true }); }
    else {
      const slot = await createGeneration6FsSlot(root, f.context);
      if (state === "partial" || state === "corrupt") { await mkdir(slotPath, { recursive: true }); if (state === "corrupt") await writeFile(path.join(slotPath, "claim.json"), "{}"); }
      else { await slot.reserve(f.review, provider, new Date(f.now()).toISOString());
        if (state === "foreign") await writeFile(path.join(slotPath, "run-intent.json"), "{}");
        else await link(path.join(slotPath, "claim.json"), path.join(root, "linked.json")); }
    }
    const slot = await createGeneration6FsSlot(root, f.context); await assert.rejects(slot.readClaim()); await assert.rejects(slot.reserve(f.review, provider, new Date(f.now()).toISOString()));
  });
});
class Command { input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
class List extends Command {} class Describe extends Command {} class Template extends Command {}
function providerReply(plan: Generation6CreatePlan) {
  const r = plan.request; return { StackId: r.StackName, StackName: "techlong-s3-b5-cell-lifecycle-management", ChangeSetId: arnFor(r.ChangeSetName), ChangeSetName: r.ChangeSetName,
    Description: r.Description, Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", Capabilities: ["CAPABILITY_NAMED_IAM"], NotificationARNs: [], Parameters: [
      { ParameterKey: "ExpectedAccountId", ParameterValue: "402010193138" }, { ParameterKey: "ExpectedRegion", ParameterValue: "ca-central-1" },
      { ParameterKey: "ManagementPrincipalArn", ParameterValue: "arn:aws:iam::402010193138:user/techlong-sandbox-dev" }],
    Changes: [{ Type: "Resource", ResourceChange: { Action: "Modify", LogicalResourceId: "CellOperatorBoundary", ResourceType: "AWS::IAM::ManagedPolicy",
      PhysicalResourceId: "arn:aws:iam::402010193138:policy/TechlongSandboxCellOperatorBoundary", Replacement: "False" } }] };
}
test("generation6 SDK inventories validate complete exact singleton, Original template and no retained/foreign/rollback exceptions", async () => {
  const f = await ports(), plan = f.review.plan, response = providerReply(plan), summary = { StackId: response.StackId, ChangeSetId: response.ChangeSetId, ChangeSetName: response.ChangeSetName,
    Status: response.Status, ExecutionStatus: response.ExecutionStatus };
  for (const scenario of ["empty", "ready", "foreign", "paged", "terminal", "rollback", "template", "duplicate", "drift"] as const) {
    let lists = 0;
    const client = { send: async (command: unknown) => {
      const c = command as Command;
      if (c instanceof List) { lists++; return { Summaries: scenario === "empty" ? [] : scenario === "duplicate" ? [summary, summary] : [{ ...summary,
        ...(scenario === "foreign" || (scenario === "drift" && lists === 2) ? { ChangeSetName: "old-grant" } : {}), ...(scenario === "terminal" ? { ExecutionStatus: "EXECUTE_COMPLETE" } : {}) }],
        ...(scenario === "paged" ? { NextToken: "page" } : {}) }; }
      assert.equal(c.input.ChangeSetName, summary.ChangeSetId);
      if (c instanceof Template) return { TemplateBody: scenario === "template" ? "{}" : plan.request.TemplateBody };
      assert.ok(c instanceof Describe); return { ...response, ...(scenario === "rollback" ? { RollbackConfiguration: { MonitoringTimeInMinutes: 2 } } : {}) };
    } };
    const reader = new AwsSdkGeneration6InventoryReader(client, { listChangeSets: List, describeChangeSet: Describe, getTemplate: Template }, f.now);
    if (scenario === "empty" || scenario === "ready") { const result = await reader.read(plan, f.signal); assert.equal(result.count, scenario === "empty" ? 0 : 1); assert.equal(lists, 2); }
    else await assert.rejects(reader.read(plan, f.signal));
  }
});
test("generation6 SDK Create checks live exact request and is single-submit on lost reply", async () => {
  const f = await ports(); let writes = 0;
  const adapter = new AwsSdkGeneration6CreateAdapter(f.review, { send: async () => { writes++; throw new Error("Lost reply"); } }, Command, f.now);
  await assert.rejects(adapter.create({ ...f.review.plan.request, StackName: "foreign" } as unknown as Generation6CreatePlan["request"], f.signal)); assert.equal(writes, 0);
  await assert.rejects(adapter.create(f.review.plan.request, f.signal)); await assert.rejects(adapter.create(f.review.plan.request, f.signal)); assert.equal(writes, 1);
  const expired = new AwsSdkGeneration6CreateAdapter(f.review, { send: async () => { writes++; return {}; } }, Command, f.now);
  f.setTime(Date.parse(f.review.expiresAt)); await assert.rejects(expired.create(f.review.plan.request, f.signal)); assert.equal(writes, 1);
});
test("generation6 wrapper parses and rejects old/mismatched full SHA before invoking Node", async () => {
  const wrapper = fileURLToPath(new URL("../ops/aws-sandbox/scripts/Invoke-ReviewedGeneration6Create.ps1", import.meta.url)), source = await readFile(wrapper, "utf8");
  assert.match(source, /finally\s*\{/); assert.match(source, /--mode RecoverCreate/); assert.doesNotMatch(source, /--mode RunReviewed|--mode RetireReviewed/);
  await temp(async root => {
    const f = await ports(), evidence = path.join(root, "evidence.json"), proof = path.join(root, "proof.json"), review = path.join(root, "review.json");
    await writeFile(evidence, "{}"); await writeFile(proof, JSON.stringify(f.context.retirementProof)); await writeFile(review, JSON.stringify(f.review));
    const cmd = "$taskTokens=$null; $taskErrors=$null; $null=[System.Management.Automation.Language.Parser]::ParseFile($args[0],[ref]$taskTokens,[ref]$taskErrors); if($taskErrors.Count){throw 'Parse failed'}; try { & $args[0] -Evidence $args[1] -RetirementProof $args[2] -CreateReview $args[3] -ApprovedReviewSha ('b'*64) -Output $args[4]; throw 'Wrong SHA accepted' } catch { if($_.Exception.Message -notlike '*Separate full generation6*'){throw} }; 'APPROVAL_REJECTED_NO_NODE'";
    const params = [wrapper, evidence, proof, review, path.join(root, "output.json")].map(v => `'${v.replaceAll("'", "''")}'`).join(" ");
    const child = spawnSync("C:/Program Files/PowerShell/7/pwsh.exe", ["-NoProfile", "-Command", `& { ${cmd} } ${params}`], { encoding: "utf8", timeout: 30_000 });
    assert.equal(child.status, 0, child.stderr); assert.match(child.stdout, /APPROVAL_REJECTED_NO_NODE/); assert.deepEqual((await readdir(root)).sort(), ["evidence.json", "proof.json", "review.json"]);
  });
});
test("generation6 CLI rejects cross-mode write flags, duplicate options and unsupported install mode before loading evidence/SDK", async () => {
  const entry = fileURLToPath(new URL("../ops/aws-sandbox/scripts/s3-b5-arn-probe-stack-control-generation6-create.ts", import.meta.url));
  await temp(async root => {
    const output = path.join(root, "out.json"), base = ["--evidence", path.join(root, "missing.json"), "--retirement-proof", path.join(root, "proof.json"), "--output", output];
    for (const args of [
      ["--mode", "CheckLocalPreparation", ...base, "--acknowledge-local-only", "--acknowledge-aws-write"],
      ["--mode", "ReviewCreate", ...base, "--acknowledge-read-only", "--approved-review-sha256", "a".repeat(64)],
      ["--mode", "CreateReviewed", ...base, "--review", path.join(root, "review.json")],
      ["--mode", "RunReviewed", ...base, "--acknowledge-read-only"],
      ["--mode", "ReviewCreate", "--mode", "ReviewCreate", ...base, "--acknowledge-read-only"],
    ]) {
      const child = spawnSync(process.execPath, ["--experimental-strip-types", entry, ...args], { encoding: "utf8", timeout: 30_000 });
      assert.notEqual(child.status, 0); assert.doesNotMatch(child.stderr, /ExpiredToken|Enter MFA|Credential/); assert.deepEqual(await readdir(root), []);
    }
    const protectedFolder = path.join(root, ".AWS-SANDBOX"); await mkdir(protectedFolder);
    const blocked = spawnSync(process.execPath, ["--experimental-strip-types", entry, "--mode", "CheckLocalPreparation", "--evidence", path.join(root, "missing.json"),
      "--retirement-proof", path.join(root, "proof.json"), "--output", path.join(protectedFolder, "out.json"), "--acknowledge-local-only"], { encoding: "utf8", timeout: 30_000 });
    assert.notEqual(blocked.status, 0); assert.match(blocked.stderr, /cannot overwrite protected/); assert.deepEqual(await readdir(protectedFolder), []);
  });
});
