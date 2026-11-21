import { firstOpenBuyerWire } from "../../buyer-forward/wire.mjs";

/** Public data only. The existing Sandbox beta buyer alias is not a tenant ID. */
export const sandboxBuyerRuntimePath = "/buyer-runtime.json";
export const sandboxBuyerPaymentPaths = Object.freeze({ success: "/payment-success", cancel: "/payment-cancel" });
const sandboxSuffix = ".sandbox.techlong.cloud";
const instanceIdPattern = /^app_[a-f0-9]{24}$/;

export function bindSandboxBuyerOrigin(tenantId: string) {
  if (!instanceIdPattern.test(tenantId)) throw Error("SANDBOX_BUYER_TENANT_ID_INVALID");
  // Prefix and full ID suffix are preserved: no truncation or case folding.
  const tenantLabel = tenantId.replace("_", "-");
  const buyerHostname = tenantLabel + sandboxSuffix;
  const apiHostname = `pending-${tenantLabel}${sandboxSuffix}`;
  return Object.freeze({ tenantId, buyerHostname, apiHostname,
    buyerOrigin: `https://${buyerHostname}`, apiOrigin: `https://${apiHostname}` });
}

const binding = bindSandboxBuyerOrigin(firstOpenBuyerWire.tenantId);
export const firstOpenBuyerBinding = Object.freeze({ ...binding, parameters: Object.freeze({
  ControlIssuer: "https://techlong.cloud",
  CorsAllowedOrigins: binding.buyerOrigin,
  // Stripe redirection is not a payment verdict. Neither landing needs a
  // Checkout Session ID or any other Stripe data in the address or page.
  StripeSuccessUrl: `${binding.buyerOrigin}${sandboxBuyerPaymentPaths.success}`,
  StripeCancelUrl: `${binding.buyerOrigin}${sandboxBuyerPaymentPaths.cancel}`,
}) });

/** Complete the offline scope before sealing it; never silently rewrite a
 * previously specified origin or redirect from a different tenant. */
export function completeFirstOpenBuyerParameters(base: Readonly<Record<string, string>>) {
  for (const [key, value] of Object.entries(firstOpenBuyerBinding.parameters)) {
    if (Object.hasOwn(base, key) && base[key] !== value) throw Error("FIRST_OPEN_BUYER_PARAMETERS_CHANGED");
  }
  return { ...base, ...firstOpenBuyerBinding.parameters };
}

export function assertFirstOpenBuyerParameters(parameters: Readonly<Record<string, string>>) {
  if (Object.entries(firstOpenBuyerBinding.parameters).some(([name, value]) => parameters[name] !== value)) {
    throw Error("FIRST_OPEN_BUYER_PARAMETERS_CHANGED");
  }
}
