import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, TransactGetCommand } from "@aws-sdk/lib-dynamodb";
import { CloudFormationClient, ListStacksCommand, DescribeStacksCommand, GetTemplateCommand, ListStackResourcesCommand } from "@aws-sdk/client-cloudformation";
import { fromEnv } from "@aws-sdk/credential-provider-env";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { READONLY_RUNTIME_IAM_TARGETS_V1 } from "./readonly-runtime-iam-v1.ts";

const account = "402010193138", region = "ca-central-1";
const table = "techlong-sandbox-tenant-external-epoch-authority", cell = "techlong-sandbox-cell-sandbox-1";
const certificateSha = "dc093614188a8f0a086b4fc6a7e251c43312495a60db2efffc654cf3d48b066f";
const digest = /^[a-f0-9]{64}$/;
type Index = 0 | 1;
type SafeStep = { label: string; passed: boolean; observation?: string; errorCode?: string };
export interface ReadonlyProbePortsV1 {
  identity(): Promise<{ Account?: string; Arn?: string }>;
  secret(): Promise<{ ARN?: string; VersionId?: string; VersionStages?: string[]; SecretString?: string; SecretBinary?: unknown }>;
  read(label: string, nonce: string): Promise<string>;
  log(value: string): void;
}
function fail(code: string): never { throw new Error(code); }
function exact(value: unknown, keys: string[]) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}
function safeError(error: unknown) {
  const name = error && typeof error === "object" ? (error as { name?: string }).name : undefined;
  return ["AccessDeniedException", "AccessDenied", "ValidationException", "ValidationError", "ResourceNotFoundException", "TimeoutError", "AbortError", "ThrottlingException"].includes(name ?? "")
    ? name! : "READONLY_PROBE_READ_NOT_VERIFIED";
}
async function validateSecret(index: Index, value: Awaited<ReturnType<ReadonlyProbePortsV1["secret"]>>) {
  const target = READONLY_RUNTIME_IAM_TARGETS_V1[index];
  if (value.ARN !== target.secretArn || value.VersionId !== target.secretVersionId ||
    canonicalJson(value.VersionStages) !== canonicalJson(["AWSCURRENT"]) || value.SecretBinary !== undefined ||
    typeof value.SecretString !== "string" || value.SecretString.length > 16384) fail("READONLY_PROBE_SECRET_REJECTED");
  const payload = JSON.parse(value.SecretString);
  if (!exact(payload, index === 0 ? ["schemaVersion", "protocol", "databaseUrl", "certificateSha256", "expectedRegisteredCertificate"] : ["databaseUrl"]) ||
    typeof payload.databaseUrl !== "string" || payload.databaseUrl.length > 4096) fail("READONLY_PROBE_SECRET_REJECTED");
  const url = new URL(payload.databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname.endsWith(".neon.tech") ||
    decodeURIComponent(url.username) !== (index === 0 ? "techlong_cell_cleanup_reader" : "techlong_cell_drain") || !url.password ||
    (url.port && url.port !== "5432") || !["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")) fail("READONLY_PROBE_SECRET_REJECTED");
  if (index === 0 && (payload.schemaVersion !== 3 || payload.protocol !== "sealed-cell-cleanup-control-v3" ||
    payload.certificateSha256 !== certificateSha || await sha256Hex(payload.expectedRegisteredCertificate) !== certificateSha)) fail("READONLY_PROBE_SECRET_REJECTED");
  // Credential material is validated only in memory: no DB connection, hash, return value or log contains it.
}
export function readonlyProbeReadLabelsV1(index: Index) {
  return index === 0 ? ["atomic-authority", "intent-journal", "receipt-journal", "stack-list-first-page", "cell-describe", "cell-template", "cell-resources"] : ["provision-authority"];
}
export async function runReadonlyLambdaProbeV1(index: Index, event: unknown, context: unknown, ports: ReadonlyProbePortsV1) {
  if (index !== 0 && index !== 1) fail("READONLY_PROBE_EVENT_INVALID");
  const value = event as { schemaVersion?: number; action?: string; nonce?: string };
  if (!exact(event, ["schemaVersion", "action", "nonce"]) || value.schemaVersion !== 1 || value.action !== "verify_readonly_runtime_v1" || !digest.test(value.nonce ?? "")) fail("READONLY_PROBE_EVENT_INVALID");
  const target = READONLY_RUNTIME_IAM_TARGETS_V1[index], arn = `arn:aws:lambda:${region}:${account}:function:${target.functionName}`;
  const ctx = context as { functionName?: string; invokedFunctionArn?: string; awsRequestId?: string };
  if (!ctx || ctx.functionName !== target.functionName || ctx.invokedFunctionArn !== arn ||
    !/^[a-f0-9-]{36}$/.test(ctx.awsRequestId ?? "")) fail("READONLY_PROBE_CONTEXT_INVALID");
  const steps: SafeStep[] = [];
  try {
    const caller = await ports.identity();
    if (caller.Account !== account || !new RegExp(`^arn:aws:sts::${account}:assumed-role/${target.role}/[A-Za-z0-9+=,.@_-]{2,64}$`).test(caller.Arn ?? "")) fail("READONLY_PROBE_IDENTITY_REJECTED");
    steps.push({ label: "exact-runtime-identity", passed: true });
  } catch (error) {
    return { schemaVersion: 1, functionArn: arn, nonce: value.nonce, requestId: ctx.awsRequestId,
      outcome: "READONLY_PROBE_IDENTITY_NOT_VERIFIED", steps: [{ label: "exact-runtime-identity", passed: false, errorCode: safeError(error) }], runtimeEnabled: false, databaseConnected: false, mutationPerformed: false };
  }
  try { await validateSecret(index, await ports.secret()); steps.push({ label: "exact-secret-awscurrent", passed: true }); }
  catch (error) { steps.push({ label: "exact-secret-awscurrent", passed: false, errorCode: safeError(error) }); }
  for (const label of readonlyProbeReadLabelsV1(index)) {
    try {
      const observation = await ports.read(label, value.nonce!);
      if (!["ABSENT", "PRESENT", "TWO_KEYS_ABSENT", "RECORDS_PRESENT", "FIRST_PAGE_READ"].includes(observation)) fail("READONLY_PROBE_OBSERVATION_INVALID");
      steps.push({ label, passed: true, observation });
    } catch (error) { steps.push({ label, passed: false, errorCode: safeError(error) }); }
  }
  const result = { schemaVersion: 1, functionArn: arn, nonce: value.nonce, requestId: ctx.awsRequestId,
    outcome: steps.every(x => x.passed) ? "READONLY_PROBE_READS_VERIFIED" : "READONLY_PROBE_READS_NOT_VERIFIED",
    steps, runtimeEnabled: false, databaseConnected: false, mutationPerformed: false };
  // A single sanitized marker; independent Source log readback, not this return value, proves delivery.
  ports.log(JSON.stringify({ protocol: "readonly-runtime-log-marker-v1", functionArn: arn, nonce: value.nonce, requestId: ctx.awsRequestId, responseSha256: await sha256Hex(result) }));
  return result;
}
export function createReadonlyLambdaProbeHandlerV1(index: Index) {
  return async (event: unknown, context: unknown) => {
    // Validate malformed input before creating clients/looking up credentials (bundle smoke test).
    if (!exact(event, ["schemaVersion", "action", "nonce"]) || (event as { action?: string }).action !== "verify_readonly_runtime_v1") fail("READONLY_PROBE_EVENT_INVALID");
    const ctx = context as { getRemainingTimeInMillis?: () => number };
    if (typeof ctx?.getRemainingTimeInMillis !== "function") fail("READONLY_PROBE_CONTEXT_INVALID");
    const remaining = ctx.getRemainingTimeInMillis();
    if (!Number.isSafeInteger(remaining) || remaining < 5000 || remaining > 60000) fail("READONLY_PROBE_DEADLINE_INVALID");
    const signal = AbortSignal.timeout(remaining - 1000);
    const config = { region, ignoreConfiguredEndpointUrls: true, maxAttempts: 1, credentials: fromEnv() };
    const sts = new STSClient(config), secrets = new SecretsManagerClient(config), ddb = DynamoDBDocumentClient.from(new DynamoDBClient(config)), cf = new CloudFormationClient(config);
    const target = READONLY_RUNTIME_IAM_TARGETS_V1[index];
    try {
      return await runReadonlyLambdaProbeV1(index, event, context, {
        identity: () => sts.send(new GetCallerIdentityCommand({}), { abortSignal: signal }),
        secret: () => secrets.send(new GetSecretValueCommand({ SecretId: target.secretArn, VersionId: target.secretVersionId, VersionStage: "AWSCURRENT" }), { abortSignal: signal }),
        log: value => console.log(value),
        read: async (label, nonce) => {
          if (label === "atomic-authority") {
            const r = await ddb.send(new TransactGetCommand({ TransactItems: ["cell:cell-sandbox-1", "sealed-cell-ttl-v3:cell:cell-sandbox-1"].map(key => ({ Get: { TableName: table, Key: { authority_key: key } } })) }), { abortSignal: signal });
            if (r.Responses?.length !== 2) fail("READONLY_PROBE_AUTHORITY_REJECTED");
            return r.Responses.every(x => !x.Item) ? "TWO_KEYS_ABSENT" : "RECORDS_PRESENT";
          }
          if (["intent-journal", "receipt-journal", "provision-authority"].includes(label)) {
            const key = label === "provision-authority" ? "cell:cell-sandbox-1" : `sealed-cell-ttl-v3:${label === "intent-journal" ? "intent" : "receipt"}:${nonce}`;
            const r = await ddb.send(new GetCommand({ TableName: table, Key: { authority_key: key }, ConsistentRead: true }), { abortSignal: signal });
            if (r.Item && r.Item.authority_key !== key) fail("READONLY_PROBE_AUTHORITY_REJECTED");
            return r.Item ? "PRESENT" : "ABSENT";
          }
          if (label === "stack-list-first-page") { await cf.send(new ListStacksCommand({}), { abortSignal: signal }); return "FIRST_PAGE_READ"; }
          try {
            if (label === "cell-describe") await cf.send(new DescribeStacksCommand({ StackName: cell }), { abortSignal: signal });
            else if (label === "cell-template") await cf.send(new GetTemplateCommand({ StackName: cell, TemplateStage: "Original" }), { abortSignal: signal });
            else if (label === "cell-resources") await cf.send(new ListStackResourcesCommand({ StackName: cell }), { abortSignal: signal });
            else fail("READONLY_PROBE_READ_LABEL_INVALID");
            return "PRESENT";
          } catch (error) {
            const e = error as { name?: string; message?: string };
            if (e.name === "ValidationError" && e.message === `Stack with id ${cell} does not exist`) return "ABSENT";
            throw error;
          }
        },
      });
    } finally { sts.destroy(); secrets.destroy(); ddb.destroy(); cf.destroy(); }
  };
}
