import {
  tenantOneShotExpectedReceiptBucketArn,
  tenantOneShotReceiptBucketName,
  type EcsOneShotTaskApi,
  type EcsOneShotTaskObservation,
  type EcsOneShotTaskRequest,
  type TenantDatabaseOneShotReceipt,
  type TenantDatabaseOneShotOperation,
} from "./ecs-one-shot-task.ts";
import { canonicalJson } from "./hash.ts";
import { TenantDatabaseLifecycleError } from "./tenant-database.ts";

interface AwsSdkClient {
  send(
    command: unknown,
    options?: { abortSignal?: AbortSignal },
  ): Promise<Record<string, unknown>>;
}

type AwsSdkClientConstructor = new (
  configuration: Record<string, unknown>,
) => AwsSdkClient;
type AwsSdkCommandConstructor = new (
  input: Record<string, unknown>,
) => unknown;

export interface EcsOneShotReceiptReader {
  read(input: {
    clusterArn: string;
    taskArn: string;
    expectedRequest: EcsOneShotTaskRequest;
    signal: AbortSignal;
  }): Promise<TenantDatabaseOneShotReceipt | null>;
}

export interface AwsSdkEcsOneShotDependencies {
  client: AwsSdkClient;
  commands: {
    runTask: AwsSdkCommandConstructor;
    listTasks: AwsSdkCommandConstructor;
    describeTasks: AwsSdkCommandConstructor;
    stopTask: AwsSdkCommandConstructor;
  };
  receiptReader: EcsOneShotReceiptReader;
}

export interface AwsSdkEcsOneShotConfig {
  expectedAccountId: string;
  expectedRegion: string;
  clusterArn: string;
  receiptBucketArn: string;
  allowedTaskDefinitionArns: readonly string[];
  allowedCommandByTaskDefinitionArn: Readonly<Record<string, readonly string[]>>;
  expectedContainerName: string;
  allowedSubnetIds: readonly string[];
  allowedSecurityGroupIds: readonly string[];
  maximumListPages?: number;
}

type StopReason = Parameters<EcsOneShotTaskApi["stopTask"]>[0]["reason"];

const regionPattern = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/;
const accountPattern = /^\d{12}$/;
const clusterArnPattern =
  /^arn:aws:ecs:([a-z]{2}(?:-gov)?-[a-z]+-\d):(\d{12}):cluster\/([A-Za-z0-9][A-Za-z0-9_-]{0,254})$/;
const taskDefinitionArnPattern =
  /^arn:aws:ecs:([a-z]{2}(?:-gov)?-[a-z]+-\d):(\d{12}):task-definition\/([A-Za-z0-9][A-Za-z0-9_-]{0,254}):([1-9][0-9]*)$/;
const taskArnPattern =
  /^arn:aws:ecs:([a-z]{2}(?:-gov)?-[a-z]+-\d):(\d{12}):task\/([A-Za-z0-9][A-Za-z0-9_-]{0,254})\/([a-f0-9]{32})$/;
const startedByPattern = /^tl-[a-f0-9]{12}-[a-f0-9]{16}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const networkIdPattern = /^(?:subnet|sg)-[a-f0-9]{8,17}$/;
const secretArnPattern =
  /^arn:aws:secretsmanager:([a-z]{2}(?:-gov)?-[a-z]+-\d):(\d{12}):secret:techlong\/sandbox\/tenant\/[a-z0-9][a-z0-9_-]{2,63}\/runtime\/g([1-9][0-9]*)-[A-Za-z0-9]{6}$/;
const receiptKeyPattern =
  /^tenant-lifecycle\/v1\/([a-f0-9]{32})\/g([1-9][0-9]*)\/([a-f0-9]{64})\.json$/;
const operations = [
  "inspect",
  "prepare_empty_database",
  "restore_approved_baseline",
  "migrate_saas",
  "verify",
  "destroy",
] as const satisfies readonly TenantDatabaseOneShotOperation[];

const environmentKeys = [
  "TENANT_DATABASE_OPERATION",
  "TENANT_RUNTIME_SECRET_ARN",
  "TENANT_RESOURCE_GENERATION",
  "TENANT_OWNERSHIP_MARKER",
  "TENANT_EXTERNAL_OPERATION_EPOCH",
  "TENANT_EXTERNAL_OPERATION_MARKER",
  "TENANT_EXTERNAL_OPERATION_HASH",
  "TENANT_RECEIPT_BUCKET",
  "TENANT_RECEIPT_EXPECTED_BUCKET_OWNER",
  "TENANT_RECEIPT_KEY",
] as const;
const predecessorEnvironmentKeys = [
  "TENANT_PREDECESSOR_PROVISION_EPOCH",
  "TENANT_PREDECESSOR_PROVISION_MARKER",
  "TENANT_PREDECESSOR_PROVISION_OPERATION_HASH",
] as const;
const tagKeys = [
  "ManagedBy",
  "ResourceGeneration",
  "OwnershipMarker",
  "ExternalOperationEpoch",
  "ExternalOperationMarker",
  "ExternalOperationHash",
] as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function errorRecord(error: unknown): Record<string, unknown> {
  return error && typeof error === "object"
    ? (error as Record<string, unknown>)
    : {};
}

function rethrowAbort(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error("AWS ECS operation was aborted."), {
        name: "AbortError",
        code: "ABORT_ERR",
      });
}

function providerError(error: unknown, operation: string): Error {
  const source = errorRecord(error);
  const metadata = record(source.$metadata);
  const name = text(source.name) ?? "AWS_ECS_ERROR";
  const status = Number(metadata.httpStatusCode ?? 0);
  return Object.assign(new Error(`AWS ECS ${operation} failed.`), {
    code: name.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100),
    retryable:
      Boolean(source.$retryable) ||
      status === 408 ||
      status === 429 ||
      status >= 500 ||
      /Throttl|Timeout|Unavailable|Internal|RequestLimit/i.test(name),
  });
}

function fail(code: string, message: string): never {
  throw new TenantDatabaseLifecycleError(code, message, false);
}

function sameArray(actual: readonly string[], expected: readonly string[]): boolean {
  return canonicalJson(actual) === canonicalJson(expected);
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  return sameArray(Object.keys(value).sort(), [...expected].sort());
}

function parseClusterArn(value: string): {
  region: string;
  accountId: string;
  clusterName: string;
} {
  const match = clusterArnPattern.exec(value);
  if (!match) fail("TENANT_ONE_SHOT_ARN_INVALID", "Configured ECS cluster ARN is invalid.");
  return { region: match[1], accountId: match[2], clusterName: match[3] };
}

function assertTaskDefinitionArn(
  value: string,
  expected: { region: string; accountId: string },
): void {
  const match = taskDefinitionArnPattern.exec(value);
  if (!match || match[1] !== expected.region || match[2] !== expected.accountId) {
    fail(
      "TENANT_ONE_SHOT_ARN_INVALID",
      "ECS task definition must be a revision-pinned ARN in the configured account and region.",
    );
  }
}

function assertTaskArn(
  value: string,
  expected: { region: string; accountId: string; clusterName: string },
): void {
  const match = taskArnPattern.exec(value);
  if (
    !match ||
    match[1] !== expected.region ||
    match[2] !== expected.accountId ||
    match[3] !== expected.clusterName
  ) {
    fail(
      "TENANT_ONE_SHOT_TASK_OWNERSHIP_INVALID",
      "ECS task ARN is outside the configured cluster, account, or region.",
    );
  }
}

function assertNoFailures(response: Record<string, unknown>, operation: string): void {
  if (response.failures !== undefined && !Array.isArray(response.failures)) {
    fail(
      "TENANT_ONE_SHOT_PROVIDER_FAILURE",
      `AWS ECS ${operation} returned a malformed provider failure list.`,
    );
  }
  if (records(response.failures).length > 0) {
    fail(
      "TENANT_ONE_SHOT_PROVIDER_FAILURE",
      `AWS ECS ${operation} returned one or more provider failures.`,
    );
  }
}

function stringMapFromResponse(
  value: unknown,
  keyName: string,
  valueName: string,
  label: string,
): Record<string, string> {
  if (!Array.isArray(value)) {
    fail("TENANT_ONE_SHOT_TASK_OWNERSHIP_INVALID", `${label} is missing or malformed.`);
  }
  const result: Record<string, string> = {};
  for (const item of records(value)) {
    const key = text(item[keyName]);
    const itemValue = text(item[valueName]);
    if (!key || !itemValue || result[key] !== undefined) {
      fail(
        "TENANT_ONE_SHOT_TASK_OWNERSHIP_INVALID",
        `${label} contains an empty or duplicate entry.`,
      );
    }
    result[key] = itemValue;
  }
  if (Object.keys(result).length !== value.length) {
    fail(
      "TENANT_ONE_SHOT_TASK_OWNERSHIP_INVALID",
      `${label} contains a non-object entry.`,
    );
  }
  return result;
}

function assertTaskIdentity(
  task: Record<string, unknown>,
  request: EcsOneShotTaskRequest,
): void {
  const overrides = record(task.overrides);
  const containerOverrides = records(overrides.containerOverrides);
  const expectedOverride = containerOverrides.filter(
    (item) => text(item.name) === request.container.name,
  );
  const command = expectedOverride[0]?.command;
  const environment = stringMapFromResponse(
    expectedOverride[0]?.environment,
    "name",
    "value",
    "ECS task environment",
  );
  const tags = stringMapFromResponse(task.tags, "key", "value", "ECS task tags");
  if (
    text(task.clusterArn) !== request.clusterArn ||
    text(task.taskDefinitionArn) !== request.taskDefinitionArn ||
    text(task.startedBy) !== request.startedBy ||
    text(task.launchType) !== request.launchType ||
    text(task.platformVersion) !== request.platformVersion ||
    task.enableExecuteCommand !== false ||
    containerOverrides.length !== 1 ||
    expectedOverride.length !== 1 ||
    !Array.isArray(command) ||
    !sameArray(
      command.filter((item): item is string => typeof item === "string"),
      request.container.command,
    ) ||
    command.length !== request.container.command.length ||
    canonicalJson(environment) !== canonicalJson(request.container.environment) ||
    canonicalJson(tags) !== canonicalJson(request.tags)
  ) {
    fail(
      "TENANT_ONE_SHOT_TASK_OWNERSHIP_INVALID",
      "ECS task does not match the exact cluster, task definition, startedBy, overrides, or ownership tags.",
    );
  }
}

function assertRequest(
  request: EcsOneShotTaskRequest,
  config: AwsSdkEcsOneShotConfig,
): void {
  const receiptBucket = tenantOneShotReceiptBucketName(config.receiptBucketArn);
  const operation = request.container.environment.TENANT_DATABASE_OPERATION;
  const requiredEnvironment: string[] = [...environmentKeys];
  if (request.container.environment.APPROVED_TENANT_BASELINE_SHA256 !== undefined) {
    requiredEnvironment.push("APPROVED_TENANT_BASELINE_SHA256");
  }
  if (operation === "destroy") {
    requiredEnvironment.push(...predecessorEnvironmentKeys);
  }
  if (
    request.schemaVersion !== 1 ||
    !exactKeys(request, [
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
    ]) ||
    !exactKeys(request.container, ["name", "command", "environment"]) ||
    !exactKeys(request.receipt, ["bucketArn", "key"]) ||
    request.clusterArn !== config.clusterArn ||
    !config.allowedTaskDefinitionArns.includes(request.taskDefinitionArn) ||
    request.launchType !== "FARGATE" ||
    request.platformVersion !== "1.4.0" ||
    request.assignPublicIp !== "DISABLED" ||
    request.container.name !== config.expectedContainerName ||
    !sameArray(
      request.container.command,
      config.allowedCommandByTaskDefinitionArn[request.taskDefinitionArn] ?? [],
    ) ||
    !sameArray(request.subnetIds, config.allowedSubnetIds) ||
    !sameArray(request.securityGroupIds, config.allowedSecurityGroupIds) ||
    !startedByPattern.test(request.startedBy) ||
    !digestPattern.test(request.clientToken) ||
    request.receipt.bucketArn !== config.receiptBucketArn ||
    !exactKeys(request.container.environment, requiredEnvironment) ||
    !exactKeys(request.tags, tagKeys) ||
    request.tags.ManagedBy !== "techlong-deployment-worker" ||
    request.tags.ResourceGeneration !==
      request.container.environment.TENANT_RESOURCE_GENERATION ||
    request.tags.OwnershipMarker !==
      request.container.environment.TENANT_OWNERSHIP_MARKER ||
    request.tags.ExternalOperationEpoch !==
      request.container.environment.TENANT_EXTERNAL_OPERATION_EPOCH ||
    request.tags.ExternalOperationMarker !==
      request.container.environment.TENANT_EXTERNAL_OPERATION_MARKER ||
    request.tags.ExternalOperationHash !==
      request.container.environment.TENANT_EXTERNAL_OPERATION_HASH
  ) {
    fail(
      "TENANT_ONE_SHOT_REQUEST_INVALID",
      "ECS one-shot request differs from the configured account, cluster, network, or immutable fence.",
    );
  }
  const secretMatch = secretArnPattern.exec(
    request.container.environment.TENANT_RUNTIME_SECRET_ARN,
  );
  const generation = request.container.environment.TENANT_RESOURCE_GENERATION;
  const epoch = request.container.environment.TENANT_EXTERNAL_OPERATION_EPOCH;
  const ownerMatch = /^tl_owner_([a-f0-9]{32})_g([1-9][0-9]*)$/.exec(
    request.container.environment.TENANT_OWNERSHIP_MARKER,
  );
  const predecessorEpoch =
    request.container.environment.TENANT_PREDECESSOR_PROVISION_EPOCH;
  const predecessorMarker =
    request.container.environment.TENANT_PREDECESSOR_PROVISION_MARKER;
  const predecessorHash =
    request.container.environment.TENANT_PREDECESSOR_PROVISION_OPERATION_HASH;
  const predecessorMatch =
    predecessorMarker === undefined
      ? null
      : /^tl_epoch_([a-f0-9]{24})_g([1-9][0-9]*)_e([1-9][0-9]*)$/.exec(
          predecessorMarker,
        );
  const receiptMatch = receiptKeyPattern.exec(request.receipt.key);
  if (
    !secretMatch ||
    secretMatch[1] !== config.expectedRegion ||
    secretMatch[2] !== config.expectedAccountId ||
    secretMatch[3] !== generation ||
    !/^[1-9][0-9]*$/.test(generation) ||
    !Number.isSafeInteger(Number(generation)) ||
    !/^[1-9][0-9]*$/.test(epoch) ||
    !Number.isSafeInteger(Number(epoch)) ||
    !operations.includes(operation) ||
    !ownerMatch ||
    Number(ownerMatch[2]) !== Number(generation) ||
    !receiptMatch ||
    receiptMatch[1] !== ownerMatch[1] ||
    receiptMatch[2] !== generation ||
    receiptMatch[3] !== request.clientToken ||
    request.container.environment.TENANT_RECEIPT_BUCKET !== receiptBucket ||
    request.container.environment.TENANT_RECEIPT_EXPECTED_BUCKET_OWNER !==
      config.expectedAccountId ||
    request.container.environment.TENANT_RECEIPT_KEY !== request.receipt.key ||
    request.container.command[2] !== operation ||
    !/^tl_owner_[a-f0-9]{32}_g[1-9][0-9]*$/.test(
      request.container.environment.TENANT_OWNERSHIP_MARKER,
    ) ||
    !request.container.environment.TENANT_OWNERSHIP_MARKER.endsWith(
      `_g${generation}`,
    ) ||
    !/^tl_epoch_[a-f0-9]{24}_g[1-9][0-9]*_e[1-9][0-9]*$/.test(
      request.container.environment.TENANT_EXTERNAL_OPERATION_MARKER,
    ) ||
    !request.container.environment.TENANT_EXTERNAL_OPERATION_MARKER.endsWith(
      `_g${generation}_e${epoch}`,
    ) ||
    !digestPattern.test(request.container.environment.TENANT_EXTERNAL_OPERATION_HASH) ||
    (operation === "destroy"
      ? !predecessorEpoch ||
        !/^[1-9][0-9]*$/.test(predecessorEpoch) ||
        !Number.isSafeInteger(Number(predecessorEpoch)) ||
        Number(predecessorEpoch) >= Number(epoch) ||
        !predecessorMatch ||
        predecessorMatch[1] !== ownerMatch[1].slice(0, 24) ||
        predecessorMatch[2] !== generation ||
        predecessorMatch[3] !== predecessorEpoch ||
        !predecessorHash ||
        !digestPattern.test(predecessorHash)
      : predecessorEpoch !== undefined ||
        predecessorMarker !== undefined ||
        predecessorHash !== undefined) ||
    (["restore_approved_baseline", "migrate_saas", "verify"].includes(
      operation,
    ) !==
      (request.container.environment.APPROVED_TENANT_BASELINE_SHA256 !==
        undefined)) ||
    (request.container.environment.APPROVED_TENANT_BASELINE_SHA256 !== undefined &&
      !digestPattern.test(
        request.container.environment.APPROVED_TENANT_BASELINE_SHA256,
      ))
  ) {
    fail(
      "TENANT_ONE_SHOT_REQUEST_INVALID",
      "ECS one-shot environment contains an invalid Secret ARN or digest.",
    );
  }
}

function runTaskInput(request: EcsOneShotTaskRequest): Record<string, unknown> {
  return {
    cluster: request.clusterArn,
    taskDefinition: request.taskDefinitionArn,
    count: 1,
    launchType: request.launchType,
    platformVersion: request.platformVersion,
    enableExecuteCommand: false,
    enableECSManagedTags: false,
    startedBy: request.startedBy,
    clientToken: request.clientToken,
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: [...request.subnetIds],
        securityGroups: [...request.securityGroupIds],
        assignPublicIp: request.assignPublicIp,
      },
    },
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

function stopReasonText(reason: StopReason): string {
  return `techlong:${reason}`;
}

/**
 * Real AWS SDK v3 ECS boundary. It is not wired into the Worker root. Every
 * provider call receives the caller's AbortSignal, and every returned task is
 * constrained to the configured long-ARN cluster/account/region.
 */
export class AwsSdkEcsOneShotTaskApi implements EcsOneShotTaskApi {
  private readonly sdk: AwsSdkEcsOneShotDependencies;
  private readonly config: Required<AwsSdkEcsOneShotConfig>;
  private readonly scope: { region: string; accountId: string; clusterName: string };

  constructor(config: AwsSdkEcsOneShotConfig, sdk: AwsSdkEcsOneShotDependencies) {
    let receiptBucketValid = true;
    try {
      tenantOneShotReceiptBucketName(config.receiptBucketArn);
    } catch {
      receiptBucketValid = false;
    }
    if (
      !accountPattern.test(config.expectedAccountId) ||
      !regionPattern.test(config.expectedRegion) ||
      !receiptBucketValid ||
      config.receiptBucketArn !==
        tenantOneShotExpectedReceiptBucketArn({
          accountId: config.expectedAccountId,
          region: config.expectedRegion,
        }) ||
      !config.expectedContainerName ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,126}$/.test(config.expectedContainerName) ||
      config.allowedTaskDefinitionArns.length < 1 ||
      config.allowedTaskDefinitionArns.length > 6 ||
      !config.allowedCommandByTaskDefinitionArn ||
      typeof config.allowedCommandByTaskDefinitionArn !== "object" ||
      new Set(config.allowedTaskDefinitionArns).size !==
        config.allowedTaskDefinitionArns.length ||
      config.allowedSubnetIds.length < 1 ||
      config.allowedSubnetIds.length > 6 ||
      config.allowedSecurityGroupIds.length < 1 ||
      config.allowedSecurityGroupIds.length > 5 ||
      new Set(config.allowedSubnetIds).size !== config.allowedSubnetIds.length ||
      new Set(config.allowedSecurityGroupIds).size !==
        config.allowedSecurityGroupIds.length ||
      [...config.allowedSubnetIds, ...config.allowedSecurityGroupIds].some(
        (value) => !networkIdPattern.test(value),
      ) ||
      !Number.isSafeInteger(config.maximumListPages ?? 5) ||
      (config.maximumListPages ?? 5) < 1 ||
      (config.maximumListPages ?? 5) > 10
    ) {
      fail("TENANT_ONE_SHOT_PROVIDER_CONFIG_INVALID", "AWS ECS adapter configuration is invalid.");
    }
    const scope = parseClusterArn(config.clusterArn);
    if (
      scope.accountId !== config.expectedAccountId ||
      scope.region !== config.expectedRegion
    ) {
      fail(
        "TENANT_ONE_SHOT_PROVIDER_CONFIG_INVALID",
        "AWS ECS cluster must match the configured account and region.",
      );
    }
    for (const arn of config.allowedTaskDefinitionArns) {
      assertTaskDefinitionArn(arn, scope);
      const command = config.allowedCommandByTaskDefinitionArn[arn];
      if (
        !Array.isArray(command) ||
        command.length !== 3 ||
        command[0] !== "/usr/local/bin/node" ||
        command[1] !== "db/tenant_lifecycle.js" ||
        !operations.includes(command[2] as TenantDatabaseOneShotOperation)
      ) {
        fail(
          "TENANT_ONE_SHOT_PROVIDER_CONFIG_INVALID",
          "Every allowed task definition requires one unified lifecycle command.",
        );
      }
    }
    if (
      canonicalJson(Object.keys(config.allowedCommandByTaskDefinitionArn).sort()) !==
      canonicalJson([...config.allowedTaskDefinitionArns].sort())
    ) {
      fail(
        "TENANT_ONE_SHOT_PROVIDER_CONFIG_INVALID",
        "ECS command allowlist must exactly cover the allowed task definitions.",
      );
    }
    this.sdk = sdk;
    this.scope = scope;
    this.config = { ...config, maximumListPages: config.maximumListPages ?? 5 };
  }

  async runTask(input: {
    request: EcsOneShotTaskRequest;
    signal: AbortSignal;
  }): Promise<{ taskArn: string }> {
    try {
      input.signal.throwIfAborted();
      assertRequest(input.request, this.config);
      const response = await this.sdk.client.send(
        new this.sdk.commands.runTask(runTaskInput(input.request)),
        { abortSignal: input.signal },
      );
      input.signal.throwIfAborted();
      assertNoFailures(response, "RunTask");
      const tasks = records(response.tasks);
      const taskArn = tasks.length === 1 ? text(tasks[0].taskArn) : null;
      if (!taskArn) {
        fail(
          "TENANT_ONE_SHOT_RUN_TASK_INVALID",
          "AWS ECS RunTask did not return exactly one task ARN.",
        );
      }
      assertTaskArn(taskArn, this.scope);
      return { taskArn };
    } catch (error) {
      rethrowAbort(input.signal);
      if (error instanceof TenantDatabaseLifecycleError) throw error;
      throw providerError(error, "RunTask");
    }
  }

  async listTaskArnsByStartedBy(input: {
    clusterArn: string;
    startedBy: string;
    signal: AbortSignal;
  }): Promise<{ taskArns: string[] }> {
    input.signal.throwIfAborted();
    if (input.clusterArn !== this.config.clusterArn || !startedByPattern.test(input.startedBy)) {
      fail(
        "TENANT_ONE_SHOT_RECOVERY_INVALID",
        "ECS recovery requires the exact configured cluster and startedBy token.",
      );
    }
    try {
      const result: string[] = [];
      let nextToken: string | undefined;
      for (let page = 0; page < this.config.maximumListPages; page += 1) {
        input.signal.throwIfAborted();
        const response = await this.sdk.client.send(
          new this.sdk.commands.listTasks({
            cluster: input.clusterArn,
            startedBy: input.startedBy,
            ...(nextToken ? { nextToken } : {}),
          }),
          { abortSignal: input.signal },
        );
        input.signal.throwIfAborted();
        if (response.taskArns !== undefined && !Array.isArray(response.taskArns)) {
          fail("TENANT_ONE_SHOT_RECOVERY_INVALID", "AWS ECS ListTasks returned an invalid task list.");
        }
        for (const value of Array.isArray(response.taskArns) ? response.taskArns : []) {
          const taskArn = text(value);
          if (!taskArn) {
            fail("TENANT_ONE_SHOT_RECOVERY_INVALID", "AWS ECS ListTasks returned an invalid ARN.");
          }
          assertTaskArn(taskArn, this.scope);
          result.push(taskArn);
        }
        const token = text(response.nextToken);
        if (!token) {
          if (new Set(result).size !== result.length || result.length > 100) {
            fail(
              "TENANT_ONE_SHOT_RECOVERY_INVALID",
              "AWS ECS ListTasks returned duplicate or unbounded task ARNs.",
            );
          }
          return { taskArns: result };
        }
        nextToken = token;
      }
      fail(
        "TENANT_ONE_SHOT_RECOVERY_UNBOUNDED",
        "AWS ECS ListTasks exceeded the configured recovery page bound.",
      );
    } catch (error) {
      rethrowAbort(input.signal);
      if (error instanceof TenantDatabaseLifecycleError) throw error;
      throw providerError(error, "ListTasks");
    }
  }

  async describeTask(input: {
    clusterArn: string;
    taskArn: string;
    expectedRequest: EcsOneShotTaskRequest;
    signal: AbortSignal;
  }): Promise<EcsOneShotTaskObservation> {
    input.signal.throwIfAborted();
    assertRequest(input.expectedRequest, this.config);
    if (input.clusterArn !== this.config.clusterArn) {
      fail("TENANT_ONE_SHOT_TASK_OWNERSHIP_INVALID", "DescribeTasks cluster is not configured.");
    }
    assertTaskArn(input.taskArn, this.scope);
    try {
      input.signal.throwIfAborted();
      const response = await this.sdk.client.send(
        new this.sdk.commands.describeTasks({
          cluster: input.clusterArn,
          tasks: [input.taskArn],
          include: ["TAGS"],
        }),
        { abortSignal: input.signal },
      );
      input.signal.throwIfAborted();
      assertNoFailures(response, "DescribeTasks");
      const tasks = records(response.tasks);
      if (tasks.length !== 1 || text(tasks[0].taskArn) !== input.taskArn) {
        fail(
          "TENANT_ONE_SHOT_OBSERVATION_INVALID",
          "AWS ECS DescribeTasks did not return the exact requested task.",
        );
      }
      const task = tasks[0];
      assertTaskIdentity(task, input.expectedRequest);
      const lastStatus = text(task.lastStatus);
      const desiredStatus = text(task.desiredStatus);
      const containers = records(task.containers).filter(
        (container) => text(container.name) === this.config.expectedContainerName,
      );
      if (
        ![
          "PROVISIONING",
          "PENDING",
          "ACTIVATING",
          "RUNNING",
          "DEACTIVATING",
          "STOPPING",
          "DEPROVISIONING",
          "STOPPED",
        ].includes(lastStatus ?? "") ||
        !["RUNNING", "STOPPED"].includes(desiredStatus ?? "") ||
        containers.length !== 1
      ) {
        fail(
          "TENANT_ONE_SHOT_OBSERVATION_INVALID",
          "AWS ECS task state or container identity is invalid.",
        );
      }
      if (lastStatus !== "STOPPED") {
        return {
          taskArn: input.taskArn,
          lastStatus: lastStatus as EcsOneShotTaskObservation["lastStatus"],
          desiredStatus: desiredStatus as EcsOneShotTaskObservation["desiredStatus"],
          exitCode: null,
          stoppedReason: null,
          receipt: null,
        };
      }
      const exitCode = Number(containers[0].exitCode);
      const receipt =
        Number.isSafeInteger(exitCode) && exitCode === 0
          ? await this.sdk.receiptReader.read({
              clusterArn: input.clusterArn,
              taskArn: input.taskArn,
              expectedRequest: input.expectedRequest,
              signal: input.signal,
            })
          : null;
      input.signal.throwIfAborted();
      return {
        taskArn: input.taskArn,
        lastStatus: "STOPPED",
        desiredStatus: "STOPPED",
        exitCode: Number.isSafeInteger(exitCode) ? exitCode : null,
        stoppedReason: text(task.stoppedReason) ?? text(containers[0].reason),
        receipt,
      };
    } catch (error) {
      rethrowAbort(input.signal);
      if (error instanceof TenantDatabaseLifecycleError) throw error;
      throw providerError(error, "DescribeTasks");
    }
  }

  async stopTask(input: {
    clusterArn: string;
    taskArn: string;
    reason: StopReason;
    signal: AbortSignal;
  }): Promise<void> {
    input.signal.throwIfAborted();
    if (input.clusterArn !== this.config.clusterArn) {
      fail("TENANT_ONE_SHOT_TASK_OWNERSHIP_INVALID", "StopTask cluster is not configured.");
    }
    assertTaskArn(input.taskArn, this.scope);
    if (![
      "deployment_lease_lost",
      "task_timeout",
      "run_task_outcome_unknown",
    ].includes(input.reason)) {
      fail("TENANT_ONE_SHOT_STOP_REASON_INVALID", "ECS StopTask reason is not allowlisted.");
    }
    try {
      input.signal.throwIfAborted();
      const response = await this.sdk.client.send(
        new this.sdk.commands.stopTask({
          cluster: input.clusterArn,
          task: input.taskArn,
          reason: stopReasonText(input.reason),
        }),
        { abortSignal: input.signal },
      );
      input.signal.throwIfAborted();
      const returnedArn = text(record(response.task).taskArn);
      if (returnedArn !== input.taskArn) {
        fail(
          "TENANT_ONE_SHOT_STOP_INVALID",
          "AWS ECS StopTask did not return the exact requested task.",
        );
      }
      assertTaskArn(returnedArn, this.scope);
    } catch (error) {
      rethrowAbort(input.signal);
      if (error instanceof TenantDatabaseLifecycleError) throw error;
      throw providerError(error, "StopTask");
    }
  }
}

function commandConstructor(
  module: Record<string, unknown>,
  name: string,
): AwsSdkCommandConstructor {
  const value = module[name];
  if (typeof value !== "function") throw new Error(`AWS SDK export ${name} is missing.`);
  return value as AwsSdkCommandConstructor;
}

function clientConstructor(
  module: Record<string, unknown>,
  name: string,
): AwsSdkClientConstructor {
  const value = module[name];
  if (typeof value !== "function") throw new Error(`AWS SDK export ${name} is missing.`);
  return value as AwsSdkClientConstructor;
}

export async function createAwsSdkEcsOneShotTaskApi(input: {
  config: AwsSdkEcsOneShotConfig;
  receiptReader: EcsOneShotReceiptReader;
}): Promise<AwsSdkEcsOneShotTaskApi> {
  const packageName = "@aws-sdk/client-ecs";
  const sdkModule = (await import(packageName)) as Record<string, unknown>;
  const ECSClient = clientConstructor(sdkModule, "ECSClient");
  return new AwsSdkEcsOneShotTaskApi(input.config, {
    client: new ECSClient({ region: input.config.expectedRegion }),
    receiptReader: input.receiptReader,
    commands: {
      runTask: commandConstructor(sdkModule, "RunTaskCommand"),
      listTasks: commandConstructor(sdkModule, "ListTasksCommand"),
      describeTasks: commandConstructor(sdkModule, "DescribeTasksCommand"),
      stopTask: commandConstructor(sdkModule, "StopTaskCommand"),
    },
  });
}
