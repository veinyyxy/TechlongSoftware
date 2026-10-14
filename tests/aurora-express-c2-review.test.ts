import test from 'node:test';
import assert from 'node:assert/strict';
import { C2_ACTIONS, C2_SOURCE, assertC2Facts, prepareC2Review, assertC2Approval, type C2Facts } from '../lib/deployments/execution/aurora-express-c2-review.ts';
const now = Date.parse('2026-10-14T01:00:00Z');
const facts = (): C2Facts => ({ observedAt: new Date(now).toISOString(),
  identity: { Account: '402010193138', Arn: C2_SOURCE, UserId: 'AIDAV3GNMXTZEO7SHLC2X' },
  plan: { planType: 'FREE', planStatus: 'ACTIVE' }, clusters: [], instances: [{ DBInstanceIdentifier: 'speedfeast-postgres-prod' }],
  defaultEngine: { EngineVersion: '17.9', ServerlessV2FeaturesSupport: { MinCapacity: 0 } },
  quotas: { clustersUsed: 0, clustersMax: 40, instancesUsed: 1, instancesMax: 40 },
  rdsServiceRole: { Arn: 'arn:aws:iam::402010193138:role/aws-service-role/rds.amazonaws.com/AWSServiceRoleForRDS', RoleId: 'actual-fixture' },
  permissions: C2_ACTIONS.map(a => ({ EvalActionName: a, EvalDecision: 'allowed', MissingContextValues: [] })) });
const prices = { observedAt: new Date(now).toISOString(), feedSha256: 'a'.repeat(64), publicationDate: 'fixture',
  acuHour: .14, storageGbMonth: .11, ioRequest: .00000022, gatewayRate: 'UNCONFIRMED_NOT_ASSUMED_ZERO' as const };
test('C2 exact one-call Express review has no Full/tenant/Secret/IAM mutation or automatic cleanup', () => {
  const r = prepareC2Review(facts(), prices, 'b'.repeat(64), 'c'.repeat(32), now);
  assert.equal(r.request.WithExpressConfiguration, true); assert.deepEqual(r.request.ServerlessV2ScalingConfiguration,
    { MinCapacity: 0, MaxCapacity: 1, SecondsUntilAutoPause: 300 });
  assert.equal(r.limits.directAwsWrites, 1); assert.equal(r.limits.sqlWrites, 0);
  assert.equal(r.estimate.spendingCap, false); assert.equal(r.estimate.halfAcu730HoursComputeOnly, 51.1);
  assertC2Approval(r, r.manifestSha256, r.codeBindingSha256, now + 3600000);
  assert.throws(() => assertC2Approval(r, r.manifestSha256, r.codeBindingSha256, now + 6 * 3600000));
  assert.throws(() => assertC2Approval({ ...r, request: { ...r.request, DeletionProtection: true } }, r.manifestSha256, r.codeBindingSha256, now));
});
test('C2 refuses account, capacity, IAM, stale facts and occupied name, including production isolation', () => {
  for (const f of [{ ...facts(), plan: { planType: 'PAID', planStatus: 'ACTIVE' } },
    { ...facts(), clusters: [{ DBClusterIdentifier: 'techlong-sandbox-express-d001' }] },
    { ...facts(), instances: [{}, {}] }, { ...facts(), permissions: facts().permissions.slice(1) },
    { ...facts(), defaultEngine: { EngineVersion: '17.9', ServerlessV2FeaturesSupport: { MinCapacity: .5 } } },
    { ...facts(), observedAt: new Date(now - 31000).toISOString() }]) assert.throws(() => assertC2Facts(f, now));
});
