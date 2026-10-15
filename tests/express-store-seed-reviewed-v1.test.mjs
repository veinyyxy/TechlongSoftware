import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import seed from '../lib/deployments/execution/express-store-seed-reviewed-v1.cjs';
import activation from '../lib/deployments/execution/express-application-activation-c4h.cjs';
import db from '../lib/deployments/execution/aurora-database-contract-v2.cjs';

// Non-secret historical compile inputs only. Tests use no native tools, DB,
// credentials or network. Catalog callback is a port spy, not live evidence.
const fixture = JSON.parse(await readFile(new URL('./fixtures/express-store-seed-reviewed-v1.json', import.meta.url)));
const roleSql = 'SELECT r.rolconfig AS config FROM fixture', catalogSql = 'fixture catalog', rowsSql = 'fixture row counts';
function program() {
  const applicationProgram = activation.compile({ candidate: fixture.candidate, closedDatabases: fixture.closed, roleSql, catalogSql, rowCountSql: rowsSql });
  return seed.compile({ seed: fixture.seed, applicationProgram, bootstrap: fixture.bootstrap });
}
const role = { oid: '16456', name: 'tenant_a0da1748bc4d5419_role', login: true, inherit: false, superuser: false,
  create_db: false, create_role: false, replication: false, bypass_rls: false, connection_limit: -1, valid_until: null, config: null,
  settings: false, owns_objects: false, iam_role_oid: '16389', parents: [{ name: 'rds_iam', oid: '16389', grantor: 'rdsadmin', admin: false, inherit: false, set: false }],
  members: [], other_connectable_databases: 0 };
const entitlements = [['branding.custom_theme.enabled', true, 'boolean'], ['branding.merchant_editable', true, 'boolean'],
  ['buyer.access.heartbeat_seconds', 300, 'integer'], ['buyer.access.lease_seconds', 900, 'integer'],
  ['buyer.accounts.max', null, 'integer_or_null'], ['buyer.concurrent_access.max', null, 'integer_or_null'],
  ['merchant.active_users.max', null, 'integer_or_null'], ['stores.max', null, 'integer_or_null']]
  .map(([key, value, type]) => ({ key, value, type, source: 'default', license: null, revision: '1', updatedBy: 'migration', sameInstance: true }));
const counts = (p, n) => p.tables.map(name => ({ name, rows: name === 'saas_instances' ? '1' : name === 'saas_entitlements' ? '8' : name === 'stores' ? String(n) : '0' }));
const result = rows => ({ rowCount: rows.length, rows });
function snapshots(p, inspectOnly, n) {
  return [result([{ database: p.target.database, database_oid: p.target.databaseOid, username: 'postgres', session_username: 'postgres',
    role_oid: '16410', server_version_num: 170009, read_only: inspectOnly ? 'on' : 'off', isolation: 'serializable', backend_tls_active: true }]),
  result([structuredClone(role)]), result(structuredClone(p.expectedDatabases)), result([{ identity: 'catalog-port-fixture' }]), result(counts(p, n)),
  result([{ database_comment: p.comments.database, role_comment: p.comments.role, bootstrap_guard_absent: true }]),
  result([{ pristine: true, entitlements: structuredClone(entitlements) }]),
  result(n ? [{ ...p.seed.expectedReturnedRow, empty_contact: true, initial_timestamps: true }] : [])];
}
function checks(p, seen = []) { return { assertCandidate(c) { assert.equal(c, fixture.candidate); },
  classifyRole(r, state) { assert.equal(state, 'active'); assert.equal(r.rows[0].parents[0].grantor, 'postgres'); return { roleOid: '16456', otherConnectableDatabases: 0 }; },
  verifyCatalog(r, candidate, state) { assert.equal(r.rows[0].identity, 'catalog-port-fixture'); assert.equal(candidate, fixture.candidate); assert.equal(state, 'active'); seen.push('actual-catalog-port'); return { actualCatalogSha256: p.pins.catalog }; } }; }
async function run({ inspectOnly = false, existing = false, mutate, failSql, journalFail, expireAfterInsert = false } = {}) {
  const p = program(), calls = [], stages = [], seen = [];
  let inserted = existing;
  const approval = () => { if (expireAfterInsert && inserted) throw Error('EXPIRED_FIXTURE'); };
  const guard = seed.createQueryGuard(p, inspectOnly, approval);
  const client = { async query(q) {
    guard.check(q); const text = typeof q === 'string' ? q : q.text; calls.push(text);
    if (failSql === text) throw Error('PROVIDER_FIXTURE');
    if (text === p.seed.insert.text) { inserted = true; return result([p.seed.expectedReturnedRow]); }
    const index = p.snapshot.findIndex(v => v.text === text);
    if (index >= 0) { const r = snapshots(p, inspectOnly, inserted ? 1 : 0)[index]; if (mutate) mutate(r, index, inserted); return r; }
    return result([]);
  } };
  const task = seed.execute({ client, program: p, candidate: fixture.candidate, checks: checks(p, seen), inspectOnly, approval,
    signal: new AbortController().signal, journal: async v => { stages.push(v); if (journalFail === v.kind) throw Error('JOURNAL_FIXTURE'); } });
  return { task, calls, stages, p, seen };
}

test('exact historical seed compiles; JSON-cloned program/changed INSERT cannot enter executor', () => {
  const p = program(); assert.equal(p.seed.store.storeId, 'add89a8c-f43e-81b9-8287-0cb6c5c54f87');
  assert.equal(db.digest(role), p.pins.role); assert.equal(db.digest(p.expectedDatabases), p.pins.databaseAcl);
  assert.throws(() => seed.assertProgram(structuredClone(p)), /PRIVATE_PROGRAM/);
  const changed = structuredClone(fixture.seed); changed.insert.text += '; SELECT 1';
  assert.throws(() => seed.compile({ seed: changed, applicationProgram: activation.compile({ candidate: fixture.candidate,
    closedDatabases: fixture.closed, roleSql, catalogSql, rowCountSql: rowsSql }), bootstrap: fixture.bootstrap }), /PROGRAM_REJECTED/);
  assert.equal(seed.querySequence(p, false).length, 22); assert.equal(seed.querySequence(p, true).length, 12);
});
test('one INSERT checks actual pre and post vectors plus technical seeds, then commits; not ready', async () => {
  const r = await run(), o = await r.task;
  assert.equal(r.calls.length, 22); assert.equal(r.calls.filter(t => t === r.p.seed.insert.text).length, 1);
  assert.equal(r.calls.at(-1), 'COMMIT'); assert.equal(o.before.storeRows, 0); assert.equal(o.after.storeRows, 1);
  assert.notEqual(o.before.actualRowCountsSha256, o.after.actualRowCountsSha256); assert.equal(r.seen.length, 2);
  assert.equal(o.commitAcknowledged, true); assert.equal(o.readyVerified, false); assert.match(o.outcome, /REQUIRES_INDEPENDENT_INSPECT/);
});
test('independent Inspect accepts exact store or exact empty state, performs 12 read-only queries and zero INSERT', async () => {
  for (const existing of [false, true]) { const r = await run({ inspectOnly: true, existing }), o = await r.task;
    assert.equal(r.calls.length, 12); assert.match(r.calls[0], /SERIALIZABLE READ ONLY$/); assert.equal(r.calls.includes(r.p.lock), false);
    assert.equal(o.insertSubmitted, false); assert.equal(o.after.storeRows, Number(existing)); assert.equal(o.readyVerified, false);
    assert.equal(r.calls.some(t => t.startsWith('INSERT')), false); }
});
test('any preexisting store, unknown row, changed bootstrap/role/ACL/technical seed aborts before INSERT', async () => {
  const edits = [
    (r, i) => { if (i === 4) r.rows.find(v => v.name === 'Order').rows = '1'; },
    (r, i) => { if (i === 5) r.rows[0].database_comment += 'changed'; },
    (r, i) => { if (i === 5) r.rows[0].bootstrap_guard_absent = false; },
    (r, i) => { if (i === 1) r.rows[0].parents[0].admin = true; },
    (r, i) => { if (i === 2) r.rows[0].acl = []; },
    (r, i) => { if (i === 6) r.rows[0].pristine = false; },
    (r, i) => { if (i === 6) r.rows[0].entitlements[0].source = 'provisioning'; },
    (r, i) => { if (i === 0) r.rows[0].backend_tls_active = false; },
  ];
  for (const mutate of edits) { const r = await run({ mutate }); await assert.rejects(r.task);
    assert.equal(r.calls.includes(r.p.seed.insert.text), false); assert.equal(r.calls.at(-1), 'ROLLBACK'); }
  const r = await run({ existing: true }); await assert.rejects(r.task); assert.equal(r.calls.includes(r.p.seed.insert.text), false);
});
test('post INSERT foreign business row is never normalized away; rollback, no COMMIT or automatic retry', async () => {
  const r = await run({ mutate(row, i, inserted) { if (i === 4 && inserted) row.rows.find(v => v.name === 'Users').rows = '1'; } });
  await assert.rejects(r.task, /ACTUAL_ROW_COUNTS_DIVERGED/); assert.equal(r.calls.at(-1), 'ROLLBACK'); assert.equal(r.calls.includes('COMMIT'), false);
  assert.equal(r.calls.filter(t => t === r.p.seed.insert.text).length, 1);
});
test('uncertain COMMIT and post-commit persistence failure never rollback or replay', async () => {
  for (const issue of [{ failSql: 'COMMIT' }, { journalFail: 'COMMIT_ACKNOWLEDGED' }]) {
    const r = await run(issue); await assert.rejects(r.task, e => { assert.equal(e.storeSeedTransaction.commitSubmitted, true);
      assert.equal(e.storeSeedTransaction.rollbackAttempted, false); return true; });
    assert.equal(r.calls.at(-1), 'COMMIT'); assert.equal(r.calls.includes('ROLLBACK'), false);
  }
});
test('expired normal approval still permits exactly one safe ROLLBACK before COMMIT submission', async () => {
  const r = await run({ expireAfterInsert: true }); await assert.rejects(r.task, e => {
    assert.equal(e.storeSeedTransaction.rollbackAcknowledged, true); assert.equal(e.storeSeedTransaction.commitSubmitted, false); return true; });
  assert.equal(r.calls.at(-1), 'ROLLBACK');
});
test('transport guard rejects arbitrary SQL, reordered or altered parameters, callbacks, extra config and queries after terminal state', () => {
  const p = program();
  for (const bad of ['SELECT 1', p.seed.insert, { text: 'BEGIN ISOLATION LEVEL SERIALIZABLE' }, 'BEGIN ISOLATION LEVEL SERIALIZABLE; SELECT 1']) {
    assert.throws(() => seed.createQueryGuard(p, false, () => {}).check(bad)); }
  const seq = seed.querySequence(p, false), g = seed.createQueryGuard(p, false, () => {});
  for (const q of seq.slice(0, 12)) g.check(q.values ? q : q.text);
  assert.throws(() => g.check({ ...p.seed.insert, values: ['foreign', ...p.seed.insert.values.slice(1)] }));
  assert.throws(() => g.check({ ...p.seed.insert, name: 'unreviewed-prepared' }));
  assert.throws(() => g.check(p.seed.insert, [() => {}]));
  g.check(p.seed.insert); for (const q of seq.slice(13)) g.check(q.values ? q : q.text);
  assert.throws(() => g.check('COMMIT')); assert.throws(() => g.check('ROLLBACK'));
  const rolled = seed.createQueryGuard(p, false, () => {}); rolled.check(seq[0].text); rolled.check('ROLLBACK');
  assert.throws(() => rolled.check('ROLLBACK')); assert.throws(() => rolled.check(seq[1].text));
});
test('fresh SHA binds exact program/code/facts/deadline; expired, wrong SHA and serialized program are rejected', () => {
  const p = program(), now = Date.parse('2026-10-15T09:00:00Z'), code = 'a'.repeat(64);
  const facts = { observedAt: new Date(now).toISOString(), source: { Account: '402010193138', Arn: 'arn:aws:iam::402010193138:user/techlong-sandbox-dev', UserId: 'AIDAV3GNMXTZEO7SHLC2X' },
    clusterVerified: true, sourceConnectAllowed: true, controlPlane: { result: { startedAt: now - 1000, completedAt: now,
      outcome: 'FIRST_CLAIM_CANDIDATE_AURORA_PROOF_STILL_REQUIRED', subscriptionId: 'sub_9253b47df64946a3ae6234ce1294ba26',
      checks: { app: true, configuration: true, subscription: true, workspace: true, environment: true, platform: true, authority: true } } } };
  const m = seed.prepare({ program: p, codeBindingSha256: code, facts, now }); seed.approval(m, m.manifestSha256, code, p, now + 1000);
  assert.throws(() => seed.approval(m, 'b'.repeat(64), code, p, now)); assert.throws(() => seed.approval(m, m.manifestSha256, 'b'.repeat(64), p, now));
  assert.throws(() => seed.approval(m, m.manifestSha256, code, p, Date.parse(m.expiresAt)));
  assert.throws(() => seed.approval(m, m.manifestSha256, code, structuredClone(p), now));
  const stale = structuredClone(facts); delete stale.controlPlane.result.startedAt;
  assert.throws(() => seed.prepare({ program: p, codeBindingSha256: code, facts: stale, now }));
  assert.equal(m.currentAuroraStateProvedAtReview, false); assert.equal(m.program.limits.awsWrites, 0);
});
