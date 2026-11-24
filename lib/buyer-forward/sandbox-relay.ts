import { createHmac, randomBytes } from "node:crypto";
import { firstOpenBuyerBinding } from "../deployments/execution/first-open-buyer-binding.ts";
import { matchBuyerForwardRoute } from "./allowed-routes.ts";
import { isFirstOpenBuyerSigningKey } from "./signer-binding.ts";
import { firstOpenBuyerWire } from "./wire.mjs";

export const buyerForwardConsoleOrigin = firstOpenBuyerWire.consoleOrigin;
export const buyerForwardPrefix = firstOpenBuyerWire.prefix;
const clientId = "speedfeast-sandbox-buyer-forward-v1";
const permittedHeaders = ["authorization", "content-type", "x-store-id", "x-buyer-device-id", "x-buyer-platform"];
const bearerPattern = /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const jsonType = /^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/i;
const maximumRequestBytes = 64 * 1024;
const maximumResponseBytes = 4 * 1024 * 1024;

function replyHeaders(request: Request) {
  const headers = new Headers({
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    Vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
  });
  if (request.headers.get("origin") === firstOpenBuyerBinding.buyerOrigin) {
    headers.set("Access-Control-Allow-Origin", firstOpenBuyerBinding.buyerOrigin);
  }
  return headers; // No credentialed CORS, irrespective of the upstream response.
}

async function readBounded(body: ReadableStream<Uint8Array> | null, limit: number, signal: AbortSignal) {
  if (!body) return "";
  const chunks: Uint8Array[] = [];
  const reader = body.getReader();
  const stop = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", stop, { once: true });
  let bytes = 0, complete = false;
  try {
    for (;;) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) { complete = true; break; }
      bytes += part.value.byteLength;
      if (bytes > limit) throw Error("BODY_TOO_LARGE");
      chunks.push(part.value);
    }
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, bytes));
  } finally {
    signal.removeEventListener("abort", stop);
    if (!complete) stop();
    reader.releaseLock();
  }
}

function normalizeQuery(params: URLSearchParams, allowed: readonly string[]) {
  const seen = new Map<string, string>();
  for (const [key, value] of params) {
    // A deliberately flat subset of A's qs codec. Unlisted, nested, multiple,
    // and inherited property names cannot reach backend routing or signing.
    if (!allowed.includes(key) || seen.has(key) || value.length > 2048 || /[\x00-\x1f\x7f\ufffd]/u.test(value)) return null;
    seen.set(key, value);
  }
  const keys = [...seen.keys()].sort();
  return { wire: new URLSearchParams(keys.map(key => [key, seen.get(key)!])), signed: keys.map(key => `${key}=${seen.get(key)}`).join("&") };
}

/** Authenticates this relay as a client of fixed version A, not its caller.
 * JWT, account/tenant/store/order ownership, rate limits and buyer-access rules
 * remain enforced by the API. Origin is only a browser CORS constraint. */
export function createSandboxBuyerForward(deps: {
  loadSigningKey(): unknown;
  fetchUpstream(url: URL, options: RequestInit): Promise<Response>;
}) {
  return async (request: Request) => {
    const resultHeaders = replyHeaders(request);
    const error = (status: number, code: string) => Response.json(
      { success: false, code, message: status >= 500 ? "Buyer service is unavailable." : "Buyer request was not accepted." },
      { status, headers: resultHeaders },
    );
    const incoming = new URL(request.url);
    if (incoming.origin !== buyerForwardConsoleOrigin || request.headers.get("origin") !== firstOpenBuyerBinding.buyerOrigin) {
      return error(403, "BUYER_FORWARD_ORIGIN");
    }
    const path = incoming.pathname.slice(buyerForwardPrefix.length);
    if (!incoming.pathname.startsWith(buyerForwardPrefix + "/api/") || incoming.hash || incoming.search.length > 8192) {
      return error(404, "BUYER_FORWARD_ROUTE");
    }
    const preflight = request.method === "OPTIONS";
    const method = preflight ? request.headers.get("access-control-request-method") ?? "" : request.method;
    const allowed = matchBuyerForwardRoute(method, path);
    if (!allowed) return error(404, "BUYER_FORWARD_ROUTE");
    const query = normalizeQuery(incoming.searchParams, allowed.queryKeys);
    if (!query || allowed.acceptsQueryValues?.(query.wire) === false) return error(400, "BUYER_FORWARD_QUERY");

    if (preflight) {
      const declared = (request.headers.get("access-control-request-headers") ?? "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
      if (declared.some(name => !permittedHeaders.includes(name))) return error(400, "BUYER_FORWARD_HEADERS");
      resultHeaders.set("Access-Control-Allow-Methods", method);
      resultHeaders.set("Access-Control-Allow-Headers", permittedHeaders.join(", "));
      return new Response(null, { status: 204, headers: resultHeaders });
    }

    const headers = new Headers({ Accept: "application/json", Origin: firstOpenBuyerBinding.buyerOrigin });
    const authorization = request.headers.get("authorization");
    if (authorization !== null && (authorization.length > 4096 || !bearerPattern.test(authorization))) return error(401, "BUYER_FORWARD_BEARER");
    if (allowed.bearer === "required" && !authorization) return error(401, "BUYER_FORWARD_BEARER");
    if (authorization) headers.set("Authorization", authorization);
    for (const name of ["x-store-id", "x-buyer-device-id", "x-buyer-platform"]) {
      const value = request.headers.get(name);
      if (value === null) continue;
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(value) || name === "x-buyer-platform" && value !== "web") {
        return error(400, "BUYER_FORWARD_HEADERS");
      }
      headers.set(name, value);
    }
    headers.set("X-Buyer-Platform", "web");
    if (request.headers.has("content-encoding")) return error(415, "BUYER_FORWARD_CONTENT");
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]);
    let body: string | undefined;
    if (method === "POST") {
      if (!jsonType.test(request.headers.get("content-type") ?? "")) return error(415, "BUYER_FORWARD_CONTENT");
      try {
        body = await readBounded(request.body, maximumRequestBytes, signal);
        const value = JSON.parse(body);
        if (!value || typeof value !== "object" || Array.isArray(value)) return error(400, "BUYER_FORWARD_JSON");
        if (path === "/api/payments/create" && value.platform !== "web") return error(400, "BUYER_FORWARD_CHECKOUT_PLATFORM");
      } catch {
        return error(400, "BUYER_FORWARD_JSON");
      }
      headers.set("Content-Type", "application/json");
    } else if (request.body) {
      return error(400, "BUYER_FORWARD_CONTENT");
    }

    try {
      signal.throwIfAborted();
      const secret = deps.loadSigningKey();
      if (!isFirstOpenBuyerSigningKey(secret)) return error(503, "BUYER_FORWARD_DISABLED");
      const timestamp = String(Math.floor(Date.now() / 1_000)), nonce = randomBytes(16).toString("hex");
      // A uses the original UTF-8 JSON bytes on writes and sorted qs values
      // with `encode: false` for GET. Do not reserialize the signed body.
      const signature = createHmac("sha256", secret).update(`${clientId}-${timestamp}-${nonce}-${body ?? query.signed}`).digest("base64");
      headers.set("X-Client-Id", clientId);
      headers.set("X-Timestamp", timestamp);
      headers.set("X-Nonce", nonce);
      headers.set("X-Signature", signature);
      const upstreamUrl = new URL(firstOpenBuyerBinding.apiOrigin);
      upstreamUrl.pathname = path; // Fixed host; allowed path never provides a URL or leading //.
      upstreamUrl.search = query.wire.toString();
      const upstream = await deps.fetchUpstream(upstreamUrl, { method, headers, body, cache: "no-store", redirect: "manual", signal });
      if (upstream.status === 204) return new Response(null, { status: 204, headers: resultHeaders });
      if (upstream.status < 200 || (upstream.status >= 300 && upstream.status < 400) || upstream.status >= 500 ||
        !jsonType.test(upstream.headers.get("content-type") ?? "")) {
        void upstream.body?.cancel().catch(() => {});
        return error(502, "BUYER_FORWARD_UPSTREAM");
      }
      const response = await readBounded(upstream.body, maximumResponseBytes, signal);
      // None of the vetted A routes intentionally return signatures, client
      // keys, cookies or internal response headers. Fail on accidental echo.
      if (response.includes(signature) || response.includes(secret)) return error(502, "BUYER_FORWARD_UPSTREAM");
      JSON.parse(response);
      resultHeaders.set("Content-Type", "application/json; charset=utf-8");
      return new Response(response, { status: upstream.status, headers: resultHeaders });
    } catch {
      return error(502, "BUYER_FORWARD_UPSTREAM");
    }
  };
}
