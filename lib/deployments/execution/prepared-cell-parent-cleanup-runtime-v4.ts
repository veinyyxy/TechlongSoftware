import { sha256Hex } from "./hash.ts";
import { cellV3Clock, cellV3Fail, cellV3Freeze } from "../cloudformation/shared-cell-stack-v3.ts";
import { AwsSdkCellParentRegistryReaderV4, assertInstalledCellParentV4, type InstalledCellParentV4 } from "./aws-sdk-cell-birth-parent-v4.ts";
import { AwsSdkCellStackEvidenceV3, type CellStackSnapshotV3 } from "./aws-sdk-cell-stack-evidence-v3.ts";
import { compileFailedCellBirthFenceV1 } from "./failed-cell-birth-fence-v1.ts";
import { prepareFailedBirthDdbMarkerV1 } from "./failed-cell-birth-ddb-v1.ts";
import { NeonCellParentDatabaseV4, assertCellParentOpenDatabaseV4 } from "./neon-cell-parent-control-v4.ts";
import { AwsSdkCellParentCleanupJournalV4, compileParentTtlPredecessorV4, prepareParentDbOperationV4, consumeParentDbClaimV4,
  prepareParentDeleteAuthorityV4, prepareParentDeleteBoundaryV4, type ParentWorkflowSnapshotV4 } from "./cell-parent-cleanup-v4.ts";
import { AwsSdkCellParentDeleteV4 } from "./aws-sdk-cell-parent-delete-v4.ts";

export class PreparedCellParentCleanupRuntimeV4 {
  readonly fullCleanupRootCompleted = true;
  private readonly registry: AwsSdkCellParentRegistryReaderV4; private readonly stack: AwsSdkCellStackEvidenceV3;
  private readonly journal: AwsSdkCellParentCleanupJournalV4; private readonly deleter: AwsSdkCellParentDeleteV4;
  private readonly load: (parent: InstalledCellParentV4, signal: AbortSignal) => Promise<NeonCellParentDatabaseV4>; private readonly now: () => number;
  constructor(input: { registry: AwsSdkCellParentRegistryReaderV4; stack: AwsSdkCellStackEvidenceV3; journal: AwsSdkCellParentCleanupJournalV4; deleter: AwsSdkCellParentDeleteV4;
    loadDatabase: (parent: InstalledCellParentV4, signal: AbortSignal) => Promise<NeonCellParentDatabaseV4>; now?: () => number }) {
    if (!(input.registry instanceof AwsSdkCellParentRegistryReaderV4) || !(input.stack instanceof AwsSdkCellStackEvidenceV3) || !(input.journal instanceof AwsSdkCellParentCleanupJournalV4) || !(input.deleter instanceof AwsSdkCellParentDeleteV4) || typeof input.loadDatabase !== "function") cellV3Fail("CELL_PARENT_CLEANUP_RUNTIME_CAPABILITIES_INVALID");
    this.registry = input.registry; this.stack = input.stack; this.journal = input.journal; this.deleter = input.deleter; this.load = input.loadDatabase; this.now = input.now ?? Date.now;
  }
  private result(outcome: string, extra: Record<string, unknown> = {}) { return cellV3Freeze({ schemaVersion: 4, mode: "prepared_not_installed", outcome,
    cloudRuntimeInstalled: false, fullCleanupRootCompleted: true, tenantRuntimeEnabled: false, retryAuthorized: false, deleteInvocationAttempted: false, ...extra }); }
  async run(original: InstalledCellParentV4, signal: AbortSignal) {
    let parent = original; const psha = original.record.parentSha256;
    const refresh = async () => { const p = await this.registry.readStrong(signal); if (!p || p.record.parentSha256 !== psha) cellV3Fail("CELL_PARENT_CLEANUP_APPROVAL_DRIFT"); parent = p; return p; };
    const workflow = () => this.journal.read(parent, signal);
    const stack = async () => { const s = await this.stack.read(parent.record.manifest.plan, parent.record.manifest.delegation.stackId, signal); if (!("protocol" in s)) cellV3Fail("CELL_PARENT_CLEANUP_EXPECTED_STACK_MISSING"); return s as CellStackSnapshotV3; };
    const recover = async (s: ParentWorkflowSnapshotV4, attempted = false) => {
      // No secret/Neon reload or actuator replay is needed for CFN attribution.
      if (s.deleteReceipt) return this.result("IMMUTABLE_DELETE_RECEIPT_REPLAYED", { receiptSha256: s.deleteReceipt.receiptSha256, receiptOutcome: s.deleteReceipt.outcome });
      try { const observed = await this.deleter.inspect(s, signal);
        if (["DELETE_COMPLETE_TOKEN_MATCHED", "DELETE_FAILED_TOKEN_MATCHED"].includes(observed.outcome)) {
          if (!attempted) return this.result(observed.outcome, { observationSha256: observed.observationSha256, terminalReceiptWriteAttempted: false });
          const saved = await this.journal.writeObservedReceiptOnce(s, observed, signal); return this.result(saved ? observed.outcome : "DELETE_RECEIPT_UNCERTAIN_INSPECT_ONLY", { deleteInvocationAttempted: attempted, observationSha256: observed.observationSha256 });
        }
        return this.result("DELETE_SLOT_OCCUPIED_READONLY_INSPECT", { deleteInvocationAttempted: attempted, observationOutcome: observed.outcome });
      } catch { return this.result("DELETE_SLOT_OCCUPIED_RECOVERY_REQUIRES_REVIEW", { deleteInvocationAttempted: attempted }); }
    };
    let saved = await workflow(); if (saved.deleteIntent) return recover(saved);
    assertInstalledCellParentV4(parent, cellV3Clock(this.now()), true);
    let current = await stack();
    if (!current.failedCreationOrPhase && (!current.completePaidStack || this.now() < Date.parse(current.cellExpiresAt))) return this.result("CLEANUP_NOT_DUE_OR_NONPAID", { mutationPerformed: false });
    const db = await this.load(parent, signal); if (!(db instanceof NeonCellParentDatabaseV4)) cellV3Fail("CELL_PARENT_CLEANUP_DATABASE_CLASS_REQUIRED");
    if (!saved.dbOperation) {
      const kind = current.failedCreationOrPhase ? "failed" : "ttl";
      if (kind === "failed" && parent.provision) return this.result("FAILED_PUBLISHED_CELL_REQUIRES_SEPARATE_REVIEW");
      const open = await db.readOpen(signal, kind === "failed"); assertCellParentOpenDatabaseV4(open, this.now(), kind === "failed");
      const value = kind === "failed" ? (await compileFailedCellBirthFenceV1({ plan: parent.record.manifest.plan, failure: current,
        environmentIdentitySha256: open.environmentIdentitySha256, expectedAdmissionEpoch: 0, now: this.now() })).intent : await compileParentTtlPredecessorV4(parent, current, this.now());
      const op = await prepareParentDbOperationV4(parent, kind, value, this.now()); saved = await workflow(); const claim = await this.journal.claimDatabaseOnce(saved, op, signal);
      if (!claim) return this.result("DATABASE_SLOT_NOT_OWNED_INSPECT_ONLY");
      await refresh(); saved = await workflow(); current = await stack(); const boundaryOpen = await db.readOpen(signal, kind === "failed");
      const operation = consumeParentDbClaimV4(claim, saved, current, boundaryOpen, this.now());
      let hash: string | null = null;
      try { if (operation.kind === "failed") { const sha = await sha256Hex(operation.fence); const r = await db.failedWriter.installOnce({ intent: operation.fence!, approvedFenceSha256: sha, signal });
          if (r.outcome === "FENCE_SUBMITTED_REQUIRES_INDEPENDENT_CERTIFIED_READ") hash = await sha256Hex(r);
        } else hash = await sha256Hex(await db.drainAndQueueOnce(operation.predecessor!, signal)); }
      catch { /* private diagnostics are never journaled or returned */ }
      if (signal.aborted) return this.result("DATABASE_ATTEMPTED_INSPECT_ONLY");
      saved = await workflow(); if (!saved.dbReceipt) await this.journal.writeDbReceiptOnce(saved, hash ? "RETURNED_REQUIRES_READ" : "UNCERTAIN_INSPECT_ONLY", hash, signal);
    }
    saved = await workflow(); if (!saved.dbOperation) cellV3Fail("CELL_PARENT_DATABASE_INTENT_READBACK_MISSING"); const op = saved.dbOperation;
    // Lost DB response may be recovered through real current certified reads;
    // the DB operation itself is NEVER reissued on restart.
    const zero = async () => op.kind === "failed" ? db.readFailedZero({ intent: op.fence!, fenceSha256: await sha256Hex(op.fence), signal }) : db.readTtlZero(op.predecessor!, signal);
    let certified;
    try { certified = await zero(); } catch { return this.result("DATABASE_OR_TENANT_WORK_NOT_CERTIFIED_ZERO_INSPECT_ONLY"); }
    current = await stack();
    if (!saved.authority) {
      if (saved.issuanceIntent) return this.result("ISSUANCE_SLOT_OCCUPIED_NO_PUBLICATION_RETRY");
      const marker = op.kind === "failed" ? await prepareFailedBirthDdbMarkerV1({ plan: parent.record.manifest.plan, failure: current, zero: certified as Awaited<ReturnType<NeonCellParentDatabaseV4["readFailedZero"]>>, now: this.now() }) : null;
      const authority = await prepareParentDeleteAuthorityV4(parent, op, current, certified, this.now()), claim = await this.journal.claimIssuanceOnce(saved, authority, marker, signal);
      if (!claim) return this.result("ISSUANCE_SLOT_NOT_OWNED_INSPECT_ONLY");
      await refresh(); saved = await workflow(); current = await stack(); certified = await zero();
      await this.journal.publishIssuanceOnce(claim, saved, current, certified, signal);
      saved = await workflow(); if (!saved.authority || saved.authority.authoritySha256 !== authority.authoritySha256) return this.result("DELETE_AUTHORITY_UNCERTAIN_INSPECT_ONLY");
    }
    await refresh(); saved = await workflow(); if (saved.deleteIntent) return recover(saved);
    current = await stack(); certified = await zero(); const before = await prepareParentDeleteBoundaryV4(saved, current, certified, this.now());
    const claim = await this.journal.claimDeleteOnce(before, signal); if (!claim) return this.result("DELETE_SLOT_NOT_OWNED_INSPECT_ONLY");
    // Current approval, exact stored intent, Stack and certified DB are all
    // re-collected after ownership was durably claimed, immediately before Send.
    await refresh(); saved = await workflow(); current = await stack(); certified = await zero();
    const boundary = await prepareParentDeleteBoundaryV4(saved, current, certified, this.now()), submission = await this.deleter.executeOnce(claim, boundary, signal);
    if (signal.aborted) return this.result(submission.outcome, { deleteInvocationAttempted: true });
    saved = await workflow(); return recover(saved, true);
  }
}
