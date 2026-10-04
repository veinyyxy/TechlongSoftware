import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeSame, probeInstant, probeObject, ARN_PROBE_OPERATOR_CALLER, ARN_PROBE_OPERATOR_ROLE, ARN_PROBE_MFA } from "./arn-compatibility-probe-workflow.ts";
import { ARN_PROBE_ACCOUNT, ARN_PROBE_REGION, ARN_PROBE_SOURCE, type ArnProbeFixtureState } from "./arn-compatibility-probe-fixture.ts";
import { sanitizeArnProbeFailure, arnProbeSafeRequestId, type ArnProbeFailurePhase } from "./arn-compatibility-probe-diagnostics.ts";
import { assertArnProbeComparisonCreateReview, assertArnProbeComparisonClaim, arnProbeComparisonClaimBinding, comparisonGrantArn,
  type ArnProbeComparisonCreateReview, type ArnProbeComparisonClaim, type ArnProbeComparisonCreatePlan, type ArnProbeComparisonGrantState } from "./arn-probe-read-comparison-generation4-create.ts";
import { assertArnProbeReadComparisonPredecessor, type ArnProbeReadComparisonPredecessor } from "./arn-compatibility-probe-read-comparison.ts";
import type { ArnProbeReadComparisonManagementObservation } from "./aws-sdk-shared-cell-author-compensation-management.ts";

function immutable<T>(v: T): Readonly<T> { const copy = JSON.parse(canonicalJson(v)) as T;
  function freeze(item: unknown) { if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); } } freeze(copy); return copy; }
function fresh(v: { observedAt: string }, now: number) { const age = now - probeInstant(v.observedAt); if (age < 0 || age > 60_000) throw new Error("Comparison workflow evidence is stale."); }
export type ArnProbeComparisonReadStyle = "FULL_ARN_REQUEST" | "EXACT_NAME_REQUEST";
export const ARN_PROBE_COMPARISON_STEPS = ["run", "grant-execute", "read-full-arn", "read-exact-name", "revoke-create", "revoke-execute"] as const;
export type ArnProbeComparisonStep = typeof ARN_PROBE_COMPARISON_STEPS[number];
export async function compileArnProbeComparisonWorkflow(input: { creationReview: ArnProbeComparisonCreateReview; claim: ArnProbeComparisonClaim;
  grantChangeSetArn: string; reviewedAt: string; expiresAt: string }) {
  probeSame(Object.keys(input).sort(), ["claim", "creationReview", "expiresAt", "grantChangeSetArn", "reviewedAt"], "Comparison workflow input");
  const review = input.creationReview, plan = review.plan;
  await assertArnProbeComparisonCreateReview(review); await assertArnProbeComparisonClaim(input.claim, review.fence);
  probeSame(input.claim.binding, await arnProbeComparisonClaimBinding(review), "Workflow exact creation claim binding");
  const start = probeInstant(input.reviewedAt), end = probeInstant(input.expiresAt);
  if (!comparisonGrantArn(plan, input.grantChangeSetArn) || start < probeInstant(input.claim.reservedAt) || end <= start || end - start > 300_000 ||
    end > probeInstant(plan.input.comparisonPlan.input.expiresAt) - 600_000) throw new Error("Workflow needs a full provider Grant ARN, five-minute approval and ten-minute cleanup margin.");
  const operationSha256 = await sha256Hex(canonicalJson({ creationReviewSha256: review.reviewSha256, claimSha256: input.claim.claimSha256,
    grantChangeSetArn: input.grantChangeSetArn, reviewedAt: input.reviewedAt, expiresAt: input.expiresAt }));
  const readCases = plan.input.comparisonPlan.proposedReadMatrix.filter((c) => c.variant === plan.input.variant);
  const revokeCreate = { ...plan.request, ChangeSetName: `techlong-j5gj20-read-revoke-${operationSha256.slice(0, 16)}`,
    ClientToken: `j5gj20-revoke-create-${operationSha256}`, Description: `J5g-j20 exact Locked revoke ${operationSha256}`, TemplateBody: plan.revokeTarget.templateBody };
  const actions = { grantExecute: { callerArn: ARN_PROBE_SOURCE, request: { StackName: plan.request.StackName, ChangeSetName: input.grantChangeSetArn,
    ClientRequestToken: `j5gj20-grant-execute-${operationSha256}`, DisableRollback: false } },
    operatorReads: { callerArn: ARN_PROBE_OPERATOR_CALLER, roleArn: ARN_PROBE_OPERATOR_ROLE, mfaDeviceArn: ARN_PROBE_MFA,
      cases: readCases, maxTotalSubmissions: 2, noAuthorizationPropagationRetry: true },
    revoke: { callerArn: ARN_PROBE_SOURCE, createRequest: revokeCreate, executeClientToken: `j5gj20-revoke-execute-${operationSha256}`,
      executeDiscoveredFullArnOnly: true, recoveryAfterExpiryAllowed: true } };
  const actionSha256 = { grantExecute: await sha256Hex(canonicalJson(actions.grantExecute)), operatorReads: await sha256Hex(canonicalJson(actions.operatorReads)), revoke: await sha256Hex(canonicalJson(actions.revoke)) };
  const body = { schemaVersion: 1, stage: "B5-J5g-j20", input, operationSha256, actions, actionSha256,
    requiredPhrase: "I_CONFIRM_J5GJ20_READ_GRANT_TWO_READS_AND_IMMEDIATE_REVOKE", grantInstallationApproved: false,
    childExecutionAllowed: false, probeDeletionAllowed: false, deleteStackAllowed: false, runtimeEnabled: false,
    productionCompatibilityVerified: false, authorizationContextObserved: false, readinessGates: [false, false, false, false] };
  return immutable({ ...body, manifestSha256: await sha256Hex(canonicalJson(body)) });
}
export type ArnProbeComparisonWorkflowManifest = Awaited<ReturnType<typeof compileArnProbeComparisonWorkflow>>;
export async function assertArnProbeComparisonWorkflow(manifest: ArnProbeComparisonWorkflowManifest) { probeSame(manifest, await compileArnProbeComparisonWorkflow(manifest.input), "Read-only comparison manifest"); }
export function comparisonStepRequest(m: ArnProbeComparisonWorkflowManifest, step: ArnProbeComparisonStep, supplied?: unknown) {
  if (step === "run") return m.actions;
  if (step === "grant-execute") return m.actions.grantExecute.request;
  if (step === "revoke-create") return m.actions.revoke.createRequest;
  if (step === "read-full-arn" || step === "read-exact-name") return m.actions.operatorReads.cases.find((c) => c.requestStyle === (step === "read-full-arn" ? "FULL_ARN_REQUEST" : "EXACT_NAME_REQUEST"))!.request;
  if (step !== "revoke-execute") throw new Error("Unknown comparison journal step.");
  const request = probeObject(supplied);
  if (typeof request.ChangeSetName !== "string" || !comparisonGrantArn({ request: m.actions.revoke.createRequest }, request.ChangeSetName)) throw new Error("Revoke intent must bind the discovered full ARN.");
  return { StackName: m.input.creationReview.plan.request.StackName, ChangeSetName: request.ChangeSetName, ClientRequestToken: m.actions.revoke.executeClientToken, DisableRollback: false };
}
export type ArnProbeComparisonRevokeState = ArnProbeComparisonGrantState | Readonly<{ state: "CREATING" | "EXECUTING" | "FAILED"; observedAt: string }>;
export interface ArnProbeComparisonWorkflowReads {
  readManagement(plan: ArnProbeComparisonCreatePlan, signal: AbortSignal): Promise<Readonly<ArnProbeReadComparisonManagementObservation>>;
  waitManagement(plan: ArnProbeComparisonCreatePlan, signal: AbortSignal): Promise<Readonly<ArnProbeReadComparisonManagementObservation>>;
  waitGrantSettlement(manifest: ArnProbeComparisonWorkflowManifest, signal: AbortSignal): Promise<Readonly<ArnProbeReadComparisonManagementObservation>>;
  readFixture(plan: ArnProbeComparisonCreatePlan, signal: AbortSignal): Promise<ArnProbeFixtureState>;
  readGrant(plan: ArnProbeComparisonCreatePlan, signal: AbortSignal): Promise<ArnProbeComparisonGrantState>;
  waitRevoke(manifest: ArnProbeComparisonWorkflowManifest, signal: AbortSignal): Promise<ArnProbeComparisonRevokeState>;
}
export interface ArnProbeComparisonJournal {
  load(step: ArnProbeComparisonStep): Promise<Readonly<Record<string, unknown>> | null>;
  reserve(step: ArnProbeComparisonStep, request: unknown, reservedAt: string): Promise<void>;
}
export interface ArnProbeComparisonWorkflowWrites {
  prepareOperator(signal: AbortSignal): Promise<{ callerArn: string; account: string; expiresAt: string }>;
  executeGrant(request: ArnProbeComparisonWorkflowManifest["actions"]["grantExecute"]["request"], signal: AbortSignal): Promise<unknown>;
  createRevoke(request: ArnProbeComparisonWorkflowManifest["actions"]["revoke"]["createRequest"], signal: AbortSignal): Promise<unknown>;
  executeRevoke(request: { StackName: string; ChangeSetName: string; ClientRequestToken: string; DisableRollback: false }, signal: AbortSignal): Promise<unknown>;
}
export type ArnProbeComparisonCaseResult = Readonly<{ manifestSha256: string; requestStyle: ArnProbeComparisonReadStyle;
  callerArn: string; account: string; region: string; requestSha256: string; outcome: "READ_SUCCEEDED" | "READ_DENIED" | "READ_UNCERTAIN";
  providerEvidenceSha256: string | null; requestId: string | null; failure: ReturnType<typeof sanitizeArnProbeFailure> | null;
  observedAt: string; mutationPerformed: false; authorizationContextObserved: false; productionCompatibilityVerified: false; retryAuthorized: false }>;
export interface ArnProbeComparisonOperatorReads {
  readCase(manifest: ArnProbeComparisonWorkflowManifest, style: ArnProbeComparisonReadStyle, signal: AbortSignal): Promise<ArnProbeComparisonCaseResult>;
}
export async function assertArnProbeComparisonManagement(plan: ArnProbeComparisonCreatePlan, value: ArnProbeReadComparisonManagementObservation, at: number) {
  fresh(value, at); const locked = value.rendererShape === "Locked";
  if (!locked && value.rendererShape !== "ArnProbeReadComparisonGrant") throw new Error("Foreign Grant is never a read comparison.");
  if (value.accountId !== ARN_PROBE_ACCOUNT || value.region !== ARN_PROBE_REGION || value.callerArn !== ARN_PROBE_SOURCE || value.stack.id !== plan.request.StackName ||
    value.cellStackState !== "MISSING" || value.authorityState !== "ABSENT" || value.stack.templateRawSha256 !== (locked ? plan.revokeTarget.templateRawSha256 : plan.templateRawSha256) ||
    value.stack.templateCanonicalSha256 !== (locked ? plan.revokeTarget.templateCanonicalSha256 : plan.templateCanonicalSha256)) throw new Error("Exact comparison management/Cell/authority evidence required.");
  const template = JSON.parse(locked ? plan.revokeTarget.templateBody : plan.request.TemplateBody);
  if (value.policies.length !== 2 || value.roles.length !== 2 || value.stack.resources.length !== 4) throw new Error("Full four-resource IAM observation required.");
  for (const id of ["CellOperatorBoundary", "CellCloudFormationExecutionBoundary"]) {
    const policy = value.policies.find((p) => p.logicalId === id), expected = template.Resources[id].Properties;
    if (!policy || policy.arn !== `arn:aws:iam::${ARN_PROBE_ACCOUNT}:policy/${expected.ManagedPolicyName}` || policy.defaultDocumentSha256 !== await sha256Hex(canonicalJson(expected.PolicyDocument))) throw new Error("Comparison live default IAM document drifted.");
  }
  const baseline = plan.input.retirementProof.observation.recovery.observation.managementAfter;
  probeSame(value.roles, baseline.roles, "Generation4 full role/trust/attachment stability");
  probeSame(value.stack.resources, baseline.stack.resources, "Generation4 exact four IAM resources");
  probeSame(value.policies.find((p) => p.logicalId === "CellCloudFormationExecutionBoundary"),
    baseline.policies.find((p) => p.logicalId === "CellCloudFormationExecutionBoundary"), "Generation4 execution boundary/version stability");
  const stableOperator = (policy: typeof value.policies[number]) => Object.fromEntries(Object.entries(policy).filter(([key]) =>
    !["defaultVersionId", "versionIds", "defaultDocumentSha256"].includes(key)));
  probeSame(stableOperator(value.policies.find((p) => p.logicalId === "CellOperatorBoundary")!),
    stableOperator(baseline.policies.find((p) => p.logicalId === "CellOperatorBoundary")!), "Generation4 Operator attachment/boundary usage stability");
  return locked;
}
function assertFixture(plan: ArnProbeComparisonCreatePlan, value: ArnProbeFixtureState, at: number) {
  fresh(value, at); const prior = plan.input.comparisonPlan.input.priorPlan;
  if (value.state !== "READY_UNEXECUTED" || value.stackId !== prior.input.fixtureStackId || value.changeSetArn !== prior.input.fixtureChangeSetArn || value.resourceCount !== 0 ||
    value.templateCanonicalSha256 !== prior.input.fixturePlan.templateCanonicalSha256) throw new Error("Original unexecuted zero-resource fixture required.");
}
type LocalEvidence = { readClaim: () => Promise<ArnProbeComparisonClaim | null>; readPredecessor: () => Promise<ArnProbeReadComparisonPredecessor> };
async function local(review: ArnProbeComparisonCreateReview, ports: LocalEvidence, expectedClaim?: ArnProbeComparisonClaim) {
  const predecessor = await ports.readPredecessor(); assertArnProbeReadComparisonPredecessor(predecessor); probeSame(predecessor, review.sourceReview.predecessor, "J20 preserved predecessor");
  const claim = await ports.readClaim();
  if (claim) { await assertArnProbeComparisonClaim(claim, review.fence); probeSame(claim.binding, await arnProbeComparisonClaimBinding(review), "J20 creation claim binding"); }
  if (expectedClaim) probeSame(claim, expectedClaim, "J20 permanent claim stability"); return claim;
}
async function preflight(review: ArnProbeComparisonCreateReview, ports: LocalEvidence & { reads: ArnProbeComparisonWorkflowReads; signal: AbortSignal }, now: () => number, expectedClaim?: ArnProbeComparisonClaim) {
  const claim = await local(review, ports, expectedClaim), plan = review.plan; ports.signal.throwIfAborted();
  const before = await ports.reads.readManagement(plan, ports.signal); if (!(await assertArnProbeComparisonManagement(plan, before, now()))) throw new Error("Execution review requires Locked.");
  const fixtureBefore = await ports.reads.readFixture(plan, ports.signal), grant = await ports.reads.readGrant(plan, ports.signal);
  const fixtureAfter = await ports.reads.readFixture(plan, ports.signal), after = await ports.reads.readManagement(plan, ports.signal);
  if (!(await assertArnProbeComparisonManagement(plan, after, now()))) throw new Error("Management changed during comparison review.");
  probeSame({ ...before, observedAt: null }, { ...after, observedAt: null }, "Stable Locked review");
  probeSame({ ...after, observedAt: null }, { ...review.sourceReview.observation.managementAfter, observedAt: null }, "Generation4 exact pre-install Locked snapshot");
  assertFixture(plan, fixtureBefore, now()); assertFixture(plan, fixtureAfter, now()); probeSame({ ...fixtureBefore, observedAt: null }, { ...fixtureAfter, observedAt: null }, "Stable review fixture");
  fresh(grant, now());
  if (grant.state === "MISSING") { if (grant.proof !== "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY") throw new Error("Missing Grant inventory proof required."); }
  else if (grant.state !== "READY_UNEXECUTED" || grant.stackId !== plan.request.StackName || !comparisonGrantArn(plan, grant.changeSetArn) || grant.templateCanonicalSha256 !== plan.templateCanonicalSha256 || !/^[a-f0-9]{64}$/.test(grant.providerEvidenceSha256)) throw new Error("Exact ready Grant proof required.");
  probeSame(await local(review, ports, expectedClaim), claim, "Creation claim across preflight"); ports.signal.throwIfAborted();
  return { claim, managementBefore: before, managementAfter: after, fixtureBefore, fixtureAfter, grant };
}
export async function reviewArnProbeComparisonWorkflow(input: LocalEvidence & { creationReview: ArnProbeComparisonCreateReview; reads: ArnProbeComparisonWorkflowReads; signal: AbortSignal; now?: () => number }) {
  const now = input.now ?? Date.now, start = now(); await assertArnProbeComparisonCreateReview(input.creationReview);
  const observation = await preflight(input.creationReview, input, now), ended = now();
  if (ended < start || ended - start > 90_000) throw new Error("J20 Source review exceeded its bound.");
  let manifest: ArnProbeComparisonWorkflowManifest | null = null;
  if (observation.grant.state !== "MISSING") {
    if (!observation.claim) throw new Error("Unclaimed Grant cannot become executable.");
    manifest = await compileArnProbeComparisonWorkflow({ creationReview: input.creationReview, claim: observation.claim, grantChangeSetArn: observation.grant.changeSetArn,
      reviewedAt: new Date(ended).toISOString(), expiresAt: new Date(Math.min(ended + 300_000, probeInstant(input.creationReview.plan.input.comparisonPlan.input.expiresAt) - 600_000)).toISOString() });
  }
  const body = { stage: "B5-J5g-j20", action: "SOURCE_ONLY_WORKFLOW_REVIEW", creationReviewSha256: input.creationReview.reviewSha256,
    createPlanSha256: input.creationReview.plan.planSha256, fence: input.creationReview.fence, expectedGrantChangeSetName: input.creationReview.plan.request.ChangeSetName,
    observation, manifest,
    outcome: manifest ? "EXECUTION_REVIEW_READY_NOT_APPROVED" : observation.claim ? "MISSING_GRANT_SLOT_CONSUMED" : "PREPARE_FENCED_GRANT_REQUIRED",
    mutationPerformed: false, executionApproved: false, operatorReadPerformed: false, runtimeEnabled: false, productionCompatibilityVerified: false, observedAt: new Date(ended).toISOString() };
  return immutable({ ...body, reviewSha256: await sha256Hex(canonicalJson(body)) });
}
export type ArnProbeComparisonApproval = { approvedManifestSha256: string; approvedGrantSha256: string; approvedReadsSha256: string; approvedRevokeSha256: string;
  acknowledgeAwsWrite: boolean; acknowledgeLowCostNotZero: boolean; executionPhrase: string };
function approve(manifest: ArnProbeComparisonWorkflowManifest, a: ArnProbeComparisonApproval, revokeOnly = false) {
  if (a.approvedManifestSha256 !== manifest.manifestSha256 || a.approvedRevokeSha256 !== manifest.actionSha256.revoke || a.acknowledgeAwsWrite !== true || a.acknowledgeLowCostNotZero !== true ||
    (!revokeOnly && (a.approvedGrantSha256 !== manifest.actionSha256.grantExecute || a.approvedReadsSha256 !== manifest.actionSha256.operatorReads)) ||
    a.executionPhrase !== (revokeOnly ? "I_CONFIRM_J5GJ20_REVOKE_ONLY" : manifest.requiredPhrase)) throw new Error("Exact separate Grant/reads/Revoke approval required.");
}
function live(manifest: ArnProbeComparisonWorkflowManifest, now: number) { if (now < probeInstant(manifest.input.reviewedAt) || now >= probeInstant(manifest.input.expiresAt)) throw new Error("J20 approval expired; only separately approved revoke-only recovery allowed."); }
function id(reply: unknown) { const v = arnProbeSafeRequestId(probeObject(probeObject(reply).$metadata).requestId); if (!v) throw new Error("Provider request identity missing."); return v; }
function operatorIdentity(value: Awaited<ReturnType<ArnProbeComparisonWorkflowWrites["prepareOperator"]>>, at: number, minimumMs: number) {
  if (value.callerArn !== ARN_PROBE_OPERATOR_CALLER || value.account !== ARN_PROBE_ACCOUNT || probeInstant(value.expiresAt) - at < minimumMs) throw new Error("Fixed fresh MFA Operator required before Grant and reads.");
}
async function caseResult(manifest: ArnProbeComparisonWorkflowManifest, style: ArnProbeComparisonReadStyle, value: ArnProbeComparisonCaseResult, now: number) {
  fresh(value, now); const approved = manifest.actions.operatorReads.cases.find((c) => c.requestStyle === style)!;
  probeSame(Object.keys(value).sort(), ["account", "authorizationContextObserved", "callerArn", "failure", "manifestSha256", "mutationPerformed", "observedAt", "outcome", "productionCompatibilityVerified", "providerEvidenceSha256", "region", "requestId", "requestSha256", "requestStyle", "retryAuthorized"], "Operator receipt fields");
  if (value.manifestSha256 !== manifest.manifestSha256 || value.requestStyle !== style || value.callerArn !== ARN_PROBE_OPERATOR_CALLER || value.account !== ARN_PROBE_ACCOUNT || value.region !== ARN_PROBE_REGION ||
    value.requestSha256 !== await sha256Hex(canonicalJson(approved.request)) || !["READ_SUCCEEDED", "READ_DENIED", "READ_UNCERTAIN"].includes(value.outcome) || value.mutationPerformed !== false || value.authorizationContextObserved !== false ||
    value.retryAuthorized !== false || value.productionCompatibilityVerified !== false) throw new Error("Operator read receipt scope drifted.");
  if (value.outcome === "READ_SUCCEEDED") { if (value.failure || !value.requestId || !arnProbeSafeRequestId(value.requestId) || !value.providerEvidenceSha256 || !/^[a-f0-9]{64}$/.test(value.providerEvidenceSha256)) throw new Error("Operator read success lacks provider identity/proof."); }
  else if (!value.failure || value.providerEvidenceSha256 !== null || (value.outcome === "READ_DENIED" && value.failure.classification !== "AUTHORIZATION_DENIED")) throw new Error("Operator failure proof drifted.");
  if (value.failure) {
    const f = value.failure;
    if (f.phase !== "OPERATOR_READINESS") throw new Error("Unexpected Operator failure phase.");
    probeSame(f, sanitizeArnProbeFailure({ name: f.code ?? "", $metadata: { requestId: f.requestId, httpStatusCode: f.httpStatusCode } }, "OPERATOR_READINESS", () => probeInstant(f.observedAt)), "Sanitized Operator failure fields");
    fresh(f, now); if (value.requestId !== f.requestId) throw new Error("Operator failure request identity drifted.");
  }
}
async function lockedTwice(m: ArnProbeComparisonWorkflowManifest, reads: ArnProbeComparisonWorkflowReads, signal: AbortSignal, now: () => number) {
  const first = await reads.waitManagement(m.input.creationReview.plan, signal), last = await reads.readManagement(m.input.creationReview.plan, signal);
  if (!(await assertArnProbeComparisonManagement(m.input.creationReview.plan, first, now())) || !(await assertArnProbeComparisonManagement(m.input.creationReview.plan, last, now()))) throw new Error("Exact Locked restoration unproved.");
  probeSame({ ...first, observedAt: null }, { ...last, observedAt: null }, "Locked restoration stability"); return { first, last };
}
async function revoke(m: ArnProbeComparisonWorkflowManifest, ports: LocalEvidence & { reads: ArnProbeComparisonWorkflowReads; writes: Pick<ArnProbeComparisonWorkflowWrites, "createRevoke" | "executeRevoke">; journal: ArnProbeComparisonJournal }, now: () => number,
  fail: (error: unknown, phase: ArnProbeFailurePhase) => void) {
  const signal = AbortSignal.timeout(240_000), plan = m.input.creationReview.plan;
  await local(m.input.creationReview, ports, m.input.claim);
  const grantIntent = await ports.journal.load("grant-execute"), createIntent = await ports.journal.load("revoke-create");
  // A returned/cancelled/lost Execute may start after a stale Locked observation.
  const current = grantIntent && !createIntent ? await ports.reads.waitGrantSettlement(m, signal) : await ports.reads.waitManagement(plan, signal);
  if (await assertArnProbeComparisonManagement(plan, current, now())) return { outcome: "LOCKED_VERIFIED", evidence: await lockedTwice(m, ports.reads, signal, now) };
  let prepared = await ports.reads.waitRevoke(m, signal);
  if (prepared.state === "MISSING") {
    if (createIntent) throw new Error("Revoke create intent exists but target missing; never replay.");
    await ports.journal.reserve("revoke-create", m.actions.revoke.createRequest, new Date(now()).toISOString());
    try {
      const response = probeObject(await ports.writes.createRevoke(m.actions.revoke.createRequest, AbortSignal.timeout(30_000)));
      if (response.StackId !== plan.request.StackName || typeof response.Id !== "string" || !comparisonGrantArn({ request: m.actions.revoke.createRequest }, response.Id)) throw new Error("Revoke creation identity drifted."); id(response);
    } catch (e) { fail(e, "REVOKE_CREATE"); }
    prepared = await ports.reads.waitRevoke(m, signal);
  } else if (!createIntent) throw new Error("Existing revoke lacks its write-ahead intent.");
  if (prepared.state !== "READY_UNEXECUTED" || prepared.stackId !== plan.request.StackName || !comparisonGrantArn({ request: m.actions.revoke.createRequest }, prepared.changeSetArn) ||
    prepared.templateCanonicalSha256 !== plan.revokeTarget.templateCanonicalSha256 || !/^[a-f0-9]{64}$/.test(prepared.providerEvidenceSha256)) throw new Error("Exact prepared Locked revoke required.");
  fresh(prepared, now());
  const request = { StackName: plan.request.StackName, ChangeSetName: prepared.changeSetArn, ClientRequestToken: m.actions.revoke.executeClientToken, DisableRollback: false as const };
  const executeIntent = await ports.journal.load("revoke-execute");
  if (executeIntent) probeSame(executeIntent.request, request, "Revoke execute exact persisted ARN");
  else {
    await local(m.input.creationReview, ports, m.input.claim);
    const before = await ports.reads.readManagement(plan, signal);
    if (await assertArnProbeComparisonManagement(plan, before, now())) return { outcome: "LOCKED_VERIFIED", evidence: await lockedTwice(m, ports.reads, signal, now) };
    await ports.journal.reserve("revoke-execute", request, new Date(now()).toISOString());
    try { id(await ports.writes.executeRevoke(request, AbortSignal.timeout(30_000))); } catch (e) { fail(e, "REVOKE_EXECUTE"); }
  }
  return { outcome: "LOCKED_VERIFIED", evidence: await lockedTwice(m, ports.reads, signal, now) };
}
export async function runArnProbeComparisonWorkflow(input: LocalEvidence & { manifest: ArnProbeComparisonWorkflowManifest; approval: ArnProbeComparisonApproval;
  reads: ArnProbeComparisonWorkflowReads; writes: ArnProbeComparisonWorkflowWrites; operatorReads: ArnProbeComparisonOperatorReads;
  journal: ArnProbeComparisonJournal; signal: AbortSignal; now?: () => number }) {
  const m = input.manifest, now = input.now ?? Date.now; await assertArnProbeComparisonWorkflow(m); approve(m, input.approval); live(m, now()); input.signal.throwIfAborted();
  if (typeof input.operatorReads?.readCase !== "function") throw new Error("Separate fixed Operator read capability required.");
  for (const step of ARN_PROBE_COMPARISON_STEPS) if (await input.journal.load(step)) throw new Error("Fixed workflow is consumed; never replay Grant/reads.");
  const check = async () => { const p = await preflight(m.input.creationReview, input, now, m.input.claim); if (p.grant.state !== "READY_UNEXECUTED" || p.grant.changeSetArn !== m.input.grantChangeSetArn) throw new Error("Approved Grant is not ready."); };
  await check(); operatorIdentity(await input.writes.prepareOperator(input.signal), now(), 600_000); await check(); live(m, now()); input.signal.throwIfAborted();
  await input.journal.reserve("run", m.actions, new Date(now()).toISOString());
  let grantMayStart = false, grantAttempted = false, cleanup: Awaited<ReturnType<typeof revoke>> | null = null;
  let grantObservation: Readonly<ArnProbeReadComparisonManagementObservation> | null = null;
  const sourceReadBrackets: Array<{ requestStyle: ArnProbeComparisonReadStyle; before: Readonly<ArnProbeReadComparisonManagementObservation>; after: Readonly<ArnProbeReadComparisonManagementObservation> }> = [];
  const failures: ReturnType<typeof sanitizeArnProbeFailure>[] = [], results: ArnProbeComparisonCaseResult[] = [];
  const fail = (e: unknown, phase: ArnProbeFailurePhase) => { failures.push(sanitizeArnProbeFailure(e, phase, now)); };
  let phase: ArnProbeFailurePhase = "GRANT_EXECUTE";
  try {
    await input.journal.reserve("grant-execute", m.actions.grantExecute.request, new Date(now()).toISOString()); grantMayStart = true;
    live(m, now()); input.signal.throwIfAborted(); grantAttempted = true;
    try { id(await input.writes.executeGrant(m.actions.grantExecute.request, AbortSignal.timeout(30_000))); } catch (e) { fail(e, "GRANT_EXECUTE"); }
    phase = "GRANT_SETTLEMENT"; const installed = await input.reads.waitGrantSettlement(m, AbortSignal.timeout(120_000));
    if (await assertArnProbeComparisonManagement(m.input.creationReview.plan, installed, now())) throw new Error("Grant not installed; no Operator calls.");
    grantObservation = installed;
    const baseline = m.input.creationReview.sourceReview.observation.managementAfter;
    probeSame(installed.roles, baseline.roles, "Installed comparison role stability");
    probeSame(installed.policies.find((p) => p.logicalId === "CellCloudFormationExecutionBoundary"), baseline.policies.find((p) => p.logicalId === "CellCloudFormationExecutionBoundary"), "Installed execution boundary stability");
    for (const c of m.actions.operatorReads.cases) {
      live(m, now()); input.signal.throwIfAborted(); phase = "SOURCE_FIXTURE";
      const before = await input.reads.readManagement(m.input.creationReview.plan, input.signal);
      if (await assertArnProbeComparisonManagement(m.input.creationReview.plan, before, now())) throw new Error("Comparison Grant absent before read.");
      probeSame({ ...before, observedAt: null }, { ...installed, observedAt: null }, "Installed Grant stable before read");
      assertFixture(m.input.creationReview.plan, await input.reads.readFixture(m.input.creationReview.plan, input.signal), now());
      phase = "OPERATOR_IDENTITY"; operatorIdentity(await input.writes.prepareOperator(input.signal), now(), 60_000);
      phase = "OPERATOR_READINESS"; const step = c.requestStyle === "FULL_ARN_REQUEST" ? "read-full-arn" : "read-exact-name";
      await local(m.input.creationReview, input, m.input.claim); await input.journal.reserve(step, c.request, new Date(now()).toISOString());
      live(m, now()); input.signal.throwIfAborted();
      const result = await input.operatorReads.readCase(m, c.requestStyle, AbortSignal.any([input.signal, AbortSignal.timeout(30_000)]));
      await caseResult(m, c.requestStyle, result, now()); results.push(result);
      const after = await input.reads.readManagement(m.input.creationReview.plan, input.signal);
      if (await assertArnProbeComparisonManagement(m.input.creationReview.plan, after, now())) throw new Error("Comparison Grant absent after read.");
      probeSame({ ...after, observedAt: null }, { ...installed, observedAt: null }, "Installed Grant stable after read");
      sourceReadBrackets.push({ requestStyle: c.requestStyle, before, after });
      if (result.outcome === "READ_UNCERTAIN") break; // No retry on drift, timeout or response loss.
    }
  } catch (e) { fail(e, phase); }
  finally { if (grantMayStart) try { cleanup = await revoke(m, input, now, fail); } catch (e) { fail(e, "REVOKE_VERIFY"); } }
  let fixtureAfter: ArnProbeFixtureState | null = null;
  if (cleanup) try { fixtureAfter = await input.reads.readFixture(m.input.creationReview.plan, AbortSignal.timeout(60_000)); assertFixture(m.input.creationReview.plan, fixtureAfter, now()); await local(m.input.creationReview, input, m.input.claim); }
  catch (e) { fail(e, "POST_PROBE_READ"); fixtureAfter = null; }
  const body = { stage: "B5-J5g-j20", mode: "RUN_REVIEWED", manifestSha256: m.manifestSha256, grantAttempted, grantMayStart, grantObservation, sourceReadBrackets, results, cleanup, fixtureAfter, failures,
    outcome: cleanup ? "LOCKED_READ_COMPARISON_RECORDED" : grantMayStart ? "REVOKE_REQUIRED" : "NO_GRANT_SUBMITTED",
    mutationPerformed: grantAttempted ? null : false, probeDeleted: false, childExecuted: false, deleteStackPerformed: false,
    authorizationContextObserved: false, productionCompatibilityVerified: false, runtimeEnabled: false, retryAuthorized: false, observedAt: new Date(now()).toISOString() };
  return immutable({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
export async function recoverArnProbeComparisonRevoke(input: LocalEvidence & { manifest: ArnProbeComparisonWorkflowManifest; approval: ArnProbeComparisonApproval;
  reads: ArnProbeComparisonWorkflowReads; writes: Pick<ArnProbeComparisonWorkflowWrites, "createRevoke" | "executeRevoke">; journal: ArnProbeComparisonJournal; now?: () => number }) {
  const m = input.manifest, now = input.now ?? Date.now; await assertArnProbeComparisonWorkflow(m); approve(m, input.approval, true);
  if (!(await input.journal.load("run")) || !(await input.journal.load("grant-execute"))) throw new Error("Revoke recovery requires the original durable run and Grant intent.");
  const failures: ReturnType<typeof sanitizeArnProbeFailure>[] = []; let cleanup: Awaited<ReturnType<typeof revoke>> | null = null;
  try { cleanup = await revoke(m, input, now, (e, p) => failures.push(sanitizeArnProbeFailure(e, p, now))); } catch (e) { failures.push(sanitizeArnProbeFailure(e, "REVOKE_VERIFY", now)); }
  const body = { stage: "B5-J5g-j20", mode: "REVOKE_ONLY_RECOVERY", manifestSha256: m.manifestSha256, cleanup, failures,
    outcome: cleanup ? "LOCKED_VERIFIED" : "REVOKE_REQUIRED", grantReplayed: false, operatorReadReplayed: false,
    retryAuthorized: false, productionCompatibilityVerified: false, runtimeEnabled: false, observedAt: new Date(now()).toISOString() };
  return immutable({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
export async function inspectArnProbeComparisonWorkflow(input: LocalEvidence & { creationReview: ArnProbeComparisonCreateReview;
  reads: ArnProbeComparisonWorkflowReads; signal: AbortSignal; now?: () => number }) {
  const now = input.now ?? Date.now, review = input.creationReview; await assertArnProbeComparisonCreateReview(review);
  const claim = await local(review, input), before = await input.reads.waitManagement(review.plan, input.signal);
  await assertArnProbeComparisonManagement(review.plan, before, now());
  const fixture = await input.reads.readFixture(review.plan, input.signal); assertFixture(review.plan, fixture, now());
  const after = await input.reads.readManagement(review.plan, input.signal), locked = await assertArnProbeComparisonManagement(review.plan, after, now());
  probeSame({ ...before, observedAt: null }, { ...after, observedAt: null }, "Inspection management stability");
  probeSame(await local(review, input), claim, "Inspection local stability"); input.signal.throwIfAborted();
  if (!locked && !claim) throw new Error("Installed comparison lacks its permanent claim; manual reconciliation required.");
  const body = { stage: "B5-J5g-j20", mode: "READ_ONLY_INSPECT", creationReviewSha256: review.reviewSha256, claim, management: after, fixture,
    outcome: locked ? "LOCKED_VERIFIED" : "REVOKE_REQUIRED", mutationPerformed: false, grantReplayed: false, operatorReadReplayed: false,
    retryAuthorized: false, productionCompatibilityVerified: false, runtimeEnabled: false, observedAt: new Date(now()).toISOString() };
  return immutable({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
