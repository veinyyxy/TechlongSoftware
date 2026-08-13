import type {
  DeploymentExecutionContext,
  DeploymentExecutionRepository,
  DeploymentJobLeaseFence,
  TenantExternalOperationFence,
  TenantExternalOperationIntent,
  TenantExternalOwnershipPort,
  TenantResourceFence,
} from "./contracts.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import type { TenantExternalOwnershipCoordinatorPort } from "./worker.ts";

function fail(code: string, message: string, retryable = false): Error {
  return Object.assign(new Error(message), { code, retryable });
}

function assertPendingFence(
  pending: TenantExternalOperationFence,
  expectedResource: TenantResourceFence,
  intent: TenantExternalOperationIntent,
): void {
  if (
    pending.schemaVersion !== 1 ||
    pending.state !== "pending_external" ||
    pending.intent !== intent ||
    pending.ownerDeploymentId !== expectedResource.ownerDeploymentId ||
    canonicalJson(pending.resourceFence) !== canonicalJson(expectedResource) ||
    !Number.isSafeInteger(pending.epoch) ||
    pending.epoch < 1 ||
    !/^[a-f0-9]{64}$/.test(pending.operationHash) ||
    pending.marker !==
      `tl_epoch_${expectedResource.identity.stableIdentityHash.slice(0, 24)}` +
        `_g${expectedResource.generation}_e${pending.epoch}`
  ) {
    throw fail(
      "TENANT_EXTERNAL_OWNERSHIP_FENCE_INVALID",
      "Repository returned an invalid pending external-operation fence.",
    );
  }
}

/**
 * Turns a durable pending epoch into active authority only after a provider
 * adapter installs and independently re-observes the exact marker. It is
 * intentionally separate from the Worker and can serve both provision and
 * cleanup intents. No external implementation is wired in the default runner.
 */
export class RepositoryTenantExternalOwnershipCoordinator
  implements TenantExternalOwnershipCoordinatorPort
{
  private readonly repository: DeploymentExecutionRepository;
  private readonly external: TenantExternalOwnershipPort;
  private readonly now: () => number;

  constructor(
    repository: DeploymentExecutionRepository,
    external: TenantExternalOwnershipPort,
    now: () => number = Date.now,
  ) {
    this.repository = repository;
    this.external = external;
    this.now = now;
  }

  async prepareAndActivate(input: {
    context: DeploymentExecutionContext;
    resourceFence: TenantResourceFence;
    lease: DeploymentJobLeaseFence;
    signal: AbortSignal;
  } & (
    | { intent: "provision" }
    | { intent: "cleanup"; cleanupReason: "ttl_cleanup" | "rollback" }
  )): Promise<TenantExternalOperationFence> {
    input.signal.throwIfAborted();
    if (
      input.context.deployment.id !== input.lease.deploymentId ||
      input.resourceFence.ownerDeploymentId !== input.lease.deploymentId
    ) {
      throw fail(
        "TENANT_EXTERNAL_OWNERSHIP_OWNER_INVALID",
        "External ownership epoch lease does not own this resource generation.",
      );
    }
    const operationHash = await sha256Hex({
      schemaVersion: 1,
      intent: input.intent,
      deploymentId: input.context.deployment.id,
      appInstanceId: input.resourceFence.identity.appInstanceId,
      generation: input.resourceFence.generation,
      ownershipMarker: input.resourceFence.ownershipMarker,
      planHash: input.context.deployment.planHash,
      configurationHash: input.context.deployment.configurationHash,
      artifactRef: input.context.deployment.artifactRef,
    });
    input.signal.throwIfAborted();
    const claim = await this.repository.prepareTenantExternalOperation({
      lease: input.lease,
      resourceFence: input.resourceFence,
      intent: input.intent,
      operationHash,
      now: this.now(),
    });
    if (claim.fence.operationHash !== operationHash) {
      throw fail(
        "TENANT_EXTERNAL_OWNERSHIP_OPERATION_MISMATCH",
        "Repository returned an external epoch for a different immutable operation.",
      );
    }
    if (claim.fence.state === "active") {
      const active = await this.repository.assertTenantExternalOperation({
        lease: input.lease,
        externalFence: claim.fence,
        requiredState: "active",
        now: this.now(),
      });
      if (!active) {
        throw fail(
          "TENANT_EXTERNAL_OWNERSHIP_ACTIVE_FENCE_REJECTED",
          "The reusable active ownership epoch is no longer current.",
          true,
        );
      }
      return claim.fence;
    }
    assertPendingFence(claim.fence, input.resourceFence, input.intent);
    input.signal.throwIfAborted();
    const proof = await this.external.installAndObserve({
      pendingFence: claim.fence,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    if (
      proof.schemaVersion !== 1 ||
      canonicalJson(proof.pendingFence) !== canonicalJson(claim.fence) ||
      !/^[a-f0-9]{64}$/.test(proof.evidenceHash) ||
      proof.evidenceHash !== (await sha256Hex(proof.evidence)) ||
      !proof.evidence ||
      typeof proof.evidence !== "object" ||
      Array.isArray(proof.evidence) ||
      Object.keys(proof.evidence).length === 0
    ) {
      throw fail(
        "TENANT_EXTERNAL_OWNERSHIP_PROOF_INVALID",
        "Provider ownership proof does not match the prepared epoch.",
      );
    }
    const activated = await this.repository.activateTenantExternalOperation({
      lease: input.lease,
      proof,
      now: this.now(),
    });
    if (
      !activated ||
      activated.state !== "active" ||
      canonicalJson({ ...activated, state: "pending_external" }) !==
        canonicalJson(claim.fence)
    ) {
      throw fail(
        "TENANT_EXTERNAL_OWNERSHIP_ACTIVATION_REJECTED",
        "Provider-proven external ownership epoch was not activated.",
        true,
      );
    }
    return activated;
  }
}
