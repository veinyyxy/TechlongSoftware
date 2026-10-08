import { canonicalJson, sha256Hex } from "./hash.ts";
import {
  isCertifiedSealedCellOwnershipSnapshotV3,
  type CertifiedSealedCellOwnershipSnapshotV3,
} from "./neon-sealed-cell-ownership-source-v3.ts";
import { compileSharedCellAdmissionDrainIntent } from "./shared-cell-admission-fence.ts";
import {
  SHARED_CELL_CLEANUP_AUTHORITY_MAX_LIFETIME_MS,
  type SharedCellProvisionAuthorityRecord,
} from "./shared-cell-cleanup-authority.ts";
import {
  isVerifiedSharedCellCleanupStackEvidence,
  type ReadSharedCellCleanupEvidenceInput,
  type VerifiedSharedCellCleanupStackEvidence,
} from "./shared-cell-cleanup-authority-operator.ts";
import type { ReadSerializableSharedCellOwnershipSnapshotInput } from "./shared-cell-zero-tenant-evidence.ts";

const maximumAgeMs = 30_000;
const executorRoleArn = "arn:aws:iam::402010193138:role/TechlongSandboxCellTtlExecutorRole";
const ownershipProofs = new WeakSet<object>();
const authorityCandidates = new WeakSet<object>();

export class SealedCellCleanupEvidenceErrorV3 extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function fail(code: string): never { throw new SealedCellCleanupEvidenceErrorV3(code); }
function exactKeys(value: unknown, expected: readonly string[]): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort());
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
function clock(now: () => number): number {
  let value: number;
  try { value = now(); } catch { return fail("SEALED_V3_CLOCK_INVALID"); }
  if (!Number.isSafeInteger(value) || value <= 0) fail("SEALED_V3_CLOCK_INVALID");
  return value;
}
function fresh(observedAt: number, now: number): void {
  if (observedAt > now || now - observedAt > maximumAgeMs) fail("SEALED_V3_EVIDENCE_STALE");
}
function optionsClock(options: { now?: () => number }): () => number {
  if (!exactKeys(options, options.now === undefined ? [] : ["now"]) ||
    (options.now !== undefined && typeof options.now !== "function")) fail("SEALED_V3_OPTIONS_INVALID");
  return options.now ?? Date.now;
}

/** Only clocks/transport metadata are excluded; no certificate or witness is projected away. */
export function sealedCellOwnershipStateV3(snapshot: CertifiedSealedCellOwnershipSnapshotV3) {
  if (!isCertifiedSealedCellOwnershipSnapshotV3(snapshot)) fail("SEALED_V3_SOURCE_UNVERIFIED");
  const state = { ...snapshot };
  for (const key of ["dbObservedAt", "isolationLevel", "readOnly", "deferrable", "ownershipStateSha256", "runtimeActivationAuthorized"] as const) {
    Reflect.deleteProperty(state, key);
  }
  return freeze(state as Omit<CertifiedSealedCellOwnershipSnapshotV3,
    "dbObservedAt" | "isolationLevel" | "readOnly" | "deferrable" | "ownershipStateSha256" | "runtimeActivationAuthorized">);
}

export interface CertifiedSealedCellOwnershipSourceV3 {
  readCertifiedSerializableSnapshot(input: ReadSerializableSharedCellOwnershipSnapshotInput): Promise<CertifiedSealedCellOwnershipSnapshotV3>;
}
export interface VerifiedSealedCellZeroOwnershipEvidenceV3 {
  readonly schemaVersion: 3;
  readonly protocol: "sealed-cell-zero-ownership-evidence-v3";
  readonly predecessorRecordHash: string;
  readonly snapshot: CertifiedSealedCellOwnershipSnapshotV3;
  readonly checkedAt: number;
  readonly runtimeActivationAuthorized: false;
}

/** Separate port: deliberately does not implement the legacy zero-tenant interface. */
export class SealedCellAuthorityOwnershipEvidenceAdapterV3 {
  private readonly read: CertifiedSealedCellOwnershipSourceV3["readCertifiedSerializableSnapshot"];
  private readonly now: () => number;
  constructor(source: CertifiedSealedCellOwnershipSourceV3, options: { now?: () => number } = {}) {
    if (typeof source?.readCertifiedSerializableSnapshot !== "function") fail("SEALED_V3_SOURCE_MISSING");
    this.read = source.readCertifiedSerializableSnapshot.bind(source);
    this.now = optionsClock(options);
  }
  async readFreshZeroOwnershipEvidence(input: ReadSharedCellCleanupEvidenceInput): Promise<Readonly<VerifiedSealedCellZeroOwnershipEvidenceV3>> {
    if (!exactKeys(input, ["predecessor", "signal"]) || typeof input.signal?.throwIfAborted !== "function") fail("SEALED_V3_INPUT_INVALID");
    input.signal.throwIfAborted();
    // Pin before the first await; the inherited drain compiler validates the full provision lineage.
    const predecessor = freeze(JSON.parse(canonicalJson(input.predecessor)) as SharedCellProvisionAuthorityRecord);
    const startedAt = clock(this.now);
    const drain = await compileSharedCellAdmissionDrainIntent(predecessor);
    input.signal.throwIfAborted();
    if (drain.cellExpiresAt > startedAt) fail("SEALED_V3_CELL_NOT_EXPIRED");
    let snapshot: CertifiedSealedCellOwnershipSnapshotV3;
    try {
      snapshot = await this.read({ accountId: "402010193138", region: "ca-central-1", cellId: "cell-sandbox-1",
        environmentId: "env_aws_sandbox_ca_central_1", signal: input.signal });
    } catch {
      input.signal.throwIfAborted(); return fail("SEALED_V3_SOURCE_READ_FAILED");
    }
    input.signal.throwIfAborted();
    if (!isCertifiedSealedCellOwnershipSnapshotV3(snapshot)) fail("SEALED_V3_SOURCE_UNVERIFIED");
    const completedAt = clock(this.now);
    if (completedAt < startedAt || completedAt - startedAt > maximumAgeMs) fail("SEALED_V3_EVIDENCE_STALE");
    fresh(snapshot.dbObservedAt, completedAt);
    if (snapshot.admissionFenceSha256 !== drain.fenceSha256 ||
      snapshot.admissionProvisionOperationHash !== predecessor.provisionOperationHash ||
      snapshot.admissionStackId !== predecessor.stackId || snapshot.admissionCellExpiresAt !== drain.cellExpiresAt ||
      snapshot.dbObservedAt < drain.cellExpiresAt) fail("SEALED_V3_ADMISSION_LINEAGE_MISMATCH");
    if ([snapshot.activeTenantIds, snapshot.activeCapacityReservationIds, snapshot.nonterminalDeploymentIds,
      snapshot.liveTenantResourceIds, snapshot.nonterminalTenantCleanupScheduleIds].some(ids => ids.length !== 0)) fail("SEALED_V3_NOT_ZERO");
    if (await sha256Hex(sealedCellOwnershipStateV3(snapshot)) !== snapshot.ownershipStateSha256) fail("SEALED_V3_STATE_HASH_MISMATCH");
    input.signal.throwIfAborted();
    const checkedAt = clock(this.now);
    if (checkedAt < completedAt || checkedAt - startedAt > maximumAgeMs) fail("SEALED_V3_EVIDENCE_STALE");
    fresh(snapshot.dbObservedAt, checkedAt);
    const proof = freeze({ schemaVersion: 3 as const, protocol: "sealed-cell-zero-ownership-evidence-v3" as const,
      predecessorRecordHash: predecessor.recordHash, snapshot, checkedAt, runtimeActivationAuthorized: false as const });
    ownershipProofs.add(proof); return proof;
  }
}

function assertFreshProof(proof: VerifiedSealedCellZeroOwnershipEvidenceV3, predecessorHash: string, now: number): void {
  if (!ownershipProofs.has(proof) || proof.predecessorRecordHash !== predecessorHash) fail("SEALED_V3_OWNERSHIP_PROOF_UNVERIFIED");
  fresh(proof.checkedAt, now); fresh(proof.snapshot.dbObservedAt, now);
}

export interface PrepareSealedCellAuthorityInputV3 {
  predecessor: Readonly<SharedCellProvisionAuthorityRecord>;
  stack: VerifiedSharedCellCleanupStackEvidence;
  ownership: VerifiedSealedCellZeroOwnershipEvidenceV3;
  cleanupEpoch: number;
  expiresAt: number;
  now: number;
}

/** Pure prepared candidate, not an authority installation or an approved AWS command. */
export async function compileSealedCellCleanupAuthorityCandidateV3(input: PrepareSealedCellAuthorityInputV3) {
  if (!exactKeys(input, ["predecessor", "stack", "ownership", "cleanupEpoch", "expiresAt", "now"])) fail("SEALED_V3_INPUT_INVALID");
  const { stack, ownership, cleanupEpoch, expiresAt, now } = input;
  const predecessor = freeze(JSON.parse(canonicalJson(input.predecessor)) as SharedCellProvisionAuthorityRecord);
  clock(() => now);
  await compileSharedCellAdmissionDrainIntent(predecessor);
  assertFreshProof(ownership, predecessor.recordHash, now);
  if (!isVerifiedSharedCellCleanupStackEvidence(stack)) fail("SEALED_V3_STACK_UNVERIFIED");
  fresh(stack.observedAt, now);
  if (stack.observedAt < Date.parse(predecessor.cellExpiresAt) ||
    ["stackId", "stackStatus", "cellExpiresAt", "cloudFormationRoleArn", "templateCanonicalSha256", "resourceInventorySha256"]
      .some(key => stack[key as keyof typeof stack] !== predecessor[key as keyof typeof predecessor])) fail("SEALED_V3_STACK_LINEAGE_MISMATCH");
  if (!Number.isSafeInteger(cleanupEpoch) || cleanupEpoch <= predecessor.provisionEpoch ||
    !Number.isSafeInteger(predecessor.revision + 1) || !Number.isSafeInteger(expiresAt) || expiresAt <= now ||
    expiresAt - now > SHARED_CELL_CLEANUP_AUTHORITY_MAX_LIFETIME_MS) fail("SEALED_V3_AUTHORITY_WINDOW_INVALID");
  const unsigned = freeze({ schemaVersion: 3 as const, protocol: "sealed-cell-cleanup-authority-v3" as const,
    authorityKey: "sealed-cell-ttl-v3:cell:cell-sandbox-1" as const, state: "prepared_cleanup_authority" as const,
    executorRoleArn, executorIdentityProtocol: "dedicated-cell-ttl-v3" as const,
    predecessor, stackEvidence: stack, ownershipState: sealedCellOwnershipStateV3(ownership.snapshot),
    ownershipStateSha256: ownership.snapshot.ownershipStateSha256, cleanupEpoch, revision: predecessor.revision + 1,
    cleanupMarker: `sealed-cell-ttl-v3:g${predecessor.generation}:e${cleanupEpoch}`, reviewedAt: now, expiresAt,
    runtimeActivationAuthorized: false as const, authorityInstallationAuthorized: false as const });
  const candidate = freeze({ ...unsigned, recordSha256: await sha256Hex(unsigned) });
  authorityCandidates.add(candidate); return candidate;
}
export type PreparedSealedCellCleanupAuthorityV3 = Awaited<ReturnType<typeof compileSealedCellCleanupAuthorityCandidateV3>>;

/** Installer admission only; JSON cannot manufacture a live candidate. */
export function isPreparedSealedCellCleanupAuthorityV3(value: unknown): value is PreparedSealedCellCleanupAuthorityV3 {
  return value !== null && typeof value === "object" && authorityCandidates.has(value);
}

/** Fresh second read, full-state comparison, and separate plan/hash; no DeleteStack method. */
export class SealedCellDeletionOwnershipEvidenceAdapterV3 {
  private readonly evidence: SealedCellAuthorityOwnershipEvidenceAdapterV3;
  private readonly now: () => number;
  constructor(source: CertifiedSealedCellOwnershipSourceV3, options: { now?: () => number } = {}) {
    this.now = optionsClock(options);
    this.evidence = new SealedCellAuthorityOwnershipEvidenceAdapterV3(source, { now: this.now });
  }
  async prepareFreshDeletionPlan(input: { candidate: PreparedSealedCellCleanupAuthorityV3; signal: AbortSignal }) {
    if (!exactKeys(input, ["candidate", "signal"]) || typeof input.signal?.throwIfAborted !== "function") fail("SEALED_V3_INPUT_INVALID");
    input.signal.throwIfAborted();
    const { candidate } = input;
    if (!authorityCandidates.has(candidate)) fail("SEALED_V3_AUTHORITY_CANDIDATE_UNVERIFIED");
    const startedAt = clock(this.now);
    if (candidate.reviewedAt > startedAt || candidate.expiresAt <= startedAt) fail("SEALED_V3_AUTHORITY_EXPIRED");
    const proof = await this.evidence.readFreshZeroOwnershipEvidence({ predecessor: candidate.predecessor, signal: input.signal });
    if (proof.snapshot.ownershipStateSha256 !== candidate.ownershipStateSha256 ||
      canonicalJson(sealedCellOwnershipStateV3(proof.snapshot)) !== canonicalJson(candidate.ownershipState)) fail("SEALED_V3_OWNERSHIP_STATE_DRIFT");
    const checkedAt = clock(this.now);
    if (checkedAt < startedAt || checkedAt - startedAt > maximumAgeMs || checkedAt >= candidate.expiresAt) fail("SEALED_V3_AUTHORITY_EXPIRED");
    assertFreshProof(proof, candidate.predecessor.recordHash, checkedAt);
    const plan = freeze({ schemaVersion: 3 as const, protocol: "sealed-cell-deletion-plan-v3" as const,
      action: "prepare_sealed_cell_cleanup_deletion" as const, authorityCandidate: candidate,
      ownershipState: sealedCellOwnershipStateV3(proof.snapshot), ownershipStateSha256: proof.snapshot.ownershipStateSha256,
      stackId: candidate.predecessor.stackId, cloudFormationRoleArn: candidate.predecessor.cloudFormationRoleArn,
      executorRoleArn, executorIdentityProtocol: "dedicated-cell-ttl-v3" as const,
      plannedDeleteMode: "STANDARD" as const, retainResources: [] as readonly string[],
      expiresAt: candidate.expiresAt, mutationAuthorized: false as const, runtimeActivationAuthorized: false as const });
    const planSha256 = await sha256Hex(plan);
    input.signal.throwIfAborted();
    const completedAt = clock(this.now);
    if (completedAt < checkedAt || completedAt - startedAt > maximumAgeMs || completedAt >= candidate.expiresAt) fail("SEALED_V3_AUTHORITY_EXPIRED");
    assertFreshProof(proof, candidate.predecessor.recordHash, completedAt);
    return freeze({ plan, planSha256, ownershipEvidence: proof, checkedAt: completedAt,
      runtimeActivationAuthorized: false as const, mutationAuthorized: false as const });
  }
}
