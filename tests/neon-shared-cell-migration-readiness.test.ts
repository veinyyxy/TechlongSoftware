import assert from "node:assert/strict";
import test from "node:test";

import {
  compileSharedCellPostgresCutoverReview,
  SHARED_CELL_POSTGRES_CUTOVER_MIGRATIONS,
  validateSharedCellPostgresCutoverReviewManifest,
  type CompileSharedCellPostgresCutoverReviewInput,
} from "../lib/deployments/execution/neon-shared-cell-migration-readiness.ts";

const localMigrations = [
  {
    filename: "0001_local_auth.sql",
    checksum: "c9bc42440c3fb8e71fd6ff8a46d82f19766dd3214c365ae26b34ea0bd56c6d1a",
  },
  {
    filename: "0002_app_instance_deployment_planning.sql",
    checksum: "f7add4988ce35cb04bf5edc6855e7bf615899e6ddd4ea122a2eed025128d69ad",
  },
  {
    filename: "0003_deployment_execution_foundation.sql",
    checksum: "ba1ba68ec2d4a3c85124b1ccdfd3f19188bca84b9f4a9013e70c7727231dd6bd",
  },
  {
    filename: "0004_aws_sandbox_worker.sql",
    checksum: "523e35a9b326367747aba794b6acf3f8790108fef32f3b0a41e77503b6eb242d",
  },
  {
    filename: "0005_tenant_resource_lifecycle.sql",
    checksum: "bd36678d6e6f0030c0254475b6a21be89a1adebea8883b99f2ce2014e9f60e05",
  },
  {
    filename: "0006_deployment_lease_fencing.sql",
    checksum: "b6b48b8d0c298d354909a335cc91205632a6fa28097c0e901e734fb8ebcd0574",
  },
  {
    filename: "0007_external_ownership_epoch_cleanup_phases.sql",
    checksum: "402b083c10f2740c6c3ac8089b0b4d0bf47e26acad4ac0cbc70ec86fa11e1540",
  },
  {
    filename: "0008_shared_cell_admission_fence.sql",
    checksum: "0b8c161c4ba7e9f9cd9154ba9f008ec534b4b8b97023de9b8f8a63f8d2756c90",
  },
] as const;

function input(): CompileSharedCellPostgresCutoverReviewInput {
  return {
    targetFingerprintSha256: "9".repeat(64),
    localMigrations: localMigrations.map((migration) => ({ ...migration })),
    appliedMigrations: localMigrations
      .slice(0, 4)
      .map((migration) => ({ ...migration })),
    schema: {
      transactionReadOnly: true,
      transactionSerializable: true,
      transactionDeferrable: true,
      schemaMigrationsPresent: true,
      baseEnvironmentTablePresent: true,
      baseJobsTablePresent: true,
      baseCleanupScheduleTablePresent: true,
      tenantResourceTablePresent: false,
      externalOperationTablePresent: false,
      cleanupRunTablePresent: false,
      legacyStepRunAttemptIndexPresent: true,
      leaseTokenColumnPresent: false,
      externalEpochColumnPresent: false,
      admissionStateColumnPresent: false,
    },
    counts: {
      environmentCount: 1,
      sandboxEnvironmentCount: 1,
      applyEnabledEnvironmentCount: 0,
      runningJobCount: 0,
      queuedJobCount: 0,
      runningStepCount: 0,
      nonterminalCleanupScheduleCount: 0,
      staleNonrunningLeaseCount: 0,
      leaseExhaustedCleanupRewriteCount: 0,
      capacityReservationCount: 0,
      nonterminalDeploymentCount: 1,
      reservationCoordinateMismatchCount: 0,
      scheduleCoordinateMismatchCount: 0,
    },
    postgresVersionNumber: 180_006,
    databaseObservedAt: "2026-09-09T18:00:00.050Z",
    hostClockStartedAt: "2026-09-09T18:00:00.000Z",
    hostClockCompletedAt: "2026-09-09T18:00:00.100Z",
  };
}

function errorCode(code: string) {
  return (error: unknown) => (error as { code?: string }).code === code;
}

test("compiles one short-lived hash-bound read-only cutover review", async () => {
  const manifest = await compileSharedCellPostgresCutoverReview(input());
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.intent, "review_shared_cell_postgres_cutover");
  assert.equal(manifest.mutationPerformed, false);
  assert.equal(manifest.clockRoundTripMs, 100);
  assert.equal(manifest.clockSkewMs, 0);
  assert.equal(manifest.reviewExpiresAt, "2026-09-09T18:15:00.100Z");
  assert.deepEqual(
    manifest.pendingMigrations.map((migration) => migration.filename),
    [...SHARED_CELL_POSTGRES_CUTOVER_MIGRATIONS],
  );
  assert.match(manifest.manifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(Object.isFrozen(manifest.pendingMigrations), true);
  assert.equal(Object.isFrozen(manifest.counts), true);
  assert.deepEqual(
    await validateSharedCellPostgresCutoverReviewManifest(manifest),
    manifest,
  );
});

test("rejects an unknown, missing or reordered local migration catalog", async () => {
  for (const mutate of [
    (value: CompileSharedCellPostgresCutoverReviewInput) => {
      value.localMigrations = value.localMigrations.slice(0, -1);
    },
    (value: CompileSharedCellPostgresCutoverReviewInput) => {
      const migrations = value.localMigrations.map((migration) => ({ ...migration }));
      [migrations[6], migrations[7]] = [migrations[7], migrations[6]];
      value.localMigrations = migrations;
    },
    (value: CompileSharedCellPostgresCutoverReviewInput) => {
      value.localMigrations = [
        ...value.localMigrations,
        { filename: "0009_unreviewed.sql", checksum: "a".repeat(64) },
      ];
    },
    (value: CompileSharedCellPostgresCutoverReviewInput) => {
      value.localMigrations = value.localMigrations.map((migration, index) => ({
        ...migration,
        checksum: index === 7 ? "d".repeat(64) : migration.checksum,
      }));
    },
  ]) {
    const value = input();
    mutate(value);
    await assert.rejects(
      compileSharedCellPostgresCutoverReview(value),
      errorCode("NEON_SHARED_CELL_LOCAL_MIGRATION_SET_INVALID"),
    );
  }
});

test("rejects checksum drift, an unknown applied row and a partial cutover", async () => {
  const drift = input();
  drift.appliedMigrations = drift.appliedMigrations.map((migration, index) => ({
    ...migration,
    checksum: index === 2 ? "f".repeat(64) : migration.checksum,
  }));
  await assert.rejects(
    compileSharedCellPostgresCutoverReview(drift),
    errorCode("NEON_SHARED_CELL_APPLIED_MIGRATION_DRIFT"),
  );

  const partial = input();
  partial.appliedMigrations = partial.localMigrations.slice(0, 5);
  await assert.rejects(
    compileSharedCellPostgresCutoverReview(partial),
    errorCode("NEON_SHARED_CELL_APPLIED_MIGRATION_DRIFT"),
  );

  const unknown = input();
  unknown.appliedMigrations = [
    ...unknown.appliedMigrations.slice(0, 3),
    { filename: "0004_unknown.sql", checksum: "e".repeat(64) },
  ];
  await assert.rejects(
    compileSharedCellPostgresCutoverReview(unknown),
    errorCode("NEON_SHARED_CELL_APPLIED_MIGRATION_DRIFT"),
  );
});

test("rejects a missing base object or any partial 0005-0008 schema object", async () => {
  const missing = input();
  missing.schema.baseJobsTablePresent = false;
  await assert.rejects(
    compileSharedCellPostgresCutoverReview(missing),
    errorCode("NEON_SHARED_CELL_BASE_SCHEMA_MISSING"),
  );

  const legacyIndex = input();
  legacyIndex.schema.legacyStepRunAttemptIndexPresent = false;
  await assert.rejects(
    compileSharedCellPostgresCutoverReview(legacyIndex),
    errorCode("NEON_SHARED_CELL_BASE_SCHEMA_MISSING"),
  );

  for (const key of [
    "transactionReadOnly",
    "transactionSerializable",
    "transactionDeferrable",
  ] as const) {
    const unsafeTransaction = input();
    unsafeTransaction.schema[key] = false;
    await assert.rejects(
      compileSharedCellPostgresCutoverReview(unsafeTransaction),
      errorCode("NEON_SHARED_CELL_BASE_SCHEMA_MISSING"),
    );
  }

  for (const key of [
    "tenantResourceTablePresent",
    "externalOperationTablePresent",
    "cleanupRunTablePresent",
    "leaseTokenColumnPresent",
    "externalEpochColumnPresent",
    "admissionStateColumnPresent",
  ] as const) {
    const partial = input();
    partial.schema[key] = true;
    await assert.rejects(
      compileSharedCellPostgresCutoverReview(partial),
      errorCode("NEON_SHARED_CELL_PARTIAL_CUTOVER_SCHEMA"),
    );
  }
});

test("requires the fixed disabled environment and a quiescent worker database", async () => {
  const environment = input();
  environment.counts.sandboxEnvironmentCount = 0;
  await assert.rejects(
    compileSharedCellPostgresCutoverReview(environment),
    errorCode("NEON_SHARED_CELL_ENVIRONMENT_DRIFT"),
  );

  for (const key of [
    "applyEnabledEnvironmentCount",
    "runningJobCount",
    "queuedJobCount",
    "runningStepCount",
    "nonterminalCleanupScheduleCount",
    "staleNonrunningLeaseCount",
    "leaseExhaustedCleanupRewriteCount",
    "capacityReservationCount",
  ] as const) {
    const active = input();
    active.counts[key] = 1;
    await assert.rejects(
      compileSharedCellPostgresCutoverReview(active),
      (error) =>
        (error as { code?: string; retryable?: boolean }).code ===
          "NEON_SHARED_CELL_CUTOVER_ACTIVITY_PRESENT" &&
        (error as { retryable?: boolean }).retryable === true,
    );
  }
});

test("nonterminal historical deployments are reported but do not bypass ownership gates", async () => {
  const value = input();
  value.counts.nonterminalDeploymentCount = 12;
  const manifest = await compileSharedCellPostgresCutoverReview(value);
  assert.equal(manifest.counts.nonterminalDeploymentCount, 12);
  assert.equal(manifest.counts.capacityReservationCount, 0);
});

test("rejects reservation or cleanup-schedule ownership coordinate drift", async () => {
  for (const key of [
    "reservationCoordinateMismatchCount",
    "scheduleCoordinateMismatchCount",
  ] as const) {
    const value = input();
    value.counts[key] = 1;
    await assert.rejects(
      compileSharedCellPostgresCutoverReview(value),
      errorCode("NEON_SHARED_CELL_CUTOVER_COORDINATE_MISMATCH"),
    );
  }
});

test("enforces PostgreSQL compatibility and bounded runtime/database clock drift", async () => {
  const version = input();
  version.postgresVersionNumber = 150_999;
  await assert.rejects(
    compileSharedCellPostgresCutoverReview(version),
    errorCode("NEON_SHARED_CELL_POSTGRES_VERSION_UNSUPPORTED"),
  );

  const slow = input();
  slow.hostClockCompletedAt = "2026-09-09T18:00:10.001Z";
  await assert.rejects(
    compileSharedCellPostgresCutoverReview(slow),
    (error) =>
      (error as { code?: string; retryable?: boolean }).code ===
        "NEON_SHARED_CELL_CLOCK_RTT_EXCEEDED" &&
      (error as { retryable?: boolean }).retryable === true,
  );

  const skewed = input();
  skewed.databaseObservedAt = "2026-09-09T18:00:05.051Z";
  await assert.rejects(
    compileSharedCellPostgresCutoverReview(skewed),
    errorCode("NEON_SHARED_CELL_CLOCK_SKEW_EXCEEDED"),
  );
});

test("rejects extra input fields and non-canonical migration entries", async () => {
  const extra = input() as CompileSharedCellPostgresCutoverReviewInput & {
    databaseUrl?: string;
  };
  extra.databaseUrl = "postgresql://secret";
  await assert.rejects(
    compileSharedCellPostgresCutoverReview(extra),
    errorCode("NEON_SHARED_CELL_MIGRATION_READINESS_INVALID"),
  );

  const migration = input();
  migration.localMigrations = migration.localMigrations.map((item, index) =>
    index === 7 ? { ...item, extra: "unexpected" } : item,
  ) as unknown as CompileSharedCellPostgresCutoverReviewInput["localMigrations"];
  await assert.rejects(
    compileSharedCellPostgresCutoverReview(migration),
    errorCode("NEON_SHARED_CELL_MIGRATION_CATALOG_INVALID"),
  );
});

test("detects any persisted manifest mutation", async () => {
  const manifest = await compileSharedCellPostgresCutoverReview(input());
  const tampered = JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>;
  tampered.clockSkewMs = 1;
  await assert.rejects(
    validateSharedCellPostgresCutoverReviewManifest(tampered),
    errorCode("NEON_SHARED_CELL_REVIEW_MANIFEST_HASH_MISMATCH"),
  );
});
