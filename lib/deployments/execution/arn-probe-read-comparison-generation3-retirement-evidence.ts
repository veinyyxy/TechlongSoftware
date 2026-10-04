import { lstat, realpath, readdir, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeSame } from "./arn-compatibility-probe-workflow.ts";
import { readArnProbeReadComparisonJson } from "./arn-compatibility-probe-read-comparison-evidence.ts";
import { loadReadComparisonRetirementProof as loadGeneration2Proof, type ReadComparisonRetirementFiles as Generation2Files } from "./arn-probe-read-comparison-retirement-evidence.ts";
import { assertArnProbeComparisonCreateReview, arnProbeComparisonClaimBinding, type ArnProbeComparisonCreateReview } from "./arn-probe-read-comparison-generation3-create.ts";
import { createArnProbeComparisonFsSlot } from "./arn-probe-read-comparison-generation3-slot.ts";
import { assertArnProbeComparisonWorkflow } from "./arn-probe-read-comparison-generation3-workflow.ts";
import { READ_COMPARISON_RETIREMENT as r, closedReadComparisonPredecessor, retirementDigest,
  assertRetirementIntent, assertReadComparisonRetirementProof, type RetirementLedger, type RetirementIntent,
  type ReadComparisonRetirementProof } from "./arn-probe-read-comparison-generation3-retirement.ts";
export type ReadComparisonRetirementFiles = {
  generation2: { evidence: string; retirementProof: string };
  creationReview: string; creationReceipt: string; recoveryReceipt: string; executionReview: string; closureReceipt: string;
};
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

/** Every generation is anchored to its actual preserved files and consumed
 * directories. Reading never mkdir, rewrites, repairs or adopts another claim. */
export async function loadReadComparisonRetirementEvidence(repository: string, files: ReadComparisonRetirementFiles) {
  probeSame(Object.keys(files).sort(), ["closureReceipt", "creationReceipt", "creationReview", "executionReview", "generation2", "recoveryReceipt"], "Generation3 retirement evidence map");
  probeSame(Object.keys(files.generation2).sort(), ["evidence", "retirementProof"], "Archived generation2 paths");
  const oldFiles = await readArnProbeReadComparisonJson(files.generation2.evidence) as Generation2Files;
  const generation2 = await loadGeneration2Proof(repository, files.generation2.retirementProof, oldFiles);
  if (generation2.proof.receiptSha256 !== r.generation2RetirementProofSha256) throw new Error("Exact prior independent retirement proof required.");
  const [review, created, recovered, execution, closure] = await Promise.all(
    [files.creationReview, files.creationReceipt, files.recoveryReceipt, files.executionReview, files.closureReceipt].map(readArnProbeReadComparisonJson));
  await retirementDigest(review, "reviewSha256", r.creationReviewSha256);
  await assertArnProbeComparisonCreateReview(review as ArnProbeComparisonCreateReview);
  await retirementDigest(created, "receiptSha256", r.creationReceiptSha256);
  await retirementDigest(recovered, "receiptSha256", r.recoveryReceiptSha256);
  await retirementDigest(execution, "reviewSha256", r.executionReviewSha256);
  await retirementDigest(closure, "receiptSha256", r.closureReceiptSha256);
  await assertArnProbeComparisonWorkflow(execution.manifest);
  probeSame(execution.manifest.input.creationReview, review, "Historical generation3 execution input");
  probeSame(review.plan.input.retirementProof, generation2.proof, "Actual archived generation2 retirement");
  probeSame(review.sourceReview.predecessor, generation2.generation1.predecessor, "Preserved original generation1");
  probeSame(review.sourceReview.plan.input.priorPlan, generation2.generation1.priorPlan, "Original prior plan");
  if (review.plan.planSha256 !== r.planSha256 || review.plan.requestSha256 !== r.requestSha256 ||
      review.plan.templateCanonicalSha256 !== r.grantTemplateSha256 || review.plan.input.variant !== "EXACT_NAME_CONDITION" ||
      execution.manifest.manifestSha256 !== r.executionManifestSha256 || execution.outcome !== "EXECUTION_REVIEW_READY_NOT_APPROVED" ||
      execution.executionApproved !== false || execution.mutationPerformed !== false || execution.operatorReadPerformed !== false ||
      created.outcome !== "CREATE_SUBMITTED" || created.target?.changeSetArn !== r.grantArn || created.grantInstalled !== false ||
      recovered.outcome !== "READY_UNEXECUTED" || closure.outcome !== "READY_UNEXECUTED" ||
      Date.parse(closure.observedAt) <= Date.parse(execution.manifest.input.expiresAt)) throw new Error("Exact closed, never-installed generation3 archive required.");
  const root = await localRoot(repository), registry = (await ordinaryDirectory(root, ".aws-sandbox/j5gj19-read-comparison"))!;
  await names(registry, [r.targetFenceKey], true);
  await names((await ordinaryDirectory(root, `.aws-sandbox/j5gj19-read-comparison/${r.targetFenceKey}`))!, ["slot-000003"], true);
  await names((await ordinaryDirectory(root, r.oldSlot))!, ["claim.json"]);
  const slot = await createArnProbeComparisonFsSlot(repository, review.fence, generation2.proof), claim = await slot.readClaim();
  if (!claim || claim.claimSha256 !== r.claimSha256) throw new Error("Original generation3 claim changed; no reset or workflow retirement.");
  probeSame(claim.binding, await arnProbeComparisonClaimBinding(review), "Unique generation3 approval/request");
  for (const receipt of [created, recovered, closure]) probeSame(receipt.claim, claim, "Anchored exact generation3 claim");
  probeSame(execution.manifest.input.claim, claim, "Unapproved manifest bound claim");
  for (const receipt of [recovered, closure]) {
    if (receipt.mutationPerformed !== false || receipt.retryAuthorized !== false || receipt.grantExecutionAuthorized !== false ||
        receipt.operatorReadAuthorized !== false || receipt.runtimeEnabled !== false ||
        receipt.productionCompatibilityVerified !== false || receipt.observation.grant.changeSetArn !== r.grantArn ||
        receipt.observation.grant.templateCanonicalSha256 !== r.grantTemplateSha256) throw new Error("Historical read-only receipt scope drift.");
    for (const m of [receipt.observation.managementBefore, receipt.observation.managementAfter])
      if (await sha256Hex(canonicalJson({ ...m, observedAt: null })) !== r.lockedObservationSha256) throw new Error("Historical full Locked snapshot drift.");
    for (const f of [receipt.observation.fixtureBefore, receipt.observation.fixtureAfter])
      probeSame({ ...f, observedAt: null }, { ...review.sourceReview.observation.fixtureAfter, observedAt: null }, "Archived original fixture");
  }
  return { generation1: generation2.generation1, generation2, review: review as ArnProbeComparisonCreateReview,
    predecessor: await closedReadComparisonPredecessor(generation2.generation1.predecessor, generation2.proof) };
}
/** One physical retirement slot shared by every review/window. Exclusive mkdir
 * consumes the slot even if the subsequent write or cloud request is lost. */
export async function createReadComparisonRetirementLedger(repository: string): Promise<RetirementLedger> {
  const root = await localRoot(repository), registryRelative = ".aws-sandbox/j5gj20-read-retirement";
  async function parent(create: boolean) {
    const registry = await ordinaryDirectory(root, registryRelative, create); if (!registry) return null;
    const entries = await readdir(registry, { withFileTypes: true });
    if (entries.some((e) => e.name !== r.targetFenceKey || !e.isDirectory() || e.isSymbolicLink())) throw new Error("Unknown retirement target; no automatic successor.");
    const target = await ordinaryDirectory(root, `${registryRelative}/${r.targetFenceKey}`, create); if (!target) return null;
    const generations = await readdir(target, { withFileTypes: true });
    if (generations.some((e) => e.name !== "slot-000003" || !e.isDirectory() || e.isSymbolicLink())) throw new Error("Unknown retirement generation.");
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
    const target = (await parent(true))!, slot = path.join(target, "slot-000003");
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
  probeSame(proof.intent.manifest.input.predecessor, old.predecessor, "Generation4 preserved predecessors");
  probeSame(await (await createReadComparisonRetirementLedger(repository)).read(), proof.intent, "Generation4 actual retirement intent");
  return { ...old, proof: JSON.parse(canonicalJson(proof)) as ReadComparisonRetirementProof };
}
