import { canonicalJson, sha256Hex } from "./hash.ts";
import { compileArnProbeGrantPlan, assertArnProbeGrantPlan } from "./arn-compatibility-probe-grant.ts";
import { assertArnProbeWorkflowManifest, probeObject, probeSame, probeInstant,
  type ArnProbeWorkflowManifest, type ArnProbeWorkflowReads, type ProbeStep } from "./arn-compatibility-probe-workflow.ts";
import { ARN_PROBE_ACCOUNT, ARN_PROBE_REGION, ARN_PROBE_SOURCE } from "./arn-compatibility-probe-fixture.ts";

export const ARN_PROBE_LEGACY_ANCHORS = Object.freeze({
  manifestSha256: "7e007a6ffbf01622d78e880f1ce121613c7fbfaed48d1f0dc9171b553e8f55a4",
  runReceiptSha256: "93ce40211ed45b1a81b28274809fea0f94316524ac28ac01d5b864f56715eeb6",
  createReviewSha256: "44ec7b9fd85cbeed8d31b7aedf2078e61eb95ff46da033db3111d515906116c5",
  revokeExecuteRequestSha256: "63fce06d60918fcf40df68263ffaae928638ea11013cad246a9ab0a858cb19e0",
});
export type ArnProbeLegacyArchive = Readonly<{ manifest: ArnProbeWorkflowManifest; runReceipt: Readonly<Record<string, unknown>>;
  createIntent: Readonly<Record<string, unknown>>; journal: Readonly<Record<ProbeStep, Readonly<Record<string, unknown>>>> }>;
export type ArnProbeEmptyManagementInventory = Readonly<{ stackId: string; state: "EMPTY"; changeSetCount: 0;
  providerEvidenceSha256: string; observedAt: string }>;
export interface ArnProbeRenewalReads extends Pick<ArnProbeWorkflowReads, "readManagement" | "readFixture"> {
  readEmptyManagementInventory(plan: ArnProbeWorkflowManifest["input"]["plan"], signal: AbortSignal): Promise<ArnProbeEmptyManagementInventory>;
}
function immutable<T>(value: T): Readonly<T> {
  const copy = JSON.parse(canonicalJson(value)) as T;
  function freeze(item: unknown) { if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); } }
  freeze(copy); return copy;
}
function digest(value: unknown) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Renewal digest is incomplete."); }
function fresh(value: { observedAt: string }, now: number) {
  const age = now - probeInstant(value.observedAt);
  if (age < 0 || age > 60_000) throw new Error("Renewal live evidence is stale.");
}
async function legacy(archive: ArnProbeLegacyArchive, anchors: Readonly<typeof ARN_PROBE_LEGACY_ANCHORS> | Readonly<Record<keyof typeof ARN_PROBE_LEGACY_ANCHORS, string>>) {
  probeSame(Object.keys(archive).sort(), ["createIntent", "journal", "manifest", "runReceipt"], "Legacy archive fields");
  const m = archive.manifest, p = m.input.plan; await assertArnProbeWorkflowManifest(m);
  if (m.manifestSha256 !== anchors.manifestSha256) throw new Error("Only the independently verified legacy round may be closed.");
  const { receiptSha256, ...receiptBody } = archive.runReceipt;
  if (receiptSha256 !== anchors.runReceiptSha256 || receiptSha256 !== await sha256Hex(canonicalJson(receiptBody)) ||
      receiptBody.stage !== "B5-J5g-j11" || receiptBody.manifestSha256 !== m.manifestSha256 || receiptBody.outcome !== "LOCKED_PROBE_NOT_PROVED" ||
      receiptBody.grantAttempted !== true || receiptBody.probeRequestId !== null || receiptBody.isolatedProbeCompatibilityObserved !== false ||
      [receiptBody.productionCompatibilityVerified, receiptBody.childExecuted, receiptBody.deleteStackPerformed, receiptBody.runtimeEnabled, receiptBody.retryAuthorized].some((v) => v !== false)) throw new Error("Legacy execution is not the exact withdrawn negative probe.");
  const cleanup = probeObject(receiptBody.cleanup), evidence = probeObject(cleanup.evidence), post = probeObject(receiptBody.post);
  if (cleanup.outcome !== "LOCKED_VERIFIED" || post.state !== "READY_UNEXECUTED" || post.stackState !== "REVIEW_IN_PROGRESS" ||
      post.stackId !== p.input.fixtureStackId || post.changeSetArn !== p.input.fixtureChangeSetArn || post.resourceCount !== 0) throw new Error("Legacy cleanup/fixture proof is incomplete.");
  for (const value of [evidence.first, evidence.last]) {
    const observation = probeObject(value), stack = probeObject(observation.stack);
    if (observation.rendererShape !== "Locked" || observation.accountId !== ARN_PROBE_ACCOUNT || observation.callerArn !== ARN_PROBE_SOURCE ||
        observation.region !== ARN_PROBE_REGION || observation.cellStackState !== "MISSING" || observation.authorityState !== "ABSENT" ||
        stack.id !== p.managementStackId || stack.templateRawSha256 !== p.revokeTarget.templateRawSha256 ||
        stack.templateCanonicalSha256 !== p.revokeTarget.templateCanonicalSha256) throw new Error("Legacy Locked observation drifted.");
  }
  probeSame(archive.createIntent, { stage: "B5-J5g-j10", action: "CREATE_PROBE_GRANT_CHANGE_SET", operationSha256: p.operationSha256,
    approvedReviewSha256: anchors.createReviewSha256, requestSha256: await sha256Hex(canonicalJson(p.request)), reservedAt: archive.createIntent.reservedAt }, "Legacy fixed Create intent");
  let previous = probeInstant(String(archive.createIntent.reservedAt));
  const steps: ProbeStep[] = ["run", "grant-execute", "probe-delete", "revoke-create", "revoke-execute"];
  probeSame(Object.keys(archive.journal).sort(), [...steps].sort(), "Complete legacy workflow journal");
  const requests: Record<ProbeStep, unknown> = { run: m.actions, "grant-execute": m.actions.grantExecute.request,
    "probe-delete": m.actions.probeDelete.request, "revoke-create": m.actions.revoke.createRequest, "revoke-execute": null };
  for (const step of steps) {
    const item = archive.journal[step], requestSha256 = step === "revoke-execute" ? anchors.revokeExecuteRequestSha256 : await sha256Hex(canonicalJson(requests[step]));
    digest(requestSha256);
    probeSame(item, { stage: "B5-J5g-j11", step, operationSha256: m.operationSha256, manifestSha256: m.manifestSha256,
      requestSha256, reservedAt: item.reservedAt }, `Legacy ${step} intent`);
    const time = probeInstant(String(item.reservedAt));
    if (time < previous || time > probeInstant(String(receiptBody.observedAt)) ||
        (["run", "grant-execute", "probe-delete"].includes(step) && (time < probeInstant(m.input.reviewedAt) || time >= probeInstant(m.input.expiresAt)))) throw new Error("Legacy intent chronology drifted.");
    previous = time;
  }
  return { manifestSha256: m.manifestSha256, runReceiptSha256: String(receiptSha256), archiveSha256: await sha256Hex(canonicalJson(archive)),
    createIntentSha256: await sha256Hex(canonicalJson(archive.createIntent)), journalSha256: await sha256Hex(canonicalJson(archive.journal)),
    oldWindowExpiredAt: p.input.expiresAt, replayAllowed: false as const };
}
export async function arnProbeTargetFenceKey(plan: ArnProbeWorkflowManifest["input"]["plan"]) {
  return sha256Hex(canonicalJson({ accountId: ARN_PROBE_ACCOUNT, region: ARN_PROBE_REGION, managementStackId: plan.managementStackId,
    fixtureStackId: plan.input.fixtureStackId, fixtureChangeSetArn: plan.input.fixtureChangeSetArn }));
}
export async function readArnProbeRenewalPreflight(input: { readArchive: () => Promise<ArnProbeLegacyArchive>; reads: ArnProbeRenewalReads;
  signal: AbortSignal; now?: () => number;
  trustedAnchors?: Readonly<Record<keyof typeof ARN_PROBE_LEGACY_ANCHORS, string>> }) {
  const now = input.now ?? Date.now, start = now(); input.signal.throwIfAborted();
  const archive = await input.readArchive(), predecessor = await legacy(archive, input.trustedAnchors ?? ARN_PROBE_LEGACY_ANCHORS), p = archive.manifest.input.plan;
  if (start < probeInstant(p.input.expiresAt)) throw new Error("Legacy Grant window must expire before proposing a successor.");
  const before = await input.reads.readManagement(p, input.signal);
  const inventoryBefore = await input.reads.readEmptyManagementInventory(p, input.signal);
  const fixture = await input.reads.readFixture(p, input.signal);
  const inventoryAfter = await input.reads.readEmptyManagementInventory(p, input.signal);
  const after = await input.reads.readManagement(p, input.signal);
  const ended = now(); input.signal.throwIfAborted();
  if (ended < start || ended - start > 90_000) throw new Error("Renewal review exceeded its bound.");
  for (const value of [before, after]) {
    fresh(value, ended);
    if (value.rendererShape !== "Locked" || value.accountId !== ARN_PROBE_ACCOUNT || value.region !== ARN_PROBE_REGION || value.callerArn !== ARN_PROBE_SOURCE ||
        value.cellStackState !== "MISSING" || value.authorityState !== "ABSENT" || value.stack.id !== p.managementStackId ||
        value.stack.templateRawSha256 !== p.revokeTarget.templateRawSha256 || value.stack.templateCanonicalSha256 !== p.revokeTarget.templateCanonicalSha256) throw new Error("Fresh exact Locked / Cell MISSING / authority ABSENT is required.");
  }
  probeSame(before.stack, after.stack, "Renewal Locked stack stability"); probeSame(before.policies, after.policies, "Renewal Locked IAM stability"); probeSame(before.roles, after.roles, "Renewal role stability");
  for (const inventory of [inventoryBefore, inventoryAfter]) {
    fresh(inventory, ended); digest(inventory.providerEvidenceSha256);
    if (inventory.state !== "EMPTY" || inventory.stackId !== p.managementStackId || inventory.changeSetCount !== 0) throw new Error("Renewal requires complete empty management Change Set inventory.");
  }
  fresh(fixture, ended);
  if (fixture.state !== "READY_UNEXECUTED" || fixture.stackId !== p.input.fixtureStackId || fixture.changeSetArn !== p.input.fixtureChangeSetArn ||
      fixture.resourceCount !== 0 || fixture.templateCanonicalSha256 !== p.input.fixturePlan.templateCanonicalSha256) throw new Error("Only the unchanged zero-resource legacy fixture may be proposed.");
  const lastArchive = await input.readArchive(); probeSame(await legacy(lastArchive, input.trustedAnchors ?? ARN_PROBE_LEGACY_ANCHORS), predecessor, "Legacy archive stability");
  return { archive, predecessor, observation: { management: after, inventoryBefore, inventoryAfter, fixture } };
}
/** Read-only preparation. No reserve/Create/Execute/Delete/AssumeRole ports. */
export async function reviewArnProbeRenewal(input: { readArchive: () => Promise<ArnProbeLegacyArchive>; reads: ArnProbeRenewalReads;
  nonce: string; signal: AbortSignal; now?: () => number;
  trustedAnchors?: Readonly<Record<keyof typeof ARN_PROBE_LEGACY_ANCHORS, string>> }) {
  if (!/^[a-f0-9]{32}$/.test(input.nonce)) throw new Error("Renewal nonce must be a bounded hexadecimal value.");
  const now = input.now ?? Date.now, { archive, predecessor, observation } = await readArnProbeRenewalPreflight(input), p = archive.manifest.input.plan;
  const issued = now(), nextGrantPlan = await compileArnProbeGrantPlan({ ...p.input, nonce: input.nonce,
    reviewedAt: new Date(issued).toISOString(), expiresAt: new Date(issued + 3_600_000).toISOString() });
  probeSame(nextGrantPlan.futureProbeRequest, p.futureProbeRequest, "Successor exact target"); probeSame(nextGrantPlan.revokeTarget, p.revokeTarget, "Successor Locked target");
  const targetFenceKey = await arnProbeTargetFenceKey(p);
  const body = { schemaVersion: 1, stage: "B5-J5g-j13", action: "REVIEW_TARGET_BOUND_RENEWAL_ONLY", predecessor,
    observation,
    proposal: { nextGrantPlan, targetFenceKey, generation: 1, priorGeneration: 0,
      slotRelativePath: `.aws-sandbox/j5gj13-arn-probe/${targetFenceKey}/slot-000001`,
      slotIndependentOfNonceAndReviewTime: true, createOnlyFsyncBeforeAnyMutationRequired: true,
      sameSlotForCreateAndAllWorkflowIntentsRequired: true, oldJournalsMustBePreserved: true,
      predecessorReadbackAndExclusiveSlotClaimRequired: true, persistenceImplemented: false },
    issuedAt: new Date(issued).toISOString(), expiresAt: new Date(issued + 300_000).toISOString(),
    mutationPerformed: false, allowedWriteActions: [], grantCreationAuthorized: false, grantExecutionAuthorized: false,
    probeDeletionAuthorized: false, cleanupAuthorized: false, retryAuthorized: false, productionCompatibilityVerified: false, runtimeEnabled: false };
  return immutable({ ...body, reviewSha256: await sha256Hex(canonicalJson(body)) });
}
export type ArnProbeRenewalReview = Awaited<ReturnType<typeof reviewArnProbeRenewal>>;
export async function assertArnProbeRenewalReview(review: ArnProbeRenewalReview) {
  const { reviewSha256, ...body } = review;
  if (reviewSha256 !== await sha256Hex(canonicalJson(body)) || body.schemaVersion !== 1 || body.stage !== "B5-J5g-j13" ||
      body.action !== "REVIEW_TARGET_BOUND_RENEWAL_ONLY" || canonicalJson(body.allowedWriteActions) !== "[]" ||
      [body.mutationPerformed, body.grantCreationAuthorized, body.grantExecutionAuthorized, body.probeDeletionAuthorized,
        body.cleanupAuthorized, body.retryAuthorized, body.productionCompatibilityVerified, body.runtimeEnabled].some((value) => value !== false)) throw new Error("Renewal review scope drifted.");
  const plan = body.proposal.nextGrantPlan; await assertArnProbeGrantPlan(plan);
  const targetFenceKey = await arnProbeTargetFenceKey(plan), issued = probeInstant(body.issuedAt);
  if (body.expiresAt !== new Date(issued + 300_000).toISOString() || plan.input.reviewedAt !== body.issuedAt ||
      plan.input.expiresAt !== new Date(issued + 3_600_000).toISOString()) throw new Error("Renewal review window drifted.");
  probeSame(body.proposal, { nextGrantPlan: plan, targetFenceKey, generation: 1, priorGeneration: 0,
    slotRelativePath: `.aws-sandbox/j5gj13-arn-probe/${targetFenceKey}/slot-000001`, slotIndependentOfNonceAndReviewTime: true,
    createOnlyFsyncBeforeAnyMutationRequired: true, sameSlotForCreateAndAllWorkflowIntentsRequired: true,
    oldJournalsMustBePreserved: true, predecessorReadbackAndExclusiveSlotClaimRequired: true, persistenceImplemented: false }, "Renewal slot proposal");
}
