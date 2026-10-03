import { open, readFile, stat, realpath, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { sanitizeArnProbeFailure } from "../../../lib/deployments/execution/arn-compatibility-probe-diagnostics.ts";
import { assertArnProbeGrantPlan, type ArnProbeGrantPlan } from "../../../lib/deployments/execution/arn-compatibility-probe-grant.ts";
import { assertArnProbeWorkflowManifest, reviewArnProbeWorkflow, inspectArnProbeWorkflow, runArnProbeWorkflow, recoverArnProbeWorkflowRevoke,
  type ArnProbeWorkflowManifest, type ArnProbeWorkflowApproval, type ArnProbeWorkflowJournal, ARN_PROBE_MFA } from "../../../lib/deployments/execution/arn-compatibility-probe-workflow.ts";

const values = new Map<string, string>(), flags = new Set<string>(), args = process.argv.slice(2);
const flagNames = ["--acknowledge-read-only", "--acknowledge-aws-write", "--acknowledge-low-cost-not-zero"];
const valueNames = ["--mode", "--output", "--plan", "--manifest", "--approved-manifest-sha", "--approved-grant-sha", "--approved-probe-sha", "--approved-revoke-sha", "--execution-phrase"];
for (let index = 0; index < args.length; index++) {
  const key = args[index];
  if (values.has(key) || flags.has(key)) throw new Error("Duplicate probe workflow option.");
  if (flagNames.includes(key)) flags.add(key);
  else {
    if (!valueNames.includes(key) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Unknown or incomplete probe workflow option.");
    values.set(key, args[++index]);
  }
}
const mode = values.get("--mode") ?? "Review", output = values.get("--output");
const commonWrite = ["--mode", "--output", "--manifest", "--approved-manifest-sha", "--approved-revoke-sha", "--execution-phrase"];
const contracts: Record<string, { values: string[]; flags: string[] }> = {
  Review: { values: ["--mode", "--output", "--plan"], flags: ["--acknowledge-read-only"] },
  Inspect: { values: ["--mode", "--output", "--plan"], flags: ["--acknowledge-read-only"] },
  RunReviewed: { values: [...commonWrite, "--approved-grant-sha", "--approved-probe-sha"], flags: ["--acknowledge-aws-write", "--acknowledge-low-cost-not-zero"] },
  RecoverRevoke: { values: commonWrite, flags: ["--acknowledge-aws-write", "--acknowledge-low-cost-not-zero"] },
};
const contract = contracts[mode];
if (!contract || !output || [...values.keys()].some((key) => !contract.values.includes(key)) || [...flags].some((key) => !contract.flags.includes(key)) ||
    contract.values.filter((key) => key !== "--mode").some((key) => !values.has(key)) || contract.flags.some((key) => !flags.has(key))) throw new Error("Invalid workflow mode or acknowledgements.");
async function json(file: string) {
  if ((await stat(file)).size > 600_000) throw new Error("Probe workflow evidence exceeds its size bound.");
  return JSON.parse(await readFile(file, "utf8"));
}
let manifest: ArnProbeWorkflowManifest | undefined;
const writeMode = mode === "RunReviewed" || mode === "RecoverRevoke";
if (writeMode) {
  const evidence = await json(values.get("--manifest")!);
  manifest = evidence.manifest ?? evidence;
  if (!manifest) throw new Error("No executable manifest: prepare Grant first.");
  await assertArnProbeWorkflowManifest(manifest);
}
const plan: ArnProbeGrantPlan = manifest ? manifest.input.plan : await json(values.get("--plan")!);
await assertArnProbeGrantPlan(plan);
const destination = await open(output, "wx"), clients: Array<{ destroy(): void }> = [];
const cancel = new AbortController();
const stop = () => cancel.abort(); process.on("SIGINT", stop); process.on("SIGTERM", stop);
try {
  for (const [key, value] of Object.entries(process.env)) {
    if (value && (/^AWS_ENDPOINT_URL(?:_|$)/.test(key) || ["AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_SECURITY_TOKEN", "AWS_ROLE_ARN", "AWS_ROLE_SESSION_NAME", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_CONTAINER_CREDENTIALS_FULL_URI", "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_AUTHORIZATION_TOKEN", "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE"].includes(key))) throw new Error("Probe workflow refuses ambient credential/config/endpoint overrides.");
  }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("Probe workflow refuses disabled TLS verification.");
  const { createSharedCellAuthorCompensationSourceCredentialProvider, createAwsSdkSharedCellAuthorCompensationManagementRuntimeFromModules } = await import("../../../lib/deployments/execution/aws-sdk-shared-cell-author-compensation-management.ts");
  const { AwsSdkArnProbeFixtureReadAdapter } = await import("../../../lib/deployments/execution/aws-sdk-arn-compatibility-probe-fixture.ts");
  const { AwsSdkArnProbeGrantReadAdapter } = await import("../../../lib/deployments/execution/aws-sdk-arn-compatibility-probe-grant.ts");
  const { AwsSdkArnProbeWorkflowReadAdapter, AwsSdkArnProbeOperatorReadAdapter, AwsSdkArnProbeWorkflowWriteAdapter, createArnProbeOperatorSession } = await import("../../../lib/deployments/execution/aws-sdk-arn-compatibility-probe-workflow.ts");
  const [sts, cloudFormation, iam, dynamoDb, login, config] = await Promise.all([
    import("@aws-sdk/client-sts"), import("@aws-sdk/client-cloudformation"), import("@aws-sdk/client-iam"),
    import("@aws-sdk/client-dynamodb"), import("@aws-sdk/credential-provider-login"), import("@smithy/core/config"),
  ]);
  const management = createAwsSdkSharedCellAuthorCompensationManagementRuntimeFromModules({ sts, cloudFormation, iam, dynamoDb, login, config }).reads;
  const source = createSharedCellAuthorCompensationSourceCredentialProvider({ login, config });
  const credentials = async () => {
    const value = await source();
    if (typeof value.accessKeyId !== "string" || typeof value.secretAccessKey !== "string" || typeof value.sessionToken !== "string") throw new Error("Source login credential shape is invalid.");
    return { accessKeyId: value.accessKeyId, secretAccessKey: value.secretAccessKey, sessionToken: value.sessionToken, expiration: value.expiration as Date };
  };
  const sdkConfig = { region: plan.input.fixturePlan.region, credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
  type Command = new (input: Record<string, unknown>) => unknown;
  type Client = { send(command: never, options: { abortSignal: AbortSignal }): Promise<unknown>; destroy(): void };
  const wrap = (client: Client) => ({ send: (command: unknown, options: { abortSignal: AbortSignal }) => client.send(command as never, options) as Promise<Record<string, unknown>> });
  const readClient = new cloudFormation.CloudFormationClient(sdkConfig); clients.push(readClient);
  const commands = { describeStacks: cloudFormation.DescribeStacksCommand as unknown as Command, listStackResources: cloudFormation.ListStackResourcesCommand as unknown as Command,
    getTemplate: cloudFormation.GetTemplateCommand as unknown as Command, describeChangeSet: cloudFormation.DescribeChangeSetCommand as unknown as Command, listChangeSets: cloudFormation.ListChangeSetsCommand as unknown as Command };
  const fixture = new AwsSdkArnProbeFixtureReadAdapter({ client: wrap(readClient), management, commands });
  const grant = new AwsSdkArnProbeGrantReadAdapter(fixture, wrap(readClient), commands);
  const reads = new AwsSdkArnProbeWorkflowReadAdapter({ client: wrap(readClient), management, fixture, grant, commands });
  const signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(180_000)]);
  let result: unknown;
  if (mode === "Review") result = await reviewArnProbeWorkflow(plan, reads, signal);
  else if (mode === "Inspect") result = await inspectArnProbeWorkflow(plan, reads, signal);
  else {
    const approval: ArnProbeWorkflowApproval = { approvedManifestSha256: values.get("--approved-manifest-sha")!,
      approvedGrantExecuteSha256: values.get("--approved-grant-sha") ?? "", approvedProbeDeleteSha256: values.get("--approved-probe-sha") ?? "",
      approvedRevokeSha256: values.get("--approved-revoke-sha")!, acknowledgeAwsWrite: true, acknowledgeLowCostNotZero: true, executionPhrase: values.get("--execution-phrase")! };
    const sourceWrite = new cloudFormation.CloudFormationClient(sdkConfig); clients.push(sourceWrite);
    let operatorClient: InstanceType<typeof cloudFormation.CloudFormationClient> | undefined;
    let operatorSession: ReturnType<typeof createArnProbeOperatorSession> | undefined;
    if (mode === "RunReviewed") {
      const sourceSts = new sts.STSClient(sdkConfig); clients.push(sourceSts);
      operatorSession = createArnProbeOperatorSession({ sts: wrap(sourceSts), assumeRole: sts.AssumeRoleCommand as unknown as Command, getCallerIdentity: sts.GetCallerIdentityCommand as unknown as Command,
        mfaCode: async () => {
          const prompt = createInterface({ input: process.stdin, output: process.stdout });
          try { return (await prompt.question(`Enter MFA code for ${ARN_PROBE_MFA}: `, { signal })).trim(); } finally { prompt.close(); }
        },
        createOperatorSts: (operatorCredentials) => { const client = new sts.STSClient({ ...sdkConfig, credentials: operatorCredentials }); clients.push(client); return wrap(client); },
      });
      operatorClient = new cloudFormation.CloudFormationClient({ ...sdkConfig, credentials: operatorSession.credentials }); clients.push(operatorClient);
    }
    const writes = new AwsSdkArnProbeWorkflowWriteAdapter({ manifest: manifest!, source: wrap(sourceWrite), operator: operatorClient && wrap(operatorClient),
      commands: { createChangeSet: cloudFormation.CreateChangeSetCommand as unknown as Command, executeChangeSet: cloudFormation.ExecuteChangeSetCommand as unknown as Command,
        deleteChangeSet: mode === "RunReviewed" ? cloudFormation.DeleteChangeSetCommand as unknown as Command : undefined }, prepareOperator: operatorSession?.prepare });
    const repository = await realpath(fileURLToPath(new URL("../../../", import.meta.url)));
    const directory = path.join(repository, ".aws-sandbox", "j5gj11-arn-probe", manifest!.operationSha256);
    const directoryInsideRepo = async () => {
      // Validate each resolved ancestor before creating anything below it.
      let current = repository;
      for (const segment of [".aws-sandbox", "j5gj11-arn-probe", manifest!.operationSha256]) {
        current = path.join(current, segment); await mkdir(current, { recursive: true }); current = await realpath(current);
        const relative = path.relative(repository, current);
        if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Probe workflow journal escapes the repository.");
      }
      if (current !== await realpath(directory)) throw new Error("Journal path changed.");
      return current;
    };
    const journal: ArnProbeWorkflowJournal = {
      load: async (step) => {
        const resolved = await directoryInsideRepo(), file = path.join(resolved, `${step}-intent.json`);
        try { return await json(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
      },
      reserve: async (step, intent) => {
        const resolved = await directoryInsideRepo(), handle = await open(path.join(resolved, `${step}-intent.json`), "wx");
        try { await handle.writeFile(`${JSON.stringify(intent, null, 2)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
      },
    };
    const operatorReads = mode === "RunReviewed" ? new AwsSdkArnProbeOperatorReadAdapter({ operator: wrap(operatorClient!), commands,
      verifyIdentity: operatorSession!.prepare }) : undefined;
    result = mode === "RunReviewed" ? await runArnProbeWorkflow({ manifest: manifest!, approval, reads, writes, operatorReads: operatorReads!, journal, signal }) :
      await recoverArnProbeWorkflowRevoke({ manifest: manifest!, approval, reads, writes: { createRevoke: (request, delegated) => writes.createRevoke(request, delegated), executeRevoke: (request, delegated) => writes.executeRevoke(request, delegated) }, journal });
  }
  await destination.writeFile(`${JSON.stringify(result, null, 2)}\n`, "utf8"); await destination.sync();
  const receipt = result as Record<string, unknown>;
  console.log(JSON.stringify({ mode, output, outcome: receipt.outcome, reviewSha256: receipt.reviewSha256, receiptSha256: receipt.receiptSha256,
    executionReady: receipt.executionReady, isolatedProbeCompatibilityObserved: receipt.isolatedProbeCompatibilityObserved, productionCompatibilityVerified: false }, null, 2));
  if (receipt.outcome === "REVOKE_REQUIRED") process.exitCode = 2;
} catch (error) {
  const body = { stage: "B5-J5g-j11", mode, outcome: "CONTROLLED_ENTRY_FAILED", planSha256: plan.planSha256,
    manifestSha256: manifest?.manifestSha256 ?? null, mutationPerformed: writeMode ? null : false, diagnosticsVersion: 1,
    failures: [sanitizeArnProbeFailure(error, "ENTRY")], retryAuthorized: false, productionCompatibilityVerified: false };
  await destination.writeFile(`${JSON.stringify({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) }, null, 2)}\n`, "utf8"); await destination.sync();
  console.error("J5g-j11 failed closed. Do not replay Grant/Probe. Inspect read-only; if not Locked, use separately approved exact revoke-only recovery. Only allowlisted failure metadata is saved; raw errors/MFA/credentials are not logged.");
  process.exitCode = 1;
} finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); clients.forEach((client) => client.destroy()); await destination.close(); }
