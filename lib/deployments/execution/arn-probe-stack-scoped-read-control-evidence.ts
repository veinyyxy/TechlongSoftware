import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeSame, probeObject } from "./arn-compatibility-probe-workflow.ts";
import { readArnProbeReadComparisonJson } from "./arn-compatibility-probe-read-comparison-evidence.ts";
import { loadReadComparisonRetirementProof, type ReadComparisonRetirementFiles } from "./arn-probe-read-comparison-generation3-retirement-evidence.ts";
import { createArnProbeComparisonFsSlot } from "./arn-probe-read-comparison-generation4-slot.ts";
import { ARN_PROBE_COMPARISON_STEPS } from "./arn-probe-read-comparison-generation4-workflow.ts";
import { closeGeneration4ForStackScopedReadControl, stackScopedReadControlFence, type StackScopedReadControlEvidence } from "./arn-probe-stack-scoped-read-control.ts";

export type StackScopedReadControlFiles = Readonly<Record<
  "retirementEvidence" | "retirementProof" | "creationReview" | "executionReview" | "runReceipt" | "lockedInspect" | "diagnosticReceipt", string>>;
/** Completed immutable evidence anchors, never approval values. The live local
 * entry cannot substitute synthetic test records or a new generation4 run. */
export const STACK_SCOPED_READ_CONTROL_ANCHORS = Object.freeze({
  retirementProof: "9956f626d1c03f6393fc263dbf1df3f84a19f2f057443390bd1979764741f5bc",
  creationReview: "23cd5982d6f3eec53e21c57f16f3070afd7802d8218bf5dde0cb885ac2bbbfb0",
  executionReview: "b3d2d09df7d9b9f60381ae00bb3c8833da8a269391c2b2231a6648fd22e1f794",
  manifest: "5ae7757a35c168c2887a3bbb2bb118460ef9fca619c464e14de567daa2f09ee9",
  runReceipt: "32ab743d159ff3654238bfd04650ac938e24c9478dde80b96c5efec362711471",
  lockedInspect: "a88547d5a0249bbbac7a273566111b9b087d8fd1eedb3cff5b1bd9ea0c8616ed",
  diagnosticReceipt: "74e70dd6e0ec0e45ddec6fbfe9df813d763f87d3ba7a44e7e1f7b367397968a1",
});
async function anchored(value: Record<string, unknown>, key: string, expected: string) {
  const body = { ...value }, digest = body[key]; delete body[key];
  if (digest !== expected || digest !== await sha256Hex(canonicalJson(body))) throw new Error("J22 exact archived evidence digest drifted.");
}
/** Existing records and actual generation4 journal only. No mkdir, reserve,
 * repair, retirement, successor fallback, AWS client or credential provider. */
export async function loadStackScopedReadControlEvidence(repository: string, files: StackScopedReadControlFiles) {
  probeSame(Object.keys(files).sort(), ["retirementEvidence", "retirementProof", "creationReview", "executionReview", "runReceipt", "lockedInspect", "diagnosticReceipt"].sort(), "J22 exact evidence paths");
  if (Object.values(files).some(v => typeof v !== "string" || !path.isAbsolute(v))) throw new Error("J22 requires explicit absolute evidence paths.");
  const root = await realpath(repository);
  if (/^(?:\\\\|\/\/)/.test(root) || !(await lstat(root)).isDirectory()) throw new Error("J22 requires a local repository.");
  const previousFiles = await readArnProbeReadComparisonJson(files.retirementEvidence) as ReadComparisonRetirementFiles;
  const retired = await loadReadComparisonRetirementProof(root, files.retirementProof, previousFiles);
  if (retired.proof.receiptSha256 !== STACK_SCOPED_READ_CONTROL_ANCHORS.retirementProof) throw new Error("J22 exact generation3 retirement proof required.");
  const [creation, workflow, run, inspect, diagnostic] = await Promise.all([
    files.creationReview, files.executionReview, files.runReceipt, files.lockedInspect, files.diagnosticReceipt,
  ].map(readArnProbeReadComparisonJson));
  await anchored(creation, "reviewSha256", STACK_SCOPED_READ_CONTROL_ANCHORS.creationReview);
  await anchored(workflow, "reviewSha256", STACK_SCOPED_READ_CONTROL_ANCHORS.executionReview);
  await anchored(run, "receiptSha256", STACK_SCOPED_READ_CONTROL_ANCHORS.runReceipt);
  await anchored(inspect, "receiptSha256", STACK_SCOPED_READ_CONTROL_ANCHORS.lockedInspect);
  await anchored(diagnostic, "receiptSha256", STACK_SCOPED_READ_CONTROL_ANCHORS.diagnosticReceipt);
  const creationReview = creation as StackScopedReadControlEvidence["creationReview"];
  const manifest = probeObject(workflow).manifest as StackScopedReadControlEvidence["manifest"];
  if (manifest.manifestSha256 !== STACK_SCOPED_READ_CONTROL_ANCHORS.manifest) throw new Error("J22 exact consumed execution manifest required.");
  probeSame(creationReview.plan.input.retirementProof, retired.proof, "Real generation3 retirement predecessor");
  probeSame(creationReview.sourceReview.predecessor, retired.generation1.predecessor, "Real archived original predecessor");
  const slot = await createArnProbeComparisonFsSlot(root, creationReview.fence, retired.proof), journal = await slot.workflowJournal(manifest);
  probeSame(await slot.readClaim(), manifest.input.claim, "Real generation4 claim");
  const intents = {} as Record<typeof ARN_PROBE_COMPARISON_STEPS[number], Readonly<Record<string, unknown>>>;
  for (const step of ARN_PROBE_COMPARISON_STEPS) {
    const value = await journal.load(step); if (!value) throw new Error("J22 requires every permanently consumed generation4 intent.");
    intents[step] = value;
  }
  const predecessor = await closeGeneration4ForStackScopedReadControl({ creationReview, manifest, run, inspect, diagnostic, intents });
  const fence = await stackScopedReadControlFence(predecessor);
  const registry = path.join(root, ".aws-sandbox", "j5gj22-stack-scoped-read-control");
  try { await lstat(registry); throw new Error("J22 registry is already present; manual reconciliation, never reset or replay."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return { predecessor, fence, actualJournalVerified: true, newRegistryAbsent: true } as const;
}
