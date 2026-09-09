import { neon } from "@neondatabase/serverless";
import type {
  ReadSerializableSharedCellOwnershipSnapshotInput,
  SerializableSharedCellOwnershipSnapshot,
  SerializableSharedCellOwnershipSnapshotSource,
} from "./shared-cell-zero-tenant-evidence.ts";

interface NeonTransactionQuery {
  readonly queryData?: unknown;
}

interface NeonTransactionClient {
  query(statement: string, values?: unknown[]): NeonTransactionQuery;
}

export interface NeonSerializableSnapshotSqlClient {
  transaction(
    queries: (client: NeonTransactionClient) => NeonTransactionQuery[],
    options: {
      isolationLevel: "Serializable";
      readOnly: true;
      deferrable: true;
      fullResults: true;
      fetchOptions: { signal: AbortSignal };
    },
  ): Promise<unknown[]>;
}

const accountId = "402010193138";
const region = "ca-central-1";
const cellId = "cell-sandbox-1";
const environmentId = "env_aws_sandbox_ca_central_1";
const safeRetryableSqlStates = new Set([
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
]);
const safeProviderCodes = new Set([
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
const safeProviderNames = new Set([
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
const inputKeys = [
  "accountId",
  "cellId",
  "environmentId",
  "region",
  "signal",
] as const;

export class NeonSharedCellZeroTenantSourceError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function fail(code: string, message: string, retryable = false): never {
  throw new NeonSharedCellZeroTenantSourceError(code, message, retryable);
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

function member(
  value: Record<string, unknown>,
  key: string,
): unknown {
  try {
    return value[key];
  } catch {
    return undefined;
  }
}

function safeProviderIdentifier(
  value: unknown,
  kind: "code" | "name",
): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (
    kind === "code" &&
    (safeRetryableSqlStates.has(value) || safeProviderCodes.has(value))
  ) {
    return value;
  }
  return kind === "name" && safeProviderNames.has(value) ? value : undefined;
}

function exactKeys(value: unknown, expected: readonly string[]): boolean {
  const keys = Object.keys(record(value)).sort();
  const sorted = [...expected].sort();
  return (
    keys.length === sorted.length &&
    keys.every((key, index) => key === sorted[index])
  );
}

function assertInput(
  input: ReadSerializableSharedCellOwnershipSnapshotInput,
): void {
  if (
    !exactKeys(input, inputKeys) ||
    input.accountId !== accountId ||
    input.region !== region ||
    input.cellId !== cellId ||
    input.environmentId !== environmentId ||
    !input.signal ||
    typeof input.signal.throwIfAborted !== "function"
  ) {
    fail(
      "NEON_SHARED_CELL_SNAPSHOT_INPUT_INVALID",
      "The Neon ownership snapshot target is outside the fixed Sandbox Cell.",
    );
  }
}

function rows(value: unknown, label: string): Record<string, unknown>[] {
  const raw = record(value).rows;
  if (
    !Array.isArray(raw) ||
    raw.some(
      (row) => !row || typeof row !== "object" || Array.isArray(row),
    )
  ) {
    fail(
      "NEON_SHARED_CELL_SNAPSHOT_RESULT_INVALID",
      `The ${label} ownership query returned a malformed result.`,
    );
  }
  return raw as Record<string, unknown>[];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function flag(value: unknown): boolean {
  return value === true || value === "t" || value === 1 || value === "1";
}

function ids(value: unknown, label: string): string[] {
  const result = rows(value, label).map((row) => {
    if (!exactKeys(row, ["id"])) {
      fail(
        "NEON_SHARED_CELL_SNAPSHOT_RESULT_INVALID",
        `The ${label} ownership query returned unexpected fields.`,
      );
    }
    const id = text(row.id);
    if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/.test(id)) {
      fail(
        "NEON_SHARED_CELL_SNAPSHOT_RESULT_INVALID",
        `The ${label} ownership query returned an invalid identifier.`,
      );
    }
    return id;
  });
  if (
    new Set(result).size !== result.length ||
    result.some((id, index) => id !== [...result].sort()[index])
  ) {
    fail(
      "NEON_SHARED_CELL_SNAPSHOT_RESULT_INVALID",
      `The ${label} ownership query was not complete, unique and ordered.`,
    );
  }
  return result;
}

function environment(value: unknown): Pick<
  SerializableSharedCellOwnershipSnapshot,
  | "dbObservedAt"
  | "admissionState"
  | "admissionEpoch"
  | "admissionFenceSha256"
  | "admissionProvisionOperationHash"
  | "admissionStackId"
  | "admissionCellExpiresAt"
  | "admissionChangedAt"
  | "databaseCellExpired"
> {
  const result = rows(value, "environment");
  if (result.length !== 1) {
    fail(
      "NEON_SHARED_CELL_ENVIRONMENT_INVALID",
      "The fixed Sandbox deployment environment is missing or duplicated.",
    );
  }
  const row = result[0];
  if (
    !exactKeys(row, [
      "account_id",
      "admission_cell_expires_at",
      "admission_changed_at",
      "admission_epoch",
      "admission_fence_sha256",
      "admission_provision_operation_hash",
      "admission_stack_id",
      "admission_state",
      "cell_key",
      "database_cell_expired",
      "db_observed_at",
      "environment_id",
      "region",
    ]) ||
    row.environment_id !== environmentId ||
    row.account_id !== accountId ||
    row.region !== region ||
    row.cell_key !== cellId
  ) {
    fail(
      "NEON_SHARED_CELL_ENVIRONMENT_INVALID",
      "The database environment does not match the fixed Sandbox Cell.",
    );
  }
  const observedAt = Number(row.db_observed_at);
  const admissionEpoch = Number(row.admission_epoch);
  const admissionCellExpiresAt = Number(row.admission_cell_expires_at);
  const admissionChangedAt = Number(row.admission_changed_at);
  const admissionFenceSha256 = text(row.admission_fence_sha256);
  const admissionProvisionOperationHash = text(
    row.admission_provision_operation_hash,
  );
  const admissionStackId = text(row.admission_stack_id);
  if (
    !Number.isSafeInteger(observedAt) ||
    observedAt <= 0 ||
    row.admission_state !== "draining" ||
    !Number.isSafeInteger(admissionEpoch) ||
    admissionEpoch < 1 ||
    !/^[a-f0-9]{64}$/.test(admissionFenceSha256) ||
    !/^[a-f0-9]{64}$/.test(admissionProvisionOperationHash) ||
    !/^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[0-9a-f-]{36}$/.test(
      admissionStackId,
    ) ||
    !Number.isSafeInteger(admissionCellExpiresAt) ||
    admissionCellExpiresAt <= 0 ||
    !Number.isSafeInteger(admissionChangedAt) ||
    admissionChangedAt < admissionCellExpiresAt ||
    observedAt < admissionChangedAt ||
    !flag(row.database_cell_expired)
  ) {
    fail(
      "NEON_SHARED_CELL_SNAPSHOT_RESULT_INVALID",
      "The database transaction clock is invalid.",
    );
  }
  return {
    dbObservedAt: observedAt,
    admissionState: "draining",
    admissionEpoch,
    admissionFenceSha256,
    admissionProvisionOperationHash,
    admissionStackId,
    admissionCellExpiresAt,
    admissionChangedAt,
    databaseCellExpired: true,
  };
}

function normalizeProviderError(error: unknown): Error {
  const source = record(error);
  const nested = record(member(source, "cause"));
  const rawName = member(source, "name");
  const rawCodes = [member(source, "code"), member(nested, "code")];
  const providerCode =
    rawCodes
      .map((value) => safeProviderIdentifier(value, "code"))
      .find((value) => value !== undefined) ??
    safeProviderIdentifier(rawName, "name") ??
    "NEON_SHARED_CELL_SNAPSHOT_READ_FAILED";
  const retryTokens = [
    rawName,
    member(source, "code"),
    member(nested, "name"),
    member(nested, "code"),
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return new NeonSharedCellZeroTenantSourceError(
    providerCode,
    "The Neon serializable Shared Cell ownership snapshot failed.",
    member(source, "retryable") === true ||
      member(nested, "retryable") === true ||
      rawCodes.some(
        (value) =>
          typeof value === "string" &&
          (safeRetryableSqlStates.has(value) || safeProviderCodes.has(value)),
      ) ||
      /Serialization|Deadlock|Transaction|Timeout|Unavailable|Connection|Fetch/i.test(
        retryTokens,
      ),
  );
}

/**
 * Reads every database-side Cell ownership signal in one serializable,
 * read-only, deferrable Neon HTTP transaction. Construction is inert: no
 * database request occurs until readSerializableReadOnlySnapshot() is called.
 */
export class NeonSerializableSharedCellOwnershipSnapshotSource
  implements SerializableSharedCellOwnershipSnapshotSource
{
  private readonly sql: NeonSerializableSnapshotSqlClient;

  constructor(sql: NeonSerializableSnapshotSqlClient) {
    if (!sql || typeof sql.transaction !== "function") {
      fail(
        "NEON_SHARED_CELL_SNAPSHOT_CLIENT_INVALID",
        "The Neon serializable transaction client is invalid.",
      );
    }
    this.sql = sql;
  }

  async readSerializableReadOnlySnapshot(
    input: ReadSerializableSharedCellOwnershipSnapshotInput,
  ): Promise<SerializableSharedCellOwnershipSnapshot> {
    assertInput(input);
    input.signal.throwIfAborted();
    let results: unknown[];
    try {
      results = await this.sql.transaction(
        (transaction) => [
          transaction.query(
            `SELECT environment.id AS environment_id,
              environment.expected_account_id AS account_id,
              environment.region,
              environment.cell_key,
              environment.admission_state,
              environment.admission_epoch,
              environment.admission_fence_sha256,
              environment.admission_provision_operation_hash,
              environment.admission_stack_id,
              environment.admission_cell_expires_at,
              environment.admission_changed_at,
              (extract(epoch FROM transaction_timestamp()) * 1000)::bigint
                AS db_observed_at,
              (environment.admission_cell_expires_at <=
                (extract(epoch FROM transaction_timestamp()) * 1000)::bigint)
                AS database_cell_expired
            FROM deployment_environments AS environment
            WHERE environment.id = $1
              AND environment.kind = 'aws_sandbox'
              AND environment.driver = 'aws_ecs_cell'
              AND environment.expected_account_id = $2
              AND environment.region = $3
              AND environment.cell_key = $4
              AND environment.status = 'active'
              AND environment.admission_state = 'draining'`,
            [environmentId, accountId, region, cellId],
          ),
          transaction.query(
            `SELECT DISTINCT instance.id
            FROM app_instances AS instance
            INNER JOIN app_instance_deployments AS deployment
              ON deployment.app_instance_id = instance.id
            WHERE deployment.environment_id = $1
              AND instance.status IN ('pending', 'active')
            ORDER BY instance.id`,
            [environmentId],
          ),
          transaction.query(
            `SELECT reservation.deployment_id AS id
            FROM deployment_environment_capacity_reservations AS reservation
            WHERE reservation.environment_id = $1
            ORDER BY reservation.deployment_id`,
            [environmentId],
          ),
          transaction.query(
            `SELECT deployment.id
            FROM app_instance_deployments AS deployment
            WHERE deployment.environment_id = $1
              AND deployment.status NOT IN ('rolled_back', 'canceled')
            ORDER BY deployment.id`,
            [environmentId],
          ),
          transaction.query(
            `SELECT resource.app_instance_id AS id
            FROM deployment_tenant_resources AS resource
            WHERE resource.environment_id = $1
              AND resource.lifecycle_status <> 'destroyed'
            ORDER BY resource.app_instance_id`,
            [environmentId],
          ),
          transaction.query(
            `SELECT schedule.id
            FROM deployment_cleanup_schedules AS schedule
            WHERE schedule.environment_id = $1
              AND schedule.status NOT IN ('succeeded', 'canceled')
            ORDER BY schedule.id`,
            [environmentId],
          ),
        ],
        {
          isolationLevel: "Serializable",
          readOnly: true,
          deferrable: true,
          fullResults: true,
          fetchOptions: { signal: input.signal },
        },
      );
      input.signal.throwIfAborted();
    } catch (error) {
      if (input.signal.aborted) {
        throw input.signal.reason instanceof Error
          ? input.signal.reason
          : Object.assign(new Error("Neon ownership snapshot was aborted."), {
              name: "AbortError",
              code: "ABORT_ERR",
            });
      }
      throw normalizeProviderError(error);
    }
    if (!Array.isArray(results) || results.length !== 6) {
      fail(
        "NEON_SHARED_CELL_SNAPSHOT_RESULT_INVALID",
        "The Neon ownership transaction did not return all six fixed results.",
      );
    }
    const fixedEnvironment = environment(results[0]);
    return Object.freeze({
      schemaVersion: 2 as const,
      isolationLevel: "Serializable" as const,
      readOnly: true as const,
      deferrable: true as const,
      accountId,
      region,
      cellId,
      environmentId,
      ...fixedEnvironment,
      activeTenantIds: Object.freeze(ids(results[1], "active tenant")),
      activeCapacityReservationIds: Object.freeze(
        ids(results[2], "capacity reservation"),
      ),
      nonterminalDeploymentIds: Object.freeze(
        ids(results[3], "nonterminal deployment"),
      ),
      liveTenantResourceIds: Object.freeze(
        ids(results[4], "live tenant resource"),
      ),
      nonterminalTenantCleanupScheduleIds: Object.freeze(
        ids(results[5], "nonterminal cleanup schedule"),
      ),
    });
  }
}

export function createNeonSerializableSharedCellOwnershipSnapshotSource(
  databaseUrl: string,
): NeonSerializableSharedCellOwnershipSnapshotSource {
  if (
    typeof databaseUrl !== "string" ||
    !/^postgres(?:ql)?:\/\//.test(databaseUrl)
  ) {
    fail(
      "NEON_SHARED_CELL_SNAPSHOT_DATABASE_URL_INVALID",
      "The Shared Cell ownership source requires a PostgreSQL DATABASE_URL.",
    );
  }
  try {
    const sql = neon(databaseUrl, { fullResults: true });
    return new NeonSerializableSharedCellOwnershipSnapshotSource(
      sql as unknown as NeonSerializableSnapshotSqlClient,
    );
  } catch {
    return fail(
      "NEON_SHARED_CELL_SNAPSHOT_DATABASE_URL_INVALID",
      "The Shared Cell ownership source requires a valid PostgreSQL DATABASE_URL.",
    );
  }
}
