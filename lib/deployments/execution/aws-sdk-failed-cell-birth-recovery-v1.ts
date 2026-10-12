import { CloudFormationClient, DescribeStacksCommand, DescribeStackEventsCommand } from "@aws-sdk/client-cloudformation";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { cellV3Clock, cellV3Fail, cellV3Freeze, CELL_V3_CFN_ROLE } from "../cloudformation/shared-cell-stack-v3.ts";
import { decodeFailedBirthCompensationJournalIntentV1, type FailedBirthCompensationJournalIntentV1, type FailedBirthDdbMarkerV1 } from "./failed-cell-birth-ddb-v1.ts";

interface Client { send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<Record<string, unknown>> }
type Command = new (input: Record<string, unknown>) => unknown;
export interface FailedBirthRecoverySdkV1 { cfn: Client; sts: Client; commands: { identity: Command; describe: Command; events: Command } }
const proofs = new WeakSet<object>();
export interface FailedBirthDeletionObservationV1 {
  schemaVersion: 1; protocol: "exact-failed-cell-birth-read-only-deletion-observation-v1";
  intentSha256: string; stackId: string; clientRequestToken: string; stackStatus: string;
  outcome: "DELETE_COMPLETE_TOKEN_MATCHED" | "DELETE_FAILED_TOKEN_MATCHED" | "DELETE_IN_PROGRESS_TOKEN_MATCHED" | "PRESENT_NOT_ATTRIBUTED";
  eventSha256: string | null; observedAt: number; observationSha256: string;
  deletionAuthorized: false; retryAuthorized: false;
}
export function assertFailedBirthDeletionObservationV1(v: FailedBirthDeletionObservationV1, intent: FailedBirthCompensationJournalIntentV1, now: number) {
  cellV3Clock(now); if (!proofs.has(v) || v.intentSha256 !== intent.intentSha256 || v.stackId !== intent.stackId ||
    v.clientRequestToken !== intent.request.ClientRequestToken || v.observedAt > now || now - v.observedAt > 30000) cellV3Fail("FAILED_BIRTH_RECOVERY_PROVENANCE_OR_FRESHNESS_INVALID");
}
/** Independent read-only recovery. Exact ARN only; deleted stacks can remain
 * describable. Missing ARN/provider errors fail closed, never prove successful
 * deletion, never fall back to a reused name, never repeat DeleteStack. */
export class AwsSdkFailedBirthDeletionRecoveryV1 {
  private readonly sdk: FailedBirthRecoverySdkV1; private readonly now: () => number;
  constructor(sdk: FailedBirthRecoverySdkV1, now: () => number = Date.now) {
    this.sdk = Object.freeze({ cfn: Object.freeze({ send: sdk.cfn.send.bind(sdk.cfn) }), sts: Object.freeze({ send: sdk.sts.send.bind(sdk.sts) }), commands: Object.freeze({ ...sdk.commands }) }); this.now = now;
  }
  private async identity(signal: AbortSignal) {
    signal.throwIfAborted(); const r = await this.sdk.sts.send(new this.sdk.commands.identity({}), { abortSignal: signal }); signal.throwIfAborted();
    if (r.Account !== "402010193138" || r.Arn !== "arn:aws:iam::402010193138:user/techlong-sandbox-dev" || r.UserId !== "AIDAV3GNMXTZEO7SHLC2X") cellV3Fail("FAILED_BIRTH_RECOVERY_SOURCE_IDENTITY_INVALID");
  }
  private async describe(intent: FailedBirthCompensationJournalIntentV1, signal: AbortSignal) {
    const r = await this.sdk.cfn.send(new this.sdk.commands.describe({ StackName: intent.stackId }), { abortSignal: signal }); signal.throwIfAborted();
    const stacks = r.Stacks as Record<string, unknown>[];
    if (!Array.isArray(stacks) || stacks.length !== 1 || stacks[0].StackId !== intent.stackId || stacks[0].StackName !== "techlong-sandbox-cell-sandbox-1" ||
      stacks[0].RoleARN !== CELL_V3_CFN_ROLE || typeof stacks[0].StackStatus !== "string" || !/^[A-Z_]{5,64}$/.test(stacks[0].StackStatus as string)) cellV3Fail("FAILED_BIRTH_RECOVERY_EXACT_STACK_INVALID");
    return { stackId: stacks[0].StackId, stackStatus: stacks[0].StackStatus as string, roleArn: stacks[0].RoleARN };
  }
  private async deletionEvent(intent: FailedBirthCompensationJournalIntentV1, signal: AbortSignal) {
    let token: string | undefined; const tokens = new Set<string>(), ids = new Set<string>();
    const stackEvents: { eventId: string; status: string; timestamp: number; clientRequestToken: string | null }[] = [];
    let count = 0;
    do {
      const r = await this.sdk.cfn.send(new this.sdk.commands.events({ StackName: intent.stackId, ...(token ? { NextToken: token } : {}) }), { abortSignal: signal }); signal.throwIfAborted();
      if (!Array.isArray(r.StackEvents) || (r.NextToken !== undefined && (typeof r.NextToken !== "string" || !r.NextToken))) cellV3Fail("FAILED_BIRTH_RECOVERY_EVENTS_INVALID");
      for (const raw of r.StackEvents as Record<string, unknown>[]) {
        if (++count > 10000 || raw.StackId !== intent.stackId || typeof raw.EventId !== "string" || !raw.EventId || ids.has(raw.EventId)) cellV3Fail("FAILED_BIRTH_RECOVERY_EVENTS_INVALID");
        ids.add(raw.EventId);
        if (raw.ResourceType !== "AWS::CloudFormation::Stack") continue;
        if (raw.PhysicalResourceId !== intent.stackId || raw.LogicalResourceId !== "techlong-sandbox-cell-sandbox-1" ||
          typeof raw.ResourceStatus !== "string" || !(raw.Timestamp instanceof Date) || !Number.isSafeInteger(raw.Timestamp.getTime()) ||
          (raw.ClientRequestToken !== undefined && (typeof raw.ClientRequestToken !== "string" || !raw.ClientRequestToken))) cellV3Fail("FAILED_BIRTH_RECOVERY_STACK_EVENT_INVALID");
        stackEvents.push({ eventId: raw.EventId, status: raw.ResourceStatus, timestamp: raw.Timestamp.getTime(), clientRequestToken: raw.ClientRequestToken as string ?? null });
      }
      token = r.NextToken as string | undefined; if (token) { if (tokens.has(token) || tokens.size >= 1000) cellV3Fail("FAILED_BIRTH_RECOVERY_EVENTS_PAGINATION_INVALID"); tokens.add(token); }
    } while (token);
    stackEvents.sort((a, b) => b.timestamp - a.timestamp || a.eventId.localeCompare(b.eventId));
    const latest = stackEvents[0];
    // A newer action from somebody else invalidates attribution, even if an old
    // matching token occurs elsewhere in the fully collected event history.
    if (!latest || !["DELETE_COMPLETE", "DELETE_FAILED", "DELETE_IN_PROGRESS"].includes(latest.status) ||
      latest.clientRequestToken !== intent.request.ClientRequestToken || latest.timestamp < intent.preparedAt || latest.timestamp > this.now() ||
      stackEvents.some(e => e.eventId !== latest.eventId && e.timestamp === latest.timestamp && canonicalJson(e) !== canonicalJson(latest))) return null;
    return latest;
  }
  async inspect(marker: FailedBirthDdbMarkerV1, rawIntent: FailedBirthCompensationJournalIntentV1, signal: AbortSignal): Promise<FailedBirthDeletionObservationV1> {
    const intent = await decodeFailedBirthCompensationJournalIntentV1(rawIntent, marker), start = cellV3Clock(this.now());
    await this.identity(signal); const before = await this.describe(intent, signal), firstEvent = await this.deletionEvent(intent, signal);
    const after = await this.describe(intent, signal), secondEvent = await this.deletionEvent(intent, signal); await this.identity(signal);
    const done = cellV3Clock(this.now());
    if (done < start || done - start > 30000 || canonicalJson(before) !== canonicalJson(after) || canonicalJson(firstEvent) !== canonicalJson(secondEvent)) cellV3Fail("FAILED_BIRTH_RECOVERY_READ_DRIFT_OR_STALE");
    const event = secondEvent?.status === after.stackStatus ? secondEvent : null;
    const outcome: FailedBirthDeletionObservationV1["outcome"] = event ? `${event.status}_TOKEN_MATCHED` as FailedBirthDeletionObservationV1["outcome"] : "PRESENT_NOT_ATTRIBUTED";
    const body = { schemaVersion: 1 as const, protocol: "exact-failed-cell-birth-read-only-deletion-observation-v1" as const,
      intentSha256: intent.intentSha256, stackId: intent.stackId, clientRequestToken: intent.request.ClientRequestToken, stackStatus: after.stackStatus, outcome,
      eventSha256: event ? await sha256Hex(event) : null, observedAt: done, deletionAuthorized: false as const, retryAuthorized: false as const };
    const v = cellV3Freeze({ ...body, observationSha256: await sha256Hex(body) }); proofs.add(v); return v;
  }
}
export function createFailedBirthDeletionRecoveryV1(credentials: unknown) {
  const config = { region: "ca-central-1", credentials: credentials as never, ignoreConfiguredEndpointUrls: true, maxAttempts: 1 }, sts = new STSClient(config), cfn = new CloudFormationClient(config);
  const reader = new AwsSdkFailedBirthDeletionRecoveryV1({ sts: sts as unknown as Client, cfn: cfn as unknown as Client,
    commands: { identity: GetCallerIdentityCommand as unknown as Command, describe: DescribeStacksCommand as unknown as Command, events: DescribeStackEventsCommand as unknown as Command } });
  return Object.freeze({ reader, dispose: () => { cfn.destroy(); sts.destroy(); } });
}
