import { canonicalJson, sha256Hex } from "./hash.ts";
import { COST_CONTROL_SCOPE_V1 as oldScope, validateCostManifestV1, type CostManifestV1, type CostSettingsV1, type CostInventoryV1 } from "./sandbox-cost-controls-v1.ts";
import { EXISTING_COST_SCOPE_V1 as previous } from "./existing-cost-controls-v1.ts";
type Json = Record<string, unknown>;
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b), digest = /^[a-f0-9]{64}$/;
function fail(code: string): never { throw Error(code); }
function freeze<T>(o: T): T { if (o && typeof o === "object") { Object.values(o).forEach(freeze); Object.freeze(o); } return o; }
const exact = (o: unknown, keys: string[]) => !!o && typeof o === "object" && !Array.isArray(o) && equal(Object.keys(o).sort(), [...keys].sort());
export const COST_RECOVERY_SCOPE_V1 = freeze({
  stackId: oldScope.stackId, accountId: oldScope.accountId, region: oldScope.region,
  sourceArn: oldScope.sourceArn, sourceUserId: oldScope.sourceUserId,
  originalManifestSha256: previous.originalManifestSha256,
  originalCodeSha256: previous.originalCodeSha256,
  previousCodeSha256: "41dfdf85b2b3e01d29737aac8dccd3846229a23cbedc5b2e871d5abedd67bf9c",
  previousReceiptSha256: "ca39ab0a5ead43ad975a4fc33de6820f1376c5ffa9b108083c77d975b6c05d60",
  failedSettingsSha256: "ac7dfa38adaf09cdf29c7e1aab358a5753f2787e73a2f2540658cd592386baa2",
  stableEventId: "bea3dee0-9424-11f1-a75e-066ead6012ed", stableEventTimestamp: "2026-08-09T19:01:36.318Z",
  failedEventId: "d5689c00-c5f8-11f1-906f-06ffe310ff0d", failedEventTimestamp: "2026-10-12T04:53:14.775Z",
  failedRequestToken: "f3c3b-execute-b28a77533adcedb7d897112441a1fa5fb235995cef94f2716076e28a8580ad48",
  acceptedPostRecoveryStarts: ["2026-08-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"],
  trackedChangeSetIds: [...oldScope.oldFailedChangeSetIds, previous.changeSetArn],
  permanentSlot: "techlong-f3c3c-cost-stack-recovery-v1-consumed",
  maximumDirectWriteAttempts: 1, action: "cloudformation:RollbackStack", retainExceptOnCreate: false,
  historicalStableEvidenceDoesNotGuaranteeServiceInternalState: true,
  serviceMayModifyBudgetAndTimePeriodOrInvalidateChangeSets: true,
  serviceMayDeleteStackIfNoStableStateDespiteHistoricalEvidence: true,
  serviceMayFailOrLeavePartialStateAndAlertsOrHistoryMayBeAffected: true,
  noDirectDeleteStackBudgetOrChangeSetCalls: true, noNewRoleOrIamWrites: true,
  noDirectBudgetUpdateOrTableUpdateInThisApproval: true,
  sourceLoginAutomaticRefreshMayFail: true, freshReadIsNotCas: true,
  noAutomaticAdditionalRollbackDeleteFillResetOrWriteRetry: true,
  noItemSecretNeonLambdaCellOrRuntimeChanges: true,
});
export interface RecoveryEventV1 { id: string; at: string; status: string; token: string | null }
export interface RecoveryChangeSetV1 { id: string; present: boolean; status: string | null; executionStatus: string | null }
export interface RecoverySnapshotV1 { observedAt: number; inventory: CostInventoryV1; disableRollback: boolean;
  stableEvent: RecoveryEventV1 | null; latestStackEvent: RecoveryEventV1 | null;
  stackEvents: RecoveryEventV1[]; changeSets: RecoveryChangeSetV1[]; permissionsAllowed: boolean }
export interface RecoveryManifestV1 { schemaVersion: 1; protocol: "cost-stack-recovery-v1"; reviewedAt: number; expiresAt: number;
  codeSha256: string; scope: typeof COST_RECOVERY_SCOPE_V1; originalManifest: CostManifestV1; before: CostSettingsV1;
  request: { StackName: string; RetainExceptOnCreate: false }; manifestSha256: string }
export function assertRecoveryFreshV1(at: number, now: number) {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(at) || at > now || now - at > 30000) fail("COST_RECOVERY_READ_STALE");
}
export function expectedFailedCostSettingsV1(original: CostManifestV1) {
  const s = structuredClone(original.before);
  s.stack.parameters.MonthlyBudgetUsd = "50"; s.stack.templateSha256 = original.candidateTemplateSha256;
  s.budget.config.TimePeriod = { Start: "2026-10-01T00:00:00.000Z", End: "2087-06-15T00:00:00.000Z" };
  return s;
}
export function assertRecoveryBeforeV1(original: CostManifestV1, v: RecoverySnapshotV1, now: number) {
  assertRecoveryFreshV1(v.observedAt, now); assertRecoveryFreshV1(v.inventory.observedAt, now);
  if (!v.permissionsAllowed || v.inventory.stackStatus !== "UPDATE_FAILED" || v.inventory.tableStatus !== "ACTIVE" || v.disableRollback !== true ||
    v.inventory.changeSets.length || !equal(v.inventory.settings, expectedFailedCostSettingsV1(original)) ||
    v.stableEvent?.id !== COST_RECOVERY_SCOPE_V1.stableEventId || v.stableEvent?.at !== COST_RECOVERY_SCOPE_V1.stableEventTimestamp || v.stableEvent?.status !== "CREATE_COMPLETE" ||
    !equal(v.latestStackEvent, { id: COST_RECOVERY_SCOPE_V1.failedEventId, at: COST_RECOVERY_SCOPE_V1.failedEventTimestamp, status: "UPDATE_FAILED", token: COST_RECOVERY_SCOPE_V1.failedRequestToken }) ||
    !equal(v.changeSets, COST_RECOVERY_SCOPE_V1.trackedChangeSetIds.map((id, n) => ({ id, present: true, status: n === 2 ? "CREATE_COMPLETE" : "FAILED", executionStatus: n === 2 ? "EXECUTE_FAILED" : "OBSOLETE" })))) fail("COST_RECOVERY_PRESTATE_UNVERIFIED");
}
export async function compileRecoveryManifestV1(original: CostManifestV1, v: RecoverySnapshotV1, base: Json, code: string, now: number) {
  assertRecoveryBeforeV1(original, v, now);
  if (await sha256Hex(v.inventory.settings) !== COST_RECOVERY_SCOPE_V1.failedSettingsSha256) fail("COST_RECOVERY_STATE_HASH_DRIFT");
  const body = { schemaVersion: 1 as const, protocol: "cost-stack-recovery-v1" as const, reviewedAt: now, expiresAt: now + 3600000, codeSha256: code, scope: COST_RECOVERY_SCOPE_V1,
    originalManifest: structuredClone(original), before: structuredClone(v.inventory.settings), request: { StackName: oldScope.stackId, RetainExceptOnCreate: false as const } };
  const m = freeze({ ...body, manifestSha256: await sha256Hex(body) }); await validateRecoveryManifestV1(m, base, code); return m;
}
export async function validateRecoveryManifestV1(m: RecoveryManifestV1, base: Json, code: string) {
  if (!exact(m, ["schemaVersion", "protocol", "reviewedAt", "expiresAt", "codeSha256", "scope", "originalManifest", "before", "request", "manifestSha256"]) || m.schemaVersion !== 1 || m.protocol !== "cost-stack-recovery-v1" ||
    !Number.isSafeInteger(m.reviewedAt) || m.reviewedAt <= 0 || m.expiresAt - m.reviewedAt !== 3600000 || !digest.test(code) || code !== m.codeSha256 || !equal(m.scope, COST_RECOVERY_SCOPE_V1) ||
    m.originalManifest?.manifestSha256 !== COST_RECOVERY_SCOPE_V1.originalManifestSha256 || !equal(m.request, { StackName: oldScope.stackId, RetainExceptOnCreate: false })) fail("COST_RECOVERY_MANIFEST_INVALID");
  await validateCostManifestV1(m.originalManifest, base, COST_RECOVERY_SCOPE_V1.originalCodeSha256);
  if (!equal(m.before, expectedFailedCostSettingsV1(m.originalManifest)) || await sha256Hex(m.before) !== COST_RECOVERY_SCOPE_V1.failedSettingsSha256) fail("COST_RECOVERY_STATE_HASH_DRIFT");
  const { manifestSha256, ...body } = m;
  if (!digest.test(manifestSha256) || await sha256Hex(body) !== manifestSha256) fail("COST_RECOVERY_MANIFEST_HASH_INVALID");
}
export function assertRecoveryApprovalV1(m: RecoveryManifestV1, approved: string, now: number) {
  if (approved !== m.manifestSha256 || !Number.isSafeInteger(now) || now < m.reviewedAt || now + 5000 >= m.expiresAt) fail("COST_RECOVERY_FRESH_APPROVAL_REQUIRED");
}
export function recoveryTokenV1(m: RecoveryManifestV1) { return `f3c3c-recover-${m.manifestSha256}`; }
export function recoveryRestoredV1(m: RecoveryManifestV1, v: RecoverySnapshotV1) {
  const i = v.inventory, period = i.settings.budget.config.TimePeriod as { Start: string; End: string };
  if (!["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"].includes(i.stackStatus) || i.tableStatus !== "ACTIVE" ||
    !COST_RECOVERY_SCOPE_V1.acceptedPostRecoveryStarts.includes(period?.Start) || period?.End !== "2087-06-15T00:00:00.000Z" ||
    !v.stackEvents.some(e => e.token === recoveryTokenV1(m) && e.status === i.stackStatus) ||
    i.changeSets.some(c => !COST_RECOVERY_SCOPE_V1.trackedChangeSetIds.includes(c.id) || c.executionStatus === "AVAILABLE" || c.executionStatus === "EXECUTE_IN_PROGRESS") ||
    v.changeSets.some(c => c.present && !["OBSOLETE", "EXECUTE_FAILED", "UNAVAILABLE"].includes(c.executionStatus ?? ""))) return false;
  const expected = structuredClone(m.originalManifest.before); expected.budget.config.TimePeriod = structuredClone(period);
  return equal(i.settings, expected);
}
// Proposal data only: no budget/table mutator is implemented or authorized by this recovery protocol.
export function draftDirectCostPayloadV1(settings: CostSettingsV1) {
  const cfg = structuredClone(settings.budget.config), p = cfg.TimePeriod as { Start: string; End: string };
  if (!exact(cfg, ["BudgetName", "BudgetLimit", "BudgetType", "TimeUnit", "CostFilters", "CostTypes", "TimePeriod"]) || cfg.BudgetName !== oldScope.budgetName || cfg.BudgetType !== "COST" || cfg.TimeUnit !== "MONTHLY" ||
    !equal(cfg.BudgetLimit, { Amount: "10", Unit: "USD" }) || !p || !Number.isFinite(Date.parse(p.Start)) || !Number.isFinite(Date.parse(p.End)) || settings.budget.actions.length ||
    settings.table.id !== oldScope.tableId || settings.table.arn !== oldScope.tableArn || settings.table.maxRead !== 5 || settings.table.maxWrite !== 2) fail("COST_RECOVERY_DIRECT_DRAFT_INVALID");
  cfg.BudgetLimit = { Amount: "50", Unit: "USD" }; cfg.TimePeriod = { Start: Date.parse(p.Start) / 1000, End: Date.parse(p.End) / 1000 };
  return { budget: { AccountId: oldScope.accountId, NewBudget: cfg }, table: { TableName: oldScope.tableName, OnDemandThroughput: { MaxReadRequestUnits: 100, MaxWriteRequestUnits: 2 } },
    cfnOwnershipRetainedNotDetached: true, explicitAmountDriftWouldRemain: true, automaticCostStackApplyMustRemainProhibited: true,
    preserveObservedPostRecoveryTimePeriod: true, recompileAfterVerifiedRecoveryRequired: true, executionAuthorized: false };
}
export interface RecoveryPortsV1 { now(): number; snapshot(permissions: boolean): Promise<RecoverySnapshotV1>; claimSlot(): Promise<void>;
  marker(name: string, value: unknown): Promise<void>; rollbackOnce(m: RecoveryManifestV1): Promise<{ stackId: string; operationId: string | null }>;
  waitRestored(m: RecoveryManifestV1): Promise<void> }
export async function runCostRecoveryV1(raw: RecoveryManifestV1, approved: string, base: Json, code: string, p: RecoveryPortsV1) {
  const m = freeze(structuredClone(raw)); await validateRecoveryManifestV1(m, base, code); return runReviewedRecoveryStepsV1(m, approved, p);
}
// Unit-test seam. The command-line entry always uses the validating wrapper above.
export async function runReviewedRecoveryStepsV1(raw: RecoveryManifestV1, approved: string, p: RecoveryPortsV1) {
  const m = freeze(structuredClone(raw)); let slotConsumed = false, writeAttempts = 0, stage = "PREFLIGHT", failureCode: string | null = null;
  const approve = () => assertRecoveryApprovalV1(m, approved, p.now());
  try {
    approve(); assertRecoveryBeforeV1(m.originalManifest, await p.snapshot(true), p.now()); approve();
    await p.claimSlot(); slotConsumed = true; await p.marker("approved-manifest.json", m);
    stage = "EXPLICIT_ROLLBACK_STACK_ONCE"; await p.marker("rollback-attempt.json", { approved, stackId: m.scope.stackId }); approve(); writeAttempts++;
    const response = await p.rollbackOnce(m); if (response.stackId !== m.scope.stackId) fail("COST_RECOVERY_RESPONSE_IDENTITY_UNVERIFIED");
    await p.marker("rollback-confirmed.json", response); await p.waitRestored(m);
    const v = await p.snapshot(false); assertRecoveryFreshV1(v.observedAt, p.now()); assertRecoveryFreshV1(v.inventory.observedAt, p.now());
    if (!recoveryRestoredV1(m, v)) fail("COST_RECOVERY_POSTSTATE_UNVERIFIED");
    await p.marker("restoration-verified.json", { budgetUsd: 10, read: 5, write: 2, stackStatus: v.inventory.stackStatus });
  } catch (e) { failureCode = e instanceof Error && /^(COST_RECOVERY|COST_CONTROL)_[A-Z_]+$/.test(e.message) ? e.message : "COST_RECOVERY_RESULT_UNVERIFIED"; }
  return { outcome: failureCode ? "COST_RECOVERY_STOPPED_INSPECT_ONLY" : "COST_RECOVERY_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT", slotConsumed, writeAttempts, failureStage: failureCode ? stage : null, failureCode,
    directBudgetUpdateAuthorized: false, tableUpdateAuthorized: false, retryAuthorized: false, runtimeEnabled: false, paidCellCreated: false };
}
