import { type ReadComparisonRetirementProof } from "./arn-probe-read-comparison-generation3-retirement.ts";
import { lstat, realpath, readdir, mkdir, readFile, open } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeSame, probeInstant } from "./arn-compatibility-probe-workflow.ts";
import { arnProbeComparisonFence, arnProbeComparisonClaimBinding, assertArnProbeComparisonClaim,
  type ArnProbeComparisonFence, type ArnProbeComparisonClaim, type ArnProbeComparisonSlot } from "./arn-probe-read-comparison-generation4-create.ts";
import { ARN_PROBE_READ_COMPARISON_ANCHORS, ARN_PROBE_CONSUMED_SLOT_FILES } from "./arn-compatibility-probe-read-comparison.ts";

function inside(root: string, file: string) { const relative = path.relative(root, file); if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Generation4 slot escapes repository."); }
async function missing(file: string) { try { await lstat(file); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error; } }
/** Local one-winner generation4 directory. Reads never mkdir. No reset, repair,
 * unlink, fallback generation, review-keyed or candidate-keyed storage exists. */
export async function createArnProbeComparisonFsSlot(repository: string, input: ArnProbeComparisonFence, proof: ReadComparisonRetirementProof): Promise<ArnProbeComparisonSlot> {
  const root = await realpath(repository), fence = JSON.parse(canonicalJson(input)) as ArnProbeComparisonFence;
  if (/^(?:\\\\|\/\/)/.test(root) || !(await lstat(root)).isDirectory()) throw new Error("Generation4 fence requires a local repository.");
  const expected = await arnProbeComparisonFence({ anchors: ARN_PROBE_READ_COMPARISON_ANCHORS, consumedGeneration: 1,
    consumedSlotRelativePath: `.aws-sandbox/j5gj13-arn-probe/${ARN_PROBE_READ_COMPARISON_ANCHORS.targetFenceKey}/slot-000001`,
    slotFiles: ARN_PROBE_CONSUMED_SLOT_FILES, consumed: true, probeDeleteIntentPresent: false, replayAllowed: false }, proof);
  probeSame(fence, expected, "Only the independently reviewed generation4 fence is supported"); Object.freeze(fence);
  const segments = [".aws-sandbox", "j5gj20-read-comparison", fence.targetFenceKey], slotName = "slot-000004";
  async function parents(create: boolean): Promise<string | null> {
    let current = root;
    for (const segment of segments) {
      if (segment === fence.targetFenceKey) {
        const entries = await readdir(current, { withFileTypes: true });
        if (entries.some((e) => e.name !== fence.targetFenceKey || !e.isDirectory() || e.isSymbolicLink())) throw new Error("Unknown comparison target requires manual reconciliation.");
      }
      current = path.join(current, segment); inside(root, current);
      if (await missing(current)) {
        if (!create) return null;
        try { await mkdir(current); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      }
      const info = await lstat(current); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Comparison slot ancestor is not ordinary.");
      current = await realpath(current); inside(root, current);
    }
    const targets = await readdir(path.dirname(current), { withFileTypes: true });
    if (targets.some((e) => e.name !== fence.targetFenceKey || !e.isDirectory() || e.isSymbolicLink())) throw new Error("Unknown comparison target.");
    const generations = await readdir(current, { withFileTypes: true });
    if (generations.some((e) => e.name !== slotName || !e.isDirectory() || e.isSymbolicLink())) throw new Error("Unknown comparison generation; no automatic successor.");
    return current;
  }
  async function existing() {
    const parent = await parents(false); if (!parent) return null;
    const slot = path.join(parent, slotName); if (await missing(slot)) return null;
    const info = await lstat(slot); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Comparison slot is not ordinary.");
    const resolved = await realpath(slot); inside(root, resolved);
    const entries = await readdir(resolved, { withFileTypes: true });
    const allowed = ["claim.json"];
    if (!entries.some((e) => e.name === "claim.json") || entries.some((e) => !allowed.includes(e.name))) throw new Error("Complete generation4 claim inventory required; partial slot remains consumed.");
    if (entries.some((e) => !e.isFile() || e.isSymbolicLink())) throw new Error("Comparison claim is not ordinary.");
    return resolved;
  }
  async function readClaim(): Promise<ArnProbeComparisonClaim | null> {
    const slot = await existing(); if (!slot) return null;
    const file = path.join(slot, "claim.json"), info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 600_000) throw new Error("Comparison claim is not a bounded ordinary file.");
    const claim = JSON.parse(await readFile(file, "utf8")) as ArnProbeComparisonClaim;
    await assertArnProbeComparisonClaim(claim, fence); return claim;
  }
  return { fence, readClaim, reserve: async (review, preflightEvidenceSha256, reservedAt) => {
    const binding = await arnProbeComparisonClaimBinding(review); probeSame(review.fence, fence, "Comparison reservation fence");
    const body = { schemaVersion: 1 as const, action: "CLAIM_GENERATION4_BEFORE_CREATE" as const, fence, binding, preflightEvidenceSha256, reservedAt };
    const claim = { ...body, claimSha256: await sha256Hex(canonicalJson(body)) }; await assertArnProbeComparisonClaim(claim, fence); probeInstant(reservedAt);
    const parent = (await parents(true))!, slot = path.join(parent, slotName); inside(root, slot);
    await mkdir(slot); // Exclusive winner. A crash from here onward consumes it.
    const handle = await open(path.join(slot, "claim.json"), "wx");
    try { await handle.writeFile(`${JSON.stringify(claim, null, 2)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
    probeSame(await readClaim(), claim, "Generation4 durable claim readback"); return claim;
  } };
}
