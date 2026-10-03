import { canonicalJson, sha256Hex } from "./hash.ts";
import { assertArnProbeGrantPlan, type ArnProbeGrantPlan } from "./arn-compatibility-probe-grant.ts";
import { ARN_PROBE_ACCOUNT, ARN_PROBE_REGION, ARN_PROBE_SOURCE } from "./arn-compatibility-probe-fixture.ts";
import { probeSame, probeInstant } from "./arn-compatibility-probe-workflow.ts";
import type { ArnProbeRenewalReads } from "./arn-compatibility-probe-renewal-review.ts";

export const ARN_PROBE_READ_COMPARISON_ANCHORS = Object.freeze({
  creationReviewSha256: "0c6ac6f6641bd446b052d76968157acec7d062ce1b84a9ed52120735d0a36a77",
  planSha256: "126e3c22a3337e1fdc823f42dc5b92f7002e9fa4466461eaeb118e3db604e051",
  targetFenceKey: "9e6c381d768f09bb9f7d8498237512284ba992e8e411b58bae6432d73f53892d",
  claimSha256: "8e94cd97fde90f32bc3ae1f3911a139697f0c9615c4a61ef8abaef8cc926f8c0",
  manifestSha256: "1969abf2c05311c40fd93ded0bd195c994bd654b17a73abaa8104539d719630b",
  workflowReviewSha256: "e9f58490adf2743b160cbc1e8f5bdad5d76125f394d9784b1b73cd8bcf9c7304",
  runReceiptSha256: "2cc942bea9e0c7655fac8b3f1db6b23feb806a8e595854e15c3d3b6955e918e6",
  inspectReceiptSha256: "7859a669a4ed5b464bba86145daeebf21463874779ac6ed6841dd534db10eb88",
  diagnosticReceiptSha256: "2a07492d7b2415030b78a7fe709de72bd9564d832e41eeb666af68be8245e222",
  legacyArchiveSha256: "c394afcd50d963af258b93ed2f8b3bc071582f67f4d08ea08bfaf0c597b4f916",
  journalSha256: "5928f40e8148127269e9acb315c91d86d505375b0127493829e156592e238d59",
  revokeExecuteRequestSha256: "518bc3683c000ad38749243c168fcf38b8379225b5e6480908088efdbfa04321",
});
export const ARN_PROBE_CONSUMED_SLOT_FILES = Object.freeze([
  "claim.json", "run-intent.json", "grant-execute-intent.json", "revoke-create-intent.json", "revoke-execute-intent.json",
].sort());
export type ArnProbeReadComparisonPredecessor = Readonly<{
  anchors: typeof ARN_PROBE_READ_COMPARISON_ANCHORS; consumedGeneration: 1; consumedSlotRelativePath: string;
  slotFiles: readonly string[]; consumed: true; probeDeleteIntentPresent: false; replayAllowed: false;
}>;
export function assertArnProbeReadComparisonPredecessor(value: ArnProbeReadComparisonPredecessor) {
  probeSame(value, { anchors: ARN_PROBE_READ_COMPARISON_ANCHORS, consumedGeneration: 1,
    consumedSlotRelativePath: `.aws-sandbox/j5gj13-arn-probe/${ARN_PROBE_READ_COMPARISON_ANCHORS.targetFenceKey}/slot-000001`,
    slotFiles: ARN_PROBE_CONSUMED_SLOT_FILES, consumed: true, probeDeleteIntentPresent: false, replayAllowed: false }, "Consumed comparison predecessor");
}
function immutable<T>(value: T): Readonly<T> {
  const copy = JSON.parse(canonicalJson(value)) as T;
  function freeze(item: unknown) { if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); } }
  freeze(copy); return copy;
}

/** Two undeployed alternatives. Deliberately NOT an ArnProbeGrantPlan or AWS request. */
export async function compileArnProbeReadComparisonPlan(input: { priorPlan: ArnProbeGrantPlan; reviewedAt: string; expiresAt: string }) {
  probeSame(Object.keys(input).sort(), ["expiresAt", "priorPlan", "reviewedAt"], "Comparison input fields");
  await assertArnProbeGrantPlan(input.priorPlan);
  const start = probeInstant(input.reviewedAt), end = probeInstant(input.expiresAt), prior = input.priorPlan;
  if (start < probeInstant(prior.input.expiresAt) || end - start !== 1_800_000) throw new Error("Comparison needs an expired predecessor and a proposed 30-minute window.");
  const stackId = prior.input.fixtureStackId, changeSetArn = prior.input.fixtureChangeSetArn;
  const changeSetName = prior.input.fixturePlan.request.ChangeSetName;
  const operationSha256 = await sha256Hex(canonicalJson({ priorPlanSha256: prior.planSha256, stackId, changeSetArn, reviewedAt: input.reviewedAt, expiresAt: input.expiresAt }));
  const condition = { StringEquals: { "aws:RequestedRegion": ARN_PROBE_REGION },
    DateGreaterThanEquals: { "aws:CurrentTime": input.reviewedAt }, DateLessThan: { "aws:CurrentTime": input.expiresAt } };
  const candidates = [];
  for (const variant of ["FULL_ARN_CONDITION", "EXACT_NAME_CONDITION"] as const) {
    // Start from Locked, never from the prior Delete grant.
    const template = JSON.parse(prior.revokeTarget.templateBody);
    const policy = template.Resources.CellOperatorBoundary.Properties.PolicyDocument;
    const conditionValue = variant === "FULL_ARN_CONDITION" ? changeSetArn : changeSetName;
    policy.Statement.push(
      { Sid: "TemporaryAllowComparisonFixtureStackRead", Effect: "Allow", Resource: stackId,
        Action: ["cloudformation:DescribeStacks", "cloudformation:ListStackResources", "cloudformation:GetTemplate"], Condition: condition },
      { Sid: "TemporaryAllowComparisonChangeSetRead", Effect: "Allow", Action: "cloudformation:DescribeChangeSet", Resource: stackId,
        Condition: { ...condition, StringEquals: { ...condition.StringEquals, "cloudformation:ChangeSetName": conditionValue } } },
    );
    Object.assign(template.Metadata.SafetyBoundary, { OperatorGrantState: "ARNPROBEREADCOMPARISONCANDIDATE", ArnProbeReadComparisonOnly: true,
      ArnProbeComparisonVariant: variant, ArnProbeComparisonOperationSha256: operationSha256, ArnProbeComparisonPriorPlanSha256: prior.planSha256,
      ArnProbeStackId: stackId, ArnProbeChangeSetArn: changeSetArn, ArnProbeReviewedAt: input.reviewedAt, ArnProbeExpiresAt: input.expiresAt,
      ArnProbeApprovedWriteActions: [], ArnProbeExecutionApproved: false, ArnProbeChildExecutionAllowed: false, ArnProbeDeleteStackAllowed: false,
      ArnProbeDeleteChangeSetAllowed: false, CloudApplyEnabled: false, TemporaryGrantApplyEnabled: false,
      CompensationChangeSetArnRequestIamConditionCompatibilityVerified: false });
    template.Description = `J5g-j16 undeployed ${variant} read-only comparison; no creation, installation, Operator run or deletion approval.`;
    template.Outputs.SafetyState.Value = "ARN_PROBE_READ_COMPARISON_UNDEPLOYED_NO_EXECUTION_APPROVAL";
    const proposedTemplateBody = `${JSON.stringify(template)}\n`;
    if (Buffer.byteLength(proposedTemplateBody, "utf8") > 51_200 || JSON.stringify(policy).replace(/\s/g, "").length > 6_144) throw new Error("Comparison template or IAM policy exceeds AWS size bounds.");
    candidates.push({ variant, conditionValue, proposedTemplateBody, templateRawSha256: await sha256Hex(proposedTemplateBody),
      templateCanonicalSha256: await sha256Hex(canonicalJson(template)), operatorPolicySha256: await sha256Hex(canonicalJson(policy)) });
  }
  const proposedReadMatrix = candidates.flatMap(({ variant }) => (["FULL_ARN_REQUEST", "EXACT_NAME_REQUEST"] as const).map((requestStyle) => ({
    variant, requestStyle, action: "cloudformation:DescribeChangeSet", maxSubmissions: 1,
    request: { StackName: stackId, ChangeSetName: requestStyle === "FULL_ARN_REQUEST" ? changeSetArn : changeSetName },
    requiredResponseIdentity: { StackId: stackId, ChangeSetId: changeSetArn, ChangeSetName: changeSetName },
  })));
  const body = { schemaVersion: 1 as const, stage: "B5-J5g-j16" as const, action: "PREPARE_UNDEPLOYED_READ_COMPARISON" as const,
    input, operationSha256, candidates, proposedReadMatrix, revokeTarget: prior.revokeTarget,
    proposedPolicyWindowOnly: true, mutuallyExclusiveCandidates: true, sourceReadDoesNotProveOperatorAccess: true,
    requiredFutureControls: { separatelyReviewedFixedFence: true, preserveConsumedSlotAndArchive: true, independentlyApprovedGrantAndImmediateRevoke: true,
      onlyOneCandidateInstalledAtATime: true, fixedMfaOperatorRequired: true, boundedReadOnlyNoWriteProbe: true },
    generationProposal: null, fenceImplementationAvailable: false, operatorReadExecutionImplemented: false,
    allowedWriteActions: [], mutationPerformed: false, grantCreationAuthorized: false, grantExecutionAuthorized: false, operatorReadAuthorized: false,
    probeDeletionAuthorized: false, retryAuthorized: false, providerContextCompatibilityVerified: false,
    productionCompatibilityVerified: false, rootCauseProven: false, runtimeEnabled: false };
  return immutable({ ...body, planSha256: await sha256Hex(canonicalJson(body)) });
}
export type ArnProbeReadComparisonPlan = Awaited<ReturnType<typeof compileArnProbeReadComparisonPlan>>;
export async function assertArnProbeReadComparisonPlan(plan: ArnProbeReadComparisonPlan) {
  probeSame(plan, await compileArnProbeReadComparisonPlan(plan.input), "Non-executable comparison plan");
}
function fresh(value: { observedAt: string }, now: number) {
  const age = now - probeInstant(value.observedAt); if (age < 0 || age > 60_000) throw new Error("Comparison live evidence is stale.");
}
export type ArnProbeReadComparisonObservation = {
  managementBefore: Awaited<ReturnType<ArnProbeRenewalReads["readManagement"]>>;
  managementAfter: Awaited<ReturnType<ArnProbeRenewalReads["readManagement"]>>;
  inventoryBefore: Awaited<ReturnType<ArnProbeRenewalReads["readEmptyManagementInventory"]>>;
  inventoryAfter: Awaited<ReturnType<ArnProbeRenewalReads["readEmptyManagementInventory"]>>;
  fixtureBefore: Awaited<ReturnType<ArnProbeRenewalReads["readFixture"]>>;
  fixtureAfter: Awaited<ReturnType<ArnProbeRenewalReads["readFixture"]>>;
};
export function assertArnProbeReadComparisonObservation(prior: ArnProbeGrantPlan, observation: ArnProbeReadComparisonObservation, ended: number) {
  probeSame(Object.keys(observation).sort(), ["fixtureAfter", "fixtureBefore", "inventoryAfter", "inventoryBefore", "managementAfter", "managementBefore"], "Comparison observation fields");
  const { managementBefore, managementAfter, inventoryBefore, inventoryAfter, fixtureBefore, fixtureAfter } = observation;
  for (const value of [managementBefore, managementAfter]) {
    fresh(value, ended);
    if (value.accountId !== ARN_PROBE_ACCOUNT || value.callerArn !== ARN_PROBE_SOURCE || value.region !== ARN_PROBE_REGION || value.rendererShape !== "Locked" ||
        value.cellStackState !== "MISSING" || value.authorityState !== "ABSENT" || value.stack.id !== prior.managementStackId ||
        value.stack.templateRawSha256 !== prior.revokeTarget.templateRawSha256 || value.stack.templateCanonicalSha256 !== prior.revokeTarget.templateCanonicalSha256) throw new Error("Comparison needs exact live Locked / Cell MISSING / authority ABSENT.");
  }
  probeSame(managementBefore.stack, managementAfter.stack, "Comparison management stability");
  probeSame(managementBefore.policies, managementAfter.policies, "Comparison IAM stability"); probeSame(managementBefore.roles, managementAfter.roles, "Comparison role stability");
  for (const value of [inventoryBefore, inventoryAfter]) {
    fresh(value, ended);
    if (value.stackId !== prior.managementStackId || value.state !== "EMPTY" || value.changeSetCount !== 0 || !/^[a-f0-9]{64}$/.test(value.providerEvidenceSha256)) throw new Error("Comparison needs complete empty management Change Set inventory.");
  }
  for (const value of [fixtureBefore, fixtureAfter]) {
    fresh(value, ended);
    if (value.state !== "READY_UNEXECUTED" || value.stackId !== prior.input.fixtureStackId || value.changeSetArn !== prior.input.fixtureChangeSetArn ||
        value.resourceCount !== 0 || value.templateCanonicalSha256 !== prior.input.fixturePlan.templateCanonicalSha256) throw new Error("Comparison needs the unchanged zero-resource fixture.");
  }
  probeSame({ ...fixtureBefore, observedAt: null }, { ...fixtureAfter, observedAt: null }, "Comparison fixture stability");
}

/** Source-only live review. No reserve, Create, Execute, Delete, or AssumeRole port. */
export async function reviewArnProbeReadComparison(input: { priorPlan: ArnProbeGrantPlan;
  readPredecessor: () => Promise<ArnProbeReadComparisonPredecessor>; reads: ArnProbeRenewalReads; signal: AbortSignal; now?: () => number }) {
  const now = input.now ?? Date.now, started = now(), prior = input.priorPlan;
  input.signal.throwIfAborted(); await assertArnProbeGrantPlan(prior);
  if (prior.planSha256 !== ARN_PROBE_READ_COMPARISON_ANCHORS.planSha256 || started < probeInstant(prior.input.expiresAt)) throw new Error("Only the closed anchored round can precede comparison review.");
  const predecessor = await input.readPredecessor(); assertArnProbeReadComparisonPredecessor(predecessor);
  const managementBefore = await input.reads.readManagement(prior, input.signal);
  const inventoryBefore = await input.reads.readEmptyManagementInventory(prior, input.signal);
  const fixtureBefore = await input.reads.readFixture(prior, input.signal);
  const inventoryAfter = await input.reads.readEmptyManagementInventory(prior, input.signal);
  const fixtureAfter = await input.reads.readFixture(prior, input.signal);
  const managementAfter = await input.reads.readManagement(prior, input.signal);
  const finalPredecessor = await input.readPredecessor(), ended = now(); input.signal.throwIfAborted();
  assertArnProbeReadComparisonPredecessor(finalPredecessor); probeSame(finalPredecessor, predecessor, "Comparison local evidence stability");
  if (ended < started || ended - started > 90_000) throw new Error("Comparison review exceeded its bound.");
  const observation = { managementBefore, inventoryBefore, fixtureBefore, inventoryAfter, fixtureAfter, managementAfter };
  assertArnProbeReadComparisonObservation(prior, observation, ended);
  const issuedAt = new Date(ended).toISOString(), plan = await compileArnProbeReadComparisonPlan({ priorPlan: prior, reviewedAt: issuedAt, expiresAt: new Date(ended + 1_800_000).toISOString() });
  const body = { schemaVersion: 1 as const, stage: "B5-J5g-j16" as const, action: "SOURCE_ONLY_REVIEW_READ_COMPARISON" as const,
    predecessor, plan, observation,
    issuedAt, expiresAt: new Date(ended + 300_000).toISOString(), allowedWriteActions: [], mutationPerformed: false,
    grantCreationAuthorized: false, grantExecutionAuthorized: false, operatorReadAuthorized: false, probeDeletionAuthorized: false,
    retryAuthorized: false, providerContextCompatibilityVerified: false, productionCompatibilityVerified: false, runtimeEnabled: false };
  return immutable({ ...body, reviewSha256: await sha256Hex(canonicalJson(body)) });
}
export type ArnProbeReadComparisonReview = Awaited<ReturnType<typeof reviewArnProbeReadComparison>>;
/** Integrity validation of historical evidence, never freshness/approval to deploy. */
export async function assertArnProbeReadComparisonReview(review: ArnProbeReadComparisonReview) {
  const { reviewSha256, ...body } = review;
  if (reviewSha256 !== await sha256Hex(canonicalJson(body))) throw new Error("Comparison review digest drifted.");
  await assertArnProbeReadComparisonPlan(body.plan); assertArnProbeReadComparisonPredecessor(body.predecessor);
  const issued = probeInstant(body.issuedAt);
  if (body.plan.input.priorPlan.planSha256 !== ARN_PROBE_READ_COMPARISON_ANCHORS.planSha256 ||
      body.plan.input.reviewedAt !== body.issuedAt || body.expiresAt !== new Date(issued + 300_000).toISOString()) throw new Error("Comparison review identity/window drifted.");
  assertArnProbeReadComparisonObservation(body.plan.input.priorPlan, body.observation, issued);
  probeSame(body, { schemaVersion: 1, stage: "B5-J5g-j16", action: "SOURCE_ONLY_REVIEW_READ_COMPARISON", predecessor: body.predecessor,
    plan: body.plan, observation: body.observation, issuedAt: body.issuedAt, expiresAt: body.expiresAt, allowedWriteActions: [], mutationPerformed: false,
    grantCreationAuthorized: false, grantExecutionAuthorized: false, operatorReadAuthorized: false, probeDeletionAuthorized: false,
    retryAuthorized: false, providerContextCompatibilityVerified: false, productionCompatibilityVerified: false, runtimeEnabled: false }, "Comparison non-authorizing review scope");
}
