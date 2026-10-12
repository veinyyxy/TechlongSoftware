import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson } from "../lib/deployments/execution/hash.ts";
import { assertCellV3ForwardPhase, decodeCellStackPlanV3, renderAwsSandboxSharedCellStackV3 } from "../lib/deployments/cloudformation/shared-cell-stack-v3.ts";
import { compileV3ProvisionPredecessor, V3CellCleanupStackEvidenceBridge, assertCellStackSnapshotV3 } from "../lib/deployments/execution/aws-sdk-cell-stack-evidence-v3.ts";
import { compileCellBirthDelegationV3, decodeCellBirthDelegationV3, prepareBirthBoundDrainV3, prepareFailedBirthCompensationV3, validateCellBirthTickV3 } from "../lib/deployments/execution/cell-birth-lifecycle-v3.ts";
import { validateSharedCellAuthorityItem } from "../lib/deployments/execution/shared-cell-cleanup-authority.ts";
import { v3Fixture, v3Now, v3StackId } from "./fixtures/cell-stack-v3.ts";

test("complete v3 blueprint is RESERVED by default, scheduler before conditional paid resources", async () => {
  const { plan } = await v3Fixture(), resources = plan.template.Resources as Record<string, Record<string, unknown>>;
  assert.equal(plan.phaseParameters.RESERVED.LifecyclePhase, "RESERVED"); assert.equal(plan.safety.reservedResourceCount, 0); assert.equal(plan.safety.armedResourceCount, 1);
  assert.equal(plan.safety.applyReady, false); assert.equal(Object.isFrozen(plan.template), true); assert.equal(plan.safety.maxAcu, 1);
  assert.equal("CellCleanupSchedule" in resources, false); const schedule = resources.CellLifecycleScheduleV3;
  assert.equal(schedule.Condition, "HasLifecycleSchedule"); const p = schedule.Properties as Record<string, unknown>, target = p.Target as Record<string, unknown>;
  assert.equal(p.State, "ENABLED"); assert.equal(p.ActionAfterCompletion, "NONE"); assert.deepEqual(target.RetryPolicy, { MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0 });
  assert.ok(canonicalJson(target.Input).includes("${AWS::StackId}")); assert.ok(canonicalJson(target.Input).includes(plan.birthIntentSha256));
  assert.equal(canonicalJson(plan.template).includes("delete_shared_cell_stack"), false); assert.equal(canonicalJson(plan.template).includes("CellJanitorFunctionArn"), false);
  for (const [id, r] of Object.entries(resources)) if (id !== "CellLifecycleScheduleV3") { assert.equal(r.Condition, "HasPaidCellResources"); assert.ok((r.DependsOn as string[]).includes("CellLifecycleScheduleV3")); }
  for (const [id, o] of Object.entries(plan.template.Outputs as Record<string, Record<string, unknown>>)) if (!["CellExpiresAt", "BirthIntentSha256"].includes(id)) assert.equal(o.Condition, "HasPaidCellResources");
});
test("deterministic reload validates whole plan, old budget/apply-enabled input and phase regressions reject", async () => {
  const { plan } = await v3Fixture(), decoded = await decodeCellStackPlanV3(JSON.parse(canonicalJson(plan))); assert.equal(decoded.planSha256, plan.planSha256);
  const bad = JSON.parse(canonicalJson(plan)); bad.template.Description = "changed"; await assert.rejects(() => decodeCellStackPlanV3(bad));
  const input = structuredClone(plan.intent.input); input.base.environment.policy.budgetLimitCents = 1000; await assert.rejects(() => renderAwsSandboxSharedCellStackV3(input));
  input.base.environment.policy.budgetLimitCents = 5000; input.base.environment.applyEnabled = true; await assert.rejects(() => renderAwsSandboxSharedCellStackV3(input));
  assert.doesNotThrow(() => assertCellV3ForwardPhase("RESERVED", "ARMED")); assert.doesNotThrow(() => assertCellV3ForwardPhase("ARMED", "PAID"));
  for (const [from, to] of [["RESERVED", "PAID"], ["PAID", "ARMED"], ["PAID", "RESERVED"], ["ARMED", "ARMED"]] as const) assert.throws(() => assertCellV3ForwardPhase(from, to));
});
test("read adapter fingerprints both complete Stack reads and preserves schema2 predecessor compatibility", async () => {
  const f = await v3Fixture(), e = await f.read(); assert.ok("protocol" in e); const p = await compileV3ProvisionPredecessor(f.plan, e, v3Now + 2000);
  const decoded = await validateSharedCellAuthorityItem(p.item); assert.equal(decoded.record.state, "provision_verified"); assert.equal(decoded.record.templateCanonicalSha256, f.plan.templateCanonicalSha256);
  assert.equal(p.authorityInstallationAuthorized, false); assert.equal(f.calls.filter(x => x === "template").length, 2); assert.equal(f.calls.filter(x => x === "resources").length, 2);
  assert.equal(f.calls.some(x => /delete|create|update/i.test(x)), false); assert.throws(() => assertCellStackSnapshotV3(structuredClone(e)));
  const bridge = new V3CellCleanupStackEvidenceBridge(f.plan, f.reader); assert.equal(decoded.record.state, "provision_verified");
  const b = await bridge.readVerifiedCleanupStackEvidence({ predecessor: decoded.record, signal: new AbortController().signal }); assert.equal(b.templateCanonicalSha256, e.templateCanonicalSha256);
});
test("Source inspection and reserved/armed states cannot become provision authority", async () => {
  for (const [phase, profile] of [["RESERVED", "provisioner"], ["ARMED", "provisioner"], ["PAID", "source_inspection"]] as const) {
    const f = await v3Fixture(phase, "UPDATE_COMPLETE", profile), e = await f.read(); assert.ok("protocol" in e);
    await assert.rejects(() => compileV3ProvisionPredecessor(f.plan, e, v3Now + 2000));
  }
});
test("missing name is absence only; an expected exact StackId may not become a reusable slot", async () => {
  const f = await v3Fixture(); f.markMissing(); const r = await f.reader.read(f.plan, null, new AbortController().signal); assert.ok("state" in r); assert.equal(r.state, "ABSENT");
  await assert.rejects(() => f.read(), /STACK_ID_MISSING/);
});
test("wrong caller, tags, phase, role, outputs and resource inventory cannot mint v3 evidence", async () => {
  for (const k of ["caller", "tag", "phase", "role", "output", "duplicate", "unknown", "missing", "clock"]) {
    const f = await v3Fixture(); if (k === "caller") f.identity.Arn = "arn:aws:sts::402010193138:assumed-role/OtherRole/fixture-session";
    if (k === "tag") f.stack.Tags[0].Value = "changed"; if (k === "phase") f.stack.Parameters.push({ ParameterKey: "Extra", ParameterValue: "PAID" });
    if (k === "role") f.stack.RoleARN = "other"; if (k === "output") f.stack.Outputs.find(x => x.OutputKey === "VpcId")!.OutputValue = "vpc-fffffffffffffffff";
    if (k === "duplicate") f.resources.push(f.resources[0]); if (k === "unknown") f.resources[0].LogicalResourceId = "Unknown"; if (k === "missing") f.resources.pop();
    if (k === "clock") f.setTime(v3Now - 1);
    await assert.rejects(() => f.read());
  }
});
async function delegated() {
  const f = await v3Fixture("RESERVED"), reserved = await f.read(); assert.ok("protocol" in reserved);
  const d = await compileCellBirthDelegationV3({ plan: f.plan, reserved, coordinatorCodeSha256: "b".repeat(64), coordinatorRoleId: "AROAV3GNMXTZTESTROLEID", now: v3Now + 2000 });
  return { f, d };
}
test("reserved delegation is data only and cold decoder binds whole parent scope", async () => {
  const { f, d } = await delegated(); assert.equal(d.installationAuthorized, false); assert.equal(d.runtimeEnabled, false);
  assert.equal(d.stackId, v3StackId); assert.equal(d.notAfter, v3Now + 4 * 3600000);
  const cold = await decodeCellBirthDelegationV3(structuredClone(d), f.plan); assert.equal(cold.delegationSha256, d.delegationSha256);
  const bad = structuredClone(d); bad.scope.noForceDeleteRetainSkipOrPhaseRegression = false as never; await assert.rejects(() => decodeCellBirthDelegationV3(bad, f.plan));
});
test("due drain child binds precise predecessor, cannot run early or transfer Stack identity", async () => {
  const { f, d } = await delegated(), paid = await v3Fixture(), e = await paid.read(); assert.ok("protocol" in e); const p = await compileV3ProvisionPredecessor(paid.plan, e, v3Now + 2000);
  await assert.rejects(() => prepareBirthBoundDrainV3({ plan: f.plan, delegation: d, provisionItem: p.item, now: v3Now + 2000 }), /NOT_DUE/);
  const r = await prepareBirthBoundDrainV3({ plan: f.plan, delegation: d, provisionItem: p.item, now: v3Now + 10800000 }); assert.equal(r.invokeAuthorized, false); assert.equal(r.event.schemaVersion, 3);
  const bad = structuredClone(d); bad.stackId = bad.stackId.replace("123456789012", "123456789013"); await assert.rejects(() => prepareBirthBoundDrainV3({ plan: f.plan, delegation: bad, provisionItem: p.item, now: v3Now + 10800000 }));
});
test("partial failed inventory remains separate, requires exclusion fence/census/journal and never authorizes delete", async () => {
  const { f, d } = await delegated(), failed = await v3Fixture("PAID", "UPDATE_FAILED"); failed.resources.splice(1); failed.resources[0].ResourceStatus = "CREATE_FAILED";
  const e = await failed.read(); assert.ok("protocol" in e); assert.equal(e.failedCreationOrPhase, true); assert.equal(e.completePaidStack, false);
  await assert.rejects(() => compileV3ProvisionPredecessor(failed.plan, e, v3Now + 2000));
  const r = await prepareFailedBirthCompensationV3({ plan: f.plan, delegation: d, failure: e, now: v3Now + 2000 });
  assert.equal(r.request.StackName, v3StackId); assert.equal(r.request.DeletionMode, "STANDARD"); assert.equal(r.mutationAuthorized, false);
  assert.ok(r.blockers.includes("atomic_failed_birth_fence_and_absent_activation_provision")); assert.ok(r.blockers.includes("certified_serializable_unadmitted_zero_tenant_source"));
  assert.equal("RetainResources" in r.request, false); assert.equal("ResourcesToSkip" in r.request, false);
});
test("tick is birth+exact StackId, never legacy deletion name or fake child SHA", () => {
  const event = { schemaVersion: 3, action: "reconcile_approved_cell_birth_v3", birthIntentSha256: "a".repeat(64), stackId: v3StackId };
  assert.equal(validateCellBirthTickV3(event).stackId, v3StackId);
  for (const patch of [{ action: "delete_shared_cell_stack" }, { stackId: "techlong-sandbox-cell-sandbox-1" }, { approvedDeletionPlanSha256: "a".repeat(64) }]) assert.throws(() => validateCellBirthTickV3({ ...event, ...patch }));
});
