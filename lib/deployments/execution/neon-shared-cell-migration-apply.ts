import { canonicalJson, sha256Hex } from "./hash.ts";
import {
  NeonSharedCellMigrationReadinessError,
  SHARED_CELL_POSTGRES_CUTOVER_MAX_CLOCK_RTT_MS,
  SHARED_CELL_POSTGRES_CUTOVER_MAX_CLOCK_SKEW_MS,
  SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG,
  type SharedCellPostgresCutoverCounts,
  type SharedCellPostgresCutoverReviewManifest,
  type SharedCellPostgresMigrationDigest,
  validateSharedCellPostgresCutoverReviewManifest,
} from "./neon-shared-cell-migration-readiness.ts";

export const SHARED_CELL_POSTGRES_CUTOVER_TRIGGER_COUNT = 23;
export const SHARED_CELL_POSTGRES_CUTOVER_INDEX_COUNT = 20;
export const SHARED_CELL_POSTGRES_CUTOVER_CONSTRAINT_COUNT = 23;

const digestPattern = /^[a-f0-9]{64}$/;
const schemaKeys = [
  "admissionEpochColumnPresent",
  "admissionFenceColumnPresent",
  "admissionStateColumnPresent",
  "baseCleanupScheduleTablePresent",
  "baseEnvironmentTablePresent",
  "baseJobsTablePresent",
  "cleanupEventTablePresent",
  "cleanupPhaseTablePresent",
  "cleanupRunTablePresent",
  "criticalConstraintCount",
  "criticalConstraintValidatedCount",
  "criticalIndexCount",
  "criticalTriggerEnabledCount",
  "criticalTriggerCount",
  "cutoverStepRunAttemptIndexPresent",
  "externalOperationEpochColumnPresent",
  "externalOperationEventTablePresent",
  "externalOperationTablePresent",
  "legacyStepRunAttemptIndexPresent",
  "leaseTokenColumnPresent",
  "schemaMigrationsPresent",
  "searchPathPublic",
  "tenantResourceEventTablePresent",
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
const preflightKeys = [
  "appliedMigrations",
  "counts",
  "databaseObservedAt",
  "expectedReviewManifestSha256",
  "hostClockCompletedAt",
  "hostClockStartedAt",
  "localMigrations",
  "postgresVersionNumber",
  "reviewManifest",
  "schema",
  "targetFingerprintSha256",
] as const;
const receiptInputKeys = [
  "counts",
  "databaseObservedAt",
  "expectedReviewManifestSha256",
  "finalMigrations",
  "hostClockCompletedAt",
  "hostClockStartedAt",
  "mutationPerformed",
  "outcome",
  "postState",
  "postgresVersionNumber",
  "reviewManifest",
  "schema",
  "targetFingerprintSha256",
] as const;
const postStateKeys = [
  "cutoverDataRowCount",
  "environmentAdmissionDefaultCount",
  "sandboxAdmissionDefaultCount",
] as const;

export interface SharedCellPostgresMigrationSchemaProof {
  transactionReadOnly: boolean;
  transactionSerializable: boolean;
  transactionDeferrable: boolean;
  searchPathPublic: boolean;
  schemaMigrationsPresent: boolean;
  baseEnvironmentTablePresent: boolean;
  baseJobsTablePresent: boolean;
  baseCleanupScheduleTablePresent: boolean;
  tenantResourceTablePresent: boolean;
  tenantResourceEventTablePresent: boolean;
  externalOperationTablePresent: boolean;
  externalOperationEventTablePresent: boolean;
  cleanupRunTablePresent: boolean;
  cleanupPhaseTablePresent: boolean;
  cleanupEventTablePresent: boolean;
  leaseTokenColumnPresent: boolean;
  externalOperationEpochColumnPresent: boolean;
  admissionStateColumnPresent: boolean;
  admissionEpochColumnPresent: boolean;
  admissionFenceColumnPresent: boolean;
  criticalTriggerCount: number;
  criticalTriggerEnabledCount: number;
  criticalIndexCount: number;
  criticalConstraintCount: number;
  criticalConstraintValidatedCount: number;
  legacyStepRunAttemptIndexPresent: boolean;
  cutoverStepRunAttemptIndexPresent: boolean;
}

export interface SharedCellPostgresMigrationPostStateProof {
  cutoverDataRowCount: number;
  environmentAdmissionDefaultCount: number;
  sandboxAdmissionDefaultCount: number;
}

export interface AuthorizeSharedCellPostgresMigrationApplyInput {
  reviewManifest: unknown;
  expectedReviewManifestSha256: string;
  targetFingerprintSha256: string;
  localMigrations: readonly SharedCellPostgresMigrationDigest[];
  appliedMigrations: readonly SharedCellPostgresMigrationDigest[];
  schema: SharedCellPostgresMigrationSchemaProof;
  counts: SharedCellPostgresCutoverCounts;
  postgresVersionNumber: number;
  databaseObservedAt: string;
  hostClockStartedAt: string;
  hostClockCompletedAt: string;
}

export interface SharedCellPostgresMigrationApplyPlan {
  schemaVersion: 1;
  intent: "apply_reviewed_shared_cell_postgres_cutover";
  reviewManifestSha256: string;
  targetFingerprintSha256: string;
  migrations: readonly Readonly<SharedCellPostgresMigrationDigest>[];
  authorizedAt: string;
  planSha256: string;
}

export type SharedCellPostgresMigrationApplyOutcome =
  | "applied"
  | "already_applied"
  | "reconciled";

export interface CompileSharedCellPostgresMigrationReceiptInput {
  reviewManifest: unknown;
  expectedReviewManifestSha256: string;
  targetFingerprintSha256: string;
  finalMigrations: readonly SharedCellPostgresMigrationDigest[];
  schema: SharedCellPostgresMigrationSchemaProof;
  postState: SharedCellPostgresMigrationPostStateProof;
  counts: SharedCellPostgresCutoverCounts;
  postgresVersionNumber: number;
  databaseObservedAt: string;
  hostClockStartedAt: string;
  hostClockCompletedAt: string;
  outcome: SharedCellPostgresMigrationApplyOutcome;
  mutationPerformed: boolean | "unknown";
}

export interface SharedCellPostgresMigrationReceipt {
  schemaVersion: 1;
  intent: "prove_shared_cell_postgres_cutover";
  outcome: SharedCellPostgresMigrationApplyOutcome;
  reviewManifestSha256: string;
  targetFingerprintSha256: string;
  postgresVersionNumber: number;
  databaseObservedAt: string;
  hostClockStartedAt: string;
  hostClockCompletedAt: string;
  clockRoundTripMs: number;
  clockSkewMs: number;
  finalMigrations: readonly Readonly<SharedCellPostgresMigrationDigest>[];
  schema: Readonly<SharedCellPostgresMigrationSchemaProof>;
  postState: Readonly<SharedCellPostgresMigrationPostStateProof>;
  counts: Readonly<SharedCellPostgresCutoverCounts>;
  databaseMutationPresent: true;
  mutationPerformed: boolean | "unknown";
  receiptSha256: string;
}

function fail(code: string, message: string, retryable = false): never {
  throw new NeonSharedCellMigrationReadinessError(code, message, retryable);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function exactKeys(value: unknown, expected: readonly string[]): boolean {
  const actual = Object.keys(record(value)).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_INVALID",
      `${label} must be an exact lowercase SHA-256.`,
    );
  }
  return value;
}

function safeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_INVALID",
      `${label} must be a non-negative safe integer.`,
    );
  }
  return Number(value);
}

function instant(value: unknown, label: string): string {
  if (typeof value !== "string") {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_INVALID",
      `${label} must be canonical UTC.`,
    );
  }
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_INVALID",
      `${label} must be canonical UTC.`,
    );
  }
  return value;
}

function clockSample(input: {
  databaseObservedAt: unknown;
  hostClockStartedAt: unknown;
  hostClockCompletedAt: unknown;
}): {
  databaseObservedAt: string;
  hostClockStartedAt: string;
  hostClockCompletedAt: string;
  clockRoundTripMs: number;
  clockSkewMs: number;
} {
  const databaseObservedAt = instant(
    input.databaseObservedAt,
    "databaseObservedAt",
  );
  const hostClockStartedAt = instant(
    input.hostClockStartedAt,
    "hostClockStartedAt",
  );
  const hostClockCompletedAt = instant(
    input.hostClockCompletedAt,
    "hostClockCompletedAt",
  );
  const started = Date.parse(hostClockStartedAt);
  const completed = Date.parse(hostClockCompletedAt);
  const database = Date.parse(databaseObservedAt);
  if (completed < started) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_CLOCK_INVALID",
      "The host clock moved backwards during the database check.",
    );
  }
  const clockRoundTripMs = completed - started;
  const clockSkewMs = database - Math.round((started + completed) / 2);
  if (clockRoundTripMs > SHARED_CELL_POSTGRES_CUTOVER_MAX_CLOCK_RTT_MS) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_CLOCK_RTT_EXCEEDED",
      "The database clock round trip exceeded the reviewed maximum.",
      true,
    );
  }
  if (Math.abs(clockSkewMs) > SHARED_CELL_POSTGRES_CUTOVER_MAX_CLOCK_SKEW_MS) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_CLOCK_SKEW_EXCEEDED",
      "The Neon and runtime clocks are outside the reviewed skew bound.",
      true,
    );
  }
  return {
    databaseObservedAt,
    hostClockStartedAt,
    hostClockCompletedAt,
    clockRoundTripMs,
    clockSkewMs,
  };
}

function migrations(
  value: readonly SharedCellPostgresMigrationDigest[],
  label: string,
): readonly Readonly<SharedCellPostgresMigrationDigest>[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_CATALOG_INVALID",
      `${label} migration catalog is invalid.`,
    );
  }
  const seen = new Set<string>();
  return Object.freeze(
    value.map((item) => {
      if (
        !exactKeys(item, ["checksum", "filename"]) ||
        typeof item.filename !== "string" ||
        !/^\d{4}_[a-z0-9_]+\.sql$/.test(item.filename) ||
        seen.has(item.filename)
      ) {
        fail(
          "NEON_SHARED_CELL_MIGRATION_APPLY_CATALOG_INVALID",
          `${label} migration catalog is invalid.`,
        );
      }
      seen.add(item.filename);
      return Object.freeze({
        filename: item.filename,
        checksum: digest(item.checksum, `${label} migration checksum`),
      });
    }),
  );
}

function sameMigrations(
  left: readonly Readonly<SharedCellPostgresMigrationDigest>[],
  right: readonly Readonly<SharedCellPostgresMigrationDigest>[],
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

function normalizedCounts(
  value: SharedCellPostgresCutoverCounts,
): Readonly<SharedCellPostgresCutoverCounts> {
  if (!exactKeys(value, countKeys)) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_COUNTS_INVALID",
      "The migration activity snapshot is incomplete.",
    );
  }
  const counts = Object.fromEntries(
    countKeys.map((key) => [key, safeInteger(value[key], key)]),
  ) as unknown as SharedCellPostgresCutoverCounts;
  return Object.freeze(counts);
}

function normalizedSchema(
  value: SharedCellPostgresMigrationSchemaProof,
): Readonly<SharedCellPostgresMigrationSchemaProof> {
  if (!exactKeys(value, schemaKeys)) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_SCHEMA_INVALID",
      "The migration schema proof is incomplete.",
    );
  }
  const schema = { ...value };
  for (const key of schemaKeys) {
    if (
      key === "criticalTriggerCount" ||
      key === "criticalTriggerEnabledCount" ||
      key === "criticalIndexCount" ||
      key === "criticalConstraintCount" ||
      key === "criticalConstraintValidatedCount"
    ) {
      continue;
    }
    if (typeof schema[key] !== "boolean") {
      fail(
        "NEON_SHARED_CELL_MIGRATION_APPLY_SCHEMA_INVALID",
        `${key} must be a boolean.`,
      );
    }
  }
  schema.criticalTriggerCount = safeInteger(
    schema.criticalTriggerCount,
    "criticalTriggerCount",
  );
  schema.criticalTriggerEnabledCount = safeInteger(
    schema.criticalTriggerEnabledCount,
    "criticalTriggerEnabledCount",
  );
  schema.criticalIndexCount = safeInteger(
    schema.criticalIndexCount,
    "criticalIndexCount",
  );
  schema.criticalConstraintCount = safeInteger(
    schema.criticalConstraintCount,
    "criticalConstraintCount",
  );
  schema.criticalConstraintValidatedCount = safeInteger(
    schema.criticalConstraintValidatedCount,
    "criticalConstraintValidatedCount",
  );
  return Object.freeze(schema);
}

function assertExactCounts(
  actual: Readonly<SharedCellPostgresCutoverCounts>,
  expected: Readonly<SharedCellPostgresCutoverCounts>,
): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_ACTIVITY_DRIFT",
      "The locked migration activity snapshot differs from the reviewed snapshot.",
      true,
    );
  }
}

function assertSafeCounts(
  counts: Readonly<SharedCellPostgresCutoverCounts>,
): void {
  if (
    counts.environmentCount < 1 ||
    counts.sandboxEnvironmentCount !== 1 ||
    counts.applyEnabledEnvironmentCount !== 0 ||
    counts.runningJobCount !== 0 ||
    counts.queuedJobCount !== 0 ||
    counts.runningStepCount !== 0 ||
    counts.nonterminalCleanupScheduleCount !== 0 ||
    counts.staleNonrunningLeaseCount !== 0 ||
    counts.leaseExhaustedCleanupRewriteCount !== 0 ||
    counts.capacityReservationCount !== 0 ||
    counts.reservationCoordinateMismatchCount !== 0 ||
    counts.scheduleCoordinateMismatchCount !== 0
  ) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_ACTIVITY_PRESENT",
      "The migration evidence contains active work or ownership drift.",
      true,
    );
  }
}

function normalizedPostState(
  value: SharedCellPostgresMigrationPostStateProof,
): Readonly<SharedCellPostgresMigrationPostStateProof> {
  if (!exactKeys(value, postStateKeys)) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_POST_STATE_INVALID",
      "The post-cutover state proof is incomplete.",
    );
  }
  const postState = Object.freeze({
    cutoverDataRowCount: safeInteger(
      value.cutoverDataRowCount,
      "cutoverDataRowCount",
    ),
    environmentAdmissionDefaultCount: safeInteger(
      value.environmentAdmissionDefaultCount,
      "environmentAdmissionDefaultCount",
    ),
    sandboxAdmissionDefaultCount: safeInteger(
      value.sandboxAdmissionDefaultCount,
      "sandboxAdmissionDefaultCount",
    ),
  });
  if (
    postState.cutoverDataRowCount !== 0 ||
    postState.sandboxAdmissionDefaultCount !== 1
  ) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_POST_STATE_INVALID",
      "Neon does not contain the exact empty/default post-cutover state.",
    );
  }
  return postState;
}

function assertPreSchema(
  schema: Readonly<SharedCellPostgresMigrationSchemaProof>,
  review: Readonly<SharedCellPostgresCutoverReviewManifest>,
): void {
  if (
    schema.transactionReadOnly ||
    !schema.transactionSerializable ||
    schema.transactionDeferrable ||
    !schema.searchPathPublic ||
    !schema.schemaMigrationsPresent ||
    !schema.baseEnvironmentTablePresent ||
    !schema.baseJobsTablePresent ||
    !schema.baseCleanupScheduleTablePresent ||
    schema.tenantResourceTablePresent ||
    schema.tenantResourceEventTablePresent ||
    schema.externalOperationTablePresent ||
    schema.externalOperationEventTablePresent ||
    schema.cleanupRunTablePresent ||
    schema.cleanupPhaseTablePresent ||
    schema.cleanupEventTablePresent ||
    schema.leaseTokenColumnPresent ||
    schema.externalOperationEpochColumnPresent ||
    schema.admissionStateColumnPresent ||
    schema.admissionEpochColumnPresent ||
    schema.admissionFenceColumnPresent ||
    !schema.legacyStepRunAttemptIndexPresent ||
    schema.cutoverStepRunAttemptIndexPresent ||
    schema.criticalTriggerCount !== 0 ||
    schema.criticalTriggerEnabledCount !== 0 ||
    schema.criticalIndexCount !== 1 ||
    schema.criticalConstraintCount !== 0 ||
    schema.criticalConstraintValidatedCount !== 0
  ) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_PRE_SCHEMA_DRIFT",
      "The locked Neon schema is not the exact reviewed pre-cutover state.",
    );
  }
  if (
    !review.schema.schemaMigrationsPresent ||
    !review.schema.baseEnvironmentTablePresent ||
    !review.schema.baseJobsTablePresent ||
    !review.schema.baseCleanupScheduleTablePresent ||
    !review.schema.legacyStepRunAttemptIndexPresent ||
    review.schema.tenantResourceTablePresent ||
    review.schema.externalOperationTablePresent ||
    review.schema.cleanupRunTablePresent ||
    review.schema.leaseTokenColumnPresent ||
    review.schema.externalEpochColumnPresent ||
    review.schema.admissionStateColumnPresent
  ) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_REVIEW_SCHEMA_INVALID",
      "The reviewed manifest does not describe the exact pre-cutover schema.",
    );
  }
}

function assertPostSchema(
  schema: Readonly<SharedCellPostgresMigrationSchemaProof>,
): void {
  if (
    !schema.transactionReadOnly ||
    !schema.transactionSerializable ||
    !schema.transactionDeferrable ||
    !schema.searchPathPublic ||
    !schema.schemaMigrationsPresent ||
    !schema.baseEnvironmentTablePresent ||
    !schema.baseJobsTablePresent ||
    !schema.baseCleanupScheduleTablePresent ||
    !schema.tenantResourceTablePresent ||
    !schema.tenantResourceEventTablePresent ||
    !schema.externalOperationTablePresent ||
    !schema.externalOperationEventTablePresent ||
    !schema.cleanupRunTablePresent ||
    !schema.cleanupPhaseTablePresent ||
    !schema.cleanupEventTablePresent ||
    !schema.leaseTokenColumnPresent ||
    !schema.externalOperationEpochColumnPresent ||
    !schema.admissionStateColumnPresent ||
    !schema.admissionEpochColumnPresent ||
    !schema.admissionFenceColumnPresent ||
    schema.legacyStepRunAttemptIndexPresent ||
    !schema.cutoverStepRunAttemptIndexPresent ||
    schema.criticalTriggerCount !== SHARED_CELL_POSTGRES_CUTOVER_TRIGGER_COUNT ||
    schema.criticalTriggerEnabledCount !==
      SHARED_CELL_POSTGRES_CUTOVER_TRIGGER_COUNT ||
    schema.criticalIndexCount !== SHARED_CELL_POSTGRES_CUTOVER_INDEX_COUNT ||
    schema.criticalConstraintCount !==
      SHARED_CELL_POSTGRES_CUTOVER_CONSTRAINT_COUNT ||
    schema.criticalConstraintValidatedCount !==
      SHARED_CELL_POSTGRES_CUTOVER_CONSTRAINT_COUNT
  ) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_POST_SCHEMA_INVALID",
      "Neon does not contain the exact reviewed post-cutover schema proof.",
    );
  }
}

async function reviewed(
  value: unknown,
  expectedSha256: unknown,
): Promise<Readonly<SharedCellPostgresCutoverReviewManifest>> {
  const expected = digest(expectedSha256, "review manifest SHA-256");
  const manifest = await validateSharedCellPostgresCutoverReviewManifest(value);
  if (manifest.manifestSha256 !== expected) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_REVIEW_HASH_MISMATCH",
      "The review manifest differs from the explicitly approved digest.",
    );
  }
  return manifest;
}

export async function authorizeSharedCellPostgresMigrationApply(
  input: AuthorizeSharedCellPostgresMigrationApplyInput,
): Promise<Readonly<SharedCellPostgresMigrationApplyPlan>> {
  if (!exactKeys(input, preflightKeys)) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_INVALID",
      "The migration apply preflight contains missing or unexpected fields.",
    );
  }
  const review = await reviewed(
    input.reviewManifest,
    input.expectedReviewManifestSha256,
  );
  const targetFingerprintSha256 = digest(
    input.targetFingerprintSha256,
    "target fingerprint",
  );
  if (targetFingerprintSha256 !== review.targetFingerprintSha256) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_TARGET_MISMATCH",
      "The credentialed Neon target differs from the reviewed target.",
    );
  }
  const local = migrations(input.localMigrations, "local");
  const expectedLocal = [...review.appliedMigrations, ...review.pendingMigrations];
  if (!sameMigrations(local, expectedLocal)) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_LOCAL_DRIFT",
      "The local migration catalog differs from the reviewed catalog.",
    );
  }
  const applied = migrations(input.appliedMigrations, "applied");
  if (!sameMigrations(applied, review.appliedMigrations)) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_DATABASE_DRIFT",
      "The locked database migration prefix differs from the reviewed prefix.",
    );
  }
  const schema = normalizedSchema(input.schema);
  assertPreSchema(schema, review);
  const counts = normalizedCounts(input.counts);
  assertSafeCounts(counts);
  assertExactCounts(counts, review.counts);
  const postgresVersionNumber = safeInteger(
    input.postgresVersionNumber,
    "postgresVersionNumber",
  );
  if (postgresVersionNumber !== review.postgresVersionNumber) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_VERSION_DRIFT",
      "The Neon PostgreSQL version differs from the reviewed version.",
    );
  }
  const clock = clockSample(input);
  const expiresAt = Date.parse(review.reviewExpiresAt);
  const databaseNow = Date.parse(clock.databaseObservedAt);
  const hostNow = Date.parse(clock.hostClockCompletedAt);
  if (
    databaseNow > expiresAt ||
    hostNow > expiresAt ||
    hostNow < Date.parse(review.hostClockStartedAt)
  ) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_REVIEW_EXPIRED",
      "The reviewed Neon inspection is expired or the runtime clock moved backwards.",
      true,
    );
  }
  const unsigned = Object.freeze({
    schemaVersion: 1 as const,
    intent: "apply_reviewed_shared_cell_postgres_cutover" as const,
    reviewManifestSha256: review.manifestSha256,
    targetFingerprintSha256,
    migrations: Object.freeze(
      review.pendingMigrations.map((migration) => Object.freeze({ ...migration })),
    ),
    authorizedAt: clock.hostClockCompletedAt,
  });
  return Object.freeze({
    ...unsigned,
    planSha256: await sha256Hex(unsigned),
  });
}

export async function compileSharedCellPostgresMigrationReceipt(
  input: CompileSharedCellPostgresMigrationReceiptInput,
): Promise<Readonly<SharedCellPostgresMigrationReceipt>> {
  if (!exactKeys(input, receiptInputKeys)) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_RECEIPT_INVALID",
      "The migration receipt input contains missing or unexpected fields.",
    );
  }
  const review = await reviewed(
    input.reviewManifest,
    input.expectedReviewManifestSha256,
  );
  const targetFingerprintSha256 = digest(
    input.targetFingerprintSha256,
    "target fingerprint",
  );
  if (targetFingerprintSha256 !== review.targetFingerprintSha256) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_TARGET_MISMATCH",
      "The verified Neon target differs from the reviewed target.",
    );
  }
  const finalMigrations = migrations(input.finalMigrations, "final");
  if (!sameMigrations(finalMigrations, SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG)) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_RECEIPT_CATALOG_INVALID",
      "The verified database does not contain the exact 0001-0008 catalog.",
    );
  }
  const schema = normalizedSchema(input.schema);
  assertPostSchema(schema);
  const postState = normalizedPostState(input.postState);
  const counts = normalizedCounts(input.counts);
  assertSafeCounts(counts);
  assertExactCounts(counts, review.counts);
  if (postState.environmentAdmissionDefaultCount !== counts.environmentCount) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_POST_STATE_INVALID",
      "Not every reviewed deployment environment has the default admission state.",
    );
  }
  const postgresVersionNumber = safeInteger(
    input.postgresVersionNumber,
    "postgresVersionNumber",
  );
  if (postgresVersionNumber !== review.postgresVersionNumber) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_VERSION_DRIFT",
      "The verified Neon PostgreSQL version differs from the reviewed version.",
    );
  }
  const outcome = input.outcome;
  const mutationPerformed = input.mutationPerformed;
  if (
    !["applied", "already_applied", "reconciled"].includes(outcome) ||
    (outcome === "applied" && mutationPerformed !== true) ||
    (outcome === "already_applied" && mutationPerformed !== false) ||
    (outcome === "reconciled" && mutationPerformed !== "unknown")
  ) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_RECEIPT_OUTCOME_INVALID",
      "The migration receipt outcome and mutation state are inconsistent.",
    );
  }
  const clock = clockSample(input);
  const unsigned = Object.freeze({
    schemaVersion: 1 as const,
    intent: "prove_shared_cell_postgres_cutover" as const,
    outcome,
    reviewManifestSha256: review.manifestSha256,
    targetFingerprintSha256,
    postgresVersionNumber,
    databaseObservedAt: clock.databaseObservedAt,
    hostClockStartedAt: clock.hostClockStartedAt,
    hostClockCompletedAt: clock.hostClockCompletedAt,
    clockRoundTripMs: clock.clockRoundTripMs,
    clockSkewMs: clock.clockSkewMs,
    finalMigrations,
    schema,
    postState,
    counts,
    databaseMutationPresent: true as const,
    mutationPerformed,
  });
  return Object.freeze({
    ...unsigned,
    receiptSha256: await sha256Hex(unsigned),
  });
}

export async function validateSharedCellPostgresMigrationReceipt(
  value: unknown,
): Promise<Readonly<SharedCellPostgresMigrationReceipt>> {
  const receipt = record(value) as unknown as SharedCellPostgresMigrationReceipt;
  const keys = [
    "clockRoundTripMs",
    "clockSkewMs",
    "counts",
    "databaseMutationPresent",
    "databaseObservedAt",
    "finalMigrations",
    "hostClockCompletedAt",
    "hostClockStartedAt",
    "intent",
    "mutationPerformed",
    "outcome",
    "postgresVersionNumber",
    "postState",
    "receiptSha256",
    "reviewManifestSha256",
    "schema",
    "schemaVersion",
    "targetFingerprintSha256",
  ] as const;
  if (
    !exactKeys(receipt, keys) ||
    receipt.schemaVersion !== 1 ||
    receipt.intent !== "prove_shared_cell_postgres_cutover" ||
    receipt.databaseMutationPresent !== true ||
    !digestPattern.test(receipt.receiptSha256 ?? "")
  ) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_RECEIPT_INVALID",
      "The migration receipt is malformed.",
    );
  }
  const unsigned = { ...receipt } as Record<string, unknown>;
  delete unsigned.receiptSha256;
  if ((await sha256Hex(unsigned)) !== receipt.receiptSha256) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_RECEIPT_HASH_MISMATCH",
      "The migration receipt hash does not match its canonical contents.",
    );
  }
  digest(receipt.reviewManifestSha256, "review manifest SHA-256");
  digest(receipt.targetFingerprintSha256, "target fingerprint");
  const postgresVersionNumber = safeInteger(
    receipt.postgresVersionNumber,
    "postgresVersionNumber",
  );
  if (postgresVersionNumber < 160_000 || postgresVersionNumber >= 200_000) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_RECEIPT_INVALID",
      "The receipt PostgreSQL version is outside the reviewed range.",
    );
  }
  const finalMigrations = migrations(receipt.finalMigrations, "final");
  if (!sameMigrations(finalMigrations, SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG)) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_RECEIPT_CATALOG_INVALID",
      "The receipt does not contain the exact 0001-0008 catalog.",
    );
  }
  const schema = normalizedSchema(receipt.schema);
  assertPostSchema(schema);
  const postState = normalizedPostState(receipt.postState);
  const counts = normalizedCounts(receipt.counts);
  assertSafeCounts(counts);
  if (postState.environmentAdmissionDefaultCount !== counts.environmentCount) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_APPLY_POST_STATE_INVALID",
      "The receipt does not prove every environment has the default admission state.",
    );
  }
  if (
    (receipt.outcome === "applied" && receipt.mutationPerformed !== true) ||
    (receipt.outcome === "already_applied" && receipt.mutationPerformed !== false) ||
    (receipt.outcome === "reconciled" && receipt.mutationPerformed !== "unknown") ||
    !["applied", "already_applied", "reconciled"].includes(receipt.outcome)
  ) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_RECEIPT_OUTCOME_INVALID",
      "The receipt outcome and mutation state are inconsistent.",
    );
  }
  const clock = clockSample(receipt);
  if (
    receipt.clockRoundTripMs !== clock.clockRoundTripMs ||
    receipt.clockSkewMs !== clock.clockSkewMs
  ) {
    fail(
      "NEON_SHARED_CELL_MIGRATION_RECEIPT_INVALID",
      "The receipt clock derivation is inconsistent.",
    );
  }
  return Object.freeze({
    ...receipt,
    postgresVersionNumber,
    finalMigrations,
    schema,
    postState,
    counts,
  });
}
