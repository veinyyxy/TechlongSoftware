import { canonicalJson, sha256Hex } from "./hash.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_KEY, validateSharedCellAuthorityItem, type SharedCellCleanupAuthoritySnapshot } from "./shared-cell-cleanup-authority.ts";
import { assertSharedCellAdmissionDrainReceipt, compileSharedCellAdmissionDrainIntent, type SharedCellAdmissionFenceWriter } from "./shared-cell-admission-fence.ts";
import { isCertifiedSealedCellOwnershipSnapshotV3 } from "./neon-sealed-cell-ownership-source-v3.ts";
import { sealedCellOwnershipStateV3, type CertifiedSealedCellOwnershipSourceV3 } from "./sealed-cell-cleanup-evidence-v3.ts";
import type { CellTtlCleanupJobProducer } from "./prepared-cell-drain-coordinator.ts";

export class SealedCellDrainErrorV3 extends Error { readonly code: string; constructor(code: string) { super(code); this.code = code; } }
function fail(code: string): never { throw new SealedCellDrainErrorV3(code); }
const exact = (v: unknown, keys: string[]) => v !== null && typeof v === "object" && !Array.isArray(v) && canonicalJson(Object.keys(v).sort()) === canonicalJson([...keys].sort());
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
export function validateSealedCellDrainEventV3(v: unknown) {
  const e = v as Record<string, unknown>;
  if (!exact(v, ["schemaVersion", "action", "expectedProvisionItemSha256", "approvedDrainIntentSha256", "certificateSha256"]) || e.schemaVersion !== 3 || e.action !== "coordinate_reviewed_sealed_cell_ttl_cleanup_v3" ||
    [e.expectedProvisionItemSha256, e.approvedDrainIntentSha256, e.certificateSha256].some(x => typeof x !== "string" || !/^[a-f0-9]{64}$/.test(x))) fail("SEALED_DRAIN_EVENT_INVALID");
  return freeze({ schemaVersion: 3 as const, action: "coordinate_reviewed_sealed_cell_ttl_cleanup_v3" as const, expectedProvisionItemSha256: e.expectedProvisionItemSha256 as string,
    approvedDrainIntentSha256: e.approvedDrainIntentSha256 as string, certificateSha256: e.certificateSha256 as string });
}
/** Reader and writer are separate capabilities. No schema2 fallback, authority issuer, journal or deleter. */
export function createPreparedSealedCellDrainCoordinatorV3(input: {
  authority: { observe(request: { authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY; signal: AbortSignal }): Promise<SharedCellCleanupAuthoritySnapshot> };
  admissions: SharedCellAdmissionFenceWriter; jobs: CellTtlCleanupJobProducer; source: CertifiedSealedCellOwnershipSourceV3; certificateSha256: string; now?: () => number;
}) {
  if (!exact(input, input.now === undefined ? ["authority", "admissions", "jobs", "source", "certificateSha256"] : ["authority", "admissions", "jobs", "source", "certificateSha256", "now"]) ||
    typeof input.authority?.observe !== "function" || typeof input.admissions?.beginAdmissionDrain !== "function" || typeof input.jobs?.enqueueOwnedCleanupJobs !== "function" ||
    typeof input.source?.readCertifiedSerializableSnapshot !== "function" || !/^[a-f0-9]{64}$/.test(input.certificateSha256) || (input.now !== undefined && typeof input.now !== "function")) fail("SEALED_DRAIN_CAPABILITIES_INVALID");
  const observe = input.authority.observe.bind(input.authority), begin = input.admissions.beginAdmissionDrain.bind(input.admissions), enqueue = input.jobs.enqueueOwnedCleanupJobs.bind(input.jobs);
  const read = input.source.readCertifiedSerializableSnapshot.bind(input.source), certificateSha256 = input.certificateSha256, now = input.now ?? Date.now;
  const clock = () => { let n: number; try { n = now(); } catch { return fail("SEALED_DRAIN_CLOCK_INVALID"); } if (!Number.isSafeInteger(n) || n <= 0) fail("SEALED_DRAIN_CLOCK_INVALID"); return n; };
  return Object.freeze({ mode: "prepared_not_installed" as const, cloudRuntimeInstalled: false as const,
    async run(rawEvent: unknown, signal: AbortSignal) {
      const event = validateSealedCellDrainEventV3(rawEvent); if (event.certificateSha256 !== certificateSha256) fail("SEALED_DRAIN_CERTIFICATE_APPROVAL_MISMATCH"); signal.throwIfAborted();
      async function predecessor() {
        const r = structuredClone(await observe({ authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY, signal })); signal.throwIfAborted();
        if (!r.item || r.authorityKey !== SHARED_CELL_CLEANUP_AUTHORITY_KEY || r.revision !== r.item.revision || await sha256Hex(r.item) !== event.expectedProvisionItemSha256) fail("SEALED_DRAIN_PREDECESSOR_DRIFT");
        const p = await validateSharedCellAuthorityItem(r.item); if (p.record.state !== "provision_verified") fail("SEALED_DRAIN_PREDECESSOR_STATE_INVALID"); return p.record;
      }
      const initial = await predecessor(), intent = await compileSharedCellAdmissionDrainIntent(initial);
      if (intent.fenceSha256 !== event.approvedDrainIntentSha256) fail("SEALED_DRAIN_APPROVAL_MISMATCH");
      if (clock() < intent.cellExpiresAt) fail("SEALED_DRAIN_NOT_DUE");
      await predecessor(); signal.throwIfAborted(); const receipt = freeze(structuredClone(await begin({ predecessor: initial, signal }))); signal.throwIfAborted();
      assertSharedCellAdmissionDrainReceipt(receipt, { predecessor: initial, fenceSha256: intent.fenceSha256, cellExpiresAt: intent.cellExpiresAt });
      async function ownership() {
        await predecessor(); const started = clock();
        const s = await read({ accountId: "402010193138", region: "ca-central-1", cellId: "cell-sandbox-1", environmentId: "env_aws_sandbox_ca_central_1", signal }); signal.throwIfAborted();
        if (!isCertifiedSealedCellOwnershipSnapshotV3(s)) fail("SEALED_DRAIN_SOURCE_UNVERIFIED");
        const done = clock();
        if (done < started || done - started > 30000 || s.dbObservedAt > done || done - s.dbObservedAt > 30000 || s.dbObservedAt < receipt.admissionChangedAt ||
          s.admissionState !== "draining" || s.admissionEpoch !== receipt.admissionEpoch || s.admissionFenceSha256 !== receipt.admissionFenceSha256 ||
          s.admissionProvisionOperationHash !== initial.provisionOperationHash || s.admissionStackId !== initial.stackId || s.admissionCellExpiresAt !== intent.cellExpiresAt ||
          s.admissionChangedAt !== receipt.admissionChangedAt || s.sealedCertificates.length !== 1 || await sha256Hex(s.sealedCertificates[0]) !== certificateSha256 ||
          await sha256Hex(sealedCellOwnershipStateV3(s)) !== s.ownershipStateSha256) fail("SEALED_DRAIN_SOURCE_OR_LINEAGE_MISMATCH");
        // An old protected instance becoming a live resource is never turned into a cleanup job.
        if (s.liveTenantResourceIds.includes(s.sealedCertificates[0].app_instance_id)) fail("SEALED_DRAIN_PROTECTED_RESOURCE_REQUIRES_REVIEW");
        await predecessor(); const final = clock();
        if (final < done || final - started > 30000 || s.dbObservedAt > final || final - s.dbObservedAt > 30000) fail("SEALED_DRAIN_SOURCE_STALE"); return s;
      }
      // Validate the current full certificate/catalog/raw witnesses before any job INSERT.
      await ownership(); signal.throwIfAborted(); const jobs = await enqueue({ drain: receipt, signal }); signal.throwIfAborted(); const after = clock();
      if (!exact(jobs, ["schemaVersion", "admissionFenceSha256", "insertedCount", "activeCount", "blockedCount", "targetCount", "dbObservedAt"]) || jobs.schemaVersion !== 1 || jobs.admissionFenceSha256 !== intent.fenceSha256 ||
        [jobs.insertedCount, jobs.activeCount, jobs.blockedCount, jobs.targetCount].some(n => !Number.isSafeInteger(n) || n < 0 || n > 10) || jobs.insertedCount + jobs.activeCount + jobs.blockedCount !== jobs.targetCount ||
        !Number.isSafeInteger(jobs.dbObservedAt) || jobs.dbObservedAt < receipt.admissionChangedAt || jobs.dbObservedAt > after || after - jobs.dbObservedAt > 30000) fail("SEALED_DRAIN_JOB_RECEIPT_INVALID");
      const s = await ownership(), counts = { activeTenantCount: s.activeTenantIds.length, activeCapacityReservationCount: s.activeCapacityReservationIds.length,
        nonterminalDeploymentCount: s.nonterminalDeploymentIds.length, liveTenantResourceCount: s.liveTenantResourceIds.length, nonterminalTenantCleanupScheduleCount: s.nonterminalTenantCleanupScheduleIds.length };
      return freeze({ schemaVersion: 3, mode: "prepared_not_installed", outcome: jobs.blockedCount > 0 ? "BLOCKED_CLEANUP_JOB_REQUIRES_REVIEW" : Object.values(counts).every(n => n === 0) ? "ZERO_TENANT_READY_FOR_AUTHORITY_REVIEW_V3" : "TENANT_CLEANUP_PENDING",
        expectedProvisionItemSha256: event.expectedProvisionItemSha256, drainIntentSha256: intent.fenceSha256, certificateSha256, drainReceipt: receipt, jobReceipt: jobs, ownershipCounts: counts,
        ownershipStateSha256: s.ownershipStateSha256, rawOwnershipWitnessSha256: await sha256Hex(s.rawOwnershipWitness),
        authorityWritePerformed: false, cellDeletionPerformed: false, runtimeActivationAuthorized: false });
    },
  });
}
