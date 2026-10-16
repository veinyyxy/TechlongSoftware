import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expressDeliveryFixture } from './fixtures/express-delivery-v1.ts';
import { getTemplateVersionPreset } from '../lib/templates/presets.ts';
import { prepareExpressInitializedWorkerV2 } from '../lib/deployments/execution/express-initialized-worker-v2.ts';
import { sha256Hex } from '../lib/deployments/execution/hash.ts';
import { prepareInitializedWorkloadV3, assertRunWindowV3, externalFenceFromSnapshotV3 } from '../ops/aws-sandbox/scripts/express-initialized-workload-v3.mjs';

async function dataFixture() {
  const f = await expressDeliveryFixture(), preset = getTemplateVersionPreset('restaurant-order-system');
  const configuration = { ...preset.defaultConfiguration, defaultStoreName: 'Fixture Store', firstOwnerUsername: 'fixture_admin' };
  const root = await prepareExpressInitializedWorkerV2({ delivery: { scope: { ...f.scope, ownerDeploymentId: f.fence.ownerDeploymentId, templateVersionId: 'tpl_fixture' },
    sourcePlan: f.plan, sourcePlanSha256: await sha256Hex(f.plan), configuration, configurationSha256: await sha256Hex(configuration),
    configurationSchema: preset.configurationSchema, environment: f.workload.environment, binding: f.binding,
    databaseOid: '16459', roleOid: '16456', tenantHostname: 'first-acceptance.sandbox.techlong.cloud' },
  existingDefaultStoreId: 'add89a8c-f43e-81b9-8287-0cb6c5c54f87' });
  // Deliberately data-only: this fixture does not claim a live PG job/lease.
  const jobPlan = { material: root.material, materialSha256: root.materialSha256, externalFence: f.external,
    planSha256: 'a'.repeat(64), jobId: 'job_' + 'b'.repeat(24), preparedAt: f.workload.requestedAt,
    claimBy: f.workload.requestedAt + 900000, deadline: f.workload.requestedAt + 3600000 };
  const cell = { stackId: 'arn:aws:cloudformation:ca-central-1:402010193138:stack/fixture/12345678-1234-1234-1234-123456789012',
    activeCellCount: 1, activeTenantCount: 0, parentTagExpiresAt: '2026-10-11T16:00:00.000Z', outputs: {
      ClusterName: 'cell-sandbox-1', VpcId: 'vpc-0123456789abcdef0', SubnetIds: 'subnet-0123456789abcdef0,subnet-0123456789abcdef1',
      TaskSecurityGroupId: 'sg-0123456789abcdef0', HttpsListenerArn: 'arn:aws:elasticloadbalancing:ca-central-1:402010193138:listener/app/techlong-sandbox-cell/0123456789abcdef/0123456789abcdef',
      ControlListenerArn: 'arn:aws:elasticloadbalancing:ca-central-1:402010193138:listener/app/techlong-sandbox-cell/0123456789abcdef/0123456789abcdee' } };
  const publicParameters = { ControlIssuer: 'https://techlong.cloud', CorsAllowedOrigins: 'https://first-acceptance.sandbox.techlong.cloud,https://techlong.cloud',
    StripePublishableKey: 'pk_test_fixture1234567890', StripeSuccessUrl: 'https://first-acceptance.sandbox.techlong.cloud/payment-success?session_id={CHECKOUT_SESSION_ID}',
    StripeCancelUrl: 'https://first-acceptance.sandbox.techlong.cloud/payment-cancel' };
  return { root, jobPlan, cell, publicParameters };
}
test('W3 composes the real seven-resource render into one immutable CreateStack and preserves old parent TTL', async () => {
  const data = await dataFixture(), plan = await prepareInitializedWorkloadV3(data);
  assert.equal(plan.resourceInventory.length, 7); assert.equal(plan.request.OnFailure, 'ROLLBACK');
  assert.equal(plan.request.TimeoutInMinutes, 15); assert.equal(plan.workloadExpiresAt, data.jobPlan.preparedAt + 7200000);
  assert.equal(plan.parentTagExpiresAt, data.cell.parentTagExpiresAt); assert.equal(plan.parentTagRenewalAuthorized, false);
  assert.equal(plan.request.Parameters.find(p => p.ParameterKey === 'ImageUri').ParameterValue, data.root.material.images.app);
  assert.equal(plan.template.Metadata.InitializedSingleJobV3.jobId, data.jobPlan.jobId);
  assert.ok(plan.request.TemplateBody.includes(data.root.material.images.app.split('@')[1]));
  assert.equal(plan.requestSha256, await sha256Hex(plan.request)); assert.equal(plan.iamWrites, 0);
  assert.equal(plan.dnsWrites, 0); assert.equal(plan.authorityWrites, 0); assert.equal(plan.initializationPosts, 0);
  assert.throws(() => { plan.request.StackName = 'changed'; }, TypeError);
});
test('occupied capacity, different material and secret-shaped extra public parameters cannot render an admitted request', async () => {
  for (const issue of ['capacity', 'material', 'extra']) {
    const data = await dataFixture();
    if (issue === 'capacity') data.cell.activeTenantCount = 1;
    if (issue === 'material') data.jobPlan.materialSha256 = '0'.repeat(64);
    if (issue === 'extra') data.publicParameters.StripeSecretKey = 'must-not-enter-request';
    await assert.rejects(prepareInitializedWorkloadV3(data));
  }
});
test('expired review does not extend TTL or authorize a fresh attempt', async () => {
  const data = await dataFixture(), workload = await prepareInitializedWorkloadV3(data), manifest = { jobPlan: data.jobPlan, workload };
  assert.doesNotThrow(() => assertRunWindowV3(manifest, data.jobPlan.preparedAt));
  assert.throws(() => assertRunWindowV3(manifest, data.jobPlan.claimBy));
  assert.throws(() => assertRunWindowV3(manifest, data.jobPlan.preparedAt - 1));
});
test('SQL snapshot projection retains identity version, owner/generation and exact active epoch', () => {
  const snapshot = { resource: { generation: 1, owner_deployment_id: 'dep_x', ownership_marker: 'marker', app_instance_id: 'app_x',
    workspace_id: 'ws_x', product_id: 'prd_x', environment_id: 'env_x', cell_key: 'cell-sandbox-1', stable_identity_hash: 'a'.repeat(64),
    database_name: 'tenant_x_db', role_name: 'tenant_x_role', secret_name: 'techlong/sandbox/tenant/x/runtime' },
  operation: { owner_deployment_id: 'dep_x', epoch: 3, intent: 'provision', marker: 'epoch_marker', operation_hash: 'b'.repeat(64), state: 'active' } };
  const f = externalFenceFromSnapshotV3(snapshot); assert.equal(f.resourceFence.identity.schemaVersion, 1);
  assert.equal(f.resourceFence.generation, 1); assert.equal(f.ownerDeploymentId, 'dep_x'); assert.equal(f.epoch, 3); assert.equal(f.state, 'active');
});
test('real CLI CheckRuntime stays local and does not start worker or load credentials', async () => {
  const result = await promisify(execFile)(process.execPath, ['--experimental-strip-types', 'ops/aws-sandbox/scripts/run-express-initialized-worker-v3.mjs', '--mode', 'CheckRuntime'],
    { windowsHide: true, timeout: 30000, maxBuffer: 100000 });
  const r = JSON.parse(result.stdout); assert.equal(r.globalWorkerEnabled, false); assert.equal(r.cloudWrites, 0);
  assert.equal(r.databaseQueries, 0); assert.equal(r.privateReads, 0); assert.equal(r.state, 'REVIEWED_SINGLE_JOB_ROOT_CODE_READY_NOT_RUNNING');
});
