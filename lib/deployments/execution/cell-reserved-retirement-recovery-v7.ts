import { canonicalJson, sha256Hex } from "./hash.ts";
import { cellV3Clock, cellV3Exact, cellV3Freeze } from "../cloudformation/shared-cell-stack-v3.ts";
import { RESERVED_RETIREMENT_V6 as old, RESERVED_RETIREMENT_SCOPE_V6, RESERVED_RETIREMENT_RISKS_V6,
  assertRetirementBeforeV6, type ReservedRetirementBeforeV6 } from "./cell-reserved-retirement-v6.ts";

const fail = (code: string): never => { throw Error(`RECOVERY_${code}`); };
const eq = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
export const RESERVED_RETIREMENT_RECOVERY_V7 = cellV3Freeze({ ...old,
  permanentSlot: "techlong-f3c9k-expired-reserved-retirement-recovery.permanent-slot.json",
  oldRetirementSlot: old.permanentSlot, oldRetirementSlotFileSha256: "7b31496eac7f43265faa0043a50b0c9df1af70b61d7076794b2ef0b1534d7898",
  oldRetirementApprovalSha256: "85838a3ce01f7acfb04c3acb202d0f9ad4e4c8a1f9c31a2e6d03b5361ab0b6ec",
  templateCanonicalSha256: "49e879c2b5df9f0f4d50b13a2f71be3cacdb0f297d04ed993662684839e97224" });
export const RETIREMENT_RECOVERY_SCOPE_V7 = cellV3Freeze({ ...RESERVED_RETIREMENT_SCOPE_V6,
  oneSeparatelyApprovedRecoveryAttempt: true, fullPreconditionsBeforeNewSlotOnly: true,
  finalDoubleStackTemplateInventoryAndChangeSetGuard: true, maximumFullEvidenceAgeMs: 30000 });
export const RETIREMENT_RECOVERY_RISKS_V7 = cellV3Freeze({ ...RESERVED_RETIREMENT_RISKS_V6,
  newAttemptDoesNotProveOriginalFailureCause: true, oldConsumedRetirementSlotNeverReset: true,
  fullIamParentAndSourceSimulationFactsNotRereadAfterClaim: true,
  boundedThirtySecondOldestFullReadWindowDoesNotPreventDrift: true,
  stageDiagnosticsCanAlsoFailToSave: true });

export interface RecoveryCompleteReadV7 { startedAt: number; completedAt: number; before: ReservedRetirementBeforeV6 }
export function assertRecoveryCompleteReadV7(read: RecoveryCompleteReadV7, now: number) {
  cellV3Clock(now); cellV3Clock(read.startedAt); cellV3Clock(read.completedAt);
  if (!cellV3Exact(read, ["startedAt", "completedAt", "before"]) || read.startedAt > read.completedAt || read.completedAt > now ||
    now - read.startedAt > 30000 || read.before.observedAt < read.startedAt || read.before.observedAt > read.completedAt) fail("FULL_READ_WINDOW_INVALID");
  assertRetirementBeforeV6(read.before, now);
}
export interface RecoveryLightFrameV7 {
  stackId: string; stackStatus: string; stableOriginalSha256: string; templateCanonicalSha256: string;
  resourceCount: number; changeSetCount: number; flagsVerified: boolean;
}
export function assertRecoveryLightFrameV7(f: RecoveryLightFrameV7) {
  const t = RESERVED_RETIREMENT_RECOVERY_V7;
  if (!cellV3Exact(f, ["stackId", "stackStatus", "stableOriginalSha256", "templateCanonicalSha256", "resourceCount", "changeSetCount", "flagsVerified"]) ||
    f.stackId !== t.stackId || f.stackStatus !== "CREATE_COMPLETE" || f.stableOriginalSha256 !== t.stableStackSha256 ||
    f.templateCanonicalSha256 !== t.templateCanonicalSha256 || f.resourceCount !== 0 || f.changeSetCount !== 0 || f.flagsVerified !== true) fail("FINAL_STACK_GUARD_DRIFT");
}
export interface RecoveryFinalReadV7 { startedAt: number; completedAt: number; frame: RecoveryLightFrameV7; sourceVerified: boolean }
export function assertRecoveryFinalReadV7(read: RecoveryFinalReadV7, full: RecoveryCompleteReadV7, now: number) {
  cellV3Clock(read.startedAt); cellV3Clock(read.completedAt); assertRecoveryCompleteReadV7(full, now);
  if (!cellV3Exact(read, ["startedAt", "completedAt", "frame", "sourceVerified"]) || read.startedAt < full.completedAt || read.completedAt < read.startedAt ||
    read.completedAt > now || now - read.startedAt > 10000 || read.sourceVerified !== true) fail("FINAL_READ_WINDOW_INVALID");
  assertRecoveryLightFrameV7(read.frame);
}
export interface RetirementRecoveryReviewV7 {
  schemaVersion: 7; protocol: "expired-reserved-identity-retirement-recovery-review-v7"; reviewedAt: number; expiresAt: number;
  targets: typeof RESERVED_RETIREMENT_RECOVERY_V7; codeBindingSha256: string; complete: RecoveryCompleteReadV7;
  request: { StackName: string; RoleARN: string; ClientRequestToken: string; DeletionMode: "STANDARD" };
  requestSha256: string; scope: typeof RETIREMENT_RECOVERY_SCOPE_V7; risks: typeof RETIREMENT_RECOVERY_RISKS_V7; manifestSha256: string;
}
export async function prepareRetirementRecoveryV7(complete: RecoveryCompleteReadV7, codeBindingSha256: string, now: number): Promise<RetirementRecoveryReviewV7> {
  assertRecoveryCompleteReadV7(complete, now); if (!/^[a-f0-9]{64}$/.test(codeBindingSha256)) fail("CODE_DIGEST_INVALID");
  const t = RESERVED_RETIREMENT_RECOVERY_V7;
  const request = { StackName: t.stackId, RoleARN: t.roleArn, DeletionMode: "STANDARD" as const,
    ClientRequestToken: `cell-v7-retire-${await sha256Hex({ stackId: t.stackId, permanentSlot: t.permanentSlot, oldRetirementSlotFileSha256: t.oldRetirementSlotFileSha256, codeBindingSha256, reviewedAt: now })}` };
  const body = { schemaVersion: 7 as const, protocol: "expired-reserved-identity-retirement-recovery-review-v7" as const,
    reviewedAt: now, expiresAt: now + 3600000, targets: t, codeBindingSha256, complete, request,
    requestSha256: await sha256Hex(request), scope: RETIREMENT_RECOVERY_SCOPE_V7, risks: RETIREMENT_RECOVERY_RISKS_V7 };
  return cellV3Freeze({ ...body, manifestSha256: await sha256Hex(body) });
}
export async function decodeRetirementRecoveryV7(input: unknown): Promise<RetirementRecoveryReviewV7> {
  const r = JSON.parse(canonicalJson(input)) as RetirementRecoveryReviewV7;
  if (!cellV3Exact(r, ["schemaVersion", "protocol", "reviewedAt", "expiresAt", "targets", "codeBindingSha256", "complete", "request", "requestSha256", "scope", "risks", "manifestSha256"]) ||
    !eq(await prepareRetirementRecoveryV7(r.complete, r.codeBindingSha256, r.reviewedAt), r)) fail("MANIFEST_INVALID");
  return cellV3Freeze(r);
}
export function assertRecoveryApprovalV7(r: RetirementRecoveryReviewV7, sha: string, code: string, now: number) {
  cellV3Clock(now);
  if (r.manifestSha256 !== sha || r.codeBindingSha256 !== code || now < r.reviewedAt || now >= r.expiresAt) fail("FRESH_EXACT_APPROVAL_REQUIRED");
}
type Json = Record<string, unknown>;
const providerNames = new Set(["Error", "TypeError", "SyntaxError", "CredentialsProviderError", "Throttling", "ThrottlingException", "AccessDenied", "AccessDeniedException",
  "ValidationError", "TimeoutError", "AbortError", "ExpiredToken", "ExpiredTokenException", "InvalidClientTokenId", "ServiceException", "NetworkingError"]);
export function boundedRecoveryErrorV7(error: unknown) {
  const e = error && typeof error === "object" ? error as Json : {}, m = e.$metadata && typeof e.$metadata === "object" ? e.$metadata as Json : {};
  const safeCode = /^(RECOVERY|RETIREMENT|RESERVATION|CELL_PARENT_UPDATE|LOCKED_UPDATE)_[A-Z0-9_]{2,100}$/.test(String(e.message)) ? String(e.message) :
    providerNames.has(String(e.name)) ? String(e.name) : "ProviderError";
  return { safeCode, operation: typeof e.recoveryOperation === "string" && /^(?:CompleteRead|SourceIdentity|DescribeStacks|GetTemplate|ListStackResources|ListChangeSets|DeleteStack|IndependentInspect)$/.test(e.recoveryOperation) ? e.recoveryOperation : null,
    providerRequestId: typeof m.requestId === "string" && /^[A-Za-z0-9-]{1,80}$/.test(m.requestId) ? m.requestId : null,
    httpStatusCode: Number.isInteger(m.httpStatusCode) && Number(m.httpStatusCode) >= 100 && Number(m.httpStatusCode) <= 599 ? Number(m.httpStatusCode) : null };
}
export interface RetirementRecoveryPortV7 {
  verifyFilesAndSource(): Promise<void>; readComplete(): Promise<RecoveryCompleteReadV7>;
  claimOnce(approvedSha: string): Promise<boolean>; marker(name: string, value: unknown): Promise<unknown>;
  readFinalStack(): Promise<RecoveryFinalReadV7>; deleteOnce(request: RetirementRecoveryReviewV7["request"]): Promise<void>;
}
export async function runRetirementRecoveryV7(input: unknown, approvedSha: string, code: string, port: RetirementRecoveryPortV7, now = Date.now) {
  let stage = "APPROVAL", slotClaimAttempted = false, slotConsumed = false, deleteCallEntered = false, responseReceived = false;
  const phases: { stage: string; startedAt: number; completedAt?: number; failure?: ReturnType<typeof boundedRecoveryErrorV7> }[] = [];
  const step = async <T>(name: string, action: () => Promise<T>): Promise<T> => {
    stage = name; const entry: typeof phases[number] = { stage, startedAt: now() }; phases.push(entry);
    try { const v = await action(); entry.completedAt = now(); return v; }
    catch (e) { entry.completedAt = now(); entry.failure = boundedRecoveryErrorV7(e); throw e; }
  };
  const result = (outcome: string) => ({ outcome, stage, phases, slotClaimAttempted, slotConsumed, deleteCallEntered, responseReceived,
    independentInspectRequired: true, retryAuthorized: false, runtimeEnabled: false });
  try {
    const r = await step("APPROVAL", async () => { const r = await decodeRetirementRecoveryV7(input); assertRecoveryApprovalV7(r, approvedSha, code, now()); return r; });
    await step("LOCAL_AND_SOURCE_BINDING", port.verifyFilesAndSource);
    const full = await step("COMPLETE_READONLY_PRECONDITIONS", async () => { const f = await port.readComplete(); assertRecoveryCompleteReadV7(f, now()); return f; });
    await step("SAVE_COMPLETE_PRECHECK", () => port.marker("complete-precheck.json", full));
    await step("FINAL_LOCAL_BEFORE_CLAIM", async () => { await port.verifyFilesAndSource(); assertRecoveryCompleteReadV7(full, now()); assertRecoveryApprovalV7(r, approvedSha, code, now()); });
    const claimed = await step("NEW_PERMANENT_SLOT", async () => { slotClaimAttempted = true; return port.claimOnce(approvedSha); });
    if (!claimed) return result("RECOVERY_SLOT_OCCUPIED_INSPECT_ONLY"); slotConsumed = true;
    await step("SAVE_DELETE_ATTEMPT", () => port.marker("delete-attempt.json", { approvedSha, requestSha256: r.requestSha256, fullReadStartedAt: full.startedAt, retryAuthorized: false }));
    const final = await step("FINAL_LIGHTWEIGHT_STACK_GUARD", async () => { const f = await port.readFinalStack(); assertRecoveryFinalReadV7(f, full, now()); return f; });
    await step("SAVE_FINAL_STACK_GUARD", () => port.marker("final-stack-guard.json", final));
    await step("FINAL_APPROVAL_AND_EVIDENCE_AGE", async () => { assertRecoveryFinalReadV7(final, full, now()); assertRecoveryApprovalV7(r, approvedSha, code, now()); });
    await step("DELETE_SUBMISSION", async () => { deleteCallEntered = true; await port.deleteOnce(r.request); responseReceived = true; });
    await step("SAVE_DELETE_RESPONSE", () => port.marker("delete-response.json", { approvedSha, responseReceived }));
    return result("RECOVERY_DELETE_SUBMITTED_INDEPENDENT_INSPECT_REQUIRED");
  } catch { return result("RECOVERY_STOPPED_INDEPENDENT_INSPECT_ONLY"); }
}
