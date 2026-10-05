import { lstat, realpath, readdir, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeSame } from "./arn-compatibility-probe-workflow.ts";
import { stackControlCopy } from "./arn-probe-stack-scoped-read-control-create.ts";
import { STACK_CONTROL_RETIREMENT as r, STACK_CONTROL_RETIREMENT_PATHS as paths, assertStackControlRetirementProof,
  stackControlGeneration6Fence, type StackControlRetirementProof } from "./arn-probe-stack-control-generation5-retirement.ts";
import { loadGeneration5RetirementEvidence, createStackControlRetirementLedger, readStackControlRetirementJson,
  type StackControlRetirementFiles } from "./arn-probe-stack-control-generation5-retirement-evidence.ts";
import { assertGeneration6Context, assertGeneration6Claim, generation6ClaimBinding, type Generation6Context,
  type Generation6Claim, type Generation6Slot } from "./arn-probe-stack-control-generation6.ts";

/** Full real archive/ledger validation on every read; a compact context never
 * substitutes for old evidence. Works after a legitimate generation6 claim,
 * unlike the older admission which deliberately requires registry absence. */
export async function loadGeneration6Context(repository: string, files: StackControlRetirementFiles, proofFile: string) {
  const archived = await loadGeneration5RetirementEvidence(repository, files);
  const proof = await readStackControlRetirementJson(proofFile) as StackControlRetirementProof;
  await assertStackControlRetirementProof(proof);
  probeSame(proof.intent.manifest.input.predecessor, archived.predecessor, "J23 generation6 genuine archived predecessor");
  probeSame(await (await createStackControlRetirementLedger(repository)).read(), proof.intent, "J23 generation6 actual permanent retirement intent");
  const context = stackControlCopy({ retirementProof: proof, revokeTarget: archived.creationReview.plan.revokeTarget });
  await assertGeneration6Context(context);
  return { context, archived };
}
async function absent(file: string) { try { await lstat(file); return false; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return true; throw e; } }
function inside(root: string, file: string) {
  const relative = path.relative(root, file); if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("J23 generation6 path escapes repository.");
}
/** No mkdir on construction/read. Exclusive fixed slot consumption precedes
 * one Create; partial/foreign/linked/corrupt state stays consumed forever.
 * This creation-only version does not accept any future workflow intent. */
export async function createGeneration6FsSlot(repository: string, context: Generation6Context): Promise<Generation6Slot> {
  await assertGeneration6Context(context); const fence = await stackControlGeneration6Fence(context.retirementProof), root = await realpath(repository);
  if (/^(?:\\\\|\/\/)/.test(root) || !(await lstat(root)).isDirectory()) throw new Error("J23 generation6 local repository required.");
  probeSame(fence.slotRelativePath, paths.successorSlot, "J23 fixed generation6 namespace");
  const segments = [".aws-sandbox", "j5gj23-stack-control", r.targetFenceKey], slotName = "slot-000006";
  async function ordinary(folder: string) {
    const info = await lstat(folder); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("J23 generation6 nonordinary ancestor.");
    const real = await realpath(folder); inside(root, real); return real;
  }
  async function parents(create: boolean) {
    let current = root;
    for (const segment of segments) {
      if (segment === r.targetFenceKey) {
        const entries = await readdir(current, { withFileTypes: true });
        if (entries.some(e => e.name !== segment || !e.isDirectory() || e.isSymbolicLink())) throw new Error("J23 generation6 unknown target; no repair.");
      }
      const next = path.join(current, segment); inside(root, next);
      if (await absent(next)) {
        if (!create) return null;
        try { await mkdir(next); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
      }
      current = await ordinary(next);
    }
    const entries = await readdir(current, { withFileTypes: true });
    if (entries.some(e => e.name !== slotName || !e.isDirectory() || e.isSymbolicLink())) throw new Error("J23 generation6 unknown slot; no generation fallback.");
    return current;
  }
  async function readClaim(): Promise<Generation6Claim | null> {
    const parent = await parents(false); if (!parent) return null;
    const slot = path.join(parent, slotName); if (await absent(slot)) return null;
    const folder = await ordinary(slot), entries = await readdir(folder, { withFileTypes: true });
    probeSame(entries.map(e => e.name), ["claim.json"], "J23 generation6 sole permanent claim");
    if (entries.some(e => !e.isFile() || e.isSymbolicLink())) throw new Error("J23 generation6 partial/linked slot; never repair.");
    const claim = await readStackControlRetirementJson(path.join(folder, "claim.json")) as Generation6Claim;
    await assertGeneration6Claim(claim, fence); return stackControlCopy(claim);
  }
  return { fence, readClaim, reserve: async (review, preflightEvidenceSha256, reservedAt) => {
    probeSame(review.fence, fence, "J23 generation6 reservation fence");
    probeSame(review.plan.input.candidate.input.context, context, "J23 generation6 reservation context");
    const binding = await generation6ClaimBinding(review), body = { schemaVersion: 1 as const, action: "CLAIM_GENERATION6_STACK_CONTROL_BEFORE_CREATE" as const,
      fence, binding, preflightEvidenceSha256, reservedAt };
    const claim = { ...body, claimSha256: await sha256Hex(canonicalJson(body)) }; await assertGeneration6Claim(claim, fence);
    // Validate any pre-existing partial/foreign state before attempting mkdir.
    if (await readClaim()) throw new Error("J23 generation6 slot consumed; no reset/retry.");
    const parent = (await parents(true))!, slot = path.join(parent, slotName); await mkdir(slot);
    const file = await open(path.join(slot, "claim.json"), "wx");
    try { await file.writeFile(`${JSON.stringify(claim, null, 2)}\n`); await file.sync(); } finally { await file.close(); }
    probeSame(await readClaim(), claim, "J23 generation6 durable exact readback"); return stackControlCopy(claim);
  } };
}
