// K3a: three unsigned public HTTPS GETs, no AWS/SQL/private-control dependency.
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFile, open, mkdir, access } from 'node:fs/promises';
const ROOT = 'E:/NodejsProject/TechlongSoftware', BASE = 'F:/ChatGPT_workshop';
export const K = Object.freeze({ host: 'first-acceptance.sandbox.techlong.cloud',
  expiry: '2026-10-16T12:04:28.726Z', store: 'add89a8c-f43e-81b9-8287-0cb6c5c54f87',
  slot: BASE + '/techlong-express-k3-public-smoke-v1.permanent-slot.json',
  risk: 'docs/aws-auto-deployment-aurora-dual-mode-k3a-public-smoke-risk.md',
  evidence: 'ops/aws-sandbox/reviews/aurora-dual-mode-k2c-ready-reconciliation.executed.json' });
const canonical = v => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v)
  ? '[' + v.map(canonical).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
export const digest = v => createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : canonical(v)).digest('hex');
const equal = (a, b) => digest(a) === digest(b);
function must(ok, code) { if (!ok) throw Error('PUBLIC_SMOKE_' + code); }
export const REQUESTS = Object.freeze([
  Object.freeze({ path: '/health', status: 200, json: { status: 'ok' } }),
  Object.freeze({ path: '/ready', status: 200, json: { status: 'ready' } }),
  Object.freeze({ path: '/api/merchant/stores', status: 401, text: 'Invalid signature' }),
]);
export function publicPlan(preparedAt) {
  const p = { schema: 'techlong/public-smoke-plan/v1', preparedAt,
    expiresAt: Math.min(preparedAt + 30 * 60000, Date.parse(K.expiry) - 5 * 60000), workloadExpiresAt: K.expiry,
    hostname: K.host, port: 443, storeId: K.store, requests: REQUESTS,
    limits: { httpGetAttempts: 3, automaticRetries: 0, requestTimeoutMs: 10000, totalTimeoutMs: 45000, responseBytes: 4096,
      privateLoads: 0, secretValueReads: 0, awsCalls: 0, directSqlConnections: 0, applicationPosts: 0, resourceWrites: 0 },
    publicTransportProofOnly: true, positiveMerchantBusinessAcceptance: false, currentAwsResourceIdentityVerified: false,
    historicalReadyProofOnly: true, monthlyBudgetTargetUSD: 50, budgetIsHardCap: false, riskDocument: K.risk };
  publicWindow(p, preparedAt); return p;
}
export function publicWindow(p, now) {
  must(Number.isSafeInteger(p.preparedAt) && now >= p.preparedAt && now < p.expiresAt &&
    p.workloadExpiresAt === K.expiry && p.expiresAt === Math.min(p.preparedAt + 30 * 60000, Date.parse(K.expiry) - 5 * 60000), 'WINDOW_EXPIRED');
}
export function requestOptions(spec, signal) {
  must(REQUESTS.some(r => equal(r, spec)), 'FIXED_REQUEST_REQUIRED');
  return { protocol: 'https:', hostname: K.host, port: 443, servername: K.host, path: spec.path, method: 'GET',
    agent: false, minVersion: 'TLSv1.2', rejectUnauthorized: true, signal,
    headers: { accept: spec.json ? 'application/json' : 'text/plain', 'accept-encoding': 'identity',
      'user-agent': 'Techlong-K3-public-smoke/1', 'x-store-id': K.store } };
}
export function validatePublicResponse(spec, status, type, body) {
  must(status === spec.status && Buffer.byteLength(body) <= 4096, 'UNEXPECTED_STATUS_OR_SIZE');
  if (spec.json) {
    must(/^application\/json(?:;|$)/i.test(type), 'JSON_CONTENT_TYPE');
    let value; try { value = JSON.parse(body); } catch { must(false, 'JSON_REQUIRED'); }
    must(equal(value, spec.json), 'PUBLIC_RESPONSE_MISMATCH');
  } else must(/^text\/(?:html|plain)(?:;|$)/i.test(type) && body === spec.text, 'UNSIGNED_GATE_NOT_PROVED');
  return { path: spec.path, statusCode: status, responseBytes: Buffer.byteLength(body), expectedResponseVerified: true };
}
export function publicGet(spec, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => { if (!settled) { settled = true; if (error) reject(error); else resolve(result); } };
    const request = https.request(requestOptions(spec, signal), response => {
      const socket = response.socket, peer = socket.getPeerCertificate();
      if (!socket.authorized || !peer.fingerprint256 || response.statusCode !== spec.status ||
        response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
        response.destroy(); finish(Error('PUBLIC_SMOKE_TLS_STATUS_OR_ENCODING')); return;
      }
      const tls = { authorized: true, protocol: socket.getProtocol(), peerFingerprint256: peer.fingerprint256, peerValidTo: peer.valid_to };
      let bytes = 0; const chunks = [];
      response.on('data', chunk => { bytes += chunk.length; if (bytes > 4096) { response.destroy(); finish(Error('PUBLIC_SMOKE_BODY_LIMIT')); }
        else chunks.push(chunk); });
      response.on('error', () => finish(Error('PUBLIC_SMOKE_RESPONSE_FAILURE')));
      response.on('end', () => { try {
        finish(null, { ...validatePublicResponse(spec, response.statusCode, response.headers['content-type'] || '', Buffer.concat(chunks).toString('utf8')),
          tls, checkedAt: new Date().toISOString() });
      } catch (e) { finish(e); } });
    });
    request.on('error', () => finish(Error('PUBLIC_SMOKE_NETWORK_OR_TLS_FAILURE'))); request.end();
  });
}
async function save(file, value) {
  const f = await open(file, 'wx'); try { await f.writeFile(JSON.stringify(value, null, 2) + '\n'); await f.sync(); } finally { await f.close(); }
}
async function absent(file) { try { await access(file); must(false, 'SLOT_OR_DIRECTORY_OCCUPIED'); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
export async function publicInputs() {
  const capsuleRaw = await readFile(ROOT + '/' + K.evidence), capsule = JSON.parse(capsuleRaw);
  must(capsule.approvedManifestSha256 === 'f98bcd6ce2123c1e99085097e846937a8f389002f7637acd6cb1547efce2c5c0' &&
    capsule.state === 'READY_PLATFORM_AND_INITIALIZED_CONFIGURATION_INDEPENDENTLY_VERIFIED' && capsule.platformReadyVerified === true &&
    capsule.approvalConsumed === true && capsule.replayAllowed === false && capsule.workloadExpiresAt === K.expiry, 'HISTORICAL_READY_EVIDENCE');
  const allowed = [];
  for (const [dir, names] of [
    ['techlong-express-k2c-review-20261016-r2', ['binding', 'metadata', 'state', 'manifest', 'result']],
    ['techlong-express-k2c-run-20261016-r1', ['after-state', 'after', 'application-proof', 'binding', 'metadata', 'result', 'state', 'submission', 'transaction-ack']],
    ['techlong-express-k2c-inspect-20261016-r1', ['application-proof', 'binding', 'metadata', 'result', 'state']],
  ]) for (const name of names) allowed.push(BASE + '/' + dir + '/' + name + '.json');
  for (const name of ['permanent-slot', 'write-slot', 'inspect-slot']) allowed.push(BASE + '/techlong-express-k2c-ready-v1.' + name + '.json');
  must(equal(capsule.evidenceFiles.map(p => p.path).sort(), allowed.sort()), 'PUBLIC_HISTORY_PATHS');
  for (const p of capsule.evidenceFiles) must(digest(await readFile(p.path)) === p.rawFileSha256, 'PUBLIC_HISTORY_CHANGED');
  const pins = [];
  const pin = async (file, normalized = false) => { const raw = await readFile(file); pins.push({ file, sha256: digest(normalized ? raw.toString('utf8').replace(/\r\n/g, '\n') : raw), normalized }); };
  for (const name of ['ops/aws-sandbox/scripts/review-express-public-smoke-v1.mjs', 'tests/express-public-smoke-v1.test.mjs', K.risk]) await pin(ROOT + '/' + name);
  for (const name of ['app.js', 'services/saas/tenant-readiness-v1.cjs', 'services/store_context.js', 'services/saas/buyer_access_service.js',
    'routes/merchant_stores.js', 'secutiry/merchant_auth.js', 'secutiry/verify_signature.js']) await pin('E:/NodejsProject/SpeedFeast_Backend_main/' + name, true);
  return { schema: 'techlong/public-smoke-binding/v1', nodeVersion: process.version, initializedAndReadyCapsuleRawSha256: digest(capsuleRaw),
    historicalApiCheckedAt: capsule.independent.applicationProof.checkedAt, evidenceFiles: capsule.evidenceFiles, pins,
    localBackendSourceIsNotFreshDeployedImageProof: true };
}
export async function main(raw = process.argv.slice(2)) {
  must(raw.length % 2 === 0, 'ARGUMENTS'); const pairs = [];
  for (let n = 0; n < raw.length; n += 2) pairs.push([raw[n], raw[n + 1]]);
  const args = Object.fromEntries(pairs), mode = args['--mode'], out = path.resolve(args['--output'] || '');
  const keys = mode === 'Prepare' ? ['--mode', '--output'] : ['--mode', '--output', '--manifest', '--approved-sha'];
  const directory = d => path.dirname(d).toLowerCase() === path.resolve(BASE).toLowerCase() && /^techlong-express-k3-public-[a-z0-9-]+$/.test(path.basename(d));
  must(['Prepare', 'Run'].includes(mode) && pairs.length === keys.length && keys.every(k => args[k]) &&
    new Set(pairs.map(p => p[0])).size === pairs.length && Object.keys(args).every(k => keys.includes(k)) && directory(out) &&
    process.cwd().toLowerCase() === path.resolve(ROOT).toLowerCase(), 'ARGUMENTS_OR_WORKSPACE');
  must(!['NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'GLOBAL_AGENT_HTTP_PROXY']
    .some(k => process.env[k] || process.env[k.toLowerCase()]) && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'TRANSPORT_ENVIRONMENT');
  await mkdir(out); let slotConsumed = false, attempts = 0; const observations = [];
  try {
    const binding = await publicInputs(); await save(out + '/binding.json', binding); await absent(K.slot);
    if (mode === 'Prepare') {
      const body = { schema: 'techlong/public-smoke-manifest/v1', plan: publicPlan(Date.now()), binding, preparationIsNotExecutionApproval: true };
      const manifest = { ...body, manifestSha256: digest(body) }; await save(out + '/manifest.json', manifest);
      const result = { mode, outcome: 'PUBLIC_SMOKE_PREPARED_REQUIRES_EXACT_APPROVAL', manifestSha256: manifest.manifestSha256,
        expiresAt: new Date(manifest.plan.expiresAt).toISOString(), networkCalls: 0, privateLoads: 0, resourceWrites: 0, slotsConsumed: 0 };
      await save(out + '/result.json', result); console.log(JSON.stringify(result, null, 2)); return;
    }
    const file = path.resolve(args['--manifest']); must(path.basename(file) === 'manifest.json' && directory(path.dirname(file)), 'MANIFEST_PATH');
    const manifest = JSON.parse(await readFile(file, 'utf8')), { manifestSha256, ...body } = manifest;
    must(/^[a-f0-9]{64}$/.test(args['--approved-sha']) && manifestSha256 === args['--approved-sha'] && digest(body) === manifestSha256 &&
      manifest.schema === 'techlong/public-smoke-manifest/v1' && equal(binding, manifest.binding) &&
      equal(publicPlan(manifest.plan.preparedAt), manifest.plan), 'EXACT_APPROVAL');
    publicWindow(manifest.plan, Date.now());
    await save(K.slot, { schema: 'techlong/public-smoke-attempt/v1', manifestSha256, runDirectory: out, consumedAt: new Date().toISOString(), retryAllowed: false }); slotConsumed = true;
    const overall = AbortSignal.timeout(45000);
    for (const spec of REQUESTS) {
      publicWindow(manifest.plan, Date.now()); overall.throwIfAborted();
      must(equal(binding, await publicInputs()), 'CODE_OR_HISTORY_CHANGED');
      await save(out + '/request-' + (attempts + 1) + '.intent.json', { manifestSha256, path: spec.path, method: 'GET', enteredAt: new Date().toISOString(), retryAllowed: false });
      publicWindow(manifest.plan, Date.now()); overall.throwIfAborted(); attempts++;
      const observed = await publicGet(spec, AbortSignal.any([overall, AbortSignal.timeout(Math.min(10000, manifest.plan.expiresAt - Date.now()))])); observations.push(observed);
      await save(out + '/response-' + attempts + '.json', observed);
    }
    const result = { mode, outcome: 'PUBLIC_HTTPS_READINESS_AND_UNSIGNED_GATE_VERIFIED', manifestSha256, attempts, observations,
      slotConsumed, privateLoads: 0, secretValues: 0, awsCalls: 0, directSqlConnections: 0, applicationPosts: 0, resourceWrites: 0,
      positiveMerchantBusinessAcceptance: false, currentAwsResourceIdentityVerified: false, automaticRetries: 0 };
    await save(out + '/result.json', result); console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    const result = { mode, outcome: 'STOP_PRESERVE_EVIDENCE_NO_HTTP_RETRY', code: /^PUBLIC_SMOKE_[A-Z0-9_]+$/.test(e.message || '') ? e.message : 'PUBLIC_SMOKE_LOCAL_OR_PROVIDER_FAILURE',
      attempts, slotConsumed, observations, automaticRetries: 0, privateLoads: 0, resourceWrites: 0 };
    await save(out + '/failure.json', result); console.error(JSON.stringify(result, null, 2)); process.exitCode = 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
