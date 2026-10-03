import { randomUUID } from "node:crypto";
import { open, readFile, stat, realpath, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { compileArnProbeGrantPlan, assertArnProbeGrantPlan, reviewArnProbeGrantCreate, createReviewedArnProbeGrant, recoverArnProbeGrantCreate,
  type ArnProbeGrantPlan, type ArnProbeGrantCreateReview } from "../../../lib/deployments/execution/arn-compatibility-probe-grant.ts";

const values = new Map<string, string>(), flags = new Set<string>(), args = process.argv.slice(2);
const flagNames = ["--acknowledge-read-only", "--acknowledge-aws-write", "--acknowledge-named-iam-change-set-only"];
for (let index = 0; index < args.length; index++) {
  const key = args[index];
  if (values.has(key) || flags.has(key)) throw new Error("Duplicate probe grant option.");
  if (flagNames.includes(key)) flags.add(key);
  else {
    if (!["--mode", "--output", "--fixture-plan", "--fixture-create", "--plan", "--review", "--approved-review-sha", "--execution-phrase"].includes(key) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Unknown or incomplete probe grant option.");
    values.set(key, args[++index]);
  }
}
const mode = values.get("--mode") ?? "LocalPlan", output = values.get("--output");
const contracts: Record<string, { values: string[]; flags: string[] }> = {
  LocalPlan: { values: ["--mode", "--output", "--fixture-plan", "--fixture-create"], flags: [] },
  ReviewGrantCreate: { values: ["--mode", "--output", "--plan"], flags: ["--acknowledge-read-only"] },
  RecoverGrantCreate: { values: ["--mode", "--output", "--plan"], flags: ["--acknowledge-read-only"] },
  CreateGrantReviewed: { values: ["--mode", "--output", "--review", "--approved-review-sha", "--execution-phrase"], flags: ["--acknowledge-aws-write", "--acknowledge-named-iam-change-set-only"] },
};
const contract = contracts[mode];
if (!contract || !output || [...values.keys()].some((key) => !contract.values.includes(key)) || [...flags].some((key) => !contract.flags.includes(key)) ||
    contract.values.filter((key) => key !== "--mode").some((key) => !values.has(key)) || contract.flags.some((key) => !flags.has(key))) throw new Error("Invalid probe grant mode or acknowledgements. No Execute/Delete mode exists.");
async function json(file: string) {
  if ((await stat(file)).size > 200_000) throw new Error("Probe grant evidence exceeds its size bound.");
  return JSON.parse(await readFile(file, "utf8"));
}
let plan: ArnProbeGrantPlan, review: ArnProbeGrantCreateReview | undefined;
if (mode === "LocalPlan") {
  const fixturePlan = await json(values.get("--fixture-plan")!), receipt = await json(values.get("--fixture-create")!);
  const { receiptSha256, ...receiptBody } = receipt;
  if (receiptSha256 !== await sha256Hex(canonicalJson(receiptBody)) || receipt.outcome !== "CREATE_SUBMITTED" || receipt.mutationPerformed !== true ||
      receipt.stage !== "B5-J5g-j9" || receipt.childExecuted !== false || receipt.grantInstalled !== false || receipt.intent?.operationSha256 !== fixturePlan.operationSha256 || !receipt.target) throw new Error("Exact submitted unexecuted J9 fixture receipt is required.");
  const now = Date.now();
  plan = await compileArnProbeGrantPlan({ fixturePlan, fixtureStackId: receipt.target.stackId, fixtureChangeSetArn: receipt.target.changeSetArn,
    nonce: randomUUID().replaceAll("-", ""), reviewedAt: new Date(now).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString() });
} else if (mode === "CreateGrantReviewed") { review = await json(values.get("--review")!); plan = review!.plan; }
else plan = await json(values.get("--plan")!);
await assertArnProbeGrantPlan(plan);
const destination = await open(output, "wx");
let destroy = () => {};
try {
  let result: unknown = plan;
  if (mode !== "LocalPlan") {
    for (const [key, value] of Object.entries(process.env)) {
      if (value && (/^AWS_ENDPOINT_URL(?:_|$)/.test(key) || ["AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_SECURITY_TOKEN", "AWS_ROLE_ARN", "AWS_ROLE_SESSION_NAME", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_CONTAINER_CREDENTIALS_FULL_URI", "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_AUTHORIZATION_TOKEN", "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE"].includes(key))) throw new Error("Probe grant refuses ambient credential/config/endpoint overrides.");
    }
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("Probe grant refuses disabled TLS verification.");
    const { createSharedCellAuthorCompensationSourceCredentialProvider, createAwsSdkSharedCellAuthorCompensationManagementRuntimeFromModules } = await import("../../../lib/deployments/execution/aws-sdk-shared-cell-author-compensation-management.ts");
    const { AwsSdkArnProbeFixtureReadAdapter } = await import("../../../lib/deployments/execution/aws-sdk-arn-compatibility-probe-fixture.ts");
    const { AwsSdkArnProbeGrantReadAdapter, AwsSdkArnProbeGrantCreateAdapter } = await import("../../../lib/deployments/execution/aws-sdk-arn-compatibility-probe-grant.ts");
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
    const clientConfig = { region: plan.input.fixturePlan.region, credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
    const readClient = new cloudFormation.CloudFormationClient(clientConfig);
    const writeClient = mode === "CreateGrantReviewed" ? new cloudFormation.CloudFormationClient(clientConfig) : undefined;
    destroy = () => { readClient.destroy(); writeClient?.destroy(); };
    type Command = new (input: Record<string, unknown>) => unknown;
    const wrap = (client: InstanceType<typeof cloudFormation.CloudFormationClient>) => ({ send: (command: unknown, options: { abortSignal: AbortSignal }) => client.send(command as never, options) as unknown as Promise<Record<string, unknown>> });
    const fixture = new AwsSdkArnProbeFixtureReadAdapter({ client: wrap(readClient), management, commands: {
      describeStacks: cloudFormation.DescribeStacksCommand as unknown as Command, listStackResources: cloudFormation.ListStackResourcesCommand as unknown as Command,
      getTemplate: cloudFormation.GetTemplateCommand as unknown as Command, describeChangeSet: cloudFormation.DescribeChangeSetCommand as unknown as Command,
    } });
    const reads = new AwsSdkArnProbeGrantReadAdapter(fixture, wrap(readClient), {
      listChangeSets: cloudFormation.ListChangeSetsCommand as unknown as Command, describeChangeSet: cloudFormation.DescribeChangeSetCommand as unknown as Command, getTemplate: cloudFormation.GetTemplateCommand as unknown as Command,
    });
    const signal = AbortSignal.timeout(120_000);
    if (mode === "ReviewGrantCreate") result = await reviewArnProbeGrantCreate(plan, reads, signal);
    else if (mode === "RecoverGrantCreate") result = await recoverArnProbeGrantCreate(plan, reads, signal);
    else {
      const creates = new AwsSdkArnProbeGrantCreateAdapter(plan, wrap(writeClient!), cloudFormation.CreateChangeSetCommand as unknown as Command);
      result = await createReviewedArnProbeGrant({ review: review!, approvedReviewSha256: values.get("--approved-review-sha")!,
        acknowledgeAwsWrite: true, acknowledgeCreatesNamedIamChangeSetOnly: true, executionPhrase: values.get("--execution-phrase")!, reads,
        create: (request, delegated) => creates.create(request, delegated), signal,
        reserve: async (intent) => {
          const repository = await realpath(fileURLToPath(new URL("../../../", import.meta.url)));
          const base = path.join(repository, ".aws-sandbox"); await mkdir(base, { recursive: true });
          const baseResolved = await realpath(base), baseRelative = path.relative(repository, baseResolved);
          if (baseRelative.startsWith("..") || path.isAbsolute(baseRelative)) throw new Error("Probe grant journal base escapes the workspace.");
          const directory = path.join(baseResolved, "j5gj10-arn-probe"); await mkdir(directory, { recursive: true });
          const resolved = await realpath(directory), relative = path.relative(repository, resolved);
          if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Probe grant journal escapes the workspace.");
          const handle = await open(path.join(resolved, "grant-create-intent.json"), "wx");
          try { await handle.writeFile(`${JSON.stringify(intent, null, 2)}\n`, "utf8"); await handle.sync(); }
          finally { await handle.close(); }
        },
      });
    }
  }
  await destination.writeFile(`${JSON.stringify(result, null, 2)}\n`, "utf8"); await destination.sync();
  const item = result as Record<string, unknown>;
  console.log(JSON.stringify({ mode, output, planSha256: plan.planSha256, reviewSha256: item.reviewSha256, receiptSha256: item.receiptSha256,
    outcome: item.outcome, grantInstalled: false, childExecuted: false, probeDeleted: false, providerContextCompatibilityVerified: false }, null, 2));
  if (item.outcome === "CREATE_UNCERTAIN") process.exitCode = 2;
} catch {
  const body = { stage: "B5-J5g-j10", mode, outcome: "CONTROLLED_ENTRY_FAILED", planSha256: plan.planSha256,
    mutationPerformed: mode === "CreateGrantReviewed" ? null : false, retryAuthorized: false, providerContextCompatibilityVerified: false };
  await destination.writeFile(`${JSON.stringify({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) }, null, 2)}\n`, "utf8"); await destination.sync();
  console.error("J5g-j10 failed closed; refresh Source/check exact preflight. No Execute/Delete/IAM write mode exists. Any uncertain Create permits only read-only Recover.");
  process.exitCode = 1;
} finally { destroy(); await destination.close(); }
