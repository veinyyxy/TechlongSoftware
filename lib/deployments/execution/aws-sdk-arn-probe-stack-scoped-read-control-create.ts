import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeObject, probeSame, probeInstant } from "./arn-compatibility-probe-workflow.ts";
import { ARN_PROBE_ACCOUNT, ARN_PROBE_REGION, ARN_PROBE_SOURCE } from "./arn-compatibility-probe-fixture.ts";
import { comparisonGrantArn } from "./arn-probe-read-comparison-generation4-create.ts";
import { validateArnProbeComparisonManagementChangeSet } from "./aws-sdk-arn-probe-read-comparison-generation4-create.ts";
import { assertStackControlCreatePlan, stackControlHistory, assertStackControlInventory, stackControlCopy,
  type StackControlCreatePlan, type StackControlInventory, type StackControlFixtureInventory } from "./arn-probe-stack-scoped-read-control-create.ts";
import type { StackScopedReadControlPredecessor } from "./arn-probe-stack-scoped-read-control.ts";

interface Client { send(command: unknown, options: { abortSignal: AbortSignal }): Promise<Record<string, unknown>>; }
type Command = new (input: Record<string, unknown>) => unknown;
const empty = (v: unknown) => v === undefined || v === null || v === "";
const off = (v: unknown) => v === undefined || v === false;
const stable = (v: Record<string, unknown>) => Object.fromEntries(Object.entries(v).filter(([k]) => k !== "$metadata"));
function list(value: unknown) { if (!Array.isArray(value)) throw new Error("J22 provider inventory incomplete."); return value.map(probeObject); }
function standalone(value: Record<string, unknown>) {
  if (!off(value.IncludeNestedStacks) || !off(value.ImportExistingResources) || !empty(value.ParentChangeSetId) || !empty(value.RootChangeSetId) ||
    !empty(value.DeploymentMode) || !empty(value.NextToken)) throw new Error("J22 foreign/paginated/nested Change Set.");
}
function noRollbackOverride(value: Record<string, unknown>) {
  if (!empty(value.RoleARN) || !empty(value.OnStackFailure)) throw new Error("J22 role/rollback override drifted.");
  if (value.RollbackConfiguration !== undefined) {
    const rollback = probeObject(value.RollbackConfiguration);
    if (rollback.MonitoringTimeInMinutes !== undefined && rollback.MonitoringTimeInMinutes !== 0) throw new Error("J22 rollback monitoring drifted.");
    probeSame(rollback.RollbackTriggers ?? [], [], "J22 no rollback triggers");
    if (Object.keys(rollback).some(k => !["MonitoringTimeInMinutes", "RollbackTriggers"].includes(k))) throw new Error("J22 unknown rollback override.");
  }
}
/** Validates real terminal evidence in its actual state, never turns an
 * executed/foreign object into an AVAILABLE target to reuse a validator. */
export async function validateStackControlRetainedHistory(expected: ReturnType<typeof stackControlHistory>[number], before: unknown, after: unknown, original: unknown) {
  const first = probeObject(before), last = probeObject(after); probeSame(stable(first), stable(last), "J22 terminal history stability");
  standalone(first); noRollbackOverride(first);
  const request = expected.request;
  if (first.StackId !== request.StackName || first.StackName !== "techlong-s3-b5-cell-lifecycle-management" || first.ChangeSetId !== expected.arn ||
    first.ChangeSetName !== request.ChangeSetName || first.Description !== request.Description || first.Status !== "CREATE_COMPLETE" || first.ExecutionStatus !== "EXECUTE_COMPLETE") throw new Error("J22 exact executed history identity/state required.");
  probeSame(first.Capabilities, ["CAPABILITY_NAMED_IAM"], "J22 retained capabilities"); probeSame(first.NotificationARNs ?? [], [], "J22 retained notifications");
  probeSame(list(first.Parameters).map(p => [p.ParameterKey, p.ParameterValue]).sort(),
    [["ExpectedAccountId", ARN_PROBE_ACCOUNT], ["ExpectedRegion", ARN_PROBE_REGION], ["ManagementPrincipalArn", ARN_PROBE_SOURCE]].sort(), "J22 retained parameters");
  const changes = list(first.Changes); if (changes.length !== 1) throw new Error("J22 retained changes incomplete.");
  const resource = probeObject(changes[0].ResourceChange);
  if (changes[0].Type !== "Resource" || resource.Action !== "Modify" || resource.LogicalResourceId !== "CellOperatorBoundary" || resource.ResourceType !== "AWS::IAM::ManagedPolicy" ||
    resource.PhysicalResourceId !== `arn:aws:iam::${ARN_PROBE_ACCOUNT}:policy/TechlongSandboxCellOperatorBoundary` || resource.Replacement !== "False") throw new Error("J22 retained history changes unapproved resource.");
  const template = probeObject(original).TemplateBody;
  probeSame(typeof template === "string" ? JSON.parse(template) : probeObject(template), JSON.parse(request.TemplateBody), "J22 retained exact Original template");
  return { kind: expected.kind, changeSetArn: expected.arn, status: "CREATE_COMPLETE" as const, executionStatus: "EXECUTE_COMPLETE" as const,
    providerEvidenceSha256: await sha256Hex(canonicalJson({ before, after, original })) };
}
/** Source read-only, complete single-page inventories and exact ARN reads.
 * Retained old IDs may be absent only in real complete inventory; no synthetic
 * empty list, terminal-name filtering, wildcard discovery or Delete exists. */
export class AwsSdkStackControlInventoryReadAdapter {
  private client: Client; private commands: { listChangeSets: Command; describeChangeSet: Command; getTemplate: Command }; private now: () => number;
  constructor(client: Client, commands: { listChangeSets: Command; describeChangeSet: Command; getTemplate: Command }, now = Date.now) {
    this.client = client; this.commands = commands; this.now = now;
    if (typeof client?.send !== "function" || Object.values(commands).some(v => typeof v !== "function")) throw new Error("J22 Source inventory dependencies incomplete.");
  }
  private async send(command: Command, input: Record<string, unknown>, signal: AbortSignal) {
    signal.throwIfAborted(); const value = probeObject(JSON.parse(JSON.stringify(await this.client.send(new command(input), { abortSignal: signal })))); signal.throwIfAborted(); return value;
  }
  private inventory(reply: Record<string, unknown>, stackId: string) {
    if (!empty(reply.NextToken)) throw new Error("J22 inventory pagination requires reconciliation.");
    const entries = list(reply.Summaries), seen = new Set<string>();
    for (const e of entries) {
      standalone(e);
      if (e.StackId !== stackId || typeof e.ChangeSetName !== "string" || typeof e.ChangeSetId !== "string" || seen.has(e.ChangeSetId)) throw new Error("J22 inventory inaccurate or duplicate ID."); seen.add(e.ChangeSetId);
    }
    return entries;
  }
  private ended(start: number) { const at = this.now(); if (at < start || at - start > 30_000) throw new Error("J22 inventory collection exceeded its bound."); return new Date(at).toISOString(); }
  async readFixtureInventory(p: StackScopedReadControlPredecessor, signal: AbortSignal): Promise<StackControlFixtureInventory> {
    const prior = p.input.creationReview.plan.input.comparisonPlan.input.priorPlan, stackId = prior.input.fixtureStackId, start = this.now();
    const first = await this.send(this.commands.listChangeSets, { StackName: stackId }, signal), entries = this.inventory(first, stackId);
    if (entries.length !== 1) throw new Error("J22 original fixture inventory is not singleton.");
    const e = entries[0];
    if (e.ChangeSetId !== prior.input.fixtureChangeSetArn || e.ChangeSetName !== prior.input.fixturePlan.request.ChangeSetName || e.Status !== "CREATE_COMPLETE" || e.ExecutionStatus !== "AVAILABLE") throw new Error("J22 original fixture inventory drifted.");
    const last = await this.send(this.commands.listChangeSets, { StackName: stackId }, signal); this.inventory(last, stackId);
    probeSame(stable(first), stable(last), "J22 complete fixture inventory stability");
    return stackControlCopy({ stackId, changeSetArn: e.ChangeSetId as string, changeSetName: e.ChangeSetName as string, status: "CREATE_COMPLETE", executionStatus: "AVAILABLE",
      complete: true, count: 1, providerEvidenceSha256: await sha256Hex(canonicalJson({ first, last })), observedAt: this.ended(start) });
  }
  async readInventory(plan: StackControlCreatePlan, signal: AbortSignal): Promise<StackControlInventory> {
    await assertStackControlCreatePlan(plan); const start = this.now(), stackId = plan.request.StackName;
    const first = await this.send(this.commands.listChangeSets, { StackName: stackId }, signal), entries = this.inventory(first, stackId);
    const history = stackControlHistory(plan.input.candidate.input.predecessor), knownTerminal: StackControlInventory["knownTerminal"][number][] = [];
    let target: StackControlInventory["target"] | null = null; const proofs: unknown[] = [];
    for (const e of entries) {
      const known = history.find(h => h.arn === e.ChangeSetId);
      if (known) {
        if (e.ChangeSetName !== known.request.ChangeSetName || e.Status !== "CREATE_COMPLETE" || e.ExecutionStatus !== "EXECUTE_COMPLETE") throw new Error("J22 listed retained history drifted.");
      } else if (e.ChangeSetName !== plan.request.ChangeSetName || !comparisonGrantArn(plan, String(e.ChangeSetId)) || e.Status !== "CREATE_COMPLETE" || e.ExecutionStatus !== "AVAILABLE" || target) throw new Error("J22 foreign, unsettled or duplicate target requires read-only reconciliation.");
      const request = { StackName: stackId, ChangeSetName: e.ChangeSetId };
      const before = await this.send(this.commands.describeChangeSet, request, signal), original = await this.send(this.commands.getTemplate, { ...request, TemplateStage: "Original" }, signal);
      const after = await this.send(this.commands.describeChangeSet, request, signal); proofs.push({ before, original, after });
      if (known) knownTerminal.push(await validateStackControlRetainedHistory(known, before, after, original));
      else {
        standalone(before); noRollbackOverride(before);
        target = await validateArnProbeComparisonManagementChangeSet(plan, before, after, original, this.ended(start));
        if (target.state !== "READY_UNEXECUTED" || target.changeSetArn !== e.ChangeSetId) throw new Error("J22 target discovery changed.");
      }
    }
    const last = await this.send(this.commands.listChangeSets, { StackName: stackId }, signal); this.inventory(last, stackId);
    probeSame(stable(first), stable(last), "J22 complete management inventory stability");
    const observedAt = this.ended(start);
    const value = stackControlCopy({ stackId, complete: true as const, knownTerminal: knownTerminal.sort((a, b) => a.changeSetArn.localeCompare(b.changeSetArn)),
      target: target ?? { state: "MISSING" as const, proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY" as const, observedAt },
      providerEvidenceSha256: await sha256Hex(canonicalJson({ first, last, proofs })), observedAt });
    assertStackControlInventory(plan, value, probeInstant(observedAt)); return value;
  }
}
/** Only one exact Create submission. No Execute/Delete/MFA/Operator commands. */
export class AwsSdkStackControlCreateAdapter {
  private submitted = false; private plan: StackControlCreatePlan; private client: Client; private command: Command;
  constructor(plan: StackControlCreatePlan, client: Client, command: Command) {
    this.plan = stackControlCopy(plan); this.client = client; this.command = command;
    if (typeof client?.send !== "function" || typeof command !== "function") throw new Error("J22 Create dependencies incomplete.");
  }
  async create(request: StackControlCreatePlan["request"], signal: AbortSignal) {
    await assertStackControlCreatePlan(this.plan); probeSame(request, this.plan.request, "J22 approved exact Create request"); signal.throwIfAborted();
    if (this.submitted) throw new Error("J22 Create adapter single-submit; recover read-only."); this.submitted = true;
    return this.client.send(new this.command(JSON.parse(canonicalJson(request))), { abortSignal: signal });
  }
}
