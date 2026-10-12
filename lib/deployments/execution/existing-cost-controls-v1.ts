import { canonicalJson, sha256Hex } from "./hash.ts";
import { COST_CONTROL_SCOPE_V1, validateCostManifestV1, assertCostProgressV1,
  type CostManifestV1, type CostInventoryV1 } from "./sandbox-cost-controls-v1.ts";

type Json = Record<string, unknown>;
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const digest = /^[a-f0-9]{64}$/;
const exact = (o: unknown, keys: string[]) => !!o && typeof o === "object" && !Array.isArray(o) && equal(Object.keys(o).sort(), [...keys].sort());
function fail(code: string): never { throw Error(code); }
function freeze<T>(o: T): T { if (o && typeof o === "object") { Object.values(o).forEach(freeze); Object.freeze(o); } return o; }

// A separate approval boundary, not a relaxation or replay of the consumed F3c3a protocol.
export const EXISTING_COST_SCOPE_V1 = freeze({
  changeSetArn: "arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-f3c3a-cost50-d662dab65100299ee922/f9ff4310-233f-4c83-bf81-19f8146895a3",
  changeSetName: "techlong-f3c3a-cost50-d662dab65100299ee922",
  creationTime: "2026-10-12T04:10:23.112Z",
  originalManifestSha256: "d662dab65100299ee922b84a88cc0a8c42db2f16bfbeb6597827b01dbf8903fe",
  originalManifestFileSha256: "4dfbffe855d1ac91cf887288dbe375aac3a6867081023641a5a24845fa56abb2",
  originalReceiptFileSha256: "068bc6e413640924256e24271a53ea78631512e01cb5a974fccf0a1cdaddc333",
  originalCodeSha256: "389e66ad5eab75416009e316b70ab86bd52ca45ac69e0b5c6ca43ae10f85dccc",
  originalSlot: COST_CONTROL_SCOPE_V1.permanentSlot,
  permanentSlot: "techlong-f3c3b-existing-cost-controls-v1-consumed",
  maximumDirectWriteAttempts: 2,
  acceptedReplacement: "Conditional", acceptedRequiresRecreation: "Conditionally",
  reviewedPaths: ["/Properties/Budget/BudgetLimit/Amount", "/Properties/Budget/TimePeriod"],
  conditionalBudgetReplacementOrRecreationMayOccur: true,
  fixedNameReplacementMayFailAndLeaveUpdateFailed: true,
  alertGapAndBudgetHistoryOrCalculatedSpendDiscontinuityPossible: true,
  cloudFormationWillDeleteExactTwoOtherFailedChangeSets: true,
  disableRollbackOnExecution: true,
  serviceInternalWritesAreNotBoundedByTwoDirectAttempts: true,
  partialBudgetUpdateWithoutTableUpdatePossible: true,
  freshReadIsNotCasAndCannotExcludeConcurrentChanges: true,
  sourceLoginAutomaticRefreshMayFail: true,
  noAutomaticRollbackDeleteFillResetOrWriteRetry: true,
  budgetIsAlertOnlyNotHardCap: true, readLimitIsBestEffortNotHardCap: true,
  noCreateChangeSetOrIamItemSecretNeonLambdaCellRuntimeChanges: true,
});

export function normalizeExistingCostPlanV1(raw: Json): Json {
  const p = JSON.parse(JSON.stringify(raw)) as Json;
  delete p.$metadata;
  const allowed = ["Changes", "ChangeSetName", "ChangeSetId", "StackId", "StackName", "Description", "Parameters", "CreationTime", "ExecutionStatus", "Status", "StatusReason", "NotificationARNs", "RollbackConfiguration", "Capabilities", "Tags", "ParentChangeSetId", "IncludeNestedStacks", "RootChangeSetId", "OnStackFailure", "ImportExistingResources", "StackDriftStatus", "DeploymentMode", "DeploymentConfig", "RoleARN"];
  if (Object.keys(p).some(k => !allowed.includes(k)) || !Number.isFinite(Date.parse(String(p.CreationTime)))) fail("EXISTING_COST_PLAN_SHAPE_UNREVIEWED");
  p.CreationTime = new Date(String(p.CreationTime)).toISOString();
  for (const k of ["StatusReason", "ParentChangeSetId", "RootChangeSetId", "OnStackFailure", "ImportExistingResources", "StackDriftStatus", "DeploymentMode", "RoleARN"]) p[k] ??= null;
  const changes = p.Changes as { ResourceChange?: Json }[] | undefined;
  if (Array.isArray(changes)) for (const c of changes) for (const k of ["BeforeContext", "AfterContext"]) {
    if (typeof c.ResourceChange?.[k] === "string") c.ResourceChange[k] = canonicalJson(JSON.parse(c.ResourceChange[k] as string));
  }
  if (Array.isArray(p.Parameters)) p.Parameters.sort((a, b) => String(a.ParameterKey).localeCompare(String(b.ParameterKey)));
  if (Array.isArray(p.Tags)) p.Tags.sort((a, b) => String(a.Key).localeCompare(String(b.Key)));
  return p;
}

// CFN property contexts encode scalar numbers and booleans as strings.
function contextScalars(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(contextScalars);
  if (o && typeof o === "object") return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, contextScalars(v)]));
  return typeof o === "number" || typeof o === "boolean" ? String(o) : o;
}
export function expectedExistingCostContextsV1(original: CostManifestV1) {
  const budget = structuredClone(original.before.budget.config);
  delete budget.TimePeriod;
  const before = contextScalars({ Properties: { Budget: budget, NotificationsWithSubscribers: original.before.budget.notifications.map(n => ({ Notification: n.notification, Subscribers: n.subscribers })) } });
  const after = structuredClone(before) as { Properties: { Budget: Json } };
  after.Properties.Budget.BudgetLimit = { Amount: "50", Unit: "USD" };
  after.Properties.Budget.TimePeriod = structuredClone(original.before.budget.config.TimePeriod);
  return { before, after };
}

export function assertExistingCostPlanV1(original: CostManifestV1, raw: Json, template: unknown) {
  const s = EXISTING_COST_SCOPE_V1, p = normalizeExistingCostPlanV1(raw);
  const parameters = Object.entries({ ...original.before.stack.parameters, MonthlyBudgetUsd: "50" }).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })).sort((a, b) => a.ParameterKey.localeCompare(b.ParameterKey));
  if (p.ChangeSetId !== s.changeSetArn || p.ChangeSetName !== s.changeSetName || p.CreationTime !== s.creationTime ||
    p.StackId !== COST_CONTROL_SCOPE_V1.stackId || p.StackName !== COST_CONTROL_SCOPE_V1.stackName || p.Status !== "CREATE_COMPLETE" || p.ExecutionStatus !== "AVAILABLE" ||
    p.Description !== `Reviewed F3c3a cost controls ${s.originalManifestSha256}` || p.IncludeNestedStacks !== false ||
    !equal(p.Capabilities, []) || !equal(p.NotificationARNs, []) || !equal(p.RollbackConfiguration, {}) ||
    !equal(p.DeploymentConfig, { Mode: "STANDARD", DisableRollback: false }) ||
    ["StatusReason", "ParentChangeSetId", "RootChangeSetId", "OnStackFailure", "ImportExistingResources", "StackDriftStatus", "DeploymentMode", "RoleARN"].some(k => p[k] !== null) ||
    !equal(p.Parameters, parameters) || !equal(p.Tags, original.before.stack.tags) || !equal(template, original.candidateTemplate)) fail("EXISTING_COST_PLAN_BINDING_DRIFT");
  const changes = p.Changes as { Type: string; ResourceChange: Json }[];
  if (!Array.isArray(changes) || changes.length !== 1 || !exact(changes[0], ["Type", "ResourceChange"]) || changes[0].Type !== "Resource") fail("EXISTING_COST_RESOURCE_SCOPE_DRIFT");
  const r = changes[0].ResourceChange;
  if (!exact(r, ["Action", "LogicalResourceId", "PhysicalResourceId", "ResourceType", "Replacement", "Scope", "Details", "BeforeContext", "AfterContext"]) ||
    r.Action !== "Modify" || r.LogicalResourceId !== "SandboxMonthlyCostBudget" || r.PhysicalResourceId !== COST_CONTROL_SCOPE_V1.budgetName || r.ResourceType !== "AWS::Budgets::Budget" ||
    r.Replacement !== "Conditional" || !equal(r.Scope, ["Properties"])) fail("EXISTING_COST_RESOURCE_SCOPE_DRIFT");
  const target = { Attribute: "Properties", Name: "Budget", RequiresRecreation: "Conditionally" };
  const expectedDetails = [
    { Target: { ...target, Path: "/Properties/Budget/TimePeriod", AfterValue: canonicalJson(original.before.budget.config.TimePeriod), AttributeChangeType: "Add" }, Evaluation: "Static", ChangeSource: "DirectModification" },
    { Target: { ...target, Path: "/Properties/Budget/BudgetLimit/Amount", BeforeValue: "10", AfterValue: "50", AttributeChangeType: "Modify" }, Evaluation: "Dynamic", ChangeSource: "DirectModification" },
    { Target: { ...target, Path: "/Properties/Budget/BudgetLimit/Amount", BeforeValue: "10", AfterValue: "50", AttributeChangeType: "Modify" }, Evaluation: "Static", ChangeSource: "ParameterReference", CausingEntity: "MonthlyBudgetUsd" },
  ];
  if (!equal(r.Details, expectedDetails)) fail("EXISTING_COST_PROPERTY_PATH_DRIFT");
  const contexts = expectedExistingCostContextsV1(original);
  if (r.BeforeContext !== canonicalJson(contexts.before) || r.AfterContext !== canonicalJson(contexts.after)) fail("EXISTING_COST_FULL_CONTEXT_DRIFT");
  return p;
}

export interface ExistingCostSnapshotV1 { observedAt: number; inventory: CostInventoryV1; plan: Json; template: Json }
export interface ExistingCostManifestV1 { schemaVersion: 1; protocol: "existing-cost-controls-v1"; reviewedAt: number; expiresAt: number;
  codeSha256: string; scope: typeof EXISTING_COST_SCOPE_V1; originalManifest: CostManifestV1; plan: Json; planSha256: string;
  beforeContextSha256: string; afterContextSha256: string; manifestSha256: string }
export function assertExistingCostFreshV1(observedAt: number, now: number) {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(observedAt) || observedAt > now || now - observedAt > 30000) fail("EXISTING_COST_READ_STALE");
}
export async function compileExistingCostManifestV1(snapshot: ExistingCostSnapshotV1, original: CostManifestV1, base: Json, code: string, now: number) {
  assertExistingCostFreshV1(snapshot.observedAt, now); assertExistingCostFreshV1(snapshot.inventory.observedAt, now);
  if (!snapshot.inventory.permissionsAllowed) fail("EXISTING_COST_PERMISSIONS_UNVERIFIED");
  assertCostProgressV1(original, snapshot.inventory, "created", EXISTING_COST_SCOPE_V1.changeSetArn);
  const plan = assertExistingCostPlanV1(original, snapshot.plan, snapshot.template), contexts = expectedExistingCostContextsV1(original);
  const body = { schemaVersion: 1 as const, protocol: "existing-cost-controls-v1" as const, reviewedAt: now, expiresAt: now + 3600000, codeSha256: code,
    scope: EXISTING_COST_SCOPE_V1, originalManifest: structuredClone(original), plan, planSha256: await sha256Hex(plan), beforeContextSha256: await sha256Hex(contexts.before), afterContextSha256: await sha256Hex(contexts.after) };
  const m = freeze({ ...body, manifestSha256: await sha256Hex(body) }); await validateExistingCostManifestV1(m, base, code); return m;
}
export async function validateExistingCostManifestV1(m: ExistingCostManifestV1, base: Json, code: string) {
  if (!exact(m, ["schemaVersion", "protocol", "reviewedAt", "expiresAt", "codeSha256", "scope", "originalManifest", "plan", "planSha256", "beforeContextSha256", "afterContextSha256", "manifestSha256"]) ||
    m.schemaVersion !== 1 || m.protocol !== "existing-cost-controls-v1" || !Number.isSafeInteger(m.reviewedAt) || m.reviewedAt <= 0 || m.expiresAt - m.reviewedAt !== 3600000 ||
    !digest.test(code) || code !== m.codeSha256 || !equal(m.scope, EXISTING_COST_SCOPE_V1) || m.originalManifest?.manifestSha256 !== EXISTING_COST_SCOPE_V1.originalManifestSha256) fail("EXISTING_COST_MANIFEST_INVALID");
  await validateCostManifestV1(m.originalManifest, base, EXISTING_COST_SCOPE_V1.originalCodeSha256);
  const p = assertExistingCostPlanV1(m.originalManifest, m.plan, m.originalManifest.candidateTemplate), ctx = expectedExistingCostContextsV1(m.originalManifest);
  if (!equal(p, m.plan) || await sha256Hex(p) !== m.planSha256 || await sha256Hex(ctx.before) !== m.beforeContextSha256 || await sha256Hex(ctx.after) !== m.afterContextSha256) fail("EXISTING_COST_PLAN_HASH_INVALID");
  const { manifestSha256, ...body } = m;
  if (!digest.test(manifestSha256) || await sha256Hex(body) !== manifestSha256) fail("EXISTING_COST_MANIFEST_HASH_INVALID");
}
export function assertExistingCostApprovalV1(m: ExistingCostManifestV1, approved: string, now: number) {
  if (approved !== m.manifestSha256 || !Number.isSafeInteger(now) || now < m.reviewedAt || now + 5000 >= m.expiresAt) fail("EXISTING_COST_FRESH_APPROVAL_REQUIRED");
}
export async function assertExistingCostSnapshotV1(m: ExistingCostManifestV1, snapshot: ExistingCostSnapshotV1, now: number) {
  assertExistingCostFreshV1(snapshot.observedAt, now); assertExistingCostFreshV1(snapshot.inventory.observedAt, now);
  if (!snapshot.inventory.permissionsAllowed) fail("EXISTING_COST_PERMISSIONS_UNVERIFIED");
  assertCostProgressV1(m.originalManifest, snapshot.inventory, "created", m.scope.changeSetArn);
  const p = assertExistingCostPlanV1(m.originalManifest, snapshot.plan, snapshot.template);
  if (await sha256Hex(p) !== m.planSha256) fail("EXISTING_COST_PLAN_HASH_INVALID");
}
export interface ExistingCostPortsV1 {
  now(): number; snapshot(): Promise<ExistingCostSnapshotV1>; inventory(): Promise<CostInventoryV1>;
  claimSlot(): Promise<void>; marker(name: string, value: unknown): Promise<void>;
  executeOnce(m: ExistingCostManifestV1): Promise<void>; waitBudget(m: ExistingCostManifestV1): Promise<void>; updateReadOnce(m: ExistingCostManifestV1): Promise<void>;
}
export async function runExistingCostControlsV1(raw: ExistingCostManifestV1, approved: string, base: Json, code: string, p: ExistingCostPortsV1) {
  const m = freeze(structuredClone(raw)); await validateExistingCostManifestV1(m, base, code);
  return runExistingCostStepsV1(m, approved, p);
}
// Internal state-machine seam for targeted tests; the CLI uses only the validating wrapper above.
export async function runExistingCostStepsV1(reviewed: ExistingCostManifestV1, approved: string, p: ExistingCostPortsV1) {
  const m = freeze(structuredClone(reviewed));
  const approve = () => assertExistingCostApprovalV1(m, approved, p.now());
  let stage = "PREFLIGHT", slotConsumed = false, writeAttempts = 0, failureCode: string | null = null;
  const completed: string[] = [];
  try {
    approve(); await assertExistingCostSnapshotV1(m, await p.snapshot(), p.now()); approve();
    await p.claimSlot(); slotConsumed = true; await p.marker("approved-manifest.json", m);
    stage = "EXECUTE_EXISTING_CHANGESET"; await p.marker("execute-attempt.json", { approved, changeSetArn: m.scope.changeSetArn }); approve(); writeAttempts++;
    await p.executeOnce(m); await p.marker("execute-confirmed.json", { changeSetArn: m.scope.changeSetArn }); await p.waitBudget(m);
    const i = await p.inventory(); assertExistingCostFreshV1(i.observedAt, p.now()); assertCostProgressV1(m.originalManifest, i, "budget", m.scope.changeSetArn);
    await p.marker("budget-verified.json", { budgetUsd: 50 }); completed.push(stage);
    stage = "UPDATE_READ_LIMIT"; await p.marker("read-limit-attempt.json", { approved, tableId: m.originalManifest.scope.tableId }); approve(); writeAttempts++;
    await p.updateReadOnce(m); await p.marker("read-limit-confirmed.json", { read: 100, write: 2 }); completed.push(stage);
  } catch (e) { failureCode = e instanceof Error && /^(EXISTING_COST|COST_CONTROL)_[A-Z_]+$/.test(e.message) ? e.message : "EXISTING_COST_RESULT_UNVERIFIED"; }
  return { outcome: failureCode ? "EXISTING_COST_STOPPED_INSPECT_ONLY" : "EXISTING_COST_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT", slotConsumed, writeAttempts,
    changeSetArn: m.scope.changeSetArn, completed, failureStage: failureCode ? stage : null, failureCode, retryAuthorized: false, runtimeEnabled: false, paidCellCreated: false };
}
