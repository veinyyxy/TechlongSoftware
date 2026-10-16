import { createExpressDeploymentClaimScopeV1 } from '../../../lib/deployments/execution/express-deployment-scope-v1.ts';
import { createExpressControlBindingSourcesV1 } from '../../../lib/deployments/execution/express-control-binding-sources-v1.ts';
import { createAcceptanceReadonlyNeonSql } from '../../../lib/deployments/execution/single-tenant-control-bindings.ts';
import { loadExpressPrivateControlSourcesV1 } from '../../../lib/deployments/execution/express-private-control-v1.ts';
import { createExpressFirstOwnerPasswordSourceV2 } from '../../../lib/deployments/execution/express-first-owner-password-v2.ts';
import { compileProvisioningConfiguration } from '../../../lib/templates/provisioning.ts';
import { MtlsSaaSControlClient } from '../../../lib/deployments/execution/control-client.ts';
import { validateExpressControlReadinessPolicyV1 } from '../../../lib/deployments/execution/express-control-readiness-v1.ts';
import { clearFirstOwnerPassword } from '../../../lib/deployments/execution/control-secret-redaction.ts';
import { B, hash, must, guardedControlTransport } from './express-initialization-recovery-plan-v1.mjs';
export { clearFirstOwnerPassword };

/** Independent live app/template/generation SELECTs still validate the ACTUAL
 * persisted old artifact. The new manual payload explicitly records the new
 * runtime image, not a fictitious updated worker/repository context. */
export async function compileManualRecoveryPayload({ plan, material, bindingSources, passwords, signal }) {
  signal.throwIfAborted();
  const app = await bindingSources.bindings.loadForAppInstance({ appInstanceId: plan.historicalScope.appInstanceId, signal });
  must(app?.templateVersionId === material.scope.templateVersionId && hash(app.resolvedConfiguration) === plan.historicalScope.configurationHash, 'COMPILER_APP_DRIFT');
  const version = await bindingSources.templateVersions.loadById({ templateVersionId: material.scope.templateVersionId, signal });
  must(version?.id === app.templateVersionId && ['published', 'archived'].includes(version.status) &&
    hash(version.configurationSchema) === material.configurationSchemaSha256, 'COMPILER_TEMPLATE_DRIFT');
  const lease = await passwords.lease({ appInstanceId: app.appInstanceId, templateVersionId: app.templateVersionId, signal });
  try {
    const password = lease.read(); must(typeof password === 'string' && password.length >= 10 && password.length <= 256, 'PASSWORD_CONTRACT');
    const result = compileProvisioningConfiguration({ schema: version.configurationSchema, configuration: app.resolvedConfiguration,
      runtimeSecrets: { firstOwnerPassword: password } });
    signal.throwIfAborted(); must(result.data && result.data.first_owner && result.data.default_store && result.data.entitlements, 'COMPILER_REJECTED');
    const f = plan.externalFence;
    return { instance: { external_instance_id: app.appInstanceId, metadata: {
      configuration_hash: plan.historicalScope.configurationHash, template_version_id: app.templateVersionId,
      image_revision: plan.controlPolicy.imageRevision, external_operation_epoch: f.epoch, external_operation_intent: f.intent,
      external_operation_marker: f.marker, external_operation_hash: f.operationHash } },
    entitlements: result.data.entitlements, default_store: result.data.default_store, first_owner: result.data.first_owner };
  } finally { lease.dispose(); }
}

export async function openManualRecoveryControl({ input, plan, mode, databaseUrl, sdk, beforePost }) {
  const m = structuredClone(input.publicInputs.source.material); m.scope.ownerDeploymentId = plan.historicalScope.deploymentId;
  must(hash(m) === B.sourceMaterialSha && hash(plan.controlPolicy) === hash({ ...m.controlPolicy, imageRevision: plan.controlPolicy.imageRevision }), 'CONTROL_SOURCE_BINDING');
  validateExpressControlReadinessPolicyV1(plan.controlPolicy);
  const sources = await loadExpressPrivateControlSourcesV1({ directory: B.privateDirectory, plan: input.publicInputs.privatePlan });
  try {
    must(hash(sources.publicParameters) === plan.publicParametersSha256, 'PRIVATE_PUBLIC_PARAMETERS_DRIFT');
    const guarded = guardedControlTransport({ plan, delegate: sources.controlTransport, mode, beforePost });
    const client = new MtlsSaaSControlClient(guarded.transport, sources.controlTokens,
      { baseDomain: m.environment.baseDomain, expressReadiness: plan.controlPolicy });
    let compiled = false;
    return { control: client, httpCounts: guarded.counts,
      async compile(signal) {
        must(mode === 'Run' && !compiled, 'COMPILE_LIMIT'); compiled = true;
        const bindingSources = await createExpressControlBindingSourcesV1({ material: m, materialSha256: hash(m),
          scope: createExpressDeploymentClaimScopeV1(plan.historicalScope), sql: createAcceptanceReadonlyNeonSql(databaseUrl) });
        const passwords = await createExpressFirstOwnerPasswordSourceV2({ scope: m.scope, binding: m.binding,
          bindings: bindingSources.runtimeBindings, sdk, expectedSourceUserId: 'AIDAV3GNMXTZEO7SHLC2X' });
        return compileManualRecoveryPayload({ plan, material: m, bindingSources, passwords, signal });
      }, dispose: () => sources.dispose() };
  } catch { sources.dispose(); throw Error('INITIALIZATION_RECOVERY_CONTROL_OPEN_FAILED'); }
}
