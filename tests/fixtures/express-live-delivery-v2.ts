import { firstClaimFixture } from './express-first-claim-v1.ts';
import { deriveExpressFirstDeploymentV1 } from '../../lib/deployments/execution/express-deployment-scope-v1.ts';
import { prepareExpressSingleTenantDeliveryV1 } from '../../lib/deployments/execution/express-single-tenant-delivery-v1.ts';
import { prepareExpressLiveDeliveryPlanV1, prepareExpressLiveDeliveryPlanV2 } from '../../lib/deployments/execution/express-live-delivery-plan-v1.ts';
import { sha256Hex } from '../../lib/deployments/execution/hash.ts';
export const liveNow = Date.parse('2026-10-15T19:06:00Z');
/** Synthetic non-secret fixture. Nothing in this file is cloud verification. */
export async function liveDeliveryFixtureV2() {
  const f = await firstClaimFixture();
  const proposal = await deriveExpressFirstDeploymentV1({ material: f.root.material,
    materialSha256: f.root.materialSha256, subscriptionId: f.subscriptionId });
  const delivery = await prepareExpressSingleTenantDeliveryV1({ ...f.input, scope: { ...f.input.scope, ownerDeploymentId: proposal.scope.deploymentId } });
  const input = { sourceMaterial: f.root.material, sourceMaterialSha256: f.root.materialSha256, subscriptionId: f.subscriptionId,
    configuration: f.configuration, configurationSchema: f.input.configurationSchema, hostedZoneId: 'Z12345678', now: Date.parse('2026-10-15T15:00:00Z'),
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
  const previousPlan = await prepareExpressLiveDeliveryPlanV1(input);
  const candidateInput = { ...input, now: liveNow, previousPlan,
    windowAcknowledgement: 'INDEPENDENT_CHILD_WINDOW_PARENT_UNCHANGED_NO_AUTO_CLEANUP' as const };
  const plan = await prepareExpressLiveDeliveryPlanV2(candidateInput);
  return { f, input, previousPlan, candidateInput, plan };
}
