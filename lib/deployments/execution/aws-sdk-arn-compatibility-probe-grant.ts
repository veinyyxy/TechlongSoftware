import { canonicalJson } from "./hash.ts";
import { ARN_PROBE_ACCOUNT, ARN_PROBE_REGION, type ArnProbeFixtureReadPort } from "./arn-compatibility-probe-fixture.ts";
import { assertArnProbeGrantPlan, validateArnProbeGrantChangeSet, type ArnProbeGrantPlan, type ArnProbeGrantReadPort } from "./arn-compatibility-probe-grant.ts";

interface Client { send(command: unknown, options: { abortSignal: AbortSignal }): Promise<Record<string, unknown>>; }
type Command = new (input: Record<string, unknown>) => unknown;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Incomplete probe Grant Change Set response.");
  return value as Record<string, unknown>;
}
export class AwsSdkArnProbeGrantReadAdapter implements ArnProbeGrantReadPort {
  private readonly fixture: ArnProbeFixtureReadPort;
  private readonly client: Client;
  private readonly commands: { listChangeSets: Command; describeChangeSet: Command; getTemplate: Command };
  private readonly now: () => number;
  constructor(fixture: ArnProbeFixtureReadPort, client: Client, commands: { listChangeSets: Command; describeChangeSet: Command; getTemplate: Command }, now = Date.now) {
    if (typeof client?.send !== "function" || Object.values(commands).some((value) => typeof value !== "function")) throw new Error("Probe grant read dependencies are incomplete.");
    this.fixture = fixture; this.client = client; this.commands = commands; this.now = now;
  }
  readLockedPreflight(signal: AbortSignal) { return this.fixture.readLockedPreflight(signal); }
  readFixture(...input: Parameters<ArnProbeFixtureReadPort["readFixture"]>) { return this.fixture.readFixture(...input); }
  private async send(command: Command, input: Record<string, unknown>, signal: AbortSignal) {
    signal.throwIfAborted();
    const result = object(JSON.parse(JSON.stringify(await this.client.send(new command(input), { abortSignal: signal }))));
    signal.throwIfAborted(); return result;
  }
  async readGrantChangeSet(plan: ArnProbeGrantPlan, signal: AbortSignal) {
    await assertArnProbeGrantPlan(plan);
    const started = this.now();
    const inventory = await this.send(this.commands.listChangeSets, { StackName: plan.managementStackId }, signal);
    if (inventory.NextToken || !Array.isArray(inventory.Summaries)) throw new Error("Management Change Set inventory must be complete.");
    const entries = inventory.Summaries.map(object), matching = entries.filter((value) => value.ChangeSetName === plan.request.ChangeSetName);
    if (entries.some((value) => value.StackId !== plan.managementStackId || typeof value.ChangeSetName !== "string" || typeof value.ChangeSetId !== "string")) throw new Error("Management Change Set inventory identities drifted.");
    // Refuse competing pending management changes, including failed/pending
    // creations whose effect or cleanup has not been explicitly reconciled.
    if (entries.some((value) => value.ChangeSetName !== plan.request.ChangeSetName && !["EXECUTE_COMPLETE", "OBSOLETE"].includes(String(value.ExecutionStatus)))) throw new Error("Another pending management Change Set requires independent review.");
    if (matching.length === 0) {
      const ended = this.now();
      if (!Number.isSafeInteger(started) || !Number.isSafeInteger(ended) || ended < started || ended - started > 30_000) throw new Error("Probe grant inventory collection exceeded its bound.");
      return Object.freeze({ state: "MISSING" as const, proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY" as const, observedAt: new Date(ended).toISOString() });
    }
    if (matching.length !== 1) throw new Error("Probe Grant Change Set discovery is not singular.");
    const arn = matching[0].ChangeSetId;
    if (typeof arn !== "string" || !new RegExp(`^arn:aws:cloudformation:${ARN_PROBE_REGION}:${ARN_PROBE_ACCOUNT}:changeSet/${plan.request.ChangeSetName}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`).test(arn)) throw new Error("Probe Grant Change Set discovered ARN drifted.");
    const input = { StackName: plan.managementStackId, ChangeSetName: arn };
    const before = await this.send(this.commands.describeChangeSet, input, signal);
    const original = await this.send(this.commands.getTemplate, { ...input, TemplateStage: "Original" }, signal);
    const after = await this.send(this.commands.describeChangeSet, input, signal);
    const ended = this.now();
    if (!Number.isSafeInteger(started) || !Number.isSafeInteger(ended) || ended < started || ended - started > 30_000) throw new Error("Probe grant read collection exceeded its bound.");
    return validateArnProbeGrantChangeSet(plan, before, after, original, new Date(ended).toISOString());
  }
}

/** Captures only one exact CreateChangeSet; no Execute/Delete/IAM capability. */
export class AwsSdkArnProbeGrantCreateAdapter {
  private readonly plan: ArnProbeGrantPlan;
  private readonly client: Client;
  private readonly command: Command;
  private submitted = false;
  constructor(plan: ArnProbeGrantPlan, client: Client, command: Command) {
    this.plan = JSON.parse(canonicalJson(plan)); this.client = client; this.command = command;
    if (typeof client?.send !== "function" || typeof command !== "function") throw new Error("Probe grant create dependency is incomplete.");
  }
  async create(request: ArnProbeGrantPlan["request"], signal: AbortSignal) {
    await assertArnProbeGrantPlan(this.plan);
    if (canonicalJson(request) !== canonicalJson(this.plan.request)) throw new Error("Probe Grant Change Set request drifted.");
    signal.throwIfAborted();
    if (this.submitted) throw new Error("Probe Grant Change Set capability is single-submit; use read-only Recover.");
    this.submitted = true;
    return this.client.send(new this.command(JSON.parse(canonicalJson(this.plan.request))), { abortSignal: signal });
  }
}
