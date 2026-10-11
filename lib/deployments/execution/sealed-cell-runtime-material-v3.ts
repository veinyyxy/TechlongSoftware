import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { fromEnv } from "@aws-sdk/credential-provider-env";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { READONLY_RUNTIME_IAM_TARGETS_V1 as targets } from "./readonly-runtime-iam-v1.ts";
import { validateSealedCertificateV3 } from "./sealed-cell-cleanup-authority-v3.ts";
import { REGISTERED_SEALED_CERTIFICATE_SHA256_V3 as pin } from "./sealed-cell-cleanup-lambda-context-v3.ts";

type SecretResponse = { ARN?: string; VersionId?: string; VersionStages?: string[]; SecretString?: string; SecretBinary?: unknown };
export interface SealedRuntimeMaterialPortsV3 {
  identity(): Promise<{ Account?: string; Arn?: string }>;
  secret(index: 0 | 1): Promise<SecretResponse>;
}
function fail(): never { throw new Error("SEALED_RUNTIME_MATERIAL_REJECTED"); }
function exact(v: unknown, keys: string[]) { return v !== null && typeof v === "object" && !Array.isArray(v) && canonicalJson(Object.keys(v).sort()) === canonicalJson([...keys].sort()); }
function url(value: unknown, username: string) {
  if (typeof value !== "string" || value.length > 4096) fail(); const u = new URL(value);
  if (!["postgres:", "postgresql:"].includes(u.protocol) || !/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(u.hostname) || u.hash || decodeURIComponent(u.username) !== username || !u.password ||
    !/^\/[A-Za-z0-9_-]+$/.test(u.pathname) || (u.port && u.port !== "5432") || !["require", "verify-full"].includes(u.searchParams.get("sslmode") ?? "") ||
    [...u.searchParams.keys()].some(k => !["sslmode", "channel_binding"].includes(k))) fail(); return { value, target: `${u.hostname}:5432${u.pathname}` };
}
function payload(index: 0 | 1, response: SecretResponse) {
  const t = targets[index]; if (response.ARN !== t.secretArn || response.VersionId !== t.secretVersionId || canonicalJson(response.VersionStages) !== canonicalJson(["AWSCURRENT"]) ||
    response.SecretBinary !== undefined || typeof response.SecretString !== "string" || response.SecretString.length > 16384) fail();
  const p = JSON.parse(response.SecretString); if (!exact(p, index === 0 ? ["schemaVersion", "protocol", "databaseUrl", "certificateSha256", "expectedRegisteredCertificate"] : ["databaseUrl"])) fail(); return p;
}
export async function readFixedSealedRuntimeMaterialV3(kind: "ttl" | "drain", signal: AbortSignal, ports: SealedRuntimeMaterialPortsV3) {
  try {
    if (!["ttl", "drain"].includes(kind)) fail(); signal.throwIfAborted(); const identity = await ports.identity(), role = kind === "ttl" ? targets[0].role : targets[1].role;
    if (identity.Account !== "402010193138" || !new RegExp(`^arn:aws:sts::402010193138:assumed-role/${role}/[A-Za-z0-9+=,.@_-]{2,64}$`).test(identity.Arn ?? "")) fail();
    const reader = payload(0, await ports.secret(0)), expected = validateSealedCertificateV3(reader.expectedRegisteredCertificate);
    if (reader.schemaVersion !== 3 || reader.protocol !== "sealed-cell-cleanup-control-v3" || reader.certificateSha256 !== pin || await sha256Hex(expected) !== pin) fail();
    const readonlyUrl = url(reader.databaseUrl, "techlong_cell_cleanup_reader"); let writerDatabaseUrl: string | undefined;
    if (kind === "drain") { const writer = payload(1, await ports.secret(1)), writeUrl = url(writer.databaseUrl, "techlong_cell_drain"); if (writeUrl.target !== readonlyUrl.target) fail(); writerDatabaseUrl = writeUrl.value; }
    signal.throwIfAborted(); return Object.freeze({ readerDatabaseUrl: readonlyUrl.value, ...(writerDatabaseUrl ? { writerDatabaseUrl } : {}), expectedRegisteredCertificate: expected, certificateSha256: pin });
  } catch { return fail(); }
}
/** Fixed exact ARNs, initial UUIDs and AWSCURRENT; no environment/credential/target fallback. */
export async function loadFixedSealedRuntimeMaterialV3(kind: "ttl" | "drain", signal: AbortSignal) {
  if (!["ttl", "drain"].includes(kind)) fail(); const config = { region: "ca-central-1", ignoreConfiguredEndpointUrls: true, maxAttempts: 1, credentials: fromEnv() };
  const sts = new STSClient(config), sm = new SecretsManagerClient(config);
  try { return await readFixedSealedRuntimeMaterialV3(kind, signal, { identity: () => sts.send(new GetCallerIdentityCommand({}), { abortSignal: signal }),
    secret: index => sm.send(new GetSecretValueCommand({ SecretId: targets[index].secretArn, VersionId: targets[index].secretVersionId, VersionStage: "AWSCURRENT" }), { abortSignal: signal }) });
  } finally { sts.destroy(); sm.destroy(); }
}
