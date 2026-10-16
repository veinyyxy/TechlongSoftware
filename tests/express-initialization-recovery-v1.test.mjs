import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { B, hash, assertPristine, assertFreshPristine, assertRecoveryAdmission, assertRecoveryExecution, guardedControlTransport } from '../ops/aws-sandbox/scripts/express-initialization-recovery-plan-v1.mjs';
import { A } from '../ops/aws-sandbox/scripts/express-initialization-audit-plan-v1.mjs';
import { compileManualRecoveryPayload, clearFirstOwnerPassword } from '../ops/aws-sandbox/scripts/express-initialization-recovery-control-v1.mjs';
import { firstClaimFixture } from './fixtures/express-first-claim-v1.ts';
const signal = () => new AbortController().signal;
function plan(now = Date.now()) {
  const expires = new Date(now + 8 * 3600000).toISOString();
  return { preparedAt: now, admissionExpiresAt: now + 2 * 3600000, executionExpiresAt: now + 2 * 3600000 + 15 * 60000,
    workloadExpiresAt: expires, hostname: 'first-acceptance.sandbox.techlong.cloud', fencedIdempotencyKey: 'tlctl-exact-fixed', storeId: 'fixed-store',
    historicalScope: { appInstanceId: 'app_exact', configurationHash: 'c'.repeat(64) },
    controlPolicy: { imageRevision: 'sha256:' + 'd'.repeat(64), business: { firstOwnerUsername: 'exact_admin' } },
    currentPristineMaximumAgeMs: 120000 };
}
function receipt(now = Date.now()) { return { checkedAt: new Date(now).toISOString(), readOnly: true, connections: 1, sqlCalls: 14,
  clientTlsVerified: true, backendTlsVerified: true, target: { database: A.database, databaseOid: A.databaseOid, endpoint: A.endpoint },
  facts: { outcome: 'PRISTINE_UNINITIALIZED_NO_POST_AUTHORITY', fullPristineSnapshotMatches: true, catalogAndOwnershipVerified: true,
    rowCountsSha256: A.pristineCounts, provisionAuthorized: false } }; }
function request(p, method, route) { return { method, url: 'https://' + p.hostname + ':8443' + route,
  headers: { 'idempotency-key': p.fencedIdempotencyKey }, body: method === 'POST' ? JSON.stringify({ instance: {
    external_instance_id: p.historicalScope.appInstanceId, metadata: { image_revision: p.controlPolicy.imageRevision,
      configuration_hash: p.historicalScope.configurationHash } }, first_owner: { username: p.controlPolicy.business.firstOwnerUsername } }) : undefined }; }

test('another audit permit is required: stale or non-pristine evidence cannot authorize recovery', () => {
  const now = Date.now(), p = plan(now), r = receipt(now); assertPristine(r); assertFreshPristine(r, p, now + 120000);
  assert.throws(() => assertFreshPristine(r, p, now + 120001), /SNAPSHOT_TOO_OLD/);
  for (const mutate of [v => { v.facts.fullPristineSnapshotMatches = false; }, v => { v.facts.outcome = 'COMMITTED'; },
    v => { v.target.databaseOid = '2'; }, v => { v.sqlCalls = 13; }, v => { v.backendTlsVerified = false; }]) {
    const v = receipt(now); mutate(v); assert.throws(() => assertPristine(v), /CURRENT_PRISTINE_REQUIRED/);
  }
});
test('finite independent admission/execution windows neither reuse K2a slots nor renew workload', () => {
  const now = Date.now(), p = plan(now); assertRecoveryAdmission(p, now); assertRecoveryExecution(p, p.admissionExpiresAt);
  assert.throws(() => assertRecoveryAdmission(p, p.admissionExpiresAt), /ADMISSION_EXPIRED/);
  assert.throws(() => assertRecoveryExecution(p, p.executionExpiresAt), /EXECUTION_EXPIRED/);
  assert.throws(() => assertRecoveryAdmission({ ...p, workloadExpiresAt: new Date(now + 10 * 60000).toISOString() }, now), /ADMISSION_EXPIRED/);
  assert.notEqual(B.slot, A.slot); assert.notEqual(B.postSlot, B.slot);
});
test('only exact fixed control routes/host/port without query or redirects are admitted', async () => {
  const p = plan(); let calls = 0;
  for (const url of ['https://other.cloud:8443/api/saas/bootstrap', 'https://' + p.hostname + '/api/saas/bootstrap',
    'https://' + p.hostname + ':8443/api/saas/bootstrap?x=1', 'https://' + p.hostname + ':8443/api/saas/other',
    'http://' + p.hostname + ':8443/api/saas/bootstrap']) {
    const g = guardedControlTransport({ plan: p, mode: 'Run', delegate: { send: async () => { calls++; return { status: 200, body: {} }; } } });
    await assert.rejects(g.transport.send({ method: 'GET', url, headers: {} }, { signal: signal() }), /HTTP_SCOPE_OR_LIMIT/);
  }
  assert.equal(calls, 0);
});
test('one fixed POST requires new durable-boundary callback, exact new image, username and idempotency key', async () => {
  const p = plan(); let entries = 0, sent = 0;
  const g = guardedControlTransport({ plan: p, mode: 'Run', beforePost: async () => { entries++; },
    delegate: { send: async () => { sent++; return { status: 200, body: { store_id: p.storeId, first_owner: { created: true } } }; } } });
  await g.transport.send(request(p, 'POST', '/api/saas/provision'), { signal: signal() });
  await assert.rejects(g.transport.send(request(p, 'POST', '/api/saas/provision'), { signal: signal() }), /HTTP_SCOPE_OR_LIMIT/);
  assert.equal(entries, 1); assert.equal(sent, 1);
  const wrong = guardedControlTransport({ plan: p, mode: 'Run', beforePost: async () => { entries++; }, delegate: { send: async () => { sent++; } } });
  const r = request(p, 'POST', '/api/saas/provision'); r.headers['idempotency-key'] = 'other';
  await assert.rejects(wrong.transport.send(r, { signal: signal() }), /POST_COORDINATE/); assert.equal(sent, 1);
});
test('HTTP failure or an ambiguous response consumes the one in-process attempt without retry', async () => {
  const p = plan(); let sent = 0;
  const g = guardedControlTransport({ plan: p, mode: 'Run', beforePost: async () => {}, delegate: { send: async () => { sent++; throw Error('network lost'); } } });
  await assert.rejects(g.transport.send(request(p, 'POST', '/api/saas/provision'), { signal: signal() }));
  await assert.rejects(g.transport.send(request(p, 'POST', '/api/saas/provision'), { signal: signal() }), /HTTP_SCOPE_OR_LIMIT/);
  assert.equal(sent, 1);
});
test('foreign app, old image or changed owner is rejected before the post boundary', async () => {
  const p = plan(); let sent = 0, entries = 0;
  for (const mutate of [body => { body.instance.external_instance_id = 'foreign'; },
    body => { body.instance.metadata.image_revision = 'sha256:' + '1'.repeat(64); },
    body => { body.first_owner.username = 'other'; }]) {
    const g = guardedControlTransport({ plan: p, mode: 'Run', beforePost: async () => { entries++; }, delegate: { send: async () => { sent++; } } });
    const r = request(p, 'POST', '/api/saas/provision'), body = JSON.parse(r.body); mutate(body); r.body = JSON.stringify(body);
    await assert.rejects(g.transport.send(r, { signal: signal() }), /POST_PAYLOAD_COORDINATE/);
  }
  assert.equal(sent, 0); assert.equal(entries, 0);
});
test('foreign store or an existing owner is not accepted as this initial commit', async () => {
  for (const body of [{ store_id: 'foreign', first_owner: { created: true } }, { store_id: 'fixed-store', first_owner: { created: false } }]) {
    const p = plan(), g = guardedControlTransport({ plan: p, mode: 'Run', beforePost: async () => {}, delegate: { send: async () => ({ status: 200, body }) } });
    await assert.rejects(g.transport.send(request(p, 'POST', '/api/saas/provision'), { signal: signal() }), /POST_EXACT_STORE_OWNER/);
  }
});
test('independent Inspect exposes only two GETs, never POST/bootstrap or a second write attempt', async () => {
  const p = plan(); let sent = 0;
  const g = guardedControlTransport({ plan: p, mode: 'Inspect', delegate: { send: async () => { sent++; return { status: 200, body: {} }; } } });
  for (const [method, route] of [['POST', '/api/saas/provision'], ['GET', '/api/saas/bootstrap']])
    await assert.rejects(g.transport.send(request(p, method, route), { signal: signal() }), /HTTP_SCOPE_OR_LIMIT/);
  await g.transport.send(request(p, 'GET', '/api/saas/readiness'), { signal: signal() });
  await assert.rejects(g.transport.send(request(p, 'GET', '/api/saas/readiness'), { signal: signal() }), /HTTP_SCOPE_OR_LIMIT/); assert.equal(sent, 1);
});
test('manual compiler reloads immutable app/template and injects one leased password with the actual image', async () => {
  const f = await firstClaimFixture(), config = f.input.configuration, schema = f.input.configurationSchema;
  const p = plan(); p.historicalScope.appInstanceId = f.input.scope.appInstanceId; p.historicalScope.configurationHash = hash(config);
  // Use a fixed explicit epoch coordinate for the pure compiler fixture.
  p.externalFence = { epoch: 1, intent: 'provision', marker: 'fixed-marker', operationHash: 'e'.repeat(64) };
  let appReads = 0, templateReads = 0, leases = 0, disposed = 0;
  const material = { scope: f.input.scope, configurationSchemaSha256: hash(schema) };
  const bindingSources = { bindings: { loadForAppInstance: async () => { appReads++; return {
    appInstanceId: p.historicalScope.appInstanceId, templateVersionId: f.input.scope.templateVersionId, resolvedConfiguration: config }; } },
  templateVersions: { loadById: async () => { templateReads++; return { id: f.input.scope.templateVersionId, status: 'published', configurationSchema: schema }; } } };
  const passwords = { lease: async () => { leases++; return { read: () => 'unit-test-only-not-a-real-password', dispose: () => { disposed++; } }; } };
  const payload = await compileManualRecoveryPayload({ plan: p, material, bindingSources, passwords, signal: signal() });
  assert.equal(payload.instance.metadata.image_revision, p.controlPolicy.imageRevision); assert.equal(payload.first_owner.password, 'unit-test-only-not-a-real-password');
  assert.equal(appReads, 1); assert.equal(templateReads, 1); assert.equal(leases, 1); assert.equal(disposed, 1);
  clearFirstOwnerPassword(payload); assert.equal(payload.first_owner.password, undefined);
  material.configurationSchemaSha256 = 'f'.repeat(64);
  await assert.rejects(compileManualRecoveryPayload({ plan: p, material, bindingSources, passwords, signal: signal() }), /COMPILER_TEMPLATE_DRIFT/);
  assert.equal(leases, 1);
});
test('new entry has no platform-write or cloud-mutation command and preserves the old worker validators', async () => {
  const entry = await readFile(new URL('../ops/aws-sandbox/scripts/review-express-initialization-recovery-v1.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(entry, /new (?:CreateStack|UpdateStack|PutItem|ExecuteChangeSet|UpdateFunctionCode)Command/);
  assert.doesNotMatch(entry, /readOnly:\s*false|\.provision\([^)]*\)\s*;\s*.*\.provision\(/s);
  assert.match(entry, /await saveFile\(B.postSlot/); assert.match(entry, /await absent\(B.slot\)/);
  assert.match(entry, /POST_READ_SLOT_FACT_WINDOW/); assert.match(entry, /POST_SUBMISSION_SLOT_FACT_WINDOW/);
});
