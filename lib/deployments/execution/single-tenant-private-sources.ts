import { createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import { Rs256SaaSControlTokenProvider } from "./control-jwt.ts";
import { NodeMtlsSaaSControlTransport } from "./control-https-transport.ts";
import type { SaaSControlTokenProvider, SaaSControlTransport } from "./control-client.ts";
import type { TenantPaymentCredentialSource } from "./tenant-runtime-material.ts";
import type { TenantResourceFence, TenantExternalOperationFence } from "./contracts.ts";
import type { AwsEcsCellDeploymentPlan } from "../types.ts";
import { assertTenantResourceFence } from "./tenant-database.ts";
import { validateSingleDeploymentScope, type SingleDeploymentClaimScope } from "./single-deployment-scope.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";

export const ACCEPTANCE_CONTROL_INPUTS = Object.freeze({ issuer: "https://techlong.cloud", subject: "techlong-first-acceptance",
  hostname: "first-acceptance.sandbox.techlong.cloud", baseDomain: "sandbox.techlong.cloud",
  publicKeySecretName: "techlong/sandbox/control-public-key-first-acceptance",
  clientCaSha256: "e60ee2d18d79c7e28c1e1dae192798ba7e18c5a106dcb5e280c1dd5643d27d5d" });
export interface AcceptanceCredentialBinding {
  scope: SingleDeploymentClaimScope; workspaceId: string; productId: string; templateVersionId: string; plan: AwsEcsCellDeploymentPlan;
}
export interface AcceptancePrivateMaterial {
  signingPrivateKeyPem: string; signingPublicKeyPem: string;
  clientCertificatePem: string; clientPrivateKeyPem: string; clientCaPem: string;
  stripeSecretKey: string; stripeWebhookSecret: string; stripePublishableKey: string;
}
function fail(code: string): never { throw Object.assign(Error(code), { code, retryable: false }); }
export async function validateAcceptanceCredentialBinding(raw: AcceptanceCredentialBinding) {
  const v = structuredClone(raw), s = validateSingleDeploymentScope(v.scope);
  if (!/^ws_[a-f0-9]{32}$/.test(v.workspaceId) || v.productId !== "prd_restaurant_order_system" ||
    v.templateVersionId !== "tplver_9c175436f0a14d9aa7f5fdfc2b5c139e" || v.plan.mode !== "aws_sandbox" ||
    v.plan.cellKey !== "cell-sandbox-1" || v.plan.deploymentProfileKey !== "standard-v1" || await sha256Hex(v.plan) !== s.planHash ||
    v.plan.resources.tenant.costTags.AppInstanceId !== s.appInstanceId || v.plan.resources.tenant.costTags.WorkspaceId !== v.workspaceId ||
    v.plan.resources.tenant.costTags.ProductId !== v.productId) fail("ACCEPTANCE_CREDENTIAL_BINDING_INVALID");
  return Object.freeze({ ...v, scope: s });
}
export function assertTestPaymentMaterial(v: Pick<AcceptancePrivateMaterial, "stripeSecretKey" | "stripeWebhookSecret" | "stripePublishableKey">) {
  if (!/^sk_test_[A-Za-z0-9]{16,256}$/.test(v.stripeSecretKey) || !/^whsec_[A-Za-z0-9]{16,256}$/.test(v.stripeWebhookSecret) ||
    !/^pk_test_[A-Za-z0-9]{16,256}$/.test(v.stripePublishableKey) ||
    [v.stripeSecretKey, v.stripeWebhookSecret, v.stripePublishableKey].some(s => /replace|placeholder|dummy|example|your[_-]?/i.test(s))) fail("ACCEPTANCE_TEST_PAYMENT_INPUT_INVALID");
}
export async function assertAcceptanceResourceFence(binding: AcceptanceCredentialBinding, fence: TenantResourceFence) {
  assertTenantResourceFence(fence);
  const i = fence.identity, s = binding.scope, db = binding.plan.resources.tenant.database;
  const ownership = { appInstanceId: s.appInstanceId, workspaceId: binding.workspaceId, productId: binding.productId,
    environmentId: s.environmentId, cellKey: "cell-sandbox-1" };
  const stableHash = await sha256Hex(ownership), stem = s.appInstanceId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-28);
  if (fence.ownerDeploymentId !== s.deploymentId || i.appInstanceId !== ownership.appInstanceId || i.workspaceId !== ownership.workspaceId ||
    i.productId !== ownership.productId || i.environmentId !== ownership.environmentId || i.cellKey !== ownership.cellKey ||
    i.databaseName !== db.databaseName || i.roleName !== db.roleName || i.stableIdentityHash !== stableHash ||
    i.secretName !== `techlong/sandbox/tenant/${stem}_${stableHash.slice(0, 10)}/runtime`) fail("ACCEPTANCE_CREDENTIAL_FOREIGN_RESOURCE_REJECTED");
}
async function assertPaymentFence(b: AcceptanceCredentialBinding, f: TenantResourceFence, e: TenantExternalOperationFence) {
  await assertAcceptanceResourceFence(b, f);
  if (e.schemaVersion !== 1 || e.intent !== "provision" || e.state !== "active" || e.ownerDeploymentId !== f.ownerDeploymentId ||
    canonicalJson(e.resourceFence) !== canonicalJson(f) || !Number.isSafeInteger(e.epoch) || e.epoch < 1 ||
    !/^[a-f0-9]{64}$/.test(e.operationHash) || e.marker !== `tl_epoch_${f.identity.stableIdentityHash.slice(0, 24)}_g${f.generation}_e${e.epoch}`) fail("ACCEPTANCE_PAYMENT_EPOCH_REJECTED");
}
/** New wrappers keep legacy transport's PEM fields below closure/private
 * boundaries. Serialization exposes metadata only, not delegates or keys.
 * Construction is local validation: no TLS request, token or payment API call.
 */
export async function createAcceptancePrivateSources(bindingInput: AcceptanceCredentialBinding, privateInput: AcceptancePrivateMaterial,
  trusted: { now?: number } = {}) {
  // The historically approved CA cannot be overridden by a CLI/DI caller.
  const now = trusted.now ?? Date.now(), trustedCaSha = ACCEPTANCE_CONTROL_INPUTS.clientCaSha256;
  const binding = await validateAcceptanceCredentialBinding(bindingInput), material = { ...privateInput };
  assertTestPaymentMaterial(material);
  let signing, publicKey, ca, client, clientKey;
  try { signing = createPrivateKey(material.signingPrivateKeyPem); publicKey = createPublicKey(material.signingPublicKeyPem);
    ca = new X509Certificate(material.clientCaPem); client = new X509Certificate(material.clientCertificatePem); clientKey = createPrivateKey(material.clientPrivateKeyPem); }
  catch { fail("ACCEPTANCE_LOCAL_KEY_OR_CERTIFICATE_INVALID"); }
  if (signing.asymmetricKeyType !== "rsa" || (signing.asymmetricKeyDetails?.modulusLength ?? 0) !== 3072 ||
    !createPublicKey(signing).export({ type: "spki", format: "der" }).equals(publicKey.export({ type: "spki", format: "der" })) ||
    await sha256Hex(material.clientCaPem) !== trustedCaSha || !ca.ca || !ca.verify(ca.publicKey) || client.ca ||
    !client.verify(ca.publicKey) || client.issuer !== ca.subject || !client.checkPrivateKey(clientKey) ||
    canonicalJson(client.keyUsage) !== canonicalJson(["1.3.6.1.5.5.7.3.2"]) ||
    [ca, client].some(c => Date.parse(c.validFrom) > now || Date.parse(c.validTo) <= now + 86400000)) fail("ACCEPTANCE_KEY_PAIR_OR_CERTIFICATE_MISMATCH");
  const publicKeySha256 = await sha256Hex(material.signingPublicKeyPem), keyId = `acceptance-${publicKeySha256.slice(0, 24)}`;
  let tokens: Rs256SaaSControlTokenProvider | undefined = new Rs256SaaSControlTokenProvider({ issuer: ACCEPTANCE_CONTROL_INPUTS.issuer,
    subject: ACCEPTANCE_CONTROL_INPUTS.subject, keyId, lifetimeSeconds: 60, privateKeyPem: material.signingPrivateKeyPem });
  let transport: NodeMtlsSaaSControlTransport | undefined = new NodeMtlsSaaSControlTransport({ baseDomain: ACCEPTANCE_CONTROL_INPUTS.baseDomain,
    clientCertificatePem: material.clientCertificatePem, clientPrivateKeyPem: material.clientPrivateKeyPem,
    // ALB/ACM server trust is the bundled public root set, NOT client CA trust.
    trustedCaPem: rootCertificates.join("\n"), timeoutMs: 15000 });
  let payment: { stripeSecretKey: string; stripeWebhookSecret: string } | undefined = {
    stripeSecretKey: material.stripeSecretKey, stripeWebhookSecret: material.stripeWebhookSecret };
  const controlTokens = Object.freeze<SaaSControlTokenProvider>({ async issue(input) {
    input.signal.throwIfAborted(); if (!tokens || input.instanceId !== binding.scope.appInstanceId) fail("ACCEPTANCE_CONTROL_TOKEN_SCOPE_REJECTED");
    return tokens.issue(input);
  } });
  const controlTransport = Object.freeze<SaaSControlTransport>({ async send(request, input) {
    input.signal.throwIfAborted(); let url: URL;
    try { url = new URL(request.url); } catch { fail("ACCEPTANCE_CONTROL_ENDPOINT_REJECTED"); }
    if (!transport || url.hostname !== ACCEPTANCE_CONTROL_INPUTS.hostname || url.protocol !== "https:" || url.port !== "8443" || url.username || url.password)
      fail("ACCEPTANCE_CONTROL_ENDPOINT_REJECTED");
    return transport.send(request, input);
  } });
  const paymentCredentials = Object.freeze<TenantPaymentCredentialSource>({ async lease(input) {
    input.signal.throwIfAborted(); await assertPaymentFence(binding, input.fence, input.externalFence); input.signal.throwIfAborted();
    if (!payment) fail("ACCEPTANCE_PRIVATE_SOURCES_DISPOSED");
    let held: { stripeSecretKey: string; stripeWebhookSecret: string } | undefined = { ...payment };
    return Object.freeze({ read() { input.signal.throwIfAborted(); if (!payment || !held) fail("ACCEPTANCE_PAYMENT_LEASE_DISPOSED"); return { ...held }; },
      dispose() { held = undefined; } });
  } });
  const summary = Object.freeze({ scopeSha256: await sha256Hex(binding.scope), publicKeySha256, clientCertificateSha256: await sha256Hex(material.clientCertificatePem),
    clientCaSha256: trustedCaSha, clientValidUntil: client.validTo, rsaBits: 3072,
    issuer: ACCEPTANCE_CONTROL_INPUTS.issuer, keyId, jwtLifetimeSeconds: 60, exactControlHostname: ACCEPTANCE_CONTROL_INPUTS.hostname,
    serverTrust: "NODE_BUNDLED_PUBLIC_ROOTS" as const, paymentInputShapeVerified: true, paymentProviderAuthenticated: false,
    webhookDeliveryVerified: false, keyValuesIncluded: false, runtimeEnabled: false });
  // Strings/KeyObjects cannot promise forensic memory erasure in JavaScript;
  // disposal only releases our retained references and forbids future leases.
  return Object.freeze({ controlTokens, controlTransport, paymentCredentials, summary,
    publicParameters: Object.freeze({ ControlIssuer: ACCEPTANCE_CONTROL_INPUTS.issuer,
      CorsAllowedOrigins: `https://${ACCEPTANCE_CONTROL_INPUTS.hostname},https://techlong.cloud`, StripePublishableKey: material.stripePublishableKey,
      StripeSuccessUrl: `https://${ACCEPTANCE_CONTROL_INPUTS.hostname}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      StripeCancelUrl: `https://${ACCEPTANCE_CONTROL_INPUTS.hostname}/payment-cancel` }),
    dispose() { tokens = undefined; transport = undefined; payment = undefined; }
  });
}
