import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { INITIALIZED_PLATFORM_SCOPE as S, INITIALIZED_REVIEW_HOLD_AT } from '../lib/deployments/initialized-platform-request-v1.ts';
import { prepareExpressInitializedWorkerV2 } from '../lib/deployments/execution/express-initialized-worker-v2.ts';
import { compilePlatformInitializedLeaseCheckV4, compilePlatformInitializedCompleteV4,
  verifyPlatformInitializedCompletionReadbackV4 } from '../lib/deployments/execution/express-platform-claim-v4.ts';
import { createExpressInitializedSingleJobRunnerV2 } from '../lib/deployments/execution/express-initialized-job-runner-v2.ts';
import { canonicalJson, sha256Hex } from '../lib/deployments/execution/hash.ts';
import { prepareInitializedWorkloadV3 } from '../ops/aws-sandbox/scripts/express-initialized-workload-v3.mjs';
import { W4_ZERO_LEASE_TOKEN, assertHeldPlatformJobV4, admitPlatformJobV4, preparePlatformReviewV4,
  assertPlatformManifestShapeV4, assertCurrentPlatformRowsV4, assertClaimMatchesReviewV4,
  platformReadObservationV4 } from '../ops/aws-sandbox/scripts/express-platform-worker-v4.mjs';

const NOW = Date.parse('2026-10-16T20:00:00Z');
async function fixture() {
  // Public material, synthetic rows/clock/predecessor proof. Never live evidence.
  const f = JSON.parse(readFileSync(new URL('./fixtures/express-platform-v4.json', import.meta.url), 'utf8')), m = f.material;
  const root = await prepareExpressInitializedWorkerV2({ delivery: { scope: m.scope, sourcePlan: m.sourcePlan,
    sourcePlanSha256: m.sourcePlanSha256, configuration: JSON.parse(f.snapshot.app.configuration_snapshot),
    configurationSha256: m.configurationSha256, configurationSchema: JSON.parse(f.snapshot.templateVersion.configuration_schema),
    environment: m.environment, binding: m.binding, databaseOid: m.databaseOid, roleOid: m.roleOid, tenantHostname: m.tenantHostname },
  existingDefaultStoreId: m.existingDefaultStoreId });
  assert.equal(root.materialSha256, S.materialSha256);
  const requestId = 'c'.repeat(64), jobId = 'job_' + (await sha256Hex({ purpose: 'express-initialized-job/v2',
    deploymentId: S.deploymentId, materialSha256: S.materialSha256, requestId })).slice(0, 24);
  const queued = { id: jobId, deployment_id: S.deploymentId, job_type: 'reconcile', dedupe_key: 'express-initialized-v2:' + requestId,
    status: 'pending', attempts: 0, max_attempts: 1, available_at: INITIALIZED_REVIEW_HOLD_AT, created_at: NOW - 2000, updated_at: NOW - 2000,
    completed_at: null, lease_owner: null, lease_token: null, lease_expires_at: null,
    payload: canonicalJson({ kind: 'express_initialized_request_v4', requestId, requestedByUserId: 'usr_fixture_admin', requestedAt: NOW - 3000,
      scope: S, reviewRequired: true, cloudExecutionAuthorized: false }) };
  const receipt = { jobId: 'job_e4147af2f10faf37b51ec9a3', materialSha256: S.materialSha256, configurationHash: S.configurationHash,
    imageUri: S.artifactRef, existingDefaultStoreId: S.existingDefaultStoreId, epoch: S.epoch, operationHash: S.operationHash,
    completedBy: 'express-initialized-single-job-v2', initializedVerified: true, effectiveConfigurationVerified: true,
    jobPlanSha256: 'a'.repeat(64), controlObservationSha256: '1'.repeat(64), providerObservationSha256: '2'.repeat(64), authorityObservationSha256: '3'.repeat(64),
    controlCheckedAt: NOW - 7200000, workloadExpiresAt: NOW - 10000,
    stackId: 'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/74a79560-c981-11f1-bfcc-06ffde30f30d' };
  const proofJob = { id: receipt.jobId, deployment_id: S.deploymentId, job_type: 'reconcile', status: 'succeeded', attempts: 1,
    lease_owner: null, lease_token: null, lease_expires_at: null, created_at: NOW - 7200000, completed_at: NOW - 7100000,
    payload: canonicalJson({ kind: 'express_initialized_workload_v2', planSha256: receipt.jobPlanSha256, materialSha256: S.materialSha256 }) };
  f.snapshot.deployment.outputs = canonicalJson({ keepHistoricalReady: true, stackId: 'obsolete-top-level', expressInitializedWorkerRunsV2: { [receipt.jobId]: receipt } });
  const predecessor = { jobId: receipt.jobId, stackId: receipt.stackId, taskDefinitionArn: 'arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-9c5ee9e64509dcad-task-definition:4',
    receiptSha256: await sha256Hex(receipt) };
  const observed = { snapshot: f.snapshot, job: queued, jobs: [proofJob, structuredClone(queued)], requester: { id: 'usr_fixture_admin', status: 'active', is_platform_admin: 1 }, checkedAt: NOW - 500 };
  const input = { root, observed, predecessor, now: NOW }, admission = await admitPlatformJobV4(input);
  const cell = { stackId: 'arn:aws:cloudformation:ca-central-1:402010193138:stack/fixture/12345678-1234-1234-1234-123456789012',
    activeCellCount: 1, activeTenantCount: 0, parentTagExpiresAt: '2026-10-11T16:00:00.000Z', outputs: {
      ClusterName: 'cell-sandbox-1', VpcId: 'vpc-0123456789abcdef0', SubnetIds: 'subnet-0123456789abcdef0,subnet-0123456789abcdef1',
      TaskSecurityGroupId: 'sg-0123456789abcdef0', HttpsListenerArn: 'arn:aws:elasticloadbalancing:ca-central-1:402010193138:listener/app/techlong-sandbox-cell/0123456789abcdef/0123456789abcdef',
      ControlListenerArn: 'arn:aws:elasticloadbalancing:ca-central-1:402010193138:listener/app/techlong-sandbox-cell/0123456789abcdef/0123456789abcdee' } };
  const publicParameters = { ControlIssuer: 'https://techlong.cloud', CorsAllowedOrigins: 'https://first-acceptance.sandbox.techlong.cloud,https://techlong.cloud',
    StripePublishableKey: 'pk_test_fixture1234567890', StripeSuccessUrl: 'https://first-acceptance.sandbox.techlong.cloud/payment-success?session_id={CHECKOUT_SESSION_ID}',
    StripeCancelUrl: 'https://first-acceptance.sandbox.techlong.cloud/payment-cancel' };
  const workload = await prepareInitializedWorkloadV3({ root, jobPlan: admission.jobPlan, cell, publicParameters });
  const reviewInput = { admission, workload, binding: { fixtureOnly: true }, endpointSha256: 'f'.repeat(64),
    preflight: { namespacesAbsent: true, retiredPredecessor: predecessor.stackId, cloudWrites: 0 }, predecessor,
    privateSource: { fixtureOnlyNoMaterialLoaded: true } };
  return { input, admission, reviewInput, manifest: await preparePlatformReviewV4(reviewInput), receipt };
}

test('queued review binds existing ID, actor, nine rows and exact V4 program templates; newJobs=0', async () => {
  const { input, admission, manifest } = await fixture();
  assert.equal(admission.jobPlan.jobId, input.observed.job.id); assert.equal(manifest.effects.newJobs, 0);
  assert.equal(manifest.queue.rowSha256, await sha256Hex(input.observed.job));
  assert.equal(manifest.queue.requester.id, 'usr_fixture_admin'); assert.equal(manifest.preparationIsNotExecutionApproval, true);
  assert.equal(manifest.effects.exactHeldJobClaims, 1); assert.equal(manifest.effects.sourceCreateStackCalls, 1);
  await assertPlatformManifestShapeV4(manifest); assert.throws(() => { manifest.queue.row.attempts = 9; }, TypeError);
  for (const patch of [{ riskFile: 'other' }, { effects: { ...manifest.effects, newJobs: 1 } }, { extra: 'unreviewed' }]) {
    const x = structuredClone({ ...manifest, ...patch }); const { manifestSha256: _hash, ...body } = x; void _hash;
    x.manifestSha256 = await sha256Hex(body); await assert.rejects(assertPlatformManifestShapeV4(x));
  }
});
test('succeeded old job, released hold, stale facts, revoked admin and active sibling cannot enter review', async () => {
  const { input } = await fixture();
  for (const patch of [{ status: 'succeeded' }, { available_at: NOW }, { attempts: 1 }, { lease_token: 'lease_other' }])
    assert.throws(() => assertHeldPlatformJobV4({ ...input.observed.job, ...patch }, NOW));
  for (const key of ['stale', 'revoked', 'sibling', 'proof', 'rowDrift']) {
    const observed = structuredClone(input.observed);
    if (key === 'stale') observed.checkedAt = NOW - 30000;
    if (key === 'revoked') observed.requester.is_platform_admin = 0;
    if (key === 'sibling') observed.jobs.push({ id: 'job_' + 'e'.repeat(24), status: 'running' });
    if (key === 'proof') observed.jobs[0].status = 'dead_letter';
    if (key === 'rowDrift') observed.job.updated_at++;
    await assert.rejects(admitPlatformJobV4({ ...input, observed }));
  }
});

test('reader freshness starts before local I/O; small DB/host clock skew is not stale or a new lease clock', async () => {
  const { input } = await fixture();
  for (const delta of [-400, 400]) {
    const raw = { ...input.observed, checkedAt: NOW + delta };
    const observed = platformReadObservationV4(raw, { jobs: raw.jobs, requester: raw.requester }, NOW - 1000, NOW - 100);
    assert.equal(observed.checkedAt, NOW - 1000);
    assert.equal(observed.databaseCheckedAt, NOW + delta);
    const admitted = await admitPlatformJobV4({ ...input, observed });
    assert.equal(admitted.queue.observedAt, NOW - 1000);
    assert.equal(admitted.queue.row.available_at, INITIALIZED_REVIEW_HOLD_AT);
    assertCurrentPlatformRowsV4({ queue: admitted.queue, jobPlan: admitted.jobPlan }, observed, NOW);
    // Reusing the same read does not reset its age or extend the 30s window.
    await assert.rejects(admitPlatformJobV4({ ...input, observed, now: NOW + 29000 }));
    assert.throws(() => assertCurrentPlatformRowsV4({ queue: admitted.queue, jobPlan: admitted.jobPlan }, observed, NOW + 29000));
  }
});

test('slow reads, backward local clock or malformed DB timestamp still stop before review', async () => {
  const { input } = await fixture(), raw = input.observed, facts = { jobs: raw.jobs, requester: raw.requester };
  for (const [start, finish] of [[NOW - 30000, NOW], [NOW, NOW - 1], [NaN, NOW]])
    assert.throws(() => platformReadObservationV4(raw, facts, start, finish));
  assert.throws(() => platformReadObservationV4({ ...raw, checkedAt: NaN }, facts, NOW - 100, NOW));
});
test('TTL is not cleanup proof or substitute for exact predecessor; active window never reviews a second workload', async () => {
  const { input } = await fixture();
  await assert.rejects(admitPlatformJobV4({ ...input, predecessor: { ...input.predecessor, stackId: 'different' } }));
  await assert.rejects(admitPlatformJobV4({ ...input, predecessor: { ...input.predecessor, receiptSha256: '0'.repeat(64) } }));
  const observed = structuredClone(input.observed), outputs = JSON.parse(observed.snapshot.deployment.outputs);
  outputs.expressInitializedWorkerRunsV2[input.predecessor.jobId].workloadExpiresAt = NOW + 7200000;
  observed.snapshot.deployment.outputs = canonicalJson(outputs);
  await assert.rejects(admitPlatformJobV4({ ...input, observed }));
  const f = await fixture(); await assert.rejects(preparePlatformReviewV4({ ...f.reviewInput, preflight: { ...f.reviewInput.preflight, namespacesAbsent: false } }));
});
test('Run current-row guard checks queued snapshot, original admin, successful proof and all old coordinates', async () => {
  const { input, manifest } = await fixture(); assert.doesNotThrow(() => assertCurrentPlatformRowsV4(manifest, input.observed, NOW));
  for (const key of ['snapshot', 'job', 'requester', 'proof', 'sibling']) {
    const observed = structuredClone(input.observed);
    if (key === 'snapshot') observed.snapshot.deployment.ready_at++;
    if (key === 'job') observed.job.updated_at++;
    if (key === 'requester') observed.requester.status = 'suspended';
    if (key === 'proof') observed.jobs[0].completed_at++;
    if (key === 'sibling') observed.jobs.push({ id: 'other', status: 'pending' });
    assert.throws(() => assertCurrentPlatformRowsV4(manifest, observed, NOW));
  }
});
test('actual unpredictable claim token is the only template capability change; zero token and drift fail', async () => {
  const { manifest } = await fixture(), request = { plan: manifest.jobPlan, approvedPlanSha256: manifest.jobPlan.planSha256, leaseToken: 'lease_' + 'd'.repeat(32) };
  const p = await assertClaimMatchesReviewV4(manifest, request), sql = p.statements.map(q => q.text).join('\n');
  assert.equal(p.lease.jobId, manifest.queue.row.id); assert.doesNotMatch(sql, /INSERT|DELETE|SKIP LOCKED/);
  assert.notEqual(p.programSha256, manifest.programs.claimTemplateSha256);
  await assert.rejects(assertClaimMatchesReviewV4(manifest, { ...request, leaseToken: W4_ZERO_LEASE_TOKEN }));
  const changed = structuredClone(manifest); changed.programs.claimTemplateSha256 = '0'.repeat(64);
  await assert.rejects(assertClaimMatchesReviewV4(changed, request));
});
test('existing W2 runner composes V4 same-job claim, GET-only proof and atomic provenance-preserving completion', async () => {
  const { manifest } = await fixture(), plan = manifest.jobPlan, calls = []; let compiledClaim;
  const runner = createExpressInitializedSingleJobRunnerV2({ plan, now: () => NOW + 5000,
    repository: {
      async readSnapshot() { throw Error('not used by runner'); },
      async claim(request) { calls.push('claim_same_job'); compiledClaim = await assertClaimMatchesReviewV4(manifest, request);
        return { lease: compiledClaim.lease, leaseExpiresAt: NOW + 1200000, programSha256: compiledClaim.programSha256 }; },
      async assertLease(p, l) { calls.push('lease'); const compiled = await compilePlatformInitializedLeaseCheckV4(p, manifest.queue.row, l);
        return { accepted: true, programSha256: compiled.programSha256 }; },
      async complete(request) { calls.push('complete_same_job');
        const compiled = await compilePlatformInitializedCompleteV4({ ...request, queuedJob: manifest.queue.row });
        assert.equal((compiled.statements.map(q => q.text).join('\n').match(/UPDATE public\./g) ?? []).length, 2);
        const snapshot = structuredClone(plan.snapshot); snapshot.deployment.outputs = compiled.outputs; snapshot.deployment.updated_at = NOW + 5000;
        const job = { ...manifest.queue.row, status: 'succeeded', attempts: 1, payload: compiledClaim.statements[3].values[2], completed_at: NOW + 5000 };
        const result = await verifyPlatformInitializedCompletionReadbackV4({ plan, lease: request.lease, queuedJob: manifest.queue.row,
          snapshot, job, expectedOutputs: compiled.outputs });
        assert.deepEqual(JSON.parse(job.payload).platformRequest, JSON.parse(manifest.queue.row.payload));
        return { ...result, programSha256: compiled.programSha256, receiptSha256: compiled.receiptSha256, checkedAt: NOW + 5000 };
      },
    },
    workload: { async executeOnce({ assertLease }) { calls.push('provider_fixture'); await assertLease();
      return { materialSha256: plan.materialSha256, ownerDeploymentId: S.deploymentId, generation: 1,
        stackId: 'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/12345678-1234-1234-1234-123456789012',
        workloadExpiresAt: NOW + 7200000, imageUri: S.artifactRef, configurationHash: S.configurationHash, epoch: S.epoch, operationHash: S.operationHash,
        providerObservationSha256: '1'.repeat(64), providerCheckedAt: NOW + 4000, authorityObservationSha256: '2'.repeat(64), authorityCheckedAt: NOW + 4000 }; } },
    readback: { async readConfiguration() { calls.push('get_only_fixture'); return { ready: true, desiredConfigurationHash: S.configurationHash, imageRevision: S.artifactRef.split('@')[1] }; } },
  });
  const result = await runner.runOnce({ approvedPlanSha256: plan.planSha256, signal: AbortSignal.timeout(5000) });
  assert.equal(result.outcome, 'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED'); assert.equal(result.jobId, manifest.queue.row.id);
  assert.equal(calls.filter(x => x === 'claim_same_job').length, 1); assert.equal(calls.filter(x => x === 'complete_same_job').length, 1);
  assert.equal(result.initializationPosts, 0); assert.equal(result.automaticRetries, 0);
});
test('real CLI CheckRuntime is local; malformed argument sets cannot reach any runtime action', async () => {
  const execute = promisify(execFile), options = { windowsHide: true, timeout: 30000, maxBuffer: 100000 };
  const { stdout } = await execute(process.execPath, ['--experimental-strip-types', 'ops/aws-sandbox/scripts/run-express-platform-worker-v4.mjs', '--mode', 'CheckRuntime'], options);
  const result = JSON.parse(stdout); assert.equal(result.databaseQueries, 0); assert.equal(result.cloudWrites, 0); assert.equal(result.privateReads, 0);
  assert.equal(result.createsNewJob, false); assert.equal(result.queuePollerEnabled, false);
  await assert.rejects(execute(process.execPath, ['--experimental-strip-types', 'ops/aws-sandbox/scripts/run-express-platform-worker-v4.mjs', '--mode', 'RunOnce'], options));
});
