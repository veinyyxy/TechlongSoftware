import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { C, hash, readyPlan, stableSnapshot, validateOldSnapshot, assertWindow, makeReceipt,
  compileReadyProgram, validateReadySnapshot, validateReadyPlatform } from '../ops/aws-sandbox/scripts/express-ready-reconciliation-plan-v1.mjs';
import { R } from '../ops/aws-sandbox/scripts/express-workload-recovery-plan-v1.mjs';
import { A } from '../ops/aws-sandbox/scripts/express-initialization-audit-plan-v1.mjs';
import { readyReadTransport } from '../ops/aws-sandbox/scripts/express-ready-reconciliation-control-v1.mjs';
const aliases = ['d', 'a', 'j', 'r', 'o', 'e', 'w', 'sub', 'tv'];
function fixture(now = Date.now()) {
  const hashes = Object.fromEntries(aliases.map(a => [a, hash(a)]));
  const historical = { plan: { scope: { deploymentId: 'dep_exact', appInstanceId: 'app_exact', configurationHash: hash('config'),
    planHash: hash('plan'), artifactRef: 'old-digest', environmentId: 'env_exact' }, subscriptionId: 'sub_exact', templateVersionId: 'tpl_exact',
    pendingExternalFence: { state: 'pending', resourceFence: { identity: { workspaceId: 'ws_exact', productId: 'prd_exact' } } }, publicParametersSha256: hash('parameters') } };
  const snapshot = { read_only: 'on', identity: { database: 'neondb', databaseOid: '1', role: 'owner', roleOid: '2', version: '180006', timezone: 'GMT' },
    hashes, unchanged_hashes: { ...hashes }, deployment_status: 'configuring', artifact_ref: 'old-digest', instance_status: 'pending',
    access_url: 'https://first-acceptance.sandbox.techlong.cloud', job_status: 'running', attempts: 1, max_attempts: 1,
    lease_owner: 'express-reviewed-first-delivery-v1', lease_expires_at: String(now - 3600000), lease_present: true, lease_expired: true,
    receipt_slot_absent: true, receipt_matches: false, stack_id: null, observation_sha256: null, ready_at: null, provisioned_at: null, completed_at: null,
    outputs_octets: 2, outputs_json_octets: 2, outputs_text_sha256: hash('{}'), outputs_json_sha256: hash('{}'), previous_outputs_sha256: null,
    db_now: String(now), deployment_updated_at: String(now - 3600000), instance_updated_at: String(now - 7200000), job_updated_at: String(now - 3600000) };
  const initialized = { approvedManifestSha256: C.initializedManifestSha, approvalConsumed: true, replayAllowed: false,
    state: 'APPLICATION_INITIALIZED_CONFIGURATION_INDEPENDENTLY_VERIFIED_PLATFORM_UNCHANGED', workloadExpiresAt: new Date(now + 8 * 3600000).toISOString(),
    independent: { apiProof: { freshAuthenticatedApiReadback: true, exactStoreVerified: true,
      initialized: { ready: true, imageRevision: R.newDigest, desiredConfigurationHash: historical.plan.scope.configurationHash } } }, platform: {} };
  const input = { base: { historical, publicInputs: { source: { material: { controlPolicy: {} } } },
    auditManifest: { plan: { program: { expectedStore: { store_id: 'store_exact' } } } } }, initialized, snapshot,
    catalogServerSha256: hash('real-catalog'), endpointSha256: hash('endpoint') };
  const p = readyPlan(input, now), api = { ready: true, imageRevision: R.newDigest, desiredConfigurationHash: p.historicalScope.configurationHash };
  const hosting = { checkedAt: now, live: { stackId: A.stackId, taskDefinitionArn: A.taskDefinitionArn } };
  const receipt = makeReceipt(p, hash('manifest'), api, hosting, now);
  return { input, p, receipt, historical, snapshot, api, hosting, now };
}
test('stable snapshot re-derives the identical plan without inventing clock/catalog observations', () => {
  const f = fixture(); assert.deepEqual(readyPlan({ ...f.input, snapshot: stableSnapshot(f.snapshot) }, f.now), f.p);
  assert.equal(Object.hasOwn(f.p.expectedSnapshot, 'db_now'), false);
  assert.equal(f.p.manualJobCompletionNotAWorkerLease, true); assert.equal(f.p.originalPlanHashAndIdempotencyPreserved, true);
});
test('old coordinate rejects an active lease, changed attempt, final output or nonpending state', () => {
  for (const patch of [{ lease_expired: false }, { attempts: 2 }, { job_status: 'succeeded' }, { receipt_slot_absent: false },
    { stack_id: 'foreign' }, { artifact_ref: 'different' }, { instance_status: 'active' }, { access_url: 'https://other.example' }]) {
    const f = fixture(); assert.throws(() => validateOldSnapshot({ ...f.snapshot, ...patch }, f.historical), /OLD_SNAPSHOT/);
  }
});
test('K2b proof must independently confirm current image and configuration before planning', () => {
  const f = fixture(); f.input.initialized.independent.apiProof.initialized.imageRevision = 'old';
  assert.throws(() => readyPlan(f.input, f.now), /INITIALIZED_OR_CATALOG/);
});
test('admission and execution stop at exact bounds and cannot renew the workload', () => {
  const { p, now } = fixture(); assertWindow(p, now, true);
  assert.throws(() => assertWindow(p, p.admissionExpiresAt, true), /WINDOW_EXPIRED/);
  assert.throws(() => assertWindow(p, p.executionExpiresAt), /WINDOW_EXPIRED/);
  assert.throws(() => assertWindow({ ...p, executionExpiresAt: p.executionExpiresAt + 1 }, now), /WINDOW_EXPIRED/);
  assert.equal(new Set([C.slot, C.writeSlot, C.inspectSlot]).size, 3);
});
test('receipt records manual attribution and old hash/lease provenance, never the raw token', () => {
  const f = fixture(), r = f.receipt; assert.equal(r.previousLease.rawTokenIncluded, false);
  assert.equal(r.manualRecoveryNotWorkerLease, true); assert.equal(r.originalArtifactRef, 'old-digest');
  assert.deepEqual(r.previousSnapshot, f.snapshot.hashes); assert.equal(r.previousOutputsTextSha256, hash('{}'));
  assert.throws(() => makeReceipt(f.p, 'manifest', { ...f.api, ready: false }, f.hosting, f.now), /READY_API_OR_HOSTING/);
});
test('program locks nine exact rows and enforces database identity, expired lease and 30-second facts', () => {
  const f = fixture(), q = compileReadyProgram(f.p, f.receipt, f.historical).statements[1];
  assert.match(q.text, /FOR UPDATE OF e,w,sub,tv,d,a,j,r,o/); assert.match(q.text, /j\.lease_expires_at</);
  assert.match(q.text, /\$9::jsonb IS NOT NULL/); assert.match(q.text, /\$13::jsonb/); assert.match(q.text, /\$14::bigint<=30000/);
  assert.equal(q.values.length, 14); assert.equal(q.values[11], f.now); assert.equal(q.values[13], f.hosting.checkedAt);
  assert.deepEqual(JSON.parse(q.values[9]), f.snapshot.hashes); assert.deepEqual(JSON.parse(q.values[12]), f.snapshot.identity);
});
test('exact seven statements update only three existing rows, no attempt bump, insert/delete or schema writes', () => {
  const f = fixture(), program = compileReadyProgram(f.p, f.receipt, f.historical), text = program.statements.map(s => s.text).join('\n');
  assert.equal(program.statements.length, 7); assert.equal(program.isolationLevel, 'Serializable'); assert.equal(program.readOnly, false);
  assert.equal((text.match(/UPDATE public\./g) || []).length, 3); assert.doesNotMatch(text, /\b(?:INSERT INTO|DELETE FROM|ALTER TABLE|CREATE TABLE)\b/i);
  assert.doesNotMatch(text, /SET\s+(?:attempts|plan_hash|desired_plan|idempotency_key|error)/i);
  assert.match(text, /lease_token=NULL/); assert.match(text, /'previousOutputs',outputs::jsonb/); assert.match(text, /attempts=1 AND max_attempts=1/);
  for (const q of program.statements) {
    const numbers = [...q.text.matchAll(/\$(\d+)/g)].map(m => Number(m[1]));
    assert.deepEqual([...new Set(numbers)].sort((a, b) => a - b), Array.from({ length: q.values.length }, (_, i) => i + 1));
  }
});
test('catalog and unchanged row masks are guarded inside the same write transaction', () => {
  const f = fixture(), q = compileReadyProgram(f.p, f.receipt, f.historical).statements;
  assert.equal(q[2].values[0], f.p.catalogServerSha256); assert.match(q[2].text, /pg_get_functiondef/);
  assert.match(q[6].text, /'previousOutputs'/); assert.deepEqual(JSON.parse(q[6].values[9]), f.snapshot.unchanged_hashes);
  assert.equal(q[6].values[12], f.snapshot.outputs_json_sha256);
});
function readySnapshot(f) { return { ...f.snapshot, deployment_status: 'ready', artifact_ref: f.p.actualArtifactRef, instance_status: 'active',
  current_step: 'ready', suspended_at: null, job_status: 'succeeded', lease_present: false, lease_owner: null, lease_expires_at: null, lease_expired: null, receipt_slot_absent: false, receipt_matches: true,
  stack_id: f.p.stackId, observation_sha256: hash(f.receipt), previous_outputs_sha256: f.snapshot.outputs_json_sha256,
  ready_at: String(f.now), provisioned_at: String(f.now), completed_at: String(f.now), deployment_updated_at: String(f.now), instance_updated_at: String(f.now), job_updated_at: String(f.now) }; }
test('independent ready state needs exact receipt, preserved fields and completed terminal coordinates', () => {
  const f = fixture(), s = readySnapshot(f); validateReadySnapshot(s, f.p, f.receipt);
  for (const patch of [{ receipt_matches: false }, { observation_sha256: 'foreign' }, { lease_present: true }, { previous_outputs_sha256: 'foreign' },
    { completed_at: null }, { artifact_ref: 'old-digest' }, { unchanged_hashes: {} }])
    assert.throws(() => validateReadySnapshot({ ...s, ...patch }, f.p, f.receipt), /READY_SNAPSHOT_NOT_PROVED/);
});
test('real ready projection preserves all other legacy provider facts, never patches an old row in memory', () => {
  const f = fixture(), fixed = { configuration_hash: f.p.historicalScope.configurationHash, attempts: 1, max_attempts: 1,
    business_scope_matches: true, desired_plan: '{}', configuration_snapshot: '{}', environment_policy: '{}' };
  f.p.sourcePlatform = { ...fixed, desired_plan_sha256: hash({}), configuration_snapshot_sha256: hash({}), environment_policy_sha256: hash({}) };
  for (const k of ['desired_plan', 'configuration_snapshot', 'environment_policy']) delete f.p.sourcePlatform[k];
  const row = { ...fixed, deployment_status: 'ready', instance_status: 'active', job_status: 'succeeded', artifact_ref: f.p.actualArtifactRef,
    stack_id: f.p.stackId, observation_sha256: hash(f.receipt), lease_cleared: true, lease_expires_at: null, lease_expired: null,
    deployment_updated_at: String(f.now), job_updated_at: String(f.now) };
  validateReadyPlatform(row, f.p, f.receipt); assert.equal(row.desired_plan, '{}');
  assert.throws(() => validateReadyPlatform({ ...row, attempts: 2 }, f.p, f.receipt), /READY_PROVIDER_PLATFORM/);
});
function request(p, route, method = 'GET') { return { method, url: 'https://' + p.hostname + ':8443' + route, headers: {} }; }
test('transport allows exactly two authenticated GET routes and no bootstrap/provision/body/foreign URL', async () => {
  const { p } = fixture(); let sends = 0;
  const guarded = () => readyReadTransport(p, { send: async () => { sends++; return { status: 200, body: { control: { stores: [{ store_id: p.storeId }] } } }; } });
  for (const r of [request(p, '/api/saas/bootstrap'), request(p, '/api/saas/provision', 'POST'),
    { ...request(p, '/api/saas/readiness'), body: '{}' }, request(p, '/api/saas/readiness?x=1'),
    { ...request(p, '/api/saas/readiness'), url: 'https://foreign.example:8443/api/saas/readiness' }])
    await assert.rejects(guarded().transport.send(r, { signal: AbortSignal.timeout(1000) }), /READONLY_HTTP_SCOPE/);
  assert.equal(sends, 0); const g = guarded();
  await g.transport.send(request(p, '/api/saas/readiness'), { signal: AbortSignal.timeout(1000) });
  await g.transport.send(request(p, '/api/saas/control'), { signal: AbortSignal.timeout(1000) });
  await assert.rejects(g.transport.send(request(p, '/api/saas/readiness'), { signal: AbortSignal.timeout(1000) }), /READONLY_HTTP_SCOPE/);
  assert.equal(sends, 2);
});
test('foreign store and network failure consume the attempt without retransmission', async () => {
  const { p } = fixture(); let sent = 0;
  for (const fail of [false, true]) {
    const g = readyReadTransport(p, { send: async () => { sent++; if (fail) throw Error('lost'); return { status: 200, body: { control: { stores: [{ store_id: 'foreign' }] } } }; } });
    await assert.rejects(g.transport.send(request(p, '/api/saas/control'), { signal: AbortSignal.timeout(1000) }));
    await assert.rejects(g.transport.send(request(p, '/api/saas/control'), { signal: AbortSignal.timeout(1000) }), /READONLY_HTTP_SCOPE/);
  }
  assert.equal(sent, 2);
});
test('new entry owns separate durable boundaries and cannot mutate AWS or initialize application', async () => {
  const file = name => readFile(new URL('../ops/aws-sandbox/scripts/' + name, import.meta.url), 'utf8');
  const entry = await file('review-express-ready-reconciliation-v1.mjs'), control = await file('express-ready-reconciliation-control-v1.mjs');
  assert.match(entry, /saveFile\(C\.writeSlot/); assert.match(entry, /saveFile\(C\.inspectSlot/); assert.match(entry, /POST_SLOT_FACT_WINDOW/);
  assert.match(entry, /write\.programSha256 === program\.programSha256/); assert.match(entry, /same\(program, compileReadyProgram/);
  assert.doesNotMatch(entry + control, /new (?:CreateStack|UpdateStack|PutItem|ExecuteChangeSet|GetSecretValue|UpdateFunctionCode)Command/);
  assert.doesNotMatch(control, /\.provision\(|\.bootstrap\(|firstOwnerPassword|new Client\(/);
});
