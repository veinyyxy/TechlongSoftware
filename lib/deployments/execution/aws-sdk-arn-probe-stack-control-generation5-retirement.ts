import { probeSame } from "./arn-compatibility-probe-workflow.ts";
import { assertStackControlRetirement, type StackControlRetirementManifest, type StackControlRetirementObservation } from "./arn-probe-stack-control-generation5-retirement.ts";
import type { StackControlCreateReview, StackControlSourceReads } from "./arn-probe-stack-scoped-read-control-create.ts";
import { assertStackControlWorkflow, type StackControlWorkflowManifest } from "./arn-probe-stack-scoped-read-control-workflow.ts";

type Command = new (input: Record<string, unknown>) => unknown;
interface Client { send(command: unknown, options: { abortSignal: AbortSignal }): Promise<unknown>; }
/** Narrow capability: exact one-shot Delete only. No SDK retry, Execute,
 * nested deletion, wildcard lookup, IAM, paid Cell or successor creation. */
export class AwsSdkGeneration5RetirementDelete {
  private submitted = false; private manifest: StackControlRetirementManifest; private client: Client; private command: Command; private now: () => number;
  constructor(manifest: StackControlRetirementManifest, client: Client, command: Command, now = Date.now) {
    this.manifest = structuredClone(manifest); this.client = client; this.command = command; this.now = now;
  }
  async submit(request: StackControlRetirementManifest["request"], signal: AbortSignal) {
    await assertStackControlRetirement(this.manifest); probeSame(request, this.manifest.request, "J23 exact full ARN delete request");
    const at = this.now(); if (at < Date.parse(this.manifest.input.reviewedAt) || at >= Date.parse(this.manifest.input.expiresAt)) throw new Error("J23 Delete adapter approval expired.");
    signal.throwIfAborted(); if (this.submitted) throw new Error("J23 Delete adapter consumed; independent Inspect only."); this.submitted = true;
    return this.client.send(new this.command({ ...this.manifest.request }), { abortSignal: signal });
  }
}
/** Source only. Construction and read observation have no write capability;
 * the caller constructs a Delete adapter solely after explicit fresh approval. */
export async function createGeneration5RetirementReadRuntime(creationReview: StackControlCreateReview, manifest: StackControlWorkflowManifest) {
  await assertStackControlWorkflow(manifest); probeSame(manifest.input.creationReview, creationReview, "J23 exact Source read plan");
  const { createArnProbeSourceReadRuntime } = await import("./aws-sdk-arn-probe-source-read-runtime.ts");
  const source = await createArnProbeSourceReadRuntime();
  const cf = await import("@aws-sdk/client-cloudformation");
  const client = new cf.CloudFormationClient({ region: "ca-central-1", credentials: source.credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true });
  const wrapped = { send: (c: unknown, o: { abortSignal: AbortSignal }) => client.send(c as never, o) as unknown as Promise<Record<string, unknown>> };
  const commands = { describeStacks: cf.DescribeStacksCommand as unknown as Command, describeChangeSet: cf.DescribeChangeSetCommand as unknown as Command,
    getTemplate: cf.GetTemplateCommand as unknown as Command, listChangeSets: cf.ListChangeSetsCommand as unknown as Command };
  const { AwsSdkStackControlInventoryReadAdapter } = await import("./aws-sdk-arn-probe-stack-scoped-read-control-create.ts");
  const { AwsSdkStackControlWorkflowReadAdapter } = await import("./aws-sdk-arn-probe-stack-scoped-read-control-workflow.ts");
  const inventory = new AwsSdkStackControlInventoryReadAdapter(wrapped, commands);
  const creation: StackControlSourceReads = { readManagement: (p, s) => source.readGeneration4Management(p.input.creationReview.plan, s),
    readFixture: (p, s) => source.reads.readFixture(p.input.creationReview.plan.input.comparisonPlan.input.priorPlan, s),
    readFixtureInventory: (p, s) => inventory.readFixtureInventory(p, s), readInventory: (p, s) => inventory.readInventory(p, s) };
  const reads = new AwsSdkStackControlWorkflowReadAdapter({ client: wrapped, commands, creation, readManagement: source.readStackControlManagement });
  const observe = async (signal: AbortSignal): Promise<StackControlRetirementObservation> => {
    const plan = creationReview.plan, managementBefore = await reads.waitManagement(plan, signal), fixture = await reads.readFixture(plan, signal),
      fixtureInventory = await reads.readFixtureInventory(plan, signal), managementInventory = await reads.readWorkflowInventory(manifest, signal), managementAfter = await reads.readManagement(plan, signal);
    return { managementBefore, fixture, fixtureInventory, inventory: managementInventory, managementAfter };
  };
  return { observe, destroy: () => { client.destroy(); source.destroy(); },
    deleteAdapter: (m: StackControlRetirementManifest) => new AwsSdkGeneration5RetirementDelete(m, wrapped, cf.DeleteChangeSetCommand as unknown as Command) };
}
