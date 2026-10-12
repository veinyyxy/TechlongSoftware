import { canonicalJson, sha256Hex } from "./hash.ts";
import { cellV3Clock, cellV3Exact, cellV3Fail, cellV3Freeze } from "../cloudformation/shared-cell-stack-v3.ts";
import { AwsSdkCellStackEvidenceV3, assertCellStackSnapshotV3, type CellStackSnapshotV3 } from "./aws-sdk-cell-stack-evidence-v3.ts";
import { prepareBirthBoundDrainV3, prepareFailedBirthCompensationV3, validateCellBirthTickV3 } from "./cell-birth-lifecycle-v3.ts";
import { AwsSdkCellBirthRegistryReaderV3, AwsSdkCellBirthDrainJournalV3, assertInstalledCellBirthRegistrationV3, compileCellBirthDrainIntentV3,
  compileCellBirthDrainReceiptV3, type InstalledCellBirthRegistrationV3, type CellBirthDrainIntentV3 } from "./aws-sdk-cell-birth-registry-v3.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_KEY, validateSharedCellAuthorityItem, type SharedCellCleanupAuthoritySnapshot } from "./shared-cell-cleanup-authority.ts";
import type { validateSealedCellDrainEventV3 } from "./prepared-sealed-cell-drain-coordinator-v3.ts";

export interface CellBirthDrainActuatorV3 {
  /** Composition must use the separately approved fixed drain identity/code.
   * No unqualified JSON endpoint or caller-provided Lambda ARN is accepted here. */
  run(event: ReturnType<typeof validateSealedCellDrainEventV3>, signal: AbortSignal): Promise<unknown>;
}
function drainResult(v: unknown, intent: CellBirthDrainIntentV3) {
  const r = v as Record<string, unknown>;
  if (!cellV3Exact(r, ["schemaVersion", "mode", "outcome", "expectedProvisionItemSha256", "drainIntentSha256", "certificateSha256", "drainReceipt", "jobReceipt", "ownershipCounts",
    "ownershipStateSha256", "rawOwnershipWitnessSha256", "authorityWritePerformed", "cellDeletionPerformed", "runtimeActivationAuthorized"]) ||
    r.schemaVersion !== 3 || r.mode !== "prepared_not_installed" || !["ZERO_TENANT_READY_FOR_AUTHORITY_REVIEW_V3", "TENANT_CLEANUP_PENDING", "BLOCKED_CLEANUP_JOB_REQUIRES_REVIEW"].includes(String(r.outcome)) ||
    r.expectedProvisionItemSha256 !== intent.event.expectedProvisionItemSha256 || r.drainIntentSha256 !== intent.event.approvedDrainIntentSha256 || r.certificateSha256 !== intent.event.certificateSha256 ||
    r.authorityWritePerformed !== false || r.cellDeletionPerformed !== false || r.runtimeActivationAuthorized !== false ||
    !/^[a-f0-9]{64}$/.test(String(r.ownershipStateSha256)) || !/^[a-f0-9]{64}$/.test(String(r.rawOwnershipWitnessSha256))) cellV3Fail("CELL_BIRTH_DRAIN_RETURN_INVALID");
  const c = r.ownershipCounts as Record<string, unknown>;
  if (!cellV3Exact(c, ["activeTenantCount", "activeCapacityReservationCount", "nonterminalDeploymentCount", "liveTenantResourceCount", "nonterminalTenantCleanupScheduleCount"]) ||
    Object.values(c).some(n => !Number.isSafeInteger(n) || Number(n) < 0 || Number(n) > 10000) ||
    (r.outcome === "ZERO_TENANT_READY_FOR_AUTHORITY_REVIEW_V3" && Object.values(c).some(n => n !== 0))) cellV3Fail("CELL_BIRTH_DRAIN_RETURN_COUNTS_INVALID");
  return r;
}

/** Real orchestration logic, dormant until explicit installation/composition.
 * Current approved scope stops after one drain: never issues TTL authority,
 * calls a deleter, advances CFN phases, or enables tenant runtime. */
export function createPreparedCellBirthCoordinatorV3(input: {
  registry: AwsSdkCellBirthRegistryReaderV3; journal: AwsSdkCellBirthDrainJournalV3; stack: AwsSdkCellStackEvidenceV3;
  authority: { observe(request: { authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY; signal: AbortSignal }): Promise<SharedCellCleanupAuthoritySnapshot> };
  drain: CellBirthDrainActuatorV3; coordinatorCodeSha256: string; now?: () => number;
}) {
  if (!cellV3Exact(input, input.now === undefined ? ["registry", "journal", "stack", "authority", "drain", "coordinatorCodeSha256"] : ["registry", "journal", "stack", "authority", "drain", "coordinatorCodeSha256", "now"]) ||
    !(input.registry instanceof AwsSdkCellBirthRegistryReaderV3) || !(input.journal instanceof AwsSdkCellBirthDrainJournalV3) || !(input.stack instanceof AwsSdkCellStackEvidenceV3) ||
    typeof input.authority?.observe !== "function" || typeof input.drain?.run !== "function" || !/^[a-f0-9]{64}$/.test(input.coordinatorCodeSha256) || (input.now !== undefined && typeof input.now !== "function")) cellV3Fail("CELL_BIRTH_COORDINATOR_CAPABILITIES_INVALID");
  const read = input.registry.readStrong.bind(input.registry), stackRead = input.stack.read.bind(input.stack), observe = input.authority.observe.bind(input.authority),
    invokeDrain = input.drain.run.bind(input.drain), journal = input.journal, codeSha256 = input.coordinatorCodeSha256, now = input.now ?? Date.now;
  const clock = () => cellV3Clock(now());
  const result = (outcome: string, extra: Record<string, unknown> = {}) => cellV3Freeze({ schemaVersion: 3, mode: "prepared_not_installed", outcome,
    cloudRuntimeInstalled: false, authorityWritePerformed: false, cellDeletionPerformed: false, tenantRuntimeEnabled: false, retryAuthorized: false, ...extra });
  return Object.freeze({ mode: "prepared_not_installed" as const, cloudRuntimeInstalled: false as const,
    async run(rawEvent: unknown, signal: AbortSignal) {
      const event = validateCellBirthTickV3(rawEvent); signal.throwIfAborted();
      async function registration() {
        const r = await read({ signal }); signal.throwIfAborted(); if (!r) cellV3Fail("CELL_BIRTH_INSTALLED_APPROVAL_ABSENT");
        assertInstalledCellBirthRegistrationV3(r, clock(), codeSha256); const d = r.record.manifest.delegation;
        if (event.birthIntentSha256 !== d.birthIntentSha256 || event.stackId !== d.stackId) cellV3Fail("CELL_BIRTH_EVENT_REGISTRATION_MISMATCH"); return r;
      }
      const first = await registration(), record = first.record, p = record.manifest.plan, d = record.manifest.delegation;
      async function sameRegistration() { const r = await registration(); if (canonicalJson(r.record) !== canonicalJson(record)) cellV3Fail("CELL_BIRTH_REGISTRATION_DRIFT"); return r; }
      async function stack(installed: InstalledCellBirthRegistrationV3) {
        assertInstalledCellBirthRegistrationV3(installed, clock(), codeSha256); const s = await stackRead(p, d.stackId, signal); signal.throwIfAborted();
        if (!("protocol" in s)) cellV3Fail("CELL_BIRTH_EXPECTED_STACK_MISSING"); assertCellStackSnapshotV3(s);
        if (s.profile !== "lifecycle_coordinator" || s.observedAt > clock() || clock() - s.observedAt > 30000) cellV3Fail("CELL_BIRTH_COORDINATOR_STACK_PROOF_INVALID"); return s;
      }
      const initialStack = await stack(first);
      if (initialStack.failedCreationOrPhase) {
        const preview = await prepareFailedBirthCompensationV3({ plan: p, delegation: d, failure: initialStack, now: clock() });
        return result("FAILED_BIRTH_BLOCKED_ON_EXCLUSION_PROOF", { compensationPlanSha256: preview.compensationPlanSha256, blockers: preview.blockers, drainInvocationAttempted: false });
      }
      if (!initialStack.completePaidStack) return result("NONPAID_BIRTH_REQUIRES_SEPARATE_REVIEW", { phase: initialStack.phase, drainInvocationAttempted: false });
      if (clock() < Date.parse(d.cellExpiresAt)) return result("CELL_BIRTH_NOT_DUE", { drainInvocationAttempted: false });
      async function predecessor(s: CellStackSnapshotV3) {
        const raw = structuredClone(await observe({ authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY, signal })); signal.throwIfAborted();
        if (!raw.item || raw.authorityKey !== SHARED_CELL_CLEANUP_AUTHORITY_KEY || raw.revision !== raw.item.revision) cellV3Fail("CELL_BIRTH_CURRENT_PROVISION_ABSENT");
        const v = await validateSharedCellAuthorityItem(raw.item), a = v.record;
        if (a.state !== "provision_verified" || a.stackId !== s.stackId || a.stackStatus !== s.stackStatus || a.cellExpiresAt !== s.cellExpiresAt ||
          a.templateCanonicalSha256 !== s.templateCanonicalSha256 || a.resourceInventorySha256 !== s.resourceInventorySha256 || a.cloudFormationRoleArn !== s.cloudFormationRoleArn ||
          a.ownerDeploymentId !== p.intent.input.ownerDeploymentId || a.generation !== p.intent.input.generation || a.provisionEpoch !== p.intent.input.provisionEpoch) cellV3Fail("CELL_BIRTH_CURRENT_PROVISION_LINEAGE_DRIFT");
        return prepareBirthBoundDrainV3({ plan: p, delegation: d, provisionItem: v.item, now: clock() });
      }
      const preview = await predecessor(initialStack), intent = await compileCellBirthDrainIntentV3(first, preview.event, clock());
      const saved = await journal.readStrong(first, signal);
      if (saved.intent) {
        if (saved.intent.operationSha256 !== intent.operationSha256) cellV3Fail("CELL_BIRTH_FIXED_ACTION_SLOT_DRIFT");
        return result(saved.receipt ? "IMMUTABLE_DRAIN_RECEIPT_REPLAYED" : "DRAIN_SLOT_OCCUPIED_INSPECT_ONLY", { receipt: saved.receipt, drainInvocationAttempted: false });
      }
      const beforeClaim = await sameRegistration(), beforeStack = await stack(beforeClaim), beforeDrain = await predecessor(beforeStack);
      if (!beforeStack.completePaidStack || canonicalJson(beforeDrain.event) !== canonicalJson(intent.event)) cellV3Fail("CELL_BIRTH_PRECLAIM_PLAN_DRIFT");
      const claim = await journal.claimOnce(beforeClaim, intent, signal);
      if (!claim) return result("DRAIN_SLOT_NOT_OWNED_INSPECT_ONLY", { drainInvocationAttempted: false });
      // A successful response alone is insufficient: exact stored intent and fresh
      // current registry/Stack/predecessor are re-read after the durable claim.
      const afterClaim = await sameRegistration(), savedClaim = await journal.readStrong(afterClaim, signal);
      if (!savedClaim.intent || canonicalJson(savedClaim.intent) !== canonicalJson(intent) || savedClaim.receipt) cellV3Fail("CELL_BIRTH_DRAIN_CLAIM_READBACK_DRIFT");
      const boundaryStack = await stack(afterClaim), boundaryDrain = await predecessor(boundaryStack);
      if (!boundaryStack.completePaidStack || canonicalJson(boundaryDrain.event) !== canonicalJson(intent.event)) cellV3Fail("CELL_BIRTH_PREINVOKE_PLAN_DRIFT");
      // Read registry again after potentially slow CFN/authority evidence.
      await sameRegistration(); signal.throwIfAborted(); const attemptedAt = clock();
      if (boundaryStack.observedAt > attemptedAt || attemptedAt - boundaryStack.observedAt > 30000) cellV3Fail("CELL_BIRTH_PREINVOKE_EVIDENCE_STALE");
      let resultSha256: string | null = null;
      try { const raw = await invokeDrain(intent.event, signal); signal.throwIfAborted(); resultSha256 = await sha256Hex(drainResult(raw, intent)); }
      catch { /* No raw provider error or secret material is persisted; no Invoke retry. */ }
      const receipt = await compileCellBirthDrainReceiptV3(intent, resultSha256 ? "RETURNED_REQUIRES_FRESH_CENSUS" : "INVOCATION_UNCERTAIN_INSPECT_ONLY", resultSha256, attemptedAt, clock());
      if (signal.aborted) return result("DRAIN_ATTEMPTED_JOURNAL_RECOVERY_REQUIRED", { drainInvocationAttempted: true });
      const published = await journal.publishReceiptOnce(claim, receipt, signal);
      if (!published) return result("DRAIN_RECEIPT_UNCERTAIN_INSPECT_ONLY", { drainInvocationAttempted: true });
      const final = await sameRegistration(), observed = await journal.readStrong(final, signal);
      if (!observed.receipt || canonicalJson(observed.receipt) !== canonicalJson(receipt)) cellV3Fail("CELL_BIRTH_DRAIN_RECEIPT_READBACK_DRIFT");
      return result(receipt.outcome, { receipt: observed.receipt, drainInvocationAttempted: true });
    },
  });
}
