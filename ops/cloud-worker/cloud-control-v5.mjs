// Minimal control-only material. No Stripe/password/DB source or local loader.
import { createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import { Rs256SaaSControlTokenProvider } from '../../lib/deployments/execution/control-jwt.ts';
import { NodeMtlsSaaSControlTransport } from '../../lib/deployments/execution/control-https-transport.ts';
import { canonicalJson, sha256Hex } from '../../lib/deployments/execution/hash.ts';
import { requireCloudV5 as must } from './cloud-session-v5.mjs';
export const CLOUD_CONTROL_V5 = Object.freeze({
  schema: 'techlong/cloud-worker-control-material/v1', appInstanceId: 'app_e897a4377bce498b9c5ee9e64509dcad',
  hostname: 'first-acceptance.sandbox.techlong.cloud', issuer: 'https://techlong.cloud', subject: 'techlong-first-acceptance',
  secretName: 'techlong/sandbox/deployment-worker/control-first-acceptance-v1',
});
const P = CLOUD_CONTROL_V5, paths = ['/api/saas/readiness', '/api/saas/control'];
const fields = ['schema', 'appInstanceId', 'signingPrivateKeyPem', 'signingPublicKeyPem', 'clientCertificatePem', 'clientPrivateKeyPem', 'clientCaPem'];
const sha = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
function exactKeys(v, wanted) { must(v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).sort().join(',') === [...wanted].sort().join(','), 'CONTROL_EXACT_KEYS'); }
function fingerprints(v) {
  exactKeys(v, ['publicKeySha256', 'clientCertificateSha256', 'clientCaSha256']);
  must(Object.values(v).every(sha), 'CONTROL_PUBLIC_FINGERPRINTS');
}
/** expected comes from the independently bound PUBLIC capsule, never from the
 * Secret being read. Library construction is not a private-read authorization. */
export async function createCloudControlSourcesV5(payload, expected, { now = Date.now() } = {}) {
  try {
    fingerprints(expected); exactKeys(payload, fields);
    must(Object.values(payload).every(v => typeof v === 'string') && payload.schema === P.schema && payload.appInstanceId === P.appInstanceId &&
      Buffer.byteLength(JSON.stringify(payload)) <= 60000 && Number.isSafeInteger(now), 'CONTROL_MATERIAL_SHAPE');
    const signing = createPrivateKey(payload.signingPrivateKeyPem), pub = createPublicKey(payload.signingPublicKeyPem),
      ca = new X509Certificate(payload.clientCaPem), client = new X509Certificate(payload.clientCertificatePem), key = createPrivateKey(payload.clientPrivateKeyPem);
    must(signing.asymmetricKeyType === 'rsa' && signing.asymmetricKeyDetails?.modulusLength === 3072 &&
      createPublicKey(signing).export({ type: 'spki', format: 'der' }).equals(pub.export({ type: 'spki', format: 'der' })) &&
      ca.ca && ca.verify(ca.publicKey) && !client.ca && client.verify(ca.publicKey) && client.issuer === ca.subject && client.checkPrivateKey(key) &&
      canonicalJson(client.keyUsage) === canonicalJson(['1.3.6.1.5.5.7.3.2']) &&
      [ca, client].every(c => Date.parse(c.validFrom) <= now && Date.parse(c.validTo) > now + 86400000), 'CONTROL_KEY_OR_CERTIFICATE');
    must(await sha256Hex(payload.signingPublicKeyPem) === expected.publicKeySha256 &&
      await sha256Hex(payload.clientCertificatePem) === expected.clientCertificateSha256 &&
      await sha256Hex(payload.clientCaPem) === expected.clientCaSha256, 'CONTROL_FINGERPRINT_DRIFT');
    let tokens = new Rs256SaaSControlTokenProvider({ issuer: P.issuer, subject: P.subject,
      keyId: `acceptance-${expected.publicKeySha256.slice(0, 24)}`, lifetimeSeconds: 60, privateKeyPem: payload.signingPrivateKeyPem });
    let transport = new NodeMtlsSaaSControlTransport({ baseDomain: 'sandbox.techlong.cloud',
      clientCertificatePem: payload.clientCertificatePem, clientPrivateKeyPem: payload.clientPrivateKeyPem,
      trustedCaPem: rootCertificates.join('\n'), timeoutMs: 15000 });
    let tokenAttempts = 0, httpAttempts = 0, halted = false;
    const issued = new Set();
    const controlTokens = Object.freeze({ async issue(request) {
      try {
        request.signal.throwIfAborted();
        must(tokens && !halted && tokenAttempts < 2 && request.instanceId === P.appInstanceId &&
          request.audience === `speedfeast-instance:${P.appInstanceId}` && request.scope === 'speedfeast:control', 'CONTROL_TOKEN_SCOPE');
        tokenAttempts++;
        const token = await tokens.issue(request); issued.add(`Bearer ${token}`); return token;
      } catch { halted = true; throw Error('CLOUD_WORKER_V5_CONTROL_TOKEN_REJECTED'); }
    } });
    const controlTransport = Object.freeze({ async send(request, options) {
      try {
        options.signal.throwIfAborted(); const url = new URL(request.url), auth = request.headers?.authorization;
        must(transport && !halted && httpAttempts < 2 && request.method === 'GET' && request.body === undefined &&
          url.protocol === 'https:' && url.hostname === P.hostname && url.port === '8443' && !url.username && !url.password &&
          !url.search && !url.hash && url.pathname === paths[httpAttempts] && request.headers?.host === P.hostname && issued.has(auth), 'CONTROL_GET_SCOPE');
        // Consume before send, including ambiguous timeout; no transport retry.
        issued.delete(auth); httpAttempts++;
        return await transport.send(request, options);
      } catch { halted = true; throw Error('CLOUD_WORKER_V5_CONTROL_GET_REQUIRES_INSPECT_NO_RETRY'); }
    } });
    return Object.freeze({ controlTokens, controlTransport,
      summary: Object.freeze({ schema: 'techlong/cloud-control-sources/v5', ...expected,
        appInstanceId: P.appInstanceId, hostname: P.hostname, paymentSourceExposed: false, databaseSourceExposed: false,
        keyValuesIncluded: false, serverTrust: 'NODE_BUNDLED_PUBLIC_ROOTS', runtimeEnabled: false }),
      counts: () => ({ tokenAttempts, httpAttempts }),
      dispose() { halted = true; tokens = undefined; transport = undefined; issued.clear(); } });
  } catch { throw Error('CLOUD_WORKER_V5_CONTROL_MATERIAL_REJECTED'); }
}
export function createFixedControlSecretLoaderV5({ reference, expected, getSecretValue, beforeRead }) {
  exactKeys(reference, ['arn', 'versionId']); fingerprints(expected);
  must(new RegExp('^arn:aws:secretsmanager:ca-central-1:402010193138:secret:' + P.secretName + '-[A-Za-z0-9]{6}$').test(reference.arn) &&
    typeof reference.versionId === 'string' && /^[A-Za-z0-9-]{32,64}$/.test(reference.versionId) &&
    typeof getSecretValue === 'function' && typeof beforeRead === 'function', 'CONTROL_SECRET_REFERENCE');
  const ref = structuredClone(reference), pins = structuredClone(expected);
  let attempted = false;
  return Object.freeze({ async loadOnce(signal) {
    must(!attempted, 'CONTROL_SECRET_ALREADY_ATTEMPTED'); attempted = true;
    try {
      signal.throwIfAborted(); await beforeRead(await sha256Hex({ reference: ref, expected: pins }), signal); signal.throwIfAborted();
      const r = await getSecretValue({ SecretId: ref.arn, VersionId: ref.versionId }, signal);
      signal.throwIfAborted();
      must(r?.ARN === ref.arn && r.Name === P.secretName && r.VersionId === ref.versionId && !r.SecretBinary &&
        canonicalJson(r.VersionStages) === canonicalJson(['AWSCURRENT']) && typeof r.SecretString === 'string' &&
        Buffer.byteLength(r.SecretString) <= 60000, 'FIXED_CONTROL_SECRET_DRIFT');
      return await createCloudControlSourcesV5(JSON.parse(r.SecretString), pins);
    } catch { throw Error('CLOUD_WORKER_V5_CONTROL_LOAD_REQUIRES_INSPECT_NO_RETRY'); }
  } });
}
