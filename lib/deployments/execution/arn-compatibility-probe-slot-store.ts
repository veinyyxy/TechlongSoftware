import { open, readFile, lstat, realpath, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeSame, probeInstant, assertArnProbeWorkflowManifest, type ArnProbeWorkflowManifest, type ArnProbeWorkflowJournal, type ProbeStep } from "./arn-compatibility-probe-workflow.ts";
import type { ArnProbeFixedSlot, ArnProbeSlotScope, ArnProbeSlotClaim } from "./arn-compatibility-probe-fenced-create.ts";

const steps: ProbeStep[] = ["run", "grant-execute", "probe-delete", "revoke-create", "revoke-execute"];
function digest(v: unknown) { if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v)) throw new Error("Fixed slot digest is incomplete."); }
function inside(root: string, value: string) { const relative = path.relative(root, value); if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Fixed slot escapes its repository."); }
async function json(file: string) {
  const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.size > 600_000) throw new Error("Fixed slot record is not an ordinary bounded file.");
  return JSON.parse(await readFile(file, "utf8"));
}
async function missing(file: string) { try { await lstat(file); return false; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return true; throw e; } }
async function writeOnce(file: string, value: unknown) {
  const handle = await open(file, "wx");
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
}
/** Single local repository, one explicitly reviewed successor generation only.
 * Missing/partial/corrupt claims are never repaired or overwritten.
 */
export async function createArnProbeFsFixedSlot(repository: string, inputScope: ArnProbeSlotScope): Promise<ArnProbeFixedSlot & {
  workflowJournal(manifest: ArnProbeWorkflowManifest): Promise<ArnProbeWorkflowJournal>;
}> {
  const root = await realpath(repository), scope: ArnProbeSlotScope = JSON.parse(canonicalJson(inputScope));
  if (/^(?:\\\\|\/\/)/.test(root) || !(await lstat(root)).isDirectory()) throw new Error("Fixed slot requires an ordinary local repository, not UNC storage.");
  probeSame(Object.keys(scope).sort(), ["creationReviewSha256", "generation", "planSha256", "predecessorArchiveSha256", "requestSha256", "slotRelativePath", "stage", "targetFenceKey"], "Fixed slot scope fields");
  for (const key of ["targetFenceKey", "predecessorArchiveSha256", "creationReviewSha256", "planSha256", "requestSha256"] as const) digest(scope[key]);
  if (scope.stage !== "B5-J5g-j14" || scope.generation !== 1 || scope.slotRelativePath !== `.aws-sandbox/j5gj13-arn-probe/${scope.targetFenceKey}/slot-000001`) throw new Error("Only the fixed generation1 slot is supported.");
  Object.freeze(scope);
  const segments = [".aws-sandbox", "j5gj13-arn-probe", scope.targetFenceKey], slotName = "slot-000001";
  async function parents(create: boolean): Promise<string | null> {
    let current = root;
    for (const segment of segments) {
      if (segment === scope.targetFenceKey) {
        const entries = await readdir(current, { withFileTypes: true });
        if (entries.some((v) => v.name !== scope.targetFenceKey || !v.isDirectory() || v.isSymbolicLink())) throw new Error("Unknown renewal target needs manual reconciliation.");
      }
      current = path.join(current, segment); inside(root, current);
      if (await missing(current)) {
        if (!create) return null;
        try { await mkdir(current); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
      }
      const info = await lstat(current); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Fixed slot ancestor is not an ordinary directory.");
      current = await realpath(current); inside(root, current);
    }
    const base = path.dirname(current), baseEntries = await readdir(base, { withFileTypes: true });
    if (baseEntries.some((v) => v.name !== scope.targetFenceKey || !v.isDirectory() || v.isSymbolicLink())) throw new Error("Unknown renewal target needs manual reconciliation.");
    const entries = await readdir(current, { withFileTypes: true });
    if (entries.some((v) => v.name !== slotName || !v.isDirectory() || v.isSymbolicLink())) throw new Error("Unknown renewal generation needs manual reconciliation.");
    return current;
  }
  async function existingSlot() {
    const parent = await parents(false); if (!parent) return null;
    const slot = path.join(parent, slotName); if (await missing(slot)) return null;
    const info = await lstat(slot); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Fixed slot is not an ordinary directory.");
    const resolved = await realpath(slot); inside(root, resolved);
    const files = await readdir(resolved, { withFileTypes: true }), allowed = ["claim.json", ...steps.map((step) => `${step}-intent.json`)];
    if (files.some((v) => !allowed.includes(v.name) || !v.isFile() || v.isSymbolicLink())) throw new Error("Unknown fixed-slot record needs manual reconciliation.");
    return resolved;
  }
  async function readClaim(): Promise<ArnProbeSlotClaim | null> {
    const slot = await existingSlot(); if (!slot) return null;
    // An existing slot without a complete claim is consumed/uncertain, not free.
    const value = await json(path.join(slot, "claim.json")), { claimSha256, ...body } = value;
    probeSame(Object.keys(body).sort(), ["action", "preflightEvidenceSha256", "reservedAt", "schemaVersion", "scope"], "Fixed claim fields");
    probeSame(body.scope, scope, "Durable fixed claim scope"); digest(body.preflightEvidenceSha256); probeInstant(body.reservedAt);
    if (body.schemaVersion !== 1 || body.action !== "CLAIM_FIXED_SLOT_BEFORE_CREATE" || claimSha256 !== await sha256Hex(canonicalJson(body))) throw new Error("Fixed claim is corrupt; never replay or repair it.");
    return value as ArnProbeSlotClaim;
  }
  return { scope, readClaim,
    reserve: async (preflightEvidenceSha256, reservedAt) => {
      digest(preflightEvidenceSha256); probeInstant(reservedAt);
      const parent = (await parents(true))!, slot = path.join(parent, slotName); inside(root, slot);
      // mkdir without recursive is the one-winner claim. Even a crash before
      // claim.json finishes consumes this directory; no automatic resume.
      await mkdir(slot);
      const body = { schemaVersion: 1 as const, action: "CLAIM_FIXED_SLOT_BEFORE_CREATE" as const, scope, preflightEvidenceSha256, reservedAt };
      const claim = { ...body, claimSha256: await sha256Hex(canonicalJson(body)) };
      await writeOnce(path.join(slot, "claim.json"), claim);
      const checked = await readClaim(); probeSame(checked, claim, "Fixed claim readback"); return claim;
    },
    workflowJournal: async (manifest) => {
      await assertArnProbeWorkflowManifest(manifest);
      if (manifest.input.plan.planSha256 !== scope.planSha256 || !(await readClaim())) throw new Error("Workflow requires the exact claimed successor plan.");
      const requests: Record<ProbeStep, unknown> = { run: manifest.actions, "grant-execute": manifest.actions.grantExecute.request,
        "probe-delete": manifest.actions.probeDelete.request, "revoke-create": manifest.actions.revoke.createRequest, "revoke-execute": null };
      async function validate(step: ProbeStep, value: Readonly<Record<string, unknown>>) {
        digest(value.requestSha256); probeInstant(String(value.reservedAt));
        probeSame(value, { stage: "B5-J5g-j11", step, operationSha256: manifest.operationSha256, manifestSha256: manifest.manifestSha256,
          requestSha256: step === "revoke-execute" ? value.requestSha256 : await sha256Hex(canonicalJson(requests[step])), reservedAt: value.reservedAt }, "Fixed workflow intent");
      }
      async function load(step: ProbeStep) {
        if (!(await readClaim())) throw new Error("Workflow fixed claim disappeared.");
        const slot = (await existingSlot())!, file = path.join(slot, `${step}-intent.json`);
        if (await missing(file)) return null;
        const value = await json(file); await validate(step, value); return value;
      }
      return { load, reserve: async (step, value) => {
        await validate(step, value);
        if (!(await readClaim())) throw new Error("Workflow fixed claim disappeared.");
        if (step !== "run" && !(await load("run"))) throw new Error("Fixed run binding is required before any workflow intent.");
        await writeOnce(path.join((await existingSlot())!, `${step}-intent.json`), value);
      } };
    },
  };
}
