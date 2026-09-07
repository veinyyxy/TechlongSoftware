import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const operationPath = path.join(
  scriptDirectory,
  "s3-b5-shared-cell-provision-authority-operator.ps1",
);
const rootCliPath = path.join(
  repositoryRoot,
  "scripts",
  "run-shared-cell-provision-authority-operator.ts",
);
const [operation, rootCli] = await Promise.all([
  readFile(operationPath, "utf8"),
  readFile(rootCliPath, "utf8"),
]);

assert.match(
  operation,
  /\[ValidateSet\('LocalValidate', 'InspectCandidate', 'ExecuteInstall', 'Recover'\)\]/,
);
assert.match(operation, /\[string\]\$Mode = 'LocalValidate'/);
assert.match(operation, /\[string\]\$Profile = 'techlong-sandbox-provisioner'/);
assert.match(operation, /\$expectedAccountId = '402010193138'/);
assert.match(operation, /\$expectedRegion = 'ca-central-1'/);
assert.match(
  operation,
  /arn:aws:sts::402010193138:assumed-role\/TechlongSandboxProvisionerRole\/techlong-sandbox-provisioner/,
);
assert.match(
  operation,
  /arn:aws:iam::402010193138:mfa\/techlong-sandbox-dev/,
);
assert.match(operation, /\$expectedStackName = 'techlong-sandbox-cell-sandbox-1'/);
assert.match(operation, /\$expectedAuthorityKey = 'cell:cell-sandbox-1'/);
assert.match(
  operation,
  /arn:aws:dynamodb:ca-central-1:402010193138:table\/techlong-sandbox-tenant-external-epoch-authority/,
);

for (const setting of [
  "region",
  "role_arn",
  "source_profile",
  "mfa_serial",
  "role_session_name",
  "login_session",
]) {
  assert.ok(
    operation.includes(`-Key '${setting}'`),
    `operator must inspect AWS profile setting ${setting}`,
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
    `operator must reject AWS override ${variable}`,
  );
  assert.ok(
    rootCli.includes(`"${variable}"`),
    `root CLI must reject AWS override ${variable}`,
  );
}
assert.match(operation, /\^AWS_ENDPOINT_URL\(\?:_\|\$\)/);
assert.match(operation, /endpoint_url\|services/);
assert.match(operation, /AWS_IGNORE_CONFIGURED_ENDPOINT_URLS/);
assert.match(rootCli, /\^AWS_ENDPOINT_URL\(\?:_\|\$\)/);
assert.match(rootCli, /AWS_IGNORE_CONFIGURED_ENDPOINT_URLS !== "true"/);
assert.match(operation, /TECHLONG_J5F_OPERATOR_GUARD_NONCE/);
assert.match(rootCli, /TECHLONG_J5F_OPERATOR_GUARD_NONCE/);
assert.match(operation, /RandomNumberGenerator]::GetBytes\(32\)/);
assert.match(rootCli, /inheritedNonce !== input\.guardNonce/);

assert.match(operation, /Get-FileHash[^\n]+-Algorithm SHA256/);
assert.match(rootCli, /createHash\("sha256"\)\.update\(bytes\)\.digest\("hex"\)/);
assert.match(operation, /\$item\.Length -gt 65536/);
assert.match(operation, /FileAttributes]::ReparsePoint/);
assert.match(rootCli, /maximumManifestBytes = 65_536/);
assert.match(rootCli, /Operator manifest has missing or unexpected top-level fields/);
assert.match(rootCli, /coordinate\.generation !== 1/);
assert.match(rootCli, /coordinate\.epoch !== 1/);

assert.match(operation, /InspectCandidate does not accept candidate approval or grant expiry/);
assert.match(operation, /Recover is read-only and does not accept -GrantExpiresAt/);
assert.match(
  operation,
  /InspectCandidate and Recover reject all write acknowledgements and execution confirmations/,
);
assert.match(rootCli, /InspectCandidate does not accept a candidate approval or grant expiry/);
assert.match(rootCli, /Recover is read-only and does not accept a grant expiry/);
assert.match(operation, /TotalMinutes -le 2/);
assert.match(operation, /TotalMinutes -gt 60/);
assert.match(rootCli, /remaining <= minimumGrantRemainingMs/);
assert.match(rootCli, /remaining > maximumGrantRemainingMs/);

for (const acknowledgement of [
  "AcknowledgeAwsWrite",
  "AcknowledgeReviewedCandidate",
  "AcknowledgeTemporaryGrantActive",
  "AcknowledgeAbsentOnlyInstall",
  "AcknowledgeLowCostNotFree",
]) {
  assert.ok(
    operation.includes(`$${acknowledgement}`),
    `ExecuteInstall must require ${acknowledgement}`,
  );
}
assert.match(
  operation,
  /I_ACKNOWLEDGE_J5F_SHARED_CELL_PROVISION_AUTHORITY_INSTALL/,
);
assert.match(
  rootCli,
  /I_ACKNOWLEDGE_J5F_SHARED_CELL_PROVISION_AUTHORITY_INSTALL/,
);
for (const confirmation of [
  "$ConfirmAccountId -cne $expectedAccountId",
  "$ConfirmRegion -cne $expectedRegion",
  "$ConfirmStackName -cne $expectedStackName",
  "$ConfirmAuthorityTableArn -cne $expectedAuthorityTableArn",
  "$ConfirmAuthorityKey -cne $expectedAuthorityKey",
]) {
  assert.ok(operation.includes(confirmation));
}
for (const rootConfirmation of [
  'input.confirmAccountId !== expectedAccountId',
  'input.confirmRegion !== expectedRegion',
  'input.confirmStackName !== expectedStackName',
  'input.confirmAuthorityTableArn !== expectedAuthorityTableArn',
  'input.confirmAuthorityKey !== expectedAuthorityKey',
  'input.acknowledgeAwsWrite !== "true"',
  'input.acknowledgeReviewedCandidate !== "true"',
  'input.acknowledgeTemporaryGrantActive !== "true"',
  'input.acknowledgeAbsentOnlyInstall !== "true"',
  'input.acknowledgeLowCostNotFree !== "true"',
  'input.confirmExecutionPhrase !== expectedExecutionPhrase',
]) {
  assert.ok(
    rootCli.includes(rootConfirmation),
    `root CLI is missing independent confirmation ${rootConfirmation}`,
  );
}
for (const forwardedArgument of [
  "--confirm-account-id",
  "--confirm-region",
  "--confirm-stack-name",
  "--confirm-authority-table-arn",
  "--confirm-authority-key",
  "--acknowledge-aws-write",
  "--acknowledge-reviewed-candidate",
  "--acknowledge-temporary-grant-active",
  "--acknowledge-absent-only-install",
  "--acknowledge-low-cost-not-free",
  "--confirm-execution-phrase",
]) {
  assert.ok(operation.includes(`'${forwardedArgument}'`));
  assert.ok(rootCli.includes(`"${forwardedArgument}"`));
}
assert.match(rootCli, /Read-only modes reject every execution confirmation/);

const validatorInvocation = operation.indexOf("& node $validator");
const localModeGuard = operation.indexOf("if ($Mode -eq 'LocalValidate')");
const onlineModeValidation = operation.indexOf("\nAssert-ModeArguments", localModeGuard);
const awsResolution = operation.indexOf("$awsCli = Resolve-Executable", onlineModeValidation);
assert.ok(validatorInvocation >= 0 && validatorInvocation < localModeGuard);
assert.ok(localModeGuard >= 0 && localModeGuard < onlineModeValidation);
assert.ok(onlineModeValidation < awsResolution);
assert.match(
  operation.slice(localModeGuard, onlineModeValidation),
  /--mode LocalValidate[\s\S]*?No AWS API was called\.[\s\S]*?exit 0/,
);

assert.match(
  operation,
  /'sts', 'get-caller-identity',[\s\S]*?'--profile', \$Profile,[\s\S]*?'--region', \$expectedRegion,[\s\S]*?'--cli-connect-timeout', '10',[\s\S]*?'--cli-read-timeout', '20'/,
);
for (const forbiddenAwsCliOperation of [
  "'cloudformation', 'create",
  "'cloudformation', 'update",
  "'cloudformation', 'delete",
  "'cloudformation', 'execute",
  "'dynamodb', 'put-item'",
  "'dynamodb', 'update-item'",
  "'dynamodb', 'delete-item'",
  "'ecs', 'run-task'",
  "'scheduler', 'create-schedule'",
  "'scheduler', 'update-schedule'",
  "'scheduler', 'delete-schedule'",
  "'rds', 'create",
  "'rds', 'delete",
  "'secretsmanager', 'create",
  "'secretsmanager', 'delete",
  "'--endpoint-url'",
]) {
  assert.equal(
    operation.toLowerCase().includes(forbiddenAwsCliOperation),
    false,
    `PowerShell wrapper must not contain ${forbiddenAwsCliOperation}`,
  );
}

assert.match(
  rootCli,
  /inspectSharedCellProvisionAuthorityCandidate\(\{[\s\S]*?evidence: runtime\.evidence,[\s\S]*?authority: runtime\.authority,[\s\S]*?manifest,[\s\S]*?signal/,
);
assert.match(
  rootCli,
  /executeReviewedSharedCellProvisionAuthorityInstall\(\{[\s\S]*?approvedCandidateItemSha256:[\s\S]*?signal/,
);
assert.match(
  rootCli,
  /installIfAbsent: \(request: AuthorityInstallInput\) => \{\s*assertGrantWindow\(input\.grantExpiresAt as string, Date\.now\(\)\);\s*return runtime\.authority\.installIfAbsent\(request\);\s*\}/,
);
assert.match(
  rootCli,
  /executeReviewedSharedCellProvisionAuthorityInstall\(\{[\s\S]*?authority: grantBoundAuthority/,
);
assert.match(
  rootCli,
  /recoverReviewedSharedCellProvisionAuthorityInstall\(\{[\s\S]*?approvedCandidateItemSha256:[\s\S]*?expectedOwnerDeploymentId,[\s\S]*?signal/,
);
assert.doesNotMatch(rootCli, /installInitialSharedCellProvisionAuthority/);
assert.doesNotMatch(rootCli, /@aws-sdk\/client-/);
assert.doesNotMatch(rootCli, /PutCommand|UpdateCommand|DeleteCommand/);
assert.match(rootCli, /summary\.mutationPerformed !== \(phase === "INSTALLED"\)/);
assert.match(rootCli, /summary\.candidateItemSha256 !== approvedCandidateItemSha256/);
assert.match(rootCli, /onlineOperationTimeoutMs = 120_000/);
assert.match(rootCli, /setTimeout\([\s\S]*?onlineOperationTimeoutMs/);
assert.match(rootCli, /timeout\.unref\(\)/);
assert.match(rootCli, /clearTimeout\(timeout\)/);
assert.match(rootCli, /bounded\.dispose\(\)/);
assert.match(rootCli, /process\.stdin\.isTTY/);
assert.match(rootCli, /process\.stderr\.isTTY/);
assert.match(rootCli, /process\.stdin\.setRawMode/);
assert.match(rootCli, /input\.setRawMode\(true\)/);
assert.match(rootCli, /input\.setRawMode\(wasRaw\)/);
assert.match(
  rootCli,
  /process\.stderr\.write\(`Enter MFA code for \$\{expectedMfaDeviceArn\}: `\)/,
);
assert.ok(rootCli.includes('/^[0-9]{6}$/.test(code)'));
assert.match(rootCli, /Online modes require an interactive TTY for hidden MFA entry/);
assert.match(
  rootCli,
  /mfaCodeProvider: \(serial\) =>\s*readHiddenMfaCode\(serial, bounded\.signal\)/,
);
assert.doesNotMatch(rootCli, /readline|MFA_CODE|mfa-code|--mfa/);
assert.match(
  rootCli,
  /signal\.addEventListener\("abort", onAbort, \{ once: true \}\);\s*if \(signal\.aborted\) \{\s*onAbort\(\);\s*return;\s*\}\s*input\.on\("data", onData\)/,
);

const localBranch = rootCli.indexOf('input.mode === "LocalValidate"');
const runtimeImport = rootCli.indexOf("createAwsSdkSharedCellProvisionRuntime");
const boundedSignal = rootCli.lastIndexOf(
  "const bounded = boundedOnlineSignal()",
  runtimeImport,
);
assert.ok(localBranch >= 0 && localBranch < runtimeImport);
assert.ok(boundedSignal > localBranch && boundedSignal < runtimeImport);
assert.match(
  rootCli.slice(localBranch, runtimeImport),
  /phase: "LOCAL_VALIDATED"[\s\S]*?mutationPerformed: false,[\s\S]*?callsAws: false/,
);

const cleanEnvironment = { ...process.env };
for (const key of Object.keys(cleanEnvironment)) {
  if (/^AWS_/i.test(key) || key === "TECHLONG_J5F_OPERATOR_GUARD_NONCE") {
    delete cleanEnvironment[key];
  }
}
const local = spawnSync(
  process.execPath,
  ["--experimental-strip-types", rootCliPath, "--mode", "LocalValidate"],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: cleanEnvironment,
  },
);
assert.equal(local.status, 0, local.stderr);
assert.deepEqual(JSON.parse(local.stdout.trim()), {
  schemaVersion: 1,
  phase: "LOCAL_VALIDATED",
  mutationPerformed: false,
  callsAws: false,
});

const accidentalOnlineArguments = spawnSync(
  process.execPath,
  [
    "--experimental-strip-types",
    rootCliPath,
    "--mode",
    "LocalValidate",
    "--profile",
    "techlong-sandbox-provisioner",
  ],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: cleanEnvironment,
  },
);
assert.notEqual(accidentalOnlineArguments.status, 0);
assert.match(accidentalOnlineArguments.stderr, /LocalValidate does not accept online operation arguments/);

const directNonce = "a".repeat(64);
const futureGrant = new Date(Date.now() + 30 * 60_000).toISOString();
const missingIndependentConfirmation = spawnSync(
  process.execPath,
  [
    "--experimental-strip-types",
    rootCliPath,
    "--mode",
    "ExecuteInstall",
    "--profile",
    "techlong-sandbox-provisioner",
    "--manifest-path",
    path.join(repositoryRoot, "never-read.json"),
    "--manifest-sha256",
    "b".repeat(64),
    "--approved-candidate-item-sha256",
    "c".repeat(64),
    "--grant-expires-at",
    futureGrant,
    "--guard-nonce",
    directNonce,
  ],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...cleanEnvironment,
      AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true",
      TECHLONG_J5F_OPERATOR_GUARD_NONCE: directNonce,
    },
  },
);
assert.notEqual(missingIndependentConfirmation.status, 0);
assert.match(
  missingIndependentConfirmation.stderr,
  /ExecuteInstall requires every exact independent execution confirmation/,
);
assert.doesNotMatch(missingIndependentConfirmation.stderr, /never-read\.json/);

console.log(
  "B5-J5f Shared Cell provision-authority controlled operator validation passed.",
);
