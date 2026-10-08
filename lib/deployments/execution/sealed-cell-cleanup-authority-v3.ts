import { canonicalJson, sha256Hex } from "./hash.ts";
import { compileSharedCellAdmissionDrainIntent } from "./shared-cell-admission-fence.ts";
import { isPreparedSealedCellCleanupAuthorityV3, type PreparedSealedCellCleanupAuthorityV3,
  type sealedCellOwnershipStateV3 } from "./sealed-cell-cleanup-evidence-v3.ts";
import type { SealedPlanCertificateV1 } from "./neon-sealed-cell-ownership-source-v3.ts";

export const SEALED_CELL_AUTHORITY_KEY_V3 = "sealed-cell-ttl-v3:cell:cell-sandbox-1" as const;
export const SEALED_CELL_EXECUTOR_ROLE_V3 = "arn:aws:iam::402010193138:role/TechlongSandboxCellTtlExecutorRole" as const;
export const SEALED_CELL_EXECUTOR_PROTOCOL_V3 = "dedicated-cell-ttl-v3" as const;
export type SealedOwnershipStateV3 = ReturnType<typeof sealedCellOwnershipStateV3>;
const digest = /^[a-f0-9]{64}$/;
const identifier = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/;
const target = "dep_d00144511731f1c20991aa56", instance = "app_fb1962e93a9a4cc2acf046170593d9e3";
const environment = "env_aws_sandbox_ca_central_1";
const certKeys = ["deployment_id", "environment_id", "app_instance_id", "original_row_sha256", "original_plan_bytes_sha256", "original_plan_hash",
  "business_state_sha256", "approved_registration_sha256", "protection_schema_sha256", "sealed_at"];
const stateKeys = ["schemaVersion", "protocol", "accountId", "region", "cellId", "environmentId", "admissionState", "admissionEpoch",
  "admissionFenceSha256", "admissionProvisionOperationHash", "admissionStackId", "admissionCellExpiresAt", "admissionChangedAt", "sealedCertificates",
  "fingerprintFunctionBodySha256", "activeTenantIds", "activeCapacityReservationIds", "nonterminalDeploymentIds", "liveTenantResourceIds",
  "nonterminalTenantCleanupScheduleIds", "rawOwnershipWitness"];
const candidateKeys = ["schemaVersion", "protocol", "authorityKey", "state", "executorRoleArn", "executorIdentityProtocol", "predecessor", "stackEvidence",
  "ownershipState", "ownershipStateSha256", "cleanupEpoch", "revision", "cleanupMarker", "reviewedAt", "expiresAt",
  "runtimeActivationAuthorized", "authorityInstallationAuthorized", "recordSha256"];

export class SealedCellAuthorityErrorV3 extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
export function sealedV3Fail(code: string): never { throw new SealedCellAuthorityErrorV3(code); }
export function sealedV3Keys(v: unknown, names: readonly string[]): boolean {
  return v !== null && typeof v === "object" && !Array.isArray(v) && canonicalJson(Object.keys(v).sort()) === canonicalJson([...names].sort());
}
export function sealedV3Freeze<T>(v: T): T {
  if (v !== null && typeof v === "object") { Object.values(v).forEach(sealedV3Freeze); Object.freeze(v); } return v;
}
function clone<T>(v: T): T { try { return JSON.parse(canonicalJson(v)); } catch { return sealedV3Fail("SEALED_V3_JSON_INVALID"); } }
function positive(n: unknown): n is number { return typeof n === "number" && Number.isSafeInteger(n) && n > 0; }
function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 10000 || value.some(v => typeof v !== "string" || !identifier.test(v)) ||
    new Set(value).size !== value.length || canonicalJson(value) !== canonicalJson([...value].sort())) sealedV3Fail("SEALED_V3_IDS_INVALID"); return value;
}
export function validateSealedCertificateV3(value: unknown): Readonly<SealedPlanCertificateV1> {
  const c = clone(value) as SealedPlanCertificateV1;
  if (!sealedV3Keys(c, certKeys) || c.deployment_id !== target || c.app_instance_id !== instance || c.environment_id !== environment ||
    certKeys.filter(k => k.endsWith("sha256") || k === "original_plan_hash").some(k => !digest.test(String(c[k as keyof typeof c]))) || !positive(c.sealed_at))
    sealedV3Fail("SEALED_V3_CERTIFICATE_INVALID"); return sealedV3Freeze(c);
}

/** Structural durable decoder; live freshness still requires the branded source's new DB read. */
export async function validateSealedOwnershipStateV3(value: unknown, expectedCertificateSha256: string): Promise<Readonly<SealedOwnershipStateV3>> {
  const s = clone(value) as SealedOwnershipStateV3;
  if (!digest.test(expectedCertificateSha256) || !sealedV3Keys(s, stateKeys) || s.schemaVersion !== 3 || s.protocol !== "sealed-cell-ownership-v3" ||
    s.accountId !== "402010193138" || s.region !== "ca-central-1" || s.cellId !== "cell-sandbox-1" || s.environmentId !== environment ||
    s.admissionState !== "draining" || !positive(s.admissionEpoch) || !positive(s.admissionCellExpiresAt) || !positive(s.admissionChangedAt) ||
    s.admissionChangedAt < s.admissionCellExpiresAt || !digest.test(s.admissionFenceSha256) || !digest.test(s.admissionProvisionOperationHash) ||
    !/^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s.admissionStackId) ||
    s.fingerprintFunctionBodySha256 !== "16e82ac1c8b9589a332cd64dbd93f4b197c5062a9c655c7b0f5d88b1302d8e66" ||
    !Array.isArray(s.sealedCertificates) || s.sealedCertificates.length !== 1) sealedV3Fail("SEALED_V3_OWNERSHIP_INVALID");
  const cert = validateSealedCertificateV3(s.sealedCertificates[0]);
  if (await sha256Hex(cert) !== expectedCertificateSha256) sealedV3Fail("SEALED_V3_CERTIFICATE_PIN_MISMATCH");
  const lists = [s.activeTenantIds, s.activeCapacityReservationIds, s.nonterminalDeploymentIds, s.liveTenantResourceIds, s.nonterminalTenantCleanupScheduleIds];
  if (lists.some(v => ids(v).length !== 0)) sealedV3Fail("SEALED_V3_NOT_ZERO");
  const raw = s.rawOwnershipWitness;
  if (!sealedV3Keys(raw, ["activeTenantIds", "nonterminalDeploymentIds", "activeTenantDeploymentAssociations"]) ||
    canonicalJson(ids(raw.nonterminalDeploymentIds)) !== canonicalJson([target]) || !Array.isArray(raw.activeTenantDeploymentAssociations) ||
    raw.activeTenantDeploymentAssociations.length > 10000) sealedV3Fail("SEALED_V3_RAW_WITNESS_INVALID");
  const active = ids(raw.activeTenantIds), associations = raw.activeTenantDeploymentAssociations;
  // At zero there can only be the sealed original association, or no active association.
  if (active.some(i => i !== instance) || associations.some(a => !sealedV3Keys(a, ["instance_id", "deployment_id"]) ||
    a.instance_id !== instance || a.deployment_id !== target) || associations.length !== active.length ||
    canonicalJson(active) !== canonicalJson(associations.map(a => a.instance_id))) sealedV3Fail("SEALED_V3_RAW_WITNESS_INVALID");
  return sealedV3Freeze(s);
}

export async function validatePreparedSealedCandidateV3(value: unknown, certificateSha256: string) {
  const c = clone(value) as PreparedSealedCellCleanupAuthorityV3;
  if (!sealedV3Keys(c, candidateKeys) || c.schemaVersion !== 3 || c.protocol !== "sealed-cell-cleanup-authority-v3" ||
    c.authorityKey !== SEALED_CELL_AUTHORITY_KEY_V3 || c.state !== "prepared_cleanup_authority" || c.executorRoleArn !== SEALED_CELL_EXECUTOR_ROLE_V3 ||
    c.executorIdentityProtocol !== SEALED_CELL_EXECUTOR_PROTOCOL_V3 || c.runtimeActivationAuthorized !== false || c.authorityInstallationAuthorized !== false ||
    !positive(c.reviewedAt) || !positive(c.expiresAt) || c.expiresAt <= c.reviewedAt || c.expiresAt - c.reviewedAt > 3_600_000 ||
    !positive(c.cleanupEpoch) || !positive(c.revision) || !digest.test(c.recordSha256)) sealedV3Fail("SEALED_V3_CANDIDATE_INVALID");
  const drain = await compileSharedCellAdmissionDrainIntent(c.predecessor);
  const state = await validateSealedOwnershipStateV3(c.ownershipState, certificateSha256);
  if (state.admissionFenceSha256 !== drain.fenceSha256 || state.admissionProvisionOperationHash !== c.predecessor.provisionOperationHash ||
    state.admissionStackId !== c.predecessor.stackId || state.admissionCellExpiresAt !== drain.cellExpiresAt || drain.cellExpiresAt > c.reviewedAt ||
    state.sealedCertificates[0].sealed_at > c.reviewedAt || state.admissionChangedAt > c.reviewedAt || c.cleanupEpoch <= c.predecessor.provisionEpoch || c.revision !== c.predecessor.revision + 1 ||
    c.cleanupMarker !== `sealed-cell-ttl-v3:g${c.predecessor.generation}:e${c.cleanupEpoch}` || await sha256Hex(state) !== c.ownershipStateSha256)
    sealedV3Fail("SEALED_V3_CANDIDATE_LINEAGE_INVALID");
  const stack = c.stackEvidence;
  if (!sealedV3Keys(stack, ["schemaVersion", "verified", "observedAt", "accountId", "region", "cellId", "stackName", "stackId", "stackStatus",
    "cellExpiresAt", "templateCanonicalSha256", "resourceInventorySha256", "cloudFormationRoleArn"]) || stack.schemaVersion !== 1 || stack.verified !== true ||
    stack.accountId !== "402010193138" || stack.region !== "ca-central-1" || stack.cellId !== "cell-sandbox-1" || stack.stackName !== c.predecessor.stackName ||
    !positive(stack.observedAt) || stack.observedAt > c.reviewedAt || c.reviewedAt - stack.observedAt > 30_000 || stack.observedAt < drain.cellExpiresAt ||
    ["stackId", "stackStatus", "cellExpiresAt", "templateCanonicalSha256", "resourceInventorySha256", "cloudFormationRoleArn"].some(k =>
      stack[k as keyof typeof stack] !== c.predecessor[k as keyof typeof c.predecessor])) sealedV3Fail("SEALED_V3_CANDIDATE_STACK_INVALID");
  const { recordSha256, ...unsigned } = c;
  if (await sha256Hex(unsigned) !== recordSha256) sealedV3Fail("SEALED_V3_CANDIDATE_HASH_INVALID"); return sealedV3Freeze(c);
}

export interface SealedCellAuthorityRecordV3 {
  readonly schemaVersion: 3;
  readonly protocol: "sealed-cell-durable-authority-v3";
  readonly state: "cleanup_authorized";
  readonly authorityKey: typeof SEALED_CELL_AUTHORITY_KEY_V3;
  readonly revision: number;
  readonly candidate: PreparedSealedCellCleanupAuthorityV3;
  readonly approvedCandidateSha256: string;
  readonly certificateSha256: string;
  readonly recordSha256: string;
}
/** Explicit reviewed installer compiler; does not grant IAM or install itself. */
export async function authorizeSealedCellAuthorityRecordV3(input: {
  candidate: PreparedSealedCellCleanupAuthorityV3; approvedCandidateSha256: string; certificateSha256: string; now: number;
}): Promise<Readonly<SealedCellAuthorityRecordV3>> {
  if (!sealedV3Keys(input, ["candidate", "approvedCandidateSha256", "certificateSha256", "now"]) ||
    !isPreparedSealedCellCleanupAuthorityV3(input.candidate) || input.approvedCandidateSha256 !== input.candidate.recordSha256 ||
    !positive(input.now) || input.now < input.candidate.reviewedAt || input.now >= input.candidate.expiresAt)
    sealedV3Fail("SEALED_V3_AUTHORITY_APPROVAL_INVALID");
  const candidate = await validatePreparedSealedCandidateV3(input.candidate, input.certificateSha256);
  const unsigned = { schemaVersion: 3 as const, protocol: "sealed-cell-durable-authority-v3" as const, state: "cleanup_authorized" as const,
    authorityKey: SEALED_CELL_AUTHORITY_KEY_V3, revision: candidate.revision, candidate,
    approvedCandidateSha256: input.approvedCandidateSha256, certificateSha256: input.certificateSha256 };
  return sealedV3Freeze({ ...unsigned, recordSha256: await sha256Hex(unsigned) });
}
export async function decodeSealedCellAuthorityRecordV3(value: unknown, certificateSha256: string): Promise<Readonly<SealedCellAuthorityRecordV3>> {
  const r = clone(value) as SealedCellAuthorityRecordV3;
  if (!sealedV3Keys(r, ["schemaVersion", "protocol", "state", "authorityKey", "revision", "candidate", "approvedCandidateSha256", "certificateSha256", "recordSha256"]) ||
    r.schemaVersion !== 3 || r.protocol !== "sealed-cell-durable-authority-v3" || r.state !== "cleanup_authorized" || r.authorityKey !== SEALED_CELL_AUTHORITY_KEY_V3 ||
    r.certificateSha256 !== certificateSha256 || !positive(r.revision) || !digest.test(r.recordSha256)) sealedV3Fail("SEALED_V3_AUTHORITY_RECORD_INVALID");
  const candidate = await validatePreparedSealedCandidateV3(r.candidate, certificateSha256);
  const { recordSha256, ...unsigned } = r;
  if (r.revision !== candidate.revision || r.approvedCandidateSha256 !== candidate.recordSha256 || await sha256Hex(unsigned) !== recordSha256)
    sealedV3Fail("SEALED_V3_AUTHORITY_RECORD_HASH_INVALID"); return sealedV3Freeze(r);
}
export function assertSealedCellAuthorityActiveV3(record: SealedCellAuthorityRecordV3, now: number): void {
  if (!positive(now) || now < record.candidate.reviewedAt || now >= record.candidate.expiresAt) sealedV3Fail("SEALED_V3_AUTHORITY_EXPIRED");
}

export interface StrongSealedCellAuthorityReadPortV3 {
  readStrong(input: { signal: AbortSignal }): Promise<Readonly<SealedCellAuthorityRecordV3>>;
}
