import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { probeSame } from "../../../lib/deployments/execution/arn-compatibility-probe-workflow.ts";
import { sanitizeArnProbeFailure } from "../../../lib/deployments/execution/arn-compatibility-probe-diagnostics.ts";
import { loadGeneration5RetirementEvidence, createStackControlRetirementLedger, readStackControlRetirementJson, assertGeneration6RegistryAbsent,
  loadGeneration6RetirementAdmission, type StackControlRetirementFiles } from "../../../lib/deployments/execution/arn-probe-stack-control-generation5-retirement-evidence.ts";
import { STACK_CONTROL_RETIREMENT as r, STACK_CONTROL_RETIREMENT_PATHS as paths, assertStackControlRetirement, approveStackControlRetirement,
  reviewStackControlRetirement, retireReviewedStackControl, inspectStackControlRetirement, type StackControlRetirementManifest } from "../../../lib/deployments/execution/arn-probe-stack-control-generation5-retirement.ts";

const values = new Map<string, string>(), flags = new Set<string>(), args = process.argv.slice(2);
const keys = ["--mode", "--evidence", "--output", "--manifest", "--approved-manifest-sha", "--execution-phrase", "--retirement-proof"];
const switches = ["--acknowledge-read-only", "--acknowledge-irreversible-deletion", "--acknowledge-low-cost-not-zero"];
for (let i = 0; i < args.length; i++) {
  const key = args[i]; if (values.has(key) || flags.has(key)) throw new Error("Duplicate J23 option.");
  if (switches.includes(key)) flags.add(key);
  else { if (!keys.includes(key) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Unsupported J23 option."); values.set(key, args[++i]); }
}
const mode = values.get("--mode") ?? "", output = values.get("--output"), writing = mode === "RetireReviewed";
const common = ["--mode", "--evidence", "--output"], readonlyFlags = ["--acknowledge-read-only"];
const contracts: Record<string, { values: string[]; flags: string[] }> = {
  CheckLocalPreparation: { values: common, flags: readonlyFlags }, Review: { values: common, flags: readonlyFlags }, Inspect: { values: common, flags: readonlyFlags },
  CheckGeneration6Admission: { values: [...common, "--retirement-proof"], flags: readonlyFlags },
  RetireReviewed: { values: [...common, "--manifest", "--approved-manifest-sha", "--execution-phrase"], flags: ["--acknowledge-irreversible-deletion", "--acknowledge-low-cost-not-zero"] },
};
const contract = contracts[mode];
if (!contract || !output || values.size !== contract.values.length || [...values.keys()].some(k => !contract.values.includes(k)) ||
  contract.values.some(k => !values.has(k)) || flags.size !== contract.flags.length || contract.flags.some(k => !flags.has(k)) ||
  [output, values.get("--evidence")!, ...(values.has("--manifest") ? [values.get("--manifest")!] : []), ...(values.has("--retirement-proof") ? [values.get("--retirement-proof")!] : [])].some(p => !path.isAbsolute(p))) throw new Error("J23 exact mode/options/acknowledgements and absolute paths required.");
if (writing && !/^[a-f0-9]{64}$/.test(values.get("--approved-manifest-sha")!)) throw new Error("J23 complete explicit new SHA required.");
const repository = await realpath(fileURLToPath(new URL("../../../", import.meta.url))), parent = await realpath(path.dirname(output)), target = path.join(parent, path.basename(output));
if (path.basename(target).startsWith(".") || target.split(path.sep).some(k => [".git", ".aws", ".codex", ".agents", ".aws-sandbox"].includes(k))) throw new Error("J23 protected output refused.");
const destination = await open(target, "wx"), cancel = new AbortController(), stop = () => cancel.abort();
process.on("SIGINT", stop); process.on("SIGTERM", stop); let destroy: (() => void) | undefined;
try {
  const files = await readStackControlRetirementJson(values.get("--evidence")!) as StackControlRetirementFiles;
  const old = await loadGeneration5RetirementEvidence(repository, files), ledger = await createStackControlRetirementLedger(repository);
  const readPredecessor = async () => { const current = await loadGeneration5RetirementEvidence(repository, files); probeSame(current, old, "J23 real archive stability");
    if (writing || mode === "Review") await assertGeneration6RegistryAbsent(repository); return current.predecessor; };
  let result: Record<string, unknown>;
  if (mode === "CheckLocalPreparation") {
    if (await ledger.read()) throw new Error("J23 retirement consumed; Inspect only."); await assertGeneration6RegistryAbsent(repository);
    const body = { stage: r.stage, mode, predecessor: old.predecessor, retirementSlot: paths.retirementSlot, futureGeneration6Slot: paths.successorSlot,
      outcome: "CLOSED_GENERATION5_LOCAL_PREPARATION_VERIFIED", networkUsed: false, mutationPerformed: false, retirementIntentAbsent: true,
      generation6RegistryAbsent: true, approvalWindowOpened: false, manifestCreated: false, cloudDeletionAuthorized: false, successorReservationAuthorized: false, runtimeEnabled: false };
    result = { ...body, receiptSha256: await sha256Hex(canonicalJson(body)) };
  } else if (mode === "CheckGeneration6Admission") {
    const admitted = await loadGeneration6RetirementAdmission(repository, files, values.get("--retirement-proof")!);
    const body = { stage: "B5-J5g-j23", mode, fence: admitted.fence, outcome: "GENERATION6_FENCE_VERIFIED_NOT_RESERVED",
      networkUsed: false, mutationPerformed: false, registryCreated: false, approvalWindowOpened: false, creationAuthorized: false, installationAuthorized: false, runtimeEnabled: false };
    result = { ...body, receiptSha256: await sha256Hex(canonicalJson(body)) };
  } else {
    if (writing || mode === "Review") await assertGeneration6RegistryAbsent(repository);
    let manifest: StackControlRetirementManifest | undefined;
    const approval = { approvedManifestSha256: values.get("--approved-manifest-sha") ?? "", executionPhrase: values.get("--execution-phrase") ?? "",
      acknowledgeDeletionIrreversible: flags.has("--acknowledge-irreversible-deletion"), acknowledgeLowCostNotZero: flags.has("--acknowledge-low-cost-not-zero") };
    if (writing) {
      manifest = await readStackControlRetirementJson(values.get("--manifest")!) as StackControlRetirementManifest;
      await assertStackControlRetirement(manifest); approveStackControlRetirement(manifest, approval);
      probeSame(manifest.input.predecessor, old.predecessor, "J23 real approved predecessor");
      if (Date.now() < Date.parse(manifest.input.reviewedAt) || Date.now() >= Date.parse(manifest.input.expiresAt)) throw new Error("J23 expired approval; no SDK/client/write.");
      if (await ledger.read()) throw new Error("J23 retirement consumed; no client/write/replay.");
    } else if (mode === "Review" && await ledger.read()) throw new Error("J23 retirement consumed; no new window.");
    else if (mode === "Inspect" && !await ledger.read()) throw new Error("J23 intent missing; no external-absence adoption.");
    const { createGeneration5RetirementReadRuntime } = await import("../../../lib/deployments/execution/aws-sdk-arn-probe-stack-control-generation5-retirement.ts");
    const runtime = await createGeneration5RetirementReadRuntime(old.creationReview, old.manifest); destroy = runtime.destroy;
    const ports = { readPredecessor, ledger, observe: runtime.observe, signal: AbortSignal.any([cancel.signal, AbortSignal.timeout(90_000)]) };
    if (mode === "Review") result = await reviewStackControlRetirement(ports);
    else if (mode === "Inspect") result = await inspectStackControlRetirement(ports);
    else {
      const deletion = runtime.deleteAdapter(manifest!);
      result = await retireReviewedStackControl({ ...ports, manifest: manifest!, approval, deleteChangeSet: (request, signal) => deletion.submit(request, signal) });
    }
  }
  await destination.writeFile(`${JSON.stringify(result, null, 2)}\n`); await destination.sync();
  console.log(JSON.stringify({ mode, output, outcome: result.outcome ?? "RETIREMENT_REVIEW_READY_NOT_APPROVED", digest: result.receiptSha256 ?? result.manifestSha256, runtimeEnabled: false }, null, 2));
  if (result.outcome === "RETIREMENT_UNPROVED") process.exitCode = 2;
} catch (e) {
  const body = { stage: r.stage, mode, outcome: "GENERATION5_RETIREMENT_ENTRY_BLOCKED", mutationPerformed: writing ? null : false,
    failure: sanitizeArnProbeFailure(e, "ENTRY"), retryAllowed: false, productionCompatibilityVerified: false, runtimeEnabled: false };
  await destination.writeFile(`${JSON.stringify({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) }, null, 2)}\n`); await destination.sync();
  console.error("J23 failed closed. Preserve all records; never replay Delete/reset/create a successor. Independent Inspect only."); process.exitCode = 1;
} finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); destroy?.(); await destination.close(); }
