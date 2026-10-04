import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeSame, probeInstant, probeObject } from "./arn-compatibility-probe-workflow.ts";
import type { ArnProbeFixtureState } from "./arn-compatibility-probe-fixture.ts";
import { sanitizeArnProbeFailure, arnProbeSafeRequestId } from "./arn-compatibility-probe-diagnostics.ts";
import { comparisonGrantArn, type ArnProbeComparisonGrantState } from "./arn-probe-read-comparison-generation4-create.ts";
import type { ArnProbeReadComparisonManagementObservation } from "./aws-sdk-shared-cell-author-compensation-management.ts";
import { assertStackScopedReadControlPredecessor, assertStackScopedReadControlPlan, compileStackScopedReadControl, stackScopedReadControlFence,
  type StackScopedReadControlPlan, type StackScopedReadControlPredecessor } from "./arn-probe-stack-scoped-read-control.ts";

export function stackControlCopy<T>(value: T): Readonly<T> {
  const copy = JSON.parse(canonicalJson(value)) as T;
  function freeze(v: unknown) { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } }
  freeze(copy); return copy;
}
export function stackControlFresh(value: { observedAt: string }, at: number) {
  const age = at - probeInstant(value.observedAt); if (age < 0 || age > 60_000) throw new Error("J22 Source evidence is stale.");
}
export type StackControlFence = Awaited<ReturnType<typeof stackScopedReadControlFence>>;
export async function compileStackControlCreatePlan(input: { candidate: StackScopedReadControlPlan }) {
  probeSame(Object.keys(input), ["candidate"], "J22 create input"); await assertStackScopedReadControlPlan(input.candidate);
  const candidate = input.candidate, predecessor = candidate.input.predecessor;
  const operationSha256 = await sha256Hex(canonicalJson({ candidateSha256: candidate.planSha256, predecessorSha256: predecessor.predecessorSha256,
    generation: 5, scope: candidate.scope }));
  const request = { StackName: predecessor.input.creationReview.plan.request.StackName, ChangeSetName: `techlong-j5gj22-stack-read-grant-${operationSha256.slice(0, 16)}`,
    ChangeSetType: "UPDATE" as const, ClientToken: `j5gj22-stack-create-${operationSha256}`, Description: `J5g-j22 exact Stack read grant review only ${operationSha256}`,
    TemplateBody: candidate.proposedTemplateBody, Capabilities: ["CAPABILITY_NAMED_IAM"], IncludeNestedStacks: false, ImportExistingResources: false,
    Parameters: ["ExpectedAccountId", "ExpectedRegion", "ManagementPrincipalArn"].map(ParameterKey => ({ ParameterKey, UsePreviousValue: true })) };
  const body = { schemaVersion: 1, stage: "B5-J5g-j22", action: "PREPARE_GENERATION5_STACK_SCOPED_GRANT_CREATE", input, operationSha256, request,
    requestSha256: await sha256Hex(canonicalJson(request)), templateRawSha256: candidate.templateRawSha256, templateCanonicalSha256: candidate.templateCanonicalSha256,
    fence: candidate.fence, revokeTarget: candidate.revokeTarget, allowedWriteActions: ["cloudformation:CreateChangeSet"], creationApproved: false,
    grantExecutionAuthorized: false, operatorReadAuthorized: false, deletionAuthorized: false, childExecutionAuthorized: false, retryAuthorized: false,
    creationToolsImplemented: true, installationToolsImplemented: false, productionCompatibilityVerified: false, runtimeEnabled: false };
  return stackControlCopy({ ...body, planSha256: await sha256Hex(canonicalJson(body)) });
}
export type StackControlCreatePlan = Awaited<ReturnType<typeof compileStackControlCreatePlan>>;
export async function assertStackControlCreatePlan(plan: StackControlCreatePlan) { probeSame(plan, await compileStackControlCreatePlan(plan.input), "J22 exact create plan"); }
export function stackControlHistory(predecessor: StackScopedReadControlPredecessor) {
  const old = predecessor.input;
  return [{ kind: "GRANT" as const, arn: old.manifest.input.grantChangeSetArn, request: old.creationReview.plan.request },
    { kind: "REVOKE" as const, arn: String(probeObject(old.intents["revoke-execute"].request).ChangeSetName), request: old.manifest.actions.revoke.createRequest }];
}
export type StackControlInventory = Readonly<{ stackId: string; complete: true; knownTerminal: readonly {
  kind: "GRANT" | "REVOKE"; changeSetArn: string; status: "CREATE_COMPLETE"; executionStatus: "EXECUTE_COMPLETE"; providerEvidenceSha256: string;
}[]; target: ArnProbeComparisonGrantState; providerEvidenceSha256: string; observedAt: string }>;
export type StackControlFixtureInventory = Readonly<{ stackId: string; changeSetArn: string; changeSetName: string;
  status: "CREATE_COMPLETE"; executionStatus: "AVAILABLE"; complete: true; count: 1; providerEvidenceSha256: string; observedAt: string }>;
export interface StackControlSourceReads {
  readManagement(predecessor: StackScopedReadControlPredecessor, signal: AbortSignal): Promise<Readonly<ArnProbeReadComparisonManagementObservation>>;
  readFixture(predecessor: StackScopedReadControlPredecessor, signal: AbortSignal): Promise<ArnProbeFixtureState>;
  readFixtureInventory(predecessor: StackScopedReadControlPredecessor, signal: AbortSignal): Promise<StackControlFixtureInventory>;
  readInventory(plan: StackControlCreatePlan, signal: AbortSignal): Promise<StackControlInventory>;
}
function normalized(value: { observedAt: string }) { return { ...value, observedAt: null }; }
function hash(value: unknown) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("J22 provider proof is incomplete."); }
export function assertStackControlInventory(plan: StackControlCreatePlan, value: StackControlInventory, at: number) {
  stackControlFresh(value, at); hash(value.providerEvidenceSha256);
  probeSame(Object.keys(value).sort(), ["complete", "knownTerminal", "observedAt", "providerEvidenceSha256", "stackId", "target"], "J22 full management inventory");
  if (value.stackId !== plan.request.StackName || value.complete !== true || !Array.isArray(value.knownTerminal)) throw new Error("J22 complete exact management inventory required.");
  const known = stackControlHistory(plan.input.candidate.input.predecessor), seen = new Set<string>();
  for (const entry of value.knownTerminal) {
    hash(entry.providerEvidenceSha256);
    const expected = known.find(k => k.arn === entry.changeSetArn);
    if (!expected || seen.has(entry.changeSetArn)) throw new Error("J22 unknown or duplicate terminal object."); seen.add(entry.changeSetArn);
    probeSame(entry, { kind: expected.kind, changeSetArn: expected.arn, status: "CREATE_COMPLETE", executionStatus: "EXECUTE_COMPLETE", providerEvidenceSha256: entry.providerEvidenceSha256 }, "J22 exact retained history");
  }
  const target = value.target; stackControlFresh(target, at);
  if (target.state === "MISSING") probeSame(target, { state: "MISSING", proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY", observedAt: target.observedAt }, "J22 exact missing target");
  else {
    hash(target.providerEvidenceSha256);
    if (!comparisonGrantArn(plan, target.changeSetArn)) throw new Error("J22 inaccurate target ARN.");
    probeSame(target, { state: "READY_UNEXECUTED", stackId: plan.request.StackName, changeSetArn: target.changeSetArn,
      templateCanonicalSha256: plan.templateCanonicalSha256, providerEvidenceSha256: target.providerEvidenceSha256, observedAt: target.observedAt }, "J22 exact unexecuted target");
  }
}
type Observation = { managementBefore: Readonly<ArnProbeReadComparisonManagementObservation>; managementAfter: Readonly<ArnProbeReadComparisonManagementObservation>;
  fixtureBefore: ArnProbeFixtureState; fixtureAfter: ArnProbeFixtureState; fixtureInventoryBefore: StackControlFixtureInventory;
  fixtureInventoryAfter: StackControlFixtureInventory; inventory: StackControlInventory };
function assertObservation(plan: StackControlCreatePlan, value: Observation, at: number) {
  probeSame(Object.keys(value).sort(), ["fixtureAfter", "fixtureBefore", "fixtureInventoryAfter", "fixtureInventoryBefore", "inventory", "managementAfter", "managementBefore"], "J22 Source observation fields");
  const predecessor = plan.input.candidate.input.predecessor, baseline = predecessor.input.inspect, prior = predecessor.input.creationReview.plan.input.comparisonPlan.input.priorPlan;
  for (const item of [value.managementBefore, value.managementAfter]) { stackControlFresh(item, at); probeSame(normalized(item), normalized(baseline.management), "J22 complete exact Locked/v7 baseline"); }
  for (const item of [value.fixtureBefore, value.fixtureAfter]) { stackControlFresh(item, at); probeSame(normalized(item), normalized(baseline.fixture), "J22 original zero-resource fixture"); }
  for (const item of [value.fixtureInventoryBefore, value.fixtureInventoryAfter]) {
    stackControlFresh(item, at); hash(item.providerEvidenceSha256);
    probeSame(item, { stackId: prior.input.fixtureStackId, changeSetArn: prior.input.fixtureChangeSetArn, changeSetName: prior.input.fixturePlan.request.ChangeSetName,
      status: "CREATE_COMPLETE", executionStatus: "AVAILABLE", complete: true, count: 1, providerEvidenceSha256: item.providerEvidenceSha256, observedAt: item.observedAt }, "J22 singleton exact fixture inventory");
  }
  assertStackControlInventory(plan, value.inventory, at);
  let previous = probeInstant(plan.input.candidate.input.reviewedAt);
  for (const item of [value.managementBefore, value.fixtureBefore, value.fixtureInventoryBefore, value.inventory, value.fixtureInventoryAfter, value.fixtureAfter, value.managementAfter]) {
    const current = probeInstant(item.observedAt); if (current < previous) throw new Error("J22 Source bracket chronology drifted."); previous = current;
  }
}
type Local = { readPredecessor: () => Promise<StackScopedReadControlPredecessor>; reads: StackControlSourceReads; signal: AbortSignal; now?: () => number };
async function collect(plan: StackControlCreatePlan, ports: Local) {
  const now = ports.now ?? Date.now, start = now(), p = plan.input.candidate.input.predecessor;
  probeSame(await ports.readPredecessor(), p, "J22 real predecessor before reads"); ports.signal.throwIfAborted();
  const managementBefore = await ports.reads.readManagement(p, ports.signal), fixtureBefore = await ports.reads.readFixture(p, ports.signal);
  const fixtureInventoryBefore = await ports.reads.readFixtureInventory(p, ports.signal), inventory = await ports.reads.readInventory(plan, ports.signal);
  const fixtureInventoryAfter = await ports.reads.readFixtureInventory(p, ports.signal), fixtureAfter = await ports.reads.readFixture(p, ports.signal);
  const managementAfter = await ports.reads.readManagement(p, ports.signal), end = now();
  if (end < start || end - start > 90_000) throw new Error("J22 Source collection exceeded its bound.");
  const observation = { managementBefore, fixtureBefore, fixtureInventoryBefore, inventory, fixtureInventoryAfter, fixtureAfter, managementAfter };
  assertObservation(plan, observation, end); probeSame(await ports.readPredecessor(), p, "J22 real predecessor after reads"); ports.signal.throwIfAborted(); return observation;
}
export interface StackControlSlot {
  fence: StackControlFence; readClaim(): Promise<StackControlClaim | null>;
  reserve(review: StackControlCreateReview, preflightEvidenceSha256: string, reservedAt: string): Promise<StackControlClaim>;
}
export async function reviewStackControlCreate(input: Local & { slot: Pick<StackControlSlot, "fence" | "readClaim"> }) {
  const now = input.now ?? Date.now, predecessor = await input.readPredecessor(); await assertStackScopedReadControlPredecessor(predecessor);
  const fence = await stackScopedReadControlFence(predecessor); probeSame(input.slot.fence, fence, "J22 independent fixed fence");
  if (await input.slot.readClaim()) throw new Error("J22 slot permanently consumed; no new review."); input.signal.throwIfAborted();
  const start = now(), candidate = await compileStackScopedReadControl({ predecessor, reviewedAt: new Date(start).toISOString(), expiresAt: new Date(start + 1_800_000).toISOString() });
  const plan = await compileStackControlCreatePlan({ candidate }), observation = await collect(plan, input), ended = now();
  if (ended < start || ended - start > 90_000 || await input.slot.readClaim()) throw new Error("J22 review crossed its bound or lost its fixed slot.");
  const body = { schemaVersion: 1, stage: "B5-J5g-j22", action: "REVIEW_GENERATION5_STACK_SCOPED_GRANT_CREATE", plan, fence, observation,
    issuedAt: new Date(ended).toISOString(), expiresAt: new Date(Math.min(ended + 300_000, start + 900_000)).toISOString(),
    requiredPhrase: "I_CONFIRM_J5GJ22_CREATE_STACK_SCOPED_READ_GRANT_ONLY", allowedWriteActions: ["cloudformation:CreateChangeSet"],
    consumesSlotPermanently: true, preservesOldRecords: true, persistenceImplemented: true, creationToolsImplemented: true, installationToolsImplemented: false,
    mutationPerformed: false, creationApproved: false, grantExecutionAuthorized: false, operatorReadAuthorized: false, deletionAuthorized: false,
    childExecutionAuthorized: false, retryAuthorized: false, productionCompatibilityVerified: false, runtimeEnabled: false };
  const review = stackControlCopy({ ...body, reviewSha256: await sha256Hex(canonicalJson(body)) }); await assertStackControlCreateReview(review); return review;
}
export type StackControlCreateReview = Awaited<ReturnType<typeof reviewStackControlCreate>>;
export async function assertStackControlCreateReview(review: StackControlCreateReview) {
  await assertStackControlCreatePlan(review.plan);
  const { reviewSha256, ...body } = review, start = probeInstant(body.issuedAt), end = probeInstant(body.expiresAt), policy = body.plan.input.candidate.input;
  probeSame(body.fence, body.plan.fence, "J22 review fence"); assertObservation(body.plan, body.observation, start);
  if (start < probeInstant(policy.reviewedAt) || start - probeInstant(policy.reviewedAt) > 90_000 || end <= start || end - start > 300_000 ||
    probeInstant(policy.expiresAt) - end < 900_000 || reviewSha256 !== await sha256Hex(canonicalJson(body))) throw new Error("J22 creation approval window/digest drifted.");
  probeSame(body, { schemaVersion: 1, stage: "B5-J5g-j22", action: "REVIEW_GENERATION5_STACK_SCOPED_GRANT_CREATE", plan: body.plan, fence: body.fence, observation: body.observation,
    issuedAt: body.issuedAt, expiresAt: body.expiresAt, requiredPhrase: "I_CONFIRM_J5GJ22_CREATE_STACK_SCOPED_READ_GRANT_ONLY", allowedWriteActions: ["cloudformation:CreateChangeSet"],
    consumesSlotPermanently: true, preservesOldRecords: true, persistenceImplemented: true, creationToolsImplemented: true, installationToolsImplemented: false,
    mutationPerformed: false, creationApproved: false, grantExecutionAuthorized: false, operatorReadAuthorized: false, deletionAuthorized: false,
    childExecutionAuthorized: false, retryAuthorized: false, productionCompatibilityVerified: false, runtimeEnabled: false }, "J22 creation-only review scope");
  if (body.observation.inventory.target.state !== "MISSING") throw new Error("J22 review cannot adopt an existing target.");
}
export async function stackControlClaimBinding(review: StackControlCreateReview) {
  await assertStackControlCreateReview(review);
  return stackControlCopy({ reviewSha256: review.reviewSha256, planSha256: review.plan.planSha256, requestSha256: review.plan.requestSha256,
    predecessorSha256: review.plan.input.candidate.input.predecessor.predecessorSha256, scope: "EXACT_STACK_RESOURCE_ONLY_NO_CHANGESET_NAME_CONDITION",
    issuedAt: review.issuedAt, expiresAt: review.expiresAt, policyExpiresAt: review.plan.input.candidate.input.expiresAt });
}
export type StackControlClaim = Readonly<{ schemaVersion: 1; action: "CLAIM_GENERATION5_STACK_CONTROL_BEFORE_CREATE"; fence: StackControlFence;
  binding: Awaited<ReturnType<typeof stackControlClaimBinding>>; preflightEvidenceSha256: string; reservedAt: string; claimSha256: string }>;
export async function assertStackControlClaim(claim: StackControlClaim, fence: StackControlFence) {
  const { claimSha256, ...body } = claim, b = body.binding;
  probeSame(body.fence, fence, "J22 exact claim fence");
  probeSame(Object.keys(b).sort(), ["expiresAt", "issuedAt", "planSha256", "policyExpiresAt", "predecessorSha256", "requestSha256", "reviewSha256", "scope"], "J22 exact claim binding fields");
  for (const v of [claimSha256, b.reviewSha256, b.planSha256, b.requestSha256, b.predecessorSha256, body.preflightEvidenceSha256]) hash(v);
  const at = probeInstant(body.reservedAt), start = probeInstant(b.issuedAt), end = probeInstant(b.expiresAt);
  if (b.predecessorSha256 !== fence.predecessorSha256 || b.scope !== "EXACT_STACK_RESOURCE_ONLY_NO_CHANGESET_NAME_CONDITION" || at < start || at >= end ||
    end <= start || end - start > 300_000 || probeInstant(b.policyExpiresAt) - end < 900_000 || claimSha256 !== await sha256Hex(canonicalJson(body))) throw new Error("J22 consumed claim is corrupt; never repair.");
  probeSame(body, { schemaVersion: 1, action: "CLAIM_GENERATION5_STACK_CONTROL_BEFORE_CREATE", fence, binding: b, preflightEvidenceSha256: body.preflightEvidenceSha256, reservedAt: body.reservedAt }, "J22 claim fields");
}
export type StackControlCreateApproval = { approvedReviewSha256: string; executionPhrase: string; acknowledgeAwsWrite: boolean;
  acknowledgeNamedIamUnexecutedOnly: boolean; acknowledgePermanentSlotAndOldRecords: boolean; acknowledgeLowCostNotZero: boolean };
export async function createReviewedStackControl(input: Local & { review: StackControlCreateReview; slot: StackControlSlot;
  approval: StackControlCreateApproval; create: (request: StackControlCreatePlan["request"], signal: AbortSignal) => Promise<unknown> }) {
  const { review, approval: a } = input, now = input.now ?? Date.now;
  await assertStackControlCreateReview(review); probeSame(input.slot.fence, review.fence, "J22 create capability fence");
  probeSame(a, { approvedReviewSha256: review.reviewSha256, executionPhrase: review.requiredPhrase, acknowledgeAwsWrite: true,
    acknowledgeNamedIamUnexecutedOnly: true, acknowledgePermanentSlotAndOldRecords: true, acknowledgeLowCostNotZero: true }, "J22 exact separate create approval");
  const live = () => { const at = now(); if (at < probeInstant(review.issuedAt) || at >= probeInstant(review.expiresAt)) throw new Error("J22 approval expired; no AWS write."); };
  live(); input.signal.throwIfAborted(); if (await input.slot.readClaim()) throw new Error("J22 fixed slot consumed; no replay.");
  const observation = await collect(review.plan, input); if (observation.inventory.target.state !== "MISSING") throw new Error("J22 target exists; do not adopt or retry.");
  live(); input.signal.throwIfAborted();
  const claim = await input.slot.reserve(review, await sha256Hex(canonicalJson(observation)), new Date(now()).toISOString());
  await assertStackControlClaim(claim, review.fence); probeSame(claim.binding, await stackControlClaimBinding(review), "J22 permanent exact request claim");
  let creationAttempted = false, target: { stackId: string; changeSetArn: string; requestId: string } | null = null;
  const failures: ReturnType<typeof sanitizeArnProbeFailure>[] = [];
  try {
    live(); input.signal.throwIfAborted(); probeSame(await input.slot.readClaim(), claim, "J22 durable claim before submission");
    live(); input.signal.throwIfAborted(); creationAttempted = true;
    const response = probeObject(await input.create(review.plan.request, AbortSignal.any([input.signal, AbortSignal.timeout(30_000)])));
    const requestId = arnProbeSafeRequestId(probeObject(response.$metadata).requestId);
    if (!requestId || response.StackId !== review.plan.request.StackName || typeof response.Id !== "string" || !comparisonGrantArn(review.plan, response.Id)) throw new Error("J22 Create response identity drifted.");
    target = { stackId: response.StackId as string, changeSetArn: response.Id, requestId };
  } catch (error) { failures.push(sanitizeArnProbeFailure(error, "GRANT_CREATE", now)); }
  const body = { stage: "B5-J5g-j22", mode: "CREATE_REVIEWED", reviewSha256: review.reviewSha256, claim, target, creationAttempted, failures,
    outcome: target ? "CREATE_SUBMITTED" : creationAttempted ? "CREATE_UNCERTAIN" : "NO_CREATE_SUBMITTED_SLOT_CONSUMED", mutationPerformed: target ? true : creationAttempted ? null : false,
    grantInstalled: false, grantExecutionAuthorized: false, operatorReadAuthorized: false, childExecuted: false, probeDeleted: false, retryAuthorized: false,
    productionCompatibilityVerified: false, runtimeEnabled: false, observedAt: new Date(now()).toISOString() };
  return stackControlCopy({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
export async function recoverStackControlCreate(input: Local & { review: StackControlCreateReview; slot: Pick<StackControlSlot, "fence" | "readClaim"> }) {
  const now = input.now ?? Date.now, review = input.review; await assertStackControlCreateReview(review); probeSame(input.slot.fence, review.fence, "J22 recovery fence");
  const claim = await input.slot.readClaim(); if (!claim) throw new Error("J22 recovery cannot reconstruct a claim.");
  await assertStackControlClaim(claim, review.fence); probeSame(claim.binding, await stackControlClaimBinding(review), "J22 recovery exact claim");
  const observation = await collect(review.plan, input); probeSame(await input.slot.readClaim(), claim, "J22 recovery claim stability");
  const body = { stage: "B5-J5g-j22", mode: "READ_ONLY_RECOVER_CREATE", reviewSha256: review.reviewSha256, claim, observation,
    outcome: observation.inventory.target.state === "MISSING" ? "MISSING_SLOT_CONSUMED" : "READY_UNEXECUTED", mutationPerformed: false,
    grantExecutionAuthorized: false, operatorReadAuthorized: false, deletionAuthorized: false, retryAuthorized: false,
    productionCompatibilityVerified: false, runtimeEnabled: false, observedAt: new Date(now()).toISOString() };
  return stackControlCopy({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
