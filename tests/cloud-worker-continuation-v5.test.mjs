import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalJson, sha256Hex } from '../lib/deployments/execution/hash.ts';
import { RECOVERY_ANCHOR_V5 as A } from '../ops/cloud-worker/install/recovery-v5.mjs';
import { INSTALL_CANDIDATE_V5 as C } from '../ops/cloud-worker/install/inventory-v5.mjs';
import { secretResourcePolicyV5 } from '../ops/cloud-worker/install/plan-v5.mjs';
import { CONTINUATION_V5 as K, CONTINUATION_EFFECTS_V5, prepareContinuationV5, continueLockedV5,
  assertContinuationApprovalV5 } from '../ops/cloud-worker/install/continuation-v5.mjs';
import { createContinuationSecretsV5, assessContinuationSecretV5, continuationErrorV5, safeContinuationFailureV5,
  CONTROL_PUBLICATION_DELAYS_V5 } from '../ops/cloud-worker/install/continuation-secrets-v5.mjs';
import { mainContinuationV5 } from '../ops/cloud-worker/install/run-continuation-v5.mjs';
const now = 1800000000000, source = { commit: 'a'.repeat(40), files: [{ file: 'test.mjs',normalizedLfSha256: 'b'.repeat(64) }] },
  material = { summarySha256: 'c'.repeat(64) }, history = { priorRecordRawSha256: K.priorRecordRawSha256,priorProofRawSha256: K.priorProofRawSha256 };
const endpoint = await sha256Hex({ host: 'ep-ci-proof.ca-central-1.aws.neon.tech',port: 5432,database: 'neondb',role: 'techlong_cloud_worker_v5',transport: 'NeonHTTPS' });
const fakeUrl = 'postgresql://techlong_cloud_worker_v5:' + 'a'.repeat(96) + '@ep-ci-proof.ca-central-1.aws.neon.tech/neondb?sslmode=verify-full';
function metadata(index,fixed) {
  const ref = A.secrets[index], stages = { [ref.versionId]: ['AWSCURRENT'] };
  return [{ ARN: ref.arn,Name: C.secrets[index],Tags: [{ Key: 'Purpose',Value: 'cloud-worker-v5' },{ Key: 'Environment',Value: 'aws-sandbox' }],
    VersionIdsToStages: fixed ? stages : {} },{ ARN: ref.arn,ResourcePolicy: JSON.stringify(secretResourcePolicyV5()) },
  { ARN: ref.arn,...(fixed ? { Versions: [{ VersionId: ref.versionId,VersionStages: ['AWSCURRENT'] }] } : {}) }];
}
function secretFixture({ fail, pending = 0, ackFailure = false, payload = { schema: 'techlong/cloud-worker-neon-material/v5',databaseUrl: fakeUrl }, response = {} } = {}) {
  const events = [], commands = [], receipts = [], waits = []; let observations = 0;
  const port = createContinuationSecretsV5({
    async send(q) {
      commands.push(q); events.push(q.constructor.name);
      if (fail === q.constructor.name) throw Object.assign(Error('DO_NOT_SAVE_PASSWORD_OR_QUERY'),{ name: 'AccessDeniedException',$metadata: { httpStatusCode: 403 } });
      if (q.constructor.name === 'GetSecretValueCommand') return { ARN: A.secrets[0].arn,Name: C.secrets[0],VersionId: A.secrets[0].versionId,
        VersionStages: ['AWSCURRENT'],SecretString: JSON.stringify(payload),...response };
      assert.equal(q.constructor.name,'PutSecretValueCommand'); return { ARN: A.secrets[1].arn,VersionId: A.secrets[1].versionId };
    },
    async verifyMetadata(i,mode) {
      events.push('metadata-' + i + '-' + mode);
      if (mode === 'published') { observations++; if (fail === 'policy') throw continuationErrorV5('CONT_SECRET_POLICY');
        if (observations <= pending) throw continuationErrorV5('CONT_CONTROL_PUBLICATION_PENDING'); }
      return assessContinuationSecretV5(i,...metadata(i,mode !== 'empty'),mode);
    },
    async record(name,value) { events.push('record-' + name); if (ackFailure) throw Error('LOCAL_DISK_FAILURE'); receipts.push({ name,value }); },
    checkpoint: label => events.push('checkpoint-' + label),approve: async () => { if (fail === 'approval') throw continuationErrorV5('CONT_APPROVAL'); },
    wait: async ms => { waits.push(ms); },
  });
  return { port,events,commands,receipts,waits };
}
function prestate() {
  return { finishedAt: now,oldSlotSha256: A.oldSlotSha256,priorSlotSha256: K.priorSlotSha256,
    foundation: { stackId: A.stackId,roleId: A.roleId,tableId: A.tableId,lockedTrustVerified: true },
    secrets: A.secrets.map((_,i) => assessContinuationSecretV5(i,...metadata(i,i === 0),i === 0 ? 'fixed' : 'empty')),
    provider: { actor: 'neondb_owner',session_actor: 'neondb_owner',owner_oid: '16392',read_only: 'on',forward_ddl: 'on',password_encryption: 'scram-sha-256' },
    metadata: { aws: { source: { Arn: 'arn:aws:iam::402010193138:user/techlong-sandbox-dev',Account: '402010193138',UserId: 'AIDAV3GNMXTZEO7SHLC2X' },
      preservedIam: { iamLayoutUnchanged: true } },neon: { state: 'READ',targetFingerprintSha256: 'e'.repeat(64),catalog: {
      actor: 'neondb_owner',session_actor: 'neondb_owner',read_only: 'on',installer: { oid: '16392',createRole: true,superuser: false },
      candidate_role: null,candidate_schema: null,public_database_create: false,public_create_schemas: [],public_relation_grants: [],public_column_grants: [],
      definers: [],default_acl: [],target_tables: Array.from({ length: 10 },(_,i) => ({ name: 'table' + i,owner: '16392',rls: false,forceRls: false })) } } } };
}
async function rootFixture() {
  const p = prestate(), manifest = await prepareContinuationV5({ prestate: p,source,material,history,now }), events = [], records = [];
  let slot = false, fail, checkpoint = 'Fixture', guard;
  const counts = { sourceSecretValueReadAttempts: 0,controlPutAttempts: 0,neonTransactionAttempts: 0,originalPrivateBundleReadAttempts: 0,neonCommitAcknowledged: false };
  const invoke = async name => { events.push(name); checkpoint = name; await guard(); if (name === fail) throw continuationErrorV5('CONT_CATALOG'); };
  const io = {
    async preflight() { events.push('preflight'); return p; },
    async consumeSlot() { assert.equal(slot,false); slot = true; events.push('slot'); },setApprovalGuard: fn => { guard = fn; },
    async record(name,value) { records.push({ name,value }); },checkpoint: () => checkpoint,
    async readDatabase() { counts.sourceSecretValueReadAttempts++; await invoke('read-db'); return { reused: true }; },
    async readControl() { counts.originalPrivateBundleReadAttempts++; await invoke('read-control'); return { verified: true }; },
    async putControl() { counts.controlPutAttempts++; await invoke('put-control'); return { acknowledged: true }; },
    async installNeon() { counts.neonTransactionAttempts++; await invoke('neon'); counts.neonCommitAcknowledged = true; return { commitAcknowledged: true }; },
    async verifyDedicatedNeon() { await invoke('dedicated'); return { roleOid: '20000',ownerOid: '16392',endpointSha256: endpoint,
      functionOids: { read_state: '20001',claim: '20002',lease: '20003',complete: '20004' } }; },
    async inspectInstalled() { await invoke('inspect'); return { roleId: A.roleId,tableId: A.tableId,lockedTrustVerified: true }; },
    counts: () => ({ ...counts }),disposePrivate: () => events.push('dispose'),
  };
  return { p,manifest,events,records,io,counts,failAt: name => { fail = name; },
    run: () => continueLockedV5({ manifest,approvedSha256: manifest.manifestSha256,source,material,history,io,now: () => now }) };
}
test('fixed database value request binds full ARN + VersionId + AWSCURRENT exactly once; no password regeneration', async () => {
  const f = secretFixture(); assert.equal(await f.port.readDatabase(endpoint),fakeUrl);
  assert.deepEqual(f.commands[0].input,{ SecretId: A.secrets[0].arn,VersionId: A.secrets[0].versionId,VersionStage: 'AWSCURRENT' });
  await assert.rejects(f.port.readDatabase(endpoint)); assert.equal(f.commands.length,1);
  assert.equal(f.port.counts().generatedPassword,false); assert.equal(f.port.counts().databaseSecretWrites,0);
});
test('wrong database response/version/endpoint/payload/password never permits control write', async () => {
  for (const response of [{ ARN: A.secrets[1].arn },{ VersionId: A.secrets[1].versionId },{ VersionStages: ['AWSPREVIOUS'] },{ SecretBinary: new Uint8Array([1]) },{ Name: C.secrets[1] }]) {
    const f = secretFixture({ response }); await assert.rejects(f.port.readDatabase(endpoint));
    assert.equal(f.commands.some(q => q.constructor.name === 'PutSecretValueCommand'),false);
  }
  for (const payload of [{ databaseUrl: fakeUrl,schema: 'wrong' },{ databaseUrl: fakeUrl.replace('a'.repeat(96),'b'.repeat(95)),schema: 'techlong/cloud-worker-neon-material/v5' },
    { databaseUrl: fakeUrl.replace('ep-ci-proof','ep-elsewhere'),schema: 'techlong/cloud-worker-neon-material/v5' }]) {
    const f = secretFixture({ payload }); await assert.rejects(f.port.readDatabase(endpoint));
    await assert.rejects(f.port.putControl({ fixture: true })); assert.equal(f.commands.length,1);
  }
});
test('Read approval fails before the single credential-bearing API; access denial is never retried', async () => {
  const f = secretFixture({ fail: 'approval' }); await assert.rejects(f.port.readDatabase(endpoint)); assert.equal(f.commands.length,0);
  const g = secretFixture({ fail: 'GetSecretValueCommand' }); await assert.rejects(g.port.readDatabase(endpoint));
  await assert.rejects(g.port.readDatabase(endpoint)); assert.equal(g.commands.length,1);
});
test('metadata checks include deprecated versions, policy, exact tags/default KMS and reject unknown or extra state', () => {
  assert.equal(assessContinuationSecretV5(0,...metadata(0,true),'fixed').versionCount,1);
  assert.equal(assessContinuationSecretV5(1,...metadata(1,false),'empty').versionCount,0);
  for (const mutate of [m => { m[0].KmsKeyId = 'unexpected'; },m => { m[0].RotationEnabled = true; },m => { m[0].Tags = []; },
    m => { m[1].ResourcePolicy = '{}'; },m => { m[2].NextToken = 'more'; },m => { m[2].Versions.push({ VersionId: 'other' }); },
    m => { m[2].Versions[0].VersionStages = ['AWSPREVIOUS']; },m => { m[0].ARN = A.secrets[1].arn; }]) {
    const m = metadata(0,true); mutate(m); assert.throws(() => assessContinuationSecretV5(0,...m,'fixed'));
  }
});
test('control single Put is preceded by database read; API ACK is recorded BEFORE bounded publication observations', async () => {
  const f = secretFixture({ pending: 2 }); await assert.rejects(f.port.putControl({ fixture: true }));
  await f.port.readDatabase(endpoint); await f.port.putControl({ fixture: true });
  assert.equal(f.commands.length,2); const put = f.commands[1];
  assert.equal(put.input.SecretId,A.secrets[1].arn); assert.equal(put.input.ClientRequestToken,A.secrets[1].versionId);
  assert.ok(f.events.indexOf('record-control-api-ack') < f.events.indexOf('metadata-1-published'));
  assert.equal(f.port.counts().controlPutAcknowledged,1); assert.equal(f.port.counts().publicationObservations,3);
  assert.deepEqual(f.waits,[1000,2000]); assert.equal(JSON.stringify(f.receipts).includes(fakeUrl),false);
  await assert.rejects(f.port.putControl({ fixture: true })); assert.equal(f.commands.length,2);
});
test('publication visibility may lag but unexpected versions/security drift are not retryable visibility', () => {
  for (const visible of [false,true]) {
    const m = metadata(1,visible); if (visible) m[2].Versions = [];
    assert.throws(() => assessContinuationSecretV5(1,...m,'published'),e => e.continuationCode === 'CONT_CONTROL_PUBLICATION_PENDING');
  }
  const m = metadata(1,true); m[2].Versions[0].VersionId = 'unexpected';
  assert.throws(() => assessContinuationSecretV5(1,...m,'published'),e => e.continuationCode === 'CONT_SECRET_VERSION_SET');
});
test('publication timeout retains ACK, five read-only observations and exactly one write; no fallback', async () => {
  const f = secretFixture({ pending: 99 }); await f.port.readDatabase(endpoint); await assert.rejects(f.port.putControl({ fixture: true }));
  assert.equal(f.port.counts().controlPutAttempts,1); assert.equal(f.port.counts().controlPutAcknowledged,1);
  assert.equal(f.port.counts().publicationObservations,5); assert.equal(f.receipts.length,1);
  assert.deepEqual(f.waits,CONTROL_PUBLICATION_DELAYS_V5.slice(1)); assert.equal(f.commands.length,2);
});
test('local ACK storage failure never repeats Put or starts metadata; policy failure halts without waiting', async () => {
  const f = secretFixture({ ackFailure: true }); await f.port.readDatabase(endpoint); await assert.rejects(f.port.putControl({ fixture: true }));
  assert.equal(f.port.counts().controlPutAcknowledged,1); assert.equal(f.port.counts().publicationObservations,0);
  await assert.rejects(f.port.putControl({ fixture: true })); assert.equal(f.commands.length,2);
  const g = secretFixture({ fail: 'policy' }); await g.port.readDatabase(endpoint); await assert.rejects(g.port.putControl({ fixture: true }));
  assert.equal(g.port.counts().publicationObservations,1); assert.equal(g.waits.length,0);
});
test('safe diagnostics save only allowlisted assertion/category/SQLSTATE/status, never arbitrary provider text', () => {
  const e = Object.assign(continuationErrorV5('CONT_SECRET_POLICY'),{ message: fakeUrl,name: 'NeonDbError',code: '42501',detail: fakeUrl,query: fakeUrl });
  const d = safeContinuationFailureV5(e); assert.equal(d.assertion,'CONT_SECRET_POLICY'); assert.equal(d.sqlState,'42501');
  assert.equal(JSON.stringify(d).includes(fakeUrl),false);
  assert.equal(safeContinuationFailureV5({ continuationCode: fakeUrl,message: fakeUrl,code: fakeUrl }).assertion,null);
});
test('new continuation binds previous sealed attempt, one fixed Get, missing control Put and zero password generation', async () => {
  const f = await rootFixture(), m = f.manifest;
  await assertContinuationApprovalV5(m,m.manifestSha256,{ source,material,history,now });
  assert.deepEqual(m.effects,CONTINUATION_EFFECTS_V5); assert.equal(m.actionsSha256,await sha256Hex(m.actions));
  assert.equal(m.effects.sourceDatabaseFixedValueReads,1); assert.equal(m.effects.controlFixedVersionPuts,1);
  assert.equal(m.effects.generatedPasswordBytes,0); assert.equal(m.effects.databaseSecretWrites,0);
  assert.equal(m.actions.neon.passwordSource.versionId,A.secrets[0].versionId);
  assert.match(m.actions.neon.recipe[3],/EXISTING_FIXED_VERSION_PASSWORD/);
  assert.notEqual(m.manifestSha256,K.priorManifestSha256);
});
test('old SHA, expired/tampered review or changed source/history is rejected before preflight/private/slot', async () => {
  for (const mutate of [m => { m.expiresAt = now; },m => { m.actions.noDatabaseVersionReplacement = false; },
    m => { m.effects.databaseSecretWrites = 1; },m => { m.history.priorRecordRawSha256 = '0'.repeat(64); },m => { m.source.commit = 'f'.repeat(40); }]) {
    const f = await rootFixture(), m = structuredClone(f.manifest); mutate(m);
    await assert.rejects(continueLockedV5({ manifest: m,approvedSha256: f.manifest.manifestSha256,source,material,history,io: f.io,now: () => now }));
    assert.deepEqual(f.events,[]);
  }
  const f = await rootFixture(); await assert.rejects(continueLockedV5({ manifest: f.manifest,approvedSha256: K.priorManifestSha256,source,material,history,io: f.io,now: () => now }));
  assert.deepEqual(f.events,[]);
});
test('database absent/extra version, control populated, provider hook off or changed prior slot never consumes a continuation slot', async () => {
  for (const mutate of [p => { p.secrets[0].versionCount = 0; },p => { p.secrets[1].fixedVersionPresent = true; },
    p => { p.secrets[0].allVersionsIncludingDeprecatedVerified = false; },p => { p.priorSlotSha256 = '0'.repeat(64); },
    p => { p.metadata.neon.catalog.candidate_role = { oid: 'other' }; },p => { p.provider.forward_ddl = 'off'; },p => { p.finishedAt = now - 30001; }]) {
    const f = await rootFixture(); mutate(f.p); await assert.rejects(f.run()); assert.deepEqual(f.events,['preflight']);
  }
});
test('one new slot -> exact database read -> private control -> missing value -> SQL -> dedicated catalog -> binding; no activation', async () => {
  const f = await rootFixture(), r = await f.run(); assert.equal(r.outcome,'CONTINUATION_LOCKED_COMPLETE_REQUIRES_INDEPENDENT_INSPECT');
  assert.deepEqual(f.events,['preflight','slot','read-db','read-control','put-control','neon','dedicated','inspect','dispose']);
  assert.equal(f.counts.sourceSecretValueReadAttempts,1); assert.equal(f.counts.controlPutAttempts,1); assert.equal(f.counts.neonTransactionAttempts,1);
  assert.equal(r.runtimeEnabled,false); assert.equal(f.records.some(x => x.name === 'installation-binding'),true);
  await assert.rejects(f.run()); assert.equal(f.events.filter(x => x === 'neon').length,1);
});
test('every continuation failure saves phase + exact checkpoint without fallback, and preserves separate commit ACK count', async () => {
  for (const name of ['read-db','read-control','put-control','neon','dedicated','inspect']) {
    const f = await rootFixture(); f.failAt(name); const r = await f.run();
    assert.equal(r.outcome,'CONTINUATION_PARTIAL_OR_UNKNOWN_INSPECT_ONLY_NO_RETRY'); assert.equal(r.checkpoint,name);
    assert.equal(r.failure.assertion,'CONT_CATALOG'); assert.equal(f.events.filter(x => x === name).length,1);
    assert.equal(f.events.at(-1),'dispose'); assert.equal(f.records.some(x => x.name === 'installation-binding'),false);
    if (['dedicated','inspect'].includes(name)) assert.equal(r.counts.neonCommitAcknowledged,true);
    await assert.rejects(f.run());
  }
});
test('new adapter never generates passwords/creates/changes IAM or secrets; old slots are only read, CLI has no old modes', async () => {
  const text = await readFile(new URL('../ops/cloud-worker/install/continuation-local-io-v5.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(text,/randomBytes|CreateStackCommand|CreateSecretCommand|PutResourcePolicyCommand|UpdateAssumeRolePolicyCommand/);
  assert.match(text,/IncludeDeprecated: true/); assert.match(text,/flag: 'wx'/);
  const helper = await readFile(new URL('../ops/cloud-worker/install/continuation-secrets-v5.mjs',import.meta.url),'utf8');
  assert.equal((helper.match(/new GetSecretValueCommand/g) ?? []).length,1); assert.equal((helper.match(/new PutSecretValueCommand/g) ?? []).length,1);
  assert.match(helper,/SecretId: ref.arn, VersionId: ref.versionId, VersionStage: 'AWSCURRENT'/);
  for (const mode of ['InstallLocked','RecoverLocked','Delete','Activate']) await assert.rejects(mainContinuationV5(['--mode',mode,'--output','unused']));
  await assert.rejects(mainContinuationV5(['--mode','ContinueLocked','--output','unused']));
  assert.equal(canonicalJson(CONTINUATION_EFFECTS_V5).includes('databaseSecretWrites'),true);
});
