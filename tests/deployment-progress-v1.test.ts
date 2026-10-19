import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeArchivedDeploymentEvidence, projectDeploymentProgress, deploymentWindowLabel } from '../lib/deployments/deployment-progress-v1.ts';
import { sha256Hex } from '../lib/deployments/execution/hash.ts';
import type { projectInitializedDeployment } from '../lib/deployments/initialized-platform-request-v1.ts';
import { createInitializedPlatformHandlers } from '../lib/deployments/initialized-platform-http.ts';

type View = ReturnType<typeof projectInitializedDeployment>['view'];
const NOW = Date.parse('2026-10-19T05:10:00Z');
const published = JSON.parse(readFileSync(new URL('../ops/aws-sandbox/reviews/cloud-worker-w5r.executed.json', import.meta.url), 'utf8'));
async function fixture() {
  const record = structuredClone(published);
  const rawReceipt = { jobId: record.jobId, providerObservationSha256: record.providerObservationSha256,
    controlCheckedAt: NOW - 60000, workloadExpiresAt: NOW + 3600000, privateFixture: 'NEVER_EXPOSE_THIS', nested: { lease: 'PRIVATE_LEASE' } };
  record.completionReceiptSha256 = await sha256Hex(rawReceipt);
  const archive = normalizeArchivedDeploymentEvidence({ ...record, password: 'NEVER_EXPOSE_THIS' })!;
  const view: View = { supported: true, state: 'verified_window_open', canRequest: false, requestGateEnabled: false,
    liveCloudChecked: false, globalQueueEnabled: false, reason: 'fixture',
    latest: { jobId: record.jobId, checkedAt: rawReceipt.controlCheckedAt, expiresAt: rawReceipt.workloadExpiresAt,
      stackId: record.stackId, imageRevision: 'sha256:fixture' },
    jobs: [{ id: record.jobId, status: 'succeeded', phase: 'succeeded', requestedAt: NOW - 120000, completedAt: NOW - 50000 }] };
  return { record, view, rawReceipt, archive, instanceId: record.appId as string, deploymentId: record.deploymentId as string, now: NOW };
}

test('published archive has a pinned canonical digest and only safe run URLs are constructed', async () => {
  const source = readFileSync(new URL('../lib/deployments/deployment-progress-evidence.ts', import.meta.url), 'utf8');
  assert.match(source, new RegExp(await sha256Hex(published)));
  const a = normalizeArchivedDeploymentEvidence(published)!;
  assert.equal(a.stages.length, 3); assert.equal(a.jobId, published.jobId);
  for (const s of a.stages) assert.equal(s.url, 'https://github.com/veinyyxy/TechlongSoftware/actions/runs/' + s.runId);
  assert.doesNotMatch(JSON.stringify(a), /evidenceFiles|F:\/|password|executionReference/);
});
test('malformed, reordered, failed, reused or injected run evidence is not accepted', () => {
  for (const patch of [{ schema: 'other' }, { state: 'READY' }, { jobId: 'foreign' }, { appId: 'other' },
    { sourceCommitAtExecution: 'bad' }, { completionReceiptSha256: 'bad' }, { distinctExecutionAndInspectRunsVerified: false },
    { stackId: published.stackId.replace('c017ca00', '--------') }]) assert.equal(normalizeArchivedDeploymentEvidence({ ...published, ...patch }), null);
  for (const patch of [{ runId: 'javascript:alert(1)' }, { attempt: 2 }, { conclusion: 'failure' }, { mode: 'Inspect' }]) {
    const r = structuredClone(published); Object.assign(r.stages[0], patch); assert.equal(normalizeArchivedDeploymentEvidence(r), null);
  }
  const reused = structuredClone(published); reused.stages[2].runId = reused.stages[1].runId;
  assert.equal(normalizeArchivedDeploymentEvidence(reused), null);
  assert.equal(normalizeArchivedDeploymentEvidence({ ...published, stages: [...published.stages].reverse() }), null);
});
test('exact receipt, database job and archive match yields historical verification, never execution capabilities', async () => {
  const f = await fixture(), before = JSON.stringify(f), p = (await projectDeploymentProgress(f))!;
  assert.equal(p.state, 'verified'); assert.equal(p.archive?.isCurrentJob, true); assert.equal(p.steps.filter(s => s.url).length, 3);
  assert.equal(p.canDispatch, false); assert.equal(p.canApprove, false); assert.equal(p.canRetry, false);
  assert.equal(p.liveCloudChecked, false); assert.equal(p.githubLiveChecked, false);
  assert.match(p.description, /不代表实时在线/); assert.equal(JSON.stringify(f), before);
  assert.doesNotMatch(JSON.stringify(p), /NEVER_EXPOSE_THIS|PRIVATE_LEASE|rawReceipt|privateFixture|payload|password/);
});
test('expiry changes the label, not historical verification or authorization', async () => {
  const f = await fixture(), p = (await projectDeploymentProgress({ ...f, now: f.rawReceipt.workloadExpiresAt + 1 }))!;
  assert.equal(p.state, 'verified'); assert.equal(p.canDispatch, false);
  assert.equal(deploymentWindowLabel(p.archive!.expiresAt, f.rawReceipt.workloadExpiresAt), '标签时间已到期');
});
test('changed receipt, wrong stack/scope or unavailable archive cannot borrow an old success', async () => {
  const f = await fixture();
  for (const changed of [{ ...f, rawReceipt: { ...f.rawReceipt, privateFixture: 'CHANGED' } },
    { ...f, archive: null }, { ...f, instanceId: 'app_' + 'b'.repeat(32) }, { ...f, deploymentId: 'dep_' + 'b'.repeat(24) },
    { ...f, archive: { ...f.archive, stackId: 'foreign' } }, { ...f, archive: { ...f.archive, receiptSha256: '0'.repeat(64) } }]) {
    const p = (await projectDeploymentProgress(changed))!; assert.equal(p.archive, null); assert.equal(p.state, 'awaiting_evidence');
    assert.equal(p.steps.some(s => s.url), false);
  }
  assert.equal(await projectDeploymentProgress({ ...f, view: { ...f.view, supported: false } }), null);
});
test('new pending job is current; prior verified archive stays historical, never its approval', async () => {
  const f = await fixture(), newer = { id: 'job_' + 'b'.repeat(24), status: 'pending', phase: 'awaiting_review' as const, requestedAt: NOW - 1000, completedAt: null };
  const p = (await projectDeploymentProgress({ ...f, view: { ...f.view, jobs: [...f.view.jobs, newer] } }))!;
  assert.equal(p.state, 'awaiting_review'); assert.equal(p.currentJobId, newer.id); assert.equal(p.archive?.isCurrentJob, false);
  assert.equal(p.steps[0].status, 'waiting'); assert.equal(p.steps.some(s => s.url), false); assert.equal(p.canDispatch, false);
});
test('running/failed/retry-wait are not inferred as cloud success and never offer retry', async () => {
  for (const [status, phase, expected] of [['running', 'running', 'running'], ['failed', 'stopped', 'needs_attention'], ['retry_wait', 'stopped', 'needs_attention']] as const) {
    const f = await fixture(), p = (await projectDeploymentProgress({ ...f, view: { ...f.view,
      jobs: [{ ...f.view.jobs[0], status, phase, completedAt: null }] } }))!;
    assert.equal(p.state, expected); assert.equal(p.archive, null); assert.equal(p.steps.some(s => s.url), false); assert.equal(p.canRetry, false);
  }
});
test('ambiguous/malformed newer rows stop the view instead of falling back to a completed job', async () => {
  for (const patch of [{ requestedAt: NaN }, { requestedAt: NOW + 1 }, { completedAt: NOW + 1 }, { completedAt: null }, { phase: 'running' as const }]) {
    const f = await fixture(), p = (await projectDeploymentProgress({ ...f, view: { ...f.view, jobs: [{ ...f.view.jobs[0], ...patch }] } }))!;
    assert.equal(p.state, 'needs_attention'); assert.equal(p.archive, null);
  }
  const f = await fixture(); await assert.rejects(projectDeploymentProgress({ ...f, now: NaN }));
});
test('countdown handles exact bounds, invalid and expired clocks without Date exceptions', () => {
  assert.equal(deploymentWindowLabel(NOW + 3601000, NOW), '1小时0分1秒');
  assert.equal(deploymentWindowLabel(NOW + 1, NOW), '0小时0分1秒');
  assert.equal(deploymentWindowLabel(NOW - 1, NOW), '标签时间已到期');
  assert.equal(deploymentWindowLabel(Number.MAX_SAFE_INTEGER, NOW), '时间不可用');
});
test('existing authenticated no-store GET carries only the new projection and never submits a job', async () => {
  const f = await fixture(), progress = await projectDeploymentProgress(f), calls: string[] = [];
  for (const allowed of [false, true]) {
    const handlers = createInitializedPlatformHandlers({ authorize: async () => ({ account: allowed ? { user: { id: 'usr_fixture_admin' } } : null, response: null }),
      enabled: () => false, read: async () => { calls.push('read'); return { ...f.view, progress }; }, submit: async () => { throw Error('MUST_NOT_SUBMIT'); } });
    const r = await handlers.GET(new Request('https://platform.example/status'), { params: Promise.resolve({ instanceId: f.instanceId }) });
    assert.equal(r.status, allowed ? 200 : 401);
    if (allowed) { assert.equal(r.headers.get('cache-control'), 'no-store'); assert.doesNotMatch(await r.text(), /NEVER_EXPOSE_THIS|PRIVATE_LEASE/); }
  }
  assert.deepEqual(calls, ['read']);
});
test('server/page integration is read-only, pinned and does not add dispatch/credential dependencies', () => {
  const evidence = readFileSync(new URL('../lib/deployments/deployment-progress-evidence.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(evidence, /fromLoginCredentials|GetSecretValue|fetch\(|writeFile|spawn\(/);
  const page = readFileSync(new URL('../app/admin/instances/[instanceId]/page.tsx', import.meta.url), 'utf8');
  assert.ok(page.indexOf('await getAdminAccount()') < page.indexOf('getInitializedPlatformStatus(instance.id)'));
  assert.match(page, /<DeploymentProgressPanel view=\{initializedStatus.progress\}/);
  const panel = readFileSync(new URL('../components/admin/DeploymentProgressPanel.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(panel, /fetch\(|method:\s*['"]POST|window\.confirm/); assert.match(panel, /performance\.now/);
});
