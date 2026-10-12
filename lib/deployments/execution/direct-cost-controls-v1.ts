import { canonicalJson, sha256Hex } from "./hash.ts";
import { COST_CONTROL_SCOPE_V1 as originalScope, type CostSettingsV1 } from "./sandbox-cost-controls-v1.ts";
import { COST_RECOVERY_SCOPE_V1 as recoveryScope, validateRecoveryManifestV1, draftDirectCostPayloadV1,
  type RecoveryManifestV1, type RecoverySnapshotV1 } from "./cost-stack-recovery-v1.ts";
type Json = Record<string, unknown>;
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b), digest = /^[a-f0-9]{64}$/;
const exact = (o: unknown, keys: string[]) => !!o && typeof o === "object" && !Array.isArray(o) && equal(Object.keys(o).sort(), [...keys].sort());
function fail(code: string): never { throw Error(code); }
function freeze<T>(o: T): T { if (o && typeof o === "object") { Object.values(o).forEach(freeze); Object.freeze(o); } return o; }
export const DIRECT_COST_SCOPE_V1 = freeze({
  accountId: originalScope.accountId, region: originalScope.region, budgetRegion: "us-east-1",
  sourceArn: originalScope.sourceArn, sourceUserId: originalScope.sourceUserId,
  budgetName: originalScope.budgetName, budgetArn: `arn:aws:budgets::${originalScope.accountId}:budget/${originalScope.budgetName}`,
  tableName: originalScope.tableName, tableArn: originalScope.tableArn, tableId: originalScope.tableId,
  stackId: originalScope.stackId, stackStatus: "UPDATE_ROLLBACK_COMPLETE", stackMonthlyBudgetUsd: 10,
  recoveryCodeSha256: "8a3a02add2954fff7c2e7577d72564817ed04ffb3f6b5356e017016cb7ceaafc",
  recoveryManifestSha256: "22fe4989d099196e75c14c148da19a90c3ff860bebed733cd2db354904ce9c36",
  recoveryReceiptFileSha256: "2b212a16f08092fdeb488a4caf10d152567691f01227a542ed0e806e64f3f12f",
  recoveryVerifyFileSha256: "722051e3486d71d164d1d5e3f463f8d8d326cfdb61269246a4d56c3ff86bfb9b",
  recoveredSettingsSha256: "f04b68099b0e4566c21e817fc3e4a96723145d2bdb21cddaec0ef610cc0ba291",
  completedEvent: { id: "d0ad64a0-c64a-11f1-a7c2-026a0543e9bf", at: "2026-10-12T14:40:05.592Z", status: "UPDATE_ROLLBACK_COMPLETE", token: "f3c3c-recover-22fe4989d099196e75c14c148da19a90c3ff860bebed733cd2db354904ce9c36" },
  budgetTimePeriod: { Start: "2026-10-01T00:00:00.000Z", End: "2087-06-15T00:00:00.000Z" },
  fromBudgetUsd: 10, toBudgetUsd: 50, fromReadUnits: 5, toReadUnits: 100, writeUnits: 2,
  permanentSlot: "techlong-f3c3d-direct-cost-controls-v1-consumed", maximumDirectWriteAttempts: 2,
  cfnOwnershipAndTagsRetained: true, cfnAmountDrift10Vs50ExplicitlyAcceptedRequired: true,
  noCfnApplyCorrectionDetachOrRollback: true, technicalCfnPermissionsNotRevoked: true,
  budgetUpdateIsWholeConfigurationOverwriteNotCas: true, budgetHasNoRequestIdempotencyToken: true,
  calculatedSpendMayTemporarilyResetNotZeroBillProof: true,
  notificationsDeliveryStateAndHistoryNotGuaranteedByConfigEquality: true,
  asyncTableUpdateAndPartialBudget50Read5StatePossible: true, sourceLoginAutomaticRefreshMayFail: true,
  noAutomaticRollbackDeleteFillResetOrWriteRetry: true, permanentSlotMayBeConsumedWithoutSuccessfulWrite: true,
  budgetIsAlertOnlyNotHardCostCap: true, readLimitIsBestEffortNotHardCap: true,
  noIamSecretItemNeonLambdaCellOrRuntimeChanges: true,
});
export interface DirectCostManifestV1 { schemaVersion: 1; protocol: "direct-cost-controls-v1"; reviewedAt: number; expiresAt: number;
  codeSha256: string; scope: typeof DIRECT_COST_SCOPE_V1; recoveryManifest: RecoveryManifestV1; before: CostSettingsV1;
  budgetRequest: { AccountId: string; NewBudget: Json }; tableRequest: { TableName: string; OnDemandThroughput: { MaxReadRequestUnits: number; MaxWriteRequestUnits: number } };
  manifestSha256: string }
export function directRecoveredSettingsV1(recovery: RecoveryManifestV1) {
  const s = structuredClone(recovery.originalManifest.before); s.budget.config.TimePeriod = structuredClone(DIRECT_COST_SCOPE_V1.budgetTimePeriod); return s;
}
export function directExpectedSettingsV1(m: DirectCostManifestV1, phase: "before" | "budget" | "complete") {
  const s = structuredClone(m.before);
  if (phase !== "before") s.budget.config.BudgetLimit = { Amount: "50", Unit: "USD" };
  if (phase === "complete") s.table.maxRead = 100;
  return s;
}
export function assertDirectFreshV1(at: number, now: number) {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(at) || at > now || now - at > 30000) fail("DIRECT_COST_READ_STALE");
}
export function assertDirectPhaseV1(m: Pick<DirectCostManifestV1, "before">, v: RecoverySnapshotV1, phase: "before" | "budget" | "complete") {
  const expected = structuredClone(m.before);
  if (phase !== "before") expected.budget.config.BudgetLimit = { Amount: "50", Unit: "USD" };
  if (phase === "complete") expected.table.maxRead = 100;
  if (v.inventory.stackStatus !== "UPDATE_ROLLBACK_COMPLETE" || v.inventory.tableStatus !== "ACTIVE" || v.disableRollback !== true || v.inventory.changeSets.length ||
    !equal(v.latestStackEvent, DIRECT_COST_SCOPE_V1.completedEvent) || !equal(v.stableEvent, DIRECT_COST_SCOPE_V1.completedEvent) || !equal(v.inventory.settings, expected) ||
    !equal(v.changeSets, recoveryScope.trackedChangeSetIds.map((id, n) => ({ id, present: true, status: n === 2 ? "CREATE_COMPLETE" : "FAILED", executionStatus: n === 2 ? "EXECUTE_FAILED" : "OBSOLETE" })))) fail("DIRECT_COST_BOUND_CONFIG_DRIFT");
}
export async function compileDirectCostManifestV1(recovery: RecoveryManifestV1, v: RecoverySnapshotV1, base: Json, code: string, now: number) {
  const before = directRecoveredSettingsV1(recovery);
  assertDirectFreshV1(v.observedAt, now); assertDirectFreshV1(v.inventory.observedAt, now); assertDirectPhaseV1({ before }, v, "before");
  if (!v.permissionsAllowed) fail("DIRECT_COST_PERMISSIONS_UNVERIFIED");
  const draft = draftDirectCostPayloadV1(before), body = { schemaVersion: 1 as const, protocol: "direct-cost-controls-v1" as const, reviewedAt: now, expiresAt: now + 3600000,
    codeSha256: code, scope: DIRECT_COST_SCOPE_V1, recoveryManifest: structuredClone(recovery), before, budgetRequest: draft.budget, tableRequest: draft.table };
  const m = freeze({ ...body, manifestSha256: await sha256Hex(body) }); await validateDirectCostManifestV1(m, base, code); return m;
}
export async function validateDirectCostManifestV1(m: DirectCostManifestV1, base: Json, code: string) {
  if (!exact(m, ["schemaVersion", "protocol", "reviewedAt", "expiresAt", "codeSha256", "scope", "recoveryManifest", "before", "budgetRequest", "tableRequest", "manifestSha256"]) || m.schemaVersion !== 1 || m.protocol !== "direct-cost-controls-v1" ||
    !Number.isSafeInteger(m.reviewedAt) || m.reviewedAt <= 0 || m.expiresAt - m.reviewedAt !== 3600000 || !digest.test(code) || code !== m.codeSha256 || !equal(m.scope, DIRECT_COST_SCOPE_V1) ||
    m.recoveryManifest?.manifestSha256 !== DIRECT_COST_SCOPE_V1.recoveryManifestSha256) fail("DIRECT_COST_MANIFEST_INVALID");
  await validateRecoveryManifestV1(m.recoveryManifest, base, DIRECT_COST_SCOPE_V1.recoveryCodeSha256);
  if (!equal(m.before, directRecoveredSettingsV1(m.recoveryManifest)) || await sha256Hex(m.before) !== DIRECT_COST_SCOPE_V1.recoveredSettingsSha256) fail("DIRECT_COST_BEFORE_HASH_DRIFT");
  const draft = draftDirectCostPayloadV1(m.before);
  if (!equal(m.budgetRequest, draft.budget) || !equal(m.tableRequest, draft.table)) fail("DIRECT_COST_REQUEST_SCOPE_DRIFT");
  const { manifestSha256, ...body } = m; if (!digest.test(manifestSha256) || await sha256Hex(body) !== manifestSha256) fail("DIRECT_COST_MANIFEST_HASH_INVALID");
}
export function assertDirectApprovalV1(m: DirectCostManifestV1, approved: string, now: number) {
  if (approved !== m.manifestSha256 || !Number.isSafeInteger(now) || now < m.reviewedAt || now + 5000 >= m.expiresAt) fail("DIRECT_COST_FRESH_APPROVAL_REQUIRED");
}
export interface DirectCostPortsV1 { now(): number; snapshot(permissions: boolean): Promise<RecoverySnapshotV1>; claimSlot(): Promise<void>; marker(name: string, value: unknown): Promise<void>;
  updateBudgetOnce(m: DirectCostManifestV1): Promise<void>; waitBudget(m: DirectCostManifestV1): Promise<void>;
  updateTableOnce(m: DirectCostManifestV1): Promise<void>; waitTable(m: DirectCostManifestV1): Promise<void> }
export async function runDirectCostControlsV1(raw: DirectCostManifestV1, approved: string, base: Json, code: string, p: DirectCostPortsV1) {
  const m = freeze(structuredClone(raw)); await validateDirectCostManifestV1(m, base, code); return runReviewedDirectCostStepsV1(m, approved, p);
}
// Test seam; the CLI calls only the validating wrapper above.
export async function runReviewedDirectCostStepsV1(raw: DirectCostManifestV1, approved: string, p: DirectCostPortsV1) {
  const m = freeze(structuredClone(raw)); let stage = "PREFLIGHT", slotConsumed = false, writeAttempts = 0, failureCode: string | null = null; const completed: string[] = [];
  const approve = () => assertDirectApprovalV1(m, approved, p.now());
  const verify = async (phase: "before" | "budget" | "complete", permissions: boolean) => { const v = await p.snapshot(permissions); assertDirectFreshV1(v.observedAt, p.now()); assertDirectFreshV1(v.inventory.observedAt, p.now());
    if (permissions && !v.permissionsAllowed) fail("DIRECT_COST_PERMISSIONS_UNVERIFIED"); assertDirectPhaseV1(m, v, phase); return v; };
  try {
    approve(); await verify("before", true); approve(); await p.claimSlot(); slotConsumed = true; await p.marker("approved-manifest.json", m);
    stage = "UPDATE_BUDGET_ONCE"; await p.marker("budget-attempt.json", { approved, budgetArn: m.scope.budgetArn }); approve(); writeAttempts++;
    await p.updateBudgetOnce(m); await p.marker("budget-confirmed.json", { usd: 50 }); await p.waitBudget(m); await verify("budget", true);
    await p.marker("budget-verified.json", { usd: 50, cfnParameterUsd: 10, intentionalAmountDrift: true }); completed.push(stage);
    stage = "UPDATE_TABLE_ONCE"; await p.marker("table-attempt.json", { approved, tableId: m.scope.tableId }); approve(); writeAttempts++;
    await p.updateTableOnce(m); await p.marker("table-confirmed.json", { read: 100, write: 2 }); await p.waitTable(m); const v = await verify("complete", false);
    await p.marker("explicit-override-verified.json", { settingsSha256: await sha256Hex(v.inventory.settings), cfnOwnershipRetained: true, cfnAmountUsd: 10, actualBudgetUsd: 50, read: 100, write: 2 }); completed.push(stage);
  } catch (e) { failureCode = e instanceof Error && /^(DIRECT_COST|COST_RECOVERY|COST_CONTROL)_[A-Z_]+$/.test(e.message) ? e.message : "DIRECT_COST_RESULT_UNVERIFIED"; }
  return { outcome: failureCode ? "DIRECT_COST_STOPPED_INSPECT_ONLY" : "DIRECT_COST_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT", slotConsumed, writeAttempts, completed, failureStage: failureCode ? stage : null, failureCode,
    retryAuthorized: false, cfnAmountDriftExplicitlyExpected: true, runtimeEnabled: false, paidCellCreated: false };
}
