import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { probeSame, probeInstant } from "../../../lib/deployments/execution/arn-compatibility-probe-workflow.ts";
import { sanitizeArnProbeFailure } from "../../../lib/deployments/execution/arn-compatibility-probe-diagnostics.ts";
import { readArnProbeReadComparisonJson } from "../../../lib/deployments/execution/arn-compatibility-probe-read-comparison-evidence.ts";
import { loadClosedStackScopedReadControlEvidence, type StackScopedReadControlFiles } from "../../../lib/deployments/execution/arn-probe-stack-scoped-read-control-evidence.ts";
import { reviewStackControlCreate, assertStackControlCreateReview, createReviewedStackControl, recoverStackControlCreate,
  type StackControlCreateReview } from "../../../lib/deployments/execution/arn-probe-stack-scoped-read-control-create.ts";
import { createStackControlFsSlot } from "../../../lib/deployments/execution/arn-probe-stack-scoped-read-control-slot.ts";

const args = process.argv.slice(2), values = new Map<string, string>(), flags = new Set<string>();
const writeFlags = ["--acknowledge-aws-write", "--acknowledge-named-iam-unexecuted-only", "--acknowledge-permanent-slot-and-old-records", "--acknowledge-low-cost-not-zero"];
for (let i = 0; i < args.length; i++) {
  const key = args[i]; if (values.has(key) || flags.has(key)) throw new Error("Duplicate J22 creation option.");
  if (["--acknowledge-read-only", ...writeFlags].includes(key)) flags.add(key);
  else { if (!["--mode", "--evidence", "--output", "--review", "--approved-review-sha256", "--execution-phrase"].includes(key) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Unsupported J22 creation option."); values.set(key, args[++i]); }
}
const mode = values.get("--mode"), evidenceFile = values.get("--evidence"), output = values.get("--output"), reviewFile = values.get("--review");
if (!["ReviewCreate", "CreateReviewed", "RecoverCreate"].includes(mode ?? "") || !evidenceFile || !output || !path.isAbsolute(evidenceFile) || !path.isAbsolute(output)) throw new Error("J22 exact mode and absolute evidence/output paths required.");
if (mode === "CreateReviewed") {
  if (!reviewFile || !path.isAbsolute(reviewFile) || flags.size !== writeFlags.length || writeFlags.some(k => !flags.has(k)) ||
    !/^[a-f0-9]{64}$/.test(values.get("--approved-review-sha256") ?? "") || !values.get("--execution-phrase")) throw new Error("J22 Create requires a new full SHA, phrase and four explicit acknowledgements.");
} else {
  if (flags.size !== 1 || !flags.has("--acknowledge-read-only") || values.has("--approved-review-sha256") || values.has("--execution-phrase") ||
    (mode === "ReviewCreate" ? !!reviewFile : !reviewFile || !path.isAbsolute(reviewFile))) throw new Error("J22 Source-only reviewed mode cannot carry write approval.");
}
const repository = await realpath(fileURLToPath(new URL("../../../", import.meta.url))), parent = await realpath(path.dirname(output)), target = path.join(parent, path.basename(output));
if (path.basename(target).startsWith(".") || target.split(path.sep).some(k => [".git", ".aws", ".codex", ".agents", ".aws-sandbox"].includes(k))) throw new Error("J22 output cannot overwrite protected records.");
const destination = await open(target, "wx"), destroyers: Array<() => void> = [], cancellation = new AbortController(), stop = () => cancellation.abort();
process.on("SIGINT", stop); process.on("SIGTERM", stop);
try {
  const files = await readArnProbeReadComparisonJson(evidenceFile) as StackScopedReadControlFiles;
  const archived = await loadClosedStackScopedReadControlEvidence(repository, files);
  const readPredecessor = async () => { const value = await loadClosedStackScopedReadControlEvidence(repository, files); probeSame(value, archived, "J22 real preserved archive/journal stability"); return value.predecessor; };
  const slot = await createStackControlFsSlot(repository, archived.fence, archived.predecessor);
  let review: StackControlCreateReview | undefined;
  if (mode !== "ReviewCreate") {
    review = await readArnProbeReadComparisonJson(reviewFile!) as StackControlCreateReview; await assertStackControlCreateReview(review);
    probeSame(review.plan.input.candidate.input.predecessor, archived.predecessor, "J22 live entry exact closed predecessor");
    if (mode === "CreateReviewed" && (values.get("--approved-review-sha256") !== review.reviewSha256 || values.get("--execution-phrase") !== review.requiredPhrase ||
      Date.now() < probeInstant(review.issuedAt) || Date.now() >= probeInstant(review.expiresAt))) throw new Error("J22 approval mismatch/expired; no AWS write.");
  }
  const claim = await slot.readClaim();
  if (mode === "RecoverCreate" ? !claim : !!claim) throw new Error("J22 slot state forbids adoption/replay/reconstruction.");
  // All local scope, SHA, window and permanent-slot checks precede clients.
  const { createArnProbeSourceReadRuntime } = await import("../../../lib/deployments/execution/aws-sdk-arn-probe-source-read-runtime.ts");
  const runtime = await createArnProbeSourceReadRuntime(); destroyers.push(runtime.destroy);
  const cf = await import("@aws-sdk/client-cloudformation");
  const client = new cf.CloudFormationClient({ region: "ca-central-1", credentials: runtime.credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true }); destroyers.push(() => client.destroy());
  type Command = new (input: Record<string, unknown>) => unknown;
  const wrapped = { send: (command: unknown, options: { abortSignal: AbortSignal }) => client.send(command as never, options) as unknown as Promise<Record<string, unknown>> };
  const { AwsSdkStackControlInventoryReadAdapter, AwsSdkStackControlCreateAdapter } = await import("../../../lib/deployments/execution/aws-sdk-arn-probe-stack-scoped-read-control-create.ts");
  const inventory = new AwsSdkStackControlInventoryReadAdapter(wrapped, { listChangeSets: cf.ListChangeSetsCommand as unknown as Command,
    describeChangeSet: cf.DescribeChangeSetCommand as unknown as Command, getTemplate: cf.GetTemplateCommand as unknown as Command });
  const reads = { readManagement: (p: typeof archived.predecessor, signal: AbortSignal) => runtime.readGeneration4Management(p.input.creationReview.plan, signal),
    readFixture: (p: typeof archived.predecessor, signal: AbortSignal) => runtime.reads.readFixture(p.input.creationReview.plan.input.comparisonPlan.input.priorPlan, signal),
    readFixtureInventory: (p: typeof archived.predecessor, signal: AbortSignal) => inventory.readFixtureInventory(p, signal),
    readInventory: (plan: Parameters<typeof inventory.readInventory>[0], signal: AbortSignal) => inventory.readInventory(plan, signal) };
  const common = { reads, slot, readPredecessor, signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(90_000)]) };
  let result;
  if (mode === "ReviewCreate") result = await reviewStackControlCreate(common);
  else if (mode === "RecoverCreate") result = await recoverStackControlCreate({ ...common, review: review! });
  else {
    const create = new AwsSdkStackControlCreateAdapter(review!.plan, wrapped, cf.CreateChangeSetCommand as unknown as Command);
    result = await createReviewedStackControl({ ...common, review: review!, approval: { approvedReviewSha256: values.get("--approved-review-sha256")!, executionPhrase: values.get("--execution-phrase")!,
      acknowledgeAwsWrite: true, acknowledgeNamedIamUnexecutedOnly: true, acknowledgePermanentSlotAndOldRecords: true, acknowledgeLowCostNotZero: true }, create: (request, signal) => create.create(request, signal) });
  }
  await destination.writeFile(`${JSON.stringify(result, null, 2)}\n`); await destination.sync();
  console.log(JSON.stringify({ mode, output, digest: "receiptSha256" in result ? result.receiptSha256 : result.reviewSha256,
    outcome: "outcome" in result ? result.outcome : "REVIEWED_NOT_APPROVED", mutationPerformed: result.mutationPerformed,
    grantExecutionAuthorized: false, operatorReadAuthorized: false, retryAuthorized: false }, null, 2));
  if (mode === "CreateReviewed" && "outcome" in result && result.outcome !== "CREATE_SUBMITTED") process.exitCode = 1;
} catch (error) {
  const body = { stage: "B5-J5g-j22", mode, outcome: "STACK_CONTROL_CREATE_ENTRY_BLOCKED", failure: sanitizeArnProbeFailure(error, "ENTRY"),
    mutationPerformed: mode === "CreateReviewed" ? null : false, retryAuthorized: false, grantExecutionAuthorized: false, operatorReadAuthorized: false, runtimeEnabled: false };
  await destination.writeFile(`${JSON.stringify({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) }, null, 2)}\n`); await destination.sync();
  console.error("J22 entry blocked. Preserve records; uncertain/consumed slots permit only independent read-only reconciliation, never reset or replay."); process.exitCode = 1;
} finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); destroyers.forEach(destroy => destroy()); await destination.close(); }
