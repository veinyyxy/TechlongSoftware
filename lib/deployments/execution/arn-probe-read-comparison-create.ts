import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeSame, probeInstant, probeObject } from "./arn-compatibility-probe-workflow.ts";
import { arnProbeSafeRequestId, sanitizeArnProbeFailure } from "./arn-compatibility-probe-diagnostics.ts";
import { ARN_PROBE_READ_COMPARISON_ANCHORS as anchors, assertArnProbeReadComparisonPlan,
  assertArnProbeReadComparisonPredecessor, assertArnProbeReadComparisonReview, reviewArnProbeReadComparison,
  type ArnProbeReadComparisonPlan, type ArnProbeReadComparisonReview, type ArnProbeReadComparisonPredecessor } from "./arn-compatibility-probe-read-comparison.ts";
import type { ArnProbeRenewalReads } from "./arn-compatibility-probe-renewal-review.ts";

export type ArnProbeComparisonVariant = "FULL_ARN_CONDITION" | "EXACT_NAME_CONDITION";
function immutable<T>(value: T): Readonly<T> {
  const copy = JSON.parse(canonicalJson(value)) as T;
  function freeze(v: unknown) { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } }
  freeze(copy); return copy;
}
/** Independent namespace, not a reset of the consumed J14 slot. Both candidates
 * and every future review/time window compete for this one physical slot. */
export async function arnProbeComparisonFence(predecessor: ArnProbeReadComparisonPredecessor) {
  assertArnProbeReadComparisonPredecessor(predecessor);
  return immutable({ stage: "B5-J5g-j17" as const, generation: 2 as const, priorGeneration: 1 as const,
    targetFenceKey: anchors.targetFenceKey, predecessorSnapshotSha256: await sha256Hex(canonicalJson(predecessor)),
    priorSlotRelativePath: predecessor.consumedSlotRelativePath,
    slotRelativePath: `.aws-sandbox/j5gj17-read-comparison/${anchors.targetFenceKey}/slot-000002` });
}
export type ArnProbeComparisonFence = Awaited<ReturnType<typeof arnProbeComparisonFence>>;
export async function compileArnProbeComparisonCreatePlan(input: { comparisonPlan: ArnProbeReadComparisonPlan; variant: ArnProbeComparisonVariant }) {
  probeSame(Object.keys(input).sort(), ["comparisonPlan", "variant"], "Comparison creation input");
  await assertArnProbeReadComparisonPlan(input.comparisonPlan);
  const selected = input.comparisonPlan.candidates.find((c) => c.variant === input.variant);
  if (!selected) throw new Error("Exactly one read-only comparison candidate is required.");
  const operationSha256 = await sha256Hex(canonicalJson({ comparisonPlanSha256: input.comparisonPlan.planSha256,
    variant: input.variant, targetFenceKey: anchors.targetFenceKey, generation: 2 }));
  const request = { StackName: input.comparisonPlan.input.priorPlan.managementStackId,
    ChangeSetName: `techlong-j5gj17-read-grant-${operationSha256.slice(0, 16)}`, ChangeSetType: "UPDATE" as const,
    ClientToken: `j5gj17-create-${operationSha256}`, Description: `J5g-j17 read-only grant review only ${operationSha256}`,
    TemplateBody: selected.proposedTemplateBody, Capabilities: ["CAPABILITY_NAMED_IAM"],
    IncludeNestedStacks: false, ImportExistingResources: false,
    Parameters: ["ExpectedAccountId", "ExpectedRegion", "ManagementPrincipalArn"].map((ParameterKey) => ({ ParameterKey, UsePreviousValue: true })) };
  const body = { schemaVersion: 1 as const, stage: "B5-J5g-j17" as const, action: "PREPARE_GENERATION2_READ_GRANT_CREATE" as const,
    input, operationSha256, request, requestSha256: await sha256Hex(canonicalJson(request)),
    templateCanonicalSha256: selected.templateCanonicalSha256, templateRawSha256: selected.templateRawSha256,
    revokeTarget: input.comparisonPlan.revokeTarget, allowedWriteActions: ["cloudformation:CreateChangeSet"],
    creationApproved: false, grantExecutionAuthorized: false, operatorReadAuthorized: false, probeDeletionAuthorized: false,
    childExecutionAuthorized: false, retryAuthorized: false, productionCompatibilityVerified: false, runtimeEnabled: false };
  return immutable({ ...body, planSha256: await sha256Hex(canonicalJson(body)) });
}
export type ArnProbeComparisonCreatePlan = Awaited<ReturnType<typeof compileArnProbeComparisonCreatePlan>>;
export async function assertArnProbeComparisonCreatePlan(plan: ArnProbeComparisonCreatePlan) {
  probeSame(plan, await compileArnProbeComparisonCreatePlan(plan.input), "Comparison creation plan");
}
export async function reviewArnProbeComparisonCreate(input: { sourceReview: ArnProbeReadComparisonReview; variant: ArnProbeComparisonVariant;
  slot: Pick<ArnProbeComparisonSlot, "fence" | "readClaim">; signal: AbortSignal; now?: () => number }) {
  const now = input.now ?? Date.now, source = input.sourceReview;
  await assertArnProbeReadComparisonReview(source); input.signal.throwIfAborted();
  const fence = await arnProbeComparisonFence(source.predecessor);
  probeSame(input.slot.fence, fence, "Comparison fixed fence");
  if (now() < probeInstant(source.issuedAt) || now() >= probeInstant(source.expiresAt)) throw new Error("Comparison Source review expired.");
  if (await input.slot.readClaim()) throw new Error("Generation2 slot is consumed; no new review can authorize replay.");
  input.signal.throwIfAborted();
  const plan = await compileArnProbeComparisonCreatePlan({ comparisonPlan: source.plan, variant: input.variant });
  const issuedAt = new Date(now()).toISOString();
  if (probeInstant(issuedAt) >= probeInstant(source.expiresAt)) throw new Error("Comparison Source review expired.");
  const body = { schemaVersion: 1 as const, stage: "B5-J5g-j17" as const, action: "REVIEW_GENERATION2_READ_GRANT_CREATE" as const,
    sourceReview: source, plan, fence, issuedAt, expiresAt: source.expiresAt,
    requiredPhrase: "I_CONFIRM_J5GJ17_CREATE_GENERATION2_READ_COMPARISON_GRANT_ONLY" as const,
    persistenceImplemented: true, consumesSlotPermanently: true, preservesConsumedPredecessor: true,
    mutationPerformed: false, creationApproved: false, allowedWriteActions: ["cloudformation:CreateChangeSet"],
    grantExecutionAuthorized: false, operatorReadAuthorized: false, probeDeletionAuthorized: false, childExecutionAuthorized: false,
    retryAuthorized: false, productionCompatibilityVerified: false, runtimeEnabled: false };
  return immutable({ ...body, reviewSha256: await sha256Hex(canonicalJson(body)) });
}
export type ArnProbeComparisonCreateReview = Awaited<ReturnType<typeof reviewArnProbeComparisonCreate>>;
export async function assertArnProbeComparisonCreateReview(review: ArnProbeComparisonCreateReview) {
  const { reviewSha256, ...body } = review;
  await assertArnProbeReadComparisonReview(body.sourceReview); await assertArnProbeComparisonCreatePlan(body.plan);
  probeSame(body.plan.input.comparisonPlan, body.sourceReview.plan, "Creation reviewed candidate");
  probeSame(body.fence, await arnProbeComparisonFence(body.sourceReview.predecessor), "Creation reviewed fence");
  if (reviewSha256 !== await sha256Hex(canonicalJson(body)) || probeInstant(body.issuedAt) < probeInstant(body.sourceReview.issuedAt) ||
    body.expiresAt !== body.sourceReview.expiresAt || probeInstant(body.issuedAt) >= probeInstant(body.expiresAt)) throw new Error("Comparison creation review identity/window drifted.");
  probeSame(body, { schemaVersion: 1, stage: "B5-J5g-j17", action: "REVIEW_GENERATION2_READ_GRANT_CREATE",
    sourceReview: body.sourceReview, plan: body.plan, fence: body.fence, issuedAt: body.issuedAt, expiresAt: body.expiresAt,
    requiredPhrase: "I_CONFIRM_J5GJ17_CREATE_GENERATION2_READ_COMPARISON_GRANT_ONLY", persistenceImplemented: true,
    consumesSlotPermanently: true, preservesConsumedPredecessor: true, mutationPerformed: false, creationApproved: false,
    allowedWriteActions: ["cloudformation:CreateChangeSet"], grantExecutionAuthorized: false, operatorReadAuthorized: false,
    probeDeletionAuthorized: false, childExecutionAuthorized: false, retryAuthorized: false, productionCompatibilityVerified: false, runtimeEnabled: false }, "Creation-only review scope");
}
export async function arnProbeComparisonClaimBinding(review: ArnProbeComparisonCreateReview) {
  await assertArnProbeComparisonCreateReview(review);
  return immutable({ creationReviewSha256: review.reviewSha256, planSha256: review.plan.planSha256, requestSha256: review.plan.requestSha256,
    variant: review.plan.input.variant, reviewIssuedAt: review.issuedAt, reviewExpiresAt: review.expiresAt,
    policyExpiresAt: review.plan.input.comparisonPlan.input.expiresAt });
}
export type ArnProbeComparisonClaimBinding = Awaited<ReturnType<typeof arnProbeComparisonClaimBinding>>;
export type ArnProbeComparisonClaim = Readonly<{ schemaVersion: 1; action: "CLAIM_GENERATION2_BEFORE_CREATE";
  fence: ArnProbeComparisonFence; binding: ArnProbeComparisonClaimBinding; preflightEvidenceSha256: string; reservedAt: string; claimSha256: string }>;
export interface ArnProbeComparisonSlot {
  fence: ArnProbeComparisonFence; readClaim(): Promise<ArnProbeComparisonClaim | null>;
  reserve(review: ArnProbeComparisonCreateReview, preflightEvidenceSha256: string, reservedAt: string): Promise<ArnProbeComparisonClaim>;
}
export async function assertArnProbeComparisonClaim(claim: ArnProbeComparisonClaim, fence: ArnProbeComparisonFence) {
  const { claimSha256, ...body } = claim;
  probeSame(body.fence, fence, "Generation2 claim fence");
  const binding = body.binding;
  probeSame(Object.keys(binding).sort(), ["creationReviewSha256", "planSha256", "policyExpiresAt", "requestSha256", "reviewExpiresAt", "reviewIssuedAt", "variant"], "Generation2 binding fields");
  for (const value of [binding.creationReviewSha256, binding.planSha256, binding.requestSha256, body.preflightEvidenceSha256]) {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Incomplete generation2 claim digest.");
  }
  const at = probeInstant(body.reservedAt), issued = probeInstant(binding.reviewIssuedAt), expires = probeInstant(binding.reviewExpiresAt);
  if (at < issued || at >= expires || expires - issued > 300_000 || expires <= issued || probeInstant(binding.policyExpiresAt) - expires < 900_000 ||
      !["FULL_ARN_CONDITION", "EXACT_NAME_CONDITION"].includes(binding.variant) || claimSha256 !== await sha256Hex(canonicalJson(body))) throw new Error("Corrupt generation2 claim; never repair or retry.");
  probeSame(body, { schemaVersion: 1, action: "CLAIM_GENERATION2_BEFORE_CREATE", fence, binding,
    preflightEvidenceSha256: body.preflightEvidenceSha256, reservedAt: body.reservedAt }, "Generation2 claim fields");
}
type Preflight = { reads: ArnProbeRenewalReads; readPredecessor: () => Promise<ArnProbeReadComparisonPredecessor>; signal: AbortSignal; now?: () => number };
export async function createReviewedArnProbeComparison(input: Preflight & { review: ArnProbeComparisonCreateReview;
  slot: ArnProbeComparisonSlot; approvedReviewSha256: string; executionPhrase: string;
  acknowledgeAwsWrite: boolean; acknowledgeNamedIamChangeSetOnly: boolean; acknowledgeLowCostNotZero: boolean;
  acknowledgePreservesPredecessorAndConsumesGeneration2: boolean;
  create: (request: ArnProbeComparisonCreatePlan["request"], signal: AbortSignal) => Promise<unknown> }) {
  const review = input.review, now = input.now ?? Date.now;
  await assertArnProbeComparisonCreateReview(review); probeSame(input.slot.fence, review.fence, "Generation2 capability fence");
  if (input.approvedReviewSha256 !== review.reviewSha256 || input.executionPhrase !== review.requiredPhrase || input.acknowledgeAwsWrite !== true ||
      input.acknowledgeNamedIamChangeSetOnly !== true || input.acknowledgeLowCostNotZero !== true || input.acknowledgePreservesPredecessorAndConsumesGeneration2 !== true) throw new Error("Exact creation-only approval and permanent generation2 acknowledgement required.");
  const live = () => { const at = now(); if (at < probeInstant(review.issuedAt) || at >= probeInstant(review.expiresAt)) throw new Error("Generation2 creation review expired before AWS write."); };
  live(); input.signal.throwIfAborted();
  if (await input.slot.readClaim()) throw new Error("Generation2 is already consumed; no automatic replay.");
  const preflight = await reviewArnProbeReadComparison({ priorPlan: review.sourceReview.plan.input.priorPlan,
    readPredecessor: input.readPredecessor, reads: input.reads, signal: input.signal, now });
  probeSame(preflight.predecessor, review.sourceReview.predecessor, "Generation2 predecessor before claim");
  probeSame({ ...preflight.observation.managementAfter, observedAt: null }, { ...review.sourceReview.observation.managementAfter, observedAt: null }, "Generation2 reviewed Locked evidence");
  probeSame({ ...preflight.observation.fixtureAfter, observedAt: null }, { ...review.sourceReview.observation.fixtureAfter, observedAt: null }, "Generation2 reviewed fixture evidence");
  // A fresh Source review changes its hypothetical window; never substitute its
  // newly compiled candidate for the exact request the human approved.
  live(); input.signal.throwIfAborted();
  const claim = await input.slot.reserve(review, await sha256Hex(canonicalJson(preflight)), new Date(now()).toISOString());
  await assertArnProbeComparisonClaim(claim, review.fence);
  probeSame(claim.binding, await arnProbeComparisonClaimBinding(review), "Generation2 durable request binding");
  let creationAttempted = false, target: { stackId: string; changeSetArn: string; requestId: string } | null = null;
  const failures: ReturnType<typeof sanitizeArnProbeFailure>[] = [];
  try {
    live(); input.signal.throwIfAborted(); creationAttempted = true;
    const response = probeObject(await input.create(review.plan.request, AbortSignal.any([input.signal, AbortSignal.timeout(30_000)])));
    const requestId = arnProbeSafeRequestId(probeObject(response.$metadata).requestId);
    if (!requestId || response.StackId !== review.plan.request.StackName || typeof response.Id !== "string" || !comparisonGrantArn(review.plan, response.Id)) throw new Error("Generation2 Create response identity drifted.");
    target = { stackId: response.StackId as string, changeSetArn: response.Id, requestId };
  } catch (error) { failures.push(sanitizeArnProbeFailure(error, "GRANT_CREATE", now)); }
  const body = { stage: "B5-J5g-j17", mode: "CREATE_REVIEWED", reviewSha256: review.reviewSha256, claim, target, creationAttempted, failures,
    outcome: target ? "CREATE_SUBMITTED" : creationAttempted ? "CREATE_UNCERTAIN" : "NO_CREATE_SUBMITTED_SLOT_CONSUMED",
    mutationPerformed: target ? true : creationAttempted ? null : false, grantInstalled: false, grantExecutionAuthorized: false,
    operatorReadAuthorized: false, probeDeleted: false, childExecuted: false, retryAuthorized: false,
    productionCompatibilityVerified: false, runtimeEnabled: false, observedAt: new Date(now()).toISOString() };
  return immutable({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
export function comparisonGrantArn(plan: ArnProbeComparisonCreatePlan, arn: string) {
  return new RegExp(`^arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${plan.request.ChangeSetName}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`).test(arn);
}
export type ArnProbeComparisonGrantState = Readonly<
  { state: "MISSING"; proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY"; observedAt: string } |
  { state: "READY_UNEXECUTED"; stackId: string; changeSetArn: string; templateCanonicalSha256: string; providerEvidenceSha256: string; observedAt: string }>;
export async function recoverArnProbeComparisonCreate(input: Omit<Preflight, "reads"> & { review: ArnProbeComparisonCreateReview;
  slot: ArnProbeComparisonSlot; reads: Pick<ArnProbeRenewalReads, "readManagement" | "readFixture">;
  readGrant: (plan: ArnProbeComparisonCreatePlan, signal: AbortSignal) => Promise<ArnProbeComparisonGrantState> }) {
  const now = input.now ?? Date.now, started = now(), review = input.review;
  await assertArnProbeComparisonCreateReview(review); input.signal.throwIfAborted();
  probeSame(input.slot.fence, review.fence, "Recovery fence");
  const claim = await input.slot.readClaim(); if (!claim) throw new Error("Recovery requires a durable claim; never reconstruct it.");
  await assertArnProbeComparisonClaim(claim, review.fence); probeSame(claim.binding, await arnProbeComparisonClaimBinding(review), "Recovery exact claim binding");
  const predecessor = await input.readPredecessor(); probeSame(predecessor, review.sourceReview.predecessor, "Recovery predecessor");
  const prior = review.sourceReview.plan.input.priorPlan;
  const managementBefore = await input.reads.readManagement(prior, input.signal), fixtureBefore = await input.reads.readFixture(prior, input.signal);
  const grant = await input.readGrant(review.plan, input.signal);
  const fixtureAfter = await input.reads.readFixture(prior, input.signal), managementAfter = await input.reads.readManagement(prior, input.signal);
  const ended = now(); input.signal.throwIfAborted();
  if (ended < started || ended - started > 90_000) throw new Error("Recovery read exceeded its bound.");
  for (const value of [managementBefore, managementAfter, fixtureBefore, fixtureAfter, grant]) {
    const age = ended - probeInstant(value.observedAt); if (age < 0 || age > 60_000) throw new Error("Recovery evidence is stale.");
  }
  // Exact original Locked management and unchanged fixture, including policy and
  // role evidence. Exclude timestamps only, never create synthetic empty inventory.
  for (const value of [managementBefore, managementAfter]) probeSame({ ...value, observedAt: null }, { ...review.sourceReview.observation.managementAfter, observedAt: null }, "Recovery exact Locked management");
  for (const value of [fixtureBefore, fixtureAfter]) probeSame({ ...value, observedAt: null }, { ...review.sourceReview.observation.fixtureAfter, observedAt: null }, "Recovery unchanged fixture");
  if (grant.state === "MISSING") {
    if (grant.proof !== "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY") throw new Error("Recovery absence lacks inventory proof.");
  } else if (grant.state !== "READY_UNEXECUTED" || grant.stackId !== review.plan.request.StackName || !comparisonGrantArn(review.plan, grant.changeSetArn) ||
    grant.templateCanonicalSha256 !== review.plan.templateCanonicalSha256 || !/^[a-f0-9]{64}$/.test(grant.providerEvidenceSha256)) throw new Error("Recovery Grant identity drifted.");
  probeSame(await input.slot.readClaim(), claim, "Recovery claim stability"); probeSame(await input.readPredecessor(), predecessor, "Recovery archive stability");
  const body = { stage: "B5-J5g-j17", mode: "READ_ONLY_RECOVER", reviewSha256: review.reviewSha256, claim,
    observation: { managementBefore, fixtureBefore, grant, fixtureAfter, managementAfter },
    outcome: grant.state === "MISSING" ? "MISSING_SLOT_CONSUMED" : "READY_UNEXECUTED", mutationPerformed: false,
    retryAuthorized: false, grantExecutionAuthorized: false, operatorReadAuthorized: false, probeDeletionAuthorized: false,
    productionCompatibilityVerified: false, runtimeEnabled: false, observedAt: new Date(ended).toISOString() };
  return immutable({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
