import { canonicalJson, sha256Hex } from "./hash.ts";
import {
  SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG,
  SHARED_CELL_POSTGRES_CUTOVER_MAX_CLOCK_RTT_MS,
  SHARED_CELL_POSTGRES_CUTOVER_MAX_CLOCK_SKEW_MS,
  SHARED_CELL_POSTGRES_CUTOVER_MAX_REVIEW_AGE_MS,
  type SharedCellPostgresMigrationDigest,
} from "./neon-shared-cell-migration-readiness.ts";
import {
  validateSharedCellPostgresMigrationReceipt,
  type SharedCellPostgresMigrationSchemaProof,
  type SharedCellPostgresMigrationPostStateProof,
} from "./neon-shared-cell-migration-apply.ts";
import type { SharedCellPostgresCutoverCounts } from "./neon-shared-cell-migration-readiness.ts";

export const SHARED_CELL_AUTHOR_COMPENSATION_MIGRATION_REVIEW_DEFAULT_ENABLED = false;
export const SHARED_CELL_AUTHOR_COMPENSATION_PREDECESSOR_RECEIPT_SHA256 =
  "5a8ac632c925fe7950a018f8dd1d12c1d5ac49ea7d82c2d0c3eac97d32936d06";
export const SHARED_CELL_AUTHOR_COMPENSATION_MIGRATION_SUFFIX = Object.freeze([
  Object.freeze({ filename: "0009_shared_cell_author_compensation_persistence.sql", checksum: "fc17718d26a2bdb1ee10d2ca54ea6e11c2a6f1c64aa39a082bfc6ceb43079394" }),
  Object.freeze({ filename: "0010_shared_cell_author_compensation_grant_lifecycle.sql", checksum: "f5005980f85eda69d92e1774150fcdeafba3411355694aa7714096eb8a5b5c86" }),
]);

export interface SharedCellAuthorCompensationMigrationReviewInput {
  predecessorReceipt: unknown;
  targetFingerprintSha256: string;
  localMigrations: readonly SharedCellPostgresMigrationDigest[];
  appliedMigrations: readonly SharedCellPostgresMigrationDigest[];
  schema: SharedCellPostgresMigrationSchemaProof;
  counts: SharedCellPostgresCutoverCounts;
  postState: SharedCellPostgresMigrationPostStateProof;
  compensationObjects: readonly unknown[];
  postgresVersionNumber: number;
  databaseObservedAt: string;
  hostClockStartedAt: string;
  hostClockCompletedAt: string;
}

export class SharedCellAuthorCompensationMigrationReviewError extends Error {
  readonly code = "SHARED_CELL_AUTHOR_COMPENSATION_MIGRATION_REVIEW_INVALID";
}
function fail(message: string): never { throw new SharedCellAuthorCompensationMigrationReviewError(message); }
function exact(value: unknown, keys: readonly string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) fail("Review evidence contains missing or unexpected fields.");
}
function same(actual: unknown, expected: unknown, label: string): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) fail(`${label} drifted from the sealed predecessor.`);
}
function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail("Clock evidence must be canonical UTC with milliseconds.");
  return parsed;
}
function immutable<T>(value: T): Readonly<T> {
  const clone = JSON.parse(canonicalJson(value)) as T;
  const freeze = (item: unknown): void => {
    if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); }
  };
  freeze(clone);
  return clone;
}
const inputKeys = ["predecessorReceipt", "targetFingerprintSha256", "localMigrations", "appliedMigrations", "schema", "counts", "postState", "compensationObjects", "postgresVersionNumber", "databaseObservedAt", "hostClockStartedAt", "hostClockCompletedAt"];

/** New review only: never extends the sealed J5g-e2 receipt or authorizes DDL. */
export async function compileSharedCellAuthorCompensationMigrationReview(input: SharedCellAuthorCompensationMigrationReviewInput) {
  exact(input, inputKeys);
  const evidence = immutable(input);
  const predecessor = await validateSharedCellPostgresMigrationReceipt(evidence.predecessorReceipt);
  if (predecessor.receiptSha256 !== SHARED_CELL_AUTHOR_COMPENSATION_PREDECESSOR_RECEIPT_SHA256) fail("The exact independently verified J5g-e2 receipt is required.");
  if (evidence.targetFingerprintSha256 !== predecessor.targetFingerprintSha256) fail("The Neon target differs from the sealed predecessor.");
  same(evidence.localMigrations, [...SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG, ...SHARED_CELL_AUTHOR_COMPENSATION_MIGRATION_SUFFIX], "Local 0001-0010 catalog");
  same(evidence.appliedMigrations, SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG, "Applied 0001-0008 catalog");
  same(evidence.schema, predecessor.schema, "Read-only transaction and critical schema proof");
  same(evidence.counts, predecessor.counts, "Quiescent activity/ownership counters");
  same(evidence.postState, predecessor.postState, "Empty cutover tables and default admission state");
  same(evidence.compensationObjects, [], "Compensation namespace absence");
  if (!Number.isSafeInteger(evidence.postgresVersionNumber) || evidence.postgresVersionNumber < predecessor.postgresVersionNumber ||
      Math.floor(evidence.postgresVersionNumber / 10_000) !== Math.floor(predecessor.postgresVersionNumber / 10_000)) fail("PostgreSQL changed outside the predecessor major version or regressed.");
  const startedAt = instant(evidence.hostClockStartedAt), completedAt = instant(evidence.hostClockCompletedAt), dbAt = instant(evidence.databaseObservedAt);
  const clockRoundTripMs = completedAt - startedAt;
  const clockSkewMs = Math.abs(dbAt - Math.floor((startedAt + completedAt) / 2));
  if (clockRoundTripMs < 0 || clockRoundTripMs > SHARED_CELL_POSTGRES_CUTOVER_MAX_CLOCK_RTT_MS || clockSkewMs > SHARED_CELL_POSTGRES_CUTOVER_MAX_CLOCK_SKEW_MS || dbAt <= instant(predecessor.databaseObservedAt)) fail("Fresh database/host clock bounds were not proved.");
  const body = { schemaVersion: 1 as const, stage: "B5-J5g-j6" as const,
    intent: "review_shared_cell_author_compensation_migrations" as const,
    predecessorReceiptSha256: predecessor.receiptSha256, evidence,
    pendingMigrations: SHARED_CELL_AUTHOR_COMPENSATION_MIGRATION_SUFFIX,
    clockRoundTripMs, clockSkewMs,
    reviewExpiresAt: new Date(completedAt + SHARED_CELL_POSTGRES_CUTOVER_MAX_REVIEW_AGE_MS).toISOString(),
    readiness: "READY_FOR_SEPARATE_WRITE_REVIEW" as const,
    applyEnabled: false as const, mutationPerformed: false as const };
  return immutable({ ...body, manifestSha256: await sha256Hex(canonicalJson(body)) });
}

export type SharedCellAuthorCompensationMigrationReview = Awaited<ReturnType<typeof compileSharedCellAuthorCompensationMigrationReview>>;
export async function validateSharedCellAuthorCompensationMigrationReview(value: unknown): Promise<SharedCellAuthorCompensationMigrationReview> {
  exact(value, ["schemaVersion", "stage", "intent", "predecessorReceiptSha256", "evidence", "pendingMigrations", "clockRoundTripMs", "clockSkewMs", "reviewExpiresAt", "readiness", "applyEnabled", "mutationPerformed", "manifestSha256"]);
  const manifest = value as SharedCellAuthorCompensationMigrationReview;
  const expected = await compileSharedCellAuthorCompensationMigrationReview(manifest.evidence);
  same(manifest, expected, "New migration review manifest");
  return expected;
}
