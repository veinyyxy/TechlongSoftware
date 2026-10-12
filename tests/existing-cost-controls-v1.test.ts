import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { COST_CONTROL_SCOPE_V1 as oldScope, assertCostChangeSetV1, expectedCostSettingsV1,
  type CostManifestV1, type CostSettingsV1 } from "../lib/deployments/execution/sandbox-cost-controls-v1.ts";
import { EXISTING_COST_SCOPE_V1 as s, expectedExistingCostContextsV1, assertExistingCostPlanV1, normalizeExistingCostPlanV1,
  assertExistingCostFreshV1, assertExistingCostApprovalV1, runExistingCostStepsV1,
  type ExistingCostManifestV1, type ExistingCostPortsV1 } from "../lib/deployments/execution/existing-cost-controls-v1.ts";
const now = 1791779600000;
const before = { stack: { id: oldScope.stackId, name: oldScope.stackName, parameters: { MonthlyBudgetUsd: "10", BudgetAlertEmail: "fixture@example.com" },
  templateSha256: oldScope.baseTemplateSha256, tags: [{ Key: "Environment", Value: "aws-sandbox" }] },
  budget: { config: { BudgetName: oldScope.budgetName, BudgetLimit: { Amount: "10", Unit: "USD" }, BudgetType: "COST", TimeUnit: "MONTHLY", CostFilters: { TagKeyValue: ["user:Environment$aws-sandbox"] },
    CostTypes: { IncludeTax: true }, TimePeriod: { Start: "2026-08-01T00:00:00.000Z", End: "2087-06-15T00:00:00.000Z" } },
    notifications: [10, 30, 50, 80, 100].map(Threshold => ({ notification: { NotificationType: "ACTUAL", ComparisonOperator: "GREATER_THAN", Threshold, ThresholdType: "PERCENTAGE" }, subscribers: [{ Address: "fixture@example.com", SubscriptionType: "EMAIL" }] })), tags: [], actions: [] },
  table: { id: oldScope.tableId, arn: oldScope.tableArn, maxRead: 5, maxWrite: 2, config: {}, tags: [] } } as unknown as CostSettingsV1;
const old = { manifestSha256: s.originalManifestSha256, before, scope: oldScope, candidateTemplate: { fixture: "same exact candidate" }, candidateTemplateSha256: "c".repeat(64),
  oldChangeSets: oldScope.oldFailedChangeSetIds.map(id => ({ id, name: id.split("/")[1], status: "FAILED", executionStatus: "UNAVAILABLE", includeNested: false })) } as unknown as CostManifestV1;
function plan() {
  const target = { Attribute: "Properties", Name: "Budget", RequiresRecreation: "Conditionally" }, contexts = expectedExistingCostContextsV1(old);
  return { ChangeSetId: s.changeSetArn, ChangeSetName: s.changeSetName, StackId: oldScope.stackId, StackName: oldScope.stackName, CreationTime: s.creationTime,
    Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", Description: `Reviewed F3c3a cost controls ${s.originalManifestSha256}`,
    IncludeNestedStacks: false, Capabilities: [], NotificationARNs: [], RollbackConfiguration: {}, DeploymentConfig: { Mode: "STANDARD", DisableRollback: false },
    Parameters: Object.entries({ ...before.stack.parameters, MonthlyBudgetUsd: "50" }).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })), Tags: before.stack.tags,
    Changes: [{ Type: "Resource", ResourceChange: { Action: "Modify", LogicalResourceId: "SandboxMonthlyCostBudget", PhysicalResourceId: oldScope.budgetName, ResourceType: "AWS::Budgets::Budget", Replacement: "Conditional", Scope: ["Properties"],
      Details: [
        { Target: { ...target, Path: "/Properties/Budget/TimePeriod", AfterValue: canonicalJson(before.budget.config.TimePeriod), AttributeChangeType: "Add" }, Evaluation: "Static", ChangeSource: "DirectModification" },
        { Target: { ...target, Path: "/Properties/Budget/BudgetLimit/Amount", BeforeValue: "10", AfterValue: "50", AttributeChangeType: "Modify" }, Evaluation: "Dynamic", ChangeSource: "DirectModification" },
        { Target: { ...target, Path: "/Properties/Budget/BudgetLimit/Amount", BeforeValue: "10", AfterValue: "50", AttributeChangeType: "Modify" }, Evaluation: "Static", ChangeSource: "ParameterReference", CausingEntity: "MonthlyBudgetUsd" },
      ], BeforeContext: canonicalJson(contexts.before), AfterContext: canonicalJson(contexts.after) } }] };
}
async function reviewed() {
  const p = normalizeExistingCostPlanV1(plan());
  // This fixture exercises guards/flow only, not the historical manifest signature validator.
  return { reviewedAt: now, expiresAt: now + 3600000, scope: s, originalManifest: old, plan: p, planSha256: await sha256Hex(p), manifestSha256: "a".repeat(64) } as ExistingCostManifestV1;
}
function ports(m: ExistingCostManifestV1) {
  let time = now, applied = false, occupied = false; const calls: string[] = [], markers = new Map<string, unknown>();
  const inventory = () => ({ observedAt: time, settings: expectedCostSettingsV1(old, applied, false), stackStatus: applied ? "UPDATE_COMPLETE" : "CREATE_COMPLETE", tableStatus: "ACTIVE", permissionsAllowed: true,
    changeSets: [...(applied ? [] : old.oldChangeSets), { id: s.changeSetArn, name: s.changeSetName, status: "CREATE_COMPLETE", executionStatus: applied ? "EXECUTE_COMPLETE" : "AVAILABLE", includeNested: false }] });
  const p: ExistingCostPortsV1 = { now: () => time, snapshot: async () => ({ observedAt: time, inventory: inventory(), plan: m.plan, template: old.candidateTemplate }), inventory: async () => inventory(),
    claimSlot: async () => { if (occupied) throw Error("EEXIST"); occupied = true; }, marker: async (n, v) => { if (markers.has(n)) throw Error("EEXIST"); markers.set(n, v); },
    executeOnce: async () => { calls.push("execute"); applied = true; }, waitBudget: async () => { calls.push("wait"); }, updateReadOnce: async () => { calls.push("table"); } };
  return { p, calls, markers, advance: () => { time += 3600000; } };
}
test("new path accepts only the exact Conditional plan; original False/Never guard still rejects it", () => {
  assert.doesNotThrow(() => assertExistingCostPlanV1(old, plan(), old.candidateTemplate));
  assert.throws(() => assertCostChangeSetV1(old, plan(), old.candidateTemplate, s.changeSetArn), /COST_CONTROL_CHANGESET_SCOPE_UNREVIEWED/);
});
test("path, recreation, expression, identity, notification and unknown-property drift all reject", () => {
  for (const kind of ["path", "recreation", "expression", "identity", "replacement", "capability", "extra", "subscriber", "bothContexts"]) {
    const p = plan(), r = p.Changes[0].ResourceChange;
    if (kind === "path") r.Details[0].Target.Path = "/Properties/NotificationsWithSubscribers";
    if (kind === "recreation") r.Details[1].Target.RequiresRecreation = "Always";
    if (kind === "expression") r.Details[2].CausingEntity = "BudgetAlertEmail";
    if (kind === "identity") p.ChangeSetId += "foreign";
    if (kind === "replacement") r.Replacement = "False";
    if (kind === "capability") p.Capabilities.push("CAPABILITY_IAM" as never);
    if (kind === "extra") Object.assign(r, { PolicyAction: "ReplaceAndDelete" });
    if (kind === "subscriber") r.AfterContext = r.AfterContext.replace("fixture@example.com", "foreign@example.com");
    if (kind === "bothContexts") { r.BeforeContext = r.BeforeContext.replace("IncludeTax", "OtherFlag"); r.AfterContext = r.AfterContext.replace("IncludeTax", "OtherFlag"); }
    assert.throws(() => assertExistingCostPlanV1(old, p, old.candidateTemplate), /EXISTING_COST_/);
  }
});
test("normalization discards only transport metadata and normalizes absent nulls/dates", () => {
  const p = plan(), a = normalizeExistingCostPlanV1({ ...p, $metadata: { requestId: "not an approval" }, CreationTime: new Date(s.creationTime) });
  assert.deepEqual(a, normalizeExistingCostPlanV1(p)); assert.throws(() => normalizeExistingCostPlanV1({ ...p, UnknownOperationSetting: true }));
});
test("fresh read and new approval reject old SHA, stale/future/NaN clocks", async () => {
  const m = await reviewed(); assert.throws(() => assertExistingCostApprovalV1(m, s.originalManifestSha256, now));
  for (const n of [now - 1, m.expiresAt, NaN]) assert.throws(() => assertExistingCostApprovalV1(m, m.manifestSha256, n));
  for (const t of [now + 1, now - 30001, NaN]) assert.throws(() => assertExistingCostFreshV1(t, now));
});
test("reviewed flow has exactly two writes and verifies budget before table; no create step", async () => {
  const m = await reviewed(), f = ports(m), r = await runExistingCostStepsV1(m, m.manifestSha256, f.p);
  assert.equal(r.failureCode, null); assert.equal(r.writeAttempts, 2); assert.deepEqual(f.calls, ["execute", "wait", "table"]); assert.ok(f.markers.has("budget-verified.json")); assert.equal(r.runtimeEnabled, false);
});
test("lost execute/table response stops once without compensating or retrying", async () => {
  for (const step of ["execute", "table"]) {
    const m = await reviewed(), f = ports(m);
    if (step === "execute") f.p.executeOnce = async () => { f.calls.push("execute"); throw Error("response lost"); };
    else f.p.updateReadOnce = async () => { f.calls.push("table"); throw Error("response lost"); };
    const r = await runExistingCostStepsV1(m, m.manifestSha256, f.p); assert.ok(r.failureCode); assert.equal(f.calls.filter(c => c === step).length, 1); assert.equal(r.retryAuthorized, false);
    if (step === "execute") assert.equal(f.calls.includes("table"), false);
  }
});
test("foreign CS, drift, unavailable permission, consumed slot and expiry prevent next write", async () => {
  for (const kind of ["foreign", "drift", "permission", "slot", "marker", "expiry", "budgetDrift"]) {
    const m = await reviewed(), f = ports(m), original = f.p.snapshot;
    f.p.snapshot = async () => { const v = await original(); if (kind === "foreign") v.inventory.changeSets.push({ ...v.inventory.changeSets[0], id: "foreign" }); if (kind === "drift") v.inventory.settings.table.maxWrite = 3; if (kind === "permission") v.inventory.permissionsAllowed = false; return v; };
    if (kind === "slot") f.p.claimSlot = async () => { throw Error("EEXIST"); };
    if (kind === "marker") f.p.marker = async () => { throw Error("disk failure"); };
    if (kind === "expiry") f.p.waitBudget = async () => { f.advance(); };
    if (kind === "budgetDrift") { const read = f.p.inventory; f.p.inventory = async () => { const i = await read(); i.settings.budget.notifications[0].subscribers[0].Address = "foreign@example.com"; return i; }; }
    const r = await runExistingCostStepsV1(m, m.manifestSha256, f.p); assert.ok(r.failureCode); assert.equal(f.calls.includes("table"), false);
    if (!["expiry", "budgetDrift"].includes(kind)) assert.equal(r.writeAttempts, 0);
  }
});
test("new adapter/CLI expose no cloud create/delete/grant or item writes and enforce deadline after refresh", () => {
  const source = readFileSync(new URL("../ops/aws-sandbox/scripts/existing-cost-controls-aws-v1.mjs", import.meta.url), "utf8"), cli = readFileSync(new URL("../ops/aws-sandbox/scripts/review-existing-cost-controls-v1.mjs", import.meta.url), "utf8");
  for (const forbidden of ["CreateChangeSetCommand", "DeleteChangeSetCommand", "UpdateBudgetCommand", "DeleteBudgetCommand", "PutUserPolicyCommand", "PutItemCommand", "CreateStackCommand"]) assert.equal(source.includes(forbidden), false);
  assert.match(source, /IncludePropertyValues: true/); assert.match(source, /DisableRollback: true/); assert.match(source, /maxAttempts: 1/);
  assert.match(source, /withClient\(DynamoDBClient, async c => \{\s*assertExistingCostApprovalV1/);
  assert.match(cli, /runExistingCostControlsV1/); assert.equal(cli.includes("runExistingCostStepsV1"), false);
  assert.match(cli, /scope.originalManifestFileSha256/); assert.match(cli, /scope.originalReceiptFileSha256/); assert.match(cli, /scope.originalCodeSha256/);
});
