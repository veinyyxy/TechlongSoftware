import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { probeSame, probeInstant, ARN_PROBE_MFA } from "../../../lib/deployments/execution/arn-compatibility-probe-workflow.ts";
import { sanitizeArnProbeFailure } from "../../../lib/deployments/execution/arn-compatibility-probe-diagnostics.ts";
import { readArnProbeReadComparisonJson } from "../../../lib/deployments/execution/arn-compatibility-probe-read-comparison-evidence.ts";
import { loadClosedStackScopedReadControlEvidence, type StackScopedReadControlFiles } from "../../../lib/deployments/execution/arn-probe-stack-scoped-read-control-evidence.ts";
import { assertStackControlCreateReview, type StackControlCreateReview, type StackControlSourceReads } from "../../../lib/deployments/execution/arn-probe-stack-scoped-read-control-create.ts";
import { createStackControlFsSlot } from "../../../lib/deployments/execution/arn-probe-stack-scoped-read-control-slot.ts";
import { STACK_CONTROL_STEPS } from "../../../lib/deployments/execution/arn-probe-stack-scoped-read-control-actions.ts";
import { assertStackControlWorkflow, approveStackControlWorkflow, reviewStackControlWorkflow, runStackControlWorkflow, recoverStackControlRevoke, inspectStackControlWorkflow,
  type StackControlWorkflowManifest, type StackControlWorkflowApproval, type StackControlWorkflowWrites } from "../../../lib/deployments/execution/arn-probe-stack-scoped-read-control-workflow.ts";

const values = new Map<string, string>(), flags = new Set<string>(), args = process.argv.slice(2);
const keys = ["--mode", "--output", "--evidence", "--creation-review", "--manifest", "--approved-manifest-sha", "--approved-grant-sha", "--approved-reads-sha", "--approved-revoke-sha", "--execution-phrase"];
const flagKeys = ["--acknowledge-read-only", "--acknowledge-aws-write", "--acknowledge-low-cost-not-zero"];
for (let i = 0; i < args.length; i++) { const key = args[i]; if (values.has(key) || flags.has(key)) throw new Error("Duplicate J22 workflow option.");
  if (flagKeys.includes(key)) flags.add(key); else { if (!keys.includes(key) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Unsupported J22 workflow option."); values.set(key, args[++i]); } }
const mode = values.get("--mode") ?? "", output = values.get("--output"), common = ["--mode", "--output", "--evidence", "--creation-review"];
const write = [...common, "--manifest", "--approved-manifest-sha", "--approved-revoke-sha", "--execution-phrase"];
const contracts: Record<string, { values: string[]; flags: string[] }> = {
  Review: { values: common, flags: ["--acknowledge-read-only"] }, Inspect: { values: [...common, "--manifest"], flags: ["--acknowledge-read-only"] },
  RunReviewed: { values: [...write, "--approved-grant-sha", "--approved-reads-sha"], flags: ["--acknowledge-aws-write", "--acknowledge-low-cost-not-zero"] },
  RecoverRevoke: { values: write, flags: ["--acknowledge-aws-write", "--acknowledge-low-cost-not-zero"] } };
const contract = contracts[mode];
if (!contract || !output || [...values.keys()].some(k => !contract.values.includes(k)) || contract.values.some(k => !values.has(k)) ||
  flags.size !== contract.flags.length || contract.flags.some(k => !flags.has(k)) || [output, values.get("--evidence")!, values.get("--creation-review")!, ...(values.has("--manifest") ? [values.get("--manifest")!] : [])].some(p => !path.isAbsolute(p))) throw new Error("J22 strict mode/acknowledgements/absolute paths required.");
for (const [key, value] of values) if (key.startsWith("--approved-") && !/^[a-f0-9]{64}$/.test(value)) throw new Error("J22 full explicit SHA required.");
const repository = await realpath(fileURLToPath(new URL("../../../", import.meta.url))), parent = await realpath(path.dirname(output)), target = path.join(parent, path.basename(output));
if (path.basename(target).startsWith(".") || target.split(path.sep).some(k => [".git", ".aws", ".codex", ".agents", ".aws-sandbox"].includes(k))) throw new Error("J22 output is protected.");
const destination = await open(target, "wx"), destroyers: Array<() => void> = [], cancel = new AbortController(), stop = () => cancel.abort();
process.on("SIGINT", stop); process.on("SIGTERM", stop); const writeMode = mode === "RunReviewed" || mode === "RecoverRevoke";
try {
  const files = await readArnProbeReadComparisonJson(values.get("--evidence")!) as StackScopedReadControlFiles, first = await loadClosedStackScopedReadControlEvidence(repository, files);
  const review = await readArnProbeReadComparisonJson(values.get("--creation-review")!) as StackControlCreateReview; await assertStackControlCreateReview(review);
  probeSame(review.plan.input.candidate.input.predecessor, first.predecessor, "J22 genuine closed predecessor before SDK");
  const slot = await createStackControlFsSlot(repository, first.fence, first.predecessor), claim = await slot.readClaim();
  if (!claim) throw new Error("J22 actual approved creation claim required before Source or Operator clients.");
  const readPredecessor = async () => { const value = await loadClosedStackScopedReadControlEvidence(repository, files); probeSame(value, first, "J22 real closed archive/journal stable"); return value.predecessor; };
  let manifest: StackControlWorkflowManifest | undefined, approval: StackControlWorkflowApproval | undefined;
  if (mode !== "Review") {
    const value = await readArnProbeReadComparisonJson(values.get("--manifest")!); manifest = value.manifest ?? value;
    await assertStackControlWorkflow(manifest!); probeSame(manifest!.input.creationReview, review, "J22 exact reviewed creation"); probeSame(manifest!.input.claim, claim, "J22 actual fixed claim");
    if (writeMode) {
      approval = { approvedManifestSha256: values.get("--approved-manifest-sha")!, approvedGrantSha256: values.get("--approved-grant-sha") ?? "",
        approvedReadsSha256: values.get("--approved-reads-sha") ?? "", approvedRevokeSha256: values.get("--approved-revoke-sha")!,
        acknowledgeAwsWrite: true, acknowledgeLowCostNotZero: true, executionPhrase: values.get("--execution-phrase")! };
      approveStackControlWorkflow(manifest!, approval, mode === "RecoverRevoke");
      if (mode === "RunReviewed" && (Date.now() < probeInstant(manifest!.input.reviewedAt) || Date.now() >= probeInstant(manifest!.input.expiresAt))) throw new Error("J22 Run approval expired; no client/MFA/write.");
    }
  } else if (await slot.workflowIntentsPresent()) throw new Error("J22 workflow consumed; no new review/window. Inspect original manifest only.");
  const journal = manifest ? await slot.workflowJournal(manifest) : undefined;
  if (mode === "RunReviewed") for (const step of STACK_CONTROL_STEPS) if (await journal!.load(step)) throw new Error("J22 intent consumed; no client/MFA/replay.");
  if (mode === "RecoverRevoke" && (!(await journal!.load("run")) || !(await journal!.load("grant-execute")))) throw new Error("J22 original run/Grant intent missing; no recovery write.");
  const { createArnProbeSourceReadRuntime } = await import("../../../lib/deployments/execution/aws-sdk-arn-probe-source-read-runtime.ts");
  const source = await createArnProbeSourceReadRuntime(); destroyers.push(source.destroy);
  const cf = await import("@aws-sdk/client-cloudformation"), config = { region: "ca-central-1", credentials: source.credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
  type Command = new (input: Record<string, unknown>) => unknown;
  type Client = { send(command: never, options: { abortSignal: AbortSignal }): Promise<unknown> };
  const wrap = (client: Client) => ({ send: (command: unknown, options: { abortSignal: AbortSignal }) => client.send(command as never, options) as Promise<Record<string, unknown>> });
  const client = new cf.CloudFormationClient(config); destroyers.push(() => client.destroy());
  const commands = { describeStacks: cf.DescribeStacksCommand as unknown as Command, describeChangeSet: cf.DescribeChangeSetCommand as unknown as Command,
    getTemplate: cf.GetTemplateCommand as unknown as Command, listChangeSets: cf.ListChangeSetsCommand as unknown as Command };
  const { AwsSdkStackControlInventoryReadAdapter } = await import("../../../lib/deployments/execution/aws-sdk-arn-probe-stack-scoped-read-control-create.ts");
  const { AwsSdkStackControlWorkflowReadAdapter, AwsSdkStackControlWorkflowWriteAdapter, AwsSdkStackControlOperatorReadAdapter } = await import("../../../lib/deployments/execution/aws-sdk-arn-probe-stack-scoped-read-control-workflow.ts");
  const inventory = new AwsSdkStackControlInventoryReadAdapter(wrap(client), commands);
  const creation: StackControlSourceReads = { readManagement: (p, s) => source.readGeneration4Management(p.input.creationReview.plan, s),
    readFixture: (p, s) => source.reads.readFixture(p.input.creationReview.plan.input.comparisonPlan.input.priorPlan, s),
    readFixtureInventory: (p, s) => inventory.readFixtureInventory(p, s), readInventory: (p, s) => inventory.readInventory(p, s) };
  const reads = new AwsSdkStackControlWorkflowReadAdapter({ client: wrap(client), commands, creation, readManagement: source.readStackControlManagement });
  const local = { readClaim: slot.readClaim, readPredecessor }, signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(writeMode ? 180_000 : 90_000)]); let result;
  if (mode === "Review") result = await reviewStackControlWorkflow({ ...local, creationReview: review, reads, signal });
  else if (mode === "Inspect") result = await inspectStackControlWorkflow({ ...local, manifest: manifest!, reads, signal });
  else {
    const writeClient = new cf.CloudFormationClient(config); destroyers.push(() => writeClient.destroy());
    const mutations = new AwsSdkStackControlWorkflowWriteAdapter(manifest!, { source: wrap(writeClient), createChangeSet: cf.CreateChangeSetCommand as unknown as Command,
      executeChangeSet: cf.ExecuteChangeSetCommand as unknown as Command, grantCapabilityEnabled: mode === "RunReviewed" });
    if (mode === "RecoverRevoke") result = await recoverStackControlRevoke({ ...local, manifest: manifest!, approval: approval!, reads, journal: journal!,
      writes: { createRevoke: (r, s) => mutations.createRevoke(r, s), executeRevoke: (r, s) => mutations.executeRevoke(r, s) } });
    else {
      const sts = await import("@aws-sdk/client-sts"), { createArnProbeOperatorSession } = await import("../../../lib/deployments/execution/aws-sdk-arn-compatibility-probe-workflow.ts");
      const sourceSts = new sts.STSClient(config); destroyers.push(() => sourceSts.destroy());
      const session = createArnProbeOperatorSession({ sts: wrap(sourceSts), assumeRole: sts.AssumeRoleCommand as unknown as Command, getCallerIdentity: sts.GetCallerIdentityCommand as unknown as Command,
        mfaCode: async () => { const prompt = createInterface({ input: process.stdin, output: process.stdout });
          try { return (await prompt.question(`Enter MFA code for ${ARN_PROBE_MFA}: `, { signal })).trim(); } finally { prompt.close(); } },
        createOperatorSts: credentials => { const operatorSts = new sts.STSClient({ ...config, credentials }); destroyers.push(() => operatorSts.destroy()); return wrap(operatorSts); } });
      const operator = new cf.CloudFormationClient({ ...config, credentials: session.credentials }); destroyers.push(() => operator.destroy());
      const operatorReads = new AwsSdkStackControlOperatorReadAdapter({ operator: wrap(operator), describeChangeSet: cf.DescribeChangeSetCommand as unknown as Command, verifyIdentity: session.prepare });
      const writes: StackControlWorkflowWrites = { prepareOperator: session.prepare, executeGrant: (r, s) => mutations.executeGrant(r, s), createRevoke: (r, s) => mutations.createRevoke(r, s), executeRevoke: (r, s) => mutations.executeRevoke(r, s) };
      result = await runStackControlWorkflow({ ...local, manifest: manifest!, approval: approval!, reads, writes, operatorReads, journal: journal!, signal });
    }
  }
  await destination.writeFile(`${JSON.stringify(result, null, 2)}\n`); await destination.sync();
  console.log(JSON.stringify({ mode, output, outcome: result.outcome, digest: "receiptSha256" in result ? result.receiptSha256 : result.reviewSha256, productionCompatibilityVerified: false, runtimeEnabled: false }, null, 2));
  if (result.outcome === "REVOKE_REQUIRED" || result.outcome === "LOCKED_RECONCILIATION_REQUIRED") process.exitCode = 2;
} catch (e) {
  const body = { stage: "B5-J5g-j22", mode, outcome: "STACK_CONTROL_WORKFLOW_ENTRY_BLOCKED", mutationPerformed: writeMode ? null : false,
    failure: sanitizeArnProbeFailure(e, "ENTRY"), retryAuthorized: false, productionCompatibilityVerified: false, runtimeEnabled: false };
  await destination.writeFile(`${JSON.stringify({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) }, null, 2)}\n`); await destination.sync();
  console.error("J22 failed closed. Preserve all records; never replay Grant/reads or reset the slot. Inspect read-only; recovery needs separate exact revoke-only approval. No MFA/credentials/raw errors are saved."); process.exitCode = 1;
} finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); destroyers.forEach(destroy => destroy()); await destination.close(); }
