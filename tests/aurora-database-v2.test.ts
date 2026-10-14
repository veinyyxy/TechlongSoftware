import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDatabaseIntentV2, parseDatabaseBindingV2, encodeDatabaseBindingV2, databaseBindingDigestV2,
  decodeDatabaseBindingV2, databaseUserArnV2, buildExpressCreateCandidateV2, buildDatabaseTaskConfigurationV2,
  dispatchDatabaseProfileV2 } from '../lib/deployments/execution/aurora-database-v2.ts';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/aurora-database-v2.json', import.meta.url), 'utf8'));
const intent = { schema: 'techlong/database-intent/v2', profile: 'express_iam', region: 'ca-central-1', tenantIsolation: 'database-and-role' };
function full() {
  return { ...fixture(), profile: 'full_password', tlsTrust: 'rds-ca/v1', access: { authentication: 'password',
    internetAccessGatewayEnabled: false, managementSecretArn: 'arn:aws:secretsmanager:ca-central-1:402010193138:secret:rds!cluster-fixture-AbCdEf' } };
}
test('D002 canonical binding roundtrip freezes a detached copy; digest binds every field', () => {
  const raw = fixture(), b = parseDatabaseBindingV2(raw), sha = databaseBindingDigestV2(b);
  raw.access.applicationRoleArn = 'changed';
  assert.equal(Object.isFrozen(b.access), true);
  assert.equal(b.access.authentication, 'iam');
  assert.deepEqual(decodeDatabaseBindingV2(encodeDatabaseBindingV2(b), sha), b);
  assert.throws(() => decodeDatabaseBindingV2(encodeDatabaseBindingV2({ ...b, resourceGeneration: 2,
    runtimeSecret: { ...b.runtimeSecret, arn: b.runtimeSecret.arn.replace('/g1-', '/g2-') } }), sha));
  assert.throws(() => decodeDatabaseBindingV2(JSON.stringify(b), sha));
});
test('D002 rejects profile mixes, foreign account/endpoint, Secret generation and tenant mismatch', () => {
  for (const patch of [{ profile: 'auto' }, { profile: 'full_password' }, { password: 'never-accepted' },
    { clusterArn: fixture().clusterArn.replace('402010193138', '000000000000') },
    { endpoint: 'attacker.example.invalid' }, { endpoint: '127.0.0.1' }, { port: 5433 },
    { tenantUsername: 'tenant_other_role' }, { resourceGeneration: 2 },
    { access: { ...fixture().access, lifecycleRoleArn: fixture().access.applicationRoleArn } }])
    assert.throws(() => parseDatabaseBindingV2({ ...fixture(), ...patch }));
  assert.throws(() => parseDatabaseIntentV2({ ...intent, allowFallback: true }));
  assert.throws(() => parseDatabaseBindingV2({ ...full(), observedEngineVersion: '17.6' }));
});
test('D002 IAM connection ARN uses immutable resource ID and exact SQL username', () => {
  const b = fixture();
  assert.equal(databaseUserArnV2(b, 'application'),
    'arn:aws:rds-db:ca-central-1:402010193138:dbuser:cluster-ABCDEFGHIJKL012345678901/tenant_fixture_role');
  assert.ok(databaseUserArnV2(b, 'management').endsWith('/postgres'));
  assert.throws(() => databaseUserArnV2(full(), 'application'));
});
test('D002 provider dispatch has no fallback after an Express failure', async () => {
  let express = 0, legacy = 0;
  const providers = { express_iam: async () => { express++; throw Error('synthetic failure'); },
    full_password: async () => { legacy++; return 'legacy'; } };
  await assert.rejects(dispatchDatabaseProfileV2(fixture(), providers));
  assert.equal(express, 1); assert.equal(legacy, 0);
  assert.equal(await dispatchDatabaseProfileV2(full(), providers), 'legacy');
});
test('D002 Express create candidate is one inert API request without Full-only inputs', () => {
  const c = buildExpressCreateCandidateV2(intent, { clusterIdentifier: 'techlong-sandbox-express-fixture',
    stableIdentity: 'a'.repeat(64), resourceGeneration: 1 });
  assert.equal(c.executionAuthorized, false); assert.equal(c.runtimeEnabled, false);
  assert.equal(c.maxDirectCreateCalls, 1); assert.equal(c.request.WithExpressConfiguration, true);
  assert.deepEqual(Object.keys(c.request).sort(), ['DBClusterIdentifier', 'Engine', 'Tags', 'WithExpressConfiguration']);
  assert.throws(() => buildExpressCreateCandidateV2({ ...intent, profile: 'full_password' },
    { clusterIdentifier: 'techlong-sandbox-express-fixture', stableIdentity: 'a'.repeat(64), resourceGeneration: 1 }));
});
test('D002 ECS config binds Express metadata and four immutable keys, never persists IAM tokens', () => {
  const c = buildDatabaseTaskConfigurationV2(fixture());
  const env = Object.fromEntries(c.environment.map(e => [e.name, e.value]));
  assert.equal(env.PG_DATABASE_PROFILE, 'express_iam'); assert.equal(env.PGSSLROOTCERT, '');
  assert.equal(env.PGPOOL_CONNECTION_TIMEOUT_MS, '30000');
  assert.equal(env.PG_DATABASE_BINDING_SHA256, databaseBindingDigestV2(fixture()));
  assert.equal(c.secrets.length, 4); assert.equal(c.secrets.some(s => s.name === 'DATABASE_URL'), false);
  assert.equal(c.executionAuthorized, false);
  assert.ok(c.secrets.every(s => s.valueFrom.endsWith('::' + fixture().runtimeSecret.versionId)));
  assert.equal(JSON.stringify(c).includes('X-Amz-'), false);
  const f = buildDatabaseTaskConfigurationV2(full());
  assert.equal(f.secrets.length, 5);
  assert.equal(f.environment.some(e => e.name === 'PG_DATABASE_BINDING_V2'), false);
  assert.equal(f.environment.some(e => e.name === 'PGPOOL_CONNECTION_TIMEOUT_MS'), false);
});
