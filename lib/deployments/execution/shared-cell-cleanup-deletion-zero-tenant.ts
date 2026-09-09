import { sha256Hex } from "./hash.ts";
import type { SharedCellCleanupDeletionEvidenceReadPort } from "./shared-cell-cleanup-deletion.ts";
import type {
  SerializableSharedCellOwnershipSnapshot,
  SerializableSharedCellOwnershipSnapshotSource,
} from "./shared-cell-zero-tenant-evidence.ts";

const accountId = "402010193138";
const region = "ca-central-1";
const cellId = "cell-sandbox-1";
const environmentId = "env_aws_sandbox_ca_central_1";
const maximumReadDurationMs = 30_000;
const safeSourceErrorCodes = new Set([
  "NEON_SHARED_CELL_ENVIRONMENT_INVALID",
  "NEON_SHARED_CELL_SNAPSHOT_CLIENT_INVALID",
  "NEON_SHARED_CELL_SNAPSHOT_DATABASE_URL_INVALID",
  "NEON_SHARED_CELL_SNAPSHOT_INPUT_INVALID",
  "NEON_SHARED_CELL_SNAPSHOT_READ_FAILED",
  "NEON_SHARED_CELL_SNAPSHOT_RESULT_INVALID",
  "SHARED_CELL_DELETE_ZERO_TENANT_CLOCK_INVALID",
  "SHARED_CELL_DELETE_ZERO_TENANT_INPUT_INVALID",
  "SHARED_CELL_DELETE_ZERO_TENANT_OPTIONS_INVALID",
  "SHARED_CELL_DELETE_ZERO_TENANT_READ_FAILED",
  "SHARED_CELL_DELETE_ZERO_TENANT_SNAPSHOT_INVALID",
  "SHARED_CELL_DELETE_ZERO_TENANT_SOURCE_INVALID",
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

type DeletionZeroTenantReadPort = Pick<
  SharedCellCleanupDeletionEvidenceReadPort,
  "readStrongZeroTenantOwnershipSnapshot"
>;

export class SharedCellCleanupDeletionZeroTenantError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function fail(code: string, message: string, retryable = false): never {
  throw new SharedCellCleanupDeletionZeroTenantError(code, message, retryable);
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
  const keys = Object.keys(record(value)).sort();
  const sorted = [...expected].sort();
  return (
    keys.length === sorted.length &&
    keys.every((key, index) => key === sorted[index])
  );
}

function clockValue(now: () => number): number {
  let value: number;
  try {
    value = now();
  } catch {
    return fail(
      "SHARED_CELL_DELETE_ZERO_TENANT_CLOCK_INVALID",
      "The deletion ownership evidence clock could not be read.",
    );
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(
      "SHARED_CELL_DELETE_ZERO_TENANT_CLOCK_INVALID",
      "The deletion ownership evidence clock is invalid.",
    );
  }
  return value;
}

function pinSource(
  source: SerializableSharedCellOwnershipSnapshotSource,
): SerializableSharedCellOwnershipSnapshotSource {
  if (
    !source ||
    typeof source !== "object" ||
    typeof source.readSerializableReadOnlySnapshot !== "function"
  ) {
    fail(
      "SHARED_CELL_DELETE_ZERO_TENANT_SOURCE_INVALID",
      "A serializable zero-tenant ownership source is required.",
    );
  }
  const read = source.readSerializableReadOnlySnapshot;
  return Object.freeze({
    readSerializableReadOnlySnapshot: (
      input: Parameters<
        SerializableSharedCellOwnershipSnapshotSource["readSerializableReadOnlySnapshot"]
      >[0],
    ) => read.call(source, input),
  });
}

function sortedUniqueIds(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (id) =>
        typeof id !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/.test(id),
    )
  ) {
    fail(
      "SHARED_CELL_DELETE_ZERO_TENANT_SNAPSHOT_INVALID",
      `${label} is not a complete identifier list.`,
    );
  }
  const result = [...value] as string[];
  if (
    new Set(result).size !== result.length ||
    result.some(
      (id, index) => id !== [...result].sort((left, right) => left.localeCompare(right))[index],
    )
  ) {
    fail(
      "SHARED_CELL_DELETE_ZERO_TENANT_SNAPSHOT_INVALID",
      `${label} is not unique and sorted.`,
    );
  }
  return result;
}

function validateSnapshot(
  value: unknown,
  startedAt: number,
  completedAt: number,
): {
  observedAt: number;
  sourceSnapshot: {
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
  };
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
      "SHARED_CELL_DELETE_ZERO_TENANT_SNAPSHOT_INVALID",
      "The deletion ownership snapshot has missing or unexpected fields.",
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
    !/^[a-f0-9]{64}$/.test(snapshot.admissionFenceSha256) ||
    !/^[a-f0-9]{64}$/.test(snapshot.admissionProvisionOperationHash) ||
    !/^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[0-9a-f-]{36}$/.test(
      snapshot.admissionStackId,
    ) ||
    !Number.isSafeInteger(snapshot.admissionCellExpiresAt) ||
    snapshot.admissionCellExpiresAt <= 0 ||
    !Number.isSafeInteger(snapshot.admissionChangedAt) ||
    snapshot.admissionChangedAt < snapshot.admissionCellExpiresAt ||
    snapshot.dbObservedAt < snapshot.admissionChangedAt ||
    snapshot.databaseCellExpired !== true ||
    completedAt < startedAt ||
    completedAt - startedAt > maximumReadDurationMs
  ) {
    fail(
      "SHARED_CELL_DELETE_ZERO_TENANT_SNAPSHOT_INVALID",
      "Deletion requires one fresh serializable read-only snapshot for the fixed Sandbox Cell.",
    );
  }
  return {
    observedAt: snapshot.dbObservedAt,
    sourceSnapshot: {
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
      activeTenantIds: sortedUniqueIds(
        snapshot.activeTenantIds,
        "activeTenantIds",
      ),
      activeCapacityReservationIds: sortedUniqueIds(
        snapshot.activeCapacityReservationIds,
        "activeCapacityReservationIds",
      ),
      nonterminalDeploymentIds: sortedUniqueIds(
        snapshot.nonterminalDeploymentIds,
        "nonterminalDeploymentIds",
      ),
      liveTenantResourceIds: sortedUniqueIds(
        snapshot.liveTenantResourceIds,
        "liveTenantResourceIds",
      ),
      nonterminalTenantCleanupScheduleIds: sortedUniqueIds(
        snapshot.nonterminalTenantCleanupScheduleIds,
        "nonterminalTenantCleanupScheduleIds",
      ),
    },
  };
}

function normalizeSourceError(error: unknown): Error {
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
    "SHARED_CELL_DELETE_ZERO_TENANT_READ_FAILED";
  return new SharedCellCleanupDeletionZeroTenantError(
    code,
    "The deletion zero-tenant ownership read failed.",
    member(value, "retryable") === true ||
      /Serialization|Deadlock|Transaction|Timeout|Unavailable|Connection|Fetch/i.test(
        `${rawName} ${rawCode}`,
      ),
  );
}

/**
 * Projects the same trusted Neon snapshot used by the authority reviewer into
 * the deletion core's count + source-list envelope. It performs no AWS or
 * database work during construction and exposes no database write method.
 */
export class SerializableSharedCellCleanupDeletionZeroTenantAdapter
  implements DeletionZeroTenantReadPort
{
  private readonly source: SerializableSharedCellOwnershipSnapshotSource;
  private readonly now: () => number;

  constructor(
    source: SerializableSharedCellOwnershipSnapshotSource,
    options: { now?: () => number } = {},
  ) {
    if (!exactKeys(options, options.now === undefined ? [] : ["now"])) {
      fail(
        "SHARED_CELL_DELETE_ZERO_TENANT_OPTIONS_INVALID",
        "Deletion zero-tenant options contain unexpected fields.",
      );
    }
    if (options.now !== undefined && typeof options.now !== "function") {
      fail(
        "SHARED_CELL_DELETE_ZERO_TENANT_OPTIONS_INVALID",
        "The deletion zero-tenant clock is invalid.",
      );
    }
    this.source = pinSource(source);
    this.now = options.now ?? Date.now;
  }

  async readStrongZeroTenantOwnershipSnapshot(input: {
    signal: AbortSignal;
  }): Promise<unknown> {
    if (
      !exactKeys(input, ["signal"]) ||
      !input.signal ||
      typeof input.signal.throwIfAborted !== "function"
    ) {
      fail(
        "SHARED_CELL_DELETE_ZERO_TENANT_INPUT_INVALID",
        "Deletion zero-tenant input is malformed.",
      );
    }
    try {
      input.signal.throwIfAborted();
      const startedAt = clockValue(this.now);
      const raw = await this.source.readSerializableReadOnlySnapshot({
        accountId,
        region,
        cellId,
        environmentId,
        signal: input.signal,
      });
      input.signal.throwIfAborted();
      const completedAt = clockValue(this.now);
      const snapshot = validateSnapshot(raw, startedAt, completedAt);
      const sourceSnapshotSha256 = await sha256Hex(snapshot.sourceSnapshot);
      input.signal.throwIfAborted();
      return Object.freeze({
        schemaVersion: 1 as const,
        accountId,
        region,
        cellId,
        environmentId,
        observedAt: snapshot.observedAt,
        activeTenantCount: snapshot.sourceSnapshot.activeTenantIds.length,
        activeCapacityReservationCount:
          snapshot.sourceSnapshot.activeCapacityReservationIds.length,
        nonterminalDeploymentCount:
          snapshot.sourceSnapshot.nonterminalDeploymentIds.length,
        liveTenantResourceCount:
          snapshot.sourceSnapshot.liveTenantResourceIds.length,
        nonterminalTenantCleanupScheduleCount:
          snapshot.sourceSnapshot.nonterminalTenantCleanupScheduleIds.length,
        sourceSnapshot: Object.freeze({
          admissionFence: Object.freeze({
            ...snapshot.sourceSnapshot.admissionFence,
          }),
          activeTenantIds: Object.freeze(
            snapshot.sourceSnapshot.activeTenantIds,
          ),
          activeCapacityReservationIds: Object.freeze(
            snapshot.sourceSnapshot.activeCapacityReservationIds,
          ),
          nonterminalDeploymentIds: Object.freeze(
            snapshot.sourceSnapshot.nonterminalDeploymentIds,
          ),
          liveTenantResourceIds: Object.freeze(
            snapshot.sourceSnapshot.liveTenantResourceIds,
          ),
          nonterminalTenantCleanupScheduleIds: Object.freeze(
            snapshot.sourceSnapshot.nonterminalTenantCleanupScheduleIds,
          ),
        }),
        sourceSnapshotSha256,
      });
    } catch (error) {
      if (input.signal.aborted) {
        throw input.signal.reason instanceof Error
          ? input.signal.reason
          : Object.assign(
              new Error("Deletion zero-tenant ownership read was aborted."),
              { name: "AbortError", code: "ABORT_ERR" },
            );
      }
      throw normalizeSourceError(error);
    }
  }
}
