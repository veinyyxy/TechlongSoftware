import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeSharedCellPostgresMigrationApply,
  compileSharedCellPostgresMigrationReceipt,
  SHARED_CELL_POSTGRES_CUTOVER_CONSTRAINT_COUNT,
  SHARED_CELL_POSTGRES_CUTOVER_INDEX_COUNT,
  SHARED_CELL_POSTGRES_CUTOVER_TRIGGER_COUNT,
  validateSharedCellPostgresMigrationReceipt,
  type AuthorizeSharedCellPostgresMigrationApplyInput,
  type CompileSharedCellPostgresMigrationReceiptInput,
  type SharedCellPostgresMigrationSchemaProof,
} from "../lib/deployments/execution/neon-shared-cell-migration-apply.ts";
import {
  compileSharedCellPostgresCutoverReview,
  type CompileSharedCellPostgresCutoverReviewInput,
  type SharedCellPostgresCutoverReviewManifest,
} from "../lib/deployments/execution/neon-shared-cell-migration-readiness.ts";

const catalog = [
  [
    "0001_local_auth.sql",
    "c9bc42440c3fb8e71fd6ff8a46d82f19766dd3214c365ae26b34ea0bd56c6d1a",
  ],
  [
    "0002_app_instance_deployment_planning.sql",
    "f7add4988ce35cb04bf5edc6855e7bf615899e6ddd4ea122a2eed025128d69ad",
  ],
  [
    "0003_deployment_execution_foundation.sql",
    "ba1ba68ec2d4a3c85124b1ccdfd3f19188bca84b9f4a9013e70c7727231dd6bd",
  ],
  [
    "0004_aws_sandbox_worker.sql",
    "523e35a9b326367747aba794b6acf3f8790108fef32f3b0a41e77503b6eb242d",
  ],
  [
    "0005_tenant_resource_lifecycle.sql",
    "bd36678d6e6f0030c0254475b6a21be89a1adebea8883b99f2ce2014e9f60e05",
  ],
  [
    "0006_deployment_lease_fencing.sql",
    "b6b48b8d0c298d354909a335cc91205632a6fa28097c0e901e734fb8ebcd0574",
  ],
  [
    "0007_external_ownership_epoch_cleanup_phases.sql",
    "402b083c10f2740c6c3ac8089b0b4d0bf47e26acad4ac0cbc70ec86fa11e1540",
  ],
  [
    "0008_shared_cell_admission_fence.sql",
    "0b8c161c4ba7e9f9cd9154ba9f008ec534b4b8b97023de9b8f8a63f8d2756c90",
  ],
].map(([filename, checksum]) => ({ filename, checksum }));

const counts = {
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
};

const reviewSchema = {
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
};

const preSchema: SharedCellPostgresMigrationSchemaProof = {
  transactionReadOnly: false,
  transactionSerializable: true,
  transactionDeferrable: false,
  searchPathPublic: true,
  schemaMigrationsPresent: true,
  baseEnvironmentTablePresent: true,
  baseJobsTablePresent: true,
  baseCleanupScheduleTablePresent: true,
  tenantResourceTablePresent: false,
  tenantResourceEventTablePresent: false,
  externalOperationTablePresent: false,
  externalOperationEventTablePresent: false,
  cleanupRunTablePresent: false,
  cleanupPhaseTablePresent: false,
  cleanupEventTablePresent: false,
  legacyStepRunAttemptIndexPresent: true,
  leaseTokenColumnPresent: false,
  externalOperationEpochColumnPresent: false,
  admissionStateColumnPresent: false,
  admissionEpochColumnPresent: false,
  admissionFenceColumnPresent: false,
  criticalTriggerCount: 0,
  criticalTriggerEnabledCount: 0,
  criticalIndexCount: 1,
  criticalConstraintCount: 0,
  criticalConstraintValidatedCount: 0,
  cutoverStepRunAttemptIndexPresent: false,
};

const postSchema: SharedCellPostgresMigrationSchemaProof = {
  ...preSchema,
  transactionReadOnly: true,
  transactionDeferrable: true,
  tenantResourceTablePresent: true,
  tenantResourceEventTablePresent: true,
  externalOperationTablePresent: true,
  externalOperationEventTablePresent: true,
  cleanupRunTablePresent: true,
  cleanupPhaseTablePresent: true,
  cleanupEventTablePresent: true,
  leaseTokenColumnPresent: true,
  externalOperationEpochColumnPresent: true,
  admissionStateColumnPresent: true,
  admissionEpochColumnPresent: true,
  admissionFenceColumnPresent: true,
  legacyStepRunAttemptIndexPresent: false,
  cutoverStepRunAttemptIndexPresent: true,
  criticalTriggerCount: SHARED_CELL_POSTGRES_CUTOVER_TRIGGER_COUNT,
  criticalTriggerEnabledCount: SHARED_CELL_POSTGRES_CUTOVER_TRIGGER_COUNT,
  criticalIndexCount: SHARED_CELL_POSTGRES_CUTOVER_INDEX_COUNT,
  criticalConstraintCount: SHARED_CELL_POSTGRES_CUTOVER_CONSTRAINT_COUNT,
  criticalConstraintValidatedCount:
    SHARED_CELL_POSTGRES_CUTOVER_CONSTRAINT_COUNT,
};

async function review(): Promise<SharedCellPostgresCutoverReviewManifest> {
  const input: CompileSharedCellPostgresCutoverReviewInput = {
    targetFingerprintSha256: "9".repeat(64),
    localMigrations: catalog,
    appliedMigrations: catalog.slice(0, 4),
    schema: { ...reviewSchema },
    counts: { ...counts },
    postgresVersionNumber: 180_006,
    databaseObservedAt: "2026-09-09T18:00:00.050Z",
    hostClockStartedAt: "2026-09-09T18:00:00.000Z",
    hostClockCompletedAt: "2026-09-09T18:00:00.100Z",
  };
  return compileSharedCellPostgresCutoverReview(input);
}

async function applyInput(): Promise<AuthorizeSharedCellPostgresMigrationApplyInput> {
  const manifest = await review();
  return {
    reviewManifest: manifest,
    expectedReviewManifestSha256: manifest.manifestSha256,
    targetFingerprintSha256: manifest.targetFingerprintSha256,
    localMigrations: catalog.map((migration) => ({ ...migration })),
    appliedMigrations: catalog.slice(0, 4).map((migration) => ({ ...migration })),
    schema: { ...preSchema },
    counts: { ...counts },
    postgresVersionNumber: 180_006,
    databaseObservedAt: "2026-09-09T18:01:00.050Z",
    hostClockStartedAt: "2026-09-09T18:01:00.000Z",
    hostClockCompletedAt: "2026-09-09T18:01:00.100Z",
  };
}

async function receiptInput(): Promise<CompileSharedCellPostgresMigrationReceiptInput> {
  const manifest = await review();
  return {
    reviewManifest: manifest,
    expectedReviewManifestSha256: manifest.manifestSha256,
    targetFingerprintSha256: manifest.targetFingerprintSha256,
    finalMigrations: catalog.map((migration) => ({ ...migration })),
    schema: { ...postSchema },
    postState: {
      cutoverDataRowCount: 0,
      environmentAdmissionDefaultCount: 1,
      sandboxAdmissionDefaultCount: 1,
    },
    counts: { ...counts },
    postgresVersionNumber: 180_006,
    databaseObservedAt: "2026-09-09T18:02:00.050Z",
    hostClockStartedAt: "2026-09-09T18:02:00.000Z",
    hostClockCompletedAt: "2026-09-09T18:02:00.100Z",
    outcome: "applied",
    mutationPerformed: true,
  };
}

function errorCode(code: string) {
  return (error: unknown) => (error as { code?: string }).code === code;
}

test("authorizes only the exact fresh locked 0005-0008 apply plan", async () => {
  const plan = await authorizeSharedCellPostgresMigrationApply(await applyInput());
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.intent, "apply_reviewed_shared_cell_postgres_cutover");
  assert.deepEqual(
    plan.migrations.map((migration) => migration.filename),
    catalog.slice(4).map((migration) => migration.filename),
  );
  assert.match(plan.planSha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(plan), true);
});

test("rejects manifest, approved digest and target drift", async () => {
  const hash = await applyInput();
  hash.expectedReviewManifestSha256 = "a".repeat(64);
  await assert.rejects(
    authorizeSharedCellPostgresMigrationApply(hash),
    errorCode("NEON_SHARED_CELL_MIGRATION_APPLY_REVIEW_HASH_MISMATCH"),
  );

  const target = await applyInput();
  target.targetFingerprintSha256 = "b".repeat(64);
  await assert.rejects(
    authorizeSharedCellPostgresMigrationApply(target),
    errorCode("NEON_SHARED_CELL_MIGRATION_APPLY_TARGET_MISMATCH"),
  );

  const tampered = await applyInput();
  tampered.reviewManifest = JSON.parse(JSON.stringify(tampered.reviewManifest));
  (tampered.reviewManifest as Record<string, unknown>).clockSkewMs = 1;
  await assert.rejects(
    authorizeSharedCellPostgresMigrationApply(tampered),
    errorCode("NEON_SHARED_CELL_REVIEW_MANIFEST_HASH_MISMATCH"),
  );
});

test("rejects local checksum and locked database catalog drift", async () => {
  const local = await applyInput();
  local.localMigrations = local.localMigrations.map((migration, index) => ({
    ...migration,
    checksum: index === 7 ? "c".repeat(64) : migration.checksum,
  }));
  await assert.rejects(
    authorizeSharedCellPostgresMigrationApply(local),
    errorCode("NEON_SHARED_CELL_MIGRATION_APPLY_LOCAL_DRIFT"),
  );

  const database = await applyInput();
  database.appliedMigrations = database.appliedMigrations.slice(0, 3);
  await assert.rejects(
    authorizeSharedCellPostgresMigrationApply(database),
    errorCode("NEON_SHARED_CELL_MIGRATION_APPLY_DATABASE_DRIFT"),
  );
});

test("rejects an expired review, clock skew and host clock rollback", async () => {
  const expired = await applyInput();
  expired.databaseObservedAt = "2026-09-09T18:16:00.050Z";
  expired.hostClockStartedAt = "2026-09-09T18:16:00.000Z";
  expired.hostClockCompletedAt = "2026-09-09T18:16:00.100Z";
  await assert.rejects(
    authorizeSharedCellPostgresMigrationApply(expired),
    errorCode("NEON_SHARED_CELL_MIGRATION_APPLY_REVIEW_EXPIRED"),
  );

  const skew = await applyInput();
  skew.databaseObservedAt = "2026-09-09T18:01:05.101Z";
  await assert.rejects(
    authorizeSharedCellPostgresMigrationApply(skew),
    errorCode("NEON_SHARED_CELL_MIGRATION_APPLY_CLOCK_SKEW_EXCEEDED"),
  );

  const rollback = await applyInput();
  rollback.databaseObservedAt = "2026-09-09T17:59:59.050Z";
  rollback.hostClockStartedAt = "2026-09-09T17:59:59.000Z";
  rollback.hostClockCompletedAt = "2026-09-09T17:59:59.100Z";
  await assert.rejects(
    authorizeSharedCellPostgresMigrationApply(rollback),
    errorCode("NEON_SHARED_CELL_MIGRATION_APPLY_REVIEW_EXPIRED"),
  );
});

test("rejects write transaction, search path or partial schema drift", async () => {
  for (const mutate of [
    (value: SharedCellPostgresMigrationSchemaProof) => {
      value.transactionReadOnly = true;
    },
    (value: SharedCellPostgresMigrationSchemaProof) => {
      value.transactionSerializable = false;
    },
    (value: SharedCellPostgresMigrationSchemaProof) => {
      value.searchPathPublic = false;
    },
    (value: SharedCellPostgresMigrationSchemaProof) => {
      value.externalOperationEpochColumnPresent = true;
    },
    (value: SharedCellPostgresMigrationSchemaProof) => {
      value.legacyStepRunAttemptIndexPresent = false;
    },
    (value: SharedCellPostgresMigrationSchemaProof) => {
      value.cutoverStepRunAttemptIndexPresent = true;
    },
    (value: SharedCellPostgresMigrationSchemaProof) => {
      value.criticalIndexCount = 0;
    },
  ]) {
    const value = await applyInput();
    mutate(value.schema);
    await assert.rejects(
      authorizeSharedCellPostgresMigrationApply(value),
      errorCode("NEON_SHARED_CELL_MIGRATION_APPLY_PRE_SCHEMA_DRIFT"),
    );
  }
});

test("rejects any activity or hidden 0006 data rewrite drift", async () => {
  for (const key of [
    "runningJobCount",
    "staleNonrunningLeaseCount",
    "leaseExhaustedCleanupRewriteCount",
    "capacityReservationCount",
  ] as const) {
    const value = await applyInput();
    value.counts[key] = 1;
    await assert.rejects(
      authorizeSharedCellPostgresMigrationApply(value),
      errorCode("NEON_SHARED_CELL_MIGRATION_APPLY_ACTIVITY_PRESENT"),
    );
  }

  const historical = await applyInput();
  historical.counts.nonterminalDeploymentCount = 2;
  await assert.rejects(
    authorizeSharedCellPostgresMigrationApply(historical),
    errorCode("NEON_SHARED_CELL_MIGRATION_APPLY_ACTIVITY_DRIFT"),
  );
});

test("compiles an exact applied and verified receipt", async () => {
  const receipt = await compileSharedCellPostgresMigrationReceipt(
    await receiptInput(),
  );
  assert.equal(receipt.outcome, "applied");
  assert.equal(receipt.mutationPerformed, true);
  assert.equal(receipt.databaseMutationPresent, true);
  assert.equal(receipt.finalMigrations.length, 8);
  assert.match(receipt.receiptSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(await validateSharedCellPostgresMigrationReceipt(receipt), receipt);
});

test("requires outcome and mutation semantics to match", async () => {
  const already = await receiptInput();
  already.outcome = "already_applied";
  already.mutationPerformed = false;
  assert.equal(
    (await compileSharedCellPostgresMigrationReceipt(already)).outcome,
    "already_applied",
  );

  const reconciled = await receiptInput();
  reconciled.outcome = "reconciled";
  reconciled.mutationPerformed = "unknown";
  assert.equal(
    (await compileSharedCellPostgresMigrationReceipt(reconciled)).mutationPerformed,
    "unknown",
  );

  const inconsistent = await receiptInput();
  inconsistent.outcome = "applied";
  inconsistent.mutationPerformed = false;
  await assert.rejects(
    compileSharedCellPostgresMigrationReceipt(inconsistent),
    errorCode("NEON_SHARED_CELL_MIGRATION_RECEIPT_OUTCOME_INVALID"),
  );
});

test("rejects partial post schema, disabled triggers and non-empty cutover tables", async () => {
  const missing = await receiptInput();
  missing.schema.externalOperationEpochColumnPresent = false;
  await assert.rejects(
    compileSharedCellPostgresMigrationReceipt(missing),
    errorCode("NEON_SHARED_CELL_MIGRATION_APPLY_POST_SCHEMA_INVALID"),
  );

  const disabled = await receiptInput();
  disabled.schema.criticalTriggerEnabledCount -= 1;
  await assert.rejects(
    compileSharedCellPostgresMigrationReceipt(disabled),
    errorCode("NEON_SHARED_CELL_MIGRATION_APPLY_POST_SCHEMA_INVALID"),
  );

  const missingIndex = await receiptInput();
  missingIndex.schema.criticalIndexCount -= 1;
  await assert.rejects(
    compileSharedCellPostgresMigrationReceipt(missingIndex),
    errorCode("NEON_SHARED_CELL_MIGRATION_APPLY_POST_SCHEMA_INVALID"),
  );

  const legacyIndex = await receiptInput();
  legacyIndex.schema.legacyStepRunAttemptIndexPresent = true;
  await assert.rejects(
    compileSharedCellPostgresMigrationReceipt(legacyIndex),
    errorCode("NEON_SHARED_CELL_MIGRATION_APPLY_POST_SCHEMA_INVALID"),
  );

  const cutoverIndex = await receiptInput();
  cutoverIndex.schema.cutoverStepRunAttemptIndexPresent = false;
  await assert.rejects(
    compileSharedCellPostgresMigrationReceipt(cutoverIndex),
    errorCode("NEON_SHARED_CELL_MIGRATION_APPLY_POST_SCHEMA_INVALID"),
  );

  const invalidConstraint = await receiptInput();
  invalidConstraint.schema.criticalConstraintValidatedCount -= 1;
  await assert.rejects(
    compileSharedCellPostgresMigrationReceipt(invalidConstraint),
    errorCode("NEON_SHARED_CELL_MIGRATION_APPLY_POST_SCHEMA_INVALID"),
  );

  const populated = await receiptInput();
  populated.postState.cutoverDataRowCount = 1;
  await assert.rejects(
    compileSharedCellPostgresMigrationReceipt(populated),
    errorCode("NEON_SHARED_CELL_MIGRATION_APPLY_POST_STATE_INVALID"),
  );

  const nondefaultEnvironment = await receiptInput();
  nondefaultEnvironment.postState.environmentAdmissionDefaultCount = 0;
  await assert.rejects(
    compileSharedCellPostgresMigrationReceipt(nondefaultEnvironment),
    errorCode("NEON_SHARED_CELL_MIGRATION_APPLY_POST_STATE_INVALID"),
  );
});

test("rejects final catalog drift and detects receipt mutation", async () => {
  const catalogDrift = await receiptInput();
  catalogDrift.finalMigrations = catalogDrift.finalMigrations.slice(0, 7);
  await assert.rejects(
    compileSharedCellPostgresMigrationReceipt(catalogDrift),
    errorCode("NEON_SHARED_CELL_MIGRATION_RECEIPT_CATALOG_INVALID"),
  );

  const receipt = await compileSharedCellPostgresMigrationReceipt(
    await receiptInput(),
  );
  const tampered = JSON.parse(JSON.stringify(receipt)) as Record<string, unknown>;
  tampered.clockSkewMs = 1;
  await assert.rejects(
    validateSharedCellPostgresMigrationReceipt(tampered),
    errorCode("NEON_SHARED_CELL_MIGRATION_RECEIPT_HASH_MISMATCH"),
  );
});
