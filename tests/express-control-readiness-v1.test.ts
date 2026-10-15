import test from 'node:test';
import assert from 'node:assert/strict';
import { MtlsSaaSControlClient, type SaaSControlRequest } from '../lib/deployments/execution/control-client.ts';
import { canonicalJson, sha256Hex } from '../lib/deployments/execution/hash.ts';
import { expressDeliveryFixture } from './fixtures/express-delivery-v1.ts';
import { validateExpressBusinessExpectationV1 } from '../lib/deployments/execution/express-control-readiness-v1.ts';
const signal = () => new AbortController().signal;
async function fixture() {
  const f = await expressDeliveryFixture(), calls: SaaSControlRequest[] = [];
  const op = { external_operation_epoch: f.external.epoch, external_operation_intent: 'provision',
    external_operation_marker: f.external.marker, external_operation_hash: f.external.operationHash };
  const instance = { external_instance_id: f.policy.appInstanceId, status: 'active' };
  const store = { store_id: '11111111-1111-4111-8111-111111111111', is_default: true, status: 'active', name: f.policy.business.default_store.name,
    branding: { store_name: f.policy.business.default_store.name, buyer_theme: f.policy.business.default_store.buyer_theme, merchant_theme: f.policy.business.default_store.merchant_theme } };
  const actual = { instance, entitlements: f.policy.business.entitlements, stores: [{ store_id: store.store_id, status: store.status,
    store_name: store.branding.store_name, buyer_theme: store.branding.buyer_theme, merchant_theme: store.branding.merchant_theme }] };
  const bodies: Record<string, unknown> = { '/api/saas/bootstrap': f.handshake(false), '/api/saas/readiness': f.handshake(true),
    '/api/saas/control': { success: true, control: { control_api_version: '1.2', ...op, instance, stores: [store], entitlements: f.policy.business.entitlements,
      configuration_hash: await sha256Hex(canonicalJson(actual)), desired_configuration_hash: f.policy.configurationHash, image_revision: f.policy.imageRevision } },
    '/api/saas/provision': { success: true, replayed: false, ...op, first_owner: { created: true, merchant_user: { username: f.policy.business.firstOwnerUsername, role: 'owner', active: true } } } };
  let tokens = 0;
  const client = new MtlsSaaSControlClient({ async send(req) { calls.push(req); return { status: 200, body: bodies[new URL(req.url).pathname] }; } },
    { async issue() { tokens++; return 'fixture-jwt'; } }, { baseDomain: 'sandbox.techlong.cloud', expressReadiness: f.policy });
  const request = { appInstanceId: f.policy.appInstanceId, hostname: f.workload.tenantHostname, externalFence: f.external, signal: signal() };
  const payload = () => ({ instance: { external_instance_id: f.policy.appInstanceId, metadata: { ...op, configuration_hash: f.policy.configurationHash, image_revision: f.policy.imageRevision } },
    entitlements: structuredClone(f.policy.business.entitlements), default_store: structuredClone(f.policy.business.default_store),
    first_owner: { username: f.policy.business.firstOwnerUsername, password: 'test-only-not-a-real-password' } });
  return { ...f, client, request, payload, calls, bodies, tokens: () => tokens };
}
test('bootstrap does not require initialized DB epoch; private authenticated readback plus existing epoch/image/config reconciliation gates final ready', async () => {
  const f = await fixture(); assert.equal(f.calls.length, 0); assert.equal(f.tokens(), 0);
  assert.equal((await f.client.waitUntilHealthy(f.request)).ready, true);
  assert.equal(f.calls[0].url, `https://${f.workload.tenantHostname}:8443/api/saas/bootstrap`);
  assert.equal(f.calls[0].headers.authorization, 'Bearer fixture-jwt');
  const p = f.payload(); await f.client.provision({ ...f.request, idempotencyKey: 'fixture-provision', compiledPayload: p });
  assert.equal('password' in p.first_owner, false);
  assert.equal((await f.client.readConfiguration(f.request)).ready, true);
  assert.deepEqual(f.calls.map(r => new URL(r.url).pathname), ['/api/saas/bootstrap', '/api/saas/provision', '/api/saas/readiness', '/api/saas/control']);
});
test('every runtime handshake binding pin and initialized flag rejects independently; no final control fallback', async () => {
  for (const patch of [{ app_instance_id: 'foreign' }, { database_binding_sha256: '0'.repeat(64) }, { database_oid: '1' }, { role_oid: '1' },
    { image_revision: 'sha256:' + '0'.repeat(64) }, { desired_configuration_hash: '0'.repeat(64) }, { external_epoch_claimed: true }, { initialization_verified: true }]) {
    const f = await fixture(); Object.assign((f.bodies['/api/saas/bootstrap'] as ReturnType<typeof f.handshake>).readiness, patch);
    assert.equal((await f.client.waitUntilHealthy(f.request)).ready, false);
  }
  const f = await fixture(); (f.bodies['/api/saas/readiness'] as ReturnType<typeof f.handshake>).readiness.initialization_verified = false;
  assert.equal((await f.client.readConfiguration(f.request)).ready, false); assert.equal(f.calls.length, 1);
});
test('desired hash alone cannot hide actual entitlement/theme/name drift, stale epoch, wrong image or forged effective checksum', async () => {
  for (const kind of ['entitlement', 'theme', 'name', 'epoch', 'image', 'checksum', 'inactive', 'extra-store']) {
    const f = await fixture(), c = (f.bodies['/api/saas/control'] as { control: Record<string, unknown> }).control;
    const s = (c.stores as { branding: Record<string, unknown> }[])[0];
    if (kind === 'entitlement') (c.entitlements as Record<string, unknown>)['stores.max'] = 99;
    if (kind === 'theme') s.branding.buyer_theme = { ...f.policy.business.default_store.buyer_theme, primary: '#000000' };
    if (kind === 'name') s.branding.store_name = 'Drifted Store';
    if (kind === 'epoch') c.external_operation_epoch = f.external.epoch + 1;
    if (kind === 'image') c.image_revision = 'sha256:' + '0'.repeat(64);
    if (kind === 'checksum') c.configuration_hash = '0'.repeat(64);
    if (kind === 'inactive') (c.instance as Record<string, unknown>).status = 'inactive';
    if (kind === 'extra-store') (c.stores as unknown[]).push(structuredClone(s));
    assert.equal((await f.client.readConfiguration(f.request)).ready, false, kind);
  }
});
test('wrong scope rejects before JWT/network; mismatched provision/owner receipt rejects and always clears password', async () => {
  const f = await fixture(); const wrong = structuredClone(f.external); wrong.resourceFence.generation++;
  assert.throws(() => validateExpressBusinessExpectationV1({ ...f.policy.business, firstOwnerUsername: undefined } as unknown as typeof f.policy.business));
  await assert.rejects(f.client.waitUntilHealthy({ ...f.request, externalFence: wrong })); assert.equal(f.calls.length, 0); assert.equal(f.tokens(), 0);
  const p = f.payload(); p.default_store.name = 'Unreviewed'; await assert.rejects(f.client.provision({ ...f.request, idempotencyKey: 'fixture-key', compiledPayload: p }));
  assert.equal('password' in p.first_owner, false); assert.equal(f.calls.length, 0);
  const r = f.bodies['/api/saas/provision'] as { first_owner: { merchant_user: { username: string } } }; r.first_owner.merchant_user.username = 'other';
  const q = f.payload(); await assert.rejects(f.client.provision({ ...f.request, idempotencyKey: 'fixture-key', compiledPayload: q })); assert.equal('password' in q.first_owner, false);
});
