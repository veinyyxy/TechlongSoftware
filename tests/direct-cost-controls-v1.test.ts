import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalJson } from "../lib/deployments/execution/hash.ts";
import { COST_CONTROL_SCOPE_V1 as old, type CostSettingsV1 } from "../lib/deployments/execution/sandbox-cost-controls-v1.ts";
import { COST_RECOVERY_SCOPE_V1 as recoveryScope, draftDirectCostPayloadV1, type RecoverySnapshotV1 } from "../lib/deployments/execution/cost-stack-recovery-v1.ts";
import { DIRECT_COST_SCOPE_V1 as s, assertDirectPhaseV1, assertDirectApprovalV1, directExpectedSettingsV1, runReviewedDirectCostStepsV1, type DirectCostManifestV1, type DirectCostPortsV1 } from "../lib/deployments/execution/direct-cost-controls-v1.ts";
const now = 1791819000000;
const before = { stack: { id: old.stackId, parameters: { MonthlyBudgetUsd: "10" }, templateSha256: old.baseTemplateSha256, tags: [] },
  budget: { config: { BudgetName: old.budgetName, BudgetLimit: { Amount: "10", Unit: "USD" }, BudgetType: "COST", TimeUnit: "MONTHLY", CostFilters: { TagKeyValue: ["user:Environment$aws-sandbox"] }, CostTypes: { IncludeTax: true }, TimePeriod: s.budgetTimePeriod }, notifications: [{ fixture: "original alerts" }], tags: [], actions: [] },
  table: { id: old.tableId, arn: old.tableArn, maxRead: 5, maxWrite: 2, config: {}, tags: [] } } as unknown as CostSettingsV1;
const draft = draftDirectCostPayloadV1(before);
// Flow fixture only. The actual CLI validates the pinned historical manifests before using this seam.
const m = { before, scope: s, budgetRequest: draft.budget, tableRequest: draft.table, reviewedAt: now, expiresAt: now + 3600000, manifestSha256: "a".repeat(64) } as DirectCostManifestV1;
function snapshot(phase: "before" | "budget" | "complete" = "before", time = now): RecoverySnapshotV1 {
  return { observedAt: time, inventory: { observedAt: time, settings: directExpectedSettingsV1(m, phase), stackStatus: s.stackStatus, tableStatus: "ACTIVE", changeSets: [], permissionsAllowed: false },
    disableRollback: true, permissionsAllowed: true, stableEvent: structuredClone(s.completedEvent), latestStackEvent: structuredClone(s.completedEvent), stackEvents: [structuredClone(s.completedEvent)],
    changeSets: recoveryScope.trackedChangeSetIds.map((id, n) => ({ id, present: true, status: n === 2 ? "CREATE_COMPLETE" : "FAILED", executionStatus: n === 2 ? "EXECUTE_FAILED" : "OBSOLETE" })) };
}
function ports() {
  let time = now, phase: "before" | "budget" | "complete" = "before"; const calls: string[] = [], markers = new Map<string, unknown>();
  const p: DirectCostPortsV1 = { now: () => time, snapshot: async () => snapshot(phase, time), claimSlot: async () => {}, marker: async (n, v) => { if (markers.has(n)) throw Error("EEXIST"); markers.set(n, v); },
    updateBudgetOnce: async () => { calls.push("budget"); phase = "budget"; }, waitBudget: async () => { calls.push("budgetWait"); },
    updateTableOnce: async () => { calls.push("table"); phase = "complete"; }, waitTable: async () => { calls.push("tableWait"); } };
  return { p, calls, markers, expire: () => { time += 3600000; } };
}
test("two writes are ordered budget then table, with explicit CFN amount drift marker", async () => {
  const f = ports(), r = await runReviewedDirectCostStepsV1(m, m.manifestSha256, f.p);
  assert.equal(r.failureCode, null); assert.equal(r.writeAttempts, 2); assert.deepEqual(f.calls, ["budget", "budgetWait", "table", "tableWait"]);
  assert.ok(f.markers.has("budget-verified.json")); assert.ok(f.markers.has("explicit-override-verified.json")); assert.equal(r.runtimeEnabled, false);
});
test("complete state keeps CFN10 while actual budget50/read100, all other bound fields unchanged", () => {
  const v = snapshot("complete"); assert.doesNotThrow(() => assertDirectPhaseV1(m, v, "complete"));
  assert.equal(v.inventory.settings.stack.parameters.MonthlyBudgetUsd, "10"); assert.deepEqual(v.inventory.settings.budget.config.BudgetLimit, { Amount: "50", Unit: "USD" }); assert.equal(v.inventory.settings.table.maxRead, 100);
  for (const kind of ["period", "tag", "alert", "write", "id", "cfn", "event", "cs"]) {
    const v = snapshot("complete"); if (kind === "period") v.inventory.settings.budget.config.TimePeriod = { Start: "2026-08-01T00:00:00.000Z", End: s.budgetTimePeriod.End };
    if (kind === "tag") v.inventory.settings.budget.tags.push({ Key: "foreign", Value: "foreign" }); if (kind === "alert") v.inventory.settings.budget.notifications = [];
    if (kind === "write") v.inventory.settings.table.maxWrite = 3; if (kind === "id") v.inventory.settings.table.id = "foreign"; if (kind === "cfn") v.inventory.settings.stack.parameters.MonthlyBudgetUsd = "50";
    if (kind === "event") v.latestStackEvent!.token = "another-operation"; if (kind === "cs") v.changeSets[0].executionStatus = "AVAILABLE";
    assert.throws(() => assertDirectPhaseV1(m, v, "complete"), /DIRECT_COST_/);
  }
});
test("expired/wrong approval, stale read and unavailable permissions have zero writes", async () => {
  for (const kind of ["sha", "expiry", "stale", "permission"]) {
    const f = ports(), original = f.p.snapshot; if (kind === "expiry") f.expire();
    f.p.snapshot = async p => { const v = await original(p); if (kind === "stale") v.observedAt -= 30001; if (kind === "permission") v.permissionsAllowed = false; return v; };
    const r = await runReviewedDirectCostStepsV1(m, kind === "sha" ? "b".repeat(64) : m.manifestSha256, f.p); assert.equal(r.writeAttempts, 0); assert.equal(r.slotConsumed, false);
  }
  assert.throws(() => assertDirectApprovalV1(m, m.manifestSha256, NaN));
});
test("partial/lost budget response and post-budget config drift stop before table without retry", async () => {
  for (const kind of ["lost", "pending", "drift", "expiry"]) {
    const f = ports(); if (kind === "lost") f.p.updateBudgetOnce = async () => { f.calls.push("budget"); throw Error("response lost"); };
    if (kind === "pending") f.p.waitBudget = async () => { throw Error("pending"); };
    if (kind === "expiry") f.p.waitBudget = async () => { f.expire(); };
    if (kind === "drift") { const read = f.p.snapshot; f.p.snapshot = async p => { const v = await read(p); if (v.inventory.settings.budget.config.BudgetLimit && (v.inventory.settings.budget.config.BudgetLimit as { Amount: string }).Amount === "50") v.inventory.settings.budget.tags.push({ Key: "new", Value: "foreign" }); return v; }; }
    const r = await runReviewedDirectCostStepsV1(m, m.manifestSha256, f.p); assert.ok(r.failureCode); assert.equal(f.calls.includes("table"), false); assert.equal(r.retryAuthorized, false);
    assert.equal(f.calls.filter(x => x === "budget").length, 1);
  }
});
test("table response loss and wait failure do not roll back budget or retry", async () => {
  for (const kind of ["lost", "pending"]) {
    const f = ports(); if (kind === "lost") f.p.updateTableOnce = async () => { f.calls.push("table"); throw Error("lost response"); }; else f.p.waitTable = async () => { throw Error("pending"); };
    const r = await runReviewedDirectCostStepsV1(m, m.manifestSha256, f.p); assert.ok(r.failureCode); assert.equal(r.writeAttempts, 2); assert.equal(f.calls.filter(x => x === "table").length, 1); assert.equal(r.retryAuthorized, false);
  }
});
test("consumed slot and marker failure block next write", async () => {
  for (const marker of ["slot", "approved-manifest.json", "budget-attempt.json", "budget-confirmed.json", "budget-verified.json", "table-attempt.json"]) {
    const f = ports(), write = f.p.marker; if (marker === "slot") f.p.claimSlot = async () => { throw Error("EEXIST"); }; else f.p.marker = async (n, v) => { if (n === marker) throw Error("disk failure"); await write(n, v); };
    const r = await runReviewedDirectCostStepsV1(m, m.manifestSha256, f.p); assert.ok(r.failureCode); assert.equal(f.calls.includes("table"), false);
  }
});
test("budget request keeps writable fields only and precise existing numeric timestamps", () => {
  const e = structuredClone(before.budget.config); e.BudgetLimit = { Amount: "50", Unit: "USD" }; e.TimePeriod = { Start: Date.parse(s.budgetTimePeriod.Start) / 1000, End: Date.parse(s.budgetTimePeriod.End) / 1000 };
  assert.equal(canonicalJson(m.budgetRequest.NewBudget), canonicalJson(e)); assert.equal(m.budgetRequest.AccountId, s.accountId); assert.deepEqual(m.tableRequest, { TableName: s.tableName, OnDemandThroughput: { MaxReadRequestUnits: 100, MaxWriteRequestUnits: 2 } });
  assert.equal("CalculatedSpend" in m.budgetRequest.NewBudget, false); assert.equal("NotificationsWithSubscribers" in m.budgetRequest.NewBudget, false);
});
test("native adapter has only exact budget/table writes, maxAttempts1 and post-refresh deadline checks", () => {
  const source = readFileSync(new URL("../ops/aws-sandbox/scripts/direct-cost-controls-aws-v1.mjs", import.meta.url), "utf8"), cli = readFileSync(new URL("../ops/aws-sandbox/scripts/review-direct-cost-controls-v1.mjs", import.meta.url), "utf8");
  for (const forbidden of ["RollbackStackCommand", "UpdateStackCommand", "ExecuteChangeSetCommand", "CreateChangeSetCommand", "DeleteBudgetCommand", '"delete-budget"', '"create-budget"', "PutItemCommand", "DeleteTableCommand", "PutUserPolicyCommand"]) assert.equal(source.includes(forbidden), false);
  assert.match(source, /nativeBudget\("update-budget", m, v\)/); assert.match(source, /AWS_MAX_ATTEMPTS: "1"/); assert.match(source, /maxAttempts: 1/);
  assert.match(source, /const credentials = await session\(\)/); assert.match(source, /if \(kind === "update-budget"\) \{ assertDirectApprovalV1/);
  assert.match(source, /withClient\(DynamoDBClient, async c => \{\s*assertDirectApprovalV1/); assert.match(cli, /s.recoveryVerifyFileSha256/); assert.match(cli, /runDirectCostControlsV1/); assert.equal(cli.includes("runReviewedDirectCostStepsV1"), false);
});
