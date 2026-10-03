import { open, readFile, lstat, realpath, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { sanitizeArnProbeFailure } from "../../../lib/deployments/execution/arn-compatibility-probe-diagnostics.ts";
import { type ArnProbeLegacyArchive } from "../../../lib/deployments/execution/arn-compatibility-probe-renewal-review.ts";
import { reviewArnProbeFencedCreate, createArnProbeFencedGrant, recoverArnProbeFencedCreate, arnProbeSlotScope,
  assertArnProbeFencedCreateReview, type ArnProbeFencedCreateReview } from "../../../lib/deployments/execution/arn-compatibility-probe-fenced-create.ts";
import { createArnProbeFsFixedSlot } from "../../../lib/deployments/execution/arn-compatibility-probe-slot-store.ts";
import { assertArnProbeWorkflowManifest, type ProbeStep } from "../../../lib/deployments/execution/arn-compatibility-probe-workflow.ts";

const values = new Map<string, string>(), flags = new Set<string>(), args = process.argv.slice(2);
const common = ["--mode", "--output"], legacy = ["--legacy-manifest", "--legacy-run"];
const contracts: Record<string, { values: string[]; flags: string[] }> = {
  ReviewCreate: { values: [...common, ...legacy, "--draft"], flags: ["--acknowledge-read-only"] },
  CreateReviewed: { values: [...common, ...legacy, "--review", "--approved-review-sha", "--execution-phrase"], flags:
    ["--acknowledge-aws-write", "--acknowledge-named-iam-change-set-only", "--acknowledge-low-cost-not-zero", "--acknowledge-preserves-legacy-and-consumes-slot"] },
  RecoverCreate: { values: [...common, "--review"], flags: ["--acknowledge-read-only"] },
};
const names = new Set(Object.values(contracts).flatMap((v) => v.values)), flagNames = new Set(Object.values(contracts).flatMap((v) => v.flags));
for (let index = 0; index < args.length; index++) {
  const key = args[index]; if (values.has(key) || flags.has(key)) throw new Error("Duplicate fenced-create option.");
  if (flagNames.has(key)) flags.add(key);
  else { if (!names.has(key) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Unknown/incomplete fenced-create option."); values.set(key, args[++index]); }
}
const mode = values.get("--mode") ?? "ReviewCreate", contract = contracts[mode], output = values.get("--output");
if (!contract || !output || [...values.keys()].some((key) => !contract.values.includes(key)) || [...flags].some((key) => !contract.flags.includes(key)) ||
    contract.values.filter((key) => key !== "--mode").some((key) => !values.has(key)) || contract.flags.some((key) => !flags.has(key))) throw new Error("Invalid fenced-create mode/acknowledgements.");
async function json(file: string) { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.size > 600_000) throw new Error("Evidence must be an ordinary bounded JSON file."); return JSON.parse(await readFile(file, "utf8")); }
const repository = await realpath(fileURLToPath(new URL("../../../", import.meta.url)));
async function directory(relative: string) {
  let current = repository;
  for (const segment of relative.split("/")) {
    current = path.join(current, segment); const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Legacy directory is not ordinary.");
    current = await realpath(current); const inside = path.relative(repository, current);
    if (inside.startsWith("..") || path.isAbsolute(inside)) throw new Error("Legacy journal escapes repository.");
  } return current;
}
async function exactEntries(folder: string, expected: string[], directories = false) {
  const entries = await readdir(folder, { withFileTypes: true });
  if (canonicalJson(entries.map((v) => v.name).sort()) !== canonicalJson([...expected].sort()) || entries.some((v) => v.isSymbolicLink() || (directories ? !v.isDirectory() : !v.isFile()))) throw new Error("Unknown/missing legacy records need manual reconciliation.");
}
async function readArchive(): Promise<ArnProbeLegacyArchive> {
  const candidate = await json(values.get("--legacy-manifest")!), manifest = candidate.manifest ?? candidate; await assertArnProbeWorkflowManifest(manifest);
  const createDirectory = await directory(".aws-sandbox/j5gj10-arn-probe"); await exactEntries(createDirectory, ["grant-create-intent.json"]);
  const workflowRoot = await directory(".aws-sandbox/j5gj11-arn-probe"); await exactEntries(workflowRoot, [manifest.operationSha256], true);
  const workflowDirectory = await directory(`.aws-sandbox/j5gj11-arn-probe/${manifest.operationSha256}`);
  const steps: ProbeStep[] = ["run", "grant-execute", "probe-delete", "revoke-create", "revoke-execute"];
  await exactEntries(workflowDirectory, steps.map((step) => `${step}-intent.json`));
  const journal = {} as ArnProbeLegacyArchive["journal"];
  for (const step of steps) (journal as Record<string, unknown>)[step] = await json(path.join(workflowDirectory, `${step}-intent.json`));
  return { manifest, runReceipt: await json(values.get("--legacy-run")!), createIntent: await json(path.join(createDirectory, "grant-create-intent.json")), journal };
}
const review: ArnProbeFencedCreateReview | undefined = mode === "ReviewCreate" ? undefined : await json(values.get("--review")!);
if (review) await assertArnProbeFencedCreateReview(review);
const draft = review?.draft ?? await json(values.get("--draft")!);
const destination = await open(output, "wx"), clients: Array<{ destroy(): void }> = [];
const cancelled = new AbortController(), stop = () => cancelled.abort(); process.on("SIGINT", stop); process.on("SIGTERM", stop);
try {
  for (const [key, value] of Object.entries(process.env)) {
    if (value && (/^AWS_ENDPOINT_URL(?:_|$)/.test(key) || ["AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_SECURITY_TOKEN", "AWS_ROLE_ARN", "AWS_ROLE_SESSION_NAME", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_CONTAINER_CREDENTIALS_FULL_URI", "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_AUTHORIZATION_TOKEN", "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE"].includes(key))) throw new Error("Fenced entry refuses ambient credentials/config/endpoint overrides.");
  }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("Fenced entry refuses disabled TLS verification.");
  const { createSharedCellAuthorCompensationSourceCredentialProvider, createAwsSdkSharedCellAuthorCompensationManagementRuntimeFromModules } = await import("../../../lib/deployments/execution/aws-sdk-shared-cell-author-compensation-management.ts");
  const { AwsSdkArnProbeFixtureReadAdapter } = await import("../../../lib/deployments/execution/aws-sdk-arn-compatibility-probe-fixture.ts");
  const { AwsSdkArnProbeGrantReadAdapter, AwsSdkArnProbeGrantCreateAdapter } = await import("../../../lib/deployments/execution/aws-sdk-arn-compatibility-probe-grant.ts");
  const { AwsSdkArnProbeWorkflowReadAdapter } = await import("../../../lib/deployments/execution/aws-sdk-arn-compatibility-probe-workflow.ts");
  const [sts, cloudFormation, iam, dynamoDb, login, config] = await Promise.all([import("@aws-sdk/client-sts"), import("@aws-sdk/client-cloudformation"), import("@aws-sdk/client-iam"), import("@aws-sdk/client-dynamodb"), import("@aws-sdk/credential-provider-login"), import("@smithy/core/config")]);
  const management = createAwsSdkSharedCellAuthorCompensationManagementRuntimeFromModules({ sts, cloudFormation, iam, dynamoDb, login, config }).reads;
  const source = createSharedCellAuthorCompensationSourceCredentialProvider({ login, config });
  const credentials = async () => { const value = await source();
    if (typeof value.accessKeyId !== "string" || typeof value.secretAccessKey !== "string" || typeof value.sessionToken !== "string") throw new Error("Source login credential shape is invalid.");
    return { accessKeyId: value.accessKeyId, secretAccessKey: value.secretAccessKey, sessionToken: value.sessionToken, expiration: value.expiration as Date };
  };
  const client = new cloudFormation.CloudFormationClient({ region: "ca-central-1", credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true }); clients.push(client);
  type Command = new (input: Record<string, unknown>) => unknown;
  const wrapped = { send: (command: unknown, input: { abortSignal: AbortSignal }) => client.send(command as never, input) as unknown as Promise<Record<string, unknown>> };
  const commands = { describeStacks: cloudFormation.DescribeStacksCommand as unknown as Command, listStackResources: cloudFormation.ListStackResourcesCommand as unknown as Command, getTemplate: cloudFormation.GetTemplateCommand as unknown as Command, describeChangeSet: cloudFormation.DescribeChangeSetCommand as unknown as Command, listChangeSets: cloudFormation.ListChangeSetsCommand as unknown as Command };
  const fixture = new AwsSdkArnProbeFixtureReadAdapter({ client: wrapped, management, commands }), grant = new AwsSdkArnProbeGrantReadAdapter(fixture, wrapped, commands);
  const reads = new AwsSdkArnProbeWorkflowReadAdapter({ client: wrapped, management, fixture, grant, commands });
  const signal = AbortSignal.any([cancelled.signal, AbortSignal.timeout(90_000)]);
  let result: unknown;
  if (mode === "ReviewCreate") {
    const reviewed = await reviewArnProbeFencedCreate({ draft, readArchive, reads, signal });
    const slot = await createArnProbeFsFixedSlot(repository, await arnProbeSlotScope(reviewed));
    if (await slot.readClaim()) throw new Error("Fixed slot already consumed; review cannot authorize recreation.");
    result = reviewed;
  } else {
    const slot = await createArnProbeFsFixedSlot(repository, await arnProbeSlotScope(review!));
    if (mode === "RecoverCreate") result = await recoverArnProbeFencedCreate({ review: review!, slot, reads: grant, signal });
    else {
      const create = new AwsSdkArnProbeGrantCreateAdapter(draft.proposal.nextGrantPlan, wrapped, cloudFormation.CreateChangeSetCommand as unknown as Command);
      result = await createArnProbeFencedGrant({ review: review!, readArchive, reads, signal, slot, approvedReviewSha256: values.get("--approved-review-sha")!, executionPhrase: values.get("--execution-phrase")!,
        acknowledgeAwsWrite: flags.has("--acknowledge-aws-write"), acknowledgeNamedIamChangeSetOnly: flags.has("--acknowledge-named-iam-change-set-only"), acknowledgeLowCostNotZero: flags.has("--acknowledge-low-cost-not-zero"),
        acknowledgePreservesLegacyAndConsumesSlot: flags.has("--acknowledge-preserves-legacy-and-consumes-slot"), create: (request, delegated) => create.create(request, delegated) });
    }
  }
  await destination.writeFile(`${JSON.stringify(result, null, 2)}\n`, "utf8"); await destination.sync();
  const body = result as Record<string, unknown>;
  console.log(JSON.stringify({ stage: "B5-J5g-j14", mode, output, outcome: body.outcome, reviewSha256: body.reviewSha256, receiptSha256: body.receiptSha256, expiresAt: body.expiresAt, mutationPerformed: body.mutationPerformed, grantInstalled: false, productionCompatibilityVerified: false }, null, 2));
} catch (error) {
  const body = { stage: "B5-J5g-j14", mode, outcome: "FENCED_ENTRY_BLOCKED", failures: [sanitizeArnProbeFailure(error, "ENTRY")], mutationPerformed: mode === "CreateReviewed" ? null : false,
    retryAuthorized: false, grantExecutionAuthorized: false, probeDeletionAuthorized: false, productionCompatibilityVerified: false };
  await destination.writeFile(`${JSON.stringify({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) }, null, 2)}\n`, "utf8"); await destination.sync();
  console.error("Fenced entry failed closed. Preserve all records; only read-only reconciliation is permitted without new exact authorization."); process.exitCode = 1;
} finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); clients.forEach((client) => client.destroy()); await destination.close(); }
