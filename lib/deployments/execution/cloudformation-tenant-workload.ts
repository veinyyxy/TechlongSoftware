import {
  awsSandboxTenantStackName,
  tenantStackExternalOperationTagKeys,
  tenantStackOperationTagKey,
  tenantStackStableOwnershipTagKeys,
} from "../cloudformation/tenant-stack.ts";
import type {
  AwsDeploymentPort,
  CloudFormationStackObservation,
  TenantExternalOperationFence,
  TenantProvisionPredecessor,
  TenantResourceFence,
  TenantWorkloadDestroyReceipt,
  TenantWorkloadLifecyclePort,
} from "./contracts.ts";
import {
  assertTenantProvisionPredecessor,
  requireActiveCleanupProvisionPredecessor,
} from "./external-ownership.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import {
  assertTenantResourceFence,
  TenantDatabaseLifecycleError,
} from "./tenant-database.ts";

const digestPattern = /^[a-f0-9]{64}$/;
const idempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/;
const sandboxAccountId = "402010193138";
const sandboxRegion = "ca-central-1";
const sandboxProvisionerRoleName = "TechlongSandboxProvisionerRole";
const cleanupFenceKeys = [
  "schemaVersion",
  "resourceFence",
  "epoch",
  "intent",
  "ownerDeploymentId",
  "operationHash",
  "marker",
  "state",
  "provisionPredecessor",
] as const;

export interface CloudFormationTenantWorkloadLifecycleConfig {
  expectedAccountId: string;
  expectedRegion: string;
  cloudFormationRoleArn: string;
  readbackAttempts?: number;
  readbackDelayMs?: number;
}

type ReadbackWait = (delayMs: number, signal: AbortSignal) => Promise<void>;

interface TenantStackObservationInput {
  stackName: string;
  expectedAccountId: string;
  expectedRegion: string;
  expectedTags: Record<string, string>;
}

function fail(code: string, message: string, retryable = false): never {
  throw new TenantDatabaseLifecycleError(code, message, retryable);
}

function assertExactCleanupFence(
  externalFence: TenantExternalOperationFence,
  resourceFence: TenantResourceFence,
  provisionPredecessor: TenantProvisionPredecessor,
): void {
  assertTenantResourceFence(resourceFence);
  assertTenantResourceFence(externalFence.resourceFence, resourceFence);
  const predecessor = requireActiveCleanupProvisionPredecessor(externalFence);
  assertTenantProvisionPredecessor(
    provisionPredecessor,
    resourceFence,
    externalFence.epoch,
    predecessor,
  );
  if (
    canonicalJson(Object.keys(externalFence).sort()) !==
      canonicalJson([...cleanupFenceKeys].sort()) ||
    externalFence.schemaVersion !== 1 ||
    externalFence.intent !== "cleanup" ||
    externalFence.state !== "active" ||
    externalFence.ownerDeploymentId !== resourceFence.ownerDeploymentId ||
    !Number.isSafeInteger(externalFence.epoch) ||
    externalFence.epoch < 1 ||
    !digestPattern.test(externalFence.operationHash) ||
    externalFence.marker !==
      `tl_epoch_${resourceFence.identity.stableIdentityHash.slice(0, 24)}` +
        `_g${resourceFence.generation}_e${externalFence.epoch}`
  ) {
    fail(
      "TENANT_WORKLOAD_CLEANUP_FENCE_INVALID",
      "CloudFormation workload deletion requires the exact active cleanup ownership fence.",
    );
  }
}

function expectedProvisionTags(
  fence: TenantResourceFence,
  predecessor: TenantProvisionPredecessor,
): Record<string, string> {
  return {
    Environment: "aws-sandbox",
    ManagedBy: "techlong-provisioner",
    AppInstanceId: fence.identity.appInstanceId,
    CellId: fence.identity.cellKey,
    ResourceGeneration: String(fence.generation),
    DeploymentId: predecessor.ownerDeploymentId,
    ExternalOperationEpoch: String(predecessor.epoch),
    ExternalOperationIntent: predecessor.intent,
    ExternalOperationMarker: predecessor.marker,
    ExternalOperationHash: predecessor.operationHash,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertObservation(
  observation: CloudFormationStackObservation,
  input: TenantStackObservationInput,
): void {
  if (
    !isRecord(observation) ||
    canonicalJson(Object.keys(observation).sort()) !==
      canonicalJson(
        ["state", "rawStatus", "stackId", "outputs", "tags"].sort(),
      ) ||
    !isRecord(observation.outputs) ||
    !isRecord(observation.tags)
  ) {
    fail(
      "TENANT_WORKLOAD_READBACK_INVALID",
      "CloudFormation returned a malformed tenant workload observation.",
    );
  }
  if (observation.state === "missing") {
    if (
      observation.rawStatus !== null ||
      observation.stackId !== null ||
      Object.keys(observation.outputs).length !== 0 ||
      Object.keys(observation.tags).length !== 0
    ) {
      fail(
        "TENANT_WORKLOAD_READBACK_INVALID",
        "A missing CloudFormation tenant workload returned residual identity or metadata.",
      );
    }
    return;
  }

  const stackIdPattern = new RegExp(
    `^arn:aws:cloudformation:${escapeRegExp(input.expectedRegion)}:` +
      `${escapeRegExp(input.expectedAccountId)}:stack/${escapeRegExp(input.stackName)}/` +
      "[A-Za-z0-9-]+$",
  );
  if (!observation.stackId || !stackIdPattern.test(observation.stackId)) {
    fail(
      "TENANT_WORKLOAD_READBACK_INVALID",
      "CloudFormation returned a tenant workload outside the exact stack identity.",
    );
  }
  for (const key of [
    ...tenantStackStableOwnershipTagKeys,
    tenantStackOperationTagKey,
    ...tenantStackExternalOperationTagKeys,
  ] as const) {
    if (observation.tags[key] !== input.expectedTags[key]) {
      fail(
        "TENANT_WORKLOAD_OWNERSHIP_MISMATCH",
        `CloudFormation tenant workload tag ${key} does not match its authority-derived provision predecessor.`,
      );
    }
  }
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" ? value : null;
}

function isRetryableError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as { retryable?: unknown }).retryable === true,
  );
}

async function defaultWait(delayMs: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (delayMs === 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  signal.throwIfAborted();
}

/**
 * Deletes only the exact CloudFormation workload created by the authority-
 * derived provision predecessor. A successful DeleteStack response is not a
 * receipt: bounded independent readback must first prove the stack is missing.
 * This adapter is intentionally not part of the default Worker composition.
 */
export class CloudFormationTenantWorkloadLifecycleAdapter
  implements TenantWorkloadLifecyclePort
{
  private readonly aws: AwsDeploymentPort;
  private readonly config: Required<CloudFormationTenantWorkloadLifecycleConfig>;
  private readonly wait: ReadbackWait;

  constructor(input: {
    aws: AwsDeploymentPort;
    config: CloudFormationTenantWorkloadLifecycleConfig;
    wait?: ReadbackWait;
  }) {
    const { config } = input;
    const exactRole = config.expectedAccountId === sandboxAccountId
      ? `arn:aws:iam::${config.expectedAccountId}:role/TechlongSandboxCloudFormationExecutionRole`
      : "";
    const readbackAttempts = config.readbackAttempts ?? 3;
    const readbackDelayMs = config.readbackDelayMs ?? 250;
    if (
      config.expectedAccountId !== sandboxAccountId ||
      config.expectedRegion !== sandboxRegion ||
      input.aws.region !== config.expectedRegion ||
      config.cloudFormationRoleArn !== exactRole ||
      !Number.isSafeInteger(readbackAttempts) ||
      readbackAttempts < 1 ||
      readbackAttempts > 10 ||
      !Number.isSafeInteger(readbackDelayMs) ||
      readbackDelayMs < 0 ||
      readbackDelayMs > 5_000
    ) {
      fail(
        "TENANT_WORKLOAD_CLEANUP_CONFIG_INVALID",
        "CloudFormation tenant workload cleanup scope is invalid.",
      );
    }
    this.aws = input.aws;
    this.config = {
      ...config,
      readbackAttempts,
      readbackDelayMs,
    };
    this.wait = input.wait ?? defaultWait;
  }

  async destroy(input: {
    fence: TenantResourceFence;
    externalFence: TenantExternalOperationFence;
    provisionPredecessor: TenantProvisionPredecessor;
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<TenantWorkloadDestroyReceipt> {
    input.signal.throwIfAborted();
    assertExactCleanupFence(
      input.externalFence,
      input.fence,
      input.provisionPredecessor,
    );
    if (!idempotencyKeyPattern.test(input.idempotencyKey)) {
      fail(
        "TENANT_IDEMPOTENCY_KEY_INVALID",
        "CloudFormation tenant workload cleanup idempotency key is invalid.",
      );
    }

    const stackName = awsSandboxTenantStackName(input.fence.identity.appInstanceId);
    const expectedTags = expectedProvisionTags(
      input.fence,
      input.provisionPredecessor,
    );
    const observationInput = {
      stackName,
      expectedAccountId: this.config.expectedAccountId,
      expectedRegion: this.config.expectedRegion,
      expectedTags,
    };
    const before = await this.observeWithVerifiedCaller(
      observationInput,
      input.signal,
    );
    if (before.state === "missing") {
      return this.receipt(input, "already_missing");
    }

    if (before.state === "delete_in_progress") {
      await this.confirmMissing(observationInput, input.signal);
      return this.receipt(input, "already_missing");
    }

    const clientRequestToken = `cleanup-${await sha256Hex({
      schemaVersion: 1,
      idempotencyKey: input.idempotencyKey,
      stackName,
      resourceFence: input.fence,
      cleanupFence: input.externalFence,
      provisionPredecessor: input.provisionPredecessor,
    })}`;
    input.signal.throwIfAborted();
    await this.assertVerifiedCaller(input.signal);
    input.signal.throwIfAborted();
    let operation: "delete" | "delete_in_progress" | "already_deleted";
    try {
      const result = await this.aws.deleteTenantStack({
        stackName,
        clientRequestToken,
        expectedTags,
        cloudFormationRoleArn: this.config.cloudFormationRoleArn,
        verifyCaller: (signal) => this.assertVerifiedCaller(signal),
        signal: input.signal,
      });
      if (
        !["delete", "delete_in_progress", "already_deleted"].includes(
          result.operation,
        )
      ) {
        fail(
          "TENANT_WORKLOAD_DELETE_RECEIPT_INVALID",
          "CloudFormation returned an invalid tenant workload delete operation.",
        );
      }
      operation = result.operation;
    } catch (error) {
      input.signal.throwIfAborted();
      if (!isRetryableError(error)) throw error;
      try {
        await this.confirmMissing(observationInput, input.signal);
        return this.receipt(input, "deleted");
      } catch (readbackError) {
        input.signal.throwIfAborted();
        if (
          errorCode(readbackError) !== "CLOUDFORMATION_DELETE_UNCONFIRMED"
        ) {
          throw readbackError;
        }
        throw error;
      }
    }
    input.signal.throwIfAborted();
    await this.confirmMissing(observationInput, input.signal);
    return this.receipt(
      input,
      operation === "already_deleted" ? "already_missing" : "deleted",
    );
  }

  private async confirmMissing(
    observationInput: TenantStackObservationInput,
    signal: AbortSignal,
  ): Promise<void> {
    let last: CloudFormationStackObservation | null = null;
    for (let attempt = 0; attempt < this.config.readbackAttempts; attempt += 1) {
      signal.throwIfAborted();
      if (attempt > 0) {
        await this.wait(this.config.readbackDelayMs, signal);
      }
      const observed = await this.observeWithVerifiedCaller(
        observationInput,
        signal,
      );
      if (observed.state === "missing") return;
      if (observed.rawStatus === "DELETE_FAILED") {
        fail(
          "CLOUDFORMATION_DELETE_FAILED",
          "The exactly owned tenant workload entered DELETE_FAILED; later cleanup may retry only under the same fence.",
          true,
        );
      }
      if (observed.state === "failed") {
        fail(
          "CLOUDFORMATION_DELETE_STATE_INVALID",
          `CloudFormation tenant workload entered unexpected state ${observed.rawStatus ?? "unknown"}.`,
        );
      }
      last = observed;
    }
    if (last?.state === "delete_in_progress") {
      fail(
        "CLOUDFORMATION_DELETE_IN_PROGRESS",
        "CloudFormation tenant workload deletion is still in progress.",
        true,
      );
    }
    fail(
      "CLOUDFORMATION_DELETE_UNCONFIRMED",
      "CloudFormation tenant workload deletion was not independently confirmed as missing.",
      true,
    );
  }

  /**
   * DescribeStacks returning "missing" is account-relative. Verify STS
   * immediately before every observation so credential refresh or provider
   * drift can never turn a lookup in another account into an absence receipt.
   */
  private async observeWithVerifiedCaller(
    observationInput: TenantStackObservationInput,
    signal: AbortSignal,
  ): Promise<CloudFormationStackObservation> {
    await this.assertVerifiedCaller(signal);
    const observed = await this.aws.describeTenantStack(
      observationInput.stackName,
      { signal },
    );
    signal.throwIfAborted();
    assertObservation(observed, observationInput);
    return observed;
  }

  /**
   * The deployment SDK may use a refreshing credential provider. Re-check the
   * exact caller immediately before both observations and the destructive API
   * boundary so a refreshed session cannot silently move the operation.
   */
  private async assertVerifiedCaller(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const identity = await this.aws.getCallerIdentity({ signal });
    signal.throwIfAborted();
    const expectedCallerPattern = new RegExp(
      `^arn:aws:sts::${sandboxAccountId}:assumed-role/` +
        `${sandboxProvisionerRoleName}/[A-Za-z0-9+=,.@_-]{2,64}$`,
    );
    if (
      identity.accountId !== sandboxAccountId ||
      !expectedCallerPattern.test(identity.arn)
    ) {
      fail(
        "TENANT_WORKLOAD_CLEANUP_CALLER_MISMATCH",
        "CloudFormation tenant workload cleanup requires the exact Sandbox provisioner caller identity.",
      );
    }
  }

  private receipt(
    input: {
      fence: TenantResourceFence;
      externalFence: TenantExternalOperationFence;
    },
    outcome: TenantWorkloadDestroyReceipt["outcome"],
  ): TenantWorkloadDestroyReceipt {
    return {
      fence: input.fence,
      externalFence: input.externalFence,
      outcome,
      ownershipMarker: input.fence.ownershipMarker,
    };
  }
}
