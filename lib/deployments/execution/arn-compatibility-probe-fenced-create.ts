import { canonicalJson, sha256Hex } from "./hash.ts";
import { compileArnProbeGrantPlan, recoverArnProbeGrantCreate, type ArnProbeGrantReadPort } from "./arn-compatibility-probe-grant.ts";
import { assertArnProbeRenewalReview, readArnProbeRenewalPreflight, type ArnProbeRenewalReview } from "./arn-compatibility-probe-renewal-review.ts";
import { probeInstant, probeSame, probeObject } from "./arn-compatibility-probe-workflow.ts";
import { arnProbeSafeRequestId, sanitizeArnProbeFailure } from "./arn-compatibility-probe-diagnostics.ts";

function immutable<T>(value: T): Readonly<T> { const copy = JSON.parse(canonicalJson(value)) as T;
  function freeze(v: unknown) { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } } freeze(copy); return copy; }
function live(draft: ArnProbeRenewalReview, now: number) {
  if (now < probeInstant(draft.issuedAt) || now >= probeInstant(draft.expiresAt) || now >= probeInstant(draft.proposal.nextGrantPlan.createApprovalExpiresAt)) throw new Error("Fenced creation needs a fresh five-minute review and cleanup margin.");
}
type PreflightInput = Parameters<typeof readArnProbeRenewalPreflight>[0];
async function preflight(draft: ArnProbeRenewalReview, input: PreflightInput) {
  const current = await readArnProbeRenewalPreflight(input), old = current.archive.manifest.input.plan, plan = draft.proposal.nextGrantPlan;
  probeSame(current.predecessor, draft.predecessor, "Fenced predecessor");
  probeSame(plan, await compileArnProbeGrantPlan({ ...old.input, nonce: plan.input.nonce, reviewedAt: draft.issuedAt, expiresAt: plan.input.expiresAt }), "Fenced exact successor plan");
  return current;
}
export async function reviewArnProbeFencedCreate(input: PreflightInput & { draft: ArnProbeRenewalReview }) {
  const now = input.now ?? Date.now; await assertArnProbeRenewalReview(input.draft); live(input.draft, now()); input.signal.throwIfAborted();
  const current = await preflight(input.draft, input); live(input.draft, now()); input.signal.throwIfAborted();
  const issued = now(), body = { schemaVersion: 1, stage: "B5-J5g-j14", action: "REVIEW_FIXED_SLOT_GRANT_CREATE", draft: input.draft,
    predecessor: current.predecessor, observation: current.observation, issuedAt: new Date(issued).toISOString(),
    expiresAt: new Date(Math.min(issued + 300_000, probeInstant(input.draft.expiresAt))).toISOString(),
    requestSha256: await sha256Hex(canonicalJson(input.draft.proposal.nextGrantPlan.request)),
    requiredPhrase: "I_CONFIRM_J5GJ14_CREATE_FENCED_PROBE_GRANT_ONLY", persistenceImplemented: true,
    mutationPerformed: false, creationApproved: false, allowedWriteActions: ["cloudformation:CreateChangeSet"],
    grantExecutionAuthorized: false, probeDeletionAuthorized: false, cleanupAuthorized: false, productionCompatibilityVerified: false, runtimeEnabled: false };
  return immutable({ ...body, reviewSha256: await sha256Hex(canonicalJson(body)) });
}
export type ArnProbeFencedCreateReview = Awaited<ReturnType<typeof reviewArnProbeFencedCreate>>;
export async function assertArnProbeFencedCreateReview(review: ArnProbeFencedCreateReview) {
  await assertArnProbeRenewalReview(review.draft);
  const { reviewSha256, ...body } = review;
  if (reviewSha256 !== await sha256Hex(canonicalJson(body)) || body.schemaVersion !== 1 || body.stage !== "B5-J5g-j14" || body.action !== "REVIEW_FIXED_SLOT_GRANT_CREATE" ||
      body.requiredPhrase !== "I_CONFIRM_J5GJ14_CREATE_FENCED_PROBE_GRANT_ONLY" || body.persistenceImplemented !== true ||
      [body.mutationPerformed, body.creationApproved, body.grantExecutionAuthorized, body.probeDeletionAuthorized, body.cleanupAuthorized, body.productionCompatibilityVerified, body.runtimeEnabled].some((v) => v !== false)) throw new Error("Fenced create review scope drifted.");
  probeSame(body.allowedWriteActions, ["cloudformation:CreateChangeSet"], "Fenced write scope"); probeSame(body.predecessor, body.draft.predecessor, "Fenced prior archive");
  if (body.requestSha256 !== await sha256Hex(canonicalJson(body.draft.proposal.nextGrantPlan.request)) || probeInstant(body.issuedAt) < probeInstant(body.draft.issuedAt) ||
      probeInstant(body.expiresAt) <= probeInstant(body.issuedAt) || probeInstant(body.expiresAt) > probeInstant(body.draft.expiresAt) ||
      probeInstant(body.expiresAt) - probeInstant(body.issuedAt) > 300_000) throw new Error("Fenced request/window drifted.");
}
export async function arnProbeSlotScope(review: ArnProbeFencedCreateReview) {
  await assertArnProbeFencedCreateReview(review);
  return immutable({ stage: "B5-J5g-j14", generation: 1, targetFenceKey: review.draft.proposal.targetFenceKey,
    slotRelativePath: review.draft.proposal.slotRelativePath, predecessorArchiveSha256: review.predecessor.archiveSha256,
    creationReviewSha256: review.reviewSha256, planSha256: review.draft.proposal.nextGrantPlan.planSha256, requestSha256: review.requestSha256 });
}
export type ArnProbeSlotScope = Awaited<ReturnType<typeof arnProbeSlotScope>>;
export type ArnProbeSlotClaim = Readonly<{ schemaVersion: 1; action: "CLAIM_FIXED_SLOT_BEFORE_CREATE"; scope: ArnProbeSlotScope;
  preflightEvidenceSha256: string; reservedAt: string; claimSha256: string }>;
export interface ArnProbeFixedSlot { scope: ArnProbeSlotScope; readClaim(): Promise<ArnProbeSlotClaim | null>;
  reserve(preflightEvidenceSha256: string, reservedAt: string): Promise<ArnProbeSlotClaim>; }
function claimScope(slot: ArnProbeFixedSlot, expected: ArnProbeSlotScope, claim?: ArnProbeSlotClaim | null) {
  probeSame(slot.scope, expected, "Fixed slot capability scope"); if (claim) probeSame(claim.scope, expected, "Fixed slot claim scope");
}
export async function createArnProbeFencedGrant(input: PreflightInput & { review: ArnProbeFencedCreateReview; approvedReviewSha256: string;
  acknowledgeAwsWrite: boolean; acknowledgeNamedIamChangeSetOnly: boolean; acknowledgeLowCostNotZero: boolean;
  acknowledgePreservesLegacyAndConsumesSlot: boolean; executionPhrase: string; slot: ArnProbeFixedSlot;
  create: (request: ArnProbeRenewalReview["proposal"]["nextGrantPlan"]["request"], signal: AbortSignal) => Promise<unknown> }) {
  const now = input.now ?? Date.now, review = input.review;
  await assertArnProbeFencedCreateReview(review); const scope = await arnProbeSlotScope(review); claimScope(input.slot, scope);
  if (input.approvedReviewSha256 !== review.reviewSha256 || input.acknowledgeAwsWrite !== true || input.acknowledgeNamedIamChangeSetOnly !== true ||
      input.acknowledgeLowCostNotZero !== true || input.acknowledgePreservesLegacyAndConsumesSlot !== true || input.executionPhrase !== review.requiredPhrase) throw new Error("Exact creation-only approval and permanent-slot acknowledgement are required.");
  const stillLive = () => { live(review.draft, now()); if (now() < probeInstant(review.issuedAt) || now() >= probeInstant(review.expiresAt)) throw new Error("Fixed slot creation review expired."); };
  stillLive(); input.signal.throwIfAborted();
  if (await input.slot.readClaim()) throw new Error("Fixed slot is already consumed; never recreate under a fresh review.");
  const current = await preflight(review.draft, input); stillLive(); input.signal.throwIfAborted();
  const claim = await input.slot.reserve(await sha256Hex(canonicalJson({ predecessor: current.predecessor, observation: current.observation })), new Date(now()).toISOString());
  claimScope(input.slot, scope, claim);
  let creationAttempted = false, target: { stackId: string; changeSetArn: string; requestId: string } | null = null;
  const failures = [] as ReturnType<typeof sanitizeArnProbeFailure>[];
  try {
    stillLive(); input.signal.throwIfAborted(); creationAttempted = true;
    const plan = review.draft.proposal.nextGrantPlan, response = probeObject(await input.create(plan.request, AbortSignal.any([input.signal, AbortSignal.timeout(30_000)]))), id = arnProbeSafeRequestId(probeObject(response.$metadata).requestId);
    if (response.StackId !== plan.managementStackId || !id || typeof response.Id !== "string" ||
        !new RegExp(`^arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${plan.request.ChangeSetName}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`).test(response.Id)) throw new Error("Fenced Create response identity drifted.");
    target = { stackId: plan.managementStackId, changeSetArn: response.Id, requestId: id };
  } catch (error) { failures.push(sanitizeArnProbeFailure(error, "GRANT_CREATE", now)); }
  const body = { stage: "B5-J5g-j14", mode: "CREATE_REVIEWED", outcome: target ? "CREATE_SUBMITTED" : creationAttempted ? "CREATE_UNCERTAIN" : "NO_CREATE_SUBMITTED_SLOT_CONSUMED",
    scope, claim, creationAttempted, target, failures, mutationPerformed: target ? true : creationAttempted ? null : false,
    grantInstalled: false, childExecuted: false, probeDeleted: false, retryAuthorized: false, productionCompatibilityVerified: false, observedAt: new Date(now()).toISOString() };
  return immutable({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
export async function recoverArnProbeFencedCreate(input: { review: ArnProbeFencedCreateReview; slot: ArnProbeFixedSlot; reads: ArnProbeGrantReadPort; signal: AbortSignal; now?: () => number }) {
  await assertArnProbeFencedCreateReview(input.review); const scope = await arnProbeSlotScope(input.review), claim = await input.slot.readClaim(); claimScope(input.slot, scope, claim);
  if (!claim) throw new Error("No durable fixed-slot claim; manual reconciliation is required.");
  const observation = await recoverArnProbeGrantCreate(input.review.draft.proposal.nextGrantPlan, input.reads, input.signal, input.now ?? Date.now);
  const body = { stage: "B5-J5g-j14", mode: "READ_ONLY_RECOVER", scope, claim, observation, mutationPerformed: false,
    retryAuthorized: false, grantInstalled: false, grantExecutionAuthorized: false, probeDeletionAuthorized: false, productionCompatibilityVerified: false };
  return immutable({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
