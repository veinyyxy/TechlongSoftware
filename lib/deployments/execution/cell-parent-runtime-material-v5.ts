import { neon } from "@neondatabase/serverless";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { cellV3Exact, cellV3Fail } from "../cloudformation/shared-cell-stack-v3.ts";
import { assertInstalledCellParentV4, type InstalledCellParentV4 } from "./aws-sdk-cell-birth-parent-v4.ts";
import { readCellParentMaterialV4 } from "./cell-parent-runtime-material-v4.ts";
import { READONLY_RUNTIME_IAM_TARGETS_V1 as targets } from "./readonly-runtime-iam-v1.ts";
import { REGISTERED_SEALED_CERTIFICATE_SHA256_V3 as certificateSha } from "./sealed-cell-cleanup-lambda-context-v3.ts";
import { validateSealedCertificateV3 } from "./sealed-cell-cleanup-authority-v3.ts";
import { NeonCellParentDatabaseV4 } from "./neon-cell-parent-control-v4.ts";
import { cellParentJobsSqlAdapterV5, CELL_PARENT_INSTALLED_PROTECTION_SHA256_V5 } from "./cell-parent-compatibility-v5.ts";
import type { NeonSerializableSnapshotSqlClient } from "./neon-shared-cell-zero-tenant-source.ts";
import type { NeonSharedCellAdmissionFenceSqlClient } from "./neon-shared-cell-admission-fence.ts";
import type { SealedPlanCertificateV1 } from "./neon-sealed-cell-ownership-source-v3.ts";

export { CELL_PARENT_INSTALLED_PROTECTION_SHA256_V5 } from "./cell-parent-compatibility-v5.ts";
export function cellParentControlEndpointV5(raw: unknown, user: "techlong_cell_cleanup_reader" | "techlong_cell_drain") {
  try {
    if (typeof raw !== "string" || raw.length > 4096) throw Error();
    const u = new URL(raw);
    if (!["postgres:", "postgresql:"].includes(u.protocol) || !/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(u.hostname) ||
      decodeURIComponent(u.username) !== user || !u.password || u.hash || !/^\/[A-Za-z0-9_-]+$/.test(u.pathname) || (u.port && u.port !== "5432") ||
      !["require", "verify-full"].includes(u.searchParams.get("sslmode") ?? "") || [...u.searchParams.keys()].some(k => !["sslmode", "channel_binding"].includes(k)) ||
      u.searchParams.getAll("sslmode").length !== 1 || u.searchParams.getAll("channel_binding").length > 1) throw Error();
    return `${u.hostname}${u.pathname}`;
  } catch { return cellV3Fail("CELL_PARENT_V5_CONTROL_ENDPOINT_INVALID"); }
}
export function createNeonCellParentDatabaseV5(readerUrl: string, writerUrl: string, cert: SealedPlanCertificateV1) {
  if (cellParentControlEndpointV5(readerUrl, "techlong_cell_cleanup_reader") !== cellParentControlEndpointV5(writerUrl, "techlong_cell_drain")) cellV3Fail("CELL_PARENT_V5_CONTROL_ENDPOINT_MISMATCH");
  return new NeonCellParentDatabaseV4(cellParentJobsSqlAdapterV5(neon(readerUrl, { fullResults: true }) as unknown as NeonSerializableSnapshotSqlClient),
    neon(writerUrl, { fullResults: true }) as unknown as NeonSharedCellAdmissionFenceSqlClient, cert, CELL_PARENT_INSTALLED_PROTECTION_SHA256_V5);
}
export function createCellParentDatabaseLoaderV5(credentials: unknown) {
  return async (parent: InstalledCellParentV4, signal: AbortSignal) => {
    assertInstalledCellParentV4(parent, Date.now(), true);
    if (parent.record.manifest.failedProtectionSha256 !== CELL_PARENT_INSTALLED_PROTECTION_SHA256_V5) cellV3Fail("CELL_PARENT_V5_REGISTERED_PROTECTION_MISMATCH");
    const sm = new SecretsManagerClient({ credentials: credentials as never, region: "ca-central-1", ignoreConfiguredEndpointUrls: true, maxAttempts: 1 });
    try {
      const m = await readCellParentMaterialV4(parent, index => sm.send(new GetSecretValueCommand({ SecretId: targets[index].secretArn,
        VersionId: targets[index].secretVersionId, VersionStage: "AWSCURRENT" }), { abortSignal: signal }), signal);
      return createNeonCellParentDatabaseV5(m.readerDatabaseUrl, m.writerDatabaseUrl, m.certificate);
    } finally { sm.destroy(); }
  };
}
/** Fixed reader only. Gate branch never reads the drain password, constructs
 * a real writer, calls a definer, or falls back to owner/environment material. */
export async function readCellParentGateReaderV5(read: () => Promise<Record<string, unknown>>, signal: AbortSignal) {
  signal.throwIfAborted(); const r = await read(), t = targets[0]; signal.throwIfAborted();
  if (r.ARN !== t.secretArn || r.VersionId !== t.secretVersionId || canonicalJson(r.VersionStages) !== '["AWSCURRENT"]' || r.SecretBinary !== undefined ||
    typeof r.SecretString !== "string" || r.SecretString.length > 16384) cellV3Fail("CELL_PARENT_V5_GATE_SECRET_INVALID");
  let raw: unknown; try { raw = JSON.parse(r.SecretString); } catch { return cellV3Fail("CELL_PARENT_V5_GATE_SECRET_INVALID"); }
  const v = raw as Record<string, unknown>;
  if (!cellV3Exact(v, ["schemaVersion", "protocol", "databaseUrl", "certificateSha256", "expectedRegisteredCertificate"]) ||
    v.schemaVersion !== 3 || v.protocol !== "sealed-cell-cleanup-control-v3" || v.certificateSha256 !== certificateSha || typeof v.databaseUrl !== "string") cellV3Fail("CELL_PARENT_V5_GATE_SECRET_INVALID");
  cellParentControlEndpointV5(v.databaseUrl, "techlong_cell_cleanup_reader");
  const certificate = validateSealedCertificateV3(v.expectedRegisteredCertificate);
  if (await sha256Hex(certificate) !== certificateSha) cellV3Fail("CELL_PARENT_V5_GATE_CERTIFICATE_INVALID");
  return { databaseUrl: v.databaseUrl, certificate };
}
