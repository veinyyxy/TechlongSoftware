import { DisabledSaaSControlClient } from "./control-client.ts";
import { DisabledSaaSControlPayloadCompiler } from "./control-payload.ts";
import { DisabledSharedCellSecurityPreflight } from "./shared-cell-preflight.ts";
import { DisabledTenantDatabasePort } from "./tenant-database.ts";
import type { DeploymentWorkerDependencies } from "./worker.ts";

export const DEFAULT_DISABLED_RUNTIME_BLOCKERS = Object.freeze([
  "live_runtime_enablement_not_implemented",
  "tenant_runtime_provider_root_wiring_missing",
  "tenant_lifecycle_task_definition_live_readback_missing",
  "fenced_cleanup_provider_root_wiring_missing",
  "shared_cell_live_preflight_root_wiring_missing",
  "saas_control_credentials_root_wiring_missing",
] as const);

export type DefaultDisabledRuntimeBlocker =
  (typeof DEFAULT_DISABLED_RUNTIME_BLOCKERS)[number];

export type DefaultDisabledWorkerRuntime = Readonly<
  Pick<
    DeploymentWorkerDependencies,
    | "applyRuntimeReady"
    | "cleanupRuntimeReady"
    | "sharedCellSecurityPreflight"
    | "tenantDatabase"
    | "controlClient"
    | "controlPayloadCompiler"
  > & {
    mode: "offline_only";
    blockers: readonly DefaultDisabledRuntimeBlocker[];
  }
>;

/**
 * The standalone Worker has one deliberately boring root composition until a
 * separately reviewed live composition exists. SDK-backed adapter source code
 * may be present in the repository, but this factory never wires it and never
 * exposes an apply, cleanup, or ownership-coordinator capability.
 */
export function createDefaultDisabledWorkerRuntime(): DefaultDisabledWorkerRuntime {
  return Object.freeze({
    mode: "offline_only" as const,
    blockers: DEFAULT_DISABLED_RUNTIME_BLOCKERS,
    applyRuntimeReady: false as const,
    cleanupRuntimeReady: false as const,
    sharedCellSecurityPreflight: new DisabledSharedCellSecurityPreflight(),
    tenantDatabase: new DisabledTenantDatabasePort(),
    controlClient: new DisabledSaaSControlClient(),
    controlPayloadCompiler: new DisabledSaaSControlPayloadCompiler(),
  });
}
