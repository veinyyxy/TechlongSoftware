import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { compileArnProbeFixturePlan, ARN_PROBE_FIXTURE_STACK } from "../lib/deployments/execution/arn-compatibility-probe-fixture.ts";
import { compileArnProbeGrantPlan, type ArnProbeGrantPlan } from "../lib/deployments/execution/arn-compatibility-probe-grant.ts";
import { compileArnProbeWorkflowManifest, assertArnProbeWorkflowManifest, reviewArnProbeWorkflow, inspectArnProbeWorkflow, runArnProbeWorkflow, recoverArnProbeWorkflowRevoke,
  ARN_PROBE_OPERATOR_CALLER, type ArnProbeWorkflowManifest, type ArnProbeWorkflowReads, type ArnProbeWorkflowWrites, type ArnProbeWorkflowJournal,
  type ProbeStep, type ArnProbeWorkflowApproval } from "../lib/deployments/execution/arn-compatibility-probe-workflow.ts";
import { AwsSdkArnProbeWorkflowReadAdapter, AwsSdkArnProbeWorkflowWriteAdapter, createArnProbeOperatorSession } from "../lib/deployments/execution/aws-sdk-arn-compatibility-probe-workflow.ts";
import type { ArnProbeManagementObservation } from "../lib/deployments/execution/aws-sdk-shared-cell-author-compensation-management.ts";

const time = Date.parse("2026-10-03T17:00:00.000Z"), now = () => time, observedAt = new Date(time).toISOString();
const signal = () => new AbortController().signal;
async function material() {
  const fixturePlan = await compileArnProbeFixturePlan({ nonce: "a".repeat(32), reviewedAt: "2026-10-03T15:00:00.000Z", expiresAt: "2026-10-03T16:00:00.000Z" });
  const plan = await compileArnProbeGrantPlan({ fixturePlan, fixtureStackId: `arn:aws:cloudformation:ca-central-1:402010193138:stack/${ARN_PROBE_FIXTURE_STACK}/11111111-2222-4333-8444-555555555555`,
    fixtureChangeSetArn: `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${fixturePlan.request.ChangeSetName}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`,
    nonce: "b".repeat(32), reviewedAt: observedAt, expiresAt: "2026-10-03T18:00:00.000Z" });
  const grantChangeSetArn = `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${plan.request.ChangeSetName}/aaaaaaaa-2222-4333-8444-bbbbbbbbbbbb`;
  const manifest = await compileArnProbeWorkflowManifest({ plan, grantChangeSetArn, reviewedAt: observedAt, expiresAt: "2026-10-03T17:05:00.000Z" });
  return { plan, manifest };
}
function approval(m: ArnProbeWorkflowManifest, revokeOnly = false): ArnProbeWorkflowApproval {
  return { approvedManifestSha256: m.manifestSha256, approvedGrantExecuteSha256: m.actionSha256.grantExecute, approvedProbeDeleteSha256: m.actionSha256.probeDelete,
    approvedRevokeSha256: m.actionSha256.revoke, acknowledgeAwsWrite: true, acknowledgeLowCostNotZero: true,
    executionPhrase: revokeOnly ? "I_CONFIRM_J5GJ11_REVOKE_ONLY" : "I_CONFIRM_J5GJ11_GRANT_EXACT_PROBE_AND_IMMEDIATE_REVOKE" };
}
function full(plan: ArnProbeGrantPlan, granted: boolean, at = observedAt): ArnProbeManagementObservation {
  return { schemaVersion: 1, accountId: "402010193138", region: "ca-central-1", callerArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev",
    rendererShape: granted ? "ArnProbeDeleteChangeSetGrant" : "Locked", cellStackState: "MISSING", authorityState: "ABSENT", observedAt: at, policies: [], roles: [],
    stack: { name: "techlong-s3-b5-cell-lifecycle-management", id: plan.managementStackId, status: "UPDATE_COMPLETE", roleArn: null, parentId: null, rootId: null, terminationProtection: false,
      templateRawSha256: granted ? plan.grantTemplateRawSha256 : plan.revokeTarget.templateRawSha256,
      templateCanonicalSha256: granted ? plan.grantTemplateCanonicalSha256 : plan.revokeTarget.templateCanonicalSha256, safetyState: granted ? "PROBE" : "LOCKED", resources: [] } };
}
function fake(m: ArnProbeWorkflowManifest) {
  const plan = m.input.plan, events: string[] = [], intents = new Map<ProbeStep, Readonly<Record<string, unknown>>>();
  let granted = false, deleted = false, revokeCreated = false, at = observedAt;
  const revokeArn = `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${m.actions.revoke.createRequest.ChangeSetName}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`;
  const ready = () => ({ state: "READY_UNEXECUTED" as const, stackId: plan.input.fixtureStackId, changeSetArn: plan.input.fixtureChangeSetArn, resourceCount: 0 as const, templateCanonicalSha256: plan.input.fixturePlan.templateCanonicalSha256, observedAt: at });
  const reads: ArnProbeWorkflowReads = {
    readManagement: async () => { events.push("management-read"); return full(plan, granted, at); },
    waitManagement: async () => { events.push("management-wait"); return full(plan, granted, at); },
    waitGrantSettlement: async () => { events.push("grant-settlement"); return full(plan, granted, at); },
    readFixture: async () => ready(),
    readGrant: async () => ({ state: "READY_UNEXECUTED", stackId: plan.managementStackId, changeSetArn: m.input.grantChangeSetArn,
      templateCanonicalSha256: plan.grantTemplateCanonicalSha256, providerEvidenceSha256: "d".repeat(64), observedAt: at }),
    readProbeAfter: async () => { events.push("post-read"); return { state: deleted ? "CHANGE_SET_ABSENT" : "READY_UNEXECUTED", stackId: plan.input.fixtureStackId, changeSetArn: plan.input.fixtureChangeSetArn,
      stackState: "REVIEW_IN_PROGRESS", resourceCount: 0, providerEvidenceSha256: "e".repeat(64), observedAt: at }; },
    readRevoke: async () => revokeCreated ? { state: "READY_UNEXECUTED", stackId: plan.managementStackId, changeSetArn: revokeArn, providerEvidenceSha256: "f".repeat(64), observedAt: at } : { state: "MISSING", observedAt: at },
    waitRevoke: async (_manifest, s) => reads.readRevoke(m, s),
  };
  const reply = { $metadata: { requestId: "unit-only" } };
  const writes: ArnProbeWorkflowWrites = {
    prepareOperator: async () => ({ callerArn: ARN_PROBE_OPERATOR_CALLER, account: "402010193138", expiresAt: "2026-10-03T17:15:00.000Z" }),
    executeGrant: async (request) => { events.push("grant"); assert.deepEqual(request, m.actions.grantExecute.request); granted = true; return reply; },
    deleteProbe: async (request) => { events.push("probe"); assert.deepEqual(request, plan.futureProbeRequest); deleted = true; return reply; },
    createRevoke: async (request) => { events.push("revoke-create"); assert.deepEqual(request, m.actions.revoke.createRequest); revokeCreated = true; return { ...reply, StackId: plan.managementStackId, Id: revokeArn }; },
    executeRevoke: async (request) => { events.push("revoke-execute"); assert.equal(request.ChangeSetName, revokeArn); assert.equal(request.DisableRollback, false); granted = false; return reply; },
  };
  const journal: ArnProbeWorkflowJournal = { load: async (step) => intents.get(step) ?? null,
    reserve: async (step, intent) => { if (intents.has(step)) throw new Error("Intent exists"); intents.set(step, intent); events.push(`intent:${step}`); } };
  return { reads, writes, journal, events, intents, setGranted: (value: boolean) => { granted = value; }, setTime: (value: string) => { at = value; } };
}
test("J11 manifests separately bind all three exact approval scopes and never enable production gates", async () => {
  const { manifest: m } = await material(); await assertArnProbeWorkflowManifest(m);
  assert.notEqual(m.actionSha256.grantExecute, m.actionSha256.probeDelete); assert.notEqual(m.actionSha256.probeDelete, m.actionSha256.revoke);
  assert.equal(m.actions.grantExecute.request.DisableRollback, false); assert.equal(m.actions.revoke.recoveryAfterExpiryAllowed, true);
  assert.equal(m.childExecutionAllowed, false); assert.equal(m.deleteStackAllowed, false); assert.deepEqual(m.readinessGates, [false, false, false, false]);
  await assert.rejects(assertArnProbeWorkflowManifest({ ...m, productionCompatibilityVerified: true } as unknown as ArnProbeWorkflowManifest));
  await assert.rejects(compileArnProbeWorkflowManifest({ ...m.input, grantChangeSetArn: m.input.plan.input.fixtureChangeSetArn }));
  await assert.rejects(compileArnProbeWorkflowManifest({ ...m.input, expiresAt: "2026-10-03T17:46:00.000Z" }));
});
test("J11 real-read review blocks on missing Grant rather than fabricating an execution ARN", async () => {
  const { plan, manifest } = await material(), f = fake(manifest);
  const blocked = await reviewArnProbeWorkflow(plan, { ...f.reads, readGrant: async () => ({ state: "MISSING", proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY", observedAt }) }, signal(), now);
  assert.equal(blocked.outcome, "PREPARE_GRANT_REQUIRED"); assert.equal(blocked.manifest, null); assert.equal(blocked.executionReady, false);
  const ready = await reviewArnProbeWorkflow(plan, f.reads, signal(), now);
  assert.equal(ready.executionReady, true); assert.equal(ready.manifest?.input.grantChangeSetArn, manifest.input.grantChangeSetArn); assert.equal(f.intents.size, 0);
});
test("J11 approval, expiry, preflight and cancellation failures make zero AWS writes", async () => {
  const { manifest: m } = await material();
  for (const patch of [{ approvedManifestSha256: "0".repeat(64) }, { approvedGrantExecuteSha256: "0".repeat(64) }, { approvedProbeDeleteSha256: "0".repeat(64) }, { approvedRevokeSha256: "0".repeat(64) }, { acknowledgeLowCostNotZero: false }, { executionPhrase: "CREATE_ONLY" }]) {
    const f = fake(m); await assert.rejects(runArnProbeWorkflow({ manifest: m, approval: { ...approval(m), ...patch }, ...f, signal: signal(), now })); assert.equal(f.intents.size, 0);
  }
  const f = fake(m); await assert.rejects(runArnProbeWorkflow({ manifest: m, approval: approval(m), ...f, signal: signal(), now: () => time + 300_000 })); assert.equal(f.intents.size, 0);
  await assert.rejects(runArnProbeWorkflow({ manifest: m, approval: approval(m), ...f, signal: AbortSignal.abort(), now })); assert.equal(f.intents.size, 0);
  f.setGranted(true); await assert.rejects(runArnProbeWorkflow({ manifest: m, approval: approval(m), ...f, signal: signal(), now })); assert.equal(f.intents.size, 0);
});
test("J11 normal order is one Grant, one exact probe, immediate revoke, then independent evidence", async () => {
  const { manifest: m } = await material(), f = fake(m);
  const receipt = await runArnProbeWorkflow({ manifest: m, approval: approval(m), ...f, signal: signal(), now });
  assert.equal(receipt.outcome, "ISOLATED_PROBE_SUCCEEDED_LOCKED"); assert.equal(receipt.productionCompatibilityVerified, false);
  assert.deepEqual(f.events.filter((item) => ["grant", "probe", "revoke-create", "revoke-execute", "post-read"].includes(item)), ["grant", "probe", "revoke-create", "revoke-execute", "post-read"]);
  assert.equal(f.intents.size, 5); assert.ok(receipt.cleanup?.evidence.first); assert.ok(receipt.cleanup?.evidence.last);
  await assert.rejects(runArnProbeWorkflow({ manifest: m, approval: approval(m), ...f, signal: signal(), now })); assert.equal(f.events.filter((item) => item === "grant").length, 1);
});
test("J11 lost Grant response is reconciled, never replayed; denied or lost probe still revokes", async () => {
  const { manifest: m } = await material();
  for (const failure of ["grant", "probe"]) {
    const f = fake(m), execute = f.writes.executeGrant, deletion = f.writes.deleteProbe;
    if (failure === "grant") f.writes.executeGrant = async (...args) => { await execute(...args); throw new Error("SECRET lost reply"); };
    else f.writes.deleteProbe = async (...args) => { await deletion(...args); throw new Error("SECRET provider AccessDenied"); };
    const receipt = await runArnProbeWorkflow({ manifest: m, approval: approval(m), ...f, signal: signal(), now });
    assert.ok(receipt.cleanup); assert.equal(f.events.filter((item) => item === failure).length, 1); assert.doesNotMatch(JSON.stringify(receipt), /SECRET/);
    assert.equal(receipt.isolatedProbeCompatibilityObserved, failure === "grant");
  }
});
test("J11 caller cancellation after Grant cannot cancel mandatory cleanup or permit probe", async () => {
  const { manifest: m } = await material(), f = fake(m), cancel = new AbortController(), execute = f.writes.executeGrant;
  f.writes.executeGrant = async (...args) => { const reply = await execute(...args); cancel.abort(); return reply; };
  const receipt = await runArnProbeWorkflow({ manifest: m, approval: approval(m), ...f, signal: cancel.signal, now });
  assert.equal(receipt.outcome, "LOCKED_PROBE_NOT_PROVED"); assert.equal(f.events.includes("probe"), false); assert.equal(f.events.includes("revoke-execute"), true);
});
test("J11 MFA pause is followed by fresh Source preflight; cancellation after intent but before delegation makes zero writes", async () => {
  const { manifest: m } = await material(), f = fake(m), prepare = f.writes.prepareOperator;
  f.writes.prepareOperator = async (...args) => { const identity = await prepare(...args); f.setGranted(true); return identity; };
  await assert.rejects(runArnProbeWorkflow({ manifest: m, approval: approval(m), ...f, signal: signal(), now })); assert.equal(f.intents.size, 0);
  const g = fake(m), cancel = new AbortController(), reserve = g.journal.reserve;
  g.journal.reserve = async (...args) => { await reserve(...args); if (args[0] === "grant-execute") cancel.abort(); };
  const result = await runArnProbeWorkflow({ manifest: m, approval: approval(m), ...g, signal: cancel.signal, now });
  assert.equal(result.grantAttempted, false); assert.equal(result.outcome, "NO_GRANT_SUBMITTED"); assert.equal(g.events.includes("grant"), false);
});
test("J11 an early Locked read cannot discharge an unsettled Grant", async () => {
  const { manifest: m } = await material(), f = fake(m);
  f.writes.executeGrant = async () => { f.events.push("grant"); throw new Error("lost"); };
  f.reads.waitGrantSettlement = async () => { throw new Error("AVAILABLE, outcome uncertain"); };
  const receipt = await runArnProbeWorkflow({ manifest: m, approval: approval(m), ...f, signal: signal(), now });
  assert.equal(receipt.outcome, "REVOKE_REQUIRED"); assert.equal(receipt.cleanup, null); assert.equal(f.events.includes("probe"), false);
});
test("J11 uncertain Revoke Create is independently recovered without duplicate creation", async () => {
  const { manifest: m } = await material(), f = fake(m), create = f.writes.createRevoke;
  f.writes.createRevoke = async (...args) => { await create(...args); throw new Error("lost"); };
  const receipt = await runArnProbeWorkflow({ manifest: m, approval: approval(m), ...f, signal: signal(), now });
  assert.ok(receipt.cleanup); assert.equal(f.events.filter((item) => item === "revoke-create").length, 1);
});
test("J11 failed revoke reports required action; expired revoke-only recovery never replays Grant/Probe", async () => {
  const { manifest: m } = await material(), f = fake(m), execute = f.writes.executeRevoke;
  f.writes.executeRevoke = async () => { f.events.push("revoke-execute-failed"); throw new Error("denied"); };
  const failed = await runArnProbeWorkflow({ manifest: m, approval: approval(m), ...f, signal: signal(), now }); assert.equal(failed.outcome, "REVOKE_REQUIRED");
  const later = time + 3_600_000; f.setTime(new Date(later).toISOString());
  const recovered = await recoverArnProbeWorkflowRevoke({ manifest: m, approval: approval(m, true), reads: f.reads, journal: f.journal,
    writes: { createRevoke: f.writes.createRevoke, executeRevoke: execute }, now: () => later });
  // Execute intent already exists: recovery may observe, never resubmit it.
  assert.equal(recovered.outcome, "REVOKE_REQUIRED"); assert.equal(f.events.filter((item) => item === "grant").length, 1); assert.equal(f.events.filter((item) => item === "probe").length, 1);
  f.setGranted(false);
  const locked = await recoverArnProbeWorkflowRevoke({ manifest: m, approval: approval(m, true), reads: f.reads, journal: f.journal, writes: { createRevoke: f.writes.createRevoke, executeRevoke: execute }, now: () => later });
  assert.equal(locked.outcome, "LOCKED_VERIFIED"); assert.equal(locked.grantReplayed, false); assert.equal(locked.probeReplayed, false);
});
test("J11 read-only inspection works after expiry and records active Grant without mutation", async () => {
  const { manifest: m } = await material(), f = fake(m); f.setGranted(true);
  const result = await inspectArnProbeWorkflow(m.input.plan, f.reads, signal(), now);
  assert.equal(result.outcome, "REVOKE_REQUIRED"); assert.equal(result.mutationPerformed, false); assert.equal(f.intents.size, 0);
});
test("J11 explicitly approved expired revoke-only recovery may create and execute Locked, with no Grant/Probe ports", async () => {
  const { manifest: m } = await material(), f = fake(m), later = time + 3_600_000;
  f.setGranted(true); f.setTime(new Date(later).toISOString());
  const receipt = await recoverArnProbeWorkflowRevoke({ manifest: m, approval: approval(m, true), reads: f.reads, journal: f.journal,
    writes: { createRevoke: f.writes.createRevoke, executeRevoke: f.writes.executeRevoke }, now: () => later });
  assert.equal(receipt.outcome, "LOCKED_VERIFIED"); assert.equal(f.events.includes("grant"), false); assert.equal(f.events.includes("probe"), false);
  assert.deepEqual([...f.intents.keys()], ["revoke-create", "revoke-execute"]);
});
test("J11 missing uncertain Revoke Create and drifted journal never trigger automatic replay", async () => {
  const { manifest: m } = await material(), f = fake(m); f.setGranted(true);
  const { sha256Hex, canonicalJson } = await import("../lib/deployments/execution/hash.ts");
  f.intents.set("revoke-create", { stage: "B5-J5g-j11", step: "revoke-create", operationSha256: m.operationSha256, manifestSha256: m.manifestSha256,
    requestSha256: await sha256Hex(canonicalJson(m.actions.revoke.createRequest)), reservedAt: observedAt });
  const receipt = await recoverArnProbeWorkflowRevoke({ manifest: m, approval: approval(m, true), reads: f.reads, journal: f.journal,
    writes: { createRevoke: f.writes.createRevoke, executeRevoke: f.writes.executeRevoke }, now });
  assert.equal(receipt.outcome, "REVOKE_REQUIRED"); assert.equal(f.events.includes("revoke-create"), false);
  f.intents.set("revoke-create", { ...f.intents.get("revoke-create"), manifestSha256: "0".repeat(64) });
  const drift = await recoverArnProbeWorkflowRevoke({ manifest: m, approval: approval(m, true), reads: f.reads, journal: f.journal,
    writes: { createRevoke: f.writes.createRevoke, executeRevoke: f.writes.executeRevoke }, now }); assert.equal(drift.outcome, "REVOKE_REQUIRED");
});

class Describe { input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
class Inventory extends Describe {} class Template extends Describe {} class Resources extends Describe {} class Changes extends Describe {}
function sdkReads(m: ArnProbeWorkflowManifest, send: (command: unknown) => Promise<Record<string, unknown>>) {
  return new AwsSdkArnProbeWorkflowReadAdapter({ client: { send }, commands: { describeStacks: Describe, listStackResources: Resources, getTemplate: Template, describeChangeSet: Changes, listChangeSets: Inventory },
    management: { readArnProbeManagementObservation: async () => full(m.input.plan, false) },
    fixture: { readFixture: (_plan, abort) => fake(m).reads.readFixture(m.input.plan, abort) }, grant: { readGrantChangeSet: fake(m).reads.readGrant } }, now);
}
test("J11 Source read rejects drift and failed management status, never treats arbitrary errors as pending", async () => {
  const { manifest: m } = await material();
  for (const status of ["DELETE_IN_PROGRESS", "UPDATE_ROLLBACK_FAILED", "CREATE_FAILED"]) {
    const port = sdkReads(m, async () => ({ Stacks: [{ StackId: m.input.plan.managementStackId, StackName: "techlong-s3-b5-cell-lifecycle-management", StackStatus: status, EnableTerminationProtection: false }] }));
    await assert.rejects(port.waitManagement(m.input.plan, signal()));
  }
  const port = sdkReads(m, async () => { throw new Error("AccessDenied"); }); await assert.rejects(port.waitManagement(m.input.plan, signal()));
});
test("J11 SDK settles terminal full Grant ARN, but an AVAILABLE Grant cannot be discharged by Locked", async () => {
  const { manifest: m } = await material();
  const response = { StackId: m.input.plan.managementStackId, ChangeSetId: m.input.grantChangeSetArn, ChangeSetName: m.input.plan.request.ChangeSetName, Description: m.input.plan.request.Description };
  const pending = sdkReads(m, async (command) => { assert.equal((command as Describe).input.ChangeSetName, m.input.grantChangeSetArn); return { ...response, ExecutionStatus: "AVAILABLE" }; });
  await assert.rejects(pending.waitGrantSettlement(m, AbortSignal.timeout(20)));
  const done = sdkReads(m, async (command) => command instanceof Changes ? { ...response, ExecutionStatus: "EXECUTE_COMPLETE" } :
    { Stacks: [{ StackId: m.input.plan.managementStackId, StackName: "techlong-s3-b5-cell-lifecycle-management", StackStatus: "UPDATE_ROLLBACK_COMPLETE", EnableTerminationProtection: false }] });
  assert.equal((await done.waitGrantSettlement(m, signal())).rendererShape, "Locked");
});
test("J11 SDK revoke review independently verifies full ARN, exact Locked and single non-replacement boundary change", async () => {
  const { manifest: m } = await material(), request = m.actions.revoke.createRequest;
  const arn = `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${request.ChangeSetName}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`;
  const details = { StackId: m.input.plan.managementStackId, StackName: "techlong-s3-b5-cell-lifecycle-management", ChangeSetId: arn, ChangeSetName: request.ChangeSetName,
    Description: request.Description, Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", Capabilities: ["CAPABILITY_NAMED_IAM"],
    Parameters: [{ ParameterKey: "ExpectedAccountId", ParameterValue: "402010193138" }, { ParameterKey: "ExpectedRegion", ParameterValue: "ca-central-1" }, { ParameterKey: "ManagementPrincipalArn", ParameterValue: m.input.plan.input.fixturePlan.sourceArn }],
    Changes: [{ Type: "Resource", ResourceChange: { Action: "Modify", LogicalResourceId: "CellOperatorBoundary", ResourceType: "AWS::IAM::ManagedPolicy", PhysicalResourceId: "arn:aws:iam::402010193138:policy/TechlongSandboxCellOperatorBoundary", Replacement: "False" } }] };
  const make = (patch: Record<string, unknown> = {}, template = request.TemplateBody) => sdkReads(m, async (command) => {
    const input = (command as Describe).input;
    if (command instanceof Inventory) return { Summaries: [{ StackId: m.input.plan.managementStackId, ChangeSetId: arn, ChangeSetName: request.ChangeSetName, ExecutionStatus: "AVAILABLE" }] };
    assert.equal(input.StackName, m.input.plan.managementStackId); assert.equal(input.ChangeSetName, arn);
    if (command instanceof Template) return { TemplateBody: template };
    return { ...details, ...patch };
  });
  assert.equal((await make().readRevoke(m, signal())).state, "READY_UNEXECUTED");
  for (const patch of [{ RoleARN: "foreign" }, { NextToken: "page" }, { IncludeNestedStacks: true }, { Parameters: [] }, { Changes: [] }, { ChangeSetId: "foreign" }]) await assert.rejects(make(patch).readRevoke(m, signal()));
  await assert.rejects(make({}, m.input.plan.request.TemplateBody).readRevoke(m, signal()));
});
test("J11 post-probe absence requires two exact ARN errors and a stable zero-resource unexecuted Stack", async () => {
  const { manifest: m } = await material(), p = m.input.plan, calls: Record<string, unknown>[] = [];
  const port = sdkReads(m, async (command) => {
    const { input } = command as Describe; calls.push(input);
    if (command instanceof Changes) throw Object.assign(new Error(`ChangeSet [${p.input.fixtureChangeSetArn}] does not exist`), { name: "ChangeSetNotFoundException", $metadata: { httpStatusCode: 404 } });
    if (command instanceof Resources) return { StackResourceSummaries: [] };
    if (command instanceof Template) return { TemplateBody: "", $metadata: { httpStatusCode: 200, requestId: "unit" } };
    return { Stacks: [{ StackId: p.input.fixtureStackId, StackName: ARN_PROBE_FIXTURE_STACK, StackStatus: "REVIEW_IN_PROGRESS", RoleARN: "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole", EnableTerminationProtection: false, Tags: [] }] };
  });
  const result = await port.readProbeAfter(p, signal()); assert.equal(result.state, "CHANGE_SET_ABSENT"); assert.equal(result.resourceCount, 0);
  assert.equal(calls.filter((item) => item.ChangeSetName === p.input.fixtureChangeSetArn).length, 2); assert.ok(calls.every((item) => item.StackName === p.input.fixtureStackId));
});
test("J11 post-probe absence refuses AccessDenied and name-bound/mismatched missing responses", async () => {
  const { manifest: m } = await material(), p = m.input.plan;
  for (const message of ["AccessDenied", `Stack with id ${ARN_PROBE_FIXTURE_STACK} does not exist`, "ChangeSet [foreign] does not exist"]) {
    const port = sdkReads(m, async () => { throw Object.assign(new Error(message), { name: "ValidationError", $metadata: { httpStatusCode: 400 } }); });
    await assert.rejects(port.readProbeAfter(p, signal()));
  }
});
test("J11 MFA session binds fixed trust/session and does not persist tokens or use ambient credentials", async () => {
  let calls = 0, prompts = 0;
  const prepare = createArnProbeOperatorSession({ now, sts: { send: async (command) => {
    calls++; const request = (command as Describe).input; assert.equal(request.RoleSessionName, "techlong-sandbox-cell-operator"); assert.equal(request.DurationSeconds, 900); assert.equal(request.TokenCode, "123456");
    return { AssumedRoleUser: { Arn: ARN_PROBE_OPERATOR_CALLER, AssumedRoleId: "AROATEST:techlong-sandbox-cell-operator" }, Credentials: { AccessKeyId: "unit-id", SecretAccessKey: "unit-secret", SessionToken: "unit-token", Expiration: new Date(time + 900_000) } };
  } }, assumeRole: Describe, getCallerIdentity: Describe, mfaCode: async () => { prompts++; return "123456"; },
    createOperatorSts: () => ({ send: async () => ({ Account: "402010193138", Arn: ARN_PROBE_OPERATOR_CALLER, UserId: "AROATEST:techlong-sandbox-cell-operator" }) }) });
  await assert.rejects(prepare.credentials()); await prepare.prepare(signal()); await prepare.prepare(signal()); assert.equal(calls, 1); assert.equal(prompts, 1);
  assert.equal((await prepare.credentials()).sessionToken, "unit-token");
});
test("J11 SDK write capabilities are exact, single-submit and revoke-only cannot Grant or Probe", async () => {
  const { manifest: m } = await material(), calls: Array<{ kind: string; input: Record<string, unknown> }> = [];
  const client = (kind: string) => ({ send: async (command: unknown) => { calls.push({ kind, input: (command as Describe).input }); return { $metadata: { requestId: "unit" } }; } });
  const adapter = new AwsSdkArnProbeWorkflowWriteAdapter({ manifest: m, source: client("source"), operator: client("operator"), commands: { executeChangeSet: Describe, createChangeSet: Describe, deleteChangeSet: Describe } });
  await assert.rejects(adapter.deleteProbe({ ...m.actions.probeDelete.request, ChangeSetName: "short" }, signal())); assert.equal(calls.length, 0);
  await adapter.deleteProbe(m.actions.probeDelete.request, signal()); await assert.rejects(adapter.deleteProbe(m.actions.probeDelete.request, signal())); assert.equal(calls.length, 1); assert.equal(calls[0].kind, "operator");
  const revokeOnly = new AwsSdkArnProbeWorkflowWriteAdapter({ manifest: m, source: client("source"), commands: { executeChangeSet: Describe, createChangeSet: Describe } });
  assert.throws(() => revokeOnly.executeGrant(m.actions.grantExecute.request, signal())); assert.throws(() => revokeOnly.deleteProbe(m.actions.probeDelete.request, signal()));
  await revokeOnly.createRevoke(m.actions.revoke.createRequest, signal()); assert.equal(calls[1].kind, "source");
  assert.throws(() => revokeOnly.executeRevoke({ StackName: m.input.plan.managementStackId, ChangeSetName: "short", ClientRequestToken: m.actions.revoke.executeClientToken, DisableRollback: false }, signal()));
});
test("J11 CLI accepts only explicit mode contracts, has no DeleteStack and reserves fsynced intent files", async () => {
  const cli = await readFile(new URL("../ops/aws-sandbox/scripts/s3-b5-arn-probe-workflow.ts", import.meta.url), "utf8");
  assert.doesNotMatch(cli, /DeleteStackCommand|UpdateStackCommand|PutRolePolicyCommand|CreatePolicyVersionCommand/);
  assert.match(cli, /await handle\.sync\(\)/); assert.match(cli, /"wx"/); assert.match(cli, /mode === "RunReviewed"/);
  for (const args of [["--mode", "DeleteStack"], ["--mode", "RunReviewed", "--acknowledge-read-only"], ["--mode", "Review", "--mode", "Inspect"]]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "ops/aws-sandbox/scripts/s3-b5-arn-probe-workflow.ts", ...args], { encoding: "utf8" }); assert.notEqual(result.status, 0);
  }
});
