import test from 'node:test';
import assert from 'node:assert/strict';
import { firstClaimFixture } from './fixtures/express-first-claim-v1.ts';
import { deriveExpressFirstDeploymentV1 } from '../lib/deployments/execution/express-deployment-scope-v1.ts';
import { prepareExpressSingleTenantDeliveryV1 } from '../lib/deployments/execution/express-single-tenant-delivery-v1.ts';
import { prepareExpressLiveDeliveryPlanV1, EXPRESS_LIVE_RESOURCES_V1 as C } from '../lib/deployments/execution/express-live-delivery-plan-v1.ts';
import { compileExpressFirstClaimProgramV1 } from '../lib/deployments/execution/express-first-claim-program-v1.ts';
import { sha256Hex, canonicalJson } from '../lib/deployments/execution/hash.ts';
const now = Date.parse('2026-10-15T15:00:00Z');
async function fixture() {
  const f = await firstClaimFixture(), proposal = await deriveExpressFirstDeploymentV1({ material: f.root.material,
    materialSha256: f.root.materialSha256, subscriptionId: f.subscriptionId });
  const delivery = await prepareExpressSingleTenantDeliveryV1({ ...f.input, scope: { ...f.input.scope, ownerDeploymentId: proposal.scope.deploymentId } });
  const input = { sourceMaterial: f.root.material, sourceMaterialSha256: f.root.materialSha256, subscriptionId: f.subscriptionId,
    configuration: f.configuration, configurationSchema: f.input.configurationSchema, hostedZoneId: 'Z12345678', now,
    privateReceipt: { outcome: 'PRIVATE_CONTROL_PROVENANCE_REBOUND_NOT_RUNTIME_VERIFIED',
      manifestSha256: '755fc5af86fd7eff9e00f87b17f424c0e8ed2efa5292e1770bac51313e15fe36',
      summary: { targetMaterialSha256: delivery.materialSha256, targetScopeSha256: await sha256Hex(proposal.scope) }, publicParameters: {
        ControlIssuer: 'https://techlong.cloud', CorsAllowedOrigins: 'https://first-acceptance.sandbox.techlong.cloud,https://techlong.cloud',
        StripePublishableKey: 'pk_test_' + 'a'.repeat(32), StripeSuccessUrl: 'https://first-acceptance.sandbox.techlong.cloud/payment-success?session_id={CHECKOUT_SESSION_ID}',
        StripeCancelUrl: 'https://first-acceptance.sandbox.techlong.cloud/payment-cancel' } },
    compute: { outcome: 'EXPRESS_COMPUTE_INDEPENDENTLY_VERIFIED_NO_WORKLOAD',
      stackId: 'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1',
      templateSha256: 'e32eae43616dfcef7eb6825a55a86eebedb8e8d2e01ba4f775592b2f80fcb892',
      outputs: { ClusterName: 'cell-sandbox-1', VpcId: 'vpc-0136b6ba92a72cbf9', SubnetIds: 'subnet-05b781276cc988b93,subnet-05729abe921410a75',
        TaskSecurityGroupId: 'sg-0df75af0d0661492a', HttpsListenerArn: 'arn:aws:elasticloadbalancing:ca-central-1:402010193138:listener/app/techlong-sandbox-cell-sandbox-1/77888e84c19e8b86/469c2b642a33bfc1',
        ControlListenerArn: 'arn:aws:elasticloadbalancing:ca-central-1:402010193138:listener/app/techlong-sandbox-cell-sandbox-1/77888e84c19e8b86/bc69b195b69bc2d9', CellExpiresAt: '2026-10-15T16:44:56.246Z' },
      loadBalancer: { arn: 'arn:aws:elasticloadbalancing:ca-central-1:402010193138:loadbalancer/app/techlong-sandbox-cell-sandbox-1/77888e84c19e8b86',
        vpcId: 'vpc-0136b6ba92a72cbf9', dnsName: 'techlong-sandbox-cell-sandbox-1-335750443.ca-central-1.elb.amazonaws.com', hostedZoneId: 'ZQSVJUPU6J1EY' } } };
  return { f, input, plan: await prepareExpressLiveDeliveryPlanV1(input) };
}

test('concrete seven-resource request fills every parameter and pins full public-key version without legacy relaxation', async () => {
  const { plan: p } = await fixture(); assert.equal(p.futureTemplate.resourceInventory.length, 7);
  assert.deepEqual(p.futureTemplate.requiredExternalParameters, []);
  assert.equal(p.futureTemplate.parameters.ControlPublicKeyValueFrom, C.controlPublicKeyArn + ':::' + C.controlPublicKeyVersion);
  assert.equal(p.futureTemplate.tags.ExpiresAt, p.deadlineTag);
  assert.equal(p.executionAuthorized, false); assert.equal(p.authorityCurrentlyInstalled, false);
  assert.equal(p.pendingExternalFence.state, 'pending_external');
  assert.equal(p.futureTemplate.templateBody.includes('AWS::Scheduler::Schedule'), false);
  assert.equal(p.futureTemplate.templateBody.includes('AWS::RDS::'), false);
  assert.equal(Object.isFrozen(p.proposedWorkloadCreate), true);
  assert.equal(p.proposedWorkloadCreate.OnFailure, 'ROLLBACK');
});
test('wrong private provenance, foreign compute, old deadline or missing public input never produces a request', async () => {
  for (const issue of ['private', 'compute', 'expiry', 'public', 'config']) {
    const { input } = await fixture(), x = structuredClone(input);
    if (issue === 'private') x.privateReceipt.summary.targetMaterialSha256 = '0'.repeat(64);
    if (issue === 'compute') x.compute.stackId = x.compute.stackId.replace('b64a20f0', '00000000');
    if (issue === 'expiry') x.now = Date.parse(x.compute.outputs.CellExpiresAt);
    if (issue === 'public') x.privateReceipt.publicParameters.ControlIssuer = 'http://evil.invalid';
    if (issue === 'config') x.configuration.defaultStoreName = 'changed';
    await assert.rejects(prepareExpressLiveDeliveryPlanV1(x));
  }
});
test('Dynamo transaction condition-checks aurora namespace and conditionally creates only the legacy first epoch', async () => {
  const { plan: p } = await fixture(), tx = p.proposedEpochTransaction;
  assert.equal(tx.TransactItems.length, 2);
  assert.equal(tx.TransactItems[0].ConditionCheck?.Key.authority_key.S.startsWith('tenant:aurora-v2:'), true);
  const put = tx.TransactItems[1].Put!;
  assert.equal(put.ConditionExpression, 'attribute_not_exists(#key)');
  const r = JSON.parse(put.Item.record_json.S); assert.equal(r.predecessor, null); assert.equal(r.epoch, 1);
  assert.equal(r.operationHash, p.pendingExternalFence.operationHash); assert.equal(tx.ClientRequestToken.length, 36);
});
test('DNS uses CREATE exact A alias, never UPSERT/DELETE or external target; priority pair remains separated', async () => {
  const { plan: p } = await fixture(), change = p.proposedDnsCreate.ChangeBatch.Changes[0];
  assert.equal(change.Action, 'CREATE'); assert.equal(change.ResourceRecordSet.Type, 'A');
  assert.equal(change.ResourceRecordSet.Name, 'first-acceptance.sandbox.techlong.cloud.');
  assert.equal(change.ResourceRecordSet.AliasTarget.HostedZoneId, 'ZQSVJUPU6J1EY');
  const rs = p.futureTemplate.template.Resources as Record<string, { Properties: { Priority: number } }>;
  assert.equal(rs.TenantBusinessControlDenyRule.Properties.Priority, 100); assert.equal(rs.TenantListenerRule.Properties.Priority, 101);
  assert.equal(rs.TenantControlListenerRule.Properties.Priority, 100);
});
test('first claim is six append-only inserts, SERIALIZABLE guards/locks, pending not verified/active; no queued auto retry', async () => {
  const { input, plan } = await fixture(); const p = await compileExpressFirstClaimProgramV1({ plan, configuration: input.configuration,
    environmentPolicy: { ...plan.environmentPolicy }, now, leaseToken: 'lease_' + '0'.repeat(32) });
  assert.equal(p.queries.length, 9); assert.equal(p.queries.filter(q => /^INSERT/.test(q.text)).length, 6);
  assert.equal(p.isolationLevel, 'Serializable'); assert.equal(p.insertedRows, 6);
  assert.equal(p.queries.some(q => /ON CONFLICT|CREATE TABLE|ALTER TABLE|DROP TABLE|DELETE FROM|UPDATE public/.test(q.text)), false);
  assert.match(p.queries[0].text, /apply_enabled=0/); assert.match(p.queries[1].text, /FOR UPDATE OF a,w,sub/);
  assert.match(p.queries[4].text, /'running'[\s\S]*1,1/); assert.match(p.queries[5].text, /'planned'/); assert.match(p.queries[7].text, /'pending_external'/);
  assert.ok(p.queries.every(q => q.values.every(v => v !== undefined)));
  assert.equal(p.resourceVerified, false); assert.equal(p.epochActivated, false); assert.equal(p.executionAuthorized, false);
  assert.equal(p.queries[3].values[4], canonicalJson(plan.desiredPlan));
});
test('tampered claim plan, config, lease token or environment cannot silently create a job', async () => {
  const { input, plan } = await fixture();
  for (const x of [{ plan: { ...plan, planSha256: '0'.repeat(64) } }, { configuration: {} }, { leaseToken: 'wrong' }, { environmentPolicy: {} }])
    await assert.rejects(compileExpressFirstClaimProgramV1({ plan, configuration: input.configuration, environmentPolicy: { ...plan.environmentPolicy },
      now, leaseToken: 'lease_' + '0'.repeat(32), ...x }));
});
