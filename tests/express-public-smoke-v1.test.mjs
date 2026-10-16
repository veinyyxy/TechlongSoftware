import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { K, REQUESTS, publicPlan, publicWindow, requestOptions, validatePublicResponse } from '../ops/aws-sandbox/scripts/review-express-public-smoke-v1.mjs';
test('public scope has an independent finite window, cannot renew workload or consumed K2c authority', () => {
  const now = Date.parse(K.expiry) - 20 * 60000, p = publicPlan(now);
  assert.equal(p.expiresAt, Date.parse(K.expiry) - 5 * 60000); publicWindow(p, now);
  assert.throws(() => publicWindow(p, p.expiresAt), /WINDOW_EXPIRED/);
  assert.throws(() => publicWindow({ ...p, expiresAt: p.expiresAt + 1 }, now), /WINDOW_EXPIRED/);
  assert.equal(p.limits.httpGetAttempts, 3); assert.equal(p.limits.privateLoads, 0);
  assert.match(K.slot, /k3-public-smoke-v1/);
});
test('only exact three unsigned GETs on fixed TLS 443, no authorization/cookie or body options', () => {
  for (const spec of REQUESTS) {
    const opts = requestOptions(spec, new AbortController().signal);
    assert.equal(opts.hostname, K.host); assert.equal(opts.port, 443); assert.equal(opts.method, 'GET');
    assert.equal(opts.rejectUnauthorized, true); assert.equal(opts.agent, false); assert.equal(opts.minVersion, 'TLSv1.2');
    assert.equal(opts.headers['x-store-id'], K.store); assert.equal(opts.headers.authorization, undefined); assert.equal(opts.headers.cookie, undefined);
  }
  for (const path of ['/api/merchant/auth/login', '/api/saas/readiness', '/health?extra=1', 'https://foreign.example/'])
    assert.throws(() => requestOptions({ ...REQUESTS[0], path }, new AbortController().signal), /FIXED_REQUEST_REQUIRED/);
});
test('exact successful health/ready JSON excludes false positives or additional sensitive fields', () => {
  for (const spec of REQUESTS.slice(0, 2)) {
    validatePublicResponse(spec, 200, 'application/json; charset=utf-8', JSON.stringify(spec.json));
    assert.throws(() => validatePublicResponse(spec, 200, 'application/json', JSON.stringify({ ...spec.json, secret: 'not-a-real-secret' })), /RESPONSE_MISMATCH/);
    assert.throws(() => validatePublicResponse(spec, 200, 'text/html', '<html>ok</html>'), /JSON_CONTENT_TYPE/);
    assert.throws(() => validatePublicResponse(spec, 503, 'application/json', '{"status":"unavailable"}'), /UNEXPECTED_STATUS/);
  }
});
test('negative gate requires exact expected 401; login success, 404, redirect or generic error is not acceptance', () => {
  const spec = REQUESTS[2]; validatePublicResponse(spec, 401, 'text/html; charset=utf-8', 'Invalid signature');
  for (const code of [200, 302, 403, 404, 500]) assert.throws(() => validatePublicResponse(spec, code, 'text/plain', 'Invalid signature'), /UNEXPECTED_STATUS/);
  assert.throws(() => validatePublicResponse(spec, 401, 'text/plain', 'Missing token'), /UNSIGNED_GATE_NOT_PROVED/);
  assert.throws(() => validatePublicResponse(spec, 401, 'text/plain', 'x'.repeat(4097)), /UNEXPECTED_STATUS_OR_SIZE/);
});
test('entry imports only builtins, has no AWS/SQL/private loader/write APIs and consumes durable boundaries before request', async () => {
  const text = await readFile(new URL('../ops/aws-sandbox/scripts/review-express-public-smoke-v1.mjs', import.meta.url), 'utf8');
  for (const m of text.matchAll(/from '([^']+)'/g)) assert.match(m[1], /^node:/);
  assert.doesNotMatch(text, /GetSecretValueCommand|loadAcceptancePrivateSources|neon\(|\.provision\(|\.login\(/);
  assert.ok(text.indexOf('await save(K.slot') < text.indexOf('const overall = AbortSignal'));
  assert.ok(text.indexOf("'.intent.json'") < text.indexOf('const observed = await publicGet'));
  assert.match(text, /request\.end\(\)/); assert.doesNotMatch(text, /setInterval|request\.write|rejectUnauthorized: false/);
});
test('transport implementation has bounded identity encoding, no redirect follow and sanitized response/error persistence', async () => {
  const text = await readFile(new URL('../ops/aws-sandbox/scripts/review-express-public-smoke-v1.mjs', import.meta.url), 'utf8');
  assert.match(text, /bytes > 4096/); assert.match(text, /response\.statusCode !== spec\.status/);
  assert.match(text, /Math\.min\(10000, manifest\.plan\.expiresAt - Date\.now\(\)\)/); assert.match(text, /response\.destroy\(\)/);
  assert.doesNotMatch(text, /response\.headers\['location'\]|rawBody|bodySha256|e\.stack/);
});
