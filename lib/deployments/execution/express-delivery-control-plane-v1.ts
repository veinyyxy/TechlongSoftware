import type { prepareExpressSingleTenantDeliveryV1 } from './express-single-tenant-delivery-v1.ts';
import { EXPRESS_DELIVERY_IMAGES_V1 } from './express-delivery-images-v1.ts';
import { canonicalJson, sha256Hex } from './hash.ts';

type Material = Awaited<ReturnType<typeof prepareExpressSingleTenantDeliveryV1>>['material'];
export const EXPRESS_EPOCH_TABLE_V1 = 'techlong-sandbox-tenant-external-epoch-authority';
export interface ExpressControlPlaneReadonlyPortV1 {
  identity(signal: AbortSignal): Promise<{ Account?: string; Arn?: string; UserId?: string }>;
  authority(key: string, signal: AbortSignal): Promise<Record<string, unknown> | undefined>;
  query(sql: string, values: unknown[], signal: AbortSignal): Promise<Record<string, unknown>[]>;
}
// One read-only Neon statement/snapshot, across the exact tenant and physical
// identity collision coordinates. No customer contact/password data selected.
export const EXPRESS_CONTROL_PLANE_SQL_V1 = `SELECT
 (SELECT jsonb_build_object('id',a.id,'workspaceId',a.workspace_id,'productId',a.product_id,'subscriptionId',a.subscription_id,
   'templateVersionId',a.template_version_id,'status',a.status,'slug',a.slug,'configuration',a.configuration_snapshot::jsonb)
   FROM public.app_instances a WHERE a.id=$1) AS app,
 (SELECT jsonb_build_object('status',s.status,'periodEnd',s.current_period_end,'workspaceId',s.workspace_id,'productId',s.product_id,
   'templateVersionId',s.template_version_id) FROM public.subscriptions s JOIN public.app_instances a ON a.subscription_id=s.id WHERE a.id=$1) AS subscription,
 (SELECT jsonb_build_object('status',w.status) FROM public.workspaces w WHERE w.id=$3) AS workspace,
 (SELECT jsonb_build_object('status',e.status,'applyEnabled',e.apply_enabled,'policy',e.policy::jsonb,
   'admissionState',e.admission_state,'admissionEpoch',e.admission_epoch,'admissionStackId',e.admission_stack_id)
   FROM public.deployment_environments e WHERE e.id=$4) AS environment,
 (SELECT count(*)::int FROM public.app_instance_deployments WHERE app_instance_id=$1) AS deployments,
 (SELECT count(*)::int FROM public.deployment_jobs j JOIN public.app_instance_deployments d ON d.id=j.deployment_id WHERE d.app_instance_id=$1) AS jobs,
 (SELECT count(*)::int FROM public.deployment_tenant_resources WHERE app_instance_id=$1 OR stable_identity_hash=$2
   OR (environment_id=$4 AND (database_name=$5 OR role_name=$6)) OR runtime_secret_ref=$7) AS resources,
 (SELECT count(*)::int FROM public.deployment_tenant_external_operations WHERE app_instance_id=$1 OR stable_identity_hash=$2) AS operations`;

function fail(code: string): never { throw Object.assign(Error(code), { code, retryable: false }); }
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail('EXPRESS_CONTROL_PLANE_ROWS_REJECTED');
  return v as Record<string, unknown>;
}
/** Read-only discovery, NOT an adoption proof. Aurora guards/data have not
 * been read here. Strongly consistent DDB reads and a Neon snapshot are not a
 * cross-service CAS; future writes must repeat fresh checks and conditions. */
export async function inspectExpressDeliveryControlPlaneV1(input: { material: Material; materialSha256: string;
  port: ExpressControlPlaneReadonlyPortV1; signal: AbortSignal; now?: () => number }) {
  const m = structuredClone(input.material), { port, signal } = input, now = input.now ?? Date.now;
  const startedAt = now(); signal.throwIfAborted();
  if (await sha256Hex(m) !== input.materialSha256 || m.binding.profile !== 'express_iam' ||
      canonicalJson(m.images) !== canonicalJson(EXPRESS_DELIVERY_IMAGES_V1) ||
      m.environment.expectedAccountId !== '402010193138' || m.environment.region !== 'ca-central-1' ||
      !/^[a-f0-9]{64}$/.test(m.binding.stableIdentity)) fail('EXPRESS_CONTROL_PLANE_MATERIAL_REJECTED');
  const who = await port.identity(signal); signal.throwIfAborted();
  if (who.Account !== '402010193138' || who.Arn !== 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' ||
      who.UserId !== 'AIDAV3GNMXTZEO7SHLC2X') fail('EXPRESS_CONTROL_PLANE_CALLER_REJECTED');
  const keys = [`tenant:${m.binding.stableIdentity}`, `tenant:aurora-v2:${m.binding.stableIdentity}`];
  const authorities = [];
  for (const key of keys) {
    const item = await port.authority(key, signal); signal.throwIfAborted();
    authorities.push({ key, present: item !== undefined, itemSha256: item === undefined ? null : await sha256Hex(item) });
  }
  const rows = await port.query(EXPRESS_CONTROL_PLANE_SQL_V1,
    [m.scope.appInstanceId, m.binding.stableIdentity, m.scope.workspaceId, m.scope.environmentId,
      m.binding.tenantDatabase, m.binding.tenantUsername, m.binding.runtimeSecret.arn], signal); signal.throwIfAborted();
  if (rows.length !== 1) fail('EXPRESS_CONTROL_PLANE_ROWS_REJECTED');
  const r = rows[0], a = object(r.app), s = object(r.subscription), e = object(r.environment), w = object(r.workspace);
  const configurationSha256 = await sha256Hex(object(a.configuration));
  const counts = Object.fromEntries(['deployments', 'jobs', 'resources', 'operations'].map(k => {
    if (!Number.isSafeInteger(r[k]) || Number(r[k]) < 0) fail('EXPRESS_CONTROL_PLANE_ROWS_REJECTED'); return [k, r[k] as number];
  }));
  const checks = {
    appBinding: a.id === m.scope.appInstanceId && a.workspaceId === m.scope.workspaceId && a.productId === m.scope.productId &&
      a.templateVersionId === m.scope.templateVersionId && a.status === 'pending' && a.slug === 'first-acceptance',
    configurationUnchanged: configurationSha256 === m.configurationSha256,
    subscriptionActive: s.status === 'active' && Number(s.periodEnd) > now() && s.workspaceId === m.scope.workspaceId &&
      s.productId === m.scope.productId && s.templateVersionId === m.scope.templateVersionId,
    workspaceActive: w.status === 'active',
    environmentClosedAndUnclaimed: e.status === 'active' && e.applyEnabled === 0 && e.admissionState === 'open' &&
      Number(e.admissionEpoch) === 0 && e.admissionStackId === null && canonicalJson(e.policy) === canonicalJson(m.environment.policy),
    noPlatformDeploymentOrOwnership: Object.values(counts).every(n => n === 0),
    noLegacyOrAuroraV2Authority: authorities.every(a => !a.present),
  };
  return { schema: 'techlong/express-delivery-control-plane-observation/v1', startedAt, completedAt: now(),
    materialSha256: input.materialSha256, source: { Account: who.Account, Arn: who.Arn, UserId: who.UserId }, authorities, counts, checks,
    configurationSha256, subscriptionId: a.subscriptionId as string,
    outcome: Object.values(checks).every(Boolean) ? 'FIRST_CLAIM_CANDIDATE_AURORA_PROOF_STILL_REQUIRED' : 'DRIFT_OR_EXISTING_OWNER_REQUIRES_REVIEW',
    auroraSqlConnections: 0, sqlBusinessWrites: 0, authorityWrites: 0, ownershipClaimed: false, epochActivated: false,
    oldFutureDeploymentWasOwnershipProof: false, executionAuthorized: false, readyVerified: false };
}
