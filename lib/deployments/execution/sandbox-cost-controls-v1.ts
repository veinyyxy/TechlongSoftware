import { canonicalJson, sha256Hex } from "./hash.ts";

export const COST_CONTROL_SCOPE_V1 = Object.freeze({
  accountId: "402010193138", region: "ca-central-1", sourceUserId: "AIDAV3GNMXTZEO7SHLC2X",
  sourceArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev",
  stackId: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-cost-guardrails/b91bb3d0-9424-11f1-8b02-02a8988b0b23",
  stackName: "techlong-cost-guardrails", budgetName: "techlong-sandbox-402010193138-ca-central-1",
  tableName: "techlong-sandbox-tenant-external-epoch-authority",
  tableArn: "arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority",
  tableId: "58c851f4-5b8e-45ce-8933-05c33b17fb21",
  baseTemplateSha256: "81fbf96d996ee84f5b1ac2337442f0b931815b24a24995b5c73d952097728cdf",
  oldFailedChangeSetIds: [
    "arn:aws:cloudformation:ca-central-1:402010193138:changeSet/awscli-cloudformation-package-deploy-1786302438/652e5dd5-e04b-4d8f-b7ee-04af0b2c52d9",
    "arn:aws:cloudformation:ca-central-1:402010193138:changeSet/awscli-cloudformation-package-deploy-1786306192/f3adc3b8-2caa-4280-b697-aec9c934ed2e",
  ],
  fromBudgetUsd: 10, toBudgetUsd: 50, fromReadUnits: 5, toReadUnits: 100, writeUnits: 2,
  maximumDirectWriteAttempts: 3, budgetIsAlertOnlyNotHardCap: true,
  readLimitIsBestEffortNotGuaranteedCeiling: true, noGuaranteedThroughputOrMonthlyBill: true,
  cloudFormationMayDeleteExactTwoOldFailedChangeSets: true,
  disableRollbackOnExecution: true, noAutomaticRollbackFillDeleteResetOrWriteRetry: true,
  noIamSecretDatabaseItemsLambdaCellOrRuntimeChanges: true,
  permanentSlot: "techlong-f3c3a-sandbox-cost-controls-v1-consumed",
});
Object.freeze(COST_CONTROL_SCOPE_V1.oldFailedChangeSetIds);
type Json = Record<string, unknown>;
export interface CostSettingsV1 {
  stack: { id: string; name: string; parameters: Record<string, string>; templateSha256: string;
    tags: { Key: string; Value: string }[]; roleArn: string | null; capabilities: string[]; notificationArns: string[];
    resources: { logicalId: string; type: string; physicalId: string }[] };
  budget: { config: Json; notifications: { notification: Json; subscribers: { Address: string; SubscriptionType: string }[] }[];
    tags: { Key: string; Value: string }[]; actions: unknown[] };
  table: { id: string; arn: string; config: Json; maxRead: number; maxWrite: number; tags: { Key: string; Value: string }[] };
}
export interface CostChangeSetSummaryV1 { id: string; name: string; status: string; executionStatus: string; includeNested: boolean }
export interface CostInventoryV1 { observedAt: number; settings: CostSettingsV1; stackStatus: string; tableStatus: string;
  changeSets: CostChangeSetSummaryV1[]; permissionsAllowed: boolean }
export interface CostManifestV1 { schemaVersion: 1; protocol: "sandbox-cost-controls-v1"; reviewedAt: number; expiresAt: number;
  codeSha256: string; scope: typeof COST_CONTROL_SCOPE_V1; before: CostSettingsV1; oldChangeSets: CostChangeSetSummaryV1[];
  candidateTemplate: Json; candidateTemplateSha256: string; manifestSha256: string }
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b), digest = /^[a-f0-9]{64}$/;
const exact = (v: unknown, keys: string[]) => !!v && typeof v === "object" && !Array.isArray(v) && equal(Object.keys(v).sort(), [...keys].sort());
function fail(code: string): never { throw Error(code); }
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function assertBefore(s: CostSettingsV1) {
  const scope = COST_CONTROL_SCOPE_V1, b = s.budget.config;
  if (!exact(s, ["stack", "budget", "table"]) || !exact(s.stack, ["id", "name", "parameters", "templateSha256", "tags", "roleArn", "capabilities", "notificationArns", "resources"]) ||
    !exact(s.budget, ["config", "notifications", "tags", "actions"]) || !exact(s.table, ["id", "arn", "config", "maxRead", "maxWrite", "tags"]) ||
    s.stack.id !== scope.stackId || s.stack.name !== scope.stackName || s.stack.templateSha256 !== scope.baseTemplateSha256 || s.stack.roleArn !== null || s.stack.capabilities.length || s.stack.notificationArns.length ||
    !equal(s.stack.resources, [{ logicalId: "SandboxMonthlyCostBudget", type: "AWS::Budgets::Budget", physicalId: scope.budgetName }]) ||
    !exact(s.stack.parameters, ["ExpectedAccountId", "ExpectedRegion", "MonthlyBudgetUsd", "BudgetAlertEmail", "DeploymentTtlSeconds", "MaxConcurrentDeployments", "SandboxDomain"]) ||
    s.stack.parameters.ExpectedAccountId !== scope.accountId || s.stack.parameters.ExpectedRegion !== scope.region || s.stack.parameters.MonthlyBudgetUsd !== "10" ||
    s.stack.parameters.DeploymentTtlSeconds !== "7200" || s.stack.parameters.MaxConcurrentDeployments !== "1" || s.stack.parameters.SandboxDomain !== "sandbox.techlong.cloud" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.stack.parameters.BudgetAlertEmail) ||
    !exact(b, ["BudgetName", "BudgetLimit", "BudgetType", "TimeUnit", "CostFilters", "CostTypes", "TimePeriod"]) || b.BudgetName !== scope.budgetName || b.BudgetType !== "COST" || b.TimeUnit !== "MONTHLY" ||
    !equal(b.BudgetLimit, { Amount: "10", Unit: "USD" }) || !equal(b.CostFilters, { TagKeyValue: ["user:Environment$aws-sandbox"] }) ||
    !equal(b.CostTypes, { IncludeTax: true, IncludeSubscription: true, UseBlended: false, IncludeRefund: false, IncludeCredit: false, IncludeUpfront: true, IncludeRecurring: true, IncludeOtherSubscription: true, IncludeSupport: true, IncludeDiscount: true, UseAmortized: false }) ||
    !exact(b.TimePeriod, ["Start", "End"]) || !Object.values(b.TimePeriod as Json).every(v => typeof v === "string" && Number.isFinite(Date.parse(v))) ||
    s.budget.actions.length || s.budget.notifications.length !== 5 || s.table.id !== scope.tableId || s.table.arn !== scope.tableArn || s.table.maxRead !== 5 || s.table.maxWrite !== 2 ||
    !equal(s.table.config, { billingMode: "PAY_PER_REQUEST", tableClass: "STANDARD", deletionProtection: false, attributes: [{ AttributeName: "authority_key", AttributeType: "S" }], keySchema: [{ AttributeName: "authority_key", KeyType: "HASH" }], stream: null, sse: null, globalIndexes: [], localIndexes: [], replicas: [] })) fail("COST_CONTROL_PRESTATE_UNVERIFIED");
  const expectedThresholds = [10, 30, 50, 80, 100];
  if (!equal(s.budget.notifications.map(n => n.notification.Threshold), expectedThresholds) || s.budget.notifications.some(n =>
    !equal(n.notification, { NotificationType: "ACTUAL", ComparisonOperator: "GREATER_THAN", Threshold: n.notification.Threshold, ThresholdType: "PERCENTAGE" }) ||
    !equal(n.subscribers, [{ Address: s.stack.parameters.BudgetAlertEmail, SubscriptionType: "EMAIL" }])) ||
    s.budget.tags.find(t => t.Key === "aws:cloudformation:stack-id")?.Value !== scope.stackId) fail("COST_CONTROL_ALERT_OR_OWNER_UNVERIFIED");
}
function oldSets(sets: CostChangeSetSummaryV1[]) {
  if (!equal(sets.map(x => x.id).sort(), [...COST_CONTROL_SCOPE_V1.oldFailedChangeSetIds].sort()) ||
    sets.some(x => !exact(x, ["id", "name", "status", "executionStatus", "includeNested"]) || x.status !== "FAILED" || x.executionStatus !== "UNAVAILABLE" || x.includeNested)) fail("COST_CONTROL_FOREIGN_CHANGESET");
}
export async function costCandidateTemplateV1(base: Json, before: CostSettingsV1) {
  if (await sha256Hex(base) !== COST_CONTROL_SCOPE_V1.baseTemplateSha256) fail("COST_CONTROL_BASE_TEMPLATE_DRIFT");
  const t = structuredClone(base) as { Parameters: Record<string, Json>; Resources: Record<string, { Properties: { Budget: Json } }> };
  t.Parameters.MonthlyBudgetUsd = { ...t.Parameters.MonthlyBudgetUsd, Default: 50, MinValue: 50, MaxValue: 50, AllowedValues: [50] };
  // Pin the existing service-generated period instead of resetting it to new defaults.
  t.Resources.SandboxMonthlyCostBudget.Properties.Budget.TimePeriod = structuredClone(before.budget.config.TimePeriod);
  return t;
}
export async function compileCostManifestV1(i: CostInventoryV1, base: Json, code: string, now: number) {
  assertBefore(i.settings); oldSets(i.changeSets);
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(i.observedAt) || i.observedAt > now || now - i.observedAt > 30000 ||
    !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(i.stackStatus) || i.tableStatus !== "ACTIVE" || !i.permissionsAllowed || !digest.test(code)) fail("COST_CONTROL_REVIEW_UNVERIFIED");
  const candidateTemplate = await costCandidateTemplateV1(base, i.settings);
  const body = { schemaVersion: 1 as const, protocol: "sandbox-cost-controls-v1" as const, reviewedAt: now, expiresAt: now + 3600000,
    codeSha256: code, scope: COST_CONTROL_SCOPE_V1, before: structuredClone(i.settings), oldChangeSets: structuredClone(i.changeSets), candidateTemplate, candidateTemplateSha256: await sha256Hex(candidateTemplate) };
  const m = freeze({ ...body, manifestSha256: await sha256Hex(body) }); await validateCostManifestV1(m, base, code); return m;
}
export async function validateCostManifestV1(m: CostManifestV1, base: Json, code: string) {
  if (!exact(m, ["schemaVersion", "protocol", "reviewedAt", "expiresAt", "codeSha256", "scope", "before", "oldChangeSets", "candidateTemplate", "candidateTemplateSha256", "manifestSha256"]) || m.schemaVersion !== 1 || m.protocol !== "sandbox-cost-controls-v1" ||
    !Number.isSafeInteger(m.reviewedAt) || m.reviewedAt <= 0 || m.expiresAt - m.reviewedAt !== 3600000 || !digest.test(code) || m.codeSha256 !== code || !equal(m.scope, COST_CONTROL_SCOPE_V1)) fail("COST_CONTROL_MANIFEST_INVALID");
  assertBefore(m.before); oldSets(m.oldChangeSets);
  if (!equal(m.candidateTemplate, await costCandidateTemplateV1(base, m.before)) || await sha256Hex(m.candidateTemplate) !== m.candidateTemplateSha256) fail("COST_CONTROL_TEMPLATE_INVALID");
  const { manifestSha256, ...body } = m; if (!digest.test(manifestSha256) || await sha256Hex(body) !== manifestSha256) fail("COST_CONTROL_MANIFEST_HASH_INVALID");
}
export function costChangeSetNameV1(m: CostManifestV1) { return `techlong-f3c3a-cost50-${m.manifestSha256.slice(0, 20)}`; }
export function expectedCostSettingsV1(m: CostManifestV1, budgetApplied: boolean, tableApplied: boolean) {
  const s = structuredClone(m.before);
  if (budgetApplied) { s.stack.templateSha256 = m.candidateTemplateSha256; s.stack.parameters.MonthlyBudgetUsd = "50"; s.budget.config.BudgetLimit = { Amount: "50", Unit: "USD" }; }
  if (tableApplied) s.table.maxRead = 100;
  return s;
}
export function assertCostProgressV1(m: CostManifestV1, i: CostInventoryV1, phase: "before" | "created" | "budget" | "complete", ownArn?: string) {
  const applied = phase === "budget" || phase === "complete";
  if (!equal(i.settings, expectedCostSettingsV1(m, applied, phase === "complete")) || !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(i.stackStatus) || i.tableStatus !== "ACTIVE") fail("COST_CONTROL_CONFIG_DRIFT");
  const expectedOld = applied ? [] : m.oldChangeSets;
  const others = i.changeSets.filter(c => c.id !== ownArn); if (!equal(others, expectedOld)) fail("COST_CONTROL_FOREIGN_CHANGESET");
  if (phase !== "before") {
    const own = i.changeSets.filter(c => c.id === ownArn);
    if (own.length !== 1 || own[0].name !== costChangeSetNameV1(m) || own[0].status !== "CREATE_COMPLETE" || own[0].includeNested || own[0].executionStatus !== (applied ? "EXECUTE_COMPLETE" : "AVAILABLE")) fail("COST_CONTROL_CHANGESET_STATE_UNVERIFIED");
  }
}
export function assertCostChangeSetV1(m: CostManifestV1, c: Json, template: unknown, ownArn: string) {
  const changes = c.Changes as { Type: string; ResourceChange: { Action: string; LogicalResourceId: string; PhysicalResourceId: string; ResourceType: string; Replacement: string; Scope: string[]; Details: { Target: { Attribute: string; Name: string; RequiresRecreation: string } }[] } }[];
  const parameters = Object.entries({ ...m.before.stack.parameters, MonthlyBudgetUsd: "50" }).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })).sort((a, b) => a.ParameterKey.localeCompare(b.ParameterKey));
  const received = (c.Parameters as { ParameterKey: string; ParameterValue: string; UsePreviousValue?: boolean }[])?.map(p => ({ ParameterKey: p.ParameterKey, ParameterValue: p.ParameterValue })).sort((a, b) => a.ParameterKey.localeCompare(b.ParameterKey));
  const tags = (c.Tags as { Key: string; Value: string }[] | undefined)?.slice().sort((a, b) => a.Key.localeCompare(b.Key));
  if (c.ChangeSetId !== ownArn || c.ChangeSetName !== costChangeSetNameV1(m) || c.StackId !== m.scope.stackId || c.StackName !== m.scope.stackName || c.Status !== "CREATE_COMPLETE" || c.ExecutionStatus !== "AVAILABLE" ||
    c.Description !== `Reviewed F3c3a cost controls ${m.manifestSha256}` || c.NextToken || c.ParentChangeSetId || c.RootChangeSetId || c.IncludeNestedStacks === true ||
    (c.Capabilities as unknown[] | undefined)?.length || (c.NotificationARNs as unknown[] | undefined)?.length || c.RoleARN ||
    (c.Parameters as { UsePreviousValue?: boolean }[] | undefined)?.some(p => p.UsePreviousValue === true) ||
    !equal(tags ?? [], m.before.stack.tags) || !equal(received, parameters) || !equal(template, m.candidateTemplate) || changes?.length !== 1) fail("COST_CONTROL_CHANGESET_UNREVIEWED");
  const change = changes[0], r = change.ResourceChange;
  if (change.Type !== "Resource" || r.Action !== "Modify" || r.LogicalResourceId !== "SandboxMonthlyCostBudget" || r.PhysicalResourceId !== m.scope.budgetName || r.ResourceType !== "AWS::Budgets::Budget" || r.Replacement !== "False" ||
    !equal(r.Scope, ["Properties"]) || !r.Details?.length || r.Details.some(d => d.Target.Attribute !== "Properties" || d.Target.Name !== "Budget" || d.Target.RequiresRecreation !== "Never")) fail("COST_CONTROL_CHANGESET_SCOPE_UNREVIEWED");
}
export interface CostPortsV1 {
  now(): number; inventory(permissions: boolean): Promise<CostInventoryV1>; claimSlot(): Promise<void>;
  marker(name: string, value: unknown): Promise<void>; createChangeSetOnce(m: CostManifestV1): Promise<{ changeSetArn: string }>;
  readReviewedChangeSet(m: CostManifestV1, arn: string): Promise<void>; executeChangeSetOnce(m: CostManifestV1, arn: string): Promise<void>;
  waitBudgetUpdate(m: CostManifestV1, arn: string): Promise<void>; updateReadLimitOnce(m: CostManifestV1): Promise<void>;
}
export async function runCostControlsV1(raw: CostManifestV1, approved: string, base: Json, code: string, p: CostPortsV1) {
  const m = freeze(structuredClone(raw)); await validateCostManifestV1(m, base, code);
  const approve = () => { const n = p.now(); if (approved !== m.manifestSha256 || !Number.isSafeInteger(n) || n < m.reviewedAt || n + 5000 >= m.expiresAt) fail("COST_CONTROL_FRESH_APPROVAL_REQUIRED"); };
  const fresh = (i: CostInventoryV1) => { const n = p.now(); if (!Number.isSafeInteger(i.observedAt) || i.observedAt > n || n - i.observedAt > 30000) fail("COST_CONTROL_INVENTORY_STALE"); return i; };
  let stage = "PREFLIGHT", slotConsumed = false, writeAttempts = 0, changeSetArn: string | null = null, failureCode: string | null = null;
  const completed: string[] = [];
  try {
    approve(); const i = fresh(await p.inventory(true)); if (!i.permissionsAllowed) fail("COST_CONTROL_PREFLIGHT_UNVERIFIED"); assertCostProgressV1(m, i, "before"); approve();
    await p.claimSlot(); slotConsumed = true; await p.marker("approved-manifest.json", m);
    stage = "CREATE_CHANGESET"; await p.marker("create-attempt.json", { approved }); approve(); writeAttempts++;
    const created = await p.createChangeSetOnce(m); changeSetArn = created.changeSetArn; await p.marker("create-confirmed.json", created); completed.push(stage);
    stage = "REVIEW_CREATED_CHANGESET"; await p.readReviewedChangeSet(m, changeSetArn); assertCostProgressV1(m, fresh(await p.inventory(false)), "created", changeSetArn); approve();
    await p.marker("changeset-reviewed.json", { changeSetArn, candidateTemplateSha256: m.candidateTemplateSha256 });
    stage = "EXECUTE_BUDGET_UPDATE"; await p.marker("execute-attempt.json", { approved, changeSetArn }); approve(); writeAttempts++;
    await p.executeChangeSetOnce(m, changeSetArn); await p.marker("execute-confirmed.json", { changeSetArn }); await p.waitBudgetUpdate(m, changeSetArn);
    assertCostProgressV1(m, fresh(await p.inventory(false)), "budget", changeSetArn); await p.marker("budget-verified.json", { usd: 50 }); completed.push(stage);
    stage = "UPDATE_READ_LIMIT"; await p.marker("read-limit-attempt.json", { approved, tableId: m.scope.tableId }); approve(); writeAttempts++;
    await p.updateReadLimitOnce(m); await p.marker("read-limit-confirmed.json", { read: 100, write: 2 }); completed.push(stage);
  } catch (e) { failureCode = e instanceof Error && /^COST_CONTROL_[A-Z_]+$/.test(e.message) ? e.message : "COST_CONTROL_RESULT_UNVERIFIED"; }
  return { outcome: failureCode ? "COST_CONTROL_STOPPED_INSPECT_ONLY" : "COST_CONTROL_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT", slotConsumed, writeAttempts, changeSetArn, completed,
    failureStage: failureCode ? stage : null, failureCode, retryAuthorized: false, runtimeEnabled: false, paidCellCreated: false };
}
