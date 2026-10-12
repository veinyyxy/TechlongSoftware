import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { cellV3Exact, cellV3Fail } from "../cloudformation/shared-cell-stack-v3.ts";
import { assertInstalledCellParentV4, type InstalledCellParentV4 } from "./aws-sdk-cell-birth-parent-v4.ts";
import { READONLY_RUNTIME_IAM_TARGETS_V1 as targets } from "./readonly-runtime-iam-v1.ts";
import { REGISTERED_SEALED_CERTIFICATE_SHA256_V3 as certificateSha } from "./sealed-cell-cleanup-lambda-context-v3.ts";
import { validateSealedCertificateV3 } from "./sealed-cell-cleanup-authority-v3.ts";
import { createNeonCellParentDatabaseV4 } from "./neon-cell-parent-control-v4.ts";

interface SecretResponse { ARN?: string; VersionId?: string; VersionStages?: string[]; SecretString?: string; SecretBinary?: unknown }
export async function readCellParentMaterialV4(parent: InstalledCellParentV4, secret: (index: 0 | 1) => Promise<SecretResponse>, signal: AbortSignal, now: () => number = Date.now) {
  assertInstalledCellParentV4(parent, now(), true); const raw: unknown[] = [];
  for (const index of [0, 1] as const) {
    signal.throwIfAborted(); const r = await secret(index), t = targets[index]; signal.throwIfAborted();
    if (r.ARN !== t.secretArn || r.VersionId !== t.secretVersionId || canonicalJson(r.VersionStages) !== canonicalJson(["AWSCURRENT"]) || r.SecretBinary !== undefined || typeof r.SecretString !== "string" || r.SecretString.length > 16384) cellV3Fail("CELL_PARENT_FIXED_SECRET_REJECTED");
    try { raw.push(JSON.parse(r.SecretString)); } catch { cellV3Fail("CELL_PARENT_SECRET_JSON_REJECTED"); }
  }
  const reader = raw[0] as Record<string, unknown>, writer = raw[1] as Record<string, unknown>;
  if (!cellV3Exact(reader, ["schemaVersion", "protocol", "databaseUrl", "certificateSha256", "expectedRegisteredCertificate"]) || reader.schemaVersion !== 3 || reader.protocol !== "sealed-cell-cleanup-control-v3" || reader.certificateSha256 !== certificateSha ||
    !cellV3Exact(writer, ["databaseUrl"]) || typeof reader.databaseUrl !== "string" || typeof writer.databaseUrl !== "string") cellV3Fail("CELL_PARENT_SECRET_PAYLOAD_REJECTED");
  const certificate = validateSealedCertificateV3(reader.expectedRegisteredCertificate); if (await sha256Hex(certificate) !== certificateSha) cellV3Fail("CELL_PARENT_SECRET_CERTIFICATE_REJECTED");
  const check = (s: string, user: string) => { try { const u = new URL(s);
    if (s.length > 4096 || !["postgres:", "postgresql:"].includes(u.protocol) || !/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(u.hostname) ||
      decodeURIComponent(u.username) !== user || !u.password || u.hash || !/^\/[A-Za-z0-9_-]+$/.test(u.pathname) || (u.port && u.port !== "5432") ||
      !["require", "verify-full"].includes(u.searchParams.get("sslmode") ?? "") || [...u.searchParams.keys()].some(k => !["sslmode", "channel_binding"].includes(k))) throw Error(); return `${u.hostname}${u.pathname}`;
  } catch { return cellV3Fail("CELL_PARENT_SECRET_DATABASE_ENDPOINT_REJECTED"); } };
  if (check(reader.databaseUrl, "techlong_cell_cleanup_reader") !== check(writer.databaseUrl, "techlong_cell_drain")) cellV3Fail("CELL_PARENT_SECRET_DATABASE_TARGET_MISMATCH");
  assertInstalledCellParentV4(parent, now(), true); return { readerDatabaseUrl: reader.databaseUrl, writerDatabaseUrl: writer.databaseUrl, certificate };
}
/** In-memory only. No env/profile database URL, Secret mutation, logging or
 * fallback to newer versions. Construction is lazy until a cleanup branch. */
export function createCellParentDatabaseLoaderV4(credentials: unknown) {
  return async (parent: InstalledCellParentV4, signal: AbortSignal) => {
    const sm = new SecretsManagerClient({ credentials: credentials as never, region: "ca-central-1", ignoreConfiguredEndpointUrls: true, maxAttempts: 1 });
    try { const material = await readCellParentMaterialV4(parent, index => sm.send(new GetSecretValueCommand({ SecretId: targets[index].secretArn, VersionId: targets[index].secretVersionId, VersionStage: "AWSCURRENT" }), { abortSignal: signal }), signal);
      return createNeonCellParentDatabaseV4(material.readerDatabaseUrl, material.writerDatabaseUrl, material.certificate, parent.record.manifest.failedProtectionSha256);
    } finally { sm.destroy(); }
  };
}
