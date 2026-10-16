import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INITIALIZED_PLATFORM_SCOPE as scope, INITIALIZED_REVIEW_HOLD_AT as HOLD, initializedRequestsEnabled,
  parseInitializedRequestBody, prepareInitializedPlatformRequest, projectInitializedDeployment,
  type InitializedDeploymentProjection } from '../lib/deployments/initialized-platform-request-v1.ts';
import { createInitializedPlatformHandlers } from '../lib/deployments/initialized-platform-http.ts';
import { prepareExpressInitializedJobV2, type ExpressInitializedSnapshotV2 } from '../lib/deployments/execution/express-initialized-job-v2.ts';
import { compilePlatformInitializedClaimV4, compilePlatformInitializedLeaseCheckV4, compilePlatformInitializedCompleteV4,
  verifyPlatformInitializedCompletionReadbackV4, createPlatformInitializedPersistenceV4 } from '../lib/deployments/execution/express-platform-claim-v4.ts';
import { canonicalJson, sha256Hex } from '../lib/deployments/execution/hash.ts';

type Row = Record<string, unknown>;
const NOW = Date.parse('2026-10-16T17:00:00Z'), oldJob = 'job_' + 'a'.repeat(24);
const body = { clientRequestId: '12345678-1234-1234-1234-123456789012', deploymentId: scope.deploymentId, intent: 'restore_initialized_workload' };
const adminUserId = 'usr_fixture_admin';
function receipt(jobId = oldJob) { return { jobId, materialSha256: scope.materialSha256, configurationHash: scope.configurationHash,
  imageUri: scope.artifactRef, existingDefaultStoreId: scope.existingDefaultStoreId, epoch: scope.epoch, operationHash: scope.operationHash,
  completedBy: 'express-initialized-single-job-v2', initializedVerified: true, effectiveConfigurationVerified: true,
  jobPlanSha256: '1'.repeat(64), controlObservationSha256: '2'.repeat(64), providerObservationSha256: '3'.repeat(64),
  authorityObservationSha256: '4'.repeat(64), controlCheckedAt: NOW - 7200000, workloadExpiresAt: NOW - 1000,
  stackId: 'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/12345678-1234-1234-1234-123456789012' }; }
function fixture() {
  const r = receipt(), deployment: InitializedDeploymentProjection = { id: scope.deploymentId, appInstanceId: scope.appInstanceId,
    environmentId: scope.environmentId, mode: 'aws_sandbox', status: 'ready', planHash: scope.planHash,
    configurationHash: scope.configurationHash, artifactRef: scope.artifactRef,
    outputs: { stackId: 'obsolete-stack-never-current', expressInitializedWorkerRunsV2: { [oldJob]: r } } };
  const jobs: Row[] = [{ id: oldJob, deployment_id: scope.deploymentId, status: 'succeeded', created_at: NOW - 7200000,
    completed_at: NOW - 7100000, lease_token: 'never-expose', payload: { kind: 'express_initialized_workload_v2',
      planSha256: r.jobPlanSha256, materialSha256: scope.materialSha256, secret: 'never-expose' } }];
  return { deployment, jobs, now: NOW, gateEnabled: true, body, adminUserId };
}

test('gate is exact opt-in; browser body accepts only the fixed intent/scope/nonce', () => {
  for (const v of [undefined, false, true, 1, '1', 'TRUE', ' true', 'false']) assert.equal(initializedRequestsEnabled(v), false);
  assert.equal(initializedRequestsEnabled('true'), true); assert.deepEqual(parseInitializedRequestBody(body), body);
  for (const bad of [null, [], JSON.stringify(body), { ...body, imageUri: 'other' }, { ...body, password: 'secret' },
    { ...body, deploymentId: 'other' }, { ...body, intent: 'apply' }, { ...body, clientRequestId: 'not-a-uuid' }])
    assert.throws(() => parseInitializedRequestBody(bad));
});
test('UI projects the matched latest receipt, not historical top-level stack; never claims live health', () => {
  const f = fixture(), p = projectInitializedDeployment(f);
  assert.equal(p.view.state, 'expired'); assert.equal(p.view.canRequest, true); assert.equal(p.view.liveCloudChecked, false);
  assert.equal(p.view.globalQueueEnabled, false); assert.equal(p.view.latest?.stackId, receipt().stackId);
  assert.doesNotMatch(JSON.stringify(p.view), /never-expose|obsolete-stack|lease_token|payload/);
  assert.equal(projectInitializedDeployment({ ...f, now: receipt().workloadExpiresAt - 1 }).view.state, 'verified_window_open');
  assert.equal(projectInitializedDeployment({ ...f, now: receipt().workloadExpiresAt - 1 }).view.canRequest, false);
  assert.equal(projectInitializedDeployment({ ...f, gateEnabled: false }).view.canRequest, false);
  assert.equal(projectInitializedDeployment({ ...f, deployment: { ...f.deployment, appInstanceId: 'other' } }).view.supported, false);
});
test('bad/missing/mismatched newest evidence fails closed, not a fallback to an older success', () => {
  for (const patch of [{ existingDefaultStoreId: 'other' }, { epoch: 2 }, { operationHash: '0'.repeat(64) },
    { initializedVerified: false }, { jobPlanSha256: 'bad' }, { stackId: 'foreign' }, { controlCheckedAt: NOW + 1 }]) {
    const f = fixture(); f.deployment.outputs.expressInitializedWorkerRunsV2 = { [oldJob]: { ...receipt(), ...patch } };
    assert.equal(projectInitializedDeployment(f).view.state, 'unverified');
  }
  const f = fixture(); (f.deployment.outputs.expressInitializedWorkerRunsV2 as Row)['job_' + 'b'.repeat(24)] = { ...receipt(), jobId: 'bad' };
  assert.equal(projectInitializedDeployment(f).view.latest, null);
  assert.equal(projectInitializedDeployment({ ...fixture(), jobs: [] }).view.canRequest, false);
  f.jobs[0].status = 'running'; assert.equal(projectInitializedDeployment(f).view.canRequest, false);
});
test('request is deterministic and held indefinitely; exactly one INSERT, no old-row edit or cloud action', async () => {
  const f = fixture(), a = await prepareInitializedPlatformRequest(f), b = await prepareInitializedPlatformRequest(f);
  assert.deepEqual(a, b); assert.equal(a.program?.isolationLevel, 'Serializable');
  const p = a.program!; assert.equal(p.values[4], HOLD); assert.equal(p.payload.cloudExecutionAuthorized, false);
  assert.equal(p.payload.requestedByUserId, adminUserId); assert.equal(p.payload.reviewRequired, true);
  assert.equal((p.text.match(/INSERT INTO/g) ?? []).length, 1); assert.doesNotMatch(p.text, /UPDATE public\.|DELETE|ALTER|SKIP LOCKED/);
  assert.match(p.text, /FOR UPDATE OF/); assert.match(p.text, /clock_timestamp/); assert.match(p.text, /d.outputs::jsonb=\$16::jsonb/);
  assert.match(p.text, /'pending','running','retry_wait'/);
  const other = await prepareInitializedPlatformRequest({ ...f, adminUserId: 'usr_other_admin' });
  assert.notEqual(other.requestId, a.requestId);
  const existing = await prepareInitializedPlatformRequest({ ...f, jobs: [...f.jobs, { id: p.jobId }] });
  assert.equal(existing.existingJobId, p.jobId); assert.equal(existing.program, null);
  await assert.rejects(prepareInitializedPlatformRequest({ ...f, gateEnabled: false }));
  await assert.rejects(prepareInitializedPlatformRequest({ ...f, now: receipt().workloadExpiresAt - 1 }));
  await assert.rejects(prepareInitializedPlatformRequest({ ...f, jobs: [...f.jobs, { ...f.jobs[0], id: 'job_' + 'b'.repeat(24), status: 'pending' }] }));
});

function httpHarness(options: { enabled?: boolean; auth?: 401 | 403; error?: boolean } = {}) {
  const calls: string[] = []; let submitted: unknown;
  const handlers = createInitializedPlatformHandlers({
    authorize: async () => { calls.push('authorize'); return options.auth ? { account: null, response: new Response(null, { status: options.auth }) } :
      { account: { user: { id: adminUserId } }, response: null }; },
    enabled: () => options.enabled ?? true,
    read: async id => { calls.push('read:' + id); return { liveCloudChecked: false }; },
    submit: async input => { calls.push('submit'); submitted = input; if (options.error) throw Error('DO_NOT_LEAK_PASSWORD');
      return { jobId: oldJob, created: true, cloudExecutionAuthorized: false }; },
  });
  const context = { params: Promise.resolve({ instanceId: scope.appInstanceId }) };
  const post = (value: unknown = body, headers: Record<string, string> = { origin: 'https://platform.example', 'content-type': 'application/json' }) =>
    handlers.POST(new Request('https://platform.example/api/request', { method: 'POST', headers, body: typeof value === 'string' ? value : JSON.stringify(value) }), context);
  return { handlers, context, calls, post, submitted: () => submitted };
}
test('HTTP auth and missing/cross Origin stop before any store access', async () => {
  for (const auth of [401, 403] as const) {
    const h = httpHarness({ auth }); assert.equal((await h.post()).status, auth);
    assert.equal((await h.handlers.GET(new Request('https://platform.example'), h.context)).status, auth);
    assert.deepEqual(h.calls, ['authorize', 'authorize']);
  }
  for (const origin of [undefined, 'null', 'https://foreign.example']) {
    const h = httpHarness(); assert.equal((await h.post(body, origin ? { origin } : {})).status, 403); assert.deepEqual(h.calls, []);
  }
});
test('HTTP disabled gate, malformed/type/oversize bodies never submit; success uses session actor', async () => {
  const disabled = httpHarness({ enabled: false }); assert.equal((await disabled.post()).status, 409); assert.deepEqual(disabled.calls, ['authorize']);
  for (const [data, headers, status] of [
    [body, { origin: 'https://platform.example' }, 415], ['{', undefined, 400], [{ ...body, adminUserId: 'forged' }, undefined, 400],
    [' '.repeat(2049), undefined, 413],
  ] as const) {
    const h = httpHarness(); assert.equal((await h.post(data, headers)).status, status); assert.deepEqual(h.calls, ['authorize']);
  }
  const h = httpHarness(), r = await h.post(); assert.equal(r.status, 201); assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(h.submitted(), { instanceId: scope.appInstanceId, adminUserId, body });
  const get = await h.handlers.GET(new Request('https://platform.example'), h.context); assert.equal(get.status, 200);
  assert.equal(get.headers.get('cache-control'), 'no-store');
});
test('ambiguous HTTP submission is sanitized and not retried', async () => {
  const h = httpHarness({ error: true }), result = await h.post(); assert.equal(result.status, 503);
  assert.doesNotMatch(await result.text(), /DO_NOT_LEAK_PASSWORD/); assert.deepEqual(h.calls, ['authorize', 'submit']);
});

async function claimFixture() {
  // Public pinned material + deliberately minimal SYNTHETIC rows. No network,
  // login, live queue entry, lease or execution approval is supplied by this.
  const f = JSON.parse(readFileSync(new URL('./fixtures/express-platform-v4.json', import.meta.url), 'utf8'));
  const request = await prepareInitializedPlatformRequest(fixture()), payload = request.program!.payload;
  const plan = await prepareExpressInitializedJobV2({ ...f, snapshot: f.snapshot as ExpressInitializedSnapshotV2,
    requestId: request.requestId, now: NOW + 1000, deadline: NOW + 3600000 });
  const queued: Row = { id: request.program!.jobId, deployment_id: scope.deploymentId, job_type: 'reconcile',
    dedupe_key: plan.dedupeKey, status: 'pending', payload: canonicalJson(payload), attempts: 0, max_attempts: 1,
    available_at: HOLD, created_at: NOW, updated_at: NOW, completed_at: null, lease_token: null, lease_owner: null, lease_expires_at: null };
  const input = { plan, queuedJob: queued, approvedPlanSha256: plan.planSha256, leaseToken: 'lease_' + 'd'.repeat(32) };
  return { input, claim: await compilePlatformInitializedClaimV4(input), queued, plan, f };
}
test('exact held-job claim is one guarded UPDATE, no insert, scan, retry or history mutation', async () => {
  const { input, claim, queued } = await claimFixture(), sql = claim.statements.map(q => q.text).join('\n');
  assert.equal(claim.statements.length, 4); assert.equal(claim.automaticRetries, 0); assert.equal(claim.isolationLevel, 'Serializable');
  assert.equal((sql.match(/UPDATE public\./g) ?? []).length, 1); assert.doesNotMatch(sql, /INSERT|DELETE|SKIP LOCKED|UPDATE public\.app/);
  assert.match(sql, /to_jsonb\(j\)=\$2::jsonb/); assert.match(sql, /u.is_platform_admin=1/); assert.match(sql, /id<>\$2/);
  assert.match(sql, /available_at=\$8/); assert.match(sql, /lease_expires_at=LEAST\(db_clock.now_ms/);
  assert.equal(claim.statements[3].values[0], queued.id);
  const running = JSON.parse(String(claim.statements[3].values[2]));
  assert.deepEqual(running.platformRequest, JSON.parse(String(queued.payload))); assert.equal(running.kind, 'express_initialized_workload_v2');
  assert.equal(claim.programSha256, await sha256Hex({ statements: claim.statements, isolationLevel: 'Serializable' }));
  await assert.rejects(compilePlatformInitializedClaimV4({ ...input, approvedPlanSha256: input.plan.materialSha256 }));
  for (const patch of [{ id: oldJob }, { status: 'running' }, { attempts: 1 }, { max_attempts: 2 }, { available_at: NOW }, { lease_token: 'other' }])
    await assert.rejects(compilePlatformInitializedClaimV4({ ...input, queuedJob: { ...queued, ...patch } }));
  for (const patch of [{ requestId: 'e'.repeat(64) }, { cloudExecutionAuthorized: true }, { requestedByUserId: 'forged' },
    { requestedAt: NOW + 2000 }, { extra: 'not-allowed' }, { scope: { ...scope, epoch: 2 } }])
    await assert.rejects(compilePlatformInitializedClaimV4({ ...input, queuedJob: { ...queued, payload: canonicalJson({ ...JSON.parse(String(queued.payload)), ...patch }) } }));
});
test('lease and atomic completion require exact preserved platform provenance; independent readback rejects its loss', async () => {
  const { claim, queued, plan } = await claimFixture(), lease = claim.lease;
  const guard = await compilePlatformInitializedLeaseCheckV4(plan, queued, lease);
  assert.equal(guard.statements[1].values[4], claim.statements[3].values[2]);
  assert.doesNotMatch(guard.statements.map(q => q.text).join('\n'), /FOR UPDATE|UPDATE public\.|INSERT/);
  const { jobPlanSha256: _sha, completedBy: _worker, ...r } = receipt(plan.jobId); void _sha; void _worker;
  const proof = { ...r, initializedVerified: true as const, effectiveConfigurationVerified: true as const, leaseToken: lease.leaseToken,
    workloadExpiresAt: NOW + 7200000, controlCheckedAt: NOW + 2000, providerCheckedAt: NOW + 2000, authorityCheckedAt: NOW + 2000 };
  const p = await compilePlatformInitializedCompleteV4({ plan, queuedJob: queued, lease, proof, now: NOW + 2500 });
  assert.equal(p.statements[1].values[4], claim.statements[3].values[2]);
  const snapshot = structuredClone(plan.snapshot); snapshot.deployment.outputs = p.outputs; snapshot.deployment.updated_at = NOW + 2500;
  const job = { ...queued, payload: claim.statements[3].values[2], status: 'succeeded', attempts: 1, completed_at: NOW + 2500 };
  const check = () => verifyPlatformInitializedCompletionReadbackV4({ plan, lease, queuedJob: queued, snapshot, job, expectedOutputs: p.outputs });
  assert.equal((await check()).outcome, 'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED');
  const altered = JSON.parse(String(job.payload)); delete altered.platformRequest; job.payload = canonicalJson(altered);
  await assert.rejects(check);
  job.payload = claim.statements[3].values[2]; snapshot.deployment.ready_at = NOW; await assert.rejects(check);
});
test('concrete V4 adapter is lazy, has no provider capability and rejects insecure DB endpoints', () => {
  const a = createPlatformInitializedPersistenceV4('postgresql://fixture:unused@ep-fixture.ca-central-1.aws.neon.tech/neondb?sslmode=require', {});
  assert.deepEqual(Object.keys(a).sort(), ['assertLease', 'claim', 'complete', 'readSnapshot']);
  assert.throws(() => createPlatformInitializedPersistenceV4('postgresql://localhost/db', {}));
});
