import { canonicalJson, sha256Hex } from "./hash.ts";
import { assertTenantResourceFence, TenantDatabaseLifecycleError } from "./tenant-database.ts";
import type { TenantResourceFence } from "./contracts.ts";
import type { EcsOneShotTaskRequest, TenantDatabaseOneShotOperation } from "./ecs-one-shot-task.ts";

export type TenantLifecycleProtocol = "legacy_v1" | "prepared_v2";
export const preparedBaselinePins = Object.freeze({
  archiveSha256: "1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a",
  manifestSha256: "62b5dc8cadcf276df140be86e002a08b64d9b713bd0257e14ac515c12a996971",
});
// Keep this module independent of the runner's runtime initialization.
const operations: readonly TenantDatabaseOneShotOperation[] = ["inspect", "prepare_empty_database",
  "restore_approved_baseline", "migrate_saas", "verify", "destroy"];
export const preparedAuthorityEnvironmentKeys = Object.freeze([
  "TENANT_EXTERNAL_AUTHORITY_KEY", "TENANT_RESOURCE_IDENTITY_JSON", "TENANT_OWNER_DEPLOYMENT_ID",
  "TENANT_DATABASE_NAME", "TENANT_DATABASE_ROLE_NAME",
]);

export function assertLifecycleProtocol(protocol: TenantLifecycleProtocol | undefined,
  receiptSchemaVersion: 1 | 2 | undefined): TenantLifecycleProtocol {
  const selected = protocol ?? "legacy_v1";
  if (!["legacy_v1", "prepared_v2"].includes(selected) ||
    (receiptSchemaVersion ?? 1) !== (selected === "prepared_v2" ? 2 : 1)) {
    throw new TenantDatabaseLifecycleError("TENANT_ONE_SHOT_PROTOCOL_INVALID",
      "The explicit lifecycle protocol and raw receipt schema must agree.");
  }
  return selected;
}

// Distinct contract: Fargate already launches Node + the prepared entrypoint.
// Passing the legacy full Node/script vector as CMD would be a protocol error.
export const preparedLifecycleEntrypoint = Object.freeze([
  "/usr/local/bin/node", "db/tenant_lifecycle_prepared.js",
]);
export const preparedLifecycleCommands = Object.freeze(Object.fromEntries(
  operations.map(operation => [operation, Object.freeze([operation])]),
)) as Readonly<Record<TenantDatabaseOneShotOperation, readonly string[]>>;
export const preparedLifecycleRuntimeMode = "aws_sandbox_tenant_lifecycle_prepared_v2";
export const preparedLifecycleActivationKey = "runtime:cell-sandbox-1:lifecycle-v2";

/** Compiles non-secret intent only. Does not launch a task, install authority,
 * change legacy command allowlists or grant readiness. The production runner
 * must select this protocol explicitly after reviewed live registration. */
export async function compilePreparedLifecycleAuthorityEnvironment(fence: TenantResourceFence) {
  assertTenantResourceFence(fence);
  if (typeof fence.ownerDeploymentId !== "string" || !fence.ownerDeploymentId ||
    fence.ownerDeploymentId.length > 128 || /[\r\n\0]/.test(fence.ownerDeploymentId)) {
    throw new TenantDatabaseLifecycleError("TENANT_PREPARED_IDENTITY_INVALID", "Prepared owner is invalid.");
  }
  const identity = structuredClone(fence.identity);
  const ownership = { appInstanceId: identity.appInstanceId, workspaceId: identity.workspaceId,
    productId: identity.productId, environmentId: identity.environmentId, cellKey: identity.cellKey };
  const database = /^tenant_([a-z0-9]{1,16})_db$/.exec(identity.databaseName);
  const role = /^tenant_([a-z0-9]{1,16})_role$/.exec(identity.roleName);
  if (Object.values(ownership).some(value => typeof value !== "string" || !value ||
    value.length > 128 || /[\r\n\0]/.test(value)) || !database || !role || database[1] !== role[1]) {
    throw new TenantDatabaseLifecycleError("TENANT_PREPARED_IDENTITY_INVALID", "Prepared tenant names or ownership are invalid.");
  }
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
    TENANT_DATABASE_NAME: identity.databaseName,
    TENANT_DATABASE_ROLE_NAME: identity.roleName,
  });
}

/** Revalidates the complete non-secret wire identity at the SDK boundary. */
export async function assertPreparedLifecycleRequestIdentity(request: EcsOneShotTaskRequest): Promise<void> {
  const env = request.container.environment;
  try {
    if (typeof env.TENANT_RESOURCE_IDENTITY_JSON !== "string" ||
      env.TENANT_RESOURCE_IDENTITY_JSON.length > 4096) throw new Error("identity");
    const identity = JSON.parse(env.TENANT_RESOURCE_IDENTITY_JSON);
    const keys = ["schemaVersion", "appInstanceId", "workspaceId", "productId", "environmentId", "cellKey",
      "databaseName", "roleName", "secretName", "stableIdentityHash"];
    if (!identity || Array.isArray(identity) ||
      canonicalJson(Object.keys(identity).sort()) !== canonicalJson(keys.sort())) throw new Error("keys");
    const compiled = await compilePreparedLifecycleAuthorityEnvironment({ schemaVersion: 1,
      identity, generation: Number(env.TENANT_RESOURCE_GENERATION),
      ownershipMarker: env.TENANT_OWNERSHIP_MARKER, ownerDeploymentId: env.TENANT_OWNER_DEPLOYMENT_ID! });
    if (preparedAuthorityEnvironmentKeys.some(key => env[key as keyof typeof env] !== compiled[key as keyof typeof compiled]) ||
      !env.TENANT_RUNTIME_SECRET_ARN.startsWith(
        `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${identity.secretName}/g${env.TENANT_RESOURCE_GENERATION}-`) ||
      !env.TENANT_EXTERNAL_OPERATION_MARKER.startsWith(`tl_epoch_${identity.stableIdentityHash.slice(0, 24)}_`)) {
      throw new Error("binding");
    }
  } catch {
    throw new TenantDatabaseLifecycleError("TENANT_PREPARED_IDENTITY_INVALID",
      "Prepared request must bind the canonical full tenant identity, owner, and generation Secret.");
  }
}
