import { canonicalJson, sha256Hex } from "./hash.ts";
import { cellV3Clock, cellV3Exact, cellV3Fail, cellV3Freeze } from "../cloudformation/shared-cell-stack-v3.ts";
import { CELL_PARENT_BOOTSTRAP_V4 as old } from "./cell-parent-bootstrap-v4.ts";
import { cellParentLockedFunctionChecksV4 } from "./cell-parent-latest-metadata-v4.ts";
import { normalizeCellParentConfigV5 } from "./cell-parent-compatibility-v5.ts";
import { CELL_PARENT_ASYNC_PLAN_V5, assertCellParentAsyncLockedV5 } from "./cell-parent-async-plan-v5.ts";

export const CELL_PARENT_LOCKED_UPDATE_V5 = cellV3Freeze({
  functionArn: old.functionArn, functionName: old.functionName, roleId: "AROAV3GNMXTZBYYFRN63O",
  beforeRevisionId: "7817b5a5-c53c-4df5-a2a7-e1385fc1d89c", beforeZipCodeSha256Base64: old.zipCodeSha256Base64,
  bundleDirectory: "techlong-f3c9f-parent-bundle-20261012-r3", zipName: "cell-birth-parent-v5.zip", bundleName: "cell-birth-coordinator-v4.mjs",
  bundleSha256: "71f31e586f2eeb737c158b917cf799595f76803f8fe725476e0b6ed47a86f25c",
  zipSha256: "b53ba821ce2619b90c4d941e5bc4969b131d4e9e777f3498a75320deca136e47",
  zipCodeSha256Base64: "tTuoIc4mGbkMTZQeW8SWmxMdTp53fzSYp1Mg3soTbkc=", zipBytes: 432218,
  artifactReportFileSha256: "ce8ff76b25b3dae56498c4e453698f423639541bcb45861e2d11de913d531ddb",
  old70CodeSha256: "1c1bc49285d6ef061e7fede2a82fd720c533fbbe00cff51cf5574bbed529e778",
  permanentSlot: "techlong-f3c9g-locked-function-update.permanent-slot.json",
});
export const CELL_PARENT_LOCKED_UPDATE_SCOPE_V5 = cellV3Freeze({ maximumWriteCalls: 2, existingFunctionCodeUpdate: 1, existingLatestAsyncPut: 1,
  codeRevisionConditionRequired: true, publishVersion: false, asyncAgeSeconds: 60, asyncFunctionErrorRetries: 0, reservedConcurrency: 0,
  retainDenyAllBoundaryAndEmptyRolePolicies: true, noIamTableSecretDatabaseOrCellWrite: true, noInvocationOrTriggerInstallation: true,
  noAutomaticRollbackDeleteResetFillOrWriteRetry: true, monthlyBudgetGoalUsd: 50 });
export const CELL_PARENT_LOCKED_UPDATE_RISKS_V5 = cellV3Freeze({ codeAndAsyncNotAtomic: true, asyncApiHasNoRevisionCas: true,
  partialCodeOrAsyncInstallationMayRemain: true, metadataReadNotEffectiveDenyProof: true, concurrentChangesCannotBeExcluded: true,
  updateResponseAndCompletionRevisionMayDiffer: true, automaticNode22RuntimePatchMayChange: true, credentialsAutoRefreshMayFail: true,
  permanentSlotEvenIfStoppedAfterClaim: true, providerLogsMayContainIdentifiers: true, noAutomaticCompensationOrRetry: true,
  retryZeroDoesNotProveExactlyOnce: true, concurrencyZeroDoesNotCancelRunningInvocations: true, nonzeroCost: true, fiftyUsdNotHardCap: true });
export const CELL_PARENT_LOCK_GUARDS_V5 = Object.freeze(["sourceIdentity", "exactRoleIdTrustBoundary", "denyAllV1Only", "emptyRolePolicies", "bootstrapTags",
  "concurrencyZero", "logRetentionSeven", "exactTableAndNoPolicy", "parentWorkflowAndRegistrationAbsent", "cellStackAbsent",
  "noResourcePolicyOrFunctionUrl", "noAliasesOrPublishedVersions", "noEventSourceMappings", "onlyLatestAsyncConfig", "defaultBusTargetsAbsent"] as const);
type Json = Record<string, unknown>;
export interface CellParentLockedSnapshotV5 {
  observedAt: number; function: Json; async: Json | null; guards: Record<string, boolean>; facts: Json;
}
// These fields are operation/provider outputs, not mutable application config.
// EVERY other returned function field is preserved, including unknown fields.
const outputFields = new Set(["CodeSha256", "CodeSize", "RevisionId", "LastModified", "State", "StateReason", "StateReasonCode",
  "LastUpdateStatus", "LastUpdateStatusReason", "LastUpdateStatusReasonCode", "RuntimeVersionConfig", "$metadata"]);
export function cellParentFunctionInvariantV5(raw: Json) {
  const f = normalizeCellParentConfigV5(raw);
  return Object.fromEntries(Object.entries(f).filter(([k]) => !outputFields.has(k)));
}
export function cellParentAsyncStateV5(raw: Json | null) {
  if (raw === null) return null;
  if (![old.functionArn, `${old.functionArn}:$LATEST`].includes(String(raw.FunctionArn))) cellV3Fail("CELL_PARENT_UPDATE_ASYNC_TARGET_INVALID");
  return Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "LastModified" && k !== "$metadata").map(([k, v]) => [k, k === "FunctionArn" ? old.functionArn : v]));
}
export async function inspectCellParentLockedSnapshotV5(s: CellParentLockedSnapshotV5, stage: "before" | "candidate", now: number) {
  if (!cellV3Exact(s, ["observedAt", "function", "async", "guards", "facts"]) || !cellV3Exact(s.guards, [...CELL_PARENT_LOCK_GUARDS_V5]) ||
    Object.values(s.guards).some(v => v !== true) || !s.facts || typeof s.facts !== "object" || Array.isArray(s.facts)) cellV3Fail("CELL_PARENT_UPDATE_LOCK_GUARDS_INVALID");
  cellV3Clock(now); cellV3Clock(s.observedAt); if (s.observedAt > now || now - s.observedAt > 30000) cellV3Fail("CELL_PARENT_UPDATE_SNAPSHOT_STALE");
  const f = normalizeCellParentConfigV5(s.function), t = CELL_PARENT_LOCKED_UPDATE_V5;
  const checks = { ...cellParentLockedFunctionChecksV4(f), zip: f.CodeSha256 === (stage === "before" ? t.beforeZipCodeSha256Base64 : t.zipCodeSha256Base64) };
  if (Object.values(checks).some(v => v !== true) || typeof f.RevisionId !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(f.RevisionId) ||
    (stage === "before" && f.RevisionId !== t.beforeRevisionId) || (stage === "candidate" && f.CodeSize !== t.zipBytes)) cellV3Fail("CELL_PARENT_UPDATE_FUNCTION_OR_CODE_DRIFT");
  const r = f.RuntimeVersionConfig as Json | undefined;
  if (r && (typeof r !== "object" || Array.isArray(r) || Object.keys(r).some(k => !["RuntimeVersionArn", "Error"].includes(k)) ||
    (r.Error !== undefined && r.Error !== null) || !/^arn:aws:lambda:ca-central-1::runtime:[a-f0-9]{64}$/.test(String(r.RuntimeVersionArn)))) cellV3Fail("CELL_PARENT_UPDATE_RUNTIME_VERSION_INVALID");
  if (s.async !== null) cellParentAsyncStateV5(s.async);
  const invariant = { function: cellParentFunctionInvariantV5(f), facts: s.facts, guards: s.guards };
  return { invariantSha256: await sha256Hex(invariant), asyncSha256: await sha256Hex(cellParentAsyncStateV5(s.async)),
    snapshotSha256: await sha256Hex({ function: f, async: cellParentAsyncStateV5(s.async), facts: s.facts, guards: s.guards }), revisionId: f.RevisionId };
}
export interface CellParentLockedUpdateReviewV5 {
  schemaVersion: 5; protocol: "cell-parent-locked-code-async-review-v5"; reviewedAt: number; expiresAt: number;
  targets: typeof CELL_PARENT_LOCKED_UPDATE_V5; codeBindingSha256: string; before: CellParentLockedSnapshotV5;
  beforeHashes: Awaited<ReturnType<typeof inspectCellParentLockedSnapshotV5>>;
  scope: typeof CELL_PARENT_LOCKED_UPDATE_SCOPE_V5; risks: typeof CELL_PARENT_LOCKED_UPDATE_RISKS_V5; manifestSha256: string;
}
export async function prepareCellParentLockedUpdateReviewV5(before: CellParentLockedSnapshotV5, codeBindingSha256: string, now: number): Promise<Readonly<CellParentLockedUpdateReviewV5>> {
  if (!/^[a-f0-9]{64}$/.test(codeBindingSha256)) cellV3Fail("CELL_PARENT_UPDATE_CODE_BINDING_INVALID");
  const copied = structuredClone(before), beforeHashes = await inspectCellParentLockedSnapshotV5(copied, "before", now);
  const body = { schemaVersion: 5 as const, protocol: "cell-parent-locked-code-async-review-v5" as const, reviewedAt: now, expiresAt: now + 3600000,
    targets: CELL_PARENT_LOCKED_UPDATE_V5, codeBindingSha256, before: copied, beforeHashes, scope: CELL_PARENT_LOCKED_UPDATE_SCOPE_V5, risks: CELL_PARENT_LOCKED_UPDATE_RISKS_V5 };
  return cellV3Freeze({ ...body, manifestSha256: await sha256Hex(body) });
}
export async function decodeCellParentLockedUpdateReviewV5(raw: unknown) {
  const r = raw as CellParentLockedUpdateReviewV5;
  if (!cellV3Exact(r, ["schemaVersion", "protocol", "reviewedAt", "expiresAt", "targets", "codeBindingSha256", "before", "beforeHashes", "scope", "risks", "manifestSha256"]) ||
    r.schemaVersion !== 5 || r.protocol !== "cell-parent-locked-code-async-review-v5") cellV3Fail("CELL_PARENT_UPDATE_REVIEW_INVALID");
  const expected = await prepareCellParentLockedUpdateReviewV5(r.before, r.codeBindingSha256, r.reviewedAt);
  if (canonicalJson(expected) !== canonicalJson(r)) cellV3Fail("CELL_PARENT_UPDATE_REVIEW_BINDING_OR_SCOPE_INVALID"); return expected;
}
export function cellParentLockedUpdateRequestsV5() {
  const t = CELL_PARENT_LOCKED_UPDATE_V5;
  return cellV3Freeze([
    { action: "update-function-code", input: { FunctionName: t.functionArn, RevisionId: t.beforeRevisionId, Publish: false, DryRun: false, Architectures: ["x86_64"] }, zipSha256: t.zipSha256 },
    { action: "put-function-event-invoke-config", input: CELL_PARENT_ASYNC_PLAN_V5.eventInvokeInput },
  ] as const);
}
/** IAM may aggregate two resource results under each action rather than emit
 * four top-level results. Require the SAME four exact allowed pairs, without
 * guessing allow from aggregate templates or missing-resource results. */
export function decodeCellParentUpdateSimulationV5(raw: unknown) {
  const response = raw as { IsTruncated?: boolean; Marker?: string; EvaluationResults?: { EvalActionName?: string; EvalResourceName?: string;
    EvalDecision?: string; MissingContextValues?: unknown[]; ResourceSpecificResults?: { EvalResourceName?: string; EvalResourceDecision?: string; MissingContextValues?: unknown[] }[] }[] };
  const actions = ["lambda:UpdateFunctionCode", "lambda:PutFunctionEventInvokeConfig"], resources = [old.functionArn, `${old.functionArn}:$LATEST`];
  if (!response || response.IsTruncated || response.Marker || !Array.isArray(response.EvaluationResults)) cellV3Fail("CELL_PARENT_UPDATE_SIMULATION_INCOMPLETE");
  const results = response.EvaluationResults.flatMap(x => {
    if (!actions.includes(String(x.EvalActionName)) || x.EvalDecision !== "allowed" || x.MissingContextValues?.length) cellV3Fail("CELL_PARENT_UPDATE_SIMULATION_NOT_ALLOWED");
    const entries = x.ResourceSpecificResults === undefined ? [{ EvalResourceName: x.EvalResourceName, EvalResourceDecision: x.EvalDecision }] : x.ResourceSpecificResults;
    if (!Array.isArray(entries) || !entries.length) cellV3Fail("CELL_PARENT_UPDATE_SIMULATION_RESOURCE_MISSING");
    return entries.map(e => {
      if (!resources.includes(String(e.EvalResourceName)) || e.EvalResourceDecision !== "allowed" || e.MissingContextValues?.length) cellV3Fail("CELL_PARENT_UPDATE_SIMULATION_NOT_ALLOWED");
      return { action: x.EvalActionName as string, resource: e.EvalResourceName as string, decision: "allowed" };
    });
  });
  const pairs = results.map(x => `${x.action}\0${x.resource}`).sort();
  if (canonicalJson(pairs) !== canonicalJson(actions.flatMap(a => resources.map(r => `${a}\0${r}`)).sort())) cellV3Fail("CELL_PARENT_UPDATE_SIMULATION_PAIRS_INCOMPLETE");
  return results;
}
export interface CellParentLockedUpdatePortV5 {
  verifySourceAndFiles(): Promise<void>; readStable(): Promise<CellParentLockedSnapshotV5>;
  claimPermanentOnce(approvedSha: string): Promise<boolean>;
  marker(name: string, value: Json): Promise<void>;
  write(index: 0 | 1, request: ReturnType<typeof cellParentLockedUpdateRequestsV5>[number]): Promise<void>;
  waitCodeReady(): Promise<void>;
}
/** Sole two-write order shared by CLI. Uncertain submissions/response failures,
 * readback errors or drift STOP; subsequent Inspect never retries/compensates. */
export async function runCellParentLockedUpdateV5(raw: unknown, approvedSha: string, codeBindingSha: string, port: CellParentLockedUpdatePortV5, now: () => number = Date.now) {
  const r = await decodeCellParentLockedUpdateReviewV5(raw);
  if (approvedSha !== r.manifestSha256 || codeBindingSha !== r.codeBindingSha256) cellV3Fail("CELL_PARENT_UPDATE_EXACT_APPROVAL_REQUIRED");
  let writesAttempted = 0, slotConsumed = false, stage = "PRECHECK", candidateRevision: string | null = null;
  const active = () => { const n = cellV3Clock(now()); if (n < r.reviewedAt || n >= r.expiresAt) cellV3Fail("CELL_PARENT_UPDATE_APPROVAL_EXPIRED"); };
  const result = (outcome: string) => ({ outcome, writesAttempted, slotConsumed, stage, candidateRevision, retryAuthorized: false, runtimeEnabled: false, independentInspectRequired: true });
  try {
    active(); await port.verifySourceAndFiles();
    const first = await inspectCellParentLockedSnapshotV5(await port.readStable(), "before", now());
    if (first.snapshotSha256 !== r.beforeHashes.snapshotSha256) cellV3Fail("CELL_PARENT_UPDATE_REVIEW_PRESTATE_DRIFT");
    active(); if (!await port.claimPermanentOnce(approvedSha)) return result("LOCKED_UPDATE_SLOT_OCCUPIED_INSPECT_ONLY"); slotConsumed = true;
    await port.marker("approved-manifest.json", r as unknown as Json);
    for (const [index, request] of cellParentLockedUpdateRequestsV5().entries()) {
      stage = index === 0 ? "CODE_PREWRITE" : "ASYNC_PREWRITE"; active(); await port.verifySourceAndFiles();
      const live = await inspectCellParentLockedSnapshotV5(await port.readStable(), index === 0 ? "before" : "candidate", now());
      if (live.invariantSha256 !== r.beforeHashes.invariantSha256 || live.asyncSha256 !== r.beforeHashes.asyncSha256 || (index === 0 && live.snapshotSha256 !== r.beforeHashes.snapshotSha256)) cellV3Fail("CELL_PARENT_UPDATE_PREWRITE_DRIFT");
      if (index === 1) candidateRevision = live.revisionId;
      await port.marker(`${index + 1}-attempt.json`, { approvedSha, request, observedRevisionId: live.revisionId });
      active(); await port.verifySourceAndFiles(); active(); stage = index === 0 ? "CODE_SUBMISSION" : "ASYNC_SUBMISSION";
      writesAttempted++; await port.write(index as 0 | 1, request);
      await port.marker(`${index + 1}-response-received.json`, { approvedSha, responseReceived: true });
      if (index === 0) { stage = "CODE_READONLY_WAIT"; await port.waitCodeReady(); }
    }
    stage = "FINAL_READONLY_INSPECT"; const final = await port.readStable();
    const hashes = await inspectCellParentLockedSnapshotV5(final, "candidate", now());
    if (hashes.invariantSha256 !== r.beforeHashes.invariantSha256) cellV3Fail("CELL_PARENT_UPDATE_FINAL_INVARIANT_DRIFT");
    if (!final.async) cellV3Fail("CELL_PARENT_UPDATE_ASYNC_MISSING");
    assertCellParentAsyncLockedV5(final.async, { ReservedConcurrentExecutions: 0 });
    await port.marker("final-metadata.json", { snapshot: final, hashes });
    candidateRevision = hashes.revisionId; return result("LOCKED_CODE_ASYNC_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT");
  } catch { return result("LOCKED_UPDATE_STOPPED_INDEPENDENT_INSPECT_ONLY"); }
}
