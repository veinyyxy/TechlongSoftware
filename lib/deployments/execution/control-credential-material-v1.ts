import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { canonicalJson, sha256Hex } from "./hash.ts";

export const CONTROL_CREDENTIAL_ROLES_V1 = ["techlong_cell_cleanup_reader", "techlong_cell_drain"] as const;
export const CONTROL_CREDENTIAL_SECRET_NAMES_V1 = ["techlong/sandbox/cell-cleanup-readonly-v3", "techlong/sandbox/cell-drain-control"] as const;
export interface ControlCredentialEndpointV1 { host: string; database: string; port: 5432 }
export function assertControlCredentialEndpointV1(v: ControlCredentialEndpointV1) {
  if (Object.keys(v).sort().join(",") !== "database,host,port" || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.neon\.tech$/.test(v.host) ||
    !/^[A-Za-z0-9_-]+$/.test(v.database) || v.port !== 5432) throw new Error("CONTROL_CREDENTIAL_ENDPOINT_INVALID");
}
/** ASCII random password only: avoids ambiguous SASLprep/SQL literal handling. No plaintext is sent in ALTER ROLE. */
export function createControlScramVerifierV1(password: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(password)) throw new Error("CONTROL_CREDENTIAL_PASSWORD_POLICY_INVALID");
  const salt = randomBytes(16), salted = pbkdf2Sync(password, salt, 4096, 32, "sha256");
  const client = createHmac("sha256", salted).update("Client Key").digest();
  const stored = createHash("sha256").update(client).digest("base64");
  const server = createHmac("sha256", salted).update("Server Key").digest("base64");
  const result = `SCRAM-SHA-256$4096:${salt.toString("base64")}$${stored}:${server}`;
  salted.fill(0); client.fill(0); salt.fill(0);
  return result;
}
const materials = new WeakSet<object>();
export interface ControlCredentialMaterialV1 {
  role: typeof CONTROL_CREDENTIAL_ROLES_V1[number]; name: typeof CONTROL_CREDENTIAL_SECRET_NAMES_V1[number];
  databaseUrl: string; scramVerifier: string; secretString: string;
}
export async function createControlCredentialMaterialsV1(endpoint: ControlCredentialEndpointV1,
  certificate: Record<string, unknown>, certificateSha256: string): Promise<readonly ControlCredentialMaterialV1[]> {
  assertControlCredentialEndpointV1(endpoint);
  if (!/^[a-f0-9]{64}$/.test(certificateSha256) || await sha256Hex(certificate) !== certificateSha256)
    throw new Error("CONTROL_CREDENTIAL_CERTIFICATE_INVALID");
  const result: ControlCredentialMaterialV1[] = [];
  for (let i = 0; i < 2; i++) {
    const bytes = randomBytes(32), password = bytes.toString("base64url"); bytes.fill(0);
    const url = new URL(`postgresql://${endpoint.host}:5432/${endpoint.database}?sslmode=verify-full&channel_binding=require`);
    url.username = CONTROL_CREDENTIAL_ROLES_V1[i]; url.password = password;
    const databaseUrl = url.href;
    const payload = i === 0 ? { schemaVersion: 3, protocol: "sealed-cell-cleanup-control-v3", databaseUrl,
      certificateSha256, expectedRegisteredCertificate: certificate } : { databaseUrl };
    const material = Object.freeze({ role: CONTROL_CREDENTIAL_ROLES_V1[i], name: CONTROL_CREDENTIAL_SECRET_NAMES_V1[i], databaseUrl,
      scramVerifier: createControlScramVerifierV1(password), secretString: canonicalJson(payload) });
    materials.add(material); result.push(material);
  }
  if (new URL(result[0].databaseUrl).password === new URL(result[1].databaseUrl).password) throw new Error("CONTROL_CREDENTIAL_ENTROPY_COLLISION");
  // JS strings cannot be reliably zeroized; none of these values may be logged or persisted locally.
  return Object.freeze(result);
}
export function controlCredentialActivationSqlV1(material: ControlCredentialMaterialV1) {
  if (!materials.has(material) || !CONTROL_CREDENTIAL_ROLES_V1.includes(material.role) ||
    !/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/.test(material.scramVerifier))
    throw new Error("CONTROL_CREDENTIAL_MATERIAL_NOT_ISSUED");
  return `ALTER ROLE ${material.role} WITH LOGIN PASSWORD '${material.scramVerifier}'`;
}
