import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cloudRootFixtureV5 } from './fixtures/cloud-worker-root-v5.mjs';
import { createCloudWorkerRootV5, assertCloudManifestV5, continueCloudContextV5, assertInstallationV5, providerPublicV5 } from '../ops/cloud-worker/cloud-worker-root-v5.mjs';
import { loadNeonContractV5, renderNeonContractV5, packNeonProgramV5 } from '../ops/cloud-worker/neon-contract-v5.mjs';
import { compilePlatformInitializedClaimV4, compilePlatformInitializedCompleteV4, verifyPlatformInitializedCompletionReadbackV4 } from '../lib/deployments/execution/express-platform-claim-v4.ts';
import { EVIDENCE_V5, createEvidencePortV5, evidenceKeyV5, assertEvidenceSafeV5 } from '../ops/cloud-worker/cloud-evidence-v5.mjs';
import { validateDatabaseMaterialV5 } from '../ops/cloud-worker/cloud-application-v5.mjs';
import { databaseBindingDigestV2 } from '../lib/deployments/execution/aurora-database-v2.ts';
import { canonicalJson, sha256Hex } from '../lib/deployments/execution/hash.ts';
import { INITIALIZED_PLATFORM_SCOPE as S } from '../lib/deployments/initialized-platform-request-v1.ts';
const signal = () => AbortSignal.timeout(20000), run = { repository: 'veinyyxy/TechlongSoftware', runId: '123456789', runAttempt: 1, commitSha: 'a'.repeat(40) };
async function rig(fault = '') {
  const f = await cloudRootFixtureV5(), events = [], objects = new Map(), slots = [], state = structuredClone(f.observed), contract = await loadNeonContractV5();
  let clock = f.now, privateReads = 0, claimProgram, created = 0;
  const code = { commitSha: run.commitSha, closureSha256: 'b'.repeat(64) };
  const body = { schema: 'techlong/cloud-worker-installed-binding/v5', installed: true, roleId: 'AROA' + 'B'.repeat(17), tableId: '11111111-2222-4333-8444-555555555555',
    neon: { contractSha256: contract.contractSha256, sqlSha256: await sha256Hex(renderNeonContractV5(contract).statements), endpointSha256: 'd'.repeat(64), roleOid: '1001', ownerOid: '1000', functionOids: { read_state: '1002', claim: '1003', lease: '1004', complete: '1005' } },
    databaseSecret: { arn: 'arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/deployment-worker/neon-control-v1-Ab1234', versionId: 'a'.repeat(32) },
    controlSecret: { arn: 'arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/deployment-worker/control-first-acceptance-v1-Ab1234', versionId: 'b'.repeat(32) }, evidenceBucket: EVIDENCE_V5.bucket };
  const installation = { ...body, installationSha256: await sha256Hex(body) };
  const db = { verify: async () => { events.push('db.verify'); }, counts: () => ({ fixtureOnly: true }),
    read: async () => { events.push('db.read'); return { ...structuredClone(state), checkedAt: clock }; },
    bind: queuedJob => ({
      async claim(input) { events.push('claim'); if (fault === 'claim') throw Error('ambiguous');
        claimProgram = await compilePlatformInitializedClaimV4({ ...input, queuedJob });
        state.job = { ...state.job, status: 'running', attempts: 1, payload: claimProgram.statements[3].values[2], lease_token: input.leaseToken,
          lease_owner: claimProgram.lease.workerId, lease_expires_at: clock + 1200000 };
        return { lease: claimProgram.lease, leaseExpiresAt: clock + 1200000, programSha256: claimProgram.programSha256 }; },
      async assertLease() { events.push('lease'); return { accepted: true }; },
      async complete(input) { events.push('complete'); if (fault === 'complete') throw Error('commit ACK lost');
        const p = await compilePlatformInitializedCompleteV4({ ...input, queuedJob });
        state.snapshot.deployment.outputs = p.outputs; state.snapshot.deployment.updated_at = clock;
        state.job = { ...state.job, status: 'succeeded', completed_at: clock, lease_owner: null, lease_token: null, lease_expires_at: null };
        state.jobs = state.jobs.map(j => j.id === state.job.id ? structuredClone(state.job) : j);
        const r = await verifyPlatformInitializedCompletionReadbackV4({ ...input, queuedJob, snapshot: state.snapshot, job: state.job, expectedOutputs: p.outputs });
        return { ...r, receiptSha256: p.receiptSha256, programSha256: p.programSha256, checkedAt: clock }; },
    }),
  };
  const evidence = { verify: async () => {},
    async put(kind, ref, value) { assertEvidenceSafeV5(value); const key = evidenceKeyV5(kind, ref); assert.equal(objects.has(key), false);
      const saved = { key, versionId: 'fixture-version', sha256: await sha256Hex(value) }; objects.set(key, { value: structuredClone(value), saved }); return saved; },
    async get(kind, ref, expected) { const o = objects.get(evidenceKeyV5(kind, ref)); assert.equal(o.saved.sha256, expected.sha256); return structuredClone(o.value); },
  };
  const publicProvider = () => ({ ...structuredClone(f.capsule.lineage.providerObservation), stackId: f.proof.stackId, checkedAt: clock,
    physical: { ...f.capsule.lineage.providerObservation.physical, TenantTaskDefinition: f.context.predecessor.taskDefinitionArn.replace(':5', ':6') } });
  const provider = {
    async readCell() { events.push('readCell'); return { stackId: f.context.base.compute.stackId, outputs: Object.fromEntries(
      ['ClusterName','VpcId','SubnetIds','TaskSecurityGroupId','HttpsListenerArn','ControlListenerArn'].map(k => [k, f.context.base.compute.outputs[k]])),
    parentTagExpiresAt: f.context.base.compute.outputs.CellExpiresAt, activeCellCount: 1, activeTenantCount: 0 }; },
    async inspectBefore() { events.push('preflight'); return { namespacesAbsent: true, retiredPredecessor: f.context.predecessor.stackId, cloudWrites: 0 }; },
    async inspectAfter() { events.push('freshInspect'); return { ...publicProvider(), providerCheckedAt: clock }; }, counts: () => ({ createCalls: created }),
    bindOnce(workload, plan, consume, save) { return { async executeOnce({ assertLease }) {
      await assertLease(); await consume('create_workload', workload.requestSha256); events.push('create'); created++;
      if (fault === 'create') throw Error('create ACK lost');
      const p = publicProvider(), hash = await sha256Hex(p);
      await save('create-ack.json', { stackId: p.stackId });
      await save('provider-after.json', { ...p, providerCheckedAt: clock, providerObservationSha256: hash });
      return { ...f.proof, jobId: plan.jobId, materialSha256: S.materialSha256, ownerDeploymentId: S.deploymentId, generation: 1,
        providerCheckedAt: clock, authorityCheckedAt: clock, providerObservationSha256: hash, workloadExpiresAt: workload.workloadExpiresAt };
    } }; },
  };
  const openJournal = async () => ({ consume: async (entry) => { events.push('slot:' + entry);
    if (fault === entry || slots.includes(entry)) throw Error('slot unknown/occupied'); slots.push(entry); },
  inspect: async () => ({ state: slots.length === 5 ? 'ALL_SLOTS_CONSUMED' : slots.length ? 'PARTIAL' : 'ABSENT', consumed: [...slots] }) });
  async function loadControl({ beforeRead }) {
    await beforeRead(); events.push('private'); privateReads++; if (fault === 'private') throw Error('secret unavailable');
    const p = f.context.root.material.controlPolicy, b = p.business, op = f.admission.jobPlan.externalFence;
    const instance = { external_instance_id: p.appInstanceId, status: 'active' }, store = { store_id: S.existingDefaultStoreId,
      is_default: true, status: 'active', branding: { store_name: b.default_store.name, buyer_theme: b.default_store.buyer_theme, merchant_theme: b.default_store.merchant_theme } };
    const actual = { instance, entitlements: b.entitlements, stores: [{ store_id: store.store_id, status: store.status, ...store.branding }] };
    const bodies = { '/api/saas/readiness': { success: true, readiness: { protocol: 'techlong/tenant-initialized/v1', ready: true,
      initialization_verified: true, external_epoch_claimed: false, readiness_mode: 'tenant-v1', database_profile: 'express_iam',
      app_instance_id: p.appInstanceId, database_binding_sha256: databaseBindingDigestV2(p.binding), database_oid: p.databaseOid, role_oid: p.roleOid,
      desired_configuration_hash: p.configurationHash, image_revision: p.imageRevision } },
    '/api/saas/control': { success: true, control: { control_api_version: '1.2', external_operation_epoch: op.epoch,
      external_operation_intent: op.intent, external_operation_marker: op.marker, external_operation_hash: op.operationHash,
      instance, stores: [store], entitlements: b.entitlements, configuration_hash: await sha256Hex(canonicalJson(actual)),
      desired_configuration_hash: p.configurationHash, image_revision: p.imageRevision } } };
    return { controlTokens: { issue: async () => 'fixture-token' }, controlTransport: { async send(req) {
      assert.equal(req.method, 'GET'); events.push('get:' + new URL(req.url).pathname); return { status: 200, body: bodies[new URL(req.url).pathname] }; } },
    counts: () => ({ fixtureOnly: true }), dispose() { events.push('disposeControl'); } };
  }
  const options = { context: f.context, installation, contract, code, run, provider, openJournal, loadControl, evidence, now: () => clock,
    openDatabase: async () => { events.push('databaseSecret'); return db; } };
  return { ...f, options, events, state, objects, slots, db, evidence, installation, code, contract,
    create: (patch = {}) => createCloudWorkerRootV5({ ...options, ...patch }), tick: n => { clock += n; }, privateReads: () => privateReads };
}

test('actual new CLI candidate has all three modes but zero live capabilities without installed binding/workflow', () => {
  const call = args => spawnSync(process.execPath, ['--experimental-strip-types','ops/cloud-worker/run-worker-v5.mjs',...args], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const c = call(['--mode','CheckCandidate']); assert.equal(c.status, 0); const r = JSON.parse(c.stdout);
  assert.deepEqual(r.rootModes, ['Review','RunOnce','Inspect']); assert.equal(r.cloudCalls + r.privateReads + r.dbQueries, 0);
  for (const mode of ['Review','RunOnce','Inspect']) assert.notEqual(call(['--mode',mode]).status, 0);
});
test('static SQL contracts reproduce compiler templates; no raw SQL capability or grant on a business table', async () => {
  const x = await rig(), p = await compilePlatformInitializedClaimV4({ plan: x.admission.jobPlan, queuedJob: x.observed.job,
    approvedPlanSha256: x.admission.jobPlan.planSha256, leaseToken: x.lease.leaseToken });
  assert.equal(packNeonProgramV5(x.contract, 'claim', p).length, 4);
  p.statements[0].text += ' -- drift'; assert.throws(() => packNeonProgramV5(x.contract, 'claim', p));
  const sql = renderNeonContractV5(x.contract).statements.join('\n');
  assert.doesNotMatch(sql, /\bEXECUTE\s+(?:p_args|format)|GRANT (?:SELECT|UPDATE|INSERT|DELETE)|CREATE OR REPLACE/i);
  assert.equal((sql.match(/SECURITY DEFINER/g) ?? []).length, 4);
  await assertInstallationV5(x.installation, x.installation.installationSha256, x.contract);
  await assert.rejects(assertInstallationV5({ ...x.installation, installed: false }, x.installation.installationSha256, x.contract));
});
test('Review rebuilds scope/templates, stores immutable manifest, consumes no journal/private-control slots', async () => {
  const x = await rig(); assert.deepEqual(x.events, []); const r = await x.create().review({ jobId: x.observed.job.id, signal: signal() });
  await assertCloudManifestV5(r.manifest, x.options);
  assert.equal(x.slots.length, 0); assert.equal(x.privateReads(), 0); assert.equal(x.events.includes('claim'), false);
});
test('wrong approval, changed source, stale review and row drift reject before irreversible operations', async () => {
  for (const fault of ['approval','source','stale','row']) {
    const x = await rig(), { manifest } = await x.create().review({ jobId: x.observed.job.id, signal: signal() }); x.events.length = 0;
    if (fault === 'stale') x.tick(900001); if (fault === 'row') x.state.snapshot.deployment.ready_at++;
    const root = x.create(fault === 'source' ? { code: { ...x.code, closureSha256: '0'.repeat(64) } } : {});
    await assert.rejects(root.runOnce({ manifest, approvedManifestSha256: fault === 'approval' ? '0'.repeat(64) : manifest.manifestSha256, signal: signal() }));
    assert.equal(x.slots.length, 0); assert.equal(x.privateReads(), 0); assert.equal(x.events.includes('claim'), false);
    if (fault !== 'row') assert.equal(x.events.includes('databaseSecret'), false);
  }
});
test('unified Run uses five slots in order, same job, two GETs, atomic append; fresh independent Inspect and chain continuation', async () => {
  const x = await rig(), { manifest } = await x.create().review({ jobId: x.observed.job.id, signal: signal() }); x.tick(1000);
  const r = await x.create().runOnce({ manifest, approvedManifestSha256: manifest.manifestSha256, signal: signal() });
  assert.equal(r.report.result.outcome, 'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED');
  assert.deepEqual(x.slots, ['run','claim_job','create_workload','private_control_load','atomic_complete']);
  for (const [a, b] of [['slot:claim_job','claim'],['slot:create_workload','create'],['slot:private_control_load','private'],['slot:atomic_complete','complete']])
    assert.ok(x.events.indexOf(a) < x.events.indexOf(b));
  assert.equal(x.events.filter(e => e.startsWith('get:')).length, 2); assert.equal(x.privateReads(), 1);
  assert.equal(JSON.stringify(r).includes('lease_'), false);
  x.tick(1000); const inspectRun = { ...run, runId: '123456790' };
  const ir = await x.create({ run: inspectRun }).inspect({ manifest, executionRun: run, executionReportReference: r.saved, signal: signal() });
  assert.equal(ir.report.outcome, 'SUCCEEDED_INDEPENDENTLY_VERIFIED'); assert.equal(x.privateReads(), 1);
  const receipt = JSON.parse(x.state.snapshot.deployment.outputs).expressInitializedWorkerRunsV2[manifest.jobPlan.jobId];
  const p = [...x.objects.entries()].find(([k]) => k.endsWith('/provider-after.json'))[1].value;
  const link = { manifest, receipt, providerObservation: providerPublicV5(p), inspect: ir.report };
  const next = await continueCloudContextV5(x.context, [link]); assert.equal(next.predecessor.jobId, manifest.jobPlan.jobId);
  assert.equal(next.base.predecessorStackId, receipt.stackId); assert.equal(next.capsuleSha256, x.context.capsuleSha256);
  await assert.rejects(continueCloudContextV5(x.context, [link, link]));
  const changed = structuredClone(link); changed.receipt.existingDefaultStoreId = 'foreign'; await assert.rejects(continueCloudContextV5(x.context, [changed]));
});
test('ambiguous slot/claim/create/private/commit stops; another process cannot replay a consumed job', async () => {
  for (const fault of ['claim_job','claim','create','private','complete']) {
    const x = await rig(fault), { manifest } = await x.create().review({ jobId: x.observed.job.id, signal: signal() });
    const r = await x.create().runOnce({ manifest, approvedManifestSha256: manifest.manifestSha256, signal: signal() });
    assert.equal(r.report.result.outcome, 'INSPECT_REQUIRED_NO_RETRY');
    assert.ok(x.events.filter(e => e === 'create').length <= 1); assert.ok(x.privateReads() <= 1);
    const claims = x.events.filter(e => e === 'claim').length;
    await assert.rejects(x.create().runOnce({ manifest, approvedManifestSha256: manifest.manifestSha256, signal: signal() }));
    assert.equal(x.events.filter(e => e === 'claim').length, claims);
  }
});
test('conditional S3 evidence validates metadata, rejects overwrite; secrets/tokens never serialize', async () => {
  const store = new Map(), C = EVIDENCE_V5, port = createEvidencePortV5(async cmd => {
    const name = cmd.constructor.name, v = cmd.input;
    if (name === 'HeadBucketCommand') return { BucketRegion: C.region };
    if (name === 'GetPublicAccessBlockCommand') return { PublicAccessBlockConfiguration: Object.fromEntries(['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets'].map(k => [k, true])) };
    if (name === 'GetBucketEncryptionCommand') return { ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] } };
    if (name === 'GetBucketOwnershipControlsCommand') return { OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] } };
    if (name === 'GetBucketVersioningCommand') return { Status: 'Enabled' };
    if (name === 'PutObjectCommand') { assert.equal(v.IfNoneMatch, '*'); if (store.has(v.Key)) throw Error('precondition'); store.set(v.Key, v.Body); return { VersionId: 'v1', ServerSideEncryption: 'AES256' }; }
    throw Error('unexpected');
  });
  await port.verify(signal()); const ref = { jobId: 'job_' + '1'.repeat(24), manifestSha256: '2'.repeat(64), run };
  await port.put('run.json', ref, { safe: true }, signal()); await assert.rejects(port.put('run.json', ref, { safe: true }, signal()));
  for (const v of [{ databaseUrl: 'redacted' }, { nested: 'lease_' + 'a'.repeat(32) }, { key: '-----BEGIN PRIVATE KEY-----' }]) assert.throws(() => assertEvidenceSafeV5(v));
});
test('minimal database material requires exact dedicated user/host/TLS endpoint and excludes owner DSN/options', async () => {
  const material = { schema: 'techlong/cloud-worker-neon-material/v5', databaseUrl: 'postgresql://techlong_cloud_worker_v5:fixture@ep-fixture-123.ca-central-1.aws.neon.tech/db?sslmode=verify-full' };
  const hash = await sha256Hex({ host: 'ep-fixture-123.ca-central-1.aws.neon.tech', port: 5432, database: 'db', role: 'techlong_cloud_worker_v5', transport: 'NeonHTTPS' });
  assert.equal(await validateDatabaseMaterialV5(material, hash), material.databaseUrl);
  for (const url of [material.databaseUrl.replace('techlong_cloud_worker_v5:', 'neondb_owner:'), material.databaseUrl + '&options=foo', material.databaseUrl.replace('verify-full','disable')])
    await assert.rejects(validateDatabaseMaterialV5({ ...material, databaseUrl: url }, hash));
});
