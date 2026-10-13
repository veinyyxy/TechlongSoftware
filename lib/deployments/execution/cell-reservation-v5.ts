import { canonicalJson, sha256Hex } from "./hash.ts";
import { assertCellStackPlanV3, decodeCellStackPlanV3, cellV3Clock, cellV3Exact, cellV3Fail, cellV3Freeze, CELL_V3_CFN_ROLE, type CellStackPlanV3 } from "../cloudformation/shared-cell-stack-v3.ts";
import { inspectCellParentLockedSnapshotV5, type CellParentLockedSnapshotV5 } from "./cell-parent-locked-update-v5.ts";
import { assertCellParentAsyncLockedV5 } from "./cell-parent-async-plan-v5.ts";
import { normalizeCellParentConfigV5 } from "./cell-parent-compatibility-v5.ts";
import { assertCellStackSnapshotV3, type CellStackSnapshotV3 } from "./aws-sdk-cell-stack-evidence-v3.ts";

type Json = Record<string, unknown>;
const digest = /^[a-f0-9]{64}$/;
export const CELL_RESERVATION_V5 = cellV3Freeze({ stackName: "techlong-sandbox-cell-sandbox-1", roleArn: CELL_V3_CFN_ROLE,
  roleId: "AROAV3GNMXTZOJLYFB4HB", boundaryArn: "arn:aws:iam::402010193138:policy/TechlongSandboxCellCloudFormationExecutionBoundary",
  parentRevisionId: "4a5f64bb-f47e-4e56-a468-1364f4381767", parentInstalledSnapshotSha256: "5e758fe60104f0baa813f0742115b81a09b3c618a87d2a304e7514f53d3e0ab0",
  previous95CodeSha256: "3d6b3e7770d6074be0f3594fdd73b485a959ee2540732dbd29169c0bb27f32be",
  permanentSlot: "techlong-f3c9h-reserved-identity-create.permanent-slot.json" });
export const CELL_RESERVATION_SCOPE_V5 = cellV3Freeze({ maximumWriteCalls: 1, operation: "cloudformation:CreateStack", phase: "RESERVED",
  expectedCreatedResourceCount: 0, reuseExistingLockedCloudFormationRole: true, disableRollback: true, terminationProtection: false,
  noChangeSetOrStackUpdateDelete: true, noIamTableSecretDatabaseLambdaOrSchedulerWrite: true, noInvocationOrParentRegistration: true,
  noAutomaticRetryRollbackDeleteFillReset: true, monthlyBudgetGoalUsd: 50 });
export const CELL_RESERVATION_RISKS_V5 = cellV3Freeze({ concurrentCloudChangesCannotBeExcluded: true, readChecksAreNotCas: true,
  iamSimulationNotEffectivePermissionProof: true, createResponseLossMayLeaveStack: true, failureMayLeaveIdentityStack: true,
  permanentSlotConsumedBeforeSubmissionEvenIfZeroWrites: true, noAutomaticRetryRollbackDeleteFillReset: true,
  maskedFullTemplateContainsFuturePaidResources: true, futurePhaseChangeNeedsSeparateApproval: true,
  lockedRoleRetainedForFutureStackOperations: true, reservedStackHasNoAutomaticCleanupSchedule: true,
  threeHourPlanTtlStartsAtReviewNotCreate: true, expiredBirthCannotBeRebasedInPlace: true,
  credentialsAutoRefreshMayFail: true, providerLogsMayContainIdentifiers: true, nonzeroCost: true, fiftyUsdNotHardCap: true });
const trust = { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "cloudformation.amazonaws.com" }, Action: "sts:AssumeRole" }] };
const eq = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const omit = (v: Json, keys: string[]) => Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k)));
export function assertReservationFoundationV5(f: Json) {
  if (!cellV3Exact(f, ["role", "boundary", "foundationMetadataVerified", "sourceCreateAllowed", "sourcePassRoleAllowed"]) ||
    f.foundationMetadataVerified !== true || f.sourceCreateAllowed !== true || f.sourcePassRoleAllowed !== true) cellV3Fail("RESERVATION_FOUNDATION_UNVERIFIED");
  const r = f.role as Json, b = f.boundary as Json;
  if (!r || r.Arn !== CELL_RESERVATION_V5.roleArn || r.RoleId !== CELL_RESERVATION_V5.roleId || !eq(r.AssumeRolePolicyDocument, trust) ||
    (r.PermissionsBoundary as Json)?.PermissionsBoundaryArn !== CELL_RESERVATION_V5.boundaryArn || !eq(r.inline, []) || !eq(r.attached, []) ||
    !b || b.arn !== CELL_RESERVATION_V5.boundaryArn || typeof b.defaultVersion !== "string" || !b.document || !Array.isArray(b.versions)) cellV3Fail("RESERVATION_ROLE_OR_BOUNDARY_DRIFT");
}
/** Cold reconstruction checks the entire deterministic blueprint, not just a
 * supplied resource count or approval hash. Both known conditions are false. */
export function reservationRequestV5(plan: CellStackPlanV3) {
  assertCellStackPlanV3(plan);
  const template = plan.template, resources = template.Resources as Record<string, Json>;
  if (plan.stackName !== CELL_RESERVATION_V5.stackName || template.Transform ||
    !eq(template.Conditions, { HasLifecycleSchedule: { "Fn::Not": [{ "Fn::Equals": [{ Ref: "LifecyclePhase" }, "RESERVED"] }] },
      HasPaidCellResources: { "Fn::Equals": [{ Ref: "LifecyclePhase" }, "PAID"] } }) ||
    plan.phaseParameters.RESERVED.LifecyclePhase !== "RESERVED" || !resources || !Object.keys(resources).length ||
    Object.entries(resources).some(([id, r]) => r.Condition !== (id === "CellLifecycleScheduleV3" ? "HasLifecycleSchedule" : "HasPaidCellResources") ||
      typeof r.Type !== "string" || /^(Custom::|AWS::CloudFormation::|AWS::IAM::)/.test(r.Type)) || Buffer.byteLength(plan.templateBody) > 51200)
    cellV3Fail("RESERVATION_ZERO_RESOURCE_CONDITIONS_REQUIRED");
  return cellV3Freeze({ StackName: plan.stackName, TemplateBody: plan.templateBody, RoleARN: CELL_V3_CFN_ROLE,
    Parameters: Object.entries(plan.phaseParameters.RESERVED).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })),
    Tags: Object.entries(plan.tags).map(([Key, Value]) => ({ Key, Value })), ClientRequestToken: plan.reservationClientToken,
    DisableRollback: true, EnableTerminationProtection: false, TimeoutInMinutes: 5 });
}
/** After creation the old adapter truthfully reports cellStackAbsent=false.
 * No synthetic absence proof is minted: compare all OTHER exact lock facts to
 * the reviewed snapshot and separately require branded zero-resource evidence. */
export async function reservationParentCommonHashV5(s: CellParentLockedSnapshotV5, stackAbsent: boolean, now: number) {
  cellV3Clock(now); cellV3Clock(s.observedAt);
  if (s.observedAt > now || now - s.observedAt > 30000 || s.guards.cellStackAbsent !== stackAbsent ||
    Object.entries(s.guards).some(([k, v]) => k !== "cellStackAbsent" && v !== true) || s.function.RevisionId !== CELL_RESERVATION_V5.parentRevisionId || !s.async)
    cellV3Fail("RESERVATION_PARENT_LOCK_DRIFT");
  assertCellParentAsyncLockedV5(s.async, { ReservedConcurrentExecutions: 0 });
  return sha256Hex({ function: omit(normalizeCellParentConfigV5(s.function), ["$metadata"]), async: s.async,
    facts: s.facts, guards: omit(s.guards, ["cellStackAbsent"]) });
}
export interface CellReservationReviewV5 {
  schemaVersion: 5; protocol: "cell-reserved-identity-create-review-v5"; reviewedAt: number; expiresAt: number;
  targets: typeof CELL_RESERVATION_V5; codeBindingSha256: string; plan: CellStackPlanV3;
  request: ReturnType<typeof reservationRequestV5>; requestSha256: string; parentCommonSha256: string;
  foundation: Json; foundationSha256: string; scope: typeof CELL_RESERVATION_SCOPE_V5; risks: typeof CELL_RESERVATION_RISKS_V5; manifestSha256: string;
}
export async function prepareReservationReviewV5(plan: CellStackPlanV3, parent: CellParentLockedSnapshotV5, foundation: Json, codeBindingSha256: string, now: number): Promise<CellReservationReviewV5> {
  const p = await decodeCellStackPlanV3(plan), hashes = await inspectCellParentLockedSnapshotV5(parent, "candidate", now);
  if (hashes.snapshotSha256 !== CELL_RESERVATION_V5.parentInstalledSnapshotSha256 || !digest.test(codeBindingSha256) ||
    p.intent.input.base.requestedAt > now || now - p.intent.input.base.requestedAt > 30000) cellV3Fail("RESERVATION_FRESH_INSTALLED_PARENT_AND_PLAN_REQUIRED");
  assertReservationFoundationV5(foundation); const request = reservationRequestV5(p);
  const body = { schemaVersion: 5 as const, protocol: "cell-reserved-identity-create-review-v5" as const, reviewedAt: now, expiresAt: now + 3600000,
    targets: CELL_RESERVATION_V5, codeBindingSha256, plan: p, request, requestSha256: await sha256Hex(request),
    parentCommonSha256: await reservationParentCommonHashV5(parent, true, now), foundation,
    foundationSha256: await sha256Hex(foundation), scope: CELL_RESERVATION_SCOPE_V5, risks: CELL_RESERVATION_RISKS_V5 };
  return cellV3Freeze({ ...body, manifestSha256: await sha256Hex(body) });
}
export async function decodeReservationReviewV5(value: unknown): Promise<CellReservationReviewV5> {
  const r = JSON.parse(canonicalJson(value)) as CellReservationReviewV5;
  if (!cellV3Exact(r, ["schemaVersion", "protocol", "reviewedAt", "expiresAt", "targets", "codeBindingSha256", "plan", "request", "requestSha256", "parentCommonSha256", "foundation", "foundationSha256", "scope", "risks", "manifestSha256"]) ||
    r.schemaVersion !== 5 || r.protocol !== "cell-reserved-identity-create-review-v5" || !eq(r.targets, CELL_RESERVATION_V5) ||
    !eq(r.scope, CELL_RESERVATION_SCOPE_V5) || !eq(r.risks, CELL_RESERVATION_RISKS_V5) ||
    [r.codeBindingSha256, r.requestSha256, r.parentCommonSha256, r.foundationSha256, r.manifestSha256].some(x => !digest.test(x))) cellV3Fail("RESERVATION_MANIFEST_INVALID");
  cellV3Clock(r.reviewedAt); cellV3Clock(r.expiresAt); const plan = await decodeCellStackPlanV3(r.plan);
  assertReservationFoundationV5(r.foundation);
  if (r.expiresAt !== r.reviewedAt + 3600000 || plan.intent.input.base.requestedAt > r.reviewedAt || r.reviewedAt - plan.intent.input.base.requestedAt > 30000 ||
    r.expiresAt >= Date.parse(plan.intent.cellExpiresAt) || !eq(r.request, reservationRequestV5(plan)) || await sha256Hex(r.request) !== r.requestSha256 ||
    await sha256Hex(r.foundation) !== r.foundationSha256) cellV3Fail("RESERVATION_REQUEST_OR_CLOCK_INVALID");
  const { manifestSha256, ...body } = r; if (await sha256Hex(body) !== manifestSha256) cellV3Fail("RESERVATION_MANIFEST_HASH_INVALID");
  return cellV3Freeze({ ...r, plan });
}
export function assertReservationApprovalV5(r: CellReservationReviewV5, approvedSha: string, codeSha: string, now: number) {
  cellV3Clock(now);
  if (approvedSha !== r.manifestSha256 || codeSha !== r.codeBindingSha256 || now < r.reviewedAt || now >= r.expiresAt)
    cellV3Fail("RESERVATION_FRESH_EXACT_APPROVAL_REQUIRED");
}
export function assertReservedEvidenceV5(r: CellReservationReviewV5, evidence: CellStackSnapshotV3) {
  assertCellStackSnapshotV3(evidence);
  if (evidence.profile !== "source_inspection" || evidence.phase !== "RESERVED" || evidence.stackStatus !== "CREATE_COMPLETE" || evidence.resources.length ||
    evidence.failedCreationOrPhase || evidence.birthIntentSha256 !== r.plan.birthIntentSha256 || evidence.templateCanonicalSha256 !== r.plan.templateCanonicalSha256)
    cellV3Fail("RESERVATION_COMPLETE_ZERO_RESOURCE_EVIDENCE_REQUIRED");
}
export interface ReservationPortV5 {
  verifyFilesAndSource(): Promise<void>;
  readBefore(): Promise<{ parent: CellParentLockedSnapshotV5; foundation: Json; absence: boolean }>;
  claimOnce(sha: string): Promise<boolean>;
  marker(name: string, value: unknown): Promise<unknown>;
  createOnce(request: ReturnType<typeof reservationRequestV5>): Promise<string>;
  waitReadOnly(stackId: string): Promise<void>;
}
export async function runReservationOnceV5(input: unknown, approvedSha: string, codeSha: string, port: ReservationPortV5, now: () => number = Date.now) {
  let stage = "APPROVAL", slotConsumed = false, createCallEntered = false, responseReceived = false, stackId: string | null = null;
  const result = (outcome: string) => ({ outcome, stage, slotConsumed, createCallEntered, responseReceived, stackId,
    independentInspectRequired: true, retryAuthorized: false, runtimeEnabled: false });
  try {
    const r = await decodeReservationReviewV5(input); assertReservationApprovalV5(r, approvedSha, codeSha, now());
    stage = "READONLY_PRECONDITIONS"; await port.verifyFilesAndSource(); const before = await port.readBefore();
    assertReservationFoundationV5(before.foundation);
    if (!before.absence || await sha256Hex(before.foundation) !== r.foundationSha256 ||
      await reservationParentCommonHashV5(before.parent, true, now()) !== r.parentCommonSha256) cellV3Fail("RESERVATION_PRECONDITION_DRIFT");
    await port.verifyFilesAndSource(); assertReservationApprovalV5(r, approvedSha, codeSha, now());
    stage = "PERMANENT_SLOT"; if (!await port.claimOnce(approvedSha)) return result("RESERVATION_SLOT_OCCUPIED_INSPECT_ONLY"); slotConsumed = true;
    await port.marker("create-attempt.json", { approvedSha, requestSha256: r.requestSha256, writeRetryAuthorized: false });
    await port.verifyFilesAndSource(); assertReservationApprovalV5(r, approvedSha, codeSha, now());
    stage = "CREATE_SUBMISSION"; createCallEntered = true; stackId = await port.createOnce(r.request); responseReceived = true;
    await port.marker("create-response.json", { approvedSha, stackId, responseReceived });
    stage = "READONLY_READINESS"; await port.waitReadOnly(stackId);
    return result("RESERVATION_CREATE_SUBMITTED_INDEPENDENT_INSPECT_REQUIRED");
  } catch { return result("RESERVATION_STOPPED_INDEPENDENT_INSPECT_ONLY"); }
}
