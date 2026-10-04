import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeObject, probeSame, probeInstant } from "./arn-compatibility-probe-workflow.ts";
import { ARN_PROBE_ACCOUNT, ARN_PROBE_REGION, ARN_PROBE_SOURCE } from "./arn-compatibility-probe-fixture.ts";
import { assertArnProbeComparisonCreatePlan, comparisonGrantArn, type ArnProbeComparisonCreatePlan,
  type ArnProbeComparisonGrantState } from "./arn-probe-read-comparison-create.ts";

interface Client { send(command: unknown, options: { abortSignal: AbortSignal }): Promise<Record<string, unknown>>; }
type Command = new (input: Record<string, unknown>) => unknown;
const empty = (v: unknown) => v === undefined || v === null || v === "";
function list(v: unknown): unknown[] { if (!Array.isArray(v)) throw new Error("Comparison provider list is incomplete."); return v; }
const stable = (v: Record<string, unknown>) => Object.fromEntries(Object.entries(v).filter(([k]) => k !== "$metadata"));
export async function validateArnProbeComparisonGrant(plan: ArnProbeComparisonCreatePlan, before: unknown, after: unknown, original: unknown, observedAt: string): Promise<ArnProbeComparisonGrantState> {
  await assertArnProbeComparisonCreatePlan(plan);
  return validateArnProbeComparisonManagementChangeSet(plan, before, after, original, observedAt);
}
/** Shared provider validator. The caller must first strictly recompile the
 * containing Grant or Revoke manifest; this function never authorizes a write. */
export async function validateArnProbeComparisonManagementChangeSet(plan: { request: ArnProbeComparisonCreatePlan["request"]; templateCanonicalSha256: string }, before: unknown, after: unknown, original: unknown, observedAt: string): Promise<ArnProbeComparisonGrantState> {
  const first = probeObject(before), last = probeObject(after); probeSame(stable(first), stable(last), "Comparison Grant stability");
  if (first.StackId !== plan.request.StackName || first.StackName !== "techlong-s3-b5-cell-lifecycle-management" ||
    first.ChangeSetName !== plan.request.ChangeSetName || typeof first.ChangeSetId !== "string" || !comparisonGrantArn({ request: plan.request }, first.ChangeSetId) ||
    first.Status !== "CREATE_COMPLETE" || first.ExecutionStatus !== "AVAILABLE" || first.Description !== plan.request.Description ||
    !empty(first.NextToken) || !empty(first.RoleARN) || !empty(first.OnStackFailure) || first.IncludeNestedStacks === true || first.ImportExistingResources === true ||
    !empty(first.ParentChangeSetId) || !empty(first.RootChangeSetId) || !empty(first.DeploymentMode)) throw new Error("Comparison Grant identity/state drifted.");
  probeSame(list(first.Capabilities), ["CAPABILITY_NAMED_IAM"], "Comparison capabilities");
  probeSame(list(first.NotificationARNs ?? []), [], "Comparison notifications");
  probeSame(list(first.Parameters).map((p) => { const v = probeObject(p); return [v.ParameterKey, v.ParameterValue]; }).sort(),
    [["ExpectedAccountId", ARN_PROBE_ACCOUNT], ["ExpectedRegion", ARN_PROBE_REGION], ["ManagementPrincipalArn", ARN_PROBE_SOURCE]].sort(), "Comparison parameters");
  const changes = list(first.Changes); if (changes.length !== 1) throw new Error("Only the Operator boundary may change.");
  const change = probeObject(changes[0]), resource = probeObject(change.ResourceChange);
  if (change.Type !== "Resource" || resource.Action !== "Modify" || resource.LogicalResourceId !== "CellOperatorBoundary" || resource.ResourceType !== "AWS::IAM::ManagedPolicy" ||
    resource.PhysicalResourceId !== `arn:aws:iam::${ARN_PROBE_ACCOUNT}:policy/TechlongSandboxCellOperatorBoundary` || resource.Replacement !== "False") throw new Error("Comparison changes an unapproved resource.");
  const template = probeObject(original).TemplateBody;
  probeSame(typeof template === "string" ? JSON.parse(template) : probeObject(template), JSON.parse(plan.request.TemplateBody), "Comparison Original template");
  probeInstant(observedAt);
  return Object.freeze({ state: "READY_UNEXECUTED", stackId: plan.request.StackName, changeSetArn: first.ChangeSetId,
    templateCanonicalSha256: plan.templateCanonicalSha256, providerEvidenceSha256: await sha256Hex(canonicalJson({ before, after, original })), observedAt });
}
export class AwsSdkArnProbeComparisonGrantReadAdapter {
  private client: Client;
  private commands: { listChangeSets: Command; describeChangeSet: Command; getTemplate: Command };
  private now: () => number;
  constructor(client: Client, commands: { listChangeSets: Command; describeChangeSet: Command; getTemplate: Command }, now = Date.now) {
    this.client = client; this.commands = commands; this.now = now;
    if (typeof client?.send !== "function" || Object.values(commands).some((v) => typeof v !== "function")) throw new Error("Comparison read dependencies incomplete.");
  }
  private async send(command: Command, input: Record<string, unknown>, signal: AbortSignal) {
    signal.throwIfAborted(); const value = probeObject(JSON.parse(JSON.stringify(await this.client.send(new command(input), { abortSignal: signal }))));
    signal.throwIfAborted(); return value;
  }
  async readGrant(plan: ArnProbeComparisonCreatePlan, signal: AbortSignal): Promise<ArnProbeComparisonGrantState> {
    await assertArnProbeComparisonCreatePlan(plan); const started = this.now();
    const inventory = await this.send(this.commands.listChangeSets, { StackName: plan.request.StackName }, signal);
    if (inventory.NextToken || !Array.isArray(inventory.Summaries)) throw new Error("Comparison management inventory is incomplete.");
    const entries = inventory.Summaries.map(probeObject);
    if (entries.some((e) => e.StackId !== plan.request.StackName || typeof e.ChangeSetName !== "string" || typeof e.ChangeSetId !== "string")) throw new Error("Comparison inventory identity drifted.");
    if (entries.some((e) => e.ChangeSetName !== plan.request.ChangeSetName && !["EXECUTE_COMPLETE", "OBSOLETE"].includes(String(e.ExecutionStatus)))) throw new Error("Competing management change requires independent review.");
    const matching = entries.filter((e) => e.ChangeSetName === plan.request.ChangeSetName);
    const bounded = () => { const end = this.now(); if (end < started || end - started > 30_000) throw new Error("Comparison Grant collection exceeded its bound."); return new Date(end).toISOString(); };
    if (matching.length === 0) return Object.freeze({ state: "MISSING", proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY", observedAt: bounded() });
    if (matching.length !== 1 || typeof matching[0].ChangeSetId !== "string" || !comparisonGrantArn(plan, matching[0].ChangeSetId)) throw new Error("Comparison Grant discovery is not exact and singular.");
    const input = { StackName: plan.request.StackName, ChangeSetName: matching[0].ChangeSetId };
    const before = await this.send(this.commands.describeChangeSet, input, signal);
    const original = await this.send(this.commands.getTemplate, { ...input, TemplateStage: "Original" }, signal);
    const after = await this.send(this.commands.describeChangeSet, input, signal);
    return validateArnProbeComparisonGrant(plan, before, after, original, bounded());
  }
}
/** One exact Create command; no Execute/Delete/Operator capability. */
export class AwsSdkArnProbeComparisonGrantCreateAdapter {
  private submitted = false;
  private plan: ArnProbeComparisonCreatePlan;
  private client: Client;
  private command: Command;
  constructor(plan: ArnProbeComparisonCreatePlan, client: Client, command: Command) {
    this.plan = JSON.parse(canonicalJson(plan)); this.client = client; this.command = command;
    if (typeof client?.send !== "function" || typeof command !== "function") throw new Error("Comparison Create dependencies incomplete.");
  }
  async create(request: ArnProbeComparisonCreatePlan["request"], signal: AbortSignal) {
    await assertArnProbeComparisonCreatePlan(this.plan); probeSame(request, this.plan.request, "Comparison exact Create request");
    signal.throwIfAborted(); if (this.submitted) throw new Error("Comparison Create is single-submit; recover read-only.");
    this.submitted = true; return this.client.send(new this.command(JSON.parse(canonicalJson(this.plan.request))), { abortSignal: signal });
  }
}
