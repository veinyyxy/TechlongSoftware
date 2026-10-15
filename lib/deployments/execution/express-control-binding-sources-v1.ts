import type { AcceptanceReadonlySql, FirstOwnerRuntimeBindingSource } from './single-tenant-control-bindings.ts';
import type { AppInstanceTemplateBindingSource, ImmutableTemplateVersionSource } from './control-payload.ts';
import type { prepareExpressSingleTenantDeliveryV1 } from './express-single-tenant-delivery-v1.ts';
import { isExpressDeploymentClaimScopeV1, type ExpressDeploymentClaimScopeV1 } from './express-deployment-scope-v1.ts';
import { validateConfigurationSchema, validateResolvedTemplateConfiguration, type TemplateConfiguration } from '../../templates/validation.ts';
import type { DeploymentExecutionContext, TenantResourceFence } from './contracts.ts';
import { deriveTenantResourceIdentity, deriveTenantOwnershipMarker, deriveTenantRuntimeSecretName } from './tenant-database.ts';
import { sha256Hex } from './hash.ts';

type Material = Awaited<ReturnType<typeof prepareExpressSingleTenantDeliveryV1>>['material'];
function fail(code: string): never { throw Object.assign(Error(code), { code, retryable: false }); }
function object(v: unknown): Record<string, unknown> {
  try { const o = typeof v === 'string' ? JSON.parse(v) : v;
    if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch { /* sanitized below */ }
  return fail('EXPRESS_CONTROL_BINDING_JSON_REJECTED');
}

/** Independent exact live SELECTs, no scope snapshots relabeled as ownership.
 * Assembly does not query. The original Full source/validator is untouched. */
export async function createExpressControlBindingSourcesV1(input: {
  material: Material; materialSha256: string; scope: ExpressDeploymentClaimScopeV1; sql: AcceptanceReadonlySql;
}) {
  const m = structuredClone(input.material), s = input.scope, sql = input.sql;
  if (!isExpressDeploymentClaimScopeV1(s) || await sha256Hex(m) !== input.materialSha256 ||
      s.deploymentId !== m.scope.ownerDeploymentId || s.appInstanceId !== m.scope.appInstanceId || s.environmentId !== m.scope.environmentId ||
      s.planHash !== m.planSha256 || await sha256Hex(m.plan) !== s.planHash || s.configurationHash !== m.configurationSha256 || s.artifactRef !== m.images.app ||
      m.binding.profile !== 'express_iam') fail('EXPRESS_CONTROL_BINDING_SCOPE_REJECTED');
  const identity = await deriveTenantResourceIdentity({ deployment: { appInstanceId: s.appInstanceId, environmentId: s.environmentId, desiredPlan: m.plan },
    appInstance: { id: s.appInstanceId, workspaceId: m.scope.workspaceId, productId: m.scope.productId }, workspace: { id: m.scope.workspaceId },
    environment: m.environment } as DeploymentExecutionContext);
  if (identity.stableIdentityHash !== m.binding.stableIdentity || identity.databaseName !== m.binding.tenantDatabase ||
      identity.roleName !== m.binding.tenantUsername) fail('EXPRESS_CONTROL_BINDING_SCOPE_REJECTED');
  const expected: TenantResourceFence = { schemaVersion: 1, identity, generation: m.binding.resourceGeneration,
    ownerDeploymentId: s.deploymentId, ownershipMarker: deriveTenantOwnershipMarker(identity, m.binding.resourceGeneration) };
  const exact = (r: { appInstanceId?: string; templateVersionId?: string; signal: AbortSignal }) => {
    r.signal.throwIfAborted();
    if (r.appInstanceId !== undefined && r.appInstanceId !== s.appInstanceId || r.templateVersionId !== undefined && r.templateVersionId !== m.scope.templateVersionId)
      fail('EXPRESS_CONTROL_BINDING_TARGET_REJECTED');
  };
  const bindings = Object.freeze<AppInstanceTemplateBindingSource>({ async loadForAppInstance(r) {
    exact(r); const rows = await sql.query(`SELECT a.id,a.template_version_id,a.configuration_snapshot FROM public.app_instances a
      WHERE a.id=$1 AND a.workspace_id=$2 AND a.product_id=$3 AND a.template_version_id=$4`,
    [s.appInstanceId, m.scope.workspaceId, m.scope.productId, m.scope.templateVersionId], r.signal);
    r.signal.throwIfAborted(); if (rows.length !== 1 || rows[0].id !== s.appInstanceId || rows[0].template_version_id !== m.scope.templateVersionId)
      fail('EXPRESS_CONTROL_APP_BINDING_MISSING');
    const configuration = object(rows[0].configuration_snapshot);
    if (await sha256Hex(configuration) !== s.configurationHash) fail('EXPRESS_CONTROL_CONFIGURATION_DRIFT');
    return { appInstanceId: s.appInstanceId, templateVersionId: m.scope.templateVersionId, resolvedConfiguration: configuration as TemplateConfiguration };
  } });
  const templateVersions = Object.freeze<ImmutableTemplateVersionSource>({ async loadById(r) {
    exact(r); const rows = await sql.query('SELECT id,status,configuration_schema FROM public.app_instance_template_versions WHERE id=$1', [m.scope.templateVersionId], r.signal);
    r.signal.throwIfAborted(); const row = rows[0];
    if (rows.length !== 1 || row.id !== m.scope.templateVersionId || !['published', 'archived'].includes(String(row.status))) fail('EXPRESS_CONTROL_TEMPLATE_REJECTED');
    const schema = validateConfigurationSchema(object(row.configuration_schema)).data;
    if (!schema || await sha256Hex(schema) !== m.configurationSchemaSha256) fail('EXPRESS_CONTROL_SCHEMA_DRIFT');
    const app = await bindings.loadForAppInstance({ appInstanceId: s.appInstanceId, signal: r.signal });
    if (!app || !validateResolvedTemplateConfiguration({ schema, configuration: app.resolvedConfiguration }).data) fail('EXPRESS_CONTROL_SCHEMA_DRIFT');
    return { id: m.scope.templateVersionId, status: row.status as 'published' | 'archived', configurationSchema: schema };
  } });
  const runtimeBindings = Object.freeze<FirstOwnerRuntimeBindingSource>({ async load(r) {
    exact(r);
    const rows = await sql.query(`SELECT r.*,o.epoch AS observed_epoch,o.operation_hash AS observed_operation_hash,o.marker AS observed_marker
      FROM public.deployment_tenant_resources r
      JOIN public.app_instance_deployments d ON d.id=r.owner_deployment_id AND d.app_instance_id=r.app_instance_id
      JOIN public.app_instances a ON a.id=r.app_instance_id
      JOIN public.deployment_tenant_external_operations o ON o.app_instance_id=r.app_instance_id AND o.generation=r.generation AND o.epoch=r.external_operation_epoch
      WHERE d.id=$1 AND d.app_instance_id=$2 AND d.environment_id=$3 AND d.plan_hash=$4 AND d.configuration_hash=$5 AND d.artifact_ref=$6
        AND a.template_version_id=$7 AND r.created_by_deployment_id=$1 AND r.owner_deployment_id=$1
        AND r.lifecycle_status='verified' AND r.destroyed_at IS NULL AND r.runtime_secret_ref=$8
        AND o.owner_deployment_id=$1 AND o.intent='provision' AND o.state='active' AND o.stable_identity_hash=r.stable_identity_hash`,
    [s.deploymentId, s.appInstanceId, s.environmentId, s.planHash, s.configurationHash, s.artifactRef, m.scope.templateVersionId, m.binding.runtimeSecret.arn], r.signal);
    r.signal.throwIfAborted(); if (rows.length !== 1) fail('EXPRESS_CONTROL_VERIFIED_GENERATION_REQUIRED');
    const row = rows[0], fields = { app_instance_id: identity.appInstanceId, workspace_id: identity.workspaceId, product_id: identity.productId,
      environment_id: identity.environmentId, cell_key: identity.cellKey, stable_identity_hash: identity.stableIdentityHash,
      database_name: identity.databaseName, role_name: identity.roleName, secret_name: identity.secretName,
      owner_deployment_id: s.deploymentId, created_by_deployment_id: s.deploymentId, ownership_marker: expected.ownershipMarker,
      runtime_secret_ref: m.binding.runtimeSecret.arn, lifecycle_status: 'verified' };
    const epoch = Number(row.observed_epoch);
    if (Object.entries(fields).some(([k, v]) => row[k] !== v) || row.destroyed_at !== null ||
        Number(row.generation) !== expected.generation || !Number.isSafeInteger(epoch) || epoch < 1 || Number(row.external_operation_epoch) !== epoch ||
        !/^[a-f0-9]{64}$/.test(String(row.observed_operation_hash)) || row.observed_marker !== `tl_epoch_${identity.stableIdentityHash.slice(0, 24)}_g${expected.generation}_e${epoch}` ||
        m.binding.runtimeSecret.arn.slice(0, -7) !== `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${deriveTenantRuntimeSecretName(expected)}`)
      fail('EXPRESS_CONTROL_RESOURCE_BINDING_DRIFT');
    return { fence: structuredClone(expected), secretArn: m.binding.runtimeSecret.arn };
  } });
  return Object.freeze({ bindings, templateVersions, runtimeBindings });
}
