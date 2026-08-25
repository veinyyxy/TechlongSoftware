import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  validateLifecycleLogSupportReadback,
  validateLifecycleLogSupportTemplate,
} from "./lifecycle-log-support-contract.mjs";
import { canonicalTemplateSha256 } from "./verify-change-set-template.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = path.join(
  root,
  "cloudformation",
  "s3-b5-lifecycle-log-support.template.json",
);
const operationScriptPath = path.join(
  root,
  "scripts",
  "s3-b5-lifecycle-log-support.ps1",
);
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};
const templateOptionIndex = process.argv.indexOf("--template");
if (templateOptionIndex !== -1) {
  assert.ok(argument("--template"), "--template requires a reviewed snapshot path");
}
const reviewedTemplatePath = argument("--template")
  ? path.resolve(argument("--template"))
  : templatePath;
const expiresAt = "2026-08-25T23:59:59Z";
const stackId =
  "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-b5j4logs/01234567-89ab-cdef-0123-456789abcdef";
const logGroupName = "/saas/cell-sandbox-1/tenant-lifecycle";
const logGroupArn =
  "arn:aws:logs:ca-central-1:402010193138:log-group:/saas/cell-sandbox-1/tenant-lifecycle";
const clone = (value) => JSON.parse(JSON.stringify(value));

function rejectTemplateMutation(template, mutate) {
  const candidate = clone(template);
  mutate(candidate);
  assert.throws(() => validateLifecycleLogSupportTemplate(candidate));
}

function syntheticDescribe() {
  return {
    logGroups: [
      {
        logGroupName,
        creationTime: 1787691600000,
        retentionInDays: 1,
        metricFilterCount: 0,
        arn: `${logGroupArn}:*`,
        storedBytes: 0,
        logGroupClass: "STANDARD",
        logGroupArn,
        deletionProtectionEnabled: false,
        bearerTokenAuthenticationEnabled: false,
      },
    ],
  };
}

function syntheticTags() {
  return {
    tags: {
      Environment: "aws-sandbox",
      ManagedBy: "techlong-provisioner",
      Component: "tenant-lifecycle-logs",
      AppInstanceId: "tenant-lifecycle",
      DeploymentId: "b5j4-log-support",
      ExpiresAt: expiresAt,
      "aws:cloudformation:logical-id": "TenantLifecycleLogGroup",
      "aws:cloudformation:stack-name": "techlong-sandbox-tenant-b5j4logs",
      "aws:cloudformation:stack-id": stackId,
    },
  };
}

const emptyStreams = { logStreams: [] };
const emptySubscriptions = { subscriptionFilters: [] };
const emptyAccountSubscriptions = { accountPolicies: [] };
const missingCluster = {
  clusters: [],
  failures: [
    {
      arn: "arn:aws:ecs:ca-central-1:402010193138:cluster/cell-sandbox-1",
      reason: "MISSING",
    },
  ],
};

const [templateSource, operationScript] = await Promise.all([
  readFile(reviewedTemplatePath, "utf8"),
  readFile(operationScriptPath, "utf8"),
]);
const template = JSON.parse(templateSource);
const intent = validateLifecycleLogSupportTemplate(template);
assert.match(intent.propertiesCanonicalSha256, /^[a-f0-9]{64}$/);
assert.match(canonicalTemplateSha256(templateSource), /^[a-f0-9]{64}$/);
assert.deepEqual(Object.keys(template.Resources), ["TenantLifecycleLogGroup"]);
assert.equal(templateSource.includes('"AWS::ECS::'), false);
assert.equal(templateSource.includes('"AWS::Logs::LogStream"'), false);
assert.equal(templateSource.includes('"AWS::Logs::SubscriptionFilter"'), false);
assert.equal(templateSource.includes('"AWS::Logs::MetricFilter"'), false);
assert.equal(templateSource.includes('"KmsKeyId"'), false);

assert.match(
  operationScript,
  /\[ValidateSet\('LocalValidate', 'OnlineValidate', 'Create', 'Readback', 'Delete'\)\]/,
);
assert.match(operationScript, /\[string\]\$Mode = 'LocalValidate'/);
assert.match(operationScript, /\[string\]\$Profile = 'techlong-sandbox-provisioner'/);
assert.match(operationScript, /\[string\]\$SourceReadbackProfile = 'techlong-sandbox-user'/);
assert.match(operationScript, /\$stackName = 'techlong-sandbox-tenant-b5j4logs'/);
assert.match(operationScript, /\$logGroupName = '\/saas\/cell-sandbox-1\/tenant-lifecycle'/);
assert.match(
  operationScript,
  /\$expectedPrincipalArn = 'arn:aws:sts::402010193138:assumed-role\/TechlongSandboxProvisionerRole\/techlong-sandbox-provisioner'/,
);
assert.match(
  operationScript,
  /\$cloudFormationRoleArn = 'arn:aws:iam::402010193138:role\/TechlongSandboxCloudFormationExecutionRole'/,
);
assert.match(operationScript, /Assert-NoAwsOverrides/);
assert.match(operationScript, /AWS_IGNORE_CONFIGURED_ENDPOINT_URLS/);
assert.match(operationScript, /configure get login_session --profile \$SourceReadbackProfile/);
assert.match(operationScript, /function ConvertFrom-ExactJson/);
assert.match(operationScript, /ConvertFrom-Json -InputObject \$Json -DateKind String/);
assert.match(operationScript, /function New-ReadOnlyTemplateSnapshot/);
assert.match(operationScript, /\[System\.IO\.File\]::ReadAllBytes\(\$templatePath\)/);
assert.match(operationScript, /\[System\.IO\.FileAttributes\]::ReadOnly/);
assert.match(operationScript, /Get-FileHash -LiteralPath \$ReviewedTemplatePath -Algorithm SHA256/);
assert.match(operationScript, /--hash-template \$ReviewedTemplatePath/);
assert.match(operationScript, /--template \$templateSnapshotPath/);
assert.match(operationScript, /-ConfirmTemplateSha256/);
assert.match(operationScript, /-ConfirmTemplateCanonicalSha256/);
assert.match(operationScript, /ExpiresAt must be between 15 minutes and 3 hours in the future/);
assert.match(operationScript, /CREATE-only mode refuses update/);
assert.match(operationScript, /'cloudformation', 'create-stack'/);
assert.match(operationScript, /'--role-arn', \$cloudFormationRoleArn/);
assert.match(operationScript, /'--on-failure', 'DELETE'/);
assert.match(operationScript, /'--resource-types', 'AWS::Logs::LogGroup'/);
assert.match(operationScript, /'--timeout-in-minutes', '10'/);
assert.match(operationScript, /\$ExpiresAt -replace '\[-:\]',''/);
assert.match(operationScript, /'cloudformation', 'list-stack-resources'/);
assert.match(operationScript, /'cloudformation', 'get-template'/);
assert.match(operationScript, /'--template-stage', 'Original'/);
assert.match(operationScript, /--expected-template \$ReviewedTemplatePath/);
assert.match(operationScript, /'logs', 'describe-log-groups'/);
assert.match(operationScript, /'logs', 'list-tags-for-resource'/);
assert.match(operationScript, /'logs', 'describe-log-streams'/);
assert.match(operationScript, /'logs', 'describe-subscription-filters'/);
assert.match(operationScript, /'logs', 'describe-account-policies'/);
assert.match(operationScript, /'--policy-type', 'SUBSCRIPTION_FILTER_POLICY'/);
assert.match(operationScript, /function Assert-AccountSubscriptionPoliciesAbsent/);
assert.match(operationScript, /Account subscription-filter policies are not the exact empty set/);
assert.match(operationScript, /'ecs', 'describe-clusters'/);
assert.match(operationScript, /'iam', 'list-mfa-devices'/);
assert.match(operationScript, /ECS cluster \$clusterName is not exactly MISSING/);
assert.match(operationScript, /AcknowledgeExactEmptyLogDeletion/);
assert.match(operationScript, /-ConfirmStackId/);
assert.match(operationScript, /-ConfirmLogGroupName/);
assert.match(operationScript, /I_ACKNOWLEDGE_B5J4_EXACT_EMPTY_LOG_GROUP_DELETION/);
assert.match(operationScript, /registrationReady=false; liveReadbackReady=false; applyRuntimeReady=false; cleanupRuntimeReady=false/);
assert.doesNotMatch(operationScript, /--endpoint-url\b/);
assert.doesNotMatch(operationScript, /'cloudformation', '(?:update-stack|deploy)'/);
assert.doesNotMatch(operationScript, /'ecs', '(?:run-task|create-cluster|create-service)'/);
assert.doesNotMatch(operationScript, /'logs', '(?:create-log-group|delete-log-group|create-log-stream)'/);

const localValidationIndex = operationScript.indexOf(
  "Write-Host 'Running local B5-J4a lifecycle log support validation...'",
);
const localExitIndex = operationScript.indexOf(
  "Write-Host 'Local validation complete. No AWS API was called and no resource was changed.'",
);
const firstAwsResolutionIndex = operationScript.indexOf("$awsCli = Resolve-AwsCli");
const writeGateIndex = operationScript.lastIndexOf("Assert-WriteGate -Delete:");
assert.ok(
  localValidationIndex !== -1 &&
    localValidationIndex < localExitIndex &&
    localExitIndex < writeGateIndex &&
    writeGateIndex < firstAwsResolutionIndex,
  "local validation and write gates must run before resolving/calling AWS",
);

for (const pattern of [
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s/]+@/i,
  /(?:sk_(?:live|test)|whsec_)[A-Za-z0-9]{16,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
]) assert.doesNotMatch(`${templateSource}\n${operationScript}`, pattern);

rejectTemplateMutation(template, (value) => {
  value.Resources.Extra = { Type: "AWS::Logs::LogStream" };
});
rejectTemplateMutation(template, (value) => {
  value.Resources.TenantLifecycleLogGroup.Properties.RetentionInDays = 7;
});
rejectTemplateMutation(template, (value) => {
  value.Resources.TenantLifecycleLogGroup.Properties.LogGroupClass = "INFREQUENT_ACCESS";
});
rejectTemplateMutation(template, (value) => {
  value.Resources.TenantLifecycleLogGroup.Properties.KmsKeyId = "arn:aws:kms:example";
});
rejectTemplateMutation(template, (value) => {
  value.Resources.TenantLifecycleLogGroup.DeletionPolicy = "Retain";
});
rejectTemplateMutation(template, (value) => {
  value.Metadata.SafetyBoundary.LiveReadbackReady = true;
});

const evidence = validateLifecycleLogSupportReadback(
  syntheticDescribe(),
  syntheticTags(),
  clone(emptyStreams),
  clone(emptySubscriptions),
  clone(emptyAccountSubscriptions),
  clone(missingCluster),
  { expectedExpiresAt: expiresAt, expectedStackId: stackId },
);
assert.match(evidence.canonicalSha256, /^[a-f0-9]{64}$/);
for (const gate of Object.values(evidence.canonical.runtimeGates)) assert.equal(gate, false);
assert.equal(evidence.canonical.logGroup.storedBytes, 0);
assert.equal(evidence.canonical.logGroup.subscriptionFilters, 0);
assert.equal(evidence.canonical.logGroup.accountSubscriptionPolicies, 0);
assert.equal(evidence.canonical.logGroup.dataProtectionPolicy, false);
assert.equal(evidence.canonical.logGroup.bearerTokenAuthentication, false);
assert.deepEqual(evidence.canonical.sharedCellCluster, {
  name: "cell-sandbox-1",
  state: "MISSING",
});

for (const mutate of [
  ({ describe }) => (describe.logGroups[0].storedBytes = 1),
  ({ describe }) => (describe.logGroups[0].retentionInDays = 7),
  ({ describe }) => (describe.logGroups[0].metricFilterCount = 1),
  ({ describe }) => (describe.logGroups[0].logGroupClass = "INFREQUENT_ACCESS"),
  ({ describe }) => (describe.logGroups[0].deletionProtectionEnabled = true),
  ({ describe }) => (describe.logGroups[0].dataProtectionStatus = "ACTIVATED"),
  ({ describe }) =>
    (describe.logGroups[0].inheritedProperties = ["ACCOUNT_DATA_PROTECTION"]),
  ({ describe }) => (describe.logGroups[0].bearerTokenAuthenticationEnabled = true),
  ({ streams }) => streams.logStreams.push({ logStreamName: "unsafe" }),
  ({ subscriptions }) =>
    subscriptions.subscriptionFilters.push({ filterName: "unsafe" }),
  ({ accountSubscriptions }) =>
    accountSubscriptions.accountPolicies.push({ policyName: "unsafe" }),
  ({ tags }) => (tags.tags.Component = "foreign"),
  ({ tags }) => (tags.tags.Extra = "foreign"),
  ({ cluster }) => {
    cluster.clusters = [{ clusterArn: cluster.failures[0].arn }];
    cluster.failures = [];
  },
]) {
  const describe = syntheticDescribe();
  const tags = syntheticTags();
  const streams = clone(emptyStreams);
  const subscriptions = clone(emptySubscriptions);
  const accountSubscriptions = clone(emptyAccountSubscriptions);
  const cluster = clone(missingCluster);
  mutate({ describe, tags, streams, subscriptions, accountSubscriptions, cluster });
  assert.throws(() =>
    validateLifecycleLogSupportReadback(
      describe,
      tags,
      streams,
      subscriptions,
      accountSubscriptions,
      cluster,
      {
        expectedExpiresAt: expiresAt,
        expectedStackId: stackId,
      },
    ),
  );
}

const describeIndex = process.argv.indexOf("--describe");
if (describeIndex !== -1) {
  const paths = {
    describe: process.argv[describeIndex + 1],
    tags: argument("--tags"),
    streams: argument("--streams"),
    subscriptions: argument("--subscriptions"),
    accountSubscriptions: argument("--account-subscriptions"),
    cluster: argument("--cluster"),
  };
  for (const [name, value] of Object.entries(paths)) assert.ok(value, `--${name} requires a file path`);
  const [describe, tags, streams, subscriptions, accountSubscriptions, cluster] =
    await Promise.all(
    Object.values(paths).map((file) => readFile(path.resolve(file), "utf8").then(JSON.parse)),
  );
  const live = validateLifecycleLogSupportReadback(
    describe,
    tags,
    streams,
    subscriptions,
    accountSubscriptions,
    cluster,
    {
      expectedExpiresAt: argument("--expires-at"),
      expectedStackId: argument("--stack-id"),
    },
  );
  process.stdout.write(`${canonicalJson(live)}\n`);
} else {
  console.log(
    `B5-J4a one-resource lifecycle log support mutation tests passed (${intent.propertiesCanonicalSha256}).`,
  );
}
