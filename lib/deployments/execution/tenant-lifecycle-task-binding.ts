import { canonicalJson } from "./hash.ts";
import {
  approvedTenantDatabaseOneShotCommands,
  tenantDatabaseOneShotOperations,
  tenantOneShotExpectedReceiptBucketArn,
  type TenantDatabaseOneShotOperation,
} from "./ecs-one-shot-task.ts";
import { TenantDatabaseLifecycleError } from "./tenant-database.ts";

const sandboxAccountId = "402010193138";
const sandboxRegion = "ca-central-1";
const sandboxClusterName = "cell-sandbox-1";
const lifecycleFamily = "tenant-lifecycle";
const lifecycleContainerName = "tenant-database-lifecycle";
const lifecycleImageRepository = "techlong-sandbox-speedfeast";
const inputKeys = [
  "expectedAccountId",
  "expectedRegion",
  "imageUri",
  "taskDefinitionArn",
  "clusterArn",
  "taskExecutionRoleArn",
  "lifecycleTaskRoleArn",
  "receiptBucketArn",
  "subnetIds",
  "oneShotSecurityGroupId",
] as const;

const imageUriPattern =
  /^(\d{12})\.dkr\.ecr\.([a-z]{2}(?:-gov)?-[a-z]+-\d)\.amazonaws\.com\/([a-z0-9][a-z0-9._/-]{1,254})@sha256:([a-f0-9]{64})$/;
const taskDefinitionArnPattern =
  /^arn:aws:ecs:([a-z]{2}(?:-gov)?-[a-z]+-\d):(\d{12}):task-definition\/tenant-lifecycle:([1-9][0-9]*)$/;
const clusterArnPattern =
  /^arn:aws:ecs:([a-z]{2}(?:-gov)?-[a-z]+-\d):(\d{12}):cluster\/([A-Za-z0-9][A-Za-z0-9_-]{0,254})$/;
const subnetIdPattern = /^subnet-[a-f0-9]{8,17}$/;
const securityGroupIdPattern = /^sg-[a-f0-9]{8,17}$/;

export interface OfflineTenantLifecycleTaskBindingInput {
  expectedAccountId: string;
  expectedRegion: string;
  imageUri: string;
  taskDefinitionArn: string;
  clusterArn: string;
  taskExecutionRoleArn: string;
  lifecycleTaskRoleArn: string;
  receiptBucketArn: string;
  subnetIds: readonly string[];
  oneShotSecurityGroupId: string;
}

export interface OfflineTenantLifecycleTaskBinding {
  readonly schemaVersion: 1;
  readonly mode: "offline_reviewed_intent";
  readonly registrationReady: false;
  readonly liveReadbackReady: false;
  readonly blocker: "tenant_lifecycle_task_definition_live_readback_missing";
  readonly image: Readonly<{
    uri: string;
    digest: string;
  }>;
  readonly taskDefinition: Readonly<{
    arn: string;
    family: "tenant-lifecycle";
    revision: number;
    executionRoleArn: string;
    taskRoleArn: string;
    containerName: "tenant-database-lifecycle";
  }>;
  readonly clusterArn: string;
  readonly receiptBucketArn: string;
  readonly commands: Readonly<
    Record<TenantDatabaseOneShotOperation, readonly string[]>
  >;
  readonly networkIntent: Readonly<{
    candidateSubnetIds: readonly string[];
    candidateOneShotSecurityGroupId: string;
    assignPublicIp: "ENABLED";
    sharedCellEvidenceReady: false;
  }>;
}

function fail(message: string): never {
  throw new TenantDatabaseLifecycleError(
    "TENANT_LIFECYCLE_TASK_BINDING_INVALID",
    message,
  );
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  return (
    canonicalJson(Object.keys(value).sort()) ===
    canonicalJson([...expected].sort())
  );
}

function frozenCommands(): Readonly<
  Record<TenantDatabaseOneShotOperation, readonly string[]>
> {
  const entries = tenantDatabaseOneShotOperations.map((operation) => [
    operation,
    Object.freeze([...approvedTenantDatabaseOneShotCommands[operation]]),
  ]);
  return Object.freeze(Object.fromEntries(entries)) as Readonly<
    Record<TenantDatabaseOneShotOperation, readonly string[]>
  >;
}

/**
 * Compiles reviewed, immutable intent for one Sandbox lifecycle task revision.
 * It performs no AWS call and deliberately remains unusable by the standalone
 * Worker until a separate live DescribeTaskDefinition readback proves that the
 * revision contains the exact image and roles recorded here.
 */
export function compileOfflineTenantLifecycleTaskBinding(
  input: OfflineTenantLifecycleTaskBindingInput,
): OfflineTenantLifecycleTaskBinding {
  if (!input || typeof input !== "object" || !exactKeys(input, inputKeys)) {
    fail("Lifecycle task binding input contains missing or unexpected fields.");
  }
  if (
    input.expectedAccountId !== sandboxAccountId ||
    input.expectedRegion !== sandboxRegion
  ) {
    fail("Lifecycle task binding is restricted to the reviewed Sandbox account and region.");
  }

  const image = imageUriPattern.exec(input.imageUri);
  if (
    !image ||
    image[1] !== input.expectedAccountId ||
    image[2] !== input.expectedRegion ||
    image[3] !== lifecycleImageRepository
  ) {
    fail("Lifecycle image must use the exact Sandbox ECR repository and an @sha256 digest.");
  }

  const taskDefinition = taskDefinitionArnPattern.exec(input.taskDefinitionArn);
  const revision = Number(taskDefinition?.[3]);
  if (
    !taskDefinition ||
    taskDefinition[1] !== input.expectedRegion ||
    taskDefinition[2] !== input.expectedAccountId ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  ) {
    fail("Lifecycle task definition must be the exact tenant-lifecycle family with an explicit revision.");
  }

  const cluster = clusterArnPattern.exec(input.clusterArn);
  if (
    !cluster ||
    cluster[1] !== input.expectedRegion ||
    cluster[2] !== input.expectedAccountId ||
    cluster[3] !== sandboxClusterName
  ) {
    fail("Lifecycle task cluster must be the exact intended Sandbox Cell cluster ARN.");
  }

  const expectedExecutionRoleArn =
    `arn:aws:iam::${input.expectedAccountId}:role/TechlongSandboxTaskExecutionRole`;
  const expectedTaskRoleArn =
    `arn:aws:iam::${input.expectedAccountId}:role/TechlongSandboxTenantLifecycleTaskRole`;
  if (
    input.taskExecutionRoleArn !== expectedExecutionRoleArn ||
    input.lifecycleTaskRoleArn !== expectedTaskRoleArn
  ) {
    fail("Lifecycle task roles do not match the intended execution and lifecycle role ARNs.");
  }

  if (
    input.receiptBucketArn !==
    tenantOneShotExpectedReceiptBucketArn({
      accountId: input.expectedAccountId,
      region: input.expectedRegion,
    })
  ) {
    fail("Lifecycle receipt bucket does not match the intended account and region.");
  }
  if (
    !Array.isArray(input.subnetIds) ||
    input.subnetIds.length !== 2 ||
    new Set(input.subnetIds).size !== input.subnetIds.length ||
    input.subnetIds.some((value) => !subnetIdPattern.test(value)) ||
    !securityGroupIdPattern.test(input.oneShotSecurityGroupId)
  ) {
    fail("Lifecycle task intent requires exactly two candidate subnet ids and one candidate one-shot security group id.");
  }

  const commands = frozenCommands();
  const candidateSubnetIds = Object.freeze([...input.subnetIds]);

  return Object.freeze({
    schemaVersion: 1 as const,
    mode: "offline_reviewed_intent" as const,
    registrationReady: false as const,
    liveReadbackReady: false as const,
    blocker: "tenant_lifecycle_task_definition_live_readback_missing" as const,
    image: Object.freeze({
      uri: input.imageUri,
      digest: `sha256:${image[4]}`,
    }),
    taskDefinition: Object.freeze({
      arn: input.taskDefinitionArn,
      family: lifecycleFamily,
      revision,
      executionRoleArn: input.taskExecutionRoleArn,
      taskRoleArn: input.lifecycleTaskRoleArn,
      containerName: lifecycleContainerName,
    }),
    clusterArn: input.clusterArn,
    receiptBucketArn: input.receiptBucketArn,
    commands,
    networkIntent: Object.freeze({
      candidateSubnetIds,
      candidateOneShotSecurityGroupId: input.oneShotSecurityGroupId,
      assignPublicIp: "ENABLED" as const,
      sharedCellEvidenceReady: false as const,
    }),
  });
}
