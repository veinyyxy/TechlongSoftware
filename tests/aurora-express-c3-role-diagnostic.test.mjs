import test from 'node:test';
import assert from 'node:assert/strict';
import diagnostic from '../lib/deployments/execution/aurora-express-c3-role-diagnostic.cjs';
import bootstrap from '../lib/deployments/execution/aurora-express-bootstrap-v3.cjs';
const now = Date.parse('2026-10-14T11:00:00Z');
function fixture() {
  const scope = { appInstanceId: 'synthetic', workspaceId: 'synthetic', productId: 'synthetic', environmentId: 'synthetic', cellKey: 'cell-sandbox-1' };
  const stableIdentity = bootstrap.digest(scope);
  const target = { schema: 'techlong/express-management-target/v3', clusterArn: 'arn:aws:rds:ca-central-1:402010193138:cluster:techlong-sandbox-express-d001',
    clusterResourceId: 'cluster-ABCDEFGHIJKLMNOPQRSTUVWX', endpoint: 'synthetic.cluster-example.ca-central-1.rds.amazonaws.com',
    port: 5432, observedEngineVersion: '17.9', managementDatabase: 'postgres', managementUsername: 'postgres', stableIdentity, resourceGeneration: 1,
    tenantDatabase: `tenant_${stableIdentity.slice(0,16)}_db`, tenantUsername: `tenant_${stableIdentity.slice(0,16)}_role` };
  const program = bootstrap.compileExpressBootstrapV3({ scope, target, nonce: 'c'.repeat(32) });
  const binding = { clusterArn: target.clusterArn, clusterResourceId: target.clusterResourceId, endpoint: target.endpoint };
  const original = { manifestSha256: diagnostic.ORIGINAL_SHA, bootstrapProgramSha256: bootstrap.digest(program),
    candidateInput: { scope, target, nonce: 'c'.repeat(32) }, expectedBinding: binding };
  const facts = { binding, observedAt: new Date(now).toISOString(), plan: { planType: 'FREE', planStatus: 'ACTIVE' },
    source: { Account: '402010193138', Arn: 'arn:aws:iam::402010193138:user/techlong-sandbox-dev', UserId: 'AIDAV3GNMXTZEO7SHLC2X' },
    connectPermission: { decision: 'allowed', missingContext: [] } };
  return { original, facts, program, codeBindingSha256: 'a'.repeat(64), historySha256: 'b'.repeat(64), legacySqlSha256: 'd'.repeat(64) };
}
test('one read-only catalog scope needs exact fresh SHA, frozen history and unmodified limits', () => {
  const f = fixture(), r = diagnostic.prepareReview(f, now);
  const approve = (value = r, sha = r.manifestSha256, time = now, code = f.codeBindingSha256) =>
    diagnostic.assertApproval(value, sha, code, f.historySha256, f.original, f.legacySqlSha256, time);
  approve(); assert.equal(r.limits.sqlConnections, 1); assert.equal(r.limits.sqlQueries, 5);
  assert.equal(r.limits.sqlMutations, 0); assert.equal(r.executionAuthorized, false); assert.equal(r.attemptSlot, diagnostic.SLOT);
  assert.throws(() => approve(r, 'invalid')); assert.throws(() => approve(r, r.manifestSha256, now + 6 * 3600000));
  assert.throws(() => approve(r, r.manifestSha256, now, 'f'.repeat(64)));
  assert.throws(() => approve({ ...r, limits: { ...r.limits, sqlConnections: 2 } }));
  assert.throws(() => diagnostic.prepareReview({ ...f, facts: { ...f.facts, observedAt: 'invalid' } }, now));
  assert.throws(() => diagnostic.prepareReview({ ...f, facts: { ...f.facts, observedAt: new Date(now - 31000).toISOString() } }, now));
  assert.throws(() => diagnostic.prepareReview({ ...f, original: { ...f.original, manifestSha256: 'f'.repeat(64) } }, now));
});
function catalog(program) {
  const make = guard => ({ oid: diagnostic.EXPECTED[guard ? 'guard' : 'tenant'], name: guard ? program.guardName : program.target.tenantUsername,
    login: false, inherit: false, superuser: false, createDb: false, createRole: false, replication: false, bypassRls: false,
    settings: false, owns: false, parents: 0, limit: -1, until: null, config: null, comment: program.comments[guard ? 'guard' : 'role'],
    members: [{ name: 'postgres', grantor: 'rdsadmin', admin: true, inherit: guard, set: guard }] });
  const legacy = { roles: [make(false), make(true)], databases: [] };
  const detail = { context: { readOnly: true, isolation: 'repeatable read', tenantDatabaseAbsent: true,
    creatorInherit: true, creatorCreateRole: true, selfGrantSetting: '' },
    roles: legacy.roles.map(r => ({ oid: r.oid, name: r.name, memberCount: 1, parentCount: 0, parents: [],
      members: r.members.map(m => ({ ...m, memberOid: '16410', grantorOid: '10' })) })) };
  return { legacy, detail };
}
test('reports original reserve predicate rejection without serializing raw configuration, comments or foreign names', () => {
  const { program } = fixture(), c = catalog(program);
  c.legacy.roles[0].members[0].inherit = true;
  c.legacy.roles[0].config = ['SYNTHETIC_PRIVATE_CONFIGURATION'];
  c.legacy.roles[0].comment = 'SYNTHETIC_PRIVATE_COMMENT';
  c.detail.roles[0].members[0].name = 'SYNTHETIC_PRIVATE_MEMBER';
  const result = diagnostic.diagnose({ program, ...c, verifyReserve: (_p, current, phase) => {
    assert.equal(phase, 'reserve'); assert.equal(current.app.oid, '16456'); throw Error('AURORA_V3_BOOTSTRAP_ROLE_CHANGED');
  } });
  assert.equal(result.state, 'RESERVE_PREDICATES_REJECTED_NOW_NOT_ORIGINAL_CAUSE_PROVED');
  assert.ok(result.roles[0].rejectedPredicates.includes('some_inherit_equals_guard'));
  assert.ok(result.roles[0].rejectedPredicates.includes('config_null'));
  assert.equal(result.originalFailureConditionProved, false); assert.equal(result.sqlMutationPerformed, false);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE'), false);
});
test('valid observations stay non-runtime and drift/unsafe transaction evidence cannot authorize repair', () => {
  const { program } = fixture(), c = catalog(program);
  let result = diagnostic.diagnose({ program, ...c, verifyReserve: () => {} });
  assert.equal(result.state, 'RESERVE_PREDICATES_MATCH_NOW_NOT_ORIGINAL_CAUSE_PROVED');
  assert.equal(result.runtimeEnabled, false); assert.equal(result.retryAuthorized, false);
  c.legacy.roles[0].oid = '19000'; c.detail.roles[0].oid = '19000';
  result = diagnostic.diagnose({ program, ...c, verifyReserve: () => {} });
  assert.equal(result.state, 'ROLE_TARGET_DRIFT_OBSERVED'); assert.ok(result.roles[0].rejectedPredicates.includes('oid'));
  c.detail.context.readOnly = false;
  assert.throws(() => diagnostic.diagnose({ program, ...c, verifyReserve: () => {} }));
  assert.ok(diagnostic.DETAIL_SQL.includes('$2::text'));
  assert.equal(/pg_authid|rolpassword|CREATE ROLE|ALTER ROLE|DROP ROLE/.test(diagnostic.DETAIL_SQL), false);
});
