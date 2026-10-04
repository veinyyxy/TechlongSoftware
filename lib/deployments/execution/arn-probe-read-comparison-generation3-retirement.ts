import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeInstant, probeSame } from "./arn-compatibility-probe-workflow.ts";
import { sanitizeArnProbeFailure } from "./arn-compatibility-probe-diagnostics.ts";
import { ARN_PROBE_READ_COMPARISON_ANCHORS, assertArnProbeReadComparisonPredecessor,
  type ArnProbeReadComparisonPredecessor } from "./arn-compatibility-probe-read-comparison.ts";
import { assertReadComparisonRetirementProof as assertGeneration2Proof, type ReadComparisonRetirementProof as Generation2RetirementProof } from "./arn-probe-read-comparison-retirement.ts";
import { arnProbeComparisonFence, assertArnProbeComparisonClaim, type recoverArnProbeComparisonCreate } from "./arn-probe-read-comparison-generation3-create.ts";

/** A closed, exact generation; not a configurable retirement/deletion service. */
export const READ_COMPARISON_RETIREMENT = Object.freeze({
  stage: "B5-J5g-j20-retirement", targetFenceKey: ARN_PROBE_READ_COMPARISON_ANCHORS.targetFenceKey,
  creationReviewSha256: "45c46c35b556bf705921aed1050998d3cd08a350f4ad3ef7ff1bd59b904e866f",
  planSha256: "e3dfd74700103b2bb371849fc1eea71ba99407a35526da9bdb9a0164cddb1f98",
  requestSha256: "da04a7dd08d51c619be3125a8b2c294dc80a4ed0b0dec8186358dc576fa347ee",
  claimSha256: "c38e7a12decc82b68916c4423b39df29c7b7dbc2e0eca2b8930d5d0cc9b9660c",
  creationReceiptSha256: "92046cb69e1d97c8323a5923e4831373b08a98146ad5e291108db5ff7c87e24d",
  recoveryReceiptSha256: "9695a120d13bc5c04aa9c16b9c5e273cea41dd6f8f681827adc39737594a5516",
  closureReceiptSha256: "2b9bc87ed95a08927050781bab9e0c73979fe5022348e39dc1e625f5a17042f4",
  grantTemplateSha256: "15266ca46828cc98ca7b2f9279bf7e330a64770cef8e7a8325210b0997940d06",
  lockedObservationSha256: "a253b5b795848d68cb3da346572c8b778bf283f14f80b6f6eb8ae4538396f592",
  generation2RetirementProofSha256: "64fd0e26e7aee9d3c3a8170def5995c3e06481879c1ebbaf1ef511d7d7337497",
  executionReviewSha256: "bcc619b5af8d15a8c55c1ee7ba59d3a083ac1b93a99220f4855dd22c1ee91244",
  executionManifestSha256: "f4bd63da020ea860ffb8d93689deafe8a6d3a6035690b6fd6da4656dc927aa66",
  policyExpiresAt: "2026-10-04T14:56:04.879Z",
  stackId: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-lifecycle-management/fb742b50-afb2-11f1-85b7-02588681429d",
  grantArn: "arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-j5gj19-read-grant-5d51369f11eec775/1a1782fb-40f7-4f3f-8bd5-85a6ca05ed89",
  grantName: "techlong-j5gj19-read-grant-5d51369f11eec775",
  oldSlot: `.aws-sandbox/j5gj19-read-comparison/${ARN_PROBE_READ_COMPARISON_ANCHORS.targetFenceKey}/slot-000003`,
  retirementSlot: `.aws-sandbox/j5gj20-read-retirement/${ARN_PROBE_READ_COMPARISON_ANCHORS.targetFenceKey}/slot-000003`,
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
export async function closedReadComparisonPredecessor(generation1: ArnProbeReadComparisonPredecessor, generation2RetirementProof: Generation2RetirementProof) {
  assertArnProbeReadComparisonPredecessor(generation1);
  await assertGeneration2Proof(generation2RetirementProof);
  if (generation2RetirementProof.receiptSha256 !== READ_COMPARISON_RETIREMENT.generation2RetirementProofSha256) throw new Error("Exact independently retired generation2 proof required.");
  probeSame(generation2RetirementProof.intent.manifest.input.predecessor.generation1, generation1, "Preserved first generation");
  const body = { schemaVersion: 1, generation1, generation2RetirementProof, generation3: READ_COMPARISON_RETIREMENT,
    slotFiles: ["claim.json"], workflowIntentCount: 0, replayAllowed: false, oldRecordsPreserved: true };
  return retirementCopy({ ...body, predecessorSha256: await sha256Hex(canonicalJson(body)) });
}
export type ClosedReadComparisonPredecessor = Awaited<ReturnType<typeof closedReadComparisonPredecessor>>;
export async function assertClosedReadComparisonPredecessor(v: ClosedReadComparisonPredecessor) {
  probeSame(v, await closedReadComparisonPredecessor(v.generation1, v.generation2RetirementProof), "Exact closed generation3 predecessor");
}
export type RetirementInventory = Readonly<{ stackId: string; changeSetArns: readonly string[]; complete: true;
  providerEvidenceSha256: string; observedAt: string }>;
export type RetirementObservation = Readonly<{ inventoryBefore: RetirementInventory;
  recovery: Awaited<ReturnType<typeof recoverArnProbeComparisonCreate>>; inventoryAfter: RetirementInventory }>;
function fresh(at: string, now: number) { const age = now - probeInstant(at); if (age < 0 || age > 60_000) throw new Error("Retirement Source evidence is stale."); }
export async function assertRetirementObservation(v: RetirementObservation, state: "PRESENT" | "MISSING", at: number, predecessor: ClosedReadComparisonPredecessor) {
  probeSame(Object.keys(v).sort(), ["inventoryAfter", "inventoryBefore", "recovery"], "Retirement observation fields");
  await assertClosedReadComparisonPredecessor(predecessor);
  const r = READ_COMPARISON_RETIREMENT, recovery = v.recovery;
  await retirementDigest(recovery, "receiptSha256"); fresh(recovery.observedAt, at);
  const o = recovery.observation;
  probeSame(Object.keys(o).sort(), ["fixtureAfter", "fixtureBefore", "grant", "managementAfter", "managementBefore"], "Retirement recovery observation fields");
  probeSame(recovery, { stage: "B5-J5g-j19", mode: "READ_ONLY_RECOVER", reviewSha256: r.creationReviewSha256, claim: recovery.claim,
    observation: o, outcome: state === "PRESENT" ? "READY_UNEXECUTED" : "MISSING_SLOT_CONSUMED", mutationPerformed: false,
    retryAuthorized: false, grantExecutionAuthorized: false, operatorReadAuthorized: false, probeDeletionAuthorized: false,
    productionCompatibilityVerified: false, runtimeEnabled: false, observedAt: recovery.observedAt, receiptSha256: recovery.receiptSha256 }, "Sanitized recovery receipt fields");
  await assertArnProbeComparisonClaim(recovery.claim, await arnProbeComparisonFence(predecessor.generation1, predecessor.generation2RetirementProof));
  if (recovery.reviewSha256 !== r.creationReviewSha256 || recovery.claim.claimSha256 !== r.claimSha256 ||
    recovery.stage !== "B5-J5g-j19" || recovery.mode !== "READ_ONLY_RECOVER" || recovery.mutationPerformed !== false ||
    recovery.retryAuthorized !== false || recovery.grantExecutionAuthorized !== false || recovery.operatorReadAuthorized !== false ||
    recovery.probeDeletionAuthorized !== false || recovery.productionCompatibilityVerified !== false || recovery.runtimeEnabled !== false ||
    recovery.outcome !== (state === "PRESENT" ? "READY_UNEXECUTED" : "MISSING_SLOT_CONSUMED")) throw new Error("Retirement requires the anchored unexecuted generation3 claim.");
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
const retirementRequest = () => ({ StackName: READ_COMPARISON_RETIREMENT.stackId, ChangeSetName: READ_COMPARISON_RETIREMENT.grantArn });
export async function compileReadComparisonRetirement(input: { predecessor: ClosedReadComparisonPredecessor;
  observation: RetirementObservation; reviewedAt: string; expiresAt: string }) {
  probeSame(Object.keys(input).sort(), ["expiresAt", "observation", "predecessor", "reviewedAt"], "Retirement manifest input");
  await assertClosedReadComparisonPredecessor(input.predecessor);
  const start = probeInstant(input.reviewedAt), end = probeInstant(input.expiresAt);
  if (start < probeInstant(READ_COMPARISON_RETIREMENT.policyExpiresAt) || end <= start || end - start > 300_000) throw new Error("Retirement needs an expired old policy and a fresh five-minute approval.");
  await assertRetirementObservation(input.observation, "PRESENT", start, input.predecessor);
  const request = retirementRequest();
  const body = { schemaVersion: 1, stage: READ_COMPARISON_RETIREMENT.stage, input, request,
    requestSha256: await sha256Hex(canonicalJson(request)), requiredPhrase: "I_CONFIRM_J5GJ20_RETIRE_EXACT_UNEXECUTED_GENERATION3_GRANT_ONLY",
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
  await assertRetirementObservation(preflight, "PRESENT", at, manifest.input.predecessor);
  const body = { schemaVersion: 1, action: "RETIRE_GENERATION3_BEFORE_SINGLE_DELETE", manifest, preflight, reservedAt };
  return retirementCopy({ ...body, intentSha256: await sha256Hex(canonicalJson(body)) });
}
export type RetirementIntent = Awaited<ReturnType<typeof makeRetirementIntent>>;
export async function assertRetirementIntent(v: RetirementIntent) { probeSame(v, await makeRetirementIntent(v.manifest, v.reservedAt, v.preflight), "Retirement permanent intent"); }
export interface RetirementLedger { read(): Promise<RetirementIntent | null>; reserve(v: RetirementIntent): Promise<void>; }
type Ports = { readPredecessor(): Promise<ClosedReadComparisonPredecessor>; observe(signal: AbortSignal): Promise<RetirementObservation>;
  ledger: RetirementLedger; now?: () => number };
/** Non-executable preparation evidence. No manifest, expiry or approval phrase;
 * code validation must not consume a fresh human deletion-approval window. */
export async function checkReadComparisonRetirementPreparation(p: Ports & { signal: AbortSignal }) {
  const now = p.now ?? Date.now, started = now(), predecessor = await p.readPredecessor();
  if (await p.ledger.read()) throw new Error("Retirement consumed; independent Inspect only.");
  const observation = await p.observe(p.signal); p.signal.throwIfAborted();
  const ended = now();
  if (ended < started || ended - started > 90_000 || ended < probeInstant(READ_COMPARISON_RETIREMENT.policyExpiresAt)) throw new Error("Preparation needs bounded reads and an expired old policy.");
  await assertRetirementObservation(observation, "PRESENT", ended, predecessor);
  probeSame(await p.readPredecessor(), predecessor, "Preparation archive stability");
  if (await p.ledger.read()) throw new Error("Retirement changed during preparation.");
  const body = { stage: READ_COMPARISON_RETIREMENT.stage, mode: "READ_ONLY_PREPARATION_CHECK", predecessor, observation,
    outcome: "EXACT_UNEXECUTED_GENERATION3_PREPARATION_VERIFIED", mutationPerformed: false,
    approvalWindowOpened: false, manifestCreated: false, deletionAuthorized: false, creationAuthorized: false,
    runtimeEnabled: false, productionCompatibilityVerified: false, observedAt: new Date(ended).toISOString() };
  return retirementCopy({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
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
  const observation = await p.observe(p.signal); await assertRetirementObservation(observation, "PRESENT", now(), m.input.predecessor);
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
  if (!intent) throw new Error("No durable retirement intent; external absence cannot authorize generation4.");
  await assertRetirementIntent(intent); probeSame(intent.manifest.input.predecessor, predecessor, "Retirement inspection predecessor");
  const observation = await p.observe(p.signal); p.signal.throwIfAborted();
  const state = observation.recovery.observation.grant.state === "MISSING" ? "MISSING" : "PRESENT";
  await assertRetirementObservation(observation, state, now(), predecessor);
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
  await assertRetirementObservation(v.observation, "MISSING", at, v.intent.manifest.input.predecessor);
  probeSame(v, { stage: READ_COMPARISON_RETIREMENT.stage, mode: "INDEPENDENT_READ_ONLY_INSPECT", intent: v.intent, observation: v.observation,
    outcome: "RETIRED_LOCKED_VERIFIED", mutationPerformed: false, retryAllowed: false, productionCompatibilityVerified: false, runtimeEnabled: false,
    observedAt: v.observedAt, receiptSha256: v.receiptSha256 }, "Independent retirement proof scope");
}
