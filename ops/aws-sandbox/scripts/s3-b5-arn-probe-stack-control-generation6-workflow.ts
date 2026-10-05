import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { probeSame, probeInstant, ARN_PROBE_MFA } from "../../../lib/deployments/execution/arn-compatibility-probe-workflow.ts";
import { sanitizeArnProbeFailure } from "../../../lib/deployments/execution/arn-compatibility-probe-diagnostics.ts";
import { assertGeneration6CreateReview, type Generation6CreateReview, type Generation6SourceReads } from "../../../lib/deployments/execution/arn-probe-stack-control-generation6.ts";
import { createGeneration6FsSlot, loadGeneration6Context } from "../../../lib/deployments/execution/arn-probe-stack-control-generation6-storage.ts";
import { readStackControlRetirementJson, type StackControlRetirementFiles } from "../../../lib/deployments/execution/arn-probe-stack-control-generation5-retirement-evidence.ts";
import { GENERATION6_STEPS } from "../../../lib/deployments/execution/arn-probe-stack-control-generation6-actions.ts";
import { assertGeneration6Workflow, approveGeneration6Workflow, reviewGeneration6Workflow, runGeneration6Workflow, recoverGeneration6Revoke, inspectGeneration6Workflow,
  type Generation6WorkflowManifest, type Generation6WorkflowApproval, type Generation6WorkflowWrites } from "../../../lib/deployments/execution/arn-probe-stack-control-generation6-workflow.ts";

const values = new Map<string, string>(), flags = new Set<string>(), args = process.argv.slice(2);
const keys = ["--retirement-proof", "--mode", "--output", "--evidence", "--creation-review", "--manifest", "--approved-manifest-sha", "--approved-grant-sha", "--approved-reads-sha", "--approved-revoke-sha", "--execution-phrase"];
const flagKeys = ["--acknowledge-read-only", "--acknowledge-aws-write", "--acknowledge-low-cost-not-zero"];
for (let i = 0; i < args.length; i++) { const key = args[i]; if (values.has(key) || flags.has(key)) throw new Error("Duplicate J23 generation6 workflow option.");
  if (flagKeys.includes(key)) flags.add(key); else { if (!keys.includes(key) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Unsupported J23 generation6 workflow option."); values.set(key, args[++i]); } }
const mode = values.get("--mode") ?? "", output = values.get("--output"), common = ["--mode", "--output", "--evidence", "--retirement-proof", "--creation-review"];
const write = [...common, "--manifest", "--approved-manifest-sha", "--approved-revoke-sha", "--execution-phrase"];
const contracts: Record<string, { values: string[]; flags: string[] }> = {
  Review: { values: common, flags: ["--acknowledge-read-only"] }, Inspect: { values: [...common, "--manifest"], flags: ["--acknowledge-read-only"] },
  RunReviewed: { values: [...write, "--approved-grant-sha", "--approved-reads-sha"], flags: ["--acknowledge-aws-write", "--acknowledge-low-cost-not-zero"] },
  RecoverRevoke: { values: write, flags: ["--acknowledge-aws-write", "--acknowledge-low-cost-not-zero"] } };
const contract = contracts[mode];
if (!contract || !output || [...values.keys()].some(k => !contract.values.includes(k)) || contract.values.some(k => !values.has(k)) ||
  flags.size !== contract.flags.length || contract.flags.some(k => !flags.has(k)) || [output, values.get("--evidence")!, values.get("--creation-review")!, values.get("--retirement-proof")!, ...(values.has("--manifest") ? [values.get("--manifest")!] : [])].some(p => !path.isAbsolute(p))) throw new Error("J23 generation6 strict mode/acknowledgements/absolute paths required.");
for (const [key, value] of values) if (key.startsWith("--approved-") && !/^[a-f0-9]{64}$/.test(value)) throw new Error("J23 generation6 full explicit SHA required.");
const repository = await realpath(fileURLToPath(new URL("../../../", import.meta.url))), parent = await realpath(path.dirname(output)), target = path.join(parent, path.basename(output));
if (path.basename(target).startsWith(".") || target.startsWith("\\\\") || target.startsWith("//") || target.split(path.sep).some(k => [".git", ".aws", ".codex", ".agents", ".aws-sandbox"].includes(k.toLowerCase()))) throw new Error("J23 generation6 output is protected.");
const destination = await open(target, "wx"), destroyers: Array<() => void> = [], cancel = new AbortController(), stop = () => cancel.abort();
process.on("SIGINT", stop); process.on("SIGTERM", stop); const writeMode = mode === "RunReviewed" || mode === "RecoverRevoke";
try {
  const files = await readStackControlRetirementJson(values.get("--evidence")!) as StackControlRetirementFiles;
  const first = await loadGeneration6Context(repository, files, values.get("--retirement-proof")!);
  const review = await readStackControlRetirementJson(values.get("--creation-review")!) as Generation6CreateReview;
  await assertGeneration6CreateReview(review);
  probeSame(review.plan.input.candidate.input.context, first.context, "J23 generation6 full archived context before SDK");
  const slot = await createGeneration6FsSlot(repository, first.context), claim = await slot.readClaim();
  if (!claim) throw new Error("J23 generation6 actual approved creation claim required before Source/Operator clients.");
  const readContext = async () => { const value = await loadGeneration6Context(repository, files, values.get("--retirement-proof")!);
    probeSame(value, first, "J23 generation6 full archive/retirement ledger stable"); return value.context; };
  let manifest: Generation6WorkflowManifest | undefined, approval: Generation6WorkflowApproval | undefined;
  if (mode !== "Review") {
    const value = await readStackControlRetirementJson(values.get("--manifest")!); manifest = value.manifest ?? value;
    await assertGeneration6Workflow(manifest!); probeSame(manifest!.input.creationReview, review, "J23 generation6 exact reviewed creation"); probeSame(manifest!.input.claim, claim, "J23 generation6 actual fixed claim");
    if (writeMode) {
      approval = { approvedManifestSha256: values.get("--approved-manifest-sha")!, approvedGrantSha256: values.get("--approved-grant-sha") ?? "",
        approvedReadsSha256: values.get("--approved-reads-sha") ?? "", approvedRevokeSha256: values.get("--approved-revoke-sha")!,
        acknowledgeAwsWrite: true, acknowledgeLowCostNotZero: true, executionPhrase: values.get("--execution-phrase")! };
      approveGeneration6Workflow(manifest!, approval, mode === "RecoverRevoke");
      if (mode === "RunReviewed" && (Date.now() < probeInstant(manifest!.input.reviewedAt) || Date.now() >= probeInstant(manifest!.input.expiresAt))) throw new Error("J23 generation6 Run approval expired; no client/MFA/write.");
    }
  } else if (await slot.workflowIntentsPresent()) throw new Error("J23 generation6 workflow consumed; no new review/window. Inspect original manifest only.");
  const journal = manifest ? await slot.workflowJournal(manifest) : undefined;
  if (mode === "RunReviewed") for (const step of GENERATION6_STEPS) if (await journal!.load(step)) throw new Error("J23 generation6 intent consumed; no client/MFA/replay.");
  if (mode === "RecoverRevoke" && (!(await journal!.load("run")) || !(await journal!.load("grant-execute")))) throw new Error("J23 generation6 original run/Grant intent missing; no recovery write.");
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
  const { AwsSdkGeneration6WorkflowReadAdapter, AwsSdkGeneration6WorkflowWriteAdapter, AwsSdkGeneration6OperatorReadAdapter } = await import("../../../lib/deployments/execution/aws-sdk-arn-probe-stack-control-generation6-workflow.ts");
  const fixtureInventory = new AwsSdkStackControlInventoryReadAdapter(wrap(client), commands);
  const { AwsSdkGeneration6InventoryReader } = await import("../../../lib/deployments/execution/aws-sdk-arn-probe-stack-control-generation6-create.ts");
  const inventory = new AwsSdkGeneration6InventoryReader(wrap(client), commands);
  const predecessor = first.archived.creationReview.plan.input.candidate.input.predecessor;
  const prior = predecessor.input.creationReview.plan.input.comparisonPlan.input.priorPlan;
  const readFixture = (_p: Generation6CreateReview["plan"], s: AbortSignal) => source.reads.readFixture(prior, s);
  const readFixtureInventory = (_p: Generation6CreateReview["plan"], s: AbortSignal) => fixtureInventory.readFixtureInventory(predecessor, s);
  const creation: Generation6SourceReads = { observe: async (plan, s) => {
    const managementBefore = await source.readStackControlManagement(first.archived.creationReview.plan, s),
      fixtureBefore = await readFixture(plan, s), fixtureInventoryBefore = await readFixtureInventory(plan, s),
      managementInventory = await inventory.read(plan, s), fixtureInventoryAfter = await readFixtureInventory(plan, s),
      fixtureAfter = await readFixture(plan, s), managementAfter = await source.readStackControlManagement(first.archived.creationReview.plan, s);
    return { managementBefore, fixtureBefore, fixtureInventoryBefore, inventory: managementInventory, fixtureInventoryAfter, fixtureAfter, managementAfter };
  } };
  const reads = new AwsSdkGeneration6WorkflowReadAdapter({ client: wrap(client), commands, creation,
    readManagement: source.readGeneration6StackControlManagement, readFixture, readFixtureInventory });
  const local = { readClaim: slot.readClaim, readContext }, signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(writeMode ? 180_000 : 90_000)]); let result;
  if (mode === "Review") result = await reviewGeneration6Workflow({ ...local, creationReview: review, reads, signal });
  else if (mode === "Inspect") result = await inspectGeneration6Workflow({ ...local, manifest: manifest!, reads, journal: journal!, signal });
  else {
    const writeClient = new cf.CloudFormationClient(config); destroyers.push(() => writeClient.destroy());
    const mutations = new AwsSdkGeneration6WorkflowWriteAdapter(manifest!, { source: wrap(writeClient), createChangeSet: cf.CreateChangeSetCommand as unknown as Command,
      executeChangeSet: cf.ExecuteChangeSetCommand as unknown as Command, grantCapabilityEnabled: mode === "RunReviewed" });
    if (mode === "RecoverRevoke") result = await recoverGeneration6Revoke({ ...local, manifest: manifest!, approval: approval!, reads, journal: journal!,
      writes: { createRevoke: (r, s) => mutations.createRevoke(r, s), executeRevoke: (r, s) => mutations.executeRevoke(r, s) } });
    else {
      const sts = await import("@aws-sdk/client-sts"), { createArnProbeOperatorSession } = await import("../../../lib/deployments/execution/aws-sdk-arn-compatibility-probe-workflow.ts");
      const sourceSts = new sts.STSClient(config); destroyers.push(() => sourceSts.destroy());
      const session = createArnProbeOperatorSession({ sts: wrap(sourceSts), assumeRole: sts.AssumeRoleCommand as unknown as Command, getCallerIdentity: sts.GetCallerIdentityCommand as unknown as Command,
        mfaCode: async () => { const prompt = createInterface({ input: process.stdin, output: process.stdout });
          try { return (await prompt.question(`Enter MFA code for ${ARN_PROBE_MFA}: `, { signal })).trim(); } finally { prompt.close(); } },
        createOperatorSts: credentials => { const operatorSts = new sts.STSClient({ ...config, credentials }); destroyers.push(() => operatorSts.destroy()); return wrap(operatorSts); } });
      const operator = new cf.CloudFormationClient({ ...config, credentials: session.credentials }); destroyers.push(() => operator.destroy());
      const operatorReads = new AwsSdkGeneration6OperatorReadAdapter({ operator: wrap(operator), describeChangeSet: cf.DescribeChangeSetCommand as unknown as Command, verifyIdentity: session.prepare, fixturePlan: prior.input.fixturePlan });
      const writes: Generation6WorkflowWrites = { prepareOperator: session.prepare, executeGrant: (r, s) => mutations.executeGrant(r, s), createRevoke: (r, s) => mutations.createRevoke(r, s), executeRevoke: (r, s) => mutations.executeRevoke(r, s) };
      result = await runGeneration6Workflow({ ...local, manifest: manifest!, approval: approval!, reads, writes, operatorReads, journal: journal!, signal });
    }
  }
  await destination.writeFile(`${JSON.stringify(result, null, 2)}\n`); await destination.sync();
  console.log(JSON.stringify({ mode, output, outcome: result.outcome, digest: "receiptSha256" in result ? result.receiptSha256 : result.reviewSha256, productionCompatibilityVerified: false, runtimeEnabled: false }, null, 2));
  if (result.outcome === "REVOKE_REQUIRED" || result.outcome === "LOCKED_RECONCILIATION_REQUIRED") process.exitCode = 2;
} catch (e) {
  const body = { stage: "B5-J5g-j23", mode, outcome: "STACK_CONTROL_WORKFLOW_ENTRY_BLOCKED", mutationPerformed: writeMode ? null : false,
    failure: sanitizeArnProbeFailure(e, "ENTRY"), retryAuthorized: false, productionCompatibilityVerified: false, runtimeEnabled: false };
  await destination.writeFile(`${JSON.stringify({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) }, null, 2)}\n`); await destination.sync();
  console.error("J23 generation6 failed closed. Preserve all records; never replay Grant/reads or reset the slot. Inspect read-only; recovery needs separate exact revoke-only approval. No MFA/credentials/raw errors are saved."); process.exitCode = 1;
} finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); destroyers.forEach(destroy => destroy()); await destination.close(); }
