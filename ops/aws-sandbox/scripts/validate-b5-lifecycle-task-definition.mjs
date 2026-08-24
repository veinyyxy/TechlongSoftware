import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  expectedTenantLifecycleTaskDefinitionProperties,
  validateTenantLifecycleTaskDefinitionReadback,
  validateTenantLifecycleTaskDefinitionTemplate,
} from "./tenant-lifecycle-task-definition-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = path.join(
  root,
  "cloudformation",
  "s3-b5-lifecycle-task-definition.template.json",
);
const operationScriptPath = path.join(
  root,
  "scripts",
  "s3-b5-lifecycle-task-definition.ps1",
);
const testExpiresAt = "2026-08-24T23:59:59Z";
const testStackId =
  "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-b5j3/01234567-89ab-cdef-0123-456789abcdef";
const clone = (value) => JSON.parse(JSON.stringify(value));

function rejectMutation(template, mutate) {
  const candidate = clone(template);
  mutate(candidate);
  assert.throws(() => validateTenantLifecycleTaskDefinitionTemplate(candidate));
}

function syntheticReadback() {
  const task = expectedTenantLifecycleTaskDefinitionProperties;
  const container = task.ContainerDefinitions[0];
  return {
    taskDefinition: {
      taskDefinitionArn:
        "arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-lifecycle:1",
      containerDefinitions: [
        {
          name: container.Name,
          image: container.Image,
          cpu: 0,
          portMappings: [],
          essential: true,
          command: clone(container.Command),
          environment: container.Environment.map(({ Name, Value }) => ({
            name: Name,
            value: Value,
          })),
          mountPoints: [],
          volumesFrom: [],
          linuxParameters: {
            capabilities: { drop: clone(container.LinuxParameters.Capabilities.Drop) },
            initProcessEnabled: true,
          },
          readonlyRootFilesystem: true,
          user: "65532:65532",
          workingDirectory: "/app",
          logConfiguration: {
            logDriver: "awslogs",
            options: clone(container.LogConfiguration.Options),
            secretOptions: [],
          },
          systemControls: [],
          stopTimeout: 30,
        },
      ],
      family: "tenant-lifecycle",
      taskRoleArn: task.TaskRoleArn,
      executionRoleArn: task.ExecutionRoleArn,
      networkMode: "awsvpc",
      revision: 1,
      volumes: [],
      status: "ACTIVE",
      requiresAttributes: [
        { name: "com.amazonaws.ecs.capability.logging-driver.awslogs" },
      ],
      placementConstraints: [],
      compatibilities: ["EC2", "FARGATE"],
      requiresCompatibilities: ["FARGATE"],
      cpu: "256",
      memory: "512",
      registeredAt: "2026-08-24T16:00:00.000Z",
      registeredBy:
        "arn:aws:sts::402010193138:assumed-role/TechlongSandboxCloudFormationExecutionRole/AWSCloudFormation",
      runtimePlatform: {
        cpuArchitecture: "X86_64",
        operatingSystemFamily: "LINUX",
      },
      enableFaultInjection: false,
    },
    tags: [
      { key: "Environment", value: "aws-sandbox" },
      { key: "ManagedBy", value: "techlong-provisioner" },
      { key: "Component", value: "tenant-lifecycle-one-shot" },
      { key: "AppInstanceId", value: "tenant-lifecycle" },
      { key: "DeploymentId", value: "b5j3-f4aa0febeba5" },
      { key: "ExpiresAt", value: testExpiresAt },
    ],
  };
}

const [templateSource, operationScript] = await Promise.all([
  readFile(templatePath, "utf8"),
  readFile(operationScriptPath, "utf8"),
]);
const template = JSON.parse(templateSource);
const intent = validateTenantLifecycleTaskDefinitionTemplate(template);
assert.match(intent.propertiesCanonicalSha256, /^[a-f0-9]{64}$/);
assert.equal(templateSource.includes("ecs:RunTask"), false);
for (const field of [
  '"Secrets"',
  '"RepositoryCredentials"',
  '"EntryPoint"',
  '"PortMappings"',
  '"MountPoints"',
  '"EphemeralStorage"',
]) assert.equal(templateSource.includes(field), false);

assert.match(
  operationScript,
  /\[ValidateSet\('LocalValidate', 'OnlineValidate', 'CreateStack', 'Readback', 'DeleteStack'\)\]/,
);
assert.match(operationScript, /\[string\]\$Mode = 'LocalValidate'/);
assert.match(
  operationScript,
  /\$expectedPrincipalArn = 'arn:aws:sts::402010193138:assumed-role\/TechlongSandboxProvisionerRole\/techlong-sandbox-provisioner'/,
);
assert.match(operationScript, /\$stackName = 'techlong-sandbox-tenant-b5j3'/);
assert.match(
  operationScript,
  /\$cloudFormationRoleArn = 'arn:aws:iam::402010193138:role\/TechlongSandboxCloudFormationExecutionRole'/,
);
assert.match(operationScript, /I_ACKNOWLEDGE_INSPECT_ONLY_TASK_DEFINITION_REGISTRATION/);
assert.match(operationScript, /I_ACKNOWLEDGE_EXACT_TASK_DEFINITION_DEREGISTRATION/);
assert.match(operationScript, /Assert-NoAwsEndpointOverrides/);
assert.match(operationScript, /AWS_IGNORE_CONFIGURED_ENDPOINT_URLS/);
assert.match(operationScript, /function ConvertFrom-ExactJson/);
assert.match(operationScript, /ConvertFrom-Json -InputObject \$Json -DateKind String/);
assert.equal(
  operationScript.match(/ConvertFrom-ExactJson -Json/g)?.length,
  5,
  "all AWS JSON and canonical-evidence reads must preserve exact ISO timestamp strings",
);
assert.doesNotMatch(operationScript, /--endpoint-url\b/);
assert.match(operationScript, /'cloudformation', 'create-stack'/);
assert.match(operationScript, /'--role-arn', \$cloudFormationRoleArn/);
assert.match(operationScript, /'--on-failure', 'DELETE'/);
assert.match(operationScript, /'cloudformation', 'list-stack-resources'/);
assert.match(operationScript, /'cloudformation', 'get-template'/);
assert.match(operationScript, /'--template-stage', 'Original'/);
assert.match(operationScript, /--expected-template \$templatePath/);
assert.match(operationScript, /'ecs', 'describe-task-definition'/);
assert.match(operationScript, /'--task-definition', \$taskDefinitionArn/);
assert.match(operationScript, /'--include', 'TAGS'/);
assert.match(operationScript, /--readback \$readbackPath/);
assert.match(operationScript, /--expires-at \$ExpiresAt/);
assert.match(operationScript, /--stack-id \(\[string\]\$stack\.StackId\)/);
assert.match(
  operationScript,
  /Verified TaskDefinition readback evidence canonical SHA-256: \$evidenceHash/,
);
assert.match(operationScript, /registeredAt is outside the exact stack creation window/);
assert.equal(
  operationScript.match(
    /\$null -ne \$stack\.Parameters -and @\(\$stack\.Parameters\)\.Count -ne 0/g,
  )?.length,
  2,
  "AWS represents a no-parameter stack as null; both readback and cleanup must normalize it",
);
assert.match(operationScript, /Assert-NoActiveLifecycleTaskDefinition/);
assert.match(operationScript, /Get-ExactDeletionTarget/);
assert.match(operationScript, /INACTIVE or no longer describable/);
assert.doesNotMatch(operationScript, /confirmed INACTIVE/);
assert.match(operationScript, /registrationReady=false; liveReadbackReady=false; applyRuntimeReady=false; cleanupRuntimeReady=false/);
assert.doesNotMatch(operationScript, /'ecs', '(?:run|register|deregister)-task-definition'/);
assert.doesNotMatch(operationScript, /'ecs', 'run-task'/);
assert.doesNotMatch(operationScript, /'cloudformation', '(?:update-stack|deploy)'/);
const localValidationIndex = operationScript.indexOf(
  "Write-Host 'Running local B5-J3 one-resource TaskDefinition validation...'",
);
const firstAwsResolutionIndex = operationScript.indexOf("$awsCli = Resolve-AwsCli");
const localExitIndex = operationScript.indexOf(
  "Write-Host 'Local validation complete. No AWS API was called and no resource was changed.'",
);
const expiresGateIndex = operationScript.lastIndexOf("Assert-ExactExpiresAt -RequireFuture:");
const writeGateIndex = operationScript.lastIndexOf("Assert-WriteGate -Delete:");
const endpointGateIndex = operationScript.lastIndexOf("Assert-NoAwsEndpointOverrides");
assert.ok(
  localValidationIndex !== -1 &&
    localValidationIndex < localExitIndex &&
    localExitIndex < expiresGateIndex &&
    expiresGateIndex < writeGateIndex &&
    writeGateIndex < endpointGateIndex &&
    endpointGateIndex < firstAwsResolutionIndex,
  "local validation and write gates must execute before the first AWS API call",
);
for (const pattern of [
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s/]+@/i,
  /(?:sk_(?:live|test)|whsec_)[A-Za-z0-9]{16,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
]) {
  assert.doesNotMatch(`${templateSource}\n${operationScript}`, pattern);
}

rejectMutation(template, (value) => {
  value.Resources.Extra = { Type: "AWS::ECS::Cluster" };
});
rejectMutation(template, (value) => {
  const containers = value.Resources.TenantLifecycleTaskDefinition.Properties.ContainerDefinitions;
  containers.push(clone(containers[0]));
});
rejectMutation(template, (value) => {
  value.Resources.TenantLifecycleTaskDefinition.Properties.ContainerDefinitions[0].Command[2] =
    "destroy";
});
rejectMutation(template, (value) => {
  value.Resources.TenantLifecycleTaskDefinition.Properties.ContainerDefinitions[0].Image =
    "402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast:latest";
});
rejectMutation(template, (value) => {
  value.Resources.TenantLifecycleTaskDefinition.Properties.ContainerDefinitions[0].Environment.push(
    { Name: "DATABASE_URL", Value: "redacted" },
  );
});
rejectMutation(template, (value) => {
  value.Resources.TenantLifecycleTaskDefinition.Properties.ContainerDefinitions[0].Secrets = [
    { Name: "PGPASSWORD", ValueFrom: "arn:aws:secretsmanager:example" },
  ];
});
for (const [field, unsafe] of [
  ["Privileged", true],
  ["ReadonlyRootFilesystem", false],
  ["Interactive", true],
  ["PseudoTerminal", true],
  ["User", "0"],
]) {
  rejectMutation(template, (value) => {
    value.Resources.TenantLifecycleTaskDefinition.Properties.ContainerDefinitions[0][field] =
      unsafe;
  });
}
rejectMutation(template, (value) => {
  value.Resources.TenantLifecycleTaskDefinition.Properties.TaskRoleArn =
    "arn:aws:iam::402010193138:role/TechlongSandboxTaskRole";
});
rejectMutation(template, (value) => {
  value.Metadata.SafetyBoundary.RegistrationReady = true;
});

const readback = syntheticReadback();
const evidence = validateTenantLifecycleTaskDefinitionReadback(readback, {
  expectedExpiresAt: testExpiresAt,
  expectedStackId: testStackId,
});
assert.equal(evidence.canonical.image.digest, intent.imageDigest);
assert.deepEqual(evidence.canonical.cloudFormation, {
  stackId: testStackId,
  logicalResourceId: "TenantLifecycleTaskDefinition",
});
for (const gate of Object.values(evidence.canonical.runtimeGates)) {
  assert.equal(gate, false);
}
assert.match(evidence.canonicalSha256, /^[a-f0-9]{64}$/);
assert.equal(
  evidence.canonicalSha256,
  validateTenantLifecycleTaskDefinitionReadback(clone(readback), {
    expectedExpiresAt: testExpiresAt,
    expectedStackId: testStackId,
  }).canonicalSha256,
);

for (const mutate of [
  (value) => (value.taskDefinition.status = "INACTIVE"),
  (value) => (value.taskDefinition.compatibilities = ["EC2"]),
  (value) =>
    (value.taskDefinition.taskDefinitionArn =
      "arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-lifecycle"),
  (value) =>
    (value.taskDefinition.registeredBy =
      "arn:aws:sts::402010193138:assumed-role/TechlongSandboxDeploymentWorkerRole/worker"),
  (value) =>
    (value.taskDefinition.containerDefinitions[0].image =
      "402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast:latest"),
  (value) =>
    (value.taskDefinition.containerDefinitions[0].command[2] = "destroy"),
  (value) =>
    value.taskDefinition.containerDefinitions[0].environment.push({
      name: "DATABASE_URL",
      value: "redacted",
    }),
  (value) => (value.taskDefinition.containerDefinitions[0].privileged = true),
  (value) =>
    (value.taskDefinition.containerDefinitions[0].portMappings = [
      { containerPort: 3000 },
    ]),
  (value) =>
    (value.tags.find((tag) => tag.key === "DeploymentId").value = "foreign"),
  (value) =>
    value.tags.push({
      key: "aws:cloudformation:stack-id",
      value: testStackId,
    }),
  (value) => value.tags.push({ key: "CellId", value: "cell-sandbox-1" }),
]) {
  const candidate = clone(readback);
  mutate(candidate);
  assert.throws(() =>
    validateTenantLifecycleTaskDefinitionReadback(candidate, {
      expectedExpiresAt: testExpiresAt,
      expectedStackId: testStackId,
    }),
  );
}

assert.throws(() =>
  validateTenantLifecycleTaskDefinitionReadback(clone(readback), {
    expectedExpiresAt: testExpiresAt,
    expectedStackId:
      "arn:aws:cloudformation:ca-central-1:402010193138:stack/foreign/01234567-89ab-cdef-0123-456789abcdef",
  }),
);

const readbackIndex = process.argv.indexOf("--readback");
if (readbackIndex !== -1) {
  const expiresIndex = process.argv.indexOf("--expires-at");
  const stackIdIndex = process.argv.indexOf("--stack-id");
  const readbackFile = process.argv[readbackIndex + 1];
  const expectedExpiresAt = expiresIndex === -1 ? undefined : process.argv[expiresIndex + 1];
  const expectedStackId = stackIdIndex === -1 ? undefined : process.argv[stackIdIndex + 1];
  assert.ok(readbackFile, "--readback requires a JSON file path");
  assert.ok(expectedExpiresAt, "--readback requires --expires-at");
  assert.ok(expectedStackId, "--readback requires --stack-id");
  const payload = JSON.parse(await readFile(path.resolve(readbackFile), "utf8"));
  const liveEvidence = validateTenantLifecycleTaskDefinitionReadback(payload, {
    expectedExpiresAt,
    expectedStackId,
  });
  process.stdout.write(`${canonicalJson(liveEvidence)}\n`);
} else {
  console.log(
    `B5-J3 one-resource inspect-only TaskDefinition template and readback mutation tests passed (${intent.propertiesCanonicalSha256}).`,
  );
}
