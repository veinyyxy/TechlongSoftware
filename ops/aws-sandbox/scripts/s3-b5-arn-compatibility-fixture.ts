import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { compileArnProbeFixturePlan, assertArnProbeFixturePlan, reviewArnProbeFixtureCreate, createReviewedArnProbeFixture,
  recoverArnProbeFixture, type ArnProbeFixturePlan, type ArnProbeFixtureCreateReview } from "../../../lib/deployments/execution/arn-compatibility-probe-fixture.ts";

const args = process.argv.slice(2);
const values = new Map<string, string>();
const flags = new Set<string>();
const flagNames = ["--acknowledge-read-only", "--acknowledge-aws-write", "--acknowledge-unexecuted-only", "--acknowledge-low-cost-not-free"];
for (let index = 0; index < args.length; index++) {
  const name = args[index];
  if (values.has(name) || flags.has(name)) throw new Error("Duplicate fixture option.");
  if (flagNames.includes(name)) flags.add(name);
  else {
    if (!["--mode", "--output", "--plan", "--review", "--approved-review-sha", "--execution-phrase"].includes(name) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Unknown or incomplete fixture option.");
    values.set(name, args[++index]);
  }
}
const mode = values.get("--mode") ?? "LocalPlan";
const output = values.get("--output");
const contracts: Record<string, { values: string[]; flags: string[] }> = {
  LocalPlan: { values: ["--mode", "--output"], flags: [] },
  ReviewCreate: { values: ["--mode", "--output", "--plan"], flags: ["--acknowledge-read-only"] },
  RecoverState: { values: ["--mode", "--output", "--plan"], flags: ["--acknowledge-read-only"] },
  CreateReviewed: { values: ["--mode", "--output", "--review", "--approved-review-sha", "--execution-phrase"],
    flags: ["--acknowledge-aws-write", "--acknowledge-unexecuted-only", "--acknowledge-low-cost-not-free"] },
};
const contract = contracts[mode];
if (!contract || !output || [...values.keys()].some((key) => !contract.values.includes(key)) ||
    [...flags].some((flag) => !contract.flags.includes(flag)) || contract.flags.some((flag) => !flags.has(flag)) ||
    contract.values.filter((key) => key !== "--mode").some((key) => !values.has(key))) throw new Error("Invalid fixture mode/options. LocalPlan is the default; every online mode requires its own acknowledgements.");
async function json(file: string) {
  if ((await stat(file)).size > 200_000) throw new Error("Fixture JSON exceeds the bounded size.");
  return JSON.parse(await readFile(file, "utf8"));
}
let plan: ArnProbeFixturePlan;
let review: ArnProbeFixtureCreateReview | undefined;
if (mode === "LocalPlan") {
  const now = Date.now();
  plan = await compileArnProbeFixturePlan({ nonce: randomUUID().replaceAll("-", ""), reviewedAt: new Date(now).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString() });
} else if (mode === "CreateReviewed") {
  review = await json(values.get("--review")!); plan = review!.plan;
} else { plan = await json(values.get("--plan")!); }
await assertArnProbeFixturePlan(plan);
// Reserve receipt output before touching AWS; existing evidence is never overwritten.
const destination = await open(output, "wx");
let closeClients = () => {};
try {
  let result: unknown = plan;
  if (mode !== "LocalPlan") {
    for (const [key, value] of Object.entries(process.env)) {
      if (value && (/^AWS_ENDPOINT_URL(?:_|$)/.test(key) || ["AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_SECURITY_TOKEN", "AWS_ROLE_ARN", "AWS_ROLE_SESSION_NAME", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_CONTAINER_CREDENTIALS_FULL_URI", "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_AUTHORIZATION_TOKEN", "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE"].includes(key))) throw new Error("Fixture entry refuses ambient credential/config/endpoint overrides.");
    }
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("TLS verification cannot be disabled.");
    const { createSharedCellAuthorCompensationSourceCredentialProvider, createAwsSdkSharedCellAuthorCompensationManagementRuntimeFromModules } = await import("../../../lib/deployments/execution/aws-sdk-shared-cell-author-compensation-management.ts");
    const { AwsSdkArnProbeFixtureReadAdapter, AwsSdkArnProbeFixtureCreateAdapter } = await import("../../../lib/deployments/execution/aws-sdk-arn-compatibility-probe-fixture.ts");
    const [sts, cloudFormation, iam, dynamoDb, login, config] = await Promise.all([
      import("@aws-sdk/client-sts"), import("@aws-sdk/client-cloudformation"), import("@aws-sdk/client-iam"),
      import("@aws-sdk/client-dynamodb"), import("@aws-sdk/credential-provider-login"), import("@smithy/core/config"),
    ]);
    const modules = { sts, cloudFormation, iam, dynamoDb, login, config };
    const management = createAwsSdkSharedCellAuthorCompensationManagementRuntimeFromModules(modules).reads;
    const source = createSharedCellAuthorCompensationSourceCredentialProvider({ login, config });
    const credentials = async () => {
      const value = await source();
      if (typeof value.accessKeyId !== "string" || typeof value.secretAccessKey !== "string" || typeof value.sessionToken !== "string") throw new Error("Source login credential shape is invalid.");
      return { accessKeyId: value.accessKeyId, secretAccessKey: value.secretAccessKey, sessionToken: value.sessionToken, expiration: value.expiration as Date };
    };
    const clientConfig = { region: plan.region, credentials, ignoreConfiguredEndpointUrls: true, maxAttempts: 1 };
    const readClient = new cloudFormation.CloudFormationClient(clientConfig);
    const writeClient = mode === "CreateReviewed" ? new cloudFormation.CloudFormationClient(clientConfig) : undefined;
    closeClients = () => { readClient.destroy(); writeClient?.destroy(); };
    type Command = new (input: Record<string, unknown>) => unknown;
    const wrap = (client: InstanceType<typeof cloudFormation.CloudFormationClient>) => ({ send: (command: unknown, options: { abortSignal: AbortSignal }) => client.send(command as never, options) as unknown as Promise<Record<string, unknown>> });
    const reads = new AwsSdkArnProbeFixtureReadAdapter({ client: wrap(readClient), management, commands: {
      describeStacks: cloudFormation.DescribeStacksCommand as unknown as Command,
      listStackResources: cloudFormation.ListStackResourcesCommand as unknown as Command,
      getTemplate: cloudFormation.GetTemplateCommand as unknown as Command,
      describeChangeSet: cloudFormation.DescribeChangeSetCommand as unknown as Command,
    } });
    const signal = AbortSignal.timeout(120_000);
    if (mode === "ReviewCreate") result = await reviewArnProbeFixtureCreate(plan, reads, signal);
    else if (mode === "RecoverState") result = await recoverArnProbeFixture(plan, reads, signal);
    else {
      const creates = new AwsSdkArnProbeFixtureCreateAdapter(plan, { client: wrap(writeClient!), createChangeSet: cloudFormation.CreateChangeSetCommand as unknown as Command });
      result = await createReviewedArnProbeFixture({ review: review!, reads, creates, signal,
        approval: { approvedReviewSha256: values.get("--approved-review-sha")!, executionPhrase: values.get("--execution-phrase")!,
          acknowledgeAwsWrite: true, acknowledgeUnexecutedOnly: true, acknowledgeLowCostNotFree: true },
        journal: { reserve: async (intent) => {
          // One fixed local fence for this dedicated Stack, across all review windows.
          // Never delete/reset it automatically, even after a MISSING observation.
          const repository = await realpath(fileURLToPath(new URL("../../../", import.meta.url)));
          const journalBase = path.join(repository, ".aws-sandbox");
          await mkdir(journalBase, { recursive: true });
          const resolvedBase = await realpath(journalBase), baseRelative = path.relative(repository, resolvedBase);
          if (baseRelative.startsWith("..") || path.isAbsolute(baseRelative)) throw new Error("Probe journal base must stay in the repository workspace.");
          const journalPath = path.join(resolvedBase, "j5gj9-arn-probe");
          await mkdir(journalPath, { recursive: true });
          const resolved = await realpath(journalPath), relative = path.relative(repository, resolved);
          if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Probe journal must stay in the repository workspace.");
          const handle = await open(path.join(resolved, "create-intent.json"), "wx");
          try { await handle.writeFile(`${JSON.stringify(intent, null, 2)}\n`, "utf8"); await handle.sync(); }
          finally { await handle.close(); }
        } },
      });
    }
  }
  await destination.writeFile(`${JSON.stringify(result, null, 2)}\n`, "utf8"); await destination.sync();
  const item = result as Record<string, unknown>;
  console.log(JSON.stringify({ mode, output, planSha256: plan.planSha256, reviewSha256: item.reviewSha256,
    receiptSha256: item.receiptSha256, outcome: item.outcome, fixtureState: (item.fixture as Record<string, unknown> | undefined)?.state,
    providerContextCompatibilityVerified: false, childExecuted: false, grantInstalled: false }, null, 2));
  if (item.outcome === "CREATE_UNCERTAIN") process.exitCode = 2;
} catch {
  const body = { stage: "B5-J5g-j9", mode, outcome: "CONTROLLED_ENTRY_FAILED", planSha256: plan.planSha256,
    mutationPerformed: mode === "CreateReviewed" ? null : false, retryAuthorized: false, providerContextCompatibilityVerified: false };
  await destination.writeFile(`${JSON.stringify({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) }, null, 2)}\n`, "utf8"); await destination.sync();
  console.error("J5g-j9 failed closed. Refresh Source/check the exact preflight; a CreateReviewed failure permits only read-only Recover, not blind replay. No Execute/Delete/IAM operation is available here.");
  process.exitCode = 1;
} finally { closeClients(); await destination.close(); }
