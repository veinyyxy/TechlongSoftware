import type { SingleDeploymentClaimScope } from './single-deployment-scope.ts';
import type { prepareExpressSingleTenantDeliveryV1 } from './express-single-tenant-delivery-v1.ts';
import { EXPRESS_DELIVERY_IMAGES_V1 } from './express-delivery-images-v1.ts';
import { stableId } from '../../domain/ids.ts';
import { canonicalJson, sha256Hex } from './hash.ts';
import { parseDatabaseBindingV2, databaseBindingDigestV2 } from './aurora-database-v2.ts';

type Material = Awaited<ReturnType<typeof prepareExpressSingleTenantDeliveryV1>>['material'];
declare const expressScope: unique symbol;
export type ExpressDeploymentClaimScopeV1 = Readonly<SingleDeploymentClaimScope> & { readonly [expressScope]: true };
const scopes = new WeakMap<object, string>();
function fail(): never { throw Error('EXPRESS_DEPLOYMENT_SCOPE_REJECTED'); }

/** Queue restriction only, NOT approval, a DB ownership claim, or enablement.
 * The old Full validator continues rejecting this image and serialized copies
 * cannot accidentally enter the new repository path without revalidation. */
export function createExpressDeploymentClaimScopeV1(raw: SingleDeploymentClaimScope): ExpressDeploymentClaimScopeV1 {
  const s = structuredClone(raw);
  if (!s || typeof s !== 'object' || Array.isArray(s) ||
      Object.keys(s).sort().join(',') !== 'appInstanceId,artifactRef,configurationHash,deploymentId,environmentId,planHash' ||
      Object.values(s).some(v => typeof v !== 'string') ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(s.deploymentId) || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(s.appInstanceId) ||
      s.environmentId !== 'env_aws_sandbox_ca_central_1' || !/^[a-f0-9]{64}$/.test(s.planHash) ||
      !/^[a-f0-9]{64}$/.test(s.configurationHash) || s.artifactRef !== EXPRESS_DELIVERY_IMAGES_V1.app) fail();
  const result = Object.freeze(s) as ExpressDeploymentClaimScopeV1;
  scopes.set(result, canonicalJson(result)); return result;
}
export function isExpressDeploymentClaimScopeV1(raw: unknown): raw is ExpressDeploymentClaimScopeV1 {
  return !!raw && typeof raw === 'object' && scopes.get(raw) === canonicalJson(raw);
}

/** Same stable deployment formula as management.ts, with the explicitly revised
 * plan and actual new image. The old D001 futureScope was never a DB owner.
 * This proposes a new first claim, never transfers an existing generation. */
export async function deriveExpressFirstDeploymentV1(input: { material: Material; materialSha256: string; subscriptionId: string }) {
  const m = structuredClone(input.material);
  const b = parseDatabaseBindingV2(m.binding), s = m.scope;
  const stable = await sha256Hex({ appInstanceId: s.appInstanceId, workspaceId: s.workspaceId, productId: s.productId,
    environmentId: s.environmentId, cellKey: s.cellKey });
  if (await sha256Hex(m) !== input.materialSha256 || m.schema !== 'techlong/express-single-tenant-delivery/v1' ||
      await sha256Hex(m.plan) !== m.planSha256 || canonicalJson(m.images) !== canonicalJson(EXPRESS_DELIVERY_IMAGES_V1) ||
      b.profile !== 'express_iam' || stable !== b.stableIdentity || databaseBindingDigestV2(b) !== m.databaseBindingSha256 ||
      m.environment.expectedAccountId !== '402010193138' || m.environment.region !== 'ca-central-1' ||
      m.plan.resources.tenant.database.databaseName !== b.tenantDatabase || m.plan.resources.tenant.database.roleName !== b.tenantUsername ||
      typeof input.subscriptionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(input.subscriptionId)) fail();
  const idempotencyKey = await sha256Hex({ appInstanceId: m.scope.appInstanceId, subscriptionId: input.subscriptionId,
    templateVersionId: m.scope.templateVersionId, driver: 'aws_ecs_cell', workflowVersion: 'v1', deploymentProfileKey: 'standard-v1',
    environmentId: m.scope.environmentId, configurationHash: m.configurationSha256, artifactRef: EXPRESS_DELIVERY_IMAGES_V1.app, planHash: m.planSha256 });
  const scope = createExpressDeploymentClaimScopeV1({ deploymentId: await stableId('dep', idempotencyKey),
    appInstanceId: m.scope.appInstanceId, environmentId: m.scope.environmentId, planHash: m.planSha256,
    configurationHash: m.configurationSha256, artifactRef: EXPRESS_DELIVERY_IMAGES_V1.app });
  return Object.freeze({ scope, idempotencyKey, previousFutureDeploymentId: m.scope.ownerDeploymentId,
    changesExistingOwner: false, firstClaimRequiresFreshAbsenceAndDatabaseProof: true,
    databaseOwnershipClaimed: false, epochActivated: false, enqueueAuthorized: false });
}
