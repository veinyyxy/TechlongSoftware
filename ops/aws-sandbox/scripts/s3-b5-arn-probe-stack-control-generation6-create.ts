import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { probeSame, probeInstant } from "../../../lib/deployments/execution/arn-compatibility-probe-workflow.ts";
import { sanitizeArnProbeFailure } from "../../../lib/deployments/execution/arn-compatibility-probe-diagnostics.ts";
import { readStackControlRetirementJson, assertGeneration6RegistryAbsent, type StackControlRetirementFiles } from "../../../lib/deployments/execution/arn-probe-stack-control-generation5-retirement-evidence.ts";
import { loadGeneration6Context, createGeneration6FsSlot } from "../../../lib/deployments/execution/arn-probe-stack-control-generation6-storage.ts";
import { reviewGeneration6Create, createReviewedGeneration6, recoverGeneration6Create, assertGeneration6CreateReview, approveGeneration6Create,
  GENERATION6_STAGE, type Generation6CreateReview } from "../../../lib/deployments/execution/arn-probe-stack-control-generation6.ts";

const args = process.argv.slice(2), values = new Map<string, string>(), flags = new Set<string>();
const writeFlags = ["--acknowledge-aws-write", "--acknowledge-named-iam-unexecuted-only", "--acknowledge-permanent-slot-and-old-records", "--acknowledge-low-cost-not-zero"];
for (let i = 0; i < args.length; i++) {
  const key = args[i]; if (values.has(key) || flags.has(key)) throw new Error("Duplicate generation6 option.");
  if (["--acknowledge-read-only", "--acknowledge-local-only", ...writeFlags].includes(key)) flags.add(key);
  else {
    if (!["--mode", "--evidence", "--retirement-proof", "--output", "--review", "--approved-review-sha256", "--execution-phrase"].includes(key) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Unsupported generation6 option.");
    values.set(key, args[++i]);
  }
}
const mode = values.get("--mode"), evidenceFile = values.get("--evidence"), proofFile = values.get("--retirement-proof"), output = values.get("--output"), reviewFile = values.get("--review");
if (!["CheckLocalPreparation", "ReviewCreate", "CreateReviewed", "RecoverCreate"].includes(mode ?? "") || [evidenceFile, proofFile, output].some(v => !v || !path.isAbsolute(v))) throw new Error("Exact generation6 mode and absolute evidence/proof/output required.");
if (mode === "CreateReviewed") {
  if (!reviewFile || !path.isAbsolute(reviewFile) || flags.size !== writeFlags.length || writeFlags.some(k => !flags.has(k)) ||
    !/^[a-f0-9]{64}$/.test(values.get("--approved-review-sha256") ?? "") || !values.get("--execution-phrase")) throw new Error("Generation6 Create needs separate full SHA, phrase and four acknowledgements.");
} else {
  const requiredFlag = mode === "CheckLocalPreparation" ? "--acknowledge-local-only" : "--acknowledge-read-only";
  if (flags.size !== 1 || !flags.has(requiredFlag) || values.has("--approved-review-sha256") || values.has("--execution-phrase") ||
    (mode === "RecoverCreate" ? !reviewFile || !path.isAbsolute(reviewFile) : !!reviewFile)) throw new Error("Generation6 local/read-only mode cannot carry write approval.");
}
const repository = await realpath(fileURLToPath(new URL("../../../", import.meta.url))), parent = await realpath(path.dirname(output!)), target = path.join(parent, path.basename(output!));
if (/^(?:\\\\|\/\/)/.test(target) || path.basename(target).startsWith(".") || target.split(path.sep).some(k => [".git", ".aws", ".codex", ".agents", ".aws-sandbox"].includes(k.toLowerCase()))) throw new Error("Generation6 output must be local and cannot overwrite protected records.");
const destination = await open(target, "wx"), cancellation = new AbortController(), stop = () => cancellation.abort();
const destroyers: Array<() => void> = []; process.on("SIGINT", stop); process.on("SIGTERM", stop);
try {
  const files = await readStackControlRetirementJson(evidenceFile!) as StackControlRetirementFiles, loaded = await loadGeneration6Context(repository, files, proofFile!);
  const readContext = async () => {
    const current = await loadGeneration6Context(repository, files, proofFile!); probeSame(current, loaded, "J23 actual archived trees/ledger/proof stable"); return current.context;
  };
  const slot = await createGeneration6FsSlot(repository, loaded.context);
  let result;
  if (mode === "CheckLocalPreparation") {
    await assertGeneration6RegistryAbsent(repository); probeSame(await readContext(), loaded.context, "J23 local context stable");
    const body = { schemaVersion: 1, stage: GENERATION6_STAGE, mode, outcome: "RETIRED_GENERATION5_GENERATION6_PREPARATION_VERIFIED",
      contextSha256: await sha256Hex(canonicalJson(loaded.context)), fence: slot.fence, oldRecordsPreserved: true, generation6RegistryAbsent: true,
      mutationPerformed: false, networkUsed: false, candidateCompiled: false, approvalWindowOpened: false, registryCreated: false,
      creationApproved: false, grantExecutionAuthorized: false, operatorReadAuthorized: false, retryAuthorized: false, productionCompatibilityVerified: false, runtimeEnabled: false };
    result = { ...body, receiptSha256: await sha256Hex(canonicalJson(body)) };
  } else {
    let review: Generation6CreateReview | undefined;
    if (mode !== "ReviewCreate") {
      review = await readStackControlRetirementJson(reviewFile!) as Generation6CreateReview; await assertGeneration6CreateReview(review);
      probeSame(review.plan.input.candidate.input.context, loaded.context, "J23 exact real generation6 context");
      if (mode === "CreateReviewed") {
        approveGeneration6Create(review, { approvedReviewSha256: values.get("--approved-review-sha256")!, executionPhrase: values.get("--execution-phrase")!,
          acknowledgeAwsWrite: true, acknowledgeNamedIamUnexecutedOnly: true, acknowledgePermanentSlotAndOldRecords: true, acknowledgeLowCostNotZero: true });
        const at = Date.now(); if (at < probeInstant(review.issuedAt) || at >= probeInstant(review.expiresAt)) throw new Error("Generation6 creation approval expired; no AWS write.");
      }
    }
    const claim = await slot.readClaim(); if (mode === "RecoverCreate" ? !claim : !!claim) throw new Error("Generation6 consumed/missing claim forbids adoption or replay.");
    // No SDK/credential loading before all local scope, slot and approval checks.
    const { createGeneration6SourceRuntime } = await import("../../../lib/deployments/execution/aws-sdk-arn-probe-stack-control-generation6-create.ts");
    const runtime = await createGeneration6SourceRuntime(loaded.archived); destroyers.push(runtime.destroy);
    const common = { readContext, slot, reads: runtime.reads, signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(90_000)]) };
    if (mode === "ReviewCreate") result = await reviewGeneration6Create(common);
    else if (mode === "RecoverCreate") result = await recoverGeneration6Create({ ...common, review: review! });
    else {
      const adapter = runtime.createAdapter(review!);
      result = await createReviewedGeneration6({ ...common, review: review!, approval: { approvedReviewSha256: values.get("--approved-review-sha256")!, executionPhrase: values.get("--execution-phrase")!,
        acknowledgeAwsWrite: true, acknowledgeNamedIamUnexecutedOnly: true, acknowledgePermanentSlotAndOldRecords: true, acknowledgeLowCostNotZero: true }, create: (request, signal) => adapter.create(request, signal) });
    }
  }
  await destination.writeFile(`${JSON.stringify(result, null, 2)}\n`); await destination.sync();
  console.log(JSON.stringify({ mode, output, digest: "receiptSha256" in result ? result.receiptSha256 : result.reviewSha256,
    outcome: "outcome" in result ? result.outcome : "REVIEWED_NOT_APPROVED", mutationPerformed: result.mutationPerformed,
    grantExecutionAuthorized: false, operatorReadAuthorized: false, retryAuthorized: false }, null, 2));
  if (mode === "CreateReviewed" && "outcome" in result && result.outcome !== "CREATE_SUBMITTED") process.exitCode = 1;
} catch (e) {
  const body = { stage: GENERATION6_STAGE, mode, outcome: "GENERATION6_CREATE_ENTRY_BLOCKED", failure: sanitizeArnProbeFailure(e, "ENTRY"),
    mutationPerformed: mode === "CreateReviewed" ? null : false, retryAuthorized: false, grantExecutionAuthorized: false, operatorReadAuthorized: false, runtimeEnabled: false };
  await destination.writeFile(`${JSON.stringify({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) }, null, 2)}\n`); await destination.sync();
  console.error("Generation6 entry blocked. Preserve records; reconcile read-only, never reset or replay."); process.exitCode = 1;
} finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); destroyers.forEach(d => d()); await destination.close(); }
