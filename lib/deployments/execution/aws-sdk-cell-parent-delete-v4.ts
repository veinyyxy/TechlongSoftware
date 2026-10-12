import { CloudFormationClient, DeleteStackCommand, DescribeStacksCommand, DescribeStackEventsCommand } from "@aws-sdk/client-cloudformation";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { cellV3Clock, cellV3Freeze, cellV3Fail } from "../cloudformation/shared-cell-stack-v3.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { consumeParentDeleteClaimV4, assertParentWorkflowV4, type ParentDeleteClaimV4, type ParentDeleteBoundaryV4, type ParentWorkflowSnapshotV4 } from "./cell-parent-cleanup-v4.ts";

interface Client { send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<Record<string, unknown>> }
type Command = new (input: Record<string, unknown>) => unknown;
export interface CellParentDeleteSdkV4 { sts: Client; cfn: Client; commands: { identity: Command; deleteStack: Command; describe: Command; events: Command } }
const observations = new WeakSet<object>();
export interface CellParentDeleteObservationV4 { schemaVersion: 4; protocol: "cell-parent-exact-delete-observation-v4"; intentSha256: string; observedAt: number;
  outcome: "DELETE_COMPLETE_TOKEN_MATCHED" | "DELETE_FAILED_TOKEN_MATCHED" | "DELETE_IN_PROGRESS_TOKEN_MATCHED" | "PRESENT_NOT_ATTRIBUTED";
  observationSha256: string; stackStatus: string; eventSha256: string | null; deletionAuthorized: false; retryAuthorized: false }
export function assertCellParentDeleteObservationV4(v: CellParentDeleteObservationV4, s: ParentWorkflowSnapshotV4, now: number) {
  cellV3Clock(now); if (!observations.has(v) || v.intentSha256 !== s.deleteIntent?.intentSha256 || v.observedAt > now || now - v.observedAt > 30000) cellV3Fail("CELL_PARENT_DELETE_OBSERVATION_NOT_LIVE");
}
/** Exact STANDARD one-shot actuator, separate from read-only recovery. Private
 * ownership is burned before Send. No name fallback, force/retain/skip or retry. */
export class AwsSdkCellParentDeleteV4 {
  private readonly sdk: CellParentDeleteSdkV4; private readonly now: () => number;
  constructor(sdk: CellParentDeleteSdkV4, now: () => number = Date.now) {
    this.sdk = Object.freeze({ sts: Object.freeze({ send: sdk.sts.send.bind(sdk.sts) }), cfn: Object.freeze({ send: sdk.cfn.send.bind(sdk.cfn) }), commands: Object.freeze({ ...sdk.commands }) }); this.now = now;
  }
  private async identity(s: ParentWorkflowSnapshotV4, signal: AbortSignal) {
    signal.throwIfAborted(); const r = await this.sdk.sts.send(new this.sdk.commands.identity({}), { abortSignal: signal }); signal.throwIfAborted();
    if (r.Account !== "402010193138" || !/^arn:aws:sts::402010193138:assumed-role\/TechlongSandboxCellLifecycleCoordinatorRoleV3\/[A-Za-z0-9+=,.@_-]{2,64}$/.test(String(r.Arn)) ||
      r.UserId !== `${s.parent.record.manifest.runtimeBinding.roleId}:${String(r.Arn).split("/").at(-1)}`) cellV3Fail("CELL_PARENT_DELETE_RUNTIME_IDENTITY_INVALID");
  }
  async executeOnce(claim: ParentDeleteClaimV4, boundary: ParentDeleteBoundaryV4, signal: AbortSignal) {
    await this.identity(boundary.snapshot, signal); signal.throwIfAborted(); const request = consumeParentDeleteClaimV4(claim, boundary, this.now());
    try { const r = await this.sdk.cfn.send(new this.sdk.commands.deleteStack(request), { abortSignal: signal }); signal.throwIfAborted();
      if ((r.$metadata as { httpStatusCode?: number })?.httpStatusCode !== 200) return { outcome: "DELETE_SUBMISSION_UNCERTAIN_INSPECT_ONLY", deleteInvocationAttempted: true, retryAuthorized: false };
      return { outcome: "DELETE_RETURNED_REQUIRES_INDEPENDENT_INSPECT", deleteInvocationAttempted: true, retryAuthorized: false };
    } catch { return { outcome: "DELETE_SUBMISSION_UNCERTAIN_INSPECT_ONLY", deleteInvocationAttempted: true, retryAuthorized: false }; }
  }
  async inspect(s: ParentWorkflowSnapshotV4, signal: AbortSignal): Promise<CellParentDeleteObservationV4> {
    assertParentWorkflowV4(s, this.now()); if (!s.deleteIntent || !s.authority) cellV3Fail("CELL_PARENT_DELETE_INSPECT_INTENT_REQUIRED"); const start = cellV3Clock(this.now()), intent = s.deleteIntent;
    await this.identity(s, signal);
    const collect = async () => {
      let stack: Record<string, unknown> | null = null;
      try {
        const r = await this.sdk.cfn.send(new this.sdk.commands.describe({ StackName: intent.request.StackName }), { abortSignal: signal }); signal.throwIfAborted();
        if (!Array.isArray(r.Stacks) || r.Stacks.length > 1) cellV3Fail("CELL_PARENT_DELETE_INSPECT_EXACT_ARN_UNAVAILABLE");
        stack = (r.Stacks as Record<string, unknown>[])[0] ?? null;
        if (stack && (stack.StackId !== intent.request.StackName || stack.StackName !== "techlong-sandbox-cell-sandbox-1" || stack.RoleARN !== intent.request.RoleARN || typeof stack.StackStatus !== "string")) cellV3Fail("CELL_PARENT_DELETE_INSPECT_EXACT_ARN_UNAVAILABLE");
      } catch (e) {
        signal.throwIfAborted(); // Missing describe is NOT a success proof. Only
        // fully collected latest exact-ARN/token DELETE_COMPLETE events can
        // certify completion below. AccessDenied/network errors are not missing.
        if ((e as { name?: string }).name !== "ValidationError") throw e;
      }
      let token: string | undefined; const tokens = new Set<string>(), ids = new Set<string>(), events: { id: string; status: string; timestamp: number; token: string | null }[] = [];
      do {
        const e = await this.sdk.cfn.send(new this.sdk.commands.events({ StackName: intent.request.StackName, ...(token ? { NextToken: token } : {}) }), { abortSignal: signal }); signal.throwIfAborted();
        if (!Array.isArray(e.StackEvents) || (e.NextToken !== undefined && (typeof e.NextToken !== "string" || !e.NextToken))) cellV3Fail("CELL_PARENT_DELETE_INSPECT_EVENTS_INVALID");
        for (const raw of e.StackEvents as Record<string, unknown>[]) {
          if (raw.StackId !== intent.request.StackName || typeof raw.EventId !== "string" || !raw.EventId || ids.has(raw.EventId) || ids.size >= 10000) cellV3Fail("CELL_PARENT_DELETE_INSPECT_EVENTS_INVALID"); ids.add(raw.EventId);
          if (raw.ResourceType !== "AWS::CloudFormation::Stack") continue;
          if (raw.PhysicalResourceId !== intent.request.StackName || raw.LogicalResourceId !== "techlong-sandbox-cell-sandbox-1" || !(raw.Timestamp instanceof Date) || !Number.isSafeInteger(raw.Timestamp.getTime()) || typeof raw.ResourceStatus !== "string" || (raw.ClientRequestToken !== undefined && typeof raw.ClientRequestToken !== "string")) cellV3Fail("CELL_PARENT_DELETE_INSPECT_EVENT_LINEAGE_INVALID");
          events.push({ id: raw.EventId, status: raw.ResourceStatus, timestamp: raw.Timestamp.getTime(), token: raw.ClientRequestToken as string ?? null });
        }
        token = e.NextToken as string | undefined; if (token) { if (tokens.has(token) || tokens.size >= 1000) cellV3Fail("CELL_PARENT_DELETE_INSPECT_PAGINATION_INVALID"); tokens.add(token); }
      } while (token);
      events.sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id)); const newest = events[0];
      const event = newest && newest.token === intent.request.ClientRequestToken && (stack ? newest.status === stack.StackStatus : newest.status === "DELETE_COMPLETE") &&
        ["DELETE_COMPLETE", "DELETE_FAILED", "DELETE_IN_PROGRESS"].includes(newest.status) && newest.timestamp >= intent.claimedAt && newest.timestamp <= this.now() &&
        !events.some(v => v.id !== newest.id && v.timestamp === newest.timestamp) ? newest : null;
      return { status: stack?.StackStatus as string ?? "EXACT_ARN_NOT_DESCRIBABLE", event };
    };
    const first = await collect(), second = await collect(); await this.identity(s, signal); const done = cellV3Clock(this.now());
    if (done < start || done - start > 30000 || canonicalJson(first) !== canonicalJson(second)) cellV3Fail("CELL_PARENT_DELETE_INSPECT_READ_DRIFT");
    const body = { schemaVersion: 4 as const, protocol: "cell-parent-exact-delete-observation-v4" as const, intentSha256: intent.intentSha256, observedAt: done,
      outcome: second.event ? `${second.event.status}_TOKEN_MATCHED` as CellParentDeleteObservationV4["outcome"] : "PRESENT_NOT_ATTRIBUTED" as const,
      stackStatus: second.status, eventSha256: second.event ? await sha256Hex(second.event) : null, deletionAuthorized: false as const, retryAuthorized: false as const };
    const o = cellV3Freeze({ ...body, observationSha256: await sha256Hex(body) }); observations.add(o); return o;
  }
}
export function createCellParentDeleteSdkV4(credentials: unknown) {
  const config = { region: "ca-central-1", ignoreConfiguredEndpointUrls: true, credentials: credentials as never, maxAttempts: 1 }, sts = new STSClient(config), cfn = new CloudFormationClient(config);
  const sdk: CellParentDeleteSdkV4 = { sts: sts as unknown as Client, cfn: cfn as unknown as Client, commands: { identity: GetCallerIdentityCommand as unknown as Command,
    deleteStack: DeleteStackCommand as unknown as Command, describe: DescribeStacksCommand as unknown as Command, events: DescribeStackEventsCommand as unknown as Command } };
  return { sdk, dispose: () => { sts.destroy(); cfn.destroy(); } };
}
