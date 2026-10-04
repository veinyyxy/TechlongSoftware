import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeSame, probeInstant, probeObject, ARN_PROBE_OPERATOR_CALLER } from "./arn-compatibility-probe-workflow.ts";
import { ARN_PROBE_SOURCE, ARN_PROBE_REGION, ARN_PROBE_ACCOUNT } from "./arn-compatibility-probe-fixture.ts";
import { arnProbeSafeRequestId } from "./arn-compatibility-probe-diagnostics.ts";
import { assertArnProbeComparisonCreateReview, type ArnProbeComparisonCreateReview } from "./arn-probe-read-comparison-generation4-create.ts";
import { assertArnProbeComparisonWorkflow, assertArnProbeComparisonManagement, comparisonStepRequest, ARN_PROBE_COMPARISON_STEPS,
  type ArnProbeComparisonWorkflowManifest, type ArnProbeComparisonStep, type runArnProbeComparisonWorkflow,
  type inspectArnProbeComparisonWorkflow } from "./arn-probe-read-comparison-generation4-workflow.ts";

type Run = Awaited<ReturnType<typeof runArnProbeComparisonWorkflow>>;
type Inspect = Awaited<ReturnType<typeof inspectArnProbeComparisonWorkflow>>;
export type StackScopedReadControlEvidence = {
  creationReview: ArnProbeComparisonCreateReview; manifest: ArnProbeComparisonWorkflowManifest; run: Run; inspect: Inspect;
  diagnostic: Record<string, unknown>; intents: Readonly<Record<ArnProbeComparisonStep, Readonly<Record<string, unknown>>>>;
};
function copy<T>(value: T): Readonly<T> {
  const result = JSON.parse(canonicalJson(value)) as T;
  function freeze(v: unknown) { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } }
  freeze(result); return result;
}
function normalized(v: { observedAt: string }) { return { ...v, observedAt: null }; }
async function digest(v: object, key: string) {
  const body = { ...v } as Record<string, unknown>, expected = body[key]; delete body[key];
  if (expected !== await sha256Hex(canonicalJson(body))) throw new Error("Closed generation4 evidence digest drifted.");
}

/** All six consumed intents must bind one exact historical manifest. This is
 * pure validation, not a filesystem journal or a successor reservation API. */
export async function stackScopedReadControlJournal(input: StackScopedReadControlEvidence) {
  const m = input.manifest;
  probeSame(Object.keys(input.intents).sort(), [...ARN_PROBE_COMPARISON_STEPS].sort(), "Complete consumed generation4 workflow");
  let previous = probeInstant(m.input.claim.reservedAt);
  for (const step of ARN_PROBE_COMPARISON_STEPS) {
    const v = input.intents[step], at = probeInstant(String(v.reservedAt));
    if (at < previous || (!step.startsWith("revoke-") && (at < probeInstant(m.input.reviewedAt) || at >= probeInstant(m.input.expiresAt)))) throw new Error("Closed workflow intent chronology drifted.");
    const request = comparisonStepRequest(m, step, v.request);
    probeSame(v, { schemaVersion: 1, stage: "B5-J5g-j20", step, claimSha256: m.input.claim.claimSha256,
      manifestSha256: m.manifestSha256, operationSha256: m.operationSha256, request,
      requestSha256: await sha256Hex(canonicalJson(request)), reservedAt: v.reservedAt }, "Historical full write-ahead intent");
    previous = at;
  }
  return sha256Hex(canonicalJson([m.input.claim, ...ARN_PROBE_COMPARISON_STEPS.map(step => input.intents[step])]));
}

async function diagnostic(input: StackScopedReadControlEvidence, journalSha256: string) {
  const d = input.diagnostic, m = input.manifest, run = input.run, inspect = input.inspect;
  await digest(d, "receiptSha256");
  probeSame(Object.keys(d).sort(), ["schemaVersion", "stage", "mode", "startedAt", "observedAt", "sourceArn", "region", "creationReviewSha256", "manifestSha256", "runReceiptSha256",
    "previousInspectReceiptSha256", "retirementProofSha256", "policies", "management", "journal", "cloudTrail", "authorizationContextObserved", "rootCauseProven", "mutationPerformed",
    "iamSimulationPerformed", "operatorSessionCreated", "probeAttemptedByDiagnostic", "newWindowOpened", "retryAuthorized", "productionCompatibilityVerified", "runtimeEnabled", "receiptSha256"].sort(), "Exact J21 diagnostic fields");
  if (d.schemaVersion !== 1 || d.stage !== "B5-J5g-j21" || d.mode !== "SOURCE_ONLY_GENERATION4_DESCRIBE_DIAGNOSTIC" || d.sourceArn !== ARN_PROBE_SOURCE || d.region !== ARN_PROBE_REGION ||
    d.creationReviewSha256 !== input.creationReview.reviewSha256 || d.manifestSha256 !== m.manifestSha256 || d.runReceiptSha256 !== run.receiptSha256 || d.previousInspectReceiptSha256 !== inspect.receiptSha256 ||
    d.retirementProofSha256 !== input.creationReview.plan.input.retirementProof.receiptSha256) throw new Error("J21 exact closed execution binding required.");
  for (const key of ["authorizationContextObserved", "rootCauseProven", "mutationPerformed", "iamSimulationPerformed", "operatorSessionCreated", "probeAttemptedByDiagnostic", "newWindowOpened", "retryAuthorized", "productionCompatibilityVerified", "runtimeEnabled"])
    if (d[key] !== false) throw new Error("Diagnostic cannot authorize a successor or claim compatibility.");
  const started = probeInstant(String(d.startedAt)), ended = probeInstant(String(d.observedAt));
  if (started < probeInstant(inspect.observedAt) || ended < started || ended - started > 150_000) throw new Error("Diagnostic chronology drifted.");
  const management = probeObject(d.management);
  for (const key of ["before", "after"]) {
    const value = management[key] as Inspect["management"];
    if (probeInstant(value.observedAt) < started || probeInstant(value.observedAt) > ended) throw new Error("Diagnostic management chronology drifted.");
    probeSame(normalized(value), normalized(inspect.management), "Diagnostic full Locked snapshot");
  }
  probeSame(management, { before: management.before, after: management.after, matchesPreviousLocked: true }, "Diagnostic management scope");
  const policy = JSON.parse(input.creationReview.plan.request.TemplateBody).Resources.CellOperatorBoundary.Properties.PolicyDocument;
  const p = probeObject(d.policies), locked = inspect.management.policies.find(p => p.logicalId === "CellOperatorBoundary")!;
  probeSame(p, { arn: locked.arn, retainedGrantVersion: "v6", grantDocumentSha256: await sha256Hex(canonicalJson(policy)), retainedGrantMatchesApprovedPlan: true,
    defaultVersion: "v7", lockedDocumentSha256: locked.defaultDocumentSha256, temporaryRead: policy.Statement.find((s: { Sid: string }) => s.Sid === "TemporaryAllowComparisonChangeSetRead") }, "J21 retained policy binding");
  if (locked.defaultVersionId !== "v7") throw new Error("J22 requires the closed Locked/v7 snapshot.");
  const journal = probeObject(d.journal);
  probeSame(journal, { inventory: ["claim.json", ...ARN_PROBE_COMPARISON_STEPS.map(s => `${s}-intent.json`)].sort(), beforeSha256: journalSha256, afterSha256: journalSha256, modified: false }, "Diagnostic immutable consumed journal");
  const trail = probeObject(d.cloudTrail), expectedIds = run.results.map(r => r.requestId).sort();
  if (trail.completeWindowInventory !== true || trail.bothMatched !== true || trail.bothNoIdentityAllow !== true || !Array.isArray(trail.pages) || trail.pages.length < 1 || trail.pages.length > 3 ||
    !Array.isArray(trail.matchedRecords) || trail.matchedRecords.length !== 2) throw new Error("Complete bounded two-request audit required.");
  probeSame(trail.expectedRequestIds, expectedIds, "Exact audit request IDs");
  const start = Date.parse(String(trail.startTime)), end = Date.parse(String(trail.endTime));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 30_000) throw new Error("Bounded historical audit window required.");
  for (const page of trail.pages) {
    const v = probeObject(page);
    if (!Number.isInteger(v.count) || Number(v.count) < 0 || Number(v.count) > 50 || typeof v.requestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(v.requestSha256)) throw new Error("Invalid bounded audit page.");
    probeSame(Object.keys(v).sort(), ["count", "requestSha256"], "Sanitized page fields");
  }
  const records = trail.matchedRecords.map(probeObject);
  probeSame(records.map(r => r.requestId).sort(), expectedIds, "No duplicate or foreign audit match");
  for (const event of records) {
    const result = run.results.find(r => r.requestId === event.requestId)!, at = Date.parse(String(event.eventTime));
    if (!arnProbeSafeRequestId(event.eventId) || !Number.isFinite(at) || at < start || at > end || probeInstant(result.observedAt) - at < 0 || probeInstant(result.observedAt) - at >= 3000) throw new Error("Historical audit identity/time drifted.");
    probeSame(event, { eventId: event.eventId, eventTime: event.eventTime, eventName: "DescribeChangeSet", callerArn: ARN_PROBE_OPERATOR_CALLER,
      sessionIssuerArn: `arn:aws:iam::${ARN_PROBE_ACCOUNT}:role/TechlongSandboxCellOperatorRole`, region: ARN_PROBE_REGION,
      requestId: result.requestId, requestStyle: result.requestStyle, errorCode: "AccessDenied", denialReason: "NO_IDENTITY_BASED_ALLOW_ON_EXACT_STACK",
      errorMessageSha256: "75e988f807c2c64501d8fdc0ac3695699ae79eae9d86497fc6a7f823161fd21c", stackName: { state: "NOT_REPORTED", value: null },
      changeSetName: { state: "NOT_REPORTED", value: null }, mfaAuthenticated: true, authorizationContextObserved: false }, "Sanitized actual denied audit event");
  }
  probeSame(Object.keys(trail).sort(), ["startTime", "endTime", "pages", "completeWindowInventory", "expectedRequestIds", "matchedRecords", "bothMatched", "bothNoIdentityAllow"].sort(), "Exact audit summary scope");
}

/** Accepts only a fully consumed, denied, revoked generation4 and its J21
 * diagnostic. Nothing here creates a generation, slot, window or AWS client. */
export async function closeGeneration4ForStackScopedReadControl(input: StackScopedReadControlEvidence) {
  probeSame(Object.keys(input).sort(), ["creationReview", "manifest", "run", "inspect", "diagnostic", "intents"].sort(), "Closed generation4 evidence inputs");
  const { creationReview: creation, manifest: m, run, inspect } = input;
  await assertArnProbeComparisonCreateReview(creation); await assertArnProbeComparisonWorkflow(m);
  probeSame(m.input.creationReview, creation, "Exact generation4 creation predecessor");
  await digest(run, "receiptSha256"); await digest(inspect, "receiptSha256");
  if (!run.cleanup || !run.grantObservation || !run.fixtureAfter || run.results.length !== 2 || run.sourceReadBrackets.length !== 2) throw new Error("Complete denied execution and immediate cleanup evidence required.");
  probeSame(run, { stage: "B5-J5g-j20", mode: "RUN_REVIEWED", manifestSha256: m.manifestSha256, grantAttempted: true, grantMayStart: true,
    grantObservation: run.grantObservation, sourceReadBrackets: run.sourceReadBrackets, results: run.results, cleanup: run.cleanup, fixtureAfter: run.fixtureAfter, failures: [],
    outcome: "LOCKED_READ_COMPARISON_RECORDED", mutationPerformed: null, probeDeleted: false, childExecuted: false, deleteStackPerformed: false,
    authorizationContextObserved: false, productionCompatibilityVerified: false, runtimeEnabled: false, retryAuthorized: false, observedAt: run.observedAt, receiptSha256: run.receiptSha256 }, "Closed execution scope");
  probeSame(inspect, { stage: "B5-J5g-j20", mode: "READ_ONLY_INSPECT", creationReviewSha256: creation.reviewSha256, claim: m.input.claim,
    management: inspect.management, fixture: inspect.fixture, outcome: "LOCKED_VERIFIED", mutationPerformed: false, grantReplayed: false, operatorReadReplayed: false,
    retryAuthorized: false, productionCompatibilityVerified: false, runtimeEnabled: false, observedAt: inspect.observedAt, receiptSha256: inspect.receiptSha256 }, "Independent locked closure scope");
  if (probeInstant(inspect.observedAt) < probeInstant(run.observedAt)) throw new Error("Independent Inspect must follow execution.");
  const runAt = probeInstant(run.observedAt), inspectAt = probeInstant(inspect.observedAt);
  for (const value of [inspect.management, inspect.fixture]) {
    const age = inspectAt - probeInstant(value.observedAt);
    if (age < 0 || age > 60_000) throw new Error("Independent closure observations must be fresh at the historical Inspect.");
  }
  if (await assertArnProbeComparisonManagement(creation.plan, run.grantObservation, probeInstant(run.grantObservation.observedAt))) throw new Error("Original Grant installation evidence required.");
  probeSame(run.cleanup, { outcome: "LOCKED_VERIFIED", evidence: { first: run.cleanup.evidence.first, last: run.cleanup.evidence.last } }, "Immediate cleanup scope");
  if (probeInstant(run.cleanup.evidence.first.observedAt) > probeInstant(run.cleanup.evidence.last.observedAt) ||
    probeInstant(run.cleanup.evidence.last.observedAt) > probeInstant(run.fixtureAfter.observedAt) || probeInstant(run.fixtureAfter.observedAt) > runAt) throw new Error("Historical cleanup/fixture chronology drifted.");
  for (const value of [run.cleanup.evidence.first, run.cleanup.evidence.last, inspect.management]) {
    if (!(await assertArnProbeComparisonManagement(creation.plan, value, probeInstant(value.observedAt)))) throw new Error("Full exact Locked evidence required.");
    probeSame(normalized(value), normalized(inspect.management), "Complete cleanup/Inspect snapshot stability");
  }
  probeSame(normalized(run.fixtureAfter), normalized(inspect.fixture), "Original fixture closure stability");
  probeSame(normalized(inspect.fixture), normalized(creation.sourceReview.observation.fixtureAfter), "Original zero-resource fixture preserved");
  const ids = new Set<string>();
  for (let i = 0; i < 2; i++) {
    const result = run.results[i], c = m.actions.operatorReads.cases[i], bracket = run.sourceReadBrackets[i];
    if (!result.failure || result.failure.code !== "AccessDenied" || result.failure.httpStatusCode !== 403 || result.failure.requestId !== result.requestId || !arnProbeSafeRequestId(result.requestId) || ids.has(result.requestId!)) throw new Error("Two distinct denied provider requests required.");
    ids.add(result.requestId!);
    probeSame(result.failure, { phase: "OPERATOR_READINESS", classification: "AUTHORIZATION_DENIED", code: "AccessDenied", requestId: result.requestId,
      httpStatusCode: 403, observedAt: result.observedAt, authorizationContextObserved: false, retryAuthorized: false }, "Sanitized historical denial");
    probeSame(result, { manifestSha256: m.manifestSha256, requestStyle: c.requestStyle, callerArn: ARN_PROBE_OPERATOR_CALLER, account: ARN_PROBE_ACCOUNT, region: ARN_PROBE_REGION,
      requestSha256: await sha256Hex(canonicalJson(c.request)), outcome: "READ_DENIED", providerEvidenceSha256: null, requestId: result.requestId, failure: result.failure,
      observedAt: result.observedAt, mutationPerformed: false, authorizationContextObserved: false, productionCompatibilityVerified: false, retryAuthorized: false }, "Actual denied read scope");
    const at = probeInstant(result.observedAt);
    if (at < probeInstant(m.input.reviewedAt) || at >= probeInstant(m.input.expiresAt) || bracket.requestStyle !== result.requestStyle) throw new Error("Historical approved read window drifted.");
    const step = result.requestStyle === "FULL_ARN_REQUEST" ? "read-full-arn" : "read-exact-name";
    if (probeInstant(String(input.intents[step].reservedAt)) > at || probeInstant(run.grantObservation.observedAt) > at ||
      probeInstant(bracket.before.observedAt) > at || probeInstant(bracket.after.observedAt) < at || probeInstant(bracket.after.observedAt) > probeInstant(run.cleanup.evidence.first.observedAt)) throw new Error("Historical single-submit bracket chronology drifted.");
    probeSame(bracket, { requestStyle: result.requestStyle, before: bracket.before, after: bracket.after }, "Exact read bracket fields");
    for (const value of [bracket.before, bracket.after]) probeSame(normalized(value), normalized(run.grantObservation), "Full installed Grant bracket");
  }
  const journalSha256 = await stackScopedReadControlJournal(input); await diagnostic(input, journalSha256);
  if (probeInstant(String(input.intents["grant-execute"].reservedAt)) > probeInstant(run.grantObservation.observedAt) ||
    probeInstant(String(input.intents["revoke-execute"].reservedAt)) > probeInstant(run.cleanup.evidence.first.observedAt)) throw new Error("Historical mutation intents must precede observation.");
  const body = { schemaVersion: 1, stage: "B5-J5g-j22", action: "CLOSE_GENERATION4_FOR_STACK_SCOPED_READ_CONTROL", input,
    generation: 4, creationReviewSha256: creation.reviewSha256, manifestSha256: m.manifestSha256, runReceiptSha256: run.receiptSha256,
    inspectReceiptSha256: inspect.receiptSha256, diagnosticReceiptSha256: input.diagnostic.receiptSha256, claimSha256: m.input.claim.claimSha256, journalSha256,
    oldRecordsPreserved: true, oldSlotConsumed: true, replayAllowed: false, successorReservationAllowed: false,
    authorizationContextObserved: false, rootCauseProven: false, productionCompatibilityVerified: false, runtimeEnabled: false };
  return copy({ ...body, predecessorSha256: await sha256Hex(canonicalJson(body)) });
}
export type StackScopedReadControlPredecessor = Awaited<ReturnType<typeof closeGeneration4ForStackScopedReadControl>>;
export async function assertStackScopedReadControlPredecessor(value: StackScopedReadControlPredecessor) {
  probeSame(value, await closeGeneration4ForStackScopedReadControl(value.input), "Closed generation4 predecessor");
}
export async function stackScopedReadControlFence(predecessor: StackScopedReadControlPredecessor) {
  await assertStackScopedReadControlPredecessor(predecessor);
  const old = predecessor.input.creationReview.fence;
  return copy({ stage: "B5-J5g-j22", generation: 5, priorGeneration: 4, targetFenceKey: old.targetFenceKey,
    predecessorSha256: predecessor.predecessorSha256, priorClaimSha256: predecessor.claimSha256, priorJournalSha256: predecessor.journalSha256,
    priorSlotRelativePath: old.slotRelativePath, slotRelativePath: `.aws-sandbox/j5gj22-stack-scoped-read-control/${old.targetFenceKey}/slot-000005`,
    physicalSlotCreated: false, persistenceImplemented: false, replayAllowed: false, reservationAuthorized: false });
}

/** Pure undeployed candidate compiler; explicit times only, no Date.now or
 * live defaults. Not an old generation4 plan and not an execution manifest. */
export async function compileStackScopedReadControl(input: { predecessor: StackScopedReadControlPredecessor; reviewedAt: string; expiresAt: string }) {
  probeSame(Object.keys(input).sort(), ["predecessor", "reviewedAt", "expiresAt"].sort(), "Stack-scoped read candidate input");
  await assertStackScopedReadControlPredecessor(input.predecessor);
  const p = input.predecessor, old = p.input.creationReview, start = probeInstant(input.reviewedAt), end = probeInstant(input.expiresAt);
  if (start < probeInstant(String(p.input.diagnostic.observedAt)) || start < probeInstant(old.plan.input.comparisonPlan.input.expiresAt) || end - start !== 1_800_000) throw new Error("New explicit 30-minute candidate must follow the expired closed predecessor.");
  const fence = await stackScopedReadControlFence(p), prior = old.plan.input.comparisonPlan.input.priorPlan;
  const operationSha256 = await sha256Hex(canonicalJson({ predecessorSha256: p.predecessorSha256, reviewedAt: input.reviewedAt, expiresAt: input.expiresAt,
    generation: 5, scope: "EXACT_STACK_RESOURCE_ONLY_NO_CHANGESET_NAME_CONDITION" }));
  const template = JSON.parse(old.plan.revokeTarget.templateBody), baselineResources = canonicalJson(template.Resources);
  const statement = { Sid: "TemporaryAllowStackScopedControlDescribeChangeSet", Effect: "Allow", Action: "cloudformation:DescribeChangeSet",
    Resource: prior.input.fixtureStackId, Condition: { StringEquals: { "aws:RequestedRegion": ARN_PROBE_REGION },
      DateGreaterThanEquals: { "aws:CurrentTime": input.reviewedAt }, DateLessThan: { "aws:CurrentTime": input.expiresAt } } };
  const beforePolicy = template.Resources.CellOperatorBoundary.Properties.PolicyDocument;
  template.Resources.CellOperatorBoundary.Properties.PolicyDocument = { ...beforePolicy, Statement: [...beforePolicy.Statement, statement] };
  const expected = JSON.parse(baselineResources);
  expected.CellOperatorBoundary.Properties.PolicyDocument = template.Resources.CellOperatorBoundary.Properties.PolicyDocument;
  probeSame(template.Resources, expected, "Only one additional exact Stack Describe Allow");
  Object.assign(template.Metadata.SafetyBoundary, { OperatorGrantState: "ARNPROBESTACKSCOPEDREADCONTROLCANDIDATE", StackScopedReadControlOnly: true,
    ReadControlGeneration: 5, ReadControlOperationSha256: operationSha256, ReadControlPredecessorSha256: p.predecessorSha256,
    ReadControlChangeSetNameConditionOmittedForDescribeOnly: true, ReadControlApprovedWriteActions: [], CloudApplyEnabled: false, TemporaryGrantApplyEnabled: false });
  template.Description = "J5g-j22 undeployed exact Stack DescribeChangeSet control; no execution or installation approval.";
  template.Outputs.SafetyState.Value = "STACK_SCOPED_READ_CONTROL_UNDEPLOYED_NO_APPROVAL";
  const proposedTemplateBody = `${JSON.stringify(template)}\n`;
  if (Buffer.byteLength(proposedTemplateBody, "utf8") > 51_200 || JSON.stringify(template.Resources.CellOperatorBoundary.Properties.PolicyDocument).replace(/\s/g, "").length > 6_144) throw new Error("Stack-scoped candidate exceeds AWS size bounds.");
  const proposedReadMatrix = (["FULL_ARN_REQUEST", "EXACT_NAME_REQUEST"] as const).map(requestStyle => ({ requestStyle, action: "cloudformation:DescribeChangeSet", maxSubmissions: 1,
    request: { StackName: prior.input.fixtureStackId, ChangeSetName: requestStyle === "FULL_ARN_REQUEST" ? prior.input.fixtureChangeSetArn : prior.input.fixturePlan.request.ChangeSetName },
    requiredResponseIdentity: { StackId: prior.input.fixtureStackId, ChangeSetId: prior.input.fixtureChangeSetArn, ChangeSetName: prior.input.fixturePlan.request.ChangeSetName } }));
  const body = { schemaVersion: 1, stage: "B5-J5g-j22", action: "PREPARE_UNDEPLOYED_STACK_SCOPED_READ_CONTROL", input, fence, operationSha256,
    scope: "EXACT_STACK_RESOURCE_ONLY_NO_CHANGESET_NAME_CONDITION", proposedStatement: statement, proposedTemplateBody,
    templateRawSha256: await sha256Hex(proposedTemplateBody), templateCanonicalSha256: await sha256Hex(canonicalJson(template)),
    operatorPolicySha256: await sha256Hex(canonicalJson(template.Resources.CellOperatorBoundary.Properties.PolicyDocument)), proposedReadMatrix,
    proposedCandidatePolicyDurationMs: 1_800_000, maximumFutureApprovalDurationMs: 300_000, minimumFutureRevokeMarginMs: 600_000,
    revokeTarget: old.plan.revokeTarget, managementSnapshot: p.input.inspect.management, fixtureSnapshot: p.input.inspect.fixture,
    futureControlsRequired: { freshSourceBeforeAfter: true, completeSingletonFixtureInventory: true, exactKnownTerminalManagementInventory: true, separatelyApprovedCreationAndInstallation: true,
      fixedMfaOperator: true, writeAheadPermanentIntents: true, immediateSourceRevoke: true, independentLockedInspect: true, noAuthorizationRetry: true },
    allowedWriteActions: [], deletionAuthorized: false, creationAuthorized: false, installationAuthorized: false, operatorReadAuthorized: false,
    childExecutionAllowed: false, deleteStackAllowed: false, productionCompatibilityVerified: false, rootCauseProven: false,
    candidateWindowIsProposalOnly: true, persistenceImplemented: false, executionImplemented: false, runtimeEnabled: false };
  return copy({ ...body, planSha256: await sha256Hex(canonicalJson(body)) });
}
export type StackScopedReadControlPlan = Awaited<ReturnType<typeof compileStackScopedReadControl>>;
export async function assertStackScopedReadControlPlan(value: StackScopedReadControlPlan) {
  probeSame(value, await compileStackScopedReadControl(value.input), "Undeployed Stack-scoped control candidate");
}

/** Actual preparation CLI uses only this timeless report. No candidate or
 * approved request is compiled, and no successor reservation is performed. */
export async function checkStackScopedReadControlPreparation(predecessor: StackScopedReadControlPredecessor) {
  const fence = await stackScopedReadControlFence(predecessor);
  const body = { schemaVersion: 1, stage: "B5-J5g-j22", mode: "CHECK_LOCAL_PREPARATION", predecessorSha256: predecessor.predecessorSha256, fence,
    outcome: "CLOSED_GENERATION4_STACK_SCOPED_PREPARATION_VERIFIED", mutationPerformed: false, candidateCompiled: false, approvalWindowOpened: false,
    manifestCreated: false, registryCreated: false, reservationAuthorized: false, executionImplemented: false, operatorSessionCreated: false,
    allowedWriteActions: [], productionCompatibilityVerified: false, runtimeEnabled: false };
  return copy({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
