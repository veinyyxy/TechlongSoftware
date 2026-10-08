import { canonicalJson, sha256Hex } from "./hash.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_KEY, validateSharedCellAuthorityItem, type SharedCellCleanupAuthoritySnapshot } from "./shared-cell-cleanup-authority.ts";
import { assertSharedCellAdmissionDrainReceipt, compileSharedCellAdmissionDrainIntent, type SharedCellAdmissionDrainReceipt, type SharedCellAdmissionFenceWriter } from "./shared-cell-admission-fence.ts";
import type { SharedCellCleanupDeletionEvidenceReadPort } from "./shared-cell-cleanup-deletion.ts";

export interface CellTtlCleanupJobReceipt {
  schemaVersion: 1;
  admissionFenceSha256: string;
  insertedCount: number;
  activeCount: number;
  blockedCount: number;
  targetCount: number;
  dbObservedAt: number;
}
export interface CellTtlCleanupJobProducer {
  enqueueOwnedCleanupJobs(input: { drain: Readonly<SharedCellAdmissionDrainReceipt>; signal: AbortSignal }): Promise<Readonly<CellTtlCleanupJobReceipt>>;
}
export class CellDrainCoordinatorError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function fail(code: string): never { throw new CellDrainCoordinatorError(code); }
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function keys(value: unknown, expected: string[]) {
  return canonicalJson(Object.keys(object(value)).sort()) === canonicalJson([...expected].sort());
}
export function validateCellDrainEvent(value: unknown) {
  const event = object(value);
  if (!keys(value, ["schemaVersion", "action", "expectedProvisionItemSha256", "approvedDrainIntentSha256"]) ||
    event.schemaVersion !== 1 || event.action !== "coordinate_reviewed_cell_ttl_cleanup" ||
    ![event.expectedProvisionItemSha256, event.approvedDrainIntentSha256].every(v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v))) fail("CELL_DRAIN_EVENT_INVALID");
  return Object.freeze({ schemaVersion: 1 as const, action: "coordinate_reviewed_cell_ttl_cleanup" as const,
    expectedProvisionItemSha256: event.expectedProvisionItemSha256 as string, approvedDrainIntentSha256: event.approvedDrainIntentSha256 as string });
}

/** No authority CAS or cloud deletion capability is accepted by this root. */
export function createPreparedCellDrainCoordinator(input: {
  authority: { observe(request: { authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY; signal: AbortSignal }): Promise<SharedCellCleanupAuthoritySnapshot> };
  admissions: SharedCellAdmissionFenceWriter;
  jobs: CellTtlCleanupJobProducer;
  ownership: Pick<SharedCellCleanupDeletionEvidenceReadPort, "readStrongZeroTenantOwnershipSnapshot">;
  now?: () => number;
}) {
  const required = ["authority", "admissions", "jobs", "ownership"];
  if (!input || required.some(key => !Object.hasOwn(input, key)) || Object.keys(input).some(key => ![...required, "now"].includes(key)) ||
    typeof input.authority?.observe !== "function" || typeof input.admissions?.beginAdmissionDrain !== "function" ||
    typeof input.jobs?.enqueueOwnedCleanupJobs !== "function" || typeof input.ownership?.readStrongZeroTenantOwnershipSnapshot !== "function" ||
    (input.now !== undefined && typeof input.now !== "function")) fail("CELL_DRAIN_CAPABILITIES_INVALID");
  const observe = input.authority.observe.bind(input.authority);
  const drain = input.admissions.beginAdmissionDrain.bind(input.admissions);
  const enqueue = input.jobs.enqueueOwnedCleanupJobs.bind(input.jobs);
  const readOwnership = input.ownership.readStrongZeroTenantOwnershipSnapshot.bind(input.ownership);
  const now = input.now ?? Date.now;
  function clock() { let value: number; try { value = now(); } catch { return fail("CELL_DRAIN_CLOCK_INVALID"); }
    if (!Number.isSafeInteger(value) || value <= 0) fail("CELL_DRAIN_CLOCK_INVALID"); return value; }
  return Object.freeze({
    mode: "prepared_not_installed" as const,
    async run(rawEvent: unknown, signal: AbortSignal) {
      const event = validateCellDrainEvent(rawEvent); signal.throwIfAborted();
      async function predecessor() {
        const snapshot = structuredClone(await observe({ authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY, signal })); signal.throwIfAborted();
        if (!snapshot.item || snapshot.authorityKey !== SHARED_CELL_CLEANUP_AUTHORITY_KEY || snapshot.revision !== snapshot.item.revision ||
          await sha256Hex(snapshot.item) !== event.expectedProvisionItemSha256) fail("CELL_DRAIN_PREDECESSOR_DRIFT");
        const validated = await validateSharedCellAuthorityItem(snapshot.item);
        if (validated.record.state !== "provision_verified") fail("CELL_DRAIN_PREDECESSOR_STATE_INVALID");
        return validated.record;
      }
      const initial = await predecessor();
      const intent = await compileSharedCellAdmissionDrainIntent(initial);
      if (intent.fenceSha256 !== event.approvedDrainIntentSha256) fail("CELL_DRAIN_APPROVAL_MISMATCH");
      if (clock() < intent.cellExpiresAt) fail("CELL_DRAIN_NOT_DUE");
      // Final strong re-read before DB mutation; database also gates expiry and
      // exact immutable lineage. Each later phase repeats the authority fence.
      await predecessor(); signal.throwIfAborted();
      const receipt = Object.freeze(structuredClone(await drain({ predecessor: initial, signal }))); signal.throwIfAborted();
      assertSharedCellAdmissionDrainReceipt(receipt, { predecessor: initial, fenceSha256: intent.fenceSha256, cellExpiresAt: intent.cellExpiresAt });
      await predecessor(); signal.throwIfAborted();
      const jobs = await enqueue({ drain: receipt, signal }); signal.throwIfAborted();
      const afterEnqueue = clock();
      if (!keys(jobs, ["schemaVersion", "admissionFenceSha256", "insertedCount", "activeCount", "blockedCount", "targetCount", "dbObservedAt"]) ||
        jobs.schemaVersion !== 1 || jobs.admissionFenceSha256 !== intent.fenceSha256 ||
        ![jobs.insertedCount, jobs.activeCount, jobs.blockedCount, jobs.targetCount].every(v => Number.isSafeInteger(v) && v >= 0 && v <= 10) ||
        jobs.insertedCount + jobs.activeCount + jobs.blockedCount !== jobs.targetCount ||
        !Number.isSafeInteger(jobs.dbObservedAt) || jobs.dbObservedAt < receipt.admissionChangedAt || jobs.dbObservedAt > afterEnqueue ||
        afterEnqueue - jobs.dbObservedAt > 30_000) fail("CELL_DRAIN_JOB_RECEIPT_INVALID");
      await predecessor(); signal.throwIfAborted();
      const started = clock();
      const snapshot = object(structuredClone(await readOwnership({ signal }))); signal.throwIfAborted();
      const completed = clock(); const source = object(snapshot.sourceSnapshot); const fence = object(source.admissionFence);
      if (snapshot.schemaVersion !== 1 || snapshot.accountId !== "402010193138" || snapshot.region !== "ca-central-1" ||
        snapshot.cellId !== "cell-sandbox-1" || snapshot.environmentId !== "env_aws_sandbox_ca_central_1" ||
        typeof snapshot.observedAt !== "number" || !Number.isSafeInteger(snapshot.observedAt) || snapshot.observedAt > completed ||
        completed < started || completed - started > 30_000 || completed - snapshot.observedAt > 30_000 || snapshot.observedAt < intent.cellExpiresAt ||
        fence.admissionState !== "draining" || fence.admissionFenceSha256 !== intent.fenceSha256 || fence.admissionEpoch !== receipt.admissionEpoch ||
        fence.admissionStackId !== initial.stackId || fence.admissionProvisionOperationHash !== initial.provisionOperationHash ||
        fence.admissionCellExpiresAt !== intent.cellExpiresAt || fence.admissionChangedAt !== receipt.admissionChangedAt ||
        await sha256Hex(source) !== snapshot.sourceSnapshotSha256) fail("CELL_DRAIN_SNAPSHOT_INVALID");
      const counts: Record<string, number> = {};
      for (const [countKey, listKey] of [
        ["activeTenantCount", "activeTenantIds"], ["activeCapacityReservationCount", "activeCapacityReservationIds"],
        ["nonterminalDeploymentCount", "nonterminalDeploymentIds"], ["liveTenantResourceCount", "liveTenantResourceIds"],
        ["nonterminalTenantCleanupScheduleCount", "nonterminalTenantCleanupScheduleIds"],
      ]) {
        if (!Array.isArray(source[listKey]) || snapshot[countKey] !== source[listKey].length) fail("CELL_DRAIN_SNAPSHOT_INVALID");
        counts[countKey] = source[listKey].length;
      }
      await predecessor(); signal.throwIfAborted();
      const zero = Object.values(counts).every(count => count === 0);
      return Object.freeze({ schemaVersion: 1, mode: "prepared_not_installed", outcome: jobs.blockedCount > 0 ? "BLOCKED_CLEANUP_JOB_REQUIRES_REVIEW" :
        zero ? "ZERO_TENANT_READY_FOR_AUTHORITY_REVIEW" : "TENANT_CLEANUP_PENDING",
      expectedProvisionItemSha256: event.expectedProvisionItemSha256, drainIntentSha256: intent.fenceSha256,
      drainReceipt: receipt, jobReceipt: jobs, ownershipCounts: Object.freeze(counts), ownershipSnapshotSha256: snapshot.sourceSnapshotSha256,
      authorityWritePerformed: false, cellDeletionPerformed: false, runtimeActivationAuthorized: false });
    },
  });
}
