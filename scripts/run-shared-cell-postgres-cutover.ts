import { access, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { Pool, neonConfig } from "@neondatabase/serverless";

import {
  compileSharedCellPostgresCutoverReview,
  NeonSharedCellMigrationReadinessError,
  type SharedCellPostgresCutoverCounts,
  type SharedCellPostgresCutoverSchemaState,
  type SharedCellPostgresMigrationDigest,
} from "../lib/deployments/execution/neon-shared-cell-migration-readiness.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { migrationChecksum } from "./migration-checksum.mjs";

const confirmationPhrase = "I_ACKNOWLEDGE_NEON_READ_ONLY_INSPECTION";
const fixedEnvironmentId = "env_aws_sandbox_ca_central_1";
const fixedEnvironmentKey = "aws-sandbox-ca-central-1";

interface QueryResult {
  rows: Record<string, unknown>[];
}

interface DatabaseClient {
  query(statement: string, values?: unknown[]): Promise<QueryResult>;
  release(destroy?: boolean): void;
}

function argument(name: string): string {
  const positions = process.argv.flatMap((value, index) =>
    value === name ? [index] : [],
  );
  if (positions.length > 1) {
    throw new Error(`Duplicate argument ${name}.`);
  }
  if (positions.length === 0) return "";
  const value = process.argv[positions[0] + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Argument ${name} requires a value.`);
  }
  return value;
}

function rejectUnknownArguments(): void {
  const accepted = new Set([
    "--confirm-read-only-neon-access",
    "--mode",
    "--output",
  ]);
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index];
    if (!accepted.has(name) || index + 1 >= process.argv.length) {
      throw new Error("Unsupported or incomplete cutover argument.");
    }
  }
}

function boolean(value: unknown, label: string): boolean {
  if (value === true || value === "t") return true;
  if (value === false || value === "f") return false;
  throw new Error(`Database returned an invalid ${label}.`);
}

function count(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`Database returned an invalid ${label}.`);
  }
  return number;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Database returned an invalid ${label}.`);
  }
  return value;
}

async function localMigrationCatalog(): Promise<SharedCellPostgresMigrationDigest[]> {
  const directory = path.resolve(process.cwd(), "db", "postgres-migrations");
  const filenames = (await readdir(directory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  const migrations: SharedCellPostgresMigrationDigest[] = [];
  for (const filename of filenames) {
    const sql = await readFile(path.join(directory, filename), "utf8");
    migrations.push({ filename, checksum: migrationChecksum(sql) });
  }
  return migrations;
}

async function databaseTargetFingerprint(databaseUrl: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new NeonSharedCellMigrationReadinessError(
      "NEON_SHARED_CELL_CUTOVER_DATABASE_URL_INVALID",
      "The cutover inspector requires a valid Neon PostgreSQL DATABASE_URL.",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname.toLowerCase().endsWith(".neon.tech") ||
    parsed.searchParams.get("sslmode") !== "require" ||
    parsed.username.length === 0 ||
    parsed.password.length === 0 ||
    parsed.pathname.length <= 1 ||
    parsed.hash.length !== 0
  ) {
    throw new NeonSharedCellMigrationReadinessError(
      "NEON_SHARED_CELL_CUTOVER_DATABASE_URL_INVALID",
      "The cutover inspector requires a credentialed Neon PostgreSQL URL with sslmode=require.",
    );
  }
  return sha256Hex({
    protocol: "postgresql",
    hostname: parsed.hostname.toLowerCase(),
    port: parsed.port || "5432",
    databasePath: parsed.pathname,
    sslmode: "require",
  });
}

function schemaState(row: Record<string, unknown>): SharedCellPostgresCutoverSchemaState {
  return {
    transactionReadOnly: boolean(
      row.transaction_read_only,
      "transaction read-only state",
    ),
    transactionSerializable: boolean(
      row.transaction_serializable,
      "transaction isolation state",
    ),
    transactionDeferrable: boolean(
      row.transaction_deferrable,
      "transaction deferrable state",
    ),
    schemaMigrationsPresent: boolean(
      row.schema_migrations_present,
      "schema_migrations state",
    ),
    baseEnvironmentTablePresent: boolean(
      row.base_environment_table_present,
      "deployment_environments state",
    ),
    baseJobsTablePresent: boolean(
      row.base_jobs_table_present,
      "deployment_jobs state",
    ),
    baseCleanupScheduleTablePresent: boolean(
      row.base_cleanup_schedule_table_present,
      "deployment_cleanup_schedules state",
    ),
    tenantResourceTablePresent: boolean(
      row.tenant_resource_table_present,
      "deployment_tenant_resources state",
    ),
    externalOperationTablePresent: boolean(
      row.external_operation_table_present,
      "deployment_tenant_external_operations state",
    ),
    cleanupRunTablePresent: boolean(
      row.cleanup_run_table_present,
      "deployment_tenant_cleanup_runs state",
    ),
    leaseTokenColumnPresent: boolean(
      row.lease_token_column_present,
      "lease_token state",
    ),
    externalEpochColumnPresent: boolean(
      row.external_epoch_column_present,
      "external_epoch state",
    ),
    admissionStateColumnPresent: boolean(
      row.admission_state_column_present,
      "admission_state state",
    ),
  };
}

function conflictCounts(row: Record<string, unknown>): SharedCellPostgresCutoverCounts {
  return {
    sandboxEnvironmentCount: count(
      row.sandbox_environment_count,
      "sandbox environment count",
    ),
    applyEnabledEnvironmentCount: count(
      row.apply_enabled_environment_count,
      "apply-enabled environment count",
    ),
    runningJobCount: count(row.running_job_count, "running job count"),
    queuedJobCount: count(row.queued_job_count, "queued job count"),
    runningStepCount: count(row.running_step_count, "running step count"),
    nonterminalCleanupScheduleCount: count(
      row.nonterminal_cleanup_schedule_count,
      "nonterminal cleanup-schedule count",
    ),
    capacityReservationCount: count(
      row.capacity_reservation_count,
      "capacity-reservation count",
    ),
    nonterminalDeploymentCount: count(
      row.nonterminal_deployment_count,
      "nonterminal deployment count",
    ),
    reservationCoordinateMismatchCount: count(
      row.reservation_coordinate_mismatch_count,
      "reservation coordinate mismatch count",
    ),
    scheduleCoordinateMismatchCount: count(
      row.schedule_coordinate_mismatch_count,
      "schedule coordinate mismatch count",
    ),
  };
}

async function inspectDatabase(
  client: DatabaseClient,
  targetFingerprintSha256: string,
  localMigrations: readonly SharedCellPostgresMigrationDigest[],
) {
  let transactionStarted = false;
  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE",
    );
    transactionStarted = true;
    await client.query("SET LOCAL statement_timeout = '10000ms'");
    await client.query("SET LOCAL lock_timeout = '1000ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '15000ms'");

    const catalogResult = await client.query(`
      SELECT
        current_setting('transaction_read_only') = 'on'
          AS transaction_read_only,
        current_setting('transaction_isolation') = 'serializable'
          AS transaction_serializable,
        current_setting('transaction_deferrable') = 'on'
          AS transaction_deferrable,
        to_regclass('public.schema_migrations') IS NOT NULL
          AS schema_migrations_present,
        to_regclass('public.deployment_environments') IS NOT NULL
          AS base_environment_table_present,
        to_regclass('public.deployment_jobs') IS NOT NULL
          AS base_jobs_table_present,
        to_regclass('public.deployment_cleanup_schedules') IS NOT NULL
          AS base_cleanup_schedule_table_present,
        to_regclass('public.deployment_tenant_resources') IS NOT NULL
          AS tenant_resource_table_present,
        to_regclass('public.deployment_tenant_external_operations') IS NOT NULL
          AS external_operation_table_present,
        to_regclass('public.deployment_tenant_cleanup_runs') IS NOT NULL
          AS cleanup_run_table_present,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'deployment_jobs'
            AND column_name = 'lease_token'
        ) AS lease_token_column_present,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'deployment_tenant_resources'
            AND column_name = 'external_epoch'
        ) AS external_epoch_column_present,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'deployment_environments'
            AND column_name = 'admission_state'
        ) AS admission_state_column_present
    `);
    const schema = schemaState(catalogResult.rows[0] ?? {});
    if (!schema.schemaMigrationsPresent) {
      throw new NeonSharedCellMigrationReadinessError(
        "NEON_SHARED_CELL_BASE_SCHEMA_MISSING",
        "The schema_migrations table is missing.",
      );
    }

    const appliedResult = await client.query(
      "SELECT filename, checksum FROM schema_migrations ORDER BY filename",
    );
    const appliedMigrations = appliedResult.rows.map((row) => ({
      filename: text(row.filename, "migration filename"),
      checksum: text(row.checksum, "migration checksum"),
    }));

    const countsResult = await client.query(
      `SELECT
        (SELECT count(*)::integer
         FROM deployment_environments
         WHERE id = $1
           AND key = $2
           AND kind = 'aws_sandbox'
           AND driver = 'aws_ecs_cell'
           AND expected_account_id = '402010193138'
           AND region = 'ca-central-1'
           AND cell_key = 'cell-sandbox-1') AS sandbox_environment_count,
        (SELECT count(*)::integer
         FROM deployment_environments
         WHERE apply_enabled <> 0) AS apply_enabled_environment_count,
        (SELECT count(*)::integer
         FROM deployment_jobs
         WHERE status = 'running') AS running_job_count,
        (SELECT count(*)::integer
         FROM deployment_jobs
         WHERE status IN ('pending', 'retry_wait')) AS queued_job_count,
        (SELECT count(*)::integer
         FROM deployment_step_runs
         WHERE status = 'running') AS running_step_count,
        (SELECT count(*)::integer
         FROM deployment_cleanup_schedules
         WHERE status NOT IN ('succeeded', 'canceled'))
          AS nonterminal_cleanup_schedule_count,
        (SELECT count(*)::integer
         FROM deployment_environment_capacity_reservations)
          AS capacity_reservation_count,
        (SELECT count(*)::integer
         FROM app_instance_deployments
         WHERE status NOT IN ('destroyed', 'failed', 'canceled'))
          AS nonterminal_deployment_count,
        (SELECT count(*)::integer
         FROM deployment_environment_capacity_reservations AS reservation
         INNER JOIN app_instance_deployments AS deployment
           ON deployment.id = reservation.deployment_id
         WHERE reservation.environment_id <> deployment.environment_id)
          AS reservation_coordinate_mismatch_count,
        (SELECT count(*)::integer
         FROM deployment_cleanup_schedules AS schedule
         INNER JOIN app_instance_deployments AS deployment
           ON deployment.id = schedule.deployment_id
         WHERE schedule.environment_id <> deployment.environment_id)
          AS schedule_coordinate_mismatch_count`,
      [fixedEnvironmentId, fixedEnvironmentKey],
    );
    const counts = conflictCounts(countsResult.rows[0] ?? {});

    const hostClockStartedAt = new Date().toISOString();
    const clockResult = await client.query(`
      SELECT
        current_setting('server_version_num')::integer
          AS postgres_version_number,
        to_char(
          clock_timestamp() AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) AS database_observed_at
    `);
    const hostClockCompletedAt = new Date().toISOString();
    const clock = clockResult.rows[0] ?? {};

    const manifest = await compileSharedCellPostgresCutoverReview({
      targetFingerprintSha256,
      localMigrations,
      appliedMigrations,
      schema,
      counts,
      postgresVersionNumber: count(
        clock.postgres_version_number,
        "PostgreSQL version number",
      ),
      databaseObservedAt: text(
        clock.database_observed_at,
        "database clock sample",
      ),
      hostClockStartedAt,
      hostClockCompletedAt,
    });
    await client.query("ROLLBACK");
    transactionStarted = false;
    return manifest;
  } finally {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The caller destroys this connection after a failed rollback.
      }
    }
  }
}

async function main(): Promise<void> {
  rejectUnknownArguments();
  if (argument("--mode") !== "online-inspect") {
    throw new Error("Only --mode online-inspect is supported in J5g-e1.");
  }
  if (argument("--confirm-read-only-neon-access") !== confirmationPhrase) {
    throw new Error("The exact read-only Neon acknowledgement is required.");
  }
  const output = argument("--output");
  if (!path.isAbsolute(output) || path.extname(output).toLowerCase() !== ".json") {
    throw new Error("--output must be an absolute JSON path.");
  }
  try {
    await access(output);
    throw new Error("The review output already exists; refusing to overwrite it.");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new NeonSharedCellMigrationReadinessError(
      "NEON_SHARED_CELL_CUTOVER_DATABASE_URL_MISSING",
      "DATABASE_URL is required for online inspection.",
    );
  }
  const [targetFingerprintSha256, localMigrations] = await Promise.all([
    databaseTargetFingerprint(databaseUrl),
    localMigrationCatalog(),
  ]);
  neonConfig.webSocketConstructor = WebSocket;
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 1_000,
  });
  let client: DatabaseClient | undefined;
  let destroyClient = false;
  try {
    client = (await pool.connect()) as unknown as DatabaseClient;
    const manifest = await inspectDatabase(
      client,
      targetFingerprintSha256,
      localMigrations,
    );
    await writeFile(output, `${JSON.stringify(manifest)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        mode: "online_inspect",
        manifestSha256: manifest.manifestSha256,
        pendingMigrations: manifest.pendingMigrations.map(
          (migration) => migration.filename,
        ),
        postgresVersionNumber: manifest.postgresVersionNumber,
        clockRoundTripMs: manifest.clockRoundTripMs,
        clockSkewMs: manifest.clockSkewMs,
        mutationPerformed: false,
        output,
      }),
    );
  } catch (error) {
    destroyClient = true;
    if (error instanceof NeonSharedCellMigrationReadinessError) throw error;
    throw new NeonSharedCellMigrationReadinessError(
      "NEON_SHARED_CELL_MIGRATION_INSPECTION_FAILED",
      "The Neon migration inspection failed closed without exposing provider details.",
      true,
    );
  } finally {
    client?.release(destroyClient);
    await pool.end();
  }
}

main().catch((error) => {
  const value =
    error instanceof NeonSharedCellMigrationReadinessError
      ? error
      : new NeonSharedCellMigrationReadinessError(
          "NEON_SHARED_CELL_MIGRATION_INSPECTION_INVALID",
          error instanceof Error
            ? error.message
            : "The Neon migration inspection failed.",
        );
  console.error(
    JSON.stringify({
      code: value.code,
      message: value.message,
      retryable: value.retryable,
      mutationPerformed: false,
    }),
  );
  process.exitCode = 1;
});
