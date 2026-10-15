import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectExpressDeliveryControlPlaneV1, EXPRESS_CONTROL_PLANE_SQL_V1, type ExpressControlPlaneReadonlyPortV1 } from '../lib/deployments/execution/express-delivery-control-plane-v1.ts';
import { compileExpressDefaultStoreSeedV1 } from '../lib/deployments/execution/express-default-store-seed-v1.ts';
import { firstClaimFixture } from './fixtures/express-first-claim-v1.ts';
import { sha256Hex } from '../lib/deployments/execution/hash.ts';

async function fixture() {
  const f = await firstClaimFixture(), calls: string[] = [];
  const port: ExpressControlPlaneReadonlyPortV1 = { async identity() { calls.push('identity'); return { Account: '402010193138',
    Arn: 'arn:aws:iam::402010193138:user/techlong-sandbox-dev', UserId: 'AIDAV3GNMXTZEO7SHLC2X', privateNoise: 'must-not-copy' } as never; },
    async authority(key) { calls.push(key); return undefined; }, async query(sql, values) {
      calls.push('neon-read'); assert.equal(sql, EXPRESS_CONTROL_PLANE_SQL_V1); assert.equal(values[0], f.root.material.scope.appInstanceId);
      assert.equal(values.length, 7); return [structuredClone(f.row)]; } };
  const request = { material: f.root.material, materialSha256: f.root.materialSha256, port, signal: new AbortController().signal,
    now: () => Date.parse('2026-10-15T06:00:00Z') };
  return { ...f, port, calls, request };
}
test('one exact Source + two authority keys + one Neon snapshot establish only a first-claim candidate, not DB ownership', async () => {
  const f = await fixture(), r = await inspectExpressDeliveryControlPlaneV1(f.request);
  assert.equal(f.calls.length, 4); assert.equal(f.calls[1], `tenant:${f.root.material.binding.stableIdentity}`);
  assert.equal(f.calls[2], `tenant:aurora-v2:${f.root.material.binding.stableIdentity}`);
  assert.equal(r.outcome, 'FIRST_CLAIM_CANDIDATE_AURORA_PROOF_STILL_REQUIRED');
  assert.equal(r.ownershipClaimed, false); assert.equal(r.epochActivated, false); assert.equal(r.auroraSqlConnections, 0);
  assert.equal(JSON.stringify(r).includes('must-not-copy'), false);
});
test('either authority, any platform ownership/job, config drift or inactive subscription blocks first claim without hiding evidence', async () => {
  for (const issue of ['legacy', 'aurora', 'resource', 'job', 'config', 'subscription', 'enabled']) {
    const f = await fixture();
    if (issue === 'legacy' || issue === 'aurora') f.port.authority = async key => key.startsWith(issue === 'legacy' ? 'tenant:a' : 'tenant:aurora-v2:') ? { existing: 'owner' } : undefined;
    if (issue === 'resource') f.row.resources = 1;
    if (issue === 'job') f.row.jobs = 1;
    if (issue === 'config') f.row.app.configuration.defaultStoreName = 'changed';
    if (issue === 'subscription') f.row.subscription.status = 'canceled';
    if (issue === 'enabled') f.row.environment.applyEnabled = 1;
    const r = await inspectExpressDeliveryControlPlaneV1(f.request); assert.equal(r.outcome, 'DRIFT_OR_EXISTING_OWNER_REQUIRES_REVIEW', issue);
    assert.equal(r.executionAuthorized, false);
  }
});
test('wrong caller, material digest and abort stop before provider/Neon reads', async () => {
  for (const issue of ['caller', 'digest', 'abort']) {
    const f = await fixture();
    if (issue === 'caller') f.port.identity = async () => ({ Account: 'wrong' });
    if (issue === 'digest') f.request.materialSha256 = '0'.repeat(64);
    if (issue === 'abort') { const c = new AbortController(); c.abort(); f.request.signal = c.signal; }
    await assert.rejects(inspectExpressDeliveryControlPlaneV1(f.request)); assert.equal(f.calls.length, 0);
  }
});
test('default-store candidate has one bound INSERT, no upsert/DDL/authority, no runtime session; deterministic UUIDv8', async () => {
  const f = await fixture(), request = { material: f.root.material, materialSha256: f.root.materialSha256, subscriptionId: f.subscriptionId };
  const p = await compileExpressDefaultStoreSeedV1(request), q = await compileExpressDefaultStoreSeedV1(request);
  assert.equal(p.programSha256, q.programSha256); assert.match(p.store.storeId, /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(p.insert.values[0], p.store.storeId); assert.equal(p.insert.text.includes(p.store.storeId), false);
  assert.match(p.insert.text, /^INSERT INTO public.stores/); assert.doesNotMatch(p.insert.text, /\b(?:ON CONFLICT|DELETE|UPDATE|CREATE|ALTER)\b/i);
  assert.equal(p.executionAuthorized, false); assert.equal(p.executionRootAvailable, false); assert.equal(p.readyVerified, false);
  assert.equal(p.limits.applicationDmlStatements, 1); assert.equal(p.limits.secretReads, 0); assert.equal(p.limits.authorityWrites, 0);
  assert.equal(p.transaction.automaticRetries, 0); assert.equal(p.postcheck.independentReadbackRequired, true);
  assert.equal(p.followingProvision.throughExistingAuthenticatedMtlsEndpoint, true);
  assert.equal(f.calls.length, 0); const { programSha256, ...body } = p; assert.equal(programSha256, await sha256Hex(body));
});
test('foreign seed target or caller-owned configuration cannot silently select a new database/store', async () => {
  const f = await fixture(), m = structuredClone(f.root.material); m.databaseOid = '999';
  await assert.rejects(compileExpressDefaultStoreSeedV1({ material: m, materialSha256: await sha256Hex(m), subscriptionId: f.subscriptionId }), /EXPRESS_DEFAULT_STORE_SEED_SCOPE_REJECTED/);
});
