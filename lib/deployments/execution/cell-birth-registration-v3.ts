import { canonicalJson, sha256Hex } from "./hash.ts";
import { assertCellStackPlanV3, decodeCellStackPlanV3, cellV3Clock, cellV3Exact, cellV3Fail, cellV3Freeze, type CellStackPlanV3 } from "../cloudformation/shared-cell-stack-v3.ts";
import { assertCellStackSnapshotV3, type CellStackSnapshotV3 } from "./aws-sdk-cell-stack-evidence-v3.ts";
import { decodeCellBirthDelegationV3, type CellBirthDelegationV3 } from "./cell-birth-lifecycle-v3.ts";

export const CELL_BIRTH_REGISTRATION_KEY_V3 = "cell-birth-v3:cell:cell-sandbox-1" as const;
export const CELL_BIRTH_COORDINATOR_ROLE_V3 = "arn:aws:iam::402010193138:role/TechlongSandboxCellLifecycleCoordinatorRoleV3" as const;
const digest = /^[a-f0-9]{64}$/;
const reviews = new WeakSet<object>();
const scope = Object.freeze({ beginAdmissionDrainOnce: true, issueCleanupAuthority: false, invokeTtlExecutor: false, deleteFailedBirth: false,
  createOrUpdateStack: false, enableTenantRuntime: false, resetReplaceOrRetrySlot: false });

/** First executable scope is deliberately narrower than the data-only parent
 * delegation. A cold decoder or delegation hash is NOT an installed approval. */
export async function prepareCellBirthRegistrationReviewV3(input: { plan: CellStackPlanV3; delegation: CellBirthDelegationV3; reserved: CellStackSnapshotV3; now: number }) {
  if (!cellV3Exact(input, ["plan", "delegation", "reserved", "now"])) cellV3Fail("CELL_BIRTH_REGISTRATION_INPUT_INVALID");
  assertCellStackPlanV3(input.plan); assertCellStackSnapshotV3(input.reserved); cellV3Clock(input.now);
  const p = input.plan, d = await decodeCellBirthDelegationV3(input.delegation, p), r = input.reserved;
  if (r.phase !== "RESERVED" || !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(r.stackStatus) || r.resources.length || r.failedCreationOrPhase ||
    r.stackId !== d.stackId || r.birthIntentSha256 !== p.birthIntentSha256 || r.templateCanonicalSha256 !== p.templateCanonicalSha256 ||
    r.observedAt > input.now || input.now - r.observedAt > 30000 || input.now < d.notBefore || input.now >= Date.parse(d.cellExpiresAt)) cellV3Fail("CELL_BIRTH_REGISTRATION_RESERVED_PROOF_REQUIRED");
  const manifest = cellV3Freeze({ schemaVersion: 3 as const, protocol: "cell-birth-drain-registration-review-v3" as const, authorityKey: CELL_BIRTH_REGISTRATION_KEY_V3,
    plan: p, delegation: d, reservedEvidenceSha256: await sha256Hex(r), reservedObservedAt: r.observedAt, reviewedAt: input.now,
    expiresAt: Math.min(input.now + 900000, Date.parse(d.cellExpiresAt)), scope,
    risks: { permanentSlot: true, crossServiceNonAtomic: true, noAutomaticWriteRetryOrCompensation: true, iamAndCodeInstallationSeparatelyApproved: true,
      downstreamDrainMayWriteControlDatabase: true, returnedDrainIsNotCertifiedZeroOrDeletionProof: true, nonzeroCost: true } });
  const review = cellV3Freeze({ manifest, manifestSha256: await sha256Hex(manifest), registrationAuthorized: false, runtimeEnabled: false }); reviews.add(review); return review;
}
export type CellBirthRegistrationReviewV3 = Awaited<ReturnType<typeof prepareCellBirthRegistrationReviewV3>>;
export async function approveCellBirthRegistrationV3(input: { review: CellBirthRegistrationReviewV3; approvedManifestSha256: string; now: number }) {
  if (!cellV3Exact(input, ["review", "approvedManifestSha256", "now"]) || !reviews.has(input.review) || input.approvedManifestSha256 !== input.review.manifestSha256)
    cellV3Fail("CELL_BIRTH_FRESH_REGISTRATION_APPROVAL_REQUIRED");
  cellV3Clock(input.now); const m = input.review.manifest;
  if (input.now < m.reviewedAt || input.now >= m.expiresAt) cellV3Fail("CELL_BIRTH_REGISTRATION_REVIEW_EXPIRED");
  const record = { schemaVersion: 3 as const, protocol: "approved-cell-birth-drain-registration-v3" as const, manifest: m,
    approvedManifestSha256: input.approvedManifestSha256, approvedAt: input.now };
  return cellV3Freeze({ ...record, registrationSha256: await sha256Hex(record) });
}
export type CellBirthRegistrationV3 = Awaited<ReturnType<typeof approveCellBirthRegistrationV3>>;

/** Structural decoding only. The live strong reader in the SDK module brands
 * the actual stored item; callers cannot use JSON copies as approval proof. */
export async function decodeCellBirthRegistrationV3(value: unknown): Promise<Readonly<CellBirthRegistrationV3>> {
  let r: CellBirthRegistrationV3;
  try { r = JSON.parse(canonicalJson(value)); } catch { return cellV3Fail("CELL_BIRTH_REGISTRATION_JSON_INVALID"); }
  if (!cellV3Exact(r, ["schemaVersion", "protocol", "manifest", "approvedManifestSha256", "approvedAt", "registrationSha256"]) ||
    r.schemaVersion !== 3 || r.protocol !== "approved-cell-birth-drain-registration-v3" || !digest.test(r.approvedManifestSha256) || !digest.test(r.registrationSha256)) cellV3Fail("CELL_BIRTH_REGISTRATION_RECORD_INVALID");
  const m = r.manifest;
  if (!cellV3Exact(m, ["schemaVersion", "protocol", "authorityKey", "plan", "delegation", "reservedEvidenceSha256", "reservedObservedAt", "reviewedAt", "expiresAt", "scope", "risks"]) ||
    m.schemaVersion !== 3 || m.protocol !== "cell-birth-drain-registration-review-v3" || m.authorityKey !== CELL_BIRTH_REGISTRATION_KEY_V3 ||
    !digest.test(m.reservedEvidenceSha256) || canonicalJson(m.scope) !== canonicalJson(scope) ||
    canonicalJson(m.risks) !== canonicalJson({ permanentSlot: true, crossServiceNonAtomic: true, noAutomaticWriteRetryOrCompensation: true, iamAndCodeInstallationSeparatelyApproved: true,
      downstreamDrainMayWriteControlDatabase: true, returnedDrainIsNotCertifiedZeroOrDeletionProof: true, nonzeroCost: true })) cellV3Fail("CELL_BIRTH_REGISTRATION_SCOPE_INVALID");
  const plan = await decodeCellStackPlanV3(m.plan), d = await decodeCellBirthDelegationV3(m.delegation, plan);
  [m.reservedObservedAt, m.reviewedAt, m.expiresAt, r.approvedAt].forEach(cellV3Clock);
  if (m.reservedObservedAt > m.reviewedAt || m.reviewedAt - m.reservedObservedAt > 30000 || m.reviewedAt < d.notBefore || m.reviewedAt >= Date.parse(d.cellExpiresAt) ||
    m.expiresAt !== Math.min(m.reviewedAt + 900000, Date.parse(d.cellExpiresAt)) || r.approvedAt < m.reviewedAt || r.approvedAt >= m.expiresAt ||
    await sha256Hex(m) !== r.approvedManifestSha256) cellV3Fail("CELL_BIRTH_REGISTRATION_HASH_OR_CLOCK_INVALID");
  const { registrationSha256, ...body } = r; if (await sha256Hex(body) !== registrationSha256) cellV3Fail("CELL_BIRTH_REGISTRATION_HASH_INVALID");
  return cellV3Freeze({ ...r, manifest: { ...m, plan, delegation: d } });
}

export function assertCellBirthRegistrationWindowV3(record: CellBirthRegistrationV3, now: number) {
  cellV3Clock(now); const d = record.manifest.delegation;
  if (now < record.approvedAt || now < d.notBefore || now >= d.notAfter) cellV3Fail("CELL_BIRTH_REGISTRATION_WINDOW_INVALID");
}
