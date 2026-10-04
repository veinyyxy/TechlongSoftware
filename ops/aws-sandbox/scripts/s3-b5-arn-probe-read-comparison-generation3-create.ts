import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { probeSame } from "../../../lib/deployments/execution/arn-compatibility-probe-workflow.ts";
import { sanitizeArnProbeFailure } from "../../../lib/deployments/execution/arn-compatibility-probe-diagnostics.ts";
import { readArnProbeReadComparisonJson } from "../../../lib/deployments/execution/arn-compatibility-probe-read-comparison-evidence.ts";
import { loadReadComparisonRetirementProof, type ReadComparisonRetirementFiles } from "../../../lib/deployments/execution/arn-probe-read-comparison-retirement-evidence.ts";
import { reviewArnProbeReadComparison } from "../../../lib/deployments/execution/arn-compatibility-probe-read-comparison.ts";
import { arnProbeComparisonFence, reviewArnProbeComparisonCreate, assertArnProbeComparisonCreateReview,
  createReviewedArnProbeComparison, recoverArnProbeComparisonCreate,
  type ArnProbeComparisonCreateReview, type ArnProbeComparisonVariant } from "../../../lib/deployments/execution/arn-probe-read-comparison-generation3-create.ts";
import { createArnProbeComparisonFsSlot } from "../../../lib/deployments/execution/arn-probe-read-comparison-generation3-slot.ts";

const options = new Map<string, string>(), flags = new Set<string>(), args = process.argv.slice(2);
const writeFlags = ["--acknowledge-aws-write", "--acknowledge-named-iam-change-set-only", "--acknowledge-low-cost-not-zero", "--acknowledge-preserves-predecessor-and-consumes-generation3"];
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (["--acknowledge-read-only", ...writeFlags].includes(key) && !flags.has(key)) flags.add(key);
  else {
    if (!["--mode", "--evidence", "--retirement-proof", "--output", "--variant", "--review", "--approved-review-sha256", "--execution-phrase"].includes(key) || options.has(key) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Unknown or duplicate generation3 option.");
    options.set(key, args[++i]);
  }
}
const mode = options.get("--mode") ?? "ReviewCreate", output = options.get("--output"), evidenceFile = options.get("--evidence");
if (!["ReviewCreate", "CreateReviewed", "RecoverCreate"].includes(mode) || !output || !path.isAbsolute(output) || !evidenceFile || !path.isAbsolute(evidenceFile)) throw new Error("Generation3 requires explicit absolute output/evidence paths and a supported mode.");
const variant = (options.get("--variant") ?? "EXACT_NAME_CONDITION") as ArnProbeComparisonVariant;
if (mode === "ReviewCreate") {
  if (!flags.has("--acknowledge-read-only") || flags.size !== 1 || options.has("--review") || options.has("--approved-review-sha256") || options.has("--execution-phrase") || !["FULL_ARN_CONDITION", "EXACT_NAME_CONDITION"].includes(variant)) throw new Error("ReviewCreate is Source read-only and selects exactly one candidate.");
} else {
  if (!options.get("--review") || !path.isAbsolute(options.get("--review")!) || options.has("--variant")) throw new Error("Reviewed modes require the exact absolute review path; variant overrides forbidden.");
  if (mode === "RecoverCreate") {
    if (!flags.has("--acknowledge-read-only") || flags.size !== 1 || options.has("--approved-review-sha256") || options.has("--execution-phrase")) throw new Error("RecoverCreate is read-only, never a retry.");
  } else if (flags.size !== writeFlags.length || writeFlags.some((v) => !flags.has(v)) || !/^[a-f0-9]{64}$/.test(options.get("--approved-review-sha256") ?? "") || !options.get("--execution-phrase")) throw new Error("CreateReviewed requires exact SHA/phrase and all four write acknowledgements.");
}
const repository = await realpath(fileURLToPath(new URL("../../../", import.meta.url))), parent = await realpath(path.dirname(output));
if (path.relative(repository, path.join(parent, path.basename(output))).split(path.sep)[0] === ".aws-sandbox") throw new Error("Generation3 output must not be inside AWS ledgers.");
const destination = await open(path.join(parent, path.basename(output)), "wx"), destroyers: Array<() => void> = [];
const cancelled = new AbortController(), stop = () => cancelled.abort(); process.on("SIGINT", stop); process.on("SIGTERM", stop);
try {
  const files = await readArnProbeReadComparisonJson(evidenceFile) as ReadComparisonRetirementFiles;
  const proofFile = options.get("--retirement-proof")!;
  if (!path.isAbsolute(proofFile)) throw new Error("Generation3 proof path must be absolute.");
  const readEvidence = async () => { const value = await loadReadComparisonRetirementProof(repository, proofFile, files); return { priorPlan: value.generation1.priorPlan, predecessor: value.generation1.predecessor, retirementProof: value.proof }; }, evidence = await readEvidence();
  const readPredecessor = async () => { const current = await readEvidence(); probeSame(current, evidence, "Generation3 closed predecessor stability"); return current.predecessor; };
  const slot = await createArnProbeComparisonFsSlot(repository, await arnProbeComparisonFence(evidence.predecessor, evidence.retirementProof), evidence.retirementProof);
  // Validate an approved review and slot before even constructing network clients.
  let review: ArnProbeComparisonCreateReview | undefined;
  if (mode !== "ReviewCreate") {
    review = await readArnProbeReadComparisonJson(options.get("--review")!) as ArnProbeComparisonCreateReview;
    await assertArnProbeComparisonCreateReview(review); probeSame(review.plan.input.retirementProof, evidence.retirementProof, "Generation3 independent retirement proof"); probeSame(review.sourceReview.predecessor, evidence.predecessor, "Reviewed predecessor");
    probeSame(review.sourceReview.plan.input.priorPlan, evidence.priorPlan, "Reviewed prior plan");
    if (mode === "CreateReviewed" && (options.get("--approved-review-sha256") !== review.reviewSha256 || options.get("--execution-phrase") !== review.requiredPhrase || Date.now() >= Date.parse(review.expiresAt) || Date.now() < Date.parse(review.issuedAt))) throw new Error("Exact approval expired or mismatched; no AWS write submitted.");
  }
  await slot.readClaim();
  const { createArnProbeSourceReadRuntime } = await import("../../../lib/deployments/execution/aws-sdk-arn-probe-source-read-runtime.ts");
  const runtime = await createArnProbeSourceReadRuntime(); destroyers.push(runtime.destroy);
  const signal = AbortSignal.any([cancelled.signal, AbortSignal.timeout(90_000)]);
  let result: Awaited<ReturnType<typeof reviewArnProbeComparisonCreate>> | Awaited<ReturnType<typeof createReviewedArnProbeComparison>> | Awaited<ReturnType<typeof recoverArnProbeComparisonCreate>>;
  if (mode === "ReviewCreate") {
    const sourceReview = await reviewArnProbeReadComparison({ priorPlan: evidence.priorPlan, readPredecessor, reads: runtime.reads, signal });
    result = await reviewArnProbeComparisonCreate({ sourceReview, variant, retirementProof: evidence.retirementProof, slot, signal });
  } else {
    const cf = await import("@aws-sdk/client-cloudformation");
    const client = new cf.CloudFormationClient({ region: "ca-central-1", credentials: runtime.credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true });
    destroyers.push(() => client.destroy());
    const wrapped = { send: (command: unknown, options: { abortSignal: AbortSignal }) => client.send(command as never, options) as unknown as Promise<Record<string, unknown>> };
    const { AwsSdkArnProbeComparisonGrantCreateAdapter, AwsSdkArnProbeComparisonGrantReadAdapter } = await import("../../../lib/deployments/execution/aws-sdk-arn-probe-read-comparison-generation3-create.ts");
    type Command = new (input: Record<string, unknown>) => unknown;
    if (mode === "CreateReviewed") {
      const create = new AwsSdkArnProbeComparisonGrantCreateAdapter(review!.plan, wrapped, cf.CreateChangeSetCommand as unknown as Command);
      result = await createReviewedArnProbeComparison({ review: review!, slot, reads: runtime.reads, readPredecessor, signal,
        approvedReviewSha256: options.get("--approved-review-sha256")!, executionPhrase: options.get("--execution-phrase")!,
        acknowledgeAwsWrite: true, acknowledgeNamedIamChangeSetOnly: true, acknowledgeLowCostNotZero: true,
        acknowledgePreservesPredecessorAndConsumesGeneration3: true, create: (request, s) => create.create(request, s) });
    } else {
      const read = new AwsSdkArnProbeComparisonGrantReadAdapter(wrapped, { listChangeSets: cf.ListChangeSetsCommand as unknown as Command,
        describeChangeSet: cf.DescribeChangeSetCommand as unknown as Command, getTemplate: cf.GetTemplateCommand as unknown as Command });
      result = await recoverArnProbeComparisonCreate({ review: review!, slot, reads: runtime.reads, readPredecessor, signal, readGrant: (plan, s) => read.waitReady(plan, s) });
    }
  }
  await destination.writeFile(`${JSON.stringify(result, null, 2)}\n`, "utf8"); await destination.sync();
  console.log(JSON.stringify({ mode, output, digest: "receiptSha256" in result ? result.receiptSha256 : result.reviewSha256,
    outcome: "outcome" in result ? result.outcome : "REVIEWED_NOT_APPROVED", mutationPerformed: result.mutationPerformed,
    grantExecutionAuthorized: false, operatorReadAuthorized: false, retryAuthorized: false }, null, 2));
  if ("outcome" in result && result.outcome !== "CREATE_SUBMITTED" && mode === "CreateReviewed") process.exitCode = 1;
} catch (error) {
  const body = { stage: "B5-J5g-j19", mode, outcome: "GENERATION3_ENTRY_BLOCKED", failures: [sanitizeArnProbeFailure(error, "ENTRY")],
    mutationPerformed: mode === "CreateReviewed" ? null : false, slotStateRequiresReadOnlyReconciliation: mode === "CreateReviewed",
    retryAuthorized: false, grantExecutionAuthorized: false, operatorReadAuthorized: false, probeDeletionAuthorized: false, runtimeEnabled: false };
  await destination.writeFile(`${JSON.stringify({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) }, null, 2)}\n`, "utf8"); await destination.sync();
  console.error("Generation3 entry failed closed. Never reset or retry a consumed/uncertain slot; use independent read-only reconciliation."); process.exitCode = 1;
} finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); destroyers.forEach((destroy) => destroy()); await destination.close(); }
