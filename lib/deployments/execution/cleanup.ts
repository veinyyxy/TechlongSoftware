import type {
  CleanupSchedulePort,
  DeploymentExecutionRepository,
  DeploymentJobLeaseFence,
  TenantDatabaseDestroyReceipt,
  TenantDatabaseLifecyclePort,
  TenantExternalOperationFence,
  TenantResourceCleanupReceipt,
  TenantResourceCleanupPhase,
  TenantResourceCleanupPhaseReceiptMap,
  TenantResourceCleanupRun,
  TenantResourceFence,
  TenantSecretDestroyReceipt,
  TenantSecretStorePort,
  TenantWorkloadDestroyReceipt,
  TenantWorkloadLifecyclePort,
} from "./contracts.ts";
import { canonicalJson } from "./hash.ts";
import {
  assertTenantResourceFence,
  TenantDatabaseLifecycleError,
} from "./tenant-database.ts";

const stackNamePattern = /^techlong-sandbox-tenant-[a-z0-9]{1,16}$/;

/**
 * Confirms the cleanup boundary represented inside the reviewed tenant stack.
 * CloudFormation must create TenantCleanupSchedule before TenantService. The
 * global Janitor scan remains a separate S3 bootstrap responsibility.
 */
export class EmbeddedCloudFormationCleanupSchedule
  implements CleanupSchedulePort
{
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async confirmSchedule(input: {
    deploymentId: string;
    stackName: string;
    expiresAt: number;
    expectedTags: Record<string, string>;
  }): Promise<{ providerScheduleRef: string; confirmedAt: number }> {
    const current = this.now();
    if (!stackNamePattern.test(input.stackName)) {
      throw new Error("Cleanup schedule stack name is outside the sandbox prefix.");
    }
    if (
      !Number.isSafeInteger(input.expiresAt) ||
      input.expiresAt < current + 5 * 60_000 ||
      input.expiresAt > current + 2 * 60 * 60_000 + 5 * 60_000
    ) {
      throw new Error("Cleanup schedule expiry is outside the two-hour sandbox TTL.");
    }
    if (
      input.expectedTags.Environment !== "aws-sandbox" ||
      input.expectedTags.ManagedBy !== "techlong-provisioner" ||
      input.expectedTags.DeploymentId !== input.deploymentId ||
      !input.expectedTags.ExpiresAt
    ) {
      throw new Error("Cleanup schedule is missing required ownership tags.");
    }
    return {
      providerScheduleRef: `cloudformation:${input.stackName}:TenantCleanupSchedule`,
      confirmedAt: current,
    };
  }
}

export const tenantResourceCleanupOrder = [
  "workload",
  "database",
  "secret",
] as const;

function assertExactKeys(
  value: object,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_CLEANUP_RECEIPT_INVALID",
      `${label} contains missing or unexpected fields.`,
    );
  }
}

function assertWorkloadReceipt(
  receipt: TenantWorkloadDestroyReceipt,
  fence: TenantResourceFence,
  externalFence: TenantExternalOperationFence,
): void {
  assertExactKeys(
    receipt,
    ["fence", "externalFence", "outcome", "ownershipMarker"],
    "Tenant workload cleanup receipt",
  );
  assertTenantResourceFence(receipt.fence, fence);
  assertExternalFence(receipt.externalFence, externalFence);
  if (
    !["deleted", "already_missing"].includes(receipt.outcome) ||
    receipt.ownershipMarker !== fence.ownershipMarker
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_WORKLOAD_CLEANUP_UNVERIFIED",
      "Tenant workload deletion lacks exact ownership evidence.",
    );
  }
}

function assertDatabaseReceipt(
  receipt: TenantDatabaseDestroyReceipt,
  fence: TenantResourceFence,
  externalFence: TenantExternalOperationFence,
): void {
  assertExactKeys(
    receipt,
    [
      "fence",
      "externalFence",
      "outcome",
      "databaseDeleted",
      "roleDeleted",
      "evidenceHash",
    ],
    "Tenant database cleanup receipt",
  );
  assertTenantResourceFence(receipt.fence, fence);
  assertExternalFence(receipt.externalFence, externalFence);
  if (!/^[a-f0-9]{64}$/.test(receipt.evidenceHash)) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_DATABASE_CLEANUP_UNVERIFIED",
      "Tenant database deletion evidence hash is invalid.",
    );
  }
  const completeDelete =
    receipt.outcome === "deleted" &&
    receipt.databaseDeleted &&
    receipt.roleDeleted;
  const completeAbsence =
    receipt.outcome === "already_missing" &&
    !receipt.databaseDeleted &&
    !receipt.roleDeleted;
  if (!completeDelete && !completeAbsence) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_DATABASE_CLEANUP_PARTIAL",
      "Tenant database and role were not deleted as one verified lifecycle unit.",
    );
  }
}

function assertSecretReceipt(
  receipt: TenantSecretDestroyReceipt,
  fence: TenantResourceFence,
  externalFence: TenantExternalOperationFence,
): void {
  assertExactKeys(
    receipt,
    ["fence", "externalFence", "outcome", "ownershipMarker"],
    "Tenant secret cleanup receipt",
  );
  assertTenantResourceFence(receipt.fence, fence);
  assertExternalFence(receipt.externalFence, externalFence);
  if (
    !["deleted", "already_missing"].includes(receipt.outcome) ||
    receipt.ownershipMarker !== fence.ownershipMarker
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_SECRET_CLEANUP_UNVERIFIED",
      "Tenant secret deletion lacks exact ownership evidence.",
    );
  }
}

function assertExternalFence(
  actual: TenantExternalOperationFence,
  expected: TenantExternalOperationFence,
): void {
  assertExactKeys(
    actual,
    [
      "schemaVersion",
      "resourceFence",
      "epoch",
      "intent",
      "ownerDeploymentId",
      "operationHash",
      "marker",
      "state",
    ],
    "Tenant cleanup external operation fence",
  );
  assertTenantResourceFence(actual.resourceFence, expected.resourceFence);
  if (
    canonicalJson(actual) !== canonicalJson(expected) ||
    actual.schemaVersion !== 1 ||
    !Number.isSafeInteger(actual.epoch) ||
    actual.epoch < 1 ||
    actual.intent !== "cleanup" ||
    actual.state !== "active" ||
    actual.ownerDeploymentId !== actual.resourceFence.ownerDeploymentId ||
    !/^[a-f0-9]{64}$/.test(actual.operationHash) ||
    actual.marker !==
      `tl_epoch_${actual.resourceFence.identity.stableIdentityHash.slice(0, 24)}` +
        `_g${actual.resourceFence.generation}_e${actual.epoch}`
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_CLEANUP_EXTERNAL_EPOCH_INVALID",
      "Tenant cleanup does not own the exact active external-operation epoch.",
    );
  }
}

function requireNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new TenantDatabaseLifecycleError(
      "DEPLOYMENT_LEASE_LOST",
      "Tenant cleanup was canceled after losing its deployment lease.",
    );
  }
}

function cleanupFenceRepository(
  repository: DeploymentExecutionRepository,
): Pick<
  DeploymentExecutionRepository,
  | "assertTenantExternalOperation"
  | "beginOrResumeTenantResourceCleanup"
  | "beginTenantResourceCleanupPhase"
  | "completeTenantResourceCleanupPhase"
  | "finalizeTenantResourceCleanup"
> {
  return repository;
}

/**
 * Destructive cleanup is deliberately sequenced: stop/remove the workload,
 * then drop the owned database and role, then remove the runtime secret. A
 * failed or partial step stops the chain, so a retry can safely resume through
 * each adapter's already_missing result without orphaning credentials needed
 * by a still-running task.
 */
export class OrderedTenantResourceCleanup {
  private readonly workload: TenantWorkloadLifecyclePort;
  private readonly database: TenantDatabaseLifecyclePort;
  private readonly secrets: TenantSecretStorePort;
  private readonly repository: ReturnType<typeof cleanupFenceRepository>;
  private readonly now: () => number;

  constructor(input: {
    workload: TenantWorkloadLifecyclePort;
    database: TenantDatabaseLifecyclePort;
    secrets: TenantSecretStorePort;
    repository: DeploymentExecutionRepository;
    now?: () => number;
  }) {
    this.workload = input.workload;
    this.database = input.database;
    this.secrets = input.secrets;
    this.repository = cleanupFenceRepository(input.repository);
    this.now = input.now ?? Date.now;
  }

  async destroy(input: {
    fence: TenantResourceFence;
    externalFence: TenantExternalOperationFence;
    lease: DeploymentJobLeaseFence;
    idempotencyKey: string;
    scheduleId: string | null;
    appInstanceId: string;
    reason: "ttl_cleanup" | "rollback";
    signal: AbortSignal;
  }): Promise<TenantResourceCleanupReceipt> {
    assertTenantResourceFence(input.fence);
    assertExternalFence(input.externalFence, input.externalFence);
    assertTenantResourceFence(input.externalFence.resourceFence, input.fence);
    if (input.lease.deploymentId !== input.fence.ownerDeploymentId) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_CLEANUP_FENCE_REJECTED",
        "Tenant cleanup lease does not own the resource generation.",
      );
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/.test(input.idempotencyKey)) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_IDEMPOTENCY_KEY_INVALID",
        "Tenant cleanup idempotency key is invalid.",
      );
    }
    if (input.appInstanceId !== input.fence.identity.appInstanceId) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_CLEANUP_FENCE_REJECTED",
        "Tenant cleanup application instance does not match its resource fence.",
      );
    }

    requireNotAborted(input.signal);
    const active = await this.repository.assertTenantExternalOperation({
      lease: input.lease,
      externalFence: input.externalFence,
      requiredState: "active",
      now: this.now(),
    });
    if (!active) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_CLEANUP_EXTERNAL_EPOCH_INACTIVE",
        "Tenant cleanup external-operation epoch is not active under this lease.",
      );
    }
    requireNotAborted(input.signal);
    const run = await this.repository.beginOrResumeTenantResourceCleanup({
      lease: input.lease,
      externalFence: input.externalFence,
      now: this.now(),
    });
    if (!run) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_CLEANUP_FENCE_REJECTED",
        "Tenant cleanup run could not be acquired under the current lease and epoch.",
      );
    }
    let activeRun: TenantResourceCleanupRun = run;

    const phaseReceipts: Partial<TenantResourceCleanupPhaseReceiptMap> = {};
    for (const phase of tenantResourceCleanupOrder) {
      const existing = activeRun.phases[phase];
      if (existing?.status === "succeeded" && existing.receipt) {
        this.assertPhaseReceipt(phase, existing.receipt, input);
        Object.assign(phaseReceipts, { [phase]: existing.receipt });
        continue;
      }
      requireNotAborted(input.signal);
      const claim = await this.repository.beginTenantResourceCleanupPhase({
        lease: input.lease,
        externalFence: input.externalFence,
        runId: activeRun.id,
        phase,
        now: this.now(),
      });
      if (!claim) {
        throw new TenantDatabaseLifecycleError(
          "TENANT_CLEANUP_FENCE_LOST",
          `Tenant cleanup phase ${phase} lost its lease or external epoch.`,
        );
      }
      let receipt: TenantResourceCleanupPhaseReceiptMap[typeof phase];
      if (claim.outcome === "already_succeeded") {
        if (!claim.receipt) {
          throw new TenantDatabaseLifecycleError(
            "TENANT_CLEANUP_RECEIPT_INVALID",
            `Persisted tenant cleanup phase ${phase} has no receipt.`,
          );
        }
        receipt = claim.receipt as TenantResourceCleanupPhaseReceiptMap[typeof phase];
      } else {
        requireNotAborted(input.signal);
        receipt = await this.executePhase(phase, claim.operationId, input);
        requireNotAborted(input.signal);
        this.assertPhaseReceipt(phase, receipt, input);
        const completed: TenantResourceCleanupRun | null =
          await this.repository.completeTenantResourceCleanupPhase({
            lease: input.lease,
            externalFence: input.externalFence,
            runId: activeRun.id,
            phase,
            operationId: claim.operationId,
            receipt,
            now: this.now(),
          });
        if (!completed) {
          throw new TenantDatabaseLifecycleError(
            "TENANT_CLEANUP_FENCE_LOST",
            `Tenant cleanup phase ${phase} could not persist its receipt.`,
          );
        }
        activeRun = completed;
      }
      if (claim.outcome === "already_succeeded") {
        this.assertPhaseReceipt(phase, receipt, input);
      }
      Object.assign(phaseReceipts, { [phase]: receipt });
    }

    const workload = phaseReceipts.workload;
    const database = phaseReceipts.database;
    const secret = phaseReceipts.secret;
    if (!workload || !database || !secret) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_CLEANUP_RECEIPT_INVALID",
        "Tenant cleanup cannot finalize without every persisted phase receipt.",
      );
    }
    requireNotAborted(input.signal);
    const finalized = await this.repository.finalizeTenantResourceCleanup({
      lease: input.lease,
      externalFence: input.externalFence,
      runId: activeRun.id,
      scheduleId: input.scheduleId,
      appInstanceId: input.appInstanceId,
      reason: input.reason,
      now: this.now(),
    });
    if (!finalized) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_CLEANUP_COMPLETE_REJECTED",
        "Tenant cleanup finalization was rejected by its lease or external epoch.",
      );
    }
    return {
      fence: input.fence,
      order: tenantResourceCleanupOrder,
      workloadOutcome: workload.outcome,
      databaseOutcome: database.outcome,
      secretOutcome: secret.outcome,
      databaseEvidenceHash: database.evidenceHash,
    };
  }

  private async executePhase<P extends TenantResourceCleanupPhase>(
    phase: P,
    operationId: string,
    input: {
      fence: TenantResourceFence;
      externalFence: TenantExternalOperationFence;
      signal: AbortSignal;
    },
  ): Promise<TenantResourceCleanupPhaseReceiptMap[P]> {
    const common = {
      fence: input.fence,
      externalFence: input.externalFence,
      idempotencyKey: operationId,
      signal: input.signal,
    };
    switch (phase) {
      case "workload":
        return (await this.workload.destroy(common)) as TenantResourceCleanupPhaseReceiptMap[P];
      case "database":
        return (await this.database.destroy(common)) as TenantResourceCleanupPhaseReceiptMap[P];
      case "secret":
        return (await this.secrets.destroyRuntimeSecret(common)) as TenantResourceCleanupPhaseReceiptMap[P];
    }
  }

  private assertPhaseReceipt<P extends TenantResourceCleanupPhase>(
    phase: P,
    receipt: TenantResourceCleanupPhaseReceiptMap[P],
    input: {
      fence: TenantResourceFence;
      externalFence: TenantExternalOperationFence;
    },
  ): void {
    switch (phase) {
      case "workload":
        assertWorkloadReceipt(
          receipt as TenantWorkloadDestroyReceipt,
          input.fence,
          input.externalFence,
        );
        return;
      case "database":
        assertDatabaseReceipt(
          receipt as TenantDatabaseDestroyReceipt,
          input.fence,
          input.externalFence,
        );
        return;
      case "secret":
        assertSecretReceipt(
          receipt as TenantSecretDestroyReceipt,
          input.fence,
          input.externalFence,
        );
    }
  }
}
