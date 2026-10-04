import { lstat, realpath, readdir, mkdir, readFile, open } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeSame, probeInstant } from "./arn-compatibility-probe-workflow.ts";
import { stackScopedReadControlFence, type StackScopedReadControlPredecessor } from "./arn-probe-stack-scoped-read-control.ts";
import { assertStackControlClaim, stackControlClaimBinding, stackControlCopy,
  type StackControlFence, type StackControlClaim, type StackControlSlot } from "./arn-probe-stack-scoped-read-control-create.ts";
import { STACK_CONTROL_STEPS, assertStackControlActions, stackControlStepRequest,
  type StackControlStep, type StackControlActions, type StackControlJournal } from "./arn-probe-stack-scoped-read-control-actions.ts";

function inside(root: string, file: string) { const relative = path.relative(root, file); if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("J22 fixed slot escapes repository."); }
async function missing(file: string) { try { await lstat(file); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error; } }
/** No state created by construction or reads. Only one mkdir winner before
 * one Create; all partial/corrupt/unknown state fails closed and stays consumed. */
export async function createStackControlFsSlot(repository: string, input: StackControlFence, predecessor: StackScopedReadControlPredecessor): Promise<StackControlSlot & {
  workflowJournal(manifest: StackControlActions): Promise<StackControlJournal>;
}> {
  const root = await realpath(repository), fence = stackControlCopy(input);
  if (/^(?:\\\\|\/\/)/.test(root) || !(await lstat(root)).isDirectory()) throw new Error("J22 requires local repository.");
  probeSame(fence, await stackScopedReadControlFence(predecessor), "J22 independent fixed namespace");
  const segments = [".aws-sandbox", "j5gj22-stack-scoped-read-control", fence.targetFenceKey], slotName = "slot-000005";
  async function ordinary(file: string) {
    const info = await lstat(file); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("J22 slot ancestor is not ordinary.");
    const value = await realpath(file); inside(root, value); return value;
  }
  async function parents(create: boolean) {
    let current = root;
    for (const segment of segments) {
      if (segment === fence.targetFenceKey) {
        const entries = await readdir(current, { withFileTypes: true });
        if (entries.some(e => e.name !== segment || !e.isDirectory() || e.isSymbolicLink())) throw new Error("J22 unknown target; manual reconciliation.");
      }
      const next = path.join(current, segment); inside(root, next);
      if (await missing(next)) {
        if (!create) return null;
        try { await mkdir(next); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      }
      current = await ordinary(next);
    }
    const entries = await readdir(current, { withFileTypes: true });
    if (entries.some(e => e.name !== slotName || !e.isDirectory() || e.isSymbolicLink())) throw new Error("J22 unknown generation; no fallback/reset.");
    return current;
  }
  async function existing() {
    const parent = await parents(false); if (!parent) return null;
    const slot = path.join(parent, slotName); if (await missing(slot)) return null;
    const current = await ordinary(slot), entries = await readdir(current, { withFileTypes: true });
    const allowed = ["claim.json", ...STACK_CONTROL_STEPS.map(step => `${step}-intent.json`)];
    if (!entries.some(e => e.name === "claim.json") || entries.some(e => !allowed.includes(e.name) || !e.isFile() || e.isSymbolicLink())) throw new Error("J22 partial/foreign slot remains consumed; never repair.");
    return current;
  }
  async function json(file: string) {
    const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.size > 600_000 || info.nlink !== 1) throw new Error("J22 record is not bounded ordinary singleton file.");
    return JSON.parse(await readFile(file, "utf8"));
  }
  async function readClaim(): Promise<StackControlClaim | null> {
    const slot = await existing(); if (!slot) return null;
    const value = await json(path.join(slot, "claim.json")) as StackControlClaim; await assertStackControlClaim(value, fence); return stackControlCopy(value);
  }
  async function durable(file: string, value: unknown) {
    const handle = await open(file, "wx");
    try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
  }
  return { fence, readClaim, reserve: async (review, preflightEvidenceSha256, reservedAt) => {
    const binding = await stackControlClaimBinding(review); probeSame(review.fence, fence, "J22 reservation fence");
    const body = { schemaVersion: 1 as const, action: "CLAIM_GENERATION5_STACK_CONTROL_BEFORE_CREATE" as const, fence, binding, preflightEvidenceSha256, reservedAt };
    const claim = { ...body, claimSha256: await sha256Hex(canonicalJson(body)) }; await assertStackControlClaim(claim, fence);
    const parent = (await parents(true))!, slot = path.join(parent, slotName); inside(root, slot);
    await mkdir(slot); // Exclusive winner; crash here permanently consumes slot.
    await durable(path.join(slot, "claim.json"), claim); probeSame(await readClaim(), claim, "J22 durable exact claim readback"); return stackControlCopy(claim);
  }, workflowJournal: async manifest => {
    await assertStackControlActions(manifest); probeSame(manifest.input.creationReview.fence, fence, "J22 action fence");
    probeSame(await readClaim(), manifest.input.claim, "J22 durable claim for future journal");
    async function validate(step: StackControlStep, value: Record<string, unknown>) {
      const request = stackControlStepRequest(manifest, step, value.request), at = probeInstant(String(value.reservedAt));
      if (at < probeInstant(manifest.input.claim.reservedAt) || (!step.startsWith("revoke-") && (at < probeInstant(manifest.input.reviewedAt) || at >= probeInstant(manifest.input.expiresAt)))) throw new Error("J22 permanent intent window/chronology drifted.");
      probeSame(value, { schemaVersion: 1, stage: "B5-J5g-j22", step, claimSha256: manifest.input.claim.claimSha256,
        manifestSha256: manifest.manifestSha256, operationSha256: manifest.operationSha256, request,
        requestSha256: await sha256Hex(canonicalJson(request)), reservedAt: value.reservedAt }, "J22 exact write-ahead intent");
    }
    async function inventory() {
      probeSame(await readClaim(), manifest.input.claim, "J22 permanent claim stability"); const slot = (await existing())!;
      const values = new Map<StackControlStep, Readonly<Record<string, unknown>>>(); let previous = probeInstant(manifest.input.claim.reservedAt);
      for (const step of STACK_CONTROL_STEPS) {
        const file = path.join(slot, `${step}-intent.json`); if (await missing(file)) continue;
        const value = await json(file) as Record<string, unknown>; await validate(step, value);
        const at = probeInstant(String(value.reservedAt)); if (at < previous) throw new Error("J22 journal intent order drifted."); previous = at; values.set(step, stackControlCopy(value));
      }
      if ((values.size && !values.has("run")) || (values.has("grant-execute") && !values.has("run")) ||
        STACK_CONTROL_STEPS.slice(2).some(step => values.has(step) && !values.has("grant-execute")) ||
        (values.has("read-exact-name") && !values.has("read-full-arn")) || (values.has("revoke-execute") && !values.has("revoke-create"))) throw new Error("J22 journal prerequisite missing; never repair.");
      if (values.has("revoke-create")) for (const step of ["read-full-arn", "read-exact-name"] as const)
        if (values.has(step) && probeInstant(String(values.get(step)!.reservedAt)) >= probeInstant(String(values.get("revoke-create")!.reservedAt))) throw new Error("J22 read cannot follow Revoke intent.");
      return { slot, values, previous };
    }
    await inventory();
    return { load: async step => { if (!STACK_CONTROL_STEPS.includes(step)) throw new Error("Unknown J22 step."); return (await inventory()).values.get(step) ?? null; },
      reserve: async (step, request, reservedAt) => {
        if (!STACK_CONTROL_STEPS.includes(step)) throw new Error("Unknown J22 step."); const current = await inventory();
        if (current.values.has(step) || (step !== "run" && !current.values.has("run")) || (step === "grant-execute" && current.values.size !== 1) ||
          ((step.startsWith("read-") || step.startsWith("revoke-")) && !current.values.has("grant-execute")) ||
          (step === "read-exact-name" && !current.values.has("read-full-arn")) || (step === "revoke-execute" && !current.values.has("revoke-create")) ||
          (step.startsWith("read-") && current.values.has("revoke-create")) || probeInstant(reservedAt) < current.previous) throw new Error("J22 step consumed/out of order; never replay.");
        const value = { schemaVersion: 1, stage: "B5-J5g-j22", step, claimSha256: manifest.input.claim.claimSha256, manifestSha256: manifest.manifestSha256,
          operationSha256: manifest.operationSha256, request, requestSha256: await sha256Hex(canonicalJson(request)), reservedAt };
        await validate(step, value); await durable(path.join(current.slot, `${step}-intent.json`), value);
        probeSame((await inventory()).values.get(step), value, "J22 durable intent readback");
      } };
  } };
}
