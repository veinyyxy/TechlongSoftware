import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { probeSame } from "../../../lib/deployments/execution/arn-compatibility-probe-workflow.ts";
import { sanitizeArnProbeFailure } from "../../../lib/deployments/execution/arn-compatibility-probe-diagnostics.ts";
import { readArnProbeReadComparisonJson } from "../../../lib/deployments/execution/arn-compatibility-probe-read-comparison-evidence.ts";
import { loadReadComparisonRetirementEvidence, createReadComparisonRetirementLedger,
  type ReadComparisonRetirementFiles } from "../../../lib/deployments/execution/arn-probe-read-comparison-retirement-evidence.ts";
import { reviewReadComparisonRetirement, retireReviewedReadComparison, inspectReadComparisonRetirement, assertReadComparisonRetirement,
  type ReadComparisonRetirementManifest } from "../../../lib/deployments/execution/arn-probe-read-comparison-retirement.ts";
import { recoverArnProbeComparisonCreate } from "../../../lib/deployments/execution/arn-probe-read-comparison-create.ts";
import { createArnProbeComparisonFsSlot } from "../../../lib/deployments/execution/arn-probe-read-comparison-slot.ts";

const args = process.argv.slice(2), values = new Map<string, string>(), flags = new Set<string>();
const keys = ["--mode", "--evidence", "--output", "--manifest", "--approved-manifest-sha", "--execution-phrase"];
const switches = ["--acknowledge-read-only", "--acknowledge-irreversible-deletion", "--acknowledge-low-cost-not-zero"];
for (let i = 0; i < args.length; i++) {
  const key = args[i]; if (values.has(key) || flags.has(key)) throw new Error("Duplicate retirement option.");
  if (switches.includes(key)) flags.add(key);
  else { if (!keys.includes(key) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Unknown retirement option."); values.set(key, args[++i]); }
}
const mode = values.get("--mode") ?? "Review", output = values.get("--output"), writing = mode === "RetireReviewed";
const common = ["--mode", "--evidence", "--output"], allowed = writing ? [...common, "--manifest", "--approved-manifest-sha", "--execution-phrase"] : common;
const expectedFlags = writing ? ["--acknowledge-irreversible-deletion", "--acknowledge-low-cost-not-zero"] : ["--acknowledge-read-only"];
if (!["Review", "RetireReviewed", "Inspect"].includes(mode) || !output || [...values.keys()].some((k) => !allowed.includes(k)) ||
  allowed.filter((k) => k !== "--mode").some((k) => !values.has(k)) || flags.size !== expectedFlags.length || expectedFlags.some((f) => !flags.has(f)) ||
  [output, values.get("--evidence")!, ...(writing ? [values.get("--manifest")!] : [])].some((p) => !path.isAbsolute(p))) throw new Error("Retirement requires exact mode scope, acknowledgements and absolute paths.");
const repository = await realpath(fileURLToPath(new URL("../../../", import.meta.url))), parent = await realpath(path.dirname(output));
if (path.relative(repository, parent).split(path.sep)[0] === ".aws-sandbox") throw new Error("Retirement output cannot replace a ledger.");
const destination = await open(path.join(parent, path.basename(output)), "wx"), destroyers: Array<() => void> = [];
const cancel = new AbortController(), stop = () => cancel.abort(); process.on("SIGINT", stop); process.on("SIGTERM", stop);
try {
  const files = await readArnProbeReadComparisonJson(values.get("--evidence")!) as ReadComparisonRetirementFiles;
  const old = await loadReadComparisonRetirementEvidence(repository, files), ledger = await createReadComparisonRetirementLedger(repository);
  const readPredecessor = async () => { const current = await loadReadComparisonRetirementEvidence(repository, files); probeSame(current, old, "Retirement closed records stable"); return current.predecessor; };
  let manifest: ReadComparisonRetirementManifest | undefined;
  if (writing) {
    manifest = await readArnProbeReadComparisonJson(values.get("--manifest")!) as ReadComparisonRetirementManifest;
    await assertReadComparisonRetirement(manifest); probeSame(manifest.input.predecessor, old.predecessor, "Retirement exact archives");
    if (values.get("--approved-manifest-sha") !== manifest.manifestSha256 || values.get("--execution-phrase") !== manifest.requiredPhrase ||
      Date.now() < Date.parse(manifest.input.reviewedAt) || Date.now() >= Date.parse(manifest.input.expiresAt)) throw new Error("New exact retirement approval mismatched/expired. No AWS write.");
    if (await ledger.read()) throw new Error("Retirement consumed; inspect only.");
  }
  const { createArnProbeSourceReadRuntime } = await import("../../../lib/deployments/execution/aws-sdk-arn-probe-source-read-runtime.ts");
  const runtime = await createArnProbeSourceReadRuntime(); destroyers.push(runtime.destroy);
  const cf = await import("@aws-sdk/client-cloudformation");
  const client = new cf.CloudFormationClient({ region: "ca-central-1", credentials: runtime.credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true }); destroyers.push(() => client.destroy());
  type Command = new (input: Record<string, unknown>) => unknown;
  const wrapped = { send: (command: unknown, o: { abortSignal: AbortSignal }) => client.send(command as never, o) as unknown as Promise<Record<string, unknown>> };
  const { AwsSdkArnProbeComparisonGrantReadAdapter } = await import("../../../lib/deployments/execution/aws-sdk-arn-probe-read-comparison-create.ts");
  const { AwsSdkReadComparisonRetirementInventory, AwsSdkReadComparisonRetirementDelete } = await import("../../../lib/deployments/execution/aws-sdk-arn-probe-read-comparison-retirement.ts");
  const inventory = new AwsSdkReadComparisonRetirementInventory(wrapped, cf.ListChangeSetsCommand as unknown as Command);
  const grant = new AwsSdkArnProbeComparisonGrantReadAdapter(wrapped, { listChangeSets: cf.ListChangeSetsCommand as unknown as Command,
    describeChangeSet: cf.DescribeChangeSetCommand as unknown as Command, getTemplate: cf.GetTemplateCommand as unknown as Command });
  const oldSlot = await createArnProbeComparisonFsSlot(repository, old.review.fence);
  const observe = async (signal: AbortSignal) => ({ inventoryBefore: await inventory.read(signal),
    recovery: await recoverArnProbeComparisonCreate({ review: old.review, slot: oldSlot, reads: runtime.reads, readPredecessor: async () => {
      await readPredecessor(); return old.generation1.predecessor;
    }, signal, readGrant: (p, s) => grant.readGrant(p, s) }), inventoryAfter: await inventory.read(signal) });
  const ports = { readPredecessor, ledger, observe, signal: AbortSignal.any([cancel.signal, AbortSignal.timeout(90_000)]) };
  let result;
  if (mode === "Review") result = await reviewReadComparisonRetirement(ports);
  else if (mode === "Inspect") result = await inspectReadComparisonRetirement(ports);
  else {
    const deletion = new AwsSdkReadComparisonRetirementDelete(manifest!, wrapped, cf.DeleteChangeSetCommand as unknown as Command);
    result = await retireReviewedReadComparison({ ...ports, manifest: manifest!, approvedManifestSha256: values.get("--approved-manifest-sha")!,
      executionPhrase: values.get("--execution-phrase")!, acknowledgeDeletionIrreversible: true, acknowledgeLowCostNotZero: true,
      deleteChangeSet: (r, s) => deletion.submit(r, s) });
  }
  await destination.writeFile(`${JSON.stringify(result, null, 2)}\n`, "utf8"); await destination.sync();
  console.log(JSON.stringify({ mode, output, digest: "manifestSha256" in result && !("receiptSha256" in result) ? result.manifestSha256 : result.receiptSha256,
    outcome: "outcome" in result ? result.outcome : "REVIEW_READY_NOT_APPROVED", retryAllowed: false, runtimeEnabled: false }, null, 2));
} catch (e) {
  const body = { stage: "B5-J5g-j19-retirement", mode, outcome: "RETIREMENT_ENTRY_BLOCKED", failures: [sanitizeArnProbeFailure(e, "ENTRY")],
    mutationPerformed: writing ? null : false, retryAllowed: false, productionCompatibilityVerified: false, runtimeEnabled: false };
  await destination.writeFile(`${JSON.stringify({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) }, null, 2)}\n`, "utf8"); await destination.sync();
  console.error("Retirement failed closed. Never replay Delete or reset records; use independent read-only Inspect."); process.exitCode = 1;
} finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); destroyers.forEach((d) => d()); await destination.close(); }
