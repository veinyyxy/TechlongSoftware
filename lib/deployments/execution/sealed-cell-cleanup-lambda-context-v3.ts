import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { sha256Hex } from "./hash.ts";
import { validateSealedCertificateV3, sealedV3Keys, sealedV3Fail } from "./sealed-cell-cleanup-authority-v3.ts";

/** Pin from two independently verified, approved Neon post-commit receipts, never from event/SQL. */
export const REGISTERED_SEALED_CERTIFICATE_SHA256_V3 = "dc093614188a8f0a086b4fc6a7e251c43312495a60db2efffc654cf3d48b066f";
export const SEALED_CELL_LAMBDA_NAME_V3 = "techlong-sandbox-cell-ttl-executor-v3";

export async function loadSealedCellTtlControlMaterialV3(signal: AbortSignal) {
  const secretArn = process.env.CELL_CLEANUP_V3_SECRET_ARN;
  if (!secretArn || !/^arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong\/sandbox\/cell-cleanup-readonly-v3-[A-Za-z0-9]{6}$/.test(secretArn))
    sealedV3Fail("SEALED_V3_SECRET_BINDING_MISSING");
  const config = { region: "ca-central-1", ignoreConfiguredEndpointUrls: true, maxAttempts: 1 };
  const credentials = defaultProvider({ clientConfig: config });
  const sts = new STSClient({ ...config, credentials }), secrets = new SecretsManagerClient({ ...config, credentials });
  try {
    signal.throwIfAborted();
    const identity = await sts.send(new GetCallerIdentityCommand({}), { abortSignal: signal });
    if (identity.Account !== "402010193138" || typeof identity.Arn !== "string" ||
      !/^arn:aws:sts::402010193138:assumed-role\/TechlongSandboxCellTtlExecutorRole\/[A-Za-z0-9+=,.@_-]{2,64}$/.test(identity.Arn)) throw new Error();
    const response = await secrets.send(new GetSecretValueCommand({ SecretId: secretArn, VersionStage: "AWSCURRENT" }), { abortSignal: signal });
    if (response.ARN !== secretArn || !response.VersionStages?.includes("AWSCURRENT") || typeof response.SecretString !== "string" || response.SecretString.length > 16384) throw new Error();
    const material = JSON.parse(response.SecretString);
    if (!sealedV3Keys(material, ["schemaVersion", "protocol", "databaseUrl", "certificateSha256", "expectedRegisteredCertificate"]) ||
      material.schemaVersion !== 3 || material.protocol !== "sealed-cell-cleanup-control-v3" || material.certificateSha256 !== REGISTERED_SEALED_CERTIFICATE_SHA256_V3 ||
      typeof material.databaseUrl !== "string" || material.databaseUrl.length > 4096) throw new Error();
    const cert = validateSealedCertificateV3(material.expectedRegisteredCertificate);
    if (await sha256Hex(cert) !== REGISTERED_SEALED_CERTIFICATE_SHA256_V3) throw new Error();
    const url = new URL(material.databaseUrl);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname.endsWith(".neon.tech") ||
      decodeURIComponent(url.username) !== "techlong_cell_cleanup_reader" || !url.password || (url.port && url.port !== "5432") ||
      !["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")) throw new Error();
    signal.throwIfAborted(); return Object.freeze({ databaseUrl: material.databaseUrl, expectedRegisteredCertificate: cert,
      certificateSha256: REGISTERED_SEALED_CERTIFICATE_SHA256_V3 });
  } catch { return sealedV3Fail("SEALED_V3_IDENTITY_OR_SECRET_REJECTED"); }
}
