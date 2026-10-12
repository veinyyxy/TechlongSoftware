import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { COST_CONTROL_SCOPE_V1 as s, compileCostManifestV1, validateCostManifestV1, costCandidateTemplateV1,
  costChangeSetNameV1, expectedCostSettingsV1, assertCostChangeSetV1, assertCostProgressV1, runCostControlsV1,
  type CostSettingsV1, type CostInventoryV1, type CostManifestV1, type CostPortsV1 } from "../lib/deployments/execution/sandbox-cost-controls-v1.ts";
const base = JSON.parse(readFileSync(new URL("../ops/aws-sandbox/cloudformation/guardrails.template.json", import.meta.url), "utf8"));
const now = 1791764000000, code = "a".repeat(64), tags = [{ Key: "Environment", Value: "aws-sandbox" }];
function before(): CostSettingsV1 {
  return { stack: { id: s.stackId, name: s.stackName, templateSha256: s.baseTemplateSha256, parameters: {
    ExpectedAccountId: s.accountId, ExpectedRegion: s.region, MonthlyBudgetUsd: "10", BudgetAlertEmail: "fixture@example.com",
    DeploymentTtlSeconds: "7200", MaxConcurrentDeployments: "1", SandboxDomain: "sandbox.techlong.cloud" }, tags, roleArn: null, capabilities: [], notificationArns: [],
    resources: [{ logicalId: "SandboxMonthlyCostBudget", type: "AWS::Budgets::Budget", physicalId: s.budgetName }] },
    budget: { config: { BudgetName: s.budgetName, BudgetLimit: { Amount: "10", Unit: "USD" }, BudgetType: "COST", TimeUnit: "MONTHLY", CostFilters: { TagKeyValue: ["user:Environment$aws-sandbox"] },
      CostTypes: { IncludeTax: true, IncludeSubscription: true, UseBlended: false, IncludeRefund: false, IncludeCredit: false, IncludeUpfront: true, IncludeRecurring: true, IncludeOtherSubscription: true, IncludeSupport: true, IncludeDiscount: true, UseAmortized: false },
      TimePeriod: { Start: "2026-08-01T00:00:00.000Z", End: "2087-06-15T00:00:00.000Z" } },
      notifications: [10, 30, 50, 80, 100].map(Threshold => ({ notification: { NotificationType: "ACTUAL", ComparisonOperator: "GREATER_THAN", Threshold, ThresholdType: "PERCENTAGE" }, subscribers: [{ Address: "fixture@example.com", SubscriptionType: "EMAIL" }] })),
      tags: [{ Key: "aws:cloudformation:stack-id", Value: s.stackId }], actions: [] },
    table: { id: s.tableId, arn: s.tableArn, maxRead: 5, maxWrite: 2, tags,
      config: { billingMode: "PAY_PER_REQUEST", tableClass: "STANDARD", deletionProtection: false, attributes: [{ AttributeName: "authority_key", AttributeType: "S" }], keySchema: [{ AttributeName: "authority_key", KeyType: "HASH" }], stream: null, sse: null, globalIndexes: [], localIndexes: [], replicas: [] } } };
}
function inventory(): CostInventoryV1 { return { observedAt: now, settings: before(), stackStatus: "CREATE_COMPLETE", tableStatus: "ACTIVE", permissionsAllowed: true,
  changeSets: s.oldFailedChangeSetIds.map(id => ({ id, name: id.split("/")[1], status: "FAILED", executionStatus: "UNAVAILABLE", includeNested: false })) }; }
const manifest = () => compileCostManifestV1(inventory(), base, code, now);
function reviewedChangeSet(m: CostManifestV1, arn: string) {
  return { ChangeSetId: arn, ChangeSetName: costChangeSetNameV1(m), StackId: s.stackId, StackName: s.stackName, Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", IncludeNestedStacks: false,
    Description: `Reviewed F3c3a cost controls ${m.manifestSha256}`, Parameters: Object.entries({ ...m.before.stack.parameters, MonthlyBudgetUsd: "50" }).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })),
    Tags: [...m.before.stack.tags].reverse(), Capabilities: [], Changes: [{ Type: "Resource", ResourceChange: { Action: "Modify", LogicalResourceId: "SandboxMonthlyCostBudget", PhysicalResourceId: s.budgetName, ResourceType: "AWS::Budgets::Budget", Replacement: "False", Scope: ["Properties"],
      Details: [{ Target: { Attribute: "Properties", Name: "Budget", RequiresRecreation: "Never" } }] } }] };
}
function ports(m: CostManifestV1, failAt = "") {
  let time = now, occupied = false, applied = false, created = false; const calls: string[] = [], markers = new Map<string, unknown>();
  const arn = `arn:aws:cloudformation:${s.region}:${s.accountId}:changeSet/${costChangeSetNameV1(m)}/11111111-1111-1111-1111-111111111111`;
  const attempt = (name: string) => { calls.push(name); if (failAt === name) throw Error("fixture lost response"); };
  const p: CostPortsV1 = { now: () => time,
    inventory: async () => ({ ...inventory(), observedAt: time, settings: expectedCostSettingsV1(m, applied, false), stackStatus: applied ? "UPDATE_COMPLETE" : "CREATE_COMPLETE",
      changeSets: [...(applied ? [] : inventory().changeSets), ...(created ? [{ id: arn, name: costChangeSetNameV1(m), status: "CREATE_COMPLETE", executionStatus: applied ? "EXECUTE_COMPLETE" : "AVAILABLE", includeNested: false }] : [])] }),
    claimSlot: async () => { if (occupied) throw Error("EEXIST"); occupied = true; }, marker: async (n, v) => { if (markers.has(n)) throw Error("EEXIST"); markers.set(n, v); },
    createChangeSetOnce: async () => { attempt("create"); created = true; return { changeSetArn: arn }; },
    readReviewedChangeSet: async () => { attempt("review"); assertCostChangeSetV1(m, reviewedChangeSet(m, arn), m.candidateTemplate, arn); },
    executeChangeSetOnce: async () => { attempt("execute"); applied = true; }, waitBudgetUpdate: async () => { attempt("wait"); },
    updateReadLimitOnce: async () => { attempt("table"); } };
  return { p, calls, markers, arn, advance: (n: number) => { time += n; } };
}
test("three writes use CloudFormation budget ownership then exact table; no runtime", async () => { const m = await manifest(), f = ports(m), r = await runCostControlsV1(m, m.manifestSha256, base, code, f.p);
  assert.equal(r.failureCode, null); assert.equal(r.writeAttempts, 3); assert.equal(r.slotConsumed, true); assert.deepEqual(f.calls, ["create", "review", "execute", "wait", "table"]); assert.equal(r.runtimeEnabled, false); assert.equal(r.retryAuthorized, false); assert.ok(f.markers.has("budget-verified.json")); });
test("candidate changes only fixed 50 parameter bounds and pins existing time period", async () => { const b = before(), copy = structuredClone(base), candidate = await costCandidateTemplateV1(base, b);
  copy.Parameters.MonthlyBudgetUsd = { ...copy.Parameters.MonthlyBudgetUsd, Default: 50, MinValue: 50, MaxValue: 50, AllowedValues: [50] }; copy.Resources.SandboxMonthlyCostBudget.Properties.Budget.TimePeriod = b.budget.config.TimePeriod;
  assert.equal(canonicalJson(candidate), canonicalJson(copy)); assert.equal(await sha256Hex(base), s.baseTemplateSha256); assert.deepEqual(Object.keys(candidate.Resources), ["SandboxMonthlyCostBudget"]); });
test("wrong/expired approval and NaN clock have no slot or writes", async () => { for (const kind of ["sha", "expired", "clock"]) { const m = await manifest(), f = ports(m); if (kind === "expired") f.advance(3600000); if (kind === "clock") f.p.now = () => NaN;
  const r = await runCostControlsV1(m, kind === "sha" ? "f".repeat(64) : m.manifestSha256, base, code, f.p); assert.equal(r.slotConsumed, false); assert.equal(r.writeAttempts, 0); assert.equal(f.calls.length, 0); } });
test("current before state, owner, permissions and timestamp drift stop preflight", async () => { for (const kind of ["id", "email", "limit", "permission", "future", "stale", "foreign"]) { const m = await manifest(), f = ports(m), original = f.p.inventory;
  f.p.inventory = async b => { const i = await original(b); if (kind === "id") i.settings.table.id = "foreign"; if (kind === "email") i.settings.stack.parameters.BudgetAlertEmail = "foreign@example.com"; if (kind === "limit") i.settings.table.maxWrite = 3; if (kind === "permission") i.permissionsAllowed = false; if (kind === "future") i.observedAt += 1; if (kind === "stale") i.observedAt -= 30001; if (kind === "foreign") i.changeSets.push({ ...i.changeSets[0], id: "foreign" }); return i; };
  const r = await runCostControlsV1(m, m.manifestSha256, base, code, f.p); assert.equal(r.slotConsumed, false); assert.equal(r.writeAttempts, 0); } });
test("review rejects active/foreign Change Sets, changed alerts, budget modes and table writes", async () => { for (const kind of ["active", "email", "action", "billing", "limit", "owner"]) { const i = inventory();
  if (kind === "active") i.changeSets[0].status = "CREATE_COMPLETE"; if (kind === "email") i.settings.budget.notifications[0].subscribers[0].Address = "foreign@example.com";
  if (kind === "action") i.settings.budget.actions.push({ action: "x" }); if (kind === "billing") i.settings.table.config.billingMode = "PROVISIONED"; if (kind === "limit") i.settings.table.maxWrite = 10; if (kind === "owner") i.settings.stack.roleArn = "foreign";
  await assert.rejects(compileCostManifestV1(i, base, code, now), /COST_CONTROL_/); } });
test("manifest tampering/code drift and base-template drift never validate", async () => { const m = await manifest(); await assert.rejects(validateCostManifestV1(m, base, "b".repeat(64)));
  const altered = structuredClone(m); Object.assign(altered.scope, { maximumDirectWriteAttempts: 4 }); await assert.rejects(validateCostManifestV1(altered, base, code)); const t = structuredClone(base); t.Resources.Foreign = { Type: "AWS::IAM::Role" }; await assert.rejects(costCandidateTemplateV1(t, before())); });
test("resource addition, replacement, IAM capability and wrong property never execute", async () => { const m = await manifest(), f = ports(m); for (const kind of ["addition", "replacement", "iam", "property", "template", "region", "previous"]) {
  const c = reviewedChangeSet(m, f.arn); if (kind === "addition") c.Changes.push(c.Changes[0]); if (kind === "replacement") c.Changes[0].ResourceChange.Replacement = "True";
  if (kind === "iam") c.Capabilities.push("CAPABILITY_IAM" as never); if (kind === "property") c.Changes[0].ResourceChange.Details[0].Target.Name = "NotificationsWithSubscribers"; if (kind === "region") Object.assign(c, { StackId: s.stackId.replace("ca-central-1", "us-east-1") });
  if (kind === "previous") Object.assign(c.Parameters[0], { UsePreviousValue: true }); const t = structuredClone(m.candidateTemplate); if (kind === "template") Object.assign(t, { Description: "foreign" });
  assert.throws(() => assertCostChangeSetV1(m, c, t, f.arn), /COST_CONTROL_/); } });
test("consumed slot and durable marker failures do not reach next write", async () => { const m = await manifest(); for (const marker of ["approved-manifest.json", "create-attempt.json", "create-confirmed.json", "changeset-reviewed.json", "execute-confirmed.json", "budget-verified.json", "read-limit-attempt.json"]) {
  const f = ports(m), original = f.p.marker; f.p.marker = async (n, v) => { if (n === marker) throw Error("disk failure"); await original(n, v); }; const r = await runCostControlsV1(m, m.manifestSha256, base, code, f.p); assert.ok(r.failureCode); assert.equal(f.calls.includes("table"), false); }
  const f = ports(m); f.p.claimSlot = async () => { throw Error("EEXIST"); }; assert.equal((await runCostControlsV1(m, m.manifestSha256, base, code, f.p)).writeAttempts, 0); });
test("each lost response stops without write retry or compensation", async () => { for (const [step, writes] of [["create", 1], ["execute", 2], ["table", 3]] as const) { const m = await manifest(), f = ports(m, step), r = await runCostControlsV1(m, m.manifestSha256, base, code, f.p);
  assert.equal(r.writeAttempts, writes); assert.ok(r.failureCode); assert.equal(f.calls.filter(c => c === step).length, 1); assert.equal(r.retryAuthorized, false); } });
test("unreviewed created plan and failed budget settlement stop before table", async () => { for (const stage of ["review", "wait"]) { const m = await manifest(), f = ports(m, stage), r = await runCostControlsV1(m, m.manifestSha256, base, code, f.p); assert.ok(r.failureCode); assert.equal(f.calls.includes("table"), false); } });
test("expiry during creation and budget wait prevents subsequent writes", async () => { for (const stage of ["review", "wait"]) { const m = await manifest(), f = ports(m), original = stage === "review" ? f.p.readReviewedChangeSet : f.p.waitBudgetUpdate;
  if (stage === "review") f.p.readReviewedChangeSet = async (a, b) => { await original(a, b); f.advance(3600000); }; else f.p.waitBudgetUpdate = async (a, b) => { await original(a, b); f.advance(3600000); };
  const r = await runCostControlsV1(m, m.manifestSha256, base, code, f.p); assert.ok(r.failureCode); assert.equal(f.calls.includes("table"), false); if (stage === "review") assert.equal(f.calls.includes("execute"), false); } });
test("complete state preserves alerts, period, table identity and write limit", async () => { const m = await manifest(), f = ports(m), i = inventory(); i.settings = expectedCostSettingsV1(m, true, true); i.stackStatus = "UPDATE_COMPLETE"; i.changeSets = [{ id: f.arn, name: costChangeSetNameV1(m), status: "CREATE_COMPLETE", executionStatus: "EXECUTE_COMPLETE", includeNested: false }];
  assert.doesNotThrow(() => assertCostProgressV1(m, i, "complete", f.arn)); i.settings.table.maxWrite = 3; assert.throws(() => assertCostProgressV1(m, i, "complete", f.arn)); });
test("adapter exposes no direct budget update, item mutation, role grant or paid Cell calls", () => { const source = readFileSync(new URL("../ops/aws-sandbox/scripts/sandbox-cost-controls-aws-v1.mjs", import.meta.url), "utf8");
  for (const forbidden of ["UpdateBudgetCommand", '"update-budget"', "PutItemCommand", "DeleteTableCommand", "DeleteChangeSetCommand", "PutUserPolicyCommand", "CreateStackCommand", "UpdateStackCommand", "RunTaskCommand", "GetSecretValueCommand"]) assert.equal(source.includes(forbidden), false);
  assert.match(source, /DisableRollback:true/); assert.match(source, /MaxReadRequestUnits:100,MaxWriteRequestUnits:2/); assert.match(source, /withClient\(DynamoDBClient,async c=>\{deadline\(m\)/); assert.match(source, /withClient\(CloudFormationClient,async c=>\{deadline\(m\)/); assert.match(source, /maxAttempts:1/); assert.match(source, /AWS_MAX_ATTEMPTS:"1"/); });
