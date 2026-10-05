import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeSame, probeObject, probeInstant } from "./arn-compatibility-probe-workflow.ts";
import { comparisonGrantArn } from "./arn-probe-read-comparison-generation4-create.ts";
import { validateArnProbeComparisonManagementChangeSet } from "./aws-sdk-arn-probe-read-comparison-generation4-create.ts";
import { stackControlCopy } from "./arn-probe-stack-scoped-read-control-create.ts";
import { assertGeneration6CreatePlan, assertGeneration6CreateReview, assertGeneration6Inventory,
  type Generation6CreatePlan, type Generation6CreateReview, type Generation6Inventory, type Generation6SourceReads } from "./arn-probe-stack-control-generation6.ts";
import type { loadGeneration5RetirementEvidence } from "./arn-probe-stack-control-generation5-retirement-evidence.ts";

type Command = new (input: Record<string, unknown>) => unknown;
interface Client { send(command: unknown, options: { abortSignal: AbortSignal }): Promise<Record<string, unknown>>; }
const stable = (v: Record<string, unknown>) => Object.fromEntries(Object.entries(v).filter(([k]) => k !== "$metadata"));
const empty = (v: unknown) => v === undefined || v === null || v === "";
function standalone(v: Record<string, unknown>) {
  if (![undefined, false].includes(v.IncludeNestedStacks as undefined | false) || ![undefined, false].includes(v.ImportExistingResources as undefined | false) ||
    !empty(v.ParentChangeSetId) || !empty(v.RootChangeSetId) || !empty(v.DeploymentMode) || !empty(v.NextToken)) throw new Error("J23 generation6 nested/import/foreign inventory.");
}
/** No retained-history exception: the successful predecessor inventory was
 * empty. Every actual object must be the single exact new unexecuted Grant. */
export class AwsSdkGeneration6InventoryReader {
  private client: Client; private commands: { listChangeSets: Command; describeChangeSet: Command; getTemplate: Command }; private now: () => number;
  constructor(client: Client, commands: { listChangeSets: Command; describeChangeSet: Command; getTemplate: Command }, now = Date.now) {
    this.client = client; this.commands = commands; this.now = now;
    if (typeof client?.send !== "function" || Object.values(commands).some(v => typeof v !== "function")) throw new Error("J23 generation6 inventory dependencies missing.");
  }
  private async send(command: Command, input: Record<string, unknown>, signal: AbortSignal) {
    signal.throwIfAborted(); const reply = probeObject(JSON.parse(JSON.stringify(await this.client.send(new command(input), { abortSignal: signal })))); signal.throwIfAborted(); return reply;
  }
  private inventory(reply: Record<string, unknown>, plan: Generation6CreatePlan) {
    if (!empty(reply.NextToken) || !Array.isArray(reply.Summaries) || reply.Summaries.length > 1) throw new Error("J23 generation6 complete zero/singleton inventory required.");
    return reply.Summaries.map(probeObject).map(e => {
      standalone(e);
      if (e.StackId !== plan.request.StackName || e.ChangeSetName !== plan.request.ChangeSetName || typeof e.ChangeSetId !== "string" || !comparisonGrantArn(plan, e.ChangeSetId) ||
        e.Status !== "CREATE_COMPLETE" || e.ExecutionStatus !== "AVAILABLE") throw new Error("J23 generation6 foreign/unsettled/terminal target requires reconciliation.");
      return e;
    });
  }
  async read(plan: Generation6CreatePlan, signal: AbortSignal): Promise<Generation6Inventory> {
    await assertGeneration6CreatePlan(plan); const started = this.now();
    const first = await this.send(this.commands.listChangeSets, { StackName: plan.request.StackName }, signal), entries = this.inventory(first, plan);
    let target: Generation6Inventory["target"] | undefined; const proofs: unknown[] = [];
    if (entries.length) {
      const request = { StackName: plan.request.StackName, ChangeSetName: entries[0].ChangeSetId };
      const before = await this.send(this.commands.describeChangeSet, request, signal), original = await this.send(this.commands.getTemplate, { ...request, TemplateStage: "Original" }, signal),
        after = await this.send(this.commands.describeChangeSet, request, signal);
      standalone(before);
      if (!empty(before.RoleARN) || !empty(before.OnStackFailure)) throw new Error("J23 generation6 rollback/role override.");
      if (before.RollbackConfiguration !== undefined) {
        const rollback = probeObject(before.RollbackConfiguration);
        if (rollback.MonitoringTimeInMinutes !== undefined && rollback.MonitoringTimeInMinutes !== 0) throw new Error("J23 generation6 rollback monitoring override.");
        probeSame(rollback.RollbackTriggers ?? [], [], "J23 generation6 no rollback triggers");
        if (Object.keys(rollback).some(k => !["MonitoringTimeInMinutes", "RollbackTriggers"].includes(k))) throw new Error("J23 generation6 unknown rollback override.");
      }
      const at = this.now(); target = await validateArnProbeComparisonManagementChangeSet(plan, before, after, original, new Date(at).toISOString());
      if (target.state !== "READY_UNEXECUTED" || target.changeSetArn !== entries[0].ChangeSetId) throw new Error("J23 generation6 discovered full ARN changed.");
      proofs.push({ before, original, after });
    }
    const last = await this.send(this.commands.listChangeSets, { StackName: plan.request.StackName }, signal); this.inventory(last, plan);
    probeSame(stable(first), stable(last), "J23 generation6 complete inventory stability");
    const ended = this.now(); if (ended < started || ended - started > 30_000) throw new Error("J23 generation6 inventory exceeded bound.");
    const observedAt = new Date(ended).toISOString(), value = stackControlCopy({ stackId: plan.request.StackName, complete: true as const, count: entries.length,
      target: target ?? { state: "MISSING" as const, proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY" as const, observedAt }, observedAt,
      providerEvidenceSha256: await sha256Hex(canonicalJson({ first, last, proofs })) });
    assertGeneration6Inventory(plan, value, ended); return value;
  }
}
/** One approved-request capability, live window checked at the SDK boundary.
 * No Execute/Delete/Operator/AssumeRole is reachable from this adapter. */
export class AwsSdkGeneration6CreateAdapter {
  private submitted = false; private review: Generation6CreateReview; private client: Client; private command: Command; private now: () => number;
  constructor(review: Generation6CreateReview, client: Client, command: Command, now = Date.now) {
    this.review = stackControlCopy(review); this.client = client; this.command = command; this.now = now;
    if (typeof client?.send !== "function" || typeof command !== "function") throw new Error("J23 generation6 Create dependencies missing.");
  }
  async create(request: Generation6CreatePlan["request"], signal: AbortSignal) {
    await assertGeneration6CreateReview(this.review); probeSame(request, this.review.plan.request, "J23 generation6 exact approved Create");
    const at = this.now(); if (at < probeInstant(this.review.issuedAt) || at >= probeInstant(this.review.expiresAt)) throw new Error("J23 generation6 SDK approval expired.");
    signal.throwIfAborted(); if (this.submitted) throw new Error("J23 generation6 Create consumed; independent read-only recovery."); this.submitted = true;
    return this.client.send(new this.command(JSON.parse(canonicalJson(request))), { abortSignal: signal });
  }
}

/** Source-only existing strict Locked/v7/fixture readers are used as reads,
 * never fed a synthetic old plan. Creation has a separate exact validator. */
export async function createGeneration6SourceRuntime(archived: Awaited<ReturnType<typeof loadGeneration5RetirementEvidence>>) {
  const { createArnProbeSourceReadRuntime } = await import("./aws-sdk-arn-probe-source-read-runtime.ts"), source = await createArnProbeSourceReadRuntime();
  const cf = await import("@aws-sdk/client-cloudformation"), client = new cf.CloudFormationClient({ region: "ca-central-1", credentials: source.credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true });
  const wrapped = { send: (c: unknown, o: { abortSignal: AbortSignal }) => client.send(c as never, o) as unknown as Promise<Record<string, unknown>> };
  const commands = { listChangeSets: cf.ListChangeSetsCommand as unknown as Command, describeChangeSet: cf.DescribeChangeSetCommand as unknown as Command, getTemplate: cf.GetTemplateCommand as unknown as Command };
  const { AwsSdkStackControlInventoryReadAdapter } = await import("./aws-sdk-arn-probe-stack-scoped-read-control-create.ts");
  const inventory = new AwsSdkGeneration6InventoryReader(wrapped, commands), fixtureInventory = new AwsSdkStackControlInventoryReadAdapter(wrapped, commands);
  const old = archived.creationReview.plan.input.candidate.input.predecessor, fixturePlan = old.input.creationReview.plan.input.comparisonPlan.input.priorPlan;
  const reads: Generation6SourceReads = { observe: async (plan, signal) => {
    const managementBefore = await source.readStackControlManagement(archived.creationReview.plan, signal), fixtureBefore = await source.reads.readFixture(fixturePlan, signal),
      fixtureInventoryBefore = await fixtureInventory.readFixtureInventory(old, signal), managementInventory = await inventory.read(plan, signal),
      fixtureInventoryAfter = await fixtureInventory.readFixtureInventory(old, signal), fixtureAfter = await source.reads.readFixture(fixturePlan, signal),
      managementAfter = await source.readStackControlManagement(archived.creationReview.plan, signal);
    return { managementBefore, fixtureBefore, fixtureInventoryBefore, inventory: managementInventory, fixtureInventoryAfter, fixtureAfter, managementAfter };
  } };
  return { reads, createAdapter: (review: Generation6CreateReview) => new AwsSdkGeneration6CreateAdapter(review, wrapped, cf.CreateChangeSetCommand as unknown as Command),
    destroy: () => { client.destroy(); source.destroy(); } };
}
