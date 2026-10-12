import { canonicalJson, sha256Hex } from "./hash.ts";
import { assertCellStackPlanV3, cellV3Clock, cellV3Exact, cellV3Fail, cellV3Freeze, type CellStackPlanV3 } from "../cloudformation/shared-cell-stack-v3.ts";
import { assertCellStackSnapshotV3, type CellStackSnapshotV3 } from "./aws-sdk-cell-stack-evidence-v3.ts";

export const FAILED_CELL_BIRTH_ENVIRONMENT_V1 = "env_aws_sandbox_ca_central_1" as const;
const digest = /^[a-f0-9]{64}$/;
const stackId = /^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const statuses = ["CREATE_FAILED", "UPDATE_FAILED", "ROLLBACK_FAILED", "ROLLBACK_COMPLETE", "UPDATE_ROLLBACK_FAILED", "DELETE_FAILED"];
export async function compileFailedCellBirthFenceV1(input: { plan: CellStackPlanV3; failure: CellStackSnapshotV3; environmentIdentitySha256: string; expectedAdmissionEpoch: number; now: number }) {
  if (!cellV3Exact(input, ["plan", "failure", "environmentIdentitySha256", "expectedAdmissionEpoch", "now"])) cellV3Fail("FAILED_BIRTH_FENCE_INPUT_INVALID");
  assertCellStackPlanV3(input.plan); assertCellStackSnapshotV3(input.failure); cellV3Clock(input.now);
  const p = input.plan, f = input.failure;
  if (!f.failedCreationOrPhase || f.completePaidStack || f.birthIntentSha256 !== p.birthIntentSha256 || f.templateCanonicalSha256 !== p.templateCanonicalSha256 ||
    f.observedAt > input.now || input.now - f.observedAt > 30000 || input.expectedAdmissionEpoch !== 0 || !digest.test(input.environmentIdentitySha256)) cellV3Fail("FAILED_BIRTH_CURRENT_UNADMITTED_EVIDENCE_REQUIRED");
  const intent = cellV3Freeze({ schemaVersion: 1 as const, protocol: "failed-cell-birth-exclusion-fence-v1" as const, accountId: "402010193138" as const,
    region: "ca-central-1" as const, cellId: "cell-sandbox-1" as const, environmentId: FAILED_CELL_BIRTH_ENVIRONMENT_V1,
    birthIntentSha256: p.birthIntentSha256, planSha256: p.planSha256, templateCanonicalSha256: p.templateCanonicalSha256, stackId: f.stackId,
    ownerDeploymentId: p.intent.input.ownerDeploymentId, generation: p.intent.input.generation, provisionEpoch: p.intent.input.provisionEpoch,
    failureInventorySha256: f.resourceInventorySha256, failedPhase: f.phase, failedStackStatus: f.stackStatus,
    cellExpiresAt: Date.parse(p.intent.cellExpiresAt), expectedAdmissionEpoch: 0, environmentIdentitySha256: input.environmentIdentitySha256 });
  return cellV3Freeze({ intent, fenceSha256: await sha256Hex(intent), databaseWriteAuthorized: false, cloudDeleteAuthorized: false, runtimeEnabled: false });
}
export type FailedCellBirthFenceIntentV1 = Awaited<ReturnType<typeof compileFailedCellBirthFenceV1>>["intent"];
export async function decodeFailedCellBirthFenceV1(value: unknown, expectedSha256: string): Promise<Readonly<FailedCellBirthFenceIntentV1>> {
  const v = value as FailedCellBirthFenceIntentV1;
  if (!cellV3Exact(v, ["schemaVersion", "protocol", "accountId", "region", "cellId", "environmentId", "birthIntentSha256", "planSha256", "templateCanonicalSha256", "stackId",
    "ownerDeploymentId", "generation", "provisionEpoch", "failureInventorySha256", "failedPhase", "failedStackStatus", "cellExpiresAt", "expectedAdmissionEpoch", "environmentIdentitySha256"]) ||
    v.schemaVersion !== 1 || v.protocol !== "failed-cell-birth-exclusion-fence-v1" || v.accountId !== "402010193138" || v.region !== "ca-central-1" || v.cellId !== "cell-sandbox-1" ||
    v.environmentId !== FAILED_CELL_BIRTH_ENVIRONMENT_V1 || !stackId.test(v.stackId) || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(v.ownerDeploymentId) ||
    !["RESERVED", "ARMED", "PAID"].includes(v.failedPhase) || !statuses.includes(v.failedStackStatus) || v.expectedAdmissionEpoch !== 0 ||
    [v.generation, v.provisionEpoch, v.cellExpiresAt].some(n => !Number.isSafeInteger(n) || n <= 0) ||
    [v.birthIntentSha256, v.planSha256, v.templateCanonicalSha256, v.failureInventorySha256, v.environmentIdentitySha256, expectedSha256].some(x => !digest.test(x)) ||
    await sha256Hex(v) !== expectedSha256) cellV3Fail("FAILED_BIRTH_FENCE_RECORD_INVALID");
  return cellV3Freeze(structuredClone(v));
}

export interface FailedCellBirthFenceSqlV1 { query(statement: string, values: unknown[], options: { fullResults: true; fetchOptions: { signal: AbortSignal } }): Promise<unknown> }
/** Dormant one-write entry. Approval is for this exact fence, NOT deletion.
 * The SQL function locks environment + checks current unadmitted ownership.
 * Timeout/lost commit is inspect-only; this adapter has no retry or reset. */
export class NeonFailedCellBirthFenceWriterV1 {
  private readonly sql: FailedCellBirthFenceSqlV1;
  constructor(sql: FailedCellBirthFenceSqlV1) { if (typeof sql?.query !== "function") cellV3Fail("FAILED_BIRTH_WRITER_CAPABILITY_INVALID"); this.sql = Object.freeze({ query: sql.query.bind(sql) }); }
  async installOnce(input: { intent: FailedCellBirthFenceIntentV1; approvedFenceSha256: string; signal: AbortSignal }) {
    if (!cellV3Exact(input, ["intent", "approvedFenceSha256", "signal"])) cellV3Fail("FAILED_BIRTH_WRITER_INPUT_INVALID");
    const intent = await decodeFailedCellBirthFenceV1(input.intent, input.approvedFenceSha256); input.signal.throwIfAborted();
    try {
      const r = await this.sql.query("SELECT public.begin_failed_cell_birth_fence_v1($1,$2) AS fence_sha256", [canonicalJson(intent), input.approvedFenceSha256],
        { fullResults: true, fetchOptions: { signal: input.signal } }); input.signal.throwIfAborted();
      const rows = (r as { rows?: { fence_sha256?: string }[] }).rows;
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0].fence_sha256 !== input.approvedFenceSha256) return { outcome: "FENCE_RESULT_UNCERTAIN_INSPECT_ONLY" as const, retryAuthorized: false as const };
      return { outcome: "FENCE_SUBMITTED_REQUIRES_INDEPENDENT_CERTIFIED_READ" as const, retryAuthorized: false as const };
    } catch { return { outcome: "FENCE_RESULT_UNCERTAIN_INSPECT_ONLY" as const, retryAuthorized: false as const }; }
  }
}
