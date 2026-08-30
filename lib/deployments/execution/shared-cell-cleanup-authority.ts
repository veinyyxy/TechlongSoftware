import { canonicalJson, sha256Hex } from "./hash.ts";

export const SHARED_CELL_CLEANUP_AUTHORITY_KEY =
  "cell:cell-sandbox-1" as const;
export const SHARED_CELL_CLEANUP_AUTHORITY_MAX_LIFETIME_MS =
  60 * 60 * 1000;

const expectedAccountId = "402010193138";
const expectedRegion = "ca-central-1";
const expectedCellId = "cell-sandbox-1";
const expectedStackName = "techlong-sandbox-cell-sandbox-1";
const digestPattern = /^[a-f0-9]{64}$/;
const ownerPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const utcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const stackIdPattern =
  /^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[0-9a-f-]{36}$/;

const inputKeys = ["cell", "cleanup", "now", "provision", "revision"] as const;
const cellKeys = [
  "cellExpiresAt",
  "resourceInventorySha256",
  "stackId",
  "stackName",
  "stackStatus",
  "templateCanonicalSha256",
] as const;
const provisionKeys = [
  "epoch",
  "generation",
  "operationHash",
  "ownerDeploymentId",
] as const;
const cleanupKeys = ["epoch", "expiresAt"] as const;
const itemKeys = [
  "authority_key",
  "record_json",
  "revision",
  "schema_version",
] as const;
const recordKeys = [
  "accountId",
  "cellExpiresAt",
  "cellId",
  "cleanupEpoch",
  "cleanupMarker",
  "cleanupOperationHash",
  "expiresAt",
  "generation",
  "ownerDeploymentId",
  "provisionEpoch",
  "provisionMarker",
  "provisionOperationHash",
  "recordHash",
  "region",
  "resourceInventorySha256",
  "revision",
  "schemaVersion",
  "stackId",
  "stackName",
  "stackStatus",
  "state",
  "templateCanonicalSha256",
] as const;

export class SharedCellCleanupAuthorityError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function fail(code: string, message: string, retryable = false): never {
  throw new SharedCellCleanupAuthorityError(code, message, retryable);
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
      "SHARED_CELL_CLEANUP_AUTHORITY_INVALID",
      `${label} must be a positive safe integer.`,
    );
  }
}

function canonicalUtc(value: unknown, label: string): number {
  if (typeof value !== "string" || !utcPattern.test(value)) {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_INVALID",
      `${label} must be canonical UTC with milliseconds.`,
    );
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_INVALID",
      `${label} is not a real canonical UTC instant.`,
    );
  }
  return timestamp;
}

function requireNotAborted(signal: AbortSignal): void {
  signal.throwIfAborted();
}

export interface SharedCellCleanupStackEvidence {
  stackName: typeof expectedStackName;
  stackId: string;
  stackStatus: "CREATE_COMPLETE" | "UPDATE_COMPLETE";
  cellExpiresAt: string;
  templateCanonicalSha256: string;
  resourceInventorySha256: string;
}

export interface SharedCellProvisionAuthorityCoordinate {
  ownerDeploymentId: string;
  generation: number;
  epoch: number;
  operationHash: string;
}

export interface SharedCellCleanupAuthorization {
  epoch: number;
  expiresAt: string;
}

export interface SharedCellCleanupAuthorityRecord {
  schemaVersion: 1;
  accountId: typeof expectedAccountId;
  region: typeof expectedRegion;
  cellId: typeof expectedCellId;
  stackName: typeof expectedStackName;
  stackId: string;
  stackStatus: "CREATE_COMPLETE" | "UPDATE_COMPLETE";
  cellExpiresAt: string;
  templateCanonicalSha256: string;
  resourceInventorySha256: string;
  ownerDeploymentId: string;
  generation: number;
  provisionEpoch: number;
  provisionMarker: string;
  provisionOperationHash: string;
  cleanupEpoch: number;
  cleanupMarker: string;
  cleanupOperationHash: string;
  revision: number;
  expiresAt: string;
  state: "cleanup_authorized";
  recordHash: string;
}

export interface SharedCellCleanupAuthorityItem {
  authority_key: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
  schema_version: 1;
  revision: number;
  record_json: string;
}

export interface CompileSharedCellCleanupAuthorityInput {
  cell: SharedCellCleanupStackEvidence;
  provision: SharedCellProvisionAuthorityCoordinate;
  cleanup: SharedCellCleanupAuthorization;
  revision: number;
  now: number;
}

type SharedCellCleanupOperationSource = Pick<
  SharedCellCleanupAuthorityRecord,
  | "schemaVersion"
  | "accountId"
  | "region"
  | "cellId"
  | "stackName"
  | "stackId"
  | "stackStatus"
  | "cellExpiresAt"
  | "templateCanonicalSha256"
  | "resourceInventorySha256"
  | "ownerDeploymentId"
  | "generation"
  | "provisionEpoch"
  | "provisionMarker"
  | "provisionOperationHash"
  | "cleanupEpoch"
  | "cleanupMarker"
  | "expiresAt"
>;

function cleanupOperationIntent(source: SharedCellCleanupOperationSource) {
  return {
    schemaVersion: 1 as const,
    intent: "cleanup_shared_cell" as const,
    accountId: source.accountId,
    region: source.region,
    cellId: source.cellId,
    stackName: source.stackName,
    stackId: source.stackId,
    stackStatus: source.stackStatus,
    cellExpiresAt: source.cellExpiresAt,
    templateCanonicalSha256: source.templateCanonicalSha256,
    resourceInventorySha256: source.resourceInventorySha256,
    ownerDeploymentId: source.ownerDeploymentId,
    generation: source.generation,
    provisionEpoch: source.provisionEpoch,
    provisionMarker: source.provisionMarker,
    provisionOperationHash: source.provisionOperationHash,
    cleanupEpoch: source.cleanupEpoch,
    cleanupMarker: source.cleanupMarker,
    expiresAt: source.expiresAt,
  };
}

function assertClockValue(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_CLOCK_INVALID",
      `${label} is not a non-negative safe integer.`,
    );
  }
}

function assertAuthorityWindow(
  value: { cellExpiresAt: string; expiresAt: string },
  now: number,
  expiredCode = "SHARED_CELL_CLEANUP_AUTHORITY_EXPIRED",
): void {
  assertClockValue(now, "Current time");
  const cellExpiresAt = canonicalUtc(value.cellExpiresAt, "cellExpiresAt");
  const expiresAt = canonicalUtc(value.expiresAt, "expiresAt");
  if (cellExpiresAt > now) {
    fail(
      "SHARED_CELL_CLEANUP_CELL_NOT_EXPIRED",
      "Shared Cell cleanup cannot be authorized before the Cell expires.",
    );
  }
  if (
    expiresAt <= now ||
    expiresAt - now > SHARED_CELL_CLEANUP_AUTHORITY_MAX_LIFETIME_MS
  ) {
    fail(
      expiredCode,
      "Shared Cell cleanup authority is expired or too long-lived.",
      expiredCode === "SHARED_CELL_CLEANUP_AUTHORITY_EXPIRED_AFTER_WRITE",
    );
  }
}

export function sharedCellAuthorityMarker(input: {
  generation: number;
  epoch: number;
}): string {
  positiveInteger(input.generation, "generation");
  positiveInteger(input.epoch, "epoch");
  return `tl_cell_epoch_${expectedCellId}_g${input.generation}_e${input.epoch}`;
}

function assertCompileInput(
  input: CompileSharedCellCleanupAuthorityInput,
): void {
  if (
    !exactKeys(input, inputKeys) ||
    !exactKeys(input.cell, cellKeys) ||
    !exactKeys(input.provision, provisionKeys) ||
    !exactKeys(input.cleanup, cleanupKeys)
  ) {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_INVALID",
      "Shared Cell cleanup authority input contains missing or unexpected fields.",
    );
  }
  assertClockValue(input.now, "Current time");
  positiveInteger(input.revision, "revision");
  positiveInteger(input.provision.generation, "generation");
  positiveInteger(input.provision.epoch, "provision epoch");
  positiveInteger(input.cleanup.epoch, "cleanup epoch");
  if (
    input.cell.stackName !== expectedStackName ||
    !stackIdPattern.test(input.cell.stackId) ||
    !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(input.cell.stackStatus) ||
    !digestPattern.test(input.cell.templateCanonicalSha256) ||
    !digestPattern.test(input.cell.resourceInventorySha256) ||
    !ownerPattern.test(input.provision.ownerDeploymentId) ||
    !digestPattern.test(input.provision.operationHash) ||
    input.cleanup.epoch <= input.provision.epoch
  ) {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_INVALID",
      "Shared Cell cleanup authority coordinates or evidence are invalid.",
    );
  }
  assertAuthorityWindow(
    {
      cellExpiresAt: input.cell.cellExpiresAt,
      expiresAt: input.cleanup.expiresAt,
    },
    input.now,
  );
}

export async function compileSharedCellCleanupAuthorityCandidateItem(
  input: CompileSharedCellCleanupAuthorityInput,
): Promise<Readonly<SharedCellCleanupAuthorityItem>> {
  assertCompileInput(input);
  const operationSource: SharedCellCleanupOperationSource = {
    schemaVersion: 1 as const,
    accountId: expectedAccountId,
    region: expectedRegion,
    cellId: expectedCellId,
    stackName: expectedStackName,
    stackId: input.cell.stackId,
    stackStatus: input.cell.stackStatus,
    cellExpiresAt: input.cell.cellExpiresAt,
    templateCanonicalSha256: input.cell.templateCanonicalSha256,
    resourceInventorySha256: input.cell.resourceInventorySha256,
    ownerDeploymentId: input.provision.ownerDeploymentId,
    generation: input.provision.generation,
    provisionEpoch: input.provision.epoch,
    provisionMarker: sharedCellAuthorityMarker({
      generation: input.provision.generation,
      epoch: input.provision.epoch,
    }),
    provisionOperationHash: input.provision.operationHash,
    cleanupEpoch: input.cleanup.epoch,
    cleanupMarker: sharedCellAuthorityMarker({
      generation: input.provision.generation,
      epoch: input.cleanup.epoch,
    }),
    expiresAt: input.cleanup.expiresAt,
  };
  const cleanupOperationHash = await sha256Hex(
    cleanupOperationIntent(operationSource),
  );
  if (cleanupOperationHash === operationSource.provisionOperationHash) {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_OPERATION_COLLISION",
      "Provision and cleanup operations must have distinct immutable hashes.",
    );
  }
  const unsigned: Omit<SharedCellCleanupAuthorityRecord, "recordHash"> = {
    ...operationSource,
    cleanupOperationHash,
    revision: input.revision,
    state: "cleanup_authorized" as const,
  };
  const record: SharedCellCleanupAuthorityRecord = Object.freeze({
    ...unsigned,
    recordHash: await sha256Hex(unsigned),
  });
  return Object.freeze({
    authority_key: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    schema_version: 1 as const,
    revision: input.revision,
    record_json: canonicalJson(record),
  });
}

function parseRecord(
  item: SharedCellCleanupAuthorityItem,
): {
  record: SharedCellCleanupAuthorityRecord;
  unsigned: Omit<SharedCellCleanupAuthorityRecord, "recordHash">;
} {
  if (
    !exactKeys(item, itemKeys) ||
    item.authority_key !== SHARED_CELL_CLEANUP_AUTHORITY_KEY ||
    item.schema_version !== 1 ||
    !Number.isSafeInteger(item.revision) ||
    item.revision < 1 ||
    typeof item.record_json !== "string" ||
    item.record_json.length > 16_384
  ) {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_INVALID",
      "Shared Cell cleanup authority item is invalid.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(item.record_json);
  } catch {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_INVALID",
      "Shared Cell cleanup authority record is not JSON.",
    );
  }
  if (
    !exactKeys(parsed, recordKeys) ||
    canonicalJson(parsed) !== item.record_json
  ) {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_INVALID",
      "Shared Cell cleanup authority record is not exact canonical JSON.",
    );
  }
  const record = parsed as SharedCellCleanupAuthorityRecord;
  positiveInteger(record.generation, "generation");
  positiveInteger(record.provisionEpoch, "provision epoch");
  positiveInteger(record.cleanupEpoch, "cleanup epoch");
  positiveInteger(record.revision, "revision");
  canonicalUtc(record.cellExpiresAt, "cellExpiresAt");
  canonicalUtc(record.expiresAt, "expiresAt");
  const unsignedRecord = {
    ...record,
  } as Partial<SharedCellCleanupAuthorityRecord>;
  delete unsignedRecord.recordHash;
  const unsigned = unsignedRecord as Omit<
    SharedCellCleanupAuthorityRecord,
    "recordHash"
  >;
  if (
    record.schemaVersion !== 1 ||
    record.accountId !== expectedAccountId ||
    record.region !== expectedRegion ||
    record.cellId !== expectedCellId ||
    record.stackName !== expectedStackName ||
    !stackIdPattern.test(record.stackId) ||
    !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(record.stackStatus) ||
    !digestPattern.test(record.templateCanonicalSha256) ||
    !digestPattern.test(record.resourceInventorySha256) ||
    !ownerPattern.test(record.ownerDeploymentId) ||
    record.cleanupEpoch <= record.provisionEpoch ||
    record.provisionMarker !==
      sharedCellAuthorityMarker({
        generation: record.generation,
        epoch: record.provisionEpoch,
      }) ||
    record.cleanupMarker !==
      sharedCellAuthorityMarker({
        generation: record.generation,
        epoch: record.cleanupEpoch,
      }) ||
    !digestPattern.test(record.provisionOperationHash) ||
    !digestPattern.test(record.cleanupOperationHash) ||
    record.revision !== item.revision ||
    record.state !== "cleanup_authorized" ||
    !digestPattern.test(record.recordHash)
  ) {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_INVALID",
      "Shared Cell cleanup authority record fields drifted.",
    );
  }
  return { record, unsigned };
}

async function assertItemExact(
  item: SharedCellCleanupAuthorityItem,
): Promise<SharedCellCleanupAuthorityRecord> {
  const { record, unsigned } = parseRecord(item);
  if ((await sha256Hex(unsigned)) !== record.recordHash) {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_HASH_MISMATCH",
      "Shared Cell cleanup authority record hash drifted.",
    );
  }
  if (
    (await sha256Hex(cleanupOperationIntent(record))) !==
      record.cleanupOperationHash ||
    record.cleanupOperationHash === record.provisionOperationHash
  ) {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_OPERATION_HASH_MISMATCH",
      "Shared Cell cleanup operation hash is not bound to the exact intent.",
    );
  }
  return record;
}

export interface SharedCellCleanupAuthoritySnapshot {
  authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
  revision: number;
  item: SharedCellCleanupAuthorityItem | null;
}

export interface AtomicSharedCellCleanupAuthorityPort {
  observe(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    signal: AbortSignal;
  }): Promise<SharedCellCleanupAuthoritySnapshot>;
  compareAndSet(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    expected: SharedCellCleanupAuthoritySnapshot;
    next: SharedCellCleanupAuthorityItem;
    signal: AbortSignal;
  }): Promise<{
    applied: boolean;
    snapshot: SharedCellCleanupAuthoritySnapshot;
  }>;
}

function assertSnapshotShape(snapshot: SharedCellCleanupAuthoritySnapshot): void {
  const itemRevision =
    snapshot?.item !== null &&
    Boolean(snapshot?.item) &&
    typeof snapshot.item === "object" &&
    !Array.isArray(snapshot.item)
      ? (snapshot.item as { revision?: unknown }).revision
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
      "SHARED_CELL_CLEANUP_AUTHORITY_SNAPSHOT_INVALID",
      "Shared Cell cleanup authority snapshot is malformed.",
    );
  }
}

function sameItem(
  left: SharedCellCleanupAuthorityItem | null,
  right: SharedCellCleanupAuthorityItem,
): boolean {
  return left !== null && canonicalJson(left) === canonicalJson(right);
}

function sameLineage(
  record: SharedCellCleanupAuthorityRecord,
  input: {
    cell: SharedCellCleanupStackEvidence;
    provision: SharedCellProvisionAuthorityCoordinate;
  },
): boolean {
  return (
    record.stackName === input.cell.stackName &&
    record.stackId === input.cell.stackId &&
    record.stackStatus === input.cell.stackStatus &&
    record.cellExpiresAt === input.cell.cellExpiresAt &&
    record.templateCanonicalSha256 ===
      input.cell.templateCanonicalSha256 &&
    record.resourceInventorySha256 ===
      input.cell.resourceInventorySha256 &&
    record.ownerDeploymentId === input.provision.ownerDeploymentId &&
    record.generation === input.provision.generation &&
    record.provisionEpoch === input.provision.epoch &&
    record.provisionOperationHash === input.provision.operationHash
  );
}

function sameCleanupIntent(
  current: SharedCellCleanupAuthorityRecord,
  next: SharedCellCleanupAuthorityRecord,
): boolean {
  return (
    current.cleanupEpoch === next.cleanupEpoch &&
    current.cleanupMarker === next.cleanupMarker &&
    current.cleanupOperationHash === next.cleanupOperationHash &&
    current.expiresAt === next.expiresAt
  );
}

function readClock(
  clock: () => number,
  previous?: number,
  afterWrite = false,
): number {
  const value = clock();
  assertClockValue(value, "Shared Cell cleanup authority clock");
  if (previous !== undefined && value < previous) {
    fail(
      afterWrite
        ? "SHARED_CELL_CLEANUP_AUTHORITY_CLOCK_REGRESSED_AFTER_WRITE"
        : "SHARED_CELL_CLEANUP_AUTHORITY_CLOCK_REGRESSED",
      afterWrite
        ? "The authority clock regressed after CAS; the write may already be committed."
        : "The authority clock regressed before CAS.",
      afterWrite,
    );
  }
  return value;
}

export async function advanceSharedCellCleanupAuthority(input: {
  port: AtomicSharedCellCleanupAuthorityPort;
  cell: SharedCellCleanupStackEvidence;
  provision: SharedCellProvisionAuthorityCoordinate;
  cleanup: SharedCellCleanupAuthorization;
  signal: AbortSignal;
  now?: () => number;
}): Promise<Readonly<SharedCellCleanupAuthorityItem>> {
  requireNotAborted(input.signal);
  const before = await input.port.observe({
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    signal: input.signal,
  });
  requireNotAborted(input.signal);
  assertSnapshotShape(before);
  if (!before.item) {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_BOOTSTRAP_MISSING",
      "A trusted Shared Cell provision authority must exist before cleanup can advance.",
    );
  }
  const beforeRecord = await assertItemExact(before.item);
  const revision = before.revision + 1;
  positiveInteger(revision, "next revision");
  const clock = input.now ?? Date.now;
  const compileNow = readClock(clock);
  const next = await compileSharedCellCleanupAuthorityCandidateItem({
    cell: input.cell,
    provision: input.provision,
    cleanup: input.cleanup,
    revision,
    now: compileNow,
  });
  requireNotAborted(input.signal);
  const nextRecord = await assertItemExact(next);
  if (!sameLineage(beforeRecord, input)) {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_TRANSITION_INVALID",
      "Shared Cell cleanup cannot change its verified provision lineage.",
    );
  }
  if (sameCleanupIntent(beforeRecord, nextRecord)) {
    const replayNow = readClock(clock, compileNow);
    assertAuthorityWindow(beforeRecord, replayNow);
    return before.item;
  }
  if (nextRecord.cleanupEpoch <= beforeRecord.cleanupEpoch) {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_TRANSITION_INVALID",
      "Shared Cell cleanup epoch must advance strictly within one provision lineage.",
    );
  }
  const preCasNow = readClock(clock, compileNow);
  assertAuthorityWindow(nextRecord, preCasNow);
  requireNotAborted(input.signal);
  const result = await input.port.compareAndSet({
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    expected: before,
    next,
    signal: input.signal,
  });
  requireNotAborted(input.signal);
  if (!exactKeys(result, ["applied", "snapshot"]) || typeof result.applied !== "boolean") {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_CAS_INVALID",
      "Shared Cell cleanup authority CAS returned an invalid result.",
    );
  }
  assertSnapshotShape(result.snapshot);
  if (
    !result.applied ||
    result.snapshot.revision !== revision ||
    !sameItem(result.snapshot.item, next)
  ) {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_CAS_CONFLICT",
      "Shared Cell cleanup authority CAS was not applied exactly.",
      true,
    );
  }
  const observed = await input.port.observe({
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    signal: input.signal,
  });
  requireNotAborted(input.signal);
  assertSnapshotShape(observed);
  if (observed.revision !== revision || !sameItem(observed.item, next)) {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_READBACK_MISMATCH",
      "Shared Cell cleanup authority did not read back exactly after CAS.",
      true,
    );
  }
  const finalNow = readClock(clock, preCasNow, true);
  assertAuthorityWindow(
    nextRecord,
    finalNow,
    "SHARED_CELL_CLEANUP_AUTHORITY_EXPIRED_AFTER_WRITE",
  );
  return next;
}

export class DisabledAtomicSharedCellCleanupAuthority
  implements AtomicSharedCellCleanupAuthorityPort
{
  private disabled(): never {
    return fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_WRITER_DISABLED",
      "No Shared Cell cleanup authority writer is configured.",
    );
  }

  async observe(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    signal: AbortSignal;
  }): Promise<SharedCellCleanupAuthoritySnapshot> {
    void input;
    return this.disabled();
  }

  async compareAndSet(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    expected: SharedCellCleanupAuthoritySnapshot;
    next: SharedCellCleanupAuthorityItem;
    signal: AbortSignal;
  }): Promise<{
    applied: boolean;
    snapshot: SharedCellCleanupAuthoritySnapshot;
  }> {
    void input;
    return this.disabled();
  }
}
