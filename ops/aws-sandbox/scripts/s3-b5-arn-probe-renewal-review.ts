import { randomUUID } from "node:crypto";
import { open, readFile, stat, lstat, realpath, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { sanitizeArnProbeFailure } from "../../../lib/deployments/execution/arn-compatibility-probe-diagnostics.ts";
import { reviewArnProbeRenewal, type ArnProbeLegacyArchive } from "../../../lib/deployments/execution/arn-compatibility-probe-renewal-review.ts";
import { assertArnProbeWorkflowManifest, type ArnProbeWorkflowManifest, type ProbeStep } from "../../../lib/deployments/execution/arn-compatibility-probe-workflow.ts";

const options = new Map<string, string>(), args = process.argv.slice(2); let acknowledged = false;
for (let index = 0; index < args.length; index++) {
  const key = args[index];
  if (key === "--acknowledge-read-only" && !acknowledged) acknowledged = true;
  else {
    if (!["--legacy-manifest", "--legacy-run", "--output"].includes(key) || options.has(key) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Unknown/duplicate renewal option. This entry has no write mode.");
    options.set(key, args[++index]);
  }
}
if (!acknowledged || options.size !== 3) throw new Error("Explicit read-only acknowledgement and all evidence/output paths are required.");
async function json(file: string) {
  const info = await stat(file); if (!info.isFile() || info.size > 600_000) throw new Error("Renewal evidence is not a bounded JSON file.");
  return JSON.parse(await readFile(file, "utf8"));
}
const candidate = await json(options.get("--legacy-manifest")!), manifest: ArnProbeWorkflowManifest = candidate.manifest ?? candidate;
await assertArnProbeWorkflowManifest(manifest);
const repository = await realpath(fileURLToPath(new URL("../../../", import.meta.url)));
async function directory(relative: string) {
  let current = repository;
  for (const segment of relative.split("/")) {
    current = path.join(current, segment);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Legacy journal directory is not an ordinary repository directory.");
    current = await realpath(current); const inside = path.relative(repository, current);
    if (inside.startsWith("..") || path.isAbsolute(inside)) throw new Error("Legacy journal path escapes repository.");
  }
  return current;
}
async function exactEntries(folder: string, names: string[], folders = false) {
  const entries = await readdir(folder, { withFileTypes: true });
  if (canonicalJson(entries.map((value) => value.name).sort()) !== canonicalJson([...names].sort()) ||
      entries.some((value) => value.isSymbolicLink() || (folders ? !value.isDirectory() : !value.isFile()))) throw new Error("Unknown/missing legacy records require manual reconciliation.");
}
const steps: ProbeStep[] = ["run", "grant-execute", "probe-delete", "revoke-create", "revoke-execute"];
async function readArchive(): Promise<ArnProbeLegacyArchive> {
  const createDirectory = await directory(".aws-sandbox/j5gj10-arn-probe");
  await exactEntries(createDirectory, ["grant-create-intent.json"]);
  const workflowRoot = await directory(".aws-sandbox/j5gj11-arn-probe");
  await exactEntries(workflowRoot, [manifest.operationSha256], true);
  const workflowDirectory = await directory(`.aws-sandbox/j5gj11-arn-probe/${manifest.operationSha256}`);
  await exactEntries(workflowDirectory, steps.map((step) => `${step}-intent.json`));
  try { await lstat(path.join(repository, ".aws-sandbox", "j5gj13-arn-probe")); throw new Error("An existing renewal registry needs manual reconciliation; this entry only proposes first adoption."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const current = await json(options.get("--legacy-manifest")!), journal = {} as Record<ProbeStep, Readonly<Record<string, unknown>>>;
  for (const step of steps) journal[step] = await json(path.join(workflowDirectory, `${step}-intent.json`));
  return { manifest: current.manifest ?? current, runReceipt: await json(options.get("--legacy-run")!),
    createIntent: await json(path.join(createDirectory, "grant-create-intent.json")), journal };
}
const destination = await open(options.get("--output")!, "wx"), clients: Array<{ destroy(): void }> = [];
const cancelled = new AbortController(), stop = () => cancelled.abort(); process.on("SIGINT", stop); process.on("SIGTERM", stop);
try {
  for (const [key, value] of Object.entries(process.env)) {
    if (value && (/^AWS_ENDPOINT_URL(?:_|$)/.test(key) || ["AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_SECURITY_TOKEN", "AWS_ROLE_ARN", "AWS_ROLE_SESSION_NAME", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_CONTAINER_CREDENTIALS_FULL_URI", "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_AUTHORIZATION_TOKEN", "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE"].includes(key))) throw new Error("Renewal refuses ambient credentials/config/endpoint overrides.");
  }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("Renewal refuses disabled TLS verification.");
  const { createSharedCellAuthorCompensationSourceCredentialProvider, createAwsSdkSharedCellAuthorCompensationManagementRuntimeFromModules } = await import("../../../lib/deployments/execution/aws-sdk-shared-cell-author-compensation-management.ts");
  const { AwsSdkArnProbeFixtureReadAdapter } = await import("../../../lib/deployments/execution/aws-sdk-arn-compatibility-probe-fixture.ts");
  const { AwsSdkArnProbeGrantReadAdapter } = await import("../../../lib/deployments/execution/aws-sdk-arn-compatibility-probe-grant.ts");
  const { AwsSdkArnProbeWorkflowReadAdapter } = await import("../../../lib/deployments/execution/aws-sdk-arn-compatibility-probe-workflow.ts");
  const [sts, cloudFormation, iam, dynamoDb, login, config] = await Promise.all([
    import("@aws-sdk/client-sts"), import("@aws-sdk/client-cloudformation"), import("@aws-sdk/client-iam"), import("@aws-sdk/client-dynamodb"),
    import("@aws-sdk/credential-provider-login"), import("@smithy/core/config"),
  ]);
  const management = createAwsSdkSharedCellAuthorCompensationManagementRuntimeFromModules({ sts, cloudFormation, iam, dynamoDb, login, config }).reads;
  const source = createSharedCellAuthorCompensationSourceCredentialProvider({ login, config });
  const credentials = async () => {
    const value = await source();
    if (typeof value.accessKeyId !== "string" || typeof value.secretAccessKey !== "string" || typeof value.sessionToken !== "string") throw new Error("Fixed Source login credential shape is invalid.");
    return { accessKeyId: value.accessKeyId, secretAccessKey: value.secretAccessKey, sessionToken: value.sessionToken, expiration: value.expiration as Date };
  };
  const client = new cloudFormation.CloudFormationClient({ region: "ca-central-1", credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true }); clients.push(client);
  type Command = new (input: Record<string, unknown>) => unknown;
  const wrapped = { send: (command: unknown, input: { abortSignal: AbortSignal }) => client.send(command as never, input) as unknown as Promise<Record<string, unknown>> };
  const commands = { describeStacks: cloudFormation.DescribeStacksCommand as unknown as Command, listStackResources: cloudFormation.ListStackResourcesCommand as unknown as Command,
    getTemplate: cloudFormation.GetTemplateCommand as unknown as Command, describeChangeSet: cloudFormation.DescribeChangeSetCommand as unknown as Command,
    listChangeSets: cloudFormation.ListChangeSetsCommand as unknown as Command };
  const fixture = new AwsSdkArnProbeFixtureReadAdapter({ client: wrapped, management, commands });
  const grant = new AwsSdkArnProbeGrantReadAdapter(fixture, wrapped, commands);
  const reads = new AwsSdkArnProbeWorkflowReadAdapter({ client: wrapped, management, fixture, grant, commands });
  const result = await reviewArnProbeRenewal({ readArchive, reads, nonce: randomUUID().replaceAll("-", ""), signal: AbortSignal.any([cancelled.signal, AbortSignal.timeout(90_000)]) });
  await destination.writeFile(`${JSON.stringify(result, null, 2)}\n`, "utf8"); await destination.sync();
  console.log(JSON.stringify({ stage: result.stage, output: options.get("--output"), reviewSha256: result.reviewSha256, expiresAt: result.expiresAt,
    targetFenceKey: result.proposal.targetFenceKey, mutationPerformed: false, grantCreationAuthorized: false, productionCompatibilityVerified: false }, null, 2));
} catch (error) {
  const body = { stage: "B5-J5g-j13", outcome: "RENEWAL_REVIEW_BLOCKED", failures: [sanitizeArnProbeFailure(error, "ENTRY")], mutationPerformed: false,
    grantCreationAuthorized: false, grantExecutionAuthorized: false, probeDeletionAuthorized: false, retryAuthorized: false, productionCompatibilityVerified: false };
  await destination.writeFile(`${JSON.stringify({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) }, null, 2)}\n`, "utf8"); await destination.sync();
  console.error("Renewal review failed closed. Preserve all journals; no grant/window/fence has been installed."); process.exitCode = 1;
} finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); clients.forEach((client) => client.destroy()); await destination.close(); }
