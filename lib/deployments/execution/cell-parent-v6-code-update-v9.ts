import { canonicalJson, sha256Hex } from "./hash.ts";
import { cellV3Clock, cellV3Exact, cellV3Freeze } from "../cloudformation/shared-cell-stack-v3.ts";
import { CELL_PARENT_LOCKED_UPDATE_V5 as installed, CELL_PARENT_LOCK_GUARDS_V5, cellParentFunctionInvariantV5, cellParentAsyncStateV5,
  type CellParentLockedSnapshotV5 } from "./cell-parent-locked-update-v5.ts";
import { normalizeCellParentConfigV5 } from "./cell-parent-compatibility-v5.ts";
import { cellParentLockedFunctionChecksV4 } from "./cell-parent-latest-metadata-v4.ts";
import { assertCellParentAsyncLockedV5 } from "./cell-parent-async-plan-v5.ts";
import { boundedRecoveryErrorV7 } from "./cell-reserved-retirement-recovery-v7.ts";

const fail = (code: string): never => { throw Error(`V6_UPDATE_${code}`); };
export const CELL_PARENT_V6_CODE_UPDATE_V9 = cellV3Freeze({ functionArn: installed.functionArn, functionName: installed.functionName, roleId: installed.roleId,
  beforeRevisionId: "4a5f64bb-f47e-4e56-a468-1364f4381767", beforeCodeSha256: installed.zipCodeSha256Base64, beforeZipBytes: installed.zipBytes,
  bundleDirectory: "techlong-f3c9i-kms-parent-bundle-20261013-r2", zipName: "cell-birth-parent-v6.zip", bundleName: "cell-birth-coordinator-v4.mjs",
  bundleSha256: "5ea6974456883d836764489c01357a003ca4c20cdea6ff704bba1d82858723b4", zipSha256: "a1f3807de8f15bf1d3ef3f37d8ba5aa626e610104a488ab66e3cf05330dadbae",
  zipCodeSha256: "ofOAfejxW/HT7z832LpapibmEBBKSIq2bjzwUzDa264=", zipBytes: 432966,
  artifactReportFileSha256: "71e787390299e73a369547fa4f421c543b25ffc69b772eb9554be733e9b98662",
  permanentSlot: "techlong-f3c9l-locked-v6-code-update.permanent-slot.json" });
export const V6_CODE_UPDATE_SCOPE_V9 = cellV3Freeze({ maximumWriteCalls: 1, operation: "lambda:UpdateFunctionCode", revisionConditionRequired: true, publishVersion: false,
  reuseFrozenCandidateZip: true, retainDenyAllEmptyRoleAndConcurrencyZero: true, existingAsyncConfigurationNotWritten: true,
  noIamTableSecretDatabaseCellOrIdentityWrite: true, noInvokeRegistrationTriggerAliasVersionOrNewResource: true, preserveAllOldRecordsAndSlots: true,
  noAutomaticRetryRollbackCompensationFillOrReset: true, monthlyBudgetGoalUsd: 50 });
export const V6_CODE_UPDATE_RISKS_V9 = cellV3Freeze({ codeUpdateReadinessIsAsynchronous: true, codeResponseAndCompletionRevisionsMayDiffer: true,
  updateFailureOrResponseLossMayLeaveCandidateInstalled: true, revisionCasDoesNotLockIamConcurrencyTableOrOtherServices: true,
  fullLockFactsCachedForMaximumThirtySecondsAfterClaim: true, automaticNode22RuntimePatchMayChange: true,
  permanentSlotConsumedBeforeApiEvenIfZeroWrites: true, stageOrEvidenceSaveCanFail: true, credentialsRefreshMayFail: true,
  metadataAndIamSimulationNotEffectivePermissionOrRuntimeProof: true, candidateHasFutureGuardedWriteCapabilitiesButNotEnabled: true,
  noAutomaticRetryRollbackCompensationFillOrReset: true, providerLogsMayContainIdentifiers: true, nonzeroCost: true, fiftyUsdNotHardCap: true });
type Json = Record<string, unknown>;
const omit = (v: Json, keys: string[]) => Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k)));
export async function inspectLockedV6CodeSnapshotV9(s: CellParentLockedSnapshotV5, variant: "before" | "candidate", now: number) {
  cellV3Clock(now); cellV3Clock(s.observedAt);
  if (!cellV3Exact(s, ["observedAt", "function", "async", "guards", "facts"]) || !cellV3Exact(s.guards, [...CELL_PARENT_LOCK_GUARDS_V5]) ||
    Object.values(s.guards).some(x => x !== true) || s.observedAt > now || now - s.observedAt > 30000 || !s.facts || typeof s.facts !== "object" || Array.isArray(s.facts)) fail("LOCKS_OR_FRESHNESS_INVALID");
  const f = normalizeCellParentConfigV5(s.function), t = CELL_PARENT_V6_CODE_UPDATE_V9;
  const checks = { ...cellParentLockedFunctionChecksV4(f), zip: f.CodeSha256 === (variant === "before" ? t.beforeCodeSha256 : t.zipCodeSha256) };
  if (Object.values(checks).some(v => v !== true) || f.CodeSize !== (variant === "before" ? t.beforeZipBytes : t.zipBytes) ||
    typeof f.RevisionId !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(f.RevisionId) ||
    (variant === "before" && f.RevisionId !== t.beforeRevisionId) || (variant === "candidate" && f.RevisionId === t.beforeRevisionId) || !s.async) fail("FUNCTION_OR_CODE_DRIFT");
  const runtime = f.RuntimeVersionConfig as Json | undefined;
  if (runtime && (typeof runtime !== "object" || Array.isArray(runtime) || Object.keys(runtime).some(k => !["RuntimeVersionArn", "Error"].includes(k)) ||
    (runtime.Error !== undefined && runtime.Error !== null) || !/^arn:aws:lambda:ca-central-1::runtime:[a-f0-9]{64}$/.test(String(runtime.RuntimeVersionArn)))) fail("RUNTIME_PATCH_INVALID");
  if (s.async === null) return fail("ASYNC_LOCK_REQUIRED");
  assertCellParentAsyncLockedV5(s.async, { ReservedConcurrentExecutions: 0 });
  const async = cellParentAsyncStateV5(s.async), invariant = { function: cellParentFunctionInvariantV5(f), facts: s.facts, guards: s.guards, async };
  return { invariantSha256: await sha256Hex(invariant), snapshotSha256: await sha256Hex({ function: omit(f, ["$metadata"]), facts: s.facts, guards: s.guards, async }),
    revisionId: String(f.RevisionId), codeSha256: String(f.CodeSha256) };
}
export function v6CodeRequestV9() {
  const t = CELL_PARENT_V6_CODE_UPDATE_V9;
  return cellV3Freeze({ FunctionName: t.functionArn, RevisionId: t.beforeRevisionId, Architectures: ["x86_64"], Publish: false, DryRun: false });
}
export interface V6CodeUpdateReviewV9 {
  schemaVersion: 9; protocol: "locked-v6-code-only-update-review-v9"; reviewedAt: number; expiresAt: number;
  targets: typeof CELL_PARENT_V6_CODE_UPDATE_V9; before: CellParentLockedSnapshotV5; beforeHashes: Awaited<ReturnType<typeof inspectLockedV6CodeSnapshotV9>>;
  codeBindingSha256: string; request: ReturnType<typeof v6CodeRequestV9>; scope: typeof V6_CODE_UPDATE_SCOPE_V9; risks: typeof V6_CODE_UPDATE_RISKS_V9; manifestSha256: string;
}
export async function prepareV6CodeReviewV9(before: CellParentLockedSnapshotV5, codeBindingSha256: string, now: number): Promise<V6CodeUpdateReviewV9> {
  if (!/^[a-f0-9]{64}$/.test(codeBindingSha256)) fail("CODE_BINDING_INVALID");
  const copied = structuredClone(before), beforeHashes = await inspectLockedV6CodeSnapshotV9(copied, "before", now);
  const body = { schemaVersion: 9 as const, protocol: "locked-v6-code-only-update-review-v9" as const, reviewedAt: now, expiresAt: now + 3600000,
    targets: CELL_PARENT_V6_CODE_UPDATE_V9, before: copied, beforeHashes, codeBindingSha256, request: v6CodeRequestV9(), scope: V6_CODE_UPDATE_SCOPE_V9, risks: V6_CODE_UPDATE_RISKS_V9 };
  return cellV3Freeze({ ...body, manifestSha256: await sha256Hex(body) });
}
export async function decodeV6CodeReviewV9(input: unknown) {
  const r = JSON.parse(canonicalJson(input)) as V6CodeUpdateReviewV9;
  if (!cellV3Exact(r, ["schemaVersion", "protocol", "reviewedAt", "expiresAt", "targets", "before", "beforeHashes", "codeBindingSha256", "request", "scope", "risks", "manifestSha256"]) ||
    canonicalJson(await prepareV6CodeReviewV9(r.before, r.codeBindingSha256, r.reviewedAt)) !== canonicalJson(r)) fail("REVIEW_INVALID");
  return cellV3Freeze(r);
}
export function assertV6CodeApprovalV9(r: V6CodeUpdateReviewV9, sha: string, code: string, now: number) {
  cellV3Clock(now); if (r.manifestSha256 !== sha || r.codeBindingSha256 !== code || now < r.reviewedAt || now >= r.expiresAt) fail("FRESH_EXACT_APPROVAL_REQUIRED");
}
export function decodeV6UpdateSimulationV9(raw: unknown) {
  const r = raw as { IsTruncated?: boolean; Marker?: string; EvaluationResults?: Json[] }, resources = [CELL_PARENT_V6_CODE_UPDATE_V9.functionArn, `${CELL_PARENT_V6_CODE_UPDATE_V9.functionArn}:$LATEST`];
  if (!r || r.IsTruncated || r.Marker || !Array.isArray(r.EvaluationResults)) return fail("SIMULATION_INCOMPLETE");
  const found: string[] = [];
  for (const e of r.EvaluationResults) {
    if (e.EvalActionName !== "lambda:UpdateFunctionCode" || e.EvalDecision !== "allowed" || (e.MissingContextValues as unknown[])?.length) fail("SIMULATION_DENIED");
    const entries = e.ResourceSpecificResults === undefined ? [{ EvalResourceName: e.EvalResourceName, EvalResourceDecision: e.EvalDecision }] : e.ResourceSpecificResults as Json[];
    if (!Array.isArray(entries) || !entries.length) fail("SIMULATION_RESOURCES_MISSING");
    for (const v of entries) { if (!resources.includes(String(v.EvalResourceName)) || v.EvalResourceDecision !== "allowed" || (v.MissingContextValues as unknown[])?.length) fail("SIMULATION_DENIED"); found.push(String(v.EvalResourceName)); }
  }
  if (canonicalJson(found.sort()) !== canonicalJson(resources.sort())) fail("SIMULATION_PAIRS_INCOMPLETE");
  return resources.map(resource => ({ action: "lambda:UpdateFunctionCode", resource, decision: "allowed" }));
}
export function v6CodeErrorV9(e: unknown) {
  const error = e && typeof e === "object" ? e as Json : {}, base = boundedRecoveryErrorV7(e);
  return { ...base, safeCode: /^V6_UPDATE_[A-Z0-9_]{2,100}$/.test(String(error.message)) ? String(error.message) :
    ["PreconditionFailedException", "ResourceConflictException", "TooManyRequestsException", "ResourceNotFoundException", "InvalidParameterValueException", "NativeCallError"].includes(String(error.name)) ? String(error.name) : base.safeCode,
    operation: ["SourceIdentity", "StableLocks", "UpdateFunctionCode", "Readiness"].includes(String(error.codeUpdateOperation)) ? String(error.codeUpdateOperation) : base.operation };
}
export interface V6CodeUpdatePortV9 {
  verifySourceAndFiles(): Promise<void>; readStable(): Promise<CellParentLockedSnapshotV5>; claimOnce(sha: string): Promise<boolean>;
  marker(name: string, value: unknown): Promise<unknown>; updateOnce(r: V6CodeUpdateReviewV9): Promise<void>; waitReady(): Promise<void>;
}
export async function runV6CodeUpdateV9(input: unknown, sha: string, code: string, port: V6CodeUpdatePortV9, now = Date.now) {
  let stage = "APPROVAL", slotClaimAttempted = false, slotConsumed = false, updateCallEntered = false, responseReceived = false;
  const phases: { stage: string; startedAt: number; completedAt?: number; failure?: ReturnType<typeof v6CodeErrorV9> }[] = [];
  const step = async <T>(name: string, action: () => Promise<T>): Promise<T> => {
    stage = name; const p: typeof phases[number] = { stage, startedAt: now() }; phases.push(p);
    try { const v = await action(); p.completedAt = now(); return v; } catch (e) { p.completedAt = now(); p.failure = v6CodeErrorV9(e); throw e; }
  };
  const result = (outcome: string) => ({ outcome, stage, phases, slotClaimAttempted, slotConsumed, updateCallEntered, responseReceived, independentInspectRequired: true, retryAuthorized: false, runtimeEnabled: false });
  try {
    const r = await step("APPROVAL", async () => { const r = await decodeV6CodeReviewV9(input); assertV6CodeApprovalV9(r, sha, code, now()); return r; });
    await step("LOCAL_SOURCE_AND_SIMULATION", port.verifySourceAndFiles);
    const live = await step("FULL_LOCKED_PRECHECK", async () => { const s = await port.readStable(); const h = await inspectLockedV6CodeSnapshotV9(s, "before", now());
      if (h.snapshotSha256 !== r.beforeHashes.snapshotSha256) fail("FULL_PRESTATE_DRIFT"); return s; });
    await step("SAVE_FULL_PRECHECK", () => port.marker("locked-precheck.json", live));
    await step("FINAL_LOCAL_AND_WINDOW", async () => { await port.verifySourceAndFiles(); await inspectLockedV6CodeSnapshotV9(live, "before", now()); assertV6CodeApprovalV9(r, sha, code, now()); });
    const claimed = await step("PERMANENT_SLOT", async () => { slotClaimAttempted = true; return port.claimOnce(sha); });
    if (!claimed) return result("V6_CODE_SLOT_OCCUPIED_INSPECT_ONLY"); slotConsumed = true;
    await step("SAVE_ATTEMPT", () => port.marker("code-attempt.json", { approvedSha: sha, request: r.request, zipSha256: r.targets.zipSha256 }));
    await step("FINAL_WINDOW_AND_AGE", async () => { await inspectLockedV6CodeSnapshotV9(live, "before", now()); assertV6CodeApprovalV9(r, sha, code, now()); });
    await step("CODE_SUBMISSION", async () => { updateCallEntered = true; await port.updateOnce(r); responseReceived = true; });
    await step("SAVE_RESPONSE", () => port.marker("code-response.json", { approvedSha: sha, responseReceived }));
    await step("READONLY_READY", port.waitReady);
    await step("FINAL_FULL_LOCKED_READ", async () => { const s = await port.readStable(), h = await inspectLockedV6CodeSnapshotV9(s, "candidate", now());
      if (h.invariantSha256 !== r.beforeHashes.invariantSha256) fail("POST_CODE_LOCK_OR_ASYNC_DRIFT"); await port.marker("code-final-metadata.json", { live: s, hashes: h }); });
    return result("V6_CODE_SUBMITTED_INDEPENDENT_INSPECT_REQUIRED");
  } catch { return result("V6_CODE_STOPPED_INDEPENDENT_INSPECT_ONLY"); }
}
