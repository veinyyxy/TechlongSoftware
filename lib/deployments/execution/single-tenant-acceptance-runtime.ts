import { createPreparedDeploymentWorkerRuntime, type PreparedWorkerRuntimeInput } from "./prepared-runtime-composition.ts";
import { createSingleTenantWorkloadStrategy, type SupervisedCleanupReadinessPort } from "./single-tenant-workload-strategy.ts";
import { validateSingleDeploymentScope, type SingleDeploymentClaimScope } from "./single-deployment-scope.ts";
import { NeonDeploymentExecutionRepository } from "./neon-repository.ts";
import { SupervisedTenantWorkloadCleanup } from "./supervised-tenant-workload-cleanup.ts";
import { loadAcceptancePrivateSources } from "./single-tenant-private-loader.ts";
import { createAcceptanceControlBindingSources, createAcceptanceReadonlyNeonSql } from "./single-tenant-control-bindings.ts";
import { createAcceptanceFirstOwnerPasswordSource, createAcceptanceFirstOwnerSdkPort } from "./single-tenant-first-owner-password.ts";
import { ImmutableTemplateSaaSControlPayloadCompiler } from "./control-payload.ts";
import { ACCEPTANCE_CONTROL_INPUTS } from "./single-tenant-private-sources.ts";
import { canonicalJson } from "./hash.ts";

/** Explicit first-acceptance composition. Reuses real Secret/database/epoch,
 * ordered cleanup and mTLS/control adapters, but installs the independent
 * supervised workload strategy instead of pretending Scheduler is installed.
 * No construction-time API call, task claim or enablement flag is accepted.
 * Actual live activation still needs reviewed business/Cell/permission proof.
 */
export async function createPreparedSingleTenantAcceptanceRuntime(input: Omit<PreparedWorkerRuntimeInput, "repository"> & {
  databaseUrl: string;
  scope: SingleDeploymentClaimScope;
  cleanupReadiness: SupervisedCleanupReadinessPort;
}) {
  const scope = validateSingleDeploymentScope(input.scope);
  const tenantWorkloadStrategy = createSingleTenantWorkloadStrategy({ scope, cleanupReadiness: input.cleanupReadiness });
  const repository = new NeonDeploymentExecutionRepository(input.databaseUrl, scope);
  const tenantWorkloadLifecycle = new SupervisedTenantWorkloadCleanup({ aws: input.aws, config: input.workloadConfig,
    reader: { read: i => repository.readSupervisedTenantStackId(i) } });
  const prepared = await createPreparedDeploymentWorkerRuntime({ ...input, repository, tenantWorkloadLifecycle });
  return Object.freeze({ ...prepared, mode: "single_tenant_prepared_not_activated" as const, scope, repository,
    tenantWorkloadStrategy, automaticCleanupInstalled: false,
    blockers: ["actual_business_scope_and_signing_inputs_missing", "cell_creation_and_exact_cleanup_permissions_missing",
      "independent_supervised_cleanup_readiness_verifier_missing", "reviewed_live_activation_missing"] as const });
}

/** Concrete local private-input wiring for D001, still NOT a live root.
 * No credentials read from AWS, Neon SELECT or control request on assembly.
 * Cell outputs, task revision and authority must come from separately proved
 * real resources before this prepared capability can be activated elsewhere.
 */
export async function createPreparedPrivateSingleTenantAcceptanceRuntime(input:
  Omit<Parameters<typeof createPreparedSingleTenantAcceptanceRuntime>[0],
    "paymentCredentials" | "controlTransport" | "controlTokens" | "controlPayloadCompiler" | "controlEndpoint"> & {
      credentialsDirectory: string; credentialsSummarySha256: string; expectedProvisionerRoleId: string;
    }) {
  const loaded = await loadAcceptancePrivateSources({ directory: input.credentialsDirectory, expectedSummarySha256: input.credentialsSummarySha256 });
  const { sources, binding } = loaded;
  try {
    if (canonicalJson(validateSingleDeploymentScope(input.scope)) !== canonicalJson(binding.scope))
      throw Object.assign(Error("ACCEPTANCE_PRIVATE_RUNTIME_SCOPE_REJECTED"), { code: "ACCEPTANCE_PRIVATE_RUNTIME_SCOPE_REJECTED", retryable: false });
    const control = await createAcceptanceControlBindingSources(binding, createAcceptanceReadonlyNeonSql(input.databaseUrl));
    const firstOwnerPasswords = await createAcceptanceFirstOwnerPasswordSource({ binding, bindings: control.runtimeBindings,
      sdk: await createAcceptanceFirstOwnerSdkPort(), expectedProvisionerRoleId: input.expectedProvisionerRoleId });
    const runtime = await createPreparedSingleTenantAcceptanceRuntime({ ...input, paymentCredentials: sources.paymentCredentials,
      controlTokens: sources.controlTokens, controlTransport: sources.controlTransport,
      controlEndpoint: { baseDomain: ACCEPTANCE_CONTROL_INPUTS.baseDomain },
      controlPayloadCompiler: new ImmutableTemplateSaaSControlPayloadCompiler({ ...control, firstOwnerPasswords }) });
    return Object.freeze({ ...runtime, privateInputSourcesPrepared: true, privateInputSummary: sources.summary,
      publicParameters: sources.publicParameters, disposePrivateInputs: sources.dispose,
      blockers: ["actual_cell_outputs_task_revision_authority_and_permissions_missing",
        "independent_supervised_cleanup_readiness_verifier_missing", "reviewed_live_activation_missing"] as const });
  } catch (e) { sources.dispose(); throw e; }
}
