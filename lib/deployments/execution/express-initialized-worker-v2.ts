import { prepareExpressSingleTenantDeliveryV1, type ExpressDeliveryInputV1 } from './express-single-tenant-delivery-v1.ts';
import { EXPRESS_DELIVERY_IMAGES_V2 } from './express-delivery-images-v2.ts';
import { renderExpressSingleTenantWorkloadV1 } from '../cloudformation/express-single-tenant-workload-v1.ts';
import { MtlsSaaSControlClient, type SaaSControlTokenProvider, type SaaSControlTransport } from './control-client.ts';
import { validateExpressControlReadinessPolicyV1 } from './express-control-readiness-v1.ts';
import { assertTenantResourceFence, deriveTenantRuntimeSecretName } from './tenant-database.ts';
import type { TenantExternalOperationFence } from './contracts.ts';
import { validateExternalParameter } from './parameters.ts';
import { sha256Hex } from './hash.ts';

function fail(code: string): never { throw Object.assign(Error('EXPRESS_INITIALIZED_WORKER_' + code), { retryable: false }); }
function freeze<T>(v: T): T { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
export interface ExpressInitializedWorkerInputV2 {
  delivery: ExpressDeliveryInputV1;
  /** Explicit existing store coordinate. Data-only input, NOT live proof. */
  existingDefaultStoreId: string;
}

/** Successor building block for rolling out an already-initialized tenant.
 * Pure composition, not a worker activation or first-claim/replay entry.
 * No provision/compiler/password/Secret-value capability exists in this root.
 * Any future executor must separately admit fresh lease/epoch/approval proof. */
export async function prepareExpressInitializedWorkerV2(raw: ExpressInitializedWorkerInputV2) {
  const i = structuredClone(raw), original = await prepareExpressSingleTenantDeliveryV1(i.delivery), old = original.material;
  if (typeof i.existingDefaultStoreId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(i.existingDefaultStoreId)) fail('STORE_COORDINATE');
  const s = old.scope, b = old.binding, images = EXPRESS_DELIVERY_IMAGES_V2;
  const policy = validateExpressControlReadinessPolicyV1({ ...old.controlPolicy, imageRevision: images.app.split('@')[1] });
  const material = freeze({ schema: 'techlong/express-initialized-worker/v2' as const,
    predecessorMaterialSha256: original.materialSha256, sourcePlanSha256: old.sourcePlanSha256, scope: s,
    sourcePlan: old.sourcePlan, plan: old.plan, planSha256: old.planSha256,
    environment: old.environment, binding: b, databaseOid: old.databaseOid, roleOid: old.roleOid,
    configurationSha256: old.configurationSha256, configurationSchemaSha256: old.configurationSchemaSha256,
    images, controlPolicy: policy, tenantHostname: old.tenantHostname, existingDefaultStoreId: i.existingDefaultStoreId,
    lifecycle: { mode: 'reuse_initialized_only' as const, initializationPostAllowed: false,
      firstOwnerPasswordAllowed: false, secretValueReadAllowed: false, databaseRestoreOrMigrationAllowed: false },
    executionAuthorized: false, runtimeEnabled: false, readyVerified: false,
    blockers: ['reviewed_single_job_runtime_not_wired', 'fresh_lease_epoch_provider_admission_required',
      'fresh_authenticated_initialized_readback_required', 'atomic_job_ready_and_independent_inspect_required'] });
  const materialSha256 = await sha256Hex(material);
  const exactFence = (f: TenantExternalOperationFence) => {
    assertTenantResourceFence(f.resourceFence);
    const r = f.resourceFence, x = r.identity;
    if (f.schemaVersion !== 1 || f.intent !== 'provision' || f.state !== 'active' || f.ownerDeploymentId !== s.ownerDeploymentId ||
      r.ownerDeploymentId !== s.ownerDeploymentId || r.generation !== b.resourceGeneration || x.stableIdentityHash !== b.stableIdentity ||
      x.appInstanceId !== s.appInstanceId || x.workspaceId !== s.workspaceId || x.productId !== s.productId ||
      x.environmentId !== s.environmentId || x.cellKey !== s.cellKey || x.databaseName !== b.tenantDatabase || x.roleName !== b.tenantUsername ||
      !Number.isSafeInteger(f.epoch) || f.epoch < 1 || !/^[a-f0-9]{64}$/.test(f.operationHash) ||
      f.marker !== `tl_epoch_${b.stableIdentity.slice(0, 24)}_g${b.resourceGeneration}_e${f.epoch}` ||
      b.runtimeSecret.arn.slice(0, -7) !== `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${deriveTenantRuntimeSecretName(r)}`) fail('FENCE');
  };
  return Object.freeze({ material, materialSha256,
    async renderWorkload(input: { fence: TenantExternalOperationFence; requestedAt: number;
      cellOutputs: Record<string, string>; activeCellCount: number; activeTenantCount: number }) {
      const x = structuredClone(input); exactFence(x.fence);
      const names = ['ClusterName', 'VpcId', 'SubnetIds', 'TaskSecurityGroupId', 'HttpsListenerArn', 'ControlListenerArn'];
      if (Object.keys(x.cellOutputs).sort().join(',') !== names.sort().join(',')) fail('CELL_OUTPUTS');
      for (const name of names) validateExternalParameter({ name, value: x.cellOutputs[name], environment: old.environment });
      if (x.cellOutputs.HttpsListenerArn === x.cellOutputs.ControlListenerArn) fail('LISTENER_SEPARATION');
      const f = x.fence;
      const rendered = await renderExpressSingleTenantWorkloadV1({ binding: b, databaseOid: old.databaseOid, roleOid: old.roleOid,
        configurationHash: old.configurationSha256, workload: { deploymentId: s.ownerDeploymentId, resourceGeneration: b.resourceGeneration,
          externalOperation: { epoch: f.epoch, intent: 'provision', ownerDeploymentId: s.ownerDeploymentId,
            marker: f.marker, operationHash: f.operationHash, state: 'active' },
          runtimeSecretName: deriveTenantRuntimeSecretName(f.resourceFence), runtimeSecretRef: b.runtimeSecret.arn,
          plan: old.plan, environment: old.environment, imageUri: images.app, tenantHostname: old.tenantHostname,
          listenerPriority: 100, activeCellCount: x.activeCellCount, activeTenantCount: x.activeTenantCount, requestedAt: x.requestedAt } });
      const parameters: Record<string, string> = { ...rendered.parameters, ...x.cellOutputs };
      return freeze({ ...rendered, parameters,
        requiredExternalParameters: rendered.requiredExternalParameters.filter(k => !names.includes(k)),
        initializedWorkerMaterialSha256: materialSha256, initializationPostAllowed: false });
    },
    /** Lazy authenticated GET-only client. Constructing it loads no token or
     * private material; invoking it still requires separately approved sources.
     * No fallback to provision on 404, uninitialized, timeout or config drift. */
    composeInitializedReadback(input: { transport: SaaSControlTransport; tokens: SaaSControlTokenProvider }) {
      const client = new MtlsSaaSControlClient({ async send(request, options) {
        const url = new URL(request.url);
        if (request.method !== 'GET' || request.body !== undefined || url.protocol !== 'https:' || url.port !== '8443' ||
            url.hostname !== old.tenantHostname || url.username || url.password || url.search || url.hash ||
            !['/api/saas/readiness', '/api/saas/control'].includes(url.pathname)) fail('READONLY_TRANSPORT');
        const response = await input.transport.send(request, options);
        if (url.pathname === '/api/saas/control' && response.status === 200) {
          const body = response.body as { control?: { stores?: { store_id?: unknown }[] } };
          if (!body || !Array.isArray(body.control?.stores) || body.control.stores.length !== 1 ||
              body.control.stores[0]?.store_id !== i.existingDefaultStoreId) fail('EXACT_STORE_READBACK');
        }
        return response;
      } }, input.tokens, { baseDomain: old.environment.baseDomain, expressReadiness: policy });
      return Object.freeze({ async readConfiguration(request: { externalFence: TenantExternalOperationFence; signal: AbortSignal }) {
        request.signal.throwIfAborted(); const externalFence = freeze(structuredClone(request.externalFence)); exactFence(externalFence);
        return client.readConfiguration({ externalFence, signal: request.signal, appInstanceId: s.appInstanceId, hostname: old.tenantHostname });
      }, initializationPostAllowed: false as const, executionAuthorized: false as const });
    },
  });
}
