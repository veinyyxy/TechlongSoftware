import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { firstOpenBuyerBinding as binding } from "../lib/deployments/execution/first-open-buyer-binding.ts";
import { buyerForwardConsoleOrigin as consoleOrigin, buyerForwardPrefix as prefix,
  createSandboxBuyerForward } from "../lib/buyer-forward/sandbox-relay.ts";

const hmac = Buffer.alloc(32, 42).toString("base64url");
const bearer = "Bearer fixture.buyer.jwt";
function request(path: string, init: RequestInit = {}, origin = binding.buyerOrigin) {
  const headers = new Headers(init.headers);
  headers.set("Origin", origin);
  return new Request(consoleOrigin + prefix + path, { ...init, headers });
}

test("exact Sandbox forward signs A's sorted GET and original POST bytes without forwarding client/console credentials", async () => {
  let calls = 0;
  const checkout = '{"platform":"web","amount":12.0,"note":"例子"}';
  const forward = createSandboxBuyerForward({ loadSigningKey: () => hmac, async fetchUpstream(url, init) {
    ++calls;
    const headers = new Headers(init.headers);
    assert.equal(url.origin, binding.apiOrigin);
    assert.equal(init.redirect, "manual");
    assert.equal(init.cache, "no-store");
    assert.equal(headers.has("Cookie"), false);
    assert.equal(headers.has("X-Forwarded-For"), false);
    assert.equal(headers.get("Origin"), binding.buyerOrigin);
    assert.equal(headers.get("x-buyer-platform"), "web");
    assert.equal(headers.get("x-buyer-device-id"), "browser-1");
    assert.match(headers.get("X-Timestamp") ?? "", /^\d+$/);
    assert.match(headers.get("X-Nonce") ?? "", /^[a-f0-9]{32}$/);
    const payload = calls === 1 ? "app_scope=order_client&country_code=CA&region_code=MB" : checkout;
    const expected = createHmac("sha256", hmac).update(
      [headers.get("x-client-id"), headers.get("x-timestamp"), headers.get("x-nonce"), payload].join("-"),
    ).digest("base64");
    assert.equal(headers.get("X-Signature"), expected);
    if (calls === 1) {
      assert.equal(init.method, "GET");
      assert.equal(url.pathname + url.search, "/api/config?app_scope=order_client&country_code=CA&region_code=MB");
      assert.equal(init.body, undefined);
      assert.equal(headers.has("Authorization"), false);
    } else {
      assert.equal(init.method, "POST");
      assert.equal(url.pathname, "/api/payments/create");
      assert.equal(init.body, checkout);
      assert.equal(headers.get("Authorization"), bearer);
    }
    return Response.json({ success: true, data: "fixture" }, { headers: {
      "Set-Cookie": "upstream=private", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Credentials": "true",
      "X-Signature": expected, "Cache-Control": "public, max-age=600",
    } });
  } });
  const common = { Cookie: "console-session=fixture", "X-Forwarded-For": "203.0.113.99", "X-Signature": "caller-supplied",
    "X-Buyer-Device-Id": "browser-1" };
  for (const res of [
    await forward(request("/api/config?region_code=MB&country_code=CA&app_scope=order_client", { headers: common })),
    await forward(request("/api/payments/create", { method: "POST", headers: { ...common, Authorization: bearer,
      "Content-Type": "application/json" }, body: checkout })),
  ]) {
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), binding.buyerOrigin);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    for (const name of ["Access-Control-Allow-Credentials", "Set-Cookie", "X-Signature", "Location"]) assert.equal(res.headers.has(name), false);
    assert.deepEqual(await res.json(), { success: true, data: "fixture" });
  }
  assert.equal(calls, 2);
});

test("wrong tenant, privileged routes, missing bearer, mobile checkout, and ambiguous input are refused before signing", async () => {
  const forward = createSandboxBuyerForward({ loadSigningKey: () => assert.fail("signing key must not be loaded"),
    fetchUpstream: async () => assert.fail("no forwarding") });
  const cases = [
    [request("/api/products/get_list", {}, "https://buyer.sandbox.techlong.cloud"), 403],
    [request("/api/products/get_list", {}, "https://app-000000000000000000000001.sandbox.techlong.cloud"), 403],
    [request("/api/saas/readiness"), 404],
    [request("/api/merchant/login"), 404],
    [request("/api/payments/webhook/stripe", { method: "POST" }), 404],
    [request("/api/payment-methods/card/save", { method: "POST" }), 404],
    [request("/api/%2fproducts/get_list"), 404],
    [request("/api/config?app_scope=merchant_client"), 400],
    [request("/api/config?app_scope=order_client&app_scope=order_client"), 400],
    [request("/api/config?app_scope=order_client&x%5By%5D=1"), 400],
    [request("/api/orders/get_list"), 401],
    [request("/api/payments/create", { method: "POST", headers: { Authorization: bearer, "Content-Type": "application/json" },
      body: '{"platform":"android"}' }), 400],
    [request("/api/users/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(66000) }), 400],
  ] as const;
  for (const [req, status] of cases) {
    const res = await forward(req);
    assert.equal(res.status, status);
    if (status === 403) assert.equal(res.headers.has("Access-Control-Allow-Origin"), false);
  }
  const preflight = await forward(request("/api/payments/create", { method: "OPTIONS", headers: {
    "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization, content-type, x-buyer-device-id",
  } }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Methods"), "POST");
  assert.equal(preflight.headers.has("Access-Control-Allow-Credentials"), false);
});

test("uninstalled secret is fail-closed and redirects, signed-response reflection or provider failures never escape", async () => {
  const unset = createSandboxBuyerForward({ loadSigningKey: () => undefined, fetchUpstream: async () => assert.fail("disabled") });
  assert.deepEqual(await (await unset(request("/api/stores/bootstrap"))).json(),
    { success: false, code: "BUYER_FORWARD_DISABLED", message: "Buyer service is unavailable." });
  for (const outcome of ["redirect", "echo", "upstream failure", "tenant-rejected-bearer"]) {
    let count = 0;
    const forward = createSandboxBuyerForward({ loadSigningKey: () => hmac, async fetchUpstream(_url, init) {
      count++;
      if (outcome === "redirect") return Response.redirect("https://another-tenant.example.invalid/");
      if (outcome === "echo") return Response.json({ signature: new Headers(init.headers).get("X-Signature") });
      if (outcome === "tenant-rejected-bearer") return Response.json({ success: false, code: "ORDER_NOT_FOUND" }, { status: 403 });
      throw Error("private upstream diagnostic");
    } });
    const res = await forward(request("/api/orders/get_list", { headers: { Authorization: bearer } }));
    assert.equal(count, 1);
    assert.equal(res.headers.has("Location"), false);
    if (outcome === "tenant-rejected-bearer") {
      assert.equal(res.status, 403);
      assert.equal((await res.json()).code, "ORDER_NOT_FOUND");
    } else {
      assert.equal(res.status, 502);
      assert.equal((await res.json()).code, "BUYER_FORWARD_UPSTREAM");
    }
  }
});
