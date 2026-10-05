import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { ARN_PROBE_EXECUTION_ROLE } from "../lib/deployments/execution/arn-compatibility-probe-fixture.ts";
import { compileGeneration6Actions } from "../lib/deployments/execution/arn-probe-stack-control-generation6-actions.ts";
import { createGeneration6FsSlot } from "../lib/deployments/execution/arn-probe-stack-control-generation6-storage.ts";
import { assertGeneration6Workflow, compileGeneration6Workflow, assertGeneration6Management, runGeneration6Workflow,
  recoverGeneration6Revoke, inspectGeneration6Workflow } from "../lib/deployments/execution/arn-probe-stack-control-generation6-workflow.ts";
import { AwsSdkGeneration6WorkflowReadAdapter, AwsSdkGeneration6WorkflowWriteAdapter, AwsSdkGeneration6OperatorReadAdapter } from "../lib/deployments/execution/aws-sdk-arn-probe-stack-control-generation6-workflow.ts";
import { generation6WorkflowFixture, controlArn, controlProof, controlUuid } from "./fixtures/arn-probe-generation6-workflow.ts";
import { signed } from "./fixtures/arn-probe-stack-scoped-read-control.ts";

class Command { input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
class List extends Command {} class Describe extends Command {} class Template extends Command {} class Stack extends Command {} class Create extends Command {} class Execute extends Command {}
const signal = () => new AbortController().signal;
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };
const mutable = <T>(value: T): Mutable<T> => structuredClone(value) as Mutable<T>;
type Fixture = Awaited<ReturnType<typeof generation6WorkflowFixture>>;
function recoveryApproval(f: Fixture) { return { ...f.approval, approvedGrantSha256: "", approvedReadsSha256: "", executionPhrase: "I_CONFIRM_J5GJ23_GENERATION6_REVOKE_ONLY" }; }
function sdkReads(f: Fixture, send: (c: Command) => Promise<Record<string, unknown>>, pause?: (s: AbortSignal) => Promise<void>) {
  return new AwsSdkGeneration6WorkflowReadAdapter({ client: { send: c => send(c as Command) }, commands: { listChangeSets: List, describeChangeSet: Describe,
    getTemplate: Template, describeStacks: Stack }, readManagement: f.reads.readManagement, creation: f.reads.creation, readFixture: f.reads.readFixture, readFixtureInventory: f.reads.readFixtureInventory, pause }, f.now);
}
function providerReply(request: Fixture["creationReview"]["plan"]["request"], arn: string, executionStatus = "AVAILABLE") {
  return { StackId: request.StackName, StackName: "techlong-s3-b5-cell-lifecycle-management", ChangeSetId: arn, ChangeSetName: request.ChangeSetName,
    Description: request.Description, Status: "CREATE_COMPLETE", ExecutionStatus: executionStatus, Capabilities: ["CAPABILITY_NAMED_IAM"], NotificationARNs: [],
    Parameters: [{ ParameterKey: "ExpectedAccountId", ParameterValue: "402010193138" }, { ParameterKey: "ExpectedRegion", ParameterValue: "ca-central-1" },
      { ParameterKey: "ManagementPrincipalArn", ParameterValue: "arn:aws:iam::402010193138:user/techlong-sandbox-dev" }],
    Changes: [{ Type: "Resource", ResourceChange: { Action: "Modify", LogicalResourceId: "CellOperatorBoundary", ResourceType: "AWS::IAM::ManagedPolicy",
      PhysicalResourceId: "arn:aws:iam::402010193138:policy/TechlongSandboxCellOperatorBoundary", Replacement: "False" } }] };
}
async function temp(run: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "techlong-j23b-test-")));
  try { await run(root); } finally { const resolved = await realpath(root), base = await realpath(os.tmpdir());
    assert.equal(path.dirname(resolved), base); assert.match(path.basename(resolved), /^techlong-j23b-test-/); await rm(resolved, { recursive: true, force: true }); }
}

test("J23B execution review binds fresh full Source, never executes pure B actions or rehashed drift", async () => {
  const f = await generation6WorkflowFixture(), m = f.manifest; await assertGeneration6Workflow(m);
  assert.equal(m.installationToolsImplemented, true); assert.equal(m.executionApproved, false); assert.equal(m.grantInstallationApproved, false);
  const { sourceObservation: ignored, ...base } = m.input; void ignored;
  const future = await compileGeneration6Actions(base); await assert.rejects(assertGeneration6Workflow(future as unknown as typeof m));
  for (const change of ["source", "scope", "window"] as const) {
    const bad = mutable(m);
    if (change === "source") bad.input.sourceObservation.managementBefore.callerArn = "arn:aws:iam::402010193138:root" as typeof bad.input.sourceObservation.managementBefore.callerArn;
    if (change === "scope") bad.actions.operatorReads.cases[0].request.ChangeSetName = "foreign";
    if (change === "window") bad.input.expiresAt = new Date(Date.parse(bad.input.reviewedAt) + 300_001).toISOString();
    await assert.rejects(assertGeneration6Workflow(await signed(bad, "manifestSha256")));
  }
  await assert.rejects(compileGeneration6Workflow({ ...m.input, sourceObservation: { ...m.input.sourceObservation,
    managementBefore: { ...m.input.sourceObservation.managementBefore, observedAt: new Date(Date.parse(m.input.reviewedAt) - 61_000).toISOString() } } }));
  assert.deepEqual(f.events, []);
});

test("J23B two independent Describe cases bracket Source, immediately Revoke, and inspect advanced Locked v9", async () => {
  const f = await generation6WorkflowFixture(), receipt = await runGeneration6Workflow(f);
  assert.equal(receipt.outcome, "LOCKED_STACK_READ_CONTROL_RECORDED"); assert.equal(receipt.results.length, 2); assert.equal(receipt.sourceReadBrackets.length, 2);
  assert.equal(receipt.cleanup?.evidence.last.policies.find(p => p.logicalId === "CellOperatorBoundary")?.defaultVersionId, "v9");
  assert.equal(receipt.productionCompatibilityVerified, false); assert.equal(receipt.runtimeEnabled, false); assert.equal(receipt.probeDeleted, false); assert.equal(receipt.childExecuted, false);
  assert.deepEqual(f.events.filter(v => v.startsWith("submit-")), ["submit-grant", "submit-revoke-create", "submit-revoke-execute"]);
  const inspect = await inspectGeneration6Workflow(f); assert.equal(inspect.outcome, "LOCKED_VERIFIED"); assert.equal(inspect.mutationPerformed, false);
  const before = [...f.events]; await assert.rejects(runGeneration6Workflow(f)); assert.deepEqual(f.events, before);
  const read = f.reads.readWorkflowInventory; f.reads.readWorkflowInventory = async (...args) => ({ ...await read(...args), stackId: "foreign" });
  await assert.rejects(inspectGeneration6Workflow(f)); assert.deepEqual(f.events, [...before, "settle-grant"]);
});

test("J23B two authorized denials are distinct evidence; uncertain first read never retries", async () => {
  const denied = await generation6WorkflowFixture(); denied.operatorReads.readCase = async (_m, style) => denied.deny(style);
  const result = await runGeneration6Workflow(denied); assert.equal(result.outcome, "LOCKED_STACK_READ_CONTROL_RECORDED");
  assert.deepEqual(result.results.map(r => r.outcome), ["READ_DENIED", "READ_DENIED"]); assert.notEqual(result.results[0].requestId, result.results[1].requestId);
  const uncertain = await generation6WorkflowFixture(); uncertain.operatorReads.readCase = async (_m, style) => uncertain.deny(style, true);
  const unknown = await runGeneration6Workflow(uncertain); assert.equal(unknown.results.length, 1); assert.equal(unknown.results[0].outcome, "READ_UNCERTAIN");
  assert.ok(unknown.cleanup); assert.equal(uncertain.intents.has("read-exact-name"), false);
});

test("J23B lost Grant and Revoke responses reconcile read-only, with each mutation submitted once", async () => {
  const f = await generation6WorkflowFixture();
  const lose = <R>(original: (r: R, s: AbortSignal) => Promise<unknown>) => async (r: R, s: AbortSignal) => {
    await original(r, s); throw new Error("PRIVATE_MFA_AND_PROVIDER_TEXT_NEVER_SAVE"); };
  f.writes.executeGrant = lose(f.writes.executeGrant); f.writes.createRevoke = lose(f.writes.createRevoke); f.writes.executeRevoke = lose(f.writes.executeRevoke);
  const result = await runGeneration6Workflow(f); assert.equal(result.outcome, "LOCKED_STACK_READ_CONTROL_RECORDED"); assert.equal(result.failures.length, 3);
  assert.deepEqual(f.events.filter(v => v.startsWith("submit-")), ["submit-grant", "submit-revoke-create", "submit-revoke-execute"]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_MFA_AND_PROVIDER_TEXT/); assert.ok(f.events.indexOf("settle-grant") > f.events.indexOf("submit-grant"));
});

test("J23B cancellation and read-window expiry cannot cancel the independent cleanup signal", async () => {
  for (const kind of ["cancel", "expire"] as const) {
    const f = await generation6WorkflowFixture(), original = f.operatorReads.readCase;
    f.operatorReads.readCase = async (...args) => { const result = await original(...args); if (kind === "cancel") f.abort.abort(); else f.setTime(Date.parse(f.manifest.input.expiresAt)); return result; };
    const create = f.writes.createRevoke, execute = f.writes.executeRevoke;
    f.writes.createRevoke = async (r, s) => { assert.equal(s.aborted, false); assert.notEqual(s, f.signal); return create(r, s); };
    f.writes.executeRevoke = async (r, s) => { assert.equal(s.aborted, false); assert.notEqual(s, f.signal); return execute(r, s); };
    const result = await runGeneration6Workflow(f); assert.ok(result.cleanup); assert.equal(result.results.length, kind === "cancel" ? 1 : 0); assert.equal(f.intents.has("read-exact-name"), false);
  }
});

test("J23B mismatched approvals, consumed slots, expired clocks and foreign fixed identity reject before Grant", async () => {
  const f = await generation6WorkflowFixture();
  for (const key of ["approvedManifestSha256", "approvedGrantSha256", "approvedReadsSha256", "approvedRevokeSha256"] as const)
    await assert.rejects(runGeneration6Workflow({ ...f, approval: { ...f.approval, [key]: "a".repeat(64) } }));
  assert.deepEqual(f.events, []); f.setTime(Date.parse(f.manifest.input.expiresAt)); await assert.rejects(runGeneration6Workflow(f)); assert.deepEqual(f.events, []);
  f.setTime(Date.parse(f.manifest.input.reviewedAt) + 1000);
  f.intents.set("run", { request: f.manifest.actions }); await assert.rejects(runGeneration6Workflow(f)); assert.deepEqual(f.events, []); f.intents.clear();
  f.writes.prepareOperator = async () => { f.events.push("foreign-identity"); return { callerArn: "arn:aws:iam::402010193138:root", account: "402010193138", expiresAt: new Date(f.now() + 900_000).toISOString() }; };
  await assert.rejects(runGeneration6Workflow(f)); assert.deepEqual(f.events, ["foreign-identity"]); assert.equal(f.intents.size, 0);
});

test("J23B fresh preflight cannot hide foreign inventory, fixture drift or stale management", async () => {
  for (const mode of ["inventory", "fixture", "stale"] as const) {
    const f = await generation6WorkflowFixture(), read = f.reads.creation.observe;
    f.reads.creation.observe = async (...a) => {
      const r = mutable(await read(...a));
      if (mode === "inventory") Object.assign(r.inventory, { knownTerminal: [] });
      if (mode === "fixture") r.fixtureInventoryBefore.count = 2 as 1;
      if (mode === "stale") r.managementBefore.observedAt = new Date(f.now() - 61_000).toISOString();
      return r;
    };
    await assert.rejects(runGeneration6Workflow(f)); assert.deepEqual(f.events, []); assert.equal(f.intents.size, 0);
  }
});

test("J23B expired revoke-only recovery preserves intents and cannot replay Grant or Operator", async () => {
  const f = await generation6WorkflowFixture(), execute = f.writes.executeRevoke;
  f.writes.executeRevoke = async () => { f.events.push("lost-revoke-without-effect"); throw new Error("lost response"); };
  const result = await runGeneration6Workflow(f); assert.equal(result.outcome, "REVOKE_REQUIRED"); assert.equal(f.intents.has("revoke-execute"), true);
  f.setTime(Date.parse(f.manifest.input.expiresAt) + 1000); f.writes.executeRevoke = execute;
  const before = [...f.events]; const recovered = await recoverGeneration6Revoke({ ...f, approval: recoveryApproval(f) });
  assert.equal(recovered.outcome, "REVOKE_REQUIRED"); assert.deepEqual(f.events, before); // Existing execute intent is never resubmitted.
  f.setInstalled(false); const inspectOnly = await recoverGeneration6Revoke({ ...f, approval: recoveryApproval(f) });
  assert.equal(inspectOnly.outcome, "LOCKED_VERIFIED"); assert.deepEqual(f.events, before);
  const fresh = await generation6WorkflowFixture(); await assert.rejects(recoverGeneration6Revoke({ ...fresh, approval: recoveryApproval(fresh) })); assert.deepEqual(fresh.events, []);
});

test("J23B missing cleanup Create with consumed intent is never recreated; unclaimed Revoke is never adopted", async () => {
  for (const kind of ["lost-create", "unclaimed"] as const) {
    const f = await generation6WorkflowFixture();
    if (kind === "lost-create") f.writes.createRevoke = async () => { f.events.push("lost-create-no-effect"); throw new Error("uncertain"); };
    else f.setRevoke(true);
    const result = await runGeneration6Workflow(f); assert.equal(result.outcome, "REVOKE_REQUIRED");
    const before = [...f.events]; const recovery = await recoverGeneration6Revoke({ ...f, approval: recoveryApproval(f) });
    assert.equal(recovery.outcome, "REVOKE_REQUIRED"); assert.deepEqual(f.events.filter(e => e !== "settle-grant"), before.filter(e => e !== "settle-grant")); assert.equal(f.events.includes("submit-revoke-execute"), false);
  }
});

test("J23B cleanup may be Locked while fixture reconciliation remains blocked; not a completed control", async () => {
  const f = await generation6WorkflowFixture(), execute = f.writes.executeRevoke;
  f.writes.executeRevoke = async (...a) => { const r = await execute(...a); f.reads.readFixtureInventory = async () => { throw new Error("fixture uncertain"); }; return r; };
  const result = await runGeneration6Workflow(f); assert.equal(result.outcome, "LOCKED_RECONCILIATION_REQUIRED"); assert.equal(result.fixtureAfter, null); assert.ok(result.cleanup);
  await assert.rejects(inspectGeneration6Workflow(f));
});

test("J23B exact live IAM document permits intentional version advancement, never widened policies or trust", async () => {
  const f = await generation6WorkflowFixture(), plan = f.creationReview.plan; f.setInstalled(true);
  const value = await f.reads.readManagement(plan, signal()); assert.equal(await assertGeneration6Management(plan, value, f.now()), false);
  for (const kind of ["policy", "role", "resources", "root"] as const) {
    const bad = mutable(value);
    if (kind === "policy") bad.policies[0].defaultDocumentSha256 = "a".repeat(64);
    if (kind === "role") bad.roles[0].trustPolicySha256 = "a".repeat(64);
    if (kind === "resources") bad.stack.resources = [];
    if (kind === "root") Object.assign(bad, { unreviewed: true });
    await assert.rejects(assertGeneration6Management(plan, bad, f.now()));
  }
});

test("J23B fixed FS journal binds full Source manifest and persists consumption without resets", async () => {
  const f = await generation6WorkflowFixture(); await temp(async root => {
    const slot = await createGeneration6FsSlot(root, f.context);
    assert.equal(await slot.workflowIntentsPresent(), false); assert.deepEqual(await readdir(root), []);
    await slot.reserve(f.creationReview, f.claim.preflightEvidenceSha256, f.claim.reservedAt);
    const journal = await slot.workflowJournal(f.manifest);
    await journal.reserve("run", f.manifest.actions, new Date(f.now()).toISOString());
    assert.equal(await slot.workflowIntentsPresent(), true); assert.equal((await journal.load("run"))?.manifestSha256, f.manifest.manifestSha256);
    await assert.rejects(journal.reserve("run", f.manifest.actions, new Date(f.now()).toISOString()));
    await assert.rejects(journal.reserve("read-full-arn", f.manifest.actions.operatorReads.cases[0].request, new Date(f.now()).toISOString()));
    const { sourceObservation: ignored, ...base } = f.manifest.input; void ignored;
    await assert.rejects(slot.workflowJournal(await compileGeneration6Actions(base) as unknown as typeof f.manifest));
  });
});

test("J23B SDK Grant settlement never discharges cleanup using early stale Locked", async () => {
  const f = await generation6WorkflowFixture(); let polls = 0, collected = 0;
  const read = f.reads.readManagement; f.reads.readManagement = async (...a) => { collected++; return read(...a); };
  const adapter = sdkReads(f, async c => {
    if (c instanceof Describe) { polls++; return providerReply(f.creationReview.plan.request, f.manifest.input.grantChangeSetArn, polls < 3 ? "AVAILABLE" : "EXECUTE_COMPLETE"); }
    assert.ok(c instanceof Stack); return { Stacks: [{ StackId: f.creationReview.plan.request.StackName, StackName: "techlong-s3-b5-cell-lifecycle-management",
      StackStatus: "UPDATE_COMPLETE", EnableTerminationProtection: false }] };
  }, async () => { assert.equal(collected, 0); });
  await adapter.waitGrantSettlement(f.manifest, signal()); assert.equal(polls, 3); assert.equal(collected, 1);
});

test("J23B durable six-step runner remains consumed, rejects chronological and re-signed request drift", async () => {
  const f = await generation6WorkflowFixture(); await temp(async root => {
    const slot = await createGeneration6FsSlot(root, f.context);
    await slot.reserve(f.creationReview, f.claim.preflightEvidenceSha256, f.claim.reservedAt);
    const journal = await slot.workflowJournal(f.manifest);
    const receipt = await runGeneration6Workflow({ ...f, readClaim: slot.readClaim, journal });
    assert.equal(receipt.outcome, "LOCKED_STACK_READ_CONTROL_RECORDED");
    const fresh = await (await createGeneration6FsSlot(root, f.context)).workflowJournal(f.manifest);
    for (const step of ["run", "grant-execute", "read-full-arn", "read-exact-name", "revoke-create", "revoke-execute"] as const) assert.ok(await fresh.load(step));
    const before = [...f.events]; await assert.rejects(runGeneration6Workflow({ ...f, readClaim: slot.readClaim, journal: fresh })); assert.deepEqual(f.events, before);
    const file = path.join(root, f.creationReview.fence.slotRelativePath, "read-full-arn-intent.json"), original = await readFile(file, "utf8"), value = JSON.parse(original);
    value.request.ChangeSetName = "foreign"; value.requestSha256 = await sha256Hex(canonicalJson(value.request));
    await writeFile(file, JSON.stringify(value)); await assert.rejects(slot.workflowJournal(f.manifest));
    await writeFile(file, original); value.request = JSON.parse(original).request;
    value.requestSha256 = JSON.parse(original).requestSha256; value.reservedAt = f.claim.reservedAt;
    await writeFile(file, JSON.stringify(value)); await assert.rejects(slot.workflowJournal(f.manifest));
  });
});

test("J23B permanent run intent has one concurrent winner and cannot open a new review", async () => {
  const f = await generation6WorkflowFixture(); await temp(async root => {
    const slot = await createGeneration6FsSlot(root, f.context); await slot.reserve(f.creationReview, f.claim.preflightEvidenceSha256, f.claim.reservedAt);
    const a = await slot.workflowJournal(f.manifest), b = await slot.workflowJournal(f.manifest), at = new Date(f.now()).toISOString();
    const results = await Promise.allSettled([a.reserve("run", f.manifest.actions, at), b.reserve("run", f.manifest.actions, at)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(await slot.workflowIntentsPresent(), true);
    await assert.rejects(a.reserve("read-full-arn", f.manifest.actions.operatorReads.cases[0].request, at));
    assert.ok(await b.load("run")); assert.equal(await b.load("grant-execute"), null);
  });
});

test("J23B expired separate revoke-only recovery may finish unsubmitted cleanup without Grant/Operator replay", async () => {
  const f = await generation6WorkflowFixture(), settle = f.reads.waitGrantSettlement;
  f.reads.waitGrantSettlement = async () => { throw new Error("uncertain settlement"); };
  const run = await runGeneration6Workflow(f); assert.equal(run.outcome, "REVOKE_REQUIRED"); assert.equal(f.intents.has("revoke-create"), false);
  f.reads.waitGrantSettlement = settle; f.setTime(Date.parse(f.manifest.input.expiresAt) + 1000);
  const before = [...f.events], recovered = await recoverGeneration6Revoke({ ...f, approval: recoveryApproval(f) });
  assert.equal(recovered.outcome, "LOCKED_VERIFIED");
  assert.deepEqual(f.events.slice(before.length).filter(e => e.startsWith("submit-")), ["submit-revoke-create", "submit-revoke-execute"]);
  assert.equal(f.events.filter(e => e === "submit-grant").length, 1); assert.equal(f.events.some(e => e.startsWith("describe-")), false);
});

test("J23B SDK unsubmitted/unsettled Grant cannot be discharged as early Locked", async () => {
  const f = await generation6WorkflowFixture(); let polls = 0, collected = 0;
  f.reads.readManagement = async () => { collected++; throw new Error("must not collect early Locked"); };
  const adapter = sdkReads(f, async c => { assert.ok(c instanceof Describe); polls++; return providerReply(f.creationReview.plan.request, f.manifest.input.grantChangeSetArn); }, async () => {});
  await assert.rejects(adapter.waitGrantSettlement(f.manifest, signal())); assert.equal(polls, 120); assert.equal(collected, 0);
});

test("J23B independent Inspect refuses stale Locked with an unsettled permanent Grant intent", async () => {
  const f = await generation6WorkflowFixture();
  await f.journal.reserve("run", f.manifest.actions, new Date(f.now()).toISOString());
  await f.journal.reserve("grant-execute", f.manifest.actions.grantExecute.request, new Date(f.now()).toISOString());
  let collected = 0; f.reads.waitManagement = async () => { collected++; return f.reads.readManagement(f.creationReview.plan, f.signal); };
  f.reads.waitGrantSettlement = async () => { throw new Error("submitted execution still unsettled"); };
  await assert.rejects(inspectGeneration6Workflow(f)); assert.equal(collected, 0); assert.equal(f.events.some(e => e.startsWith("submit-")), false);
});

test("J23B SDK Source writes have exact full ARN and one-shot/revoke-only capability", async () => {
  const f = await generation6WorkflowFixture(), calls: Command[] = [];
  const sdk = { source: { send: async (c: unknown) => { calls.push(c as Command); return { $metadata: { requestId: controlUuid } }; } },
    createChangeSet: Create, executeChangeSet: Execute, grantCapabilityEnabled: true };
  const adapter = new AwsSdkGeneration6WorkflowWriteAdapter(f.manifest, sdk, f.now), request = f.manifest.actions.grantExecute.request;
  await assert.rejects(adapter.executeGrant({ ...request, ChangeSetName: "short-name" }, signal())); assert.equal(calls.length, 0);
  await adapter.executeGrant(request, signal()); await assert.rejects(adapter.executeGrant(request, signal())); assert.deepEqual(calls[0].input, request);
  const only = new AwsSdkGeneration6WorkflowWriteAdapter(f.manifest, { ...sdk, grantCapabilityEnabled: false }, f.now);
  assert.throws(() => only.executeGrant(request, signal())); await only.createRevoke(f.manifest.actions.revoke.createRequest, signal());
  const revoke = { StackName: request.StackName, ChangeSetName: controlArn(f.manifest.actions.revoke.createRequest.ChangeSetName), ClientRequestToken: f.manifest.actions.revoke.executeClientToken, DisableRollback: false as const };
  await only.executeRevoke(revoke, signal()); await assert.rejects(only.executeRevoke(revoke, signal())); assert.equal(calls.length, 3);
  f.setTime(Date.parse(f.manifest.input.expiresAt)); const expired = new AwsSdkGeneration6WorkflowWriteAdapter(f.manifest, sdk, f.now);
  await assert.rejects(expired.executeGrant(request, signal())); assert.equal(calls.length, 3);
});

test("J23B SDK complete inventory admits only exact current objects, rejects foreign/paginated/drift", async () => {
  const f = await generation6WorkflowFixture(), plan = f.creationReview.plan;
  const records = [
    { request: plan.request, arn: f.manifest.input.grantChangeSetArn, exec: "EXECUTE_COMPLETE" },
    { request: f.manifest.actions.revoke.createRequest, arn: controlArn(f.manifest.actions.revoke.createRequest.ChangeSetName), exec: "AVAILABLE" }];
  let corruption = "";
  const adapter = sdkReads(f, async c => {
    if (c instanceof List) return { Summaries: records.map(r => ({ StackId: r.request.StackName, ChangeSetId: r.arn, ChangeSetName: r.request.ChangeSetName, Status: "CREATE_COMPLETE", ExecutionStatus: r.exec })),
      ...(corruption === "pagination" ? { NextToken: "unseen" } : {}), ...(corruption === "foreign" ? { Summaries: [{ StackId: plan.request.StackName, ChangeSetId: controlArn("foreign"), ChangeSetName: "foreign", Status: "CREATE_COMPLETE", ExecutionStatus: "OBSOLETE" }] } : {}) };
    const row = records.find(r => r.arn === c.input.ChangeSetName)!; assert.ok(row);
    if (c instanceof Template) return { TemplateBody: row.request.TemplateBody };
    const response = providerReply(row.request, row.arn, row.exec);
    if (corruption === "parameter") response.Parameters[0].ParameterValue = "other";
    if (corruption === "role") Object.assign(response, { RoleARN: ARN_PROBE_EXECUTION_ROLE }); return response;
  });
  const inventory = await adapter.readWorkflowInventory(f.manifest, signal()); assert.equal(inventory.complete, true); assert.equal(inventory.objects.length, records.length);
  assert.equal((await adapter.waitRevoke(f.manifest, signal())).state, "READY_UNEXECUTED"); assert.equal(inventory.objects.find(o => o.kind === "CURRENT_GRANT")?.executionStatus, "EXECUTE_COMPLETE");
  for (const bad of ["foreign", "pagination", "parameter", "role"]) { corruption = bad; await assert.rejects(adapter.readWorkflowInventory(f.manifest, signal())); }
});

test("J23B SDK Operator submits one Describe per style, validates fixture and sanitizes denial", async () => {
  const f = await generation6WorkflowFixture(), prior = f.context.retirementProof.observation.fixture;
  const calls: Command[] = []; let deny = false;
  const adapter = new AwsSdkGeneration6OperatorReadAdapter({ verifyIdentity: f.writes.prepareOperator, fixturePlan: f.fixturePlan, describeChangeSet: Describe, operator: { send: async c => {
    calls.push(c as Command); if (deny) throw Object.assign(new Error("RAW_SECRET_MUST_NOT_SERIALIZE"), { name: "AccessDenied", $metadata: { requestId: controlUuid, httpStatusCode: 403 } });
    return { StackId: ("stackId" in prior ? prior.stackId : ""), StackName: "techlong-sandbox-arn-compatibility-probe", ChangeSetId: ("changeSetArn" in prior ? prior.changeSetArn : ""),
      ChangeSetName: f.fixturePlan.request.ChangeSetName, RoleARN: ARN_PROBE_EXECUTION_ROLE, Description: f.fixturePlan.request.Description,
      OnStackFailure: "DELETE", Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", Tags: f.fixturePlan.request.Tags,
      Changes: [{ Type: "Resource", ResourceChange: { Action: "Add", LogicalResourceId: "ProbeHandle", ResourceType: "AWS::CloudFormation::WaitConditionHandle" } }],
      $metadata: { requestId: controlUuid, httpStatusCode: 200 } }; } } }, f.now);
  const success = await adapter.readCase(f.manifest, "FULL_ARN_REQUEST", signal()); assert.equal(success.outcome, "READ_SUCCEEDED");
  deny = true; const denial = await adapter.readCase(f.manifest, "EXACT_NAME_REQUEST", signal()); assert.equal(denial.outcome, "READ_DENIED");
  assert.doesNotMatch(JSON.stringify(denial), /RAW_SECRET/); await assert.rejects(adapter.readCase(f.manifest, "FULL_ARN_REQUEST", signal()));
  assert.equal(calls.length, 2); assert.ok(calls.every(c => c instanceof Describe)); assert.deepEqual(calls.map(c => c.input), f.manifest.actions.operatorReads.cases.map(c => c.request));
});

test("J23B CLI and local PowerShell wrapper reject missing approvals and legacy review without clients", async () => {
  const entry = fileURLToPath(new URL("../ops/aws-sandbox/scripts/s3-b5-arn-probe-generation6-workflow.ts", import.meta.url));
  for (const args of [["--mode", "RunReviewed"], ["--mode", "Inspect", "--mode", "Review"], ["--mode", "Unsupported"], ["--reset-slot"]]) {
    const child = spawnSync(process.execPath, ["--experimental-strip-types", entry, ...args], { encoding: "utf8", timeout: 30_000 });
    assert.notEqual(child.status, 0); assert.doesNotMatch(child.stdout, /Enter MFA|LOCKED_VERIFIED/);
  }
  const wrapper = fileURLToPath(new URL("../ops/aws-sandbox/scripts/Invoke-ReviewedGeneration6ReadControl.ps1", import.meta.url));
  const script = await readFile(wrapper, "utf8"); assert.match(script, /Mandatory, ParameterSetName = 'Execute'/); assert.doesNotMatch(script, /Approved(?:Manifest|Grant|Reads|Revoke)Sha\s*=/);
  await temp(async root => { const evidence = path.join(root, "evidence.json"), review = path.join(root, "legacy.json"),
    proof = path.join(root, "retired.json"), execution = path.join(root, "execution.json"), output = path.join(root, "never.json");
    await writeFile(evidence, "{}"); await writeFile(proof, JSON.stringify({ outcome: "RETIRED_LOCKED_VERIFIED" }));
    await writeFile(review, JSON.stringify({ stage: "B5-J5g-j20", action: "REVIEW" })); await writeFile(execution, "{}");
    const result = spawnSync("C:/Program Files/PowerShell/7/pwsh.exe", ["-NoProfile", "-File", wrapper, "-Evidence", evidence, "-RetirementProof", proof,
      "-CreationReview", review, "-ExecutionReview", execution, "-Output", output, "-ApprovedManifestSha", controlProof,
      "-ApprovedGrantSha", controlProof, "-ApprovedReadsSha", controlProof, "-ApprovedRevokeSha", controlProof], { encoding: "utf8", timeout: 30_000 });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /own exact creation review/);
    assert.deepEqual((await readdir(root)).sort(), ["evidence.json", "execution.json", "legacy.json", "retired.json"]); });
});
