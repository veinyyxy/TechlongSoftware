import { loadAcceptancePrivateSources } from './single-tenant-private-loader.ts';
import { validateAcceptanceCredentialBinding, type AcceptanceCredentialBinding } from './single-tenant-private-sources.ts';
import { deriveExpressFirstDeploymentV1 } from './express-deployment-scope-v1.ts';
import type { prepareExpressSingleTenantDeliveryV1 } from './express-single-tenant-delivery-v1.ts';
import type { SaaSControlTokenProvider, SaaSControlTransport } from './control-client.ts';
import { validateExternalParameter } from './parameters.ts';
import { canonicalJson, sha256Hex } from './hash.ts';

type Material = Awaited<ReturnType<typeof prepareExpressSingleTenantDeliveryV1>>['material'];
const plans = new WeakMap<object, string>();
const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function fail(code: string): never { throw Object.assign(Error(code), { code, retryable: false }); }
function freeze<T>(v: T): T { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }

/** Public provenance only. The original Full binding must still validate as
 * Full; the new Express scope does not enter or weaken that validator. */
export async function prepareExpressPrivateControlRebindV1(input: {
  sourceMaterial: Material; sourceMaterialSha256: string; subscriptionId: string;
  historicalBinding: AcceptanceCredentialBinding; historicalSummary: Record<string, unknown>;
  historicalSummarySha256: string;
}) {
  const m = structuredClone(input.sourceMaterial), summary = structuredClone(input.historicalSummary);
  const old = await validateAcceptanceCredentialBinding(input.historicalBinding);
  const proposal = await deriveExpressFirstDeploymentV1({ material: m, materialSha256: input.sourceMaterialSha256,
    subscriptionId: input.subscriptionId });
  if (!sha(input.historicalSummarySha256) || summary.protocol !== 'd001-local-private-inputs' ||
      summary.businessIndependentReadOnlyVerified !== true || summary.runtimeEnabled !== false ||
      summary.bindingSha256 !== await sha256Hex(old) || summary.scopeSha256 !== await sha256Hex(old.scope) ||
      ![summary.publicKeySha256, summary.clientCertificateSha256, summary.clientCaSha256].every(sha) ||
      old.scope.deploymentId !== m.scope.ownerDeploymentId || old.scope.deploymentId === proposal.scope.deploymentId ||
      old.scope.appInstanceId !== m.scope.appInstanceId || old.scope.environmentId !== m.scope.environmentId ||
      old.scope.configurationHash !== m.configurationSha256 || old.workspaceId !== m.scope.workspaceId ||
      old.productId !== m.scope.productId || old.templateVersionId !== m.scope.templateVersionId ||
      canonicalJson(old.plan) !== canonicalJson(m.sourcePlan) || old.scope.planHash !== m.sourcePlanSha256 ||
      canonicalJson(m.physicalNameRevision.before) !== canonicalJson(old.plan.resources.tenant.database)) fail('EXPRESS_PRIVATE_PROVENANCE_REJECTED');
  const revised = structuredClone(old.plan);
  revised.resources.tenant.database.databaseName = m.binding.tenantDatabase;
  revised.resources.tenant.database.roleName = m.binding.tenantUsername;
  if (canonicalJson(revised) !== canonicalJson(m.plan) || await sha256Hex(revised) !== proposal.scope.planHash ||
      canonicalJson(m.physicalNameRevision.after) !== canonicalJson(revised.resources.tenant.database)) fail('EXPRESS_PRIVATE_PLAN_REVISION_REJECTED');
  const targetMaterial = { ...m, scope: { ...m.scope, ownerDeploymentId: proposal.scope.deploymentId } };
  const plan = freeze({ schema: 'techlong/express-private-control-rebind/v1' as const,
    historicalSummarySha256: input.historicalSummarySha256, historicalBindingSha256: await sha256Hex(old),
    historicalScopeSha256: await sha256Hex(old.scope), historicalDeploymentId: old.scope.deploymentId,
    historicalArtifactRef: old.scope.artifactRef, historicalPlanSha256: old.scope.planHash,
    sourceMaterialSha256: input.sourceMaterialSha256, targetMaterialSha256: await sha256Hex(targetMaterial),
    targetScope: proposal.scope, targetScopeSha256: await sha256Hex(proposal.scope),
    environment: m.environment, workspaceId: m.scope.workspaceId, productId: m.scope.productId,
    templateVersionId: m.scope.templateVersionId, tenantHostname: m.tenantHostname,
    databaseBindingSha256: m.databaseBindingSha256, databaseGeneration: m.binding.resourceGeneration,
    publicKeySha256: summary.publicKeySha256 as string, clientCertificateSha256: summary.clientCertificateSha256 as string,
    clientCaSha256: summary.clientCaSha256 as string,
    changes: ['explicit_new_deployment_id', 'published_express_image', 'two_reviewed_physical_database_names'],
    oldBindingAndFilesPreserved: true, secretValuesIncluded: false, ownershipClaimed: false, executionAuthorized: false });
  plans.set(plan, canonicalJson(plan)); return plan;
}
export type ExpressPrivateControlRebindV1 = Awaited<ReturnType<typeof prepareExpressPrivateControlRebindV1>>;
export function assertExpressPrivateControlRebindV1(plan: ExpressPrivateControlRebindV1): void {
  if (!plan || plans.get(plan) !== canonicalJson(plan)) fail('EXPRESS_PRIVATE_VALIDATED_PLAN_REQUIRED');
}

/** Actual private read: requires an external fresh reviewed authorization.
 * The unchanged legacy loader checks original paths, ACL, binding, summary,
 * RSA/mTLS pairs and fingerprints before returning anything. Its payment
 * source is deliberately NOT exposed to the Express caller. */
export async function loadExpressPrivateControlSourcesV1(input: {
  directory: string; plan: ExpressPrivateControlRebindV1;
}, loader: typeof loadAcceptancePrivateSources = loadAcceptancePrivateSources) {
  assertExpressPrivateControlRebindV1(input.plan);
  const p = input.plan;
  let loaded: Awaited<ReturnType<typeof loadAcceptancePrivateSources>> | undefined;
  try {
    loaded = await loader({ directory: input.directory, expectedSummarySha256: p.historicalSummarySha256 });
    if (loaded.summarySha256 !== p.historicalSummarySha256 || loaded.aclVerified !== true ||
        await sha256Hex(loaded.binding) !== p.historicalBindingSha256 ||
        loaded.sources.summary.publicKeySha256 !== p.publicKeySha256 ||
        loaded.sources.summary.clientCertificateSha256 !== p.clientCertificateSha256 ||
        loaded.sources.summary.clientCaSha256 !== p.clientCaSha256) fail('EXPRESS_PRIVATE_LOADED_PROVENANCE_CHANGED');
    const publicParameters = structuredClone(loaded.sources.publicParameters);
    for (const [name, value] of Object.entries(publicParameters)) validateExternalParameter({ name, value, environment: p.environment });
    const sources = loaded.sources;
    let delegate: typeof sources | undefined = sources;
    const tokens = Object.freeze<SaaSControlTokenProvider>({ issue(request) {
      request.signal.throwIfAborted();
      if (!delegate || request.instanceId !== p.targetScope.appInstanceId || request.audience !== `speedfeast-instance:${p.targetScope.appInstanceId}` ||
          request.scope !== 'speedfeast:control') fail('EXPRESS_PRIVATE_TOKEN_SCOPE_REJECTED');
      return delegate.controlTokens.issue(request);
    } });
    const transport = Object.freeze<SaaSControlTransport>({ send(request, context) {
      context.signal.throwIfAborted(); let url;
      try { url = new URL(request.url); } catch { fail('EXPRESS_PRIVATE_CONTROL_ENDPOINT_REJECTED'); }
      if (!delegate || url.protocol !== 'https:' || url.hostname !== p.tenantHostname || url.port !== '8443' || url.username || url.password)
        fail('EXPRESS_PRIVATE_CONTROL_ENDPOINT_REJECTED');
      return delegate.controlTransport.send(request, context);
    } });
    return Object.freeze({ controlTokens: tokens, controlTransport: transport, publicParameters: freeze(publicParameters),
      summary: freeze({ schema: 'techlong/express-private-control-sources/v1' as const,
        targetMaterialSha256: p.targetMaterialSha256, targetScopeSha256: p.targetScopeSha256,
        historicalSummarySha256: p.historicalSummarySha256, historicalBindingSha256: p.historicalBindingSha256,
        publicKeySha256: p.publicKeySha256, clientCertificateSha256: p.clientCertificateSha256, clientCaSha256: p.clientCaSha256,
        oldFilesChanged: false, aclVerified: true, secretValuesIncluded: false, legacyPaymentSourceExposed: false,
        liveOwnerOrEpochProved: false, runtimeEnabled: false }),
      dispose() { if (delegate) { delegate.dispose(); delegate = undefined; } } });
  } catch (e) {
    loaded?.sources.dispose();
    if (e instanceof Error && /^EXPRESS_PRIVATE_[A-Z0-9_]+$/.test(e.message)) throw e;
    fail('EXPRESS_PRIVATE_LOAD_FAILED');
  }
}
