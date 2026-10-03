import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { sanitizeArnProbeFailure } from "../../../lib/deployments/execution/arn-compatibility-probe-diagnostics.ts";
import { compileArnProbeReadComparisonPlan, reviewArnProbeReadComparison } from "../../../lib/deployments/execution/arn-compatibility-probe-read-comparison.ts";
import { loadArnProbeReadComparisonEvidence, readArnProbeReadComparisonJson,
  type ArnProbeReadComparisonEvidenceFiles } from "../../../lib/deployments/execution/arn-compatibility-probe-read-comparison-evidence.ts";

const options = new Map<string, string>(), args = process.argv.slice(2); let acknowledged = false;
for (let index = 0; index < args.length; index++) {
  const key = args[index];
  if (key === "--acknowledge-read-only" && !acknowledged) acknowledged = true;
  else {
    if (!["--mode", "--evidence", "--output"].includes(key) || options.has(key) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Unknown or duplicate comparison option; no AWS write mode exists.");
    options.set(key, args[++index]);
  }
}
const mode = options.get("--mode") ?? "Prepare", output = options.get("--output");
if (!["Prepare", "Review"].includes(mode) || !acknowledged || !output || !options.get("--evidence") || !path.isAbsolute(output)) throw new Error("Comparison requires Prepare/Review, absolute paths and read-only acknowledgement.");
const repository = await realpath(fileURLToPath(new URL("../../../", import.meta.url)));
const parent = await realpath(path.dirname(output)), relativeOutput = path.relative(repository, path.join(parent, path.basename(output)));
if (relativeOutput.split(path.sep)[0] === ".aws-sandbox") throw new Error("Comparison artifacts must never be written into AWS ledgers.");
const destination = await open(output, "wx"), clients: Array<{ destroy(): void }> = [];
const cancelled = new AbortController(), stop = () => cancelled.abort(); process.on("SIGINT", stop); process.on("SIGTERM", stop);
try {
  const files = await readArnProbeReadComparisonJson(options.get("--evidence")!) as ArnProbeReadComparisonEvidenceFiles;
  const readEvidence = () => loadArnProbeReadComparisonEvidence(repository, files);
  const sourceEvidence = await readEvidence();
  let result;
  if (mode === "Prepare") {
    const start = Date.now(), plan = await compileArnProbeReadComparisonPlan({ priorPlan: sourceEvidence.priorPlan,
      reviewedAt: new Date(start).toISOString(), expiresAt: new Date(start + 1_800_000).toISOString() });
    const last = await readEvidence(); probeStable(last, sourceEvidence);
    const body = { schemaVersion: 1, stage: "B5-J5g-j16", mode: "LOCAL_UNDEPLOYED_PREPARATION", predecessor: last.predecessor, plan,
      observedAt: new Date().toISOString(), sourceLiveReadPerformed: false, mutationPerformed: false, grantCreationAuthorized: false,
      grantExecutionAuthorized: false, operatorReadAuthorized: false, probeDeletionAuthorized: false, runtimeEnabled: false };
    result = { ...body, receiptSha256: await sha256Hex(canonicalJson(body)) };
  } else {
    for (const [key, value] of Object.entries(process.env)) {
      if (value && (/^AWS_ENDPOINT_URL(?:_|$)/.test(key) || ["AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_SECURITY_TOKEN", "AWS_ROLE_ARN", "AWS_ROLE_SESSION_NAME", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_CONTAINER_CREDENTIALS_FULL_URI", "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_AUTHORIZATION_TOKEN", "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE"].includes(key))) throw new Error("Comparison refuses ambient credential/config/endpoint overrides.");
    }
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("Comparison requires TLS validation.");
    const { createSharedCellAuthorCompensationSourceCredentialProvider, AwsSdkSharedCellAuthorCompensationManagementReadAdapter } = await import("../../../lib/deployments/execution/aws-sdk-shared-cell-author-compensation-management.ts");
    const { AwsSdkArnProbeFixtureReadAdapter } = await import("../../../lib/deployments/execution/aws-sdk-arn-compatibility-probe-fixture.ts");
    const { AwsSdkArnProbeGrantReadAdapter } = await import("../../../lib/deployments/execution/aws-sdk-arn-compatibility-probe-grant.ts");
    const { AwsSdkArnProbeWorkflowReadAdapter } = await import("../../../lib/deployments/execution/aws-sdk-arn-compatibility-probe-workflow.ts");
    const [sts, cloudFormation, iam, dynamoDb, login, config] = await Promise.all([
      import("@aws-sdk/client-sts"), import("@aws-sdk/client-cloudformation"), import("@aws-sdk/client-iam"), import("@aws-sdk/client-dynamodb"),
      import("@aws-sdk/credential-provider-login"), import("@smithy/core/config"),
    ]);
    const source = createSharedCellAuthorCompensationSourceCredentialProvider({ login, config });
    const credentials = async () => {
      const value = await source();
      if (typeof value.accessKeyId !== "string" || typeof value.secretAccessKey !== "string" || typeof value.sessionToken !== "string") throw new Error("Comparison Source credential shape is invalid.");
      return { accessKeyId: value.accessKeyId, secretAccessKey: value.secretAccessKey, sessionToken: value.sessionToken, expiration: value.expiration as Date };
    };
    const sdkConfig = { region: "ca-central-1", credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
    const sourceSts = new sts.STSClient(sdkConfig), sourceCf = new cloudFormation.CloudFormationClient(sdkConfig),
      sourceIam = new iam.IAMClient(sdkConfig), sourceDynamo = new dynamoDb.DynamoDBClient(sdkConfig);
    clients.push(sourceSts, sourceCf, sourceIam, sourceDynamo);
    type Command = new (input: Record<string, unknown>) => unknown;
    type Client = { send(command: never, options: { abortSignal: AbortSignal }): Promise<unknown> };
    const wrap = (client: Client) => ({ send: (command: unknown, options: { abortSignal: AbortSignal }) => client.send(command as never, options) as Promise<Record<string, unknown>> });
    const cfClient = wrap(sourceCf);
    const commands = { describeStacks: cloudFormation.DescribeStacksCommand as unknown as Command, listStackResources: cloudFormation.ListStackResourcesCommand as unknown as Command,
      getTemplate: cloudFormation.GetTemplateCommand as unknown as Command, describeChangeSet: cloudFormation.DescribeChangeSetCommand as unknown as Command,
      listChangeSets: cloudFormation.ListChangeSetsCommand as unknown as Command };
    const management = new AwsSdkSharedCellAuthorCompensationManagementReadAdapter({
      clients: { sts: wrap(sourceSts), cloudFormation: cfClient, iam: wrap(sourceIam), dynamoDb: wrap(sourceDynamo) },
      commands: { ...commands, getCallerIdentity: sts.GetCallerIdentityCommand as unknown as Command,
        getPolicy: iam.GetPolicyCommand as unknown as Command, getPolicyVersion: iam.GetPolicyVersionCommand as unknown as Command,
        listPolicyVersions: iam.ListPolicyVersionsCommand as unknown as Command, listEntitiesForPolicy: iam.ListEntitiesForPolicyCommand as unknown as Command,
        getRole: iam.GetRoleCommand as unknown as Command, listAttachedRolePolicies: iam.ListAttachedRolePoliciesCommand as unknown as Command,
        listRolePolicies: iam.ListRolePoliciesCommand as unknown as Command, getItem: dynamoDb.GetItemCommand as unknown as Command },
    });
    const fixture = new AwsSdkArnProbeFixtureReadAdapter({ client: cfClient, management, commands });
    const grant = new AwsSdkArnProbeGrantReadAdapter(fixture, cfClient, commands);
    const reads = new AwsSdkArnProbeWorkflowReadAdapter({ client: cfClient, management, fixture, grant, commands });
    result = await reviewArnProbeReadComparison({ priorPlan: sourceEvidence.priorPlan,
      readPredecessor: async () => { const value = await readEvidence(); probeStable(value, sourceEvidence); return value.predecessor; },
      reads, signal: AbortSignal.any([cancelled.signal, AbortSignal.timeout(90_000)]) });
  }
  await destination.writeFile(`${JSON.stringify(result, null, 2)}\n`, "utf8"); await destination.sync();
  console.log(JSON.stringify({ mode, output, digest: "reviewSha256" in result ? result.reviewSha256 : result.receiptSha256,
    candidatePlanSha256: result.plan.planSha256, candidateVariants: result.plan.candidates.map((value) => value.variant), mutationPerformed: false, operatorReadAuthorized: false }, null, 2));
} catch (error) {
  const body = { stage: "B5-J5g-j16", outcome: "READ_COMPARISON_BLOCKED", failures: [sanitizeArnProbeFailure(error, "ENTRY")],
    mutationPerformed: false, grantCreationAuthorized: false, grantExecutionAuthorized: false, operatorReadAuthorized: false,
    probeDeletionAuthorized: false, retryAuthorized: false, runtimeEnabled: false };
  await destination.writeFile(`${JSON.stringify({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) }, null, 2)}\n`, "utf8"); await destination.sync();
  console.error("Read-only comparison preparation/review failed closed. No permissions, fence or Operator session installed."); process.exitCode = 1;
} finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); clients.forEach((client) => client.destroy()); await destination.close(); }
function probeStable(actual: unknown, expected: unknown) {
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error("Comparison predecessor changed during review.");
}
