import { readFileSync } from 'node:fs';
import { AwsEcsCellPlanOnlyDriver } from '../../lib/deployments/drivers/aws-ecs-cell.ts';
import { parseDatabaseBindingV2, databaseBindingDigestV2 } from '../../lib/deployments/execution/aurora-database-v2.ts';
import { deriveTenantResourceIdentity, deriveTenantOwnershipMarker, deriveTenantRuntimeSecretName } from '../../lib/deployments/execution/tenant-database.ts';
import type { DeploymentExecutionContext, TenantExternalOperationFence } from '../../lib/deployments/execution/contracts.ts';
import type { ExpressControlReadinessPolicyV1 } from '../../lib/deployments/execution/express-control-readiness-v1.ts';
import { v3Environment, v3Now } from './cell-stack-v3.ts';
export async function expressDeliveryFixture() {
  const scope = { appInstanceId: 'app_express_fixture', workspaceId: 'ws_fixture', productId: 'prd_restaurant_order_system',
    environmentId: 'env_aws_sandbox_ca_central_1', cellKey: 'cell-sandbox-1' };
  const plan = new AwsEcsCellPlanOnlyDriver({ mode: 'aws_sandbox', region: 'ca-central-1', cellKey: scope.cellKey }).buildPlan({
    ...scope, planId: 'plan_fixture', subscriptionId: 'sub_fixture', tenantKey: 'first_acceptance', deploymentProfileKey: 'standard-v1' });
  const identity = await deriveTenantResourceIdentity({ deployment: { appInstanceId: scope.appInstanceId, environmentId: scope.environmentId, desiredPlan: plan },
    appInstance: { id: scope.appInstanceId, workspaceId: scope.workspaceId, productId: scope.productId }, workspace: { id: scope.workspaceId },
    environment: { id: scope.environmentId, cellKey: scope.cellKey } } as DeploymentExecutionContext);
  const fence = { schemaVersion: 1 as const, identity, generation: 1, ownerDeploymentId: 'dep_fixture', ownershipMarker: deriveTenantOwnershipMarker(identity, 1) };
  const name = deriveTenantRuntimeSecretName(fence), arn = `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${name}-AbCdEf`;
  const b = JSON.parse(readFileSync(new URL('./aurora-database-v2.json', import.meta.url), 'utf8'));
  Object.assign(b, { stableIdentity: identity.stableIdentityHash, tenantDatabase: identity.databaseName, tenantUsername: identity.roleName,
    runtimeSecret: { arn, versionId: 'b'.repeat(32) } });
  const binding = parseDatabaseBindingV2(b), epoch = 3;
  const external: TenantExternalOperationFence = { schemaVersion: 1, resourceFence: fence, ownerDeploymentId: fence.ownerDeploymentId,
    epoch, intent: 'provision', marker: `tl_epoch_${identity.stableIdentityHash.slice(0, 24)}_g1_e${epoch}`, operationHash: 'c'.repeat(64), state: 'active' };
  const theme = { brightness: 'light' as const, primary: '#03A9F4', secondary: '#0288D1', surface: '#FFFFFF', background: '#FFFFFF', error: '#B3261E' };
  const policy: ExpressControlReadinessPolicyV1 = { binding, databaseOid: '16459', roleOid: '16456', appInstanceId: scope.appInstanceId,
    configurationHash: 'd'.repeat(64), imageRevision: 'sha256:' + 'e'.repeat(64), business: {
      entitlements: { 'buyer.accounts.max': 100, 'buyer.concurrent_access.max': 10, 'stores.max': 1, 'merchant.active_users.max': 3,
        'branding.custom_theme.enabled': true, 'branding.merchant_editable': true, 'buyer.access.lease_seconds': 900, 'buyer.access.heartbeat_seconds': 300 },
      default_store: { name: 'Fixture Store', buyer_theme: { ...theme }, merchant_theme: { ...theme } }, firstOwnerUsername: 'fixture_admin' } };
  const imageUri = `402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@${policy.imageRevision}`;
  const workload = { deploymentId: fence.ownerDeploymentId, resourceGeneration: 1, externalOperation: {
    epoch, intent: 'provision' as const, ownerDeploymentId: fence.ownerDeploymentId, operationHash: external.operationHash, marker: external.marker, state: 'active' as const },
    runtimeSecretName: name, runtimeSecretRef: arn, plan, environment: v3Environment(), imageUri,
    tenantHostname: 'first-acceptance.sandbox.techlong.cloud', listenerPriority: 100, activeCellCount: 1, activeTenantCount: 0, requestedAt: v3Now };
  const handshake = (complete: boolean) => ({ success: true, readiness: { protocol: complete ? 'techlong/tenant-initialized/v1' : 'techlong/tenant-bootstrap/v1',
    readiness_mode: 'tenant-v1', database_profile: 'express_iam', app_instance_id: policy.appInstanceId,
    database_binding_sha256: databaseBindingDigestV2(binding), database_oid: policy.databaseOid, role_oid: policy.roleOid,
    desired_configuration_hash: policy.configurationHash, image_revision: policy.imageRevision, ready: true, initialization_verified: complete, external_epoch_claimed: false } });
  return { scope, plan, fence, name, arn, binding, external, policy, workload, handshake };
}
