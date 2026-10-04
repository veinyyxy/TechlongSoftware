import { assertReadComparisonRetirementProof, type ReadComparisonRetirementProof } from "./arn-probe-read-comparison-generation3-retirement.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeSame, probeInstant } from "./arn-compatibility-probe-workflow.ts";
import { ARN_PROBE_READ_COMPARISON_ANCHORS as anchors, assertArnProbeReadComparisonPlan,
  assertArnProbeReadComparisonPredecessor, assertArnProbeReadComparisonReview,
  type ArnProbeReadComparisonPlan, type ArnProbeReadComparisonReview, type ArnProbeReadComparisonPredecessor } from "./arn-compatibility-probe-read-comparison.ts";

export type ArnProbeComparisonVariant = "FULL_ARN_CONDITION" | "EXACT_NAME_CONDITION";
function immutable<T>(value: T): Readonly<T> {
  const copy = JSON.parse(canonicalJson(value)) as T;
  function freeze(v: unknown) { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } }
  freeze(copy); return copy;
}
/** Independent namespace, not a reset of any consumed predecessor. The
 * exact-name candidate and every future window compete for one physical slot. */
export async function arnProbeComparisonFence(predecessor: ArnProbeReadComparisonPredecessor, proof: ReadComparisonRetirementProof) {
  assertArnProbeReadComparisonPredecessor(predecessor); await assertReadComparisonRetirementProof(proof);
  probeSame(proof.intent.manifest.input.predecessor.generation1, predecessor, "Generation4 archived generation1");
  return immutable({ stage: "B5-J5g-j20" as const, generation: 4 as const, priorGeneration: 3 as const,
    retirementProofSha256: proof.receiptSha256,
    generation3PredecessorSha256: proof.intent.manifest.input.predecessor.predecessorSha256,
    generation3SlotRelativePath: proof.intent.manifest.input.predecessor.generation3.oldSlot,
    generation2RetirementProofSha256: proof.intent.manifest.input.predecessor.generation2RetirementProof.receiptSha256,
    generation2PredecessorSha256: proof.intent.manifest.input.predecessor.generation2RetirementProof.intent.manifest.input.predecessor.predecessorSha256,
    generation2SlotRelativePath: proof.intent.manifest.input.predecessor.generation2RetirementProof.intent.manifest.input.predecessor.generation2.oldSlot,
    targetFenceKey: anchors.targetFenceKey, predecessorSnapshotSha256: proof.intent.manifest.input.predecessor.predecessorSha256,
    generation1PredecessorSha256: await sha256Hex(canonicalJson(predecessor)),
    generation1SlotRelativePath: predecessor.consumedSlotRelativePath,
    priorSlotRelativePath: proof.intent.manifest.input.predecessor.generation3.oldSlot,
    slotRelativePath: `.aws-sandbox/j5gj20-read-comparison/${anchors.targetFenceKey}/slot-000004` });
}
export type ArnProbeComparisonFence = Awaited<ReturnType<typeof arnProbeComparisonFence>>;
export async function compileArnProbeComparisonCreatePlan(input: { comparisonPlan: ArnProbeReadComparisonPlan; variant: ArnProbeComparisonVariant; retirementProof: ReadComparisonRetirementProof }) {
  probeSame(Object.keys(input).sort(), ["comparisonPlan", "retirementProof", "variant"], "Comparison creation input");
  await assertArnProbeReadComparisonPlan(input.comparisonPlan); await assertReadComparisonRetirementProof(input.retirementProof);
  if (input.variant !== "EXACT_NAME_CONDITION" || probeInstant(input.comparisonPlan.input.reviewedAt) < probeInstant(input.retirementProof.observedAt)) throw new Error("Generation4 requires independent retirement proof and the exact-name read candidate only.");
  const selected = input.comparisonPlan.candidates.find((c) => c.variant === input.variant);
  if (!selected) throw new Error("Exactly one read-only comparison candidate is required.");
  const operationSha256 = await sha256Hex(canonicalJson({ comparisonPlanSha256: input.comparisonPlan.planSha256,
    variant: input.variant, targetFenceKey: anchors.targetFenceKey, generation: 4, retirementProofSha256: input.retirementProof.receiptSha256 }));
  const request = { StackName: input.comparisonPlan.input.priorPlan.managementStackId,
    ChangeSetName: `techlong-j5gj20-read-grant-${operationSha256.slice(0, 16)}`, ChangeSetType: "UPDATE" as const,
    ClientToken: `j5gj20-create-${operationSha256}`, Description: `J5g-j20 read-only grant review only ${operationSha256}`,
    TemplateBody: selected.proposedTemplateBody, Capabilities: ["CAPABILITY_NAMED_IAM"],
    IncludeNestedStacks: false, ImportExistingResources: false,
    Parameters: ["ExpectedAccountId", "ExpectedRegion", "ManagementPrincipalArn"].map((ParameterKey) => ({ ParameterKey, UsePreviousValue: true })) };
  const body = { schemaVersion: 1 as const, stage: "B5-J5g-j20" as const, action: "PREPARE_GENERATION4_READ_GRANT_CREATE" as const,
    input, operationSha256, request, requestSha256: await sha256Hex(canonicalJson(request)),
    templateCanonicalSha256: selected.templateCanonicalSha256, templateRawSha256: selected.templateRawSha256,
    revokeTarget: input.comparisonPlan.revokeTarget, allowedWriteActions: ["cloudformation:CreateChangeSet"],
    candidatePolicyDurationMs: 1_800_000, maximumApprovalDurationMs: 300_000, minimumRevokeMarginMs: 600_000,
    creationApproved: false, grantExecutionAuthorized: false, operatorReadAuthorized: false, probeDeletionAuthorized: false,
    childExecutionAuthorized: false, retryAuthorized: false, productionCompatibilityVerified: false, runtimeEnabled: false };
  return immutable({ ...body, planSha256: await sha256Hex(canonicalJson(body)) });
}
export type ArnProbeComparisonCreatePlan = Awaited<ReturnType<typeof compileArnProbeComparisonCreatePlan>>;
export async function assertArnProbeComparisonCreatePlan(plan: ArnProbeComparisonCreatePlan) {
  probeSame(plan, await compileArnProbeComparisonCreatePlan(plan.input), "Comparison creation plan");
}
async function assertGeneration4Source(source: ArnProbeReadComparisonReview, proof: ReadComparisonRetirementProof) {
  await assertReadComparisonRetirementProof(proof);
  const baseline = proof.observation.recovery.observation;
  for (const value of [source.observation.managementBefore, source.observation.managementAfter])
    probeSame({ ...value, observedAt: null }, { ...baseline.managementAfter, observedAt: null }, "Generation4 unchanged retired Locked/v5 baseline");
  for (const value of [source.observation.fixtureBefore, source.observation.fixtureAfter])
    probeSame({ ...value, observedAt: null }, { ...baseline.fixtureAfter, observedAt: null }, "Generation4 original fixture preserved");
}
export async function reviewArnProbeComparisonCreate(input: { sourceReview: ArnProbeReadComparisonReview; variant: ArnProbeComparisonVariant; retirementProof: ReadComparisonRetirementProof;
  slot: Pick<ArnProbeComparisonSlot, "fence" | "readClaim">; signal: AbortSignal; now?: () => number }) {
  const now = input.now ?? Date.now, source = input.sourceReview;
  await assertArnProbeReadComparisonReview(source); input.signal.throwIfAborted();
  await assertGeneration4Source(source, input.retirementProof);
  const fence = await arnProbeComparisonFence(source.predecessor, input.retirementProof);
  probeSame(input.slot.fence, fence, "Comparison fixed fence");
  if (now() < probeInstant(source.issuedAt) || now() >= probeInstant(source.expiresAt)) throw new Error("Comparison Source review expired.");
  if (await input.slot.readClaim()) throw new Error("Generation4 slot is consumed; no new review can authorize replay.");
  input.signal.throwIfAborted();
  const plan = await compileArnProbeComparisonCreatePlan({ comparisonPlan: source.plan, variant: input.variant, retirementProof: input.retirementProof });
  const issuedAt = new Date(now()).toISOString();
  if (probeInstant(issuedAt) >= probeInstant(source.expiresAt)) throw new Error("Comparison Source review expired.");
  const body = { schemaVersion: 1 as const, stage: "B5-J5g-j20" as const, action: "REVIEW_GENERATION4_READ_GRANT_CREATE" as const,
    sourceReview: source, plan, fence, issuedAt, expiresAt: source.expiresAt,
    requiredPhrase: "I_CONFIRM_J5GJ20_CREATE_GENERATION4_READ_COMPARISON_GRANT_ONLY" as const,
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
  await assertGeneration4Source(body.sourceReview, body.plan.input.retirementProof);
  probeSame(body.plan.input.comparisonPlan, body.sourceReview.plan, "Creation reviewed candidate");
  probeSame(body.fence, await arnProbeComparisonFence(body.sourceReview.predecessor, body.plan.input.retirementProof), "Creation reviewed fence");
  if (reviewSha256 !== await sha256Hex(canonicalJson(body)) || probeInstant(body.issuedAt) < probeInstant(body.sourceReview.issuedAt) ||
    body.expiresAt !== body.sourceReview.expiresAt || probeInstant(body.issuedAt) >= probeInstant(body.expiresAt)) throw new Error("Comparison creation review identity/window drifted.");
  probeSame(body, { schemaVersion: 1, stage: "B5-J5g-j20", action: "REVIEW_GENERATION4_READ_GRANT_CREATE",
    sourceReview: body.sourceReview, plan: body.plan, fence: body.fence, issuedAt: body.issuedAt, expiresAt: body.expiresAt,
    requiredPhrase: "I_CONFIRM_J5GJ20_CREATE_GENERATION4_READ_COMPARISON_GRANT_ONLY", persistenceImplemented: true,
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
export type ArnProbeComparisonClaim = Readonly<{ schemaVersion: 1; action: "CLAIM_GENERATION4_BEFORE_CREATE";
  fence: ArnProbeComparisonFence; binding: ArnProbeComparisonClaimBinding; preflightEvidenceSha256: string; reservedAt: string; claimSha256: string }>;
export interface ArnProbeComparisonSlot {
  fence: ArnProbeComparisonFence; readClaim(): Promise<ArnProbeComparisonClaim | null>;
  reserve(review: ArnProbeComparisonCreateReview, preflightEvidenceSha256: string, reservedAt: string): Promise<ArnProbeComparisonClaim>;
}
export async function assertArnProbeComparisonClaim(claim: ArnProbeComparisonClaim, fence: ArnProbeComparisonFence) {
  const { claimSha256, ...body } = claim;
  probeSame(body.fence, fence, "Generation4 claim fence");
  const binding = body.binding;
  probeSame(Object.keys(binding).sort(), ["creationReviewSha256", "planSha256", "policyExpiresAt", "requestSha256", "reviewExpiresAt", "reviewIssuedAt", "variant"], "Generation4 binding fields");
  for (const value of [binding.creationReviewSha256, binding.planSha256, binding.requestSha256, body.preflightEvidenceSha256]) {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Incomplete generation4 claim digest.");
  }
  const at = probeInstant(body.reservedAt), issued = probeInstant(binding.reviewIssuedAt), expires = probeInstant(binding.reviewExpiresAt);
  if (at < issued || at >= expires || expires - issued > 300_000 || expires <= issued || probeInstant(binding.policyExpiresAt) - expires < 900_000 ||
      binding.variant !== "EXACT_NAME_CONDITION" || claimSha256 !== await sha256Hex(canonicalJson(body))) throw new Error("Corrupt generation4 claim; never repair or retry.");
  probeSame(body, { schemaVersion: 1, action: "CLAIM_GENERATION4_BEFORE_CREATE", fence, binding,
    preflightEvidenceSha256: body.preflightEvidenceSha256, reservedAt: body.reservedAt }, "Generation4 claim fields");
}
/** This phase exposes no cloud Create/Execute or Operator controller. The next
 * code phase must wire and verify those before opening any real policy window. */
export const GENERATION4_LIVE_EXECUTION_IMPLEMENTED = false as const;
