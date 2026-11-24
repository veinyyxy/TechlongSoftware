import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import base from "../ops/aws-sandbox/cloudformation/buyer-web-sandbox-v1.domain.candidate.template.json" with { type: "json" };
import { buyerRuntimePath, renderSandboxBuyerTenantRouting, sandboxLegacyBuyerHostname } from "../ops/aws-sandbox/buyer-web-tenant-routing.ts";

test("the shared buyer candidate adds one exact tenant, preserves the old site, and isolates runtime and Stripe returns by host", () => {
  const id = "bbd626d7d3806af686073211", host = `app-${id}.sandbox.techlong.cloud`;
  const binding = { tenantId: `app_${id}`, buyerOrigin: `https://${host}`, apiOrigin: `https://pending-${host}` };
  const template = renderSandboxBuyerTenantRouting(binding);
  const candidate = template.Resources;
  const { BuyerDistribution, ...unchanged } = base.Resources;
  for (const [key, value] of Object.entries(unchanged)) {
    assert.deepEqual(candidate[key as keyof typeof unchanged], value);
  }
  const { Aliases, Comment, DefaultCacheBehavior, ...config } = candidate.BuyerDistribution.Properties.DistributionConfig;
  assert.deepEqual(Aliases, [sandboxLegacyBuyerHostname, host]);
  assert.match(Comment, /shared sandbox buyer Web/);
  const expected = BuyerDistribution.Properties.DistributionConfig;
  for (const key of Object.keys(config) as (keyof typeof config)[]) assert.deepEqual(config[key], expected[key]);
  const { FunctionAssociations, ...behavior } = DefaultCacheBehavior;
  assert.deepEqual(behavior, expected.DefaultCacheBehavior);
  assert.deepEqual(FunctionAssociations, [{ EventType: "viewer-request", FunctionARN: { "Fn::GetAtt": ["BuyerTenantRouting", "FunctionARN"] } }]);
  for (const rr of [candidate.BuyerTenantAliasIpv4, candidate.BuyerTenantAliasIpv6]) {
    assert.equal(rr.Properties.Name, host + ".");
    assert.deepEqual(rr.Properties.AliasTarget, base.Resources.BuyerAliasIpv4.Properties.AliasTarget);
  }
  assert.match(template.Parameters.SandboxBuyerCertificateArn.Description, /covering both/);
  assert.equal(Object.hasOwn(template.Parameters.SandboxBuyerCertificateArn, "Default"), false);

  const run = runInNewContext(candidate.BuyerTenantRouting.Properties.FunctionCode + "\nhandler");
  const event = (name: string, uri: string, method = "GET") => ({ request: { uri, method, headers: {
    host: { value: name }, "x-forwarded-host": { value: host },
  }, querystring: { session_id: { value: "unsafe-session-marker" }, apiOrigin: { value: "https://bad.example" } } } });
  const js = run(event(host, buyerRuntimePath));
  assert.equal(js.statusCode, 200);
  assert.equal(js.headers["cache-control"].value, "no-store, private");
  assert.deepEqual(JSON.parse(js.body.data), { schema: "techlong/buyer-runtime/v1", ...binding });
  for (const [path, title] of [["/payment-success", "Returned from checkout"], ["/payment-cancel", "Checkout cancelled"]]) {
    const landing = run(event(host, path));
    assert.equal(landing.statusCode, 200);
    assert.ok(landing.body.data.includes(title));
    assert.ok(!landing.body.data.includes("unsafe-session-marker") && !landing.body.data.includes("https://bad.example"));
    assert.equal(landing.headers["referrer-policy"].value, "no-referrer");
    assert.equal(run(event(host, path, "POST")).statusCode, 405);
    assert.equal(run(event(host, path, "HEAD")).body, undefined);
    const legacy = event(sandboxLegacyBuyerHostname, path);
    assert.equal(run(legacy), legacy.request);
    assert.equal(run(event("another.sandbox.techlong.cloud", path)).statusCode, 404);
  }
  const staticAsset = event(host, "/main.dart.js");
  assert.equal(run(staticAsset), staticAsset.request);
  assert.equal(run(event("another.sandbox.techlong.cloud", buyerRuntimePath)).statusCode, 404);
  assert.throws(() => renderSandboxBuyerTenantRouting({ ...binding, buyerOrigin: `https://${sandboxLegacyBuyerHostname}` }), /TENANT_ORIGIN/);
  assert.throws(() => renderSandboxBuyerTenantRouting({ ...binding, apiOrigin: "https://first-acceptance.sandbox.techlong.cloud" }), /TENANT_ORIGIN/);
});
