import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, mkdir, readFile, writeFile, readdir, lstat, symlink, link } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { stackScopedReadControlFence } from "../lib/deployments/execution/arn-probe-stack-scoped-read-control.ts";
import { reviewStackControlCreate, assertStackControlCreateReview, createReviewedStackControl, recoverStackControlCreate, stackControlClaimBinding, stackControlHistory,
  type StackControlClaim, type StackControlSlot, type StackControlSourceReads, type StackControlCreatePlan } from "../lib/deployments/execution/arn-probe-stack-scoped-read-control-create.ts";
import { createStackControlFsSlot } from "../lib/deployments/execution/arn-probe-stack-scoped-read-control-slot.ts";
import { compileStackControlActions, assertStackControlActions, stackControlStepRequest } from "../lib/deployments/execution/arn-probe-stack-scoped-read-control-actions.ts";
import { AwsSdkStackControlCreateAdapter, AwsSdkStackControlInventoryReadAdapter, validateStackControlRetainedHistory } from "../lib/deployments/execution/aws-sdk-arn-probe-stack-scoped-read-control-create.ts";
import { stackScopedReadControlFixture, signed } from "./fixtures/arn-probe-stack-scoped-read-control.ts";
import { assertArnProbeComparisonCreateReview } from "../lib/deployments/execution/arn-probe-read-comparison-generation4-create.ts";

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };
let cached: ReturnType<typeof stackScopedReadControlFixture> | undefined;
const fixture = () => cached ??= stackScopedReadControlFixture();
const uuid = "55555555-2222-4333-8444-555555555555", proof = "f".repeat(64);
const arnFor = (name: string) => `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${name}/${uuid}`;
class Command { input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
class List extends Command {} class Describe extends Command {} class Template extends Command {}
async function temp(run: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "techlong-j22b-test-")));
  try { await run(root); } finally {
    const resolved = await realpath(root), base = await realpath(os.tmpdir());
    assert.equal(path.dirname(resolved), base); assert.match(path.basename(resolved), /^techlong-j22b-test-/);
    await rm(resolved, { recursive: true, force: true });
  }
}
async function ports() {
  const f = await fixture(), predecessor = f.predecessor, fence = await stackScopedReadControlFence(predecessor);
  let time = Date.parse(f.reviewedAt), claim: StackControlClaim | null = null, targetExists = false; const events: string[] = [];
  const now = () => time, stamp = () => new Date(time += 10).toISOString();
  const slot: StackControlSlot = { fence, readClaim: async () => claim, reserve: async (review, preflightEvidenceSha256, reservedAt) => {
    if (claim) throw new Error("Consumed");
    const body = { schemaVersion: 1 as const, action: "CLAIM_GENERATION5_STACK_CONTROL_BEFORE_CREATE" as const, fence,
      binding: await stackControlClaimBinding(review), preflightEvidenceSha256, reservedAt };
    claim = { ...body, claimSha256: await sha256Hex(canonicalJson(body)) }; events.push("claim"); return claim;
  } };
  const prior = predecessor.input.creationReview.plan.input.comparisonPlan.input.priorPlan;
  const reads: StackControlSourceReads = {
    readManagement: async () => ({ ...predecessor.input.inspect.management, observedAt: stamp() }),
    readFixture: async () => ({ ...predecessor.input.inspect.fixture, observedAt: stamp() }),
    readFixtureInventory: async () => ({ stackId: prior.input.fixtureStackId, changeSetArn: prior.input.fixtureChangeSetArn,
      changeSetName: prior.input.fixturePlan.request.ChangeSetName, status: "CREATE_COMPLETE", executionStatus: "AVAILABLE", complete: true, count: 1, providerEvidenceSha256: proof, observedAt: stamp() }),
    readInventory: async plan => {
      const observedAt = stamp(); return { stackId: plan.request.StackName, complete: true, knownTerminal: stackControlHistory(predecessor).map(k => ({
        kind: k.kind, changeSetArn: k.arn, status: "CREATE_COMPLETE", executionStatus: "EXECUTE_COMPLETE", providerEvidenceSha256: proof })),
        target: targetExists ? { state: "READY_UNEXECUTED", stackId: plan.request.StackName, changeSetArn: arnFor(plan.request.ChangeSetName),
          templateCanonicalSha256: plan.templateCanonicalSha256, providerEvidenceSha256: proof, observedAt } : { state: "MISSING", proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY", observedAt }, providerEvidenceSha256: proof, observedAt };
    },
  };
  const common = { slot, reads, now, signal: new AbortController().signal, readPredecessor: async () => predecessor };
  const review = await reviewStackControlCreate(common);
  const approval = { approvedReviewSha256: review.reviewSha256, executionPhrase: review.requiredPhrase, acknowledgeAwsWrite: true,
    acknowledgeNamedIamUnexecutedOnly: true, acknowledgePermanentSlotAndOldRecords: true, acknowledgeLowCostNotZero: true };
  const create = async (request: StackControlCreatePlan["request"]) => { assert.ok(claim); assert.deepEqual(request, review.plan.request); events.push("create"); targetExists = true;
    return { StackId: request.StackName, Id: arnFor(request.ChangeSetName), $metadata: { requestId: uuid } }; };
  return { ...common, predecessor, review, approval, create, events, setTime: (value: number) => { time = value; }, setTarget: (value: boolean) => { targetExists = value; } };
}
function providerReply(request: StackControlCreatePlan["request"], arn: string, executionStatus = "AVAILABLE") {
  return { StackId: request.StackName, StackName: "techlong-s3-b5-cell-lifecycle-management", ChangeSetId: arn, ChangeSetName: request.ChangeSetName, Description: request.Description,
    Status: "CREATE_COMPLETE", ExecutionStatus: executionStatus, Capabilities: ["CAPABILITY_NAMED_IAM"], NotificationARNs: [], Parameters: [
      { ParameterKey: "ExpectedAccountId", ParameterValue: "402010193138" }, { ParameterKey: "ExpectedRegion", ParameterValue: "ca-central-1" },
      { ParameterKey: "ManagementPrincipalArn", ParameterValue: "arn:aws:iam::402010193138:user/techlong-sandbox-dev" }],
    Changes: [{ Type: "Resource", ResourceChange: { Action: "Modify", LogicalResourceId: "CellOperatorBoundary", ResourceType: "AWS::IAM::ManagedPolicy",
      PhysicalResourceId: "arn:aws:iam::402010193138:policy/TechlongSandboxCellOperatorBoundary", Replacement: "False" } }] };
}
test("J22 creation review binds Stack-only scope, fresh complete Source and independent creation-only SHA", async () => {
  const f = await ports(); await assertStackControlCreateReview(f.review);
  assert.equal(f.review.plan.input.candidate.scope, "EXACT_STACK_RESOURCE_ONLY_NO_CHANGESET_NAME_CONDITION");
  assert.match(f.review.plan.request.ChangeSetName, /^techlong-j5gj22-stack-read-grant-/); assert.deepEqual(f.review.allowedWriteActions, ["cloudformation:CreateChangeSet"]);
  assert.equal(f.review.persistenceImplemented, true); assert.equal(f.review.installationToolsImplemented, false);
  assert.equal(f.review.grantExecutionAuthorized, false); assert.equal(f.review.operatorReadAuthorized, false); assert.equal(await f.slot.readClaim(), null);
  assert(Date.parse(f.review.expiresAt) - Date.parse(f.review.issuedAt) <= 300_000);
  await assert.rejects(assertArnProbeComparisonCreateReview(f.review as unknown as Parameters<typeof assertArnProbeComparisonCreateReview>[0]));
});
test("J22 creates one exact unexecuted target only after durable claim, then independent read-only recovery", async () => {
  const f = await ports(), receipt = await createReviewedStackControl(f);
  assert.equal(receipt.outcome, "CREATE_SUBMITTED"); assert.deepEqual(f.events, ["claim", "create"]);
  assert.equal(receipt.grantInstalled, false); assert.equal(receipt.retryAuthorized, false);
  f.setTime(Date.parse(f.review.plan.input.candidate.input.expiresAt) + 1000);
  const recovered = await recoverStackControlCreate(f); assert.equal(recovered.outcome, "READY_UNEXECUTED"); assert.equal(recovered.mutationPerformed, false);
  await assert.rejects(createReviewedStackControl(f)); assert.deepEqual(f.events, ["claim", "create"]);
});
test("mismatched/expired/legacy approval rejects before claim or submission", async () => {
  const f = await ports();
  for (const approval of [{ ...f.approval, approvedReviewSha256: "a".repeat(64) }, { ...f.approval, acknowledgePermanentSlotAndOldRecords: false },
    { ...f.approval, executionPhrase: "I_CONFIRM_J5GJ20_CREATE_GENERATION4_READ_COMPARISON_GRANT_ONLY" }]) await assert.rejects(createReviewedStackControl({ ...f, approval }));
  f.setTime(Date.parse(f.review.expiresAt)); await assert.rejects(createReviewedStackControl(f)); assert.deepEqual(f.events, []);
});
test("fresh preflight cannot adopt a target, drift Locked, hide foreign history, or drift original fixture", async () => {
  const f = await ports(), base = { ...f.reads };
  f.setTarget(true); await assert.rejects(createReviewedStackControl(f)); f.setTarget(false);
  f.reads.readManagement = async (p, s) => { const value = await base.readManagement(p, s); return { ...value, authorityState: "PRESENT" as typeof value.authorityState }; };
  await assert.rejects(createReviewedStackControl(f)); f.reads.readManagement = base.readManagement;
  f.reads.readInventory = async (p, s) => { const value = await base.readInventory(p, s); return { ...value, knownTerminal: [...value.knownTerminal, { ...value.knownTerminal[0], changeSetArn: arnFor("foreign") }] }; };
  await assert.rejects(createReviewedStackControl(f)); f.reads.readInventory = base.readInventory;
  f.reads.readFixtureInventory = async (p, s) => ({ ...await base.readFixtureInventory(p, s), changeSetArn: arnFor("foreign") });
  await assert.rejects(createReviewedStackControl(f)); assert.deepEqual(f.events, []);
});
test("uncertain Create keeps permanent claim and permits only recovery, never replay", async () => {
  const f = await ports();
  const receipt = await createReviewedStackControl({ ...f, create: async () => { f.events.push("lost-create"); throw new Error("Private raw failure must not appear in receipt"); } });
  assert.equal(receipt.outcome, "CREATE_UNCERTAIN"); assert.equal(receipt.mutationPerformed, null); assert.doesNotMatch(JSON.stringify(receipt), /Private raw failure/);
  await assert.rejects(createReviewedStackControl(f)); const recovered = await recoverStackControlCreate(f);
  assert.equal(recovered.outcome, "MISSING_SLOT_CONSUMED"); assert.deepEqual(f.events, ["claim", "lost-create"]);
});
test("approval expiry after durable claim makes zero submissions and still consumes fixed slot", async () => {
  const f = await ports(), reserve = f.slot.reserve;
  f.slot.reserve = async (...args) => { const value = await reserve(...args); f.setTime(Date.parse(f.review.expiresAt)); return value; };
  const receipt = await createReviewedStackControl(f); assert.equal(receipt.outcome, "NO_CREATE_SUBMITTED_SLOT_CONSUMED"); assert.equal(receipt.mutationPerformed, false);
  assert.deepEqual(f.events, ["claim"]); assert.ok(await f.slot.readClaim());
});
test("rehashed scope, time or observation drift cannot widen a creation review", async () => {
  const f = await ports();
  for (const change of ["action", "time", "baseline"] as const) {
    const v = structuredClone(f.review) as Mutable<typeof f.review>;
    if (change === "action") v.allowedWriteActions.push("cloudformation:ExecuteChangeSet");
    if (change === "time") v.expiresAt = new Date(Date.parse(v.issuedAt) + 300_001).toISOString();
    if (change === "baseline") v.observation.managementAfter.policies[0].defaultDocumentSha256 = "a".repeat(64);
    await assert.rejects(assertStackControlCreateReview(await signed(v, "reviewSha256")));
  }
});
test("real temporary FS slot reads do not create state; concurrent create claims have exactly one winner", async () => {
  const f = await ports(); await temp(async root => {
    const slot = await createStackControlFsSlot(root, f.slot.fence, f.predecessor); assert.equal(await slot.readClaim(), null);
    await assert.rejects(lstat(path.join(root, ".aws-sandbox")), { code: "ENOENT" });
    const outcomes = await Promise.allSettled([slot.reserve(f.review, proof, new Date(f.now()).toISOString()), slot.reserve(f.review, proof, new Date(f.now()).toISOString())]);
    assert.equal(outcomes.filter(v => v.status === "fulfilled").length, 1); assert.equal(outcomes.filter(v => v.status === "rejected").length, 1);
    assert.ok(await slot.readClaim()); assert.deepEqual(await readdir(path.join(root, f.slot.fence.slotRelativePath)), ["claim.json"]);
    await assert.rejects(slot.reserve(f.review, proof, new Date(f.now()).toISOString()));
  });
});
test("partial, corrupt and unknown-generation slot state never resets or repairs", async () => {
  const f = await ports(); await temp(async root => {
    const slot = await createStackControlFsSlot(root, f.slot.fence, f.predecessor), directory = path.join(root, f.slot.fence.slotRelativePath);
    await mkdir(directory, { recursive: true }); await assert.rejects(slot.readClaim()); await assert.rejects(slot.reserve(f.review, proof, new Date(f.now()).toISOString()));
    await writeFile(path.join(directory, "claim.json"), "{}"); await assert.rejects(slot.readClaim());
    await mkdir(path.join(path.dirname(directory), "slot-000006")); await assert.rejects(slot.readClaim());
    assert.deepEqual((await readdir(directory)).sort(), ["claim.json"]);
  });
});
test("linked ancestors and multiply-linked claim files are rejected without following or repairing them", async () => {
  const f = await ports(); await temp(async root => {
    const directory = path.join(root, "foreign"); await mkdir(directory);
    await symlink(directory, path.join(root, ".aws-sandbox"), "junction");
    const slot = await createStackControlFsSlot(root, f.slot.fence, f.predecessor);
    await assert.rejects(slot.readClaim()); await assert.rejects(slot.reserve(f.review, proof, new Date(f.now()).toISOString()));
    assert.deepEqual(await readdir(directory), []);
  });
  await temp(async root => {
    const slot = await createStackControlFsSlot(root, f.slot.fence, f.predecessor); await slot.reserve(f.review, proof, new Date(f.now()).toISOString());
    await link(path.join(root, f.slot.fence.slotRelativePath, "claim.json"), path.join(root, "extra-link.json")); await assert.rejects(slot.readClaim());
  });
});
test("six future intents bind new SHA/claim/actions, consume once, and permit cleanup after expiry without reads", async () => {
  const f = await ports(); await temp(async root => {
    const slot = await createStackControlFsSlot(root, f.slot.fence, f.predecessor), claim = await slot.reserve(f.review, proof, new Date(f.now()).toISOString());
    const at = f.now() + 1000, m = await compileStackControlActions({ creationReview: f.review, claim, grantChangeSetArn: arnFor(f.review.plan.request.ChangeSetName), reviewedAt: new Date(at).toISOString(), expiresAt: new Date(at + 300_000).toISOString() });
    assert.equal(m.installationToolsImplemented, false); assert.equal(m.grantInstallationApproved, false); assert.equal(m.actions.operatorReads.maxTotalSubmissions, 2);
    const journal = await slot.workflowJournal(m), time = (offset: number) => new Date(at + offset).toISOString();
    await assert.rejects(journal.reserve("read-full-arn", stackControlStepRequest(m, "read-full-arn"), time(1)));
    await journal.reserve("run", stackControlStepRequest(m, "run"), time(1)); await journal.reserve("grant-execute", stackControlStepRequest(m, "grant-execute"), time(2));
    await journal.reserve("read-full-arn", stackControlStepRequest(m, "read-full-arn"), time(3)); await assert.rejects(journal.reserve("read-full-arn", stackControlStepRequest(m, "read-full-arn"), time(4)));
    await journal.reserve("read-exact-name", stackControlStepRequest(m, "read-exact-name"), time(4));
    await journal.reserve("revoke-create", stackControlStepRequest(m, "revoke-create"), time(300_001));
    const request = { StackName: f.review.plan.request.StackName, ChangeSetName: arnFor(m.actions.revoke.createRequest.ChangeSetName), ClientRequestToken: m.actions.revoke.executeClientToken, DisableRollback: false };
    await journal.reserve("revoke-execute", request, time(300_002)); assert.deepEqual((await journal.load("revoke-execute"))!.request, request);
    assert.equal((await readdir(path.join(root, f.slot.fence.slotRelativePath))).length, 7);
    const bad = structuredClone(m) as Mutable<typeof m>; bad.actions.operatorReads.cases[0].request.StackName = "foreign";
    await assert.rejects(assertStackControlActions(await signed(bad, "manifestSha256")));
  });
});
test("future journal rejects request drift, late reads and foreign persisted manifest without writing a repair", async () => {
  const f = await ports(); await temp(async root => {
    const slot = await createStackControlFsSlot(root, f.slot.fence, f.predecessor), claim = await slot.reserve(f.review, proof, new Date(f.now()).toISOString());
    const at = f.now() + 1000, input = { creationReview: f.review, claim, grantChangeSetArn: arnFor(f.review.plan.request.ChangeSetName), reviewedAt: new Date(at).toISOString(), expiresAt: new Date(at + 300_000).toISOString() };
    const m = await compileStackControlActions(input), journal = await slot.workflowJournal(m);
    await assert.rejects(journal.reserve("run", { altered: true }, input.reviewedAt));
    await journal.reserve("run", m.actions, input.reviewedAt); await journal.reserve("grant-execute", m.actions.grantExecute.request, new Date(at + 1).toISOString());
    await assert.rejects(journal.reserve("read-full-arn", stackControlStepRequest(m, "read-full-arn"), input.expiresAt));
    const other = await compileStackControlActions({ ...input, reviewedAt: new Date(at + 1).toISOString() }); await assert.rejects(slot.workflowJournal(other));
    assert.equal((await readdir(path.join(root, f.slot.fence.slotRelativePath))).length, 3);
  });
});
test("SDK inventory validates retained executed history plus exact new target, with complete brackets and no writes", async () => {
  const f = await ports(), plan = f.review.plan, history = stackControlHistory(f.predecessor), seen: string[] = [];
  const all = [...history.map(h => ({ arn: h.arn, request: h.request, execution: "EXECUTE_COMPLETE" })), { arn: arnFor(plan.request.ChangeSetName), request: plan.request, execution: "AVAILABLE" }];
  const client = { send: async (command: unknown) => {
    const c = command as Command; seen.push(c.constructor.name);
    if (c instanceof List) return { Summaries: all.map(e => ({ StackId: e.request.StackName, ChangeSetId: e.arn, ChangeSetName: e.request.ChangeSetName, Status: "CREATE_COMPLETE", ExecutionStatus: e.execution })) };
    const entry = all.find(e => e.arn === c.input.ChangeSetName)!; assert.ok(entry);
    return c instanceof Template ? { TemplateBody: entry.request.TemplateBody } : providerReply(entry.request, entry.arn, entry.execution);
  } };
  const adapter = new AwsSdkStackControlInventoryReadAdapter(client, { listChangeSets: List, describeChangeSet: Describe, getTemplate: Template }, f.now);
  const value = await adapter.readInventory(plan, f.signal); assert.equal(value.knownTerminal.length, 2); assert.equal(value.target.state, "READY_UNEXECUTED");
  assert.equal(seen.filter(v => v === "List").length, 2); assert(seen.every(v => ["List", "Describe", "Template"].includes(v)));
});
test("SDK inventory rejects foreign terminal, duplicate, pagination, unstable bracket, unsafe rollback or history template drift", async () => {
  const f = await ports(), h = stackControlHistory(f.predecessor)[0], base = { StackId: h.request.StackName, ChangeSetId: h.arn, ChangeSetName: h.request.ChangeSetName, Status: "CREATE_COMPLETE", ExecutionStatus: "EXECUTE_COMPLETE" };
  for (const kind of ["foreign", "duplicate", "pagination", "unstable", "rollback", "template"] as const) {
    let lists = 0; const client = { send: async (command: unknown) => {
      const c = command as Command;
      if (c instanceof List) { lists++; return { Summaries: kind === "foreign" ? [{ ...base, ChangeSetId: arnFor("foreign") }] : kind === "duplicate" ? [base, base] : kind === "unstable" && lists > 1 ? [] : [base], ...(kind === "pagination" ? { NextToken: "more" } : {}) }; }
      if (c instanceof Template) return { TemplateBody: kind === "template" ? "{}" : h.request.TemplateBody };
      return { ...providerReply(h.request, h.arn, "EXECUTE_COMPLETE"), ...(kind === "rollback" ? { RoleARN: "foreign" } : {}) };
    } };
    const adapter = new AwsSdkStackControlInventoryReadAdapter(client, { listChangeSets: List, describeChangeSet: Describe, getTemplate: Template }, f.now);
    await assert.rejects(adapter.readInventory(f.review.plan, f.signal), /J22/, kind);
  }
  const reply = providerReply(h.request, h.arn); await assert.rejects(validateStackControlRetainedHistory(h, reply, reply, { TemplateBody: h.request.TemplateBody }));
});
test("SDK only proves absent history/target from real complete inventory and singleton exact fixture", async () => {
  const f = await ports(), prior = f.predecessor.input.creationReview.plan.input.comparisonPlan.input.priorPlan; let multiple = false;
  const client = { send: async (command: unknown) => { const c = command as Command; assert(c instanceof List);
    const fixture = { StackId: prior.input.fixtureStackId, ChangeSetId: prior.input.fixtureChangeSetArn, ChangeSetName: prior.input.fixturePlan.request.ChangeSetName, Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE" };
    return { Summaries: c.input.StackName === prior.input.fixtureStackId ? multiple ? [fixture, { ...fixture, ChangeSetId: arnFor("foreign") }] : [fixture] : [] }; } };
  const adapter = new AwsSdkStackControlInventoryReadAdapter(client, { listChangeSets: List, describeChangeSet: Describe, getTemplate: Template }, f.now);
  const inventory = await adapter.readInventory(f.review.plan, f.signal); assert.deepEqual(inventory.knownTerminal, []); assert.equal(inventory.target.state, "MISSING");
  assert.equal((await adapter.readFixtureInventory(f.predecessor, f.signal)).count, 1); multiple = true; await assert.rejects(adapter.readFixtureInventory(f.predecessor, f.signal));
});
test("Create SDK dependency is exact and single-submit even after lost reply", async () => {
  const f = await ports(); let submissions = 0;
  const adapter = new AwsSdkStackControlCreateAdapter(f.review.plan, { send: async () => { submissions++; throw new Error("Lost"); } }, Command);
  const wrong = { ...f.review.plan.request, StackName: "foreign" } as unknown as StackControlCreatePlan["request"];
  await assert.rejects(adapter.create(wrong, f.signal)); assert.equal(submissions, 0);
  await assert.rejects(adapter.create(f.review.plan.request, f.signal)); await assert.rejects(adapter.create(f.review.plan.request, f.signal)); assert.equal(submissions, 1);
});
test("J22 CLI rejects unsupported execution, missing acknowledgements and duplicate approval before output or SDK", async () => {
  const script = fileURLToPath(new URL("../ops/aws-sandbox/scripts/s3-b5-arn-probe-stack-scoped-read-control-create.ts", import.meta.url));
  for (const args of [["--mode", "RunReviewed"], ["--mode", "CreateReviewed", "--evidence", path.resolve("missing-evidence.json"), "--output", path.resolve("never-create.json")], ["--approved-review-sha256", proof, "--approved-review-sha256", proof]]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", script, ...args], { windowsHide: true, encoding: "utf8" });
    assert.notEqual(result.status, 0); assert.doesNotMatch(result.stderr, /Credential|Login|ECONN/);
  }
  const source = await readFile(script, "utf8"); assert.doesNotMatch(source, /ExecuteChangeSetCommand|DeleteChangeSetCommand|DeleteStackCommand|AssumeRole|prepareOperator/);
  const localCheck = await readFile(new URL("../ops/aws-sandbox/scripts/s3-b5-arn-probe-stack-scoped-read-control.ts", import.meta.url), "utf8");
  assert.doesNotMatch(localCheck, /@aws-sdk|reserve\(|compileStackScopedReadControl\(/);
});
