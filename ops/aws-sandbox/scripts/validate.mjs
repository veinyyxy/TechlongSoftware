import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderBootstrapTemplate } from "./render-bootstrap.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const projectRoot = path.resolve(root, "..", "..");
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

async function readJson(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const source = await readFile(absolutePath, "utf8");
  try {
    return { value: JSON.parse(source), source };
  } catch (error) {
    failures.push(`${relativePath} is not valid JSON: ${error.message}`);
    return { value: null, source };
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

function actionsFrom(policy, effect) {
  if (!policy || !Array.isArray(policy.Statement)) return [];
  return policy.Statement
    .filter((statement) => statement.Effect === effect && statement.Action)
    .flatMap((statement) => asArray(statement.Action));
}

function collectRefs(value, refs = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
    return refs;
  }
  if (!value || typeof value !== "object") return refs;
  if (typeof value.Ref === "string") refs.push(value.Ref);
  for (const child of Object.values(value)) collectRefs(child, refs);
  return refs;
}

async function listTextFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTextFiles(absolutePath)));
    } else if (/\.(?:cjs|json|md|mjs|ps1|ya?ml)$/i.test(entry.name)) {
      files.push(absolutePath);
    }
  }
  return files;
}

const [
  configResult,
  templateResult,
  bootstrapResult,
  boundaryResult,
  denyResult,
  janitorSource,
  imageBuildspec,
] =
  await Promise.all([
    readJson("sandbox.example.json"),
    readJson("cloudformation/guardrails.template.json"),
    readJson("cloudformation/s3-bootstrap.template.json"),
    readJson("policies/provisioner-permissions-boundary.example.json"),
    readJson("policies/sandbox-expensive-actions-deny.example.json"),
    readFile(path.join(root, "lambda", "janitor.cjs"), "utf8"),
    readFile(path.join(root, "codebuild", "buildspec.aws-sandbox.yml"), "utf8"),
  ]);

check(
  imageBuildspec.includes("docker image inspect --format '{{.Config.User}}'") &&
    imageBuildspec.includes('= "65532:65532"'),
  "image build must verify the final runtime user",
);
check(
  imageBuildspec.includes("--entrypoint /usr/local/bin/node") &&
    imageBuildspec.includes("grep -Fx 'v24.18.0'"),
  "image build must smoke-test the pinned Node runtime",
);
check(
  imageBuildspec.includes("require('bcrypt'); require('pg');"),
  "image build must load native and database runtime dependencies before push",
);

const config = configResult.value;
if (config) {
  check(config.schemaVersion === 1, "sandbox config schemaVersion must be 1");
  check(config.environment === "aws-sandbox", "environment must be aws-sandbox");
  check(config.aws?.accountId === "402010193138", "unexpected AWS account id");
  check(config.aws?.region === "ca-central-1", "unexpected AWS region");
  check(config.aws?.profile === "techlong-sandbox-user", "unexpected AWS profile name");
  check(config.aws?.cloudApplyEnabled === false, "cloud apply must remain disabled");
  check(config.aws?.requireStsAccountMatch === true, "STS account check must be required");
  check(
    config.aws?.cloudFormationStackPrefix === "techlong-sandbox-tenant-",
    "provisioner stack prefix must be tenant-only",
  );
  check(config.costControls?.monthlyBudgetUsd === 10, "monthly budget must default to 10 USD");
  check(config.costControls?.includeCreditsInBudget === false, "budget must exclude credits");
  check(
    JSON.stringify(config.costControls?.warningThresholdPercentages) ===
      JSON.stringify([10, 30, 50, 80, 100]),
    "unexpected budget thresholds",
  );
  check(config.lifecycle?.deploymentTtlSeconds === 7200, "deployment TTL must be 7200 seconds");
  check(
    config.lifecycle?.requireCleanupScheduleBeforeProvisioning === true,
    "cleanup schedule must be required before provisioning",
  );
  for (const key of [
    "maxConcurrentCells",
    "maxConcurrentDeployments",
    "maxConcurrentTenants",
    "maxDesiredTaskCount",
  ]) {
    check(config.limits?.[key] === 1, `${key} must remain 1`);
  }
  check(
    config.database?.provider === "aurora-postgresql-serverless-v2",
    "database provider must remain Aurora PostgreSQL Serverless v2",
  );
  check(config.database?.engine === "aurora-postgresql", "database engine must remain Aurora PostgreSQL");
  check(config.database?.engineMajorVersion === 16, "Aurora PostgreSQL major version must remain 16");
  check(
    config.database?.minimumEngineVersion === "16.3",
    "Aurora PostgreSQL must support Serverless v2 auto-pause",
  );
  check(config.database?.isolation === "tenant_database", "database isolation must be tenant_database");
  check(config.database?.minAcu === 0, "Aurora minimum capacity must remain 0 ACU");
  check(config.database?.maxAcu === 1, "Aurora maximum capacity must remain 1 ACU");
  check(config.database?.secondsUntilAutoPause === 300, "Aurora auto-pause must remain 300 seconds");
  check(config.database?.maxCellClusters === 1, "only one Aurora Cell cluster is allowed");
  check(config.database?.maxReaderInstances === 0, "Sandbox must not create Aurora readers");
  check(config.database?.allowDedicatedTenantDatabase === false, "dedicated tenant databases must remain disabled");
  check(config.database?.allowTraditionalMultiAz === false, "traditional Multi-AZ must remain disabled");
  check(config.database?.allowDbProxy === false, "DB Proxy must remain disabled");
  check(config.database?.allowSnapshotRestore === false, "snapshot restore must remain disabled");
  check(config.dns?.delegatedZone === "sandbox.techlong.cloud", "unexpected sandbox domain");
  check(config.dns?.createHostedZoneAutomatically === false, "hosted zone auto-create must be disabled");
  check(config.aws?.bootstrapStackName === "techlong-s3-bootstrap", "bootstrap stack name drifted");
  check(config.aws?.requireMfaToAssumeProvisionerRole === true, "provisioner role must require MFA");
  check(config.build?.repositoryName === "techlong-sandbox-speedfeast", "ECR repository name drifted");
  check(config.build?.imageTagMutability === "IMMUTABLE", "ECR tags must remain immutable");
  check(config.build?.sourceRetentionDays === 1, "build source retention must remain one day");
  check(config.build?.codeBuildImage === "aws/codebuild/standard:8.0", "CodeBuild image drifted");
  check(config.build?.computeType === "BUILD_GENERAL1_SMALL", "CodeBuild compute must remain small");
  check(config.build?.timeoutMinutes === 5, "CodeBuild timeout must remain five minutes");
  check(config.build?.queuedTimeoutMinutes === 5, "CodeBuild queue timeout must remain five minutes");
  check(config.build?.concurrentBuildLimit === 1, "CodeBuild concurrency must remain one");
}

const template = templateResult.value;
if (template) {
  const parameters = template.Parameters ?? {};
  const conditions = template.Conditions ?? {};
  const resources = template.Resources ?? {};
  check(parameters.ExpectedAccountId?.Default === "402010193138", "template account default drifted");
  check(
    JSON.stringify(parameters.ExpectedAccountId?.AllowedValues) === JSON.stringify(["402010193138"]),
    "template account parameter must be fixed",
  );
  check(parameters.ExpectedRegion?.Default === "ca-central-1", "template region default drifted");
  check(parameters.MonthlyBudgetUsd?.Default === 10, "template budget default drifted");
  check(parameters.MonthlyBudgetUsd?.MinValue === 10, "template budget minimum must be fixed at 10");
  check(parameters.MonthlyBudgetUsd?.MaxValue === 10, "template budget maximum must be fixed at 10");
  check(
    JSON.stringify(parameters.MonthlyBudgetUsd?.AllowedValues) === JSON.stringify([10]),
    "template budget allowed value must be fixed at 10",
  );
  check(parameters.DeploymentTtlSeconds?.Default === 7200, "template TTL default drifted");
  check(parameters.MaxConcurrentDeployments?.Default === 1, "template max concurrency drifted");
  check(parameters.SandboxDomain?.Default === "sandbox.techlong.cloud", "template domain drifted");
  check(
    JSON.stringify(parameters.SandboxDomain?.AllowedValues) === JSON.stringify(["sandbox.techlong.cloud"]),
    "template sandbox domain must be fixed",
  );
  check(Boolean(conditions.IsExpectedAccount), "missing account condition");
  check(Boolean(conditions.IsExpectedRegion), "missing region condition");
  check(Boolean(conditions.IsExpectedTarget), "missing combined target condition");

  const resourceEntries = Object.entries(resources);
  check(resourceEntries.length === 1, "S0 guardrails template must contain exactly one resource");
  const budget = resources.SandboxMonthlyCostBudget;
  check(budget?.Type === "AWS::Budgets::Budget", "S0 resource must be an AWS Budget");
  check(budget?.Condition === "IsExpectedTarget", "budget must be protected by account and region conditions");
  check(
    budget?.Properties?.Budget?.BudgetLimit?.Amount?.Ref === "MonthlyBudgetUsd",
    "budget amount must come from MonthlyBudgetUsd",
  );
  check(budget?.Properties?.Budget?.TimeUnit === "MONTHLY", "budget must be monthly");
  check(budget?.Properties?.Budget?.CostTypes?.IncludeCredit === false, "budget must exclude credits");
  check(
    JSON.stringify(budget?.Properties?.Budget?.CostFilters?.TagKeyValue) ===
      JSON.stringify(["user:Environment$aws-sandbox"]),
    "budget must be filtered to the aws-sandbox Environment cost allocation tag",
  );
  const notifications = budget?.Properties?.NotificationsWithSubscribers ?? [];
  check(notifications.length === 5, "budget must have exactly five notifications");
  check(
    JSON.stringify(notifications.map((item) => item.Notification?.Threshold)) ===
      JSON.stringify([10, 30, 50, 80, 100]),
    "budget notification thresholds drifted",
  );
  check(
    notifications.every(
      (item) =>
        item.Notification?.NotificationType === "ACTUAL" &&
        item.Notification?.ThresholdType === "PERCENTAGE" &&
        item.Subscribers?.[0]?.Address?.Ref === "BudgetAlertEmail" &&
        item.Subscribers?.[0]?.SubscriptionType === "EMAIL",
    ),
    "budget notifications must use actual percentage and the email parameter",
  );

  const knownRefs = new Set([
    ...Object.keys(parameters),
    ...Object.keys(resources),
    "AWS::AccountId",
    "AWS::NoValue",
    "AWS::NotificationARNs",
    "AWS::Partition",
    "AWS::Region",
    "AWS::StackId",
    "AWS::StackName",
    "AWS::URLSuffix",
  ]);
  for (const ref of collectRefs(template)) {
    check(knownRefs.has(ref), `CloudFormation contains an unknown Ref: ${ref}`);
  }
  for (const [logicalId, resource] of resourceEntries) {
    if (resource.Condition) {
      check(Boolean(conditions[resource.Condition]), `${logicalId} uses an unknown condition`);
    }
  }
}

const bootstrap = bootstrapResult.value;
if (bootstrap) {
  const parameters = bootstrap.Parameters ?? {};
  const conditions = bootstrap.Conditions ?? {};
  const resources = bootstrap.Resources ?? {};
  const outputs = bootstrap.Outputs ?? {};
  check(parameters.ExpectedAccountId?.Default === "402010193138", "bootstrap account drifted");
  check(parameters.ExpectedRegion?.Default === "ca-central-1", "bootstrap region drifted");
  check(
    parameters.ProvisionerPrincipalArn?.Default ===
      "arn:aws:iam::402010193138:user/techlong-sandbox-dev",
    "bootstrap principal drifted",
  );
  check(parameters.ScheduleGroupName?.Default === "techlong-sandbox", "schedule group drifted");
  check(Boolean(conditions.IsExpectedTarget), "bootstrap is missing its target condition");
  check(
    bootstrap.Metadata?.SafetyBoundary?.TenantStackPrefix ===
      "techlong-sandbox-tenant-",
    "bootstrap tenant stack prefix drifted",
  );
  for (const [logicalId, resource] of Object.entries(resources)) {
    check(resource.Condition === "IsExpectedTarget", `${logicalId} is not target-guarded`);
    check(
      !["AWS::IAM::User", "AWS::IAM::Group", "AWS::IAM::UserToGroupAddition"].includes(
        resource.Type,
      ),
      `${logicalId} must not modify the existing IAM user or group`,
    );
  }

  const roles = Object.entries(resources).filter(([, resource]) => resource.Type === "AWS::IAM::Role");
  check(roles.length >= 6, "bootstrap must define bounded service roles");
  for (const [logicalId, role] of roles) {
    check(Boolean(role.Properties?.PermissionsBoundary), `${logicalId} is missing a permissions boundary`);
    check(role.Properties?.MaxSessionDuration === 3600, `${logicalId} session duration must be one hour`);
  }

  const provisioner = resources.ProvisionerRole?.Properties;
  const provisionerTrust = provisioner?.AssumeRolePolicyDocument?.Statement?.[0];
  check(provisioner?.RoleName === "TechlongSandboxProvisionerRole", "provisioner role name drifted");
  check(
    provisionerTrust?.Principal?.AWS?.Ref === "ProvisionerPrincipalArn",
    "provisioner trust must use the fixed principal parameter",
  );
  check(
    provisionerTrust?.Condition?.Bool?.["aws:MultiFactorAuthPresent"] === "true",
    "provisioner trust must require MFA",
  );
  check(
    provisionerTrust?.Condition?.StringEquals?.["sts:RoleSessionName"] ===
      "techlong-sandbox-provisioner",
    "provisioner role session name must be fixed",
  );

  const janitor = resources.JanitorFunction?.Properties;
  check(janitor?.FunctionName === "techlong-sandbox-janitor", "Janitor name drifted");
  check(janitor?.Runtime === "nodejs22.x", "Janitor runtime drifted");
  check(
    !("ReservedConcurrentExecutions" in (janitor ?? {})),
    "Janitor must not reserve account concurrency; low-quota accounts require at least ten unreserved executions",
  );
  check(janitor?.MemorySize === 128, "Janitor memory must remain 128 MiB");
  check(janitor?.Timeout === 30, "Janitor timeout must remain 30 seconds");
  check(
    janitor?.Code?.ZipFile === "__JANITOR_INLINE_SOURCE__",
    "Janitor source marker is missing",
  );
  const janitorRolePolicy =
    resources.JanitorExecutionRole?.Properties?.Policies?.[0]?.PolicyDocument;
  const janitorAllowed = actionsFrom(janitorRolePolicy, "Allow");
  check(
    JSON.stringify([...janitorAllowed].sort()) ===
      JSON.stringify(
        [
          "cloudformation:DeleteStack",
          "cloudformation:DescribeStacks",
          "cloudformation:ListStacks",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ].sort(),
      ),
    "Janitor role permissions are broader than its scan/delete/log contract",
  );

  const serviceBoundary = resources.ServiceRoleBoundary?.Properties?.PolicyDocument;
  const serviceBoundaryActions = actionsFrom(serviceBoundary, "Allow");
  check(
    serviceBoundaryActions.includes("ecr:DescribeImages"),
    "CodeBuild ecr:DescribeImages is blocked by the service role boundary",
  );
  const tenantStackResource =
    "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-*/*";
  const janitorBoundaryStackStatement = serviceBoundary?.Statement?.find(
    (statement) => statement.Sid === "AllowJanitorOnlySandboxStacks",
  );
  check(
    janitorBoundaryStackStatement?.Resource === tenantStackResource,
    "Janitor boundary must never include shared Sandbox stacks",
  );
  const janitorIdentityStackStatement = janitorRolePolicy?.Statement?.find(
    (statement) => asArray(statement.Action).includes("cloudformation:DeleteStack"),
  );
  check(
    janitorIdentityStackStatement?.Resource === tenantStackResource,
    "Janitor identity policy must be tenant-stack-only",
  );
  const expectedSecretResource =
    "arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/*";
  const boundarySecretStatement = serviceBoundary?.Statement?.find(
    (statement) => statement.Sid === "AllowTaskRuntimeSecrets",
  );
  check(
    boundarySecretStatement?.Resource === expectedSecretResource,
    "service role boundary Secret prefix must match the platform allowlist",
  );
  const taskSecretStatement = resources.TaskExecutionRole?.Properties?.Policies?.[0]
    ?.PolicyDocument?.Statement?.find(
      (statement) => asArray(statement.Action).includes("secretsmanager:GetSecretValue"),
    );
  check(
    taskSecretStatement?.Resource === expectedSecretResource,
    "task execution role Secret prefix must match the platform allowlist",
  );
  const executionBoundaryActions = actionsFrom(
    resources.ExecutionRoleBoundary?.Properties?.PolicyDocument,
    "Allow",
  );
  check(
    !executionBoundaryActions.some((action) => action.startsWith("application-autoscaling:")),
    "single-task Sandbox execution role must not have Application Auto Scaling permissions",
  );
  check(
    !executionBoundaryActions.includes("iam:CreateServiceLinkedRole"),
    "single-task Sandbox execution role must not create an Auto Scaling service-linked role",
  );
  const provisionerBoundary = resources.ProvisionerBoundary?.Properties?.PolicyDocument;
  for (const sid of [
    "AllowCreateOnlyTaggedSandboxStacks",
    "AllowSandboxStackLifecycle",
  ]) {
    check(
      provisionerBoundary?.Statement?.find((statement) => statement.Sid === sid)
        ?.Resource === tenantStackResource,
      `${sid} must be tenant-stack-only`,
    );
  }
  const provisionerImageRead = provisionerBoundary?.Statement?.find(
    (statement) => statement.Sid === "AllowReadSandboxImage",
  );
  check(
    asArray(provisionerImageRead?.Action).includes(
      "ecr:DescribeImageScanFindings",
    ),
    "Provisioner must read scan findings before an image can be approved",
  );
  check(
    provisionerImageRead?.Resource ===
      "arn:aws:ecr:ca-central-1:402010193138:repository/techlong-sandbox-speedfeast",
    "Provisioner image reads must remain limited to the Sandbox repository",
  );

  const group = resources.SandboxScheduleGroup?.Properties;
  const schedule = resources.GlobalJanitorSchedule?.Properties;
  check(group?.Name?.Ref === "ScheduleGroupName", "Scheduler group must use its fixed parameter");
  check(schedule?.GroupName?.Ref === "ScheduleGroupName", "global scan must use the sandbox group");
  check(schedule?.ScheduleExpression === "rate(15 minutes)", "Janitor scan must run every 15 minutes");
  check(schedule?.FlexibleTimeWindow?.Mode === "OFF", "Janitor flexible time window must be off");
  check(
    schedule?.Target?.RoleArn?.["Fn::GetAtt"]?.[0] === "SchedulerInvokeRole",
    "global scan must use the bounded Scheduler invoke role",
  );
  check(
    resources.SchedulerInvokeRole?.Properties?.AssumeRolePolicyDocument?.Statement?.[0]
      ?.Condition?.ArnLike?.["aws:SourceArn"] ===
      "arn:aws:scheduler:ca-central-1:402010193138:schedule-group/techlong-sandbox",
    "Scheduler trust must be limited to the sandbox schedule group",
  );

  const repository = resources.SandboxEcrRepository?.Properties;
  check(repository?.RepositoryName?.Ref === "EcrRepositoryName", "ECR name must use fixed parameter");
  check(repository?.ImageTagMutability === "IMMUTABLE", "ECR tags must be immutable");
  check(repository?.ImageScanningConfiguration?.ScanOnPush === true, "ECR must scan on push");
  check(repository?.EmptyOnDelete === true, "rollback must not strand Sandbox ECR images");
  const lifecycle = JSON.parse(repository?.LifecyclePolicy?.LifecyclePolicyText ?? "{}");
  check(lifecycle.rules?.length === 2, "ECR lifecycle must contain two cleanup rules");
  check(
    lifecycle.rules?.some(
      (rule) => rule.selection?.tagStatus === "any" && rule.selection?.countNumber === 2,
    ),
    "ECR must retain at most two images",
  );

  const sourceBucket = resources.CodeBuildSourceBucket;
  check(sourceBucket?.DeletionPolicy === "Delete", "source bucket deletion policy must be explicit");
  check(sourceBucket?.UpdateReplacePolicy === "Delete", "source bucket replacement policy must be explicit");
  check(
    sourceBucket?.Properties?.BucketName ===
      "techlong-sandbox-build-source-402010193138-ca-central-1",
    "source bucket name drifted",
  );
  check(
    Object.values(sourceBucket?.Properties?.PublicAccessBlockConfiguration ?? {}).every(
      (value) => value === true,
    ),
    "source bucket public access must be fully blocked",
  );
  check(
    sourceBucket?.Properties?.LifecycleConfiguration?.Rules?.[0]?.ExpirationInDays === 1,
    "source objects must expire after one day",
  );
  const sourceBucketPolicy =
    resources.CodeBuildSourceBucketPolicy?.Properties?.PolicyDocument?.Statement?.[0];
  check(sourceBucketPolicy?.Effect === "Deny", "source bucket policy must be deny-only");
  check(sourceBucketPolicy?.Action === "s3:*", "source bucket policy must cover every S3 action");
  check(
    sourceBucketPolicy?.Condition?.Bool?.["aws:SecureTransport"] === "false",
    "source bucket must deny insecure transport",
  );

  const build = resources.SandboxCodeBuildProject?.Properties;
  check(build?.ConcurrentBuildLimit === 1, "CodeBuild concurrency must remain one");
  check(build?.TimeoutInMinutes === 5, "CodeBuild timeout must remain five minutes");
  check(build?.QueuedTimeoutInMinutes === 5, "CodeBuild queue timeout must remain five minutes");
  check(build?.Source?.Type === "NO_SOURCE", "CodeBuild must have no implicit source");
  check(build?.Environment?.Image === "aws/codebuild/standard:8.0", "CodeBuild image drifted");
  check(build?.Environment?.ComputeType === "BUILD_GENERAL1_SMALL", "CodeBuild compute drifted");
  check(build?.Environment?.PrivilegedMode === true, "Docker builds require privileged mode");
  check(!build?.Triggers, "CodeBuild must not have automatic triggers");
  check(!build?.VpcConfig, "CodeBuild must not create a VPC/NAT dependency");

  for (const outputName of [
    "ProvisionerRoleArn",
    "CloudFormationExecutionRoleArn",
    "JanitorFunctionArn",
    "SchedulerInvokeRoleArn",
    "SchedulerGroupName",
    "EcrRepositoryUri",
    "CodeBuildSourceBucketName",
    "CodeBuildProjectName",
  ]) {
    check(Boolean(outputs[outputName]), `bootstrap output ${outputName} is missing`);
  }

  const knownRefs = new Set([
    ...Object.keys(parameters),
    ...Object.keys(resources),
    "AWS::AccountId",
    "AWS::NoValue",
    "AWS::NotificationARNs",
    "AWS::Partition",
    "AWS::Region",
    "AWS::StackId",
    "AWS::StackName",
    "AWS::URLSuffix",
  ]);
  for (const ref of collectRefs(bootstrap)) {
    check(knownRefs.has(ref), `bootstrap contains an unknown Ref: ${ref}`);
  }
}

try {
  const renderedBootstrap = await renderBootstrapTemplate();
  const rendered = JSON.parse(renderedBootstrap);
  check(
    rendered.Resources?.JanitorFunction?.Properties?.Code?.ZipFile === janitorSource,
    "rendered bootstrap did not inject the reviewed Janitor source",
  );
  check(
    Buffer.byteLength(renderedBootstrap, "utf8") <= 51_200,
    "rendered bootstrap exceeds CloudFormation direct body limit",
  );
} catch (error) {
  failures.push(`bootstrap render failed: ${error.message}`);
}

try {
  const loadedModule = { exports: {} };
  const load = new Function("module", "exports", "require", janitorSource);
  load(loadedModule, loadedModule.exports, () => {
    throw new Error("Janitor pure contract test must not load the AWS SDK");
  });
  const { createHandler, isEligibleStack, parseExpiresAt } = loadedModule.exports;
  const now = Date.parse("2026-08-09T12:00:00.000Z");
  const safeStack = {
    StackName: "techlong-sandbox-tenant-abc123",
    StackStatus: "CREATE_COMPLETE",
    Tags: [
      { Key: "Environment", Value: "aws-sandbox" },
      { Key: "ManagedBy", Value: "techlong-provisioner" },
      { Key: "DeploymentId", Value: "deployment-1" },
      { Key: "AppInstanceId", Value: "instance-1" },
      { Key: "CellId", Value: "cell-sandbox-1" },
      { Key: "ResourceGeneration", Value: "1" },
      { Key: "ExpiresAt", Value: "2026-08-09T11:59:59.000Z" },
    ],
  };
  check(parseExpiresAt("2026-02-30T00:00:00Z") === null, "Janitor accepted an invalid calendar date");
  check(parseExpiresAt("2026-08-09T11:59:59") === null, "Janitor accepted a non-UTC expiry");
  check(isEligibleStack(safeStack, now), "Janitor rejected a valid expired Sandbox stack");
  check(
    !isEligibleStack({ ...safeStack, StackName: "speedfeast-prod" }, now),
    "Janitor accepted a production stack name",
  );
  check(
    !isEligibleStack(
      { ...safeStack, StackName: "techlong-sandbox-cell-one" },
      now,
    ),
    "Janitor accepted a shared Cell stack with forged tenant tags",
  );
  check(
    !isEligibleStack({ ...safeStack, RootId: "nested" }, now),
    "Janitor accepted a nested stack",
  );
  check(
    isEligibleStack({ ...safeStack, StackStatus: "DELETE_FAILED" }, now),
    "Janitor must retry an expired, fully tagged DELETE_FAILED stack",
  );
  check(
    !isEligibleStack({ ...safeStack, StackStatus: "DELETE_IN_PROGRESS" }, now) &&
      !isEligibleStack({ ...safeStack, StackStatus: "DELETE_COMPLETE" }, now),
    "Janitor must not re-delete an in-progress or completed deletion",
  );
  check(
    !isEligibleStack(
      {
        ...safeStack,
        Tags: safeStack.Tags.map((tag) =>
          tag.Key === "Environment" ? { ...tag, Value: "production" } : tag,
        ),
      },
      now,
    ),
    "Janitor accepted a non-Sandbox Environment tag",
  );
  check(
    !isEligibleStack(
      {
        ...safeStack,
        Tags: safeStack.Tags.map((tag) =>
          tag.Key === "ExpiresAt"
            ? { ...tag, Value: "2026-08-09T12:00:01.000Z" }
            : tag,
        ),
      },
      now,
    ),
    "Janitor accepted a future expiry",
  );

  const deleted = [];
  const handler = createHandler(
    {
      async listStackNames() {
        return [safeStack.StackName, "speedfeast-prod"];
      },
      async describeStack(name) {
        if (name !== safeStack.StackName) throw new Error("unexpected describe");
        return safeStack;
      },
      async deleteStack(name) {
        deleted.push(name);
      },
    },
    () => now,
  );
  const scanResult = await handler({ action: "scan_expired_cloudformation_stacks" });
  check(
    JSON.stringify(deleted) === JSON.stringify([safeStack.StackName]) &&
      scanResult.deleted.length === 1,
    "Janitor scan did not limit deletion to the eligible Sandbox stack",
  );
  const mismatchResult = await handler({
    action: "delete_cloudformation_stack",
    stackName: safeStack.StackName,
    deploymentId: "different-deployment",
    appInstanceId: "instance-1",
    resourceGeneration: 1,
  });
  check(mismatchResult.deleted.length === 0, "Janitor ignored the targeted DeploymentId binding");
  const ownerMismatchResult = await handler({
    action: "delete_cloudformation_stack",
    stackName: safeStack.StackName,
    deploymentId: "deployment-1",
    appInstanceId: "different-instance",
    resourceGeneration: 1,
  });
  check(
    ownerMismatchResult.deleted.length === 0,
    "Janitor ignored the targeted stable AppInstanceId binding",
  );
  const generationMismatchResult = await handler({
    action: "delete_cloudformation_stack",
    stackName: safeStack.StackName,
    deploymentId: "deployment-1",
    appInstanceId: "instance-1",
    resourceGeneration: 2,
  });
  check(
    generationMismatchResult.deleted.length === 0,
    "Janitor ignored the targeted tenant resource generation fence",
  );

  const retryDeletes = [];
  const retryHandler = createHandler(
    {
      async listStackNames() {
        return [safeStack.StackName];
      },
      async describeStack() {
        return { ...safeStack, StackStatus: "DELETE_FAILED" };
      },
      async deleteStack(name) {
        retryDeletes.push(name);
      },
    },
    () => now,
  );
  await retryHandler({ action: "scan_expired_cloudformation_stacks" });
  check(
    JSON.stringify(retryDeletes) === JSON.stringify([safeStack.StackName]),
    "Janitor scan did not retry DeleteStack for DELETE_FAILED",
  );
  check(
    !janitorSource.includes('StackStatus.startsWith("DELETE_")') &&
      !janitorSource.includes('summary.StackStatus !== "DELETE_FAILED"') &&
      janitorSource.includes('summary.StackStatus !== "DELETE_IN_PROGRESS"') &&
      janitorSource.includes('summary.StackStatus !== "DELETE_COMPLETE"'),
    "Janitor inventory must not blanket-filter DELETE_FAILED",
  );
} catch (error) {
  failures.push(`Janitor contract test failed: ${error.message}`);
}

const [bootstrapScript, buildScript, rollbackScript] = await Promise.all([
  readFile(path.join(root, "scripts", "s3-bootstrap.ps1"), "utf8"),
  readFile(path.join(root, "scripts", "s3-build-image.ps1"), "utf8"),
  readFile(path.join(root, "scripts", "s3-rollback.ps1"), "utf8"),
]);
const platformParameterSource = await readFile(
  path.join(projectRoot, "lib", "deployments", "execution", "parameters.ts"),
  "utf8",
);
check(
  /resourcePattern:\s*\/secret:techlong\\\/sandbox\\\//.test(platformParameterSource),
  "platform Secret parameter allowlist must remain techlong/sandbox/*",
);
check(
  /\$noExecute\s*=\s*@\('\-\-no-execute-changeset'\)/.test(bootstrapScript),
  "CreateChangeSet mode must define the no-execute flag",
);
check(
  /\$budgetArgs\s*=\s*@\([\s\S]*?\)\s*\+\s*\$noExecute[\s\S]*?-Arguments\s+\$budgetArgs/.test(
    bootstrapScript,
  ),
  "Budget CreateChangeSet arguments must include the no-execute flag",
);
check(
  /\$bootstrapArgs\s*=\s*@\([\s\S]*?\)\s*\+\s*\$noExecute[\s\S]*?-Arguments\s+\$bootstrapArgs/.test(
    bootstrapScript,
  ),
  "Bootstrap CreateChangeSet arguments must include the no-execute flag",
);
check(
  buildScript.includes("[string]$Profile = 'techlong-sandbox-provisioner'") &&
    buildScript.includes(
      "arn:aws:sts::402010193138:assumed-role/TechlongSandboxProvisionerRole/techlong-sandbox-provisioner",
    ),
  "image build must require the dedicated MFA-backed assumed role",
);
check(
  buildScript.indexOf("ecr list-images") < buildScript.indexOf("s3api put-object") &&
    buildScript.indexOf("ecr list-images") < buildScript.indexOf("codebuild start-build"),
  "image build must reuse an immutable ECR tag before upload or CodeBuild",
);
for (const forbidden of [
  "firebase",
  "service[-_]?account",
  "migration-artifacts",
  "\\.env",
  "\\.(?:backup|dump|key|p12|pem|pfx|tar|tgz|zip)",
]) {
  check(buildScript.includes(forbidden), `image package denylist is missing ${forbidden}`);
}
check(
  rollbackScript.includes("$sourceBucket = 'techlong-sandbox-build-source-402010193138-ca-central-1'") &&
    rollbackScript.includes("--logical-resource-id CodeBuildSourceBucket") &&
    rollbackScript.indexOf('s3 rm "s3://$sourceBucket/source/"') <
      rollbackScript.indexOf("cloudformation delete-stack"),
  "rollback must empty only the fixed source bucket before deleting bootstrap",
);
check(
  !rollbackScript.includes("--stack-status-filter") &&
    rollbackScript.includes("$_.StackStatus -ne 'DELETE_COMPLETE'") &&
    rollbackScript.includes("$tenantStacks.Count -gt 0"),
  "rollback must block on every prefixed stack state except DELETE_COMPLETE",
);

const boundary = boundaryResult.value;
if (boundary) {
  check(boundary.Version === "2012-10-17", "boundary policy version is invalid");
  check(Array.isArray(boundary.Statement), "boundary Statement must be an array");
  const allowedActions = actionsFrom(boundary, "Allow");
  check(!allowedActions.includes("*"), "boundary must not allow every AWS action");
  check(
    !allowedActions.some((action) => typeof action === "string" && action.endsWith(":*")),
    "boundary Allow statements must not use service-wide wildcards",
  );
  check(allowedActions.includes("sts:GetCallerIdentity"), "boundary must allow STS identity verification");
  check(allowedActions.includes("cloudformation:CreateStack"), "boundary must allow controlled stack creation");
  check(allowedActions.includes("cloudformation:DeleteStack"), "boundary must allow cleanup");
  check(allowedActions.includes("iam:PassRole"), "boundary must allow only the named execution role");
  const createStatement = boundary.Statement.find(
    (statement) => statement.Sid === "AllowCreateOnlyTaggedSandboxStacks",
  );
  check(
    createStatement?.Resource ===
      "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-*/*",
    "example provisioner boundary must create only tenant stacks",
  );
  for (const tag of ["AppInstanceId", "DeploymentId", "ExpiresAt"] ) {
    check(
      createStatement?.Condition?.Null?.[`aws:RequestTag/${tag}`] === "false",
      `boundary must require the ${tag} request tag`,
    );
  }
  check(
    boundary.Statement.find(
      (statement) => statement.Sid === "AllowSandboxStackLifecycle",
    )?.Resource ===
      "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-*/*",
    "example provisioner boundary lifecycle must be tenant-stack-only",
  );
}

const denyPolicy = denyResult.value;
if (denyPolicy) {
  check(denyPolicy.Version === "2012-10-17", "deny policy version is invalid");
  check(
    (denyPolicy.Statement ?? []).every((statement) => statement.Effect === "Deny"),
    "expensive-actions policy must remain deny-only",
  );
  const deniedActions = new Set(actionsFrom(denyPolicy, "Deny"));
  for (const action of [
    "aws-marketplace:Subscribe",
    "ec2:CreateNatGateway",
    "ec2:CreateVpcEndpoint",
    "ec2:RunInstances",
    "kms:CreateKey",
    "rds:CreateDBProxy",
    "rds:CreateGlobalCluster",
    "rds:PurchaseReservedDBInstancesOffering",
    "rds:RestoreDBClusterFromSnapshot",
    "rds:RestoreDBClusterToPointInTime",
    "savingsplans:CreateSavingsPlan",
  ]) {
    check(deniedActions.has(action), `deny policy is missing ${action}`);
  }
  check(
    !deniedActions.has("rds:CreateDBCluster"),
    "Aurora DB cluster creation must not be denied absolutely",
  );
}

const likelySecretPatterns = [
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bwhsec_[A-Za-z0-9]{16,}\b/,
  /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s/]+@/i,
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
];
for (const absolutePath of await listTextFiles(root)) {
  const source = await readFile(absolutePath, "utf8");
  for (const pattern of likelySecretPatterns) {
    check(
      !pattern.test(source),
      `${path.relative(root, absolutePath)} contains a likely secret value`,
    );
  }
}

if (failures.length > 0) {
  console.error("AWS Sandbox S0 static validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("AWS Sandbox S0-S3-A static validation passed.");
  console.log("Checked bootstrap, Janitor, IAM boundaries, cost/build limits, refs, and secret patterns.");
}
