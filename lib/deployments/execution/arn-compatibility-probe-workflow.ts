import { canonicalJson, sha256Hex } from "./hash.ts";
import { ARN_PROBE_ACCOUNT, ARN_PROBE_REGION, ARN_PROBE_SOURCE, type ArnProbeFixtureState } from "./arn-compatibility-probe-fixture.ts";
import { assertArnProbeGrantPlan, type ArnProbeGrantPlan, type ArnProbeGrantChangeSetState } from "./arn-compatibility-probe-grant.ts";
import type { ArnProbeManagementObservation } from "./aws-sdk-shared-cell-author-compensation-management.ts";
import { arnProbeSafeRequestId, sanitizeArnProbeFailure, type ArnProbeFailure, type ArnProbeFailurePhase } from "./arn-compatibility-probe-diagnostics.ts";

export const ARN_PROBE_OPERATOR_ROLE = `arn:aws:iam::${ARN_PROBE_ACCOUNT}:role/TechlongSandboxCellOperatorRole`;
export const ARN_PROBE_OPERATOR_SESSION = "techlong-sandbox-cell-operator";
export const ARN_PROBE_OPERATOR_CALLER = `arn:aws:sts::${ARN_PROBE_ACCOUNT}:assumed-role/TechlongSandboxCellOperatorRole/${ARN_PROBE_OPERATOR_SESSION}`;
export const ARN_PROBE_MFA = `arn:aws:iam::${ARN_PROBE_ACCOUNT}:mfa/techlong-sandbox-dev`;
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export function probeSame(actual: unknown, expected: unknown, label: string) {
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`${label} drifted.`);
}
export function probeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Probe workflow evidence is incomplete.");
  return value as Record<string, unknown>;
}
export function probeInstant(value: string) {
  const time = Date.parse(value);
  if (!Number.isSafeInteger(time) || new Date(time).toISOString() !== value) throw new Error("Probe workflow time is not canonical UTC.");
  return time;
}
function immutable<T>(value: T): Readonly<T> {
  const copy = JSON.parse(canonicalJson(value)) as T;
  function visit(item: unknown) { if (item && typeof item === "object") { Object.values(item).forEach(visit); Object.freeze(item); } }
  visit(copy); return copy;
}
function fresh(value: { observedAt: string }, now: number) {
  const age = now - probeInstant(value.observedAt);
  if (age < 0 || age > 60_000) throw new Error("Probe workflow observation is stale.");
}
function management(plan: ArnProbeGrantPlan, observation: ArnProbeManagementObservation, now: number) {
  fresh(observation, now);
  const locked = observation.rendererShape === "Locked";
  if (observation.accountId !== ARN_PROBE_ACCOUNT || observation.region !== ARN_PROBE_REGION || observation.callerArn !== ARN_PROBE_SOURCE ||
      observation.stack.id !== plan.managementStackId || observation.cellStackState !== "MISSING" || observation.authorityState !== "ABSENT" ||
      !["Locked", "ArnProbeDeleteChangeSetGrant"].includes(observation.rendererShape) ||
      observation.stack.templateRawSha256 !== (locked ? plan.revokeTarget.templateRawSha256 : plan.grantTemplateRawSha256) ||
      observation.stack.templateCanonicalSha256 !== (locked ? plan.revokeTarget.templateCanonicalSha256 : plan.grantTemplateCanonicalSha256)) throw new Error("Probe workflow requires exact Source/IAM/Cell/authority evidence.");
  return locked;
}
function fixture(plan: ArnProbeGrantPlan, value: ArnProbeFixtureState, now: number) {
  fresh(value, now);
  if (value.state !== "READY_UNEXECUTED" || value.stackId !== plan.input.fixtureStackId || value.changeSetArn !== plan.input.fixtureChangeSetArn ||
      value.resourceCount !== 0 || value.templateCanonicalSha256 !== plan.input.fixturePlan.templateCanonicalSha256) throw new Error("Exact unexecuted zero-resource probe is required.");
}
export type ProbeAfterState = Readonly<{ state: "READY_UNEXECUTED" | "CHANGE_SET_ABSENT"; stackId: string; changeSetArn: string;
  stackState: "REVIEW_IN_PROGRESS" | "MISSING"; resourceCount: 0; providerEvidenceSha256: string; observedAt: string }>;
export type ProbeRevokeState = Readonly<{ state: "MISSING" | "CREATING" | "EXECUTING" | "FAILED"; observedAt: string } |
  { state: "READY_UNEXECUTED"; stackId: string; changeSetArn: string; providerEvidenceSha256: string; observedAt: string }>;
export interface ArnProbeWorkflowReads {
  readManagement(plan: ArnProbeGrantPlan, signal: AbortSignal): Promise<Readonly<ArnProbeManagementObservation>>;
  waitManagement(plan: ArnProbeGrantPlan, signal: AbortSignal): Promise<Readonly<ArnProbeManagementObservation>>;
  waitGrantSettlement(manifest: ArnProbeWorkflowManifest, signal: AbortSignal): Promise<Readonly<ArnProbeManagementObservation>>;
  readFixture(plan: ArnProbeGrantPlan, signal: AbortSignal): Promise<ArnProbeFixtureState>;
  readGrant(plan: ArnProbeGrantPlan, signal: AbortSignal): Promise<ArnProbeGrantChangeSetState>;
  readProbeAfter(plan: ArnProbeGrantPlan, signal: AbortSignal): Promise<ProbeAfterState>;
  readRevoke(manifest: ArnProbeWorkflowManifest, signal: AbortSignal): Promise<ProbeRevokeState>;
  waitRevoke(manifest: ArnProbeWorkflowManifest, signal: AbortSignal): Promise<ProbeRevokeState>;
}

/** Separate approval scope from J10's creation-only plan. Never authorizes child Execute or DeleteStack. */
export async function compileArnProbeWorkflowManifest(input: { plan: ArnProbeGrantPlan; grantChangeSetArn: string; reviewedAt: string; expiresAt: string }) {
  probeSame(Object.keys(input).sort(), ["expiresAt", "grantChangeSetArn", "plan", "reviewedAt"], "Workflow input");
  const { plan } = input; await assertArnProbeGrantPlan(plan);
  if (!new RegExp(`^arn:aws:cloudformation:${ARN_PROBE_REGION}:${ARN_PROBE_ACCOUNT}:changeSet/${plan.request.ChangeSetName}/${uuid}$`).test(input.grantChangeSetArn)) throw new Error("Workflow requires a provider-issued exact Grant Change Set ARN.");
  const start = probeInstant(input.reviewedAt), end = probeInstant(input.expiresAt);
  if (start < probeInstant(plan.input.reviewedAt) || end <= start || end - start > 300_000 || end > probeInstant(plan.deleteCutoff) - 300_000) throw new Error("Workflow approval needs a five-minute review window and cleanup margin.");
  const operationSha256 = await sha256Hex(canonicalJson({ ...input, plan: plan.planSha256 }));
  const grantRequest = { StackName: plan.managementStackId, ChangeSetName: input.grantChangeSetArn,
    ClientRequestToken: `j5gj11-grant-execute-${operationSha256}`, DisableRollback: false };
  const revokeRequest = { ...plan.request, ChangeSetName: `techlong-j5gj11-probe-revoke-${operationSha256.slice(0, 16)}`,
    ClientToken: `j5gj11-revoke-create-${operationSha256}`, Description: `J5g-j11 exact Locked revoke ${operationSha256}`,
    TemplateBody: plan.revokeTarget.templateBody };
  const actions = {
    grantExecute: { operationSha256, callerArn: ARN_PROBE_SOURCE, request: grantRequest, templateRawSha256: plan.grantTemplateRawSha256, expiresAt: input.expiresAt },
    probeDelete: { operationSha256, callerArn: ARN_PROBE_OPERATOR_CALLER, roleArn: ARN_PROBE_OPERATOR_ROLE, mfaDeviceArn: ARN_PROBE_MFA,
      request: plan.futureProbeRequest, expiresAt: input.expiresAt, singleSubmit: true },
    revoke: { operationSha256, callerArn: ARN_PROBE_SOURCE, createRequest: revokeRequest, templateRawSha256: plan.revokeTarget.templateRawSha256,
      templateCanonicalSha256: plan.revokeTarget.templateCanonicalSha256, executeDiscoveredFullArnOnly: true, disableRollback: false,
      executeClientToken: `j5gj11-revoke-execute-${operationSha256}`, recoveryAfterExpiryAllowed: true },
  };
  const actionSha256 = { grantExecute: await sha256Hex(canonicalJson(actions.grantExecute)), probeDelete: await sha256Hex(canonicalJson(actions.probeDelete)), revoke: await sha256Hex(canonicalJson(actions.revoke)) };
  const body = { schemaVersion: 1 as const, stage: "B5-J5g-j11" as const, input, operationSha256, actions, actionSha256,
    childExecutionAllowed: false as const, deleteStackAllowed: false as const, runtimeEnabled: false as const,
    productionCompatibilityVerified: false as const, readinessGates: [false, false, false, false] };
  return immutable({ ...body, manifestSha256: await sha256Hex(canonicalJson(body)) });
}
export type ArnProbeWorkflowManifest = Awaited<ReturnType<typeof compileArnProbeWorkflowManifest>>;
export async function assertArnProbeWorkflowManifest(manifest: ArnProbeWorkflowManifest) { probeSame(manifest, await compileArnProbeWorkflowManifest(manifest.input), "Workflow manifest"); }
export type ArnProbeOperatorReadiness = Readonly<{ schemaVersion: 1; manifestSha256: string; callerArn: string; account: string; region: string;
  stackId: string; changeSetArn: string; outcome: "READ_READY" | "READ_NOT_READY"; attempts: number; consecutiveSuccessfulReads: number;
  evidenceSha256: string | null; operatorIdentityVerified: boolean;
  failures: readonly (ArnProbeFailure & { readOperation: "GetCallerIdentity" | "DescribeStacks" | "ListStackResources" | "GetTemplate" | "DescribeChangeSet"; attempt: number })[]; observedAt: string;
  deleteAuthorizationVerified: false; productionCompatibilityVerified: false; mutationPerformed: false; retryAuthorized: false }>;
export interface ArnProbeOperatorReadPort {
  checkReadiness(manifest: ArnProbeWorkflowManifest, signal: AbortSignal): Promise<ArnProbeOperatorReadiness>;
}
function readinessObservation(manifest: ArnProbeWorkflowManifest, value: ArnProbeOperatorReadiness, now: number): ArnProbeOperatorReadiness {
  fresh(value, now);
  if (value.schemaVersion !== 1 || value.manifestSha256 !== manifest.manifestSha256 || value.callerArn !== ARN_PROBE_OPERATOR_CALLER ||
      value.account !== ARN_PROBE_ACCOUNT || value.region !== ARN_PROBE_REGION || value.stackId !== manifest.input.plan.input.fixtureStackId ||
      value.changeSetArn !== manifest.input.plan.input.fixtureChangeSetArn || !["READ_READY", "READ_NOT_READY"].includes(value.outcome) ||
      !Number.isInteger(value.attempts) || value.attempts < 1 || value.attempts > 3 || !Number.isInteger(value.consecutiveSuccessfulReads) ||
      value.consecutiveSuccessfulReads < 0 || value.consecutiveSuccessfulReads > 2 || value.consecutiveSuccessfulReads > value.attempts || typeof value.operatorIdentityVerified !== "boolean" ||
      (value.evidenceSha256 !== null && (typeof value.evidenceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.evidenceSha256))) ||
      (value.outcome === "READ_NOT_READY" && (value.evidenceSha256 !== null || value.consecutiveSuccessfulReads === 2)) || !Array.isArray(value.failures) || value.failures.length > 3 ||
      value.deleteAuthorizationVerified !== false || value.productionCompatibilityVerified !== false || value.mutationPerformed !== false || value.retryAuthorized !== false) throw new Error("Operator readiness scope drifted.");
  const failures = value.failures.map((item) => {
    if (item.phase !== "OPERATOR_READINESS" || !["GetCallerIdentity", "DescribeStacks", "ListStackResources", "GetTemplate", "DescribeChangeSet"].includes(item.readOperation) ||
        !Number.isInteger(item.attempt) || item.attempt < 1 || item.attempt > value.attempts || item.authorizationContextObserved !== false || item.retryAuthorized !== false) throw new Error("Operator diagnostic scope drifted.");
    fresh(item, now);
    const safe = sanitizeArnProbeFailure({ name: item.code, $metadata: { requestId: item.requestId, httpStatusCode: item.httpStatusCode } }, "OPERATOR_READINESS", () => probeInstant(item.observedAt));
    if (safe.classification !== item.classification || safe.code !== item.code || safe.requestId !== item.requestId || safe.httpStatusCode !== item.httpStatusCode) throw new Error("Operator diagnostic is not allowlisted.");
    return { ...safe, readOperation: item.readOperation, attempt: item.attempt };
  });
  // Select explicit fields, including for failed readiness. Never copy arbitrary
  // port/provider fields (messages, credentials, error objects) into receipts.
  return immutable({ schemaVersion: 1, manifestSha256: manifest.manifestSha256, callerArn: ARN_PROBE_OPERATOR_CALLER, account: ARN_PROBE_ACCOUNT,
    region: ARN_PROBE_REGION, stackId: manifest.input.plan.input.fixtureStackId, changeSetArn: manifest.input.plan.input.fixtureChangeSetArn,
    outcome: value.outcome, attempts: value.attempts, consecutiveSuccessfulReads: value.consecutiveSuccessfulReads,
    evidenceSha256: value.evidenceSha256, operatorIdentityVerified: value.operatorIdentityVerified, failures, observedAt: value.observedAt,
    deleteAuthorizationVerified: false, productionCompatibilityVerified: false, mutationPerformed: false, retryAuthorized: false });
}
function operatorReady(manifest: ArnProbeWorkflowManifest, value: ArnProbeOperatorReadiness, now: number) {
  fresh(value, now);
  if (value.schemaVersion !== 1 || value.manifestSha256 !== manifest.manifestSha256 || value.callerArn !== ARN_PROBE_OPERATOR_CALLER ||
      value.account !== ARN_PROBE_ACCOUNT || value.region !== ARN_PROBE_REGION || value.stackId !== manifest.input.plan.input.fixtureStackId ||
      value.changeSetArn !== manifest.input.plan.input.fixtureChangeSetArn || value.outcome !== "READ_READY" ||
      !Number.isInteger(value.attempts) || value.attempts < 2 || value.attempts > 3 || value.consecutiveSuccessfulReads !== 2 ||
      value.failures.some((item) => item.attempt > value.attempts - 2) ||
      value.operatorIdentityVerified !== true || typeof value.evidenceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.evidenceSha256) || value.deleteAuthorizationVerified !== false ||
      value.productionCompatibilityVerified !== false || value.mutationPerformed !== false || value.retryAuthorized !== false) throw new Error("Fixed Operator real-read readiness is not proved; do not delete.");
}
function live(manifest: ArnProbeWorkflowManifest, now: number) {
  if (now < probeInstant(manifest.input.reviewedAt) || now >= probeInstant(manifest.input.expiresAt)) throw new Error("Workflow approval expired; only explicitly approved revoke-only recovery is available.");
}
async function preflight(plan: ArnProbeGrantPlan, reads: ArnProbeWorkflowReads, signal: AbortSignal, now: () => number) {
  const before = await reads.readManagement(plan, signal);
  if (!management(plan, before, now())) throw new Error("Grant execution review requires exact Locked.");
  const probe = await reads.readFixture(plan, signal); fixture(plan, probe, now());
  const grant = await reads.readGrant(plan, signal); fresh(grant, now());
  const after = await reads.readManagement(plan, signal);
  if (!management(plan, after, now())) throw new Error("Management changed during review.");
  probeSame(before.stack, after.stack, "Management across review");
  fresh(probe, now()); signal.throwIfAborted();
  return { management: after, fixture: probe, grant };
}
export async function reviewArnProbeWorkflow(plan: ArnProbeGrantPlan, reads: ArnProbeWorkflowReads, signal: AbortSignal, now = Date.now) {
  await assertArnProbeGrantPlan(plan);
  const observation = await preflight(plan, reads, signal, now);
  let manifest: ArnProbeWorkflowManifest | null = null;
  if (observation.grant.state === "READY_UNEXECUTED") {
    if (observation.grant.stackId !== plan.managementStackId || observation.grant.templateCanonicalSha256 !== plan.grantTemplateCanonicalSha256 || !/^[a-f0-9]{64}$/.test(observation.grant.providerEvidenceSha256)) throw new Error("Grant review proof drifted.");
    const start = now();
    manifest = await compileArnProbeWorkflowManifest({ plan, grantChangeSetArn: observation.grant.changeSetArn,
      reviewedAt: new Date(start).toISOString(), expiresAt: new Date(Math.min(start + 300_000, probeInstant(plan.deleteCutoff) - 300_000)).toISOString() });
  } else if (observation.grant.proof !== "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY") throw new Error("Grant absence proof is incomplete.");
  const body = { stage: "B5-J5g-j11" as const, outcome: manifest ? "EXECUTION_REVIEW_READY" : "PREPARE_GRANT_REQUIRED", observation, manifest,
    executionReady: manifest !== null, mutationPerformed: false, productionCompatibilityVerified: false };
  return immutable({ ...body, reviewSha256: await sha256Hex(canonicalJson(body)) });
}
export type ProbeStep = "run" | "grant-execute" | "probe-delete" | "revoke-create" | "revoke-execute";
export interface ArnProbeWorkflowJournal {
  load(step: ProbeStep): Promise<Readonly<Record<string, unknown>> | null>;
  reserve(step: ProbeStep, intent: Readonly<Record<string, unknown>>): Promise<void>;
}
export interface ArnProbeWorkflowWrites {
  prepareOperator(signal: AbortSignal): Promise<{ callerArn: string; account: string; expiresAt: string }>;
  executeGrant(request: ArnProbeWorkflowManifest["actions"]["grantExecute"]["request"], signal: AbortSignal): Promise<unknown>;
  deleteProbe(request: ArnProbeGrantPlan["futureProbeRequest"], signal: AbortSignal): Promise<unknown>;
  createRevoke(request: ArnProbeWorkflowManifest["actions"]["revoke"]["createRequest"], signal: AbortSignal): Promise<unknown>;
  executeRevoke(request: { StackName: string; ChangeSetName: string; ClientRequestToken: string; DisableRollback: false }, signal: AbortSignal): Promise<unknown>;
}
export interface ArnProbeWorkflowApproval {
  approvedManifestSha256: string; approvedGrantExecuteSha256: string; approvedProbeDeleteSha256: string; approvedRevokeSha256: string;
  acknowledgeAwsWrite: boolean; acknowledgeLowCostNotZero: boolean; executionPhrase: string;
}
function approve(manifest: ArnProbeWorkflowManifest, approval: ArnProbeWorkflowApproval, revokeOnly = false) {
  if (approval.approvedManifestSha256 !== manifest.manifestSha256 || approval.approvedRevokeSha256 !== manifest.actionSha256.revoke ||
      (!revokeOnly && (approval.approvedGrantExecuteSha256 !== manifest.actionSha256.grantExecute || approval.approvedProbeDeleteSha256 !== manifest.actionSha256.probeDelete)) ||
      approval.acknowledgeAwsWrite !== true || approval.acknowledgeLowCostNotZero !== true ||
      approval.executionPhrase !== (revokeOnly ? "I_CONFIRM_J5GJ11_REVOKE_ONLY" : "I_CONFIRM_J5GJ11_GRANT_EXACT_PROBE_AND_IMMEDIATE_REVOKE")) throw new Error("Exact separate Grant, Probe and Revoke approvals are required.");
}
async function intent(manifest: ArnProbeWorkflowManifest, journal: ArnProbeWorkflowJournal, step: ProbeStep, request: unknown, now: () => number) {
  await journal.reserve(step, immutable({ stage: "B5-J5g-j11", step, operationSha256: manifest.operationSha256,
    manifestSha256: manifest.manifestSha256, requestSha256: await sha256Hex(canonicalJson(request)), reservedAt: new Date(now()).toISOString() }));
}
async function loaded(manifest: ArnProbeWorkflowManifest, journal: ArnProbeWorkflowJournal, step: ProbeStep, request: unknown) {
  const value = await journal.load(step);
  if (value && (value.stage !== "B5-J5g-j11" || value.step !== step || value.operationSha256 !== manifest.operationSha256 || value.manifestSha256 !== manifest.manifestSha256 || value.requestSha256 !== await sha256Hex(canonicalJson(request)))) throw new Error("Journal scope drifted; manual reconciliation required.");
  return value;
}
function requestId(response: unknown) {
  const id = arnProbeSafeRequestId(probeObject(probeObject(response).$metadata).requestId);
  if (!id) throw new Error("Provider request identity is missing.");
  return id;
}
async function verifyLocked(manifest: ArnProbeWorkflowManifest, reads: ArnProbeWorkflowReads, signal: AbortSignal, now: () => number) {
  const plan = manifest.input.plan, first = await reads.waitManagement(plan, signal);
  if (!management(plan, first, now())) throw new Error("Exact Locked restoration is not proved.");
  const last = await reads.readManagement(plan, signal);
  if (!management(plan, last, now())) throw new Error("Locked restoration was not stable.");
  probeSame(first.stack, last.stack, "Locked stack stability"); probeSame(first.policies, last.policies, "Locked IAM policy stability");
  probeSame(first.roles, last.roles, "Locked IAM role stability");
  return { first, last };
}
async function revoke(manifest: ArnProbeWorkflowManifest, reads: ArnProbeWorkflowReads, writes: Pick<ArnProbeWorkflowWrites, "createRevoke" | "executeRevoke">,
  journal: ArnProbeWorkflowJournal, now: () => number, failure: (error: unknown, phase: ArnProbeFailurePhase) => void) {
  // Never use the caller's cancelled/expired signal for mandatory cleanup.
  const signal = AbortSignal.timeout(240_000), plan = manifest.input.plan;
  const createRequest = manifest.actions.revoke.createRequest;
  const createIntent = await loaded(manifest, journal, "revoke-create", createRequest);
  const grantIntent = await loaded(manifest, journal, "grant-execute", manifest.actions.grantExecute.request);
  // A stale Locked read immediately after Execute is not proof that Grant will
  // never start. Reconcile its terminal provider state before skipping cleanup.
  const current = grantIntent && !createIntent ? await reads.waitGrantSettlement(manifest, signal) : await reads.waitManagement(plan, signal);
  if (management(plan, current, now())) return { outcome: "LOCKED_VERIFIED" as const, evidence: await verifyLocked(manifest, reads, signal, now) };
  let prepared = await reads.waitRevoke(manifest, signal);
  if (prepared.state === "MISSING") {
    if (createIntent) throw new Error("Revoke Create intent exists but no exact Change Set was found; never replay.");
    await intent(manifest, journal, "revoke-create", createRequest, now);
    try {
      const reply = probeObject(await writes.createRevoke(createRequest, AbortSignal.timeout(30_000)));
      if (reply.StackId !== plan.managementStackId || typeof reply.Id !== "string" || !new RegExp(`^arn:aws:cloudformation:${ARN_PROBE_REGION}:${ARN_PROBE_ACCOUNT}:changeSet/${createRequest.ChangeSetName}/${uuid}$`).test(reply.Id)) throw new Error("Revoke creation identity drifted.");
      requestId(reply);
    } catch (error) { failure(error, "REVOKE_CREATE"); /* reconcile only; no mutation retry */ }
    prepared = await reads.waitRevoke(manifest, signal);
  } else if (!createIntent) throw new Error("Existing revoke lacks its durable scope-bound intent.");
  if (prepared.state !== "READY_UNEXECUTED" || prepared.stackId !== plan.managementStackId ||
      !new RegExp(`^arn:aws:cloudformation:${ARN_PROBE_REGION}:${ARN_PROBE_ACCOUNT}:changeSet/${createRequest.ChangeSetName}/${uuid}$`).test(prepared.changeSetArn) || !/^[a-f0-9]{64}$/.test(prepared.providerEvidenceSha256)) throw new Error("Exact prepared Locked revoke is not executable.");
  fresh(prepared, now());
  const request = { StackName: plan.managementStackId, ChangeSetName: prepared.changeSetArn, ClientRequestToken: manifest.actions.revoke.executeClientToken, DisableRollback: false as const };
  if (!(await loaded(manifest, journal, "revoke-execute", request))) {
    const before = await reads.readManagement(plan, signal);
    if (management(plan, before, now())) return { outcome: "LOCKED_VERIFIED" as const, evidence: await verifyLocked(manifest, reads, signal, now) };
    await intent(manifest, journal, "revoke-execute", request, now);
    try { requestId(await writes.executeRevoke(request, AbortSignal.timeout(30_000))); } catch (error) { failure(error, "REVOKE_EXECUTE"); /* never replay an uncertain Execute */ }
  }
  return { outcome: "LOCKED_VERIFIED" as const, evidence: await verifyLocked(manifest, reads, signal, now) };
}
export async function recoverArnProbeWorkflowRevoke(input: { manifest: ArnProbeWorkflowManifest; approval: ArnProbeWorkflowApproval; reads: ArnProbeWorkflowReads;
  writes: Pick<ArnProbeWorkflowWrites, "createRevoke" | "executeRevoke">; journal: ArnProbeWorkflowJournal; now?: () => number }) {
  await assertArnProbeWorkflowManifest(input.manifest); approve(input.manifest, input.approval, true);
  // Expired review may restore only the exact Locked target, never Grant or Probe.
  let cleanup: Awaited<ReturnType<typeof revoke>> | null = null;
  const now = input.now ?? Date.now, failures: ArnProbeFailure[] = [];
  const failure = (error: unknown, phase: ArnProbeFailurePhase) => { failures.push(sanitizeArnProbeFailure(error, phase, now)); };
  try { cleanup = await revoke(input.manifest, input.reads, input.writes, input.journal, now, failure); } catch (error) { failure(error, "REVOKE_VERIFY"); }
  const body = { stage: "B5-J5g-j11", mode: "REVOKE_ONLY_RECOVERY", manifestSha256: input.manifest.manifestSha256,
    outcome: cleanup ? "LOCKED_VERIFIED" : "REVOKE_REQUIRED", cleanup, diagnosticsVersion: 1, failures, grantReplayed: false, probeReplayed: false, retryAuthorized: false,
    productionCompatibilityVerified: false, observedAt: new Date((input.now ?? Date.now)()).toISOString() };
  return immutable({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
export async function runArnProbeWorkflow(input: { manifest: ArnProbeWorkflowManifest; approval: ArnProbeWorkflowApproval; reads: ArnProbeWorkflowReads;
  writes: ArnProbeWorkflowWrites; operatorReads: ArnProbeOperatorReadPort; journal: ArnProbeWorkflowJournal; signal: AbortSignal; now?: () => number }) {
  const { manifest, reads, writes, journal } = input, plan = manifest.input.plan, now = input.now ?? Date.now;
  await assertArnProbeWorkflowManifest(manifest); approve(manifest, input.approval); live(manifest, now()); input.signal.throwIfAborted();
  if (typeof input.operatorReads?.checkReadiness !== "function") throw new Error("A separate real Operator read port is required before Grant.");
  const observation = await preflight(plan, reads, input.signal, now);
  if (observation.grant.state !== "READY_UNEXECUTED" || observation.grant.changeSetArn !== manifest.input.grantChangeSetArn || observation.grant.templateCanonicalSha256 !== plan.grantTemplateCanonicalSha256 || !/^[a-f0-9]{64}$/.test(observation.grant.providerEvidenceSha256)) throw new Error("Approved full Grant ARN is not ready.");
  const operator = await writes.prepareOperator(input.signal);
  if (operator.callerArn !== ARN_PROBE_OPERATOR_CALLER || operator.account !== ARN_PROBE_ACCOUNT || probeInstant(operator.expiresAt) - now() < 600_000) throw new Error("Fresh fixed MFA Operator identity is required before installing Grant.");
  // Human MFA entry can take minutes. Never install Grant using the Source
  // observations collected before that interactive pause.
  const refreshed = await preflight(plan, reads, input.signal, now);
  if (refreshed.grant.state !== "READY_UNEXECUTED" || refreshed.grant.changeSetArn !== manifest.input.grantChangeSetArn ||
      refreshed.grant.templateCanonicalSha256 !== plan.grantTemplateCanonicalSha256 || !/^[a-f0-9]{64}$/.test(refreshed.grant.providerEvidenceSha256)) throw new Error("Grant changed during Operator MFA preparation.");
  live(manifest, now()); input.signal.throwIfAborted();
  await intent(manifest, journal, "run", manifest.actions, now);
  let grantAttempted = false, grantRequestId: string | null = null, probeRequestId: string | null = null;
  let cleanup: Awaited<ReturnType<typeof revoke>> | null = null, post: ProbeAfterState | null = null;
  let readiness: ArnProbeOperatorReadiness | null = null, probeAttempted = false, phase: ArnProbeFailurePhase = "GRANT_EXECUTE";
  const failures: ArnProbeFailure[] = [], failure = (error: unknown, step: ArnProbeFailurePhase) => { failures.push(sanitizeArnProbeFailure(error, step, now)); };
  try {
    await intent(manifest, journal, "grant-execute", manifest.actions.grantExecute.request, now);
    live(manifest, now()); input.signal.throwIfAborted();
    grantAttempted = true;
    try { grantRequestId = requestId(await writes.executeGrant(manifest.actions.grantExecute.request, AbortSignal.timeout(30_000))); } catch (error) { failure(error, "GRANT_EXECUTE"); }
    phase = "GRANT_SETTLEMENT";
    const granted = await reads.waitGrantSettlement(manifest, AbortSignal.timeout(120_000));
    if (management(plan, granted, now())) throw new Error("Grant is not installed; do not probe.");
    live(manifest, now()); input.signal.throwIfAborted();
    phase = "SOURCE_FIXTURE";
    const exactFixture = await reads.readFixture(plan, input.signal); fixture(plan, exactFixture, now());
    phase = "OPERATOR_IDENTITY";
    const caller = await writes.prepareOperator(input.signal);
    if (caller.callerArn !== ARN_PROBE_OPERATOR_CALLER || caller.account !== ARN_PROBE_ACCOUNT || probeInstant(caller.expiresAt) <= now() + 60_000) throw new Error("Operator identity expired before probe.");
    live(manifest, now()); input.signal.throwIfAborted();
    phase = "OPERATOR_READINESS";
    const observed = await input.operatorReads.checkReadiness(manifest, AbortSignal.any([input.signal, AbortSignal.timeout(30_000)]));
    readiness = readinessObservation(manifest, observed, now()); operatorReady(manifest, readiness, now());
    // A real read barrier is not proof of Delete authorization. Recheck Source
    // and the approval after the bounded read wait; never relax ARN conditions.
    phase = "GRANT_SETTLEMENT";
    if (management(plan, await reads.readManagement(plan, input.signal), now())) throw new Error("Grant changed during Operator readiness.");
    live(manifest, now()); input.signal.throwIfAborted();
    phase = "PROBE_DELETE";
    await intent(manifest, journal, "probe-delete", manifest.actions.probeDelete.request, now);
    live(manifest, now()); input.signal.throwIfAborted();
    // One full-ARN request under Operator. A lost reply is not retried.
    probeAttempted = true;
    try { probeRequestId = requestId(await writes.deleteProbe(manifest.actions.probeDelete.request, AbortSignal.timeout(30_000))); } catch (error) { failure(error, "PROBE_DELETE"); }
  } catch (error) { failure(error, phase); /* every failure still enters cleanup */ }
  finally {
    if (grantAttempted) try { cleanup = await revoke(manifest, reads, writes, journal, now, failure); } catch (error) { failure(error, "REVOKE_VERIFY"); }
  }
  if (cleanup) try {
    post = await reads.readProbeAfter(plan, AbortSignal.timeout(60_000)); fresh(post, now());
    if (post.stackId !== plan.input.fixtureStackId || post.changeSetArn !== plan.input.fixtureChangeSetArn || post.resourceCount !== 0 || !/^[a-f0-9]{64}$/.test(post.providerEvidenceSha256)) throw new Error("Post-probe proof drifted.");
  } catch (error) { failure(error, "POST_PROBE_READ"); post = null; }
  const isolatedProbeCompatibilityObserved = !!(cleanup && probeRequestId && post?.state === "CHANGE_SET_ABSENT");
  const body = { stage: "B5-J5g-j11", manifestSha256: manifest.manifestSha256,
    outcome: cleanup ? (isolatedProbeCompatibilityObserved ? "ISOLATED_PROBE_SUCCEEDED_LOCKED" : "LOCKED_PROBE_NOT_PROVED") : (grantAttempted ? "REVOKE_REQUIRED" : "NO_GRANT_SUBMITTED"),
    grantAttempted, grantRequestId, probeAttempted, probeRequestId, cleanup, post, diagnosticsVersion: 1, failures, operatorReadiness: readiness, isolatedProbeCompatibilityObserved,
    productionCompatibilityVerified: false, childExecuted: false, deleteStackPerformed: false, runtimeEnabled: false,
    retryAuthorized: false, observedAt: new Date(now()).toISOString() };
  return immutable({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
export async function inspectArnProbeWorkflow(plan: ArnProbeGrantPlan, reads: ArnProbeWorkflowReads, signal: AbortSignal, now = Date.now) {
  await assertArnProbeGrantPlan(plan);
  const before = await reads.waitManagement(plan, signal); management(plan, before, now());
  const post = await reads.readProbeAfter(plan, signal); fresh(post, now());
  const after = await reads.readManagement(plan, signal); management(plan, after, now());
  probeSame(before.stack, after.stack, "Inspection management stability");
  const body = { stage: "B5-J5g-j11", mode: "READ_ONLY_INSPECT", planSha256: plan.planSha256, management: after, post,
    outcome: after.rendererShape === "Locked" ? "LOCKED_VERIFIED" : "REVOKE_REQUIRED", mutationPerformed: false,
    grantReplayed: false, probeReplayed: false, productionCompatibilityVerified: false };
  return immutable({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
