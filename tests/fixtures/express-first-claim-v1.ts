import { AwsEcsCellPlanOnlyDriver } from '../../lib/deployments/drivers/aws-ecs-cell.ts';
import { prepareExpressSingleTenantDeliveryV1 } from '../../lib/deployments/execution/express-single-tenant-delivery-v1.ts';
import { getTemplateVersionPreset } from '../../lib/templates/presets.ts';
import { sha256Hex } from '../../lib/deployments/execution/hash.ts';
import { expressDeliveryFixture } from './express-delivery-v1.ts';

/** Non-secret coordinates only; no real token/password/provider calls. */
export async function firstClaimFixture() {
  const f = await expressDeliveryFixture(), preset = getTemplateVersionPreset('restaurant-order-system')!;
  const scope = { appInstanceId: 'app_e897a4377bce498b9c5ee9e64509dcad', workspaceId: 'ws_ac46ffc6778f44f5a4b5332c41bb9f33',
    productId: 'prd_restaurant_order_system', environmentId: 'env_aws_sandbox_ca_central_1', cellKey: 'cell-sandbox-1',
    templateVersionId: 'tplver_fixture', ownerDeploymentId: 'dep_previous_future_only' };
  const subscriptionId = 'sub_fixture';
  const plan = new AwsEcsCellPlanOnlyDriver({ mode: 'aws_sandbox', cellKey: 'cell-sandbox-1', region: 'ca-central-1' }).buildPlan({
    ...scope, planId: 'plan_fixture', subscriptionId, tenantKey: 'first-acceptance', deploymentProfileKey: 'standard-v1' });
  const binding = { ...f.binding, clusterArn: 'arn:aws:rds:ca-central-1:402010193138:cluster:techlong-sandbox-express-d001',
    clusterResourceId: 'cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM', endpoint: 'techlong-sandbox-express-d001.cluster-cn8aaekuqf1r.ca-central-1.rds.amazonaws.com',
    stableIdentity: 'a0da1748bc4d5419a6306b89c090957bc432332f6cc33820abc7f02ad63a808d',
    tenantDatabase: 'tenant_a0da1748bc4d5419_db', tenantUsername: 'tenant_a0da1748bc4d5419_role',
    runtimeSecret: { arn: 'arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/tenant/a4377bce498b9c5ee9e64509dcad_a0da1748bc/runtime/g1-T9CqN5',
      versionId: '0f45d29f-02d4-4117-99b1-c06645aa3c6e' } };
  const configuration = { ...preset.defaultConfiguration, defaultStoreName: 'Techlong Sandbox', firstOwnerUsername: 'techlong_sandbox_admin' };
  const input = { scope, sourcePlan: plan, sourcePlanSha256: await sha256Hex(plan), configuration,
    configurationSha256: await sha256Hex(configuration), configurationSchema: preset.configurationSchema, environment: f.workload.environment,
    binding, databaseOid: '16459', roleOid: '16456', tenantHostname: 'first-acceptance.sandbox.techlong.cloud' as const };
  const root = await prepareExpressSingleTenantDeliveryV1(input);
  return { root, input, subscriptionId, configuration, row: {
    app: { id: scope.appInstanceId, workspaceId: scope.workspaceId, productId: scope.productId, subscriptionId,
      templateVersionId: scope.templateVersionId, status: 'pending', slug: 'first-acceptance', configuration },
    subscription: { status: 'active', periodEnd: Date.parse('2026-11-13T00:00:00Z'), workspaceId: scope.workspaceId,
      productId: scope.productId, templateVersionId: scope.templateVersionId }, workspace: { status: 'active' },
    environment: { status: 'active', applyEnabled: 0, policy: f.workload.environment.policy,
      admissionState: 'open', admissionEpoch: 0, admissionStackId: null }, deployments: 0, jobs: 0, resources: 0, operations: 0 } };
}
