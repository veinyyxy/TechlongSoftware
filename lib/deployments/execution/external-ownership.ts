import type {
  TenantExternalOperationFence,
  TenantExternalOwnershipPort,
  TenantExternalOwnershipProof,
  TenantProvisionPredecessor,
  TenantResourceFence,
} from "./contracts.ts";
import { canonicalJson } from "./hash.ts";

const digestPattern = /^[a-f0-9]{64}$/;
const predecessorKeys = [
  "schemaVersion",
  "generation",
  "epoch",
  "intent",
  "ownerDeploymentId",
  "operationHash",
  "marker",
] as const;

function fail(code: string, message: string): Error {
  return Object.assign(new Error(message), { code, retryable: false });
}

/**
 * Validates the immutable provision coordinate before any destructive adapter
 * can be called. The coordinate must be older than, and in the same resource
 * generation as, the active cleanup epoch.
 */
export function assertTenantProvisionPredecessor(
  value: unknown,
  resourceFence: TenantResourceFence,
  cleanupEpoch: number,
  expected?: TenantProvisionPredecessor,
): asserts value is TenantProvisionPredecessor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw fail(
      "TENANT_CLEANUP_PROVISION_PREDECESSOR_INVALID",
      "Tenant cleanup requires an authority-derived provision predecessor.",
    );
  }
  const predecessor = value as TenantProvisionPredecessor;
  if (
    canonicalJson(Object.keys(predecessor).sort()) !==
      canonicalJson([...predecessorKeys].sort()) ||
    predecessor.schemaVersion !== 1 ||
    predecessor.intent !== "provision" ||
    !Number.isSafeInteger(predecessor.generation) ||
    predecessor.generation !== resourceFence.generation ||
    !Number.isSafeInteger(predecessor.epoch) ||
    predecessor.epoch < 1 ||
    predecessor.epoch >= cleanupEpoch ||
    predecessor.ownerDeploymentId !== resourceFence.ownerDeploymentId ||
    !digestPattern.test(predecessor.operationHash) ||
    predecessor.marker !==
      `tl_epoch_${resourceFence.identity.stableIdentityHash.slice(0, 24)}` +
        `_g${resourceFence.generation}_e${predecessor.epoch}` ||
    (expected !== undefined &&
      canonicalJson(predecessor) !== canonicalJson(expected))
  ) {
    throw fail(
      "TENANT_CLEANUP_PROVISION_PREDECESSOR_INVALID",
      "Tenant cleanup provision predecessor is stale, drifting, or belongs to another generation.",
    );
  }
}

export function requireActiveCleanupProvisionPredecessor(
  externalFence: TenantExternalOperationFence,
  expected?: TenantProvisionPredecessor,
): TenantProvisionPredecessor {
  if (
    externalFence.intent !== "cleanup" ||
    externalFence.state !== "active"
  ) {
    throw fail(
      "TENANT_CLEANUP_EXTERNAL_EPOCH_INVALID",
      "Tenant cleanup requires the exact active cleanup epoch.",
    );
  }
  assertTenantProvisionPredecessor(
    externalFence.provisionPredecessor,
    externalFence.resourceFence,
    externalFence.epoch,
    expected,
  );
  return externalFence.provisionPredecessor;
}

/** Extracts only the hash-bound, authority-derived cleanup predecessor. */
export function proofProvisionPredecessor(
  proof: TenantExternalOwnershipProof,
): TenantProvisionPredecessor | null {
  const evidenceValue = proof.evidence.provisionPredecessor;
  if (proof.pendingFence.intent === "provision") {
    if (proof.provisionPredecessor !== null || evidenceValue !== null) {
      throw fail(
        "TENANT_EXTERNAL_OWNERSHIP_PROOF_INVALID",
        "A provision proof must not carry a cleanup predecessor.",
      );
    }
    return null;
  }
  assertTenantProvisionPredecessor(
    proof.provisionPredecessor,
    proof.pendingFence.resourceFence,
    proof.pendingFence.epoch,
  );
  assertTenantProvisionPredecessor(
    evidenceValue,
    proof.pendingFence.resourceFence,
    proof.pendingFence.epoch,
    proof.provisionPredecessor,
  );
  return proof.provisionPredecessor;
}

export function cleanupProvisionPredecessorFromEvidence(
  evidence: Record<string, unknown>,
  externalFence: TenantExternalOperationFence,
): TenantProvisionPredecessor {
  assertTenantProvisionPredecessor(
    evidence.provisionPredecessor,
    externalFence.resourceFence,
    externalFence.epoch,
  );
  return evidence.provisionPredecessor;
}

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
    fence.provisionPredecessor !== undefined ||
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
