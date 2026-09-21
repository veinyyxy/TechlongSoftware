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
import {
  deployedJ4cChildCanonicalSha256,
  deployedJ4cChildRawSha256,
  renderDeployedJ4cChildTemplate,
} from "./render-b5-cell-bootstrap-j4c-deployed.mjs";
import {
  j5ggAuthorityV2ChildCanonicalSha256,
  j5ggAuthorityV2ChildRawSha256,
  renderJ5ggAuthorityV2ChildTemplate,
} from "./render-b5-cell-bootstrap-j5gg-v2.mjs";

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
const [
  templateSource,
  operationScript,
  janitorSource,
  renderedSource,
  legacyRenderedSource,
  deployedJ4cRenderedSource,
  pinnedAuthorityV2RenderedSource,
] =
  await Promise.all([
    readFile(templatePath, "utf8"),
    readFile(operationScriptPath, "utf8"),
    readFile(janitorPath, "utf8"),
    snapshotPath
      ? readFile(path.resolve(snapshotPath), "utf8")
      : renderB5CellBootstrapTemplate(),
    renderLegacyJ4bChildTemplate(),
    renderDeployedJ4cChildTemplate(),
    renderJ5ggAuthorityV2ChildTemplate(),
  ]);
const sourceTemplate = JSON.parse(templateSource);
const template = JSON.parse(renderedSource);
const resources = template.Resources ?? {};
const boundary = template.Metadata?.SafetyBoundary ?? {};
const legacyTemplate = JSON.parse(legacyRenderedSource);
const deployedJ4cTemplate = JSON.parse(deployedJ4cRenderedSource);
const authorityV2Template = JSON.parse(pinnedAuthorityV2RenderedSource);

function canonicalJson(value) {
  if (value === null || ["boolean", "number", "string"].includes(typeof value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

assert.equal(
  createHash("sha256").update(renderedSource, "utf8").digest("hex"),
  "77a57afeaafc2f26b14ad5d1374c816196395a55720de7ab68dea68ac8c802d7",
);
assert.equal(
  createHash("sha256").update(canonicalJson(template), "utf8").digest("hex"),
  "d22612f92f46ba9c060166455cd3e3fc9aa2a12fbb2093e892bfbcf9dc39f142",
);
assert.notEqual(renderedSource, pinnedAuthorityV2RenderedSource);
assert.equal(
  createHash("sha256").update(pinnedAuthorityV2RenderedSource, "utf8").digest("hex"),
  j5ggAuthorityV2ChildRawSha256,
);
assert.equal(
  createHash("sha256").update(canonicalJson(authorityV2Template), "utf8").digest("hex"),
  j5ggAuthorityV2ChildCanonicalSha256,
);
assert.equal(
  j5ggAuthorityV2ChildRawSha256,
  "a768753c50de3fd3e13a1366ac5493768f794a0635c54274438c9606c1ad11e6",
);
assert.equal(
  j5ggAuthorityV2ChildCanonicalSha256,
  "4f42f95d7e0b43b309d87acf2fb4795b136a1b40643d433e84606849d46d4673",
);

assert.equal(
  createHash("sha256").update(legacyRenderedSource, "utf8").digest("hex"),
  legacyJ4bChildRawSha256,
);
assert.equal(legacyJ4bChildRawSha256,
  "8eeef35a7936cdd1f4613434d8b7990630b192707e92ea4b5f21637f7cdaf15f");
assert.equal(legacyJ4bChildCanonicalSha256,
  "2bfe9ec02c7939abbab48fb07a9126e7dc7684472607c2d8787623720e88f389");
assert.equal(
  createHash("sha256").update(deployedJ4cRenderedSource, "utf8").digest("hex"),
  deployedJ4cChildRawSha256,
);
assert.equal(
  deployedJ4cChildRawSha256,
  "a14e9898ed7af636dfdb7f5c509d93b317b604a591aadb4a67d0f956e7a9d986",
);
assert.equal(
  deployedJ4cChildCanonicalSha256,
  "74379232124d94b1d2ffb4322edaecd0bdb0534444b8961295175ecadc06c09c",
);

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

assert.deepEqual(
  Object.keys(deployedJ4cTemplate.Resources).sort(),
  Object.keys(resources).sort(),
);
const authorityV2ConsumerChangedResources = Object.keys(authorityV2Template.Resources)
  .filter(
    (name) =>
      JSON.stringify(deployedJ4cTemplate.Resources[name]) !==
      JSON.stringify(authorityV2Template.Resources[name]),
  )
  .sort();
assert.deepEqual(authorityV2ConsumerChangedResources, ["CellJanitorFunction"]);
assert.deepEqual(
  exactChangedPropertyNames(
    deployedJ4cTemplate.Resources.CellJanitorFunction.Properties,
    authorityV2Template.Resources.CellJanitorFunction.Properties,
  ),
  ["Code"],
);
assert.deepEqual(
  Object.keys(
    deployedJ4cTemplate.Resources.CellJanitorFunction.Properties.Code,
  ).sort(),
  ["ZipFile"],
);
assert.deepEqual(
  Object.keys(authorityV2Template.Resources.CellJanitorFunction.Properties.Code).sort(),
  ["ZipFile"],
);
assert.notEqual(
  deployedJ4cTemplate.Resources.CellJanitorFunction.Properties.Code.ZipFile,
  authorityV2Template.Resources.CellJanitorFunction.Properties.Code.ZipFile,
);
const deployedJ4cWithAuthorityV2ConsumerCode = structuredClone(
  deployedJ4cTemplate,
);
deployedJ4cWithAuthorityV2ConsumerCode.Resources.CellJanitorFunction.Properties.Code.ZipFile =
  authorityV2Template.Resources.CellJanitorFunction.Properties.Code.ZipFile;
assert.deepEqual(
  authorityV2Template,
  deployedJ4cWithAuthorityV2ConsumerCode,
  "the authority-v2 consumer update may change only CellJanitorFunction.Properties.Code.ZipFile",
);
for (const logicalId of Object.keys(authorityV2Template.Resources)) {
  if (logicalId === "CellJanitorFunction") continue;
  assert.deepEqual(
    deployedJ4cTemplate.Resources[logicalId],
    authorityV2Template.Resources[logicalId],
    `${logicalId} must remain byte-equivalent across the authority-v2 consumer update`,
  );
}

assert.deepEqual(
  Object.keys(authorityV2Template.Resources).sort(),
  Object.keys(resources).sort(),
);
const deleteIntentCompatibilityChangedResources = Object.keys(resources)
  .filter(
    (name) =>
      JSON.stringify(authorityV2Template.Resources[name]) !==
      JSON.stringify(resources[name]),
  )
  .sort();
assert.deepEqual(deleteIntentCompatibilityChangedResources, ["CellJanitorFunction"]);
assert.deepEqual(
  exactChangedPropertyNames(
    authorityV2Template.Resources.CellJanitorFunction.Properties,
    resources.CellJanitorFunction.Properties,
  ),
  ["Code"],
);
const authorityV2WithDeleteIntentCompatibleCode = structuredClone(authorityV2Template);
authorityV2WithDeleteIntentCompatibleCode.Resources.CellJanitorFunction.Properties.Code.ZipFile =
  resources.CellJanitorFunction.Properties.Code.ZipFile;
assert.deepEqual(
  template,
  authorityV2WithDeleteIntentCompatibleCode,
  "the delete-intent compatibility update may change only CellJanitorFunction.Properties.Code.ZipFile",
);
for (const logicalId of Object.keys(resources)) {
  if (logicalId === "CellJanitorFunction") continue;
  assert.deepEqual(
    authorityV2Template.Resources[logicalId],
    resources[logicalId],
    `${logicalId} must remain byte-equivalent across the delete-intent compatibility update`,
  );
}

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
assert.equal(lambda.Code.ZipFile, janitorSource);
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
assert.match(lambda.Code.ZipFile, /delete_shared_cell_stack/);
assert.match(
  lambda.Code.ZipFile,
  /exactKeys\(event, \["action", "cellId", "schemaVersion", "stackName"\]\)/,
);
assert.match(lambda.Code.ZipFile, /event\.stackName === EXPECTED_CELL_STACK_NAME/);
assert.match(lambda.Code.ZipFile, /event\.cellId === EXPECTED_CELL_ID/);
assert.match(lambda.Code.ZipFile, /ConsistentRead:\s*true/);
assert.match(lambda.Code.ZipFile, /mutationPerformed:\s*false/);
assert.doesNotMatch(lambda.Code.ZipFile, /DeleteStackCommand/);
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
assert.match(
  operationScript,
  /\[ValidateSet\('InitialCreate', 'PlannerUpdate', 'AuthorityV2ConsumerUpdate', 'AuthorityV2ConsumerRollback', 'DeleteIntentCompatibilityUpdate'\)\]/,
);
assert.match(operationScript, /\[string\]\$DeploymentShape = 'InitialCreate'/);
assert.match(
  operationScript,
  /I_ACKNOWLEDGE_B5_J5G_G_PLAN_ONLY_AUTHORITY_V2_CONSUMER_UPDATE/,
);
assert.match(
  operationScript,
  /I_ACKNOWLEDGE_B5_J5G_G_PLAN_ONLY_AUTHORITY_V2_CONSUMER_ROLLBACK/,
);
assert.match(
  operationScript,
  /I_ACKNOWLEDGE_B5_J5G_H_PLAN_ONLY_DELETE_INTENT_COMPATIBILITY_UPDATE/,
);
assert.match(
  operationScript,
  /'AuthorityV2ConsumerUpdate' \{ \$authorityV2ConsumerUpdatePhrase \}[\s\S]*'AuthorityV2ConsumerRollback' \{ \$authorityV2ConsumerRollbackPhrase \}[\s\S]*'DeleteIntentCompatibilityUpdate' \{ \$deleteIntentCompatibilityUpdatePhrase \}/,
);
assert.match(operationScript, /\$ConfirmExecutionPhrase -cne \$executePhrase/);
assert.match(operationScript, /TechlongSandboxCellBootstrapManagerRole/);
assert.match(operationScript, /TechlongSandboxCellBootstrapCloudFormationExecutionRole/);
assert.match(operationScript, /ConfirmTemplateSha256/);
assert.match(operationScript, /ConfirmTemplateCanonicalSha256/);
assert.match(operationScript, /New-ReadOnlyTemplateSnapshot/);
assert.match(operationScript, /New-LegacyJ4bReadOnlyTemplateSnapshot/);
assert.match(operationScript, /render-b5-cell-bootstrap-j4b-legacy\.mjs/);
assert.match(operationScript, /8eeef35a7936cdd1f4613434d8b7990630b192707e92ea4b5f21637f7cdaf15f/);
assert.match(operationScript, /2bfe9ec02c7939abbab48fb07a9126e7dc7684472607c2d8787623720e88f389/);
assert.match(operationScript, /New-DeployedJ4cReadOnlyTemplateSnapshot/);
assert.match(operationScript, /render-b5-cell-bootstrap-j4c-deployed\.mjs/);
assert.match(operationScript, /New-AuthorityV2ReadOnlyTemplateSnapshot/);
assert.match(operationScript, /render-b5-cell-bootstrap-j5gg-v2\.mjs/);
assert.match(operationScript, /a14e9898ed7af636dfdb7f5c509d93b317b604a591aadb4a67d0f956e7a9d986/);
assert.match(operationScript, /74379232124d94b1d2ffb4322edaecd0bdb0534444b8961295175ecadc06c09c/);
assert.match(operationScript, /Assert-ExactLegacyJ4bChildStack/);
assert.match(operationScript, /Assert-ExactDeployedJ4cChildStack/);
assert.match(
  operationScript,
  /\$DeploymentShape -eq 'PlannerUpdate'[\s\S]*New-LegacyJ4bReadOnlyTemplateSnapshot/,
  "the historical PlannerUpdate path must remain pinned to the exact J4b predecessor",
);
assert.match(
  operationScript,
  /\$DeploymentShape -eq 'AuthorityV2ConsumerUpdate'[\s\S]*New-DeployedJ4cReadOnlyTemplateSnapshot/,
  "the authority-v2 consumer update must use the exact deployed J4c predecessor",
);
assert.match(
  operationScript,
  /\$DeploymentShape -eq 'AuthorityV2ConsumerRollback'[\s\S]*New-DeployedJ4cReadOnlyTemplateSnapshot -DestinationPath \$templateSnapshotPath[\s\S]*New-AuthorityV2ReadOnlyTemplateSnapshot -DestinationPath \$authorityV2TemplateSnapshotPath/,
  "the dormant rollback must target exact J4c-v1 and pin the authority-v2 predecessor",
);
assert.match(
  operationScript,
  /'DeleteIntentCompatibilityUpdate'[\s\S]*New-AuthorityV2ReadOnlyTemplateSnapshot -DestinationPath \$authorityV2TemplateSnapshotPath/,
  "the delete-intent compatibility update must pin the authority-v2 predecessor",
);
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
assert.match(
  operationScript,
  /\$changeSetType = if \(\$DeploymentShape -eq 'InitialCreate'\) \{ 'CREATE' \} else \{ 'UPDATE' \}/,
);
assert.match(operationScript, /\$DeploymentShape -eq 'InitialCreate'[\s\S]*'--on-stack-failure', 'DELETE'/);
assert.match(operationScript, /\[string\]\$resource\.Action -cne 'Modify'/);
assert.match(operationScript, /\[string\]\$resource\.Scope\[0\] -cne 'Properties'/);
assert.match(
  operationScript,
  /'PlannerUpdate'\s*\{[\s\S]*CellJanitorFunction = 'AWS::Lambda::Function'[\s\S]*CellGlobalJanitorSchedule = 'AWS::Scheduler::Schedule'[\s\S]*\}\s*'AuthorityV2ConsumerUpdate'/,
  "the historical PlannerUpdate must retain its exact two-resource change contract",
);
assert.match(
  operationScript,
  /'AuthorityV2ConsumerUpdate'\s*\{\s*@\{ CellJanitorFunction = 'AWS::Lambda::Function' \}\s*\}/,
  "the authority-v2 consumer update must accept exactly one Lambda modification",
);
assert.match(
  operationScript,
  /'AuthorityV2ConsumerRollback'\s*\{\s*@\{ CellJanitorFunction = 'AWS::Lambda::Function' \}\s*\}/,
  "the authority-v2 consumer rollback must accept exactly one Lambda modification",
);
assert.match(
  operationScript,
  /'DeleteIntentCompatibilityUpdate'\s*\{\s*@\{ CellJanitorFunction = 'AWS::Lambda::Function' \}\s*\}/,
  "the delete-intent compatibility update must accept exactly one Lambda modification",
);
assert.match(operationScript, /\[string\]\$resource\.Replacement -cne 'False'/);
assert.match(operationScript, /-not \[string\]::IsNullOrEmpty\(\[string\]\$resource\.PolicyAction\)/);
assert.match(operationScript, /\[string\]\$resource\.PhysicalResourceId -cne 'techlong-sandbox-cell-janitor'/);
assert.match(operationScript, /Duplicate Change Set resource \$logicalId/);
assert.match(operationScript, /\$observed\.Count -ne \$expected\.Count/);
assert.match(operationScript, /\$details = @\(\$resource\.Details\)/);
assert.match(operationScript, /\$details\.Count -lt 1/);
assert.match(operationScript, /\[string\]\$detail\.ChangeSource -cne 'DirectModification'/);
assert.match(operationScript, /\[string\]\$detail\.Evaluation -cne 'Static'/);
assert.match(operationScript, /\[string\]\$target\.Attribute -cne 'Properties'/);
assert.match(operationScript, /\[string\]\$target\.Name -cne 'Code'/);
assert.match(operationScript, /\[string\]\$target\.RequiresRecreation -cne 'Never'/);
assert.match(operationScript, /\[string\]\$target\.AttributeChangeType -cne 'Modify'/);
assert.match(operationScript, /\[string\]\$target\.Path -cnotmatch '\^\/Properties\/Code\(\?:\/ZipFile\)\?\$'/);
assert.match(
  operationScript,
  /\$DeploymentShape -ne 'InitialCreate'[\s\S]*\$predecessorStack\.StackId/,
  "every UPDATE Change Set must remain bound to its separately verified predecessor StackId",
);
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
  /\$expectedStackStatus = switch \(\$DeploymentShape\) \{[\s\S]*'InitialCreate' \{ 'REVIEW_IN_PROGRESS' \}[\s\S]*'PlannerUpdate' \{ 'CREATE_COMPLETE' \}[\s\S]*'AuthorityV2ConsumerUpdate' \{ 'UPDATE_COMPLETE' \}[\s\S]*'AuthorityV2ConsumerRollback' \{ 'UPDATE_COMPLETE' \}[\s\S]*'DeleteIntentCompatibilityUpdate' \{ 'UPDATE_COMPLETE' \}[\s\S]*\[string\]\$stacks\[0\]\.RoleARN -cne \$bootstrapExecutionRoleArn/,
  "CREATE and UPDATE Change Sets must prove the exact stable Stack and CloudFormation execution role",
);
assert.match(operationScript, /Get-ExactLambdaConfigurationAndVerifyInlineCode/);
assert.match(operationScript, /'lambda', 'get-function'/);
assert.match(operationScript, /'--profile', \$SourceReadbackProfile/);
assert.match(operationScript, /\$ReviewedTemplatePath[\s\S]*Properties\.Code\.ZipFile/);
assert.match(operationScript, /\.EndsWith\('\.amazonaws\.com'/);
assert.match(operationScript, /\$codeUri\.Scheme -cne 'https'/);
assert.match(
  operationScript,
  /-MaximumRedirection 0\s*`\s*-ConnectionTimeoutSeconds 20 -OperationTimeoutSeconds 20/,
);
assert.match(operationScript, /\$zipItem\.Length -le 0 -or \$zipItem\.Length -gt 1048576/);
assert.match(operationScript, /\[System\.IO\.Compression\.ZipFile\]::OpenRead/);
assert.match(operationScript, /\$entries\.Count -ne 1/);
assert.match(operationScript, /\[string\]\$entries\[0\]\.FullName -cne 'index\.js'/);
assert.match(operationScript, /\[long\]\$entries\[0\]\.Length -ne \[long\]\$expectedSourceBytes\.Length/);
assert.match(operationScript, /\$observedSourceBytes = \[byte\[\]\]::new\(\$expectedSourceBytes\.Length\)/);
assert.match(operationScript, /while \(\$offset -lt \$observedSourceBytes\.Length\)/);
assert.match(operationScript, /\$stream\.ReadByte\(\) -ne -1/);
assert.doesNotMatch(operationScript, /\.CopyTo\(\$memory\)/);
assert.match(operationScript, /\[Convert\]::ToBase64String\(\$observedSourceBytes\) -cne \[Convert\]::ToBase64String\(\$expectedSourceBytes\)/);
assert.match(operationScript, /\[System\.Security\.Cryptography\.SHA256\]::HashData/);
assert.match(operationScript, /\$observedCodeSha256 -cne \[string\]\$configuration\.CodeSha256/);
assert.match(operationScript, /\[long\]\$configuration\.CodeSize -ne \[long\]\$zipItem\.Length/);
assert.match(operationScript, /\[string\]\$before\.Code\.RepositoryType -cne 'S3'/);
assert.match(operationScript, /\$requiredBusinessTags = \[System\.Collections\.Generic\.Dictionary\[string,string\]\]::new\(/);
assert.match(operationScript, /\$requiredBusinessTags\.Add\('Environment', 'aws-sandbox'\)/);
assert.match(operationScript, /\$requiredBusinessTags\.Add\('ManagedBy', 'techlong-cell-bootstrap-manager'\)/);
assert.match(operationScript, /\$requiredBusinessTags\.Add\('Component', 'cell-janitor'\)/);
assert.match(operationScript, /\$allowedCloudFormationTags\.Add\('aws:cloudformation:logical-id', 'CellJanitorFunction'\)/);
assert.match(operationScript, /\$allowedCloudFormationTags\.Add\('aws:cloudformation:stack-id', \$ExpectedStackId\)/);
assert.match(operationScript, /\$allowedCloudFormationTags\.Add\('aws:cloudformation:stack-name', \$bootstrapStackName\)/);
assert.match(operationScript, /\[StringComparer\]::Ordinal/);
assert.match(operationScript, /Unexpected or drifted Cell Janitor Lambda tag/);
assert.match(operationScript, /-ExpectedStackId \(\[string\]\$stack\.StackId\)/);
assert.match(operationScript, /-ExpectedStackId \$ExpectedStackId/);
assert.match(operationScript, /\[string\]\$lambda\.PackageType -cne 'Zip'/);
assert.match(operationScript, /\[string\]\$lambda\.TracingConfig\.Mode -cne 'PassThrough'/);
assert.match(operationScript, /\[int\]\$lambda\.EphemeralStorage\.Size -ne 512/);
assert.match(operationScript, /\[string\]\$lambda\.LoggingConfig\.LogFormat -cne 'Text'/);
assert.match(operationScript, /\[string\]\$configuration\.CodeSha256 -cne \[string\]\$after\.CodeSha256/);
assert.match(operationScript, /\[string\]\$configuration\.RevisionId -cne \[string\]\$after\.RevisionId/);
assert.match(operationScript, /janitorCodeSha256 = \[string\]\$lambda\.CodeSha256/);
assert.equal(
  operationScript.match(/= Get-ExactLambdaConfigurationAndVerifyInlineCode -AwsCli/g)?.length,
  2,
  "both the historical predecessor and exact deployed readback must verify physical Lambda bytes",
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
