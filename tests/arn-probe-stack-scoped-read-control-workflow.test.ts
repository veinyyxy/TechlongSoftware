import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ARN_PROBE_EXECUTION_ROLE } from "../lib/deployments/execution/arn-compatibility-probe-fixture.ts";
import { compileStackControlActions } from "../lib/deployments/execution/arn-probe-stack-scoped-read-control-actions.ts";
import { stackControlHistory } from "../lib/deployments/execution/arn-probe-stack-scoped-read-control-create.ts";
import { createStackControlFsSlot } from "../lib/deployments/execution/arn-probe-stack-scoped-read-control-slot.ts";
import { assertStackControlWorkflow, compileStackControlWorkflow, assertStackControlManagement, runStackControlWorkflow,
  recoverStackControlRevoke, inspectStackControlWorkflow } from "../lib/deployments/execution/arn-probe-stack-scoped-read-control-workflow.ts";
import { AwsSdkStackControlWorkflowReadAdapter, AwsSdkStackControlWorkflowWriteAdapter, AwsSdkStackControlOperatorReadAdapter } from "../lib/deployments/execution/aws-sdk-arn-probe-stack-scoped-read-control-workflow.ts";
import { stackControlWorkflowFixture, controlArn, controlProof, controlUuid } from "./fixtures/arn-probe-stack-scoped-read-control-workflow.ts";
import { signed } from "./fixtures/arn-probe-stack-scoped-read-control.ts";

class Command { input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
class List extends Command {} class Describe extends Command {} class Template extends Command {} class Stack extends Command {} class Create extends Command {} class Execute extends Command {}
const signal = () => new AbortController().signal;
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };
const mutable = <T>(value: T): Mutable<T> => structuredClone(value) as Mutable<T>;
type Fixture = Awaited<ReturnType<typeof stackControlWorkflowFixture>>;
function recoveryApproval(f: Fixture) { return { ...f.approval, approvedGrantSha256: "", approvedReadsSha256: "", executionPhrase: "I_CONFIRM_J5GJ22_REVOKE_ONLY" }; }
function sdkReads(f: Fixture, send: (c: Command) => Promise<Record<string, unknown>>, pause?: (s: AbortSignal) => Promise<void>) {
  return new AwsSdkStackControlWorkflowReadAdapter({ client: { send: c => send(c as Command) }, commands: { listChangeSets: List, describeChangeSet: Describe,
    getTemplate: Template, describeStacks: Stack }, readManagement: f.reads.readManagement, creation: f.reads.creation, pause }, f.now);
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
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "techlong-j22c-test-")));
  try { await run(root); } finally { const resolved = await realpath(root), base = await realpath(os.tmpdir());
    assert.equal(path.dirname(resolved), base); assert.match(path.basename(resolved), /^techlong-j22c-test-/); await rm(resolved, { recursive: true, force: true }); }
}

test("J22C execution review binds fresh full Source, never executes pure B actions or rehashed drift", async () => {
  const f = await stackControlWorkflowFixture(), m = f.manifest; await assertStackControlWorkflow(m);
  assert.equal(m.installationToolsImplemented, true); assert.equal(m.executionApproved, false); assert.equal(m.grantInstallationApproved, false);
  const { sourceObservation: ignored, ...base } = m.input; void ignored;
  const future = await compileStackControlActions(base); await assert.rejects(assertStackControlWorkflow(future as unknown as typeof m));
  for (const change of ["source", "scope", "window"] as const) {
    const bad = mutable(m);
    if (change === "source") bad.input.sourceObservation.managementBefore.callerArn = "arn:aws:iam::402010193138:root" as typeof bad.input.sourceObservation.managementBefore.callerArn;
    if (change === "scope") bad.actions.operatorReads.cases[0].request.ChangeSetName = "foreign";
    if (change === "window") bad.input.expiresAt = new Date(Date.parse(bad.input.reviewedAt) + 300_001).toISOString();
    await assert.rejects(assertStackControlWorkflow(await signed(bad, "manifestSha256")));
  }
  await assert.rejects(compileStackControlWorkflow({ ...m.input, sourceObservation: { ...m.input.sourceObservation,
    managementBefore: { ...m.input.sourceObservation.managementBefore, observedAt: new Date(Date.parse(m.input.reviewedAt) - 61_000).toISOString() } } }));
  assert.deepEqual(f.events, []);
});

test("J22C two independent Describe cases bracket Source, immediately Revoke, and inspect advanced Locked v9", async () => {
  const f = await stackControlWorkflowFixture(), receipt = await runStackControlWorkflow(f);
  assert.equal(receipt.outcome, "LOCKED_STACK_READ_CONTROL_RECORDED"); assert.equal(receipt.results.length, 2); assert.equal(receipt.sourceReadBrackets.length, 2);
  assert.equal(receipt.cleanup?.evidence.last.policies.find(p => p.logicalId === "CellOperatorBoundary")?.defaultVersionId, "v9");
  assert.equal(receipt.productionCompatibilityVerified, false); assert.equal(receipt.runtimeEnabled, false); assert.equal(receipt.probeDeleted, false); assert.equal(receipt.childExecuted, false);
  assert.deepEqual(f.events.filter(v => v.startsWith("submit-")), ["submit-grant", "submit-revoke-create", "submit-revoke-execute"]);
  const inspect = await inspectStackControlWorkflow(f); assert.equal(inspect.outcome, "LOCKED_VERIFIED"); assert.equal(inspect.mutationPerformed, false);
  const before = [...f.events]; await assert.rejects(runStackControlWorkflow(f)); assert.deepEqual(f.events, before);
  const read = f.reads.readWorkflowInventory; f.reads.readWorkflowInventory = async (...args) => ({ ...await read(...args), stackId: "foreign" });
  await assert.rejects(inspectStackControlWorkflow(f)); assert.deepEqual(f.events, before);
});

test("J22C two authorized denials are distinct evidence; uncertain first read never retries", async () => {
  const denied = await stackControlWorkflowFixture(); denied.operatorReads.readCase = async (_m, style) => denied.deny(style);
  const result = await runStackControlWorkflow(denied); assert.equal(result.outcome, "LOCKED_STACK_READ_CONTROL_RECORDED");
  assert.deepEqual(result.results.map(r => r.outcome), ["READ_DENIED", "READ_DENIED"]); assert.notEqual(result.results[0].requestId, result.results[1].requestId);
  const uncertain = await stackControlWorkflowFixture(); uncertain.operatorReads.readCase = async (_m, style) => uncertain.deny(style, true);
  const unknown = await runStackControlWorkflow(uncertain); assert.equal(unknown.results.length, 1); assert.equal(unknown.results[0].outcome, "READ_UNCERTAIN");
  assert.ok(unknown.cleanup); assert.equal(uncertain.intents.has("read-exact-name"), false);
});

test("J22C lost Grant and Revoke responses reconcile read-only, with each mutation submitted once", async () => {
  const f = await stackControlWorkflowFixture();
  const lose = <R>(original: (r: R, s: AbortSignal) => Promise<unknown>) => async (r: R, s: AbortSignal) => {
    await original(r, s); throw new Error("PRIVATE_MFA_AND_PROVIDER_TEXT_NEVER_SAVE"); };
  f.writes.executeGrant = lose(f.writes.executeGrant); f.writes.createRevoke = lose(f.writes.createRevoke); f.writes.executeRevoke = lose(f.writes.executeRevoke);
  const result = await runStackControlWorkflow(f); assert.equal(result.outcome, "LOCKED_STACK_READ_CONTROL_RECORDED"); assert.equal(result.failures.length, 3);
  assert.deepEqual(f.events.filter(v => v.startsWith("submit-")), ["submit-grant", "submit-revoke-create", "submit-revoke-execute"]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_MFA_AND_PROVIDER_TEXT/); assert.ok(f.events.indexOf("settle-grant") > f.events.indexOf("submit-grant"));
});

test("J22C cancellation and read-window expiry cannot cancel the independent cleanup signal", async () => {
  for (const kind of ["cancel", "expire"] as const) {
    const f = await stackControlWorkflowFixture(), original = f.operatorReads.readCase;
    f.operatorReads.readCase = async (...args) => { const result = await original(...args); if (kind === "cancel") f.abort.abort(); else f.setTime(Date.parse(f.manifest.input.expiresAt)); return result; };
    const create = f.writes.createRevoke, execute = f.writes.executeRevoke;
    f.writes.createRevoke = async (r, s) => { assert.equal(s.aborted, false); assert.notEqual(s, f.signal); return create(r, s); };
    f.writes.executeRevoke = async (r, s) => { assert.equal(s.aborted, false); assert.notEqual(s, f.signal); return execute(r, s); };
    const result = await runStackControlWorkflow(f); assert.ok(result.cleanup); assert.equal(result.results.length, kind === "cancel" ? 1 : 0); assert.equal(f.intents.has("read-exact-name"), false);
  }
});

test("J22C mismatched approvals, consumed slots, expired clocks and foreign fixed identity reject before Grant", async () => {
  const f = await stackControlWorkflowFixture();
  for (const key of ["approvedManifestSha256", "approvedGrantSha256", "approvedReadsSha256", "approvedRevokeSha256"] as const)
    await assert.rejects(runStackControlWorkflow({ ...f, approval: { ...f.approval, [key]: "a".repeat(64) } }));
  assert.deepEqual(f.events, []); f.setTime(Date.parse(f.manifest.input.expiresAt)); await assert.rejects(runStackControlWorkflow(f)); assert.deepEqual(f.events, []);
  f.setTime(Date.parse(f.manifest.input.reviewedAt) + 1000);
  f.intents.set("run", { request: f.manifest.actions }); await assert.rejects(runStackControlWorkflow(f)); assert.deepEqual(f.events, []); f.intents.clear();
  f.writes.prepareOperator = async () => { f.events.push("foreign-identity"); return { callerArn: "arn:aws:iam::402010193138:root", account: "402010193138", expiresAt: new Date(f.now() + 900_000).toISOString() }; };
  await assert.rejects(runStackControlWorkflow(f)); assert.deepEqual(f.events, ["foreign-identity"]); assert.equal(f.intents.size, 0);
});

test("J22C fresh preflight cannot hide history, fixture drift, or stale management", async () => {
  for (const mode of ["inventory", "fixture", "stale"] as const) {
    const f = await stackControlWorkflowFixture(), creation = f.reads.creation;
    if (mode === "inventory") { const read = creation.readInventory; creation.readInventory = async (...a) => { const r = await read(...a); return { ...r, knownTerminal: [] }; }; }
    if (mode === "fixture") { const read = creation.readFixtureInventory; creation.readFixtureInventory = async (...a) => ({ ...await read(...a), count: 2 as 1 }); }
    if (mode === "stale") { const read = creation.readManagement; creation.readManagement = async (...a) => ({ ...await read(...a), observedAt: new Date(f.now() - 61_000).toISOString() }); }
    await assert.rejects(runStackControlWorkflow(f)); assert.deepEqual(f.events, []); assert.equal(f.intents.size, 0);
  }
});

test("J22C expired revoke-only recovery preserves intents and cannot replay Grant or Operator", async () => {
  const f = await stackControlWorkflowFixture(), execute = f.writes.executeRevoke;
  f.writes.executeRevoke = async () => { f.events.push("lost-revoke-without-effect"); throw new Error("lost response"); };
  const result = await runStackControlWorkflow(f); assert.equal(result.outcome, "REVOKE_REQUIRED"); assert.equal(f.intents.has("revoke-execute"), true);
  f.setTime(Date.parse(f.manifest.input.expiresAt) + 1000); f.writes.executeRevoke = execute;
  const before = [...f.events]; const recovered = await recoverStackControlRevoke({ ...f, approval: recoveryApproval(f) });
  assert.equal(recovered.outcome, "REVOKE_REQUIRED"); assert.deepEqual(f.events, before); // Existing execute intent is never resubmitted.
  f.setInstalled(false); const inspectOnly = await recoverStackControlRevoke({ ...f, approval: recoveryApproval(f) });
  assert.equal(inspectOnly.outcome, "LOCKED_VERIFIED"); assert.deepEqual(f.events, before);
  const fresh = await stackControlWorkflowFixture(); await assert.rejects(recoverStackControlRevoke({ ...fresh, approval: recoveryApproval(fresh) })); assert.deepEqual(fresh.events, []);
});

test("J22C missing cleanup Create with consumed intent is never recreated; unclaimed Revoke is never adopted", async () => {
  for (const kind of ["lost-create", "unclaimed"] as const) {
    const f = await stackControlWorkflowFixture();
    if (kind === "lost-create") f.writes.createRevoke = async () => { f.events.push("lost-create-no-effect"); throw new Error("uncertain"); };
    else f.setRevoke(true);
    const result = await runStackControlWorkflow(f); assert.equal(result.outcome, "REVOKE_REQUIRED");
    const before = [...f.events]; const recovery = await recoverStackControlRevoke({ ...f, approval: recoveryApproval(f) });
    assert.equal(recovery.outcome, "REVOKE_REQUIRED"); assert.deepEqual(f.events.filter(e => e !== "settle-grant"), before.filter(e => e !== "settle-grant")); assert.equal(f.events.includes("submit-revoke-execute"), false);
  }
});

test("J22C cleanup may be Locked while fixture reconciliation remains blocked; not a completed control", async () => {
  const f = await stackControlWorkflowFixture(), execute = f.writes.executeRevoke;
  f.writes.executeRevoke = async (...a) => { const r = await execute(...a); f.reads.readFixtureInventory = async () => { throw new Error("fixture uncertain"); }; return r; };
  const result = await runStackControlWorkflow(f); assert.equal(result.outcome, "LOCKED_RECONCILIATION_REQUIRED"); assert.equal(result.fixtureAfter, null); assert.ok(result.cleanup);
  await assert.rejects(inspectStackControlWorkflow(f));
});

test("J22C exact live IAM document permits intentional version advancement, never widened policies or trust", async () => {
  const f = await stackControlWorkflowFixture(), plan = f.creationReview.plan; f.setInstalled(true);
  const value = await f.reads.readManagement(plan, signal()); assert.equal(await assertStackControlManagement(plan, value, f.now()), false);
  for (const kind of ["policy", "role", "resources", "root"] as const) {
    const bad = mutable(value);
    if (kind === "policy") bad.policies[0].defaultDocumentSha256 = "a".repeat(64);
    if (kind === "role") bad.roles[0].trustPolicySha256 = "a".repeat(64);
    if (kind === "resources") bad.stack.resources = [];
    if (kind === "root") Object.assign(bad, { unreviewed: true });
    await assert.rejects(assertStackControlManagement(plan, bad, f.now()));
  }
});

test("J22C fixed FS journal binds full Source manifest and persists consumption without resets", async () => {
  const f = await stackControlWorkflowFixture(); await temp(async root => {
    const slot = await createStackControlFsSlot(root, f.creationReview.fence, f.predecessor);
    assert.equal(await slot.workflowIntentsPresent(), false); assert.deepEqual(await readdir(root), []);
    await slot.reserve(f.creationReview, f.claim.preflightEvidenceSha256, f.claim.reservedAt);
    const journal = await slot.workflowJournal(f.manifest);
    await journal.reserve("run", f.manifest.actions, new Date(f.now()).toISOString());
    assert.equal(await slot.workflowIntentsPresent(), true); assert.equal((await journal.load("run"))?.manifestSha256, f.manifest.manifestSha256);
    await assert.rejects(journal.reserve("run", f.manifest.actions, new Date(f.now()).toISOString()));
    await assert.rejects(journal.reserve("read-full-arn", f.manifest.actions.operatorReads.cases[0].request, new Date(f.now()).toISOString()));
    const { sourceObservation: ignored, ...base } = f.manifest.input; void ignored;
    await assert.rejects(slot.workflowJournal(await compileStackControlActions(base)));
  });
});

test("J22C SDK Grant settlement never discharges cleanup using early stale Locked", async () => {
  const f = await stackControlWorkflowFixture(); let polls = 0, collected = 0;
  const read = f.reads.readManagement; f.reads.readManagement = async (...a) => { collected++; return read(...a); };
  const adapter = sdkReads(f, async c => {
    if (c instanceof Describe) { polls++; return providerReply(f.creationReview.plan.request, f.manifest.input.grantChangeSetArn, polls < 3 ? "AVAILABLE" : "EXECUTE_COMPLETE"); }
    assert.ok(c instanceof Stack); return { Stacks: [{ StackId: f.creationReview.plan.request.StackName, StackName: "techlong-s3-b5-cell-lifecycle-management",
      StackStatus: "UPDATE_COMPLETE", EnableTerminationProtection: false }] };
  }, async () => { assert.equal(collected, 0); });
  await adapter.waitGrantSettlement(f.manifest, signal()); assert.equal(polls, 3); assert.equal(collected, 1);
});

test("J22C SDK Source writes have exact full ARN and one-shot/revoke-only capability", async () => {
  const f = await stackControlWorkflowFixture(), calls: Command[] = [];
  const sdk = { source: { send: async (c: unknown) => { calls.push(c as Command); return { $metadata: { requestId: controlUuid } }; } },
    createChangeSet: Create, executeChangeSet: Execute, grantCapabilityEnabled: true };
  const adapter = new AwsSdkStackControlWorkflowWriteAdapter(f.manifest, sdk, f.now), request = f.manifest.actions.grantExecute.request;
  await assert.rejects(adapter.executeGrant({ ...request, ChangeSetName: "short-name" }, signal())); assert.equal(calls.length, 0);
  await adapter.executeGrant(request, signal()); await assert.rejects(adapter.executeGrant(request, signal())); assert.deepEqual(calls[0].input, request);
  const only = new AwsSdkStackControlWorkflowWriteAdapter(f.manifest, { ...sdk, grantCapabilityEnabled: false }, f.now);
  assert.throws(() => only.executeGrant(request, signal())); await only.createRevoke(f.manifest.actions.revoke.createRequest, signal());
  const revoke = { StackName: request.StackName, ChangeSetName: controlArn(f.manifest.actions.revoke.createRequest.ChangeSetName), ClientRequestToken: f.manifest.actions.revoke.executeClientToken, DisableRollback: false as const };
  await only.executeRevoke(revoke, signal()); await assert.rejects(only.executeRevoke(revoke, signal())); assert.equal(calls.length, 3);
  f.setTime(Date.parse(f.manifest.input.expiresAt)); const expired = new AwsSdkStackControlWorkflowWriteAdapter(f.manifest, sdk, f.now);
  await assert.rejects(expired.executeGrant(request, signal())); assert.equal(calls.length, 3);
});

test("J22C SDK complete inventory checks retained/current terminal objects, rejects foreign/paginated/drift", async () => {
  const f = await stackControlWorkflowFixture(), plan = f.creationReview.plan, history = stackControlHistory(f.predecessor);
  const records = [...history.map(h => ({ request: h.request, arn: h.arn, exec: "EXECUTE_COMPLETE" })),
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

test("J22C SDK Operator submits one Describe per style, validates fixture and sanitizes denial", async () => {
  const f = await stackControlWorkflowFixture(), prior = f.predecessor.input.creationReview.plan.input.comparisonPlan.input.priorPlan;
  const calls: Command[] = []; let deny = false;
  const adapter = new AwsSdkStackControlOperatorReadAdapter({ verifyIdentity: f.writes.prepareOperator, describeChangeSet: Describe, operator: { send: async c => {
    calls.push(c as Command); if (deny) throw Object.assign(new Error("RAW_SECRET_MUST_NOT_SERIALIZE"), { name: "AccessDenied", $metadata: { requestId: controlUuid, httpStatusCode: 403 } });
    return { StackId: prior.input.fixtureStackId, StackName: "techlong-sandbox-arn-compatibility-probe", ChangeSetId: prior.input.fixtureChangeSetArn,
      ChangeSetName: prior.input.fixturePlan.request.ChangeSetName, RoleARN: ARN_PROBE_EXECUTION_ROLE, Description: prior.input.fixturePlan.request.Description,
      OnStackFailure: "DELETE", Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", Tags: prior.input.fixturePlan.request.Tags,
      Changes: [{ Type: "Resource", ResourceChange: { Action: "Add", LogicalResourceId: "ProbeHandle", ResourceType: "AWS::CloudFormation::WaitConditionHandle" } }],
      $metadata: { requestId: controlUuid, httpStatusCode: 200 } }; } } }, f.now);
  const success = await adapter.readCase(f.manifest, "FULL_ARN_REQUEST", signal()); assert.equal(success.outcome, "READ_SUCCEEDED");
  deny = true; const denial = await adapter.readCase(f.manifest, "EXACT_NAME_REQUEST", signal()); assert.equal(denial.outcome, "READ_DENIED");
  assert.doesNotMatch(JSON.stringify(denial), /RAW_SECRET/); await assert.rejects(adapter.readCase(f.manifest, "FULL_ARN_REQUEST", signal()));
  assert.equal(calls.length, 2); assert.ok(calls.every(c => c instanceof Describe)); assert.deepEqual(calls.map(c => c.input), f.manifest.actions.operatorReads.cases.map(c => c.request));
});

test("J22C CLI and local PowerShell wrapper reject missing approvals and legacy review without clients", async () => {
  const entry = fileURLToPath(new URL("../ops/aws-sandbox/scripts/s3-b5-arn-probe-stack-scoped-read-control-workflow.ts", import.meta.url));
  for (const args of [["--mode", "RunReviewed"], ["--mode", "Inspect", "--mode", "Review"], ["--mode", "Unsupported"], ["--reset-slot"]]) {
    const child = spawnSync(process.execPath, ["--experimental-strip-types", entry, ...args], { encoding: "utf8", timeout: 30_000 });
    assert.notEqual(child.status, 0); assert.doesNotMatch(child.stdout, /Enter MFA|LOCKED_VERIFIED/);
  }
  const wrapper = fileURLToPath(new URL("../ops/aws-sandbox/scripts/Invoke-ReviewedStackScopedReadControl.ps1", import.meta.url));
  const script = await readFile(wrapper, "utf8"); assert.match(script, /Mandatory, ParameterSetName = 'Execute'/); assert.doesNotMatch(script, /Approved(?:Manifest|Grant|Reads|Revoke)Sha\s*=/);
  await temp(async root => { const evidence = path.join(root, "evidence.json"), review = path.join(root, "legacy.json"), output = path.join(root, "never.json");
    await writeFile(evidence, "{}"); await writeFile(review, JSON.stringify({ stage: "B5-J5g-j20", action: "REVIEW" }));
    const result = spawnSync("C:/Program Files/PowerShell/7/pwsh.exe", ["-NoProfile", "-File", wrapper, "-Evidence", evidence, "-CreationReview", review,
      "-Output", output, "-ApprovedCreationReviewSha", controlProof], { encoding: "utf8", timeout: 30_000 });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /own exact creation review/); assert.deepEqual((await readdir(root)).sort(), ["evidence.json", "legacy.json"]); });
});
