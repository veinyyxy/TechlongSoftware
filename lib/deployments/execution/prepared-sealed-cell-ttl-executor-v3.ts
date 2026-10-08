import { canonicalJson, sha256Hex } from "./hash.ts";
import { collectSealedCellStackEvidenceV3, confirmSealedCellStackMissingV3, type SealedCellStackReadPortV3,
  type SharedCellCleanupDeleteStackPort } from "./shared-cell-cleanup-deletion.ts";
import { SealedCellAuthorityOwnershipEvidenceAdapterV3, sealedCellOwnershipStateV3,
  type CertifiedSealedCellOwnershipSourceV3 } from "./sealed-cell-cleanup-evidence-v3.ts";
import { SEALED_CELL_EXECUTOR_ROLE_V3, SEALED_CELL_EXECUTOR_PROTOCOL_V3, decodeSealedCellAuthorityRecordV3,
  assertSealedCellAuthorityActiveV3, sealedV3Keys as keys, sealedV3Freeze as freeze, sealedV3Fail as fail,
  type SealedCellAuthorityRecordV3, type StrongSealedCellAuthorityReadPortV3, type SealedOwnershipStateV3 } from "./sealed-cell-cleanup-authority-v3.ts";

export interface SealedCellDeletePlanV3 {
  schemaVersion: 3;
  protocol: "sealed-cell-runtime-delete-plan-v3";
  action: "delete_sealed_shared_cell_stack";
  executorRoleArn: typeof SEALED_CELL_EXECUTOR_ROLE_V3;
  executorIdentityProtocol: typeof SEALED_CELL_EXECUTOR_PROTOCOL_V3;
  authorityRecord: SealedCellAuthorityRecordV3;
  ownershipState: SealedOwnershipStateV3;
  stackId: string;
  cloudFormationRoleArn: "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole";
  deletionMode: "STANDARD";
}
export interface SealedCellDeleteIntentV3 { schemaVersion: 3; plan: Readonly<SealedCellDeletePlanV3>; planSha256: string }
export interface SealedCellDeleteReceiptV3 { schemaVersion: 3; intent: Readonly<SealedCellDeleteIntentV3>; outcome: "DELETED" | "RECOVERED"; mutationAttempted: boolean }
export interface SealedCellCleanupJournalV3 {
  readStrong(input: { planSha256: string; signal: AbortSignal }): Promise<{ intent: unknown | null; receipt: unknown | null }>;
  claimIntent(input: { intent: Readonly<SealedCellDeleteIntentV3>; signal: AbortSignal }): Promise<boolean>;
  publishReceipt(input: { receipt: Readonly<SealedCellDeleteReceiptV3>; signal: AbortSignal }): Promise<void>;
}
function digest(v: unknown): asserts v is string { if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v)) fail("SEALED_V3_PLAN_SHA_INVALID"); }
function clock(now: () => number) { const n = now(); if (!Number.isSafeInteger(n) || n <= 0) fail("SEALED_V3_CLOCK_INVALID"); return n; }
function dataClone<T>(v: T): T { try { return JSON.parse(canonicalJson(v)); } catch { return fail("SEALED_V3_JSON_INVALID"); } }

function planForAuthority(record: SealedCellAuthorityRecordV3): Readonly<SealedCellDeletePlanV3> {
  return freeze({ schemaVersion: 3, protocol: "sealed-cell-runtime-delete-plan-v3", action: "delete_sealed_shared_cell_stack",
    executorRoleArn: SEALED_CELL_EXECUTOR_ROLE_V3, executorIdentityProtocol: SEALED_CELL_EXECUTOR_PROTOCOL_V3,
    authorityRecord: record, ownershipState: record.candidate.ownershipState, stackId: record.candidate.predecessor.stackId,
    cloudFormationRoleArn: record.candidate.predecessor.cloudFormationRoleArn, deletionMode: "STANDARD" });
}
export async function validateSealedCellDeleteIntentV3(value: unknown, planSha256: string, certificateSha256: string): Promise<Readonly<SealedCellDeleteIntentV3>> {
  digest(planSha256);
  const intent = dataClone(value) as SealedCellDeleteIntentV3;
  if (!keys(intent, ["schemaVersion", "plan", "planSha256"]) || intent.schemaVersion !== 3 || intent.planSha256 !== planSha256 ||
    !keys(intent.plan, ["schemaVersion", "protocol", "action", "executorRoleArn", "executorIdentityProtocol", "authorityRecord", "ownershipState", "stackId", "cloudFormationRoleArn", "deletionMode"]))
    fail("SEALED_V3_JOURNAL_INTENT_INVALID");
  const record = await decodeSealedCellAuthorityRecordV3(intent.plan.authorityRecord, certificateSha256);
  if (canonicalJson(intent.plan) !== canonicalJson(planForAuthority(record)) || await sha256Hex(intent.plan) !== planSha256)
    fail("SEALED_V3_JOURNAL_PLAN_MISMATCH"); return freeze(intent);
}
export async function validateSealedCellDeleteReceiptV3(value: unknown, planSha256: string, certificateSha256: string): Promise<Readonly<SealedCellDeleteReceiptV3>> {
  const receipt = dataClone(value) as SealedCellDeleteReceiptV3;
  if (!keys(receipt, ["schemaVersion", "intent", "outcome", "mutationAttempted"]) || receipt.schemaVersion !== 3 ||
    !["DELETED", "RECOVERED"].includes(receipt.outcome) || typeof receipt.mutationAttempted !== "boolean" ||
    (receipt.outcome === "DELETED" && receipt.mutationAttempted !== true)) fail("SEALED_V3_JOURNAL_RECEIPT_INVALID");
  await validateSealedCellDeleteIntentV3(receipt.intent, planSha256, certificateSha256); return freeze(receipt);
}

export interface PreparedSealedCellTtlExecutorInputV3 {
  stack: SealedCellStackReadPortV3;
  source: CertifiedSealedCellOwnershipSourceV3;
  certificateSha256: string;
  authority: StrongSealedCellAuthorityReadPortV3;
  journal: SealedCellCleanupJournalV3;
  deleter: SharedCellCleanupDeleteStackPort;
  now?: () => number;
  readbackAttempts?: number;
  readbackDelayMs?: number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

/** Independent executable capability, uninstalled. No authority installer is exposed to this root. */
export function createPreparedSealedCellTtlExecutorV3(input: PreparedSealedCellTtlExecutorInputV3) {
  if (!keys(input, Object.keys(input).filter(k => ["stack", "source", "certificateSha256", "authority", "journal", "deleter", "now", "readbackAttempts", "readbackDelayMs", "wait"].includes(k))) ||
    !input.stack || !input.source || !input.authority || !input.journal || !input.deleter) fail("SEALED_V3_CAPABILITIES_INVALID");
  if ((input.now !== undefined && typeof input.now !== "function") ||
    (input.readbackAttempts !== undefined && (!Number.isSafeInteger(input.readbackAttempts) || input.readbackAttempts < 1 || input.readbackAttempts > 10)) ||
    (input.readbackDelayMs !== undefined && (!Number.isSafeInteger(input.readbackDelayMs) || input.readbackDelayMs < 0 || input.readbackDelayMs > 5000)) ||
    (input.wait !== undefined && typeof input.wait !== "function")) fail("SEALED_V3_READBACK_CONFIG_INVALID");
  digest(input.certificateSha256);
  const certificateSha256 = input.certificateSha256, now = input.now ?? Date.now;
  const stack = Object.freeze({ region: input.stack.region, getCallerIdentity: input.stack.getCallerIdentity.bind(input.stack),
    listStackNamesPage: input.stack.listStackNamesPage.bind(input.stack), describeCellStack: input.stack.describeCellStack.bind(input.stack),
    getOriginalTemplate: input.stack.getOriginalTemplate.bind(input.stack), listStackResourcesPage: input.stack.listStackResourcesPage.bind(input.stack) });
  const readAuthority = input.authority.readStrong.bind(input.authority);
  const journal = Object.freeze({ readStrong: input.journal.readStrong.bind(input.journal), claimIntent: input.journal.claimIntent.bind(input.journal),
    publishReceipt: input.journal.publishReceipt.bind(input.journal) });
  const deleteStack = input.deleter.deleteStack.bind(input.deleter);
  const evidence = new SealedCellAuthorityOwnershipEvidenceAdapterV3(input.source, { now });
  const readback = { ...(input.readbackAttempts === undefined ? {} : { readbackAttempts: input.readbackAttempts }),
    ...(input.readbackDelayMs === undefined ? {} : { readbackDelayMs: input.readbackDelayMs }), ...(input.wait === undefined ? {} : { wait: input.wait }) };
  async function authority(signal: AbortSignal, active: boolean) {
    signal.throwIfAborted(); const r = await decodeSealedCellAuthorityRecordV3(await readAuthority({ signal }), certificateSha256);
    signal.throwIfAborted(); if (active) assertSealedCellAuthorityActiveV3(r, clock(now)); return r;
  }
  async function ownership(record: SealedCellAuthorityRecordV3, signal: AbortSignal) {
    const proof = await evidence.readFreshZeroOwnershipEvidence({ predecessor: record.candidate.predecessor, signal });
    if (proof.snapshot.ownershipStateSha256 !== record.candidate.ownershipStateSha256 ||
      canonicalJson(sealedCellOwnershipStateV3(proof.snapshot)) !== canonicalJson(record.candidate.ownershipState)) fail("SEALED_V3_LIVE_OWNERSHIP_DRIFT");
    return proof;
  }
  async function collect(signal: AbortSignal) {
    const startedAt = clock(now), first = await authority(signal, true);
    await ownership(first, signal);
    const live = await collectSealedCellStackEvidenceV3({ evidence: stack, signal, now });
    const p = first.candidate.predecessor;
    if (live.stack.stackId !== p.stackId || live.stack.stackStatus !== p.stackStatus || live.stack.roleArn !== p.cloudFormationRoleArn ||
      live.stack.tags.ExpiresAt !== p.cellExpiresAt || live.templateCanonicalSha256 !== p.templateCanonicalSha256 ||
      live.resourceInventorySha256 !== p.resourceInventorySha256) fail("SEALED_V3_LIVE_STACK_DRIFT");
    const proof = await ownership(first, signal), last = await authority(signal, true), completedAt = clock(now);
    if (canonicalJson(first) !== canonicalJson(last) || completedAt < startedAt || completedAt - startedAt > 30_000 ||
      proof.snapshot.dbObservedAt > completedAt || completedAt - proof.snapshot.dbObservedAt > 30_000) fail("SEALED_V3_DESTRUCTIVE_BOUNDARY_DRIFT");
    const plan = planForAuthority(last), planSha256 = await sha256Hex(plan);
    const intent = await validateSealedCellDeleteIntentV3({ schemaVersion: 3, plan, planSha256 }, planSha256, certificateSha256);
    const checkedAt = clock(now);
    if (checkedAt < completedAt || checkedAt - startedAt > 30_000 || checkedAt - proof.snapshot.dbObservedAt > 30_000)
      fail("SEALED_V3_DESTRUCTIVE_BOUNDARY_DRIFT");
    assertSealedCellAuthorityActiveV3(last, checkedAt); signal.throwIfAborted();
    return { intent, checkedAt, dbObservedAt: proof.snapshot.dbObservedAt };
  }
  async function saved(planSha256: string, signal: AbortSignal) {
    const r = await journal.readStrong({ planSha256, signal }); signal.throwIfAborted();
    if (!keys(r, ["intent", "receipt"])) fail("SEALED_V3_JOURNAL_SNAPSHOT_INVALID");
    const intent = r.intent === null ? null : await validateSealedCellDeleteIntentV3(r.intent, planSha256, certificateSha256);
    const receipt = r.receipt === null ? null : await validateSealedCellDeleteReceiptV3(r.receipt, planSha256, certificateSha256);
    if (receipt && (!intent || canonicalJson(receipt.intent) !== canonicalJson(intent))) fail("SEALED_V3_RECEIPT_WITHOUT_EXACT_INTENT");
    return { intent, receipt };
  }
  async function recover(intent: SealedCellDeleteIntentV3, signal: AbortSignal) {
    const first = await authority(signal, false);
    if (canonicalJson(first) !== canonicalJson(intent.plan.authorityRecord)) fail("SEALED_V3_RECOVERY_AUTHORITY_DRIFT");
    await ownership(first, signal);
    await confirmSealedCellStackMissingV3({ evidence: stack, expectedStackId: intent.plan.stackId, signal, ...readback });
    await ownership(first, signal); const last = await authority(signal, false);
    if (canonicalJson(first) !== canonicalJson(last)) fail("SEALED_V3_RECOVERY_AUTHORITY_DRIFT");
  }
  return Object.freeze({ mode: "prepared_not_installed" as const, cloudRuntimeInstalled: false as const,
    async inspect(signal: AbortSignal) { return (await collect(signal)).intent; },
    async run(event: unknown, signal: AbortSignal) {
      if (!keys(event, ["schemaVersion", "action", "approvedDeletionPlanSha256"]) ||
        (event as Record<string, unknown>).schemaVersion !== 3 || (event as Record<string, unknown>).action !== "execute_reviewed_sealed_cell_ttl_cleanup") fail("SEALED_V3_EVENT_INVALID");
      const sha = (event as Record<string, unknown>).approvedDeletionPlanSha256; digest(sha); signal.throwIfAborted();
      const previous = await saved(sha, signal);
      const result = (receipt: SealedCellDeleteReceiptV3, replay: boolean) => freeze({ schemaVersion: 3, mode: "prepared_not_installed",
        outcome: replay ? "IMMUTABLE_RECEIPT_REPLAYED" : "DELETION_INDEPENDENTLY_VERIFIED", cloudRuntimeInstalled: false,
        historicalReceiptReplay: replay, receipt });
      if (previous.receipt) return result(previous.receipt, true);
      let intent = previous.intent, owns = false, attempted = false, responseLost = false;
      if (!intent) {
        const fresh = await collect(signal);
        if (fresh.intent.planSha256 !== sha) fail("SEALED_V3_APPROVAL_MISMATCH");
        try { owns = await journal.claimIntent({ intent: fresh.intent, signal }); } catch { signal.throwIfAborted(); return fail("SEALED_V3_SLOT_UNCERTAIN_RECOVER_ONLY"); }
        if (typeof owns !== "boolean") fail("SEALED_V3_SLOT_RESULT_INVALID");
        const observed = await saved(sha, signal);
        if (!observed.intent || canonicalJson(observed.intent) !== canonicalJson(fresh.intent)) fail("SEALED_V3_SLOT_READBACK_MISMATCH");
        if (observed.receipt) return result(observed.receipt, true); intent = observed.intent;
      }
      if (owns) {
        const boundary = await collect(signal); // After potentially slow durable CAS; no cached source evidence.
        if (boundary.intent.planSha256 !== sha || canonicalJson(boundary.intent) !== canonicalJson(intent)) fail("SEALED_V3_PREDELETE_PLAN_DRIFT");
        const delegateAt = clock(now);
        if (delegateAt < boundary.checkedAt || delegateAt - boundary.checkedAt > 30_000 || boundary.dbObservedAt > delegateAt ||
          delegateAt - boundary.dbObservedAt > 30_000) fail("SEALED_V3_PREDELETE_EVIDENCE_STALE");
        assertSealedCellAuthorityActiveV3(boundary.intent.plan.authorityRecord, delegateAt); signal.throwIfAborted(); attempted = true;
        try {
          const r = await deleteStack({ request: { StackName: intent.plan.stackId, RoleARN: intent.plan.cloudFormationRoleArn,
            ClientRequestToken: `cell-delete-${sha}`, DeletionMode: "STANDARD" }, signal });
          responseLost = !keys(r, ["operation"]) || (r as { operation: unknown }).operation !== "delete_submitted";
        } catch { signal.throwIfAborted(); responseLost = true; }
      }
      // A restart, loser, lost response or aborted attempt never gets another actuator call.
      await recover(intent, signal);
      const receipt = await validateSealedCellDeleteReceiptV3({ schemaVersion: 3, intent,
        outcome: attempted && !responseLost ? "DELETED" : "RECOVERED", mutationAttempted: attempted }, sha, certificateSha256);
      try { await journal.publishReceipt({ receipt, signal }); } catch { signal.throwIfAborted(); /* strong read, not Put retry */ }
      const final = await saved(sha, signal);
      if (!final.receipt) fail("SEALED_V3_RECEIPT_UNCERTAIN_RECOVER_ONLY"); return result(final.receipt, false);
    },
  });
}
