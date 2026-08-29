import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderB5CellBootstrapTemplate } from "./render-b5-cell-bootstrap.mjs";
import {
  legacyJ4bChildCanonicalSha256,
  legacyJ4bChildRawSha256,
  renderLegacyJ4bChildTemplate,
} from "./render-b5-cell-bootstrap-j4b-legacy.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const templatePath = path.join(
  root,
  "cloudformation",
  "s3-b5-cell-bootstrap.template.json",
);
const operationScriptPath = path.join(
  root,
  "scripts",
  "s3-b5-cell-bootstrap.ps1",
);
const janitorPath = path.join(root, "lambda", "cell-janitor.cjs");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

const snapshotPath = argument("--template");
const [templateSource, operationScript, janitorSource, renderedSource, legacyRenderedSource] =
  await Promise.all([
    readFile(templatePath, "utf8"),
    readFile(operationScriptPath, "utf8"),
    readFile(janitorPath, "utf8"),
    snapshotPath
      ? readFile(path.resolve(snapshotPath), "utf8")
      : renderB5CellBootstrapTemplate(),
    renderLegacyJ4bChildTemplate(),
  ]);
const sourceTemplate = JSON.parse(templateSource);
const template = JSON.parse(renderedSource);
const resources = template.Resources ?? {};
const boundary = template.Metadata?.SafetyBoundary ?? {};
const legacyTemplate = JSON.parse(legacyRenderedSource);

assert.equal(
  createHash("sha256").update(legacyRenderedSource, "utf8").digest("hex"),
  legacyJ4bChildRawSha256,
);
assert.equal(legacyJ4bChildRawSha256,
  "8eeef35a7936cdd1f4613434d8b7990630b192707e92ea4b5f21637f7cdaf15f");
assert.equal(legacyJ4bChildCanonicalSha256,
  "2bfe9ec02c7939abbab48fb07a9126e7dc7684472607c2d8787623720e88f389");

function exactChangedPropertyNames(previous, target) {
  return [...new Set([...Object.keys(previous), ...Object.keys(target)])]
    .filter((name) => JSON.stringify(previous[name]) !== JSON.stringify(target[name]))
    .sort();
}

assert.deepEqual(Object.keys(legacyTemplate.Resources).sort(), Object.keys(resources).sort());
const changedResources = Object.keys(resources)
  .filter((name) => JSON.stringify(legacyTemplate.Resources[name]) !== JSON.stringify(resources[name]))
  .sort();
assert.deepEqual(changedResources, ["CellGlobalJanitorSchedule", "CellJanitorFunction"]);
assert.deepEqual(
  exactChangedPropertyNames(
    legacyTemplate.Resources.CellJanitorFunction.Properties,
    resources.CellJanitorFunction.Properties,
  ),
  ["Code", "Description", "Environment"],
);
assert.deepEqual(
  exactChangedPropertyNames(
    legacyTemplate.Resources.CellGlobalJanitorSchedule.Properties,
    resources.CellGlobalJanitorSchedule.Properties,
  ),
  ["Description", "Target"],
);
assert.deepEqual(
  legacyTemplate.Resources.CellJanitorLogGroup,
  resources.CellJanitorLogGroup,
);
assert.deepEqual(
  legacyTemplate.Resources.CellSchedulerGroup,
  resources.CellSchedulerGroup,
);

assert.equal(sourceTemplate.Resources.CellJanitorFunction.Properties.Code.ZipFile,
  "__CELL_JANITOR_INLINE_SOURCE__");
assert.equal(renderedSource.includes("__CELL_JANITOR_INLINE_SOURCE__"), false);
assert.ok(Buffer.byteLength(renderedSource, "utf8") <= 51_200);

assert.equal(boundary.CloudApplyEnabled, true);
assert.equal(boundary.CreatesSharedCell, false);
assert.equal(boundary.CreatesPaidCellResources, false);
assert.equal(boundary.CreatesBootstrapRuntimeResources, true);
assert.equal(boundary.CellApplyRolesPresent, false);
assert.equal(boundary.CellCreateChangeSetAllowed, false);
assert.equal(boundary.CellExecuteChangeSetAllowed, false);
assert.equal(boundary.CellExecutionPassRoleAllowed, false);
assert.equal(boundary.CellDeletionAllowed, false);
assert.equal(boundary.CoordinatorMode, "PLAN_ONLY");
assert.equal(boundary.AuthorityReadOnly, true);
assert.equal(boundary.AuthorityKey, "cell:cell-sandbox-1");
assert.equal(boundary.JanitorScheduleEnabled, false);
assert.equal(boundary.RequiresDedicatedManagementStack, true);
assert.equal(
  boundary.ApprovedManagementStackName,
  "techlong-s3-b5-cell-bootstrap-management",
);
assert.equal(boundary.ApprovedCellStackName, "techlong-sandbox-cell-sandbox-1");
assert.deepEqual(template.Parameters.ExpectedAccountId.AllowedValues, [
  "402010193138",
]);
assert.deepEqual(template.Parameters.ExpectedRegion.AllowedValues, [
  "ca-central-1",
]);
assert.deepEqual(Object.keys(template.Parameters).sort(), [
  "ExpectedAccountId",
  "ExpectedRegion",
]);

const expectedResources = {
  CellJanitorLogGroup: "AWS::Logs::LogGroup",
  CellJanitorFunction: "AWS::Lambda::Function",
  CellSchedulerGroup: "AWS::Scheduler::ScheduleGroup",
  CellGlobalJanitorSchedule: "AWS::Scheduler::Schedule",
};
assert.deepEqual(
  Object.fromEntries(Object.entries(resources).map(([name, value]) => [name, value.Type])),
  expectedResources,
);
for (const [name, resource] of Object.entries(resources)) {
  assert.equal(resource.Condition, "IsExpectedTarget", `${name} lacks target condition`);
}
for (const forbidden of [
  "CellJanitorBoundary",
  "CellJanitorExecutionRole",
  "CellSchedulerInvokeBoundary",
  "CellSchedulerInvokeRole",
  "CellOperatorBoundary",
  "CellOperatorRole",
  "CellExecutionBoundary",
  "CellCloudFormationExecutionRole",
]) {
  assert.equal(resources[forbidden], undefined, `${forbidden} must not exist in J4c`);
}
assert.equal(template.Outputs?.CellOperatorRoleArn, undefined);
assert.equal(template.Outputs?.CellCloudFormationExecutionRoleArn, undefined);

assert.equal(
  Object.values(resources).some((resource) => resource.Type.startsWith("AWS::IAM::")),
  false,
  "the child Bootstrap must not own or mutate IAM resources",
);

const logGroup = resources.CellJanitorLogGroup;
assert.equal(logGroup.DeletionPolicy, "Delete");
assert.equal(logGroup.UpdateReplacePolicy, "Delete");
assert.equal(logGroup.Properties.LogGroupName, "/aws/lambda/techlong-sandbox-cell-janitor");
assert.equal(logGroup.Properties.LogGroupClass, "STANDARD");
assert.equal(logGroup.Properties.RetentionInDays, 1);
assert.equal(logGroup.Properties.KmsKeyId, undefined);

const lambda = resources.CellJanitorFunction.Properties;
assert.equal(lambda.FunctionName, "techlong-sandbox-cell-janitor");
assert.equal(lambda.Runtime, "nodejs22.x");
assert.deepEqual(lambda.Architectures, ["arm64"]);
assert.equal(lambda.Handler, "index.handler");
assert.equal(lambda.MemorySize, 128);
assert.equal(lambda.Timeout, 60);
assert.equal(lambda.ReservedConcurrentExecutions, undefined);
assert.equal(
  lambda.Role,
  "arn:aws:iam::402010193138:role/TechlongSandboxCellJanitorExecutionRole",
);
assert.deepEqual(lambda.Environment.Variables, {
  EXPECTED_ACCOUNT_ID: "402010193138",
  EXPECTED_REGION: "ca-central-1",
  EXPECTED_CELL_ID: "cell-sandbox-1",
  CELL_CLEANUP_AUTHORITY_KEY: "cell:cell-sandbox-1",
  CELL_CLEANUP_AUTHORITY_TABLE_ARN:
    "arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority",
  CELL_CLEANUP_COORDINATOR_MODE: "PLAN_ONLY",
});
for (const forbiddenProperty of [
  "DeadLetterConfig",
  "FileSystemConfigs",
  "KmsKeyArn",
  "Layers",
  "ReservedConcurrentExecutions",
  "VpcConfig",
]) {
  assert.equal(lambda[forbiddenProperty], undefined);
}
assert.match(lambda.Code.ZipFile, /inspect_cell_cleanup_plan/);
assert.match(lambda.Code.ZipFile, /ConsistentRead:\s*true/);
assert.match(lambda.Code.ZipFile, /mutationPerformed:\s*false/);
assert.doesNotMatch(lambda.Code.ZipFile, /DeleteStackCommand/);
assert.doesNotMatch(lambda.Code.ZipFile, /delete_shared_cell_stack/);
const deployedCommands = [...janitorSource.matchAll(/new\s+(?:cloudFormation|dynamoDb)\.([A-Za-z0-9]+Command)\s*\(/g)]
  .map((match) => match[1])
  .sort();
assert.deepEqual(deployedCommands, [
  "DescribeStacksCommand",
  "GetItemCommand",
  "GetTemplateCommand",
  "ListStackResourcesCommand",
  "ListStacksCommand",
]);
assert.equal(deployedCommands.some((name) => /(?:Create|Delete|Execute|Put|Run|Update|Write)/.test(name)), false);

assert.equal(resources.CellSchedulerGroup.Properties.Name, "techlong-sandbox-cell");
const schedule = resources.CellGlobalJanitorSchedule.Properties;
assert.equal(schedule.Name, "techlong-sandbox-cell-global-janitor");
assert.equal(schedule.GroupName.Ref, "CellSchedulerGroup");
assert.equal(schedule.State, "DISABLED");
assert.equal(schedule.ScheduleExpression, "rate(15 minutes)");
assert.equal(schedule.Target.RetryPolicy.MaximumRetryAttempts, 0);
assert.equal(
  schedule.Target.RoleArn,
  "arn:aws:iam::402010193138:role/TechlongSandboxCellSchedulerInvokeRole",
);
assert.deepEqual(JSON.parse(schedule.Target.Input), {
  schemaVersion: 1,
  action: "inspect_cell_cleanup_plan",
});

assert.deepEqual(Object.keys(template.Outputs).sort(), [
  "ApprovedCellStackName",
  "CellJanitorFunctionArn",
  "CellSchedulerGroupName",
  "CellSchedulerInvokeRoleArn",
  "SafetyState",
]);
assert.equal(
  template.Outputs.SafetyState.Value,
  "B5_J4C_OWNERSHIP_FENCED_PLAN_ONLY_ALL_MUTATIONS_DISABLED",
);

assert.match(
  operationScript,
  /\[ValidateSet\('LocalValidate', 'OnlineValidate', 'CreateChangeSet', 'InspectChangeSet', 'ExecuteChangeSet', 'Readback', 'ProbeJanitor', 'Delete'\)\]/,
);
assert.match(operationScript, /\[string\]\$Mode = 'LocalValidate'/);
assert.match(operationScript, /\[ValidateSet\('InitialCreate', 'PlannerUpdate'\)\]/);
assert.match(operationScript, /\[string\]\$DeploymentShape = 'InitialCreate'/);
assert.match(operationScript, /TechlongSandboxCellBootstrapManagerRole/);
assert.match(operationScript, /TechlongSandboxCellBootstrapCloudFormationExecutionRole/);
assert.match(operationScript, /ConfirmTemplateSha256/);
assert.match(operationScript, /ConfirmTemplateCanonicalSha256/);
assert.match(operationScript, /New-ReadOnlyTemplateSnapshot/);
assert.match(operationScript, /New-LegacyJ4bReadOnlyTemplateSnapshot/);
assert.match(operationScript, /render-b5-cell-bootstrap-j4b-legacy\.mjs/);
assert.match(operationScript, /8eeef35a7936cdd1f4613434d8b7990630b192707e92ea4b5f21637f7cdaf15f/);
assert.match(operationScript, /2bfe9ec02c7939abbab48fb07a9126e7dc7684472607c2d8787623720e88f389/);
assert.match(operationScript, /\$renderOutput = \(\(& node \$renderer --output \$DestinationPath\)/);
assert.match(operationScript, /get-template/);
assert.match(operationScript, /template-stage', 'Original'/);
assert.match(operationScript, /simulate-principal-policy/);
assert.match(
  operationScript,
  /stack\/not-approved\/[0-9-]+'[\s\S]*ContextKeyName=dynamodb:LeadingKeys,ContextKeyValues=cell:cell-sandbox-1,ContextKeyType=stringList/,
  "foreign Stack simulation must supply the unrelated DynamoDB condition key so implicit deny has no missing context",
);
assert.match(operationScript, /inspect_cell_cleanup_plan/);
assert.match(operationScript, /stack-create-complete/);
assert.match(operationScript, /stack-update-complete/);
assert.match(operationScript, /stack-delete-complete/);
assert.match(
  operationScript,
  /\[string\]\$stack\.StackStatus -notin @\('CREATE_COMPLETE', 'UPDATE_COMPLETE'\)/,
  "deployed child readback must accept the exact terminal state for CREATE and UPDATE",
);
assert.match(operationScript, /ApprovedTemplateSha256/);
assert.match(operationScript, /Assert-ExactTemplateObject/);
assert.match(operationScript, /Assert-BootstrapExecutionIdentity/);
assert.match(operationScript, /techlong-sandbox-build-source-402010193138-ca-central-1/);
assert.match(operationScript, /b5-cell-bootstrap\/templates\/sha256/);
assert.match(operationScript, /'--template-url', \$templateObject\.Url/);
assert.match(operationScript, /'--resource-types'/);
assert.match(operationScript, /\$changeSetType = if \(\$DeploymentShape -eq 'PlannerUpdate'\) \{ 'UPDATE' \} else \{ 'CREATE' \}/);
assert.match(operationScript, /\$DeploymentShape -eq 'InitialCreate'[\s\S]*'--on-stack-failure', 'DELETE'/);
assert.match(operationScript, /\[string\]\$resource\.Action -cne 'Modify'/);
assert.match(operationScript, /\[string\]\$resource\.Scope\[0\] -cne 'Properties'/);
assert.match(operationScript, /PlannerUpdate Change Set StackId is not the exact verified legacy child StackId/);
for (const resourceType of Object.values(expectedResources)) {
  assert.match(operationScript, new RegExp(resourceType.replaceAll("::", "\\:\\:")));
}
assert.match(operationScript, /resourceCount = 4/);
assert.doesNotMatch(operationScript, /resourceCount = 8/);
assert.doesNotMatch(operationScript, /'--capabilities', 'CAPABILITY_NAMED_IAM'/);
assert.match(
  operationScript,
  /\$null -ne \$changeSet\.Capabilities -and @\(\$changeSet\.Capabilities\)\.Count -ne 0/,
  "an omitted or null non-IAM Change Set Capabilities field must mean zero capabilities",
);
assert.match(
  operationScript,
  /\$null -ne \$stack\.Capabilities -and @\(\$stack\.Capabilities\)\.Count -ne 0/,
  "an omitted or null non-IAM Stack Capabilities field must mean zero capabilities",
);
assert.doesNotMatch(operationScript, /cloudformation', 'deploy'/);
assert.doesNotMatch(operationScript, /cloudformation', '(?:create|update)-stack'/);
assert.doesNotMatch(operationScript, /ecs', 'run-task'/);
assert.match(
  operationScript,
  /janitorReservedConcurrencyConfigured = \$false/,
  "readback evidence must record that reserved concurrency is not configured",
);
assert.match(
  operationScript,
  /\$null -ne \$lambda\.Layers -and @\(\$lambda\.Layers\)\.Count -ne 0/,
  "an omitted or null Lambda Layers field must mean no layers",
);
assert.match(
  operationScript,
  /\$null -ne \$lambda\.FileSystemConfigs -and @\(\$lambda\.FileSystemConfigs\)\.Count -ne 0/,
  "an omitted or null Lambda FileSystemConfigs field must mean no file systems",
);
assert.match(
  operationScript,
  /'lambda', 'get-function-concurrency'[\s\S]*\) -AllowEmptyObject/,
  "the one Lambda API that returns an empty body when concurrency is unset must opt in explicitly",
);
assert.match(
  operationScript,
  /\$null -ne \$exactGroups\[0\]\.inheritedProperties -and\s*@\(\$exactGroups\[0\]\.inheritedProperties\)\.Count -ne 0/,
  "an omitted or null CloudWatch Logs inheritedProperties field must mean no inherited properties",
);
assert.doesNotMatch(
  operationScript,
  /janitorReservedConcurrency\s*=\s*1/,
  "readback evidence must not retain the removed one-concurrency claim",
);
assert.match(
  operationScript,
  /Get-StackOrNull -AwsCli \$awsCli -Profile \$SourceReadbackProfile -StackName \$bootstrapStackName/,
  "CREATE-only child absence must be established by the trusted source readback profile",
);
assert.doesNotMatch(
  operationScript,
  /Get-StackOrNull -AwsCli \$awsCli -Profile \$ManagerProfile -StackName \$bootstrapStackName/,
  "the tag-scoped manager cannot prove absence of a not-yet-existing child Stack",
);
assert.match(
  operationScript,
  /Get-StackOrNull -AwsCli \$AwsCli -Profile \$SourceReadbackProfile -StackName \$ExpectedStackId/,
  "exact deployed Stack readback must use the trusted source readback profile",
);
assert.match(
  operationScript,
  /'cloudformation', 'list-stack-resources', '--profile', \$SourceReadbackProfile/,
  "deployed resource inventory must use the trusted source readback profile",
);
assert.match(
  operationScript,
  /'cloudformation', 'get-template', '--profile', \$SourceReadbackProfile/,
  "Change Set and deployed template verification must use the trusted source readback profile",
);
assert.match(
  operationScript,
  /'cloudformation', 'describe-change-set', '--profile', \$SourceReadbackProfile/,
  "Change Set inspection must not require temporary manager read privileges",
);
assert.match(
  operationScript,
  /'cloudformation', 'wait', \$waiter, '--profile', \$SourceReadbackProfile/,
  "post-execution waiting must not require temporary manager read privileges",
);
assert.match(
  operationScript,
  /\$expectedStackStatus = if \(\$DeploymentShape -eq 'InitialCreate'\)[\s\S]*'REVIEW_IN_PROGRESS'[\s\S]*\[string\]\$stacks\[0\]\.RoleARN -cne \$bootstrapExecutionRoleArn/,
  "CREATE and UPDATE Change Sets must prove the exact stable Stack and CloudFormation execution role",
);
assert.match(
  operationScript,
  /ConvertFrom-Json -DateKind String/,
  "management grant expiry must remain a canonical JSON string during child preflight",
);
assert.doesNotMatch(
  operationScript,
  /\$changeSet\.ChangeSetType|\$ChangeSet\.ChangeSetType/,
  "DescribeChangeSet does not return ChangeSetType; each shape is fenced by metadata and exact resource changes",
);
assert.match(
  operationScript,
  /-not \$AllowHistoricalVersions -and\s*\$observedVersions\.Count -ne 1/,
  "immutable policies must retain exactly one current default version after CloudFormation updates",
);
assert.doesNotMatch(
  operationScript,
  /only default version v1/,
  "the sole default IAM policy version may legitimately advance beyond v1",
);
const executionPreflightIndex = operationScript.indexOf(
  "Assert-BootstrapExecutionIdentity -AwsCli $awsCli",
);
const simulationPreflightIndex = operationScript.indexOf(
  "Assert-IamSimulations -AwsCli $awsCli",
  executionPreflightIndex,
);
const createChangeSetIndex = operationScript.indexOf(
  "'cloudformation', 'create-change-set'",
);
assert.ok(executionPreflightIndex >= 0);
assert.ok(simulationPreflightIndex > executionPreflightIndex);
assert.ok(createChangeSetIndex > simulationPreflightIndex);

const combinedText = `${templateSource}\n${renderedSource}\n${operationScript}\n${janitorSource}`;
for (const forbidden of [
  /AKIA[0-9A-Z]{16}/,
  /postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/i,
  /sk_(?:live|test)_[A-Za-z0-9]{16,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
]) {
  assert.doesNotMatch(combinedText, forbidden);
}

console.log(
  "B5-J4c plan-only cleanup planner, locked authority reads, disabled schedule and exact operation contract validation passed.",
);
