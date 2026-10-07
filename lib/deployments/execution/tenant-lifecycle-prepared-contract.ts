import { canonicalJson, sha256Hex } from "./hash.ts";
import { assertTenantResourceFence, TenantDatabaseLifecycleError } from "./tenant-database.ts";
import type { TenantResourceFence } from "./contracts.ts";
import { tenantDatabaseOneShotOperations, type TenantDatabaseOneShotOperation } from "./ecs-one-shot-task.ts";

// Distinct contract: Fargate already launches Node + the prepared entrypoint.
// Passing the legacy full Node/script vector as CMD would be a protocol error.
export const preparedLifecycleEntrypoint = Object.freeze([
  "/usr/local/bin/node", "db/tenant_lifecycle_prepared.js",
]);
export const preparedLifecycleCommands = Object.freeze(Object.fromEntries(
  tenantDatabaseOneShotOperations.map(operation => [operation, Object.freeze([operation])]),
)) as Readonly<Record<TenantDatabaseOneShotOperation, readonly string[]>>;
export const preparedLifecycleRuntimeMode = "aws_sandbox_tenant_lifecycle_prepared_v2";
export const preparedLifecycleActivationKey = "runtime:cell-sandbox-1:lifecycle-v2";

/** Compiles non-secret intent only. Does not launch a task, install authority,
 * change legacy command allowlists or grant readiness. The production runner
 * must select this protocol explicitly after reviewed live registration. */
export async function compilePreparedLifecycleAuthorityEnvironment(fence: TenantResourceFence) {
  assertTenantResourceFence(fence);
  const identity = structuredClone(fence.identity);
  const ownership = { appInstanceId: identity.appInstanceId, workspaceId: identity.workspaceId,
    productId: identity.productId, environmentId: identity.environmentId, cellKey: identity.cellKey };
  const hash = await sha256Hex(ownership);
  const stem = identity.appInstanceId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-28) || "pending";
  if (identity.stableIdentityHash !== hash || identity.cellKey !== "cell-sandbox-1" ||
    identity.secretName !== `techlong/sandbox/tenant/${stem}_${hash.slice(0, 10)}/runtime`) {
    throw new TenantDatabaseLifecycleError("TENANT_PREPARED_IDENTITY_INVALID",
      "Prepared authority identity must recompute from the exact immutable ownership preimage.");
  }
  return Object.freeze({
    TENANT_EXTERNAL_AUTHORITY_KEY: `tenant:${hash}`,
    TENANT_RESOURCE_IDENTITY_JSON: canonicalJson(identity),
    TENANT_OWNER_DEPLOYMENT_ID: fence.ownerDeploymentId,
  });
}
