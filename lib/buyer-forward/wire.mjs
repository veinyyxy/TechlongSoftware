// Public constants, also loaded directly by the minimal Node hosting entry.
const tenantId = "app_bbd626d7d3806af686073211";
export const firstOpenBuyerWire = Object.freeze({
  tenantId,
  buyerOrigin: `https://${tenantId.replace("_", "-")}.sandbox.techlong.cloud`,
  consoleOrigin: "https://console.sandbox.techlong.cloud",
  prefix: "/api/buyer-forward",
  signerEnvName: "FIRST_OPEN_BUYER_FORWARD_HMAC",
});

// 32 bytes form 42 complete Base64 characters and four remaining bits.
// Require canonical zero padding bits; never write the value into policy state.
export function hasFirstOpenBuyerSigningMaterial(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value);
}
