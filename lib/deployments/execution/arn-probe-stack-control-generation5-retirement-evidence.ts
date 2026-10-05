import { lstat, realpath, readdir, mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { probeSame } from "./arn-compatibility-probe-workflow.ts";
import { readStackControlReviewJson } from "./arn-probe-stack-scoped-read-control-json.ts";
import { loadClosedStackScopedReadControlEvidence, type StackScopedReadControlFiles } from "./arn-probe-stack-scoped-read-control-evidence.ts";
import { createStackControlFsSlot } from "./arn-probe-stack-scoped-read-control-slot.ts";
import { assertStackControlCreateReview, assertStackControlCreationObservation, stackControlClaimBinding, type StackControlCreateReview } from "./arn-probe-stack-scoped-read-control-create.ts";
import { assertStackControlWorkflow, type StackControlWorkflowManifest, type inspectStackControlWorkflow } from "./arn-probe-stack-scoped-read-control-workflow.ts";
import { STACK_CONTROL_RETIREMENT as r, STACK_CONTROL_RETIREMENT_PATHS as paths, stackControlRetirementDigest, closedGeneration5Descriptor,
  assertStackControlRetirementState, assertStackControlRetirementIntent, assertStackControlRetirementProof, stackControlGeneration6Fence,
  type StackControlRetirementIntent, type StackControlRetirementLedger, type StackControlRetirementProof } from "./arn-probe-stack-control-generation5-retirement.ts";

/** Small new envelopes retain references, not another copy of all old trees. */
export async function readStackControlRetirementJson(file: string) {
  if (!path.isAbsolute(file) || /^(?:\\\\|\/\/)/.test(file)) throw new Error("J23 explicit local absolute file required.");
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 600_000) throw new Error("J23 bounded ordinary singleton file required.");
  const data = await readFile(file), after = await lstat(file);
  if (data.byteLength !== before.size || before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
    !after.isFile() || after.isSymbolicLink() || after.nlink !== 1) throw new Error("J23 evidence changed during read.");
  return JSON.parse(data.toString("utf8"));
}
export type StackControlRetirementFiles = Readonly<Record<"oldEvidence" | "creationReview" | "creationReceipt" | "recoveryReceipt" | "executionReview" | "closureReceipt", string>>;
async function rootPath(repository: string) {
  const root = await realpath(repository); if (/^(?:\\\\|\/\/)/.test(root) || !(await lstat(root)).isDirectory()) throw new Error("J23 local repository required."); return root;
}
async function directory(root: string, relative: string, create = false): Promise<string | null> {
  let current = root;
  for (const segment of relative.split("/")) {
    if (!segment || segment === "." || segment === "..") throw new Error("J23 invalid fixed ledger path.");
    current = path.join(current, segment);
    try { await lstat(current); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; if (!create) return null;
      try { await mkdir(current); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    const info = await lstat(current); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("J23 ledger ancestor is not ordinary.");
    current = await realpath(current); const rel = path.relative(root, current); if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("J23 ledger escapes repository.");
  }
  return current;
}
async function names(folder: string, allowed: readonly string[], exact: boolean, folders = false) {
  const entries = await readdir(folder, { withFileTypes: true });
  if (exact) probeSame(entries.map(e => e.name).sort(), [...allowed].sort(), "J23 complete ledger inventory");
  if (entries.some(e => !allowed.includes(e.name) || e.isSymbolicLink() || (folders ? !e.isDirectory() : !e.isFile()))) throw new Error("J23 foreign/partial ledger state; never repair.");
}
/** All old trees are recompiled and all actual claims/journals read. The
 * resulting descriptor is small, but never replaces this admission check. */
export async function loadGeneration5RetirementEvidence(repository: string, files: StackControlRetirementFiles) {
  probeSame(Object.keys(files).sort(), ["closureReceipt", "creationReceipt", "creationReview", "executionReview", "oldEvidence", "recoveryReceipt"], "J23 exact evidence paths");
  if (Object.values(files).some(v => typeof v !== "string" || !path.isAbsolute(v))) throw new Error("J23 explicit absolute evidence paths required.");
  const root = await rootPath(repository), oldFiles = await readStackControlRetirementJson(files.oldEvidence) as StackScopedReadControlFiles;
  const old = await loadClosedStackScopedReadControlEvidence(root, oldFiles);
  if (old.predecessor.predecessorSha256 !== r.oldPredecessorSha256 || old.predecessor.journalSha256 !== r.oldJournalSha256) throw new Error("J23 original closed generation4 changed.");
  const [review, workflow, created, recovered, closure] = await Promise.all([
    readStackControlReviewJson(files.creationReview), readStackControlReviewJson(files.executionReview),
    readStackControlRetirementJson(files.creationReceipt), readStackControlRetirementJson(files.recoveryReceipt), readStackControlRetirementJson(files.closureReceipt),
  ]);
  for (const [v, key, expected] of [[review, "reviewSha256", r.creationReviewSha256], [workflow, "reviewSha256", r.executionReviewSha256],
    [created, "receiptSha256", r.creationReceiptSha256], [recovered, "receiptSha256", r.recoveryReceiptSha256], [closure, "receiptSha256", r.closureReceiptSha256]] as const)
    await stackControlRetirementDigest(v, key, expected);
  const creationReview = review as StackControlCreateReview, manifest = workflow.manifest as StackControlWorkflowManifest;
  await assertStackControlCreateReview(creationReview); await assertStackControlWorkflow(manifest);
  probeSame(manifest.input.creationReview, creationReview, "J23 exact historical creation");
  probeSame(creationReview.plan.input.candidate.input.predecessor, old.predecessor, "J23 genuine archived predecessor");
  if (creationReview.plan.planSha256 !== r.planSha256 || creationReview.plan.requestSha256 !== r.requestSha256 || creationReview.plan.templateCanonicalSha256 !== r.grantTemplateSha256 ||
    manifest.manifestSha256 !== r.executionManifestSha256 || workflow.outcome !== "EXECUTION_REVIEW_READY_NOT_APPROVED" || workflow.executionApproved !== false ||
    created.target?.changeSetArn !== r.grantArn || created.outcome !== "CREATE_SUBMITTED" || created.grantInstalled !== false || created.grantExecutionAuthorized !== false ||
    recovered.outcome !== "READY_UNEXECUTED" || recovered.mutationPerformed !== false || recovered.grantExecutionAuthorized !== false ||
    closure.observedAt !== r.closureObservedAt || Date.parse(closure.observedAt) < Date.parse(r.policyExpiresAt)) throw new Error("J23 exact never-installed generation5 archive required.");
  assertStackControlCreationObservation(creationReview.plan, recovered.observation, Date.parse(recovered.observedAt));
  const inspect = closure as Awaited<ReturnType<typeof inspectStackControlWorkflow>>;
  probeSame(inspect, { stage: "B5-J5g-j22", mode: "READ_ONLY_INSPECT", manifestSha256: manifest.manifestSha256, claim: manifest.input.claim,
    management: inspect.management, fixture: inspect.fixture, fixtureInventory: inspect.fixtureInventory, managementInventory: inspect.managementInventory,
    outcome: "LOCKED_VERIFIED", mutationPerformed: false, retryAuthorized: false, operatorSessionCreated: false, productionCompatibilityVerified: false,
    runtimeEnabled: false, observedAt: inspect.observedAt, receiptSha256: inspect.receiptSha256 }, "J23 exact successful historical Inspect");
  // Historical Inspect contains its final complete snapshot, not a fabricated
  // before/after pair. Its anchored receipt came from the independent Inspect.
  const at = Date.parse(inspect.observedAt), chronological = [inspect.fixture.observedAt, inspect.fixtureInventory.observedAt, inspect.managementInventory.observedAt, inspect.management.observedAt];
  if (chronological.some((v, index) => index && Date.parse(v) < Date.parse(chronological[index - 1]))) throw new Error("J23 archived Inspect chronology drifted.");
  await assertStackControlRetirementState(inspect.management, inspect.fixture, inspect.fixtureInventory, inspect.managementInventory, "PRESENT", at);
  const registry = (await directory(root, ".aws-sandbox/j5gj22-stack-scoped-read-control"))!;
  await names(registry, [r.targetFenceKey], true, true);
  await names((await directory(root, `.aws-sandbox/j5gj22-stack-scoped-read-control/${r.targetFenceKey}`))!, ["slot-000005"], true, true);
  await names((await directory(root, paths.oldSlot))!, ["claim.json"], true);
  const slot = await createStackControlFsSlot(root, old.fence, old.predecessor), claim = await slot.readClaim();
  if (!claim || claim.claimSha256 !== r.claimSha256 || await slot.workflowIntentsPresent()) throw new Error("J23 actual generation5 claim consumed/changed; no reset.");
  await stackControlRetirementDigest(claim, "claimSha256", r.claimSha256);
  probeSame(claim.binding, await stackControlClaimBinding(creationReview), "J23 unique original approval and request");
  for (const receipt of [created, recovered, closure]) probeSame(receipt.claim, claim, "J23 actual anchored claim");
  probeSame(manifest.input.claim, claim, "J23 unapproved manifest actual claim");
  probeSame(await loadClosedStackScopedReadControlEvidence(root, oldFiles), old, "J23 old actual journal stable");
  return { predecessor: await closedGeneration5Descriptor(), creationReview, manifest };
}
/** Reads/construction do not mkdir. Exclusive physical slot consumption comes
 * before file write. Partial, linked, corrupt or foreign state is never reset. */
export async function createStackControlRetirementLedger(repository: string): Promise<StackControlRetirementLedger> {
  const root = await rootPath(repository);
  async function parent(create: boolean) {
    const registry = await directory(root, paths.retirementRegistry, create); if (!registry) return null;
    await names(registry, [r.targetFenceKey], false, true);
    const target = await directory(root, `${paths.retirementRegistry}/${r.targetFenceKey}`, create); if (!target) return null;
    await names(target, ["slot-000005"], false, true); return target;
  }
  async function read() {
    if (!await parent(false)) return null;
    const slot = await directory(root, paths.retirementSlot); if (!slot) return null;
    await names(slot, ["delete-intent.json"], true);
    const intent = await readStackControlRetirementJson(path.join(slot, "delete-intent.json")) as StackControlRetirementIntent;
    await assertStackControlRetirementIntent(intent); return intent;
  }
  return { read, reserve: async intent => {
    await assertStackControlRetirementIntent(intent); if (await read()) throw new Error("J23 retirement already consumed.");
    const target = (await parent(true))!, slot = path.join(target, "slot-000005"); await mkdir(slot);
    const file = await open(path.join(slot, "delete-intent.json"), "wx");
    try { await file.writeFile(`${JSON.stringify(intent, null, 2)}\n`); await file.sync(); } finally { await file.close(); }
    probeSame(await read(), intent, "J23 durable retirement readback");
  } };
}
export async function assertGeneration6RegistryAbsent(repository: string) {
  const root = await rootPath(repository), sandbox = await directory(root, ".aws-sandbox");
  if (!sandbox) return;
  try { await lstat(path.join(sandbox, "j5gj23-stack-control")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
  throw new Error("J23 generation6 registry present; no automatic successor/reset.");
}
export async function loadGeneration6RetirementAdmission(repository: string, files: StackControlRetirementFiles, proofFile: string) {
  const old = await loadGeneration5RetirementEvidence(repository, files), proof = await readStackControlRetirementJson(proofFile) as StackControlRetirementProof;
  await assertStackControlRetirementProof(proof);
  probeSame(proof.intent.manifest.input.predecessor, old.predecessor, "J23 real preserved predecessor");
  probeSame(await (await createStackControlRetirementLedger(repository)).read(), proof.intent, "J23 actual permanent retirement intent");
  await assertGeneration6RegistryAbsent(repository);
  return { predecessor: old.predecessor, proof, fence: await stackControlGeneration6Fence(proof) };
}
