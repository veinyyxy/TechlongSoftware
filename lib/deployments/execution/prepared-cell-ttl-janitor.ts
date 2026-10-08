import { canonicalJson, sha256Hex } from "./hash.ts";
import {
  executeReviewedSharedCellCleanupDeletion,
  inspectSharedCellCleanupDeletion,
  recoverReviewedSharedCellCleanupDeletion,
  SHARED_CELL_CLEANUP_DELETION_ROLE_ARN,
  SHARED_CELL_CLEANUP_DELETION_STACK_NAME,
  type SharedCellCleanupDeleteStackPort,
  type SharedCellCleanupDeletionEvidenceReadPort,
  type SharedCellCleanupDeletionSummary,
  type StrongSharedCellCleanupAuthorityReadPort,
} from "./shared-cell-cleanup-deletion.ts";

export interface PreparedCellCleanupIntent {
  schemaVersion: 1;
  plan: Readonly<SharedCellCleanupDeletionSummary>;
}
export interface PreparedCellCleanupReceipt {
  schemaVersion: 1;
  result: Readonly<SharedCellCleanupDeletionSummary>;
}
export interface PreparedCellCleanupJournal {
  readStrong(input: { planSha256: string; signal: AbortSignal }): Promise<{
    intent: unknown | null; receipt: unknown | null;
  }>;
  /** Permanent attribute_not_exists slot. Never reset, expire or overwrite. */
  claimIntent(input: { intent: Readonly<PreparedCellCleanupIntent>; signal: AbortSignal }): Promise<boolean>;
  /** Append-only separate receipt key; a concurrent first receipt is retained. */
  publishReceipt(input: { receipt: Readonly<PreparedCellCleanupReceipt>; signal: AbortSignal }): Promise<void>;
}
export interface PreparedCellTtlJanitorInput {
  evidence: SharedCellCleanupDeletionEvidenceReadPort;
  authority: StrongSharedCellCleanupAuthorityReadPort;
  deleter: SharedCellCleanupDeleteStackPort;
  journal: PreparedCellCleanupJournal;
  now?: () => number;
  readbackAttempts?: number;
  readbackDelayMs?: number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}
export class PreparedCellTtlJanitorError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function fail(code: string): never { throw new PreparedCellTtlJanitorError(code); }
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function keys(value: unknown, expected: readonly string[]): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(object(value)).sort()) === canonicalJson([...expected].sort());
}
const summaryKeys = [
  "schemaVersion", "action", "accountId", "region", "cellId", "stackName", "stackId", "roleArn",
  "cellExpiresAt", "templateCanonicalSha256", "resourceInventorySha256", "ownerDeploymentId", "generation",
  "provisionEpoch", "provisionMarker", "provisionOperationHash", "cleanupEpoch", "cleanupMarker",
  "cleanupOperationHash", "cleanupExpiresAt", "authorityRevision", "authorityRecordHash",
  "zeroTenantSourceSnapshotSha256", "phase", "mutationPerformed", "deletionPlanSha256", "clientRequestToken",
] as const;
function digest(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("CELL_TTL_PLAN_INVALID");
}
async function checkedSummary(value: unknown, planSha256: string, intent: boolean) {
  digest(planSha256);
  let summary: Record<string, unknown>;
  try { summary = object(structuredClone(value)); } catch { return fail("CELL_TTL_JOURNAL_INVALID"); }
  if (!keys(summary, summaryKeys)) fail("CELL_TTL_JOURNAL_INVALID");
  if (summary.schemaVersion !== 1 || summary.action !== "delete_shared_cell_stack" ||
      summary.accountId !== "402010193138" || summary.region !== "ca-central-1" || summary.cellId !== "cell-sandbox-1" ||
      summary.stackName !== SHARED_CELL_CLEANUP_DELETION_STACK_NAME || summary.roleArn !== SHARED_CELL_CLEANUP_DELETION_ROLE_ARN ||
      typeof summary.stackId !== "string" || !/^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(summary.stackId) ||
      summary.deletionPlanSha256 !== planSha256 || summary.clientRequestToken !== `cell-delete-${planSha256}` ||
      (intent ? summary.phase !== "INSPECTED" || summary.mutationPerformed !== false :
        !["DELETED", "RECOVERED"].includes(String(summary.phase)) || typeof summary.mutationPerformed !== "boolean" ||
          (summary.phase === "DELETED" && summary.mutationPerformed !== true))) fail("CELL_TTL_JOURNAL_INVALID");
  const bound = Object.fromEntries(Object.entries(summary).filter(([key]) =>
    !["phase", "mutationPerformed", "deletionPlanSha256", "clientRequestToken"].includes(key)));
  if (await sha256Hex(bound) !== planSha256) fail("CELL_TTL_JOURNAL_PLAN_MISMATCH");
  return Object.freeze(summary) as unknown as Readonly<SharedCellCleanupDeletionSummary>;
}
export async function validatePreparedCellCleanupIntent(value: unknown, planSha256: string): Promise<Readonly<PreparedCellCleanupIntent>> {
  if (!keys(value, ["schemaVersion", "plan"]) || object(value).schemaVersion !== 1) fail("CELL_TTL_JOURNAL_INVALID");
  return Object.freeze({ schemaVersion: 1, plan: await checkedSummary(object(value).plan, planSha256, true) });
}
export async function validatePreparedCellCleanupReceipt(value: unknown, planSha256: string): Promise<Readonly<PreparedCellCleanupReceipt>> {
  if (!keys(value, ["schemaVersion", "result"]) || object(value).schemaVersion !== 1) fail("CELL_TTL_JOURNAL_INVALID");
  return Object.freeze({ schemaVersion: 1, result: await checkedSummary(object(value).result, planSha256, false) });
}

/**
 * Executable but UNINSTALLED capability. Does not touch the legacy PLAN_ONLY
 * Lambda, construct cloud clients, activate Worker, advance authority or drain
 * admission. The existing executor still enforces expiry, caller, exact Stack,
 * template/inventory, strong authority and serializable zero-tenant fences.
 */
export function createPreparedCellTtlJanitor(input: PreparedCellTtlJanitorInput) {
  const required = ["evidence", "authority", "deleter", "journal"];
  const allowed = [...required, "now", "readbackAttempts", "readbackDelayMs", "wait"];
  const evidenceMethods = ["getCallerIdentity", "listStackNamesPage", "describeCellStack", "getOriginalTemplate", "listStackResourcesPage", "readStrongZeroTenantOwnershipSnapshot"];
  if (!input || required.some(key => !Object.hasOwn(input, key)) || Object.keys(input).some(key => !allowed.includes(key)) ||
      evidenceMethods.some(key => typeof object(input.evidence)[key] !== "function") || typeof input.authority?.readStrong !== "function" ||
      typeof input.deleter?.deleteStack !== "function" || ["readStrong", "claimIntent", "publishReceipt"].some(key =>
        typeof object(input.journal)[key] !== "function")) fail("CELL_TTL_CAPABILITIES_INVALID");
  const source = input.evidence;
  const evidence = Object.freeze({
    region: source.region,
    getCallerIdentity: source.getCallerIdentity.bind(source),
    listStackNamesPage: source.listStackNamesPage.bind(source),
    describeCellStack: source.describeCellStack.bind(source),
    getOriginalTemplate: source.getOriginalTemplate.bind(source),
    listStackResourcesPage: source.listStackResourcesPage.bind(source),
    readStrongZeroTenantOwnershipSnapshot: source.readStrongZeroTenantOwnershipSnapshot.bind(source),
  });
  const authority = Object.freeze({ readStrong: input.authority.readStrong.bind(input.authority) });
  const deleter = Object.freeze({ deleteStack: input.deleter.deleteStack.bind(input.deleter) });
  const journal = Object.freeze({
    readStrong: input.journal.readStrong.bind(input.journal),
    claimIntent: input.journal.claimIntent.bind(input.journal),
    publishReceipt: input.journal.publishReceipt.bind(input.journal),
  });
  const settings = { now: input.now ?? Date.now,
    ...(input.readbackAttempts === undefined ? {} : { readbackAttempts: input.readbackAttempts }),
    ...(input.readbackDelayMs === undefined ? {} : { readbackDelayMs: input.readbackDelayMs }),
    ...(input.wait === undefined ? {} : { wait: input.wait }),
  };
  return Object.freeze({
    mode: "prepared_not_installed" as const,
    cloudRuntimeInstalled: false as const,
    async run(event: unknown, signal: AbortSignal) {
      if (!keys(event, ["schemaVersion", "action", "approvedDeletionPlanSha256"]) || object(event).schemaVersion !== 1 ||
          object(event).action !== "execute_reviewed_cell_ttl_cleanup") fail("CELL_TTL_EVENT_INVALID");
      const planSha256 = object(event).approvedDeletionPlanSha256; digest(planSha256);
      signal.throwIfAborted();
      async function read() {
        const snapshot = await journal.readStrong({ planSha256: planSha256 as string, signal });
        signal.throwIfAborted();
        if (!keys(snapshot, ["intent", "receipt"])) fail("CELL_TTL_JOURNAL_INVALID");
        const intent = snapshot.intent === null ? null : await validatePreparedCellCleanupIntent(snapshot.intent, planSha256 as string);
        const receipt = snapshot.receipt === null ? null : await validatePreparedCellCleanupReceipt(snapshot.receipt, planSha256 as string);
        if (receipt && !intent) fail("CELL_TTL_RECEIPT_WITHOUT_INTENT");
        return { intent, receipt };
      }
      function result(receipt: Readonly<PreparedCellCleanupReceipt>, attempted: boolean, replay: boolean) {
        return Object.freeze({ schemaVersion: 1 as const, mode: "prepared_not_installed" as const,
          outcome: replay ? "IMMUTABLE_RECEIPT_REPLAYED" as const : "DELETION_INDEPENDENTLY_VERIFIED" as const,
          deleteStackAttempted: attempted, cloudRuntimeInstalled: false as const, receipt });
      }
      const previous = await read();
      if (previous.receipt) return result(previous.receipt, false, true); // historical proof, not a new live readback
      let intent = previous.intent;
      let ownsSlot = false;
      if (!intent) {
        const plan = await inspectSharedCellCleanupDeletion({ evidence, authority, signal, now: settings.now });
        if (plan.deletionPlanSha256 !== planSha256) fail("CELL_TTL_APPROVAL_MISMATCH");
        const proposed = await validatePreparedCellCleanupIntent({ schemaVersion: 1, plan }, planSha256);
        try { ownsSlot = await journal.claimIntent({ intent: proposed, signal }); }
        catch { fail("CELL_TTL_SLOT_WRITE_UNCERTAIN_RECOVER_ONLY"); }
        if (typeof ownsSlot !== "boolean") fail("CELL_TTL_SLOT_RESULT_INVALID");
        // Persisted intent is checked BEFORE delegating. The core then collects
        // fresh evidence again AFTER this potentially slow DynamoDB write.
        const observed = await read();
        if (!observed.intent || canonicalJson(observed.intent) !== canonicalJson(proposed)) fail("CELL_TTL_SLOT_READBACK_MISMATCH");
        if (observed.receipt) return result(observed.receipt, false, true);
        intent = observed.intent;
      }
      signal.throwIfAborted();
      let attempted = false;
      const common = { evidence, authority, signal, ...settings, approvedDeletionPlanSha256: planSha256 };
      const summary = ownsSlot ? await executeReviewedSharedCellCleanupDeletion({ ...common, deleter: {
        deleteStack: async request => { attempted = true; return deleter.deleteStack(request); },
      } }) : await recoverReviewedSharedCellCleanupDeletion(common);
      if (!intent || summary.deletionPlanSha256 !== intent.plan.deletionPlanSha256) fail("CELL_TTL_RESULT_MISMATCH");
      const receipt = await validatePreparedCellCleanupReceipt({ schemaVersion: 1, result: summary }, planSha256);
      // A lost receipt response never replays DeleteStack or a receipt write.
      // Exact readback accepts the first valid receipt from a concurrent recovery.
      try { await journal.publishReceipt({ receipt, signal }); } catch { /* independent strong read below */ }
      const saved = await read();
      if (!saved.receipt) fail("CELL_TTL_RECEIPT_WRITE_UNCERTAIN_RECOVER_ONLY");
      return result(saved.receipt, attempted, false);
    },
  });
}
