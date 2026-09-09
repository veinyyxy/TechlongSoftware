import {
  access,
  open,
  readFile,
  readdir,
  stat,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { Pool, neonConfig } from "@neondatabase/serverless";

import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import {
  authorizeSharedCellPostgresMigrationApply,
  compileSharedCellPostgresMigrationReceipt,
  SHARED_CELL_POSTGRES_CUTOVER_CONSTRAINT_COUNT,
  SHARED_CELL_POSTGRES_CUTOVER_INDEX_COUNT,
  SHARED_CELL_POSTGRES_CUTOVER_TRIGGER_COUNT,
  type SharedCellPostgresMigrationApplyOutcome,
  type SharedCellPostgresMigrationPostStateProof,
  type SharedCellPostgresMigrationReceipt,
  type SharedCellPostgresMigrationSchemaProof,
} from "../lib/deployments/execution/neon-shared-cell-migration-apply.ts";
import {
  NeonSharedCellMigrationReadinessError,
  SHARED_CELL_POSTGRES_CUTOVER_MAX_CLOCK_RTT_MS,
  SHARED_CELL_POSTGRES_CUTOVER_MAX_CLOCK_SKEW_MS,
  SHARED_CELL_POSTGRES_CUTOVER_MIGRATIONS,
  SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG,
  type SharedCellPostgresCutoverCounts,
  type SharedCellPostgresCutoverReviewManifest,
  type SharedCellPostgresMigrationDigest,
  validateSharedCellPostgresCutoverReviewManifest,
} from "../lib/deployments/execution/neon-shared-cell-migration-readiness.ts";
import { migrationChecksum } from "./migration-checksum.mjs";

const applyConfirmationPhrase =
  "I_CONFIRM_J5GE2_APPLY_NEON_MIGRATIONS_0005_TO_0008";
const guardEnvironmentVariable = "TECHLONG_J5GE2_POSTGRES_GUARD_NONCE";
const fixedEnvironmentId = "env_aws_sandbox_ca_central_1";
const fixedEnvironmentKey = "aws-sandbox-ca-central-1";
const maximumManifestBytes = 65_536;
const digestPattern = /^[a-f0-9]{64}$/;
const advisoryLockKey1 = 1_246_841_221;
const advisoryLockKey2 = 1_245_955_122;

const criticalTriggers = Object.freeze([
  ["deployment_tenant_resources_relationships", "deployment_tenant_resources", "enforce_deployment_tenant_resource_relationships"],
  ["deployment_tenant_resource_events_append_only", "deployment_tenant_resource_events", "prevent_deployment_tenant_resource_event_mutation"],
  ["deployment_tenant_external_operations_transition", "deployment_tenant_external_operations", "enforce_tenant_external_operation_transition"],
  ["deployment_tenant_resources_external_operation_pointer", "deployment_tenant_resources", "enforce_tenant_external_operation_pointer"],
  ["deployment_tenant_cleanup_runs_transition", "deployment_tenant_cleanup_runs", "enforce_tenant_cleanup_run_transition"],
  ["deployment_tenant_cleanup_phases_transition", "deployment_tenant_cleanup_phases", "enforce_tenant_cleanup_phase_transition"],
  ["deployment_tenant_external_operation_events_append_only", "deployment_tenant_external_operation_events", "prevent_b5_epoch_event_mutation"],
  ["deployment_tenant_cleanup_events_append_only", "deployment_tenant_cleanup_events", "prevent_b5_epoch_event_mutation"],
  ["deployment_environments_admission_initial_state", "deployment_environments", "enforce_deployment_environment_admission_initial_state"],
  ["deployment_environments_admission_transition", "deployment_environments", "enforce_deployment_environment_admission_transition"],
  ["deployment_environments_draining_tombstone", "deployment_environments", "enforce_draining_deployment_environment_tombstone"],
  ["app_instance_deployments_draining_tombstone", "app_instance_deployments", "enforce_draining_environment_ownership_tombstone"],
  ["deployment_tenant_resources_draining_tombstone", "deployment_tenant_resources", "enforce_draining_environment_ownership_tombstone"],
  ["deployment_cleanup_schedules_draining_tombstone", "deployment_cleanup_schedules", "enforce_draining_environment_ownership_tombstone"],
  ["deployment_environment_capacity_admission_fence", "deployment_environment_capacity_reservations", "enforce_deployment_environment_admission_fence"],
  ["app_instance_deployments_admission_insert_fence", "app_instance_deployments", "enforce_app_instance_deployment_admission"],
  ["app_instance_deployments_admission_reopen_fence", "app_instance_deployments", "enforce_app_instance_deployment_admission"],
  ["deployment_tenant_resources_admission_insert_fence", "deployment_tenant_resources", "enforce_deployment_tenant_resource_admission"],
  ["deployment_tenant_resources_admission_reopen_fence", "deployment_tenant_resources", "enforce_deployment_tenant_resource_admission"],
  ["deployment_cleanup_schedules_admission_insert_fence", "deployment_cleanup_schedules", "enforce_deployment_cleanup_schedule_admission"],
  ["deployment_cleanup_schedules_admission_move_fence", "deployment_cleanup_schedules", "enforce_deployment_cleanup_schedule_admission"],
  ["deployment_cleanup_schedules_terminal_status_fence", "deployment_cleanup_schedules", "enforce_deployment_cleanup_schedule_terminal_status"],
  ["app_instances_activation_admission_fence", "app_instances", "enforce_app_instance_activation_admission"],
] as const);
const criticalTriggerNames = Object.freeze(
  criticalTriggers.map(([name]) => name),
);
const criticalTriggerRelations = Object.freeze(
  criticalTriggers.map(([, relation]) => relation),
);
const criticalTriggerFunctions = Object.freeze(
  criticalTriggers.map(([, , functionName]) => functionName),
);
const criticalIndexes = Object.freeze([
  "deployment_tenant_resources_database_unique",
  "deployment_tenant_resources_role_unique",
  "deployment_tenant_resources_secret_name_unique",
  "deployment_tenant_resources_secret_ref_unique",
  "deployment_tenant_resources_status_idx",
  "deployment_tenant_resources_created_deployment_idx",
  "deployment_tenant_resources_owner_deployment_idx",
  "deployment_tenant_resource_events_instance_generation_idx",
  "deployment_tenant_resource_events_deployment_idx",
  "deployment_step_runs_attempt_unique",
  "deployment_tenant_external_operations_identity_unique",
  "deployment_tenant_external_operations_current_unique",
  "deployment_tenant_external_operations_pending_unique",
  "deployment_tenant_external_operations_owner_idx",
  "deployment_tenant_external_operations_owner_epoch_unique",
  "deployment_tenant_external_operation_events_epoch_idx",
  "deployment_tenant_cleanup_runs_operation_unique",
  "deployment_tenant_cleanup_runs_owner_idx",
  "deployment_tenant_cleanup_phases_operation_unique",
  "deployment_tenant_cleanup_events_run_idx",
]);
const criticalConstraints = Object.freeze([
  ["deployment_jobs_lease_token_check", "deployment_jobs"],
  ["deployment_jobs_lease_check", "deployment_jobs"],
  ["deployment_environments_admission_state_check", "deployment_environments"],
  ["deployment_environments_admission_epoch_check", "deployment_environments"],
  ["deployment_environments_admission_fence_sha256_check", "deployment_environments"],
  ["deployment_environments_admission_provision_hash_check", "deployment_environments"],
  ["deployment_environments_admission_consistency_check", "deployment_environments"],
  ["deployment_tenant_external_operations_identity_hash_check", "deployment_tenant_external_operations"],
  ["deployment_tenant_external_operations_attempt_check", "deployment_tenant_external_operations"],
  ["deployment_tenant_external_operations_marker_check", "deployment_tenant_external_operations"],
  ["deployment_tenant_external_operations_state_timestamps_check", "deployment_tenant_external_operations"],
  ["deployment_tenant_external_operations_active_evidence_check", "deployment_tenant_external_operations"],
  ["deployment_tenant_external_operations_timestamp_order_check", "deployment_tenant_external_operations"],
  ["deployment_tenant_resources_external_operation_fkey", "deployment_tenant_resources"],
  ["deployment_tenant_external_operation_events_transition_check", "deployment_tenant_external_operation_events"],
  ["deployment_tenant_external_operation_events_operation_fkey", "deployment_tenant_external_operation_events"],
  ["deployment_tenant_cleanup_runs_state_timestamps_check", "deployment_tenant_cleanup_runs"],
  ["deployment_tenant_cleanup_runs_timestamp_order_check", "deployment_tenant_cleanup_runs"],
  ["deployment_tenant_cleanup_runs_operation_fkey", "deployment_tenant_cleanup_runs"],
  ["deployment_tenant_cleanup_phases_state_receipt_check", "deployment_tenant_cleanup_phases"],
  ["deployment_tenant_cleanup_phases_timestamp_order_check", "deployment_tenant_cleanup_phases"],
  ["deployment_tenant_cleanup_events_shape_check", "deployment_tenant_cleanup_events"],
  ["deployment_tenant_cleanup_events_phase_event_check", "deployment_tenant_cleanup_events"],
] as const);
const criticalConstraintNames = Object.freeze(
  criticalConstraints.map(([name]) => name),
);
const criticalConstraintRelations = Object.freeze(
  criticalConstraints.map(([, relation]) => relation),
);

if (
  criticalTriggers.length !== SHARED_CELL_POSTGRES_CUTOVER_TRIGGER_COUNT ||
  criticalIndexes.length !== SHARED_CELL_POSTGRES_CUTOVER_INDEX_COUNT ||
  criticalConstraints.length !== SHARED_CELL_POSTGRES_CUTOVER_CONSTRAINT_COUNT
) {
  throw new Error("The reviewed critical-trigger catalog is incomplete.");
}

type RunnerMode = "apply-reviewed" | "recover-applied-state";
type MutationState = boolean | "unknown";

interface ParsedArguments {
  mode: RunnerMode;
  reviewPath: string;
  reviewSha256: string;
  outputPath: string;
  guardNonce: string;
  confirmApply?: string;
}

interface QueryResult {
  rows: Record<string, unknown>[];
}

interface DatabaseClient {
  query(statement: string, values?: unknown[]): Promise<QueryResult>;
  release(destroy?: boolean): void;
}

interface LocalMigration extends SharedCellPostgresMigrationDigest {
  sql: string;
}

interface DatabaseSnapshot {
  appliedMigrations: readonly SharedCellPostgresMigrationDigest[];
  schema: SharedCellPostgresMigrationSchemaProof;
  counts: SharedCellPostgresCutoverCounts;
  postgresVersionNumber: number;
  databaseObservedAt: string;
  hostClockStartedAt: string;
  hostClockCompletedAt: string;
}

class MigrationApplyExecutionError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly mutationPerformed: MutationState;

  constructor(
    code: string,
    message: string,
    mutationPerformed: MutationState,
    retryable = false,
  ) {
    super(message);
    this.name = "MigrationApplyExecutionError";
    this.code = code;
    this.retryable = retryable;
    this.mutationPerformed = mutationPerformed;
  }
}

function fail(
  code: string,
  message: string,
  mutationPerformed: MutationState = false,
  retryable = false,
): never {
  throw new MigrationApplyExecutionError(
    code,
    message,
    mutationPerformed,
    retryable,
  );
}

function boolean(value: unknown, label: string): boolean {
  if (value === true || value === "t") return true;
  if (value === false || value === "f") return false;
  fail(
    "NEON_SHARED_CELL_MIGRATION_APPLY_DATABASE_INVALID",
    `Database returned an invalid ${label}.`,
  );
}

function count(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_DATABASE_INVALID",
      `Database returned an invalid ${label}.`,
    );
  }
  return number;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_DATABASE_INVALID",
      `Database returned an invalid ${label}.`,
    );
  }
  return value;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  if (argv.length === 0 || argv.length % 2 !== 0) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_ARGUMENT_INVALID",
      "Arguments must be explicit name/value pairs.",
    );
  }
  const allowed = new Set([
    "--confirm-apply",
    "--guard-nonce",
    "--mode",
    "--output",
    "--review",
    "--review-sha256",
  ]);
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name) || values.has(name) || !value) {
      fail(
        "NEON_SHARED_CELL_MIGRATION_APPLY_ARGUMENT_INVALID",
        "Arguments contain an unknown, duplicate or empty value.",
      );
    }
    values.set(name, value);
  }
  const mode = values.get("--mode");
  if (mode !== "apply-reviewed" && mode !== "recover-applied-state") {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_ARGUMENT_INVALID",
      "Mode is outside the reviewed allowlist.",
    );
  }
  const reviewPath = values.get("--review");
  const reviewSha256 = values.get("--review-sha256");
  const outputPath = values.get("--output");
  const guardNonce = values.get("--guard-nonce");
  if (
    !reviewPath ||
    !reviewSha256 ||
    !outputPath ||
    !guardNonce ||
    !digestPattern.test(reviewSha256) ||
    !digestPattern.test(guardNonce)
  ) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_ARGUMENT_INVALID",
      "Review, digest, output and wrapper guard are required.",
    );
  }
  const confirmApply = values.get("--confirm-apply");
  if (
    (mode === "apply-reviewed" && confirmApply !== applyConfirmationPhrase) ||
    (mode === "recover-applied-state" && confirmApply !== undefined)
  ) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_CONFIRMATION_REQUIRED",
      mode === "apply-reviewed"
        ? "The exact J5g-e2 Neon migration confirmation is required."
        : "The read-only recovery mode rejects the apply confirmation.",
    );
  }
  return {
    mode,
    reviewPath,
    reviewSha256,
    outputPath,
    guardNonce,
    confirmApply,
  };
}

function assertWrapperGuard(nonce: string): void {
  if (process.env[guardEnvironmentVariable] !== nonce) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_GUARD_INVALID",
      "The reviewed PowerShell wrapper did not attest this invocation.",
    );
  }
  delete process.env[guardEnvironmentVariable];
}

function assertAbsoluteExternalJson(value: string, label: string): string {
  if (!path.isAbsolute(value) || path.extname(value).toLowerCase() !== ".json") {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_PATH_INVALID",
      `${label} must be an absolute JSON path.`,
    );
  }
  const resolved = path.resolve(value);
  const repositoryRoot = path.resolve(process.cwd());
  const relative = path.relative(repositoryRoot, resolved);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  ) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_PATH_INVALID",
      `${label} must be outside the repository.`,
    );
  }
  return resolved;
}

async function readReviewManifest(
  reviewPath: string,
  expectedSha256: string,
): Promise<Readonly<SharedCellPostgresCutoverReviewManifest>> {
  const resolved = assertAbsoluteExternalJson(reviewPath, "Review manifest");
  const metadata = await stat(resolved);
  if (!metadata.isFile() || metadata.size === 0 || metadata.size > maximumManifestBytes) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_REVIEW_INVALID",
      "The review manifest is not a bounded regular file.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolved, "utf8"));
  } catch {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_REVIEW_INVALID",
      "The review manifest is not valid JSON.",
    );
  }
  const manifest = await validateSharedCellPostgresCutoverReviewManifest(parsed);
  if (manifest.manifestSha256 !== expectedSha256) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_REVIEW_HASH_MISMATCH",
      "The review manifest differs from the explicitly approved digest.",
    );
  }
  return manifest;
}

async function databaseTargetFingerprint(databaseUrl: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_DATABASE_URL_INVALID",
      "A valid Neon PostgreSQL DATABASE_URL is required.",
    );
  }
  const allowedParameters = new Set(["channel_binding", "sslmode"]);
  const parameterNames = [...new Set(parsed.searchParams.keys())];
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname.toLowerCase().endsWith(".neon.tech") ||
    parsed.searchParams.getAll("sslmode").length !== 1 ||
    parsed.searchParams.get("sslmode") !== "require" ||
    parsed.searchParams.getAll("channel_binding").length > 1 ||
    (parsed.searchParams.has("channel_binding") &&
      parsed.searchParams.get("channel_binding") !== "require") ||
    parameterNames.some((name) => !allowedParameters.has(name)) ||
    parsed.username.length === 0 ||
    parsed.password.length === 0 ||
    parsed.pathname.length <= 1 ||
    parsed.hash.length !== 0
  ) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_DATABASE_URL_INVALID",
      "The runner requires a credentialed Neon PostgreSQL URL with only reviewed TLS parameters.",
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

async function localMigrations(): Promise<readonly LocalMigration[]> {
  const directory = path.resolve(process.cwd(), "db", "postgres-migrations");
  const filenames = (await readdir(directory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  const result: LocalMigration[] = [];
  for (const filename of filenames) {
    const sql = await readFile(path.join(directory, filename), "utf8");
    result.push({ filename, checksum: migrationChecksum(sql), sql });
  }
  if (
    result.length !== SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG.length ||
    result.some(
      (migration, index) =>
        migration.filename !==
          SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG[index]?.filename ||
        migration.checksum !==
          SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG[index]?.checksum,
    )
  ) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_LOCAL_DRIFT",
      "The local migration catalog is not the exact reviewed 0001-0008 sequence.",
    );
  }
  return Object.freeze(result.map((migration) => Object.freeze(migration)));
}

function migrationCatalog(row: Record<string, unknown>): SharedCellPostgresMigrationDigest {
  return {
    filename: text(row.filename, "migration filename"),
    checksum: text(row.checksum, "migration checksum"),
  };
}

function schemaProof(row: Record<string, unknown>): SharedCellPostgresMigrationSchemaProof {
  return {
    transactionReadOnly: boolean(row.transaction_read_only, "transaction read-only state"),
    transactionSerializable: boolean(
      row.transaction_serializable,
      "transaction isolation state",
    ),
    transactionDeferrable: boolean(
      row.transaction_deferrable,
      "transaction deferrable state",
    ),
    searchPathPublic: boolean(row.search_path_public, "search path state"),
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
    tenantResourceEventTablePresent: boolean(
      row.tenant_resource_event_table_present,
      "deployment_tenant_resource_events state",
    ),
    externalOperationTablePresent: boolean(
      row.external_operation_table_present,
      "deployment_tenant_external_operations state",
    ),
    externalOperationEventTablePresent: boolean(
      row.external_operation_event_table_present,
      "deployment_tenant_external_operation_events state",
    ),
    cleanupRunTablePresent: boolean(
      row.cleanup_run_table_present,
      "deployment_tenant_cleanup_runs state",
    ),
    cleanupPhaseTablePresent: boolean(
      row.cleanup_phase_table_present,
      "deployment_tenant_cleanup_phases state",
    ),
    cleanupEventTablePresent: boolean(
      row.cleanup_event_table_present,
      "deployment_tenant_cleanup_events state",
    ),
    leaseTokenColumnPresent: boolean(row.lease_token_column_present, "lease_token state"),
    externalOperationEpochColumnPresent: boolean(
      row.external_operation_epoch_column_present,
      "external_operation_epoch state",
    ),
    admissionStateColumnPresent: boolean(
      row.admission_state_column_present,
      "admission_state state",
    ),
    admissionEpochColumnPresent: boolean(
      row.admission_epoch_column_present,
      "admission_epoch state",
    ),
    admissionFenceColumnPresent: boolean(
      row.admission_fence_column_present,
      "admission fence state",
    ),
    criticalTriggerCount: count(row.critical_trigger_count, "critical trigger count"),
    criticalTriggerEnabledCount: count(
      row.critical_trigger_enabled_count,
      "enabled critical trigger count",
    ),
    criticalIndexCount: count(row.critical_index_count, "critical index count"),
    criticalConstraintCount: count(
      row.critical_constraint_count,
      "critical constraint count",
    ),
    criticalConstraintValidatedCount: count(
      row.critical_constraint_validated_count,
      "validated critical constraint count",
    ),
    legacyStepRunAttemptIndexPresent: boolean(
      row.legacy_step_run_attempt_index_present,
      "legacy deployment_step_runs_attempt_unique state",
    ),
    cutoverStepRunAttemptIndexPresent: boolean(
      row.cutover_step_run_attempt_index_present,
      "cutover deployment_step_runs_attempt_unique state",
    ),
  };
}

function conflictCounts(row: Record<string, unknown>): SharedCellPostgresCutoverCounts {
  return {
    environmentCount: count(row.environment_count, "environment count"),
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
      "nonterminal cleanup schedule count",
    ),
    staleNonrunningLeaseCount: count(
      row.stale_nonrunning_lease_count,
      "stale non-running lease count",
    ),
    leaseExhaustedCleanupRewriteCount: count(
      row.lease_exhausted_cleanup_rewrite_count,
      "lease-exhausted cleanup rewrite count",
    ),
    capacityReservationCount: count(
      row.capacity_reservation_count,
      "capacity reservation count",
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

const schemaProofSql = `
  SELECT
    current_setting('transaction_read_only') = 'on' AS transaction_read_only,
    current_setting('transaction_isolation') = 'serializable'
      AS transaction_serializable,
    current_setting('transaction_deferrable') = 'on' AS transaction_deferrable,
    current_schema() = 'public' AS search_path_public,
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
    to_regclass('public.deployment_tenant_resource_events') IS NOT NULL
      AS tenant_resource_event_table_present,
    to_regclass('public.deployment_tenant_external_operations') IS NOT NULL
      AS external_operation_table_present,
    to_regclass('public.deployment_tenant_external_operation_events') IS NOT NULL
      AS external_operation_event_table_present,
    to_regclass('public.deployment_tenant_cleanup_runs') IS NOT NULL
      AS cleanup_run_table_present,
    to_regclass('public.deployment_tenant_cleanup_phases') IS NOT NULL
      AS cleanup_phase_table_present,
    to_regclass('public.deployment_tenant_cleanup_events') IS NOT NULL
      AS cleanup_event_table_present,
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
        AND column_name = 'external_operation_epoch'
    ) AS external_operation_epoch_column_present,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'deployment_environments'
        AND column_name = 'admission_state'
    ) AS admission_state_column_present,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'deployment_environments'
        AND column_name = 'admission_epoch'
    ) AS admission_epoch_column_present,
    (
      SELECT count(*) = 5 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'deployment_environments'
        AND column_name IN (
          'admission_fence_sha256',
          'admission_provision_operation_hash',
          'admission_stack_id',
          'admission_cell_expires_at',
          'admission_changed_at'
        )
    ) AS admission_fence_column_present,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS index_relation
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = index_relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND index_relation.relkind = 'i'
        AND index_relation.relname = 'deployment_step_runs_attempt_unique'
        AND pg_catalog.pg_get_indexdef(index_relation.oid) =
          'CREATE UNIQUE INDEX deployment_step_runs_attempt_unique ON public.deployment_step_runs USING btree (deployment_id, step_key, input_hash, attempt)'
    ) AS legacy_step_run_attempt_index_present,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS index_relation
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = index_relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND index_relation.relkind = 'i'
        AND index_relation.relname = 'deployment_step_runs_attempt_unique'
        AND pg_catalog.pg_get_indexdef(index_relation.oid) =
          'CREATE UNIQUE INDEX deployment_step_runs_attempt_unique ON public.deployment_step_runs USING btree (job_id, step_key, input_hash, attempt)'
    ) AS cutover_step_run_attempt_index_present,
    (
      SELECT count(*)::integer
      FROM unnest($1::text[], $2::text[], $3::text[])
        AS expected(trigger_name, relation_name, function_name)
      INNER JOIN pg_catalog.pg_trigger AS trigger
        ON trigger.tgname = expected.trigger_name
      INNER JOIN pg_catalog.pg_class AS relation
        ON relation.oid = trigger.tgrelid
        AND relation.relname = expected.relation_name
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      INNER JOIN pg_catalog.pg_proc AS trigger_function
        ON trigger_function.oid = trigger.tgfoid
        AND trigger_function.proname = expected.function_name
      WHERE namespace.nspname = 'public'
        AND NOT trigger.tgisinternal
    ) AS critical_trigger_count,
    (
      SELECT count(*)::integer
      FROM unnest($1::text[], $2::text[], $3::text[])
        AS expected(trigger_name, relation_name, function_name)
      INNER JOIN pg_catalog.pg_trigger AS trigger
        ON trigger.tgname = expected.trigger_name
      INNER JOIN pg_catalog.pg_class AS relation
        ON relation.oid = trigger.tgrelid
        AND relation.relname = expected.relation_name
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      INNER JOIN pg_catalog.pg_proc AS trigger_function
        ON trigger_function.oid = trigger.tgfoid
        AND trigger_function.proname = expected.function_name
      WHERE namespace.nspname = 'public'
        AND NOT trigger.tgisinternal
        AND trigger.tgenabled IN ('O', 'A')
    ) AS critical_trigger_enabled_count,
    (
      SELECT count(*)::integer
      FROM pg_catalog.pg_class AS index_relation
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = index_relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND index_relation.relkind = 'i'
        AND index_relation.relname = ANY($4::text[])
    ) AS critical_index_count,
    (
      SELECT count(*)::integer
      FROM unnest($5::text[], $6::text[])
        AS expected(constraint_name, relation_name)
      INNER JOIN pg_catalog.pg_constraint AS constraint_row
        ON constraint_row.conname = expected.constraint_name
      INNER JOIN pg_catalog.pg_class AS relation
        ON relation.oid = constraint_row.conrelid
        AND relation.relname = expected.relation_name
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
    ) AS critical_constraint_count,
    (
      SELECT count(*)::integer
      FROM unnest($5::text[], $6::text[])
        AS expected(constraint_name, relation_name)
      INNER JOIN pg_catalog.pg_constraint AS constraint_row
        ON constraint_row.conname = expected.constraint_name
      INNER JOIN pg_catalog.pg_class AS relation
        ON relation.oid = constraint_row.conrelid
        AND relation.relname = expected.relation_name
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND constraint_row.convalidated
    ) AS critical_constraint_validated_count
`;

const conflictCountsSql = `
  SELECT
    (SELECT count(*)::integer FROM public.deployment_environments)
      AS environment_count,
    (SELECT count(*)::integer
     FROM public.deployment_environments
     WHERE id = $1
       AND key = $2
       AND kind = 'aws_sandbox'
       AND driver = 'aws_ecs_cell'
       AND expected_account_id = '402010193138'
       AND region = 'ca-central-1'
       AND cell_key = 'cell-sandbox-1') AS sandbox_environment_count,
    (SELECT count(*)::integer
     FROM public.deployment_environments
     WHERE apply_enabled <> 0) AS apply_enabled_environment_count,
    (SELECT count(*)::integer
     FROM public.deployment_jobs
     WHERE status = 'running') AS running_job_count,
    (SELECT count(*)::integer
     FROM public.deployment_jobs
     WHERE status IN ('pending', 'retry_wait')) AS queued_job_count,
    (SELECT count(*)::integer
     FROM public.deployment_step_runs
     WHERE status = 'running') AS running_step_count,
    (SELECT count(*)::integer
     FROM public.deployment_cleanup_schedules
     WHERE status NOT IN ('succeeded', 'canceled'))
      AS nonterminal_cleanup_schedule_count,
    (SELECT count(*)::integer
     FROM public.deployment_jobs
     WHERE status <> 'running'
       AND (lease_owner IS NOT NULL OR lease_expires_at IS NOT NULL))
      AS stale_nonrunning_lease_count,
    (SELECT count(*)::integer
     FROM public.deployment_cleanup_schedules AS schedule
     INNER JOIN public.deployment_jobs AS job
       ON job.deployment_id = schedule.deployment_id
     WHERE job.job_type IN ('cleanup', 'rollback')
       AND job.status = 'dead_letter'
       AND job.last_error_code = 'LEASE_EXHAUSTED'
       AND schedule.status <> 'succeeded')
      AS lease_exhausted_cleanup_rewrite_count,
    (SELECT count(*)::integer
     FROM public.deployment_environment_capacity_reservations)
      AS capacity_reservation_count,
    (SELECT count(*)::integer
     FROM public.app_instance_deployments
     WHERE status NOT IN ('rolled_back', 'canceled'))
      AS nonterminal_deployment_count,
    (SELECT count(*)::integer
     FROM public.deployment_environment_capacity_reservations AS reservation
     INNER JOIN public.app_instance_deployments AS deployment
       ON deployment.id = reservation.deployment_id
     WHERE reservation.environment_id <> deployment.environment_id)
      AS reservation_coordinate_mismatch_count,
    (SELECT count(*)::integer
     FROM public.deployment_cleanup_schedules AS schedule
     INNER JOIN public.app_instance_deployments AS deployment
       ON deployment.id = schedule.deployment_id
     WHERE schedule.environment_id <> deployment.environment_id)
      AS schedule_coordinate_mismatch_count
`;

async function snapshot(client: DatabaseClient): Promise<DatabaseSnapshot> {
  const catalogResult = await client.query(
    "SELECT filename, checksum FROM public.schema_migrations ORDER BY filename",
  );
  const schemaResult = await client.query(schemaProofSql, [
    criticalTriggerNames,
    criticalTriggerRelations,
    criticalTriggerFunctions,
    criticalIndexes,
    criticalConstraintNames,
    criticalConstraintRelations,
  ]);
  const countsResult = await client.query(conflictCountsSql, [
    fixedEnvironmentId,
    fixedEnvironmentKey,
  ]);
  const hostClockStartedAt = new Date().toISOString();
  const clockResult = await client.query(`
    SELECT
      current_setting('server_version_num')::integer AS postgres_version_number,
      to_char(
        clock_timestamp() AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) AS database_observed_at
  `);
  const hostClockCompletedAt = new Date().toISOString();
  const clock = clockResult.rows[0] ?? {};
  return {
    appliedMigrations: catalogResult.rows.map(migrationCatalog),
    schema: schemaProof(schemaResult.rows[0] ?? {}),
    counts: conflictCounts(countsResult.rows[0] ?? {}),
    postgresVersionNumber: count(
      clock.postgres_version_number,
      "PostgreSQL version number",
    ),
    databaseObservedAt: text(clock.database_observed_at, "database clock sample"),
    hostClockStartedAt,
    hostClockCompletedAt,
  };
}

async function postState(
  client: DatabaseClient,
): Promise<SharedCellPostgresMigrationPostStateProof> {
  const result = await client.query(
    `SELECT
      (
        (SELECT count(*) FROM public.deployment_tenant_resources) +
        (SELECT count(*) FROM public.deployment_tenant_resource_events) +
        (SELECT count(*) FROM public.deployment_tenant_external_operations) +
        (SELECT count(*) FROM public.deployment_tenant_external_operation_events) +
        (SELECT count(*) FROM public.deployment_tenant_cleanup_runs) +
        (SELECT count(*) FROM public.deployment_tenant_cleanup_phases) +
        (SELECT count(*) FROM public.deployment_tenant_cleanup_events)
      )::integer AS cutover_data_row_count,
      (SELECT count(*)::integer
       FROM public.deployment_environments
       WHERE admission_state = 'open'
         AND admission_epoch = 0
         AND admission_fence_sha256 IS NULL
         AND admission_provision_operation_hash IS NULL
         AND admission_stack_id IS NULL
         AND admission_cell_expires_at IS NULL
         AND admission_changed_at IS NOT NULL)
        AS environment_admission_default_count,
      (SELECT count(*)::integer
       FROM public.deployment_environments
       WHERE id = $1
         AND key = $2
         AND admission_state = 'open'
         AND admission_epoch = 0
         AND admission_fence_sha256 IS NULL
         AND admission_provision_operation_hash IS NULL
         AND admission_stack_id IS NULL
         AND admission_cell_expires_at IS NULL
         AND admission_changed_at IS NOT NULL)
        AS sandbox_admission_default_count`,
    [fixedEnvironmentId, fixedEnvironmentKey],
  );
  const row = result.rows[0] ?? {};
  return {
    cutoverDataRowCount: count(row.cutover_data_row_count, "cutover data row count"),
    environmentAdmissionDefaultCount: count(
      row.environment_admission_default_count,
      "environment admission default count",
    ),
    sandboxAdmissionDefaultCount: count(
      row.sandbox_admission_default_count,
      "sandbox admission default count",
    ),
  };
}

function sameCatalog(
  left: readonly SharedCellPostgresMigrationDigest[],
  right: readonly SharedCellPostgresMigrationDigest[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (migration, index) =>
        migration.filename === right[index]?.filename &&
        migration.checksum === right[index]?.checksum,
    )
  );
}

async function beginReadOnly(client: DatabaseClient): Promise<void> {
  await client.query(
    "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE",
  );
  await client.query("SET LOCAL statement_timeout = '10000ms'");
  await client.query("SET LOCAL lock_timeout = '1000ms'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout = '15000ms'");
  await client.query("SET LOCAL search_path = public, pg_catalog");
}

async function beginLockedApply(client: DatabaseClient): Promise<void> {
  await client.query(
    "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE NOT DEFERRABLE",
  );
  await client.query("SET LOCAL statement_timeout = '120000ms'");
  await client.query("SET LOCAL lock_timeout = '5000ms'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout = '30000ms'");
  await client.query("SET LOCAL search_path = public, pg_catalog");
  const advisory = await client.query(
    "SELECT pg_try_advisory_xact_lock($1, $2) AS acquired",
    [advisoryLockKey1, advisoryLockKey2],
  );
  if (!boolean(advisory.rows[0]?.acquired, "migration advisory lock")) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_LOCK_UNAVAILABLE",
      "Another migration operator holds the reviewed transaction lock.",
      false,
      true,
    );
  }
  await client.query(
    "LOCK TABLE public.schema_migrations IN ACCESS EXCLUSIVE MODE",
  );
  await client.query(`
    LOCK TABLE
      public.app_instances,
      public.app_instance_deployments,
      public.deployment_environments,
      public.deployment_jobs,
      public.deployment_step_runs,
      public.deployment_cleanup_schedules,
      public.deployment_environment_capacity_reservations
    IN SHARE ROW EXCLUSIVE MODE
  `);
}

function assertClockStillFresh(
  snapshotValue: DatabaseSnapshot,
  review: Readonly<SharedCellPostgresCutoverReviewManifest>,
): void {
  const started = Date.parse(snapshotValue.hostClockStartedAt);
  const completed = Date.parse(snapshotValue.hostClockCompletedAt);
  const database = Date.parse(snapshotValue.databaseObservedAt);
  const roundTrip = completed - started;
  const skew = database - Math.round((started + completed) / 2);
  const expiresAt = Date.parse(review.reviewExpiresAt);
  if (
    !Number.isFinite(started) ||
    !Number.isFinite(completed) ||
    !Number.isFinite(database) ||
    completed < started ||
    roundTrip > SHARED_CELL_POSTGRES_CUTOVER_MAX_CLOCK_RTT_MS ||
    Math.abs(skew) > SHARED_CELL_POSTGRES_CUTOVER_MAX_CLOCK_SKEW_MS ||
    completed > expiresAt ||
    database > expiresAt ||
    completed < Date.parse(review.hostClockCompletedAt)
  ) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_REVIEW_EXPIRED",
      "The reviewed inspection expired or clock bounds failed before commit.",
      false,
      true,
    );
  }
}

async function verifyAppliedState(
  pool: Pool,
  review: Readonly<SharedCellPostgresCutoverReviewManifest>,
  targetFingerprintSha256: string,
  outcome: SharedCellPostgresMigrationApplyOutcome,
  mutationPerformed: MutationState,
): Promise<Readonly<SharedCellPostgresMigrationReceipt>> {
  let client: DatabaseClient | undefined;
  let transactionStarted = false;
  let destroy = false;
  try {
    client = (await pool.connect()) as unknown as DatabaseClient;
    await beginReadOnly(client);
    transactionStarted = true;
    const value = await snapshot(client);
    if (
      sameCatalog(value.appliedMigrations, review.appliedMigrations) &&
      outcome === "reconciled"
    ) {
      fail(
        "NEON_SHARED_CELL_MIGRATION_COMMIT_NOT_APPLIED",
        "A fresh read proves the uncertain commit did not apply.",
        false,
        true,
      );
    }
    const finalState = await postState(client);
    const receipt = await compileSharedCellPostgresMigrationReceipt({
      reviewManifest: review,
      expectedReviewManifestSha256: review.manifestSha256,
      targetFingerprintSha256,
      finalMigrations: value.appliedMigrations,
      schema: value.schema,
      postState: finalState,
      counts: value.counts,
      postgresVersionNumber: value.postgresVersionNumber,
      databaseObservedAt: value.databaseObservedAt,
      hostClockStartedAt: value.hostClockStartedAt,
      hostClockCompletedAt: value.hostClockCompletedAt,
      outcome,
      mutationPerformed,
    });
    await client.query("ROLLBACK");
    transactionStarted = false;
    return receipt;
  } catch (error) {
    destroy = true;
    if (transactionStarted && client) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The connection is destroyed below; the original failure is authoritative.
      }
    }
    throw error;
  } finally {
    client?.release(destroy);
  }
}

async function executeApply(
  pool: Pool,
  review: Readonly<SharedCellPostgresCutoverReviewManifest>,
  targetFingerprintSha256: string,
  catalog: readonly LocalMigration[],
): Promise<Readonly<SharedCellPostgresMigrationReceipt>> {
  let client: DatabaseClient | undefined;
  let transactionStarted = false;
  let commitSent = false;
  let commitConfirmed = false;
  let destroy = false;
  try {
    client = (await pool.connect()) as unknown as DatabaseClient;
    await beginLockedApply(client);
    transactionStarted = true;
    const before = await snapshot(client);
    if (
      sameCatalog(before.appliedMigrations, SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG)
    ) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      client.release();
      client = undefined;
      return verifyAppliedState(
        pool,
        review,
        targetFingerprintSha256,
        "already_applied",
        false,
      );
    }
    const plan = await authorizeSharedCellPostgresMigrationApply({
      reviewManifest: review,
      expectedReviewManifestSha256: review.manifestSha256,
      targetFingerprintSha256,
      localMigrations: catalog.map(({ filename, checksum }) => ({ filename, checksum })),
      appliedMigrations: before.appliedMigrations,
      schema: before.schema,
      counts: before.counts,
      postgresVersionNumber: before.postgresVersionNumber,
      databaseObservedAt: before.databaseObservedAt,
      hostClockStartedAt: before.hostClockStartedAt,
      hostClockCompletedAt: before.hostClockCompletedAt,
    });
    if (
      plan.migrations.length !== SHARED_CELL_POSTGRES_CUTOVER_MIGRATIONS.length ||
      plan.migrations.some(
        (migration, index) =>
          migration.filename !== SHARED_CELL_POSTGRES_CUTOVER_MIGRATIONS[index],
      )
    ) {
      fail(
        "NEON_SHARED_CELL_MIGRATION_APPLY_PLAN_INVALID",
        "The authorized plan is not the exact 0005-0008 sequence.",
      );
    }
    const appliedAtResult = await client.query(
      "SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS applied_at",
    );
    const appliedAt = text(appliedAtResult.rows[0]?.applied_at, "migration applied_at");
    for (const migration of plan.migrations) {
      const local = catalog.find((item) => item.filename === migration.filename);
      if (!local || local.checksum !== migration.checksum) {
        fail(
          "NEON_SHARED_CELL_MIGRATION_APPLY_LOCAL_DRIFT",
          "The in-memory migration differs from the authorized plan.",
        );
      }
      await client.query(local.sql);
      await client.query(
        `INSERT INTO public.schema_migrations (filename, checksum, applied_at)
         VALUES ($1, $2, $3)`,
        [local.filename, local.checksum, appliedAt],
      );
    }
    const beforeCommit = await snapshot(client);
    if (
      !sameCatalog(
        beforeCommit.appliedMigrations,
        SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG,
      ) ||
      !beforeCommit.schema.searchPathPublic ||
      beforeCommit.schema.transactionReadOnly ||
      !beforeCommit.schema.transactionSerializable ||
      beforeCommit.schema.transactionDeferrable ||
      beforeCommit.schema.legacyStepRunAttemptIndexPresent ||
      !beforeCommit.schema.cutoverStepRunAttemptIndexPresent ||
      beforeCommit.schema.criticalTriggerCount !==
        SHARED_CELL_POSTGRES_CUTOVER_TRIGGER_COUNT ||
      beforeCommit.schema.criticalTriggerEnabledCount !==
        SHARED_CELL_POSTGRES_CUTOVER_TRIGGER_COUNT ||
      beforeCommit.schema.criticalIndexCount !==
        SHARED_CELL_POSTGRES_CUTOVER_INDEX_COUNT ||
      beforeCommit.schema.criticalConstraintCount !==
        SHARED_CELL_POSTGRES_CUTOVER_CONSTRAINT_COUNT ||
      beforeCommit.schema.criticalConstraintValidatedCount !==
        SHARED_CELL_POSTGRES_CUTOVER_CONSTRAINT_COUNT
    ) {
      fail(
        "NEON_SHARED_CELL_MIGRATION_APPLY_PRECOMMIT_INVALID",
        "The atomic migration transaction failed its pre-commit proof.",
      );
    }
    const beforeCommitPostState = await postState(client);
    if (
      beforeCommitPostState.cutoverDataRowCount !== 0 ||
      beforeCommitPostState.environmentAdmissionDefaultCount !==
        review.counts.environmentCount ||
      beforeCommitPostState.sandboxAdmissionDefaultCount !== 1 ||
      canonicalJson(beforeCommit.counts) !== canonicalJson(review.counts)
    ) {
      fail(
        "NEON_SHARED_CELL_MIGRATION_APPLY_PRECOMMIT_DRIFT",
        "The atomic migration transaction changed reviewed data state.",
      );
    }
    assertClockStillFresh(beforeCommit, review);
    commitSent = true;
    await client.query("COMMIT");
    commitConfirmed = true;
    transactionStarted = false;
    client.release();
    client = undefined;
    return await verifyAppliedState(
      pool,
      review,
      targetFingerprintSha256,
      "applied",
      true,
    );
  } catch (error) {
    destroy = true;
    if (!commitSent && transactionStarted && client) {
      try {
        await client.query("ROLLBACK");
        transactionStarted = false;
      } catch {
        // Disconnecting an uncommitted PostgreSQL transaction rolls it back.
      }
    }
    client?.release(destroy);
    client = undefined;
    if (commitSent && !commitConfirmed) {
      try {
        return await verifyAppliedState(
          pool,
          review,
          targetFingerprintSha256,
          "reconciled",
          "unknown",
        );
      } catch (reconciliationError) {
        if (
          reconciliationError instanceof MigrationApplyExecutionError &&
          reconciliationError.code === "NEON_SHARED_CELL_MIGRATION_COMMIT_NOT_APPLIED"
        ) {
          throw reconciliationError;
        }
        fail(
          "NEON_SHARED_CELL_MIGRATION_COMMIT_OUTCOME_UNKNOWN",
          "The commit response was lost and exact read-only reconciliation failed.",
          "unknown",
        );
      }
    }
    if (commitConfirmed) {
      fail(
        "NEON_SHARED_CELL_MIGRATION_POSTCOMMIT_VERIFICATION_FAILED",
        "The migration committed but exact post-commit verification failed.",
        true,
      );
    }
    throw error;
  } finally {
    client?.release(destroy);
  }
}

async function reserveOutput(outputPath: string): Promise<FileHandle> {
  const resolved = assertAbsoluteExternalJson(outputPath, "Receipt output");
  const directory = path.dirname(resolved);
  await access(directory);
  try {
    return await open(resolved, "wx", 0o600);
  } catch {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_OUTPUT_EXISTS",
      "The receipt output cannot be exclusively reserved.",
    );
  }
}

async function writeUncertaintyMarker(
  handle: FileHandle,
  review: Readonly<SharedCellPostgresCutoverReviewManifest>,
  targetFingerprintSha256: string,
  error: MigrationApplyExecutionError,
): Promise<void> {
  const unsigned = {
    schemaVersion: 1,
    intent: "record_shared_cell_postgres_cutover_uncertainty",
    reviewManifestSha256: review.manifestSha256,
    targetFingerprintSha256,
    outcome: "uncertain",
    errorCode: error.code,
    mutationPerformed: error.mutationPerformed,
  } as const;
  const marker = { ...unsigned, markerSha256: await sha256Hex(unsigned) };
  await handle.truncate(0);
  await handle.write(`${JSON.stringify(marker)}\n`, 0, "utf8");
  await handle.sync();
}

async function main(): Promise<void> {
  const input = parseArguments(process.argv.slice(2));
  assertWrapperGuard(input.guardNonce);
  const review = await readReviewManifest(input.reviewPath, input.reviewSha256);
  const outputPath = assertAbsoluteExternalJson(input.outputPath, "Receipt output");
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_DATABASE_URL_MISSING",
      "DATABASE_URL is required for the reviewed Neon operation.",
    );
  }
  const [targetFingerprintSha256, catalog] = await Promise.all([
    databaseTargetFingerprint(databaseUrl),
    localMigrations(),
  ]);
  if (targetFingerprintSha256 !== review.targetFingerprintSha256) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_TARGET_MISMATCH",
      "The credentialed Neon target differs from the reviewed target.",
    );
  }
  const output = await reserveOutput(outputPath);
  neonConfig.webSocketConstructor = WebSocket;
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 1_000,
  });
  let success = false;
  let operationCompleted = false;
  let operationMutation: MutationState = false;
  let retainFailureEvidence = false;
  try {
    const receipt =
      input.mode === "apply-reviewed"
        ? await executeApply(pool, review, targetFingerprintSha256, catalog)
        : await verifyAppliedState(
            pool,
            review,
            targetFingerprintSha256,
            "reconciled",
            "unknown",
          );
    operationCompleted = true;
    operationMutation = receipt.mutationPerformed;
    await output.truncate(0);
    await output.write(`${JSON.stringify(receipt)}\n`, 0, "utf8");
    await output.sync();
    success = true;
    process.stdout.write(
      `${JSON.stringify({
        mode: input.mode,
        outcome: receipt.outcome,
        reviewManifestSha256: receipt.reviewManifestSha256,
        receiptSha256: receipt.receiptSha256,
        finalMigrations: receipt.finalMigrations.map(
          (migration) => migration.filename,
        ),
        mutationPerformed: receipt.mutationPerformed,
        output: outputPath,
      })}\n`,
    );
  } catch (error) {
    const normalized =
      error instanceof MigrationApplyExecutionError
        ? error
        : error instanceof NeonSharedCellMigrationReadinessError
          ? new MigrationApplyExecutionError(
              error.code,
              error.message,
              false,
              error.retryable,
            )
          : new MigrationApplyExecutionError(
              operationCompleted
                ? "NEON_SHARED_CELL_MIGRATION_EVIDENCE_WRITE_FAILED"
                : "NEON_SHARED_CELL_MIGRATION_APPLY_FAILED",
              operationCompleted
                ? "The database outcome was verified but its local evidence file could not be completed."
                : "The reviewed Neon migration operation failed without exposing provider details.",
              operationCompleted ? operationMutation : false,
              !operationCompleted,
            );
    if (normalized.mutationPerformed === true || normalized.mutationPerformed === "unknown") {
      retainFailureEvidence = true;
      try {
        await writeUncertaintyMarker(
          output,
          review,
          targetFingerprintSha256,
          normalized,
        );
      } catch {
        // The stderr result remains authoritative if local evidence cannot be written.
      }
    }
    throw normalized;
  } finally {
    await pool.end();
    await output.close();
    if (!success && !retainFailureEvidence) {
      try {
        await unlink(outputPath);
      } catch {
        // The exclusively created output was already removed.
      }
    }
  }
}

main().catch((error) => {
  const normalized =
    error instanceof MigrationApplyExecutionError
      ? error
      : error instanceof NeonSharedCellMigrationReadinessError
        ? new MigrationApplyExecutionError(
            error.code,
            error.message,
            false,
            error.retryable,
          )
        : new MigrationApplyExecutionError(
            "NEON_SHARED_CELL_MIGRATION_APPLY_INVALID",
            "The reviewed Neon migration operation failed.",
            false,
          );
  process.stderr.write(
    `${JSON.stringify({
      code: normalized.code,
      message: normalized.message,
      retryable: normalized.retryable,
      mutationPerformed: normalized.mutationPerformed,
    })}\n`,
  );
  process.exitCode = 1;
});
