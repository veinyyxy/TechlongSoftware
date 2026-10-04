import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeInstant, probeSame } from "./arn-compatibility-probe-workflow.ts";
import { sanitizeArnProbeFailure } from "./arn-compatibility-probe-diagnostics.ts";
import { ARN_PROBE_READ_COMPARISON_ANCHORS, assertArnProbeReadComparisonPredecessor,
  type ArnProbeReadComparisonPredecessor } from "./arn-compatibility-probe-read-comparison.ts";
import { arnProbeComparisonFence, assertArnProbeComparisonClaim, type recoverArnProbeComparisonCreate } from "./arn-probe-read-comparison-create.ts";

/** A closed, exact generation; not a configurable retirement/deletion service. */
export const READ_COMPARISON_RETIREMENT = Object.freeze({
  stage: "B5-J5g-j19-retirement", targetFenceKey: ARN_PROBE_READ_COMPARISON_ANCHORS.targetFenceKey,
  creationReviewSha256: "5fe8ada96f680dd0e50c249f1caa274c2a76ea155123a50ba77faef473675b69",
  planSha256: "d63f0ebce61f518b8ac493357f93bc08e49531947008c14f2d6fcaaad0278087",
  requestSha256: "a4ec882ee50f01e84b6a41214b3b27b476abc0f6f0d3255cc78bc2e6b0e3d9a3",
  claimSha256: "3f06d253646d29d77d7a9045cdb1a28098b442b1cc58ee9ca65c130b2186a71a",
  creationReceiptSha256: "2463973b6670bb1ac1d5f3c164131e41e26903b95628f50786a14345a12aad0c",
  recoveryReceiptSha256: "9e7c3c13212b52092e5ca819372a646cbadb4f147ead45d771755d17f02d6a46",
  closureReceiptSha256: "828fb18e57a6e8f3615a41e444f704f227596cfb931945284cd79204ab18de9a",
  grantTemplateSha256: "8352b93986b84cbd11f46acb8e7e8aec33b6958c339a65b34d25de5cb5a3bdb2",
  lockedObservationSha256: "a253b5b795848d68cb3da346572c8b778bf283f14f80b6f6eb8ae4538396f592",
  policyExpiresAt: "2026-10-04T04:46:25.991Z",
  stackId: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-lifecycle-management/fb742b50-afb2-11f1-85b7-02588681429d",
  grantArn: "arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-j5gj17-read-grant-ab42ba50c3d9f4b6/84265223-0571-4770-a293-61fd4b732bdc",
  grantName: "techlong-j5gj17-read-grant-ab42ba50c3d9f4b6",
  oldSlot: `.aws-sandbox/j5gj17-read-comparison/${ARN_PROBE_READ_COMPARISON_ANCHORS.targetFenceKey}/slot-000002`,
  retirementSlot: `.aws-sandbox/j5gj19-read-retirement/${ARN_PROBE_READ_COMPARISON_ANCHORS.targetFenceKey}/slot-000002`,
});
export function retirementCopy<T>(v: T): T {
  const copy = JSON.parse(canonicalJson(v)) as T;
  function freeze(item: unknown) { if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); } }
  freeze(copy); return copy;
}
export async function retirementDigest(value: Record<string, unknown>, key: string, expected?: string) {
  const body = { ...value }, digest = body[key]; delete body[key];
  if ((expected && digest !== expected) || digest !== await sha256Hex(canonicalJson(body))) throw new Error("Retirement evidence digest drifted.");
}
export async function closedReadComparisonPredecessor(generation1: ArnProbeReadComparisonPredecessor) {
  assertArnProbeReadComparisonPredecessor(generation1);
  const body = { schemaVersion: 1, generation1, generation2: READ_COMPARISON_RETIREMENT,
    slotFiles: ["claim.json"], workflowIntentCount: 0, replayAllowed: false, oldRecordsPreserved: true };
  return retirementCopy({ ...body, predecessorSha256: await sha256Hex(canonicalJson(body)) });
}
export type ClosedReadComparisonPredecessor = Awaited<ReturnType<typeof closedReadComparisonPredecessor>>;
export async function assertClosedReadComparisonPredecessor(v: ClosedReadComparisonPredecessor) {
  probeSame(v, await closedReadComparisonPredecessor(v.generation1), "Exact closed generation2 predecessor");
}
export type RetirementInventory = Readonly<{ stackId: string; changeSetArns: readonly string[]; complete: true;
  providerEvidenceSha256: string; observedAt: string }>;
export type RetirementObservation = Readonly<{ inventoryBefore: RetirementInventory;
  recovery: Awaited<ReturnType<typeof recoverArnProbeComparisonCreate>>; inventoryAfter: RetirementInventory }>;
function fresh(at: string, now: number) { const age = now - probeInstant(at); if (age < 0 || age > 60_000) throw new Error("Retirement Source evidence is stale."); }
export async function assertRetirementObservation(v: RetirementObservation, state: "PRESENT" | "MISSING", at: number) {
  probeSame(Object.keys(v).sort(), ["inventoryAfter", "inventoryBefore", "recovery"], "Retirement observation fields");
  const r = READ_COMPARISON_RETIREMENT, recovery = v.recovery;
  await retirementDigest(recovery, "receiptSha256"); fresh(recovery.observedAt, at);
  const o = recovery.observation;
  probeSame(Object.keys(o).sort(), ["fixtureAfter", "fixtureBefore", "grant", "managementAfter", "managementBefore"], "Retirement recovery observation fields");
  probeSame(recovery, { stage: "B5-J5g-j17", mode: "READ_ONLY_RECOVER", reviewSha256: r.creationReviewSha256, claim: recovery.claim,
    observation: o, outcome: state === "PRESENT" ? "READY_UNEXECUTED" : "MISSING_SLOT_CONSUMED", mutationPerformed: false,
    retryAuthorized: false, grantExecutionAuthorized: false, operatorReadAuthorized: false, probeDeletionAuthorized: false,
    productionCompatibilityVerified: false, runtimeEnabled: false, observedAt: recovery.observedAt, receiptSha256: recovery.receiptSha256 }, "Sanitized recovery receipt fields");
  await assertArnProbeComparisonClaim(recovery.claim, await arnProbeComparisonFence(await predecessorGeneration1()));
  if (recovery.reviewSha256 !== r.creationReviewSha256 || recovery.claim.claimSha256 !== r.claimSha256 ||
    recovery.stage !== "B5-J5g-j17" || recovery.mode !== "READ_ONLY_RECOVER" || recovery.mutationPerformed !== false ||
    recovery.retryAuthorized !== false || recovery.grantExecutionAuthorized !== false || recovery.operatorReadAuthorized !== false ||
    recovery.probeDeletionAuthorized !== false || recovery.productionCompatibilityVerified !== false || recovery.runtimeEnabled !== false ||
    recovery.outcome !== (state === "PRESENT" ? "READY_UNEXECUTED" : "MISSING_SLOT_CONSUMED")) throw new Error("Retirement requires the anchored unexecuted generation2 claim.");
  for (const m of [o.managementBefore, o.managementAfter]) {
    fresh(m.observedAt, at);
    if (await sha256Hex(canonicalJson({ ...m, observedAt: null })) !== r.lockedObservationSha256) throw new Error("Retirement requires the full original Locked/v5 IAM snapshot.");
  }
  for (const f of [o.fixtureBefore, o.fixtureAfter]) {
    fresh(f.observedAt, at);
    probeSame({ ...f, observedAt: null }, { state: "READY_UNEXECUTED", resourceCount: 0, observedAt: null,
      stackId: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-arn-compatibility-probe/e5fcb450-bf3d-11f1-8f15-02cdaaa60ec7",
      changeSetArn: "arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-sandbox-arn-compatibility-probe-08b7955eb7029b3a/ffac6957-44d4-4485-9d08-d018a0be3f11",
      templateCanonicalSha256: "00bba9b57a32c6b777a2afb1079f8303821e550162fc720af69099c6d301ba75" }, "Original fixture preserved");
  }
  fresh(o.grant.observedAt, at);
  probeSame(Object.keys(o.grant).sort(), state === "PRESENT" ? ["changeSetArn", "observedAt", "providerEvidenceSha256", "stackId", "state", "templateCanonicalSha256"] : ["observedAt", "proof", "state"], "Sanitized Grant observation fields");
  if (state === "PRESENT") {
    if (o.grant.state !== "READY_UNEXECUTED" || o.grant.stackId !== r.stackId || o.grant.changeSetArn !== r.grantArn ||
      o.grant.templateCanonicalSha256 !== r.grantTemplateSha256 || !/^[a-f0-9]{64}$/.test(o.grant.providerEvidenceSha256)) throw new Error("Only the exact old unexecuted Grant may retire.");
  } else if (o.grant.state !== "MISSING" || o.grant.proof !== "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY") throw new Error("Independent complete absence proof required.");
  for (const inv of [v.inventoryBefore, v.inventoryAfter]) {
    fresh(inv.observedAt, at);
    probeSame(Object.keys(inv).sort(), ["changeSetArns", "complete", "observedAt", "providerEvidenceSha256", "stackId"], "Complete retirement inventory fields");
    if (inv.complete !== true || inv.stackId !== r.stackId || !/^[a-f0-9]{64}$/.test(inv.providerEvidenceSha256)) throw new Error("Incomplete retirement inventory.");
    probeSame(inv.changeSetArns, state === "PRESENT" ? [r.grantArn] : [], "No competing management Change Sets, even terminal ones");
  }
}
async function predecessorGeneration1(): Promise<ArnProbeReadComparisonPredecessor> {
  const { ARN_PROBE_CONSUMED_SLOT_FILES } = await import("./arn-compatibility-probe-read-comparison.ts");
  return { anchors: ARN_PROBE_READ_COMPARISON_ANCHORS, consumedGeneration: 1,
    consumedSlotRelativePath: `.aws-sandbox/j5gj13-arn-probe/${ARN_PROBE_READ_COMPARISON_ANCHORS.targetFenceKey}/slot-000001`,
    slotFiles: ARN_PROBE_CONSUMED_SLOT_FILES, consumed: true, probeDeleteIntentPresent: false, replayAllowed: false };
}
const retirementRequest = () => ({ StackName: READ_COMPARISON_RETIREMENT.stackId, ChangeSetName: READ_COMPARISON_RETIREMENT.grantArn });
export async function compileReadComparisonRetirement(input: { predecessor: ClosedReadComparisonPredecessor;
  observation: RetirementObservation; reviewedAt: string; expiresAt: string }) {
  probeSame(Object.keys(input).sort(), ["expiresAt", "observation", "predecessor", "reviewedAt"], "Retirement manifest input");
  await assertClosedReadComparisonPredecessor(input.predecessor);
  const start = probeInstant(input.reviewedAt), end = probeInstant(input.expiresAt);
  if (start < probeInstant(READ_COMPARISON_RETIREMENT.policyExpiresAt) || end <= start || end - start > 300_000) throw new Error("Retirement needs an expired old policy and a fresh five-minute approval.");
  await assertRetirementObservation(input.observation, "PRESENT", start);
  const request = retirementRequest();
  const body = { schemaVersion: 1, stage: READ_COMPARISON_RETIREMENT.stage, input, request,
    requestSha256: await sha256Hex(canonicalJson(request)), requiredPhrase: "I_CONFIRM_J5GJ19_RETIRE_EXACT_UNEXECUTED_GENERATION2_GRANT_ONLY",
    allowedWriteActions: ["cloudformation:DeleteChangeSet"], maxSubmissions: 1, oldRecordsPreserved: true,
    originalFixtureDeletionAllowed: false, stackDeletionAllowed: false, iamMutationAllowed: false,
    grantExecutionAllowed: false, creationAllowed: false, retryAllowed: false,
    productionCompatibilityVerified: false, runtimeEnabled: false };
  return retirementCopy({ ...body, manifestSha256: await sha256Hex(canonicalJson(body)) });
}
export type ReadComparisonRetirementManifest = Awaited<ReturnType<typeof compileReadComparisonRetirement>>;
export async function assertReadComparisonRetirement(v: ReadComparisonRetirementManifest) {
  probeSame(v, await compileReadComparisonRetirement(v.input), "Exact singleton retirement manifest");
}
export async function makeRetirementIntent(manifest: ReadComparisonRetirementManifest, reservedAt: string, preflight: RetirementObservation) {
  await assertReadComparisonRetirement(manifest);
  const at = probeInstant(reservedAt);
  if (at < probeInstant(manifest.input.reviewedAt) || at >= probeInstant(manifest.input.expiresAt)) throw new Error("Retirement approval expired before durable intent.");
  await assertRetirementObservation(preflight, "PRESENT", at);
  const body = { schemaVersion: 1, action: "RETIRE_GENERATION2_BEFORE_SINGLE_DELETE", manifest, preflight, reservedAt };
  return retirementCopy({ ...body, intentSha256: await sha256Hex(canonicalJson(body)) });
}
export type RetirementIntent = Awaited<ReturnType<typeof makeRetirementIntent>>;
export async function assertRetirementIntent(v: RetirementIntent) { probeSame(v, await makeRetirementIntent(v.manifest, v.reservedAt, v.preflight), "Retirement permanent intent"); }
export interface RetirementLedger { read(): Promise<RetirementIntent | null>; reserve(v: RetirementIntent): Promise<void>; }
type Ports = { readPredecessor(): Promise<ClosedReadComparisonPredecessor>; observe(signal: AbortSignal): Promise<RetirementObservation>;
  ledger: RetirementLedger; now?: () => number };
export async function reviewReadComparisonRetirement(p: Ports & { signal: AbortSignal }) {
  const now = p.now ?? Date.now, started = now(), predecessor = await p.readPredecessor();
  if (await p.ledger.read()) throw new Error("Retirement slot consumed; use read-only Inspect, never replay.");
  const observation = await p.observe(p.signal); p.signal.throwIfAborted();
  if (now() < started || now() - started > 90_000) throw new Error("Retirement read exceeded its bound.");
  probeSame(await p.readPredecessor(), predecessor, "Retirement archive stable");
  const issued = now();
  return compileReadComparisonRetirement({ predecessor, observation, reviewedAt: new Date(issued).toISOString(), expiresAt: new Date(issued + 300_000).toISOString() });
}
export async function retireReviewedReadComparison(p: Ports & { manifest: ReadComparisonRetirementManifest; approvedManifestSha256: string;
  executionPhrase: string; acknowledgeDeletionIrreversible: boolean; acknowledgeLowCostNotZero: boolean;
  signal: AbortSignal; deleteChangeSet(request: ReadComparisonRetirementManifest["request"], signal: AbortSignal): Promise<unknown> }) {
  const m = retirementCopy(p.manifest), now = p.now ?? Date.now; await assertReadComparisonRetirement(m);
  const live = () => { if (now() < probeInstant(m.input.reviewedAt) || now() >= probeInstant(m.input.expiresAt)) throw new Error("Retirement approval expired. No automatic refresh."); };
  if (p.approvedManifestSha256 !== m.manifestSha256 || p.executionPhrase !== m.requiredPhrase || p.acknowledgeDeletionIrreversible !== true || p.acknowledgeLowCostNotZero !== true) throw new Error("Exact new retirement approval required.");
  live(); p.signal.throwIfAborted(); if (await p.ledger.read()) throw new Error("Retirement already consumed; never replay deletion.");
  probeSame(await p.readPredecessor(), m.input.predecessor, "Retirement current old records");
  const observation = await p.observe(p.signal); await assertRetirementObservation(observation, "PRESENT", now());
  probeSame(await p.readPredecessor(), m.input.predecessor, "Retirement old records after preflight");
  live(); p.signal.throwIfAborted();
  const intent = await makeRetirementIntent(m, new Date(now()).toISOString(), observation); await p.ledger.reserve(intent);
  probeSame(await p.ledger.read(), intent, "Retirement fsync/readback before deletion");
  let deletionAttempted = false; const failures: ReturnType<typeof sanitizeArnProbeFailure>[] = [];
  try { live(); p.signal.throwIfAborted(); deletionAttempted = true;
    await p.deleteChangeSet(m.request, AbortSignal.any([p.signal, AbortSignal.timeout(30_000)]));
  } catch (e) { failures.push(sanitizeArnProbeFailure(e, "ENTRY", now)); }
  // Submission is not retirement proof. Inspect must run through a separate read-only entry.
  const body = { stage: READ_COMPARISON_RETIREMENT.stage, mode: "RETIRE_REVIEWED", manifestSha256: m.manifestSha256,
    intentSha256: intent.intentSha256, deletionAttempted, failures, independentInspectionRequired: true,
    outcome: deletionAttempted ? "DELETE_SUBMISSION_REQUIRES_INSPECT" : "NO_DELETE_SUBMITTED_SLOT_CONSUMED",
    retryAllowed: false, productionCompatibilityVerified: false, runtimeEnabled: false, observedAt: new Date(now()).toISOString() };
  return { ...body, receiptSha256: await sha256Hex(canonicalJson(body)) };
}
export async function inspectReadComparisonRetirement(p: Ports & { signal: AbortSignal }) {
  const now = p.now ?? Date.now, started = now(), predecessor = await p.readPredecessor(), intent = await p.ledger.read();
  if (!intent) throw new Error("No durable retirement intent; external absence cannot authorize generation3.");
  await assertRetirementIntent(intent); probeSame(intent.manifest.input.predecessor, predecessor, "Retirement inspection predecessor");
  const observation = await p.observe(p.signal); p.signal.throwIfAborted();
  const state = observation.recovery.observation.grant.state === "MISSING" ? "MISSING" : "PRESENT";
  await assertRetirementObservation(observation, state, now());
  if (now() < started || now() - started > 90_000 || now() < probeInstant(intent.reservedAt)) throw new Error("Retirement inspection chronology drifted.");
  probeSame(await p.readPredecessor(), predecessor, "Retirement inspection preserved archives"); probeSame(await p.ledger.read(), intent, "Retirement inspection intent stability");
  const body = { stage: READ_COMPARISON_RETIREMENT.stage, mode: "INDEPENDENT_READ_ONLY_INSPECT", intent, observation,
    outcome: state === "MISSING" ? "RETIRED_LOCKED_VERIFIED" : "RETIREMENT_UNPROVED", mutationPerformed: false,
    retryAllowed: false, productionCompatibilityVerified: false, runtimeEnabled: false, observedAt: new Date(now()).toISOString() };
  return retirementCopy({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
export type ReadComparisonRetirementProof = Awaited<ReturnType<typeof inspectReadComparisonRetirement>>;
export async function assertReadComparisonRetirementProof(v: ReadComparisonRetirementProof) {
  await retirementDigest(v, "receiptSha256"); await assertRetirementIntent(v.intent);
  const at = probeInstant(v.observedAt);
  if (at < probeInstant(v.intent.reservedAt)) throw new Error("Retirement proof predates its intent.");
  await assertRetirementObservation(v.observation, "MISSING", at);
  probeSame(v, { stage: READ_COMPARISON_RETIREMENT.stage, mode: "INDEPENDENT_READ_ONLY_INSPECT", intent: v.intent, observation: v.observation,
    outcome: "RETIRED_LOCKED_VERIFIED", mutationPerformed: false, retryAllowed: false, productionCompatibilityVerified: false, runtimeEnabled: false,
    observedAt: v.observedAt, receiptSha256: v.receiptSha256 }, "Independent retirement proof scope");
}
