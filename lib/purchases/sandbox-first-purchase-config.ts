export const SANDBOX_PURCHASE_ORIGIN = "https://console.sandbox.techlong.cloud";
export const SANDBOX_PURCHASE_PRODUCT = "prd_restaurant_order_system";
export const SANDBOX_PURCHASE_ENVIRONMENT = "env_aws_sandbox_ca_central_1";
export const SANDBOX_PURCHASE_WEBHOOK_ROLE = "techlong_sandbox_first_purchase_webhook";

// Stripe owns the routing prefix. Bind the exact HTTPS authority and the final
// test-session segment, reject query or URL normalization, and keep the fragment opaque.
export const SANDBOX_CHECKOUT_URL_MAX_BYTES = 8192;
export const SANDBOX_CHECKOUT_URL_PATTERN =
  "^https://checkout[.]stripe[.]com/(?:[A-Za-z0-9_-]+/)*(cs_test_[A-Za-z0-9]{1,200})(?:#[!-~]*)?$";
const sandboxCheckoutUrl = new RegExp(SANDBOX_CHECKOUT_URL_PATTERN);
export function sandboxCheckoutSessionIdFromUrl(value: unknown): string | null {
  // All admitted characters are ASCII, so the length limit also bounds UTF-8 bytes.
  if (typeof value !== "string" || value.length > SANDBOX_CHECKOUT_URL_MAX_BYTES) return null;
  const match = sandboxCheckoutUrl.exec(value);
  return match && match[0] === value ? match[1] : null;
}

export const SANDBOX_PURCHASE_BINDINGS = [
  "TECHLONG_SANDBOX_FIRST_PURCHASE",
  "AWS_SANDBOX_FIRST_ONBOARDING_WORKSPACE_ID",
  "TECHLONG_SANDBOX_FIRST_PURCHASE_PLAN_ID",
  "AWS_SANDBOX_FIRST_ONBOARDING_RELEASE_ID",
  "TECHLONG_SANDBOX_FIRST_PURCHASE_IMAGE_URI",
  "TECHLONG_SANDBOX_STRIPE_TEST_KEY",
  "TECHLONG_SANDBOX_STRIPE_TEST_WEBHOOK_SECRET",
  "TECHLONG_SANDBOX_FIRST_PURCHASE_WEBHOOK_DB",
] as const;

export type SandboxPurchaseScope = { workspaceId: string; planId: string; releaseId: string; imageUri: string };
export function validSandboxPurchaseScope(s: SandboxPurchaseScope) {
  return /^wsp_[a-f0-9]{24}$/.test(s.workspaceId) &&
    /^(?:pln_[a-f0-9]{32}|plan_[a-zA-Z0-9_-]{1,100})$/.test(s.planId) && /^release_[a-f0-9]{32}$/.test(s.releaseId) &&
    /^402010193138\.dkr\.ecr\.ca-central-1\.amazonaws\.com\/techlong-sandbox-speedfeast@sha256:[a-f0-9]{64}$/.test(s.imageUri);
}

export function readSandboxPurchaseConfiguration(bindings: Record<string, unknown>) {
  if (bindings.TECHLONG_SANDBOX_FIRST_PURCHASE !== "true") return null;
  const value = (name: string) => typeof bindings[name] === "string" ? bindings[name] as string : "";
  const scope = {
    workspaceId: value("AWS_SANDBOX_FIRST_ONBOARDING_WORKSPACE_ID"),
    planId: value("TECHLONG_SANDBOX_FIRST_PURCHASE_PLAN_ID"),
    releaseId: value("AWS_SANDBOX_FIRST_ONBOARDING_RELEASE_ID"),
    imageUri: value("TECHLONG_SANDBOX_FIRST_PURCHASE_IMAGE_URI"),
  };
  const stripeKey = value("TECHLONG_SANDBOX_STRIPE_TEST_KEY");
  const signingSecret = value("TECHLONG_SANDBOX_STRIPE_TEST_WEBHOOK_SECRET");
  const webhookDatabase = value("TECHLONG_SANDBOX_FIRST_PURCHASE_WEBHOOK_DB");
  if (!validSandboxPurchaseScope(scope) || bindings.TECHLONG_PLATFORM_INGRESS !== "alb-https-v1" ||
      bindings.TECHLONG_PLATFORM_PUBLIC_ORIGIN !== SANDBOX_PURCHASE_ORIGIN ||
      !/^(?:sk|rk)_test_[A-Za-z0-9_]{8,}$/.test(stripeKey) || !/^whsec_[A-Za-z0-9_]{8,}$/.test(signingSecret)) return null;
  try {
    const webhook = new URL(webhookDatabase);
    const web = new URL(value("DATABASE_URL"));
    if (webhook.protocol !== "postgresql:" || webhook.username !== SANDBOX_PURCHASE_WEBHOOK_ROLE || !webhook.password ||
        webhook.host !== web.host || !webhook.hostname.endsWith(".neon.tech") || webhook.pathname !== web.pathname ||
        webhook.searchParams.get("sslmode") !== "verify-full") return null;
  } catch { return null; }
  return { ...scope, stripeKey, signingSecret, webhookDatabase };
}
