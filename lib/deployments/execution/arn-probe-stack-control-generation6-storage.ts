import { lstat, realpath, readdir, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeSame, probeInstant } from "./arn-compatibility-probe-workflow.ts";
import { stackControlCopy } from "./arn-probe-stack-scoped-read-control-create.ts";
import { STACK_CONTROL_RETIREMENT as r, STACK_CONTROL_RETIREMENT_PATHS as paths, assertStackControlRetirementProof,
  stackControlGeneration6Fence, type StackControlRetirementProof } from "./arn-probe-stack-control-generation5-retirement.ts";
import { loadGeneration5RetirementEvidence, createStackControlRetirementLedger, readStackControlRetirementJson,
  type StackControlRetirementFiles } from "./arn-probe-stack-control-generation5-retirement-evidence.ts";
import { assertGeneration6Context, assertGeneration6Claim, generation6ClaimBinding, type Generation6Context,
  type Generation6Claim, type Generation6Slot } from "./arn-probe-stack-control-generation6.ts";
import { GENERATION6_STEPS, generation6StepRequest, type Generation6Step, type Generation6Journal } from "./arn-probe-stack-control-generation6-actions.ts";
import { assertGeneration6Workflow, type Generation6WorkflowManifest } from "./arn-probe-stack-control-generation6-workflow.ts";

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
 * Only the six manifest-bound permanent workflow steps are recognized. */
export async function createGeneration6FsSlot(repository: string, context: Generation6Context): Promise<Generation6Slot & {
  workflowIntentsPresent(): Promise<boolean>; workflowJournal(manifest: Generation6WorkflowManifest): Promise<Generation6Journal>;
}> {
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
  async function existing() {
    const parent = await parents(false); if (!parent) return null;
    const slot = path.join(parent, slotName); if (await absent(slot)) return null;
    const folder = await ordinary(slot), entries = await readdir(folder, { withFileTypes: true });
    const allowed = ["claim.json", ...GENERATION6_STEPS.map(step => `${step}-intent.json`)];
    if (!entries.some(e => e.name === "claim.json") || entries.some(e => !allowed.includes(e.name) || !e.isFile() || e.isSymbolicLink())) throw new Error("J23 generation6 partial/linked/foreign slot; never repair.");
    return folder;
  }
  async function readClaim(): Promise<Generation6Claim | null> {
    const folder = await existing(); if (!folder) return null;
    const claim = await readStackControlRetirementJson(path.join(folder, "claim.json")) as Generation6Claim;
    await assertGeneration6Claim(claim, fence);
    // Even a creation-only read rejects corrupt/linked intent envelopes. Full
    // exact manifest/action/order validation occurs before any workflow client.
    for (const step of GENERATION6_STEPS) {
      const file = path.join(folder, `${step}-intent.json`); if (await absent(file)) continue;
      const v = await readStackControlRetirementJson(file) as Record<string, unknown>;
      probeSame(v, { schemaVersion: 1, stage: "B5-J5g-j23", step, claimSha256: claim.claimSha256, manifestSha256: v.manifestSha256,
        operationSha256: v.operationSha256, request: v.request, requestSha256: await sha256Hex(canonicalJson(v.request)), reservedAt: v.reservedAt }, "J23 generation6 strict intent envelope");
      if ([v.manifestSha256, v.operationSha256].some(x => typeof x !== "string" || !/^[a-f0-9]{64}$/.test(x)) ||
        probeInstant(String(v.reservedAt)) < probeInstant(claim.reservedAt)) throw new Error("J23 generation6 corrupt intent digest/time; never repair.");
    }
    return stackControlCopy(claim);
  }
  async function durable(file: string, value: unknown) {
    const handle = await open(file, "wx");
    try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); }
  }
  return { fence, readClaim, workflowIntentsPresent: async () => {
    await readClaim(); const folder = await existing(); return !!folder && (await readdir(folder)).some(name => name !== "claim.json");
  }, reserve: async (review, preflightEvidenceSha256, reservedAt) => {
    probeSame(review.fence, fence, "J23 generation6 reservation fence");
    probeSame(review.plan.input.candidate.input.context, context, "J23 generation6 reservation context");
    const binding = await generation6ClaimBinding(review), body = { schemaVersion: 1 as const, action: "CLAIM_GENERATION6_STACK_CONTROL_BEFORE_CREATE" as const,
      fence, binding, preflightEvidenceSha256, reservedAt };
    const claim = { ...body, claimSha256: await sha256Hex(canonicalJson(body)) }; await assertGeneration6Claim(claim, fence);
    // Validate any pre-existing partial/foreign state before attempting mkdir.
    if (await readClaim()) throw new Error("J23 generation6 slot consumed; no reset/retry.");
    const parent = (await parents(true))!, slot = path.join(parent, slotName); await mkdir(slot);
    await durable(path.join(slot, "claim.json"), claim);
    probeSame(await readClaim(), claim, "J23 generation6 durable exact readback"); return stackControlCopy(claim);
  }, workflowJournal: async manifest => {
    await assertGeneration6Workflow(manifest); probeSame(manifest.input.creationReview.fence, fence, "J23 generation6 journal fence");
    probeSame(manifest.input.creationReview.plan.input.candidate.input.context, context, "J23 generation6 journal original context");
    probeSame(await readClaim(), manifest.input.claim, "J23 generation6 journal actual claim");
    async function validate(step: Generation6Step, v: Record<string, unknown>) {
      const request = generation6StepRequest(manifest, step, v.request), at = probeInstant(String(v.reservedAt));
      if (at < probeInstant(manifest.input.claim.reservedAt) || (!step.startsWith("revoke-") &&
        (at < probeInstant(manifest.input.reviewedAt) || at >= probeInstant(manifest.input.expiresAt)))) throw new Error("J23 generation6 permanent intent window drifted.");
      probeSame(v, { schemaVersion: 1, stage: "B5-J5g-j23", step, claimSha256: manifest.input.claim.claimSha256,
        manifestSha256: manifest.manifestSha256, operationSha256: manifest.operationSha256, request,
        requestSha256: await sha256Hex(canonicalJson(request)), reservedAt: v.reservedAt }, "J23 generation6 exact permanent action intent");
    }
    async function inventory() {
      probeSame(await readClaim(), manifest.input.claim, "J23 generation6 permanent claim stability"); const folder = (await existing())!;
      const values = new Map<Generation6Step, Readonly<Record<string, unknown>>>(); let previous = probeInstant(manifest.input.claim.reservedAt);
      for (const step of GENERATION6_STEPS) {
        const file = path.join(folder, `${step}-intent.json`); if (await absent(file)) continue;
        const v = await readStackControlRetirementJson(file) as Record<string, unknown>; await validate(step, v);
        const at = probeInstant(String(v.reservedAt)); if (at < previous) throw new Error("J23 generation6 journal intent chronology drifted."); previous = at; values.set(step, stackControlCopy(v));
      }
      if ((values.size && !values.has("run")) || (values.has("grant-execute") && !values.has("run")) ||
        GENERATION6_STEPS.slice(2).some(step => values.has(step) && !values.has("grant-execute")) ||
        (values.has("read-exact-name") && !values.has("read-full-arn")) || (values.has("revoke-execute") && !values.has("revoke-create"))) throw new Error("J23 generation6 journal prerequisite missing; never repair.");
      if (values.has("revoke-create")) for (const step of ["read-full-arn", "read-exact-name"] as const)
        if (values.has(step) && probeInstant(String(values.get(step)!.reservedAt)) >= probeInstant(String(values.get("revoke-create")!.reservedAt))) throw new Error("J23 generation6 read cannot follow Revoke intent.");
      return { folder, values, previous };
    }
    await inventory();
    return { load: async step => { if (!GENERATION6_STEPS.includes(step)) throw new Error("Unknown generation6 step."); return (await inventory()).values.get(step) ?? null; },
      reserve: async (step, request, reservedAt) => {
        if (!GENERATION6_STEPS.includes(step)) throw new Error("Unknown generation6 step."); const current = await inventory();
        if (current.values.has(step) || (step !== "run" && !current.values.has("run")) || (step === "grant-execute" && current.values.size !== 1) ||
          ((step.startsWith("read-") || step.startsWith("revoke-")) && !current.values.has("grant-execute")) ||
          (step === "read-exact-name" && !current.values.has("read-full-arn")) || (step === "revoke-execute" && !current.values.has("revoke-create")) ||
          (step.startsWith("read-") && current.values.has("revoke-create")) || probeInstant(reservedAt) < current.previous) throw new Error("J23 generation6 step consumed/out of order; never replay.");
        const v = { schemaVersion: 1, stage: "B5-J5g-j23", step, claimSha256: manifest.input.claim.claimSha256, manifestSha256: manifest.manifestSha256,
          operationSha256: manifest.operationSha256, request, requestSha256: await sha256Hex(canonicalJson(request)), reservedAt };
        await validate(step, v); await durable(path.join(current.folder, `${step}-intent.json`), v);
        probeSame((await inventory()).values.get(step), v, "J23 generation6 fsync and exact intent readback");
      } };
  } };
}
