import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { canonicalJson, sha256Hex } from '../lib/deployments/execution/hash.ts';
import { prepareRecoveryV5, recoverLockedV5, assertRecoveryApprovalV5, recoveryPrestateV5,
  RECOVERY_ANCHOR_V5 as A, RECOVERY_EFFECTS_V5 } from '../ops/cloud-worker/install/recovery-v5.mjs';
import { neonRecoveryRecipeV5, neonRecoveryStatementsV5, RECOVERY_PASSWORD_MARKER_V5, safeRecoveryFailureV5 } from '../ops/cloud-worker/install/neon-recovery-sql-v5.mjs';
import { mainRecoveryV5 } from '../ops/cloud-worker/install/run-recovery-v5.mjs';
const now = 1800000000000, source = { commit: 'a'.repeat(40), files: [{ file: 'recovery.mjs', normalizedLfSha256: 'b'.repeat(64) }] },
  material = { summarySha256: 'c'.repeat(64) }, history = { recordSha256: 'd'.repeat(64), evidenceFiles: 25 };
function prestate() {
  return { finishedAt: now, oldSlotSha256: A.oldSlotSha256, foundation: { stackId: A.stackId, roleId: A.roleId, tableId: A.tableId, lockedTrustVerified: true },
    secrets: A.secrets.map(s => ({ ...s, isolated: true, fixedVersionPresent: false, allVersionsIncludingDeprecatedVerified: true, versionCount: 0 })),
    provider: { actor: 'neondb_owner', session_actor: 'neondb_owner', owner_oid: '16392', read_only: 'on', forward_ddl: 'on', password_encryption: 'scram-sha-256' },
    metadata: { aws: { source: { Arn: 'arn:aws:iam::402010193138:user/techlong-sandbox-dev', Account: '402010193138', UserId: 'AIDAV3GNMXTZEO7SHLC2X' },
      preservedIam: { iamLayoutUnchanged: true } }, neon: { state: 'READ', targetFingerprintSha256: 'e'.repeat(64), catalog: {
      read_only: 'on', actor: 'neondb_owner', session_actor: 'neondb_owner', installer: { oid: '16392', createRole: true, superuser: false },
      candidate_role: null, candidate_schema: null, public_database_create: false, public_create_schemas: [],
      public_relation_grants: [], public_column_grants: [], definers: [], default_acl: [],
      target_tables: Array.from({ length: 10 }, (_, i) => ({ name: 'table' + i, owner: '16392', rls: false, forceRls: false })) } } } };
}
async function fixture() {
  const p = prestate(), manifest = await prepareRecoveryV5({ prestate: p, source, material, history, now }), events = [], records = [];
  let occupied = false, fail;
  const counts = { privateBundleReadAttempts: 0, passwordGenerated: false, awsPutAttempts: 0, awsPutAcknowledged: 0,
    neonTransactionAttempts: 0, neonCommitAcknowledged: false, dedicatedCatalogReads: 0, sourceSecretValueReads: 0 };
  const invoke = async name => {
    events.push(name);
    if (fail === name) throw Object.assign(Error("SECRET_LITERAL postgres://hidden/ PRIVATE_QUERY DO_NOT_SAVE"),
      { name: 'NeonDbError', code: 'XX000', detail: 'SECRET_LITERAL', query: 'SECRET_LITERAL' });
  };
  const io = {
    async preflight() { events.push('preflight'); return p; },
    async consumeSlot() { events.push('slot'); assert.equal(occupied, false); occupied = true; },
    async record(name, value) { records.push({ name, value }); },
    async preparePrivate() { counts.privateBundleReadAttempts++; await invoke('private'); counts.passwordGenerated = true;
      return { privateRead: true, privateValuesReturned: false }; },
    async putDatabase() { counts.awsPutAttempts++; await invoke('put-db'); counts.awsPutAcknowledged++; return { versionPut: true }; },
    async putControl() { counts.awsPutAttempts++; await invoke('put-control'); counts.awsPutAcknowledged++; return { versionPut: true }; },
    async installNeon() { counts.neonTransactionAttempts++; await invoke('neon'); counts.neonCommitAcknowledged = true; return { commitAcknowledged: true }; },
    async verifyDedicatedNeon() { counts.dedicatedCatalogReads++; await invoke('dedicated'); return { roleOid: '20000', ownerOid: '16392',
      endpointSha256: 'e'.repeat(64), functionOids: { read_state: '20001', claim: '20002', lease: '20003', complete: '20004' } }; },
    async inspectInstalled() { await invoke('inspect'); return { roleId: A.roleId, tableId: A.tableId, lockedTrustVerified: true }; },
    counts: () => ({ ...counts }), disposePrivate() { events.push('dispose'); },
  };
  return { p, manifest, events, records, io, counts, failAt: name => { fail = name; },
    run: () => recoverLockedV5({ manifest, approvedSha256: manifest.manifestSha256, source, material, history, io, now: () => now }) };
}
test('Neon recipe accepts only generated original password, rejects verifier/injection, and preserves fixed four-function contract', async () => {
  const password = 'a'.repeat(96), recipe = await neonRecoveryRecipeV5(), actual = await neonRecoveryStatementsV5(password);
  assert.equal(recipe.length, 20); assert.equal(actual.length, 20);
  assert.ok(recipe[3].includes(RECOVERY_PASSWORD_MARKER_V5)); assert.ok(!recipe.join('\n').includes(password));
  assert.ok(actual[3].includes("PASSWORD '" + password + "'")); assert.ok(!actual[3].includes('SCRAM'));
  assert.match(actual[2], /current_setting\('neon.forward_ddl',true\).*DISTINCT FROM 'on'/);
  assert.equal(actual.filter(s => s.startsWith('CREATE FUNCTION')).length, 4);
  assert.doesNotMatch(actual.join('\n'), /OR REPLACE|neon.forward_ddl\s*=|SET.*password_encryption/);
  for (const bad of ["SCRAM-SHA-256$4096:abc", "abc';DROP ROLE x;--", 'postgres://private', 'a'.repeat(95), 'A'.repeat(96)])
    await assert.rejects(neonRecoveryStatementsV5(bad));
});
test('failure classifier retains only finite category/SQLSTATE/HTTP status, never provider text/SQL/password or stack', () => {
  const e = Object.assign(Error('SECRET_LITERAL postgres://owner:private@host/db'), { name: 'NeonDbError', code: 'XX000',
    detail: 'SECRET_LITERAL', query: 'SECRET_LITERAL', cause: 'SECRET_LITERAL', $metadata: { httpStatusCode: 400 } });
  assert.deepEqual(safeRecoveryFailureV5(e), { category: 'NeonDbError', sqlState: 'XX000', httpStatus: 400,
    originalProviderTextSaved: false, uniqueCauseProved: false });
  const unsafe = safeRecoveryFailureV5({ name: 'SECRET_LITERAL', code: 'SECRET_LITERAL', status: 'SECRET_LITERAL' });
  assert.equal(JSON.stringify(unsafe).includes('SECRET_LITERAL'), false); assert.equal(unsafe.sqlState, null);
});
test('fresh recovery manifest is distinct from old approval, binds preserved IDs/history and two pre-SQL value puts only', async () => {
  const f = await fixture(), m = f.manifest;
  await assertRecoveryApprovalV5(m, m.manifestSha256, { source, material, history, now });
  assert.equal(m.actionsSha256, await sha256Hex(m.actions)); assert.equal(m.expiresAt - now, 7200000);
  assert.deepEqual(m.effects, RECOVERY_EFFECTS_V5); assert.equal(m.effects.createStackCalls, 0); assert.equal(m.effects.createSecretCalls, 0);
  assert.equal(m.actions.secretsBeforeSql, true); assert.equal(m.actions.failureMayLeavePopulatedSecrets, true);
  assert.equal(m.actions.neon.providerHookDisabled, false); assert.deepEqual(m.actions.reuseOnly, A);
  await assert.rejects(recoverLockedV5({ manifest: m, approvedSha256: A.oldManifestSha256, source, material, history, io: f.io, now: () => now }));
  assert.deepEqual(f.events, []);
});
test('wrong SHA/expired/tampered action or source/history stops before any preflight/slot/private generation', async () => {
  for (const mutate of [m => { m.expiresAt = now; }, m => { m.source.commit = 'f'.repeat(40); },
    m => { m.actions.secretsBeforeSql = false; }, m => { m.history.evidenceFiles = 0; }, m => { m.effects.putFixedSecretVersions = 3; }]) {
    const f = await fixture(), m = structuredClone(f.manifest); mutate(m);
    await assert.rejects(recoverLockedV5({ manifest: m, approvedSha256: f.manifest.manifestSha256, source, material, history, io: f.io, now: () => now }));
    assert.deepEqual(f.events, []);
  }
});
test('resource replacement, any prior version, changed old slot, role collision or hook disabled consumes no recovery slot', async () => {
  for (const mutate of [p => { p.foundation.roleId = 'AROA' + 'X'.repeat(17); }, p => { p.secrets[0].versionCount = 1; },
    p => { p.secrets[0].allVersionsIncludingDeprecatedVerified = false; }, p => { p.oldSlotSha256 = '0'.repeat(64); },
    p => { p.metadata.neon.catalog.candidate_role = { oid: 'other' }; }, p => { p.provider.forward_ddl = 'off'; },
    p => { p.metadata.aws.source.UserId = 'other'; }, p => { p.finishedAt = now - 30001; }]) {
    const f = await fixture(); mutate(f.p); await assert.rejects(f.run()); assert.deepEqual(f.events, ['preflight']);
  }
});
test('one independent slot then one private read, both durable values, one SQL transaction; no activation or replay', async () => {
  const f = await fixture(), r = await f.run();
  assert.equal(r.outcome, 'RECOVERY_LOCKED_COMPLETE_REQUIRES_INDEPENDENT_INSPECT');
  assert.deepEqual(f.events, ['preflight','slot','private','put-db','put-control','neon','dedicated','inspect','dispose']);
  assert.equal(r.counts.awsPutAttempts, 2); assert.equal(r.counts.neonTransactionAttempts, 1); assert.equal(r.counts.privateBundleReadAttempts, 1);
  assert.equal(r.runtimeEnabled, false); assert.equal(f.records.some(r => r.name === 'installation-binding'), true);
  const count = f.events.filter(x => x === 'put-db').length; await assert.rejects(f.run()); assert.equal(f.events.filter(x => x === 'put-db').length, count);
});
test('every private/write/read failure halts, preserves previous durable ACKs and safe diagnostics; no fallback writes', async () => {
  for (const name of ['private','put-db','put-control','neon','dedicated','inspect']) {
    const f = await fixture(); f.failAt(name); const r = await f.run();
    assert.equal(r.outcome, 'RECOVERY_PARTIAL_OR_UNKNOWN_INSPECT_ONLY_NO_RETRY'); assert.equal(r.failure.sqlState, 'XX000');
    assert.equal(JSON.stringify(f.records).includes('SECRET_LITERAL'), false); assert.equal(JSON.stringify(f.records).includes('postgres://'), false);
    assert.equal(f.events.at(-1), 'dispose'); assert.equal(f.events.filter(x => x === name).length, 1);
    assert.equal(f.records.some(x => x.name === 'installation-binding'), false);
    if (['neon','dedicated','inspect'].includes(name)) assert.equal(r.counts.awsPutAcknowledged, 2);
    if (['dedicated','inspect'].includes(name)) assert.equal(r.counts.neonCommitAcknowledged, true);
    await assert.rejects(f.run());
  }
});
test('catalog row order does not invent drift, but provider privilege and unknown booleans fail closed', () => {
  const a = prestate(), b = prestate(); b.metadata.neon.catalog.target_tables.reverse();
  assert.equal(canonicalJson(recoveryPrestateV5(a)), canonicalJson(recoveryPrestateV5(b)));
  b.metadata.neon.catalog.definers = [{}]; assert.throws(() => recoveryPrestateV5(b));
  assert.throws(() => recoveryPrestateV5({}));
});
test('separate recovery adapter has no creation/permission/Secret-value-read APIs; old installer is not modified', async () => {
  const text = await readFile(new URL('../ops/cloud-worker/install/recovery-local-io-v5.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /CreateStackCommand|CreateSecretCommand|PutResourcePolicyCommand|GetSecretValueCommand|UpdateAssumeRolePolicyCommand/);
  assert.match(text, /IncludeDeprecated: true/); assert.match(text, /flag: 'wx'/);
  assert.match(text, /password = randomBytes|target.password = randomBytes/);
});
test('CLI rejects old installer mode and malformed argument sets before local/runtime/network checks', async () => {
  await assert.rejects(mainRecoveryV5(['--mode','InstallLocked','--output','unused']));
  await assert.rejects(mainRecoveryV5(['--mode','RecoverLocked','--output','unused']));
  await assert.rejects(mainRecoveryV5(['--mode','Review','--mode','Review','--output','unused']));
});
