import { prepareExpressSingleTenantDeliveryV1, type ExpressDeliveryInputV1 } from './express-single-tenant-delivery-v1.ts';
import { deriveExpressFirstDeploymentV1 } from './express-deployment-scope-v1.ts';
import { NeonDeploymentExecutionRepository } from './neon-repository.ts';

/** Explicit first-claim entry, not a Full prepared-v2 factory. Construction
 * creates a genuinely scoped repository and rebinds the control/password scope
 * to the new deterministic owner proposal, but does NOT claim a job/resource,
 * activate an epoch, read private sources or run the worker. The DB URL is only
 * held by the lazy Neon client and is never returned in review material. */
export async function createPreparedExpressFirstDeploymentRuntimeV1(input: {
  delivery: ExpressDeliveryInputV1; subscriptionId: string; databaseUrl: string;
}) {
  const url = new URL(input.databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech')) {
    throw Error('EXPRESS_FIRST_DEPLOYMENT_NEON_SOURCE_REQUIRED');
  }
  const source = await prepareExpressSingleTenantDeliveryV1(input.delivery);
  const proposal = await deriveExpressFirstDeploymentV1({ material: source.material, materialSha256: source.materialSha256,
    subscriptionId: input.subscriptionId });
  const delivery = await prepareExpressSingleTenantDeliveryV1({ ...input.delivery,
    scope: { ...input.delivery.scope, ownerDeploymentId: proposal.scope.deploymentId } });
  const repository = new NeonDeploymentExecutionRepository(input.databaseUrl, proposal.scope);
  return Object.freeze({ mode: 'express_first_deployment_prepared_not_activated' as const,
    delivery, repository, scope: proposal.scope, sourceMaterialSha256: source.materialSha256,
    previousFutureDeploymentId: proposal.previousFutureDeploymentId, idempotencyKey: proposal.idempotencyKey,
    blockers: ['fresh_Aurora_identity_catalog_and_empty_business_proof', 'reviewed_atomic_first_claim_and_external_epoch_installation',
      'reviewed_default_store_seed_execution_root', 'reviewed_compute_workload_dns_and_private_source_execution',
      'initialized_reconciliation_and_atomic_ready_writeback'],
    workerStarted: false, jobClaimed: false, databaseOwnershipClaimed: false, epochActivated: false,
    executionAuthorized: false, runtimeEnabled: false });
}
