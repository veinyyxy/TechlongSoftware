import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalJson } from "../lib/deployments/execution/hash.ts";
import { COST_CONTROL_SCOPE_V1 as old, type CostManifestV1, type CostSettingsV1 } from "../lib/deployments/execution/sandbox-cost-controls-v1.ts";
import { COST_RECOVERY_SCOPE_V1 as s, expectedFailedCostSettingsV1, assertRecoveryBeforeV1, assertRecoveryApprovalV1,
  recoveryRestoredV1, recoveryTokenV1, draftDirectCostPayloadV1, runReviewedRecoveryStepsV1,
  type RecoveryManifestV1, type RecoverySnapshotV1, type RecoveryPortsV1 } from "../lib/deployments/execution/cost-stack-recovery-v1.ts";
const now = 1791800000000;
const original = { before: { stack: { id: old.stackId, parameters: { MonthlyBudgetUsd: "10" }, templateSha256: old.baseTemplateSha256, tags: [] },
  budget: { config: { BudgetName: old.budgetName, BudgetLimit: { Amount: "10", Unit: "USD" }, BudgetType: "COST", TimeUnit: "MONTHLY", CostFilters: { TagKeyValue: ["user:Environment$aws-sandbox"] }, CostTypes: { IncludeTax: true },
    TimePeriod: { Start: s.acceptedPostRecoveryStarts[0], End: "2087-06-15T00:00:00.000Z" } }, notifications: [{ fixture: "bound" }], tags: [], actions: [] },
  table: { id: old.tableId, arn: old.tableArn, maxRead: 5, maxWrite: 2, config: {}, tags: [] } } as unknown as CostSettingsV1,
  candidateTemplateSha256: "c".repeat(64) } as CostManifestV1;
// Fixtures exercise guards/flow; production entry separately validates the actual signed historical manifest.
const manifest = { scope: s, originalManifest: original, before: expectedFailedCostSettingsV1(original), reviewedAt: now, expiresAt: now + 3600000, manifestSha256: "a".repeat(64) } as RecoveryManifestV1;
function snapshot(time = now): RecoverySnapshotV1 {
  const stableEvent = { id: s.stableEventId, at: s.stableEventTimestamp, status: "CREATE_COMPLETE", token: "legacy-token-is-not-a-new-approval" };
  const failed = { id: s.failedEventId, at: s.failedEventTimestamp, status: "UPDATE_FAILED", token: s.failedRequestToken };
  return { observedAt: time, inventory: { observedAt: time, settings: expectedFailedCostSettingsV1(original), stackStatus: "UPDATE_FAILED", tableStatus: "ACTIVE", changeSets: [], permissionsAllowed: false },
    disableRollback: true, stableEvent, latestStackEvent: failed, stackEvents: [failed, stableEvent], permissionsAllowed: true,
    changeSets: s.trackedChangeSetIds.map((id, n) => ({ id, present: true, status: n === 2 ? "CREATE_COMPLETE" : "FAILED", executionStatus: n === 2 ? "EXECUTE_FAILED" : "OBSOLETE" })) };
}
function restored(time = now) {
  const v = snapshot(time); v.inventory.stackStatus = "UPDATE_ROLLBACK_COMPLETE";
  v.inventory.settings = structuredClone(original.before); v.inventory.settings.budget.config.TimePeriod = { Start: s.acceptedPostRecoveryStarts[1], End: "2087-06-15T00:00:00.000Z" };
  v.stackEvents.unshift({ id: "new-completion", at: new Date(time).toISOString(), status: "UPDATE_ROLLBACK_COMPLETE", token: recoveryTokenV1(manifest) });
  return v;
}
function ports() {
  let time = now, submitted = false; const calls: string[] = [], markers = new Map<string, unknown>();
  const p: RecoveryPortsV1 = { now: () => time, snapshot: async () => submitted ? restored(time) : snapshot(time), claimSlot: async () => {},
    marker: async (n, v) => { if (markers.has(n)) throw Error("EEXIST"); markers.set(n, v); },
    rollbackOnce: async () => { calls.push("rollback"); submitted = true; return { stackId: s.stackId, operationId: "one-operation" }; }, waitRestored: async () => { calls.push("wait"); } };
  return { p, calls, markers, expire: () => { time += 3600000; } };
}
test("preflight binds failed state, precise stable/failure events and directly described obsolete records", () => {
  assert.doesNotThrow(() => assertRecoveryBeforeV1(original, snapshot(), now));
  for (const kind of ["stable", "latest", "sourceToken", "table", "period", "foreign", "record", "permission", "stale"]) {
    const v = snapshot(); if (kind === "stable") v.stableEvent = null; if (kind === "latest") v.latestStackEvent!.id = "foreign"; if (kind === "sourceToken") v.latestStackEvent!.token = "other-operation";
    if (kind === "table") v.inventory.settings.table.id = "foreign"; if (kind === "period") v.inventory.settings.budget.config.TimePeriod = { Start: "foreign", End: "foreign" };
    if (kind === "foreign") v.inventory.changeSets.push({ id: "foreign", name: "foreign", status: "CREATE_COMPLETE", executionStatus: "AVAILABLE", includeNested: false });
    if (kind === "record") v.changeSets[0].executionStatus = "UNAVAILABLE"; if (kind === "permission") v.permissionsAllowed = false; if (kind === "stale") v.observedAt -= 30001;
    assert.throws(() => assertRecoveryBeforeV1(original, v, now), /COST_RECOVERY_/);
  }
});
test("new SHA and deadline reject expired, old or malformed approval before writes", async () => {
  assert.throws(() => assertRecoveryApprovalV1(manifest, "b".repeat(64), now));
  for (const t of [NaN, now - 1, manifest.expiresAt]) assert.throws(() => assertRecoveryApprovalV1(manifest, manifest.manifestSha256, t));
  const f = ports(); f.expire(); const r = await runReviewedRecoveryStepsV1(manifest, manifest.manifestSha256, f.p); assert.equal(r.writeAttempts, 0); assert.equal(r.slotConsumed, false); assert.equal(f.calls.length, 0);
});
test("approved recovery flow has one explicit rollback, not a budget/table update", async () => {
  const f = ports(), r = await runReviewedRecoveryStepsV1(manifest, manifest.manifestSha256, f.p);
  assert.equal(r.failureCode, null); assert.equal(r.writeAttempts, 1); assert.deepEqual(f.calls, ["rollback", "wait"]); assert.ok(f.markers.has("restoration-verified.json")); assert.equal(r.directBudgetUpdateAuthorized, false); assert.equal(r.tableUpdateAuthorized, false);
});
test("lost response, failure and permanent/marker failures never trigger retry or follow-on writes", async () => {
  for (const kind of ["lost", "wait", "slot", "marker"]) {
    const f = ports(); if (kind === "lost") f.p.rollbackOnce = async () => { f.calls.push("rollback"); throw Error("lost response"); };
    if (kind === "wait") f.p.waitRestored = async () => { throw Error("failure"); };
    if (kind === "slot") f.p.claimSlot = async () => { throw Error("EEXIST"); };
    if (kind === "marker") f.p.marker = async () => { throw Error("disk failure"); };
    const r = await runReviewedRecoveryStepsV1(manifest, manifest.manifestSha256, f.p); assert.ok(r.failureCode); assert.equal(r.retryAuthorized, false); assert.ok(f.calls.filter(x => x === "rollback").length <= 1);
    if (["slot", "marker"].includes(kind)) assert.equal(r.writeAttempts, 0);
  }
});
test("poststate requires exact restored settings and same operation completion, not merely COMPLETE", () => {
  assert.equal(recoveryRestoredV1(manifest, restored()), true);
  for (const kind of ["token", "period", "budget", "table", "template", "alert", "activeCs"]) {
    const v = restored(); if (kind === "token") v.stackEvents[0].token = "foreign"; if (kind === "period") v.inventory.settings.budget.config.TimePeriod = { Start: "2026-11-01T00:00:00.000Z", End: "2087-06-15T00:00:00.000Z" };
    if (kind === "budget") v.inventory.settings.budget.config.BudgetLimit = { Amount: "50", Unit: "USD" }; if (kind === "table") v.inventory.settings.table.maxWrite = 3;
    if (kind === "template") v.inventory.settings.stack.templateSha256 = "foreign"; if (kind === "alert") v.inventory.settings.budget.notifications = [];
    if (kind === "activeCs") v.changeSets[2].executionStatus = "AVAILABLE";
    assert.equal(recoveryRestoredV1(manifest, v), false);
  }
});
test("direct API draft preserves observed period/types/filter and changes only limit; never sends read-only fields", () => {
  const settings = expectedFailedCostSettingsV1(original), d = draftDirectCostPayloadV1(settings), expected = structuredClone(settings.budget.config);
  expected.BudgetLimit = { Amount: "50", Unit: "USD" }; expected.TimePeriod = { Start: Date.parse(s.acceptedPostRecoveryStarts[1]) / 1000, End: Date.parse("2087-06-15T00:00:00.000Z") / 1000 };
  assert.equal(canonicalJson(d.budget.NewBudget), canonicalJson(expected)); assert.deepEqual(d.table.OnDemandThroughput, { MaxReadRequestUnits: 100, MaxWriteRequestUnits: 2 });
  assert.equal(d.executionAuthorized, false); assert.equal(d.recompileAfterVerifiedRecoveryRequired, true); assert.equal(d.cfnOwnershipRetainedNotDetached, true); assert.equal(d.explicitAmountDriftWouldRemain, true);
  settings.budget.config.CalculatedSpend = { ActualSpend: 0 }; assert.throws(() => draftDirectCostPayloadV1(settings));
});
test("recovery adapter contains only RollbackStack mutation and preserves old entrypoints/bindings", () => {
  const source = readFileSync(new URL("../ops/aws-sandbox/scripts/cost-stack-recovery-aws-v1.mjs", import.meta.url), "utf8"), cli = readFileSync(new URL("../ops/aws-sandbox/scripts/review-cost-stack-recovery-v1.mjs", import.meta.url), "utf8");
  for (const forbidden of ["UpdateBudgetCommand", "UpdateTableCommand", "UpdateStackCommand", "DeleteStackCommand", "CreateChangeSetCommand", "ExecuteChangeSetCommand", "PutUserPolicyCommand", '"update-budget"', '"update-table"']) assert.equal(source.includes(forbidden), false);
  assert.match(source, /RollbackStackCommand/); assert.match(source, /maxAttempts: 1/); assert.match(source, /assertRecoveryApprovalV1\(m, m.manifestSha256, Date.now\(\)\); assertRecoveryFreshV1/);
  assert.match(cli, /scope.previousReceiptSha256/); assert.match(cli, /scope.previousCodeSha256/); assert.equal(cli.includes("runReviewedRecoveryStepsV1"), false);
});
