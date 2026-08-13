import type {
  TenantExternalOperationFence,
  TenantExternalOwnershipPort,
  TenantExternalOwnershipProof,
} from "./contracts.ts";

export class TenantExternalOwnershipBoundaryDisabledError extends Error {
  readonly code = "TENANT_EXTERNAL_OWNERSHIP_BOUNDARY_DISABLED";
  readonly retryable = false;

  constructor() {
    super(
      "Tenant external ownership installation and provider observation are not configured.",
    );
  }
}
function assertPendingFence(fence: TenantExternalOperationFence): void {
  if (
    fence.schemaVersion !== 1 ||
    fence.state !== "pending_external" ||
    !Number.isSafeInteger(fence.epoch) ||
    fence.epoch < 1 ||
    fence.ownerDeploymentId !== fence.resourceFence.ownerDeploymentId ||
    !/^[a-f0-9]{64}$/.test(fence.operationHash) ||
    !/^tl_epoch_[a-f0-9]{24}_g[1-9][0-9]*_e[1-9][0-9]*$/.test(fence.marker)
  ) {
    throw Object.assign(
      new Error("Tenant external ownership proof requires an exact pending epoch fence."),
      { code: "TENANT_EXTERNAL_OWNERSHIP_FENCE_INVALID", retryable: false },
    );
  }
}

/**
 * Fail-closed default for the standalone worker. A production implementation
 * must atomically install the epoch marker into every provider resource and
 * re-observe it before returning a reference-only proof.
 */
export class DisabledTenantExternalOwnershipPort
  implements TenantExternalOwnershipPort
{
  async installAndObserve(input: {
    pendingFence: TenantExternalOperationFence;
    signal: AbortSignal;
  }): Promise<TenantExternalOwnershipProof> {
    input.signal.throwIfAborted();
    assertPendingFence(input.pendingFence);
    throw new TenantExternalOwnershipBoundaryDisabledError();
  }
}
