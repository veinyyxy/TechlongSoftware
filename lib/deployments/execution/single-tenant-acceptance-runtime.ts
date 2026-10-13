import { createPreparedDeploymentWorkerRuntime, type PreparedWorkerRuntimeInput } from "./prepared-runtime-composition.ts";
import { createSingleTenantWorkloadStrategy, type SupervisedCleanupReadinessPort } from "./single-tenant-workload-strategy.ts";
import { validateSingleDeploymentScope, type SingleDeploymentClaimScope } from "./single-deployment-scope.ts";
import { NeonDeploymentExecutionRepository } from "./neon-repository.ts";
import { SupervisedTenantWorkloadCleanup } from "./supervised-tenant-workload-cleanup.ts";

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
