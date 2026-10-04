import { lstat, realpath, readdir, mkdir, readFile, open } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeSame, probeInstant } from "./arn-compatibility-probe-workflow.ts";
import { arnProbeComparisonFence, arnProbeComparisonClaimBinding, assertArnProbeComparisonClaim,
  type ArnProbeComparisonFence, type ArnProbeComparisonClaim, type ArnProbeComparisonSlot } from "./arn-probe-read-comparison-create.ts";
import { ARN_PROBE_READ_COMPARISON_ANCHORS, ARN_PROBE_CONSUMED_SLOT_FILES } from "./arn-compatibility-probe-read-comparison.ts";
import { ARN_PROBE_COMPARISON_STEPS, assertArnProbeComparisonWorkflow, comparisonStepRequest,
  type ArnProbeComparisonWorkflowManifest, type ArnProbeComparisonJournal, type ArnProbeComparisonStep } from "./arn-probe-read-comparison-workflow.ts";

function inside(root: string, file: string) { const relative = path.relative(root, file); if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Generation2 slot escapes repository."); }
async function missing(file: string) { try { await lstat(file); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error; } }
/** Local one-winner generation2 directory. Reads never mkdir. No reset, repair,
 * unlink, fallback generation, review-keyed or candidate-keyed storage exists. */
export async function createArnProbeComparisonFsSlot(repository: string, input: ArnProbeComparisonFence): Promise<ArnProbeComparisonSlot & {
  workflowJournal(manifest: ArnProbeComparisonWorkflowManifest): Promise<ArnProbeComparisonJournal>;
}> {
  const root = await realpath(repository), fence = JSON.parse(canonicalJson(input)) as ArnProbeComparisonFence;
  if (/^(?:\\\\|\/\/)/.test(root) || !(await lstat(root)).isDirectory()) throw new Error("Generation2 fence requires a local repository.");
  const expected = await arnProbeComparisonFence({ anchors: ARN_PROBE_READ_COMPARISON_ANCHORS, consumedGeneration: 1,
    consumedSlotRelativePath: `.aws-sandbox/j5gj13-arn-probe/${ARN_PROBE_READ_COMPARISON_ANCHORS.targetFenceKey}/slot-000001`,
    slotFiles: ARN_PROBE_CONSUMED_SLOT_FILES, consumed: true, probeDeleteIntentPresent: false, replayAllowed: false });
  probeSame(fence, expected, "Only the independently reviewed generation2 fence is supported"); Object.freeze(fence);
  const segments = [".aws-sandbox", "j5gj17-read-comparison", fence.targetFenceKey], slotName = "slot-000002";
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
    const allowed = ["claim.json", ...ARN_PROBE_COMPARISON_STEPS.map((step) => `${step}-intent.json`)];
    if (!entries.some((e) => e.name === "claim.json") || entries.some((e) => !allowed.includes(e.name))) throw new Error("Complete generation2 claim inventory required; partial slot remains consumed.");
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
    const body = { schemaVersion: 1 as const, action: "CLAIM_GENERATION2_BEFORE_CREATE" as const, fence, binding, preflightEvidenceSha256, reservedAt };
    const claim = { ...body, claimSha256: await sha256Hex(canonicalJson(body)) }; await assertArnProbeComparisonClaim(claim, fence); probeInstant(reservedAt);
    const parent = (await parents(true))!, slot = path.join(parent, slotName); inside(root, slot);
    await mkdir(slot); // Exclusive winner. A crash from here onward consumes it.
    const handle = await open(path.join(slot, "claim.json"), "wx");
    try { await handle.writeFile(`${JSON.stringify(claim, null, 2)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
    probeSame(await readClaim(), claim, "Generation2 durable claim readback"); return claim;
  }, workflowJournal: async (manifest) => {
    await assertArnProbeComparisonWorkflow(manifest);
    probeSame(manifest.input.creationReview.fence, fence, "Workflow fixed fence");
    probeSame(await readClaim(), manifest.input.claim, "Workflow durable generation2 claim");
    async function validate(step: ArnProbeComparisonStep, v: Record<string, unknown>) {
      const request = comparisonStepRequest(manifest, step, v.request);
      const reservedAt = String(v.reservedAt), at = probeInstant(reservedAt);
      if (at < probeInstant(manifest.input.claim.reservedAt) || (!step.startsWith("revoke-") && (at < probeInstant(manifest.input.reviewedAt) || at >= probeInstant(manifest.input.expiresAt)))) throw new Error("Comparison journal chronology/window drifted.");
      probeSame(v, { schemaVersion: 1, stage: "B5-J5g-j18", step, claimSha256: manifest.input.claim.claimSha256,
        manifestSha256: manifest.manifestSha256, operationSha256: manifest.operationSha256,
        request, requestSha256: await sha256Hex(canonicalJson(request)), reservedAt }, "Exact comparison write-ahead intent");
    }
    async function inventory() {
      probeSame(await readClaim(), manifest.input.claim, "Workflow claim stability");
      const slot = (await existing())!, values = new Map<ArnProbeComparisonStep, Readonly<Record<string, unknown>>>();
      let previous = probeInstant(manifest.input.claim.reservedAt);
      for (const step of ARN_PROBE_COMPARISON_STEPS) {
        const file = path.join(slot, `${step}-intent.json`); if (await missing(file)) continue;
        const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.size > 600_000) throw new Error("Comparison intent is not bounded/ordinary.");
        const v = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>; await validate(step, v);
        const at = probeInstant(String(v.reservedAt)); if (at < previous) throw new Error("Comparison step intent order drifted."); previous = at; values.set(step, v);
      }
      if ((values.size && !values.has("run")) || (["read-full-arn", "read-exact-name", "revoke-create", "revoke-execute"] as ArnProbeComparisonStep[]).some((s) => values.has(s) && !values.has("grant-execute")) ||
        (values.has("revoke-execute") && !values.has("revoke-create")) || (values.has("read-exact-name") && !values.has("read-full-arn"))) throw new Error("Comparison journal has a missing prerequisite; never repair.");
      return { slot, values };
    }
    await inventory();
    return { load: async (step) => {
      if (!ARN_PROBE_COMPARISON_STEPS.includes(step)) throw new Error("Unknown comparison journal step.");
      return (await inventory()).values.get(step) ?? null;
    }, reserve: async (step, request, reservedAt) => {
      if (!ARN_PROBE_COMPARISON_STEPS.includes(step)) throw new Error("Unknown comparison journal step.");
      const current = await inventory();
      if (current.values.has(step) || (step !== "run" && !current.values.has("run")) ||
        (step === "grant-execute" && current.values.size !== 1) || ((step.startsWith("read-") || step.startsWith("revoke-")) && !current.values.has("grant-execute")) ||
        (step === "read-exact-name" && !current.values.has("read-full-arn")) || (step === "revoke-execute" && !current.values.has("revoke-create")) ||
        (step.startsWith("read-") && current.values.has("revoke-create"))) throw new Error("Comparison step consumed or out of order; never replay.");
      const v = { schemaVersion: 1, stage: "B5-J5g-j18", step, claimSha256: manifest.input.claim.claimSha256, manifestSha256: manifest.manifestSha256,
        operationSha256: manifest.operationSha256, request, requestSha256: await sha256Hex(canonicalJson(request)), reservedAt };
      await validate(step, v); const handle = await open(path.join(current.slot, `${step}-intent.json`), "wx");
      try { await handle.writeFile(`${JSON.stringify(v, null, 2)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
      probeSame((await inventory()).values.get(step), v, "Comparison intent durable readback");
    } };
  } };
}
