import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const operationPath = path.join(
  scriptDirectory,
  "s3-b5-shared-cell-prerequisite-preflight.ps1",
);
const lifecyclePath = path.join(
  scriptDirectory,
  "s3-b5-cell-lifecycle-management.ps1",
);
const [operation, lifecycle] = await Promise.all([
  readFile(operationPath, "utf8"),
  readFile(lifecyclePath, "utf8"),
]);

assert.match(
  operation,
  /\[ValidateSet\('LocalValidate', 'OnlineValidate'\)\]\s*\[string\]\$Mode = 'LocalValidate'/,
);
assert.match(operation, /\[string\]\$Profile = 'techlong-sandbox-user'/);
assert.match(operation, /\[string\]\$CertificateArn = ''/);
assert.match(operation, /\[string\]\$ControlTrustStoreArn = ''/);
assert.match(operation, /\$expectedAccountId = '402010193138'/);
assert.match(operation, /\$expectedRegion = 'ca-central-1'/);
assert.match(
  operation,
  /arn:aws:iam::402010193138:user\/techlong-sandbox-dev/,
);
assert.match(
  operation,
  /arn:aws:iam::402010193138:mfa\/techlong-sandbox-dev/,
);
assert.match(
  operation,
  /\$managementStackName = 'techlong-s3-b5-cell-lifecycle-management'/,
);
assert.match(operation, /\$cellStackName = 'techlong-sandbox-cell-sandbox-1'/);
assert.match(operation, /\$authorityKey = 'cell:cell-sandbox-1'/);
assert.match(operation, /\$bootstrapStackName = 'techlong-s3-b5-cell-bootstrap'/);
assert.match(
  operation,
  /\$templateBucketName = 'techlong-sandbox-build-source-402010193138-ca-central-1'/,
);
assert.match(operation, /\$templatePrefix = 'b5-shared-cell\/templates\/sha256'/);
assert.match(
  operation,
  /\$immutableTemplatePolicySid = 'DenyMutableSharedCellTemplateOperation'/,
);
assert.match(
  operation,
  /\$expectedAvailabilityZones = @\('ca-central-1a', 'ca-central-1b'\)/,
);
assert.match(operation, /\$expectedEngineVersion = '16\.14'/);
assert.match(operation, /\$expectedDbInstanceClass = 'db\.serverless'/);

for (const setting of ["login_session", "region"]) {
  assert.ok(
    operation.includes(`-Key '${setting}'`),
    `preflight must inspect Source profile ${setting}`,
  );
}
for (const variable of [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_SECURITY_TOKEN",
  "AWS_ROLE_ARN",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_SHARED_CREDENTIALS_FILE",
  "AWS_PROFILE",
  "AWS_DEFAULT_PROFILE",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
]) {
  assert.ok(
    operation.includes(`'${variable}'`),
    `preflight must reject override ${variable}`,
  );
}
assert.match(operation, /\^AWS_ENDPOINT_URL\(\?:_\|\$\)/);
assert.match(operation, /endpoint_url\|services/);
assert.match(operation, /AWS_IGNORE_CONFIGURED_ENDPOINT_URLS/);
assert.match(operation, /AWS_CLI_AUTO_PROMPT', 'off'/);
assert.match(operation, /AWS_MAX_ATTEMPTS', '3'/);

assert.match(
  operation,
  /function Add-AwsReadTimeoutArguments[\s\S]*?'--cli-connect-timeout', '10'[\s\S]*?'--cli-read-timeout', '30'[\s\S]*?'--no-cli-pager'/,
);
assert.match(
  operation,
  /function Invoke-AwsReadJson[\s\S]*?Add-AwsReadTimeoutArguments/,
);
assert.match(
  operation,
  /'sts', 'get-caller-identity',[\s\S]*?'--profile', \$Profile,[\s\S]*?'--region', \$expectedRegion/,
);
assert.match(
  operation,
  /'iam', 'list-mfa-devices',[\s\S]*?'--user-name', \$expectedUserName/,
);

assert.match(
  operation,
  /-File \$lifecycleController\s*`\s*\r?\n\s*-Mode Readback\s*`\s*\r?\n\s*-UpdateShape InitialLocked\s*`\s*\r?\n\s*-Profile \$Profile/,
);
assert.match(operation, /Strict Locked management Stack readback passed:/);
assert.match(
  lifecycle,
  /function Assert-ExactStackReadback[\s\S]*?CellOperatorBoundary[\s\S]*?CellOperatorRole[\s\S]*?CellCloudFormationExecutionBoundary[\s\S]*?CellCloudFormationExecutionRole/,
);
assert.match(
  lifecycle,
  /\[string\]\$resource\.ResourceStatus -notin @\('CREATE_COMPLETE', 'UPDATE_COMPLETE'\)/,
);

for (const [operationName, command] of [
  ["DescribeStacks", "describe-stacks"],
  ["GetTemplate", "get-template"],
  ["ListStackResources", "list-stack-resources"],
]) {
  assert.match(
    operation,
    new RegExp(
      `-Operation '${operationName}'[\\s\\S]*?'cloudformation', '${command}'[\\s\\S]*?\\$cellStackName`,
    ),
  );
}
assert.match(operation, /denial is never accepted as MISSING/);
assert.match(operation, /\(\?i\)\\\(ValidationError\\\)/);
assert.match(
  operation,
  /'dynamodb', 'get-item',[\s\S]*?'--table-name', \$authorityTableName,[\s\S]*?'--consistent-read'/,
);
assert.match(
  operation,
  /\$keyDocument = '\{"authority_key":\{"S":"cell:cell-sandbox-1"\}\}'/,
);
assert.match(operation, /its value was not displayed/);

for (const output of [
  "CellJanitorFunctionArn",
  "CellSchedulerInvokeRoleArn",
  "CellSchedulerGroupName",
  "ApprovedCellStackName",
  "SafetyState",
]) {
  assert.ok(operation.includes(output), `missing exact Bootstrap output ${output}`);
}
assert.match(
  operation,
  /B5_J4C_OWNERSHIP_FENCED_PLAN_ONLY_ALL_MUTATIONS_DISABLED/,
);
assert.match(
  operation,
  /'lambda', 'get-function-configuration',[\s\S]*?CELL_CLEANUP_COORDINATOR_MODE -cne 'PLAN_ONLY'/,
);
assert.match(
  operation,
  /'scheduler', 'get-schedule-group',[\s\S]*?'scheduler', 'get-schedule'/,
);
assert.match(operation, /\[string\]\$schedule\.State -cne 'DISABLED'/);
assert.match(operation, /inspect_cell_cleanup_plan/);

assert.match(operation, /'ec2', 'describe-availability-zones'/);
assert.match(operation, /Name=zone-type,Values=availability-zone/);
assert.match(operation, /Name=state,Values=available/);
assert.match(operation, /ZoneId -cnotmatch '\^cac1-az\[0-9\]\+\$'/);
assert.match(operation, /Select-Object -Unique/);

assert.match(
  operation,
  /\^arn:aws:acm:ca-central-1:402010193138:certificate\/\[0-9a-f-\]\{36\}\$/,
);
assert.match(operation, /'acm', 'describe-certificate'/);
assert.match(operation, /\[string\]\$certificate\.Status -cne 'ISSUED'/);
assert.match(operation, /\*\.sandbox\.techlong\.cloud/);
assert.match(operation, /UtcNow\.AddHours\(4\)/);

assert.match(
  operation,
  /\^arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore\//,
);
assert.match(operation, /'elbv2', 'describe-trust-stores'/);
assert.match(operation, /\[string\]\$trustStores\[0\]\.Status -cne 'ACTIVE'/);
assert.match(operation, /NumberOfCaCertificates -lt 1/);

assert.match(operation, /'rds', 'describe-db-engine-versions'/);
assert.match(operation, /ServerlessV2FeaturesSupport/);
assert.match(operation, /SupportedEngineModes/);
assert.match(operation, /SupportsLogExportsToCloudwatchLogs/);
assert.match(operation, /'rds', 'describe-orderable-db-instance-options'/);
assert.match(operation, /'--db-instance-class', \$expectedDbInstanceClass/);
assert.match(operation, /AvailabilityZones\.Name/);

for (const role of [
  "AWSServiceRoleForElasticLoadBalancing",
  "AWSServiceRoleForECS",
  "AWSServiceRoleForRDS",
]) {
  assert.ok(operation.includes(role), `missing service-linked role ${role}`);
}
assert.match(
  operation,
  /'iam', 'get-role',[\s\S]*?'--role-name', \$contract\.Name/,
);
assert.match(operation, /\/aws-service-role\/\$\(\$contract\.Service\)\//);
assert.match(
  operation,
  /'s3api', 'get-bucket-policy',[\s\S]*?'--expected-bucket-owner', \$expectedAccountId/,
);
assert.match(operation, /\$actions -cnotcontains 's3:PutObject'/);
assert.match(operation, /\$actions -cnotcontains 's3:DeleteObject'/);
assert.match(operation, /\$conditionKeys\[0\] -cne 's3:if-none-match'/);
assert.match(
  operation,
  /\$deny\.Condition\.StringNotEquals\.'s3:if-none-match' -cne '\*'/,
);
assert.match(operation, /PLAN_ONLY_JANITOR_EVENT_INCOMPATIBLE/);
assert.match(operation, /delete_shared_cell_stack/);

for (const label of [
  "LockedManagementRootAndFourIamResources",
  "SharedCellStackMissing",
  "CellAuthorityAbsent",
  "PlanOnlyJanitorAndDisabledScheduler",
  "TwoAvailabilityZones",
  "AcmCertificate",
  "ElbTrustStore",
  "AuroraPostgresql16_14ServerlessV2",
  "RequiredServiceLinkedRoles",
  "ExecutableTtlJanitorCompatibility",
  "ImmutableSharedCellTemplateObjectPolicy",
]) {
  assert.ok(operation.includes(`-Label '${label}'`), `missing blocker ${label}`);
}
assert.match(operation, /ONLINE PREFLIGHT BLOCKED:/);
assert.match(operation, /ONLINE PREFLIGHT PASSED:/);

const forbiddenAwsWrites = [
  "put-item",
  "update-item",
  "delete-item",
  "batch-write-item",
  "transact-write-items",
  "create-stack",
  "update-stack",
  "delete-stack",
  "create-change-set",
  "execute-change-set",
  "delete-change-set",
  "create-role",
  "update-role",
  "delete-role",
  "create-policy",
  "delete-policy",
  "put-role-policy",
  "attach-role-policy",
  "detach-role-policy",
  "create-service-linked-role",
  "request-certificate",
  "import-certificate",
  "create-trust-store",
  "modify-trust-store",
  "create-db-cluster",
  "create-db-instance",
  "create-schedule",
  "update-schedule",
  "delete-schedule",
  "run-task",
  "--endpoint-url",
];
for (const fragment of forbiddenAwsWrites) {
  assert.equal(
    operation.toLowerCase().includes(fragment),
    false,
    `read-only preflight must not contain AWS write ${fragment}`,
  );
}

const validatorInvocation = operation.indexOf("& $nodeCommand.Source $validator");
const localGuard = operation.indexOf("if ($Mode -eq 'LocalValidate')");
const onlineArgumentGuard = operation.indexOf("if (\n  $Profile -cne $expectedProfile");
const awsResolution = operation.indexOf("$awsCli = Resolve-AwsCli");
assert.ok(validatorInvocation >= 0 && validatorInvocation < localGuard);
assert.ok(localGuard >= 0 && localGuard < onlineArgumentGuard);
assert.ok(onlineArgumentGuard >= 0 && onlineArgumentGuard < awsResolution);
assert.match(
  operation.slice(localGuard, onlineArgumentGuard),
  /No AWS API was called\.\s*'\s*\r?\n\s*exit 0/,
);

console.log(
  "B5-J5g-a Shared Cell read-only prerequisite preflight contract validated.",
);
