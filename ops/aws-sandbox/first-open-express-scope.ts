import type { TenantDatabaseLifecyclePort } from "../../lib/deployments/execution/contracts.ts";
import { canonicalJson } from "../../lib/deployments/execution/hash.ts";
import { SANDBOX_FIRST_OPEN as s } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { deriveTenantOwnershipMarker, deriveTenantRuntimeSecretName } from "../../lib/deployments/execution/tenant-database.ts";

export type FirstOpenFenceInput = Parameters<TenantDatabaseLifecyclePort["inspect"]>[0];
export const validOid = (value: unknown): value is string => typeof value === "string" && /^[1-9][0-9]{0,9}$/.test(value) && Number(value) < 2**32;
export function stopFirstOpen(code: string): never {
  const safe = "FIRST_OPEN_EXPRESS_" + code;
  throw Object.assign(Error(safe), { code: safe, retryable: false });
}
export function sameFirstOpenFence({ fence, externalFence: e, signal }: FirstOpenFenceInput) {
  signal.throwIfAborted();
  const id = fence.identity;
  if (id.appInstanceId !== s.instanceId || id.stableIdentityHash !== s.stableIdentity || id.databaseName !== s.tenantDatabase ||
    id.productId !== s.productId || id.environmentId !== s.environmentId || id.cellKey !== "cell-sandbox-1" ||
    id.roleName !== s.tenantRole || fence.ownerDeploymentId !== s.deploymentId || fence.generation !== 1 ||
    fence.schemaVersion !== 1 || e.schemaVersion !== 1 || e.provisionPredecessor !== undefined ||
    deriveTenantRuntimeSecretName(fence) !== s.secretName ||
    fence.ownershipMarker !== deriveTenantOwnershipMarker(id, 1) || e.ownerDeploymentId !== s.deploymentId || e.epoch !== 1 ||
    e.state !== "active" || e.intent !== "provision" || e.marker !== `tl_epoch_${s.stableIdentity.slice(0, 24)}_g1_e1` ||
    !/^[a-f0-9]{64}$/.test(e.operationHash) || canonicalJson(e.resourceFence) !== canonicalJson(fence)) stopFirstOpen("FENCE_CHANGED");
}
