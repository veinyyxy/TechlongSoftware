import { canonicalJson, sha256Hex } from "./hash.ts";
import {
  SharedCellZeroTenantEvidencePort,
  type ReadSharedCellCleanupEvidenceInput,
  type VerifiedSharedCellZeroTenantEvidence,
} from "./shared-cell-cleanup-authority-operator.ts";
import {
  compileSharedCellAdmissionDrainIntent,
} from "./shared-cell-admission-fence.ts";

const accountId = "402010193138";
const region = "ca-central-1";
const cellId = "cell-sandbox-1";
const environmentId = "env_aws_sandbox_ca_central_1";
const maximumEvidenceAgeMs = 30_000;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/;
const utcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const safeSourceErrorCodes = new Set([
  "NEON_SHARED_CELL_ENVIRONMENT_INVALID",
  "NEON_SHARED_CELL_SNAPSHOT_CLIENT_INVALID",
  "NEON_SHARED_CELL_SNAPSHOT_DATABASE_URL_INVALID",
  "NEON_SHARED_CELL_SNAPSHOT_INPUT_INVALID",
  "NEON_SHARED_CELL_SNAPSHOT_READ_FAILED",
  "NEON_SHARED_CELL_SNAPSHOT_RESULT_INVALID",
  "SHARED_CELL_ADMISSION_PREDECESSOR_INVALID",
  "SHARED_CELL_ZERO_TENANT_CLOCK_INVALID",
  "SHARED_CELL_ZERO_TENANT_EVIDENCE_STALE",
  "SHARED_CELL_ZERO_TENANT_NOT_ZERO",
  "SHARED_CELL_ZERO_TENANT_OPTIONS_INVALID",
  "SHARED_CELL_ZERO_TENANT_PREDECESSOR_INVALID",
  "SHARED_CELL_ZERO_TENANT_READ_FAILED",
  "SHARED_CELL_ZERO_TENANT_SNAPSHOT_INVALID",
  "SHARED_CELL_ZERO_TENANT_SOURCE_MISSING",
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "40001",
  "40003",
  "40P01",
  "55P03",
  "57P01",
  "57P02",
  "57P03",
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_ABORTED",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CLOSED",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_DESTROYED",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);
const safeSourceErrorNames = new Set([
  "AbortError",
  "ConnectionError",
  "Error",
  "FetchError",
  "NeonDbError",
  "NetworkError",
  "SerializationError",
  "SerializationFailure",
  "TimeoutError",
  "TransactionError",
  "TypeError",
]);

/**
 * Current integration blocker, not a permanent limitation: the default Worker
 * root does not yet provide the Neon implementation of the serializable source
 * below. The adapter never substitutes an empty snapshot when that source is
 * absent.
 */
export const SHARED_CELL_ZERO_TENANT_SOURCE_WIRING_BLOCKER =
  "neon_serializable_zero_tenant_snapshot_source_not_wired" as const;

export interface ReadSerializableSharedCellOwnershipSnapshotInput {
  accountId: typeof accountId;
  region: typeof region;
  cellId: typeof cellId;
  environmentId: typeof environmentId;
  signal: AbortSignal;
}

/**
 * One result returned from one Neon HTTP transaction configured with
 * isolationLevel=Serializable, readOnly=true and deferrable=true. A production
 * source must evaluate all five queries in that same transaction and use the
 * database clock for dbObservedAt. Every ID list must be unique and sorted.
 */
export interface SerializableSharedCellOwnershipSnapshot {
  readonly schemaVersion: 2;
  readonly isolationLevel: "Serializable";
  readonly readOnly: true;
  readonly deferrable: true;
  readonly accountId: typeof accountId;
  readonly region: typeof region;
  readonly cellId: typeof cellId;
  readonly environmentId: typeof environmentId;
  readonly dbObservedAt: number;
  readonly admissionState: "draining";
  readonly admissionEpoch: number;
  readonly admissionFenceSha256: string;
  readonly admissionProvisionOperationHash: string;
  readonly admissionStackId: string;
  readonly admissionCellExpiresAt: number;
  readonly admissionChangedAt: number;
  readonly databaseCellExpired: true;
  readonly activeTenantIds: readonly string[];
  readonly activeCapacityReservationIds: readonly string[];
  readonly nonterminalDeploymentIds: readonly string[];
  readonly liveTenantResourceIds: readonly string[];
  readonly nonterminalTenantCleanupScheduleIds: readonly string[];
}

export interface SerializableSharedCellOwnershipSnapshotSource {
  readSerializableReadOnlySnapshot(
    input: ReadSerializableSharedCellOwnershipSnapshotInput,
  ): Promise<SerializableSharedCellOwnershipSnapshot>;
}

export class SharedCellZeroTenantEvidenceError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function fail(code: string, message: string, retryable = false): never {
  throw new SharedCellZeroTenantEvidenceError(code, message, retryable);
}

function record(value: unknown): Record<string, unknown> {
  try {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function member(value: Record<string, unknown>, key: string): unknown {
  try {
    return value[key];
  } catch {
    return undefined;
  }
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

function requireNotAborted(signal: AbortSignal): void {
  signal.throwIfAborted();
}

function clockValue(clock: () => number, label: string): number {
  let value: number;
  try {
    value = clock();
  } catch {
    return fail(
      "SHARED_CELL_ZERO_TENANT_CLOCK_INVALID",
      `${label} could not be read.`,
    );
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(
      "SHARED_CELL_ZERO_TENANT_CLOCK_INVALID",
      `${label} is not a positive safe integer.`,
    );
  }
  return value;
}

function canonicalUtc(value: unknown, label: string): number {
  if (typeof value !== "string" || !utcPattern.test(value)) {
    fail(
      "SHARED_CELL_ZERO_TENANT_PREDECESSOR_INVALID",
      `${label} must be canonical UTC with milliseconds.`,
    );
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail(
      "SHARED_CELL_ZERO_TENANT_PREDECESSOR_INVALID",
      `${label} is not a real canonical UTC instant.`,
    );
  }
  return parsed;
}

function assertSortedUniqueIds(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || !idPattern.test(item))
  ) {
    fail(
      "SHARED_CELL_ZERO_TENANT_SNAPSHOT_INVALID",
      `${label} must be a complete list of canonical ownership IDs.`,
    );
  }
  const result = [...value] as string[];
  if (
    new Set(result).size !== result.length ||
    canonicalJson(result) !==
      canonicalJson([...result].sort((left, right) => left.localeCompare(right)))
  ) {
    fail(
      "SHARED_CELL_ZERO_TENANT_SNAPSHOT_INVALID",
      `${label} must be unique and sorted by the database query.`,
    );
  }
  return result;
}

function pinSource(
  value: SerializableSharedCellOwnershipSnapshotSource,
): SerializableSharedCellOwnershipSnapshotSource {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.readSerializableReadOnlySnapshot !== "function"
  ) {
    fail(
      "SHARED_CELL_ZERO_TENANT_SOURCE_MISSING",
      "A trusted serializable ownership snapshot source is required; empty evidence cannot be synthesized.",
    );
  }
  const read = value.readSerializableReadOnlySnapshot;
  return Object.freeze({
    readSerializableReadOnlySnapshot: (
      input: ReadSerializableSharedCellOwnershipSnapshotInput,
    ) => read.call(value, input),
  });
}

interface SourceIdSnapshot {
  admissionFence: {
    admissionState: "draining";
    admissionEpoch: number;
    admissionFenceSha256: string;
    admissionProvisionOperationHash: string;
    admissionStackId: string;
    admissionCellExpiresAt: number;
    admissionChangedAt: number;
  };
  activeTenantIds: string[];
  activeCapacityReservationIds: string[];
  nonterminalDeploymentIds: string[];
  liveTenantResourceIds: string[];
  nonterminalTenantCleanupScheduleIds: string[];
}

function validateSnapshot(
  value: unknown,
  cellExpiresAt: number,
  expectedFenceSha256: string,
  predecessor: ReadSharedCellCleanupEvidenceInput["predecessor"],
): {
  observedAt: number;
  source: SourceIdSnapshot;
} {
  if (
    !exactKeys(value, [
      "accountId",
      "admissionCellExpiresAt",
      "admissionChangedAt",
      "admissionEpoch",
      "admissionFenceSha256",
      "admissionProvisionOperationHash",
      "admissionStackId",
      "admissionState",
      "activeCapacityReservationIds",
      "activeTenantIds",
      "cellId",
      "dbObservedAt",
      "databaseCellExpired",
      "deferrable",
      "environmentId",
      "isolationLevel",
      "liveTenantResourceIds",
      "nonterminalDeploymentIds",
      "nonterminalTenantCleanupScheduleIds",
      "readOnly",
      "region",
      "schemaVersion",
    ])
  ) {
    fail(
      "SHARED_CELL_ZERO_TENANT_SNAPSHOT_INVALID",
      "The serializable ownership snapshot has missing or unexpected fields.",
    );
  }
  const snapshot = value as SerializableSharedCellOwnershipSnapshot;
  if (
    snapshot.schemaVersion !== 2 ||
    snapshot.isolationLevel !== "Serializable" ||
    snapshot.readOnly !== true ||
    snapshot.deferrable !== true ||
    snapshot.accountId !== accountId ||
    snapshot.region !== region ||
    snapshot.cellId !== cellId ||
    snapshot.environmentId !== environmentId ||
    !Number.isSafeInteger(snapshot.dbObservedAt) ||
    snapshot.dbObservedAt <= 0 ||
    snapshot.admissionState !== "draining" ||
    !Number.isSafeInteger(snapshot.admissionEpoch) ||
    snapshot.admissionEpoch < 1 ||
    snapshot.admissionFenceSha256 !== expectedFenceSha256 ||
    snapshot.admissionProvisionOperationHash !==
      predecessor.provisionOperationHash ||
    snapshot.admissionStackId !== predecessor.stackId ||
    snapshot.admissionCellExpiresAt !== cellExpiresAt ||
    !Number.isSafeInteger(snapshot.admissionChangedAt) ||
    snapshot.admissionChangedAt < cellExpiresAt ||
    snapshot.dbObservedAt < snapshot.admissionChangedAt ||
    snapshot.databaseCellExpired !== true
  ) {
    fail(
      "SHARED_CELL_ZERO_TENANT_SNAPSHOT_INVALID",
      "The source is not one fresh, post-expiry serializable read-only database snapshot for the fixed Cell.",
    );
  }
  const source: SourceIdSnapshot = {
    admissionFence: {
      admissionState: snapshot.admissionState,
      admissionEpoch: snapshot.admissionEpoch,
      admissionFenceSha256: snapshot.admissionFenceSha256,
      admissionProvisionOperationHash:
        snapshot.admissionProvisionOperationHash,
      admissionStackId: snapshot.admissionStackId,
      admissionCellExpiresAt: snapshot.admissionCellExpiresAt,
      admissionChangedAt: snapshot.admissionChangedAt,
    },
    activeTenantIds: assertSortedUniqueIds(
      snapshot.activeTenantIds,
      "activeTenantIds",
    ),
    activeCapacityReservationIds: assertSortedUniqueIds(
      snapshot.activeCapacityReservationIds,
      "activeCapacityReservationIds",
    ),
    nonterminalDeploymentIds: assertSortedUniqueIds(
      snapshot.nonterminalDeploymentIds,
      "nonterminalDeploymentIds",
    ),
    liveTenantResourceIds: assertSortedUniqueIds(
      snapshot.liveTenantResourceIds,
      "liveTenantResourceIds",
    ),
    nonterminalTenantCleanupScheduleIds: assertSortedUniqueIds(
      snapshot.nonterminalTenantCleanupScheduleIds,
      "nonterminalTenantCleanupScheduleIds",
    ),
  };
  if (
    [
      source.activeTenantIds,
      source.activeCapacityReservationIds,
      source.nonterminalDeploymentIds,
      source.liveTenantResourceIds,
      source.nonterminalTenantCleanupScheduleIds,
    ].some((ids) => ids.length !== 0)
  ) {
    fail(
      "SHARED_CELL_ZERO_TENANT_NOT_ZERO",
      "At least one tenant, reservation, deployment, resource or cleanup schedule still owns the Shared Cell.",
    );
  }
  return { observedAt: snapshot.dbObservedAt, source };
}

function normalizeSourceError(error: unknown): SharedCellZeroTenantEvidenceError {
  const value = record(error);
  const codeValue = member(value, "code");
  const nameValue = member(value, "name");
  const rawCode = typeof codeValue === "string" ? codeValue : "";
  const rawName = typeof nameValue === "string" ? nameValue : "";
  const code =
    (safeSourceErrorCodes.has(rawCode) ? rawCode : undefined) ??
    (rawCode.length === 0 && safeSourceErrorNames.has(rawName)
      ? rawName
      : undefined) ??
    "SHARED_CELL_ZERO_TENANT_READ_FAILED";
  return new SharedCellZeroTenantEvidenceError(
    code,
    "The durable admission drain or serializable ownership read failed closed.",
    member(value, "retryable") === true ||
      /Serialization|Deadlock|Transaction|Timeout|Unavailable|Connection|Fetch/i.test(
        `${rawName} ${rawCode}`,
      ),
  );
}

/**
 * Production-facing, fail-closed bridge from one trusted serializable Neon
 * snapshot to the private-provenance cleanup-authority evidence port. This
 * adapter cannot query five tables independently and cannot invent zeroes.
 */
export class SerializableSharedCellZeroTenantEvidenceAdapter extends SharedCellZeroTenantEvidencePort {
  private readonly source: SerializableSharedCellOwnershipSnapshotSource;
  private readonly now: () => number;

  constructor(
    source: SerializableSharedCellOwnershipSnapshotSource,
    options: { now?: () => number } = {},
  ) {
    super();
    if (!exactKeys(options, options.now === undefined ? [] : ["now"])) {
      fail(
        "SHARED_CELL_ZERO_TENANT_OPTIONS_INVALID",
        "Zero-tenant evidence options contain unexpected fields.",
      );
    }
    if (options.now !== undefined && typeof options.now !== "function") {
      fail(
        "SHARED_CELL_ZERO_TENANT_OPTIONS_INVALID",
        "The zero-tenant evidence clock is invalid.",
      );
    }
    this.source = pinSource(source);
    this.now = options.now ?? Date.now;
  }

  async readVerifiedZeroTenantEvidence(
    input: ReadSharedCellCleanupEvidenceInput,
  ): Promise<VerifiedSharedCellZeroTenantEvidence> {
    try {
      requireNotAborted(input.signal);
      if (
        input.predecessor.accountId !== accountId ||
        input.predecessor.region !== region ||
        input.predecessor.cellId !== cellId ||
        input.predecessor.stackName !== "techlong-sandbox-cell-sandbox-1" ||
        input.predecessor.state !== "provision_verified"
      ) {
        fail(
          "SHARED_CELL_ZERO_TENANT_PREDECESSOR_INVALID",
          "The ownership snapshot target is outside the exact Shared Cell predecessor.",
        );
      }
      const expiresAt = canonicalUtc(
        input.predecessor.cellExpiresAt,
        "Predecessor cellExpiresAt",
      );
      const startedAt = clockValue(this.now, "Evidence start clock");
      const compiled = await compileSharedCellAdmissionDrainIntent(
        input.predecessor,
      );
      requireNotAborted(input.signal);
      const raw = await this.source.readSerializableReadOnlySnapshot({
        accountId,
        region,
        cellId,
        environmentId,
        signal: input.signal,
      });
      requireNotAborted(input.signal);
      const completedAt = clockValue(this.now, "Evidence completion clock");
      if (
        completedAt < startedAt ||
        completedAt - startedAt > maximumEvidenceAgeMs
      ) {
        fail(
          "SHARED_CELL_ZERO_TENANT_EVIDENCE_STALE",
          "The ownership snapshot took too long or the local clock regressed.",
        );
      }
      const snapshot = validateSnapshot(
        raw,
        expiresAt,
        compiled.fenceSha256,
        input.predecessor,
      );
      const sourceSnapshotSha256 = await sha256Hex(snapshot.source);
      requireNotAborted(input.signal);
      return this.markVerified({
        schemaVersion: 1,
        verified: true,
        observedAt: snapshot.observedAt,
        accountId,
        region,
        cellId,
        environmentId,
        activeTenantCount: 0,
        activeCapacityReservationCount: 0,
        nonterminalDeploymentCount: 0,
        liveTenantResourceCount: 0,
        nonterminalTenantCleanupScheduleCount: 0,
        sourceSnapshotSha256,
      });
    } catch (error) {
      if (input.signal.aborted) {
        throw input.signal.reason instanceof Error
          ? input.signal.reason
          : Object.assign(
              new Error("Shared Cell zero-tenant evidence read was aborted."),
              { name: "AbortError", code: "ABORT_ERR" },
            );
      }
      throw normalizeSourceError(error);
    }
  }
}
