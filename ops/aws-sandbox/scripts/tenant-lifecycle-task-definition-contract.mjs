import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const tenantLifecycleTaskDefinitionSafety = Object.freeze({
  SchemaVersion: 1,
  ExpectedAccountId: "402010193138",
  ExpectedRegion: "ca-central-1",
  ApprovedStackName: "techlong-sandbox-tenant-b5j3",
  RegistersTaskDefinitionOnly: true,
  RunsTask: false,
  ContainsSecrets: false,
  CreatesSharedCell: false,
  RequiredLogGroupName: "/saas/cell-sandbox-1/tenant-lifecycle",
  LogGroupReady: false,
  RegistrationReady: false,
  LiveReadbackReady: false,
  ApplyRuntimeReady: false,
  CleanupRuntimeReady: false,
  ImageCommit: "f4aa0febeba526f737bac3b59d516e1ab5c24482",
  ImageDigest:
    "sha256:4815009949cd5219add56fedb183f1809b728081562f0280ede5229b567136f0",
});

export const expectedTenantLifecycleTaskDefinitionProperties = Object.freeze({
  Family: "tenant-lifecycle",
  TaskRoleArn:
    "arn:aws:iam::402010193138:role/TechlongSandboxTenantLifecycleTaskRole",
  ExecutionRoleArn:
    "arn:aws:iam::402010193138:role/TechlongSandboxTaskExecutionRole",
  NetworkMode: "awsvpc",
  ContainerDefinitions: Object.freeze([
    Object.freeze({
      Name: "tenant-database-lifecycle",
      Image:
        "402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:4815009949cd5219add56fedb183f1809b728081562f0280ede5229b567136f0",
      Essential: true,
      Command: Object.freeze([
        "/usr/local/bin/node",
        "db/tenant_lifecycle.js",
        "inspect",
      ]),
      Environment: Object.freeze([
        Object.freeze({
          Name: "APP_RUNTIME_MODE",
          Value: "aws_sandbox_tenant_lifecycle_inspect",
        }),
        Object.freeze({ Name: "NODE_ENV", Value: "production" }),
      ]),
      LinuxParameters: Object.freeze({
        Capabilities: Object.freeze({ Drop: Object.freeze(["ALL"]) }),
        InitProcessEnabled: true,
      }),
      LogConfiguration: Object.freeze({
        LogDriver: "awslogs",
        Options: Object.freeze({
          "awslogs-group": "/saas/cell-sandbox-1/tenant-lifecycle",
          "awslogs-region": "ca-central-1",
          "awslogs-stream-prefix": "inspect",
        }),
      }),
      Privileged: false,
      ReadonlyRootFilesystem: true,
      Interactive: false,
      PseudoTerminal: false,
      User: "65532:65532",
      WorkingDirectory: "/app",
      StopTimeout: 30,
    }),
  ]),
  Volumes: Object.freeze([]),
  RequiresCompatibilities: Object.freeze(["FARGATE"]),
  Cpu: "256",
  Memory: "512",
  RuntimePlatform: Object.freeze({
    CpuArchitecture: "X86_64",
    OperatingSystemFamily: "LINUX",
  }),
  Tags: Object.freeze([
    Object.freeze({ Key: "Environment", Value: "aws-sandbox" }),
    Object.freeze({ Key: "ManagedBy", Value: "techlong-provisioner" }),
    Object.freeze({ Key: "Component", Value: "tenant-lifecycle-one-shot" }),
  ]),
  EnableFaultInjection: false,
});

const accountId = tenantLifecycleTaskDefinitionSafety.ExpectedAccountId;
const region = tenantLifecycleTaskDefinitionSafety.ExpectedRegion;
const stackName = tenantLifecycleTaskDefinitionSafety.ApprovedStackName;
const logicalId = "TenantLifecycleTaskDefinition";
const taskArnPattern =
  /^arn:aws:ecs:ca-central-1:402010193138:task-definition\/tenant-lifecycle:([1-9][0-9]*)$/;
const registrarPattern =
  /^arn:aws:sts::402010193138:assumed-role\/TechlongSandboxCloudFormationExecutionRole\/[A-Za-z0-9+=,.@_-]{2,64}$/;
const stackIdPattern =
  /^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-tenant-b5j3\/[a-f0-9-]{36}$/i;
const isoUtcPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/;
const credentialPatterns = [
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /sk_(?:live|test)_[A-Za-z0-9]{16,}/,
  /whsec_[A-Za-z0-9]{16,}/,
];

const clone = (value) => JSON.parse(JSON.stringify(value));

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalized(value[key])]),
    );
  }
  return value;
}

export const canonicalJson = (value) => JSON.stringify(normalized(value));
export const sha256Canonical = (value) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");

function assertNoCredentials(value, label) {
  const source = JSON.stringify(value);
  for (const pattern of credentialPatterns) {
    assert.doesNotMatch(source, pattern, `${label} contains credential material`);
  }
}

function assertUtc(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  const match = isoUtcPattern.exec(value);
  assert.ok(match, `${label} must be an exact UTC timestamp`);
  const [, y, m, d, h, min, s, ms = "000"] = match;
  const parsed = new Date(Date.UTC(+y, +m - 1, +d, +h, +min, +s, +ms));
  assert.equal(parsed.getUTCFullYear(), +y);
  assert.equal(parsed.getUTCMonth(), +m - 1);
  assert.equal(parsed.getUTCDate(), +d);
  assert.equal(parsed.getUTCHours(), +h);
  assert.equal(parsed.getUTCMinutes(), +min);
  assert.equal(parsed.getUTCSeconds(), +s);
  assert.equal(parsed.getUTCMilliseconds(), +ms);
}

function expectedReadbackContainer() {
  const source = expectedTenantLifecycleTaskDefinitionProperties.ContainerDefinitions[0];
  return {
    name: source.Name,
    image: source.Image,
    essential: source.Essential,
    command: clone(source.Command),
    environment: source.Environment.map(({ Name, Value }) => ({
      name: Name,
      value: Value,
    })),
    linuxParameters: {
      capabilities: { drop: clone(source.LinuxParameters.Capabilities.Drop) },
      initProcessEnabled: source.LinuxParameters.InitProcessEnabled,
    },
    logConfiguration: {
      logDriver: source.LogConfiguration.LogDriver,
      options: clone(source.LogConfiguration.Options),
    },
    privileged: false,
    readonlyRootFilesystem: true,
    interactive: false,
    pseudoTerminal: false,
    user: source.User,
    workingDirectory: source.WorkingDirectory,
    stopTimeout: source.StopTimeout,
  };
}

function assertReadbackContainer(container) {
  const expected = expectedReadbackContainer();
  const emptyDefaults = [
    "credentialSpecs",
    "dependsOn",
    "dnsSearchDomains",
    "dnsServers",
    "dockerSecurityOptions",
    "entryPoint",
    "environmentFiles",
    "extraHosts",
    "links",
    "mountPoints",
    "portMappings",
    "resourceRequirements",
    "secrets",
    "systemControls",
    "ulimits",
    "volumesFrom",
  ];
  const falseDefaults = new Set([
    "disableNetworking",
    "interactive",
    "privileged",
    "pseudoTerminal",
  ]);
  const allowed = new Set([
    ...Object.keys(expected),
    "cpu",
    "dockerLabels",
    "versionConsistency",
    ...emptyDefaults,
    ...falseDefaults,
  ]);
  for (const key of Object.keys(container)) {
    assert.ok(allowed.has(key), `container has unexpected field ${key}`);
  }
  for (const key of Object.keys(expected)) {
    assert.ok(Object.hasOwn(container, key) || falseDefaults.has(key), `container misses ${key}`);
  }
  assert.equal(container.cpu ?? 0, 0);
  for (const key of emptyDefaults) assert.deepEqual(container[key] ?? [], []);
  for (const key of falseDefaults) assert.equal(container[key] ?? false, false);
  assert.deepEqual(container.dockerLabels ?? {}, {});
  assert.equal(container.versionConsistency ?? "enabled", "enabled");
  const selected = Object.fromEntries(
    Object.keys(expected).map((key) => [
      key,
      falseDefaults.has(key) ? (container[key] ?? false) : container[key],
    ]),
  );
  const environment = [...container.environment].sort((a, b) => a.name.localeCompare(b.name));
  const expectedEnvironment = [...expected.environment].sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(environment, expectedEnvironment);
  selected.environment = clone(expected.environment);
  const log = clone(selected.logConfiguration);
  assert.deepEqual(log.secretOptions ?? [], []);
  delete log.secretOptions;
  selected.logConfiguration = log;
  const linux = clone(selected.linuxParameters);
  assert.deepEqual(linux.capabilities.add ?? [], []);
  delete linux.capabilities.add;
  for (const key of ["devices", "tmpfs"]) {
    assert.deepEqual(linux[key] ?? [], []);
    delete linux[key];
  }
  for (const key of ["maxSwap", "sharedMemorySize", "swappiness"]) {
    assert.equal(linux[key] ?? 0, 0);
    delete linux[key];
  }
  selected.linuxParameters = linux;
  assert.deepEqual(selected, expected);
}

export function validateTenantLifecycleTaskDefinitionTemplate(template) {
  assert.deepEqual(Object.keys(template), [
    "AWSTemplateFormatVersion",
    "Description",
    "Metadata",
    "Conditions",
    "Resources",
    "Outputs",
  ]);
  assert.equal(template.AWSTemplateFormatVersion, "2010-09-09");
  assert.deepEqual(template.Metadata, { SafetyBoundary: tenantLifecycleTaskDefinitionSafety });
  assert.deepEqual(template.Conditions, {
    IsExpectedTarget: {
      "Fn::And": [
        { "Fn::Equals": [{ Ref: "AWS::AccountId" }, accountId] },
        { "Fn::Equals": [{ Ref: "AWS::Region" }, region] },
      ],
    },
  });
  assert.deepEqual(Object.keys(template.Resources), [logicalId]);
  const resource = template.Resources[logicalId];
  assert.deepEqual(Object.keys(resource), [
    "Type",
    "Condition",
    "DeletionPolicy",
    "UpdateReplacePolicy",
    "Properties",
  ]);
  assert.equal(resource.Type, "AWS::ECS::TaskDefinition");
  assert.equal(resource.Condition, "IsExpectedTarget");
  assert.equal(resource.DeletionPolicy, "Delete");
  assert.equal(resource.UpdateReplacePolicy, "Delete");
  assert.deepEqual(resource.Properties, expectedTenantLifecycleTaskDefinitionProperties);
  assert.deepEqual(template.Outputs, {
    TaskDefinitionArn: {
      Condition: "IsExpectedTarget",
      Value: { Ref: logicalId },
    },
  });
  for (const gate of [
    "RegistrationReady",
    "LiveReadbackReady",
    "ApplyRuntimeReady",
    "CleanupRuntimeReady",
  ]) assert.equal(template.Metadata.SafetyBoundary[gate], false);
  assert.equal(template.Metadata.SafetyBoundary.RunsTask, false);
  assertNoCredentials(template, "template");
  return deepFreeze({
    schemaVersion: 1,
    mode: "reviewed_cloudformation_task_definition",
    accountId,
    region,
    approvedStackName: stackName,
    logicalId,
    imageUri: resource.Properties.ContainerDefinitions[0].Image,
    imageDigest: tenantLifecycleTaskDefinitionSafety.ImageDigest,
    imageCommit: tenantLifecycleTaskDefinitionSafety.ImageCommit,
    propertiesCanonicalSha256: sha256Canonical(resource.Properties),
    runtimeGates: {
      registrationReady: false,
      liveReadbackReady: false,
      applyRuntimeReady: false,
      cleanupRuntimeReady: false,
    },
  });
}

function validateTags(tags, expectedExpiresAt, expectedStackId) {
  assertUtc(expectedExpiresAt, "expectedExpiresAt");
  assert.match(expectedStackId, stackIdPattern);
  const entries = tags.map((tag) => {
    assert.deepEqual(Object.keys(tag).sort(), ["key", "value"]);
    return [tag.key, tag.value];
  });
  assert.equal(new Set(entries.map(([key]) => key)).size, entries.length);
  const map = Object.fromEntries(entries);
  assert.deepEqual(Object.keys(map).sort(), [
    "AppInstanceId",
    "Component",
    "DeploymentId",
    "Environment",
    "ExpiresAt",
    "ManagedBy",
    "aws:cloudformation:logical-id",
    "aws:cloudformation:stack-id",
    "aws:cloudformation:stack-name",
  ]);
  assert.equal(map.Environment, "aws-sandbox");
  assert.equal(map.ManagedBy, "techlong-provisioner");
  assert.equal(map.Component, "tenant-lifecycle-one-shot");
  assert.equal(map.AppInstanceId, "tenant-lifecycle");
  assert.equal(map.DeploymentId, "b5j3-f4aa0febeba5");
  assert.equal(map.ExpiresAt, expectedExpiresAt);
  assert.equal(map["aws:cloudformation:logical-id"], logicalId);
  assert.equal(map["aws:cloudformation:stack-name"], stackName);
  assert.equal(map["aws:cloudformation:stack-id"], expectedStackId);
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
}

export function validateTenantLifecycleTaskDefinitionReadback(
  payload,
  { expectedExpiresAt, expectedStackId } = {},
) {
  assert.deepEqual(Object.keys(payload).sort(), ["tags", "taskDefinition"]);
  const task = payload.taskDefinition;
  const allowed = new Set([
    "compatibilities",
    "containerDefinitions",
    "cpu",
    "deregisteredAt",
    "enableFaultInjection",
    "ephemeralStorage",
    "executionRoleArn",
    "family",
    "memory",
    "networkMode",
    "placementConstraints",
    "registeredAt",
    "registeredBy",
    "requiresAttributes",
    "requiresCompatibilities",
    "revision",
    "runtimePlatform",
    "status",
    "taskDefinitionArn",
    "taskRoleArn",
    "volumes",
  ]);
  for (const key of Object.keys(task)) assert.ok(allowed.has(key), `unexpected task field ${key}`);
  const arn = taskArnPattern.exec(task.taskDefinitionArn);
  assert.ok(arn, "TaskDefinition ARN is not revision-pinned to the exact target");
  assert.equal(task.family, "tenant-lifecycle");
  assert.equal(task.revision, Number(arn[1]));
  assert.equal(task.status, "ACTIVE");
  assert.equal(task.taskRoleArn, expectedTenantLifecycleTaskDefinitionProperties.TaskRoleArn);
  assert.equal(task.executionRoleArn, expectedTenantLifecycleTaskDefinitionProperties.ExecutionRoleArn);
  assert.equal(task.networkMode, "awsvpc");
  assert.equal(task.cpu, "256");
  assert.equal(task.memory, "512");
  assert.deepEqual(task.requiresCompatibilities, ["FARGATE"]);
  assert.ok(
    Array.isArray(task.compatibilities) && task.compatibilities.includes("FARGATE"),
    "TaskDefinition compatibilities must include FARGATE",
  );
  assert.deepEqual(task.runtimePlatform, {
    cpuArchitecture: "X86_64",
    operatingSystemFamily: "LINUX",
  });
  assert.equal(task.enableFaultInjection ?? false, false);
  assert.deepEqual(task.volumes ?? [], []);
  assert.deepEqual(task.placementConstraints ?? [], []);
  assert.equal(task.deregisteredAt, undefined);
  if (task.ephemeralStorage !== undefined) {
    assert.deepEqual(task.ephemeralStorage, { sizeInGiB: 20 });
  }
  assert.match(task.registeredBy, registrarPattern);
  assert.ok(Number.isFinite(Date.parse(task.registeredAt)));
  assert.equal(task.containerDefinitions.length, 1);
  assertReadbackContainer(task.containerDefinitions[0]);
  const tags = validateTags(payload.tags, expectedExpiresAt, expectedStackId);
  assertNoCredentials(payload, "readback");
  const canonical = {
    schemaVersion: 1,
    mode: "describe_task_definition_exact_readback",
    accountId,
    region,
    stackName,
    taskDefinitionArn: task.taskDefinitionArn,
    family: task.family,
    revision: task.revision,
    status: task.status,
    image: {
      uri: task.containerDefinitions[0].image,
      digest: tenantLifecycleTaskDefinitionSafety.ImageDigest,
      sourceCommit: tenantLifecycleTaskDefinitionSafety.ImageCommit,
    },
    roles: {
      executionRoleArn: task.executionRoleArn,
      taskRoleArn: task.taskRoleArn,
    },
    resources: {
      cpu: task.cpu,
      memory: task.memory,
      networkMode: task.networkMode,
      requiresCompatibilities: clone(task.requiresCompatibilities),
      runtimePlatform: clone(task.runtimePlatform),
    },
    container: expectedReadbackContainer(),
    tags,
    registeredBy: task.registeredBy,
    runtimeGates: {
      registrationReady: false,
      liveReadbackReady: false,
      applyRuntimeReady: false,
      cleanupRuntimeReady: false,
    },
  };
  return deepFreeze({ canonical, canonicalSha256: sha256Canonical(canonical) });
}
