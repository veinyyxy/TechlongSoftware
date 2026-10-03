import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdtemp, realpath, rm, lstat, mkdir, writeFile, symlink } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { compileArnProbeFixturePlan, ARN_PROBE_FIXTURE_STACK } from "../lib/deployments/execution/arn-compatibility-probe-fixture.ts";
import { compileArnProbeGrantPlan, type ArnProbeGrantPlan } from "../lib/deployments/execution/arn-compatibility-probe-grant.ts";
import { compileArnProbeWorkflowManifest, assertArnProbeWorkflowManifest, reviewArnProbeWorkflow, inspectArnProbeWorkflow, runArnProbeWorkflow, recoverArnProbeWorkflowRevoke,
  ARN_PROBE_OPERATOR_CALLER, type ArnProbeWorkflowManifest, type ArnProbeWorkflowReads, type ArnProbeWorkflowWrites, type ArnProbeWorkflowJournal,
  type ProbeStep, type ArnProbeWorkflowApproval, type ArnProbeOperatorReadPort, type ArnProbeOperatorReadiness } from "../lib/deployments/execution/arn-compatibility-probe-workflow.ts";
import { AwsSdkArnProbeWorkflowReadAdapter, AwsSdkArnProbeOperatorReadAdapter, AwsSdkArnProbeWorkflowWriteAdapter, createArnProbeOperatorSession } from "../lib/deployments/execution/aws-sdk-arn-compatibility-probe-workflow.ts";
import { sanitizeArnProbeFailure } from "../lib/deployments/execution/arn-compatibility-probe-diagnostics.ts";
import { reviewArnProbeRenewal, type ArnProbeLegacyArchive, type ArnProbeRenewalReads } from "../lib/deployments/execution/arn-compatibility-probe-renewal-review.ts";
import { reviewArnProbeFencedCreate, arnProbeSlotScope, createArnProbeFencedGrant, recoverArnProbeFencedCreate, assertArnProbeFencedCreateReview,
  type ArnProbeFencedCreateReview } from "../lib/deployments/execution/arn-compatibility-probe-fenced-create.ts";
import { createArnProbeFsFixedSlot } from "../lib/deployments/execution/arn-compatibility-probe-slot-store.ts";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
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
  const reply = { $metadata: { requestId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" } };
  const operatorReads: ArnProbeOperatorReadPort = { checkReadiness: async () => {
    events.push("operator-readiness"); return { schemaVersion: 1, manifestSha256: m.manifestSha256, callerArn: ARN_PROBE_OPERATOR_CALLER,
      account: "402010193138", region: "ca-central-1", stackId: plan.input.fixtureStackId, changeSetArn: plan.input.fixtureChangeSetArn,
      outcome: "READ_READY", attempts: 2, consecutiveSuccessfulReads: 2, evidenceSha256: "c".repeat(64), operatorIdentityVerified: true,
      failures: [], observedAt: at, deleteAuthorizationVerified: false, productionCompatibilityVerified: false, mutationPerformed: false, retryAuthorized: false };
  } };
  const writes: ArnProbeWorkflowWrites = {
    prepareOperator: async () => ({ callerArn: ARN_PROBE_OPERATOR_CALLER, account: "402010193138", expiresAt: "2026-10-03T17:15:00.000Z" }),
    executeGrant: async (request) => { events.push("grant"); assert.deepEqual(request, m.actions.grantExecute.request); granted = true; return reply; },
    deleteProbe: async (request) => { events.push("probe"); assert.deepEqual(request, plan.futureProbeRequest); deleted = true; return reply; },
    createRevoke: async (request) => { events.push("revoke-create"); assert.deepEqual(request, m.actions.revoke.createRequest); revokeCreated = true; return { ...reply, StackId: plan.managementStackId, Id: revokeArn }; },
    executeRevoke: async (request) => { events.push("revoke-execute"); assert.equal(request.ChangeSetName, revokeArn); assert.equal(request.DisableRollback, false); granted = false; return reply; },
  };
  const journal: ArnProbeWorkflowJournal = { load: async (step) => intents.get(step) ?? null,
    reserve: async (step, intent) => { if (intents.has(step)) throw new Error("Intent exists"); intents.set(step, intent); events.push(`intent:${step}`); } };
  return { reads, writes, operatorReads, journal, events, intents, setGranted: (value: boolean) => { granted = value; }, setTime: (value: string) => { at = value; } };
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
  assert.deepEqual(f.events.filter((item) => ["grant", "operator-readiness", "probe", "revoke-create", "revoke-execute", "post-read"].includes(item)), ["grant", "operator-readiness", "probe", "revoke-create", "revoke-execute", "post-read"]);
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

const providerRequestId = "8fd5ccaa-73e6-4728-a71e-4386096872dc";
function operatorSdk(m: ArnProbeWorkflowManifest, hook?: (command: Describe, index: number, reply: Record<string, unknown>) => Record<string, unknown>, clock = now) {
  const calls: Describe[] = [], p = m.input.plan, fixture = p.input.fixturePlan;
  const stack = { StackId: p.input.fixtureStackId, StackName: ARN_PROBE_FIXTURE_STACK, StackStatus: "REVIEW_IN_PROGRESS",
    RoleARN: fixture.request.RoleARN, EnableTerminationProtection: false, Tags: [] };
  const change = { StackId: p.input.fixtureStackId, StackName: ARN_PROBE_FIXTURE_STACK, ChangeSetId: p.input.fixtureChangeSetArn,
    ChangeSetName: fixture.request.ChangeSetName, Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", Description: fixture.request.Description,
    RoleARN: fixture.request.RoleARN, OnStackFailure: "DELETE", Tags: fixture.request.Tags, Capabilities: [], Parameters: [], NotificationARNs: [],
    Changes: [{ Type: "Resource", ResourceChange: { Action: "Add", LogicalResourceId: "ProbeHandle", ResourceType: "AWS::CloudFormation::WaitConditionHandle" } }] };
  const adapter = new AwsSdkArnProbeOperatorReadAdapter({ operator: { send: async (command) => {
    const typed = command as Describe; calls.push(typed);
    const reply = typed instanceof Changes ? { ...change } : typed instanceof Resources ? { StackResourceSummaries: [] } : typed instanceof Template ?
      { TemplateBody: typed.input.ChangeSetName ? fixture.request.TemplateBody : "" } : { Stacks: [{ ...stack }] };
    return { ...(hook ? hook(typed, calls.length, reply) : reply), $metadata: { httpStatusCode: 200, requestId: providerRequestId } };
  } }, commands: { describeStacks: Describe, listStackResources: Resources, getTemplate: Template, describeChangeSet: Changes },
    verifyIdentity: fake(m).writes.prepareOperator, pause: async (abort) => { abort.throwIfAborted(); } }, clock);
  return { adapter, calls };
}
test("J12 diagnostics allowlist scalars, reject credential-shaped fields and survive hostile errors", () => {
  const raw = Object.assign(new Error("SECRET_MFA_654321 SECRET_TOKEN"), { name: "AccessDenied", stack: "SECRET_STACK", $metadata:
    { requestId: providerRequestId, httpStatusCode: 403, secretAccessKey: "SECRET_KEY" }, response: { token: "SECRET_TOKEN" } });
  const safe = sanitizeArnProbeFailure(raw, "PROBE_DELETE", now);
  assert.equal(safe.classification, "AUTHORIZATION_DENIED"); assert.equal(safe.code, "AccessDenied"); assert.equal(safe.requestId, providerRequestId);
  assert.equal(safe.httpStatusCode, 403); assert.equal(safe.retryAuthorized, false); assert.equal(safe.authorizationContextObserved, false);
  assert.doesNotMatch(JSON.stringify(safe), /SECRET|654321/);
  const unknown = sanitizeArnProbeFailure({ name: "SECRET_NAME", $metadata: { requestId: "SECRET_TOKEN", httpStatusCode: "SECRET_STATUS" } }, "ENTRY", now);
  assert.equal(unknown.code, null); assert.equal(unknown.requestId, null); assert.equal(unknown.httpStatusCode, null);
  assert.doesNotMatch(JSON.stringify(unknown), /SECRET/);
  const hostile = new Proxy({}, { get() { throw new Error("SECRET_GETTER"); } });
  assert.equal(sanitizeArnProbeFailure(hostile, "ENTRY", now).classification, "UNKNOWN_UNCERTAIN");
  for (const [name, classification] of [["ExpiredToken", "AUTHENTICATION_FAILED"], ["ThrottlingException", "THROTTLED"], ["AbortError", "CANCELLED"], ["TimeoutError", "TIMEOUT_UNCERTAIN"], ["ChangeSetNotFoundException", "NOT_FOUND"]]) {
    assert.equal(sanitizeArnProbeFailure({ name }, "OPERATOR_READINESS", now).classification, classification);
  }
});
test("J12 Operator gate requires two complete real-read rounds using only exact ARNs; it never proves Delete", async () => {
  const { manifest: m } = await material(), { adapter, calls } = operatorSdk(m);
  const result = await adapter.checkReadiness(m, signal());
  assert.equal(result.outcome, "READ_READY"); assert.equal(result.attempts, 2); assert.equal(result.consecutiveSuccessfulReads, 2);
  assert.equal(result.operatorIdentityVerified, true); assert.match(result.evidenceSha256!, /^[a-f0-9]{64}$/);
  assert.equal(result.deleteAuthorizationVerified, false); assert.equal(result.productionCompatibilityVerified, false); assert.equal(result.mutationPerformed, false);
  assert.equal(calls.length, 14);
  assert.ok(calls.every((item) => item.input.StackName === m.input.plan.input.fixtureStackId && (!item.input.ChangeSetName || item.input.ChangeSetName === m.input.plan.input.fixtureChangeSetArn)));
});
test("J12 only bounded read retries may overcome a denial; persistent denial is recorded and never absence", async () => {
  const { manifest: m } = await material();
  for (const transient of [false, true]) {
    const { adapter, calls } = operatorSdk(m, (_command, index, reply) => {
      if (!transient || index === 1) throw Object.assign(new Error("SECRET provider denial"), { name: "AccessDenied", $metadata: { requestId: providerRequestId, httpStatusCode: 403 } });
      return reply;
    });
    const result = await adapter.checkReadiness(m, signal()); assert.equal(result.attempts, 3);
    assert.equal(result.outcome, transient ? "READ_READY" : "READ_NOT_READY"); assert.equal(result.failures.length, transient ? 1 : 3);
    assert.equal(result.failures[0].readOperation, "DescribeStacks"); assert.equal(result.failures[0].requestId, providerRequestId);
    assert.equal(result.failures[0].classification, "AUTHORIZATION_DENIED"); assert.doesNotMatch(JSON.stringify(result), /SECRET/);
    if (!transient) { assert.equal(result.evidenceSha256, null); assert.equal(calls.length, 3); }
  }
  const interrupted = operatorSdk(m, (_command, index, reply) => {
    if (index === 8) throw Object.assign(new Error("denied second round"), { name: "AccessDenied" });
    return reply;
  });
  const result = await interrupted.adapter.checkReadiness(m, signal());
  assert.equal(result.outcome, "READ_NOT_READY"); assert.equal(result.consecutiveSuccessfulReads, 1); assert.equal(result.evidenceSha256, null);
});
test("J12 Operator readiness fails closed on fixture drift, missing, pagination, or unknown errors without read replay", async () => {
  const { manifest: m } = await material();
  const patches = [
    (command: Describe, reply: Record<string, unknown>) => command instanceof Changes ? { ...reply, ChangeSetId: "foreign" } : reply,
    (command: Describe, reply: Record<string, unknown>) => command instanceof Changes ? { ...reply, NextToken: "page" } : reply,
    (command: Describe, reply: Record<string, unknown>) => command instanceof Changes ? { ...reply, IncludeNestedStacks: true } : reply,
    (command: Describe, reply: Record<string, unknown>) => command instanceof Changes ? { ...reply, RoleARN: "foreign" } : reply,
    (command: Describe, reply: Record<string, unknown>) => command instanceof Resources ? { ...reply, StackResourceSummaries: [{ LogicalResourceId: "materialized" }] } : reply,
    (command: Describe, reply: Record<string, unknown>) => command instanceof Template && command.input.ChangeSetName ? { ...reply, TemplateBody: "{}" } : reply,
  ];
  for (const patch of patches) {
    const port = operatorSdk(m, (command, _index, reply) => patch(command, reply));
    const result = await port.adapter.checkReadiness(m, signal()); assert.equal(result.outcome, "READ_NOT_READY"); assert.equal(result.attempts, 1);
  }
  for (const name of ["ChangeSetNotFoundException", "ValidationError", "UnrecognizedClientException", "Unknown_SECRET"]) {
    const port = operatorSdk(m, () => { throw Object.assign(new Error("SECRET"), { name }); });
    const result = await port.adapter.checkReadiness(m, signal()); assert.equal(result.outcome, "READ_NOT_READY"); assert.equal(port.calls.length, 1);
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  }
});
test("J12 cancelled, expired or wrong-identity Operator gate makes no CFN calls", async () => {
  const { manifest: m } = await material();
  for (const [clock, abort] of [[now, AbortSignal.abort()], [() => time + 300_000, signal()]] as const) {
    const port = operatorSdk(m, undefined, clock); assert.equal((await port.adapter.checkReadiness(m, abort)).outcome, "READ_NOT_READY"); assert.equal(port.calls.length, 0);
  }
  for (const caller of [{ account: "foreign", callerArn: "foreign", expiresAt: "2026-10-03T17:15:00.000Z" },
    { account: "402010193138", callerArn: ARN_PROBE_OPERATOR_CALLER, expiresAt: "invalid" }]) {
    const port = new AwsSdkArnProbeOperatorReadAdapter({ operator: { send: async () => { assert.fail("invalid caller must not query"); } },
      commands: { describeStacks: Describe, listStackResources: Resources, getTemplate: Template, describeChangeSet: Changes },
      verifyIdentity: async () => caller }, now);
    assert.equal((await port.checkReadiness(m, signal())).outcome, "READ_NOT_READY");
  }
});
test("J12 a failed Operator gate preserves its sanitized evidence, skips Delete intent and immediately revokes", async () => {
  const { manifest: m } = await material(), f = fake(m), ready = await f.operatorReads.checkReadiness(m, signal());
  const denied = sanitizeArnProbeFailure({ name: "AccessDenied", message: "SECRET", $metadata: { requestId: providerRequestId, httpStatusCode: 403 } }, "OPERATOR_READINESS", now);
  f.operatorReads.checkReadiness = async () => ({ ...ready, outcome: "READ_NOT_READY", attempts: 3, consecutiveSuccessfulReads: 0, evidenceSha256: null,
    failures: [{ ...denied, readOperation: "DescribeChangeSet", attempt: 1 }] });
  const result = await runArnProbeWorkflow({ manifest: m, approval: approval(m), ...f, signal: signal(), now });
  assert.equal(result.outcome, "LOCKED_PROBE_NOT_PROVED"); assert.equal(result.probeAttempted, false); assert.equal(result.probeRequestId, null);
  assert.equal(f.intents.has("probe-delete"), false); assert.equal(f.events.includes("probe"), false); assert.equal(f.events.includes("revoke-execute"), true);
  assert.equal(result.operatorReadiness?.failures[0].requestId, providerRequestId); assert.equal(result.operatorReadiness?.outcome, "READ_NOT_READY");
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
});
test("J12 readiness scope/age/success-proof drift cannot bypass the gate; receipts omit arbitrary port fields", async () => {
  const { manifest: m } = await material();
  const missing = fake(m);
  await assert.rejects(runArnProbeWorkflow({ manifest: m, approval: approval(m), ...missing, operatorReads: undefined as unknown as ArnProbeOperatorReadPort, signal: signal(), now }));
  assert.equal(missing.intents.size, 0); assert.equal(missing.events.includes("grant"), false);
  for (const patch of [{ stackId: "foreign" }, { changeSetArn: "foreign" }, { callerArn: "foreign" }, { evidenceSha256: null },
    { consecutiveSuccessfulReads: 1 }, { operatorIdentityVerified: false }, { observedAt: new Date(time - 60_001).toISOString() }, { deleteAuthorizationVerified: true },
    { failures: [{ ...sanitizeArnProbeFailure({ name: "AccessDenied" }, "OPERATOR_READINESS", now), readOperation: "DescribeChangeSet", attempt: 2 }] }]) {
    const f = fake(m), ready = await f.operatorReads.checkReadiness(m, signal());
    f.operatorReads.checkReadiness = async () => ({ ...ready, ...patch }) as ArnProbeOperatorReadiness;
    const result = await runArnProbeWorkflow({ manifest: m, approval: approval(m), ...f, signal: signal(), now });
    assert.ok(result.cleanup); assert.equal(f.events.includes("probe"), false);
  }
  const f = fake(m), ready = await f.operatorReads.checkReadiness(m, signal());
  f.operatorReads.checkReadiness = async () => ({ ...ready, secretAccessKey: "SECRET_PORT" });
  const result = await runArnProbeWorkflow({ manifest: m, approval: approval(m), ...f, signal: signal(), now });
  assert.equal(result.isolatedProbeCompatibilityObserved, true); assert.doesNotMatch(JSON.stringify(result), /SECRET_PORT/);
});
test("J12 Delete AccessDenied records one rejected attempt and request ID, then revokes without retry", async () => {
  const { manifest: m } = await material(), f = fake(m);
  f.writes.deleteProbe = async () => { f.events.push("probe"); throw Object.assign(new Error("SECRET"), { name: "AccessDenied", $metadata: { requestId: providerRequestId, httpStatusCode: 403 } }); };
  const result = await runArnProbeWorkflow({ manifest: m, approval: approval(m), ...f, signal: signal(), now });
  assert.equal(result.probeAttempted, true); assert.equal(result.probeRequestId, null); assert.equal(result.post?.state, "READY_UNEXECUTED");
  const failure = result.failures.find((item) => item.phase === "PROBE_DELETE"); assert.equal(failure?.classification, "AUTHORIZATION_DENIED"); assert.equal(failure?.requestId, providerRequestId);
  assert.equal(f.events.filter((item) => item === "probe").length, 1); assert.ok(result.cleanup); assert.equal(result.retryAuthorized, false);
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
});
test("J12 cancellation or review expiry during readiness skips Delete and cannot cancel Source Revoke", async () => {
  const { manifest: m } = await material();
  for (const expiry of [false, true]) {
    const f = fake(m), cancel = new AbortController(), prepare = f.operatorReads.checkReadiness; let current = time;
    f.operatorReads.checkReadiness = async (...args) => { const ready = await prepare(...args); if (expiry) { current += 300_000; f.setTime(new Date(current).toISOString()); } else cancel.abort(); return ready; };
    const result = await runArnProbeWorkflow({ manifest: m, approval: approval(m), ...f, signal: cancel.signal, now: () => current });
    assert.equal(result.probeAttempted, false); assert.ok(result.cleanup); assert.equal(result.outcome, "LOCKED_PROBE_NOT_PROVED");
  }
});

async function renewalMaterial() {
  const { manifest: m } = await material(), f = fake(m);
  f.writes.deleteProbe = async () => { throw Object.assign(new Error("denied"), { name: "AccessDenied" }); };
  const runReceipt = await runArnProbeWorkflow({ manifest: m, approval: approval(m), ...f, signal: signal(), now });
  const createReviewSha256 = "c".repeat(64), createIntent = { stage: "B5-J5g-j10", action: "CREATE_PROBE_GRANT_CHANGE_SET",
    operationSha256: m.input.plan.operationSha256, approvedReviewSha256: createReviewSha256,
    requestSha256: await sha256Hex(canonicalJson(m.input.plan.request)), reservedAt: observedAt };
  const archive: ArnProbeLegacyArchive = { manifest: m, runReceipt, createIntent, journal: Object.fromEntries(f.intents) as ArnProbeLegacyArchive["journal"] };
  const trustedAnchors = { manifestSha256: m.manifestSha256, runReceiptSha256: runReceipt.receiptSha256, createReviewSha256,
    revokeExecuteRequestSha256: String(f.intents.get("revoke-execute")!.requestSha256) };
  const later = time + 7_200_000, at = new Date(later).toISOString();
  const reads: ArnProbeRenewalReads = {
    readManagement: async () => full(m.input.plan, false, at),
    readEmptyManagementInventory: async () => ({ stackId: m.input.plan.managementStackId, state: "EMPTY", changeSetCount: 0, providerEvidenceSha256: "d".repeat(64), observedAt: at }),
    readFixture: async () => ({ state: "READY_UNEXECUTED", stackId: m.input.plan.input.fixtureStackId, changeSetArn: m.input.plan.input.fixtureChangeSetArn,
      resourceCount: 0, templateCanonicalSha256: m.input.plan.input.fixturePlan.templateCanonicalSha256, observedAt: at }),
  };
  return { archive, trustedAnchors, reads, readArchive: async () => archive, nonce: "d".repeat(32), signal: signal(), now: () => later };
}
test("J13 successor review closes exact history and proposes one target-bound slot independent of nonce/time", async () => {
  const input = await renewalMaterial(), first = await reviewArnProbeRenewal(input);
  const second = await reviewArnProbeRenewal({ ...input, nonce: "e".repeat(32), now: () => input.now() + 1_000 });
  assert.equal(first.proposal.targetFenceKey, second.proposal.targetFenceKey); assert.equal(first.proposal.slotRelativePath, second.proposal.slotRelativePath);
  assert.notEqual(first.proposal.nextGrantPlan.operationSha256, second.proposal.nextGrantPlan.operationSha256);
  assert.equal(first.proposal.generation, 1); assert.equal(first.proposal.persistenceImplemented, false); assert.equal(first.predecessor.replayAllowed, false);
  assert.equal(first.grantCreationAuthorized, false); assert.equal(first.grantExecutionAuthorized, false); assert.equal(first.probeDeletionAuthorized, false);
  assert.deepEqual(first.allowedWriteActions, []); assert.equal(first.mutationPerformed, false); assert.equal(first.runtimeEnabled, false);
  const { reviewSha256, ...body } = first; assert.equal(reviewSha256, await sha256Hex(canonicalJson(body)));
  assert.deepEqual(first.proposal.nextGrantPlan.futureProbeRequest, input.archive.manifest.input.plan.futureProbeRequest);
});
test("J13 default production anchors reject fabricated history before any provider read", async () => {
  const input = await renewalMaterial(); let reads = 0;
  await assert.rejects(reviewArnProbeRenewal({ ...input, trustedAnchors: undefined, reads: { ...input.reads, readManagement: async () => { reads++; throw new Error("must not read"); } } }));
  assert.equal(reads, 0);
  await assert.rejects(reviewArnProbeRenewal({ ...input, now: () => time, reads: { ...input.reads, readManagement: async () => { reads++; throw new Error("must not read"); } } })); assert.equal(reads, 0);
});
test("J13 missing, retargeted or corrupted legacy intents and changed receipt block review", async () => {
  const input = await renewalMaterial();
  for (const modify of [
    (archive: ArnProbeLegacyArchive) => { delete (archive.journal as Record<string, unknown>)["probe-delete"]; },
    (archive: ArnProbeLegacyArchive) => { (archive.journal["grant-execute"] as Record<string, unknown>).requestSha256 = "f".repeat(64); },
    (archive: ArnProbeLegacyArchive) => { (archive.journal["revoke-execute"] as Record<string, unknown>).operationSha256 = "f".repeat(64); },
    (archive: ArnProbeLegacyArchive) => { (archive.journal["revoke-create"] as Record<string, unknown>).reservedAt = "2026-10-03T16:00:00.000Z"; },
    (archive: ArnProbeLegacyArchive) => { (archive.createIntent as Record<string, unknown>).approvedReviewSha256 = "f".repeat(64); },
    (archive: ArnProbeLegacyArchive) => { (archive.runReceipt as Record<string, unknown>).outcome = "ISOLATED_PROBE_SUCCEEDED_LOCKED"; },
  ]) {
    const archive = JSON.parse(canonicalJson(input.archive)) as ArnProbeLegacyArchive; modify(archive);
    await assert.rejects(reviewArnProbeRenewal({ ...input, readArchive: async () => archive }));
  }
});
test("J13 renewed candidate needs fresh stable Locked, empty inventories, exact zero-resource fixture and unchanged local archive", async () => {
  const input = await renewalMaterial();
  for (const patch of [
    { readManagement: async () => full(input.archive.manifest.input.plan, true, new Date(input.now()).toISOString()) },
    { readManagement: async () => full(input.archive.manifest.input.plan, false, new Date(input.now() - 60_001).toISOString()) },
    { readEmptyManagementInventory: async () => { throw new Error("pending competing Change Set"); } },
    { readFixture: async () => ({ ...(await input.reads.readFixture(input.archive.manifest.input.plan, signal())), resourceCount: 1 }) },
  ]) await assert.rejects(reviewArnProbeRenewal({ ...input, reads: { ...input.reads, ...patch } as ArnProbeRenewalReads }));
  let reads = 0;
  await assert.rejects(reviewArnProbeRenewal({ ...input, readArchive: async () => {
    reads++; if (reads === 1) return input.archive;
    const archive = JSON.parse(canonicalJson(input.archive)); archive.journal["revoke-create"].requestSha256 = "f".repeat(64); return archive;
  } }));
  assert.equal(reads, 2);
});
test("J13 SDK requires genuinely empty unpaginated inventory and only queries the exact management Stack ID", async () => {
  const { manifest: m } = await material();
  for (const response of [{ Summaries: [{}] }, { Summaries: [], NextToken: "next" }, {}]) {
    const reads = sdkReads(m, async (command) => { assert.equal((command as Describe).input.StackName, m.input.plan.managementStackId); return response; });
    await assert.rejects(reads.readEmptyManagementInventory(m.input.plan, signal()));
  }
  const reads = sdkReads(m, async () => ({ Summaries: [] }));
  assert.equal((await reads.readEmptyManagementInventory(m.input.plan, signal())).state, "EMPTY");
});
test("J13 CLI is read-only and rejects old approval/write options without creating a journal", async () => {
  const cli = await readFile(new URL("../ops/aws-sandbox/scripts/s3-b5-arn-probe-renewal-review.ts", import.meta.url), "utf8");
  assert.doesNotMatch(cli, /CreateChangeSetCommand|ExecuteChangeSetCommand|DeleteChangeSetCommand|DeleteStackCommand|AssumeRoleCommand|mkdir\(|unlink\(|reserve\(/);
  assert.match(cli, /await exactEntries/); assert.match(cli, /isSymbolicLink/); assert.match(cli, /"wx"/);
  for (const args of [["--acknowledge-aws-write"], ["--mode", "CreateGrantReviewed"], ["--execution-phrase", "I_CONFIRM_J5GJ10_CREATE_PROBE_GRANT_CHANGE_SET_ONLY"]]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "ops/aws-sandbox/scripts/s3-b5-arn-probe-renewal-review.ts", ...args], { encoding: "utf8" }); assert.notEqual(result.status, 0);
  }
});

async function withSlotTemp(run: (folder: string) => Promise<void>) {
  const parent = await realpath(tmpdir()), folder = await mkdtemp(path.join(parent, "techlong-j14-"));
  try { await run(folder); } finally {
    const resolved = await realpath(folder);
    assert.equal(path.dirname(resolved), parent); assert.match(path.basename(resolved), /^techlong-j14-/);
    await rm(resolved, { recursive: true, force: true });
  }
}
async function fencedMaterial() {
  const input = await renewalMaterial(), draft = await reviewArnProbeRenewal(input), review = await reviewArnProbeFencedCreate({ ...input, draft });
  const plan = review.draft.proposal.nextGrantPlan, grantChangeSetArn = `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${plan.request.ChangeSetName}/aaaaaaaa-2222-4333-8444-bbbbbbbbbbbb`;
  const create = async () => ({ StackId: plan.managementStackId, Id: grantChangeSetArn, $metadata: { requestId: providerRequestId } });
  return { input, review, plan, grantChangeSetArn, create, approvedReviewSha256: review.reviewSha256, executionPhrase: review.requiredPhrase,
    acknowledgeAwsWrite: true, acknowledgeNamedIamChangeSetOnly: true, acknowledgeLowCostNotZero: true, acknowledgePreservesLegacyAndConsumesSlot: true };
}

test("J14 creation review binds the successor, exact request and permanent slot without authorizing Execute/Delete", async () => {
  const { review } = await fencedMaterial(); await assertArnProbeFencedCreateReview(review);
  assert.deepEqual(review.allowedWriteActions, ["cloudformation:CreateChangeSet"]); assert.equal(review.creationApproved, false);
  assert.equal(review.persistenceImplemented, true); assert.equal(review.grantExecutionAuthorized, false); assert.equal(review.probeDeletionAuthorized, false);
  assert.equal(review.cleanupAuthorized, false); assert.equal(review.runtimeEnabled, false);
  await assert.rejects(assertArnProbeFencedCreateReview({ ...review, grantExecutionAuthorized: true } as ArnProbeFencedCreateReview));
  const { input } = await fencedMaterial();
  await assert.rejects(reviewArnProbeFencedCreate({ ...input, draft: review.draft, now: () => input.now() + 300_000 }));
});

test("J14 actual filesystem read-only inspection creates no directory; one durable claim submits exactly one Create", async () => {
  const f = await fencedMaterial(); await withSlotTemp(async (folder) => {
    const slot = await createArnProbeFsFixedSlot(folder, await arnProbeSlotScope(f.review));
    assert.equal(await slot.readClaim(), null); await assert.rejects(lstat(path.join(folder, ".aws-sandbox")), { code: "ENOENT" });
    let calls = 0; const result = await createArnProbeFencedGrant({ ...f.input, ...f, slot, create: async (request) => { calls++; assert.deepEqual(request, f.plan.request); assert.ok(await slot.readClaim()); return f.create(); } });
    assert.equal(result.outcome, "CREATE_SUBMITTED"); assert.equal(calls, 1); assert.equal(result.grantInstalled, false); assert.equal(result.probeDeleted, false);
    const before = await readFile(path.join(folder, slot.scope.slotRelativePath, "claim.json"), "utf8");
    await assert.rejects(createArnProbeFencedGrant({ ...f.input, ...f, slot }));
    assert.equal(await readFile(path.join(folder, slot.scope.slotRelativePath, "claim.json"), "utf8"), before);
  });
});

test("J14 concurrent different reviews/nonces compete for one fixed directory: only one Create can be submitted", async () => {
  const a = await fencedMaterial(), draft = await reviewArnProbeRenewal({ ...a.input, nonce: "e".repeat(32) });
  const review = await reviewArnProbeFencedCreate({ ...a.input, draft });
  await withSlotTemp(async (folder) => {
    const first = await createArnProbeFsFixedSlot(folder, await arnProbeSlotScope(a.review)), second = await createArnProbeFsFixedSlot(folder, await arnProbeSlotScope(review));
    assert.equal(first.scope.slotRelativePath, second.scope.slotRelativePath); let calls = 0;
    const make = (r: ArnProbeFencedCreateReview) => async () => { calls++; return { StackId: r.draft.proposal.nextGrantPlan.managementStackId,
      Id: `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${r.draft.proposal.nextGrantPlan.request.ChangeSetName}/aaaaaaaa-2222-4333-8444-bbbbbbbbbbbb`, $metadata: { requestId: providerRequestId } }; };
    const outcomes = await Promise.allSettled([
      createArnProbeFencedGrant({ ...a.input, ...a, slot: first, create: make(a.review) }),
      createArnProbeFencedGrant({ ...a.input, ...a, review, approvedReviewSha256: review.reviewSha256, slot: second, create: make(review) }),
    ]);
    assert.equal(outcomes.filter((v) => v.status === "fulfilled").length, 1); assert.equal(calls, 1);
    const claim = JSON.parse(await readFile(path.join(folder, first.scope.slotRelativePath, "claim.json"), "utf8"));
    assert.ok([a.review.reviewSha256, review.reviewSha256].includes(claim.scope.creationReviewSha256));
  });
});

test("J14 incomplete/corrupt/unknown slots remain consumed and cannot be automatically repaired", async () => {
  const f = await fencedMaterial(), scope = await arnProbeSlotScope(f.review);
  for (const content of [null, "{partial", "{}", "unknown-file"]) await withSlotTemp(async (folder) => {
    const target = path.join(folder, scope.slotRelativePath); await mkdir(target, { recursive: true });
    if (content !== null) await writeFile(path.join(target, content === "unknown-file" ? "foreign.json" : "claim.json"), content);
    const slot = await createArnProbeFsFixedSlot(folder, scope); await assert.rejects(slot.readClaim()); await assert.rejects(slot.reserve("a".repeat(64), new Date(f.input.now()).toISOString()));
    await assert.rejects(createArnProbeFencedGrant({ ...f.input, ...f, slot, create: async () => assert.fail("consumed slot must not create") }));
  });
});

test("J14 rejects unknown targets/generations, path traversal and junction escape before submission", async () => {
  const f = await fencedMaterial(), scope = await arnProbeSlotScope(f.review);
  await withSlotTemp(async (folder) => {
    await assert.rejects(createArnProbeFsFixedSlot(folder, { ...scope, slotRelativePath: "../escape" }));
    await assert.rejects(createArnProbeFsFixedSlot(folder, { ...scope, generation: 2 }));
    await mkdir(path.join(folder, ".aws-sandbox", "j5gj13-arn-probe", "foreign"), { recursive: true });
    const slot = await createArnProbeFsFixedSlot(folder, scope); await assert.rejects(slot.readClaim()); await assert.rejects(slot.reserve("a".repeat(64), new Date(f.input.now()).toISOString()));
  });
  await withSlotTemp(async (folder) => {
    const outside = path.join(folder, "outside"); await mkdir(outside); await symlink(outside, path.join(folder, ".aws-sandbox"), "junction");
    const slot = await createArnProbeFsFixedSlot(folder, scope); await assert.rejects(slot.readClaim()); await assert.rejects(slot.reserve("a".repeat(64), new Date(f.input.now()).toISOString()));
  });
});

test("J14 missing acknowledgements, expiry/cancellation and fresh preflight drift consume no slot and submit nothing", async () => {
  const f = await fencedMaterial(); await withSlotTemp(async (folder) => {
    const slot = await createArnProbeFsFixedSlot(folder, await arnProbeSlotScope(f.review));
    const common = { ...f.input, ...f, slot, create: async () => assert.fail("rejected preflight must not create") };
    for (const patch of [{ approvedReviewSha256: "0".repeat(64) }, { acknowledgeAwsWrite: false }, { acknowledgeNamedIamChangeSetOnly: false },
      { acknowledgeLowCostNotZero: false }, { acknowledgePreservesLegacyAndConsumesSlot: false }, { executionPhrase: "OLD_PHRASE" },
      { now: () => f.input.now() + 300_000 }, { signal: AbortSignal.abort() },
      { reads: { ...f.input.reads, readEmptyManagementInventory: async () => { throw new Error("foreign pending change"); } } }]) await assert.rejects(createArnProbeFencedGrant({ ...common, ...patch }));
    assert.equal(await slot.readClaim(), null); await assert.rejects(lstat(path.join(folder, ".aws-sandbox")), { code: "ENOENT" });
  });
});

test("J14 cancellation/expiry immediately after durable claim keeps it consumed with zero AWS submissions", async () => {
  const f = await fencedMaterial(); for (const expiry of [false, true]) await withSlotTemp(async (folder) => {
    const slot = await createArnProbeFsFixedSlot(folder, await arnProbeSlotScope(f.review)), cancel = new AbortController(); let current = f.input.now();
    const result = await createArnProbeFencedGrant({ ...f.input, ...f, signal: cancel.signal, now: () => current,
      slot: { ...slot, reserve: async (...args) => { const claim = await slot.reserve(...args); if (expiry) current += 300_000; else cancel.abort(); return claim; } },
      create: async () => assert.fail("cancelled consumed slot cannot submit") });
    assert.equal(result.outcome, "NO_CREATE_SUBMITTED_SLOT_CONSUMED"); assert.equal(result.creationAttempted, false); assert.ok(await slot.readClaim());
  });
});

test("J14 lost or malformed Create response is uncertain, single-submit, and only read-only Recover is allowed", async () => {
  const f = await fencedMaterial(); for (const malformed of [false, true]) await withSlotTemp(async (folder) => {
    const slot = await createArnProbeFsFixedSlot(folder, await arnProbeSlotScope(f.review)); let calls = 0;
    const result = await createArnProbeFencedGrant({ ...f.input, ...f, slot, create: async () => { calls++; if (malformed) return { Id: "foreign" }; throw Object.assign(new Error("SECRET"), { name: "TimeoutError" }); } });
    assert.equal(result.outcome, "CREATE_UNCERTAIN"); assert.equal(result.retryAuthorized, false); assert.equal(calls, 1); assert.doesNotMatch(JSON.stringify(result), /SECRET/);
    let readCalls = 0; const old = f.input.archive.manifest.input.plan;
    const recovered = await recoverArnProbeFencedCreate({ review: f.review, slot, signal: signal(), now: f.input.now, reads: {
      readLockedPreflight: async () => { const locked = full(old, false, new Date(f.input.now()).toISOString());
        return { ...locked, rendererShape: "Locked" as const, stack: { ...locked.stack, status: "UPDATE_COMPLETE" as const } }; },
      readFixture: async () => f.input.reads.readFixture(old, signal()),
      readGrantChangeSet: async () => { readCalls++; return { state: "MISSING", proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY", observedAt: new Date(f.input.now()).toISOString() }; },
    } });
    assert.equal(recovered.mutationPerformed, false); assert.equal(recovered.retryAuthorized, false); assert.equal(readCalls, 1);
  });
});

test("J14 shared filesystem journal binds all five intents; fresh workflow manifests cannot replay under a new operation", async () => {
  const f = await fencedMaterial(); await withSlotTemp(async (folder) => {
    const slot = await createArnProbeFsFixedSlot(folder, await arnProbeSlotScope(f.review)); await createArnProbeFencedGrant({ ...f.input, ...f, slot });
    const at = new Date(f.input.now()).toISOString(), m = await compileArnProbeWorkflowManifest({ plan: f.plan, grantChangeSetArn: f.grantChangeSetArn, reviewedAt: at, expiresAt: new Date(f.input.now() + 300_000).toISOString() });
    const ports = fake(m); ports.setTime(at); ports.writes.prepareOperator = async () => ({ callerArn: ARN_PROBE_OPERATOR_CALLER, account: "402010193138", expiresAt: new Date(f.input.now() + 900_000).toISOString() });
    const journal = await slot.workflowJournal(m), result = await runArnProbeWorkflow({ ...ports, journal, manifest: m, approval: approval(m), signal: signal(), now: f.input.now });
    assert.equal(result.outcome, "ISOLATED_PROBE_SUCCEEDED_LOCKED");
    for (const step of ["run", "grant-execute", "probe-delete", "revoke-create", "revoke-execute"] as ProbeStep[]) assert.ok(await journal.load(step));
    const renewed = await compileArnProbeWorkflowManifest({ ...m.input, reviewedAt: new Date(f.input.now() + 1_000).toISOString(), expiresAt: new Date(f.input.now() + 301_000).toISOString() });
    assert.notEqual(renewed.operationSha256, m.operationSha256); const other = fake(renewed); other.setTime(at);
    await assert.rejects(runArnProbeWorkflow({ ...other, journal: await slot.workflowJournal(renewed), manifest: renewed, approval: approval(renewed), signal: signal(), now: () => f.input.now() + 1_000 }));
    assert.equal(other.events.includes("grant"), false); assert.equal(other.events.includes("probe"), false);
    await assert.rejects(slot.workflowJournal(f.input.archive.manifest));
  });
});

test("J14 CLI has strict creation-only modes and successor workflow entry requires fixed-slot binding before SDK/MFA", async () => {
  const cli = await readFile(new URL("../ops/aws-sandbox/scripts/s3-b5-arn-probe-fenced-create.ts", import.meta.url), "utf8");
  assert.doesNotMatch(cli, /ExecuteChangeSetCommand|DeleteChangeSetCommand|DeleteStackCommand|AssumeRoleCommand|unlink\(/);
  assert.match(cli, /if \(mode === "ReviewCreate"\)/); assert.match(cli, /if \(mode === "RecoverCreate"\)/); assert.match(cli, /maxAttempts: 1/);
  for (const args of [["--mode", "ReviewCreate", "--acknowledge-aws-write"], ["--mode", "CreateReviewed", "--acknowledge-read-only"], ["--mode", "RecoverCreate", "--approved-review-sha", "0".repeat(64)], ["--mode", "ExecuteGrant"]]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "ops/aws-sandbox/scripts/s3-b5-arn-probe-fenced-create.ts", ...args], { encoding: "utf8" }); assert.notEqual(result.status, 0);
  }
  const workflow = await readFile(new URL("../ops/aws-sandbox/scripts/s3-b5-arn-probe-workflow.ts", import.meta.url), "utf8");
  assert.match(workflow, /manifest!\.manifestSha256 !== ARN_PROBE_LEGACY_ANCHORS\.manifestSha256/); assert.match(workflow, /fencedJournal \?\?/);
  assert.ok(workflow.indexOf("slot.workflowJournal(manifest!)") < workflow.indexOf('import("@aws-sdk/client-sts")'));
  const { manifest: m } = await material();
  await withSlotTemp(async (folder) => {
    const manifestFile = path.join(folder, "manifest.json"), output = path.join(folder, "output.json"); await writeFile(manifestFile, JSON.stringify(m));
    for (const mode of ["RunReviewed", "RecoverRevoke"]) {
      const args = ["--mode", mode, "--manifest", manifestFile, "--output", output, "--approved-manifest-sha", m.manifestSha256, "--approved-revoke-sha", m.actionSha256.revoke,
        "--execution-phrase", approval(m, mode === "RecoverRevoke").executionPhrase, "--acknowledge-aws-write", "--acknowledge-low-cost-not-zero"];
      if (mode === "RunReviewed") args.push("--approved-grant-sha", m.actionSha256.grantExecute, "--approved-probe-sha", m.actionSha256.probeDelete);
      const result = spawnSync(process.execPath, ["--experimental-strip-types", "ops/aws-sandbox/scripts/s3-b5-arn-probe-workflow.ts", ...args], { encoding: "utf8" });
      assert.notEqual(result.status, 0); assert.match(result.stderr, /Every successor workflow requires/); await assert.rejects(lstat(output), { code: "ENOENT" });
    }
  });
});
