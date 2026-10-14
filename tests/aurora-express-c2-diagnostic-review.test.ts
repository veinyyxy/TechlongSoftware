import test from 'node:test';
import assert from 'node:assert/strict';
import { C2A_SHA, assertDiagnosticApproval, assertDiagnosticFacts, prepareDiagnosticReview,
  type ExistingExpressBinding, type DiagnosticFacts } from '../lib/deployments/execution/aurora-express-c2-diagnostic-review.ts';
const now = Date.parse('2026-10-14T03:30:00Z');
const binding: ExistingExpressBinding = { manifestSha256: C2A_SHA,
  clusterArn: 'arn:aws:rds:ca-central-1:402010193138:cluster:techlong-sandbox-express-d001', clusterResourceId: 'cluster-ABCDEFGHIJKLMNOPQRSTUVWX',
  createdAt: '2026-10-14T03:00:00Z', engineVersion: '17.9', endpoint: 'fixture.cluster-example.ca-central-1.rds.amazonaws.com', port: 5432,
  writerIdentifier: 'techlong-sandbox-express-d001-instance-1', writerArn: 'arn:aws:rds:ca-central-1:402010193138:db:techlong-sandbox-express-d001-instance-1',
  writerResourceId: 'db-ABCDEFGHIJKLMNOPQRSTUVWX', writerCreatedAt: '2026-10-14T03:00:01Z',
  tags: { ManagedBy: 'techlong-sandbox', DatabaseProfile: 'express_iam', DeliveryTrack: 'D002-C2-admin-facts', ProbeNonce: 'c'.repeat(32) },
  clusterStatus: 'available', writerStatus: 'available' };
const facts = (): DiagnosticFacts => ({ observedAt: new Date(now).toISOString(),
  source: { Account: '402010193138', Arn: 'arn:aws:iam::402010193138:user/techlong-sandbox-dev', UserId: 'AIDAV3GNMXTZEO7SHLC2X' },
  plan: { planType: 'FREE', planStatus: 'ACTIVE' }, binding,
  connectPermission: { action: 'rds-db:connect', resource: `arn:aws:rds-db:ca-central-1:402010193138:dbuser:${binding.clusterResourceId}/postgres`,
    decision: 'allowed', missingContext: [] } });
const history = { originalManifestSha256: C2A_SHA, originalCodeBindingSha256: 'a'.repeat(64), createdFileSha256: 'b'.repeat(64),
  bindingFileSha256: 'b'.repeat(64), stoppedFileSha256: 'b'.repeat(64), createSlotFileSha256: 'b'.repeat(64), sqlSlotFileSha256: 'b'.repeat(64) };
test('C2b approval binds existing physical identities and immutable consumed history, no resource mutation', () => {
  const r = prepareDiagnosticReview(facts(), history, 'd'.repeat(64), now);
  assert.equal(r.limits.awsResourceWrites, 0); assert.equal(r.limits.logicalSqlSessions, 1);
  assert.equal(r.limits.maxNativeConnectMs, 30000); assert.equal(r.limits.fixedReadonlySqlStatements, 4);
  assertDiagnosticApproval(r, r.manifestSha256, r.codeBindingSha256, now + 1000);
  assert.throws(() => assertDiagnosticApproval(r, 'invalid', r.codeBindingSha256, now));
  assert.throws(() => assertDiagnosticApproval(r, r.manifestSha256, r.codeBindingSha256, now + 6 * 3600000));
  assert.throws(() => assertDiagnosticApproval({ ...r, attemptSlot: 'old-slot' }, r.manifestSha256, r.codeBindingSha256, now));
});
test('C2b rejects replacement cluster/writer, broad IAM resource, wrong Source and stale facts', () => {
  for (const f of [{ ...facts(), binding: { ...binding, clusterResourceId: 'cluster-ZZZZZZZZZZZZZZZZZZZZZZZZ' } },
    { ...facts(), binding: { ...binding, writerResourceId: 'db-ZZZZZZZZZZZZZZZZZZZZZZZZ' } },
    { ...facts(), connectPermission: { ...facts().connectPermission, resource: '*' } },
    { ...facts(), observedAt: new Date(now - 31000).toISOString() },
    { ...facts(), source: { ...facts().source, Arn: 'arn:aws:iam::402010193138:root' } }])
    assert.throws(() => assertDiagnosticFacts(f, binding, now));
});
