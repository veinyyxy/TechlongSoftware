import { readFile } from "node:fs/promises";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { ARN_PROBE_READ_COMPARISON_ANCHORS as anchors, ARN_PROBE_CONSUMED_SLOT_FILES,
  type ArnProbeReadComparisonPredecessor } from "../../lib/deployments/execution/arn-compatibility-probe-read-comparison.ts";
import { READ_COMPARISON_RETIREMENT as r, closedReadComparisonPredecessor, compileReadComparisonRetirement, makeRetirementIntent,
  inspectReadComparisonRetirement, type RetirementObservation, type RetirementIntent, type RetirementLedger } from "../../lib/deployments/execution/arn-probe-read-comparison-retirement.ts";

// Public metadata fixture + memory ports only. No cloud, MFA, credentials or live ledger.
export const retirementTestAt = Date.parse("2026-10-04T04:59:00.000Z");
export const generation1: ArnProbeReadComparisonPredecessor = { anchors, consumedGeneration: 1,
  consumedSlotRelativePath: `.aws-sandbox/j5gj13-arn-probe/${anchors.targetFenceKey}/slot-000001`, slotFiles: ARN_PROBE_CONSUMED_SLOT_FILES,
  consumed: true, probeDeleteIntentPresent: false, replayAllowed: false };
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };
export async function retirementObservation(state: "PRESENT" | "MISSING", at = retirementTestAt): Promise<RetirementObservation> {
  const recovery: Mutable<RetirementObservation["recovery"]> = JSON.parse(await readFile(new URL("./arn-probe-generation2-closed.json", import.meta.url), "utf8"));
  recovery.observedAt = new Date(at).toISOString();
  for (const v of Object.values(recovery.observation)) v.observedAt = recovery.observedAt;
  if (state === "MISSING") { recovery.observation.grant = { state: "MISSING", proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY", observedAt: recovery.observedAt }; recovery.outcome = "MISSING_SLOT_CONSUMED"; }
  const body = Object.fromEntries(Object.entries(recovery).filter(([k]) => k !== "receiptSha256"));
  recovery.receiptSha256 = await sha256Hex(canonicalJson(body));
  const inventory = { stackId: r.stackId, changeSetArns: state === "PRESENT" ? [r.grantArn] : [], complete: true as const,
    providerEvidenceSha256: "f".repeat(64), observedAt: recovery.observedAt };
  return { recovery, inventoryBefore: inventory, inventoryAfter: { ...inventory } };
}
export async function retirementFixture() {
  let at = retirementTestAt, absent = false, intent: RetirementIntent | null = null;
  const events: string[] = [], predecessor = await closedReadComparisonPredecessor(generation1), now = () => at;
  const ledger: RetirementLedger = { read: async () => intent, reserve: async (v) => { if (intent) throw new Error("Consumed"); events.push("durable-intent"); intent = v; } };
  const observe = () => retirementObservation(absent ? "MISSING" : "PRESENT", at);
  const ports = { readPredecessor: async () => predecessor, ledger, observe, now, signal: new AbortController().signal };
  const manifest = await compileReadComparisonRetirement({ predecessor, observation: await observe(), reviewedAt: new Date(at).toISOString(), expiresAt: new Date(at + 300_000).toISOString() });
  return { ...ports, manifest, events, setTime: (v: number) => { at = v; }, setAbsent: (v: boolean) => { absent = v; },
    approval: { approvedManifestSha256: manifest.manifestSha256, executionPhrase: manifest.requiredPhrase, acknowledgeDeletionIrreversible: true, acknowledgeLowCostNotZero: true },
    deleteChangeSet: async () => { events.push("one-delete"); absent = true; return {}; } };
}
export async function retirementProofFixture() {
  const f = await retirementFixture();
  await f.ledger.reserve(await makeRetirementIntent(f.manifest, new Date(f.now()).toISOString(), await f.observe()));
  f.setAbsent(true); f.setTime(retirementTestAt + 1_000);
  return inspectReadComparisonRetirement(f);
}
