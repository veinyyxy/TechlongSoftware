import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
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
    } else if (/\.(?:json|md|mjs)$/i.test(entry.name)) {
      files.push(absolutePath);
    }
  }
  return files;
}

const [configResult, templateResult, boundaryResult, denyResult] =
  await Promise.all([
    readJson("sandbox.example.json"),
    readJson("cloudformation/guardrails.template.json"),
    readJson("policies/provisioner-permissions-boundary.example.json"),
    readJson("policies/sandbox-expensive-actions-deny.example.json"),
  ]);

const config = configResult.value;
if (config) {
  check(config.schemaVersion === 1, "sandbox config schemaVersion must be 1");
  check(config.environment === "aws-sandbox", "environment must be aws-sandbox");
  check(config.aws?.accountId === "402010193138", "unexpected AWS account id");
  check(config.aws?.region === "ca-central-1", "unexpected AWS region");
  check(config.aws?.profile === "techlong-sandbox-user", "unexpected AWS profile name");
  check(config.aws?.cloudApplyEnabled === false, "cloud apply must remain disabled");
  check(config.aws?.requireStsAccountMatch === true, "STS account check must be required");
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
  for (const tag of ["AppInstanceId", "DeploymentId", "ExpiresAt"] ) {
    check(
      createStatement?.Condition?.Null?.[`aws:RequestTag/${tag}`] === "false",
      `boundary must require the ${tag} request tag`,
    );
  }
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
  console.log("AWS Sandbox S0 static validation passed.");
  console.log("Checked config, CloudFormation, IAM examples, refs, limits, and secret patterns.");
}
