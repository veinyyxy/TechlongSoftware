import { readFile } from "node:fs/promises";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { generation1 } from "./arn-probe-retirement.ts";
import { comparisonWorkflowFixture } from "./arn-probe-generation3-workflow.ts";
import type { ReadComparisonRetirementProof as Generation2Proof } from "../../lib/deployments/execution/arn-probe-read-comparison-retirement.ts";
import { READ_COMPARISON_RETIREMENT as r, closedReadComparisonPredecessor, compileReadComparisonRetirement,
  makeRetirementIntent, inspectReadComparisonRetirement, type RetirementObservation, type RetirementIntent, type RetirementLedger } from "../../lib/deployments/execution/arn-probe-read-comparison-generation3-retirement.ts";
import { reviewArnProbeReadComparison } from "../../lib/deployments/execution/arn-compatibility-probe-read-comparison.ts";
import { arnProbeComparisonFence, reviewArnProbeComparisonCreate } from "../../lib/deployments/execution/arn-probe-read-comparison-generation4-create.ts";

// Sanitized public metadata and temporary/memory ports only; no live SDK or ledger.
export const generation3RetirementTestAt = Date.parse("2026-10-04T16:00:00.000Z");
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };
export async function retiredGeneration2() {
  return JSON.parse(await readFile(new URL("./arn-probe-generation2-retired.json", import.meta.url), "utf8")) as Generation2Proof;
}
export async function generation3Observation(state: "PRESENT" | "MISSING", at = generation3RetirementTestAt): Promise<RetirementObservation> {
  const recovery: Mutable<RetirementObservation["recovery"]> = JSON.parse(await readFile(new URL("./arn-probe-generation3-closed.json", import.meta.url), "utf8"));
  recovery.observedAt = new Date(at).toISOString();
  for (const value of Object.values(recovery.observation)) value.observedAt = recovery.observedAt;
  if (state === "MISSING") {
    recovery.observation.grant = { state: "MISSING", proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY", observedAt: recovery.observedAt };
    recovery.outcome = "MISSING_SLOT_CONSUMED";
  }
  const body = { ...recovery }; delete (body as Partial<typeof body>).receiptSha256;
  recovery.receiptSha256 = await sha256Hex(canonicalJson(body));
  const inventory = { stackId: r.stackId, changeSetArns: state === "PRESENT" ? [r.grantArn] : [], complete: true as const,
    providerEvidenceSha256: "f".repeat(64), observedAt: recovery.observedAt };
  return { recovery, inventoryBefore: inventory, inventoryAfter: { ...inventory } };
}
export async function generation3RetirementFixture() {
  let at = generation3RetirementTestAt, absent = false, intent: RetirementIntent | null = null;
  const events: string[] = [], now = () => at;
  const predecessor = await closedReadComparisonPredecessor(generation1, await retiredGeneration2());
  const ledger: RetirementLedger = { read: async () => intent, reserve: async (value) => {
    if (intent) throw new Error("Consumed"); events.push("durable-intent"); intent = value;
  } };
  const observe = () => generation3Observation(absent ? "MISSING" : "PRESENT", at);
  const ports = { readPredecessor: async () => predecessor, ledger, observe, now, signal: new AbortController().signal };
  const manifest = await compileReadComparisonRetirement({ predecessor, observation: await observe(), reviewedAt: new Date(at).toISOString(), expiresAt: new Date(at + 300_000).toISOString() });
  return { ...ports, manifest, events, setTime: (value: number) => { at = value; }, setAbsent: (value: boolean) => { absent = value; },
    approval: { approvedManifestSha256: manifest.manifestSha256, executionPhrase: manifest.requiredPhrase, acknowledgeDeletionIrreversible: true, acknowledgeLowCostNotZero: true },
    deleteChangeSet: async () => { events.push("one-delete"); absent = true; return {}; } };
}
let cachedProof: ReturnType<typeof makeProof> | undefined;
async function makeProof() {
  const f = await generation3RetirementFixture();
  await f.ledger.reserve(await makeRetirementIntent(f.manifest, new Date(f.now()).toISOString(), await f.observe()));
  f.setAbsent(true); f.setTime(generation3RetirementTestAt + 1000);
  return inspectReadComparisonRetirement(f);
}
export async function generation3RetiredProof() {
  cachedProof ??= makeProof(); return JSON.parse(canonicalJson(await cachedProof)) as Awaited<ReturnType<typeof makeProof>>;
}
export async function generation4Fixture() {
  const proof = await generation3RetiredProof(), old = await comparisonWorkflowFixture(), at = generation3RetirementTestAt + 2000;
  const observation = await generation3Observation("MISSING", at), prior = old.prior;
  const sourceReview = await reviewArnProbeReadComparison({ priorPlan: prior, readPredecessor: old.readPredecessor,
    reads: { readManagement: async () => observation.recovery.observation.managementAfter,
      readFixture: async () => observation.recovery.observation.fixtureAfter,
      readEmptyManagementInventory: async () => ({ state: "EMPTY", changeSetCount: 0, stackId: prior.managementStackId, providerEvidenceSha256: "f".repeat(64), observedAt: new Date(at).toISOString() }) },
    now: () => at, signal: new AbortController().signal });
  const fence = await arnProbeComparisonFence(sourceReview.predecessor, proof);
  const review = await reviewArnProbeComparisonCreate({ sourceReview, variant: "EXACT_NAME_CONDITION", retirementProof: proof,
    slot: { fence, readClaim: async () => null }, signal: new AbortController().signal, now: () => at });
  return { proof, fence, review, at };
}
