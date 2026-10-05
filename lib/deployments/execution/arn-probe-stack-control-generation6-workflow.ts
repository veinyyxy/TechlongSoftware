import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeSame, probeInstant, probeObject, ARN_PROBE_OPERATOR_CALLER } from "./arn-compatibility-probe-workflow.ts";
import { ARN_PROBE_ACCOUNT, ARN_PROBE_REGION, ARN_PROBE_SOURCE, type ArnProbeFixtureState } from "./arn-compatibility-probe-fixture.ts";
import { arnProbeSafeRequestId, sanitizeArnProbeFailure, type ArnProbeFailurePhase } from "./arn-compatibility-probe-diagnostics.ts";
import { comparisonGrantArn, type ArnProbeComparisonGrantState } from "./arn-probe-read-comparison-generation4-create.ts";
import type { ArnProbeComparisonCaseResult, ArnProbeComparisonReadStyle } from "./arn-probe-read-comparison-generation4-workflow.ts";
import type { StackControlManagementObservation } from "./aws-sdk-shared-cell-author-compensation-management.ts";
import { stackControlCopy, stackControlFresh, type StackControlFixtureInventory } from "./arn-probe-stack-scoped-read-control-create.ts";
import { assertGeneration6CreateReview, assertGeneration6Claim, generation6ClaimBinding, recoverGeneration6Create, assertGeneration6CreationObservation,
  type Generation6CreationObservation, type Generation6CreateReview, type Generation6CreatePlan, type Generation6Claim,
  type Generation6Context, type Generation6SourceReads } from "./arn-probe-stack-control-generation6.ts";
import { compileGeneration6Actions, GENERATION6_STEPS, type Generation6Journal } from "./arn-probe-stack-control-generation6-actions.ts";

export async function compileGeneration6Workflow(input: { creationReview: Generation6CreateReview; claim: Generation6Claim;
  grantChangeSetArn: string; reviewedAt: string; expiresAt: string; sourceObservation: Generation6CreationObservation }) {
  probeSame(Object.keys(input).sort(), ["claim", "creationReview", "expiresAt", "grantChangeSetArn", "reviewedAt", "sourceObservation"], "J23 generation6 execution manifest inputs");
  const { sourceObservation, ...base } = input, binding = await compileGeneration6Actions(base), at = probeInstant(input.reviewedAt);
  assertGeneration6CreationObservation(input.creationReview.plan, sourceObservation, at);
  if (sourceObservation.inventory.target.state !== "READY_UNEXECUTED" || sourceObservation.inventory.target.changeSetArn !== input.grantChangeSetArn) throw new Error("Fresh exact unexecuted Grant required, never a pure future binding.");
  const { manifestSha256: ignored, ...body } = binding; void ignored;
  const result = { ...body, action: "REVIEW_GENERATION6_STACK_READ_WORKFLOW", input, installationToolsImplemented: true,
    sourceObservationSha256: await sha256Hex(canonicalJson(sourceObservation)), executionApproved: false };
  return stackControlCopy({ ...result, manifestSha256: await sha256Hex(canonicalJson(result)) });
}
export type Generation6WorkflowManifest = Awaited<ReturnType<typeof compileGeneration6Workflow>>;
export async function assertGeneration6Workflow(manifest: Generation6WorkflowManifest) { probeSame(manifest, await compileGeneration6Workflow(manifest.input), "J23 generation6 Source-bound execution manifest"); }
export type Generation6RevokeState = ArnProbeComparisonGrantState | Readonly<{ state: "CREATING" | "EXECUTING" | "FAILED"; observedAt: string }>;
export type Generation6WorkflowInventory = Readonly<{ stackId: string; observedAt: string; complete: true; providerEvidenceSha256: string;
  objects: readonly Readonly<{ kind: string; arn: string; status: string; executionStatus: string }>[] }>;
export interface Generation6WorkflowReads {
  creation: Generation6SourceReads;
  readManagement(plan: Generation6CreatePlan, signal: AbortSignal): Promise<Readonly<StackControlManagementObservation>>;
  waitManagement(plan: Generation6CreatePlan, signal: AbortSignal): Promise<Readonly<StackControlManagementObservation>>;
  waitGrantSettlement(manifest: Generation6WorkflowManifest, signal: AbortSignal): Promise<Readonly<StackControlManagementObservation>>;
  readFixture(plan: Generation6CreatePlan, signal: AbortSignal): Promise<ArnProbeFixtureState>;
  readFixtureInventory(plan: Generation6CreatePlan, signal: AbortSignal): Promise<StackControlFixtureInventory>;
  waitRevoke(manifest: Generation6WorkflowManifest, signal: AbortSignal): Promise<Generation6RevokeState>;
  readWorkflowInventory(manifest: Generation6WorkflowManifest, signal: AbortSignal): Promise<Generation6WorkflowInventory>;
}
export interface Generation6WorkflowWrites {
  prepareOperator(signal: AbortSignal): Promise<{ callerArn: string; account: string; expiresAt: string }>;
  executeGrant(request: Generation6WorkflowManifest["actions"]["grantExecute"]["request"], signal: AbortSignal): Promise<unknown>;
  createRevoke(request: Generation6WorkflowManifest["actions"]["revoke"]["createRequest"], signal: AbortSignal): Promise<unknown>;
  executeRevoke(request: { StackName: string; ChangeSetName: string; ClientRequestToken: string; DisableRollback: false }, signal: AbortSignal): Promise<unknown>;
}
export interface Generation6OperatorReads {
  readCase(manifest: Generation6WorkflowManifest, style: ArnProbeComparisonReadStyle, signal: AbortSignal): Promise<ArnProbeComparisonCaseResult>;
}
type Local = { readClaim: () => Promise<Generation6Claim | null>; readContext: () => Promise<Generation6Context> };
function normalized(value: { observedAt: string }) { return { ...value, observedAt: null }; }
function digest(value: unknown) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("J23 generation6 complete provider digest required."); }
export function assertGeneration6WorkflowInventory(m: Generation6WorkflowManifest, value: Generation6WorkflowInventory, at: number) {
  stackControlFresh(value, at); digest(value.providerEvidenceSha256);
  probeSame(value, { stackId: m.input.creationReview.plan.request.StackName, complete: true, objects: value.objects,
    observedAt: value.observedAt, providerEvidenceSha256: value.providerEvidenceSha256 }, "J23 generation6 exact complete management inventory fields");
  if (!Array.isArray(value.objects)) throw new Error("J23 generation6 complete management objects required.");
  const seen = new Set<string>(), kinds = new Set<string>();
  for (const object of value.objects) {
    probeSame(Object.keys(object).sort(), ["arn", "executionStatus", "kind", "status"], "J23 generation6 exact inventory object fields");
    const valid = object.kind === "CURRENT_GRANT" ? object.arn === m.input.grantChangeSetArn && object.status === "CREATE_COMPLETE" &&
        ["AVAILABLE", "EXECUTE_IN_PROGRESS", "EXECUTE_COMPLETE", "EXECUTE_FAILED", "OBSOLETE"].includes(object.executionStatus)
      : object.kind === "CURRENT_REVOKE" && comparisonGrantArn({ request: m.actions.revoke.createRequest }, object.arn) &&
        (["CREATE_PENDING", "CREATE_IN_PROGRESS"].includes(object.status) ? object.executionStatus === "UNAVAILABLE" : object.status === "CREATE_COMPLETE" &&
          ["AVAILABLE", "EXECUTE_IN_PROGRESS", "EXECUTE_COMPLETE", "EXECUTE_FAILED", "OBSOLETE"].includes(object.executionStatus));
    if (!valid || seen.has(object.arn) || kinds.has(object.kind)) throw new Error("J23 generation6 foreign/duplicate inventory object."); seen.add(object.arn); kinds.add(object.kind);
  }
}
async function local(review: Generation6CreateReview, ports: Local, expected?: Generation6Claim) {
  probeSame(await ports.readContext(), review.plan.input.candidate.input.context, "J23 generation6 actual archived context and retirement unchanged");
  const claim = await ports.readClaim(); if (!claim) throw new Error("J23 generation6 execution/inspect requires its actual permanent claim.");
  await assertGeneration6Claim(claim, review.fence); probeSame(claim.binding, await generation6ClaimBinding(review), "J23 generation6 exact durable creation claim");
  if (expected) probeSame(claim, expected, "J23 generation6 permanent claim stability"); return claim;
}
export async function assertGeneration6Management(plan: Generation6CreatePlan, value: StackControlManagementObservation, at: number) {
  stackControlFresh(value, at); const locked = value.rendererShape === "Locked", baseline = plan.input.candidate.input.context.retirementProof.observation.managementAfter;
  if (!locked && value.rendererShape !== "StackScopedReadControlGrant") throw new Error("Foreign management renderer is not a J23 generation6 Grant.");
  if (value.accountId !== ARN_PROBE_ACCOUNT || value.region !== ARN_PROBE_REGION || value.callerArn !== ARN_PROBE_SOURCE || value.cellStackState !== "MISSING" || value.authorityState !== "ABSENT") throw new Error("J23 generation6 exact Source/Cell/authority required.");
  const template = JSON.parse(locked ? plan.revokeTarget.templateBody : plan.request.TemplateBody);
  const expectedStack = { ...baseline.stack, status: value.stack.status, templateRawSha256: locked ? plan.revokeTarget.templateRawSha256 : plan.templateRawSha256,
    templateCanonicalSha256: locked ? plan.revokeTarget.templateCanonicalSha256 : plan.templateCanonicalSha256, safetyState: template.Outputs.SafetyState.Value };
  if (!["UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"].includes(value.stack.status)) throw new Error("J23 generation6 management settlement is not terminal.");
  probeSame(value.stack, expectedStack, "J23 generation6 exact Stack and four IAM resources"); probeSame(value.roles, baseline.roles, "J23 generation6 full role/trust/attachments");
  if (value.policies.length !== 2) throw new Error("J23 generation6 full policy inventory required.");
  for (const logicalId of ["CellOperatorBoundary", "CellCloudFormationExecutionBoundary"]) {
    const policy = value.policies.find(p => p.logicalId === logicalId), old = baseline.policies.find(p => p.logicalId === logicalId)!;
    if (!policy) throw new Error("J23 generation6 policy missing.");
    if (logicalId === "CellCloudFormationExecutionBoundary") probeSame(policy, old, "J23 generation6 execution boundary unchanged");
    else {
      const stable = (p: typeof policy) => Object.fromEntries(Object.entries(p).filter(([k]) => !["defaultVersionId", "versionIds", "defaultDocumentSha256"].includes(k)));
      probeSame(stable(policy), stable(old), "J23 generation6 Operator policy attachments/boundary usage");
      if (!/^v\d+$/.test(policy.defaultVersionId) || policy.versionIds.some(v => !/^v\d+$/.test(v)) || !policy.versionIds.includes(policy.defaultVersionId) || new Set(policy.versionIds).size !== policy.versionIds.length ||
        policy.defaultDocumentSha256 !== await sha256Hex(canonicalJson(template.Resources.CellOperatorBoundary.Properties.PolicyDocument))) throw new Error("J23 generation6 exact live default Operator document/version required.");
    }
  }
  probeSame(value, { ...baseline, rendererShape: locked ? "Locked" : "StackScopedReadControlGrant", stack: expectedStack,
    policies: value.policies, observedAt: value.observedAt }, "J23 generation6 complete management fields"); return locked;
}
function fixture(plan: Generation6CreatePlan, value: ArnProbeFixtureState, inventory: StackControlFixtureInventory, at: number) {
  stackControlFresh(value, at); stackControlFresh(inventory, at); digest(inventory.providerEvidenceSha256);
  const proof = plan.input.candidate.input.context.retirementProof, baseline = proof.observation.fixture, original = proof.observation.fixtureInventory;
  probeSame(normalized(value), normalized(baseline), "J23 generation6 original zero-resource fixture unchanged");
  probeSame(inventory, { stackId: original.stackId, changeSetArn: original.changeSetArn, changeSetName: original.changeSetName,
    status: "CREATE_COMPLETE", executionStatus: "AVAILABLE", complete: true, count: 1, providerEvidenceSha256: inventory.providerEvidenceSha256, observedAt: inventory.observedAt }, "J23 generation6 complete singleton fixture inventory");
}
async function preflight(review: Generation6CreateReview, ports: Local & { reads: Generation6WorkflowReads; signal: AbortSignal }, now: () => number, expected?: Generation6Claim) {
  const claim = await local(review, ports, expected);
  const recovered = await recoverGeneration6Create({ review, slot: { fence: review.fence, readClaim: ports.readClaim }, reads: ports.reads.creation,
    readContext: ports.readContext, signal: ports.signal, now });
  if (recovered.observation.inventory.target.state !== "READY_UNEXECUTED") throw new Error("J23 generation6 exact ready Grant required; consumed missing target cannot be recreated.");
  probeSame(recovered.claim, claim, "J23 generation6 creation preflight claim"); await local(review, ports, claim); return recovered.observation;
}
export async function reviewGeneration6Workflow(input: Local & { creationReview: Generation6CreateReview; reads: Generation6WorkflowReads; signal: AbortSignal; now?: () => number }) {
  const now = input.now ?? Date.now, started = now(); await assertGeneration6CreateReview(input.creationReview);
  const claim = await local(input.creationReview, input), sourceObservation = await preflight(input.creationReview, input, now, claim), ended = now();
  if (ended < started || ended - started > 90_000) throw new Error("J23 generation6 workflow review exceeded its bound.");
  const target = sourceObservation.inventory.target; if (target.state !== "READY_UNEXECUTED") throw new Error("J23 generation6 target not ready.");
  const manifest = await compileGeneration6Workflow({ creationReview: input.creationReview, claim, sourceObservation, grantChangeSetArn: target.changeSetArn,
    reviewedAt: new Date(ended).toISOString(), expiresAt: new Date(Math.min(ended + 300_000, probeInstant(input.creationReview.plan.input.candidate.input.expiresAt) - 600_000)).toISOString() });
  const body = { stage: "B5-J5g-j23", mode: "SOURCE_ONLY_WORKFLOW_REVIEW", manifest, outcome: "EXECUTION_REVIEW_READY_NOT_APPROVED",
    mutationPerformed: false, executionApproved: false, operatorSessionCreated: false, productionCompatibilityVerified: false, runtimeEnabled: false, observedAt: new Date(now()).toISOString() };
  return stackControlCopy({ ...body, reviewSha256: await sha256Hex(canonicalJson(body)) });
}
export type Generation6WorkflowApproval = { approvedManifestSha256: string; approvedGrantSha256: string; approvedReadsSha256: string; approvedRevokeSha256: string;
  acknowledgeAwsWrite: boolean; acknowledgeLowCostNotZero: boolean; executionPhrase: string };
export function approveGeneration6Workflow(m: Generation6WorkflowManifest, a: Generation6WorkflowApproval, revokeOnly = false) {
  probeSame(a, { approvedManifestSha256: m.manifestSha256, approvedGrantSha256: revokeOnly ? "" : m.actionSha256.grantExecute,
    approvedReadsSha256: revokeOnly ? "" : m.actionSha256.operatorReads, approvedRevokeSha256: m.actionSha256.revoke,
    acknowledgeAwsWrite: true, acknowledgeLowCostNotZero: true, executionPhrase: revokeOnly ? "I_CONFIRM_J5GJ23_GENERATION6_REVOKE_ONLY" : m.requiredPhrase }, "J23 generation6 exact separate Grant/reads/Revoke approvals");
}
function live(m: Generation6WorkflowManifest, at: number) { if (at < probeInstant(m.input.reviewedAt) || at >= probeInstant(m.input.expiresAt)) throw new Error("J23 generation6 installation/read approval expired; only separately approved revoke-only recovery."); }
function requestId(value: unknown) { const id = arnProbeSafeRequestId(probeObject(probeObject(value).$metadata).requestId); if (!id) throw new Error("J23 generation6 provider request ID missing."); return id; }
function operatorIdentity(value: Awaited<ReturnType<Generation6WorkflowWrites["prepareOperator"]>>, at: number, margin: number) {
  if (value.account !== ARN_PROBE_ACCOUNT || value.callerArn !== ARN_PROBE_OPERATOR_CALLER || probeInstant(value.expiresAt) - at < margin) throw new Error("J23 generation6 fixed fresh MFA Operator required.");
}
async function caseResult(m: Generation6WorkflowManifest, style: ArnProbeComparisonReadStyle, value: ArnProbeComparisonCaseResult, at: number) {
  stackControlFresh(value, at); const c = m.actions.operatorReads.cases.find(c => c.requestStyle === style)!;
  if (!["READ_SUCCEEDED", "READ_DENIED", "READ_UNCERTAIN"].includes(value.outcome)) throw new Error("J23 generation6 unknown read result.");
  probeSame(value, { manifestSha256: m.manifestSha256, requestStyle: style, callerArn: ARN_PROBE_OPERATOR_CALLER, account: ARN_PROBE_ACCOUNT, region: ARN_PROBE_REGION,
    requestSha256: await sha256Hex(canonicalJson(c.request)), outcome: value.outcome, providerEvidenceSha256: value.providerEvidenceSha256, requestId: value.requestId, failure: value.failure,
    observedAt: value.observedAt, mutationPerformed: false, authorizationContextObserved: false, productionCompatibilityVerified: false, retryAuthorized: false }, "J23 generation6 exact read receipt fields");
  if (value.outcome === "READ_SUCCEEDED") { digest(value.providerEvidenceSha256); if (value.failure || !arnProbeSafeRequestId(value.requestId)) throw new Error("J23 generation6 read success missing provider proof."); }
  else {
    if (!value.failure || value.providerEvidenceSha256 !== null || value.requestId !== value.failure.requestId ||
      (value.outcome === "READ_DENIED" && (value.failure.classification !== "AUTHORIZATION_DENIED" || !arnProbeSafeRequestId(value.requestId)))) throw new Error("J23 generation6 read failure proof drifted.");
    const f = value.failure; stackControlFresh(f, at);
    probeSame(f, sanitizeArnProbeFailure({ name: f.code ?? "", $metadata: { requestId: f.requestId, httpStatusCode: f.httpStatusCode } }, "OPERATOR_READINESS", () => probeInstant(f.observedAt)), "J23 generation6 sanitized failure fields");
  }
}
async function lockedTwice(m: Generation6WorkflowManifest, reads: Generation6WorkflowReads, signal: AbortSignal, now: () => number) {
  const first = await reads.waitManagement(m.input.creationReview.plan, signal), last = await reads.readManagement(m.input.creationReview.plan, signal);
  if (!(await assertGeneration6Management(m.input.creationReview.plan, first, now())) || !(await assertGeneration6Management(m.input.creationReview.plan, last, now()))) throw new Error("J23 generation6 exact Locked restoration unproved.");
  probeSame(normalized(first), normalized(last), "J23 generation6 full independent Locked stability"); return { first, last };
}
async function revoke(m: Generation6WorkflowManifest, ports: Local & { reads: Generation6WorkflowReads; writes: Pick<Generation6WorkflowWrites, "createRevoke" | "executeRevoke">; journal: Generation6Journal },
  now: () => number, fail: (e: unknown, phase: ArnProbeFailurePhase) => void) {
  const signal = AbortSignal.timeout(240_000), plan = m.input.creationReview.plan; await local(m.input.creationReview, ports, m.input.claim);
  const grantIntent = await ports.journal.load("grant-execute"), createIntent = await ports.journal.load("revoke-create");
  const current = grantIntent && !createIntent ? await ports.reads.waitGrantSettlement(m, signal) : await ports.reads.waitManagement(plan, signal);
  if (await assertGeneration6Management(plan, current, now())) return { outcome: "LOCKED_VERIFIED", evidence: await lockedTwice(m, ports.reads, signal, now) };
  let prepared = await ports.reads.waitRevoke(m, signal);
  if (prepared.state === "MISSING") {
    if (prepared.proof !== "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY" || createIntent) throw new Error("J23 generation6 missing Revoke cannot be replayed/adopted.");
    stackControlFresh(prepared, now()); await ports.journal.reserve("revoke-create", m.actions.revoke.createRequest, new Date(now()).toISOString());
    try { const reply = probeObject(await ports.writes.createRevoke(m.actions.revoke.createRequest, AbortSignal.timeout(30_000)));
      if (reply.StackId !== plan.request.StackName || typeof reply.Id !== "string" || !comparisonGrantArn({ request: m.actions.revoke.createRequest }, reply.Id)) throw new Error("J23 generation6 Revoke Create identity drifted."); requestId(reply);
    } catch (e) { fail(e, "REVOKE_CREATE"); }
    prepared = await ports.reads.waitRevoke(m, signal);
  } else if (!createIntent) throw new Error("J23 generation6 existing Revoke has no permanent intent.");
  if (prepared.state !== "READY_UNEXECUTED" || prepared.stackId !== plan.request.StackName || !comparisonGrantArn({ request: m.actions.revoke.createRequest }, prepared.changeSetArn) ||
    prepared.templateCanonicalSha256 !== plan.revokeTarget.templateCanonicalSha256) throw new Error("J23 generation6 exact ready Locked Revoke required.");
  digest(prepared.providerEvidenceSha256); stackControlFresh(prepared, now());
  const request = { StackName: plan.request.StackName, ChangeSetName: prepared.changeSetArn, ClientRequestToken: m.actions.revoke.executeClientToken, DisableRollback: false as const };
  const executeIntent = await ports.journal.load("revoke-execute");
  if (executeIntent) probeSame(executeIntent.request, request, "J23 generation6 persisted exact Revoke ARN");
  else {
    await local(m.input.creationReview, ports, m.input.claim); const before = await ports.reads.readManagement(plan, signal);
    if (await assertGeneration6Management(plan, before, now())) return { outcome: "LOCKED_VERIFIED", evidence: await lockedTwice(m, ports.reads, signal, now) };
    await ports.journal.reserve("revoke-execute", request, new Date(now()).toISOString());
    try { requestId(await ports.writes.executeRevoke(request, AbortSignal.timeout(30_000))); } catch (e) { fail(e, "REVOKE_EXECUTE"); }
  }
  return { outcome: "LOCKED_VERIFIED", evidence: await lockedTwice(m, ports.reads, signal, now) };
}
export async function runGeneration6Workflow(input: Local & { manifest: Generation6WorkflowManifest; approval: Generation6WorkflowApproval;
  reads: Generation6WorkflowReads; writes: Generation6WorkflowWrites; operatorReads: Generation6OperatorReads; journal: Generation6Journal; signal: AbortSignal; now?: () => number }) {
  const m = input.manifest, now = input.now ?? Date.now; await assertGeneration6Workflow(m); approveGeneration6Workflow(m, input.approval); live(m, now()); input.signal.throwIfAborted();
  if (typeof input.operatorReads?.readCase !== "function") throw new Error("J23 generation6 separate Operator read capability missing.");
  for (const step of GENERATION6_STEPS) if (await input.journal.load(step)) throw new Error("J23 generation6 workflow consumed; never replay Grant/reads.");
  const check = async () => { const source = await preflight(m.input.creationReview, input, now, m.input.claim);
    if (source.inventory.target.state !== "READY_UNEXECUTED" || source.inventory.target.changeSetArn !== m.input.grantChangeSetArn) throw new Error("J23 generation6 approved Grant no longer ready.");
    if (source.inventory.count !== 1) throw new Error("J23 generation6 full singleton Grant inventory required before install."); };
  await check(); live(m, now()); operatorIdentity(await input.writes.prepareOperator(input.signal), now(), 600_000); await check(); live(m, now()); input.signal.throwIfAborted();
  await input.journal.reserve("run", m.actions, new Date(now()).toISOString());
  let grantMayStart = false, grantAttempted = false, cleanup: Awaited<ReturnType<typeof revoke>> | null = null, grantObservation: Readonly<StackControlManagementObservation> | null = null;
  const results: ArnProbeComparisonCaseResult[] = [], sourceReadBrackets: { requestStyle: ArnProbeComparisonReadStyle; before: Readonly<StackControlManagementObservation>; after: Readonly<StackControlManagementObservation> }[] = [];
  const failures: ReturnType<typeof sanitizeArnProbeFailure>[] = [], fail = (e: unknown, phase: ArnProbeFailurePhase) => failures.push(sanitizeArnProbeFailure(e, phase, now));
  let phase: ArnProbeFailurePhase = "GRANT_EXECUTE";
  try {
    await input.journal.reserve("grant-execute", m.actions.grantExecute.request, new Date(now()).toISOString()); grantMayStart = true;
    live(m, now()); input.signal.throwIfAborted(); grantAttempted = true;
    try { requestId(await input.writes.executeGrant(m.actions.grantExecute.request, AbortSignal.timeout(30_000))); } catch (e) { fail(e, "GRANT_EXECUTE"); }
    phase = "GRANT_SETTLEMENT"; const installed = await input.reads.waitGrantSettlement(m, AbortSignal.timeout(120_000));
    if (await assertGeneration6Management(m.input.creationReview.plan, installed, now())) throw new Error("J23 generation6 Grant not installed; no Operator reads."); grantObservation = installed;
    for (const c of m.actions.operatorReads.cases) {
      live(m, now()); input.signal.throwIfAborted(); phase = "SOURCE_FIXTURE"; const plan = m.input.creationReview.plan;
      const before = await input.reads.readManagement(plan, input.signal);
      if (await assertGeneration6Management(plan, before, now())) throw new Error("J23 generation6 Grant absent before read."); probeSame(normalized(before), normalized(installed), "J23 generation6 full installed Grant stable before read");
      fixture(plan, await input.reads.readFixture(plan, input.signal), await input.reads.readFixtureInventory(plan, input.signal), now());
      phase = "OPERATOR_IDENTITY"; live(m, now()); operatorIdentity(await input.writes.prepareOperator(input.signal), now(), 60_000);
      phase = "OPERATOR_READINESS"; await local(m.input.creationReview, input, m.input.claim);
      await input.journal.reserve(c.requestStyle === "FULL_ARN_REQUEST" ? "read-full-arn" : "read-exact-name", c.request, new Date(now()).toISOString()); live(m, now()); input.signal.throwIfAborted();
      const result = await input.operatorReads.readCase(m, c.requestStyle, AbortSignal.any([input.signal, AbortSignal.timeout(30_000)])); await caseResult(m, c.requestStyle, result, now());
      if (result.requestId && results.some(r => r.requestId === result.requestId)) throw new Error("J23 generation6 read request IDs must be distinct."); results.push(result);
      const after = await input.reads.readManagement(plan, input.signal); if (await assertGeneration6Management(plan, after, now())) throw new Error("J23 generation6 Grant absent after read.");
      probeSame(normalized(after), normalized(installed), "J23 generation6 full installed Grant stable after read"); sourceReadBrackets.push({ requestStyle: c.requestStyle, before, after });
      if (result.outcome === "READ_UNCERTAIN") break;
    }
  } catch (e) { fail(e, phase); }
  finally { if (grantMayStart) try { cleanup = await revoke(m, input, now, fail); } catch (e) { fail(e, "REVOKE_VERIFY"); } }
  let fixtureAfter: ArnProbeFixtureState | null = null;
  if (cleanup) try { const s = AbortSignal.timeout(60_000), plan = m.input.creationReview.plan; fixtureAfter = await input.reads.readFixture(plan, s);
    fixture(plan, fixtureAfter, await input.reads.readFixtureInventory(plan, s), now()); await local(m.input.creationReview, input, m.input.claim);
  } catch (e) { fixtureAfter = null; fail(e, "POST_PROBE_READ"); }
  const body = { stage: "B5-J5g-j23", mode: "RUN_REVIEWED", manifestSha256: m.manifestSha256, grantAttempted, grantMayStart, grantObservation, results, sourceReadBrackets, cleanup, fixtureAfter, failures,
    outcome: cleanup && fixtureAfter ? "LOCKED_STACK_READ_CONTROL_RECORDED" : cleanup ? "LOCKED_RECONCILIATION_REQUIRED" : grantMayStart ? "REVOKE_REQUIRED" : "NO_GRANT_SUBMITTED", mutationPerformed: grantAttempted ? null : false,
    probeDeleted: false, childExecuted: false, deleteStackPerformed: false, retryAuthorized: false, authorizationContextObserved: false, productionCompatibilityVerified: false, runtimeEnabled: false, observedAt: new Date(now()).toISOString() };
  return stackControlCopy({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
export async function recoverGeneration6Revoke(input: Local & { manifest: Generation6WorkflowManifest; approval: Generation6WorkflowApproval;
  reads: Generation6WorkflowReads; writes: Pick<Generation6WorkflowWrites, "createRevoke" | "executeRevoke">; journal: Generation6Journal; now?: () => number }) {
  const m = input.manifest, now = input.now ?? Date.now; await assertGeneration6Workflow(m); approveGeneration6Workflow(m, input.approval, true);
  if (!(await input.journal.load("run")) || !(await input.journal.load("grant-execute"))) throw new Error("J23 generation6 revoke-only requires original run and Grant intents.");
  const failures: ReturnType<typeof sanitizeArnProbeFailure>[] = []; let cleanup: Awaited<ReturnType<typeof revoke>> | null = null;
  try { cleanup = await revoke(m, input, now, (e, p) => failures.push(sanitizeArnProbeFailure(e, p, now))); } catch (e) { failures.push(sanitizeArnProbeFailure(e, "REVOKE_VERIFY", now)); }
  const body = { stage: "B5-J5g-j23", mode: "REVOKE_ONLY_RECOVERY", manifestSha256: m.manifestSha256, cleanup, failures, outcome: cleanup ? "LOCKED_VERIFIED" : "REVOKE_REQUIRED",
    grantReplayed: false, operatorReadReplayed: false, retryAuthorized: false, productionCompatibilityVerified: false, runtimeEnabled: false, observedAt: new Date(now()).toISOString() };
  return stackControlCopy({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
export async function inspectGeneration6Workflow(input: Local & { manifest: Generation6WorkflowManifest; reads: Generation6WorkflowReads; journal: Generation6Journal; signal: AbortSignal; now?: () => number }) {
  const m = input.manifest, plan = m.input.creationReview.plan, now = input.now ?? Date.now; await assertGeneration6Workflow(m);
  await local(m.input.creationReview, input, m.input.claim);
  // A terminal-looking old root can precede a submitted Grant becoming visible.
  // An independent Inspect must not certify Locked until that intent settles.
  if (await input.journal.load("grant-execute")) await input.reads.waitGrantSettlement(m, input.signal);
  const before = await input.reads.waitManagement(plan, input.signal), fixtureState = await input.reads.readFixture(plan, input.signal), inventory = await input.reads.readFixtureInventory(plan, input.signal);
  fixture(plan, fixtureState, inventory, now()); const managementInventory = await input.reads.readWorkflowInventory(m, input.signal); assertGeneration6WorkflowInventory(m, managementInventory, now());
  const after = await input.reads.readManagement(plan, input.signal); await assertGeneration6Management(plan, before, now()); const locked = await assertGeneration6Management(plan, after, now());
  probeSame(normalized(before), normalized(after), "J23 generation6 independent Inspect management stability"); await local(m.input.creationReview, input, m.input.claim); input.signal.throwIfAborted();
  const body = { stage: "B5-J5g-j23", mode: "READ_ONLY_INSPECT", manifestSha256: m.manifestSha256, claim: m.input.claim, management: after,
    fixture: fixtureState, fixtureInventory: inventory, managementInventory, outcome: locked ? "LOCKED_VERIFIED" : "REVOKE_REQUIRED", mutationPerformed: false,
    retryAuthorized: false, operatorSessionCreated: false, productionCompatibilityVerified: false, runtimeEnabled: false, observedAt: new Date(now()).toISOString() };
  return stackControlCopy({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
