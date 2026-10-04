import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeObject, probeSame } from "./arn-compatibility-probe-workflow.ts";
import { READ_COMPARISON_RETIREMENT as r, assertReadComparisonRetirement,
  type ReadComparisonRetirementManifest, type RetirementInventory } from "./arn-probe-read-comparison-generation3-retirement.ts";

type Command = new (input: Record<string, unknown>) => unknown;
interface Client { send(command: unknown, options: { abortSignal: AbortSignal }): Promise<Record<string, unknown>>; }
/** Fail closed on ambiguous nested/import flags in provider Describe replies,
 * in addition to the original double-Describe/template/root validator. */
export function guardRetirementReadClient(client: Client): Client {
  return { send: async (command, options) => {
    const value = probeObject(await client.send(command, options));
    for (const field of ["IncludeNestedStacks", "ImportExistingResources"])
      if (value[field] !== undefined && value[field] !== false) throw new Error("Retirement requires unambiguous non-nested, non-import replies.");
    return value;
  } };
}
/** Complete SINGLE-target or EMPTY inventory. Never filters out other terminal
 * objects. Root/nested/template/one-policy checks also run in the Grant reader. */
export class AwsSdkReadComparisonRetirementInventory {
  private client: Client; private command: Command; private now: () => number;
  constructor(client: Client, command: Command, now = Date.now) { this.client = client; this.command = command; this.now = now; }
  async read(signal: AbortSignal): Promise<RetirementInventory> {
    signal.throwIfAborted(); const started = this.now();
    const value = probeObject(JSON.parse(JSON.stringify(await this.client.send(new this.command({ StackName: r.stackId }), { abortSignal: signal }))));
    signal.throwIfAborted();
    if (value.NextToken || !Array.isArray(value.Summaries) || value.Summaries.length > 1) throw new Error("Retirement requires complete singleton/empty inventory.");
    const arns = value.Summaries.map((item) => {
      const v = probeObject(item);
      if (v.StackId !== r.stackId || v.StackName !== "techlong-s3-b5-cell-lifecycle-management" || v.ChangeSetId !== r.grantArn ||
        v.ChangeSetName !== r.grantName || v.Status !== "CREATE_COMPLETE" || v.ExecutionStatus !== "AVAILABLE" ||
        (v.IncludeNestedStacks !== undefined && v.IncludeNestedStacks !== false) || v.ParentChangeSetId || v.RootChangeSetId) throw new Error("Only the exact root unexecuted generation3 Grant can retire.");
      return r.grantArn;
    });
    const ended = this.now(); if (ended < started || ended - started > 30_000) throw new Error("Retirement inventory exceeded its bound.");
    return { stackId: r.stackId, changeSetArns: arns, complete: true, providerEvidenceSha256: await sha256Hex(canonicalJson(value)), observedAt: new Date(ended).toISOString() };
  }
}
/** The ONLY new cloud write: one exact DeleteChangeSet of a root UPDATE object.
 * No retry, nested flag, DeleteStack, IAM, Create or Execute command exists here. */
export class AwsSdkReadComparisonRetirementDelete {
  private manifest: ReadComparisonRetirementManifest; private client: Client; private command: Command; private submitted = false;
  constructor(manifest: ReadComparisonRetirementManifest, client: Client, command: Command) {
    this.manifest = JSON.parse(canonicalJson(manifest)); this.client = client; this.command = command;
  }
  async submit(request: ReadComparisonRetirementManifest["request"], signal: AbortSignal) {
    await assertReadComparisonRetirement(this.manifest); probeSame(request, this.manifest.request, "Exact retirement deletion request");
    signal.throwIfAborted(); if (this.submitted) throw new Error("Retirement Delete is single-submit; inspect read-only.");
    this.submitted = true;
    return this.client.send(new this.command({ ...this.manifest.request }), { abortSignal: signal });
  }
}
