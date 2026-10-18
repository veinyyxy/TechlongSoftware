import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, access } from 'node:fs/promises';
import yaml from 'js-yaml';
import { sha256Hex } from '../lib/deployments/execution/hash.ts';
import { prepareInstallV5, installLockedV5, assertInstallApprovalV5, stablePrestateV5, INSTALL_EFFECTS_V5 } from '../ops/cloud-worker/install/installer-v5.mjs';
import { INSTALL_SCOPE_V5 as I } from '../ops/cloud-worker/install/plan-v5.mjs';
import { INSTALL_CANDIDATE_V5 as C } from '../ops/cloud-worker/install/inventory-v5.mjs';
import { scramVerifierV5, neonInstallStatementsV5 } from '../ops/cloud-worker/install/local-io-v5.mjs';
import { validateWorkflowInputV5 } from '../ops/cloud-worker/workflow-input-v5.mjs';
const capsule = JSON.parse(await readFile(new URL('../ops/cloud-worker/material/public-capsule-v5.json', import.meta.url), 'utf8'));
const source = { commit: 'a'.repeat(40), files: [{ file: 'installer.mjs', normalizedLfSha256: 'b'.repeat(64) }] },
  material = { summarySha256: 'c'.repeat(64) }, now = 1800000000000;
function state() {
  const absent = { state: 'ABSENT_AT_CHECK' };
  return { finishedAt: now, foundation: absent, aws: { source: { Arn: I.sourceArn, Account: '402010193138', UserId: 'AIDAV3GNMXTZEO7SHLC2X' },
    preservedIam: { iamLayoutUnchanged: true }, oidcRoleReferenceScanComplete: true,
    oidc: { state: 'READ', value: { Url: 'token.actions.githubusercontent.com', ClientIDList: ['sts.amazonaws.com'], ThumbprintList: ['thumbprint'] } },
    workerRole: absent, boundary: absent, journal: absent, evidenceBucket: absent,
    secrets: Object.fromEntries(C.secrets.map(n => [n, absent])) },
  neon: { state: 'READ', targetFingerprintSha256: 'd'.repeat(64), catalog: { read_only: 'on', actor: 'neondb_owner', session_actor: 'neondb_owner',
    installer: { oid: '16392', createRole: true }, candidate_role: null, candidate_schema: null, public_database_create: false,
    public_create_schemas: [], public_relation_grants: [], public_column_grants: [], definers: [], default_acl: [],
    target_tables: Array.from({ length: 10 }, (_, i) => ({ name: 'table' + i, owner: '16392', rls: false, forceRls: false })) } } };
}
async function fixture() {
  const prestate = state(), manifest = await prepareInstallV5({ capsule, prestate, source, material, now }),
    events = [], records = [], attempted = [];
  let occupied = false, failAt;
  const call = async name => { events.push(name); attempted.push(name); if (failAt === name) throw Error('ambiguous provider failure DO_NOT_PERSIST'); };
  const neon = { roleOid: '20000', ownerOid: '16392', endpointSha256: 'e'.repeat(64),
    functionOids: { read_state: '20001', claim: '20002', lease: '20003', complete: '20004' } };
  const io = {
    async preflight() { events.push('preflight'); return prestate; },
    async consumeSlot() { events.push('slot'); assert.equal(occupied, false); occupied = true; },
    async record(name, value) { records.push({ name, value }); },
    async createFoundation() { await call('foundation'); return { stackId: 'fixed' }; },
    async verifyFoundation() { events.push('verify-locked'); },
    async createEmptySecret(a) { await call('empty:' + a.name); return { arn: `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${a.name}-ABC123` }; },
    async isolateSecret(ref) { await call('isolate:' + ref.arn); return { isolated: true }; },
    async verifySecret(ref) { events.push('verify-isolation:' + ref.arn); },
    async loadControl() { events.push('private'); return { private: 'DO_NOT_PERSIST' }; },
    async installNeon() { await call('neon'); return neon; },
    async verifyDedicatedNeon() { events.push('verify-dedicated'); },
    async putDatabase() { await call('database-version'); return { put: true }; },
    async putControl() { await call('control-version'); return { put: true }; },
    async inspect() { events.push('inspect'); return { outcome: 'LOCKED_INSTALL_METADATA_VERIFIED',
      roleId: 'AROA' + 'A'.repeat(17), tableId: '12345678-1234-4234-8234-123456789abc' }; },
    disposePrivate() { events.push('dispose'); },
  };
  return { manifest, io, events, records, attempted, prestate,
    fail: name => { failAt = name; }, run: () => installLockedV5({ manifest, approvedSha256: manifest.manifestSha256, capsule, source, material, io, now: () => now }) };
}
test('locked installer binds exact sources/actions/capsule, finite approval and no activation/workload authority', async () => {
  const f = await fixture();
  await assertInstallApprovalV5(f.manifest, f.manifest.manifestSha256, { capsule, source, material, now });
  assert.equal(f.manifest.actionsSha256, await sha256Hex(f.manifest.actions));
  assert.deepEqual(f.manifest.effects, INSTALL_EFFECTS_V5); assert.equal(f.manifest.actions.foundation.terminationProtection, true);
  assert.equal(f.manifest.actions.foundation.template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Effect, 'Deny');
  assert.equal(f.manifest.activationAuthorized, false); assert.equal(f.manifest.effects.githubWrites, 0);
  assert.equal(f.manifest.expiresAt - now, 7200000);
});
test('wrong SHA, expired approval or edited action/source stops BEFORE preflight/slot/private read', async () => {
  for (const mutation of [m => { m.effects.createStackCalls = 2; }, m => { m.actions.activation = 'RUN'; },
    m => { m.source.commit = 'f'.repeat(40); }, m => { m.expiresAt = now; }]) {
    const f = await fixture(), m = structuredClone(f.manifest); mutation(m);
    await assert.rejects(installLockedV5({ manifest: m, approvedSha256: f.manifest.manifestSha256, capsule, source, material, io: f.io, now: () => now }));
    assert.deepEqual(f.events, []);
  }
  const f = await fixture();
  await assert.rejects(installLockedV5({ manifest: f.manifest, approvedSha256: '0'.repeat(64), capsule, source, material, io: f.io, now: () => now }));
  assert.deepEqual(f.events, []);
});
test('fresh unknown/collision/default ACL or changed catalog is not absence and consumes no slot', async () => {
  for (const alter of [s => { s.foundation.state = 'UNKNOWN_NOT_ABSENT'; }, s => { s.aws.workerRole = { state: 'READ' }; },
    s => { s.neon.catalog.default_acl.push({ owner: '16392', type: 'f' }); },
    s => { s.neon.catalog.target_tables[0].owner = '99'; }, s => { s.finishedAt -= 30001; }]) {
    const f = await fixture(); alter(f.prestate); await assert.rejects(f.run()); assert.deepEqual(f.events, ['preflight']);
  }
  assert.throws(() => stablePrestateV5({}));
});
test('real orchestrator has one fixed slot, both Secrets isolated before private read, seven AWS writes and one Neon transaction', async () => {
  const f = await fixture(), r = await f.run();
  assert.equal(r.outcome, 'LOCKED_INSTALLED_REQUIRES_INDEPENDENT_INSPECT_AND_ACTIVATION_REVIEW');
  assert.equal(r.attemptedAwsWrites, 7); assert.equal(r.attemptedNeonWrites, 1); assert.equal(r.privateReads, 1);
  assert.ok(f.events.indexOf('slot') < f.events.indexOf('foundation'));
  assert.equal(f.events.slice(0, f.events.indexOf('private')).filter(x => x.startsWith('verify-isolation:')).length, 2);
  assert.ok(f.events.indexOf('verify-dedicated') < f.events.indexOf('database-version'));
  assert.equal(JSON.stringify(f.records).includes('DO_NOT_PERSIST'), false);
  const binding = f.records.find(x => x.name === 'installation-binding').value;
  assert.equal(binding.installed, true); assert.equal(r.trustActivated, false); assert.equal(r.runtimeEnabled, false);
  const count = f.attempted.length; await assert.rejects(f.run()); assert.equal(f.attempted.length, count);
});
test('every ambiguous external mutation halts immediately, preserves slot/intents, never compensates/retries', async () => {
  const baseline = await fixture(); await baseline.run();
  for (const name of baseline.attempted) {
    const f = await fixture(); f.fail(name); const r = await f.run();
    assert.equal(r.outcome, 'PARTIAL_OR_UNKNOWN_REQUIRES_INDEPENDENT_INSPECT_NO_RETRY');
    assert.equal(f.attempted.at(-1), name); assert.equal(f.attempted.filter(n => n === name).length, 1);
    assert.equal(f.records.some(x => x.name === 'installation-binding'), false);
    assert.equal(f.events.at(-1), 'dispose');
    assert.equal(JSON.stringify(f.records).includes('DO_NOT_PERSIST'), false);
    await assert.rejects(f.run());
  }
});
test('SCRAM generation only accepts generated high-entropy hex and fixed SQL contains verifier not plaintext', async () => {
  const password = 'a'.repeat(96), verifier = scramVerifierV5(password, Buffer.alloc(16, 1));
  assert.match(verifier, /^SCRAM-SHA-256\$4096:/);
  assert.equal(verifier, scramVerifierV5(password, Buffer.alloc(16, 1)));
  const sql = await neonInstallStatementsV5(verifier);
  assert.equal(sql.length, 19); assert.ok(sql[2].startsWith('CREATE ROLE techlong_cloud_worker_v5 LOGIN NOINHERIT'));
  assert.ok(!sql.join('\n').includes(password)); assert.ok(!sql.join('\n').includes('OR REPLACE'));
  assert.throws(() => scramVerifierV5("bad' password")); await assert.rejects(neonInstallStatementsV5("invalid'; DROP ROLE x;--"));
});
const prefix = 'worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/';
const ref = key => JSON.stringify({ key, versionId: 'version-1', sha256: 'b'.repeat(64) });
const input = () => ({ mode: 'Review', job: 'job_' + '1'.repeat(24), installationSha: 'a'.repeat(64),
  installation: ref(prefix + 'installation/' + 'a'.repeat(64) + '.json'), manifest: '', manifestSha: '', execution: '', lineage: '' });
test('workflow inputs carry only fixed private S3 version references, not manifests/secrets or arbitrary paths', () => {
  assert.equal(validateWorkflowInputV5(input()).mode, 'Review');
  for (const alter of [i => { i.installation = '{"databaseUrl":"private"}'; },
    i => { i.installation = ref('other-tenant/manifest.json'); }, i => { i.installation = ref(prefix + '../escape'); },
    i => { i.mode = 'RunOnce'; }, i => { i.mode = 'Review; curl evil'; }]) {
    const i = input(); alter(i); assert.throws(() => validateWorkflowInputV5(i));
  }
  const i = input(); i.mode = 'RunOnce'; i.manifestSha = 'c'.repeat(64);
  i.manifest = ref(prefix + i.job + '/' + i.manifestSha + '/manifest.json'); validateWorkflowInputV5(i);
  i.execution = ref(prefix + 'run.json'); assert.throws(() => validateWorkflowInputV5(i));
});
test('candidate workflows are inactive, main-only, environment-reviewed, rerun-disabled and do not upload private artifacts', async () => {
  const root = '../ops/cloud-worker/workflow-candidates/';
  const caller = yaml.load(await readFile(new URL(root + 'cloud-worker-execute.yml', import.meta.url), 'utf8')),
    reusable = yaml.load(await readFile(new URL(root + 'cloud-worker-job.yml', import.meta.url), 'utf8'));
  assert.ok(caller.on.workflow_dispatch); assert.equal(Object.keys(caller.on).length, 1);
  assert.ok(caller.jobs.reviewed.uses.endsWith('@REVIEWED_REUSABLE_COMMIT_REQUIRED'));
  assert.match(caller.jobs.reviewed.if, /github.run_attempt == 1/);
  assert.equal(reusable.jobs.single.environment, 'techlong-sandbox-deploy');
  assert.equal(reusable.jobs.single.steps.some(s => /upload-artifact/.test(s.uses ?? '')), false);
  assert.equal(reusable.jobs.single.steps.some(s => s.env && Object.values(s.env).some(v => /secrets\./.test(v))), false);
  for (const name of ['cloud-worker-execute.yml','cloud-worker-job.yml'])
    await assert.rejects(access(new URL('../.github/workflows/' + name, import.meta.url)), { code: 'ENOENT' });
});
