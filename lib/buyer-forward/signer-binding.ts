import { firstOpenBuyerWire, hasFirstOpenBuyerSigningMaterial } from "./wire.mjs";

export const firstOpenBuyerSignerEnvName = firstOpenBuyerWire.signerEnvName;
export const firstOpenBuyerSignerSecretName = "techlong/sandbox/platform-web/buyer-forward/fc41597f-hmac-v1";
const arnPrefix = `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${firstOpenBuyerSignerSecretName}-`;

export type FirstOpenBuyerSignerPin = Readonly<{ arn: string; versionId: string }>;

export function isFirstOpenBuyerSignerPin(value: unknown): value is FirstOpenBuyerSignerPin {
  if (!value || typeof value !== "object" || Object.keys(value).sort().join(",") !== "arn,versionId") return false;
  const { arn, versionId } = value as Partial<FirstOpenBuyerSignerPin>;
  return typeof arn === "string" && arn.startsWith(arnPrefix) && /^[A-Za-z0-9]{6}$/.test(arn.slice(arnPrefix.length)) &&
    typeof versionId === "string" && /^[A-Za-z0-9-]{32,64}$/.test(versionId);
}

// Canonical base64url encoding of exactly 32 fresh random bytes, raw text.
// Do not normalize/truncate, accept placeholders or parse a runtime JSON.
export function isFirstOpenBuyerSigningKey(value: unknown): value is string {
  return hasFirstOpenBuyerSigningMaterial(value);
}
