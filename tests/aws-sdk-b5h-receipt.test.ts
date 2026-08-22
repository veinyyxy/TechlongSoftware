import assert from "node:assert/strict";
import test from "node:test";
import {
  AwsSdkEcsOneShotTaskApi,
  type AwsSdkEcsOneShotDependencies,
} from "../lib/deployments/execution/aws-sdk-ecs-one-shot-api.ts";
import {
  AwsSdkS3OneShotReceiptReader,
  MAX_TENANT_ONE_SHOT_RAW_RECEIPT_BYTES,
  type AwsSdkS3OneShotReceiptReaderDependencies,
  type TenantDatabaseOneShotRawResult,
} from "../lib/deployments/execution/aws-sdk-s3-one-shot-receipt-reader.ts";
import {
  tenantOneShotReceiptHash,
  tenantOneShotRequestHash,
  type EcsOneShotTaskRequest,
} from "../lib/deployments/execution/ecs-one-shot-task.ts";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";

class GetObjectCommand {
  readonly input: Record<string, unknown>;
  constructor(input: Record<string, unknown>) {
    this.input = input;
  }
}

class DescribeTasksCommand {
  readonly input: Record<string, unknown>;
  constructor(input: Record<string, unknown>) {
    this.input = input;
  }
}

class UnusedCommand {
  readonly input: Record<string, unknown>;
  constructor(input: Record<string, unknown>) {
    this.input = input;
  }
}

const accountId = "402010193138";
const region = "ca-central-1";
const clusterName = "techlong-sandbox-cell-one";
const clusterArn = `arn:aws:ecs:${region}:${accountId}:cluster/${clusterName}`;
const taskDefinitionArn =
  `arn:aws:ecs:${region}:${accountId}:task-definition/tenant-lifecycle:7`;
const taskArn =
  `arn:aws:ecs:${region}:${accountId}:task/${clusterName}/${"1".repeat(32)}`;
const secretArn =
  `arn:aws:secretsmanager:${region}:${accountId}:secret:` +
  "techlong/sandbox/tenant/tenant_one_123/runtime/g1-ABC123";
const ownerPrefix = "8".repeat(32);
const ownershipMarker = `tl_owner_${ownerPrefix}_g1`;
const externalMarker = `tl_epoch_${"8".repeat(24)}_g1_e3`;
const clientToken = "c".repeat(64);
const receiptBucketName =
  `techlong-sandbox-${accountId}-${region}-tenant-receipts`;
const receiptBucketArn = `arn:aws:s3:::${receiptBucketName}`;
const receiptKey =
  `tenant-lifecycle/v1/${ownerPrefix}/g1/${clientToken}.json`;

function request(): EcsOneShotTaskRequest {
  return {
    schemaVersion: 1,
    clusterArn,
    taskDefinitionArn,
    launchType: "FARGATE",
    platformVersion: "1.4.0",
    assignPublicIp: "ENABLED",
    subnetIds: ["subnet-0123456789abcdef0"],
    securityGroupIds: ["sg-0123456789abcdef0"],
    container: {
      name: "tenant-database-lifecycle",
      command: ["/usr/local/bin/node", "db/tenant_lifecycle.js", "inspect"],
      environment: {
        TENANT_DATABASE_OPERATION: "inspect",
        TENANT_RUNTIME_SECRET_ARN: secretArn,
        TENANT_RESOURCE_GENERATION: "1",
        TENANT_OWNERSHIP_MARKER: ownershipMarker,
        TENANT_EXTERNAL_OPERATION_EPOCH: "3",
        TENANT_EXTERNAL_OPERATION_MARKER: externalMarker,
        TENANT_EXTERNAL_OPERATION_HASH: "9".repeat(64),
        TENANT_RECEIPT_BUCKET: receiptBucketName,
        TENANT_RECEIPT_EXPECTED_BUCKET_OWNER: accountId,
        TENANT_RECEIPT_KEY: receiptKey,
      },
    },
    receipt: { bucketArn: receiptBucketArn, key: receiptKey },
    startedBy: `tl-${"a".repeat(12)}-${"b".repeat(16)}`,
    clientToken,
    tags: {
      ManagedBy: "techlong-deployment-worker",
      ResourceGeneration: "1",
      OwnershipMarker: ownershipMarker,
      ExternalOperationEpoch: "3",
      ExternalOperationMarker: externalMarker,
      ExternalOperationHash: "9".repeat(64),
    },
  };
}

async function rawResult(): Promise<TenantDatabaseOneShotRawResult> {
  const output = {
    state: "present",
    databaseExists: true,
    evidenceHash: "7".repeat(64),
  };
  return {
    schemaVersion: 1,
    operation: "inspect",
    resourceGeneration: 1,
    ownershipMarker,
    externalEpoch: 3,
    externalMarker,
    externalOperationHash: "9".repeat(64),
    output,
    outputHash: await sha256Hex(output),
  };
}

async function checksum(bytes: Uint8Array): Promise<string> {
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", digestInput.buffer),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function s3Response(
  value: unknown,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const source = typeof value === "string" ? value : canonicalJson(value);
  const bytes = new TextEncoder().encode(source);
  return {
    Body: bytes,
    ContentLength: bytes.byteLength,
    ContentType: "application/json",
    ServerSideEncryption: "AES256",
    ChecksumType: "FULL_OBJECT",
    ChecksumSHA256: await checksum(bytes),
    ...overrides,
  };
}

function reader(input: {
  send: AwsSdkS3OneShotReceiptReaderDependencies["client"]["send"];
  config?: Partial<{
    expectedBucketOwner: string;
    expectedRegion: string;
    receiptBucketArn: string;
    maximumReceiptBytes: number;
  }>;
}): AwsSdkS3OneShotReceiptReader {
  return new AwsSdkS3OneShotReceiptReader(
    {
      expectedBucketOwner: accountId,
      expectedRegion: region,
      receiptBucketArn,
      maximumReceiptBytes: MAX_TENANT_ONE_SHOT_RAW_RECEIPT_BYTES,
      ...input.config,
    },
    {
      client: { send: input.send },
      commands: { getObject: GetObjectCommand },
    },
  );
}

function code(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

test("S3 raw result constructs all trusted receipt bindings inside the platform", async () => {
  const expectedRequest = request();
  const raw = await rawResult();
  const controller = new AbortController();
  let calls = 0;
  const result = await reader({
    send: async (command, options) => {
      calls += 1;
      assert.equal(options?.abortSignal, controller.signal);
      assert.deepEqual((command as GetObjectCommand).input, {
        Bucket: receiptBucketName,
        Key: receiptKey,
        ExpectedBucketOwner: accountId,
        ChecksumMode: "ENABLED",
      });
      return s3Response(raw);
    },
  }).read({
    clusterArn,
    taskArn,
    expectedRequest,
    signal: controller.signal,
  });

  assert.equal(calls, 1);
  assert.ok(result);
  assert.equal(result.taskArn, taskArn);
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.requestHash, await tenantOneShotRequestHash(expectedRequest));
  assert.equal(result.outputHash, await sha256Hex(raw.output));
  const { receiptHash, ...withoutReceiptHash } = result;
  assert.equal(receiptHash, await tenantOneShotReceiptHash(withoutReceiptHash));
  assert.equal(JSON.stringify(raw).includes("taskArn"), false);
  assert.equal(JSON.stringify(raw).includes("requestHash"), false);
  assert.equal(JSON.stringify(raw).includes("receiptHash"), false);
});

test("S3 receipt location rejects wrong account and tenant generation before GetObject", async () => {
  let calls = 0;
  const send = async (): Promise<Record<string, unknown>> => {
    calls += 1;
    return {};
  };
  assert.throws(
    () => reader({
      send,
      config: { expectedBucketOwner: "111111111111" },
    }),
    (error: unknown) => code(error) === "TENANT_ONE_SHOT_RECEIPT_CONFIG_INVALID",
  );
  assert.throws(
    () =>
      reader({
        send,
        config: {
          maximumReceiptBytes:
            MAX_TENANT_ONE_SHOT_RAW_RECEIPT_BYTES + 1,
        },
      }),
    (error: unknown) => code(error) === "TENANT_ONE_SHOT_RECEIPT_CONFIG_INVALID",
  );

  const wrongAccount = request();
  wrongAccount.container.environment.TENANT_RECEIPT_EXPECTED_BUCKET_OWNER =
    "111111111111";
  await assert.rejects(
    reader({ send }).read({
      clusterArn,
      taskArn,
      expectedRequest: wrongAccount,
      signal: new AbortController().signal,
    }),
    (error: unknown) => code(error) === "TENANT_ONE_SHOT_RECEIPT_LOCATION_INVALID",
  );

  const wrongGeneration = request();
  wrongGeneration.receipt.key = wrongGeneration.receipt.key.replace("/g1/", "/g2/");
  wrongGeneration.container.environment.TENANT_RECEIPT_KEY =
    wrongGeneration.receipt.key;
  await assert.rejects(
    reader({ send }).read({
      clusterArn,
      taskArn,
      expectedRequest: wrongGeneration,
      signal: new AbortController().signal,
    }),
    (error: unknown) => code(error) === "TENANT_ONE_SHOT_RECEIPT_LOCATION_INVALID",
  );
  assert.equal(calls, 0);
});

test("S3 receipt rejects checksum, content type, or AES256 metadata drift", async (t) => {
  const raw = await rawResult();
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["checksum", { ChecksumSHA256: btoa("x".repeat(32)) }, "TENANT_ONE_SHOT_RECEIPT_CHECKSUM_INVALID"],
    ["content type", { ContentType: "text/plain" }, "TENANT_ONE_SHOT_RECEIPT_METADATA_INVALID"],
    ["SSE", { ServerSideEncryption: "aws:kms" }, "TENANT_ONE_SHOT_RECEIPT_METADATA_INVALID"],
    ["checksum type", { ChecksumType: "COMPOSITE" }, "TENANT_ONE_SHOT_RECEIPT_METADATA_INVALID"],
  ];
  for (const [name, overrides, expectedCode] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        reader({ send: async () => s3Response(raw, overrides) }).read({
          clusterArn,
          taskArn,
          expectedRequest: request(),
          signal: new AbortController().signal,
        }),
        (error: unknown) => code(error) === expectedCode,
      );
    });
  }
});

test("S3 receipt accepts only one canonical exact-key raw envelope", async (t) => {
  const raw = await rawResult();
  const variants: Array<[string, unknown]> = [
    ["additional field", { ...raw, debug: true }],
    ["non-canonical key order", JSON.stringify(raw)],
    ["two envelopes", `${canonicalJson(raw)}${canonicalJson(raw)}`],
  ];
  for (const [name, body] of variants) {
    await t.test(name, async () => {
      await assert.rejects(
        reader({ send: async () => s3Response(body) }).read({
          clusterArn,
          taskArn,
          expectedRequest: request(),
          signal: new AbortController().signal,
        }),
        (error: unknown) => code(error) === "TENANT_ONE_SHOT_RECEIPT_INVALID",
      );
    });
  }
});

test("ECS validates the described task before binding the exact task and request to its reader", async () => {
  const expectedRequest = request();
  const readerInputs: Record<string, unknown>[] = [];
  const dependencies: AwsSdkEcsOneShotDependencies = {
    client: {
      send: async (command) => {
        assert.deepEqual((command as DescribeTasksCommand).input, {
          cluster: clusterArn,
          tasks: [taskArn],
          include: ["TAGS"],
        });
        return {
          failures: [],
          tasks: [
            {
              taskArn,
              clusterArn,
              taskDefinitionArn,
              startedBy: expectedRequest.startedBy,
              launchType: "FARGATE",
              platformVersion: "1.4.0",
              enableExecuteCommand: false,
              lastStatus: "STOPPED",
              desiredStatus: "STOPPED",
              containers: [
                {
                  name: expectedRequest.container.name,
                  lastStatus: "STOPPED",
                  exitCode: 0,
                },
              ],
              overrides: {
                containerOverrides: [
                  {
                    name: expectedRequest.container.name,
                    command: [...expectedRequest.container.command],
                    environment: Object.entries(
                      expectedRequest.container.environment,
                    ).map(([name, value]) => ({ name, value })),
                  },
                ],
              },
              tags: Object.entries(expectedRequest.tags).map(([key, value]) => ({
                key,
                value,
              })),
            },
          ],
        };
      },
    },
    commands: {
      runTask: UnusedCommand,
      listTasks: UnusedCommand,
      describeTasks: DescribeTasksCommand,
      stopTask: UnusedCommand,
    },
    receiptReader: {
      read: async (input) => {
        readerInputs.push(input as unknown as Record<string, unknown>);
        return null;
      },
    },
  };
  const api = new AwsSdkEcsOneShotTaskApi(
    {
      environmentKind: "aws_sandbox",
      expectedAccountId: accountId,
      expectedRegion: region,
      clusterArn,
      receiptBucketArn,
      allowedTaskDefinitionArns: [taskDefinitionArn],
      allowedCommandByTaskDefinitionArn: {
        [taskDefinitionArn]: expectedRequest.container.command,
      },
      expectedContainerName: expectedRequest.container.name,
      assignPublicIp: "ENABLED",
      allowedSubnetIds: expectedRequest.subnetIds,
      allowedSecurityGroupIds: expectedRequest.securityGroupIds,
    },
    dependencies,
  );

  await api.describeTask({
    clusterArn,
    taskArn,
    expectedRequest,
    signal: new AbortController().signal,
  });
  assert.equal(readerInputs[0]?.taskArn, taskArn);
  assert.equal(readerInputs[0]?.expectedRequest, expectedRequest);
});
