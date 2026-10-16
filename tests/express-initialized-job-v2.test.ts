import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareExpressInitializedWorkerV2 } from '../lib/deployments/execution/express-initialized-worker-v2.ts';
import { prepareExpressInitializedJobV2, compileExpressInitializedClaimV2, compileExpressInitializedLeaseCheckV2,
  compileExpressInitializedCompleteV2, verifyExpressInitializedCompletionReadbackV2,
  type ExpressInitializedSnapshotV2, type ExpressInitializedCompletionProofV2 } from '../lib/deployments/execution/express-initialized-job-v2.ts';
import { createExpressInitializedJobNeonV2 } from '../lib/deployments/execution/express-initialized-job-neon-v2.ts';
import { expressDeliveryFixture } from './fixtures/express-delivery-v1.ts';
import { getTemplateVersionPreset } from '../lib/templates/presets.ts';
import { sha256Hex, canonicalJson } from '../lib/deployments/execution/hash.ts';
import { awsSandboxTenantStackName } from '../lib/deployments/cloudformation/tenant-stack.ts';
import { createExpressInitializedSingleJobRunnerV2 } from '../lib/deployments/execution/express-initialized-job-runner-v2.ts';

async function fixture() {
  const f = await expressDeliveryFixture(), preset = getTemplateVersionPreset('restaurant-order-system')!, now = f.workload.requestedAt;
  const configuration = { ...preset.defaultConfiguration, defaultStoreName: 'Fixture Store', firstOwnerUsername: 'fixture_admin' };
  const root = await prepareExpressInitializedWorkerV2({ delivery: {
    scope: { ...f.scope, ownerDeploymentId: f.fence.ownerDeploymentId, templateVersionId: 'tpl_fixture' },
    sourcePlan: f.plan, sourcePlanSha256: await sha256Hex(f.plan), configuration, configurationSha256: await sha256Hex(configuration),
    configurationSchema: preset.configurationSchema, environment: f.workload.environment, binding: f.binding,
    databaseOid: '16459', roleOid: '16456', tenantHostname: 'first-acceptance.sandbox.techlong.cloud',
  }, existingDefaultStoreId: 'add89a8c-f43e-81b9-8287-0cb6c5c54f87' });
  const m = root.material, s = m.scope, i = f.fence.identity, oldJob = 'job_' + 'a'.repeat(24);
  const snapshot: ExpressInitializedSnapshotV2 = {
    deployment: { id: s.ownerDeploymentId, app_instance_id: s.appInstanceId, environment_id: s.environmentId,
      subscription_id: 'sub_fixture', status: 'ready', current_step: 'ready', ready_at: now - 60000, updated_at: now - 50000,
      mode: 'aws_sandbox', cell_key: s.cellKey, plan_hash: m.planSha256, configuration_hash: m.configurationSha256,
      artifact_ref: m.images.app, desired_plan: canonicalJson(m.plan), outputs: '{"manualReady":{"historical":true},"workloadRestoration":{"keep":true}}' },
    app: { id: s.appInstanceId, workspace_id: s.workspaceId, product_id: s.productId, template_version_id: s.templateVersionId,
      subscription_id: 'sub_fixture', status: 'active', access_url: 'https://' + m.tenantHostname, configuration_snapshot: canonicalJson(configuration) },
    workspace: { id: s.workspaceId, status: 'active' },
    subscription: { id: 'sub_fixture', workspace_id: s.workspaceId, product_id: s.productId, template_version_id: s.templateVersionId,
      status: 'active', current_period_end: now + 86400000 },
    environment: { id: s.environmentId, status: 'active', apply_enabled: 0, admission_state: 'open', admission_epoch: 0,
      admission_stack_id: null, kind: 'aws_sandbox', expected_account_id: '402010193138', region: 'ca-central-1', cell_key: s.cellKey,
      policy: canonicalJson(m.environment.policy) },
    predecessorJob: { id: oldJob, deployment_id: s.ownerDeploymentId, job_type: 'apply', status: 'succeeded', lease_owner: null,
      lease_token: null, lease_expires_at: null, attempts: 1, completed_at: now - 60000 },
    resource: { app_instance_id: s.appInstanceId, created_by_deployment_id: s.ownerDeploymentId, owner_deployment_id: s.ownerDeploymentId,
      generation: 1, lifecycle_status: 'verified', destroyed_at: null, stable_identity_hash: i.stableIdentityHash,
      environment_id: s.environmentId, workspace_id: s.workspaceId, product_id: s.productId, cell_key: s.cellKey,
      database_name: i.databaseName, role_name: i.roleName, secret_name: i.secretName, runtime_secret_ref: m.binding.runtimeSecret.arn,
      ownership_marker: f.fence.ownershipMarker, evidence_hash: 'b'.repeat(64), external_operation_epoch: f.external.epoch },
    operation: { app_instance_id: s.appInstanceId, generation: 1, epoch: f.external.epoch, owner_deployment_id: s.ownerDeploymentId,
      stable_identity_hash: i.stableIdentityHash, state: 'active', intent: 'provision', operation_hash: f.external.operationHash,
      marker: f.external.marker, created_by_job_id: oldJob },
    templateVersion: { id: s.templateVersionId, status: 'published', configuration_schema: canonicalJson(preset.configurationSchema) },
  };
  const input = { material: m, materialSha256: root.materialSha256, snapshot, externalFence: f.external,
    requestId: 'c'.repeat(64), now, deadline: now + 3600000 };
  const plan = await prepareExpressInitializedJobV2(input), leaseToken = 'lease_' + 'd'.repeat(32);
  const claim = await compileExpressInitializedClaimV2({ plan, approvedPlanSha256: plan.planSha256, leaseToken });
  const proof: ExpressInitializedCompletionProofV2 = { materialSha256: root.materialSha256, jobId: plan.jobId, leaseToken,
    stackId: 'arn:aws:cloudformation:ca-central-1:402010193138:stack/' + awsSandboxTenantStackName(s.appInstanceId) + '/12345678-1234-1234-1234-123456789012',
    workloadExpiresAt: now + 7200000, imageUri: m.images.app, configurationHash: m.configurationSha256,
    existingDefaultStoreId: m.existingDefaultStoreId, epoch: f.external.epoch, operationHash: f.external.operationHash,
    providerObservationSha256: '1'.repeat(64), providerCheckedAt: now + 1000,
    authorityObservationSha256: '2'.repeat(64), authorityCheckedAt: now + 1100,
    controlObservationSha256: '3'.repeat(64), controlCheckedAt: now + 1200,
    initializedVerified: true, effectiveConfigurationVerified: true };
  return { input, plan, claim, proof, now: now + 1500 };
}
test('new exact job is deterministic, immutable and distinct from old apply; material is not approval', async () => {
  const { input, plan, claim } = await fixture();
  assert.equal((await prepareExpressInitializedJobV2(input)).planSha256, plan.planSha256);
  assert.notEqual(plan.jobId, input.snapshot.predecessorJob.id); assert.equal(claim.lease.attempt, 1);
  assert.equal(plan.leaseDurationMs, 1200000); assert.throws(() => { plan.snapshot.deployment.status = 'verifying'; }, TypeError);
  await assert.rejects(compileExpressInitializedClaimV2({ plan, approvedPlanSha256: plan.materialSha256, leaseToken: claim.lease.leaseToken }));
});
test('claim is one INSERT with database-clock admission/expiry; no replay/upsert/queue scan/old row write', async () => {
  const { claim, plan } = await fixture(), sql = claim.statements.map(q => q.text).join('\n');
  assert.equal(claim.statements.length, 3); assert.equal(claim.automaticRetries, 0); assert.equal(claim.isolationLevel, 'Serializable');
  assert.equal((sql.match(/INSERT INTO/g) ?? []).length, 1); assert.doesNotMatch(sql, /UPDATE public\.|ON CONFLICT|SKIP LOCKED|DELETE|ALTER/);
  assert.match(sql, /clock_timestamp/); assert.match(sql, /'pending','running','retry_wait'/); assert.match(sql, /1,1/);
  assert.match(sql, /to_jsonb\(oldj\)/); assert.match(sql, /FOR UPDATE OF e,w,sub,a,t,d,oldj,r,o/);
  assert.equal(claim.statements[2].values[0], plan.jobId);
});
test('wrong scope, inactive/changed coordinates, resource/epoch and material tampering fail closed', async () => {
  for (const key of ['deployment', 'app', 'subscription', 'environment', 'resource', 'operation', 'templateVersion', 'predecessorJob'] as const) {
    const { input } = await fixture();
    if (key === 'deployment') input.snapshot[key].artifact_ref = 'old-image';
    else if (key === 'resource') input.snapshot[key].generation = 2;
    else if (key === 'operation') input.snapshot[key].epoch = 99;
    else input.snapshot[key].status = 'inactive';
    await assert.rejects(prepareExpressInitializedJobV2(input));
  }
  const { plan, claim } = await fixture(), changed = structuredClone(plan); changed.deadline++;
  await assert.rejects(compileExpressInitializedClaimV2({ plan: changed, approvedPlanSha256: changed.planSha256, leaseToken: claim.lease.leaseToken }));
});
test('lease check is read-only DB-clock exact incarnation, never extends an expired lease', async () => {
  const { plan, claim } = await fixture(), p = await compileExpressInitializedLeaseCheckV2(plan, claim.lease);
  const sql = p.statements.map(q => q.text).join('\n');
  assert.doesNotMatch(sql, /FOR UPDATE|INSERT|UPDATE public\.|DELETE/); assert.match(sql, /lease_expires_at>/);
  for (const bad of [{ attempt: 2 }, { jobId: String(plan.snapshot.predecessorJob.id) }, { leaseToken: 'bad' }, { workerId: 'legacy-worker' }])
    await assert.rejects(compileExpressInitializedLeaseCheckV2(plan, { ...claim.lease, ...bad }));
});
test('completion preserves all old outputs and atomically changes only outputs/time and new job', async () => {
  const { plan, claim, proof, now } = await fixture(), p = await compileExpressInitializedCompleteV2({ plan, lease: claim.lease, proof, now });
  const sql = p.statements.map(q => q.text).join('\n'), outputs = JSON.parse(p.outputs);
  assert.equal(p.statements.length, 4); assert.equal(p.automaticRetries, 0);
  assert.deepEqual(outputs.manualReady, { historical: true }); assert.deepEqual(outputs.workloadRestoration, { keep: true });
  const receipt = outputs.expressInitializedWorkerRunsV2[plan.jobId];
  assert.equal(receipt.existingDefaultStoreId, proof.existingDefaultStoreId); assert.equal('leaseToken' in receipt, false);
  assert.equal(await sha256Hex(receipt), p.receiptSha256);
  assert.equal((sql.match(/UPDATE public\./g) ?? []).length, 2); assert.doesNotMatch(sql, /SET status='ready'|ready_at=|UPDATE public\.app_instances|INSERT/);
  assert.match(sql, /lease_expires_at>/); assert.match(sql, /clock_timestamp\(\).*\$3<=30000/);
});
test('stale/future/uninitialized/wrong image, store, epoch or lease proof cannot complete', async () => {
  const { plan, claim, proof, now } = await fixture();
  for (const bad of [{ providerCheckedAt: now - 30001 }, { authorityCheckedAt: now + 1 }, { controlCheckedAt: plan.preparedAt - 1 },
    { initializedVerified: false }, { imageUri: 'old' }, { existingDefaultStoreId: 'other' }, { epoch: 99 }, { leaseToken: 'wrong' },
    { stackId: proof.stackId.replace(awsSandboxTenantStackName(plan.material.scope.appInstanceId), 'techlong-sandbox-tenant-foreign') },
    { password: 'must-not-be-persisted' }]) {
    await assert.rejects(compileExpressInitializedCompleteV2({ plan, lease: claim.lease,
      proof: { ...proof, ...bad } as ExpressInitializedCompletionProofV2, now }));
  }
});
test('independent readback checks new job and every old row, not just succeeded status', async () => {
  const { plan, claim, proof, now } = await fixture(), p = await compileExpressInitializedCompleteV2({ plan, lease: claim.lease, proof, now });
  const snapshot = structuredClone(plan.snapshot); snapshot.deployment.outputs = p.outputs; snapshot.deployment.updated_at = now;
  const payload = claim.statements[2].values[3];
  const job = { id: plan.jobId, deployment_id: plan.material.scope.ownerDeploymentId, job_type: 'reconcile', dedupe_key: plan.dedupeKey,
    payload, status: 'succeeded', attempts: 1, max_attempts: 1, lease_owner: null, lease_token: null, lease_expires_at: null, completed_at: now };
  const check = () => verifyExpressInitializedCompletionReadbackV2({ plan, snapshot, job, expectedOutputs: p.outputs });
  assert.equal(check().outcome, 'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED');
  snapshot.deployment.ready_at = now; assert.throws(check); snapshot.deployment.ready_at = plan.snapshot.deployment.ready_at;
  snapshot.predecessorJob.status = 'running'; assert.throws(check);
});
test('concrete Neon construction is lazy; insecure/other-provider endpoints are rejected without network', () => {
  const adapter = createExpressInitializedJobNeonV2('postgresql://fixture:unused@ep-fixture.ca-central-1.aws.neon.tech/neondb?sslmode=require');
  assert.deepEqual(Object.keys(adapter).sort(), ['assertLease', 'claim', 'complete', 'readSnapshot']);
  for (const url of ['postgresql://localhost/test?sslmode=require', 'postgresql://ep-fixture.aws.neon.tech/test',
    'postgresql://ep-fixture.aws.neon.tech/test?sslmode=disable']) assert.throws(() => createExpressInitializedJobNeonV2(url));
});
async function runnerFixture(issue?: 'provider' | 'not_ready' | 'commit_unknown' | 'lost_lease' | 'image') {
  const f = await fixture(), calls: string[] = [], m = f.plan.material;
  let persistedProof: ExpressInitializedCompletionProofV2 | undefined;
  const runner = createExpressInitializedSingleJobRunnerV2({ plan: f.plan, now: () => f.now,
    repository: {
      async readSnapshot() { throw Error('not used by orchestration fixture'); },
      async claim(input) {
        calls.push('claim'); const compiled = await compileExpressInitializedClaimV2(input);
        return { lease: compiled.lease, leaseExpiresAt: f.now + 1200000, programSha256: compiled.programSha256 };
      },
      async assertLease() { calls.push('lease'); if (issue === 'lost_lease') throw Error('lease lost'); return { accepted: true, programSha256: '0'.repeat(64) }; },
      async complete(input) {
        calls.push('complete'); const compiled = await compileExpressInitializedCompleteV2(input); persistedProof = input.proof;
        if (issue === 'commit_unknown') throw Error('test provider secret MUST NOT leak');
        return { outcome: 'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED', retryAllowed: false, initializationPostAllowed: false,
          programSha256: compiled.programSha256, receiptSha256: compiled.receiptSha256, checkedAt: f.now };
      },
    },
    workload: { async executeOnce({ assertLease }) {
      calls.push('provider'); await assertLease();
      if (issue === 'provider') throw Error('test secret MUST NOT leak');
      return { ...f.proof, ownerDeploymentId: m.scope.ownerDeploymentId, generation: m.binding.resourceGeneration,
        imageUri: issue === 'image' ? 'wrong' : f.proof.imageUri,
        injectedPrivateValue: 'must not reach proof or outputs' };
    } },
    readback: { initializationPostAllowed: false, executionAuthorized: false, async readConfiguration() {
      calls.push('get_only'); return { ready: issue !== 'not_ready', desiredConfigurationHash: m.configurationSha256, imageRevision: m.images.app.split('@')[1] };
    } },
  });
  return { ...f, runner, calls, persistedProof: () => persistedProof };
}
test('single-job orchestration orders lease, provider, W1 readback and atomic complete; never copies extra provider fields', async () => {
  const f = await runnerFixture(); assert.deepEqual(f.calls, []);
  const result = await f.runner.runOnce({ approvedPlanSha256: f.plan.planSha256, signal: new AbortController().signal });
  assert.equal(result.outcome, 'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED');
  assert.deepEqual(f.calls, ['claim', 'lease', 'provider', 'lease', 'lease', 'get_only', 'complete']);
  assert.equal('injectedPrivateValue' in f.persistedProof()!, false);
  await assert.rejects(f.runner.runOnce({ approvedPlanSha256: f.plan.planSha256, signal: new AbortController().signal }));
  assert.equal(f.calls.filter(c => c === 'claim').length, 1);
});
test('provider/not-ready/lease/commit ambiguity never retries, provisions, completes early or leaks provider message', async () => {
  for (const issue of ['provider', 'not_ready', 'lost_lease', 'commit_unknown', 'image'] as const) {
    const f = await runnerFixture(issue), result = await f.runner.runOnce({ approvedPlanSha256: f.plan.planSha256, signal: new AbortController().signal });
    assert.equal(result.outcome, 'INSPECT_REQUIRED_NO_RETRY'); assert.doesNotMatch(JSON.stringify(result), /MUST NOT leak/);
    assert.equal(f.calls.filter(c => c === 'claim').length, 1); assert.ok(f.calls.filter(c => c === 'provider').length <= 1);
    assert.ok(f.calls.filter(c => c === 'get_only').length <= 1);
    if (issue !== 'commit_unknown') assert.equal(f.calls.includes('complete'), false);
    if (issue === 'image' || issue === 'lost_lease') assert.equal(f.calls.includes('get_only'), false);
  }
});
test('invalid approval and concurrent invocation cannot enter two claims', async () => {
  const invalid = await runnerFixture();
  await assert.rejects(invalid.runner.runOnce({ approvedPlanSha256: invalid.plan.materialSha256, signal: new AbortController().signal }));
  assert.deepEqual(invalid.calls, []);
  const f = await runnerFixture(), request = { approvedPlanSha256: f.plan.planSha256, signal: new AbortController().signal };
  const result = await Promise.allSettled([f.runner.runOnce(request), f.runner.runOnce(request)]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.calls.filter(c => c === 'claim').length, 1);
});
