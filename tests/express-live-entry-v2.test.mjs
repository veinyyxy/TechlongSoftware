import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateExpressReadyInspectionV1 } from '../ops/aws-sandbox/scripts/express-live-runtime-v1.mjs';
import { validateExpressInstalledSnapshotV1, createExpressInstalledDatabaseObserverV1 } from '../ops/aws-sandbox/scripts/express-live-database-observer-v1.mjs';
import { liveDeliveryFixtureV2 } from './fixtures/express-live-delivery-v2.ts';
import { compileExpressFirstClaimProgramV1 } from '../lib/deployments/execution/express-first-claim-program-v1.ts';

const execute = promisify(execFile);
async function readyFixture() {
  const { plan, f } = await liveDeliveryFixtureV2(), fence = plan.pendingExternalFence;
  const claim = await compileExpressFirstClaimProgramV1({ plan, configuration: f.configuration,
    environmentPolicy: { ...plan.environmentPolicy }, now: plan.renderRequestedAt, leaseToken: 'lease_' + '1'.repeat(32) });
  const row = { deployment_id: plan.scope.deploymentId, app_instance_id: plan.scope.appInstanceId,
    plan_hash: plan.scope.planHash, configuration_hash: plan.scope.configurationHash, artifact_ref: plan.scope.artifactRef,
    deployment_status: 'ready', instance_status: 'active', job_status: 'succeeded', job_id: claim.jobId,
    attempts: 1, max_attempts: 1, lease_cleared: true, lease_owner: null, owner_deployment_id: plan.scope.deploymentId,
    created_by_deployment_id: plan.scope.deploymentId, generation: 1, stable_identity_hash: fence.resourceFence.identity.stableIdentityHash,
    lifecycle_status: 'verified', runtime_secret_ref: plan.futureTemplate.parameters.TenantRuntimeSecretArn,
    epoch: 1, intent: 'provision', operation_state: 'active', operation_hash: fence.operationHash, marker: fence.marker,
    delivery_plan_sha256: plan.planSha256, observation_sha256: 'a'.repeat(64),
    stack_id: 'arn:aws:cloudformation:ca-central-1:402010193138:stack/' + plan.futureTemplate.stackName + '/11111111-2222-3333-4444-555555555555',
    access_url: 'https://first-acceptance.sandbox.techlong.cloud' };
  return { plan, row, jobId: claim.jobId };
}
test('independent ready projection needs exact successful job, resource, active epoch and stored deployment proof', async () => {
  const { plan, row, jobId } = await readyFixture();
  assert.equal(validateExpressReadyInspectionV1([row], plan, jobId).observationSha256, row.observation_sha256);
  for (const [key, bad] of Object.entries({ deployment_status: 'verifying', instance_status: 'pending', job_status: 'running',
    lease_cleared: false, attempts: 2, max_attempts: 3, generation: 2, epoch: 2, intent: 'cleanup', operation_state: 'pending_external',
    runtime_secret_ref: 'foreign', plan_hash: '0'.repeat(64), delivery_plan_sha256: '0'.repeat(64), access_url: 'https://wrong.invalid',
    observation_sha256: null, stack_id: 'wrong', owner_deployment_id: 'dep_foreign' }))
    assert.throws(() => validateExpressReadyInspectionV1([{ ...row, [key]: bad }], plan, jobId), /NOT_PROVED/);
  assert.throws(() => validateExpressReadyInspectionV1([], plan, jobId));
});
test('foreign database target refuses construction before credential resolution, connection or slot consumption', () => {
  let consumed = 0;
  assert.throws(() => createExpressInstalledDatabaseObserverV1({ program: { target: { endpoint: 'foreign.invalid' } },
    journal: { consume() { consumed++; } }, save() {} }), /TARGET_REJECTED/);
  assert.equal(consumed, 0);
});
test('database observer rejects partial/missing snapshots without accepting stale receipt booleans', async () => {
  await assert.rejects(validateExpressInstalledSnapshotV1([], { snapshot: [], tables: [] }), /SNAPSHOT_REJECTED/);
  await assert.rejects(validateExpressInstalledSnapshotV1(Array.from({ length: 8 }, () => ({ rows: [{}], rowCount: 1 })),
    { snapshot: Array(8).fill({}), tables: Array(73).fill('x'), target: { database: 'tenant_a0da1748bc4d5419_db' } }), /CURRENT_STATE_DIVERGED/);
});
test('new observer binds frozen read-only SELECT program, exact hashes, verified TLS, two entries and no old execution replay', async () => {
  const text = await readFile(new URL('../ops/aws-sandbox/scripts/express-live-database-observer-v1.mjs', import.meta.url), 'utf8');
  assert.match(text, /BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY/);
  assert.match(text, /default_transaction_read_only=on/); assert.match(text, /rejectUnauthorized: true/);
  assert.match(text, /checkServerIdentity: tls.checkServerIdentity/); assert.match(text, /journal.consume\('database_observe_'/);
  assert.match(text, /canonicalJson\(singleton.rows\).*ENTITLEMENTS/);
  assert.doesNotMatch(text, /client\.query\((?:program\.seed|.*insert)|review-express-store-seed|SetRole|ALTER |INSERT INTO/i);
});
test('metadata implementation never installs permissions, simulates logs or reads Secret values', async () => {
  const text = await readFile(new URL('../ops/aws-sandbox/scripts/express-live-metadata-v1.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /SimulatePrincipalPolicyCommand|GetSecretValueCommand|CreatePolicyVersionCommand|PutItemCommand|RunTaskCommand/);
  assert.match(text, /ConsistentRead: true/); assert.match(text, /ValidateTemplateCommand/);
  assert.match(text, /ServerlessV2ScalingConfiguration/); assert.match(text, /MaxCapacity: 1/);
  assert.match(text, /neonReadonlyAttempts\+\+/);
});
test('concrete runtime verifies task image/Secret reference set and UUID after atomic writeback, with one private/value entry', async () => {
  const text = await readFile(new URL('../ops/aws-sandbox/scripts/express-live-runtime-v1.mjs', import.meta.url), 'utf8');
  assert.match(text, /privateOpened\) throw/); assert.match(text, /valueRead \|\|/);
  assert.match(text, /'SAAS_CONTROL_PUBLIC_KEY'/); assert.match(text, /imageDigest !== plan.scope.artifactRef.split/);
  assert.match(text, /stack.StackId !== rows\[0\].stack_id/); assert.match(text, /new DescribeTasksCommand/);
  assert.match(text, /createAcceptanceReadonlyNeonSql\(databaseUrl\)\.query\(EXPRESS_READY_INSPECT_SQL_V1/);
});
test('Check is a non-network local composition; Run rederives whole plan before runtime/side effects', async () => {
  const text = await readFile(new URL('../ops/aws-sandbox/scripts/review-express-live-delivery-v2.mjs', import.meta.url), 'utf8');
  assert.match(text, /postgresql:\/\/check:check@local-check.neon.tech\/unused/);
  assert.match(text, /inputs.plan\(manifest.plan.renderRequestedAt\)/);
  assert.ok(text.indexOf('LIVE_MANIFEST_PLAN_REDERIVATION_REJECTED') < text.indexOf('runtime = await createExpressLiveRuntimeV1({ inputs, plan: manifest.plan'));
  assert.doesNotMatch(text, /process.env.DATABASE_URL\s*=/);
});
test('CLI rejects unknown/duplicate arguments before local history, credentials or output-directory creation', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'techlong-express-cli-test-'));
  for (const args of [['--mode', 'Run'], ['--mode', 'Check', '--mode', 'Run', '--output', temp],
    ['--mode', 'Review', '--output', temp, '--force', 'true']]) {
    await assert.rejects(execute(process.execPath, ['--experimental-strip-types', 'ops/aws-sandbox/scripts/review-express-live-delivery-v2.mjs', ...args],
      { timeout: 10000, windowsHide: true }), e => e.code === 1 && /LIVE_CLI_ARGUMENTS/.test(e.stderr));
  }
});
