import { canonicalJson, sha256Hex } from "./hash.ts";
import { cellV3Clock, cellV3Exact, cellV3Freeze } from "../cloudformation/shared-cell-stack-v3.ts";

const fail = (code: string): never => { throw Error(`RETIREMENT_${code}`); };
const eq = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const digest = /^[a-f0-9]{64}$/;
export const RESERVED_RETIREMENT_V6 = cellV3Freeze({
  stackId: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/01a06ca0-c6bf-11f1-898a-0e285576029b",
  stackName: "techlong-sandbox-cell-sandbox-1",
  roleArn: "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole",
  originalApprovalSha256: "afb48684ff3c3c6603a1f23ecc65b3ae33e54c47c028f729e112bef687cc36c2",
  birthIntentSha256: "4f7181ff6f7212fe831d40d52e86ffb98f87297020c4159a43a31b19883c7077",
  cellExpiresAt: "2026-10-13T07:02:35.244Z",
  stableStackSha256: "d3ab47fe8db904134bc2b17d16d71d4b3869ed24d41f181994a9f9ea1433fe85",
  parentCommonSha256: "c4e5ebcb891f4394b01f6416809e43c629b06aeffcd2562a9401c243b258719b",
  foundationSha256: "b9cfa5c2da60cedb53dfcfa11be8cfdf43e0668652f244e36158375680465991",
  creationSlotFileSha256: "89db5acfd987bae79a9f4372d614efee50b58ca0fa95abdfcbba483e7fb2a77b",
  permanentSlot: "techlong-f3c9j-expired-reserved-retirement.permanent-slot.json",
});
export const RESERVED_RETIREMENT_SCOPE_V6 = cellV3Freeze({ maximumWriteCalls: 1, operation: "cloudformation:DeleteStack",
  exactOldStackArnOnly: true, expectedResourceCountBeforeAndAfter: 0, deletionMode: "STANDARD", reuseExactExistingRole: true,
  noForceRetainOrSkip: true, noIamLambdaSecretDatabaseTableScheduleOrOtherResourceWrite: true,
  noCreateUpdateChangeSetInvokeOrParentRegistration: true, preserveAllOldFilesAndSlots: true,
  noAutomaticRetryRollbackCompensationResetFillOrNewBirth: true, monthlyBudgetGoalUsd: 50 });
export const RESERVED_RETIREMENT_RISKS_V6 = cellV3Freeze({ exactIdentityUuidIrrecoverable: true, deletionIsAsynchronous: true,
  checksAreNotCasAndConcurrentCloudMutationCannotBeExcluded: true, iamSimulationNotEffectivePermissionProof: true,
  concurrentPhaseUpdateCouldCauseResourceDeletion: true, responseLossOrTimeoutLeavesSubmissionUncertain: true,
  credentialsRefreshOrIndependentInspectMayFail: true, permanentSlotConsumedBeforeApiEvenWithZeroWrites: true,
  noAutomaticRetryRollbackCompensationResetFillOrNewBirth: true, historicalCreationSlotNeverReset: true,
  noAutomaticExpiryExtensionOrNewGeneration: true, deletionFailureMayLeaveStack: true,
  providerLogsMayContainIdentifiers: true, nonzeroCost: true, fiftyUsdNotHardCap: true });

export interface ReservedRetirementBeforeV6 {
  observedAt: number; stackId: string; stableStackSha256: string; parentCommonSha256: string; foundationSha256: string;
  zeroResourcesReservedAndFlagsVerified: boolean; noChangeSetsOrNonCreationEvents: boolean; sourceDeleteAndPassRoleSimulated: boolean;
}
export function assertRetirementBeforeV6(b: ReservedRetirementBeforeV6, now: number) {
  cellV3Clock(now); cellV3Clock(b.observedAt);
  const t = RESERVED_RETIREMENT_V6;
  if (!cellV3Exact(b, ["observedAt", "stackId", "stableStackSha256", "parentCommonSha256", "foundationSha256",
    "zeroResourcesReservedAndFlagsVerified", "noChangeSetsOrNonCreationEvents", "sourceDeleteAndPassRoleSimulated"]) ||
    b.observedAt > now || now - b.observedAt > 30000 || now < Date.parse(t.cellExpiresAt) || b.stackId !== t.stackId ||
    b.stableStackSha256 !== t.stableStackSha256 || b.parentCommonSha256 !== t.parentCommonSha256 || b.foundationSha256 !== t.foundationSha256 ||
    b.zeroResourcesReservedAndFlagsVerified !== true || b.noChangeSetsOrNonCreationEvents !== true || b.sourceDeleteAndPassRoleSimulated !== true)
    fail("FRESH_EXPIRED_ZERO_RESOURCE_LOCKED_IDENTITY_REQUIRED");
}
export interface ReservedRetirementReviewV6 {
  schemaVersion: 6; protocol: "expired-reserved-identity-retirement-review-v6"; reviewedAt: number; expiresAt: number;
  targets: typeof RESERVED_RETIREMENT_V6; codeBindingSha256: string; before: ReservedRetirementBeforeV6;
  request: { StackName: string; RoleARN: string; ClientRequestToken: string; DeletionMode: "STANDARD" };
  requestSha256: string; scope: typeof RESERVED_RETIREMENT_SCOPE_V6; risks: typeof RESERVED_RETIREMENT_RISKS_V6; manifestSha256: string;
}
async function requestV6(codeBindingSha256: string, reviewedAt: number) {
  const t = RESERVED_RETIREMENT_V6;
  return { StackName: t.stackId, RoleARN: t.roleArn, DeletionMode: "STANDARD" as const,
    ClientRequestToken: `cell-v6-retire-${await sha256Hex({ stackId: t.stackId, birthIntentSha256: t.birthIntentSha256, codeBindingSha256, reviewedAt })}` };
}
export async function prepareRetirementReviewV6(before: ReservedRetirementBeforeV6, codeBindingSha256: string, now: number): Promise<ReservedRetirementReviewV6> {
  assertRetirementBeforeV6(before, now); if (!digest.test(codeBindingSha256)) fail("CODE_DIGEST_INVALID");
  const request = await requestV6(codeBindingSha256, now);
  const body = { schemaVersion: 6 as const, protocol: "expired-reserved-identity-retirement-review-v6" as const,
    reviewedAt: now, expiresAt: now + 3600000, targets: RESERVED_RETIREMENT_V6, codeBindingSha256, before,
    request, requestSha256: await sha256Hex(request), scope: RESERVED_RETIREMENT_SCOPE_V6, risks: RESERVED_RETIREMENT_RISKS_V6 };
  return cellV3Freeze({ ...body, manifestSha256: await sha256Hex(body) });
}
export async function decodeRetirementReviewV6(input: unknown): Promise<ReservedRetirementReviewV6> {
  const r = JSON.parse(canonicalJson(input)) as ReservedRetirementReviewV6;
  if (!cellV3Exact(r, ["schemaVersion", "protocol", "reviewedAt", "expiresAt", "targets", "codeBindingSha256", "before", "request", "requestSha256", "scope", "risks", "manifestSha256"]) ||
    r.schemaVersion !== 6 || r.protocol !== "expired-reserved-identity-retirement-review-v6" || !eq(r.targets, RESERVED_RETIREMENT_V6) ||
    !eq(r.scope, RESERVED_RETIREMENT_SCOPE_V6) || !eq(r.risks, RESERVED_RETIREMENT_RISKS_V6) ||
    [r.codeBindingSha256, r.requestSha256, r.manifestSha256].some(x => !digest.test(x))) fail("MANIFEST_INVALID");
  const rebuilt = await prepareRetirementReviewV6(r.before, r.codeBindingSha256, r.reviewedAt);
  if (!eq(rebuilt, r)) fail("MANIFEST_HASH_OR_REQUEST_INVALID");
  return cellV3Freeze(r);
}
export function assertRetirementApprovalV6(r: ReservedRetirementReviewV6, approval: string, code: string, now: number) {
  cellV3Clock(now);
  if (approval !== r.manifestSha256 || code !== r.codeBindingSha256 || now < r.reviewedAt || now >= r.expiresAt) fail("FRESH_EXACT_APPROVAL_REQUIRED");
}
export interface ReservedRetirementPortV6 {
  verifyFilesAndSource(): Promise<void>; readBefore(): Promise<ReservedRetirementBeforeV6>;
  claimOnce(approvedSha: string): Promise<boolean>; marker(name: string, value: unknown): Promise<unknown>;
  deleteOnce(request: ReservedRetirementReviewV6["request"]): Promise<void>;
}
/** A successful API response is submission only. Never retries or treats it as
 * deletion proof. A new process must perform the independent read-only Inspect. */
export async function runRetirementOnceV6(input: unknown, approvedSha: string, code: string, port: ReservedRetirementPortV6, now = Date.now) {
  let stage = "APPROVAL", slotClaimAttempted = false, slotConsumed = false, deleteCallEntered = false, responseReceived = false;
  const result = (outcome: string) => ({ outcome, stage, slotClaimAttempted, slotConsumed, deleteCallEntered, responseReceived,
    independentInspectRequired: true, retryAuthorized: false, runtimeEnabled: false });
  try {
    const r = await decodeRetirementReviewV6(input); assertRetirementApprovalV6(r, approvedSha, code, now());
    stage = "READONLY_PRECONDITIONS"; await port.verifyFilesAndSource(); assertRetirementBeforeV6(await port.readBefore(), now());
    await port.verifyFilesAndSource(); assertRetirementApprovalV6(r, approvedSha, code, now());
    stage = "PERMANENT_SLOT"; slotClaimAttempted = true;
    if (!await port.claimOnce(approvedSha)) return result("RETIREMENT_SLOT_OCCUPIED_INSPECT_ONLY"); slotConsumed = true;
    await port.marker("delete-attempt.json", { approvedSha, requestSha256: r.requestSha256, writeRetryAuthorized: false });
    await port.verifyFilesAndSource(); assertRetirementBeforeV6(await port.readBefore(), now());
    assertRetirementApprovalV6(r, approvedSha, code, now());
    stage = "DELETE_SUBMISSION"; deleteCallEntered = true; await port.deleteOnce(r.request); responseReceived = true;
    await port.marker("delete-response.json", { approvedSha, responseReceived });
    return result("RETIREMENT_DELETE_SUBMITTED_INDEPENDENT_INSPECT_REQUIRED");
  } catch { return result("RETIREMENT_STOPPED_INDEPENDENT_INSPECT_ONLY"); }
}

export interface RetirementHistoryFrameV6 {
  stackId: string; stackName: string; status: string; zeroResourcesAndOriginalBindingsVerified: boolean;
  noOtherLiveCell: boolean; birthEventsVerified: boolean; deletionEventsVerified: boolean; deletionTime: string | null;
}
/** NOT a generic absence-to-deletion mapper. Missing history or unfamiliar
 * states fail closed, including DELETE_FAILED and any update/paid inventory. */
export function classifyRetirementHistoryV6(frame: RetirementHistoryFrameV6, slotMatches: boolean) {
  const t = RESERVED_RETIREMENT_V6;
  if (frame.stackId !== t.stackId || frame.stackName !== t.stackName || frame.zeroResourcesAndOriginalBindingsVerified !== true ||
    frame.noOtherLiveCell !== true || frame.birthEventsVerified !== true) fail("DELETION_HISTORY_BINDING_INVALID");
  if (frame.status === "CREATE_COMPLETE" && !frame.deletionTime && !frame.deletionEventsVerified) return "RETIREMENT_NOT_DELETED_INSPECT_ONLY";
  if (slotMatches !== true || frame.deletionEventsVerified !== true) fail("DELETION_ATTRIBUTION_UNVERIFIED");
  if (frame.status === "DELETE_IN_PROGRESS" && (!frame.deletionTime || Number.isFinite(Date.parse(frame.deletionTime)))) return "RETIREMENT_DELETE_PENDING_INSPECT_ONLY";
  if (frame.status === "DELETE_COMPLETE" && frame.deletionTime && Number.isFinite(Date.parse(frame.deletionTime))) return "RETIREMENT_ZERO_RESOURCE_DELETION_INDEPENDENTLY_VERIFIED";
  fail("DELETION_TERMINAL_STATE_UNVERIFIED");
}
