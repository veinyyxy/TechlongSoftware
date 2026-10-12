import { canonicalJson, sha256Hex } from "./hash.ts";
import { assertCellStackPlanV3, cellV3Clock, cellV3Exact, cellV3Fail, cellV3Freeze, CELL_V3_CFN_ROLE, type CellStackPlanV3 } from "../cloudformation/shared-cell-stack-v3.ts";
import { assertCellStackSnapshotV3, type CellStackSnapshotV3 } from "./aws-sdk-cell-stack-evidence-v3.ts";
import { validateSharedCellAuthorityItem, type SharedCellAuthorityItem } from "./shared-cell-cleanup-authority.ts";
import { compileSharedCellAdmissionDrainIntent } from "./shared-cell-admission-fence.ts";
import { authorizeSealedCellAuthorityRecordV3, decodeSealedCellAuthorityRecordV3, type SealedCellAuthorityRecordV3 } from "./sealed-cell-cleanup-authority-v3.ts";
import { isPreparedSealedCellCleanupAuthorityV3, type PreparedSealedCellCleanupAuthorityV3 } from "./sealed-cell-cleanup-evidence-v3.ts";
import { validateSealedCellDeleteIntentV3 } from "./prepared-sealed-cell-ttl-executor-v3.ts";
import { REGISTERED_SEALED_CERTIFICATE_SHA256_V3 as certificateSha256 } from "./sealed-cell-cleanup-lambda-context-v3.ts";
import { validateSealedCellDrainEventV3 } from "./prepared-sealed-cell-drain-coordinator-v3.ts";

const digest = /^[a-f0-9]{64}$/, stackId = /^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const delegates = new WeakSet<object>();
export async function compileCellBirthDelegationV3(input: { plan: CellStackPlanV3; reserved: CellStackSnapshotV3; coordinatorCodeSha256: string; coordinatorRoleId: string; now: number }) {
  if (!cellV3Exact(input, ["plan", "reserved", "coordinatorCodeSha256", "coordinatorRoleId", "now"])) cellV3Fail("CELL_V3_DELEGATION_INPUT_INVALID");
  assertCellStackPlanV3(input.plan); assertCellStackSnapshotV3(input.reserved); cellV3Clock(input.now);
  const r = input.reserved, p = input.plan;
  if (r.phase !== "RESERVED" || !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(r.stackStatus) || r.resources.length || r.birthIntentSha256 !== p.birthIntentSha256 ||
    r.templateCanonicalSha256 !== p.templateCanonicalSha256 || r.observedAt > input.now || input.now - r.observedAt > 30000 ||
    !digest.test(input.coordinatorCodeSha256) || !/^AROA[A-Z0-9]{16,24}$/.test(input.coordinatorRoleId) || input.now >= Date.parse(p.intent.cellExpiresAt)) cellV3Fail("CELL_V3_RESERVED_DELEGATION_EVIDENCE_REQUIRED");
  const unsigned = { schemaVersion: 3 as const, protocol: "cell-birth-cleanup-delegation-v3" as const, birthIntentSha256: p.birthIntentSha256,
    stackId: r.stackId, templateCanonicalSha256: p.templateCanonicalSha256, planSha256: p.planSha256, ownerDeploymentId: p.intent.input.ownerDeploymentId,
    generation: p.intent.input.generation, provisionEpoch: p.intent.input.provisionEpoch, coordinatorCodeSha256: input.coordinatorCodeSha256,
    coordinatorRoleId: input.coordinatorRoleId, cellExpiresAt: p.intent.cellExpiresAt, notBefore: input.now, notAfter: Date.parse(p.intent.cleanupDelegationNotAfter),
    scope: { automaticTtlAuthorityAfterDueAndCertifiedZero: true, exactPredecessorAndTemplateRequired: true, onceOnlyDeleteJournalRequired: true,
      failedCreationCompensationRequiresSeparateUnadmittedFence: true, noForceDeleteRetainSkipOrPhaseRegression: true, noGenerationResetOrWriteRetry: true },
    installationAuthorized: false as const, runtimeEnabled: false as const };
  const d = cellV3Freeze({ ...unsigned, delegationSha256: await sha256Hex(unsigned) }); delegates.add(d); return d;
}
export type CellBirthDelegationV3 = Awaited<ReturnType<typeof compileCellBirthDelegationV3>>;
/** Cold-start decoder remains data-only. An independently verified immutable
 * installation registry is still needed before ANY writer may consume it. */
export async function decodeCellBirthDelegationV3(value: CellBirthDelegationV3, plan: CellStackPlanV3) {
  assertCellStackPlanV3(plan); const v = structuredClone(value);
  if (!cellV3Exact(v, ["schemaVersion", "protocol", "birthIntentSha256", "stackId", "templateCanonicalSha256", "planSha256", "ownerDeploymentId", "generation", "provisionEpoch",
    "coordinatorCodeSha256", "coordinatorRoleId", "cellExpiresAt", "notBefore", "notAfter", "scope", "installationAuthorized", "runtimeEnabled", "delegationSha256"]) ||
    v.schemaVersion !== 3 || v.protocol !== "cell-birth-cleanup-delegation-v3" || v.birthIntentSha256 !== plan.birthIntentSha256 || v.planSha256 !== plan.planSha256 ||
    v.templateCanonicalSha256 !== plan.templateCanonicalSha256 || !stackId.test(v.stackId) || v.ownerDeploymentId !== plan.intent.input.ownerDeploymentId ||
    v.generation !== plan.intent.input.generation || v.provisionEpoch !== plan.intent.input.provisionEpoch || v.cellExpiresAt !== plan.tags.ExpiresAt ||
    !Number.isSafeInteger(v.notBefore) || v.notBefore < plan.intent.input.base.requestedAt || v.notBefore >= Date.parse(v.cellExpiresAt) ||
    v.notAfter !== Date.parse(plan.intent.cleanupDelegationNotAfter) || !digest.test(v.coordinatorCodeSha256) || !/^AROA[A-Z0-9]{16,24}$/.test(v.coordinatorRoleId) ||
    v.installationAuthorized !== false || v.runtimeEnabled !== false || !digest.test(v.delegationSha256) ||
    canonicalJson(v.scope) !== canonicalJson({ automaticTtlAuthorityAfterDueAndCertifiedZero: true, exactPredecessorAndTemplateRequired: true, onceOnlyDeleteJournalRequired: true,
      failedCreationCompensationRequiresSeparateUnadmittedFence: true, noForceDeleteRetainSkipOrPhaseRegression: true, noGenerationResetOrWriteRetry: true })) cellV3Fail("CELL_V3_DELEGATION_RECORD_INVALID");
  const { delegationSha256, ...body } = v; if (await sha256Hex(body) !== delegationSha256) cellV3Fail("CELL_V3_DELEGATION_HASH_INVALID");
  const d = cellV3Freeze(v); delegates.add(d); return d;
}
function assertDelegate(d: CellBirthDelegationV3, plan: CellStackPlanV3, now: number) {
  assertCellStackPlanV3(plan); cellV3Clock(now);
  if (!delegates.has(d) || d.birthIntentSha256 !== plan.birthIntentSha256 || d.planSha256 !== plan.planSha256 || now < d.notBefore || now >= d.notAfter) cellV3Fail("CELL_V3_DELEGATION_PROVENANCE_OR_WINDOW_INVALID");
}

/** Parent-delegation-scoped data preview. No installation proof is created;
 * a later installer must independently verify the approval registry. */
export async function prepareBirthBoundDrainV3(input: { plan: CellStackPlanV3; delegation: CellBirthDelegationV3; provisionItem: SharedCellAuthorityItem; now: number }) {
  if (!cellV3Exact(input, ["plan", "delegation", "provisionItem", "now"])) cellV3Fail("CELL_V3_DRAIN_PREPARE_INPUT_INVALID");
  assertDelegate(input.delegation, input.plan, input.now);
  if (input.now < Date.parse(input.delegation.cellExpiresAt)) cellV3Fail("CELL_V3_CLEANUP_NOT_DUE");
  const v = await validateSharedCellAuthorityItem(input.provisionItem); if (v.record.state !== "provision_verified") cellV3Fail("CELL_V3_PROVISION_PREDECESSOR_REQUIRED");
  const p = v.record, d = input.delegation;
  if (p.stackId !== d.stackId || p.cellExpiresAt !== d.cellExpiresAt || p.templateCanonicalSha256 !== d.templateCanonicalSha256 || p.ownerDeploymentId !== d.ownerDeploymentId ||
    p.generation !== d.generation || p.provisionEpoch !== d.provisionEpoch) cellV3Fail("CELL_V3_BIRTH_PREDECESSOR_DRIFT");
  const drain = await compileSharedCellAdmissionDrainIntent(p), event = validateSealedCellDrainEventV3({ schemaVersion: 3, action: "coordinate_reviewed_sealed_cell_ttl_cleanup_v3",
    expectedProvisionItemSha256: await sha256Hex(v.item), approvedDrainIntentSha256: drain.fenceSha256, certificateSha256 });
  return cellV3Freeze({ schemaVersion: 3, delegationSha256: d.delegationSha256, stackId: p.stackId, event, invokeAuthorized: false, runtimeEnabled: false });
}

/** Reuses the certified v3 zero/Stack candidate. Never turns raw counters,
 * serialized copies or a failure Stack into successful TTL cleanup authority. */
export async function prepareBirthBoundCleanupAuthorityV3(input: { plan: CellStackPlanV3; delegation: CellBirthDelegationV3; candidate: PreparedSealedCellCleanupAuthorityV3; now: number }) {
  if (!cellV3Exact(input, ["plan", "delegation", "candidate", "now"])) cellV3Fail("CELL_V3_AUTHORITY_PREPARE_INPUT_INVALID");
  assertDelegate(input.delegation, input.plan, input.now); const c = input.candidate, d = input.delegation;
  if (!isPreparedSealedCellCleanupAuthorityV3(c) || input.now < Date.parse(d.cellExpiresAt) || c.expiresAt > d.notAfter || c.predecessor.stackId !== d.stackId ||
    c.predecessor.templateCanonicalSha256 !== d.templateCanonicalSha256 || c.predecessor.ownerDeploymentId !== d.ownerDeploymentId ||
    c.predecessor.generation !== d.generation || c.predecessor.provisionEpoch !== d.provisionEpoch || c.predecessor.cellExpiresAt !== d.cellExpiresAt) cellV3Fail("CELL_V3_AUTHORITY_OUTSIDE_BIRTH_DELEGATION");
  const record = await authorizeSealedCellAuthorityRecordV3({ candidate: c, approvedCandidateSha256: c.recordSha256, certificateSha256, now: input.now });
  return cellV3Freeze({ record, delegationSha256: d.delegationSha256, recordSha256: record.recordSha256, installationAuthorized: false, invokeAuthorized: false, runtimeEnabled: false });
}

export async function prepareBirthBoundExecutorEventV3(input: { plan: CellStackPlanV3; delegation: CellBirthDelegationV3; installedRecord: SealedCellAuthorityRecordV3; now: number }) {
  if (!cellV3Exact(input, ["plan", "delegation", "installedRecord", "now"])) cellV3Fail("CELL_V3_EXECUTOR_PREPARE_INPUT_INVALID");
  assertDelegate(input.delegation, input.plan, input.now); const r = await decodeSealedCellAuthorityRecordV3(input.installedRecord, certificateSha256), p = r.candidate.predecessor, d = input.delegation;
  if (input.now < r.candidate.reviewedAt || input.now >= r.candidate.expiresAt || r.candidate.expiresAt > d.notAfter || p.stackId !== d.stackId || p.templateCanonicalSha256 !== d.templateCanonicalSha256 ||
    p.cellExpiresAt !== d.cellExpiresAt || p.ownerDeploymentId !== d.ownerDeploymentId || p.generation !== d.generation || p.provisionEpoch !== d.provisionEpoch) cellV3Fail("CELL_V3_INSTALLED_AUTHORITY_OUTSIDE_DELEGATION");
  const plan = { schemaVersion: 3 as const, protocol: "sealed-cell-runtime-delete-plan-v3" as const, action: "delete_sealed_shared_cell_stack" as const,
    executorRoleArn: r.candidate.executorRoleArn, executorIdentityProtocol: r.candidate.executorIdentityProtocol, authorityRecord: r, ownershipState: r.candidate.ownershipState,
    stackId: p.stackId, cloudFormationRoleArn: p.cloudFormationRoleArn, deletionMode: "STANDARD" as const };
  const sha = await sha256Hex(plan); await validateSealedCellDeleteIntentV3({ schemaVersion: 3, plan, planSha256: sha }, sha, certificateSha256);
  return cellV3Freeze({ schemaVersion: 3, delegationSha256: d.delegationSha256, event: { schemaVersion: 3, action: "execute_reviewed_sealed_cell_ttl_cleanup", approvedDeletionPlanSha256: sha },
    stackId: p.stackId, executorRoleArn: r.candidate.executorRoleArn, authorityRecordSha256: r.recordSha256, invokeAuthorized: false, runtimeEnabled: false });
}

/** Partial failure is separate from complete/expired/zero TTL authority. The
 * data-only request cannot be executed without a live admission+activation CAS
 * exclusion fence and certified DB census; none is manufactured here. */
export async function prepareFailedBirthCompensationV3(input: { plan: CellStackPlanV3; delegation: CellBirthDelegationV3; failure: CellStackSnapshotV3; now: number }) {
  if (!cellV3Exact(input, ["plan", "delegation", "failure", "now"])) cellV3Fail("CELL_V3_COMPENSATION_INPUT_INVALID");
  assertDelegate(input.delegation, input.plan, input.now); assertCellStackSnapshotV3(input.failure); const f = input.failure, d = input.delegation;
  if (f.profile === "source_inspection" || !f.failedCreationOrPhase || f.completePaidStack || f.stackId !== d.stackId || f.birthIntentSha256 !== d.birthIntentSha256 ||
    f.templateCanonicalSha256 !== d.templateCanonicalSha256 || f.observedAt > input.now || input.now - f.observedAt > 30000) cellV3Fail("CELL_V3_FAILED_BIRTH_EVIDENCE_INVALID");
  const intent = { schemaVersion: 3, action: "delete_failed_unadmitted_cell_birth", delegationSha256: d.delegationSha256, stackId: f.stackId,
    templateCanonicalSha256: f.templateCanonicalSha256, partialInventorySha256: f.resourceInventorySha256, stackStatus: f.stackStatus, phase: f.phase, resources: f.resources };
  const sha = await sha256Hex(intent);
  return cellV3Freeze({ intent, compensationPlanSha256: sha, request: { StackName: f.stackId, RoleARN: CELL_V3_CFN_ROLE, ClientRequestToken: `cell-v3-failed-${sha}`, DeletionMode: "STANDARD" },
    mutationAuthorized: false, runtimeEnabled: false, noAutomaticRollbackOrWriteRetry: true,
    blockers: ["explicit_parent_delegation_installed_and_verified", "atomic_failed_birth_fence_and_absent_activation_provision", "certified_serializable_unadmitted_zero_tenant_source",
      "exact_failed_inventory_immediate_readback", "immutable_compensation_intent_and_once_only_journal", "independent_exact_stack_deletion_readback"] });
}

export function validateCellBirthTickV3(v: unknown) {
  const r = v as Record<string, unknown>;
  if (!cellV3Exact(v, ["schemaVersion", "action", "birthIntentSha256", "stackId"]) || r.schemaVersion !== 3 || r.action !== "reconcile_approved_cell_birth_v3" ||
    typeof r.birthIntentSha256 !== "string" || !digest.test(r.birthIntentSha256) || typeof r.stackId !== "string" || !stackId.test(r.stackId)) cellV3Fail("CELL_V3_TICK_EVENT_INVALID");
  return cellV3Freeze(structuredClone(r));
}
