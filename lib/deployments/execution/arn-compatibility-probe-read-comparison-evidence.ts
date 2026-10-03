import { readFile, lstat, realpath, readdir } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { assertArnProbeWorkflowManifest, probeSame, probeInstant, type ArnProbeWorkflowManifest, type ProbeStep } from "./arn-compatibility-probe-workflow.ts";
import { arnProbeSlotScope, type ArnProbeFencedCreateReview } from "./arn-compatibility-probe-fenced-create.ts";
import { ARN_PROBE_READ_COMPARISON_ANCHORS as anchors, ARN_PROBE_CONSUMED_SLOT_FILES, assertArnProbeReadComparisonPredecessor,
  type ArnProbeReadComparisonPredecessor } from "./arn-compatibility-probe-read-comparison.ts";

export type ArnProbeReadComparisonEvidenceFiles = Readonly<Record<
  "legacyManifest" | "legacyRunReceipt" | "creationReview" | "workflowReview" | "runReceipt" | "independentInspect" | "diagnosticReceipt", string>>;
export async function readArnProbeReadComparisonJson(file: string) {
  if (!path.isAbsolute(file)) throw new Error("Comparison evidence path must be absolute.");
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 600_000) throw new Error("Comparison evidence must be an ordinary bounded file.");
  return JSON.parse(await readFile(file, "utf8"));
}
async function receipt(value: Record<string, unknown>, key: string, expected: string) {
  const body = { ...value }, digest = body[key]; delete body[key];
  if (digest !== expected || digest !== await sha256Hex(canonicalJson(body))) throw new Error("Anchored comparison evidence digest drifted.");
}
/** Reads existing ledgers only. No mkdir/open/write/reserve/repair/cleanup API. */
export async function loadArnProbeReadComparisonEvidence(repository: string, files: ArnProbeReadComparisonEvidenceFiles) {
  probeSame(Object.keys(files).sort(), ["creationReview", "diagnosticReceipt", "independentInspect", "legacyManifest", "legacyRunReceipt", "runReceipt", "workflowReview"], "Comparison evidence paths");
  if (Object.values(files).some((value) => typeof value !== "string")) throw new Error("All comparison evidence paths must be explicit.");
  const root = await realpath(repository);
  if (/^(?:\\\\|\/\/)/.test(root) || !(await lstat(root)).isDirectory()) throw new Error("Comparison requires a local repository.");
  async function directory(relative: string) {
    let current = root;
    for (const segment of relative.split("/")) {
      if (!segment || segment === "." || segment === "..") throw new Error("Invalid comparison ledger path.");
      current = path.join(current, segment);
      const info = await lstat(current); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Comparison ledger ancestor is not ordinary.");
      current = await realpath(current); const relativePath = path.relative(root, current);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) throw new Error("Comparison ledger escapes the repository.");
    }
    return current;
  }
  async function entries(folder: string, expected: readonly string[], folders = false) {
    const actual = await readdir(folder, { withFileTypes: true });
    probeSame(actual.map((item) => item.name).sort(), [...expected].sort(), "Comparison complete ledger inventory");
    if (actual.some((item) => item.isSymbolicLink() || (folders ? !item.isDirectory() : !item.isFile()))) throw new Error("Comparison ledger has an unknown file type.");
  }
  const [creation, workflow, run, inspect, diagnostic, legacyReview, legacyRun] = await Promise.all([
    files.creationReview, files.workflowReview, files.runReceipt, files.independentInspect, files.diagnosticReceipt, files.legacyManifest, files.legacyRunReceipt,
  ].map(readArnProbeReadComparisonJson));
  await receipt(creation, "reviewSha256", anchors.creationReviewSha256);
  await receipt(workflow, "reviewSha256", anchors.workflowReviewSha256);
  await receipt(run, "receiptSha256", anchors.runReceiptSha256);
  await receipt(inspect, "receiptSha256", anchors.inspectReceiptSha256);
  await receipt(diagnostic, "receiptSha256", anchors.diagnosticReceiptSha256);
  const manifest = workflow.manifest as ArnProbeWorkflowManifest; await assertArnProbeWorkflowManifest(manifest);
  if (manifest.manifestSha256 !== anchors.manifestSha256 || manifest.input.plan.planSha256 !== anchors.planSha256 || run.manifestSha256 !== anchors.manifestSha256 ||
      run.outcome !== "LOCKED_PROBE_NOT_PROVED" || run.probeAttempted !== false || run.cleanup?.outcome !== "LOCKED_VERIFIED" ||
      inspect.outcome !== "LOCKED_VERIFIED" || inspect.mutationPerformed !== false || diagnostic.rootCauseProven !== false ||
      diagnostic.authorizationContextObserved !== false || diagnostic.mutationPerformed !== false) throw new Error("Comparison requires the exact closed, withdrawn predecessor.");
  const scope = await arnProbeSlotScope(creation as ArnProbeFencedCreateReview);
  if (scope.targetFenceKey !== anchors.targetFenceKey || scope.planSha256 !== anchors.planSha256 || scope.predecessorArchiveSha256 !== anchors.legacyArchiveSha256) throw new Error("Comparison consumed scope drifted.");
  const registry = await directory(".aws-sandbox/j5gj13-arn-probe"); await entries(registry, [scope.targetFenceKey], true);
  const target = await directory(`.aws-sandbox/j5gj13-arn-probe/${scope.targetFenceKey}`); await entries(target, ["slot-000001"], true);
  const slot = await directory(scope.slotRelativePath); await entries(slot, ARN_PROBE_CONSUMED_SLOT_FILES);
  const claim = await readArnProbeReadComparisonJson(path.join(slot, "claim.json"));
  await receipt(claim, "claimSha256", anchors.claimSha256); probeSame(claim.scope, scope, "Consumed claim scope");
  const steps = ["run", "grant-execute", "revoke-create", "revoke-execute"] as const;
  const intents = {} as Record<typeof steps[number], Record<string, unknown>>;
  const requests = { run: manifest.actions, "grant-execute": manifest.actions.grantExecute.request, "revoke-create": manifest.actions.revoke.createRequest };
  let previous = probeInstant(claim.reservedAt);
  for (const step of steps) {
    const intent = await readArnProbeReadComparisonJson(path.join(slot, `${step}-intent.json`));
    const requestSha256 = step === "revoke-execute" ? anchors.revokeExecuteRequestSha256 : await sha256Hex(canonicalJson(requests[step]));
    probeSame(intent, { stage: "B5-J5g-j11", step, operationSha256: manifest.operationSha256, manifestSha256: manifest.manifestSha256,
      requestSha256, reservedAt: intent.reservedAt }, "Consumed intent binding");
    const time = probeInstant(intent.reservedAt);
    if (time < previous || time > probeInstant(run.observedAt)) throw new Error("Comparison predecessor chronology drifted.");
    if (["run", "grant-execute"].includes(step) && (time < probeInstant(manifest.input.reviewedAt) || time >= probeInstant(manifest.input.expiresAt))) throw new Error("Comparison predecessor approval chronology drifted.");
    previous = time; intents[step] = intent;
  }
  if (await sha256Hex(canonicalJson(intents)) !== anchors.journalSha256) throw new Error("Comparison consumed journal changed.");
  const legacy = (legacyReview.manifest ?? legacyReview) as ArnProbeWorkflowManifest; await assertArnProbeWorkflowManifest(legacy);
  const oldCreate = await directory(".aws-sandbox/j5gj10-arn-probe"); await entries(oldCreate, ["grant-create-intent.json"]);
  const oldWorkflow = await directory(".aws-sandbox/j5gj11-arn-probe"); await entries(oldWorkflow, [legacy.operationSha256], true);
  const oldSlot = await directory(`.aws-sandbox/j5gj11-arn-probe/${legacy.operationSha256}`);
  const oldSteps: ProbeStep[] = ["run", "grant-execute", "probe-delete", "revoke-create", "revoke-execute"];
  await entries(oldSlot, oldSteps.map((step) => `${step}-intent.json`));
  const oldJournal = {} as Record<ProbeStep, Record<string, unknown>>;
  for (const step of oldSteps) oldJournal[step] = await readArnProbeReadComparisonJson(path.join(oldSlot, `${step}-intent.json`));
  const legacyArchive = { manifest: legacy, runReceipt: legacyRun,
    createIntent: await readArnProbeReadComparisonJson(path.join(oldCreate, "grant-create-intent.json")), journal: oldJournal };
  if (await sha256Hex(canonicalJson(legacyArchive)) !== anchors.legacyArchiveSha256) throw new Error("Original legacy archive changed; never adopt another slot automatically.");
  const predecessor: ArnProbeReadComparisonPredecessor = { anchors, consumedGeneration: 1, consumedSlotRelativePath: scope.slotRelativePath,
    slotFiles: ARN_PROBE_CONSUMED_SLOT_FILES, consumed: true, probeDeleteIntentPresent: false, replayAllowed: false };
  assertArnProbeReadComparisonPredecessor(predecessor);
  // Return hashes and the reviewed prior plan only, never raw historical events/receipts.
  return { priorPlan: manifest.input.plan, predecessor };
}
