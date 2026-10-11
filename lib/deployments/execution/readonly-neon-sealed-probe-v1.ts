import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { fromEnv } from "@aws-sdk/credential-provider-env";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { READONLY_RUNTIME_IAM_TARGETS_V1 } from "./readonly-runtime-iam-v1.ts";
import { type SealedPlanCertificateV1 } from "./neon-sealed-cell-ownership-source-v3.ts";

export const NEON_SEALED_PROBE_FUNCTION_ARN_V1 = "arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-ttl-executor-v3";
export const NEON_SEALED_PROBE_CERTIFICATE_SHA_V1 = "dc093614188a8f0a086b4fc6a7e251c43312495a60db2efffc654cf3d48b066f";
export const NEON_SEALED_PROBE_ACTION_V1 = "verify_neon_sealed_readonly_v1";
const digest = /^[a-f0-9]{64}$/;
export function exactNeonProbeObjectV1(value: unknown, keys: string[]) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}
function fail(code: string): never { throw new Error(code); }
export interface NeonSealedDatabaseProofV1 {
  tlsReadVerified: true; transactionSettingsVerified: true; limitedReaderVerified: true; sealedCertificateVerified: true;
  queryCount: 10; sourceGate: "ADMISSION_NOT_DRAINING" | "CERTIFIED_V3_SNAPSHOT";
  counts: { rawActiveTenants: number; rawNonterminalDeployments: number; capacityReservations: number; liveResources: number; cleanupSchedules: number };
}
export interface NeonSealedProbePortsV1 {
  identity(): Promise<{ Account?: string; Arn?: string }>;
  secret(): Promise<{ ARN?: string; VersionId?: string; VersionStages?: string[]; SecretString?: string; SecretBinary?: unknown }>;
  read(databaseUrl: string, expected: SealedPlanCertificateV1, signal: AbortSignal): Promise<NeonSealedDatabaseProofV1>;
  log(value: string): void;
}
export function validateNeonProbeEventV1(event: unknown): asserts event is { schemaVersion: 1; action: typeof NEON_SEALED_PROBE_ACTION_V1; nonce: string } {
  const e = event as { schemaVersion?: number; action?: string; nonce?: string };
  if (!exactNeonProbeObjectV1(event, ["schemaVersion", "action", "nonce"]) || e.schemaVersion !== 1 || e.action !== NEON_SEALED_PROBE_ACTION_V1 || !digest.test(e.nonce ?? "")) fail("NEON_PROBE_EVENT_INVALID");
}
async function validateSecret(value: Awaited<ReturnType<NeonSealedProbePortsV1["secret"]>>) {
  const target = READONLY_RUNTIME_IAM_TARGETS_V1[0];
  if (value.ARN !== target.secretArn || value.VersionId !== target.secretVersionId || canonicalJson(value.VersionStages) !== canonicalJson(["AWSCURRENT"]) ||
    value.SecretBinary !== undefined || typeof value.SecretString !== "string" || value.SecretString.length > 16384) fail("NEON_PROBE_SECRET_INVALID");
  const p = JSON.parse(value.SecretString);
  if (!exactNeonProbeObjectV1(p, ["schemaVersion", "protocol", "databaseUrl", "certificateSha256", "expectedRegisteredCertificate"]) || p.schemaVersion !== 3 ||
    p.protocol !== "sealed-cell-cleanup-control-v3" || p.certificateSha256 !== NEON_SEALED_PROBE_CERTIFICATE_SHA_V1 ||
    await sha256Hex(p.expectedRegisteredCertificate) !== NEON_SEALED_PROBE_CERTIFICATE_SHA_V1 || typeof p.databaseUrl !== "string" || p.databaseUrl.length > 4096) fail("NEON_PROBE_SECRET_INVALID");
  const u = new URL(p.databaseUrl);
  if (!["postgres:", "postgresql:"].includes(u.protocol) || !/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(u.hostname) || u.hash ||
    decodeURIComponent(u.username) !== "techlong_cell_cleanup_reader" || !u.password || !/^\/[A-Za-z0-9_-]+$/.test(u.pathname) ||
    (u.port && u.port !== "5432") || !["require", "verify-full"].includes(u.searchParams.get("sslmode") ?? "") ||
    [...u.searchParams.keys()].some(k => !["sslmode", "channel_binding"].includes(k))) fail("NEON_PROBE_SECRET_INVALID");
  return { databaseUrl: p.databaseUrl as string, expected: p.expectedRegisteredCertificate as SealedPlanCertificateV1 };
}
function safeError(error: unknown) {
  const e = error as { message?: string; name?: string };
  if (/^NEON_PROBE_[A-Z_]+$/.test(e?.message ?? "")) return e.message!;
  return ["AccessDeniedException", "AccessDenied", "TimeoutError", "AbortError", "ThrottlingException"].includes(e?.name ?? "") ? e.name! : "NEON_PROBE_READ_UNVERIFIED";
}
export function validateNeonDatabaseProofV1(value: unknown): NeonSealedDatabaseProofV1 {
  const p = value as NeonSealedDatabaseProofV1;
  if (!exactNeonProbeObjectV1(value, ["tlsReadVerified", "transactionSettingsVerified", "limitedReaderVerified", "sealedCertificateVerified", "queryCount", "sourceGate", "counts"]) ||
    p.tlsReadVerified !== true || p.transactionSettingsVerified !== true || p.limitedReaderVerified !== true || p.sealedCertificateVerified !== true || p.queryCount !== 10 ||
    !["ADMISSION_NOT_DRAINING", "CERTIFIED_V3_SNAPSHOT"].includes(p.sourceGate) || !exactNeonProbeObjectV1(p.counts, ["rawActiveTenants", "rawNonterminalDeployments", "capacityReservations", "liveResources", "cleanupSchedules"]) ||
    Object.values(p.counts).some(n => !Number.isSafeInteger(n) || n < 0 || n > 10000)) fail("NEON_PROBE_DATABASE_PROOF_INVALID");
  return structuredClone(p);
}
export async function runNeonSealedProbeV1(event: unknown, context: unknown, signal: AbortSignal, ports: NeonSealedProbePortsV1) {
  validateNeonProbeEventV1(event);
  const c = context as { functionName?: string; invokedFunctionArn?: string; awsRequestId?: string };
  if (c?.functionName !== READONLY_RUNTIME_IAM_TARGETS_V1[0].functionName || c.invokedFunctionArn !== NEON_SEALED_PROBE_FUNCTION_ARN_V1 || !/^[a-f0-9-]{36}$/.test(c.awsRequestId ?? "")) fail("NEON_PROBE_CONTEXT_INVALID");
  let stage = "identity", databaseReadAttempted = false, proof: NeonSealedDatabaseProofV1 | null = null, errorCode: string | null = null;
  try {
    signal.throwIfAborted(); const identity = await ports.identity();
    if (identity.Account !== "402010193138" || !/^arn:aws:sts::402010193138:assumed-role\/TechlongSandboxCellTtlExecutorRole\/[A-Za-z0-9+=,.@_-]{2,64}$/.test(identity.Arn ?? "")) fail("NEON_PROBE_IDENTITY_INVALID");
    stage = "secret"; signal.throwIfAborted(); const material = await validateSecret(await ports.secret());
    stage = "readonly-database"; signal.throwIfAborted(); databaseReadAttempted = true;
    proof = validateNeonDatabaseProofV1(await ports.read(material.databaseUrl, material.expected, signal)); stage = "verified";
  } catch (error) { errorCode = safeError(error); }
  const result = { schemaVersion: 1, protocol: "neon-sealed-readonly-probe-v1", functionArn: NEON_SEALED_PROBE_FUNCTION_ARN_V1, nonce: event.nonce, requestId: c.awsRequestId,
    outcome: proof ? "NEON_SEALED_READONLY_PREFLIGHT_VERIFIED" : "NEON_SEALED_READONLY_PREFLIGHT_NOT_VERIFIED", stage, errorCode, databaseReadAttempted, proof,
    runtimeEnabled: false, mutationPerformed: false, deletionAuthorized: false };
  ports.log(JSON.stringify({ protocol: "neon-sealed-readonly-log-v1", functionArn: result.functionArn, nonce: event.nonce, requestId: result.requestId, responseSha256: await sha256Hex(result) }));
  return result;
}
export function validateNeonProbeResponseV1(event: unknown, value: unknown) {
  validateNeonProbeEventV1(event); const r = value as Awaited<ReturnType<typeof runNeonSealedProbeV1>>;
  if (!exactNeonProbeObjectV1(value, ["schemaVersion", "protocol", "functionArn", "nonce", "requestId", "outcome", "stage", "errorCode", "databaseReadAttempted", "proof", "runtimeEnabled", "mutationPerformed", "deletionAuthorized"]) ||
    r.schemaVersion !== 1 || r.protocol !== "neon-sealed-readonly-probe-v1" || r.functionArn !== NEON_SEALED_PROBE_FUNCTION_ARN_V1 || r.nonce !== event.nonce ||
    !/^[a-f0-9-]{36}$/.test(r.requestId ?? "") || r.runtimeEnabled !== false || r.mutationPerformed !== false || r.deletionAuthorized !== false ||
    !["identity", "secret", "readonly-database", "verified"].includes(r.stage) || typeof r.databaseReadAttempted !== "boolean") fail("NEON_PROBE_RESPONSE_INVALID");
  if (r.outcome === "NEON_SEALED_READONLY_PREFLIGHT_VERIFIED") {
    if (r.stage !== "verified" || r.errorCode !== null || !r.databaseReadAttempted) fail("NEON_PROBE_RESPONSE_INVALID"); validateNeonDatabaseProofV1(r.proof);
  } else if (r.outcome !== "NEON_SEALED_READONLY_PREFLIGHT_NOT_VERIFIED" || r.stage === "verified" || r.proof !== null || typeof r.errorCode !== "string" ||
    !/^(NEON_PROBE_[A-Z_]+|AccessDeniedException|AccessDenied|TimeoutError|AbortError|ThrottlingException)$/.test(r.errorCode) ||
    r.databaseReadAttempted !== (r.stage === "readonly-database")) fail("NEON_PROBE_RESPONSE_INVALID");
  return structuredClone(r);
}
export async function neonSealedProbeHandlerV1(event: unknown, context: unknown) {
  validateNeonProbeEventV1(event); const c = context as { getRemainingTimeInMillis?: () => number };
  if (typeof c?.getRemainingTimeInMillis !== "function") fail("NEON_PROBE_CONTEXT_INVALID");
  const remaining = c.getRemainingTimeInMillis(); if (!Number.isSafeInteger(remaining) || remaining < 5000 || remaining > 60000) fail("NEON_PROBE_DEADLINE_INVALID");
  const signal = AbortSignal.timeout(remaining - 1000), config = { region: "ca-central-1", ignoreConfiguredEndpointUrls: true, maxAttempts: 1, credentials: fromEnv() };
  const sts = new STSClient(config), sm = new SecretsManagerClient(config), t = READONLY_RUNTIME_IAM_TARGETS_V1[0];
  try { return await runNeonSealedProbeV1(event, context, signal, { identity: () => sts.send(new GetCallerIdentityCommand({}), { abortSignal: signal }),
    secret: () => sm.send(new GetSecretValueCommand({ SecretId: t.secretArn, VersionId: t.secretVersionId, VersionStage: "AWSCURRENT" }), { abortSignal: signal }),
    read: async (url, expected, abort) => (await import("./readonly-neon-sealed-transport-v1.ts")).readNeonSealedProbeDatabaseV1(url, expected, abort), log: v => console.log(v) });
  } finally { sts.destroy(); sm.destroy(); }
}
