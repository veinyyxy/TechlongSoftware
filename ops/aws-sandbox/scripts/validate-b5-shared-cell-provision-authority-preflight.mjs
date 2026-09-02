import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const operationScriptPath = path.join(
  scriptDirectory,
  "s3-b5-shared-cell-provision-authority-preflight.ps1",
);
const operationScript = await readFile(operationScriptPath, "utf8");

assert.match(
  operationScript,
  /\[ValidateSet\('LocalValidate', 'EvidencePreflight'\)\]\s*\[string\]\$Mode = 'LocalValidate'/,
);
assert.match(
  operationScript,
  /\[string\]\$Profile = 'techlong-sandbox-provisioner'/,
);
assert.match(operationScript, /\$expectedAccountId = '402010193138'/);
assert.match(operationScript, /\$expectedRegion = 'ca-central-1'/);
assert.match(
  operationScript,
  /arn:aws:sts::402010193138:assumed-role\/TechlongSandboxProvisionerRole\/techlong-sandbox-provisioner/,
);
assert.match(
  operationScript,
  /arn:aws:iam::402010193138:role\/TechlongSandboxProvisionerRole/,
);
assert.match(operationScript, /\$expectedSourceProfile = 'techlong-sandbox-user'/);
assert.match(
  operationScript,
  /arn:aws:iam::402010193138:user\/techlong-sandbox-dev/,
);
assert.match(
  operationScript,
  /arn:aws:iam::402010193138:mfa\/techlong-sandbox-dev/,
);
assert.match(operationScript, /\$expectedSessionName = 'techlong-sandbox-provisioner'/);
assert.match(operationScript, /\$cellStackName = 'techlong-sandbox-cell-sandbox-1'/);
assert.match(
  operationScript,
  /arn:aws:dynamodb:ca-central-1:402010193138:table\/techlong-sandbox-tenant-external-epoch-authority/,
);
assert.match(operationScript, /\$authorityKey = 'cell:cell-sandbox-1'/);

for (const setting of [
  "region",
  "role_arn",
  "source_profile",
  "mfa_serial",
  "role_session_name",
  "login_session",
]) {
  assert.ok(
    operationScript.includes(`-Key '${setting}'`),
    `preflight must inspect AWS profile setting ${setting}`,
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
]) {
  assert.ok(
    operationScript.includes(`'${variable}'`),
    `preflight must reject credential override ${variable}`,
  );
}
assert.match(operationScript, /\^AWS_ENDPOINT_URL\(\?:_\|\$\)/);
assert.match(operationScript, /endpoint_url\|services/);
assert.match(operationScript, /AWS_IGNORE_CONFIGURED_ENDPOINT_URLS/);

assert.match(
  operationScript,
  /'sts', 'get-caller-identity',[\s\S]*?'--profile', \$Profile,[\s\S]*?'--region', \$expectedRegion/,
);
assert.match(
  operationScript,
  /'cloudformation', 'describe-stacks',[\s\S]*?'--stack-name', \$cellStackName/,
);
assert.match(
  operationScript,
  /'cloudformation', 'get-template',[\s\S]*?'--stack-name', \$cellStackName,[\s\S]*?'--template-stage', 'Original'/,
);
assert.match(
  operationScript,
  /'cloudformation', 'list-stack-resources',[\s\S]*?'--stack-name', \$cellStackName,[\s\S]*?'--no-paginate'/,
);
assert.match(operationScript, /AccessDenied\|Unauthorized\|not authorized/);
assert.match(operationScript, /denial is never accepted as MISSING/);
assert.match(operationScript, /\\\(ValidationError\\\)/);
assert.match(operationScript, /does not exist/);

assert.match(
  operationScript,
  /'dynamodb', 'get-item',[\s\S]*?'--table-name', \$authorityTableArn,[\s\S]*?'--key', \$keyDocument,[\s\S]*?'--consistent-read'/,
);
assert.match(operationScript, /function Invoke-AwsOptionalJson/);
assert.match(
  operationScript,
  /Invoke-AwsOptionalJson -AwsCli \$AwsCli -Arguments @\([\s\S]*?'dynamodb', 'get-item'/,
);
assert.match(
  operationScript,
  /if \(\[string\]::IsNullOrWhiteSpace\(\$json\)\) \{\s*return \$null\s*\}/,
);
assert.match(operationScript, /\$responseProperties\.Count -ne 0/);
assert.match(
  operationScript,
  /\$keyDocument = '\{"authority_key":\{"S":"cell:cell-sandbox-1"\}\}'/,
);
assert.match(operationScript, /Shared Cell authority key state: PRESENT_BLOCKED/);
assert.match(operationScript, /its contents were not displayed/);
assert.match(operationScript, /Shared Cell authority key state: ABSENT/);

assert.doesNotMatch(operationScript, /'scheduler',\s*'get-schedule'/);
assert.match(operationScript, /temporary PutItem grant is attested separately/);

const forbiddenCommandFragments = [
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
  "cancel-update-stack",
  "continue-update-rollback",
  "rollback-stack",
  "set-stack-policy",
  "update-termination-protection",
  "run-task",
  "create-schedule",
  "update-schedule",
  "delete-schedule",
  "--endpoint-url",
];
for (const fragment of forbiddenCommandFragments) {
  assert.equal(
    operationScript.toLowerCase().includes(fragment),
    false,
    `read-only preflight must not contain ${fragment}`,
  );
}

const validatorInvocation = operationScript.indexOf("& node $validator");
const localModeGuard = operationScript.indexOf("if ($Mode -eq 'LocalValidate')");
const onlineBoundary = operationScript.lastIndexOf(
  "\nAssert-NoCredentialOrEndpointOverrides",
);
const awsResolution = operationScript.lastIndexOf("$awsCli = Resolve-AwsCli");
assert.ok(validatorInvocation >= 0 && validatorInvocation < localModeGuard);
assert.ok(localModeGuard >= 0 && localModeGuard < onlineBoundary);
assert.ok(localModeGuard < awsResolution);
assert.match(
  operationScript.slice(localModeGuard, onlineBoundary),
  /No AWS API was called\.\s*'\s*\r?\n\s*exit 0/,
);

console.log(
  "B5-J5e Shared Cell provision-authority read-only preflight validation passed.",
);
