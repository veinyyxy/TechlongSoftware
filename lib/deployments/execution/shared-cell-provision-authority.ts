import { canonicalJson, sha256Hex } from "./hash.ts";
import {
  SHARED_CELL_CLEANUP_AUTHORITY_KEY,
  sharedCellAuthorityMarker,
  sharedCellProvisionOperationIntent,
  type SharedCellAuthorityItem,
  type SharedCellAuthorityRecord,
  type SharedCellProvisionAuthorityRecord,
  type SharedCellProvisionOperationSource,
  validateSharedCellAuthorityItem,
} from "./shared-cell-cleanup-authority.ts";
import {
  assertVerifiedSharedCellProvisionEvidence,
  type VerifiedSharedCellProvisionEvidence,
} from "./shared-cell-provision-evidence.ts";

const accountId = "402010193138";
const region = "ca-central-1";
const cellId = "cell-sandbox-1";
const stackName = "techlong-sandbox-cell-sandbox-1";
// Cross-service installation cannot be atomic with CloudFormation. Keep the
// hand-off window short; J4c independently re-reads Stack/template/inventory
// before it will treat a later cleanup record as actionable.
const evidenceFreshnessMs = 30_000;
const ownerPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const stackIdPattern =
  /^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[0-9a-f-]{36}$/;
const utcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const evidenceKeys = [
  "accountId",
  "cellExpiresAt",
  "cellId",
  "observedAt",
  "region",
  "resourceInventorySha256",
  "schemaVersion",
  "stackId",
  "stackName",
  "stackStatus",
  "templateCanonicalSha256",
  "verified",
] as const;

const compiledProvisionCandidates = new WeakMap<
  object,
  Readonly<{
    compiledAt: number;
    observedAt: number;
    validThrough: number;
    cellExpiresAt: number;
  }>
>();

export interface SharedCellProvisionAuthorityCoordinateInput {
  ownerDeploymentId: string;
  generation: number;
  epoch: number;
}

export interface CompileSharedCellProvisionAuthorityInput {
  evidence: VerifiedSharedCellProvisionEvidence;
  coordinate: SharedCellProvisionAuthorityCoordinateInput;
  revision: number;
  now: number;
}

export interface SharedCellProvisionAuthoritySnapshot {
  authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
  revision: number;
  item: SharedCellAuthorityItem | null;
}

/**
 * Separate bootstrap boundary. installIfAbsent must be one provider-side
 * conditional write that succeeds only when the fixed authority key is absent.
 */
export interface AtomicSharedCellProvisionAuthorityPort {
  observe(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    signal: AbortSignal;
  }): Promise<SharedCellProvisionAuthoritySnapshot>;
  installIfAbsent(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    next: SharedCellAuthorityItem;
    signal: AbortSignal;
  }): Promise<{
    applied: boolean;
    snapshot: SharedCellProvisionAuthoritySnapshot;
  }>;
}

export class SharedCellProvisionAuthorityError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function fail(code: string, message: string, retryable = false): never {
  throw new SharedCellProvisionAuthorityError(code, message, retryable);
}

function exactKeys(value: unknown, expected: readonly string[]): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJson(Object.keys(value as Record<string, unknown>).sort()) ===
      canonicalJson([...expected].sort())
  );
}

function positiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    fail(
      "SHARED_CELL_PROVISION_AUTHORITY_INVALID",
      `${label} must be a positive safe integer.`,
    );
  }
}

function clockValue(value: unknown, label: string, afterWrite = false): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    fail(
      afterWrite
        ? "SHARED_CELL_PROVISION_AUTHORITY_CLOCK_INVALID_AFTER_WRITE"
        : "SHARED_CELL_PROVISION_AUTHORITY_CLOCK_INVALID",
      afterWrite
        ? `${label} is invalid after install; the write may already be committed.`
        : `${label} is invalid.`,
      afterWrite,
    );
  }
  return value as number;
}

function readClock(
  clock: () => number,
  label: string,
  previous?: number,
  afterWrite = false,
): number {
  let value: number;
  try {
    value = clock();
  } catch {
    return fail(
      afterWrite
        ? "SHARED_CELL_PROVISION_AUTHORITY_CLOCK_INVALID_AFTER_WRITE"
        : "SHARED_CELL_PROVISION_AUTHORITY_CLOCK_INVALID",
      afterWrite
        ? `${label} failed after install; the write may already be committed.`
        : `${label} failed.`,
      afterWrite,
    );
  }
  clockValue(value, label, afterWrite);
  if (previous !== undefined && value < previous) {
    fail(
      afterWrite
        ? "SHARED_CELL_PROVISION_AUTHORITY_CLOCK_REGRESSED_AFTER_WRITE"
        : "SHARED_CELL_PROVISION_AUTHORITY_CLOCK_REGRESSED",
      afterWrite
        ? "The provision authority clock regressed after install; the write may already be committed."
        : "The provision authority clock regressed.",
      afterWrite,
    );
  }
  return value;
}

function canonicalUtc(value: unknown, label: string): number {
  if (typeof value !== "string" || !utcPattern.test(value)) {
    fail(
      "SHARED_CELL_PROVISION_AUTHORITY_INVALID",
      `${label} must be canonical UTC with milliseconds.`,
    );
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    fail(
      "SHARED_CELL_PROVISION_AUTHORITY_INVALID",
      `${label} is not a real canonical UTC instant.`,
    );
  }
  return timestamp;
}

function validateEvidence(
  evidence: VerifiedSharedCellProvisionEvidence,
  now: number,
): Readonly<{ observedAt: number; validThrough: number; cellExpiresAt: number }> {
  try {
    assertVerifiedSharedCellProvisionEvidence(evidence);
  } catch {
    return fail(
      "SHARED_CELL_PROVISION_AUTHORITY_EVIDENCE_UNVERIFIED",
      "Provision authority requires evidence from the complete live Stack adapter.",
    );
  }
  if (
    !exactKeys(evidence, evidenceKeys) ||
    evidence.schemaVersion !== 1 ||
    evidence.verified !== true ||
    evidence.accountId !== accountId ||
    evidence.region !== region ||
    evidence.cellId !== cellId ||
    evidence.stackName !== stackName ||
    !stackIdPattern.test(evidence.stackId) ||
    !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(evidence.stackStatus) ||
    !Number.isSafeInteger(evidence.observedAt) ||
    evidence.observedAt <= 0 ||
    !digestPattern.test(evidence.templateCanonicalSha256) ||
    !digestPattern.test(evidence.resourceInventorySha256)
  ) {
    fail(
      "SHARED_CELL_PROVISION_AUTHORITY_EVIDENCE_INVALID",
      "Provision authority evidence contains missing, unexpected or drifting fields.",
    );
  }
  clockValue(now, "Provision authority clock");
  const validThrough = evidence.observedAt + evidenceFreshnessMs;
  const cellExpiresAt = canonicalUtc(evidence.cellExpiresAt, "cellExpiresAt");
  if (
    !Number.isSafeInteger(validThrough) ||
    evidence.observedAt > now ||
    now > validThrough
  ) {
    fail(
      "SHARED_CELL_PROVISION_AUTHORITY_EVIDENCE_STALE",
      "Provision authority requires fresh live Stack evidence.",
    );
  }
  if (cellExpiresAt <= now) {
    fail(
      "SHARED_CELL_PROVISION_AUTHORITY_CELL_EXPIRED",
      "An expired Shared Cell cannot be installed as a provision predecessor.",
    );
  }
  return Object.freeze({
    observedAt: evidence.observedAt,
    validThrough,
    cellExpiresAt,
  });
}

export async function compileSharedCellProvisionAuthorityCandidateItem(
  input: CompileSharedCellProvisionAuthorityInput,
): Promise<Readonly<SharedCellAuthorityItem>> {
  if (
    !exactKeys(input, ["coordinate", "evidence", "now", "revision"]) ||
    !exactKeys(input.coordinate, ["epoch", "generation", "ownerDeploymentId"])
  ) {
    fail(
      "SHARED_CELL_PROVISION_AUTHORITY_INVALID",
      "Provision authority compiler input contains missing or unexpected fields.",
    );
  }
  const validity = validateEvidence(input.evidence, input.now);
  positiveInteger(input.revision, "revision");
  positiveInteger(input.coordinate.generation, "generation");
  positiveInteger(input.coordinate.epoch, "provision epoch");
  if (!ownerPattern.test(input.coordinate.ownerDeploymentId)) {
    fail(
      "SHARED_CELL_PROVISION_AUTHORITY_INVALID",
      "Provision authority deployment owner is invalid.",
    );
  }
  const operationSource: SharedCellProvisionOperationSource = {
    schemaVersion: 1 as const,
    accountId,
    region,
    cellId,
    stackName,
    stackId: input.evidence.stackId,
    stackStatus: input.evidence.stackStatus,
    cellExpiresAt: input.evidence.cellExpiresAt,
    templateCanonicalSha256: input.evidence.templateCanonicalSha256,
    resourceInventorySha256: input.evidence.resourceInventorySha256,
    ownerDeploymentId: input.coordinate.ownerDeploymentId,
    generation: input.coordinate.generation,
    provisionEpoch: input.coordinate.epoch,
    provisionMarker: sharedCellAuthorityMarker({
      generation: input.coordinate.generation,
      epoch: input.coordinate.epoch,
    }),
  };
  const provisionOperationHash = await sha256Hex(
    sharedCellProvisionOperationIntent(operationSource),
  );
  const unsigned: Omit<SharedCellProvisionAuthorityRecord, "recordHash"> = {
    ...operationSource,
    provisionOperationHash,
    revision: input.revision,
    state: "provision_verified",
  };
  const record: SharedCellProvisionAuthorityRecord = Object.freeze({
    ...unsigned,
    recordHash: await sha256Hex(unsigned),
  });
  const item: Readonly<SharedCellAuthorityItem> = Object.freeze({
    authority_key: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    schema_version: 1 as const,
    revision: input.revision,
    record_json: canonicalJson(record),
  });
  compiledProvisionCandidates.set(
    item,
    Object.freeze({ ...validity, compiledAt: input.now }),
  );
  return item;
}

async function validateSnapshot(
  snapshot: SharedCellProvisionAuthoritySnapshot,
): Promise<Readonly<SharedCellProvisionAuthoritySnapshot>> {
  const itemRevision =
    snapshot?.item && typeof snapshot.item === "object"
      ? snapshot.item.revision
      : null;
  if (
    !exactKeys(snapshot, ["authorityKey", "item", "revision"]) ||
    snapshot.authorityKey !== SHARED_CELL_CLEANUP_AUTHORITY_KEY ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 0 ||
    (snapshot.revision === 0) !== (snapshot.item === null) ||
    (snapshot.item !== null && itemRevision !== snapshot.revision)
  ) {
    fail(
      "SHARED_CELL_PROVISION_AUTHORITY_SNAPSHOT_INVALID",
      "Provision authority snapshot is malformed.",
    );
  }
  if (snapshot.item) await validateSharedCellAuthorityItem(snapshot.item);
  return snapshot;
}

function sameItem(
  left: SharedCellAuthorityItem | null,
  right: SharedCellAuthorityItem,
): boolean {
  return left !== null && canonicalJson(left) === canonicalJson(right);
}

function assertNotAbortedAfterWrite(
  signal: AbortSignal,
  message: string,
): void {
  if (signal.aborted) {
    fail(
      "SHARED_CELL_PROVISION_AUTHORITY_ABORTED_AFTER_WRITE",
      message,
      true,
    );
  }
}

function assertCandidateFresh(
  item: SharedCellAuthorityItem,
  now: number,
  afterWrite = false,
): void {
  const validity = compiledProvisionCandidates.get(item);
  if (!validity) {
    fail(
      afterWrite
        ? "SHARED_CELL_PROVISION_AUTHORITY_CANDIDATE_UNVERIFIED_AFTER_WRITE"
        : "SHARED_CELL_PROVISION_AUTHORITY_CANDIDATE_UNVERIFIED",
      afterWrite
        ? "Provision authority candidate provenance was lost after install; the write may already be committed."
        : "Provision authority requires the exact candidate produced by its reviewed compiler.",
      afterWrite,
    );
  }
  if (now < validity.compiledAt) {
    fail(
      afterWrite
        ? "SHARED_CELL_PROVISION_AUTHORITY_CLOCK_REGRESSED_AFTER_WRITE"
        : "SHARED_CELL_PROVISION_AUTHORITY_CLOCK_REGRESSED",
      afterWrite
        ? "Provision authority clock regressed behind candidate compilation after install; the write may already be committed."
        : "Provision authority clock regressed behind candidate compilation before install.",
      afterWrite,
    );
  }
  if (
    now < validity.observedAt ||
    now > validity.validThrough ||
    now >= validity.cellExpiresAt
  ) {
    fail(
      afterWrite
        ? "SHARED_CELL_PROVISION_AUTHORITY_EVIDENCE_STALE_AFTER_WRITE"
        : "SHARED_CELL_PROVISION_AUTHORITY_EVIDENCE_STALE",
      afterWrite
        ? "Provision evidence expired after install; the write may already be committed."
        : "Provision evidence expired before install.",
      afterWrite,
    );
  }
}

/**
 * Low-level provider adapters use the same private compiler provenance and
 * freshness fence as the high-level absent-only installer.
 */
export function assertCompiledSharedCellProvisionAuthorityCandidate(
  item: SharedCellAuthorityItem,
  now: number,
  afterWrite = false,
): void {
  assertCandidateFresh(
    item,
    clockValue(now, "Provision authority clock", afterWrite),
    afterWrite,
  );
}

export async function installInitialSharedCellProvisionAuthority(input: {
  port: AtomicSharedCellProvisionAuthorityPort;
  evidence: VerifiedSharedCellProvisionEvidence;
  coordinate: SharedCellProvisionAuthorityCoordinateInput;
  signal: AbortSignal;
  now?: () => number;
}): Promise<Readonly<SharedCellAuthorityItem>> {
  input.signal.throwIfAborted();
  const clock = input.now ?? Date.now;
  const initialNow = readClock(clock, "Initial provision authority clock");
  validateEvidence(input.evidence, initialNow);
  positiveInteger(input.coordinate.generation, "generation");
  positiveInteger(input.coordinate.epoch, "provision epoch");
  if (input.coordinate.generation !== 1 || input.coordinate.epoch !== 1) {
    fail(
      "SHARED_CELL_PROVISION_AUTHORITY_GENESIS_INVALID",
      "The initial Shared Cell provision predecessor must be generation 1, epoch 1.",
    );
  }

  const before = await input.port.observe({
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    signal: input.signal,
  });
  input.signal.throwIfAborted();
  await validateSnapshot(before);
  input.signal.throwIfAborted();

  const candidate = await compileSharedCellProvisionAuthorityCandidateItem({
    evidence: input.evidence,
    coordinate: input.coordinate,
    revision: 1,
    now: initialNow,
  });
  input.signal.throwIfAborted();
  if (before.item) {
    if (sameItem(before.item, candidate)) {
      const replayNow = readClock(
        clock,
        "Provision authority replay clock",
        initialNow,
      );
      assertCandidateFresh(candidate, replayNow);
      return before.item;
    }
    fail(
      "SHARED_CELL_PROVISION_AUTHORITY_ALREADY_EXISTS",
      "The fixed Shared Cell authority key already contains a different lineage.",
    );
  }

  const preWriteNow = readClock(
    clock,
    "Pre-install provision authority clock",
    initialNow,
  );
  assertCandidateFresh(candidate, preWriteNow);
  input.signal.throwIfAborted();
  let result: {
    applied: boolean;
    snapshot: SharedCellProvisionAuthoritySnapshot;
  };
  try {
    result = await input.port.installIfAbsent({
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      next: candidate,
      signal: input.signal,
    });
  } catch (error) {
    if (input.signal.aborted) {
      assertNotAbortedAfterWrite(
        input.signal,
        "Provision authority install was aborted after submission; the result is uncertain.",
      );
      throw error;
    }
    const uncertain = new SharedCellProvisionAuthorityError(
      "SHARED_CELL_PROVISION_AUTHORITY_WRITE_UNCERTAIN",
      "Provision authority install failed after submission; the result is uncertain.",
      true,
    );
    Object.defineProperty(uncertain, "cause", { value: error });
    throw uncertain;
  }
  assertNotAbortedAfterWrite(
    input.signal,
    "Provision authority install was aborted after submission; the result is uncertain.",
  );
  if (
    !exactKeys(result, ["applied", "snapshot"]) ||
    typeof result.applied !== "boolean"
  ) {
    fail(
      "SHARED_CELL_PROVISION_AUTHORITY_INSTALL_RESULT_INVALID",
      "Provision authority installer returned a malformed result.",
      true,
    );
  }
  try {
    await validateSnapshot(result.snapshot);
  } catch (error) {
    assertNotAbortedAfterWrite(
      input.signal,
      "Provision authority result validation was aborted after submission; the result is uncertain.",
    );
    const uncertain = new SharedCellProvisionAuthorityError(
      "SHARED_CELL_PROVISION_AUTHORITY_INSTALL_RESULT_INVALID",
      "Provision authority installer returned an invalid snapshot after submission; the result is uncertain.",
      true,
    );
    Object.defineProperty(uncertain, "cause", { value: error });
    throw uncertain;
  }
  assertNotAbortedAfterWrite(
    input.signal,
    "Provision authority result validation was aborted after submission; the result is uncertain.",
  );
  if (
    !result.applied ||
    result.snapshot.revision !== 1 ||
    !sameItem(result.snapshot.item, candidate)
  ) {
    fail(
      "SHARED_CELL_PROVISION_AUTHORITY_INSTALL_CONFLICT",
      "The initial provision authority was not installed exactly.",
      true,
    );
  }

  let observed: SharedCellProvisionAuthoritySnapshot;
  try {
    observed = await input.port.observe({
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      signal: input.signal,
    });
  } catch {
    assertNotAbortedAfterWrite(
      input.signal,
      "Provision authority readback was aborted; the install result is uncertain.",
    );
    return fail(
      "SHARED_CELL_PROVISION_AUTHORITY_READBACK_FAILED_AFTER_WRITE",
      "Provision authority readback failed after install; the result is uncertain.",
      true,
    );
  }
  assertNotAbortedAfterWrite(
    input.signal,
    "Provision authority readback was aborted; the install result is uncertain.",
  );
  try {
    await validateSnapshot(observed);
  } catch (error) {
    assertNotAbortedAfterWrite(
      input.signal,
      "Provision authority readback validation was aborted; the install result is uncertain.",
    );
    const uncertain = new SharedCellProvisionAuthorityError(
      "SHARED_CELL_PROVISION_AUTHORITY_READBACK_INVALID_AFTER_WRITE",
      "Provision authority readback was malformed after install; the result is uncertain.",
      true,
    );
    Object.defineProperty(uncertain, "cause", { value: error });
    throw uncertain;
  }
  assertNotAbortedAfterWrite(
    input.signal,
    "Provision authority readback validation was aborted; the install result is uncertain.",
  );
  if (observed.revision !== 1 || !sameItem(observed.item, candidate)) {
    fail(
      "SHARED_CELL_PROVISION_AUTHORITY_READBACK_MISMATCH",
      "Provision authority did not read back exactly after install.",
      true,
    );
  }
  const finalNow = readClock(
    clock,
    "Post-install provision authority clock",
    preWriteNow,
    true,
  );
  assertCandidateFresh(candidate, finalNow, true);
  return candidate;
}

export class DisabledAtomicSharedCellProvisionAuthority
  implements AtomicSharedCellProvisionAuthorityPort
{
  private disabled(): never {
    return fail(
      "SHARED_CELL_PROVISION_AUTHORITY_INSTALLER_DISABLED",
      "No Shared Cell provision authority installer is configured.",
    );
  }

  async observe(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    signal: AbortSignal;
  }): Promise<SharedCellProvisionAuthoritySnapshot> {
    void input;
    return this.disabled();
  }

  async installIfAbsent(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    next: SharedCellAuthorityItem;
    signal: AbortSignal;
  }): Promise<{
    applied: boolean;
    snapshot: SharedCellProvisionAuthoritySnapshot;
  }> {
    void input;
    return this.disabled();
  }
}

/** Convenience type for reviewers inspecting the two-state fixed-key record. */
export type SharedCellProvisionAuthorityStoredRecord = SharedCellAuthorityRecord;
