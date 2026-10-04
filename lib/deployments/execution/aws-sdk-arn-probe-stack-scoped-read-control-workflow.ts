import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeObject, probeSame, probeInstant, ARN_PROBE_OPERATOR_CALLER } from "./arn-compatibility-probe-workflow.ts";
import { ARN_PROBE_ACCOUNT, ARN_PROBE_REGION, ARN_PROBE_SOURCE, ARN_PROBE_FIXTURE_STACK, ARN_PROBE_EXECUTION_ROLE } from "./arn-compatibility-probe-fixture.ts";
import { sanitizeArnProbeFailure, arnProbeSafeRequestId } from "./arn-compatibility-probe-diagnostics.ts";
import { comparisonGrantArn } from "./arn-probe-read-comparison-generation4-create.ts";
import { validateArnProbeComparisonManagementChangeSet } from "./aws-sdk-arn-probe-read-comparison-generation4-create.ts";
import { assertStackControlCreatePlan, stackControlHistory, stackControlCopy, type StackControlCreatePlan, type StackControlSourceReads } from "./arn-probe-stack-scoped-read-control-create.ts";
import { AwsSdkStackControlInventoryReadAdapter, validateStackControlRetainedHistory } from "./aws-sdk-arn-probe-stack-scoped-read-control-create.ts";
import { stackControlStepRequest } from "./arn-probe-stack-scoped-read-control-actions.ts";
import { assertStackControlWorkflow, type StackControlWorkflowManifest, type StackControlWorkflowReads, type StackControlWorkflowWrites,
  type StackControlOperatorReads, type StackControlRevokeState } from "./arn-probe-stack-scoped-read-control-workflow.ts";
import type { ArnProbeComparisonReadStyle, ArnProbeComparisonCaseResult } from "./arn-probe-read-comparison-generation4-workflow.ts";
import type { ArnProbeSdkClient, ArnProbeSdkCommand } from "./aws-sdk-arn-compatibility-probe-workflow.ts";

const empty = (v: unknown) => v === undefined || v === null || v === "";
const off = (v: unknown) => v === undefined || v === false;
const stable = (v: Record<string, unknown>) => Object.fromEntries(Object.entries(v).filter(([k]) => k !== "$metadata"));
function array(v: unknown) { if (!Array.isArray(v)) throw new Error("J22 provider inventory incomplete."); return v.map(probeObject); }
function standalone(v: Record<string, unknown>) {
  if (!empty(v.NextToken) || !off(v.IncludeNestedStacks) || !off(v.ImportExistingResources) || !empty(v.ParentChangeSetId) || !empty(v.RootChangeSetId) || !empty(v.DeploymentMode)) throw new Error("J22 nested/foreign/paginated provider identity.");
}
function identity(request: StackControlCreatePlan["request"], arn: string, value: Record<string, unknown>) {
  standalone(value);
  if (value.StackId !== request.StackName || value.StackName !== "techlong-s3-b5-cell-lifecycle-management" || value.ChangeSetId !== arn ||
    value.ChangeSetName !== request.ChangeSetName || value.Description !== request.Description || !empty(value.RoleARN) || !empty(value.OnStackFailure)) throw new Error("J22 exact management Change Set identity required.");
  if (value.RollbackConfiguration !== undefined) {
    const rollback = probeObject(value.RollbackConfiguration);
    if ((rollback.MonitoringTimeInMinutes !== undefined && rollback.MonitoringTimeInMinutes !== 0) || Object.keys(rollback).some(k => !["MonitoringTimeInMinutes", "RollbackTriggers"].includes(k))) throw new Error("J22 rollback override drifted.");
    probeSame(rollback.RollbackTriggers ?? [], [], "J22 no rollback triggers");
  }
}
async function validateCurrentRecord(request: StackControlCreatePlan["request"], arn: string, before: unknown, after: unknown, original: unknown) {
  const first = probeObject(before), last = probeObject(after); identity(request, arn, first); probeSame(stable(first), stable(last), "J22 current management record stability");
  if (first.Status !== "CREATE_COMPLETE" || !["AVAILABLE", "EXECUTE_COMPLETE", "EXECUTE_FAILED", "OBSOLETE", "EXECUTE_IN_PROGRESS"].includes(String(first.ExecutionStatus))) throw new Error("J22 current record state unproved.");
  probeSame(first.Capabilities, ["CAPABILITY_NAMED_IAM"], "J22 current capabilities"); probeSame(first.NotificationARNs ?? [], [], "J22 current notifications");
  probeSame(array(first.Parameters).map(p => [p.ParameterKey, p.ParameterValue]).sort(),
    [["ExpectedAccountId", ARN_PROBE_ACCOUNT], ["ExpectedRegion", ARN_PROBE_REGION], ["ManagementPrincipalArn", ARN_PROBE_SOURCE]].sort(), "J22 current parameters");
  const changes = array(first.Changes), r = probeObject(changes[0]?.ResourceChange);
  if (changes.length !== 1 || changes[0].Type !== "Resource" || r.Action !== "Modify" || r.LogicalResourceId !== "CellOperatorBoundary" || r.ResourceType !== "AWS::IAM::ManagedPolicy" ||
    r.PhysicalResourceId !== `arn:aws:iam::${ARN_PROBE_ACCOUNT}:policy/TechlongSandboxCellOperatorBoundary` || r.Replacement !== "False") throw new Error("J22 current record changes unapproved resource.");
  const template = probeObject(original).TemplateBody;
  probeSame(typeof template === "string" ? JSON.parse(template) : probeObject(template), JSON.parse(request.TemplateBody), "J22 current exact Original template");
}
async function pause(signal: AbortSignal) {
  signal.throwIfAborted(); await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, 2000);
    const aborted = () => { clearTimeout(timer); reject(new Error("J22 Source settlement cancelled.")); }; signal.addEventListener("abort", aborted, { once: true }); if (signal.aborted) aborted();
  });
}
export class AwsSdkStackControlWorkflowReadAdapter implements StackControlWorkflowReads {
  readonly creation: StackControlSourceReads;
  private sdk: { client: ArnProbeSdkClient; commands: { describeStacks: ArnProbeSdkCommand; describeChangeSet: ArnProbeSdkCommand; getTemplate: ArnProbeSdkCommand; listChangeSets: ArnProbeSdkCommand };
    readManagement: StackControlWorkflowReads["readManagement"]; creation: StackControlSourceReads; pause?: typeof pause };
  private inventory: AwsSdkStackControlInventoryReadAdapter; private now: () => number;
  constructor(sdk: AwsSdkStackControlWorkflowReadAdapter["sdk"], now = Date.now) { this.sdk = sdk; this.now = now; this.creation = sdk.creation; this.inventory = new AwsSdkStackControlInventoryReadAdapter(sdk.client, sdk.commands, now); }
  private async send(command: ArnProbeSdkCommand, input: Record<string, unknown>, signal: AbortSignal) {
    signal.throwIfAborted(); const value = probeObject(JSON.parse(JSON.stringify(await this.sdk.client.send(new command(input), { abortSignal: signal })))); signal.throwIfAborted(); return value;
  }
  readManagement(plan: StackControlCreatePlan, signal: AbortSignal) { return this.sdk.readManagement(plan, signal); }
  readFixture(plan: StackControlCreatePlan, signal: AbortSignal) { return this.creation.readFixture(plan.input.candidate.input.predecessor, signal); }
  readFixtureInventory(plan: StackControlCreatePlan, signal: AbortSignal) { return this.inventory.readFixtureInventory(plan.input.candidate.input.predecessor, signal); }
  async waitManagement(plan: StackControlCreatePlan, signal: AbortSignal) {
    await assertStackControlCreatePlan(plan); const start = this.now();
    for (let n = 0; n < 120; n++) {
      const reply = await this.send(this.sdk.commands.describeStacks, { StackName: plan.request.StackName }, signal), stacks = array(reply.Stacks), v = stacks[0];
      if (!empty(reply.NextToken) || stacks.length !== 1 || v.StackId !== plan.request.StackName || v.StackName !== "techlong-s3-b5-cell-lifecycle-management" ||
        !empty(v.RoleARN) || !empty(v.ParentId) || !empty(v.RootId) || v.EnableTerminationProtection !== false || this.now() < start || this.now() - start >= 240_000) throw new Error("J22 management wait identity/time drifted.");
      if (["UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"].includes(String(v.StackStatus))) return this.readManagement(plan, signal);
      if (!["UPDATE_IN_PROGRESS", "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS", "UPDATE_ROLLBACK_IN_PROGRESS", "UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS"].includes(String(v.StackStatus))) throw new Error("J22 management failed/unrecognized; manual reconciliation.");
      await (this.sdk.pause ?? pause)(signal);
    }
    throw new Error("J22 management settlement exceeded its bound.");
  }
  async waitGrantSettlement(m: StackControlWorkflowManifest, signal: AbortSignal) {
    await assertStackControlWorkflow(m); const plan = m.input.creationReview.plan, start = this.now();
    for (let n = 0; n < 120; n++) {
      const value = await this.send(this.sdk.commands.describeChangeSet, { StackName: plan.request.StackName, ChangeSetName: m.input.grantChangeSetArn }, signal);
      identity(plan.request, m.input.grantChangeSetArn, value);
      if (value.Status !== "CREATE_COMPLETE" || this.now() < start || this.now() - start >= 240_000) throw new Error("J22 Grant settlement drifted/exceeded bound.");
      if (["EXECUTE_COMPLETE", "EXECUTE_FAILED", "OBSOLETE"].includes(String(value.ExecutionStatus))) return this.waitManagement(plan, signal);
      if (!["AVAILABLE", "EXECUTE_IN_PROGRESS"].includes(String(value.ExecutionStatus))) throw new Error("J22 Grant execution uncertain; stale Locked cannot discharge cleanup.");
      await (this.sdk.pause ?? pause)(signal);
    }
    throw new Error("J22 Grant remains unsettled; never replay or infer early Locked.");
  }
  private async snapshot(m: StackControlWorkflowManifest, signal: AbortSignal) {
    await assertStackControlWorkflow(m); const plan = m.input.creationReview.plan, start = this.now(), request = m.actions.revoke.createRequest;
    const first = await this.send(this.sdk.commands.listChangeSets, { StackName: plan.request.StackName }, signal), entries = array(first.Summaries);
    if (!empty(first.NextToken)) throw new Error("J22 workflow inventory is paginated.");
    const history = stackControlHistory(plan.input.candidate.input.predecessor), seen = new Set<string>(), proofs: unknown[] = [], objects: { kind: string; arn: string; status: string; executionStatus: string }[] = [];
    let revoke: StackControlRevokeState | null = null;
    for (const e of entries) {
      standalone(e);
      if (e.StackId !== plan.request.StackName || typeof e.ChangeSetName !== "string" || typeof e.ChangeSetId !== "string" || seen.has(e.ChangeSetId)) throw new Error("J22 workflow inventory inaccurate/duplicate."); seen.add(e.ChangeSetId);
      const old = history.find(h => h.arn === e.ChangeSetId), isGrant = e.ChangeSetId === m.input.grantChangeSetArn && e.ChangeSetName === plan.request.ChangeSetName,
        isRevoke = e.ChangeSetName === request.ChangeSetName && comparisonGrantArn({ request }, e.ChangeSetId);
      if ((!old && !isGrant && !isRevoke) || (isRevoke && revoke)) throw new Error("J22 foreign workflow object; terminal names are not filtered.");
      const read = { StackName: plan.request.StackName, ChangeSetName: e.ChangeSetId }, before = await this.send(this.sdk.commands.describeChangeSet, read, signal);
      const expectedRequest = old?.request ?? (isGrant ? plan.request : request); identity(expectedRequest, e.ChangeSetId, before);
      if (e.ChangeSetName !== expectedRequest.ChangeSetName || before.Status !== e.Status || before.ExecutionStatus !== e.ExecutionStatus) throw new Error("J22 summary/Describe state drifted.");
      let original: unknown = null;
      if (before.Status === "CREATE_COMPLETE") original = await this.send(this.sdk.commands.getTemplate, { ...read, TemplateStage: "Original" }, signal);
      const after = await this.send(this.sdk.commands.describeChangeSet, read, signal); probeSame(stable(before), stable(after), "J22 workflow object stable"); proofs.push({ before, original, after });
      if (old) await validateStackControlRetainedHistory(old, before, after, original);
      else if (isGrant) await validateCurrentRecord(plan.request, m.input.grantChangeSetArn, before, after, original);
      else if (["CREATE_PENDING", "CREATE_IN_PROGRESS"].includes(String(before.Status)) && before.ExecutionStatus === "UNAVAILABLE") revoke = { state: "CREATING", observedAt: new Date(this.now()).toISOString() };
      else {
        await validateCurrentRecord(request, e.ChangeSetId, before, after, original);
        if (["EXECUTE_IN_PROGRESS", "EXECUTE_COMPLETE"].includes(String(before.ExecutionStatus))) revoke = { state: "EXECUTING", observedAt: new Date(this.now()).toISOString() };
        else if (before.ExecutionStatus !== "AVAILABLE") revoke = { state: "FAILED", observedAt: new Date(this.now()).toISOString() };
        else revoke = await validateArnProbeComparisonManagementChangeSet({ request, templateCanonicalSha256: plan.revokeTarget.templateCanonicalSha256 }, before, after, original, new Date(this.now()).toISOString());
      }
      objects.push({ kind: old ? `PRIOR_${old.kind}` : isGrant ? "CURRENT_GRANT" : "CURRENT_REVOKE", arn: e.ChangeSetId, status: String(e.Status), executionStatus: String(e.ExecutionStatus) });
    }
    const last = await this.send(this.sdk.commands.listChangeSets, { StackName: plan.request.StackName }, signal); probeSame(stable(first), stable(last), "J22 full workflow inventory stable");
    const end = this.now(); if (end < start || end - start > 30_000) throw new Error("J22 workflow inventory collection exceeded its bound.");
    const observedAt = new Date(end).toISOString();
    return stackControlCopy({ complete: true as const, stackId: plan.request.StackName, objects: objects.sort((a, b) => a.arn.localeCompare(b.arn)),
      providerEvidenceSha256: await sha256Hex(canonicalJson({ first, last, proofs })), observedAt,
      revoke: revoke ?? { state: "MISSING" as const, proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY" as const, observedAt } });
  }
  async readWorkflowInventory(m: StackControlWorkflowManifest, signal: AbortSignal) { const { revoke: ignored, ...report } = await this.snapshot(m, signal); void ignored; return report; }
  async waitRevoke(m: StackControlWorkflowManifest, signal: AbortSignal) {
    for (let n = 0; n < 60; n++) { const value = (await this.snapshot(m, signal)).revoke; if (value.state !== "CREATING") return value; await (this.sdk.pause ?? pause)(signal); }
    throw new Error("J22 Revoke creation settlement exceeded its bound.");
  }
}
/** One call per request style; no readiness retry, auth propagation loop,
 * DescribeStacks/GetTemplate/Delete capability or short-name response ID. */
export class AwsSdkStackControlOperatorReadAdapter implements StackControlOperatorReads {
  private sdk: { operator: ArnProbeSdkClient; describeChangeSet: ArnProbeSdkCommand; verifyIdentity: StackControlWorkflowWrites["prepareOperator"] };
  private submitted = new Set<ArnProbeComparisonReadStyle>(); private now: () => number;
  constructor(sdk: AwsSdkStackControlOperatorReadAdapter["sdk"], now = Date.now) { this.sdk = sdk; this.now = now; }
  async readCase(m: StackControlWorkflowManifest, style: ArnProbeComparisonReadStyle, signal: AbortSignal): Promise<ArnProbeComparisonCaseResult> {
    await assertStackControlWorkflow(m); const c = m.actions.operatorReads.cases.find(c => c.requestStyle === style);
    if (!c || this.submitted.has(style)) throw new Error("J22 case unknown/consumed.");
    const start = this.now(), live = () => { signal.throwIfAborted(); const at = this.now(); if (at < start || at - start > 30_000 || at < probeInstant(m.input.reviewedAt) || at >= probeInstant(m.input.expiresAt)) throw new Error("J22 Operator read window expired."); };
    live(); const caller = await this.sdk.verifyIdentity(signal); live();
    if (caller.callerArn !== ARN_PROBE_OPERATOR_CALLER || caller.account !== ARN_PROBE_ACCOUNT || probeInstant(caller.expiresAt) - this.now() < 60_000) throw new Error("J22 fixed Operator identity expired/drifted.");
    let outcome: ArnProbeComparisonCaseResult["outcome"] = "READ_UNCERTAIN", requestId: string | null = null, providerEvidenceSha256: string | null = null, failure: ArnProbeComparisonCaseResult["failure"] = null;
    this.submitted.add(style);
    try {
      const reply = probeObject(JSON.parse(JSON.stringify(await this.sdk.operator.send(new this.sdk.describeChangeSet(JSON.parse(canonicalJson(c.request))), { abortSignal: signal })))); live();
      const prior = m.input.creationReview.plan.input.candidate.input.predecessor.input.creationReview.plan.input.comparisonPlan.input.priorPlan, f = prior.input.fixturePlan;
      standalone(reply);
      if (reply.StackId !== prior.input.fixtureStackId || reply.StackName !== ARN_PROBE_FIXTURE_STACK || reply.ChangeSetId !== prior.input.fixtureChangeSetArn || reply.ChangeSetName !== f.request.ChangeSetName ||
        reply.RoleARN !== ARN_PROBE_EXECUTION_ROLE || reply.Status !== "CREATE_COMPLETE" || reply.ExecutionStatus !== "AVAILABLE" || reply.Description !== f.request.Description || reply.OnStackFailure !== "DELETE") throw new Error("J22 Operator fixture identity/state drifted.");
      for (const key of ["Capabilities", "Parameters", "NotificationARNs"]) probeSame(reply[key] ?? [], [], "J22 fixture no extra capabilities/parameters");
      const sortTags = (v: unknown) => array(v).sort((a, b) => String(a.Key).localeCompare(String(b.Key))); probeSame(sortTags(reply.Tags), sortTags(f.request.Tags), "J22 fixture exact tags");
      const changes = array(reply.Changes), r = probeObject(changes[0]?.ResourceChange);
      if (changes.length !== 1 || changes[0].Type !== "Resource" || r.Action !== "Add" || r.LogicalResourceId !== "ProbeHandle" || r.ResourceType !== "AWS::CloudFormation::WaitConditionHandle" || !empty(r.PhysicalResourceId)) throw new Error("J22 Operator fixture changes drifted.");
      const metadata = probeObject(reply.$metadata); requestId = arnProbeSafeRequestId(metadata.requestId);
      if (metadata.httpStatusCode !== 200 || !requestId) throw new Error("J22 Operator read lacks provider HTTP/request proof.");
      providerEvidenceSha256 = await sha256Hex(canonicalJson({ manifestSha256: m.manifestSha256, callerArn: caller.callerArn, request: c.request, reply })); outcome = "READ_SUCCEEDED";
    } catch (e) { failure = sanitizeArnProbeFailure(e, "OPERATOR_READINESS", this.now); requestId = failure.requestId; providerEvidenceSha256 = null; outcome = failure.classification === "AUTHORIZATION_DENIED" ? "READ_DENIED" : "READ_UNCERTAIN"; }
    return Object.freeze({ manifestSha256: m.manifestSha256, requestStyle: style, callerArn: ARN_PROBE_OPERATOR_CALLER, account: ARN_PROBE_ACCOUNT, region: ARN_PROBE_REGION,
      requestSha256: await sha256Hex(canonicalJson(c.request)), outcome, providerEvidenceSha256, requestId, failure, observedAt: new Date(this.now()).toISOString(),
      mutationPerformed: false, authorizationContextObserved: false, productionCompatibilityVerified: false, retryAuthorized: false });
  }
}
/** Source: one Grant Execute, one exact Locked Create, one full ARN Revoke
 * Execute. Revoke-only construction cannot install Grant or prepare Operator. */
export class AwsSdkStackControlWorkflowWriteAdapter implements Pick<StackControlWorkflowWrites, "executeGrant" | "createRevoke" | "executeRevoke"> {
  private m: StackControlWorkflowManifest; private submitted = new Set<string>(); private now: () => number;
  private sdk: { source: ArnProbeSdkClient; createChangeSet: ArnProbeSdkCommand; executeChangeSet: ArnProbeSdkCommand; grantCapabilityEnabled: boolean };
  constructor(m: StackControlWorkflowManifest, sdk: AwsSdkStackControlWorkflowWriteAdapter["sdk"], now = Date.now) { this.m = stackControlCopy(m); this.sdk = sdk; this.now = now; }
  private async submit(step: string, command: ArnProbeSdkCommand, supplied: unknown, expected: unknown, signal: AbortSignal) {
    await assertStackControlWorkflow(this.m); probeSame(supplied, expected, "J22 exact single-submit mutation"); signal.throwIfAborted();
    if (step === "grant-execute" && (this.now() < probeInstant(this.m.input.reviewedAt) || this.now() >= probeInstant(this.m.input.expiresAt))) throw new Error("J22 Grant approval expired before SDK submission.");
    if (this.submitted.has(step)) throw new Error("J22 mutation consumed; never replay."); this.submitted.add(step);
    return this.sdk.source.send(new command(JSON.parse(canonicalJson(expected))), { abortSignal: signal });
  }
  executeGrant(request: StackControlWorkflowManifest["actions"]["grantExecute"]["request"], signal: AbortSignal) {
    if (!this.sdk.grantCapabilityEnabled) throw new Error("J22 revoke-only cannot install Grant."); return this.submit("grant-execute", this.sdk.executeChangeSet, request, this.m.actions.grantExecute.request, signal);
  }
  createRevoke(request: StackControlWorkflowManifest["actions"]["revoke"]["createRequest"], signal: AbortSignal) { return this.submit("revoke-create", this.sdk.createChangeSet, request, this.m.actions.revoke.createRequest, signal); }
  executeRevoke(request: Parameters<StackControlWorkflowWrites["executeRevoke"]>[0], signal: AbortSignal) { return this.submit("revoke-execute", this.sdk.executeChangeSet, request, stackControlStepRequest(this.m, "revoke-execute", request), signal); }
}
