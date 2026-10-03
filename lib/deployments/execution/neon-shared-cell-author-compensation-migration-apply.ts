import { canonicalJson, sha256Hex } from "./hash.ts";
import {
  validateSharedCellAuthorCompensationMigrationReview,
  SHARED_CELL_AUTHOR_COMPENSATION_MIGRATION_SUFFIX,
  type SharedCellAuthorCompensationMigrationReview,
} from "./neon-shared-cell-author-compensation-migration-review.ts";
import { SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG,
  SHARED_CELL_POSTGRES_CUTOVER_MAX_CLOCK_RTT_MS, SHARED_CELL_POSTGRES_CUTOVER_MAX_CLOCK_SKEW_MS,
  type SharedCellPostgresMigrationDigest, type SharedCellPostgresCutoverCounts,
} from "./neon-shared-cell-migration-readiness.ts";
import type { SharedCellPostgresMigrationSchemaProof, SharedCellPostgresMigrationPostStateProof } from "./neon-shared-cell-migration-apply.ts";

export const COMPENSATION_MIGRATION_APPLY_DEFAULT_ENABLED = false;
// PostgreSQL 18.3 / PGlite 0.5.8, exact sealed 0009 then 0010; excludes OIDs/owners and PG18 NOT NULL constraint names.
export const COMPENSATION_MIGRATION_SCHEMA_SHA256 = "d31d72e398658677bc483fbbd261de9d5ae59d0b89f31f8e436bf448921a3631";
export const COMPENSATION_MIGRATION_FINAL_CATALOG = Object.freeze([
  ...SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG, ...SHARED_CELL_AUTHOR_COMPENSATION_MIGRATION_SUFFIX,
]);
export const COMPENSATION_MIGRATION_EMPTY_SCHEMA = Object.freeze(Object.fromEntries(
  ["objects", "relations", "columns", "constraints", "indexes", "triggers", "functions"].map((key) => [key, Object.freeze([])]),
));
export interface CompensationMigrationObservation {
  appliedMigrations: readonly SharedCellPostgresMigrationDigest[];
  schema: SharedCellPostgresMigrationSchemaProof;
  counts: SharedCellPostgresCutoverCounts;
  postState: SharedCellPostgresMigrationPostStateProof;
  postgresVersionNumber: number;
  databaseObservedAt: string;
  hostClockStartedAt: string;
  hostClockCompletedAt: string;
  compensationSchema: Record<string, readonly Record<string, unknown>[]>;
  compensationRowCount: number;
}
export type CompensationMigrationMutation = boolean | "unknown";
export class CompensationMigrationApplyError extends Error {
  readonly code: string;
  readonly mutationPerformed: CompensationMigrationMutation;
  constructor(code: string, mutationPerformed: CompensationMigrationMutation = false) {
    super("The reviewed compensation migration operation failed closed; provider details are withheld.");
    this.code = code; this.mutationPerformed = mutationPerformed;
  }
}
function fail(code: string): never { throw new CompensationMigrationApplyError(`COMPENSATION_MIGRATION_${code}`); }
function same(actual: unknown, expected: unknown, label: string) {
  if (canonicalJson(actual) !== canonicalJson(expected)) fail(`${label}_DRIFT`);
}
function exact(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("EVIDENCE_INVALID");
  same(Object.keys(value).sort(), [...keys].sort(), "EVIDENCE_FIELDS");
}
function immutable<T>(value: T): Readonly<T> {
  const cloned = JSON.parse(canonicalJson(value)) as T;
  function freeze(item: unknown) {
    if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); }
  }
  freeze(cloned); return cloned;
}
function instant(value: string) {
  const result = Date.parse(value);
  if (!Number.isFinite(result) || new Date(result).toISOString() !== value) fail("CLOCK_INVALID");
  return result;
}
export async function reviewedCompensationMigration(value: unknown, expectedSha256: string) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) fail("REVIEW_DIGEST_INVALID");
  const review = await validateSharedCellAuthorCompensationMigrationReview(value);
  if (review.manifestSha256 !== expectedSha256) fail("REVIEW_DIGEST_MISMATCH");
  return review;
}
export function assertCompensationMigrationReviewFresh(review: SharedCellAuthorCompensationMigrationReview, now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < instant(review.evidence.hostClockCompletedAt) || now >= instant(review.reviewExpiresAt)) fail("REVIEW_EXPIRED");
}
const observationKeys = ["appliedMigrations", "schema", "counts", "postState", "postgresVersionNumber", "databaseObservedAt", "hostClockStartedAt", "hostClockCompletedAt", "compensationSchema", "compensationRowCount"];
export async function validateCompensationMigrationObservation(review: SharedCellAuthorCompensationMigrationReview,
  observation: CompensationMigrationObservation, mode: "locked" | "read-only", state: "before" | "after", fresh: boolean) {
  exact(observation, observationKeys);
  const started = instant(observation.hostClockStartedAt), completed = instant(observation.hostClockCompletedAt), dbAt = instant(observation.databaseObservedAt);
  const rtt = completed - started, skew = Math.abs(dbAt - Math.floor((started + completed) / 2));
  if (rtt < 0 || rtt > SHARED_CELL_POSTGRES_CUTOVER_MAX_CLOCK_RTT_MS || skew > SHARED_CELL_POSTGRES_CUTOVER_MAX_CLOCK_SKEW_MS ||
      completed < instant(review.evidence.hostClockCompletedAt) || dbAt < instant(review.evidence.databaseObservedAt)) fail("CLOCK_DRIFT");
  if (fresh) { assertCompensationMigrationReviewFresh(review, completed); if (dbAt >= instant(review.reviewExpiresAt)) fail("REVIEW_EXPIRED"); }
  same(observation.schema, { ...review.evidence.schema, transactionReadOnly: mode === "read-only", transactionDeferrable: mode === "read-only" }, "SEALED_SCHEMA");
  same(observation.counts, review.evidence.counts, "QUIESCENCE");
  same(observation.postState, review.evidence.postState, "ADMISSION_AND_CUTOVER_DATA");
  same(observation.postgresVersionNumber, review.evidence.postgresVersionNumber, "VERSION");
  if (observation.compensationRowCount !== 0) fail("COMPENSATION_DATA_PRESENT");
  same(observation.appliedMigrations, state === "before" ? SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG : COMPENSATION_MIGRATION_FINAL_CATALOG, "CATALOG");
  if (state === "before") same(observation.compensationSchema, COMPENSATION_MIGRATION_EMPTY_SCHEMA, "NAMESPACE_ABSENCE");
  else if (await sha256Hex(observation.compensationSchema) !== COMPENSATION_MIGRATION_SCHEMA_SHA256) fail("COMPENSATION_SCHEMA_DRIFT");
  return immutable(observation);
}
export async function authorizeCompensationMigrationApply(input: {
  review: unknown; expectedReviewSha256: string; targetFingerprintSha256: string;
  localMigrations: readonly SharedCellPostgresMigrationDigest[]; observation: CompensationMigrationObservation;
}) {
  exact(input, ["review", "expectedReviewSha256", "targetFingerprintSha256", "localMigrations", "observation"]);
  const review = await reviewedCompensationMigration(input.review, input.expectedReviewSha256);
  same(input.targetFingerprintSha256, review.evidence.targetFingerprintSha256, "TARGET");
  same(input.localMigrations, COMPENSATION_MIGRATION_FINAL_CATALOG, "LOCAL_CATALOG");
  const observed = await validateCompensationMigrationObservation(review, input.observation, "locked", "before", true);
  const body = { schemaVersion: 1, stage: "B5-J5g-j7", intent: "apply_reviewed_compensation_migrations",
    reviewManifestSha256: review.manifestSha256, targetFingerprintSha256: input.targetFingerprintSha256,
    predecessorReceiptSha256: review.predecessorReceiptSha256, migrations: SHARED_CELL_AUTHOR_COMPENSATION_MIGRATION_SUFFIX,
    expectedPostSchemaSha256: COMPENSATION_MIGRATION_SCHEMA_SHA256, authorizedAt: observed.hostClockCompletedAt };
  return immutable({ ...body, planSha256: await sha256Hex(body) });
}
export type CompensationMigrationOutcome = "APPLIED" | "RECONCILED_APPLIED" | "RECOVERED_APPLIED" | "RECOVERED_NOT_APPLIED";
export async function compileCompensationMigrationReceipt(input: {
  review: unknown; expectedReviewSha256: string; targetFingerprintSha256: string;
  observation: CompensationMigrationObservation; outcome: CompensationMigrationOutcome;
  mutationPerformed: CompensationMigrationMutation;
}) {
  exact(input, ["review", "expectedReviewSha256", "targetFingerprintSha256", "observation", "outcome", "mutationPerformed"]);
  const review = await reviewedCompensationMigration(input.review, input.expectedReviewSha256);
  same(input.targetFingerprintSha256, review.evidence.targetFingerprintSha256, "TARGET");
  const states = { APPLIED: true, RECONCILED_APPLIED: "unknown", RECOVERED_APPLIED: false, RECOVERED_NOT_APPLIED: false } as const;
  if (!Object.hasOwn(states, input.outcome) || states[input.outcome] !== input.mutationPerformed) fail("OUTCOME_INVALID");
  const state = input.outcome === "RECOVERED_NOT_APPLIED" ? "before" : "after";
  const observation = await validateCompensationMigrationObservation(review, input.observation, "read-only", state, false);
  const body = { schemaVersion: 1, stage: "B5-J5g-j7", intent: "prove_compensation_migration_state",
    reviewManifestSha256: review.manifestSha256, predecessorReceiptSha256: review.predecessorReceiptSha256,
    targetFingerprintSha256: input.targetFingerprintSha256, observation, outcome: input.outcome,
    databaseMutationPresent: state === "after", mutationPerformed: input.mutationPerformed,
    runtimeEnabled: false, cloudApplyEnabled: false };
  return immutable({ ...body, receiptSha256: await sha256Hex(body) });
}
export async function validateCompensationMigrationReceipt(value: unknown, review: unknown, expectedReviewSha256: string) {
  exact(value, ["schemaVersion", "stage", "intent", "reviewManifestSha256", "predecessorReceiptSha256", "targetFingerprintSha256",
    "observation", "outcome", "databaseMutationPresent", "mutationPerformed", "runtimeEnabled", "cloudApplyEnabled", "receiptSha256"]);
  const receipt = value as Awaited<ReturnType<typeof compileCompensationMigrationReceipt>>;
  const expected = await compileCompensationMigrationReceipt({ review, expectedReviewSha256,
    targetFingerprintSha256: receipt.targetFingerprintSha256, observation: receipt.observation,
    outcome: receipt.outcome, mutationPerformed: receipt.mutationPerformed });
  same(receipt, expected, "RECEIPT");
  return expected;
}
