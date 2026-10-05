import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeSame, probeInstant, probeObject } from "./arn-compatibility-probe-workflow.ts";
import { ARN_PROBE_REGION } from "./arn-compatibility-probe-fixture.ts";
import { sanitizeArnProbeFailure, arnProbeSafeRequestId } from "./arn-compatibility-probe-diagnostics.ts";
import { comparisonGrantArn, type ArnProbeComparisonGrantState } from "./arn-probe-read-comparison-generation4-create.ts";
import { stackControlCopy, stackControlFresh, type StackControlFixtureInventory } from "./arn-probe-stack-scoped-read-control-create.ts";
import { STACK_CONTROL_RETIREMENT as r, assertStackControlRetirementProof, stackControlGeneration6Fence, type StackControlRetirementProof } from "./arn-probe-stack-control-generation5-retirement.ts";

export const GENERATION6_STAGE = "B5-J5g-j23";
export type Generation6Context = Readonly<{ retirementProof: StackControlRetirementProof;
  revokeTarget: Readonly<{ templateBody: string; templateRawSha256: string; templateCanonicalSha256: string }> }>;
export type Generation6Fence = Awaited<ReturnType<typeof stackControlGeneration6Fence>>;
const hash = (v: unknown) => { if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v)) throw new Error("J23 generation6 complete digest required."); };
const normalized = (v: { observedAt: string }) => ({ ...v, observedAt: null });

/** Compact, fully anchored context; production additionally reads all actual
 * old archives and the permanent retirement intent. Never a new approval. */
export async function assertGeneration6Context(c: Generation6Context) {
  probeSame(Object.keys(c).sort(), ["retirementProof", "revokeTarget"], "J23 generation6 context fields");
  await assertStackControlRetirementProof(c.retirementProof);
  const t = c.revokeTarget, locked = c.retirementProof.observation.managementAfter.stack;
  probeSame(Object.keys(t).sort(), ["templateBody", "templateCanonicalSha256", "templateRawSha256"], "J23 original Locked template fields");
  if (typeof t.templateBody !== "string" || Buffer.byteLength(t.templateBody) > 51_200 ||
    t.templateRawSha256 !== locked.templateRawSha256 || t.templateCanonicalSha256 !== locked.templateCanonicalSha256 ||
    await sha256Hex(t.templateBody) !== t.templateRawSha256 || await sha256Hex(canonicalJson(JSON.parse(t.templateBody))) !== t.templateCanonicalSha256)
    throw new Error("J23 generation6 requires the original exact Locked template.");
}

/** Explicit proposal times only, no Date.now/default candidate and no old
 * generation5 compiler relabeling. One exact Stack Describe Allow only. */
export async function compileGeneration6Candidate(input: { context: Generation6Context; reviewedAt: string; expiresAt: string }) {
  probeSame(Object.keys(input).sort(), ["context", "expiresAt", "reviewedAt"], "J23 generation6 candidate inputs");
  await assertGeneration6Context(input.context);
  const start = probeInstant(input.reviewedAt), end = probeInstant(input.expiresAt), proof = input.context.retirementProof;
  if (start < probeInstant(proof.observedAt) || end - start !== 1_800_000) throw new Error("J23 independent 30-minute proposal must follow proven retirement.");
  const fence = await stackControlGeneration6Fence(proof), contextSha256 = await sha256Hex(canonicalJson(input.context));
  const operationSha256 = await sha256Hex(canonicalJson({ contextSha256, fenceSha256: fence.fenceSha256, generation: 6,
    reviewedAt: input.reviewedAt, expiresAt: input.expiresAt, scope: "EXACT_STACK_RESOURCE_ONLY_NO_CHANGESET_NAME_CONDITION" }));
  const original = proof.observation.fixtureInventory, template = JSON.parse(input.context.revokeTarget.templateBody), before = canonicalJson(template.Resources);
  const statement = { Sid: "TemporaryAllowStackScopedControlDescribeChangeSet", Effect: "Allow", Action: "cloudformation:DescribeChangeSet", Resource: original.stackId,
    Condition: { StringEquals: { "aws:RequestedRegion": ARN_PROBE_REGION }, DateGreaterThanEquals: { "aws:CurrentTime": input.reviewedAt }, DateLessThan: { "aws:CurrentTime": input.expiresAt } } };
  const policy = template.Resources.CellOperatorBoundary.Properties.PolicyDocument;
  template.Resources.CellOperatorBoundary.Properties.PolicyDocument = { ...policy, Statement: [...policy.Statement, statement] };
  const expected = JSON.parse(before); expected.CellOperatorBoundary.Properties.PolicyDocument = template.Resources.CellOperatorBoundary.Properties.PolicyDocument;
  probeSame(template.Resources, expected, "J23 only one exact Stack read Allow");
  Object.assign(template.Metadata.SafetyBoundary, { OperatorGrantState: "ARNPROBESTACKSCOPEDREADCONTROLCANDIDATE", StackScopedReadControlOnly: true,
    ReadControlGeneration: 6, ReadControlOperationSha256: operationSha256, ReadControlPredecessorSha256: fence.predecessorSha256,
    ReadControlRetirementProofSha256: fence.retirementProofSha256, ReadControlFenceSha256: fence.fenceSha256,
    ReadControlChangeSetNameConditionOmittedForDescribeOnly: true, ReadControlApprovedWriteActions: [], CloudApplyEnabled: false, TemporaryGrantApplyEnabled: false });
  template.Description = "J5g-j23 generation6 undeployed exact Stack DescribeChangeSet control; no installation approval.";
  template.Outputs.SafetyState.Value = "STACK_SCOPED_READ_CONTROL_UNDEPLOYED_NO_APPROVAL";
  const proposedTemplateBody = `${JSON.stringify(template)}\n`;
  if (Buffer.byteLength(proposedTemplateBody) > 51_200 || JSON.stringify(template.Resources.CellOperatorBoundary.Properties.PolicyDocument).replace(/\s/g, "").length > 6_144)
    throw new Error("J23 generation6 candidate exceeds template/policy bounds.");
  const proposedReadMatrix = (["FULL_ARN_REQUEST", "EXACT_NAME_REQUEST"] as const).map(requestStyle => ({ requestStyle, action: "cloudformation:DescribeChangeSet", maxSubmissions: 1,
    request: { StackName: original.stackId, ChangeSetName: requestStyle === "FULL_ARN_REQUEST" ? original.changeSetArn : original.changeSetName },
    requiredResponseIdentity: { StackId: original.stackId, ChangeSetId: original.changeSetArn, ChangeSetName: original.changeSetName } }));
  const body = { schemaVersion: 1, stage: GENERATION6_STAGE, action: "PREPARE_UNDEPLOYED_GENERATION6_STACK_CONTROL", input, contextSha256, fence, operationSha256,
    scope: "EXACT_STACK_RESOURCE_ONLY_NO_CHANGESET_NAME_CONDITION", proposedStatement: statement, proposedReadMatrix, proposedTemplateBody,
    templateRawSha256: await sha256Hex(proposedTemplateBody), templateCanonicalSha256: await sha256Hex(canonicalJson(template)), revokeTarget: input.context.revokeTarget,
    allowedWriteActions: [], candidateWindowIsProposalOnly: true, creationAuthorized: false, installationAuthorized: false, operatorReadAuthorized: false,
    childExecutionAllowed: false, probeDeletionAllowed: false, deleteStackAllowed: false, productionCompatibilityVerified: false, runtimeEnabled: false };
  return stackControlCopy({ ...body, planSha256: await sha256Hex(canonicalJson(body)) });
}
export type Generation6Candidate = Awaited<ReturnType<typeof compileGeneration6Candidate>>;
export async function compileGeneration6CreatePlan(input: { candidate: Generation6Candidate }) {
  probeSame(Object.keys(input), ["candidate"], "J23 generation6 create input");
  probeSame(input.candidate, await compileGeneration6Candidate(input.candidate.input), "J23 generation6 candidate recompile");
  const c = input.candidate, operationSha256 = await sha256Hex(canonicalJson({ candidateSha256: c.planSha256, fenceSha256: c.fence.fenceSha256, generation: 6 }));
  const request = { StackName: r.stackId, ChangeSetName: `techlong-j5gj23-stack-read-grant-${operationSha256.slice(0, 16)}`,
    ChangeSetType: "UPDATE" as const, ClientToken: `j5gj23-stack-create-${operationSha256}`, Description: `J5g-j23 generation6 exact Stack read review only ${operationSha256}`,
    TemplateBody: c.proposedTemplateBody, Capabilities: ["CAPABILITY_NAMED_IAM"], IncludeNestedStacks: false, ImportExistingResources: false,
    Parameters: ["ExpectedAccountId", "ExpectedRegion", "ManagementPrincipalArn"].map(ParameterKey => ({ ParameterKey, UsePreviousValue: true })) };
  const body = { schemaVersion: 1, stage: GENERATION6_STAGE, action: "PREPARE_GENERATION6_GRANT_CREATE", input, operationSha256, request,
    requestSha256: await sha256Hex(canonicalJson(request)), templateRawSha256: c.templateRawSha256, templateCanonicalSha256: c.templateCanonicalSha256, fence: c.fence,
    revokeTarget: c.revokeTarget, allowedWriteActions: ["cloudformation:CreateChangeSet"], creationApproved: false, grantExecutionAuthorized: false,
    operatorReadAuthorized: false, deletionAuthorized: false, childExecutionAuthorized: false, retryAuthorized: false, installationToolsImplemented: false,
    productionCompatibilityVerified: false, runtimeEnabled: false };
  return stackControlCopy({ ...body, planSha256: await sha256Hex(canonicalJson(body)) });
}
export type Generation6CreatePlan = Awaited<ReturnType<typeof compileGeneration6CreatePlan>>;
export async function assertGeneration6CreatePlan(p: Generation6CreatePlan) { probeSame(p, await compileGeneration6CreatePlan(p.input), "J23 exact generation6 create plan"); }

export type Generation6Inventory = Readonly<{ stackId: string; complete: true; count: number; target: ArnProbeComparisonGrantState; providerEvidenceSha256: string; observedAt: string }>;
export type Generation6CreationObservation = Readonly<{ managementBefore: StackControlRetirementProof["observation"]["managementBefore"];
  managementAfter: StackControlRetirementProof["observation"]["managementAfter"]; fixtureBefore: StackControlRetirementProof["observation"]["fixture"];
  fixtureAfter: StackControlRetirementProof["observation"]["fixture"]; fixtureInventoryBefore: StackControlFixtureInventory;
  fixtureInventoryAfter: StackControlFixtureInventory; inventory: Generation6Inventory }>;
export function assertGeneration6Inventory(plan: Generation6CreatePlan, v: Generation6Inventory, at: number) {
  probeSame(Object.keys(v).sort(), ["complete", "count", "observedAt", "providerEvidenceSha256", "stackId", "target"], "J23 complete generation6 inventory");
  stackControlFresh(v, at); hash(v.providerEvidenceSha256); stackControlFresh(v.target, at);
  if (v.stackId !== r.stackId || v.complete !== true) throw new Error("J23 exact complete management inventory required.");
  if (v.target.state === "MISSING") {
    if (v.count !== 0) throw new Error("J23 generation6 no retained/foreign object filtering.");
    probeSame(v.target, { state: "MISSING", proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY", observedAt: v.target.observedAt }, "J23 exact missing generation6 target");
  } else {
    hash(v.target.providerEvidenceSha256);
    if (v.count !== 1 || !comparisonGrantArn(plan, v.target.changeSetArn)) throw new Error("J23 exact singleton generation6 target required.");
    probeSame(v.target, { state: "READY_UNEXECUTED", stackId: r.stackId, changeSetArn: v.target.changeSetArn, templateCanonicalSha256: plan.templateCanonicalSha256,
      providerEvidenceSha256: v.target.providerEvidenceSha256, observedAt: v.target.observedAt }, "J23 accurate unexecuted generation6 identity");
  }
}
export function assertGeneration6CreationObservation(p: Generation6CreatePlan, o: Generation6CreationObservation, at: number) {
  probeSame(Object.keys(o).sort(), ["fixtureAfter", "fixtureBefore", "fixtureInventoryAfter", "fixtureInventoryBefore", "inventory", "managementAfter", "managementBefore"], "J23 generation6 observation fields");
  const proof = p.input.candidate.input.context.retirementProof;
  for (const m of [o.managementBefore, o.managementAfter]) { stackControlFresh(m, at); probeSame(normalized(m), normalized(proof.observation.managementAfter), "J23 full original Locked/v7 snapshot"); }
  for (const f of [o.fixtureBefore, o.fixtureAfter]) { stackControlFresh(f, at); probeSame(normalized(f), normalized(proof.observation.fixture), "J23 original zero-resource fixture"); }
  for (const f of [o.fixtureInventoryBefore, o.fixtureInventoryAfter]) {
    stackControlFresh(f, at); hash(f.providerEvidenceSha256);
    probeSame({ ...f, observedAt: null, providerEvidenceSha256: null }, { ...proof.observation.fixtureInventory, observedAt: null, providerEvidenceSha256: null }, "J23 complete original fixture singleton");
  }
  assertGeneration6Inventory(p, o.inventory, at);
  let previous = probeInstant(p.input.candidate.input.reviewedAt);
  for (const v of [o.managementBefore, o.fixtureBefore, o.fixtureInventoryBefore, o.inventory, o.fixtureInventoryAfter, o.fixtureAfter, o.managementAfter]) {
    const current = probeInstant(v.observedAt); if (current < previous) throw new Error("J23 generation6 Source chronology drifted."); previous = current;
  }
}
export interface Generation6SourceReads {
  observe(plan: Generation6CreatePlan, signal: AbortSignal): Promise<Generation6CreationObservation>;
}
type Local = { readContext(): Promise<Generation6Context>; reads: Generation6SourceReads; signal: AbortSignal; now?: () => number };
async function collect(p: Generation6CreatePlan, ports: Local) {
  const now = ports.now ?? Date.now, started = now(), context = p.input.candidate.input.context;
  probeSame(await ports.readContext(), context, "J23 actual archive and retirement before reads"); ports.signal.throwIfAborted();
  const observation = await ports.reads.observe(p, ports.signal); ports.signal.throwIfAborted();
  probeSame(await ports.readContext(), context, "J23 actual archive and retirement after reads");
  const ended = now(); if (ended < started || ended - started > 90_000) throw new Error("J23 generation6 collection exceeded bound.");
  assertGeneration6CreationObservation(p, observation, ended); return observation;
}
export async function generation6CreateReview(plan: Generation6CreatePlan, observation: Generation6CreationObservation, issuedAt: string, expiresAt: string) {
  await assertGeneration6CreatePlan(plan); const start = probeInstant(issuedAt), end = probeInstant(expiresAt), policy = plan.input.candidate.input;
  assertGeneration6CreationObservation(plan, observation, start);
  if (observation.inventory.target.state !== "MISSING" || start < probeInstant(policy.reviewedAt) || start - probeInstant(policy.reviewedAt) > 90_000 ||
    end <= start || end - start > 300_000 || probeInstant(policy.expiresAt) - end < 900_000) throw new Error("J23 generation6 create needs fresh missing target and revoke margin.");
  const body = { schemaVersion: 1, stage: GENERATION6_STAGE, action: "REVIEW_GENERATION6_GRANT_CREATE", plan, fence: plan.fence, observation, issuedAt, expiresAt,
    requiredPhrase: "I_CONFIRM_J5GJ23_CREATE_GENERATION6_STACK_READ_GRANT_ONLY", allowedWriteActions: ["cloudformation:CreateChangeSet"],
    consumesSlotPermanently: true, preservesOldRecords: true, creationApproved: false, grantExecutionAuthorized: false, operatorReadAuthorized: false,
    childExecutionAuthorized: false, deletionAuthorized: false, retryAuthorized: false, installationToolsImplemented: false,
    mutationPerformed: false, productionCompatibilityVerified: false, runtimeEnabled: false };
  return stackControlCopy({ ...body, reviewSha256: await sha256Hex(canonicalJson(body)) });
}
export type Generation6CreateReview = Awaited<ReturnType<typeof generation6CreateReview>>;
export async function assertGeneration6CreateReview(v: Generation6CreateReview) {
  probeSame(v, await generation6CreateReview(v.plan, v.observation, v.issuedAt, v.expiresAt), "J23 generation6 creation-only review");
}
export async function generation6ClaimBinding(review: Generation6CreateReview) {
  await assertGeneration6CreateReview(review);
  return { reviewSha256: review.reviewSha256, planSha256: review.plan.planSha256, requestSha256: review.plan.requestSha256,
    contextSha256: review.plan.input.candidate.contextSha256, fenceSha256: review.fence.fenceSha256,
    issuedAt: review.issuedAt, expiresAt: review.expiresAt, policyExpiresAt: review.plan.input.candidate.input.expiresAt };
}
export type Generation6Claim = Readonly<{ schemaVersion: 1; action: "CLAIM_GENERATION6_STACK_CONTROL_BEFORE_CREATE"; fence: Generation6Fence;
  binding: Awaited<ReturnType<typeof generation6ClaimBinding>>; preflightEvidenceSha256: string; reservedAt: string; claimSha256: string }>;
export async function assertGeneration6Claim(v: Generation6Claim, fence: Generation6Fence) {
  const { claimSha256, ...body } = v, b = body.binding;
  probeSame(body.fence, fence, "J23 exact generation6 claim fence");
  probeSame(Object.keys(b).sort(), ["contextSha256", "expiresAt", "fenceSha256", "issuedAt", "planSha256", "policyExpiresAt", "requestSha256", "reviewSha256"], "J23 exact generation6 claim binding");
  for (const key of [claimSha256, body.preflightEvidenceSha256, b.contextSha256, b.fenceSha256, b.planSha256, b.requestSha256, b.reviewSha256]) hash(key);
  const at = probeInstant(body.reservedAt), start = probeInstant(b.issuedAt), end = probeInstant(b.expiresAt);
  if (b.fenceSha256 !== fence.fenceSha256 || at < start || at >= end || end <= start || end - start > 300_000 ||
    probeInstant(b.policyExpiresAt) - end < 900_000 || claimSha256 !== await sha256Hex(canonicalJson(body))) throw new Error("J23 generation6 claim consumed/corrupt; never repair.");
  probeSame(body, { schemaVersion: 1, action: "CLAIM_GENERATION6_STACK_CONTROL_BEFORE_CREATE", fence, binding: b, preflightEvidenceSha256: body.preflightEvidenceSha256, reservedAt: body.reservedAt }, "J23 generation6 claim fields");
}
export interface Generation6Slot {
  fence: Generation6Fence; readClaim(): Promise<Generation6Claim | null>;
  reserve(review: Generation6CreateReview, preflightEvidenceSha256: string, reservedAt: string): Promise<Generation6Claim>;
}
export async function reviewGeneration6Create(p: Local & { slot: Pick<Generation6Slot, "fence" | "readClaim"> }) {
  const context = await p.readContext(), fence = await stackControlGeneration6Fence(context.retirementProof), now = p.now ?? Date.now;
  await assertGeneration6Context(context); probeSame(p.slot.fence, fence, "J23 independent fixed generation6 fence");
  if (await p.slot.readClaim()) throw new Error("J23 generation6 consumed; no refreshed review.");
  const started = now(), candidate = await compileGeneration6Candidate({ context, reviewedAt: new Date(started).toISOString(), expiresAt: new Date(started + 1_800_000).toISOString() });
  const plan = await compileGeneration6CreatePlan({ candidate }), observation = await collect(plan, p), ended = now();
  if (ended < started || ended - started > 90_000 || await p.slot.readClaim()) throw new Error("J23 generation6 review crossed its bound/slot.");
  return generation6CreateReview(plan, observation, new Date(ended).toISOString(), new Date(ended + 300_000).toISOString());
}
export type Generation6CreateApproval = Readonly<{ approvedReviewSha256: string; executionPhrase: string; acknowledgeAwsWrite: boolean;
  acknowledgeNamedIamUnexecutedOnly: boolean; acknowledgePermanentSlotAndOldRecords: boolean; acknowledgeLowCostNotZero: boolean }>;
export function approveGeneration6Create(review: Generation6CreateReview, approval: Generation6CreateApproval) {
  probeSame(approval, { approvedReviewSha256: review.reviewSha256, executionPhrase: review.requiredPhrase, acknowledgeAwsWrite: true,
    acknowledgeNamedIamUnexecutedOnly: true, acknowledgePermanentSlotAndOldRecords: true, acknowledgeLowCostNotZero: true }, "J23 separate exact generation6 create approval");
}
function live(review: Generation6CreateReview, at: number) {
  if (at < probeInstant(review.issuedAt) || at >= probeInstant(review.expiresAt)) throw new Error("J23 generation6 approval expired; no AWS write.");
}
export async function createReviewedGeneration6(p: Local & { review: Generation6CreateReview; slot: Generation6Slot; approval: Generation6CreateApproval;
  create(request: Generation6CreatePlan["request"], signal: AbortSignal): Promise<unknown> }) {
  const review = stackControlCopy(p.review), now = p.now ?? Date.now;
  await assertGeneration6CreateReview(review); approveGeneration6Create(review, p.approval); probeSame(p.slot.fence, review.fence, "J23 generation6 capability fence");
  live(review, now()); p.signal.throwIfAborted(); if (await p.slot.readClaim()) throw new Error("J23 generation6 permanent slot consumed; recover only.");
  const observation = await collect(review.plan, p); if (observation.inventory.target.state !== "MISSING") throw new Error("J23 generation6 exists; never adopt/retry.");
  live(review, now()); p.signal.throwIfAborted();
  const claim = await p.slot.reserve(review, await sha256Hex(canonicalJson(observation)), new Date(now()).toISOString());
  await assertGeneration6Claim(claim, review.fence); probeSame(claim.binding, await generation6ClaimBinding(review), "J23 exact permanent generation6 request");
  let creationAttempted = false, target: { stackId: string; changeSetArn: string; requestId: string } | null = null;
  const failures: ReturnType<typeof sanitizeArnProbeFailure>[] = [];
  try {
    probeSame(await p.slot.readClaim(), claim, "J23 durable generation6 claim before submission"); live(review, now()); p.signal.throwIfAborted(); creationAttempted = true;
    const reply = probeObject(await p.create(review.plan.request, AbortSignal.any([p.signal, AbortSignal.timeout(30_000)])));
    const requestId = arnProbeSafeRequestId(probeObject(reply.$metadata).requestId);
    if (!requestId || reply.StackId !== r.stackId || typeof reply.Id !== "string" || !comparisonGrantArn(review.plan, reply.Id)) throw new Error("J23 generation6 Create response identity drifted.");
    target = { stackId: r.stackId, changeSetArn: reply.Id, requestId };
  } catch (e) { failures.push(sanitizeArnProbeFailure(e, "GRANT_CREATE", now)); }
  const body = { stage: GENERATION6_STAGE, mode: "CREATE_REVIEWED", reviewSha256: review.reviewSha256, claim, target, creationAttempted, failures,
    outcome: target ? "CREATE_SUBMITTED" : creationAttempted ? "CREATE_UNCERTAIN" : "NO_CREATE_SUBMITTED_SLOT_CONSUMED", mutationPerformed: target ? true : creationAttempted ? null : false,
    grantInstalled: false, grantExecutionAuthorized: false, operatorReadAuthorized: false, childExecuted: false, probeDeleted: false, retryAuthorized: false,
    productionCompatibilityVerified: false, runtimeEnabled: false, observedAt: new Date(now()).toISOString() };
  return stackControlCopy({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
export async function recoverGeneration6Create(p: Local & { review: Generation6CreateReview; slot: Pick<Generation6Slot, "fence" | "readClaim"> }) {
  const now = p.now ?? Date.now, review = p.review; await assertGeneration6CreateReview(review); probeSame(p.slot.fence, review.fence, "J23 generation6 recovery fence");
  const claim = await p.slot.readClaim(); if (!claim) throw new Error("J23 generation6 recovery cannot reconstruct a claim.");
  await assertGeneration6Claim(claim, review.fence); probeSame(claim.binding, await generation6ClaimBinding(review), "J23 generation6 recovery exact claim");
  const observation = await collect(review.plan, p); probeSame(await p.slot.readClaim(), claim, "J23 permanent generation6 claim stability");
  const body = { stage: GENERATION6_STAGE, mode: "READ_ONLY_RECOVER_CREATE", reviewSha256: review.reviewSha256, claim, observation,
    outcome: observation.inventory.target.state === "MISSING" ? "MISSING_SLOT_CONSUMED" : "READY_UNEXECUTED", mutationPerformed: false,
    grantExecutionAuthorized: false, operatorReadAuthorized: false, deletionAuthorized: false, retryAuthorized: false, productionCompatibilityVerified: false, runtimeEnabled: false, observedAt: new Date(now()).toISOString() };
  return stackControlCopy({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
