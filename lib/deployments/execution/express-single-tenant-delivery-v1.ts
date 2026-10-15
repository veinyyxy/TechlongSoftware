import type { DeploymentEnvironment } from '../environment.ts';
import type { AwsEcsCellDeploymentPlan } from '../types.ts';
import type { TemplateConfiguration, TemplateConfigurationSchema } from '../../templates/validation.ts';
import { compileProvisioningConfigurationForReview } from '../../templates/provisioning.ts';
import { renderExpressSingleTenantCellV1 } from '../cloudformation/express-single-tenant-cell-v1.ts';
import type { SingleTenantAcceptanceCellInput } from '../cloudformation/single-tenant-acceptance-cell.ts';
import { renderExpressSingleTenantWorkloadV1 } from '../cloudformation/express-single-tenant-workload-v1.ts';
import { parseDatabaseBindingV2, databaseBindingDigestV2, type DatabaseBindingV2 } from './aurora-database-v2.ts';
import { EXPRESS_DELIVERY_IMAGES_V1 } from './express-delivery-images-v1.ts';
import { validateExpressControlReadinessPolicyV1, type ExpressBusinessExpectationV1 } from './express-control-readiness-v1.ts';
import { createExpressFirstOwnerPasswordSourceV2, type ExpressFirstOwnerScopeV2 } from './express-first-owner-password-v2.ts';
import type { FirstOwnerSecretReadonlyPort } from './single-tenant-first-owner-password.ts';
import type { FirstOwnerRuntimeBindingSource } from './single-tenant-control-bindings.ts';
import { ImmutableTemplateSaaSControlPayloadCompiler, type AppInstanceTemplateBindingSource, type ImmutableTemplateVersionSource } from './control-payload.ts';
import { MtlsSaaSControlClient, type SaaSControlTransport, type SaaSControlTokenProvider } from './control-client.ts';
import type { TenantExternalOperationFence, SaaSControlPort, SaaSControlPayloadCompilerPort } from './contracts.ts';
import { assertTenantResourceFence, deriveTenantRuntimeSecretName } from './tenant-database.ts';
import { validateExternalParameter } from './parameters.ts';
import { canonicalJson, sha256Hex } from './hash.ts';
import { clearFirstOwnerPassword } from './control-secret-redaction.ts';

function fail(code: string): never { throw Object.assign(Error(code), { code, retryable: false }); }
function freeze<T>(v: T): T { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
export interface ExpressDeliveryInputV1 {
  scope: ExpressFirstOwnerScopeV2;
  sourcePlan: AwsEcsCellDeploymentPlan;
  sourcePlanSha256: string;
  configuration: TemplateConfiguration;
  configurationSha256: string;
  configurationSchema: TemplateConfigurationSchema;
  environment: DeploymentEnvironment;
  binding: DatabaseBindingV2;
  databaseOid: string;
  roleOid: string;
  tenantHostname: 'first-acceptance.sandbox.techlong.cloud';
}

/** Independent Express composition, not an old Full worker capability.
 * Pure assembly: no credentials, file reads, SQL, Secret value, or network.
 * The physical-name revision is explicit and hashed, never saved over the
 * historical plan. Owner/generation are supplied, never derived from an image.
 */
export async function prepareExpressSingleTenantDeliveryV1(raw: ExpressDeliveryInputV1) {
  const i = structuredClone(raw), s = i.scope, b = parseDatabaseBindingV2(i.binding);
  if (Object.keys(s).sort().join(',') !== 'appInstanceId,cellKey,environmentId,ownerDeploymentId,productId,templateVersionId,workspaceId' ||
      Object.values(s).some(v => typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(v)) ||
      s.environmentId !== 'env_aws_sandbox_ca_central_1' || s.cellKey !== 'cell-sandbox-1' ||
      i.environment.id !== s.environmentId || i.environment.cellKey !== s.cellKey || i.environment.kind !== 'aws_sandbox' ||
      i.environment.expectedAccountId !== '402010193138' || i.environment.region !== 'ca-central-1' ||
      i.environment.status !== 'active' || i.environment.applyEnabled !== false ||
      i.environment.baseDomain !== 'sandbox.techlong.cloud' || i.environment.policy.budgetLimitCents !== 5000 ||
      i.environment.policy.maxTaskCount !== 1 || i.tenantHostname !== 'first-acceptance.sandbox.techlong.cloud' ||
      b.profile !== 'express_iam' || i.configurationSchema.schemaVersion !== 2 ||
      i.configurationSchema.contract !== 'speedfeast-saas-control-v1' ||
      await sha256Hex(i.sourcePlan) !== i.sourcePlanSha256 || await sha256Hex(i.configuration) !== i.configurationSha256) fail('EXPRESS_DELIVERY_SCOPE_REJECTED');
  const stable = await sha256Hex({ appInstanceId: s.appInstanceId, workspaceId: s.workspaceId, productId: s.productId,
    environmentId: s.environmentId, cellKey: s.cellKey });
  const p = i.sourcePlan, cost = p.resources.tenant.costTags;
  if (stable !== b.stableIdentity || p.mode !== 'aws_sandbox' || p.region !== i.environment.region || p.cellKey !== s.cellKey ||
      p.deploymentProfileKey !== 'standard-v1' || p.resources.tenant.database.isolation !== 'tenant_database' ||
      cost.AppInstanceId !== s.appInstanceId || cost.WorkspaceId !== s.workspaceId || cost.ProductId !== s.productId || cost.CellId !== s.cellKey ||
      Object.entries(i.configuration).some(([k, v]) => /password|secret|token|privatekey|credential/i.test(k) ||
        typeof v === 'string' && /-----BEGIN .*PRIVATE KEY|postgres(?:ql)?:\/\/|\b(?:sk|rk)_(?:test|live)_|\bwhsec_/i.test(v))) fail('EXPRESS_DELIVERY_BINDING_REJECTED');
  const compiled = compileProvisioningConfigurationForReview({ schema: i.configurationSchema, configuration: i.configuration }).data;
  if (!compiled || Object.keys(compiled).sort().join(',') !== 'default_store,entitlements,first_owner' ||
      !compiled.first_owner || typeof compiled.first_owner !== 'object' ||
      Object.keys(compiled.first_owner).join(',') !== 'username') fail('EXPRESS_DELIVERY_BUSINESS_REJECTED');
  const business = { entitlements: compiled.entitlements, default_store: compiled.default_store,
    firstOwnerUsername: (compiled.first_owner as { username: string }).username } as ExpressBusinessExpectationV1;
  const policy = validateExpressControlReadinessPolicyV1({ binding: b, databaseOid: i.databaseOid, roleOid: i.roleOid,
    appInstanceId: s.appInstanceId, configurationHash: i.configurationSha256,
    imageRevision: EXPRESS_DELIVERY_IMAGES_V1.app.split('@')[1], business });
  // This new candidate must be separately approved/persisted before enqueue.
  const plan = structuredClone(p);
  plan.resources.tenant.database.databaseName = b.tenantDatabase;
  plan.resources.tenant.database.roleName = b.tenantUsername;
  const material = freeze({ schema: 'techlong/express-single-tenant-delivery/v1' as const,
    scope: s, environment: i.environment, sourcePlan: p, sourcePlanSha256: i.sourcePlanSha256,
    plan, planSha256: await sha256Hex(plan),
    physicalNameRevision: { before: p.resources.tenant.database, after: plan.resources.tenant.database,
      requiresSeparatePersistenceApproval: true, oldPlanPreserved: true },
    configurationSha256: i.configurationSha256, configurationSchemaSha256: await sha256Hex(i.configurationSchema),
    databaseBindingSha256: databaseBindingDigestV2(b), binding: b, databaseOid: i.databaseOid, roleOid: i.roleOid,
    images: EXPRESS_DELIVERY_IMAGES_V1, tenantHostname: i.tenantHostname, controlPolicy: policy,
    lifecycle: { reuseInstalledDatabase: true, runRestoreOrMigration: false, oldPreparedV2ReceiptIssued: false,
      existingActiveDefaultStoreRequiredBeforeProvision: true, createsDefaultStore: false },
    executionAuthorized: false, runtimeEnabled: false, readyVerified: false,
    blockers: ['fresh_exact_compute_cleanup_and_deployment_review', 'actual_database_owner_epoch_adoption_and_scoped_queue',
      'private_sources_read_approval_and_live_control_bindings', 'initialized_effective_configuration_and_ready_writeback'] });
  const materialSha256 = await sha256Hex(material);
  const exactFence = (f: TenantExternalOperationFence) => {
    assertTenantResourceFence(f.resourceFence);
    const r = f.resourceFence, x = r.identity;
    if (f.schemaVersion !== 1 || f.intent !== 'provision' || f.state !== 'active' || f.ownerDeploymentId !== s.ownerDeploymentId ||
        r.ownerDeploymentId !== s.ownerDeploymentId || r.generation !== b.resourceGeneration || x.stableIdentityHash !== stable ||
        x.appInstanceId !== s.appInstanceId || x.workspaceId !== s.workspaceId || x.productId !== s.productId ||
        x.environmentId !== s.environmentId || x.cellKey !== s.cellKey || x.databaseName !== b.tenantDatabase || x.roleName !== b.tenantUsername ||
        !Number.isSafeInteger(f.epoch) || f.epoch < 1 || !/^[a-f0-9]{64}$/.test(f.operationHash) ||
        f.marker !== `tl_epoch_${stable.slice(0, 24)}_g${b.resourceGeneration}_e${f.epoch}` ||
        b.runtimeSecret.arn.slice(0, -7) !== `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${deriveTenantRuntimeSecretName(r)}`) fail('EXPRESS_DELIVERY_FENCE_REJECTED');
  };
  return Object.freeze({ material, materialSha256,
    async renderCell(input: Omit<SingleTenantAcceptanceCellInput, 'environment'>) {
      return renderExpressSingleTenantCellV1({ cell: { ...structuredClone(input), environment: i.environment }, binding: b });
    },
    /** Real Cell readback must supply these six network outputs. This validates
     * values, not their cloud provenance; a later reviewed adapter must reread
     * exact stack UUID/ownership before any write. No placeholder IDs accepted. */
    async renderWorkload(input: { fence: TenantExternalOperationFence; requestedAt: number;
      cellOutputs: Record<string, string>; activeCellCount: number; activeTenantCount: number }) {
      const x = structuredClone(input); exactFence(x.fence);
      const names = ['ClusterName', 'VpcId', 'SubnetIds', 'TaskSecurityGroupId', 'HttpsListenerArn', 'ControlListenerArn'];
      if (Object.keys(x.cellOutputs).sort().join(',') !== names.sort().join(',')) fail('EXPRESS_DELIVERY_CELL_OUTPUTS_REJECTED');
      for (const name of names) validateExternalParameter({ name, value: x.cellOutputs[name], environment: i.environment });
      if (x.cellOutputs.HttpsListenerArn === x.cellOutputs.ControlListenerArn) fail('EXPRESS_DELIVERY_LISTENERS_NOT_SEPARATED');
      const f = x.fence;
      const rendered = await renderExpressSingleTenantWorkloadV1({ binding: b, databaseOid: i.databaseOid, roleOid: i.roleOid,
        configurationHash: i.configurationSha256, workload: { deploymentId: s.ownerDeploymentId, resourceGeneration: b.resourceGeneration,
          externalOperation: { epoch: f.epoch, intent: 'provision', ownerDeploymentId: s.ownerDeploymentId,
            marker: f.marker, operationHash: f.operationHash, state: 'active' },
          runtimeSecretName: deriveTenantRuntimeSecretName(f.resourceFence), runtimeSecretRef: b.runtimeSecret.arn, plan,
          environment: i.environment, imageUri: EXPRESS_DELIVERY_IMAGES_V1.app, tenantHostname: i.tenantHostname,
          listenerPriority: 100, activeCellCount: x.activeCellCount, activeTenantCount: x.activeTenantCount, requestedAt: x.requestedAt } });
      const parameters: Record<string, string> = { ...rendered.parameters, ...x.cellOutputs };
      return freeze({ ...rendered, parameters,
        requiredExternalParameters: rendered.requiredExternalParameters.filter(n => !names.includes(n)) });
    },
    /** Ports are lazy. Calling compiler.compile later reads the precise Secret
     * and calling control.provision writes tenant data; assembly authorizes
     * neither. No old private bundle loader is invoked here. */
    async composeControl(input: { transport: SaaSControlTransport; tokens: SaaSControlTokenProvider;
      bindings: AppInstanceTemplateBindingSource; templateVersions: ImmutableTemplateVersionSource;
      runtimeBindings: FirstOwnerRuntimeBindingSource; sdk: FirstOwnerSecretReadonlyPort; expectedSourceUserId: string }) {
      const passwords = await createExpressFirstOwnerPasswordSourceV2({ scope: s, binding: b,
        bindings: input.runtimeBindings, sdk: input.sdk, expectedSourceUserId: input.expectedSourceUserId });
      const client = new MtlsSaaSControlClient(input.transport, input.tokens, { baseDomain: i.environment.baseDomain, expressReadiness: policy });
      const compiler = new ImmutableTemplateSaaSControlPayloadCompiler({ bindings: input.bindings,
        templateVersions: { async loadById(request) {
          if (request.templateVersionId !== s.templateVersionId) fail('EXPRESS_DELIVERY_TEMPLATE_REJECTED');
          const version = await input.templateVersions.loadById(request);
          request.signal.throwIfAborted();
          if (!version || await sha256Hex(version.configurationSchema) !== material.configurationSchemaSha256) fail('EXPRESS_DELIVERY_TEMPLATE_REJECTED');
          return version;
        } }, firstOwnerPasswords: passwords });
      const check = (request: { hostname: string; appInstanceId: string; externalFence: TenantExternalOperationFence; signal: AbortSignal }) => {
        request.signal.throwIfAborted();
        if (request.hostname !== i.tenantHostname || request.appInstanceId !== s.appInstanceId) fail('EXPRESS_DELIVERY_CONTROL_TARGET_REJECTED');
        exactFence(request.externalFence);
      };
      const control = Object.freeze<SaaSControlPort>({
        waitUntilHealthy(request) { check(request); return client.waitUntilHealthy(request); },
        async provision(request) {
          try { check(request); return await client.provision(request); }
          finally { clearFirstOwnerPassword(request.compiledPayload); }
        },
        readConfiguration(request) { check(request); return client.readConfiguration(request); },
      });
      const scopedCompiler = Object.freeze<SaaSControlPayloadCompilerPort>({ async compile(request) {
        request.signal.throwIfAborted(); exactFence(request.externalFence);
        const c = request.context;
        if (c.deployment.id !== s.ownerDeploymentId || c.deployment.appInstanceId !== s.appInstanceId || c.appInstance.id !== s.appInstanceId ||
            c.appInstance.templateVersionId !== s.templateVersionId || c.appInstance.workspaceId !== s.workspaceId ||
            c.appInstance.productId !== s.productId || c.workspace.id !== s.workspaceId ||
            c.deployment.environmentId !== s.environmentId || canonicalJson(c.environment) !== canonicalJson(i.environment) ||
            c.deployment.artifactRef !== EXPRESS_DELIVERY_IMAGES_V1.app || c.deployment.planHash !== material.planSha256 ||
            await sha256Hex(c.deployment.desiredPlan) !== material.planSha256 ||
            request.configurationHash !== i.configurationSha256 || c.deployment.configurationHash !== i.configurationSha256 ||
            await sha256Hex(c.appInstance.configurationSnapshot) !== i.configurationSha256) fail('EXPRESS_DELIVERY_CONTEXT_REJECTED');
        return compiler.compile(request);
      } });
      return Object.freeze({
        control, compiler: scopedCompiler,
        assertFence: exactFence, executionAuthorized: false, readyWritebackImplemented: false,
      });
    },
  });
}
