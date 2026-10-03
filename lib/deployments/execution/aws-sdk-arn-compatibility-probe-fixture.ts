import { canonicalJson } from "./hash.ts";
import {
  ARN_PROBE_FIXTURE_STACK, assertArnProbeFixturePlan, validateArnProbeFixtureEvidence,
  type ArnProbeFixturePlan, type ArnProbeFixtureState, type ArnProbeFixtureReadPort, type ArnProbeFixtureCreatePort,
} from "./arn-compatibility-probe-fixture.ts";
import type { AwsSdkSharedCellAuthorCompensationManagementReadAdapter } from "./aws-sdk-shared-cell-author-compensation-management.ts";

interface Client { send(command: unknown, options: { abortSignal: AbortSignal }): Promise<Record<string, unknown>>; }
type Command = new (input: Record<string, unknown>) => unknown;
interface ReadDependencies {
  client: Client; management: Pick<AwsSdkSharedCellAuthorCompensationManagementReadAdapter, "readLockedPreflightObservation">;
  commands: { describeStacks: Command; listStackResources: Command; getTemplate: Command; describeChangeSet: Command };
  now?: () => number;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Incomplete probe provider response.");
  return value as Record<string, unknown>;
}
function absence(error: unknown, target: string) {
  const value = object(error), metadata = object(value.$metadata);
  if (value.name !== "ValidationError" || value.message !== `Stack with id ${target} does not exist` || metadata.httpStatusCode !== 400) throw new Error("Exact-ID-bound probe absence was not proved.");
  return { name: "ValidationError", message: `Stack with id ${target} does not exist`, httpStatusCode: 400 };
}
export class AwsSdkArnProbeFixtureReadAdapter implements ArnProbeFixtureReadPort {
  private readonly sdk: ReadDependencies;
  private readonly now: () => number;
  constructor(sdk: ReadDependencies) {
    if (typeof sdk?.client?.send !== "function" || typeof sdk.management?.readLockedPreflightObservation !== "function" ||
        ["describeStacks", "listStackResources", "getTemplate", "describeChangeSet"].some((key) => typeof sdk.commands?.[key as keyof ReadDependencies["commands"]] !== "function")) throw new Error("Probe read dependencies are incomplete.");
    this.sdk = sdk; this.now = sdk.now ?? Date.now;
  }
  readLockedPreflight(signal: AbortSignal) { return this.sdk.management.readLockedPreflightObservation({ signal }); }
  private async send(command: Command, input: Record<string, unknown>, signal: AbortSignal) {
    signal.throwIfAborted();
    const response = await this.sdk.client.send(new command(input), { abortSignal: signal });
    signal.throwIfAborted();
    // Preserve provider Date values as ISO strings; ignore no response fields.
    return object(JSON.parse(JSON.stringify(response)));
  }
  async readFixture(plan: ArnProbeFixturePlan, signal: AbortSignal): Promise<ArnProbeFixtureState> {
    await assertArnProbeFixturePlan(plan); signal.throwIfAborted();
    const started = this.now();
    let first: Record<string, unknown>;
    try { first = await this.send(this.sdk.commands.describeStacks, { StackName: ARN_PROBE_FIXTURE_STACK }, signal); }
    catch (error) {
      signal.throwIfAborted(); absence(error, ARN_PROBE_FIXTURE_STACK);
      return Object.freeze({ state: "MISSING", proof: "EXACT_NAME_BOUND_STACK_MISSING", observedAt: new Date(this.now()).toISOString() });
    }
    if (!Array.isArray(first.Stacks) || first.Stacks.length !== 1) throw new Error("Probe Stack inventory is incomplete.");
    const stack = object(first.Stacks[0]);
    // Refuse to make even read requests using an unvalidated foreign ARN.
    const id = stack.StackId;
    if (typeof id !== "string" || !/^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-arn-compatibility-probe\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) || stack.StackName !== ARN_PROBE_FIXTURE_STACK || stack.StackStatus !== "REVIEW_IN_PROGRESS") throw new Error("Probe is not the exact unexecuted review Stack.");
    const resources = await this.send(this.sdk.commands.listStackResources, { StackName: id }, signal);
    let originalTemplateAbsence: unknown;
    try {
      await this.send(this.sdk.commands.getTemplate, { StackName: id, TemplateStage: "Original" }, signal);
    } catch (error) { signal.throwIfAborted(); originalTemplateAbsence = absence(error, id); }
    if (!originalTemplateAbsence) throw new Error("Probe Stack has an Original template and cannot be treated as unexecuted.");
    // Short name is used ONLY to discover the provider-issued ARN after a lost
    // Create reply. All subsequent evidence queries bind that exact ARN.
    const changeSetBefore = await this.send(this.sdk.commands.describeChangeSet, { StackName: id, ChangeSetName: plan.request.ChangeSetName }, signal);
    const arn = changeSetBefore.ChangeSetId;
    if (typeof arn !== "string" || !new RegExp(`^arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${plan.request.ChangeSetName}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`).test(arn) || changeSetBefore.StackId !== id) throw new Error("Provider-issued probe Change Set ARN drifted.");
    const changeSetTemplate = await this.send(this.sdk.commands.getTemplate, { StackName: id, ChangeSetName: arn, TemplateStage: "Original" }, signal);
    const changeSetAfter = await this.send(this.sdk.commands.describeChangeSet, { StackName: id, ChangeSetName: arn }, signal);
    const stackAfter = await this.send(this.sdk.commands.describeStacks, { StackName: ARN_PROBE_FIXTURE_STACK }, signal);
    const ended = this.now();
    if (!Number.isSafeInteger(started) || !Number.isSafeInteger(ended) || ended < started || ended - started > 30_000) throw new Error("Probe evidence collection exceeded its bound.");
    return validateArnProbeFixtureEvidence(plan, { stackBefore: first, stackAfter, resources, originalTemplateAbsence,
      changeSetBefore, changeSetAfter, changeSetTemplate, observedAt: new Date(ended).toISOString() });
  }
}

/** Captures one deterministic request; never exposes Execute/Delete/IAM writes. */
export class AwsSdkArnProbeFixtureCreateAdapter implements ArnProbeFixtureCreatePort {
  private readonly plan: ArnProbeFixturePlan;
  private readonly client: Client;
  private readonly command: Command;
  private submitted = false;
  constructor(plan: ArnProbeFixturePlan, sdk: { client: Client; createChangeSet: Command }) {
    this.plan = JSON.parse(canonicalJson(plan)); this.client = sdk.client; this.command = sdk.createChangeSet;
    if (typeof this.client?.send !== "function" || typeof this.command !== "function") throw new Error("Probe create dependencies are incomplete.");
  }
  async createChangeSet(request: ArnProbeFixturePlan["request"], signal: AbortSignal) {
    await assertArnProbeFixturePlan(this.plan);
    if (canonicalJson(request) !== canonicalJson(this.plan.request)) throw new Error("Probe CreateChangeSet request drifted.");
    signal.throwIfAborted();
    if (this.submitted) throw new Error("Probe mutation adapter is single-submit; use read-only Recover.");
    this.submitted = true;
    return this.client.send(new this.command(JSON.parse(canonicalJson(this.plan.request))), { abortSignal: signal });
  }
}
