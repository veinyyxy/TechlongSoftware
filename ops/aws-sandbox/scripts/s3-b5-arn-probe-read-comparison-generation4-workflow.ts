import { loadReadComparisonRetirementProof, type ReadComparisonRetirementFiles } from "../../../lib/deployments/execution/arn-probe-read-comparison-generation3-retirement-evidence.ts";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { probeSame, ARN_PROBE_MFA } from "../../../lib/deployments/execution/arn-compatibility-probe-workflow.ts";
import { sanitizeArnProbeFailure } from "../../../lib/deployments/execution/arn-compatibility-probe-diagnostics.ts";
import { assertArnProbeComparisonCreateReview, type ArnProbeComparisonCreateReview } from "../../../lib/deployments/execution/arn-probe-read-comparison-generation4-create.ts";
import { createArnProbeComparisonFsSlot } from "../../../lib/deployments/execution/arn-probe-read-comparison-generation4-slot.ts";
import { readArnProbeReadComparisonJson } from "../../../lib/deployments/execution/arn-compatibility-probe-read-comparison-evidence.ts";
import { reviewArnProbeComparisonWorkflow, inspectArnProbeComparisonWorkflow, assertArnProbeComparisonWorkflow,
  runArnProbeComparisonWorkflow, recoverArnProbeComparisonRevoke, type ArnProbeComparisonWorkflowManifest,
  type ArnProbeComparisonApproval, type ArnProbeComparisonWorkflowWrites } from "../../../lib/deployments/execution/arn-probe-read-comparison-generation4-workflow.ts";

const values = new Map<string, string>(), flags = new Set<string>(), args = process.argv.slice(2);
const keys = ["--mode", "--output", "--evidence", "--retirement-proof", "--creation-review", "--manifest", "--approved-manifest-sha", "--approved-grant-sha", "--approved-reads-sha", "--approved-revoke-sha", "--execution-phrase"];
const flagKeys = ["--acknowledge-read-only", "--acknowledge-aws-write", "--acknowledge-low-cost-not-zero"];
for (let i = 0; i < args.length; i++) {
  const key = args[i]; if (values.has(key) || flags.has(key)) throw new Error("Duplicate J20 workflow option.");
  if (flagKeys.includes(key)) flags.add(key);
  else { if (!keys.includes(key) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Unknown J20 workflow option."); values.set(key, args[++i]); }
}
const mode = values.get("--mode") ?? "", output = values.get("--output");
const common = ["--mode", "--output", "--evidence", "--retirement-proof", "--creation-review"], write = [...common, "--manifest", "--approved-manifest-sha", "--approved-revoke-sha", "--execution-phrase"];
const contracts: Record<string, { values: string[]; flags: string[] }> = {
  Review: { values: common, flags: ["--acknowledge-read-only"] }, Inspect: { values: common, flags: ["--acknowledge-read-only"] },
  RunReviewed: { values: [...write, "--approved-grant-sha", "--approved-reads-sha"], flags: ["--acknowledge-aws-write", "--acknowledge-low-cost-not-zero"] },
  RecoverRevoke: { values: write, flags: ["--acknowledge-aws-write", "--acknowledge-low-cost-not-zero"] } };
const contract = contracts[mode];
if (!contract || !output || [...values.keys()].some((k) => !contract.values.includes(k)) || contract.values.filter((k) => k !== "--mode").some((k) => !values.has(k)) ||
  flags.size !== contract.flags.length || contract.flags.some((k) => !flags.has(k)) || [output, values.get("--evidence")!, values.get("--retirement-proof")!, values.get("--creation-review")!, ...(values.has("--manifest") ? [values.get("--manifest")!] : [])].some((p) => !path.isAbsolute(p))) throw new Error("J20 requires strict mode scope, acknowledgements and absolute paths.");
const repository = await realpath(fileURLToPath(new URL("../../../", import.meta.url))), parent = await realpath(path.dirname(output));
if (path.relative(repository, path.join(parent, path.basename(output))).split(path.sep)[0] === ".aws-sandbox") throw new Error("J20 output cannot be a ledger record.");
const destination = await open(path.join(parent, path.basename(output)), "wx"), destroyers: Array<() => void> = [];
const cancel = new AbortController(), stop = () => cancel.abort(); process.on("SIGINT", stop); process.on("SIGTERM", stop);
const writeMode = mode === "RunReviewed" || mode === "RecoverRevoke";
try {
  const files = await readArnProbeReadComparisonJson(values.get("--evidence")!) as ReadComparisonRetirementFiles;
  const proofFile = values.get("--retirement-proof")!; if (!path.isAbsolute(proofFile)) throw new Error("Generation4 proof path must be absolute.");
  const readEvidence = async () => { const value = await loadReadComparisonRetirementProof(repository, proofFile, files); return { priorPlan: value.generation1.priorPlan, predecessor: value.generation1.predecessor, retirementProof: value.proof }; };
  const first = await readEvidence();
  const review = await readArnProbeReadComparisonJson(values.get("--creation-review")!) as ArnProbeComparisonCreateReview;
  await assertArnProbeComparisonCreateReview(review); probeSame(review.plan.input.retirementProof, first.retirementProof, "Generation4 exact retirement proof"); probeSame(review.sourceReview.predecessor, first.predecessor, "J20 reviewed predecessor");
  probeSame(review.sourceReview.plan.input.priorPlan, first.priorPlan, "J20 reviewed prior plan");
  const slot = await createArnProbeComparisonFsSlot(repository, review.fence, first.retirementProof);
  const readPredecessor = async () => { const current = await readEvidence(); probeSame(current, first, "J20 old evidence stability"); return current.predecessor; };
  let manifest: ArnProbeComparisonWorkflowManifest | undefined, approval: ArnProbeComparisonApproval | undefined;
  if (writeMode) {
    const value = await readArnProbeReadComparisonJson(values.get("--manifest")!); manifest = value.manifest ?? value;
    if (!manifest) throw new Error("No executable manifest; approved generation4 creation required first.");
    await assertArnProbeComparisonWorkflow(manifest); probeSame(manifest.input.creationReview, review, "J20 exact creation review");
    if (values.get("--approved-manifest-sha") !== manifest.manifestSha256 || values.get("--approved-revoke-sha") !== manifest.actionSha256.revoke ||
      (mode === "RunReviewed" && (values.get("--approved-grant-sha") !== manifest.actionSha256.grantExecute || values.get("--approved-reads-sha") !== manifest.actionSha256.operatorReads ||
        values.get("--execution-phrase") !== manifest.requiredPhrase || Date.now() < Date.parse(manifest.input.reviewedAt) || Date.now() >= Date.parse(manifest.input.expiresAt))) ||
      (mode === "RecoverRevoke" && values.get("--execution-phrase") !== "I_CONFIRM_J5GJ20_REVOKE_ONLY")) throw new Error("J20 exact approval mismatched or Run window expired; no AWS write.");
    approval = { approvedManifestSha256: values.get("--approved-manifest-sha")!, approvedGrantSha256: values.get("--approved-grant-sha") ?? "",
      approvedReadsSha256: values.get("--approved-reads-sha") ?? "", approvedRevokeSha256: values.get("--approved-revoke-sha")!,
      acknowledgeAwsWrite: true, acknowledgeLowCostNotZero: true, executionPhrase: values.get("--execution-phrase")! };
  }
  const journal = manifest ? await slot.workflowJournal(manifest) : undefined; await slot.readClaim();
  const { createArnProbeSourceReadRuntime } = await import("../../../lib/deployments/execution/aws-sdk-arn-probe-source-read-runtime.ts");
  const { AwsSdkArnProbeComparisonWorkflowReadAdapter, AwsSdkArnProbeComparisonOperatorReadAdapter, AwsSdkArnProbeComparisonWorkflowWriteAdapter } = await import("../../../lib/deployments/execution/aws-sdk-arn-probe-read-comparison-generation4-workflow.ts");
  const source = await createArnProbeSourceReadRuntime(); destroyers.push(source.destroy);
  const cf = await import("@aws-sdk/client-cloudformation");
  const config = { region: "ca-central-1", credentials: source.credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
  type Command = new (input: Record<string, unknown>) => unknown;
  type Client = { send(command: never, options: { abortSignal: AbortSignal }): Promise<unknown> };
  const wrap = (client: Client) => ({ send: (command: unknown, options: { abortSignal: AbortSignal }) => client.send(command as never, options) as Promise<Record<string, unknown>> });
  const readClient = new cf.CloudFormationClient(config); destroyers.push(() => readClient.destroy());
  const commands = { describeStacks: cf.DescribeStacksCommand as unknown as Command, describeChangeSet: cf.DescribeChangeSetCommand as unknown as Command,
    listChangeSets: cf.ListChangeSetsCommand as unknown as Command, getTemplate: cf.GetTemplateCommand as unknown as Command };
  const reads = new AwsSdkArnProbeComparisonWorkflowReadAdapter({ client: wrap(readClient), commands,
    readManagement: source.readGeneration4Management, readFixture: (p, s) => source.reads.readFixture(p.input.comparisonPlan.input.priorPlan, s) });
  const local = { readClaim: slot.readClaim, readPredecessor }, signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(writeMode ? 180_000 : 90_000)]);
  let result;
  if (mode === "Review") result = await reviewArnProbeComparisonWorkflow({ ...local, creationReview: review, reads, signal });
  else if (mode === "Inspect") result = await inspectArnProbeComparisonWorkflow({ ...local, creationReview: review, reads, signal });
  else {
    const writeClient = new cf.CloudFormationClient(config); destroyers.push(() => writeClient.destroy());
    const mutations = new AwsSdkArnProbeComparisonWorkflowWriteAdapter(manifest!, { source: wrap(writeClient), createChangeSet: cf.CreateChangeSetCommand as unknown as Command,
      executeChangeSet: cf.ExecuteChangeSetCommand as unknown as Command, grantCapabilityEnabled: mode === "RunReviewed" });
    if (mode === "RecoverRevoke") result = await recoverArnProbeComparisonRevoke({ ...local, manifest: manifest!, approval: approval!, reads, journal: journal!,
      writes: { createRevoke: (r, s) => mutations.createRevoke(r, s), executeRevoke: (r, s) => mutations.executeRevoke(r, s) } });
    else {
      const sts = await import("@aws-sdk/client-sts"), { createArnProbeOperatorSession } = await import("../../../lib/deployments/execution/aws-sdk-arn-compatibility-probe-workflow.ts");
      const sourceSts = new sts.STSClient(config); destroyers.push(() => sourceSts.destroy());
      const session = createArnProbeOperatorSession({ sts: wrap(sourceSts), assumeRole: sts.AssumeRoleCommand as unknown as Command,
        getCallerIdentity: sts.GetCallerIdentityCommand as unknown as Command,
        mfaCode: async () => { const prompt = createInterface({ input: process.stdin, output: process.stdout });
          try { return (await prompt.question(`Enter MFA code for ${ARN_PROBE_MFA}: `, { signal })).trim(); } finally { prompt.close(); } },
        createOperatorSts: (credentials) => { const client = new sts.STSClient({ ...config, credentials }); destroyers.push(() => client.destroy()); return wrap(client); } });
      const operator = new cf.CloudFormationClient({ ...config, credentials: session.credentials }); destroyers.push(() => operator.destroy());
      const operatorReads = new AwsSdkArnProbeComparisonOperatorReadAdapter({ operator: wrap(operator), describeChangeSet: cf.DescribeChangeSetCommand as unknown as Command, verifyIdentity: session.prepare });
      const writes: ArnProbeComparisonWorkflowWrites = { prepareOperator: session.prepare, executeGrant: (r, s) => mutations.executeGrant(r, s),
        createRevoke: (r, s) => mutations.createRevoke(r, s), executeRevoke: (r, s) => mutations.executeRevoke(r, s) };
      result = await runArnProbeComparisonWorkflow({ ...local, manifest: manifest!, approval: approval!, reads, writes, operatorReads, journal: journal!, signal });
    }
  }
  await destination.writeFile(`${JSON.stringify(result, null, 2)}\n`, "utf8"); await destination.sync();
  console.log(JSON.stringify({ mode, output, outcome: result.outcome, digest: "receiptSha256" in result ? result.receiptSha256 : result.reviewSha256,
    productionCompatibilityVerified: false, runtimeEnabled: false }, null, 2));
  if (result.outcome === "REVOKE_REQUIRED") process.exitCode = 2;
} catch (e) {
  const body = { stage: "B5-J5g-j20", mode, outcome: "WORKFLOW_ENTRY_BLOCKED", mutationPerformed: writeMode ? null : false,
    failures: [sanitizeArnProbeFailure(e, "ENTRY")], retryAuthorized: false, productionCompatibilityVerified: false, runtimeEnabled: false };
  await destination.writeFile(`${JSON.stringify({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) }, null, 2)}\n`, "utf8"); await destination.sync();
  console.error("J20 failed closed. Never replay Grant/reads or reset a slot. Inspect read-only; use separately approved exact revoke-only recovery when required. MFA/credentials/raw errors are not saved."); process.exitCode = 1;
} finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); destroyers.forEach((destroy) => destroy()); await destination.close(); }
