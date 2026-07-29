import { env } from "cloudflare:workers";

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;

export class StripeGatewayError extends Error {
  public readonly code: "STRIPE_NOT_CONFIGURED" | "STRIPE_CHECKOUT_FAILED";
  public readonly status: number;

  constructor(
    code: "STRIPE_NOT_CONFIGURED" | "STRIPE_CHECKOUT_FAILED",
    message: string,
    status: number,
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface StripeCheckoutSessionInput {
  checkoutId: string;
  metadataKey?: "payment_checkout_id" | "subscription_purchase_order_id";
  planName: string;
  planDescription: string;
  amount: number;
  currency: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export interface StripeCheckoutSession {
  id: string;
  url: string;
  expiresAt: number | null;
}

export interface StripeCheckoutSessionStatus {
  id: string;
  paymentStatus: string | null;
  status: string | null;
  paymentIntentId: string | null;
  amountTotal: number | null;
  currency: string | null;
  metadata: Record<string, unknown>;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

function binding(name: string): string | null {
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getStripeWebhookSecret(): string | null {
  return binding("STRIPE_WEBHOOK_SECRET");
}

export function hasStripeSecretKey(): boolean {
  return Boolean(binding("STRIPE_SECRET_KEY"));
}

export function hasStripePaymentConfiguration(): boolean {
  return hasStripeSecretKey() && Boolean(getStripeWebhookSecret());
}

export async function createStripeCheckoutSession(
  input: StripeCheckoutSessionInput,
): Promise<StripeCheckoutSession> {
  const secretKey = binding("STRIPE_SECRET_KEY");
  if (!secretKey) {
    throw new StripeGatewayError(
      "STRIPE_NOT_CONFIGURED",
      "在线支付尚未配置，请联系平台管理员。",
      503,
    );
  }

  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("success_url", input.successUrl);
  body.set("cancel_url", input.cancelUrl);
  body.set("client_reference_id", input.checkoutId);
  body.set("customer_email", input.customerEmail);
  body.set("line_items[0][price_data][currency]", input.currency.toLowerCase());
  body.set("line_items[0][price_data][unit_amount]", String(input.amount));
  body.set("line_items[0][price_data][product_data][name]", input.planName);
  if (input.planDescription) {
    body.set(
      "line_items[0][price_data][product_data][description]",
      input.planDescription,
    );
  }
  body.set("line_items[0][quantity]", "1");
  const metadataKey = input.metadataKey ?? "payment_checkout_id";
  body.set(`metadata[${metadataKey}]`, input.checkoutId);
  body.set(`payment_intent_data[metadata][${metadataKey}]`, input.checkoutId);

  let response: Response;
  try {
    response = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        "idempotency-key": `checkout_${input.checkoutId}`,
      },
      body: body.toString(),
    });
  } catch {
    throw new StripeGatewayError(
      "STRIPE_CHECKOUT_FAILED",
      "暂时无法连接在线支付服务，请稍后重试。",
      502,
    );
  }

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof payload?.id === "string" ? payload.id : "";
  const url = typeof payload?.url === "string" ? payload.url : "";
  if (!response.ok || !id || !isStripeCheckoutUrl(url)) {
    throw new StripeGatewayError(
      "STRIPE_CHECKOUT_FAILED",
      "无法创建在线支付页面，请稍后重试。",
      502,
    );
  }

  const expiresAt =
    typeof payload?.expires_at === "number" && Number.isSafeInteger(payload.expires_at)
      ? payload.expires_at * 1000
      : null;

  return { id, url, expiresAt };
}

export async function retrieveStripeCheckoutSession(
  sessionId: string,
): Promise<StripeCheckoutSessionStatus> {
  const secretKey = binding("STRIPE_SECRET_KEY");
  if (!secretKey) {
    throw new StripeGatewayError(
      "STRIPE_NOT_CONFIGURED",
      "在线支付尚未配置，请联系平台管理员。",
      503,
    );
  }
  if (!/^cs_(?:test_|live_)?[A-Za-z0-9]+$/.test(sessionId)) {
    throw new StripeGatewayError(
      "STRIPE_CHECKOUT_FAILED",
      "Stripe 付款会话编号无效。",
      400,
    );
  }

  let response: Response;
  try {
    response = await fetch(
      `${STRIPE_API_BASE}/checkout/sessions/${encodeURIComponent(sessionId)}`,
      { headers: { authorization: `Bearer ${secretKey}` } },
    );
  } catch {
    throw new StripeGatewayError(
      "STRIPE_CHECKOUT_FAILED",
      "暂时无法连接在线支付服务，请稍后重试。",
      502,
    );
  }

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || payload?.id !== sessionId) {
    throw new StripeGatewayError(
      "STRIPE_CHECKOUT_FAILED",
      "暂时无法核对 Stripe 付款状态，请稍后重试。",
      502,
    );
  }

  return {
    id: sessionId,
    paymentStatus: typeof payload.payment_status === "string" ? payload.payment_status : null,
    status: typeof payload.status === "string" ? payload.status : null,
    paymentIntentId: typeof payload.payment_intent === "string" ? payload.payment_intent : null,
    amountTotal:
      typeof payload.amount_total === "number" &&
      Number.isSafeInteger(payload.amount_total)
        ? payload.amount_total
        : null,
    currency:
      typeof payload.currency === "string" ? payload.currency : null,
    metadata:
      payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
        ? (payload.metadata as Record<string, unknown>)
        : {},
  };
}

export async function verifyStripeWebhook(
  payload: string,
  signatureHeader: string | null,
  webhookSecret: string,
  toleranceSeconds = DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
): Promise<StripeWebhookEvent> {
  const parsedSignature = parseSignatureHeader(signatureHeader);
  if (!parsedSignature || !isFreshTimestamp(parsedSignature.timestamp, toleranceSeconds)) {
    throw new Error("Invalid Stripe webhook signature.");
  }

  const signedPayload = `${parsedSignature.timestamp}.${payload}`;
  const expected = await hmacSha256Hex(webhookSecret, signedPayload);
  if (!parsedSignature.signatures.some((signature) => constantTimeEqual(signature, expected))) {
    throw new Error("Invalid Stripe webhook signature.");
  }

  const event = JSON.parse(payload) as unknown;
  if (!isStripeWebhookEvent(event)) {
    throw new Error("Invalid Stripe webhook payload.");
  }
  return event;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest));
}

function isStripeCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "stripe.com" || url.hostname.endsWith(".stripe.com"))
    );
  } catch {
    return false;
  }
}

function parseSignatureHeader(value: string | null): {
  timestamp: number;
  signatures: string[];
} | null {
  if (!value) return null;

  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const item of value.split(",")) {
    const [key, rawValue] = item.split("=", 2);
    if (key === "t" && rawValue && /^\d+$/.test(rawValue)) {
      const parsed = Number(rawValue);
      if (Number.isSafeInteger(parsed)) timestamp = parsed;
    }
    if (key === "v1" && rawValue && /^[0-9a-f]{64}$/i.test(rawValue)) {
      signatures.push(rawValue.toLowerCase());
    }
  }
  return timestamp && signatures.length ? { timestamp, signatures } : null;
}

function isFreshTimestamp(timestamp: number, toleranceSeconds: number): boolean {
  return Math.abs(Math.floor(Date.now() / 1000) - timestamp) <= toleranceSeconds;
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toHex(new Uint8Array(signature));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function isStripeWebhookEvent(value: unknown): value is StripeWebhookEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  const data = event.data;
  return (
    typeof event.id === "string" &&
    typeof event.type === "string" &&
    Boolean(data) &&
    typeof data === "object" &&
    Boolean((data as Record<string, unknown>).object) &&
    typeof (data as Record<string, unknown>).object === "object"
  );
}
