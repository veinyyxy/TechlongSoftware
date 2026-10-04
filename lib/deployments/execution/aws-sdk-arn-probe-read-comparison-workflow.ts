import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeObject, probeSame, probeInstant, ARN_PROBE_OPERATOR_CALLER } from "./arn-compatibility-probe-workflow.ts";
import { ARN_PROBE_ACCOUNT, ARN_PROBE_REGION, ARN_PROBE_FIXTURE_STACK, ARN_PROBE_EXECUTION_ROLE } from "./arn-compatibility-probe-fixture.ts";
import { sanitizeArnProbeFailure, arnProbeSafeRequestId } from "./arn-compatibility-probe-diagnostics.ts";
import { assertArnProbeComparisonCreatePlan, comparisonGrantArn, type ArnProbeComparisonCreatePlan } from "./arn-probe-read-comparison-create.ts";
import { assertArnProbeComparisonWorkflow, comparisonStepRequest, type ArnProbeComparisonWorkflowManifest, type ArnProbeComparisonWorkflowReads,
  type ArnProbeComparisonWorkflowWrites, type ArnProbeComparisonOperatorReads, type ArnProbeComparisonReadStyle, type ArnProbeComparisonCaseResult } from "./arn-probe-read-comparison-workflow.ts";
import { AwsSdkArnProbeComparisonGrantReadAdapter, validateArnProbeComparisonManagementChangeSet } from "./aws-sdk-arn-probe-read-comparison-create.ts";
import type { ArnProbeSdkClient, ArnProbeSdkCommand } from "./aws-sdk-arn-compatibility-probe-workflow.ts";

const empty = (v: unknown) => v === undefined || v === null || v === "";
function array(v: unknown) { if (!Array.isArray(v)) throw new Error("Comparison provider inventory incomplete."); return v.map(probeObject); }
async function pause(signal: AbortSignal) {
  signal.throwIfAborted(); await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, 2000);
    const aborted = () => { clearTimeout(timer); reject(new Error("Comparison provider wait cancelled.")); };
    signal.addEventListener("abort", aborted, { once: true });
  });
}
export class AwsSdkArnProbeComparisonWorkflowReadAdapter implements ArnProbeComparisonWorkflowReads {
  private sdk: { client: ArnProbeSdkClient; commands: { describeStacks: ArnProbeSdkCommand; describeChangeSet: ArnProbeSdkCommand; getTemplate: ArnProbeSdkCommand; listChangeSets: ArnProbeSdkCommand };
    readManagement: ArnProbeComparisonWorkflowReads["readManagement"]; readFixture: ArnProbeComparisonWorkflowReads["readFixture"]; pause?: typeof pause };
  private grant: AwsSdkArnProbeComparisonGrantReadAdapter;
  private now: () => number;
  constructor(sdk: AwsSdkArnProbeComparisonWorkflowReadAdapter["sdk"], now = Date.now) { this.sdk = sdk; this.now = now; this.grant = new AwsSdkArnProbeComparisonGrantReadAdapter(sdk.client, sdk.commands, now); }
  private async send(command: ArnProbeSdkCommand, input: Record<string, unknown>, signal: AbortSignal) {
    signal.throwIfAborted(); const value = probeObject(JSON.parse(JSON.stringify(await this.sdk.client.send(new command(input), { abortSignal: signal })))); signal.throwIfAborted(); return value;
  }
  readManagement(plan: ArnProbeComparisonCreatePlan, signal: AbortSignal) { return this.sdk.readManagement(plan, signal); }
  readFixture(plan: ArnProbeComparisonCreatePlan, signal: AbortSignal) { return this.sdk.readFixture(plan, signal); }
  readGrant(plan: ArnProbeComparisonCreatePlan, signal: AbortSignal) { return this.grant.readGrant(plan, signal); }
  async waitManagement(plan: ArnProbeComparisonCreatePlan, signal: AbortSignal) {
    await assertArnProbeComparisonCreatePlan(plan);
    for (let count = 0; count < 120; count++) {
      const reply = await this.send(this.sdk.commands.describeStacks, { StackName: plan.request.StackName }, signal), stacks = array(reply.Stacks), stack = stacks[0];
      if (reply.NextToken || stacks.length !== 1 || stack.StackId !== plan.request.StackName || stack.StackName !== "techlong-s3-b5-cell-lifecycle-management" || !empty(stack.RoleARN) || !empty(stack.ParentId) || !empty(stack.RootId) || stack.EnableTerminationProtection !== false) throw new Error("Management wait identity drifted.");
      if (["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"].includes(String(stack.StackStatus))) return this.readManagement(plan, signal);
      if (!["UPDATE_IN_PROGRESS", "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS", "UPDATE_ROLLBACK_IN_PROGRESS", "UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS"].includes(String(stack.StackStatus))) throw new Error("Management failed or unrecognized; manual reconciliation required.");
      await (this.sdk.pause ?? pause)(signal);
    }
    throw new Error("Comparison management wait exceeded its bound.");
  }
  async waitGrantSettlement(m: ArnProbeComparisonWorkflowManifest, signal: AbortSignal) {
    await assertArnProbeComparisonWorkflow(m); const plan = m.input.creationReview.plan;
    for (let count = 0; count < 120; count++) {
      const v = await this.send(this.sdk.commands.describeChangeSet, { StackName: plan.request.StackName, ChangeSetName: m.input.grantChangeSetArn }, signal);
      if (v.StackId !== plan.request.StackName || v.ChangeSetId !== m.input.grantChangeSetArn || v.ChangeSetName !== plan.request.ChangeSetName || v.Description !== plan.request.Description || !empty(v.NextToken)) throw new Error("Grant settlement identity drifted.");
      if (["EXECUTE_COMPLETE", "EXECUTE_FAILED", "OBSOLETE"].includes(String(v.ExecutionStatus))) return this.waitManagement(plan, signal);
      if (!["AVAILABLE", "EXECUTE_IN_PROGRESS"].includes(String(v.ExecutionStatus))) throw new Error("Grant settlement is uncertain; no early Locked discharge.");
      await (this.sdk.pause ?? pause)(signal);
    }
    throw new Error("Grant submission remains unsettled; a stale Locked read cannot discharge cleanup.");
  }
  private async readRevoke(m: ArnProbeComparisonWorkflowManifest, signal: AbortSignal) {
    await assertArnProbeComparisonWorkflow(m); const request = m.actions.revoke.createRequest, started = this.now();
    const inventory = await this.send(this.sdk.commands.listChangeSets, { StackName: request.StackName }, signal);
    if (inventory.NextToken) throw new Error("Revoke inventory is paginated.");
    const entries = array(inventory.Summaries);
    if (entries.some((v) => v.StackId !== request.StackName || typeof v.ChangeSetName !== "string" || typeof v.ChangeSetId !== "string" ||
      (v.ChangeSetName !== request.ChangeSetName && !["EXECUTE_COMPLETE", "OBSOLETE"].includes(String(v.ExecutionStatus))))) throw new Error("Competing or foreign management Change Set blocks revoke creation.");
    const matching = entries.filter((v) => v.ChangeSetName === request.ChangeSetName), observedAt = () => new Date(this.now()).toISOString();
    if (!matching.length) return { state: "MISSING" as const, proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY" as const, observedAt: observedAt() };
    const arn = matching[0].ChangeSetId;
    if (matching.length !== 1 || typeof arn !== "string" || !comparisonGrantArn({ request }, arn)) throw new Error("Revoke discovery is not exact and singular.");
    const input = { StackName: request.StackName, ChangeSetName: arn }, before = await this.send(this.sdk.commands.describeChangeSet, input, signal);
    if (before.StackId !== request.StackName || before.ChangeSetId !== arn || before.ChangeSetName !== request.ChangeSetName || before.Description !== request.Description || !empty(before.NextToken)) throw new Error("Revoke identity drifted.");
    if (["CREATE_PENDING", "CREATE_IN_PROGRESS"].includes(String(before.Status))) return { state: "CREATING" as const, observedAt: observedAt() };
    if (["EXECUTE_IN_PROGRESS", "EXECUTE_COMPLETE"].includes(String(before.ExecutionStatus))) return { state: "EXECUTING" as const, observedAt: observedAt() };
    if (before.Status === "FAILED") return { state: "FAILED" as const, observedAt: observedAt() };
    const original = await this.send(this.sdk.commands.getTemplate, { ...input, TemplateStage: "Original" }, signal), after = await this.send(this.sdk.commands.describeChangeSet, input, signal);
    if (this.now() < started || this.now() - started > 30_000) throw new Error("Revoke provider collection exceeded its bound.");
    return validateArnProbeComparisonManagementChangeSet({ request, templateCanonicalSha256: m.input.creationReview.plan.revokeTarget.templateCanonicalSha256 }, before, after, original, observedAt());
  }
  async waitRevoke(m: ArnProbeComparisonWorkflowManifest, signal: AbortSignal) {
    for (let count = 0; count < 60; count++) { const v = await this.readRevoke(m, signal); if (v.state !== "CREATING") return v; await (this.sdk.pause ?? pause)(signal); }
    throw new Error("Revoke creation wait exceeded its bound.");
  }
}
/** Exactly one DescribeChangeSet per request style; no retry/readiness loop.
 * Returned identity stays full ARN even when the request uses the exact name. */
export class AwsSdkArnProbeComparisonOperatorReadAdapter implements ArnProbeComparisonOperatorReads {
  private sdk: { operator: ArnProbeSdkClient; describeChangeSet: ArnProbeSdkCommand; verifyIdentity: ArnProbeComparisonWorkflowWrites["prepareOperator"] };
  private submitted = new Set<ArnProbeComparisonReadStyle>();
  private now: () => number;
  constructor(sdk: AwsSdkArnProbeComparisonOperatorReadAdapter["sdk"], now = Date.now) { this.sdk = sdk; this.now = now; }
  async readCase(m: ArnProbeComparisonWorkflowManifest, style: ArnProbeComparisonReadStyle, signal: AbortSignal): Promise<ArnProbeComparisonCaseResult> {
    await assertArnProbeComparisonWorkflow(m); const c = m.actions.operatorReads.cases.find((c) => c.requestStyle === style);
    if (!c || this.submitted.has(style)) throw new Error("Operator case unknown or already consumed.");
    const started = this.now(), live = () => { signal.throwIfAborted(); const at = this.now(); if (at < started || at - started > 30_000 || at < probeInstant(m.input.reviewedAt) || at >= probeInstant(m.input.expiresAt)) throw new Error("Operator read window expired."); };
    live(); const caller = await this.sdk.verifyIdentity(signal); live();
    if (caller.callerArn !== ARN_PROBE_OPERATOR_CALLER || caller.account !== ARN_PROBE_ACCOUNT || probeInstant(caller.expiresAt) - this.now() < 60_000) throw new Error("Fixed Operator identity drifted/expired.");
    let outcome: ArnProbeComparisonCaseResult["outcome"] = "READ_UNCERTAIN", requestId: string | null = null, providerEvidenceSha256: string | null = null;
    let failure: ArnProbeComparisonCaseResult["failure"] = null;
    this.submitted.add(style);
    try {
      const reply = probeObject(JSON.parse(JSON.stringify(await this.sdk.operator.send(new this.sdk.describeChangeSet(JSON.parse(canonicalJson(c.request))), { abortSignal: signal }))));
      live(); const prior = m.input.creationReview.plan.input.comparisonPlan.input.priorPlan, fixture = prior.input.fixturePlan;
      if (reply.StackId !== prior.input.fixtureStackId || reply.StackName !== ARN_PROBE_FIXTURE_STACK || reply.ChangeSetId !== prior.input.fixtureChangeSetArn || reply.ChangeSetName !== fixture.request.ChangeSetName ||
        reply.RoleARN !== ARN_PROBE_EXECUTION_ROLE || reply.Status !== "CREATE_COMPLETE" || reply.ExecutionStatus !== "AVAILABLE" || reply.Description !== fixture.request.Description || reply.OnStackFailure !== "DELETE" ||
        !empty(reply.NextToken) || reply.IncludeNestedStacks === true || reply.ImportExistingResources === true || !empty(reply.ParentChangeSetId) || !empty(reply.RootChangeSetId) || !empty(reply.DeploymentMode)) throw new Error("Operator returned fixture identity/shape drifted.");
      for (const key of ["Capabilities", "Parameters", "NotificationARNs"]) if (array(reply[key] ?? []).length) throw new Error("Operator fixture has unexpected capabilities/parameters.");
      const sortTags = (v: unknown) => array(v).sort((a, b) => String(a.Key).localeCompare(String(b.Key)));
      probeSame(sortTags(reply.Tags), sortTags(fixture.request.Tags), "Operator fixture tags");
      const changes = array(reply.Changes), change = changes[0], resource = probeObject(change?.ResourceChange);
      if (changes.length !== 1 || change.Type !== "Resource" || resource.Action !== "Add" || resource.LogicalResourceId !== "ProbeHandle" || resource.ResourceType !== "AWS::CloudFormation::WaitConditionHandle" || !empty(resource.PhysicalResourceId)) throw new Error("Operator probe change drifted.");
      const metadata = probeObject(reply.$metadata); requestId = arnProbeSafeRequestId(metadata.requestId);
      if (metadata.httpStatusCode !== 200 || !requestId) throw new Error("Operator read lacks provider HTTP/request proof.");
      providerEvidenceSha256 = await sha256Hex(canonicalJson({ manifestSha256: m.manifestSha256, callerArn: caller.callerArn, request: c.request, reply })); outcome = "READ_SUCCEEDED";
    } catch (e) { failure = sanitizeArnProbeFailure(e, "OPERATOR_READINESS", this.now); requestId = failure.requestId; providerEvidenceSha256 = null; outcome = failure.classification === "AUTHORIZATION_DENIED" ? "READ_DENIED" : "READ_UNCERTAIN"; }
    return Object.freeze({ manifestSha256: m.manifestSha256, requestStyle: style, callerArn: ARN_PROBE_OPERATOR_CALLER, account: ARN_PROBE_ACCOUNT, region: ARN_PROBE_REGION,
      requestSha256: await sha256Hex(canonicalJson(c.request)), outcome, providerEvidenceSha256, requestId, failure,
      observedAt: new Date(this.now()).toISOString(), mutationPerformed: false, authorizationContextObserved: false, productionCompatibilityVerified: false, retryAuthorized: false });
  }
}
/** Source CF only: one Grant Execute, one Locked Create, one exact Revoke Execute.
 * Revoke-only construction has no Grant or Operator capability. No Delete APIs. */
export class AwsSdkArnProbeComparisonWorkflowWriteAdapter implements Pick<ArnProbeComparisonWorkflowWrites, "executeGrant" | "createRevoke" | "executeRevoke"> {
  private manifest: ArnProbeComparisonWorkflowManifest;
  private sdk: { source: ArnProbeSdkClient; createChangeSet: ArnProbeSdkCommand; executeChangeSet: ArnProbeSdkCommand; grantCapabilityEnabled: boolean };
  private submitted = new Set<string>();
  constructor(manifest: ArnProbeComparisonWorkflowManifest, sdk: AwsSdkArnProbeComparisonWorkflowWriteAdapter["sdk"]) { this.manifest = JSON.parse(canonicalJson(manifest)); this.sdk = sdk; }
  private async submit(step: string, command: ArnProbeSdkCommand, supplied: unknown, expected: unknown, signal: AbortSignal) {
    await assertArnProbeComparisonWorkflow(this.manifest); probeSame(supplied, expected, `Exact comparison ${step}`); signal.throwIfAborted();
    if (this.submitted.has(step)) throw new Error("Comparison mutation single-submit; never replay."); this.submitted.add(step);
    return this.sdk.source.send(new command(JSON.parse(canonicalJson(expected))), { abortSignal: signal });
  }
  executeGrant(request: ArnProbeComparisonWorkflowManifest["actions"]["grantExecute"]["request"], signal: AbortSignal) {
    if (!this.sdk.grantCapabilityEnabled) throw new Error("Revoke-only mode cannot install Grant.");
    return this.submit("grant-execute", this.sdk.executeChangeSet, request, this.manifest.actions.grantExecute.request, signal);
  }
  createRevoke(request: ArnProbeComparisonWorkflowManifest["actions"]["revoke"]["createRequest"], signal: AbortSignal) { return this.submit("revoke-create", this.sdk.createChangeSet, request, this.manifest.actions.revoke.createRequest, signal); }
  executeRevoke(request: Parameters<ArnProbeComparisonWorkflowWrites["executeRevoke"]>[0], signal: AbortSignal) { return this.submit("revoke-execute", this.sdk.executeChangeSet, request, comparisonStepRequest(this.manifest, "revoke-execute", request), signal); }
}
