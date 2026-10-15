import test from 'node:test';
import assert from 'node:assert/strict';
import { renderExpressSingleTenantCellV1 } from '../lib/deployments/cloudformation/express-single-tenant-cell-v1.ts';
import { renderSingleTenantAcceptanceCell, assertSingleTenantCellRender } from '../lib/deployments/cloudformation/single-tenant-acceptance-cell.ts';
import { expressDeliveryFixture } from './fixtures/express-delivery-v1.ts';
import { v3Environment, v3Now } from './fixtures/cell-stack-v3.ts';
const cell = () => ({ environment: v3Environment(), requestedAt: v3Now, availabilityZones: ['ca-central-1a', 'ca-central-1b'] as [string, string],
  certificateArn: 'arn:aws:acm:ca-central-1:402010193138:certificate/12345678-1234-1234-1234-123456789012',
  controlTrustStoreArn: 'arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/fixture/abc123' });
test('Express compute/network has exactly 16 resources, no RDS/DB ingress/one-shot or invented password outputs; no old authority', async () => {
  const f = await expressDeliveryFixture(), i = { cell: cell(), binding: f.binding }, before = structuredClone(i);
  const r = await renderExpressSingleTenantCellV1(i); assert.deepEqual(i, before); assert.equal(r.resourceInventory.length, 16);
  assert.equal(r.resourceInventory.some(x => /RDS|IAM|Lambda|Scheduler/.test(x.type)), false);
  assert.equal(r.templateBody.includes('5432'), false); assert.equal(r.templateBody.includes('DatabaseMasterSecretArn'), false);
  assert.equal(r.safety.existingExpressDatabaseOwnedByThisStack, false); assert.equal(r.safety.existingFailedStackDeletionAuthorized, false);
  assert.equal(r.safety.executionAuthorized, false); assert.equal(r.safety.monthlyBudgetTargetUsd, 50);
  assert.throws(() => assertSingleTenantCellRender(r));
  const outputs = r.template.Outputs as Record<string, unknown>;
  assert.deepEqual(Object.keys(outputs).sort(), ['ClusterName', 'VpcId', 'SubnetIds', 'TaskSecurityGroupId', 'HttpsListenerArn', 'ControlListenerArn', 'CellExpiresAt'].sort());
  assert.ok(r.templateBody.includes('ControlMtlsListener')); assert.ok(r.templateBody.includes('BusinessControlDenyRule'));
  assert.ok(r.templateBody.includes('verify')); // Original ALB mTLS mode retained.
});
test('Full Cell renderer remains 25-resource and RDS-backed; Express does not silently convert Full binding', async () => {
  const f = await expressDeliveryFixture(), old = await renderSingleTenantAcceptanceCell(cell());
  assert.equal(old.resourceInventory.length, 25); assert.ok(old.templateBody.includes('AWS::RDS::DBCluster')); assertSingleTenantCellRender(old);
  const full = { ...f.binding, profile: 'full_password', tlsTrust: 'rds-ca/v1', access: { authentication: 'password', internetAccessGatewayEnabled: false,
    managementSecretArn: 'arn:aws:secretsmanager:ca-central-1:402010193138:secret:rds!cluster-fixture-AbCdEf' } };
  await assert.rejects(renderExpressSingleTenantCellV1({ cell: cell(), binding: full as typeof f.binding }), /EXPRESS_CELL_PROFILE_REQUIRED/);
});
