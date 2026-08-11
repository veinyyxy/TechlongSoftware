import type {
  CleanupSchedulePort,
  TenantDatabaseDestroyReceipt,
  TenantDatabaseLifecyclePort,
  TenantResourceCleanupReceipt,
  TenantResourceCleanupFencePhase,
  TenantResourceCleanupFencePort,
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
): void {
  assertExactKeys(
    receipt,
    ["fence", "outcome", "ownershipMarker"],
    "Tenant workload cleanup receipt",
  );
  assertTenantResourceFence(receipt.fence, fence);
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
): void {
  assertExactKeys(
    receipt,
    [
      "fence",
      "outcome",
      "databaseDeleted",
      "roleDeleted",
      "evidenceHash",
    ],
    "Tenant database cleanup receipt",
  );
  assertTenantResourceFence(receipt.fence, fence);
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
): void {
  assertExactKeys(
    receipt,
    ["fence", "outcome", "ownershipMarker"],
    "Tenant secret cleanup receipt",
  );
  assertTenantResourceFence(receipt.fence, fence);
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
  private readonly fences: TenantResourceCleanupFencePort;
  private readonly now: () => number;

  constructor(input: {
    workload: TenantWorkloadLifecyclePort;
    database: TenantDatabaseLifecyclePort;
    secrets: TenantSecretStorePort;
    fences: TenantResourceCleanupFencePort;
    now?: () => number;
  }) {
    this.workload = input.workload;
    this.database = input.database;
    this.secrets = input.secrets;
    this.fences = input.fences;
    this.now = input.now ?? Date.now;
  }

  async destroy(input: {
    fence: TenantResourceFence;
    jobId: string;
    workerId: string;
    idempotencyKey: string;
  }): Promise<TenantResourceCleanupReceipt> {
    assertTenantResourceFence(input.fence);
    if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/.test(input.idempotencyKey)) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_IDEMPOTENCY_KEY_INVALID",
        "Tenant cleanup idempotency key is invalid.",
      );
    }

    const acquired = await this.fences.beginTenantResourceCleanup({
      fence: input.fence,
      jobId: input.jobId,
      workerId: input.workerId,
      now: this.now(),
    });
    if (!acquired) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_CLEANUP_FENCE_REJECTED",
        "Tenant cleanup generation is stale or owned by another deployment.",
      );
    }
    assertTenantResourceFence(acquired, input.fence);

    const assertCurrent = async (
      phase: TenantResourceCleanupFencePhase,
    ): Promise<void> => {
      const current = await this.fences.assertTenantResourceCleanupFence({
        fence: acquired,
        jobId: input.jobId,
        workerId: input.workerId,
        phase,
        now: this.now(),
      });
      if (!current) {
        throw new TenantDatabaseLifecycleError(
          "TENANT_CLEANUP_FENCE_LOST",
          `Tenant cleanup fence was lost at ${phase}.`,
        );
      }
    };

    await assertCurrent("before_workload");
    const workload = await this.workload.destroy({
      fence: acquired,
      idempotencyKey: `${input.idempotencyKey}:workload`,
    });
    assertWorkloadReceipt(workload, acquired);

    await assertCurrent("before_database");
    const database = await this.database.destroy({
      fence: acquired,
      idempotencyKey: `${input.idempotencyKey}:database`,
    });
    assertDatabaseReceipt(database, acquired);

    await assertCurrent("before_secret");
    const secret = await this.secrets.destroyRuntimeSecret({
      fence: acquired,
      idempotencyKey: `${input.idempotencyKey}:secret`,
    });
    assertSecretReceipt(secret, acquired);

    const receipt: TenantResourceCleanupReceipt = {
      fence: acquired,
      order: tenantResourceCleanupOrder,
      workloadOutcome: workload.outcome,
      databaseOutcome: database.outcome,
      secretOutcome: secret.outcome,
      databaseEvidenceHash: database.evidenceHash,
    };
    await assertCurrent("before_complete");
    const completed = await this.fences.completeTenantResourceCleanup({
      fence: acquired,
      jobId: input.jobId,
      workerId: input.workerId,
      receipt,
      now: this.now(),
    });
    if (!completed) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_CLEANUP_COMPLETE_REJECTED",
        "Tenant cleanup completion was rejected by its generation fence.",
      );
    }
    return receipt;
  }
}
