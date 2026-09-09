import { neon } from "@neondatabase/serverless";
import {
  SharedCellAdmissionFenceError,
  assertSharedCellAdmissionDrainReceipt,
  compileSharedCellAdmissionDrainIntent,
  type BeginSharedCellAdmissionDrainInput,
  type SharedCellAdmissionDrainReceipt,
  type SharedCellAdmissionFenceWriter,
} from "./shared-cell-admission-fence.ts";

export interface NeonSharedCellAdmissionFenceSqlClient {
  query(
    statement: string,
    values: unknown[],
    options: { fullResults: true; fetchOptions: { signal: AbortSignal } },
  ): Promise<unknown>;
}

const accountId = "402010193138";
const region = "ca-central-1";
const cellId = "cell-sandbox-1";
const environmentId = "env_aws_sandbox_ca_central_1";
const sqlStatePattern = /^[0-9A-Z]{5}$/;
const deterministicSqlStates = new Set([
  "22003",
  "22007",
  "22023",
  "23502",
  "23503",
  "23505",
  "23514",
  "40001",
  "40P01",
  "42501",
  "42601",
  "42703",
  "42P01",
  "55000",
  "55P03",
  "57014",
]);
const safeSqlStates = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "22003",
  "22007",
  "22023",
  "23502",
  "23503",
  "23505",
  "23514",
  "40001",
  "40003",
  "40P01",
  "42501",
  "42601",
  "42703",
  "42P01",
  "55000",
  "55P03",
  "57014",
  "57P01",
  "57P02",
  "57P03",
]);
const safeProviderCodes = new Set([
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
  "SyntaxError",
  "TimeoutError",
  "TransactionError",
  "TypeError",
]);

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

function safeProviderIdentifier(value: unknown, kind: "code" | "name") {
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (kind === "code" && (safeSqlStates.has(value) || safeProviderCodes.has(value))) {
    return value;
  }
  return kind === "name" && safeProviderNames.has(value) ? value : undefined;
}

function providerError(error: unknown): Error {
  let source: Record<string, unknown> = {};
  let nested: Record<string, unknown> = {};
  try {
    source = record(error);
    nested = record(member(source, "cause"));
  } catch {
    // An uninspectable provider failure is still wrapped without its message.
  }
  const sourceName = member(source, "name");
  const rawName = typeof sourceName === "string" ? sourceName : "";
  const providerCodes = [member(source, "code"), member(nested, "code")].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const safeCodes = providerCodes
    .map((value) => safeProviderIdentifier(value, "code"))
    .filter((value): value is string => value !== undefined);
  const providerCode =
    safeCodes.find((code) => sqlStatePattern.test(code)) ??
    safeCodes[0] ??
    safeProviderIdentifier(sourceName, "name") ??
    "NEON_SHARED_CELL_ADMISSION_DRAIN_FAILED";
  return new SharedCellAdmissionFenceError(
    providerCode,
    "The Neon Shared Cell admission drain failed closed.",
    member(source, "retryable") === true ||
      member(nested, "retryable") === true ||
      providerCodes.some((code) => /^(?:08|40)/.test(code)) ||
      providerCodes.some((code) =>
        ["55P03", "57P01", "57P02", "57P03"].includes(code),
      ) ||
      /Serialization|Deadlock|Transaction|Timeout|Unavailable|Connection|Fetch/i.test(
        rawName,
      ),
  );
}

function uncertainWrite(error: unknown): SharedCellAdmissionFenceError {
  const uncertain = new SharedCellAdmissionFenceError(
    "NEON_SHARED_CELL_ADMISSION_DRAIN_UNCERTAIN",
    "The admission drain may have committed; retry the exact predecessor to read back the idempotent fence.",
    true,
  );
  Object.defineProperty(uncertain, "cause", {
    configurable: true,
    enumerable: false,
    value: providerError(error),
  });
  return uncertain;
}

function providerWriteOutcomeUncertain(error: unknown): boolean {
  try {
    const source = record(error);
    const nested = record(member(source, "cause"));
    const codes = [member(source, "code"), member(nested, "code")].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (
      codes.some(
        (code) =>
          /^08/.test(code) ||
          code === "40003" ||
          ["57P01", "57P02", "57P03"].includes(code),
      )
    ) {
      return true;
    }
    const tokens = [
      member(source, "name"),
      member(source, "code"),
      member(source, "message"),
      member(nested, "name"),
      member(nested, "code"),
      member(nested, "message"),
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
    if (
      /Abort|Cancel|Fetch|Timeout|Connection|Network|Socket|ECONN|ETIMEDOUT|EPIPE|UND_ERR/i.test(
        tokens,
      )
    ) {
      return true;
    }
    if (codes.some((code) => deterministicSqlStates.has(code))) {
      return false;
    }
    const names = [member(source, "name"), member(nested, "name")];
    if (
      names.some(
        (name) =>
          name === "SerializationError" ||
          name === "SerializationFailure" ||
          name === "DeadlockError",
      )
    ) {
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

function boolean(value: unknown): boolean {
  return value === true || value === "t" || value === 1 || value === "1";
}

function receipt(value: unknown): SharedCellAdmissionDrainReceipt {
  const rows = record(value).rows;
  if (Array.isArray(rows) && rows.length === 0) {
    throw new SharedCellAdmissionFenceError(
      "NEON_SHARED_CELL_ADMISSION_DRAIN_REJECTED",
      "The database rejected the admission drain because the Cell is early, missing, or bound to another lineage.",
      false,
    );
  }
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new SharedCellAdmissionFenceError(
      "NEON_SHARED_CELL_ADMISSION_RECEIPT_INVALID",
      "The admission drain response did not contain one exact receipt.",
      false,
    );
  }
  const row = record(rows[0]);
  return {
    schemaVersion: 1,
    admissionState: String(row.admission_state) as "draining",
    accountId: String(row.account_id) as typeof accountId,
    region: String(row.region) as typeof region,
    cellId: String(row.cell_key) as typeof cellId,
    environmentId: String(row.environment_id) as typeof environmentId,
    admissionEpoch: Number(row.admission_epoch),
    admissionFenceSha256: String(row.admission_fence_sha256),
    admissionProvisionOperationHash: String(
      row.admission_provision_operation_hash,
    ),
    admissionStackId: String(row.admission_stack_id),
    admissionCellExpiresAt: Number(row.admission_cell_expires_at),
    admissionChangedAt: Number(row.admission_changed_at),
    dbObservedAt: Number(row.db_observed_at),
    databaseCellExpired: boolean(row.database_cell_expired) as true,
  };
}

/**
 * Atomically locks the same deployment-environment row used by tenant capacity
 * reservation and advances it from open to draining only after the database
 * clock reaches the immutable Cell expiry. Exact retries return the same fence;
 * different lineage is rejected. Construction performs no database request.
 */
export class NeonSharedCellAdmissionFenceWriter
  implements SharedCellAdmissionFenceWriter
{
  private readonly sql: NeonSharedCellAdmissionFenceSqlClient;

  constructor(sql: NeonSharedCellAdmissionFenceSqlClient) {
    if (!sql || typeof sql.query !== "function") {
      throw new SharedCellAdmissionFenceError(
        "NEON_SHARED_CELL_ADMISSION_CLIENT_INVALID",
        "The Neon admission-fence client is invalid.",
      );
    }
    this.sql = sql;
  }

  async beginAdmissionDrain(
    input: BeginSharedCellAdmissionDrainInput,
  ): Promise<Readonly<SharedCellAdmissionDrainReceipt>> {
    const signal = input.signal;
    signal.throwIfAborted();
    const compiled = await compileSharedCellAdmissionDrainIntent(
      input.predecessor,
    );
    const predecessor = compiled.intent.provisionLineage;
    signal.throwIfAborted();
    let raw: unknown;
    let queryStarted = false;
    try {
      queryStarted = true;
      raw = await this.sql.query(
        `WITH db_clock AS MATERIALIZED (
          SELECT (extract(epoch FROM transaction_timestamp()) * 1000)::bigint
            AS now_ms
        ), locked_environment AS MATERIALIZED (
          SELECT environment.id
          FROM deployment_environments AS environment
          CROSS JOIN db_clock
          WHERE environment.id = $1
            AND environment.kind = 'aws_sandbox'
            AND environment.driver = 'aws_ecs_cell'
            AND environment.expected_account_id = $2
            AND environment.region = $3
            AND environment.cell_key = $4
            AND environment.status = 'active'
            AND $6::bigint <= db_clock.now_ms
          FOR UPDATE OF environment
        ), drained AS (
          UPDATE deployment_environments AS environment
          SET admission_state = 'draining',
            admission_epoch = CASE
              WHEN environment.admission_state = 'open'
                THEN environment.admission_epoch + 1
              ELSE environment.admission_epoch
            END,
            admission_fence_sha256 = CASE
              WHEN environment.admission_state = 'open' THEN $8
              ELSE environment.admission_fence_sha256
            END,
            admission_provision_operation_hash = CASE
              WHEN environment.admission_state = 'open' THEN $7
              ELSE environment.admission_provision_operation_hash
            END,
            admission_stack_id = CASE
              WHEN environment.admission_state = 'open' THEN $5
              ELSE environment.admission_stack_id
            END,
            admission_cell_expires_at = CASE
              WHEN environment.admission_state = 'open' THEN $6
              ELSE environment.admission_cell_expires_at
            END,
            admission_changed_at = CASE
              WHEN environment.admission_state = 'open' THEN db_clock.now_ms
              ELSE environment.admission_changed_at
            END
          FROM locked_environment, db_clock
          WHERE environment.id = locked_environment.id
            AND (
              environment.admission_state = 'open'
              OR (
                environment.admission_state = 'draining'
                AND environment.admission_fence_sha256 = $8
                AND environment.admission_provision_operation_hash = $7
                AND environment.admission_stack_id = $5
                AND environment.admission_cell_expires_at = $6
              )
            )
          RETURNING environment.*
        )
        SELECT drained.id AS environment_id,
          drained.expected_account_id AS account_id,
          drained.region,
          drained.cell_key,
          drained.admission_state,
          drained.admission_epoch,
          drained.admission_fence_sha256,
          drained.admission_provision_operation_hash,
          drained.admission_stack_id,
          drained.admission_cell_expires_at,
          drained.admission_changed_at,
          db_clock.now_ms AS db_observed_at,
          (drained.admission_cell_expires_at <= db_clock.now_ms)
            AS database_cell_expired
        FROM drained
        CROSS JOIN db_clock`,
        [
          environmentId,
          accountId,
          region,
          cellId,
          predecessor.stackId,
          compiled.cellExpiresAt,
          predecessor.provisionOperationHash,
          compiled.fenceSha256,
        ],
        { fullResults: true, fetchOptions: { signal } },
      );
      signal.throwIfAborted();
    } catch (error) {
      if (
        queryStarted &&
        (signal.aborted || providerWriteOutcomeUncertain(error))
      ) {
        throw uncertainWrite(error);
      }
      throw providerError(error);
    }
    try {
      const result = Object.freeze(receipt(raw));
      assertSharedCellAdmissionDrainReceipt(result, {
        predecessor,
        fenceSha256: compiled.fenceSha256,
        cellExpiresAt: compiled.cellExpiresAt,
      });
      return result;
    } catch (error) {
      if (
        error instanceof SharedCellAdmissionFenceError &&
        error.code === "NEON_SHARED_CELL_ADMISSION_DRAIN_REJECTED"
      ) {
        throw error;
      }
      throw uncertainWrite(error);
    }
  }
}

export function createNeonSharedCellAdmissionFenceWriter(
  databaseUrl: string,
): NeonSharedCellAdmissionFenceWriter {
  if (
    typeof databaseUrl !== "string" ||
    !/^postgres(?:ql)?:\/\//.test(databaseUrl)
  ) {
    throw new SharedCellAdmissionFenceError(
      "NEON_SHARED_CELL_ADMISSION_DATABASE_URL_INVALID",
      "The Shared Cell admission fence requires a PostgreSQL DATABASE_URL.",
    );
  }
  try {
    const sql = neon(databaseUrl, { fullResults: true });
    return new NeonSharedCellAdmissionFenceWriter(
      sql as unknown as NeonSharedCellAdmissionFenceSqlClient,
    );
  } catch {
    throw new SharedCellAdmissionFenceError(
      "NEON_SHARED_CELL_ADMISSION_DATABASE_URL_INVALID",
      "The Shared Cell admission fence requires a valid PostgreSQL DATABASE_URL.",
    );
  }
}
