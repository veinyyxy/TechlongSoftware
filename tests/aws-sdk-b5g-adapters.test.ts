import assert from "node:assert/strict";
import test from "node:test";

import {
  AwsSdkDynamoDbEpochAuthority,
  type AwsSdkDynamoDbEpochAuthorityDependencies,
} from "../lib/deployments/execution/aws-sdk-dynamodb-epoch-authority.ts";
import {
  AwsSdkEcsOneShotTaskApi,
  type AwsSdkEcsOneShotDependencies,
  type EcsOneShotReceiptReader,
} from "../lib/deployments/execution/aws-sdk-ecs-one-shot-api.ts";
import { AwsSdkTenantRuntimeSecretProvider } from "../lib/deployments/execution/aws-sdk-tenant-secret-provider.ts";
import type {
  TenantExternalEpochAuthorityCandidate,
  TenantExternalEpochAuthorityRecord,
} from "../lib/deployments/execution/cloudformation-external-ownership.ts";
import type {
  EcsOneShotTaskRequest,
  TenantDatabaseOneShotReceipt,
} from "../lib/deployments/execution/ecs-one-shot-task.ts";
import { canonicalJson } from "../lib/deployments/execution/hash.ts";
import {
  tenantRuntimeSecretExactJsonKeys,
  type TenantRuntimeSecretOwnershipEvidence,
} from "../lib/deployments/execution/tenant-aws-one-shot-adapters.ts";

class RunTaskCommand {
  readonly kind = "run";
  readonly input: Record<string, unknown>;
  constructor(input: Record<string, unknown>) { this.input = input; }
}
class ListTasksCommand {
  readonly kind = "list";
  readonly input: Record<string, unknown>;
  constructor(input: Record<string, unknown>) { this.input = input; }
}
class DescribeTasksCommand {
  readonly kind = "describe";
  readonly input: Record<string, unknown>;
  constructor(input: Record<string, unknown>) { this.input = input; }
}
class StopTaskCommand {
  readonly kind = "stop";
  readonly input: Record<string, unknown>;
  constructor(input: Record<string, unknown>) { this.input = input; }
}
class DescribeSecretCommand {
  readonly kind = "describe-secret";
  readonly input: Record<string, unknown>;
  constructor(input: Record<string, unknown>) { this.input = input; }
}
class GetSecretValueCommand {
  readonly kind = "get-secret";
  readonly input: Record<string, unknown>;
  constructor(input: Record<string, unknown>) { this.input = input; }
}
class CreateSecretCommand {
  readonly kind = "create-secret";
  readonly input: Record<string, unknown>;
  constructor(input: Record<string, unknown>) { this.input = input; }
}
class GetCallerIdentityCommand {
  readonly kind = "caller-identity";
  readonly input: Record<string, unknown>;
  constructor(input: Record<string, unknown>) { this.input = input; }
}
class GetCommand {
  readonly kind = "get-item";
  readonly input: Record<string, unknown>;
  constructor(input: Record<string, unknown>) { this.input = input; }
}
class PutCommand {
  readonly kind = "put-item";
  readonly input: Record<string, unknown>;
  constructor(input: Record<string, unknown>) { this.input = input; }
}

const accountId = "402010193138";
const region = "ca-central-1";
const clusterName = "techlong-sandbox-cell-one";
const clusterArn = `arn:aws:ecs:${region}:${accountId}:cluster/${clusterName}`;
const taskDefinitionArn =
  `arn:aws:ecs:${region}:${accountId}:task-definition/tenant-lifecycle:7`;
const taskArn =
  `arn:aws:ecs:${region}:${accountId}:task/${clusterName}/` + "1".repeat(32);
const secretName = "techlong/sandbox/tenant/tenant_one_123/runtime/g1";
const secretArn =
  `arn:aws:secretsmanager:${region}:${accountId}:secret:${secretName}-ABC123`;
const workerRoleArn =
  `arn:aws:iam::${accountId}:role/TechlongSandboxProvisionerRole`;
const receiptBucketName =
  `techlong-sandbox-${accountId}-${region}-tenant-receipts`;
const receiptBucketArn = `arn:aws:s3:::${receiptBucketName}`;
const receiptKey =
  `tenant-lifecycle/v1/${"8".repeat(32)}/g1/${"c".repeat(64)}.json`;
const assumedWorkerRoleArn =
  `arn:aws:sts::${accountId}:assumed-role/TechlongSandboxProvisionerRole/b5g-test`;

function ecsRequest(): EcsOneShotTaskRequest {
  return {
    schemaVersion: 1,
    clusterArn,
    taskDefinitionArn,
    launchType: "FARGATE",
    platformVersion: "1.4.0",
    assignPublicIp: "DISABLED",
    subnetIds: ["subnet-0123456789abcdef0"],
    securityGroupIds: ["sg-0123456789abcdef0"],
    container: {
      name: "tenant-database-lifecycle",
      command: ["/usr/local/bin/node", "db/tenant_lifecycle.js", "inspect"],
      environment: {
        TENANT_DATABASE_OPERATION: "inspect",
        TENANT_RUNTIME_SECRET_ARN: secretArn,
        TENANT_RESOURCE_GENERATION: "1",
        TENANT_OWNERSHIP_MARKER: `tl_owner_${"8".repeat(32)}_g1`,
        TENANT_EXTERNAL_OPERATION_EPOCH: "3",
        TENANT_EXTERNAL_OPERATION_MARKER: `tl_epoch_${"8".repeat(24)}_g1_e3`,
        TENANT_EXTERNAL_OPERATION_HASH: "9".repeat(64),
        TENANT_RECEIPT_BUCKET: receiptBucketName,
        TENANT_RECEIPT_EXPECTED_BUCKET_OWNER: accountId,
        TENANT_RECEIPT_KEY: receiptKey,
      },
    },
    receipt: {
      bucketArn: receiptBucketArn,
      key: receiptKey,
    },
    startedBy: `tl-${"a".repeat(12)}-${"b".repeat(16)}`,
    clientToken: "c".repeat(64),
    tags: {
      ManagedBy: "techlong-deployment-worker",
      ResourceGeneration: "1",
      OwnershipMarker: `tl_owner_${"8".repeat(32)}_g1`,
      ExternalOperationEpoch: "3",
      ExternalOperationMarker: `tl_epoch_${"8".repeat(24)}_g1_e3`,
      ExternalOperationHash: "9".repeat(64),
    },
  };
}

function ecsTaskIdentity(request: EcsOneShotTaskRequest): Record<string, unknown> {
  return {
    clusterArn: request.clusterArn,
    taskDefinitionArn: request.taskDefinitionArn,
    startedBy: request.startedBy,
    launchType: request.launchType,
    platformVersion: request.platformVersion,
    enableExecuteCommand: false,
    overrides: {
      containerOverrides: [
        {
          name: request.container.name,
          command: [...request.container.command],
          environment: Object.entries(request.container.environment).map(
            ([name, value]) => ({ name, value }),
          ),
        },
      ],
    },
    tags: Object.entries(request.tags).map(([key, value]) => ({ key, value })),
  };
}

function ecsDependencies(input: {
  send: AwsSdkEcsOneShotDependencies["client"]["send"];
  receiptReader?: EcsOneShotReceiptReader;
}): AwsSdkEcsOneShotDependencies {
  return {
    client: { send: input.send },
    commands: {
      runTask: RunTaskCommand,
      listTasks: ListTasksCommand,
      describeTasks: DescribeTasksCommand,
      stopTask: StopTaskCommand,
    },
    receiptReader:
      input.receiptReader ??
      ({ read: async () => null } satisfies EcsOneShotReceiptReader),
  };
}

function ecsApi(sdk: AwsSdkEcsOneShotDependencies): AwsSdkEcsOneShotTaskApi {
  return new AwsSdkEcsOneShotTaskApi(
    {
      expectedAccountId: accountId,
      expectedRegion: region,
      clusterArn,
      receiptBucketArn,
      allowedTaskDefinitionArns: [taskDefinitionArn],
      allowedCommandByTaskDefinitionArn: {
        [taskDefinitionArn]: [
          "/usr/local/bin/node",
          "db/tenant_lifecycle.js",
          "inspect",
        ],
      },
      expectedContainerName: "tenant-database-lifecycle",
      allowedSubnetIds: ["subnet-0123456789abcdef0"],
      allowedSecurityGroupIds: ["sg-0123456789abcdef0"],
      maximumListPages: 2,
    },
    sdk,
  );
}

test("AWS ECS adapter sends an exact one-task Fargate request with the caller signal", async () => {
  const controller = new AbortController();
  const observedInputs: Record<string, unknown>[] = [];
  const api = ecsApi(
    ecsDependencies({
      send: async (command, options) => {
        assert.equal(options?.abortSignal, controller.signal);
        const typed = command as RunTaskCommand;
        assert.equal(typed.kind, "run");
        observedInputs.push(typed.input);
        return { tasks: [{ taskArn }], failures: [] };
      },
    }),
  );

  assert.deepEqual(
    await api.runTask({ request: ecsRequest(), signal: controller.signal }),
    { taskArn },
  );
  const observedInput = observedInputs[0];
  assert.equal(observedInput.cluster, clusterArn);
  assert.equal(observedInput.taskDefinition, taskDefinitionArn);
  assert.equal(observedInput.count, 1);
  assert.equal(observedInput.enableExecuteCommand, false);
  assert.deepEqual(observedInput.networkConfiguration, {
    awsvpcConfiguration: {
      subnets: ["subnet-0123456789abcdef0"],
      securityGroups: ["sg-0123456789abcdef0"],
      assignPublicIp: "DISABLED",
    },
  });
});

test("AWS ECS adapter rejects task ARNs outside the exact configured cluster", async () => {
  const foreignTaskArn =
    `arn:aws:ecs:${region}:${accountId}:task/another-cluster/` + "2".repeat(32);
  const api = ecsApi(
    ecsDependencies({
      send: async () => ({ tasks: [{ taskArn: foreignTaskArn }], failures: [] }),
    }),
  );
  await assert.rejects(
    api.runTask({ request: ecsRequest(), signal: new AbortController().signal }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "TENANT_ONE_SHOT_TASK_OWNERSHIP_INVALID",
  );
});

test("AWS ECS adapter rejects command and Secret scope drift before the SDK call", async () => {
  let sends = 0;
  const api = ecsApi(
    ecsDependencies({
      send: async () => {
        sends += 1;
        return {};
      },
    }),
  );
  const commandDrift = ecsRequest();
  commandDrift.container.command = [
    "/usr/local/bin/node",
    "db/tenant_lifecycle.js",
    "verify",
  ];
  await assert.rejects(
    api.runTask({
      request: commandDrift,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "TENANT_ONE_SHOT_REQUEST_INVALID",
  );
  const secretDrift = ecsRequest();
  secretDrift.container.environment.TENANT_RUNTIME_SECRET_ARN =
    secretArn.replace(`:${accountId}:`, ":000000000000:");
  await assert.rejects(
    api.runTask({
      request: secretDrift,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "TENANT_ONE_SHOT_REQUEST_INVALID",
  );
  assert.equal(sends, 0);
});

test("AWS ECS startedBy recovery is paginated, bounded and cluster scoped", async () => {
  const controller = new AbortController();
  let calls = 0;
  const secondTaskArn = taskArn.replace(/1{32}$/, "2".repeat(32));
  const api = ecsApi(
    ecsDependencies({
      send: async (command, options) => {
        assert.equal(options?.abortSignal, controller.signal);
        const typed = command as ListTasksCommand;
        assert.equal(typed.kind, "list");
        calls += 1;
        return calls === 1
          ? { taskArns: [taskArn], nextToken: "page-two" }
          : { taskArns: [secondTaskArn] };
      },
    }),
  );
  assert.deepEqual(
    await api.listTaskArnsByStartedBy({
      clusterArn,
      startedBy: ecsRequest().startedBy,
      signal: controller.signal,
    }),
    { taskArns: [taskArn, secondTaskArn] },
  );
  assert.equal(calls, 2);
});

test("AWS ECS describe and stop forward signals and use only allowlisted stop reasons", async () => {
  const controller = new AbortController();
  const request = ecsRequest();
  const receipt = { receiptHash: "d".repeat(64) } as TenantDatabaseOneShotReceipt;
  let describeCount = 0;
  let receiptReads = 0;
  const api = ecsApi(
    ecsDependencies({
      receiptReader: {
        read: async (input) => {
          assert.equal(input.signal, controller.signal);
          assert.equal(input.taskArn, taskArn);
          receiptReads += 1;
          return receipt;
        },
      },
      send: async (command, options) => {
        assert.equal(options?.abortSignal, controller.signal);
        const kind = (command as { kind: string }).kind;
        if (kind === "describe") {
          describeCount += 1;
          return describeCount === 1
            ? {
                tasks: [
                  {
                    taskArn,
                    ...ecsTaskIdentity(request),
                    lastStatus: "RUNNING",
                    desiredStatus: "RUNNING",
                    containers: [
                      { name: "tenant-database-lifecycle", lastStatus: "RUNNING" },
                    ],
                  },
                ],
                failures: [],
              }
            : {
                tasks: [
                  {
                    taskArn,
                    ...ecsTaskIdentity(request),
                    lastStatus: "STOPPED",
                    desiredStatus: "STOPPED",
                    stoppedReason: "Essential container exited",
                    containers: [
                      {
                        name: "tenant-database-lifecycle",
                        lastStatus: "STOPPED",
                        exitCode: 0,
                      },
                    ],
                  },
                ],
                failures: [],
              };
        }
        const stop = command as StopTaskCommand;
        assert.equal(stop.kind, "stop");
        assert.equal(stop.input.reason, "techlong:task_timeout");
        return { task: { taskArn } };
      },
    }),
  );

  assert.equal(
    (await api.describeTask({
      clusterArn,
      taskArn,
      expectedRequest: request,
      signal: controller.signal,
    }))
      .receipt,
    null,
  );
  assert.equal(receiptReads, 0);
  assert.equal(
    (await api.describeTask({
      clusterArn,
      taskArn,
      expectedRequest: request,
      signal: controller.signal,
    }))
      .receipt,
    receipt,
  );
  assert.equal(receiptReads, 1);
  await api.stopTask({
    clusterArn,
    taskArn,
    reason: "task_timeout",
    signal: controller.signal,
  });
});

test("AWS ECS adapter rejects recovered task identity drift before it can be trusted", async () => {
  const request = ecsRequest();
  const api = ecsApi(
    ecsDependencies({
      send: async (command) => {
        assert.equal((command as { kind: string }).kind, "describe");
        return {
          tasks: [
            {
              taskArn,
              ...ecsTaskIdentity(request),
              startedBy: request.startedBy.replace(/b$/, "c"),
              lastStatus: "RUNNING",
              desiredStatus: "RUNNING",
              containers: [
                { name: "tenant-database-lifecycle", lastStatus: "RUNNING" },
              ],
            },
          ],
          failures: [],
        };
      },
    }),
  );
  await assert.rejects(
    api.describeTask({
      clusterArn,
      taskArn,
      expectedRequest: request,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "TENANT_ONE_SHOT_TASK_OWNERSHIP_INVALID",
  );
});

const ownership: TenantRuntimeSecretOwnershipEvidence = {
  resourceGeneration: 1,
  ownershipMarker: `tl_owner_${"8".repeat(32)}_g1`,
  externalEpoch: 3,
  externalMarker: `tl_epoch_${"8".repeat(24)}_g1_e3`,
  externalOperationHash: "9".repeat(64),
};
const versionRef = "a".repeat(32);
const material = {
  database_url: ["postgresql", "://tenant:generated@db.internal/tenant_one"].join(""),
  hmac_secret_key: "generated-hmac-value",
  jwt_secret_key: "generated-jwt-value",
  stripe_secret_key: "generated-stripe-value",
  stripe_webhook_secret: "generated-webhook-value",
};

function secretTags(
  value: TenantRuntimeSecretOwnershipEvidence = ownership,
): Array<{ Key: string; Value: string }> {
  return [
    { Key: "ManagedBy", Value: "techlong-deployment-worker" },
    { Key: "SecretSchema", Value: "techlong-runtime-five-key-v1" },
    { Key: "ResourceGeneration", Value: String(value.resourceGeneration) },
    { Key: "OwnershipMarker", Value: value.ownershipMarker },
  ];
}

function secretOwnership(input: {
  generation?: number;
  epoch: number;
  identityPrefix?: string;
  operationHash: string;
}): TenantRuntimeSecretOwnershipEvidence {
  const generation = input.generation ?? 1;
  const prefix = input.identityPrefix ?? "8".repeat(32);
  return {
    resourceGeneration: generation,
    ownershipMarker: `tl_owner_${prefix}_g${generation}`,
    externalEpoch: input.epoch,
    externalMarker:
      `tl_epoch_${prefix.slice(0, 24)}_g${generation}_e${input.epoch}`,
    externalOperationHash: input.operationHash,
  };
}

test("AWS Secret provider generates once, writes exact tags, and returns no secret material", async () => {
  const controller = new AbortController();
  let describeCalls = 0;
  let generated = 0;
  const createInputs: Record<string, unknown>[] = [];
  const provider = new AwsSdkTenantRuntimeSecretProvider(
    {
      expectedAccountId: accountId,
      expectedRegion: region,
      expectedWorkerRoleArn: workerRoleArn,
    },
    {
      materialGenerator: {
        generate: async (input) => {
          assert.equal(input.signal, controller.signal);
          generated += 1;
          return material;
        },
      },
      client: {
        send: async (command, options) => {
          assert.equal(options?.abortSignal, controller.signal);
          const kind = (command as { kind: string }).kind;
          if (kind === "describe-secret") {
            describeCalls += 1;
            if (describeCalls === 1) {
              throw Object.assign(new Error("missing"), {
                name: "ResourceNotFoundException",
              });
            }
            return {
              ARN: secretArn,
              Name: secretName,
              Tags: secretTags(),
              VersionIdsToStages: { [versionRef]: ["AWSCURRENT"] },
            };
          }
          if (kind === "get-secret") {
            return {
              ARN: secretArn,
              Name: secretName,
              VersionId: versionRef,
              SecretString: JSON.stringify(material),
            };
          }
          createInputs.push((command as CreateSecretCommand).input);
          return { ARN: secretArn, Name: secretName, VersionId: versionRef };
        },
      },
      stsClient: {
        send: async (_command, options) => {
          assert.equal(options?.abortSignal, controller.signal);
          return { Account: accountId, Arn: assumedWorkerRoleArn };
        },
      },
      commands: {
        describeSecret: DescribeSecretCommand,
        getSecretValue: GetSecretValueCommand,
        createSecret: CreateSecretCommand,
        getCallerIdentity: GetCallerIdentityCommand,
      },
    },
  );

  const receipt = await provider.ensureGeneratedSecret({
    secretName,
    requiredJsonKeys: tenantRuntimeSecretExactJsonKeys,
    ownership,
    idempotencyKey: "tenant-secret-create-1",
    signal: controller.signal,
  });
  assert.equal(receipt.outcome, "created");
  assert.equal(receipt.secretArn, secretArn);
  assert.equal(generated, 1);
  const createInput = createInputs[0];
  assert.deepEqual(createInput.Tags, secretTags());
  assert.deepEqual(
    Object.keys(JSON.parse(String(createInput.SecretString))).sort(),
    [...tenantRuntimeSecretExactJsonKeys].sort(),
  );
  const encodedReceipt = JSON.stringify(receipt);
  for (const value of Object.values(material)) {
    assert.equal(encodedReceipt.includes(value), false);
  }
});

test("AWS Secret provider reuses generation-stable ownership across provision epochs without writes", async () => {
  const secondEpoch = secretOwnership({ epoch: 4, operationHash: "7".repeat(64) });
  let reads = 0;
  let writes = 0;
  const provider = new AwsSdkTenantRuntimeSecretProvider(
    {
      expectedAccountId: accountId,
      expectedRegion: region,
      expectedWorkerRoleArn: workerRoleArn,
    },
    {
      materialGenerator: { generate: async () => assert.fail("generation is outside this test") },
      stsClient: { send: async () => assert.fail("stable reuse must not call STS") },
      client: {
        send: async (command) => {
          const kind = (command as { kind: string }).kind;
          if (kind === "describe-secret") {
            reads += 1;
            return {
              ARN: secretArn,
              Name: secretName,
              Tags: secretTags(),
              VersionIdsToStages: { [versionRef]: ["AWSCURRENT"] },
            };
          }
          if (kind === "get-secret") {
            reads += 1;
            return {
              ARN: secretArn,
              Name: secretName,
              VersionId: versionRef,
              SecretString: JSON.stringify(material),
            };
          }
          writes += 1;
          return {};
        },
      },
      commands: {
        describeSecret: DescribeSecretCommand,
        getSecretValue: GetSecretValueCommand,
        createSecret: CreateSecretCommand,
        getCallerIdentity: GetCallerIdentityCommand,
      },
    },
  );

  const first = await provider.inspectSecret({
    secretName,
    expectedJsonKeys: tenantRuntimeSecretExactJsonKeys,
    expectedOwnership: ownership,
    signal: new AbortController().signal,
  });
  const second = await provider.inspectSecret({
    secretName,
    expectedJsonKeys: tenantRuntimeSecretExactJsonKeys,
    expectedOwnership: secondEpoch,
    signal: new AbortController().signal,
  });
  assert.deepEqual(first.ownership, ownership);
  assert.deepEqual(second.ownership, secondEpoch);
  assert.equal(reads, 4);
  assert.equal(writes, 0);
});

test("AWS Secret provider rejects foreign owner and generation before any Secret write", async () => {
  let writes = 0;
  const provider = new AwsSdkTenantRuntimeSecretProvider(
    {
      expectedAccountId: accountId,
      expectedRegion: region,
      expectedWorkerRoleArn: workerRoleArn,
    },
    {
      materialGenerator: { generate: async () => assert.fail("generation is outside this test") },
      stsClient: { send: async () => assert.fail("invalid ownership must not call STS") },
      client: {
        send: async (command) => {
          if ((command as { kind: string }).kind !== "describe-secret") {
            writes += 1;
            return {};
          }
          return {
            ARN: secretArn,
            Name: secretName,
            Tags: secretTags(),
            VersionIdsToStages: { [versionRef]: ["AWSCURRENT"] },
          };
        },
      },
      commands: {
        describeSecret: DescribeSecretCommand,
        getSecretValue: GetSecretValueCommand,
        createSecret: CreateSecretCommand,
        getCallerIdentity: GetCallerIdentityCommand,
      },
    },
  );
  const foreign = secretOwnership({
    epoch: 4,
    identityPrefix: "7".repeat(32),
    operationHash: "6".repeat(64),
  });
  await assert.rejects(
    provider.inspectSecret({
      secretName,
      expectedJsonKeys: tenantRuntimeSecretExactJsonKeys,
      expectedOwnership: foreign,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "TENANT_SECRET_OWNERSHIP_MISMATCH",
  );
  const nextGeneration = secretOwnership({
    generation: 2,
    epoch: 1,
    operationHash: "6".repeat(64),
  });
  await assert.rejects(
    provider.inspectSecret({
      secretName,
      expectedJsonKeys: tenantRuntimeSecretExactJsonKeys,
      expectedOwnership: nextGeneration,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "TENANT_SECRET_OWNERSHIP_MISMATCH",
  );
  assert.equal(writes, 0);
});

test("AWS Secret provider rejects schema drift and keeps deletion fail closed before AWS", async () => {
  let sends = 0;
  const provider = new AwsSdkTenantRuntimeSecretProvider(
    {
      expectedAccountId: accountId,
      expectedRegion: region,
      expectedWorkerRoleArn: workerRoleArn,
    },
    {
      materialGenerator: { generate: async () => material },
      stsClient: { send: async () => assert.fail("STS is outside this test") },
      client: {
        send: async (command) => {
          sends += 1;
          if ((command as { kind: string }).kind === "describe-secret") {
            return {
              ARN: secretArn,
              Name: secretName,
              Tags: secretTags(),
              VersionIdsToStages: { [versionRef]: ["AWSCURRENT"] },
            };
          }
          return {
            ARN: secretArn,
            Name: secretName,
            VersionId: versionRef,
            SecretString: JSON.stringify({ ...material, unexpected: "value" }),
          };
        },
      },
      commands: {
        describeSecret: DescribeSecretCommand,
        getSecretValue: GetSecretValueCommand,
        createSecret: CreateSecretCommand,
        getCallerIdentity: GetCallerIdentityCommand,
      },
    },
  );
  await assert.rejects(
    provider.inspectSecret({
      secretName,
      expectedJsonKeys: tenantRuntimeSecretExactJsonKeys,
      expectedOwnership: ownership,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "TENANT_SECRET_SCHEMA_INVALID",
  );
  const beforeDelete = sends;
  await assert.rejects(
    provider.deleteSecret({
      secretName,
      expectedOwnership: ownership,
      idempotencyKey: "tenant-secret-delete-1",
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "TENANT_SECRET_CLEANUP_PREDECESSOR_UNAVAILABLE",
  );
  assert.equal(sends, beforeDelete);
});

const stableIdentityHash = "a".repeat(64);
const authorityKey = `tenant:${stableIdentityHash}`;
const tableArn =
  `arn:aws:dynamodb:${region}:${accountId}:table/techlong-sandbox-tenant-epoch`;

function candidate(input: {
  generation?: number;
  epoch?: number;
  intent?: "provision" | "cleanup";
  operationHash?: string;
} = {}): TenantExternalEpochAuthorityCandidate {
  const generation = input.generation ?? 1;
  const epoch = input.epoch ?? 1;
  return {
    schemaVersion: 1,
    stableIdentityHash,
    generation,
    epoch,
    intent: input.intent ?? "provision",
    ownerDeploymentId: "dep-one",
    operationHash: input.operationHash ?? String(epoch).repeat(64).slice(0, 64),
    marker: `tl_epoch_${stableIdentityHash.slice(0, 24)}_g${generation}_e${epoch}`,
  };
}

function ddbDependencies(
  send: AwsSdkDynamoDbEpochAuthorityDependencies["client"]["send"],
): AwsSdkDynamoDbEpochAuthorityDependencies {
  return {
    client: { send },
    commands: { get: GetCommand, put: PutCommand },
  };
}

test("DynamoDB authority installs generation one with one conditional Put and derived null predecessor", async () => {
  const controller = new AbortController();
  let item: Record<string, unknown> | undefined;
  const getInputs: Record<string, unknown>[] = [];
  const putInputs: Record<string, unknown>[] = [];
  const authority = new AwsSdkDynamoDbEpochAuthority(
    { tableArn },
    ddbDependencies(async (command, options) => {
      assert.equal(options?.abortSignal, controller.signal);
      if ((command as { kind: string }).kind === "get-item") {
        getInputs.push((command as GetCommand).input);
        return { Item: item };
      }
      const putInput = (command as PutCommand).input;
      putInputs.push(putInput);
      item = putInput.Item as Record<string, unknown>;
      return {};
    }),
  );
  const before = await authority.observe({ authorityKey, signal: controller.signal });
  assert.deepEqual(before, { authorityKey, revision: "rev:0", record: null });
  const result = await authority.compareAndSet({
    authorityKey,
    expected: before,
    next: candidate(),
    signal: controller.signal,
  });
  assert.equal(result.applied, true);
  assert.equal(result.snapshot.revision, "rev:1");
  assert.equal(result.snapshot.record?.predecessor, null);
  assert.equal(getInputs[0].TableName, tableArn);
  assert.equal(putInputs[0].ConditionExpression, "attribute_not_exists(#authorityKey)");
  assert.equal(putInputs[0].TableName, tableArn);
  assert.equal(JSON.parse(String(item?.record_json)).predecessor, null);
});

test("DynamoDB authority condition compares revision and full record while deriving one predecessor coordinate", async () => {
  const first = candidate();
  const current: TenantExternalEpochAuthorityRecord = {
    ...first,
    predecessor: null,
  };
  let item: Record<string, unknown> = {
    authority_key: authorityKey,
    schema_version: 1,
    revision: 1,
    record_json: canonicalJson(current),
  };
  const putInputs: Record<string, unknown>[] = [];
  const authority = new AwsSdkDynamoDbEpochAuthority(
    { tableArn },
    ddbDependencies(async (command) => {
      if ((command as { kind: string }).kind === "get-item") return { Item: item };
      const putInput = (command as PutCommand).input;
      putInputs.push(putInput);
      item = putInput.Item as Record<string, unknown>;
      return {};
    }),
  );
  const before = await authority.observe({
    authorityKey,
    signal: new AbortController().signal,
  });
  const result = await authority.compareAndSet({
    authorityKey,
    expected: before,
    next: candidate({ epoch: 2, operationHash: "b".repeat(64) }),
    signal: new AbortController().signal,
  });
  assert.equal(result.applied, true);
  assert.equal(
    putInputs[0].ConditionExpression,
    "#revision = :expectedRevision AND #recordJson = :expectedRecordJson",
  );
  assert.deepEqual(result.snapshot.record?.predecessor, {
    schemaVersion: 1,
    generation: 1,
    epoch: 1,
    intent: "provision",
    ownerDeploymentId: "dep-one",
    operationHash: first.operationHash,
    marker: first.marker,
  });
});

test("DynamoDB authority reports a CAS conflict using a fresh consistent read", async () => {
  const current: TenantExternalEpochAuthorityRecord = {
    ...candidate(),
    predecessor: null,
  };
  const winner: TenantExternalEpochAuthorityRecord = {
    ...candidate({ epoch: 2, operationHash: "c".repeat(64) }),
    predecessor: {
      schemaVersion: 1,
      generation: current.generation,
      epoch: current.epoch,
      intent: current.intent,
      ownerDeploymentId: current.ownerDeploymentId,
      operationHash: current.operationHash,
      marker: current.marker,
    },
  };
  let getCalls = 0;
  const authority = new AwsSdkDynamoDbEpochAuthority(
    { tableArn },
    ddbDependencies(async (command) => {
      if ((command as { kind: string }).kind === "put-item") {
        throw Object.assign(new Error("conflict"), {
          name: "ConditionalCheckFailedException",
        });
      }
      getCalls += 1;
      const selected = getCalls === 1 ? current : winner;
      return {
        Item: {
          authority_key: authorityKey,
          schema_version: 1,
          revision: getCalls,
          record_json: canonicalJson(selected),
        },
      };
    }),
  );
  const before = await authority.observe({
    authorityKey,
    signal: new AbortController().signal,
  });
  const result = await authority.compareAndSet({
    authorityKey,
    expected: before,
    next: candidate({ epoch: 2, operationHash: "b".repeat(64) }),
    signal: new AbortController().signal,
  });
  assert.equal(result.applied, false);
  assert.equal(result.snapshot.revision, "rev:2");
  assert.deepEqual(result.snapshot.record, winner);
  assert.equal(getCalls, 2);
});

test("DynamoDB authority rejects skipped generations before issuing a conditional write", async () => {
  let sends = 0;
  const authority = new AwsSdkDynamoDbEpochAuthority(
    { tableArn },
    ddbDependencies(async () => {
      sends += 1;
      return {};
    }),
  );
  await assert.rejects(
    authority.compareAndSet({
      authorityKey,
      expected: { authorityKey, revision: "rev:0", record: null },
      next: candidate({ generation: 2 }),
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "TENANT_EXTERNAL_EPOCH_TRANSITION_INVALID",
  );
  assert.equal(sends, 0);
});
