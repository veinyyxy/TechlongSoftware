import test from 'node:test';
import assert from 'node:assert/strict';
import { createExpressFirstOwnerPasswordSourceV2 } from '../lib/deployments/execution/express-first-owner-password-v2.ts';
import type { FirstOwnerSecretReadonlyPort } from '../lib/deployments/execution/single-tenant-first-owner-password.ts';
import { expressDeliveryFixture } from './fixtures/express-delivery-v1.ts';
const signal = () => new AbortController().signal;
async function fixture() {
  const f = await expressDeliveryFixture(), calls: string[] = [];
  const metadata = () => ({ ARN: f.arn, Name: f.name, Tags: Object.entries({ ManagedBy: 'techlong-sandbox', SecretSchema: 'techlong-runtime-four-key-v2',
    DatabaseProfile: 'express_iam', ResourceGeneration: '1', StableIdentity: f.binding.stableIdentity }).map(([Key, Value]) => ({ Key, Value })),
    VersionIdsToStages: { [f.binding.runtimeSecret.versionId]: ['AWSCURRENT'] } });
  const material: Record<string, string> = { hmac_secret_key: Buffer.alloc(32, 7).toString('base64url'), jwt_secret_key: Buffer.alloc(32, 8).toString('base64url'),
    stripe_secret_key: 'sk_test_fixture', stripe_webhook_secret: 'whsec_fixture' };
  const sdk: FirstOwnerSecretReadonlyPort = {
    identity: async () => { calls.push('identity'); return { Account: '402010193138', Arn: 'arn:aws:iam::402010193138:user/techlong-sandbox-dev', UserId: 'AIDAV3GNMXTZEO7SHLC2X' }; },
    describe: async () => { calls.push('describe'); return metadata(); },
    value: async (arn, version) => { calls.push('value'); assert.equal(arn, f.arn); assert.equal(version, f.binding.runtimeSecret.versionId);
      return { ARN: arn, Name: f.name, VersionId: version, VersionStages: ['AWSCURRENT'], SecretString: JSON.stringify(material) }; } };
  const input = { scope: { ...f.scope, ownerDeploymentId: f.fence.ownerDeploymentId, templateVersionId: 'tplver_fixture' }, binding: f.binding,
    bindings: { load: async () => { calls.push('binding'); return { fence: f.fence, secretArn: f.arn }; } }, sdk, expectedSourceUserId: 'AIDAV3GNMXTZEO7SHLC2X' };
  const request = { appInstanceId: f.scope.appInstanceId, templateVersionId: 'tplver_fixture', signal: signal() };
  return { ...f, calls, input, request, metadata, material, sdk };
}
test('four-key lease is deterministic, domain-separated, private and disposable; assembly performs no provider reads', async () => {
  const f = await fixture(), source = await createExpressFirstOwnerPasswordSourceV2(f.input); assert.deepEqual(f.calls, []);
  const a = await source.lease(f.request), b = await source.lease(f.request);
  assert.equal(a.read(), b.read()); assert.notEqual(a.read(), f.material.hmac_secret_key); assert.match(a.read(), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(JSON.stringify(a), '{}'); assert.equal(JSON.stringify(source), '{}');
  assert.deepEqual(f.calls.slice(0, 6), ['binding', 'identity', 'describe', 'value', 'describe', 'binding']);
  a.dispose(); assert.throws(() => a.read()); b.dispose();
});
test('foreign scope/caller/version/schema reject before value read; five-key DB URL is never accepted as Express', async () => {
  for (const issue of ['scope', 'caller', 'version', 'schema', 'fifth-key']) {
    const f = await fixture();
    if (issue === 'caller') f.sdk.identity = async () => ({ Account: '402010193138', Arn: 'arn:aws:iam::402010193138:user/other', UserId: f.input.expectedSourceUserId });
    if (issue === 'version') f.sdk.describe = async () => ({ ...f.metadata(), VersionIdsToStages: { ['9'.repeat(32)]: ['AWSCURRENT'] } });
    if (issue === 'schema') f.sdk.describe = async () => ({ ...f.metadata(), Tags: [] });
    if (issue === 'fifth-key') f.material.database_url = 'postgresql://forbidden.invalid/db';
    const source = await createExpressFirstOwnerPasswordSourceV2(f.input);
    await assert.rejects(source.lease({ ...f.request, ...(issue === 'scope' ? { appInstanceId: 'foreign' } : {}) }));
    assert.equal(f.calls.includes('value'), issue === 'fifth-key');
  }
});
test('post-read version/fence races and raw provider failures fail closed without leaking provider messages', async () => {
  for (const issue of ['metadata-race', 'fence-race', 'provider']) {
    const f = await fixture(); let reads = 0;
    if (issue === 'metadata-race') f.sdk.describe = async () => ({ ...f.metadata(), ...(++reads === 2 ? { RotationEnabled: true } : {}) });
    if (issue === 'fence-race') f.input.bindings.load = async () => ({ fence: { ...f.fence, ownerDeploymentId: ++reads === 2 ? 'dep_other' : f.fence.ownerDeploymentId }, secretArn: f.arn });
    if (issue === 'provider') f.sdk.value = async () => { throw Error('PRIVATE_PROVIDER_VALUE'); };
    const source = await createExpressFirstOwnerPasswordSourceV2(f.input);
    await assert.rejects(source.lease(f.request), e => e instanceof Error && !e.message.includes('PRIVATE_PROVIDER_VALUE'));
  }
});
