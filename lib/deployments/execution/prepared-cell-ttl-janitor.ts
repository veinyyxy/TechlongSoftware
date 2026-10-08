import { canonicalJson, sha256Hex } from "./hash.ts";
import {
  executeReviewedSharedCellCleanupDeletion,
  inspectSharedCellCleanupDeletion,
  recoverReviewedSharedCellCleanupDeletion,
  createDedicatedCellTtlDeletionProtocolV2,
  DEDICATED_CELL_TTL_EXECUTOR_ROLE_ARN,
  DEDICATED_CELL_TTL_IDENTITY_PROTOCOL,
  SHARED_CELL_CLEANUP_DELETION_ROLE_ARN,
  SHARED_CELL_CLEANUP_DELETION_STACK_NAME,
  type SharedCellCleanupDeleteStackPort,
  type SharedCellCleanupDeletionEvidenceReadPort,
  type SharedCellCleanupDeletionSummary,
  type DedicatedCellTtlDeletionSummary,
  type StrongSharedCellCleanupAuthorityReadPort,
} from "./shared-cell-cleanup-deletion.ts";

type CleanupSummary = SharedCellCleanupDeletionSummary | DedicatedCellTtlDeletionSummary;
export interface PreparedCellCleanupIntent<T extends CleanupSummary = SharedCellCleanupDeletionSummary> {
  schemaVersion: T["schemaVersion"];
  plan: Readonly<T>;
}
export interface PreparedCellCleanupReceipt<T extends CleanupSummary = SharedCellCleanupDeletionSummary> {
  schemaVersion: T["schemaVersion"];
  result: Readonly<T>;
}
export interface PreparedCellCleanupJournal<T extends CleanupSummary = SharedCellCleanupDeletionSummary> {
  readStrong(input: { planSha256: string; signal: AbortSignal }): Promise<{
    intent: unknown | null; receipt: unknown | null;
  }>;
  /** Permanent attribute_not_exists slot. Never reset, expire or overwrite. */
  claimIntent(input: { intent: Readonly<PreparedCellCleanupIntent<T>>; signal: AbortSignal }): Promise<boolean>;
  /** Append-only separate receipt key; a concurrent first receipt is retained. */
  publishReceipt(input: { receipt: Readonly<PreparedCellCleanupReceipt<T>>; signal: AbortSignal }): Promise<void>;
}
export interface PreparedCellTtlJanitorInput<T extends CleanupSummary = SharedCellCleanupDeletionSummary> {
  evidence: SharedCellCleanupDeletionEvidenceReadPort;
  authority: StrongSharedCellCleanupAuthorityReadPort;
  deleter: SharedCellCleanupDeleteStackPort;
  journal: PreparedCellCleanupJournal<T>;
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
async function checkedSummary<T extends CleanupSummary>(value: unknown, planSha256: string, intent: boolean, schemaVersion: T["schemaVersion"]) {
  digest(planSha256);
  let summary: Record<string, unknown>;
  try { summary = object(structuredClone(value)); } catch { return fail("CELL_TTL_JOURNAL_INVALID"); }
  if (!keys(summary, schemaVersion === 1 ? summaryKeys : [...summaryKeys, "executorIdentityProtocol", "executorRoleArn"])) fail("CELL_TTL_JOURNAL_INVALID");
  if (summary.schemaVersion !== schemaVersion || (schemaVersion === 2 &&
      (summary.executorIdentityProtocol !== DEDICATED_CELL_TTL_IDENTITY_PROTOCOL || summary.executorRoleArn !== DEDICATED_CELL_TTL_EXECUTOR_ROLE_ARN)) ||
      summary.action !== "delete_shared_cell_stack" ||
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
  return Object.freeze(summary) as unknown as Readonly<T>;
}
export async function validatePreparedCellCleanupIntent(value: unknown, planSha256: string): Promise<Readonly<PreparedCellCleanupIntent>> {
  if (!keys(value, ["schemaVersion", "plan"]) || object(value).schemaVersion !== 1) fail("CELL_TTL_JOURNAL_INVALID");
  return Object.freeze({ schemaVersion: 1, plan: await checkedSummary<SharedCellCleanupDeletionSummary>(object(value).plan, planSha256, true, 1) });
}
export async function validatePreparedCellCleanupReceipt(value: unknown, planSha256: string): Promise<Readonly<PreparedCellCleanupReceipt>> {
  if (!keys(value, ["schemaVersion", "result"]) || object(value).schemaVersion !== 1) fail("CELL_TTL_JOURNAL_INVALID");
  return Object.freeze({ schemaVersion: 1, result: await checkedSummary<SharedCellCleanupDeletionSummary>(object(value).result, planSha256, false, 1) });
}
export async function validateDedicatedCellCleanupIntentV2(value: unknown, planSha256: string): Promise<Readonly<PreparedCellCleanupIntent<DedicatedCellTtlDeletionSummary>>> {
  if (!keys(value, ["schemaVersion", "plan"]) || object(value).schemaVersion !== 2) fail("CELL_TTL_JOURNAL_INVALID");
  return Object.freeze({ schemaVersion: 2, plan: await checkedSummary<DedicatedCellTtlDeletionSummary>(object(value).plan, planSha256, true, 2) });
}
export async function validateDedicatedCellCleanupReceiptV2(value: unknown, planSha256: string): Promise<Readonly<PreparedCellCleanupReceipt<DedicatedCellTtlDeletionSummary>>> {
  if (!keys(value, ["schemaVersion", "result"]) || object(value).schemaVersion !== 2) fail("CELL_TTL_JOURNAL_INVALID");
  return Object.freeze({ schemaVersion: 2, result: await checkedSummary<DedicatedCellTtlDeletionSummary>(object(value).result, planSha256, false, 2) });
}
interface CleanupProtocol<T extends CleanupSummary> {
  schemaVersion: T["schemaVersion"];
  eventAction: string;
  inspect(input: Parameters<typeof inspectSharedCellCleanupDeletion>[0]): Promise<Readonly<T>>;
  execute(input: Parameters<typeof executeReviewedSharedCellCleanupDeletion>[0]): Promise<Readonly<T>>;
  recover(input: Parameters<typeof recoverReviewedSharedCellCleanupDeletion>[0]): Promise<Readonly<T>>;
  validateIntent(value: unknown, planSha256: string): Promise<Readonly<PreparedCellCleanupIntent<T>>>;
  validateReceipt(value: unknown, planSha256: string): Promise<Readonly<PreparedCellCleanupReceipt<T>>>;
}

/**
 * Executable but UNINSTALLED capability. Does not touch the legacy PLAN_ONLY
 * Lambda, construct cloud clients, activate Worker, advance authority or drain
 * admission. The existing executor still enforces expiry, caller, exact Stack,
 * template/inventory, strong authority and serializable zero-tenant fences.
 */
function createBoundPreparedCellTtlJanitor<T extends CleanupSummary>(input: PreparedCellTtlJanitorInput<T>, protocol: CleanupProtocol<T>) {
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
      if (!keys(event, ["schemaVersion", "action", "approvedDeletionPlanSha256"]) || object(event).schemaVersion !== protocol.schemaVersion ||
          object(event).action !== protocol.eventAction) fail("CELL_TTL_EVENT_INVALID");
      const planSha256 = object(event).approvedDeletionPlanSha256; digest(planSha256);
      signal.throwIfAborted();
      async function read() {
        const snapshot = await journal.readStrong({ planSha256: planSha256 as string, signal });
        signal.throwIfAborted();
        if (!keys(snapshot, ["intent", "receipt"])) fail("CELL_TTL_JOURNAL_INVALID");
        const intent = snapshot.intent === null ? null : await protocol.validateIntent(snapshot.intent, planSha256 as string);
        const receipt = snapshot.receipt === null ? null : await protocol.validateReceipt(snapshot.receipt, planSha256 as string);
        if (receipt && !intent) fail("CELL_TTL_RECEIPT_WITHOUT_INTENT");
        return { intent, receipt };
      }
      function result(receipt: Readonly<PreparedCellCleanupReceipt<T>>, attempted: boolean, replay: boolean) {
        return Object.freeze({ schemaVersion: protocol.schemaVersion, mode: "prepared_not_installed" as const,
          outcome: replay ? "IMMUTABLE_RECEIPT_REPLAYED" as const : "DELETION_INDEPENDENTLY_VERIFIED" as const,
          deleteStackAttempted: attempted, cloudRuntimeInstalled: false as const, receipt });
      }
      const previous = await read();
      if (previous.receipt) return result(previous.receipt, false, true); // historical proof, not a new live readback
      let intent = previous.intent;
      let ownsSlot = false;
      if (!intent) {
        const plan = await protocol.inspect({ evidence, authority, signal, now: settings.now });
        if (plan.deletionPlanSha256 !== planSha256) fail("CELL_TTL_APPROVAL_MISMATCH");
        const proposed = await protocol.validateIntent({ schemaVersion: protocol.schemaVersion, plan }, planSha256);
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
      const summary = ownsSlot ? await protocol.execute({ ...common, deleter: {
        deleteStack: async request => { attempted = true; return deleter.deleteStack(request); },
      } }) : await protocol.recover(common);
      if (!intent || summary.deletionPlanSha256 !== intent.plan.deletionPlanSha256) fail("CELL_TTL_RESULT_MISMATCH");
      const receipt = await protocol.validateReceipt({ schemaVersion: protocol.schemaVersion, result: summary }, planSha256);
      // A lost receipt response never replays DeleteStack or a receipt write.
      // Exact readback accepts the first valid receipt from a concurrent recovery.
      try { await journal.publishReceipt({ receipt, signal }); } catch { /* independent strong read below */ }
      const saved = await read();
      if (!saved.receipt) fail("CELL_TTL_RECEIPT_WRITE_UNCERTAIN_RECOVER_ONLY");
      return result(saved.receipt, attempted, false);
    },
  });
}
export function createPreparedCellTtlJanitor(input: PreparedCellTtlJanitorInput) {
  return createBoundPreparedCellTtlJanitor(input, {
    schemaVersion: 1, eventAction: "execute_reviewed_cell_ttl_cleanup",
    inspect: inspectSharedCellCleanupDeletion, execute: executeReviewedSharedCellCleanupDeletion, recover: recoverReviewedSharedCellCleanupDeletion,
    validateIntent: validatePreparedCellCleanupIntent, validateReceipt: validatePreparedCellCleanupReceipt,
  });
}
export function createPreparedDedicatedCellTtlExecutorV2(input: PreparedCellTtlJanitorInput<DedicatedCellTtlDeletionSummary>) {
  return createBoundPreparedCellTtlJanitor(input, {
    schemaVersion: 2, eventAction: "execute_reviewed_dedicated_cell_ttl_cleanup",
    ...createDedicatedCellTtlDeletionProtocolV2(),
    validateIntent: validateDedicatedCellCleanupIntentV2, validateReceipt: validateDedicatedCellCleanupReceiptV2,
  });
}
