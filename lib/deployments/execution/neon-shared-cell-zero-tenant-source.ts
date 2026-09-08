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
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function environment(value: unknown): number {
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
      "cell_key",
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
  if (!Number.isSafeInteger(observedAt) || observedAt <= 0) {
    fail(
      "NEON_SHARED_CELL_SNAPSHOT_RESULT_INVALID",
      "The database transaction clock is invalid.",
    );
  }
  return observedAt;
}

function normalizeProviderError(error: unknown): Error {
  if (error instanceof NeonSharedCellZeroTenantSourceError) return error;
  const source = record(error);
  const name =
    typeof source.name === "string" && source.name.length > 0
      ? source.name
      : "NEON_SHARED_CELL_SNAPSHOT_READ_FAILED";
  return new NeonSharedCellZeroTenantSourceError(
    name.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100),
    "The Neon serializable Shared Cell ownership snapshot failed.",
    /Serialization|Transaction|Timeout|Unavailable|Connection|Fetch/i.test(name),
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
              (extract(epoch FROM transaction_timestamp()) * 1000)::bigint
                AS db_observed_at
            FROM deployment_environments AS environment
            WHERE environment.id = $1
              AND environment.kind = 'aws_sandbox'
              AND environment.driver = 'aws_ecs_cell'
              AND environment.expected_account_id = $2
              AND environment.region = $3
              AND environment.cell_key = $4
              AND environment.status = 'active'`,
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
    return Object.freeze({
      schemaVersion: 1 as const,
      isolationLevel: "Serializable" as const,
      readOnly: true as const,
      deferrable: true as const,
      accountId,
      region,
      cellId,
      environmentId,
      dbObservedAt: environment(results[0]),
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
  if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
    fail(
      "NEON_SHARED_CELL_SNAPSHOT_DATABASE_URL_INVALID",
      "The Shared Cell ownership source requires a PostgreSQL DATABASE_URL.",
    );
  }
  const sql = neon(databaseUrl, { fullResults: true });
  return new NeonSerializableSharedCellOwnershipSnapshotSource(
    sql as unknown as NeonSerializableSnapshotSqlClient,
  );
}
