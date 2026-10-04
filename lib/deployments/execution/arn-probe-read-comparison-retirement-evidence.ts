import { lstat, realpath, readdir, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "./hash.ts";
import { probeSame } from "./arn-compatibility-probe-workflow.ts";
import { readArnProbeReadComparisonJson, loadArnProbeReadComparisonEvidence,
  type ArnProbeReadComparisonEvidenceFiles } from "./arn-compatibility-probe-read-comparison-evidence.ts";
import { assertArnProbeComparisonCreateReview, arnProbeComparisonClaimBinding,
  type ArnProbeComparisonCreateReview } from "./arn-probe-read-comparison-create.ts";
import { createArnProbeComparisonFsSlot } from "./arn-probe-read-comparison-slot.ts";
import { READ_COMPARISON_RETIREMENT as r, closedReadComparisonPredecessor, retirementDigest,
  assertRetirementIntent, assertReadComparisonRetirementProof, type RetirementLedger, type RetirementIntent,
  type ReadComparisonRetirementProof } from "./arn-probe-read-comparison-retirement.ts";

export type ReadComparisonRetirementFiles = { generation1: ArnProbeReadComparisonEvidenceFiles;
  creationReview: string; creationReceipt: string; recoveryReceipt: string; closureReceipt: string };
async function ordinaryDirectory(root: string, relative: string, create = false): Promise<string | null> {
  let current = root;
  for (const segment of relative.split("/")) {
    if (!segment || segment === "." || segment === "..") throw new Error("Invalid permanent retirement path.");
    current = path.join(current, segment);
    try { await lstat(current); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      if (!create) return null;
      try { await mkdir(current); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    const info = await lstat(current); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Retirement ledger ancestor is not ordinary.");
    current = await realpath(current); const rel = path.relative(root, current);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Retirement ledger escapes repository.");
  }
  return current;
}
async function names(folder: string, expected: string[], directories = false) {
  const entries = await readdir(folder, { withFileTypes: true });
  probeSame(entries.map((e) => e.name).sort(), [...expected].sort(), "Complete permanent ledger inventory");
  if (entries.some((e) => e.isSymbolicLink() || (directories ? !e.isDirectory() : !e.isFile()))) throw new Error("Ledger entry is not ordinary.");
}
async function localRoot(repository: string) {
  const root = await realpath(repository);
  if (/^(?:\\\\|\/\/)/.test(root) || !(await lstat(root)).isDirectory()) throw new Error("Local repository required.");
  return root;
}
/** Re-hash every anchored predecessor and prove generation2 has no workflow
 * intents. Does not create, repair or remove any ledger. */
export async function loadReadComparisonRetirementEvidence(repository: string, files: ReadComparisonRetirementFiles) {
  probeSame(Object.keys(files).sort(), ["closureReceipt", "creationReceipt", "creationReview", "generation1", "recoveryReceipt"], "Retirement evidence map");
  const generation1 = await loadArnProbeReadComparisonEvidence(repository, files.generation1);
  const [review, created, recovered, closure] = await Promise.all([files.creationReview, files.creationReceipt, files.recoveryReceipt, files.closureReceipt].map(readArnProbeReadComparisonJson));
  await retirementDigest(review, "reviewSha256", r.creationReviewSha256);
  await assertArnProbeComparisonCreateReview(review as ArnProbeComparisonCreateReview);
  await retirementDigest(created, "receiptSha256", r.creationReceiptSha256);
  await retirementDigest(recovered, "receiptSha256", r.recoveryReceiptSha256);
  await retirementDigest(closure, "receiptSha256", r.closureReceiptSha256);
  probeSame(review.sourceReview.predecessor, generation1.predecessor, "Generation2 preserved generation1");
  probeSame(review.sourceReview.plan.input.priorPlan, generation1.priorPlan, "Generation2 prior plan");
  if (review.plan.planSha256 !== r.planSha256 || review.plan.requestSha256 !== r.requestSha256 ||
    review.plan.templateCanonicalSha256 !== r.grantTemplateSha256 || review.plan.input.variant !== "EXACT_NAME_CONDITION" ||
    created.outcome !== "CREATE_SUBMITTED" || created.target?.changeSetArn !== r.grantArn || created.grantInstalled !== false ||
    recovered.outcome !== "READY_UNEXECUTED" || closure.outcome !== "READY_UNEXECUTED") throw new Error("Exact closed generation2 archive required.");
  const root = await localRoot(repository), registry = (await ordinaryDirectory(root, ".aws-sandbox/j5gj17-read-comparison"))!;
  await names(registry, [r.targetFenceKey], true);
  await names((await ordinaryDirectory(root, `.aws-sandbox/j5gj17-read-comparison/${r.targetFenceKey}`))!, ["slot-000002"], true);
  await names((await ordinaryDirectory(root, r.oldSlot))!, ["claim.json"]);
  const oldSlot = await createArnProbeComparisonFsSlot(repository, review.fence), claim = await oldSlot.readClaim();
  if (!claim || claim.claimSha256 !== r.claimSha256) throw new Error("Original generation2 claim changed; never reset or adopt another generation.");
  probeSame(claim.binding, await arnProbeComparisonClaimBinding(review), "Old exact creation binding");
  for (const receipt of [created, recovered, closure]) probeSame(receipt.claim, claim, "Anchored old claim");
  return { generation1, review: review as ArnProbeComparisonCreateReview, predecessor: await closedReadComparisonPredecessor(generation1.predecessor) };
}
/** One physical retirement slot shared by every review/window. Exclusive mkdir
 * consumes the slot even if the subsequent write or cloud request is lost. */
export async function createReadComparisonRetirementLedger(repository: string): Promise<RetirementLedger> {
  const root = await localRoot(repository), registryRelative = ".aws-sandbox/j5gj19-read-retirement";
  async function parent(create: boolean) {
    const registry = await ordinaryDirectory(root, registryRelative, create); if (!registry) return null;
    const entries = await readdir(registry, { withFileTypes: true });
    if (entries.some((e) => e.name !== r.targetFenceKey || !e.isDirectory() || e.isSymbolicLink())) throw new Error("Unknown retirement target; no automatic successor.");
    const target = await ordinaryDirectory(root, `${registryRelative}/${r.targetFenceKey}`, create); if (!target) return null;
    const generations = await readdir(target, { withFileTypes: true });
    if (generations.some((e) => e.name !== "slot-000002" || !e.isDirectory() || e.isSymbolicLink())) throw new Error("Unknown retirement generation.");
    return target;
  }
  async function read(): Promise<RetirementIntent | null> {
    if (!(await parent(false))) return null;
    const slot = await ordinaryDirectory(root, r.retirementSlot); if (!slot) return null;
    await names(slot, ["delete-intent.json"]); // Partial slot is consumed, never repaired.
    const intent = await readArnProbeReadComparisonJson(path.join(slot, "delete-intent.json")) as RetirementIntent;
    await assertRetirementIntent(intent); return intent;
  }
  return { read, reserve: async (intent) => {
    await assertRetirementIntent(intent); if (await read()) throw new Error("Retirement already consumed.");
    const target = (await parent(true))!, slot = path.join(target, "slot-000002");
    await mkdir(slot); // no recursive mkdir; a concurrent contender loses permanently
    const file = await open(path.join(slot, "delete-intent.json"), "wx");
    try { await file.writeFile(`${JSON.stringify(intent, null, 2)}\n`, "utf8"); await file.sync(); } finally { await file.close(); }
    probeSame(await read(), intent, "Retirement durable readback");
  } };
}
export async function loadReadComparisonRetirementProof(repository: string, file: string, files: ReadComparisonRetirementFiles) {
  const old = await loadReadComparisonRetirementEvidence(repository, files);
  const proof = await readArnProbeReadComparisonJson(file) as ReadComparisonRetirementProof;
  await assertReadComparisonRetirementProof(proof);
  probeSame(proof.intent.manifest.input.predecessor, old.predecessor, "Generation3 preserved predecessors");
  probeSame(await (await createReadComparisonRetirementLedger(repository)).read(), proof.intent, "Generation3 actual retirement intent");
  return { ...old, proof: JSON.parse(canonicalJson(proof)) as ReadComparisonRetirementProof };
}
