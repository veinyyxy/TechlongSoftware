import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { verify } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createCloudSessionV5, CLOUD_V5 as C } from '../ops/cloud-worker/cloud-session-v5.mjs';
import { createCloudAwsClientsV5, createAuxiliaryCloudReadsV5 } from '../ops/cloud-worker/cloud-aws-reads-v5.mjs';
import { createCloudInitializedAwsV5, cloudTaskProjectionV5 } from '../ops/cloud-worker/aws-initialized-workload-v5.mjs';
import { createCloudControlSourcesV5, createFixedControlSecretLoaderV5, CLOUD_CONTROL_V5 as P } from '../ops/cloud-worker/cloud-control-v5.mjs';
import { prepareCloudContextV5, verifyCloudPredecessorV5 } from '../ops/cloud-worker/cloud-context-v5.mjs';
import { taskProjection } from '../ops/aws-sandbox/scripts/express-image-repair-plan-v1.mjs';
import { sha256Hex } from '../lib/deployments/execution/hash.ts';
import { controlFixtureV5 } from './fixtures/cloud-control-v5.mjs';
const expected = () => ({ repository: C.repository, runId: '123456789', runAttempt: 1, commitSha: 'a'.repeat(40), roleId: 'AROA' + 'B'.repeat(17) });
const fakeCredentials = () => ({ accessKeyId: 'ASIA' + 'A'.repeat(16), secretAccessKey: 'test-fixture-only', sessionToken: 'test-fixture-only', expiration: new Date(Date.now() + 3600000) });
const signal = () => AbortSignal.timeout(10000);
const capsule = async () => JSON.parse(await readFile(new URL('../ops/cloud-worker/material/public-capsule-v5.json', import.meta.url), 'utf8'));

test('cloud identity is exact role-ID/session, no Source user, publisher role or default fallback', async () => {
  let resolutions = 0;
  const s = createCloudSessionV5({ credentials: async () => { resolutions++; return fakeCredentials(); }, expected: expected() });
  assert.equal(resolutions, 0);
  const who = { Account: C.account, Arn: `arn:aws:sts::${C.account}:assumed-role/${C.roleName}/Deploy-123456789-1`, UserId: expected().roleId + ':Deploy-123456789-1' };
  s.assertIdentity(who);
  for (const patch of [{ Account: '000000000000' }, { Arn: 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' },
    { UserId: 'AROAFOREIGN:Deploy-123456789-1' }, { Arn: who.Arn.replace(C.roleName, 'TechlongSandboxGitHubImagePublisherRole') }])
    assert.throws(() => s.assertIdentity({ ...who, ...patch }));
  assert.equal(resolutions, 0); await s.clientConfig().credentials(); assert.equal(resolutions, 1);
  const bad = createCloudSessionV5({ credentials: async () => ({ ...fakeCredentials(), accessKeyId: 'AKIA' + 'A'.repeat(16) }), expected: expected() });
  await assert.rejects(bad.clientConfig().credentials(), /TEMPORARY_CREDENTIALS_UNAVAILABLE/);
  assert.throws(() => createCloudSessionV5({ expected: expected() }));
});
test('short-lived credentials expiry/provider error is sanitized and never falls back', async () => {
  for (const fn of [async () => ({ ...fakeCredentials(), expiration: new Date(Date.now() + 60000) }),
    async () => ({ ...fakeCredentials(), sessionToken: '' }), async () => { throw Error('DO_NOT_EXPOSE_PROVIDER_SECRET'); }]) {
    const s = createCloudSessionV5({ credentials: fn, expected: expected() });
    await assert.rejects(s.clientConfig().credentials(), /^Error: CLOUD_WORKER_V5_TEMPORARY_CREDENTIALS_UNAVAILABLE$/);
  }
});
test('all 13 SDK clients are lazy, fixed-endpoint, explicit-session and maxAttempts=1', async () => {
  let resolutions = 0;
  const s = createCloudSessionV5({ credentials: async () => { resolutions++; return fakeCredentials(); }, expected: expected() });
  const clients = createCloudAwsClientsV5(s), provider = createCloudInitializedAwsV5({}, s);
  assert.deepEqual(provider.counts(), { sdkReads: 0, auxiliarySdkReads: 0, createCalls: 0 });
  assert.equal(Object.keys(clients.api).length, 13);
  for (const [service, client] of Object.entries(clients.api)) {
    assert.equal(await client.config.maxAttempts(), 1);
    const endpoint = await client.config.endpoint(); assert.equal(endpoint.protocol, 'https:');
    assert.ok(endpoint.hostname.endsWith('.amazonaws.com'));
    assert.equal(await client.config.region(), ['iam', 'dns'].includes(service) ? 'us-east-1' : C.region);
  }
  assert.equal(resolutions, 0); clients.destroy(); provider.dispose();
});
test('12 auxiliary allowlisted SDK operations, no write/Secret API/paginator; Lambda env not exposed', async () => {
  const seen = [], api = Object.fromEntries(['elb', 'logs', 'dns', 'rds', 'ecr', 'scheduler', 'lambda'].map(service => [service, {
    async send(command, options) { seen.push([service, command.constructor.name, command.input]); assert.ok(options.abortSignal);
      return { State: 'Active', CodeSha256: 'code', FunctionArn: 'arn', Environment: { Variables: { NO_LEAK: 'fixture' } } }; },
  }]));
  const bridge = createAuxiliaryCloudReadsV5(api);
  const operations = ['elb.DescribeTargetGroups', 'elb.DescribeRules', 'elb.DescribeTargetHealth', 'elb.DescribeListeners', 'elb.DescribeLoadBalancers',
    'logs.DescribeLogGroups', 'dns.ListResourceRecordSets', 'rds.DescribeDBClusters', 'ecr.BatchGetImage', 'ecr.DescribeImageScanFindings', 'scheduler.GetSchedule', 'lambda.GetFunctionConfiguration'];
  for (const op of operations) {
    const r = await bridge.read(op, { exactFixture: op }, signal());
    if (op.startsWith('lambda.')) assert.equal('Environment' in r, false);
  }
  assert.equal(seen.length, 12); assert.equal(bridge.count(), 12);
  for (const op of ['sm.GetSecretValue', 'cfn.CreateStack', 'elb.CreateRule', 'rds.DeleteDBCluster']) await assert.rejects(bridge.read(op, {}, signal()));
  assert.equal(seen.length, 12);
});
test('only exact missing-target-group errors mean absent, other reads fail sanitized', async () => {
  const api = { elb: { async send() { throw Object.assign(Error('HIDDEN'), { name: 'TargetGroupNotFoundException' }); } } };
  const b = createAuxiliaryCloudReadsV5(api);
  assert.equal(await b.read('elb.DescribeTargetGroups', { Names: ['fixture'] }, signal(), 'TargetGroupNotFound'), null);
  await assert.rejects(b.read('elb.DescribeTargetHealth', {}, signal(), 'TargetGroupNotFound'), /^Error: CLOUD_WORKER_V5_AUXILIARY_READ_FAILED$/);
});
test('task projection preserves unknown future runtime fields identically to W3', () => {
  const definition = { taskDefinitionArn: 'arn', revision: 5, status: 'INACTIVE', unknownFuture: { retain: true },
    containerDefinitions: [{ image: 'unchanged', environment: [{ name: 'z' }, { name: 'a' }], secrets: [{ name: 'y' }, { name: 'b' }] }] };
  assert.deepEqual(cloudTaskProjectionV5(definition), taskProjection(definition));
});
test('portable public capsule proves exact W4c receipt/provider and reconstructs same material', async () => {
  const c = await capsule(), context = await prepareCloudContextV5(c);
  assert.ok(context.predecessor.taskDefinitionArn.endsWith(':5')); assert.equal(context.executionAuthorized, false);
  assert.equal(context.currentCloudHealthProved, false);
  for (const change of ['receipt', 'provider', 'predecessor', 'fingerprints', 'delivery']) {
    const x = structuredClone(c);
    if (change === 'receipt') x.lineage.receipt.initializedVerified = false;
    if (change === 'provider') x.lineage.providerObservation.physical.TenantTaskDefinition = x.lineage.predecessor.taskDefinitionArn.replace(':5', ':6');
    if (change === 'predecessor') x.lineage.predecessor.receiptSha256 = 'a'.repeat(64);
    if (change === 'fingerprints') x.controlFingerprints.clientCaSha256 = 'b'.repeat(64);
    if (change === 'delivery') x.delivery.configuration.defaultStoreName = 'modified';
    const { capsuleSha256: _sha, ...body } = x; void _sha; x.capsuleSha256 = await sha256Hex(body);
    await assert.rejects(prepareCloudContextV5(x));
  }
  await verifyCloudPredecessorV5(c.lineage);
});
test('real check entry imports and rebuilds bundle without credentials, F-drive or any live action', () => {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', 'ops/cloud-worker/check-runtime-v5.mjs', '--mode', 'CheckBundle'],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0); const r = JSON.parse(result.stdout);
  assert.equal(r.awsCalls + r.dbQueries + r.privateReads + r.slotsConsumed, 0); assert.equal(r.runModeAvailable, false);
  const bad = spawnSync(process.execPath, ['--experimental-strip-types', 'ops/cloud-worker/check-runtime-v5.mjs', '--mode', 'RunOnce'],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.notEqual(bad.status, 0);
});
test('minimal real RSA/mTLS material signs two valid scoped JWTs, serializes no keys, disposal blocks access', async () => {
  const f = await controlFixtureV5(), v = await createCloudControlSourcesV5(f.payload, f.expected), request = {
    instanceId: P.appInstanceId, audience: `speedfeast-instance:${P.appInstanceId}`, scope: 'speedfeast:control', signal: signal() };
  const jwt = await v.controlTokens.issue(request), [h, body, signature] = jwt.split('.');
  assert.equal(verify('RSA-SHA256', Buffer.from(h + '.' + body), f.payload.signingPublicKeyPem, Buffer.from(signature, 'base64url')), true);
  const claims = JSON.parse(Buffer.from(body, 'base64url')); assert.equal(claims.exp - claims.iat, 60); assert.equal(claims.instance_id, P.appInstanceId);
  assert.equal(JSON.stringify(v).includes('PRIVATE KEY'), false); assert.equal('paymentCredentials' in v, false);
  await v.controlTokens.issue(request); await assert.rejects(v.controlTokens.issue(request));
  v.dispose(); await assert.rejects(v.controlTokens.issue(request)); assert.equal(v.counts().httpAttempts, 0);
});
test('Stripe/DB/password extra fields, wrong public pins and expired certificates fail closed', async () => {
  const f = await controlFixtureV5();
  for (const name of ['stripeSecretKey', 'stripeWebhookSecret', 'databaseUrl', 'firstOwnerPassword'])
    await assert.rejects(createCloudControlSourcesV5({ ...f.payload, [name]: 'not-allowed' }, f.expected));
  await assert.rejects(createCloudControlSourcesV5(f.payload, { ...f.expected, publicKeySha256: '0'.repeat(64) }));
  await assert.rejects(createCloudControlSourcesV5(f.payload, f.expected, { now: Date.now() + 4 * 86400000 }));
});
test('control transport blocks POST/foreign/redirect-like URL/wrong path before network', async () => {
  const f = await controlFixtureV5();
  const good = { method: 'GET', url: `https://${P.hostname}:8443/api/saas/readiness`, headers: { host: P.hostname } };
  for (const patch of [{ method: 'POST' }, { body: '{}' }, { url: 'https://other.invalid:8443/api/saas/readiness' },
    { url: good.url + '?redirect=1' }, { url: good.url.replace('readiness', 'provision') }]) {
    const v = await createCloudControlSourcesV5(f.payload, f.expected);
    const token = await v.controlTokens.issue({ instanceId: P.appInstanceId, audience: `speedfeast-instance:${P.appInstanceId}`, scope: 'speedfeast:control', signal: signal() });
    await assert.rejects(v.controlTransport.send({ ...good, headers: { ...good.headers, authorization: `Bearer ${token}` }, ...patch }, { signal: signal() }));
    assert.equal(v.counts().httpAttempts, 0); v.dispose();
  }
});
test('fixed-version Secret loader consumes before one read; any mismatch/failure forbids retry', async () => {
  const f = await controlFixtureV5(), reference = { arn: `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${P.secretName}-Ab1234`, versionId: 'a'.repeat(32) };
  for (const fail of ['none', 'before', 'version', 'stage', 'provider']) {
    const events = [];
    const loader = createFixedControlSecretLoaderV5({ reference, expected: f.expected,
      beforeRead: async sha => { events.push('slot'); assert.match(sha, /^[a-f0-9]{64}$/); if (fail === 'before') throw Error('no'); },
      getSecretValue: async spec => { events.push('get'); assert.equal(spec.SecretId, reference.arn); assert.equal(spec.VersionId, reference.versionId);
        if (fail === 'provider') throw Error('RAW_SECRET_MUST_NOT_ESCAPE');
        return { ARN: reference.arn, Name: P.secretName, VersionId: fail === 'version' ? 'b'.repeat(32) : reference.versionId,
          VersionStages: [fail === 'stage' ? 'AWSPREVIOUS' : 'AWSCURRENT'], SecretString: JSON.stringify(f.payload) }; } });
    if (fail === 'none') (await loader.loadOnce(signal())).dispose(); else await assert.rejects(loader.loadOnce(signal()), /^Error: CLOUD_WORKER_V5_CONTROL_LOAD_REQUIRES_INSPECT_NO_RETRY$/);
    await assert.rejects(loader.loadOnce(signal()));
    assert.deepEqual(events, fail === 'before' ? ['slot'] : ['slot', 'get']);
  }
});
