import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeInstant, probeSame } from "./arn-compatibility-probe-workflow.ts";
import { arnProbeSafeRequestId, sanitizeArnProbeFailure } from "./arn-compatibility-probe-diagnostics.ts";
import { stackControlCopy, type StackControlFixtureInventory } from "./arn-probe-stack-scoped-read-control-create.ts";
import type { StackControlManagementObservation } from "./aws-sdk-shared-cell-author-compensation-management.ts";
import type { ArnProbeFixtureState } from "./arn-compatibility-probe-fixture.ts";
import type { StackControlWorkflowInventory } from "./arn-probe-stack-scoped-read-control-workflow.ts";

/** Completed historical anchors, not approvals or a general deletion service. */
export const STACK_CONTROL_RETIREMENT = Object.freeze({
  stage: "B5-J5g-j23-retirement", generation: 5,
  targetFenceKey: "9e6c381d768f09bb9f7d8498237512284ba992e8e411b58bae6432d73f53892d",
  oldPredecessorSha256: "c0a9db665633fd6cbfd29b732bd6099d93cf7ea12aac2e23c506ecb89cc57b63",
  oldJournalSha256: "6ec0eae446692285efe64e844eca3cb9f9e24ced36d5fb268b8f1ba66872b192",
  creationReviewSha256: "e68868b78bb4b62de82a4d6dbf491238b70673612e338cd65856d266e73700c3",
  planSha256: "e4184e979c8a3a8bd89076055dfe1b7153d5c3bb6347fa27b1170115180e62e8",
  requestSha256: "417bcad8f4dac343510ae2691f27c806546488f2a72b09f7e517437a9297a351",
  claimSha256: "f6c09dd307dfeeb4e0bb08cb17b9dca997dde96d0e1f43cbc9b6329488a76641",
  creationReceiptSha256: "aa4dd5fbd1a60278e682bf7e0576c7c38ca3bd5130d8179381403c190fcbd23e",
  recoveryReceiptSha256: "b7cfebcaa14f15d131503c16e757a0a177259f2427d90cabe6717d7b8008da88",
  executionReviewSha256: "dc2e5cb06554eb81e23efd428f86970f9fe4fd25521f81f045529188b8509afb",
  executionManifestSha256: "f7966a916745741f1d29e1dde130168414a909b5e1d16b8717a4bad8595bc093",
  closureReceiptSha256: "5020a3547263333b0755bc8430042666e9007d37ca95feaca4aac2942bc49596",
  grantTemplateSha256: "f974a15990fea40c7e1205a6fdb7e59c879c7468420d564a83a6b6398dbca732",
  lockedSnapshotSha256: "3f915cfb6102a62433a50cda146642db842f2a476b2ae5d926c5e101de17a32d",
  fixtureSnapshotSha256: "6e0a20df4f70b5310669aca50ad3cfe416777121da653f1910f3a09b2472a8ef",
  policyExpiresAt: "2026-10-05T04:32:46.189Z", closureObservedAt: "2026-10-05T04:35:25.447Z",
  stackId: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-lifecycle-management/fb742b50-afb2-11f1-85b7-02588681429d",
  grantArn: "arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-j5gj22-stack-read-grant-eb71b71ef41e3111/efbf0abc-5638-41d7-9a50-6960f9f442f2",
});
const r = STACK_CONTROL_RETIREMENT;
export const STACK_CONTROL_RETIREMENT_PATHS = Object.freeze({
  oldSlot: `.aws-sandbox/j5gj22-stack-scoped-read-control/${r.targetFenceKey}/slot-000005`,
  retirementRegistry: ".aws-sandbox/j5gj23-stack-control-retirement",
  retirementSlot: `.aws-sandbox/j5gj23-stack-control-retirement/${r.targetFenceKey}/slot-000005`,
  successorRegistry: ".aws-sandbox/j5gj23-stack-control",
  successorSlot: `.aws-sandbox/j5gj23-stack-control/${r.targetFenceKey}/slot-000006`,
});
export async function stackControlRetirementDigest(v: object, key: string, expected?: string) {
  const body = { ...v } as Record<string, unknown>, digest = body[key]; delete body[key];
  if ((expected && digest !== expected) || digest !== await sha256Hex(canonicalJson(body))) throw new Error("J23 evidence digest drifted.");
}
/** Compact reference only. Production must independently load all anchored
 * original evidence and actual ledgers before returning this descriptor. */
export async function closedGeneration5Descriptor() {
  const body = { schemaVersion: 1, action: "CLOSED_UNEXECUTED_GENERATION5_REFERENCES", anchors: r,
    oldSlot: STACK_CONTROL_RETIREMENT_PATHS.oldSlot, slotFiles: ["claim.json"], workflowIntentCount: 0,
    oldRecordsPreserved: true, replayAllowed: false, successorReservationAllowed: false };
  return stackControlCopy({ ...body, predecessorSha256: await sha256Hex(canonicalJson(body)) });
}
export type ClosedGeneration5 = Awaited<ReturnType<typeof closedGeneration5Descriptor>>;
export async function assertClosedGeneration5(v: ClosedGeneration5) { probeSame(v, await closedGeneration5Descriptor(), "J23 exact closed references"); }
export type StackControlRetirementObservation = Readonly<{
  managementBefore: Readonly<StackControlManagementObservation>; managementAfter: Readonly<StackControlManagementObservation>;
  fixture: ArnProbeFixtureState; fixtureInventory: StackControlFixtureInventory; inventory: StackControlWorkflowInventory;
}>;
const normalized = (v: { observedAt: string }) => ({ ...v, observedAt: null });
function fresh(v: { observedAt: string }, at: number) { const age = at - probeInstant(v.observedAt); if (age < 0 || age > 60_000) throw new Error("J23 Source evidence stale."); }
export async function assertStackControlRetirementObservation(o: StackControlRetirementObservation, state: "PRESENT" | "MISSING", at: number) {
  probeSame(Object.keys(o).sort(), ["fixture", "fixtureInventory", "inventory", "managementAfter", "managementBefore"], "J23 complete observation fields");
  let previous = -Infinity;
  for (const v of [o.managementBefore, o.fixture, o.fixtureInventory, o.inventory, o.managementAfter]) {
    fresh(v, at); const current = probeInstant(v.observedAt); if (current < previous) throw new Error("J23 Source chronology drifted."); previous = current;
  }
  for (const m of [o.managementBefore, o.managementAfter]) await assertStackControlRetirementState(m, o.fixture, o.fixtureInventory, o.inventory, state, at);
}
/** Also validates the historical Inspect's single final snapshot as-is;
 * it never synthesizes a second bracket or rewrites provider timestamps. */
export async function assertStackControlRetirementState(management: Readonly<StackControlManagementObservation>, fixture: ArnProbeFixtureState,
  f: StackControlFixtureInventory, i: StackControlWorkflowInventory, state: "PRESENT" | "MISSING", at: number) {
  for (const v of [management, fixture, f, i]) fresh(v, at);
  if (await sha256Hex(canonicalJson(normalized(management))) !== r.lockedSnapshotSha256) throw new Error("J23 full original Locked/v7 IAM snapshot required.");
  if (await sha256Hex(canonicalJson(normalized(fixture))) !== r.fixtureSnapshotSha256) throw new Error("J23 original zero-resource fixture changed.");
  if (fixture.state !== "READY_UNEXECUTED") throw new Error("J23 original fixture must remain unexecuted.");
  const original = fixture;
  probeSame(f, { stackId: original.stackId, changeSetArn: original.changeSetArn,
    changeSetName: "techlong-sandbox-arn-compatibility-probe-08b7955eb7029b3a", status: "CREATE_COMPLETE", executionStatus: "AVAILABLE",
    complete: true, count: 1, observedAt: f.observedAt, providerEvidenceSha256: f.providerEvidenceSha256 }, "J23 complete singleton fixture");
  probeSame(i, { stackId: r.stackId, complete: true, observedAt: i.observedAt, providerEvidenceSha256: i.providerEvidenceSha256,
    objects: state === "PRESENT" ? [{ kind: "CURRENT_GRANT", arn: r.grantArn, status: "CREATE_COMPLETE", executionStatus: "AVAILABLE" }] : [] }, "J23 only exact unexecuted Grant or complete empty inventory");
  for (const v of [f, i]) if (!/^[a-f0-9]{64}$/.test(v.providerEvidenceSha256)) throw new Error("J23 complete provider digest missing.");
}
export async function compileStackControlRetirement(input: { predecessor: ClosedGeneration5; observation: StackControlRetirementObservation; reviewedAt: string; expiresAt: string }) {
  probeSame(Object.keys(input).sort(), ["expiresAt", "observation", "predecessor", "reviewedAt"], "J23 retirement manifest inputs");
  await assertClosedGeneration5(input.predecessor); const start = probeInstant(input.reviewedAt), end = probeInstant(input.expiresAt);
  if (start < probeInstant(r.closureObservedAt) || start < probeInstant(r.policyExpiresAt) || end <= start || end - start > 300_000) throw new Error("J23 expired old policy and fresh five-minute retirement approval required.");
  await assertStackControlRetirementObservation(input.observation, "PRESENT", start);
  const request = { StackName: r.stackId, ChangeSetName: r.grantArn };
  const body = { schemaVersion: 1, stage: r.stage, input, request, requestSha256: await sha256Hex(canonicalJson(request)),
    requiredPhrase: "I_CONFIRM_J5GJ23_RETIRE_EXACT_UNEXECUTED_GENERATION5_GRANT_ONLY",
    allowedWriteActions: ["cloudformation:DeleteChangeSet"], maxSubmissions: 1, oldRecordsPreserved: true,
    originalFixtureDeletionAllowed: false, stackDeletionAllowed: false, iamMutationAllowed: false, grantExecutionAllowed: false,
    deletionApproved: false, creationAllowed: false, successorReservationAllowed: false, retryAllowed: false, productionCompatibilityVerified: false, runtimeEnabled: false };
  return stackControlCopy({ ...body, manifestSha256: await sha256Hex(canonicalJson(body)) });
}
export type StackControlRetirementManifest = Awaited<ReturnType<typeof compileStackControlRetirement>>;
export async function assertStackControlRetirement(m: StackControlRetirementManifest) { probeSame(m, await compileStackControlRetirement(m.input), "J23 exact retirement manifest"); }
function live(m: StackControlRetirementManifest, at: number) {
  if (at < probeInstant(m.input.reviewedAt) || at >= probeInstant(m.input.expiresAt)) throw new Error("J23 retirement approval expired; no automatic refresh.");
}
export async function makeStackControlRetirementIntent(manifest: StackControlRetirementManifest, preflight: StackControlRetirementObservation, reservedAt: string) {
  await assertStackControlRetirement(manifest); const at = probeInstant(reservedAt); live(manifest, at);
  await assertStackControlRetirementObservation(preflight, "PRESENT", at);
  const body = { schemaVersion: 1, action: "RETIRE_GENERATION5_BEFORE_SINGLE_DELETE", manifest, preflight, reservedAt };
  return stackControlCopy({ ...body, intentSha256: await sha256Hex(canonicalJson(body)) });
}
export type StackControlRetirementIntent = Awaited<ReturnType<typeof makeStackControlRetirementIntent>>;
export async function assertStackControlRetirementIntent(i: StackControlRetirementIntent) { probeSame(i, await makeStackControlRetirementIntent(i.manifest, i.preflight, i.reservedAt), "J23 permanent intent"); }
export interface StackControlRetirementLedger { read(): Promise<StackControlRetirementIntent | null>; reserve(i: StackControlRetirementIntent): Promise<void>; }
type Ports = { readPredecessor(): Promise<ClosedGeneration5>; observe(signal: AbortSignal): Promise<StackControlRetirementObservation>; ledger: StackControlRetirementLedger; signal: AbortSignal; now?: () => number };
export async function reviewStackControlRetirement(p: Ports) {
  const now = p.now ?? Date.now, started = now(), predecessor = await p.readPredecessor(); await assertClosedGeneration5(predecessor);
  if (await p.ledger.read()) throw new Error("J23 retirement slot consumed; Inspect only.");
  const observation = await p.observe(p.signal); p.signal.throwIfAborted();
  probeSame(await p.readPredecessor(), predecessor, "J23 archive stable after review");
  if (await p.ledger.read()) throw new Error("J23 retirement changed during review.");
  const ended = now(); if (ended < started || ended - started > 90_000) throw new Error("J23 review exceeded bound.");
  return compileStackControlRetirement({ predecessor, observation, reviewedAt: new Date(ended).toISOString(), expiresAt: new Date(ended + 300_000).toISOString() });
}
export function approveStackControlRetirement(m: StackControlRetirementManifest, a: { approvedManifestSha256: string; executionPhrase: string; acknowledgeDeletionIrreversible: boolean; acknowledgeLowCostNotZero: boolean }) {
  probeSame(a, { approvedManifestSha256: m.manifestSha256, executionPhrase: m.requiredPhrase, acknowledgeDeletionIrreversible: true, acknowledgeLowCostNotZero: true }, "J23 exact new deletion approval");
}
export async function retireReviewedStackControl(p: Ports & { manifest: StackControlRetirementManifest; approval: Parameters<typeof approveStackControlRetirement>[1];
  deleteChangeSet(request: StackControlRetirementManifest["request"], signal: AbortSignal): Promise<unknown> }) {
  const m = stackControlCopy(p.manifest), now = p.now ?? Date.now; await assertStackControlRetirement(m); approveStackControlRetirement(m, p.approval);
  live(m, now()); p.signal.throwIfAborted(); if (await p.ledger.read()) throw new Error("J23 permanent slot consumed; never replay Delete.");
  probeSame(await p.readPredecessor(), m.input.predecessor, "J23 actual old records before preflight");
  const preflight = await p.observe(p.signal); await assertStackControlRetirementObservation(preflight, "PRESENT", now());
  probeSame(await p.readPredecessor(), m.input.predecessor, "J23 actual old records after preflight"); live(m, now()); p.signal.throwIfAborted();
  const intent = await makeStackControlRetirementIntent(m, preflight, new Date(now()).toISOString()); await p.ledger.reserve(intent);
  probeSame(await p.ledger.read(), intent, "J23 fsync and readback before Delete");
  let deletionAttempted = false, deleteRequestId: string | null = null; const failures: ReturnType<typeof sanitizeArnProbeFailure>[] = [];
  try { live(m, now()); p.signal.throwIfAborted(); deletionAttempted = true;
    const reply = await p.deleteChangeSet(m.request, AbortSignal.any([p.signal, AbortSignal.timeout(30_000)]));
    const metadata = reply && typeof reply === "object" && Reflect.get(reply, "$metadata");
    deleteRequestId = arnProbeSafeRequestId(metadata && typeof metadata === "object" ? Reflect.get(metadata, "requestId") : null);
    if (!deleteRequestId) throw new Error("J23 Delete provider request ID unavailable; independent Inspect required.");
  }
  catch (e) { failures.push(sanitizeArnProbeFailure(e, "ENTRY", now)); }
  const body = { stage: r.stage, mode: "RETIRE_REVIEWED", manifestSha256: m.manifestSha256, intentSha256: intent.intentSha256, deletionAttempted, deleteRequestId, failures,
    outcome: deletionAttempted ? "DELETE_SUBMISSION_REQUIRES_INSPECT" : "NO_DELETE_SUBMITTED_SLOT_CONSUMED", independentInspectionRequired: true,
    retryAllowed: false, successorReservationAllowed: false, productionCompatibilityVerified: false, runtimeEnabled: false, observedAt: new Date(now()).toISOString() };
  return stackControlCopy({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
export async function inspectStackControlRetirement(p: Ports) {
  const now = p.now ?? Date.now, started = now(), predecessor = await p.readPredecessor(), intent = await p.ledger.read(); await assertClosedGeneration5(predecessor);
  if (!intent) throw new Error("J23 permanent intent missing; external absence cannot admit generation6.");
  await assertStackControlRetirementIntent(intent); probeSame(intent.manifest.input.predecessor, predecessor, "J23 inspection predecessor");
  const observation = await p.observe(p.signal), state = observation.inventory.objects.length ? "PRESENT" : "MISSING";
  await assertStackControlRetirementObservation(observation, state, now()); p.signal.throwIfAborted();
  probeSame(await p.readPredecessor(), predecessor, "J23 preserved archive after Inspect"); probeSame(await p.ledger.read(), intent, "J23 permanent intent stability");
  const ended = now(); if (ended < started || ended - started > 90_000 || ended < probeInstant(intent.reservedAt)) throw new Error("J23 Inspect chronology drifted.");
  if (probeInstant(observation.managementBefore.observedAt) < probeInstant(intent.reservedAt)) throw new Error("J23 independent observations must follow the permanent intent.");
  await assertStackControlRetirementObservation(observation, state, ended);
  const body = { stage: r.stage, mode: "INDEPENDENT_READ_ONLY_INSPECT", intent, observation,
    outcome: state === "MISSING" ? "RETIRED_LOCKED_VERIFIED" : "RETIREMENT_UNPROVED", mutationPerformed: false,
    retryAllowed: false, productionCompatibilityVerified: false, runtimeEnabled: false, observedAt: new Date(ended).toISOString() };
  return stackControlCopy({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
export type StackControlRetirementProof = Awaited<ReturnType<typeof inspectStackControlRetirement>>;
export async function assertStackControlRetirementProof(p: StackControlRetirementProof) {
  await stackControlRetirementDigest(p, "receiptSha256"); await assertStackControlRetirementIntent(p.intent);
  const at = probeInstant(p.observedAt); if (at < probeInstant(p.intent.reservedAt)) throw new Error("J23 proof predates its intent.");
  if (probeInstant(p.observation.managementBefore.observedAt) < probeInstant(p.intent.reservedAt)) throw new Error("J23 proof observations predate intent.");
  await assertStackControlRetirementObservation(p.observation, "MISSING", at);
  probeSame(p, { stage: r.stage, mode: "INDEPENDENT_READ_ONLY_INSPECT", intent: p.intent, observation: p.observation, outcome: "RETIRED_LOCKED_VERIFIED",
    mutationPerformed: false, retryAllowed: false, productionCompatibilityVerified: false, runtimeEnabled: false, observedAt: p.observedAt, receiptSha256: p.receiptSha256 }, "J23 independent successful retirement scope");
}
/** Pure generation6 descriptor, not a compiler, filesystem reservation,
 * creation request or approval. No generation7 or configurable generation. */
export async function stackControlGeneration6Fence(proof: StackControlRetirementProof) {
  await assertStackControlRetirementProof(proof);
  const body = { stage: "B5-J5g-j23", generation: 6, priorGeneration: 5, targetFenceKey: r.targetFenceKey,
    predecessorSha256: proof.intent.manifest.input.predecessor.predecessorSha256, retirementProofSha256: proof.receiptSha256,
    retirementIntentSha256: proof.intent.intentSha256, priorClaimSha256: r.claimSha256, priorSlotRelativePath: STACK_CONTROL_RETIREMENT_PATHS.oldSlot,
    slotRelativePath: STACK_CONTROL_RETIREMENT_PATHS.successorSlot, oldRecordsPreserved: true, physicalSlotCreated: false,
    persistenceImplemented: false, reservationAuthorized: false, replayAllowed: false, creationAuthorized: false, installationAuthorized: false, runtimeEnabled: false };
  return stackControlCopy({ ...body, fenceSha256: await sha256Hex(canonicalJson(body)) });
}
