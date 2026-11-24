import base from "./cloudformation/buyer-web-sandbox-v1.domain.candidate.template.json" with { type: "json" };
import { bindSandboxBuyerOrigin, sandboxBuyerPaymentPaths, sandboxBuyerRuntimePath } from "../../lib/deployments/execution/first-open-buyer-binding.ts";

export const sandboxLegacyBuyerHostname = "buyer.sandbox.techlong.cloud";
export const buyerRuntimePath = sandboxBuyerRuntimePath;
const { success: successPath, cancel: cancelPath } = sandboxBuyerPaymentPaths;

export interface SandboxBuyerRouteBinding {
  readonly tenantId: string;
  readonly buyerOrigin: string;
  readonly apiOrigin: string;
}

const page = (title: string, message: string) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><main><h1>${title}</h1><p>${message}</p><a href="/">Return to the store</a></main></html>`;

/** Pure CloudFormation candidate. The exact original distribution, bucket,
 * objects, old alias, and two old DNS records remain in place. The existing
 * certificate parameter must be separately pinned to an ISSUED us-east-1
 * certificate that covers both exact aliases before any stack update. */
export function renderSandboxBuyerTenantRouting(binding: SandboxBuyerRouteBinding) {
  const expected = bindSandboxBuyerOrigin(binding.tenantId), host = expected.buyerHostname;
  if (binding.buyerOrigin !== expected.buyerOrigin || binding.apiOrigin !== expected.apiOrigin) {
    throw Error("SANDBOX_BUYER_TENANT_ORIGIN");
  }
  const runtime = { schema: "techlong/buyer-runtime/v1", buyerOrigin: binding.buyerOrigin, apiOrigin: binding.apiOrigin,
    tenantId: binding.tenantId } as const;
  // The only values interpolated in the edge program are the exact DNS host,
  // the non-secret runtime response, and predefined landing copy. Neither
  // the query nor client-provided endpoints are used as a routing authority.
  const functionCode = `function handler(event) {
  var request = event.request;
  var host = request.headers.host && request.headers.host.value;
  if (host === ${JSON.stringify(sandboxLegacyBuyerHostname)}) return request;
  var uri = request.uri;
  if (uri !== ${JSON.stringify(buyerRuntimePath)} && uri !== ${JSON.stringify(successPath)} && uri !== ${JSON.stringify(cancelPath)}) return request;
  var headers = {
    'cache-control': { value: 'no-store, private' },
    'content-security-policy': { value: "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" },
    'referrer-policy': { value: 'no-referrer' },
    'x-content-type-options': { value: 'nosniff' }
  };
  if (host !== ${JSON.stringify(host)}) return { statusCode: 404, statusDescription: 'Not Found', headers: headers };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    headers.allow = { value: 'GET, HEAD' };
    return { statusCode: 405, statusDescription: 'Method Not Allowed', headers: headers };
  }
  var config = uri === ${JSON.stringify(buyerRuntimePath)};
  headers['content-type'] = { value: config ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8' };
  var response = { statusCode: 200, statusDescription: 'OK', headers: headers };
  if (request.method === 'HEAD') return response;
  response.body = { encoding: 'text', data: config ? ${JSON.stringify(JSON.stringify(runtime))} :
    uri === ${JSON.stringify(successPath)} ? ${JSON.stringify(page("Returned from checkout", "Check your order in the store for its current payment status."))} :
    ${JSON.stringify(page("Checkout cancelled", "This return page does not change your payment or order. Check your order before trying again."))} };
  return response;
}`;

  const original = structuredClone(base);
  const distribution = original.Resources.BuyerDistribution;
  const config = distribution.Properties.DistributionConfig;
  const alias = (old: typeof original.Resources.BuyerAliasIpv4 | typeof original.Resources.BuyerAliasIpv6) => ({
    ...old, Properties: { ...old.Properties, Name: host + "." },
  });
  return {
    ...original,
    Description: "DRAFT ONLY - shared buyer distribution with one additional Sandbox tenant; no release or execution approval",
    Resources: {
      ...original.Resources,
      BuyerDistribution: { ...distribution, Properties: { ...distribution.Properties, DistributionConfig: {
        ...config, Comment: "Techlong shared sandbox buyer Web; tenant-specific metadata and Stripe returns",
        Aliases: [...config.Aliases, host],
        DefaultCacheBehavior: { ...config.DefaultCacheBehavior, FunctionAssociations: [{
          EventType: "viewer-request", FunctionARN: { "Fn::GetAtt": ["BuyerTenantRouting", "FunctionARN"] },
        }] },
      } } },
      BuyerTenantRouting: { Type: "AWS::CloudFront::Function", Properties: {
        Name: "techlong-sandbox-buyer-tenant-routing-v1", AutoPublish: true,
        FunctionConfig: { Comment: "Serve exact-host public config and neutral Checkout return pages", Runtime: "cloudfront-js-2.0" },
        FunctionCode: functionCode,
      } },
      BuyerTenantAliasIpv4: alias(original.Resources.BuyerAliasIpv4),
      BuyerTenantAliasIpv6: alias(original.Resources.BuyerAliasIpv6),
    },
    Outputs: { ...original.Outputs, BuyerTenantOrigin: { Value: runtime.buyerOrigin } },
    Parameters: { ...original.Parameters, SandboxBuyerCertificateArn: {
      ...original.Parameters.SandboxBuyerCertificateArn,
      Description: `Approved ISSUED us-east-1 certificate covering both ${sandboxLegacyBuyerHostname} and ${host}; no default`,
    } },
  };
}
