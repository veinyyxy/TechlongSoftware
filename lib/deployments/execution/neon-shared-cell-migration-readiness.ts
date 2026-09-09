import { canonicalJson, sha256Hex } from "./hash.ts";

export const SHARED_CELL_POSTGRES_CUTOVER_MIGRATIONS = Object.freeze([
  "0005_tenant_resource_lifecycle.sql",
  "0006_deployment_lease_fencing.sql",
  "0007_external_ownership_epoch_cleanup_phases.sql",
  "0008_shared_cell_admission_fence.sql",
] as const);

export const SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG = Object.freeze([
  Object.freeze({
    filename: "0001_local_auth.sql",
    checksum: "c9bc42440c3fb8e71fd6ff8a46d82f19766dd3214c365ae26b34ea0bd56c6d1a",
  }),
  Object.freeze({
    filename: "0002_app_instance_deployment_planning.sql",
    checksum: "f7add4988ce35cb04bf5edc6855e7bf615899e6ddd4ea122a2eed025128d69ad",
  }),
  Object.freeze({
    filename: "0003_deployment_execution_foundation.sql",
    checksum: "ba1ba68ec2d4a3c85124b1ccdfd3f19188bca84b9f4a9013e70c7727231dd6bd",
  }),
  Object.freeze({
    filename: "0004_aws_sandbox_worker.sql",
    checksum: "523e35a9b326367747aba794b6acf3f8790108fef32f3b0a41e77503b6eb242d",
  }),
  Object.freeze({
    filename: "0005_tenant_resource_lifecycle.sql",
    checksum: "bd36678d6e6f0030c0254475b6a21be89a1adebea8883b99f2ce2014e9f60e05",
  }),
  Object.freeze({
    filename: "0006_deployment_lease_fencing.sql",
    checksum: "b6b48b8d0c298d354909a335cc91205632a6fa28097c0e901e734fb8ebcd0574",
  }),
  Object.freeze({
    filename: "0007_external_ownership_epoch_cleanup_phases.sql",
    checksum: "402b083c10f2740c6c3ac8089b0b4d0bf47e26acad4ac0cbc70ec86fa11e1540",
  }),
  Object.freeze({
    filename: "0008_shared_cell_admission_fence.sql",
    checksum: "0b8c161c4ba7e9f9cd9154ba9f008ec534b4b8b97023de9b8f8a63f8d2756c90",
  }),
] as const);

export const SHARED_CELL_POSTGRES_CUTOVER_MAX_REVIEW_AGE_MS = 15 * 60_000;
export const SHARED_CELL_POSTGRES_CUTOVER_MAX_CLOCK_RTT_MS = 10_000;
export const SHARED_CELL_POSTGRES_CUTOVER_MAX_CLOCK_SKEW_MS = 5_000;

const expectedAppliedPrefix = Object.freeze([
  "0001_local_auth.sql",
  "0002_app_instance_deployment_planning.sql",
  "0003_deployment_execution_foundation.sql",
  "0004_aws_sandbox_worker.sql",
] as const);
const digestPattern = /^[a-f0-9]{64}$/;
const migrationFilenamePattern = /^\d{4}_[a-z0-9_]+\.sql$/;

export class NeonSharedCellMigrationReadinessError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "NeonSharedCellMigrationReadinessError";
    this.code = code;
    this.retryable = retryable;
  }
}

function fail(code: string, message: string, retryable = false): never {
  throw new NeonSharedCellMigrationReadinessError(code, message, retryable);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    return value as Record<string, unknown>;
  } catch {
    return {};
  }
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  const source = record(value);
  let actual: string[];
  try {
    actual = Object.keys(source).sort();
  } catch {
    return false;
  }
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function safeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_READINESS_INVALID",
      `${label} must be a non-negative safe integer.`,
    );
  }
  return Number(value);
}

function exactBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    fail(
      "NEON_SHARED_CELL_MIGRATION_READINESS_INVALID",
      `${label} must be a boolean.`,
    );
  }
  return value;
}

function exactDigest(value: unknown, label: string): string {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_READINESS_INVALID",
      `${label} must be an exact lowercase SHA-256.`,
    );
  }
  return value;
}

function canonicalInstant(value: unknown, label: string): string {
  if (typeof value !== "string") {
    fail(
      "NEON_SHARED_CELL_MIGRATION_READINESS_INVALID",
      `${label} must be canonical UTC.`,
    );
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_READINESS_INVALID",
      `${label} must be canonical UTC.`,
    );
  }
  return value;
}

export interface SharedCellPostgresMigrationDigest {
  filename: string;
  checksum: string;
}

export interface SharedCellPostgresCutoverSchemaState {
  transactionReadOnly: boolean;
  transactionSerializable: boolean;
  transactionDeferrable: boolean;
  schemaMigrationsPresent: boolean;
  baseEnvironmentTablePresent: boolean;
  baseJobsTablePresent: boolean;
  baseCleanupScheduleTablePresent: boolean;
  tenantResourceTablePresent: boolean;
  externalOperationTablePresent: boolean;
  cleanupRunTablePresent: boolean;
  legacyStepRunAttemptIndexPresent: boolean;
  leaseTokenColumnPresent: boolean;
  externalEpochColumnPresent: boolean;
  admissionStateColumnPresent: boolean;
}

export interface SharedCellPostgresCutoverCounts {
  environmentCount: number;
  sandboxEnvironmentCount: number;
  applyEnabledEnvironmentCount: number;
  runningJobCount: number;
  queuedJobCount: number;
  runningStepCount: number;
  nonterminalCleanupScheduleCount: number;
  staleNonrunningLeaseCount: number;
  leaseExhaustedCleanupRewriteCount: number;
  capacityReservationCount: number;
  nonterminalDeploymentCount: number;
  reservationCoordinateMismatchCount: number;
  scheduleCoordinateMismatchCount: number;
}

export interface CompileSharedCellPostgresCutoverReviewInput {
  targetFingerprintSha256: string;
  localMigrations: readonly SharedCellPostgresMigrationDigest[];
  appliedMigrations: readonly SharedCellPostgresMigrationDigest[];
  schema: SharedCellPostgresCutoverSchemaState;
  counts: SharedCellPostgresCutoverCounts;
  postgresVersionNumber: number;
  databaseObservedAt: string;
  hostClockStartedAt: string;
  hostClockCompletedAt: string;
}

export interface SharedCellPostgresCutoverReviewManifest {
  schemaVersion: 1;
  intent: "review_shared_cell_postgres_cutover";
  targetFingerprintSha256: string;
  postgresVersionNumber: number;
  databaseObservedAt: string;
  hostClockStartedAt: string;
  hostClockCompletedAt: string;
  clockRoundTripMs: number;
  clockSkewMs: number;
  reviewExpiresAt: string;
  appliedMigrations: readonly Readonly<SharedCellPostgresMigrationDigest>[];
  pendingMigrations: readonly Readonly<SharedCellPostgresMigrationDigest>[];
  schema: Readonly<SharedCellPostgresCutoverSchemaState>;
  counts: Readonly<SharedCellPostgresCutoverCounts>;
  mutationPerformed: false;
  manifestSha256: string;
}

const inputKeys = [
  "appliedMigrations",
  "counts",
  "databaseObservedAt",
  "hostClockCompletedAt",
  "hostClockStartedAt",
  "localMigrations",
  "postgresVersionNumber",
  "schema",
  "targetFingerprintSha256",
] as const;
const migrationKeys = ["checksum", "filename"] as const;
const schemaKeys = [
  "admissionStateColumnPresent",
  "baseCleanupScheduleTablePresent",
  "baseEnvironmentTablePresent",
  "baseJobsTablePresent",
  "cleanupRunTablePresent",
  "externalEpochColumnPresent",
  "externalOperationTablePresent",
  "legacyStepRunAttemptIndexPresent",
  "leaseTokenColumnPresent",
  "schemaMigrationsPresent",
  "tenantResourceTablePresent",
  "transactionDeferrable",
  "transactionReadOnly",
  "transactionSerializable",
] as const;
const countKeys = [
  "applyEnabledEnvironmentCount",
  "capacityReservationCount",
  "environmentCount",
  "leaseExhaustedCleanupRewriteCount",
  "nonterminalCleanupScheduleCount",
  "nonterminalDeploymentCount",
  "queuedJobCount",
  "reservationCoordinateMismatchCount",
  "runningJobCount",
  "runningStepCount",
  "sandboxEnvironmentCount",
  "scheduleCoordinateMismatchCount",
  "staleNonrunningLeaseCount",
] as const;

function validatedMigrations(
  value: readonly SharedCellPostgresMigrationDigest[],
  label: string,
): Readonly<SharedCellPostgresMigrationDigest>[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_CATALOG_INVALID",
      `${label} migration catalog is invalid.`,
    );
  }
  const seen = new Set<string>();
  return value.map((item) => {
    if (
      !exactKeys(item, migrationKeys) ||
      typeof item.filename !== "string" ||
      !migrationFilenamePattern.test(item.filename) ||
      seen.has(item.filename)
    ) {
      fail(
        "NEON_SHARED_CELL_MIGRATION_CATALOG_INVALID",
        `${label} migration catalog is invalid.`,
      );
    }
    seen.add(item.filename);
    return Object.freeze({
      filename: item.filename,
      checksum: exactDigest(item.checksum, `${label} migration checksum`),
    });
  });
}

function assertExpectedLocalCatalog(
  migrations: readonly Readonly<SharedCellPostgresMigrationDigest>[],
): void {
  if (
    migrations.length !== SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG.length ||
    migrations.some(
      (migration, index) =>
        migration.filename !==
          SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG[index]?.filename ||
        migration.checksum !==
          SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG[index]?.checksum,
    )
  ) {
    fail(
      "NEON_SHARED_CELL_LOCAL_MIGRATION_SET_INVALID",
      "The local migration catalog is not the exact reviewed 0001-0008 sequence.",
    );
  }
}

function assertAppliedPrefix(
  local: readonly Readonly<SharedCellPostgresMigrationDigest>[],
  applied: readonly Readonly<SharedCellPostgresMigrationDigest>[],
): void {
  if (
    applied.length !== expectedAppliedPrefix.length ||
    applied.some(
      (migration, index) =>
        migration.filename !== expectedAppliedPrefix[index] ||
        migration.filename !== local[index]?.filename ||
        migration.checksum !== local[index]?.checksum,
    )
  ) {
    fail(
      "NEON_SHARED_CELL_APPLIED_MIGRATION_DRIFT",
      "Neon must contain the exact reviewed 0001-0004 prefix and no partial cutover migration.",
    );
  }
}

function validatedSchema(
  value: SharedCellPostgresCutoverSchemaState,
): Readonly<SharedCellPostgresCutoverSchemaState> {
  if (!exactKeys(value, schemaKeys)) {
    fail(
      "NEON_SHARED_CELL_SCHEMA_STATE_INVALID",
      "The Neon schema-state snapshot is incomplete.",
    );
  }
  const schema = Object.fromEntries(
    schemaKeys.map((key) => [key, exactBoolean(value[key], key)]),
  ) as unknown as SharedCellPostgresCutoverSchemaState;
  if (
    !schema.transactionReadOnly ||
    !schema.transactionSerializable ||
    !schema.transactionDeferrable ||
    !schema.schemaMigrationsPresent ||
    !schema.baseEnvironmentTablePresent ||
    !schema.baseJobsTablePresent ||
    !schema.baseCleanupScheduleTablePresent ||
    !schema.legacyStepRunAttemptIndexPresent
  ) {
    fail(
      "NEON_SHARED_CELL_BASE_SCHEMA_MISSING",
      "The required 0001-0004 Neon base schema is incomplete.",
    );
  }
  if (
    schema.tenantResourceTablePresent ||
    schema.externalOperationTablePresent ||
    schema.cleanupRunTablePresent ||
    schema.leaseTokenColumnPresent ||
    schema.externalEpochColumnPresent ||
    schema.admissionStateColumnPresent
  ) {
    fail(
      "NEON_SHARED_CELL_PARTIAL_CUTOVER_SCHEMA",
      "Cutover schema objects exist without the reviewed 0005-0008 migration records.",
    );
  }
  return Object.freeze(schema);
}

function validatedCounts(
  value: SharedCellPostgresCutoverCounts,
): Readonly<SharedCellPostgresCutoverCounts> {
  if (!exactKeys(value, countKeys)) {
    fail(
      "NEON_SHARED_CELL_CUTOVER_COUNTS_INVALID",
      "The cutover conflict snapshot is incomplete.",
    );
  }
  const counts = Object.fromEntries(
    countKeys.map((key) => [key, safeInteger(value[key], key)]),
  ) as unknown as SharedCellPostgresCutoverCounts;
  if (counts.environmentCount < 1 || counts.sandboxEnvironmentCount !== 1) {
    fail(
      "NEON_SHARED_CELL_ENVIRONMENT_DRIFT",
      "Neon must contain exactly one fixed AWS Sandbox environment.",
    );
  }
  if (
    counts.applyEnabledEnvironmentCount !== 0 ||
    counts.runningJobCount !== 0 ||
    counts.queuedJobCount !== 0 ||
    counts.runningStepCount !== 0 ||
    counts.nonterminalCleanupScheduleCount !== 0 ||
    counts.staleNonrunningLeaseCount !== 0 ||
    counts.leaseExhaustedCleanupRewriteCount !== 0 ||
    counts.capacityReservationCount !== 0
  ) {
    fail(
      "NEON_SHARED_CELL_CUTOVER_ACTIVITY_PRESENT",
      "Neon has active deployment work or ownership that must be quiesced before cutover.",
      true,
    );
  }
  if (
    counts.reservationCoordinateMismatchCount !== 0 ||
    counts.scheduleCoordinateMismatchCount !== 0
  ) {
    fail(
      "NEON_SHARED_CELL_CUTOVER_COORDINATE_MISMATCH",
      "Neon contains deployment ownership coordinate drift.",
    );
  }
  return Object.freeze(counts);
}

/**
 * Compiles the read-only online inspection into a short-lived, hash-bound
 * review manifest. This function performs no I/O and never receives a URL or
 * credential; the database target is represented only by a non-secret digest.
 */
export async function compileSharedCellPostgresCutoverReview(
  input: CompileSharedCellPostgresCutoverReviewInput,
): Promise<Readonly<SharedCellPostgresCutoverReviewManifest>> {
  if (!exactKeys(input, inputKeys)) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_READINESS_INVALID",
      "The cutover review input contains missing or unexpected fields.",
    );
  }
  const targetFingerprintSha256 = exactDigest(
    input.targetFingerprintSha256,
    "target fingerprint",
  );
  const localMigrations = validatedMigrations(input.localMigrations, "local");
  const appliedMigrations = validatedMigrations(
    input.appliedMigrations,
    "applied",
  );
  assertExpectedLocalCatalog(localMigrations);
  assertAppliedPrefix(localMigrations, appliedMigrations);
  const pendingMigrations = Object.freeze(
    localMigrations.slice(appliedMigrations.length).map((migration) =>
      Object.freeze({ ...migration }),
    ),
  );
  if (
    pendingMigrations.length !== SHARED_CELL_POSTGRES_CUTOVER_MIGRATIONS.length ||
    pendingMigrations.some(
      (migration, index) =>
        migration.filename !== SHARED_CELL_POSTGRES_CUTOVER_MIGRATIONS[index],
    )
  ) {
    fail(
      "NEON_SHARED_CELL_PENDING_MIGRATION_SET_INVALID",
      "The only allowed pending migration set is the exact reviewed 0005-0008 suffix.",
    );
  }

  const schema = validatedSchema(input.schema);
  const counts = validatedCounts(input.counts);
  const postgresVersionNumber = safeInteger(
    input.postgresVersionNumber,
    "postgresVersionNumber",
  );
  if (postgresVersionNumber < 160_000 || postgresVersionNumber >= 200_000) {
    fail(
      "NEON_SHARED_CELL_POSTGRES_VERSION_UNSUPPORTED",
      "The Neon PostgreSQL version is outside the reviewed 16-19 compatibility range.",
    );
  }
  const databaseObservedAt = canonicalInstant(
    input.databaseObservedAt,
    "databaseObservedAt",
  );
  const hostClockStartedAt = canonicalInstant(
    input.hostClockStartedAt,
    "hostClockStartedAt",
  );
  const hostClockCompletedAt = canonicalInstant(
    input.hostClockCompletedAt,
    "hostClockCompletedAt",
  );
  const started = Date.parse(hostClockStartedAt);
  const completed = Date.parse(hostClockCompletedAt);
  const database = Date.parse(databaseObservedAt);
  if (completed < started) {
    fail(
      "NEON_SHARED_CELL_CLOCK_INVALID",
      "The host clock moved backwards during Neon inspection.",
    );
  }
  const clockRoundTripMs = completed - started;
  const clockSkewMs = database - Math.round((started + completed) / 2);
  if (clockRoundTripMs > SHARED_CELL_POSTGRES_CUTOVER_MAX_CLOCK_RTT_MS) {
    fail(
      "NEON_SHARED_CELL_CLOCK_RTT_EXCEEDED",
      "The Neon clock sample round trip exceeded the reviewed maximum.",
      true,
    );
  }
  if (Math.abs(clockSkewMs) > SHARED_CELL_POSTGRES_CUTOVER_MAX_CLOCK_SKEW_MS) {
    fail(
      "NEON_SHARED_CELL_CLOCK_SKEW_EXCEEDED",
      "The Neon and runtime clocks are outside the reviewed skew bound.",
      true,
    );
  }
  const unsigned = Object.freeze({
    schemaVersion: 1 as const,
    intent: "review_shared_cell_postgres_cutover" as const,
    targetFingerprintSha256,
    postgresVersionNumber,
    databaseObservedAt,
    hostClockStartedAt,
    hostClockCompletedAt,
    clockRoundTripMs,
    clockSkewMs,
    reviewExpiresAt: new Date(
      completed + SHARED_CELL_POSTGRES_CUTOVER_MAX_REVIEW_AGE_MS,
    ).toISOString(),
    appliedMigrations: Object.freeze(
      appliedMigrations.map((migration) => Object.freeze({ ...migration })),
    ),
    pendingMigrations,
    schema,
    counts,
    mutationPerformed: false as const,
  });
  return Object.freeze({
    ...unsigned,
    manifestSha256: await sha256Hex(unsigned),
  });
}

export async function validateSharedCellPostgresCutoverReviewManifest(
  value: unknown,
): Promise<Readonly<SharedCellPostgresCutoverReviewManifest>> {
  const manifest = record(value) as unknown as SharedCellPostgresCutoverReviewManifest;
  if (
    !exactKeys(manifest, [
      "appliedMigrations",
      "clockRoundTripMs",
      "clockSkewMs",
      "counts",
      "databaseObservedAt",
      "hostClockCompletedAt",
      "hostClockStartedAt",
      "intent",
      "manifestSha256",
      "mutationPerformed",
      "pendingMigrations",
      "postgresVersionNumber",
      "reviewExpiresAt",
      "schema",
      "schemaVersion",
      "targetFingerprintSha256",
    ]) ||
    manifest.schemaVersion !== 1 ||
    manifest.intent !== "review_shared_cell_postgres_cutover" ||
    manifest.mutationPerformed !== false ||
    !digestPattern.test(manifest.manifestSha256 ?? "")
  ) {
    fail(
      "NEON_SHARED_CELL_REVIEW_MANIFEST_INVALID",
      "The cutover review manifest is malformed.",
    );
  }
  const unsigned = { ...manifest } as Record<string, unknown>;
  delete unsigned.manifestSha256;
  if ((await sha256Hex(unsigned)) !== manifest.manifestSha256) {
    fail(
      "NEON_SHARED_CELL_REVIEW_MANIFEST_HASH_MISMATCH",
      "The cutover review manifest hash does not match its canonical contents.",
    );
  }
  const recompiled = await compileSharedCellPostgresCutoverReview({
    targetFingerprintSha256: manifest.targetFingerprintSha256,
    localMigrations: [
      ...manifest.appliedMigrations,
      ...manifest.pendingMigrations,
    ],
    appliedMigrations: manifest.appliedMigrations,
    schema: manifest.schema,
    counts: manifest.counts,
    postgresVersionNumber: manifest.postgresVersionNumber,
    databaseObservedAt: manifest.databaseObservedAt,
    hostClockStartedAt: manifest.hostClockStartedAt,
    hostClockCompletedAt: manifest.hostClockCompletedAt,
  });
  if (canonicalJson(recompiled) !== canonicalJson(manifest)) {
    fail(
      "NEON_SHARED_CELL_REVIEW_MANIFEST_INVALID",
      "The cutover review manifest is not canonical.",
    );
  }
  return recompiled;
}
