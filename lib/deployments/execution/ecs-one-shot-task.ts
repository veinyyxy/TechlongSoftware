import type {
  TenantExternalOperationFence,
  TenantProvisionPredecessor,
  TenantResourceFence,
} from "./contracts.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import {
  assertTenantResourceFence,
  TenantDatabaseLifecycleError,
} from "./tenant-database.ts";
import {
  assertTenantProvisionPredecessor,
  requireActiveCleanupProvisionPredecessor,
} from "./external-ownership.ts";

const sha256Pattern = /^[a-f0-9]{64}$/;
const arnPattern =
  /^arn:aws:ecs:([a-z]{2}(?:-gov)?-[a-z]+-\d):(\d{12}):(cluster|task-definition|task)\/[A-Za-z0-9][A-Za-z0-9_./:-]{0,254}$/;
const secretArnPattern =
  /^arn:aws:secretsmanager:[a-z]{2}(?:-gov)?-[a-z]+-\d:\d{12}:secret:techlong\/sandbox\/tenant\/[a-z0-9][a-z0-9_-]{2,63}\/runtime\/g[1-9][0-9]*-[A-Za-z0-9]{6}$/;
const idempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/;
const containerNamePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,126}$/;
const networkIdPattern = /^(subnet|sg)-[a-f0-9]{8,17}$/;
const receiptBucketArnPattern =
  /^arn:aws:s3:::(techlong-sandbox-[a-z0-9][a-z0-9.-]{1,45}[a-z0-9])$/;
const receiptKeyPattern =
  /^tenant-lifecycle\/v1\/([a-f0-9]{32})\/g([1-9][0-9]*)\/([a-f0-9]{64})\.json$/;

export type TenantDatabaseOneShotOperation =
  | "inspect"
  | "prepare_empty_database"
  | "restore_approved_baseline"
  | "migrate_saas"
  | "verify"
  | "destroy";

export interface TenantDatabaseOneShotOutput {
  readonly [key: string]: unknown;
}

export interface TenantDatabaseOneShotReceipt {
  schemaVersion: 1;
  taskArn: string;
  operation: TenantDatabaseOneShotOperation;
  outcome: "succeeded";
  resourceGeneration: number;
  ownershipMarker: string;
  externalEpoch: number;
  externalMarker: string;
  externalOperationHash: string;
  requestHash: string;
  output: TenantDatabaseOneShotOutput;
  outputHash: string;
  receiptHash: string;
}

export interface EcsOneShotTaskObservation {
  taskArn: string;
  lastStatus: "PROVISIONING" | "PENDING" | "ACTIVATING" | "RUNNING" | "DEACTIVATING" | "STOPPING" | "DEPROVISIONING" | "STOPPED";
  desiredStatus: "RUNNING" | "STOPPED";
  exitCode: number | null;
  stoppedReason: string | null;
  receipt: TenantDatabaseOneShotReceipt | null;
}

export interface EcsOneShotTaskRequest {
  schemaVersion: 1;
  clusterArn: string;
  taskDefinitionArn: string;
  launchType: "FARGATE";
  platformVersion: "1.4.0";
  assignPublicIp: "DISABLED";
  subnetIds: readonly string[];
  securityGroupIds: readonly string[];
  container: {
    name: string;
    command: readonly string[];
    environment: {
      TENANT_DATABASE_OPERATION: TenantDatabaseOneShotOperation;
      TENANT_RUNTIME_SECRET_ARN: string;
      TENANT_RESOURCE_GENERATION: string;
      TENANT_OWNERSHIP_MARKER: string;
      TENANT_EXTERNAL_OPERATION_EPOCH: string;
      TENANT_EXTERNAL_OPERATION_MARKER: string;
      TENANT_EXTERNAL_OPERATION_HASH: string;
      TENANT_PREDECESSOR_PROVISION_EPOCH?: string;
      TENANT_PREDECESSOR_PROVISION_MARKER?: string;
      TENANT_PREDECESSOR_PROVISION_OPERATION_HASH?: string;
      TENANT_RECEIPT_BUCKET: string;
      TENANT_RECEIPT_EXPECTED_BUCKET_OWNER: string;
      TENANT_RECEIPT_KEY: string;
      APPROVED_TENANT_BASELINE_SHA256?: string;
    };
  };
  receipt: {
    bucketArn: string;
    key: string;
  };
  startedBy: string;
  clientToken: string;
  tags: {
    ManagedBy: "techlong-deployment-worker";
    ResourceGeneration: string;
    OwnershipMarker: string;
    ExternalOperationEpoch: string;
    ExternalOperationMarker: string;
    ExternalOperationHash: string;
  };
}

/**
 * Deliberately SDK-free provider boundary. A future AWS implementation must
 * forward every signal to the SDK call and must not add log text or secret
 * material to these DTOs.
 */
export interface EcsOneShotTaskApi {
  runTask(input: {
    request: EcsOneShotTaskRequest;
    signal: AbortSignal;
  }): Promise<{ taskArn: string }>;
  listTaskArnsByStartedBy(input: {
    clusterArn: string;
    startedBy: string;
    signal: AbortSignal;
  }): Promise<{ taskArns: string[] }>;
  describeTask(input: {
    clusterArn: string;
    taskArn: string;
    expectedRequest: EcsOneShotTaskRequest;
    signal: AbortSignal;
  }): Promise<EcsOneShotTaskObservation>;
  stopTask(input: {
    clusterArn: string;
    taskArn: string;
    reason:
      | "deployment_lease_lost"
      | "task_timeout"
      | "run_task_outcome_unknown";
    signal: AbortSignal;
  }): Promise<void>;
}

export interface AbortableWaitPort {
  wait(input: { milliseconds: number; signal: AbortSignal }): Promise<void>;
}

export interface EcsOneShotTaskRunnerConfig {
  clusterArn: string;
  receiptBucketArn: string;
  taskDefinitionArnByOperation: Readonly<
    Record<TenantDatabaseOneShotOperation, string>
  >;
  containerName: string;
  subnetIds: readonly string[];
  securityGroupIds: readonly string[];
  commandByOperation: Readonly<
    Record<TenantDatabaseOneShotOperation, readonly string[]>
  >;
  pollIntervalMs: number;
  maximumDescribeAttempts: number;
  abortCleanupTimeoutMs: number;
}

interface TenantDatabaseOneShotInvocationBase {
  operation: TenantDatabaseOneShotOperation;
  fence: TenantResourceFence;
  externalFence: TenantExternalOperationFence;
  runtimeSecretRef: string;
  approvedBaselineDigest: string | null;
  idempotencyKey: string;
  signal: AbortSignal;
}

export type TenantDatabaseOneShotInvocation =
  | (TenantDatabaseOneShotInvocationBase & {
      operation: "destroy";
      provisionPredecessor: TenantProvisionPredecessor;
    })
  | (TenantDatabaseOneShotInvocationBase & {
      operation: Exclude<TenantDatabaseOneShotOperation, "destroy">;
      provisionPredecessor?: never;
    });

const requestKeys = [
  "schemaVersion",
  "clusterArn",
  "taskDefinitionArn",
  "launchType",
  "platformVersion",
  "assignPublicIp",
  "subnetIds",
  "securityGroupIds",
  "container",
  "receipt",
  "startedBy",
  "clientToken",
  "tags",
] as const;
const receiptLocationKeys = ["bucketArn", "key"] as const;
const observationKeys = [
  "taskArn",
  "lastStatus",
  "desiredStatus",
  "exitCode",
  "stoppedReason",
  "receipt",
] as const;
const receiptKeys = [
  "schemaVersion",
  "taskArn",
  "operation",
  "outcome",
  "resourceGeneration",
  "ownershipMarker",
  "externalEpoch",
  "externalMarker",
  "externalOperationHash",
  "requestHash",
  "output",
  "outputHash",
  "receiptHash",
] as const;

function assertExactKeys(
  value: object,
  expected: readonly string[],
  label: string,
): void {
  if (
    canonicalJson(Object.keys(value).sort()) !==
    canonicalJson([...expected].sort())
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_ONE_SHOT_CONTRACT_INVALID",
      `${label} contains missing or unexpected fields.`,
    );
  }
}

function parseArn(
  value: string,
  expectedKind: "cluster" | "task-definition" | "task",
): { region: string; accountId: string } {
  const match = arnPattern.exec(value);
  if (!match || match[3] !== expectedKind) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_ONE_SHOT_ARN_INVALID",
      `ECS ${expectedKind} ARN is invalid.`,
    );
  }
  return { region: match[1], accountId: match[2] };
}

function assertArn(value: string, expectedKind: "cluster" | "task-definition" | "task"): void {
  parseArn(value, expectedKind);
}

function assertAwsScope(
  actual: { accountId: string; region: string },
  expected: { accountId: string; region: string },
  label: string,
): void {
  if (
    actual.accountId !== expected.accountId ||
    actual.region !== expected.region
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_ONE_SHOT_ARN_INVALID",
      `${label} must stay inside the configured ECS account and region.`,
    );
  }
}

export function tenantOneShotReceiptBucketName(bucketArn: string): string {
  const match = receiptBucketArnPattern.exec(bucketArn);
  const bucketName = match?.[1];
  if (
    !bucketName ||
    bucketName.length > 63 ||
    bucketName.includes("..") ||
    bucketName.includes(".-") ||
    bucketName.includes("-.")
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_ONE_SHOT_RECEIPT_LOCATION_INVALID",
      "Tenant one-shot receipt requires a complete, DNS-safe sandbox S3 bucket ARN.",
    );
  }
  return bucketName;
}

export function tenantOneShotExpectedReceiptBucketArn(input: {
  accountId: string;
  region: string;
}): string {
  return (
    `arn:aws:s3:::techlong-sandbox-${input.accountId}-${input.region}-` +
    "tenant-receipts"
  );
}

export function assertTenantRuntimeSecretArn(
  value: string,
  expected?: {
    accountId?: string;
    region?: string;
    physicalSecretName?: string;
  },
): void {
  if (
    !secretArnPattern.test(value) ||
    (expected?.accountId !== undefined && !value.includes(`:${expected.accountId}:secret:`))
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_SECRET_REFERENCE_INVALID",
      "Tenant database tasks accept only a generation-owned runtime Secret ARN.",
    );
  }
  const match = /^arn:aws:secretsmanager:([^:]+):(\d{12}):secret:(.+)-[A-Za-z0-9]{6}$/.exec(
    value,
  );
  if (
    !match ||
    (expected?.region !== undefined && match[1] !== expected.region) ||
    (expected?.accountId !== undefined && match[2] !== expected.accountId) ||
    (expected?.physicalSecretName !== undefined &&
      match[3] !== expected.physicalSecretName)
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_SECRET_REFERENCE_INVALID",
      "Tenant runtime Secret ARN does not match the expected account, region, or physical generation.",
    );
  }
}

function assertActiveExternalFence(
  externalFence: TenantExternalOperationFence,
  fence: TenantResourceFence,
  intent: "provision" | "cleanup",
): TenantProvisionPredecessor | null {
  assertTenantResourceFence(externalFence.resourceFence, fence);
  if (
    externalFence.schemaVersion !== 1 ||
    externalFence.state !== "active" ||
    externalFence.intent !== intent ||
    externalFence.ownerDeploymentId !== fence.ownerDeploymentId ||
    !Number.isSafeInteger(externalFence.epoch) ||
    externalFence.epoch < 1 ||
    !sha256Pattern.test(externalFence.operationHash) ||
    externalFence.marker !==
      `tl_epoch_${fence.identity.stableIdentityHash.slice(0, 24)}` +
        `_g${fence.generation}_e${externalFence.epoch}`
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_EXTERNAL_OWNERSHIP_FENCE_MISMATCH",
      "Tenant one-shot task requires the exact active external operation epoch.",
    );
  }
  if (intent === "cleanup") {
    return requireActiveCleanupProvisionPredecessor(externalFence);
  }
  if (externalFence.provisionPredecessor !== undefined) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_EXTERNAL_OWNERSHIP_FENCE_MISMATCH",
      "A provision task cannot carry cleanup predecessor evidence.",
    );
  }
  return null;
}

function assertConfig(config: EcsOneShotTaskRunnerConfig): void {
  const cluster = parseArn(config.clusterArn, "cluster");
  tenantOneShotReceiptBucketName(config.receiptBucketArn);
  if (
    config.receiptBucketArn !== tenantOneShotExpectedReceiptBucketArn(cluster)
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_ONE_SHOT_CONFIG_INVALID",
      "Tenant receipt bucket must encode the configured ECS account and region.",
    );
  }
  for (const operation of tenantDatabaseOneShotOperations) {
    const taskDefinition = parseArn(
      config.taskDefinitionArnByOperation[operation],
      "task-definition",
    );
    if (
      taskDefinition.accountId !== cluster.accountId ||
      taskDefinition.region !== cluster.region
    ) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_ONE_SHOT_CONFIG_INVALID",
        "Tenant one-shot cluster and task definitions must share one AWS account and region.",
      );
    }
    const command = config.commandByOperation[operation];
    if (
      !Array.isArray(command) ||
      command.length > 8 ||
      command.some(
        (item) =>
          typeof item !== "string" ||
          !item ||
          item.length > 160 ||
          /[\r\n\0]/.test(item) ||
          /(?:password|database_url|postgres(?:ql)?:\/\/|secret[_-]?value)/i.test(item),
      )
    ) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_ONE_SHOT_COMMAND_INVALID",
        "Tenant one-shot command is not an approved secret-free command vector.",
      );
    }
    if (
      canonicalJson(command) !==
      canonicalJson(approvedTenantDatabaseOneShotCommands[operation])
    ) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_ONE_SHOT_COMMAND_INVALID",
        "Tenant one-shot command vector is outside the reviewed code-owned allowlist.",
      );
    }
  }
  for (const operation of tenantDatabaseOneShotOperations) {
    if (
      canonicalJson(config.commandByOperation[operation]) !==
      canonicalJson([
        "/usr/local/bin/node",
        "db/tenant_lifecycle.js",
        operation,
      ])
    ) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_ONE_SHOT_COMMAND_INVALID",
        "Every database lifecycle operation must use the reviewed unified SpeedFeast task entrypoint.",
      );
    }
  }
  if (!containerNamePattern.test(config.containerName)) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_ONE_SHOT_CONFIG_INVALID",
      "Tenant one-shot container name is invalid.",
    );
  }
  if (
    config.subnetIds.length < 1 ||
    config.subnetIds.length > 6 ||
    config.securityGroupIds.length < 1 ||
    config.securityGroupIds.length > 5 ||
    [...config.subnetIds, ...config.securityGroupIds].some(
      (value) => !networkIdPattern.test(value),
    ) ||
    new Set(config.subnetIds).size !== config.subnetIds.length ||
    new Set(config.securityGroupIds).size !== config.securityGroupIds.length ||
    !Number.isSafeInteger(config.pollIntervalMs) ||
    config.pollIntervalMs < 0 ||
    config.pollIntervalMs > 30_000 ||
    !Number.isSafeInteger(config.maximumDescribeAttempts) ||
    config.maximumDescribeAttempts < 1 ||
    config.maximumDescribeAttempts > 600 ||
    !Number.isSafeInteger(config.abortCleanupTimeoutMs) ||
    config.abortCleanupTimeoutMs < 1_000 ||
    config.abortCleanupTimeoutMs > 300_000
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_ONE_SHOT_CONFIG_INVALID",
      "Tenant one-shot task network or polling configuration is invalid.",
    );
  }
}

export const tenantDatabaseOneShotOperations = [
  "inspect",
  "prepare_empty_database",
  "restore_approved_baseline",
  "migrate_saas",
  "verify",
  "destroy",
] as const satisfies readonly TenantDatabaseOneShotOperation[];

/**
 * Command vectors are code-owned, not deployment input. The lifecycle helper
 * image is intentionally not wired yet. All operations share one reviewed
 * SpeedFeast entrypoint so task definitions cannot substitute ad-hoc scripts.
 */
export const approvedTenantDatabaseOneShotCommands = {
  inspect: ["/usr/local/bin/node", "db/tenant_lifecycle.js", "inspect"],
  prepare_empty_database: [
    "/usr/local/bin/node",
    "db/tenant_lifecycle.js",
    "prepare_empty_database",
  ],
  restore_approved_baseline: [
    "/usr/local/bin/node",
    "db/tenant_lifecycle.js",
    "restore_approved_baseline",
  ],
  migrate_saas: [
    "/usr/local/bin/node",
    "db/tenant_lifecycle.js",
    "migrate_saas",
  ],
  verify: ["/usr/local/bin/node", "db/tenant_lifecycle.js", "verify"],
  destroy: ["/usr/local/bin/node", "db/tenant_lifecycle.js", "destroy"],
} as const satisfies Readonly<
  Record<TenantDatabaseOneShotOperation, readonly string[]>
>;

function requestHashInput(request: EcsOneShotTaskRequest): Record<string, unknown> {
  return {
    schemaVersion: request.schemaVersion,
    clusterArn: request.clusterArn,
    taskDefinitionArn: request.taskDefinitionArn,
    launchType: request.launchType,
    platformVersion: request.platformVersion,
    assignPublicIp: request.assignPublicIp,
    subnetIds: request.subnetIds,
    securityGroupIds: request.securityGroupIds,
    container: request.container,
    receipt: request.receipt,
    tags: request.tags,
  };
}

export async function tenantOneShotRequestHash(
  request: EcsOneShotTaskRequest,
): Promise<string> {
  return sha256Hex(requestHashInput(request));
}

export async function tenantOneShotReceiptHash(
  receipt: Omit<TenantDatabaseOneShotReceipt, "receiptHash">,
): Promise<string> {
  return sha256Hex(receipt);
}

function receiptHashInput(
  receipt: TenantDatabaseOneShotReceipt,
): Omit<TenantDatabaseOneShotReceipt, "receiptHash"> {
  return Object.fromEntries(
    Object.entries(receipt).filter(([key]) => key !== "receiptHash"),
  ) as unknown as Omit<TenantDatabaseOneShotReceipt, "receiptHash">;
}

function assertSafeOutput(value: TenantDatabaseOneShotOutput): void {
  const encoded = canonicalJson(value);
  if (
    encoded.length > 16_384 ||
    /(?:password|database[_-]?url|postgres(?:ql)?:\/\/|secret[_-]?value|access[_-]?token|private[_-]?key)/i.test(
      encoded,
    )
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_ONE_SHOT_RECEIPT_UNSAFE",
      "Tenant one-shot receipt contains forbidden secret material.",
    );
  }
}

async function assertReceipt(
  receipt: TenantDatabaseOneShotReceipt,
  expected: {
    taskArn: string;
    operation: TenantDatabaseOneShotOperation;
    fence: TenantResourceFence;
    externalFence: TenantExternalOperationFence;
    requestHash: string;
  },
): Promise<void> {
  assertExactKeys(receipt, receiptKeys, "Tenant one-shot receipt");
  assertArn(receipt.taskArn, "task");
  assertSafeOutput(receipt.output);
  const calculatedOutputHash = await sha256Hex(receipt.output);
  const calculatedReceiptHash = await tenantOneShotReceiptHash(
    receiptHashInput(receipt),
  );
  if (
    receipt.schemaVersion !== 1 ||
    receipt.taskArn !== expected.taskArn ||
    receipt.operation !== expected.operation ||
    receipt.outcome !== "succeeded" ||
    receipt.resourceGeneration !== expected.fence.generation ||
    receipt.ownershipMarker !== expected.fence.ownershipMarker ||
    receipt.externalEpoch !== expected.externalFence.epoch ||
    receipt.externalMarker !== expected.externalFence.marker ||
    receipt.externalOperationHash !== expected.externalFence.operationHash ||
    receipt.requestHash !== expected.requestHash ||
    receipt.outputHash !== calculatedOutputHash ||
    receipt.receiptHash !== calculatedReceiptHash
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_ONE_SHOT_RECEIPT_INVALID",
      "Tenant one-shot receipt is stale, foreign, or not hash-bound.",
    );
  }
}

function assertObservation(
  observation: EcsOneShotTaskObservation,
  taskArn: string,
): void {
  assertExactKeys(observation, observationKeys, "ECS one-shot observation");
  if (
    observation.taskArn !== taskArn ||
    ![
      "PROVISIONING",
      "PENDING",
      "ACTIVATING",
      "RUNNING",
      "DEACTIVATING",
      "STOPPING",
      "DEPROVISIONING",
      "STOPPED",
    ].includes(observation.lastStatus) ||
    !["RUNNING", "STOPPED"].includes(observation.desiredStatus) ||
    (observation.lastStatus !== "STOPPED" &&
      (observation.exitCode !== null ||
        observation.stoppedReason !== null ||
        observation.receipt !== null))
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_ONE_SHOT_OBSERVATION_INVALID",
      "ECS one-shot task observation is malformed or belongs to another task.",
    );
  }
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Deployment lease was lost.", "AbortError");
}

/**
 * Runs exactly one ECS task and returns only a hash-bound, allowlisted receipt.
 * If the deployment lease is aborted after launch, it uses an independent,
 * bounded cleanup signal to StopTask and does not surface the abort until a
 * subsequent DescribeTasks observation proves STOPPED.
 */
export class EcsOneShotTaskRunner {
  private readonly api: EcsOneShotTaskApi;
  private readonly waiter: AbortableWaitPort;
  private readonly config: EcsOneShotTaskRunnerConfig;
  private readonly aws: { accountId: string; region: string };

  constructor(input: {
    api: EcsOneShotTaskApi;
    waiter: AbortableWaitPort;
    config: EcsOneShotTaskRunnerConfig;
  }) {
    assertConfig(input.config);
    this.api = input.api;
    this.waiter = input.waiter;
    this.config = input.config;
    this.aws = parseArn(input.config.clusterArn, "cluster");
  }

  async execute(input: TenantDatabaseOneShotInvocation): Promise<TenantDatabaseOneShotReceipt> {
    input.signal.throwIfAborted();
    assertTenantResourceFence(input.fence);
    const provisionPredecessor = assertActiveExternalFence(
      input.externalFence,
      input.fence,
      input.operation === "destroy" ? "cleanup" : "provision",
    );
    if (input.operation === "destroy") {
      assertTenantProvisionPredecessor(
        input.provisionPredecessor,
        input.fence,
        input.externalFence.epoch,
        provisionPredecessor ?? undefined,
      );
    } else if (
      Object.prototype.hasOwnProperty.call(input, "provisionPredecessor")
    ) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_CLEANUP_PROVISION_PREDECESSOR_INVALID",
        "Provision tasks must not carry cleanup predecessor evidence.",
      );
    }
    assertTenantRuntimeSecretArn(input.runtimeSecretRef, {
      ...this.aws,
      physicalSecretName:
        `${input.fence.identity.secretName}/g${input.fence.generation}`,
    });
    if (!idempotencyKeyPattern.test(input.idempotencyKey)) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_IDEMPOTENCY_KEY_INVALID",
        "Tenant one-shot task idempotency key is invalid.",
      );
    }
    if (
      input.approvedBaselineDigest !== null &&
      !sha256Pattern.test(input.approvedBaselineDigest)
    ) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_BASELINE_INVALID",
        "Tenant one-shot task baseline digest is invalid.",
      );
    }
    if (
      ["restore_approved_baseline", "migrate_saas", "verify"].includes(
        input.operation,
      ) !== (input.approvedBaselineDigest !== null)
    ) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_BASELINE_INVALID",
        "Only baseline, SaaS migration, and verification tasks accept the approved baseline digest.",
      );
    }

    const idempotencyHash = await sha256Hex(input.idempotencyKey);
    const receiptBucket = tenantOneShotReceiptBucketName(
      this.config.receiptBucketArn,
    );
    const receiptOwner = /^tl_owner_([a-f0-9]{32})_g([1-9][0-9]*)$/.exec(
      input.fence.ownershipMarker,
    );
    if (
      !receiptOwner ||
      Number(receiptOwner[2]) !== input.fence.generation
    ) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_ONE_SHOT_RECEIPT_LOCATION_INVALID",
        "Tenant one-shot receipt key requires the exact tenant generation owner.",
      );
    }
    const receiptKey =
      `tenant-lifecycle/v1/${receiptOwner[1]}/g${input.fence.generation}/` +
      `${idempotencyHash}.json`;
    const environment: EcsOneShotTaskRequest["container"]["environment"] = {
      TENANT_DATABASE_OPERATION: input.operation,
      TENANT_RUNTIME_SECRET_ARN: input.runtimeSecretRef,
      TENANT_RESOURCE_GENERATION: String(input.fence.generation),
      TENANT_OWNERSHIP_MARKER: input.fence.ownershipMarker,
      TENANT_EXTERNAL_OPERATION_EPOCH: String(input.externalFence.epoch),
      TENANT_EXTERNAL_OPERATION_MARKER: input.externalFence.marker,
      TENANT_EXTERNAL_OPERATION_HASH: input.externalFence.operationHash,
      TENANT_RECEIPT_BUCKET: receiptBucket,
      TENANT_RECEIPT_EXPECTED_BUCKET_OWNER: this.aws.accountId,
      TENANT_RECEIPT_KEY: receiptKey,
    };
    if (input.operation === "destroy") {
      environment.TENANT_PREDECESSOR_PROVISION_EPOCH = String(
        input.provisionPredecessor.epoch,
      );
      environment.TENANT_PREDECESSOR_PROVISION_MARKER =
        input.provisionPredecessor.marker;
      environment.TENANT_PREDECESSOR_PROVISION_OPERATION_HASH =
        input.provisionPredecessor.operationHash;
    }
    if (input.approvedBaselineDigest !== null) {
      environment.APPROVED_TENANT_BASELINE_SHA256 =
        input.approvedBaselineDigest;
    }
    const draft: EcsOneShotTaskRequest = {
      schemaVersion: 1,
      clusterArn: this.config.clusterArn,
      taskDefinitionArn:
        this.config.taskDefinitionArnByOperation[input.operation],
      launchType: "FARGATE",
      platformVersion: "1.4.0",
      assignPublicIp: "DISABLED",
      subnetIds: [...this.config.subnetIds],
      securityGroupIds: [...this.config.securityGroupIds],
      container: {
        name: this.config.containerName,
        command: [...this.config.commandByOperation[input.operation]],
        environment,
      },
      receipt: {
        bucketArn: this.config.receiptBucketArn,
        key: receiptKey,
      },
      startedBy: "tl-pending-request-hash",
      clientToken: idempotencyHash,
      tags: {
        ManagedBy: "techlong-deployment-worker",
        ResourceGeneration: String(input.fence.generation),
        OwnershipMarker: input.fence.ownershipMarker,
        ExternalOperationEpoch: String(input.externalFence.epoch),
        ExternalOperationMarker: input.externalFence.marker,
        ExternalOperationHash: input.externalFence.operationHash,
      },
    };
    assertExactKeys(draft, requestKeys, "ECS one-shot request");
    assertExactKeys(
      draft.receipt,
      receiptLocationKeys,
      "ECS one-shot receipt location",
    );
    if (
      !receiptKeyPattern.test(draft.receipt.key) ||
      draft.receipt.key !== receiptKey ||
      draft.container.environment.TENANT_RECEIPT_BUCKET !== receiptBucket ||
      draft.container.environment.TENANT_RECEIPT_EXPECTED_BUCKET_OWNER !==
        this.aws.accountId ||
      draft.container.environment.TENANT_RECEIPT_KEY !== draft.receipt.key
    ) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_ONE_SHOT_RECEIPT_LOCATION_INVALID",
        "Tenant one-shot receipt location is not bound to the idempotency hash.",
      );
    }
    assertSafeOutput(draft as unknown as TenantDatabaseOneShotOutput);
    const requestHash = await tenantOneShotRequestHash(draft);
    draft.startedBy =
      `tl-${idempotencyHash.slice(0, 12)}-` + requestHash.slice(0, 16);
    let taskArn: string | null = null;
    let stoppedObserved = false;
    try {
      // Do not abort an in-flight RunTask with the lease signal: AWS may have
      // accepted it before the client sees the abort, leaving no task ARN to
      // stop. An independent deadline lets the call return its ARN; the lease
      // is checked immediately afterwards and then uses StopTask.
      const launchSignal = AbortSignal.timeout(
        this.config.abortCleanupTimeoutMs,
      );
      const launched = await this.api.runTask({
        request: draft,
        signal: launchSignal,
      });
      assertExactKeys(launched, ["taskArn"], "ECS RunTask result");
      taskArn = launched.taskArn;
      assertAwsScope(parseArn(taskArn, "task"), this.aws, "ECS task ARN");
      input.signal.throwIfAborted();
      for (
        let attempt = 0;
        attempt < this.config.maximumDescribeAttempts;
        attempt += 1
      ) {
        input.signal.throwIfAborted();
        const observation = await this.api.describeTask({
          clusterArn: this.config.clusterArn,
          taskArn,
          expectedRequest: draft,
          signal: input.signal,
        });
        assertObservation(observation, taskArn);
        if (observation.lastStatus === "STOPPED") {
          stoppedObserved = true;
          if (
            observation.desiredStatus !== "STOPPED" ||
            observation.exitCode !== 0 ||
            !observation.receipt
          ) {
            throw new TenantDatabaseLifecycleError(
              "TENANT_ONE_SHOT_TASK_FAILED",
              "Tenant one-shot task stopped without a successful receipt.",
              true,
            );
          }
          await assertReceipt(observation.receipt, {
            taskArn,
            operation: input.operation,
            fence: input.fence,
            externalFence: input.externalFence,
            requestHash,
          });
          input.signal.throwIfAborted();
          return observation.receipt;
        }
        await this.waiter.wait({
          milliseconds: this.config.pollIntervalMs,
          signal: input.signal,
        });
      }
      throw new TenantDatabaseLifecycleError(
        "TENANT_ONE_SHOT_TASK_TIMEOUT",
        "Tenant one-shot task did not stop inside the reviewed polling bound.",
        true,
      );
    } catch (error) {
      if (stoppedObserved) throw error;
      if (taskArn === null) {
        const recoveredTaskArns = await this.recoverTaskArns(draft.startedBy);
        if (recoveredTaskArns.length === 0) {
          if (input.signal.aborted) throw abortError(input.signal);
          throw error;
        }
        const stopResults = await Promise.allSettled(
          recoveredTaskArns.map((recoveredTaskArn) =>
            this.stopAndConfirm(
              recoveredTaskArn,
              "run_task_outcome_unknown",
              draft,
              true,
            ),
          ),
        );
        const failedStop = stopResults.find(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        if (failedStop) throw failedStop.reason;
        if (recoveredTaskArns.length > 1) {
          throw new TenantDatabaseLifecycleError(
            "TENANT_ONE_SHOT_MULTIPLE_TASKS",
            "More than one ECS task matched an exact one-shot startedBy token; all recovered tasks were stopped.",
          );
        }
        if (input.signal.aborted) throw abortError(input.signal);
        throw error;
      }
      await this.stopAndConfirm(
        taskArn,
        input.signal.aborted ? "deployment_lease_lost" : "task_timeout",
        draft,
        false,
      );
      if (input.signal.aborted) throw abortError(input.signal);
      throw error;
    }
  }

  private async recoverTaskArns(startedBy: string): Promise<string[]> {
    const recoverySignal = AbortSignal.timeout(
      this.config.abortCleanupTimeoutMs,
    );
    let lastProviderError: unknown = null;
    for (
      let attempt = 0;
      attempt < this.config.maximumDescribeAttempts;
      attempt += 1
    ) {
      try {
        const result = await this.api.listTaskArnsByStartedBy({
          clusterArn: this.config.clusterArn,
          startedBy,
          signal: recoverySignal,
        });
        assertExactKeys(result, ["taskArns"], "ECS startedBy recovery result");
        if (
          !Array.isArray(result.taskArns) ||
          result.taskArns.length > 100 ||
          new Set(result.taskArns).size !== result.taskArns.length
        ) {
          throw new TenantDatabaseLifecycleError(
            "TENANT_ONE_SHOT_RECOVERY_INVALID",
            "ECS startedBy recovery returned an invalid or unbounded task set.",
          );
        }
        for (const recoveredTaskArn of result.taskArns) {
          assertAwsScope(
            parseArn(recoveredTaskArn, "task"),
            this.aws,
            "Recovered ECS task ARN",
          );
        }
        if (result.taskArns.length > 0) return result.taskArns;
        lastProviderError = null;
      } catch (error) {
        lastProviderError = error;
      }
      if (attempt + 1 < this.config.maximumDescribeAttempts) {
        try {
          await this.waiter.wait({
            milliseconds: this.config.pollIntervalMs,
            signal: recoverySignal,
          });
        } catch (error) {
          lastProviderError = error;
          break;
        }
      }
    }
    throw new TenantDatabaseLifecycleError(
      "TENANT_ONE_SHOT_RUN_TASK_OUTCOME_UNKNOWN",
      `Tenant one-shot RunTask outcome remains unknown after bounded startedBy recovery${
        lastProviderError instanceof Error
          ? `: ${lastProviderError.message}`
          : "."
      }`,
      true,
    );
  }

  private async stopAndConfirm(
    taskArn: string,
    reason:
      | "deployment_lease_lost"
      | "task_timeout"
      | "run_task_outcome_unknown",
    expectedRequest: EcsOneShotTaskRequest,
    requireIdentityReadback: boolean,
  ): Promise<void> {
    const cleanupSignal = AbortSignal.timeout(this.config.abortCleanupTimeoutMs);
    try {
      // A task recovered from an uncertain RunTask response is not trusted by
      // ARN or startedBy alone. The provider must independently prove its
      // immutable request identity before this runner is allowed to stop it.
      if (requireIdentityReadback) {
        const beforeStop = await this.api.describeTask({
          clusterArn: this.config.clusterArn,
          taskArn,
          expectedRequest,
          signal: cleanupSignal,
        });
        assertObservation(beforeStop, taskArn);
        if (beforeStop.lastStatus === "STOPPED") return;
      }
      await this.api.stopTask({
        clusterArn: this.config.clusterArn,
        taskArn,
        reason,
        signal: cleanupSignal,
      });
      for (
        let attempt = 0;
        attempt < this.config.maximumDescribeAttempts;
        attempt += 1
      ) {
        const observation = await this.api.describeTask({
          clusterArn: this.config.clusterArn,
          taskArn,
          expectedRequest,
          signal: cleanupSignal,
        });
        assertObservation(observation, taskArn);
        if (observation.lastStatus === "STOPPED") return;
        await this.waiter.wait({
          milliseconds: this.config.pollIntervalMs,
          signal: cleanupSignal,
        });
      }
    } catch (error) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_ONE_SHOT_ABORT_CLEANUP_FAILED",
        `Tenant one-shot task could not be confirmed STOPPED after lease loss: ${
          error instanceof Error ? error.message : "unknown provider error"
        }`,
        true,
      );
    }
    throw new TenantDatabaseLifecycleError(
      "TENANT_ONE_SHOT_ABORT_CLEANUP_FAILED",
      "Tenant one-shot task was not confirmed STOPPED after lease loss.",
      true,
    );
  }
}
