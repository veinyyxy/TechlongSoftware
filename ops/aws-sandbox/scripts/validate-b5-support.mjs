import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderBootstrapTemplate } from "./render-bootstrap.mjs";
import { renderB5SupportRollbackTemplate } from "./render-b5-support-rollback.mjs";
import {
  assertExactChangeSetTemplate,
  canonicalTemplateSha256,
} from "./verify-change-set-template.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const projectRoot = path.resolve(root, "..", "..");
const templatePath = path.join(
  root,
  "cloudformation",
  "s3-bootstrap.template.json",
);
const operationScriptPath = path.join(
  root,
  "scripts",
  "s3-b5-support-bootstrap.ps1",
);
const sandboxConfigPath = path.join(root, "sandbox.example.json");
const oneShotContractPath = path.join(
  projectRoot,
  "lib",
  "deployments",
  "execution",
  "ecs-one-shot-task.ts",
);

const [
  templateSource,
  operationScript,
  oneShotContract,
  sandboxConfigSource,
  renderedSource,
  rollbackSource,
] =
  await Promise.all([
    readFile(templatePath, "utf8"),
    readFile(operationScriptPath, "utf8"),
    readFile(oneShotContractPath, "utf8"),
    readFile(sandboxConfigPath, "utf8"),
    renderBootstrapTemplate(),
    renderB5SupportRollbackTemplate(),
  ]);

const template = JSON.parse(templateSource);
const rendered = JSON.parse(renderedSource);
const rollback = JSON.parse(rollbackSource);
const sandboxConfig = JSON.parse(sandboxConfigSource);
const resources = template.Resources;
const receiptBucketName =
  "techlong-sandbox-402010193138-ca-central-1-tenant-receipts";
const receiptBucketArn = `arn:aws:s3:::${receiptBucketName}`;
const receiptObjectArn = `${receiptBucketArn}/tenant-lifecycle/v1/*`;
const authorityTableName =
  "techlong-sandbox-tenant-external-epoch-authority";
const authorityTableArn =
  `arn:aws:dynamodb:ca-central-1:402010193138:table/${authorityTableName}`;
const clusterArn =
  "arn:aws:ecs:ca-central-1:402010193138:cluster/cell-sandbox-1";
const lifecycleTaskDefinitionArn =
  "arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-lifecycle:*";
const lifecycleTaskArn =
  "arn:aws:ecs:ca-central-1:402010193138:task/cell-sandbox-1/*";
const generationSecretArn =
  "arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/tenant/*/runtime/g*-??????";
const sandboxTaskRoleArns = [
  "arn:aws:iam::402010193138:role/TechlongSandboxTaskExecutionRole",
  "arn:aws:iam::402010193138:role/TechlongSandboxTenantLifecycleTaskRole",
];
const oneShotTagKeys = [
  "ManagedBy",
  "ResourceGeneration",
  "OwnershipMarker",
  "ExternalOperationEpoch",
  "ExternalOperationMarker",
  "ExternalOperationHash",
];
const runtimeSecretTagKeys = [
  "ManagedBy",
  "SecretSchema",
  "ResourceGeneration",
  "OwnershipMarker",
];
const supportResources = new Map([
  ["TenantLifecycleReceiptBucket", "AWS::S3::Bucket"],
  ["TenantLifecycleReceiptBucketPolicy", "AWS::S3::BucketPolicy"],
  ["TenantExternalEpochAuthorityTable", "AWS::DynamoDB::Table"],
  ["TenantLifecycleTaskRole", "AWS::IAM::Role"],
  ["DeploymentWorkerRole", "AWS::IAM::Role"],
]);
const supportOutputs = [
  "TenantLifecycleReceiptBucketName",
  "TenantLifecycleReceiptBucketArn",
  "TenantExternalEpochAuthorityTableName",
  "TenantExternalEpochAuthorityTableArn",
  "TenantLifecycleTaskRoleArn",
  "DeploymentWorkerRoleArn",
];
const serviceBoundarySupportSids = [
  "AllowExactTenantLifecycleReceipts",
  "AllowExactExternalEpochAuthority",
  "AllowExactTenantLifecycleRunTask",
  "AllowExactCellOneShotTaskControl",
  "AllowExactCellOneShotTaskRecovery",
  "AllowRunTaskTagAuthorizationOnly",
  "AllowPassOnlySandboxTaskRoles",
  "AllowGenerationOwnedRuntimeSecretLifecycle",
];
const provisionerBoundarySupportSids = [
  "AllowExactWorkerCanaryRole",
  "AllowSharedCellReadOnlyPreflight",
];

function actionList(statement) {
  if (!statement?.Action) return [];
  return Array.isArray(statement.Action)
    ? statement.Action
    : [statement.Action];
}

function statementBySid(policy, sid) {
  return policy.Statement.find((statement) => statement.Sid === sid);
}

assert.equal(template.Metadata.SafetyBoundary.CreatesB5SupportResources, true);
assert.equal(template.Metadata.SafetyBoundary.ApplyRuntimeReady, false);
assert.equal(template.Metadata.SafetyBoundary.CleanupRuntimeReady, false);
assert.equal(template.Metadata.SafetyBoundary.ReceiptRetentionDays, 1);
assert.equal(
  template.Metadata.SafetyBoundary.AuthorityBillingMode,
  "PAY_PER_REQUEST",
);
assert.deepEqual(template.Parameters.ExpectedAccountId.AllowedValues, [
  "402010193138",
]);
assert.deepEqual(template.Parameters.ExpectedRegion.AllowedValues, [
  "ca-central-1",
]);
assert.deepEqual(sandboxConfig.b5Support, {
  receiptBucketName,
  receiptPrefix: "tenant-lifecycle/v1/",
  receiptRetentionDays: 1,
  authorityTableName,
  authorityBillingMode: "PAY_PER_REQUEST",
  authorityMaxReadRequestUnits: 5,
  authorityMaxWriteRequestUnits: 2,
  applyRuntimeReady: false,
  cleanupRuntimeReady: false,
});

for (const [logicalId, resourceType] of supportResources) {
  assert.equal(resources[logicalId]?.Type, resourceType);
  assert.equal(resources[logicalId]?.Condition, "IsExpectedTarget");
  assert.equal(rollback.Resources[logicalId], undefined);
}
for (const outputName of supportOutputs) {
  assert.ok(template.Outputs[outputName]);
  assert.equal(rollback.Outputs[outputName], undefined);
}
assert.equal(rollback.Metadata.SafetyBoundary.CreatesB5SupportResources, false);
assert.equal(
  rollback.Metadata.SafetyBoundary.RevokesB5SupportIamCapabilities,
  true,
);
assert.equal(rollback.Metadata.SafetyBoundary.ApplyRuntimeReady, false);
assert.equal(rollback.Metadata.SafetyBoundary.CleanupRuntimeReady, false);
assert.equal(
  Object.keys(template.Resources).length - Object.keys(rollback.Resources).length,
  supportResources.size,
);
assert.equal(
  Object.keys(template.Outputs).length - Object.keys(rollback.Outputs).length,
  supportOutputs.length,
);
const intentionallyChangedRollbackResources = new Set([
  "ServiceRoleBoundary",
  "ProvisionerBoundary",
]);
for (const logicalId of Object.keys(rollback.Resources)) {
  if (intentionallyChangedRollbackResources.has(logicalId)) continue;
  assert.deepEqual(
    rollback.Resources[logicalId],
    rendered.Resources[logicalId],
    `rollback unexpectedly mutates retained resource ${logicalId}`,
  );
}
const rollbackServiceBoundary =
  rollback.Resources.ServiceRoleBoundary.Properties.PolicyDocument;
const expectedRollbackServiceBoundary = structuredClone(
  rendered.Resources.ServiceRoleBoundary,
);
expectedRollbackServiceBoundary.Properties.PolicyDocument.Statement =
  expectedRollbackServiceBoundary.Properties.PolicyDocument.Statement.filter(
    (statement) => !serviceBoundarySupportSids.includes(statement.Sid),
  );
assert.deepEqual(
  rollback.Resources.ServiceRoleBoundary,
  expectedRollbackServiceBoundary,
  "rollback may only revoke the enumerated B5 support boundary statements",
);
for (const sid of serviceBoundarySupportSids) {
  assert.equal(
    statementBySid(rollbackServiceBoundary, sid),
    undefined,
    `rollback must revoke ServiceRoleBoundary/${sid}`,
  );
}
for (const sid of provisionerBoundarySupportSids) {
  assert.equal(
    statementBySid(
      rollback.Resources.ProvisionerBoundary.Properties.PolicyDocument,
      sid,
    ),
    undefined,
    `rollback must revoke ProvisionerBoundary/${sid}`,
  );
}
const expectedRollbackProvisionerBoundary = structuredClone(
  rendered.Resources.ProvisionerBoundary,
);
expectedRollbackProvisionerBoundary.Properties.PolicyDocument.Statement =
  expectedRollbackProvisionerBoundary.Properties.PolicyDocument.Statement.filter(
    (statement) => !provisionerBoundarySupportSids.includes(statement.Sid),
  );
assert.deepEqual(
  rollback.Resources.ProvisionerBoundary,
  expectedRollbackProvisionerBoundary,
  "rollback may only revoke the WorkerRole assume and Shared Cell read-only capabilities",
);
assert.equal(
  rollback.Resources.TaskRole.Properties.Policies,
  undefined,
  "rollback must retain removal of the public task role S3 wildcard policy",
);

const bucket = resources.TenantLifecycleReceiptBucket;
assert.equal(bucket.DeletionPolicy, "Delete");
assert.equal(bucket.UpdateReplacePolicy, "Delete");
assert.equal(bucket.Properties.BucketName, receiptBucketName);
assert.deepEqual(bucket.Properties.BucketEncryption, {
  ServerSideEncryptionConfiguration: [
    { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
  ],
});
assert.deepEqual(bucket.Properties.PublicAccessBlockConfiguration, {
  BlockPublicAcls: true,
  BlockPublicPolicy: true,
  IgnorePublicAcls: true,
  RestrictPublicBuckets: true,
});
assert.deepEqual(bucket.Properties.OwnershipControls, {
  Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }],
});
assert.deepEqual(bucket.Properties.LifecycleConfiguration.Rules, [
  {
    Id: "ExpireTenantLifecycleReceiptsAfterOneDay",
    Prefix: "tenant-lifecycle/v1/",
    Status: "Enabled",
    ExpirationInDays: 1,
  },
]);
for (const forbiddenProperty of [
  "AccessControl",
  "LoggingConfiguration",
  "ReplicationConfiguration",
  "VersioningConfiguration",
  "WebsiteConfiguration",
]) {
  assert.equal(bucket.Properties[forbiddenProperty], undefined);
}

const bucketPolicy =
  resources.TenantLifecycleReceiptBucketPolicy.Properties.PolicyDocument;
assert.equal(bucketPolicy.Statement.length, 4);
const transportDeny = statementBySid(bucketPolicy, "DenyInsecureTransport");
assert.equal(transportDeny.Effect, "Deny");
assert.equal(transportDeny.Principal, "*");
assert.equal(transportDeny.Action, "s3:*");
assert.equal(transportDeny.Condition.Bool["aws:SecureTransport"], "false");
assert.deepEqual(transportDeny.Resource, [
  { "Fn::GetAtt": ["TenantLifecycleReceiptBucket", "Arn"] },
  { "Fn::Sub": "${TenantLifecycleReceiptBucket.Arn}/*" },
]);
const encryptionDeny = statementBySid(
  bucketPolicy,
  "DenyReceiptWritesWithoutSseS3",
);
assert.equal(
  encryptionDeny.Condition.StringNotEquals["s3:x-amz-server-side-encryption"],
  "AES256",
);
assert.equal(
  statementBySid(bucketPolicy, "DenyReceiptWritesWithoutIfNoneMatch").Condition
    .Null["s3:if-none-match"],
  "true",
);
assert.equal(
  statementBySid(bucketPolicy, "DenyReceiptWritesWithWrongIfNoneMatch")
    .Condition.StringNotEquals["s3:if-none-match"],
  "*",
);

const table = resources.TenantExternalEpochAuthorityTable;
assert.equal(table.DeletionPolicy, "Delete");
assert.equal(table.UpdateReplacePolicy, "Delete");
assert.equal(table.Properties.TableName, authorityTableName);
assert.deepEqual(table.Properties.AttributeDefinitions, [
  { AttributeName: "authority_key", AttributeType: "S" },
]);
assert.deepEqual(table.Properties.KeySchema, [
  { AttributeName: "authority_key", KeyType: "HASH" },
]);
assert.equal(table.Properties.BillingMode, "PAY_PER_REQUEST");
assert.equal(table.Properties.ProvisionedThroughput, undefined);
assert.deepEqual(table.Properties.OnDemandThroughput, {
  MaxReadRequestUnits: 5,
  MaxWriteRequestUnits: 2,
});
assert.equal(table.Properties.DeletionProtectionEnabled, false);
assert.deepEqual(table.Properties.PointInTimeRecoverySpecification, {
  PointInTimeRecoveryEnabled: false,
});
assert.deepEqual(table.Properties.SSESpecification, { SSEEnabled: false });
assert.equal(table.Properties.TableClass, "STANDARD");
for (const forbiddenProperty of [
  "ContributorInsightsSpecification",
  "GlobalSecondaryIndexes",
  "KinesisStreamSpecification",
  "LocalSecondaryIndexes",
  "StreamSpecification",
  "TimeToLiveSpecification",
  "WarmThroughput",
]) {
  assert.equal(table.Properties[forbiddenProperty], undefined);
}

const serviceBoundary = resources.ServiceRoleBoundary.Properties.PolicyDocument;
const boundaryReceipt = statementBySid(
  serviceBoundary,
  "AllowExactTenantLifecycleReceipts",
);
assert.deepEqual(actionList(boundaryReceipt).sort(), [
  "s3:GetObject",
  "s3:PutObject",
]);
assert.equal(boundaryReceipt.Resource, receiptObjectArn);
const boundaryAuthority = statementBySid(
  serviceBoundary,
  "AllowExactExternalEpochAuthority",
);
assert.deepEqual(actionList(boundaryAuthority).sort(), [
  "dynamodb:GetItem",
  "dynamodb:PutItem",
]);
assert.equal(boundaryAuthority.Resource, authorityTableArn);
const boundaryRunTask = statementBySid(
  serviceBoundary,
  "AllowExactTenantLifecycleRunTask",
);
assert.deepEqual(actionList(boundaryRunTask), ["ecs:RunTask"]);
assert.equal(boundaryRunTask.Resource, lifecycleTaskDefinitionArn);
assert.equal(boundaryRunTask.Condition.StringEquals["aws:RequestedRegion"], "ca-central-1");
assert.equal(boundaryRunTask.Condition.ArnEquals["ecs:cluster"], clusterArn);
const boundaryTaskControl = statementBySid(
  serviceBoundary,
  "AllowExactCellOneShotTaskControl",
);
assert.deepEqual(actionList(boundaryTaskControl).sort(), [
  "ecs:DescribeTasks",
  "ecs:StopTask",
]);
assert.equal(boundaryTaskControl.Resource, lifecycleTaskArn);
const boundaryListTasks = statementBySid(
  serviceBoundary,
  "AllowExactCellOneShotTaskRecovery",
);
assert.deepEqual(actionList(boundaryListTasks), ["ecs:ListTasks"]);
assert.equal(boundaryListTasks.Resource, "*");
assert.equal(boundaryListTasks.Condition.ArnEquals["ecs:cluster"], clusterArn);
assert.equal(
  boundaryListTasks.Condition.StringEquals["aws:RequestedRegion"],
  "ca-central-1",
);
const boundaryTagTask = statementBySid(
  serviceBoundary,
  "AllowRunTaskTagAuthorizationOnly",
);
assert.deepEqual(actionList(boundaryTagTask), ["ecs:TagResource"]);
assert.equal(boundaryTagTask.Resource, "*");
assert.deepEqual(boundaryTagTask.Condition.StringEquals, {
  "aws:RequestedRegion": "ca-central-1",
  "ecs:CreateAction": "RunTask",
});
const boundaryPassRole = statementBySid(
  serviceBoundary,
  "AllowPassOnlySandboxTaskRoles",
);
assert.deepEqual(actionList(boundaryPassRole), ["iam:PassRole"]);
assert.deepEqual(boundaryPassRole.Resource, sandboxTaskRoleArns);
assert.equal(
  boundaryPassRole.Condition.StringEquals["iam:PassedToService"],
  "ecs-tasks.amazonaws.com",
);
const boundarySecrets = statementBySid(
  serviceBoundary,
  "AllowGenerationOwnedRuntimeSecretLifecycle",
);
assert.deepEqual(actionList(boundarySecrets).sort(), [
  "secretsmanager:CreateSecret",
  "secretsmanager:DeleteSecret",
  "secretsmanager:DescribeSecret",
  "secretsmanager:GetSecretValue",
  "secretsmanager:PutSecretValue",
  "secretsmanager:TagResource",
]);
assert.equal(boundarySecrets.Resource, generationSecretArn);
assert.equal(
  JSON.stringify(serviceBoundary).includes("arn:aws:s3:::techlong-sandbox-*"),
  false,
);
assert.ok(Buffer.byteLength(JSON.stringify(serviceBoundary), "utf8") <= 6_144);

const taskRole = resources.TaskRole.Properties;
assert.equal(taskRole.RoleName, "TechlongSandboxTaskRole");
assert.deepEqual(taskRole.PermissionsBoundary, { Ref: "ServiceRoleBoundary" });
assert.equal(
  taskRole.Policies,
  undefined,
  "the public tenant web-service role must have no receipt or Secret identity permissions",
);

const lifecycleTaskRole = resources.TenantLifecycleTaskRole.Properties;
assert.equal(
  lifecycleTaskRole.RoleName,
  "TechlongSandboxTenantLifecycleTaskRole",
);
assert.deepEqual(
  lifecycleTaskRole.PermissionsBoundary,
  { Ref: "ServiceRoleBoundary" },
);
assert.equal(lifecycleTaskRole.MaxSessionDuration, 3600);
const lifecycleTrust = lifecycleTaskRole.AssumeRolePolicyDocument.Statement[0];
assert.equal(lifecycleTrust.Principal.Service, "ecs-tasks.amazonaws.com");
assert.equal(
  lifecycleTrust.Condition.StringEquals["aws:SourceAccount"],
  "402010193138",
);
assert.equal(
  lifecycleTrust.Condition.ArnLike["aws:SourceArn"],
  "arn:aws:ecs:ca-central-1:402010193138:*",
);
const lifecyclePolicy = lifecycleTaskRole.Policies[0];
assert.equal(
  lifecyclePolicy.PolicyName,
  "ImmutableReceiptsAndGenerationSecretRead",
);
const lifecycleStatements = lifecyclePolicy.PolicyDocument.Statement;
assert.equal(lifecycleStatements.length, 3);
assert.deepEqual(lifecycleStatements.flatMap(actionList).sort(), [
  "s3:GetObject",
  "s3:PutObject",
  "secretsmanager:DescribeSecret",
  "secretsmanager:GetSecretValue",
]);
const lifecycleReceiptStatements = lifecycleStatements.filter((statement) =>
  actionList(statement).some((action) => action.startsWith("s3:")),
);
assert.ok(
  lifecycleReceiptStatements.every(
    (statement) => statement.Resource === receiptObjectArn,
  ),
);
const taskPut = lifecycleStatements.find((statement) =>
  actionList(statement).includes("s3:PutObject"),
);
assert.equal(
  taskPut.Condition.StringEquals["s3:x-amz-server-side-encryption"],
  "AES256",
);
assert.equal(taskPut.Condition.StringEquals["s3:if-none-match"], "*");
const lifecycleSecretRead = lifecycleStatements.find((statement) =>
  actionList(statement).includes("secretsmanager:GetSecretValue"),
);
assert.equal(lifecycleSecretRead.Resource, generationSecretArn);
assert.deepEqual(lifecycleSecretRead.Condition.StringEquals, {
  "aws:RequestedRegion": "ca-central-1",
  "aws:ResourceTag/ManagedBy": "techlong-deployment-worker",
  "aws:ResourceTag/SecretSchema": "techlong-runtime-five-key-v1",
});
assert.ok(
  Buffer.byteLength(JSON.stringify(lifecyclePolicy.PolicyDocument), "utf8") <=
    10_240,
);
assert.equal(
  JSON.stringify(lifecyclePolicy.PolicyDocument).includes(
    "arn:aws:s3:::techlong-sandbox-*",
  ),
  false,
);

const workerRole = resources.DeploymentWorkerRole.Properties;
assert.equal(workerRole.RoleName, "TechlongSandboxDeploymentWorkerRole");
assert.deepEqual(workerRole.PermissionsBoundary, { Ref: "ServiceRoleBoundary" });
assert.equal(workerRole.MaxSessionDuration, 3600);
const ecsTrust = statementBySid(
  workerRole.AssumeRolePolicyDocument,
  "AllowSandboxEcsWorkerTask",
);
assert.equal(ecsTrust.Principal.Service, "ecs-tasks.amazonaws.com");
assert.equal(ecsTrust.Condition.StringEquals["aws:SourceAccount"], "402010193138");
assert.equal(
  ecsTrust.Condition.ArnLike["aws:SourceArn"],
  "arn:aws:ecs:ca-central-1:402010193138:*",
);
const canaryTrust = statementBySid(
  workerRole.AssumeRolePolicyDocument,
  "AllowMfaProvisionerCanarySession",
);
assert.deepEqual(canaryTrust.Principal.AWS, {
  "Fn::GetAtt": ["ProvisionerRole", "Arn"],
});
assert.equal(
  canaryTrust.Condition.StringEquals["sts:RoleSessionName"],
  "techlong-sandbox-worker-canary",
);
const workerStatements = workerRole.Policies[0].PolicyDocument.Statement;
assert.deepEqual(
  workerStatements.flatMap(actionList).sort(),
  [
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "ecs:DescribeTasks",
    "ecs:ListTasks",
    "ecs:RunTask",
    "ecs:StopTask",
    "ecs:TagResource",
    "iam:PassRole",
    "s3:GetObject",
    "secretsmanager:CreateSecret",
    "secretsmanager:DeleteSecret",
    "secretsmanager:DescribeSecret",
    "secretsmanager:GetSecretValue",
    "secretsmanager:PutSecretValue",
    "secretsmanager:TagResource",
  ],
);
assert.equal(
  workerStatements.find((statement) => actionList(statement).includes("s3:GetObject"))
    .Resource,
  receiptObjectArn,
);
assert.equal(
  workerStatements.find((statement) => actionList(statement).includes("dynamodb:GetItem"))
    .Resource,
  authorityTableArn,
);
const workerAuthority = statementBySid(
  workerRole.Policies[0].PolicyDocument,
  "ReadWriteExactExternalEpochAuthority",
);
assert.deepEqual(
  workerAuthority.Condition["ForAllValues:StringLike"]["dynamodb:LeadingKeys"],
  ["tenant:*"],
);
const workerRunTask = statementBySid(
  workerRole.Policies[0].PolicyDocument,
  "RunExactTenantLifecycleTask",
);
assert.equal(workerRunTask.Resource, lifecycleTaskDefinitionArn);
assert.equal(workerRunTask.Condition.ArnEquals["ecs:cluster"], clusterArn);
assert.equal(workerRunTask.Condition.StringEquals["ecs:enable-execute-command"], "false");
assert.equal(
  workerRunTask.Condition.StringEquals["aws:RequestTag/ManagedBy"],
  "techlong-deployment-worker",
);
assert.deepEqual(
  workerRunTask.Condition["ForAllValues:StringEquals"]["aws:TagKeys"],
  oneShotTagKeys,
);
for (const tagKey of oneShotTagKeys) {
  assert.equal(workerRunTask.Condition.Null[`aws:RequestTag/${tagKey}`], "false");
}
const workerTagTask = statementBySid(
  workerRole.Policies[0].PolicyDocument,
  "AuthorizeExactRunTaskTags",
);
assert.equal(workerTagTask.Resource, "*");
assert.equal(workerTagTask.Condition.StringEquals["ecs:CreateAction"], "RunTask");
assert.deepEqual(
  workerTagTask.Condition["ForAllValues:StringEquals"]["aws:TagKeys"],
  oneShotTagKeys,
);
const workerListTasks = statementBySid(
  workerRole.Policies[0].PolicyDocument,
  "RecoverOnlyExactCellTasks",
);
assert.equal(workerListTasks.Resource, "*");
assert.equal(workerListTasks.Condition.ArnEquals["ecs:cluster"], clusterArn);
const workerTaskControl = statementBySid(
  workerRole.Policies[0].PolicyDocument,
  "ObserveAndStopOwnedCellTasks",
);
assert.equal(workerTaskControl.Resource, lifecycleTaskArn);
assert.equal(workerTaskControl.Condition.ArnEquals["ecs:cluster"], clusterArn);
assert.equal(
  workerTaskControl.Condition.StringEquals["aws:ResourceTag/ManagedBy"],
  "techlong-deployment-worker",
);
const workerPassRole = statementBySid(
  workerRole.Policies[0].PolicyDocument,
  "PassOnlySandboxTaskRolesToEcs",
);
assert.deepEqual(workerPassRole.Resource, sandboxTaskRoleArns);
assert.equal(
  workerPassRole.Condition.StringEquals["iam:PassedToService"],
  "ecs-tasks.amazonaws.com",
);
const workerCreateSecret = statementBySid(
  workerRole.Policies[0].PolicyDocument,
  "CreateGenerationOwnedRuntimeSecret",
);
assert.equal(workerCreateSecret.Resource, generationSecretArn);
assert.equal(
  workerCreateSecret.Condition.StringLike["secretsmanager:Name"],
  "techlong/sandbox/tenant/*/runtime/g*",
);
assert.equal(workerCreateSecret.Condition.Null["secretsmanager:KmsKeyId"], "true");
assert.equal(
  workerCreateSecret.Condition.Null["secretsmanager:AddReplicaRegions"],
  "true",
);
assert.deepEqual(
  workerCreateSecret.Condition["ForAllValues:StringEquals"]["aws:TagKeys"],
  runtimeSecretTagKeys,
);
const workerTagSecret = statementBySid(
  workerRole.Policies[0].PolicyDocument,
  "TagGenerationOwnedRuntimeSecret",
);
assert.equal(workerTagSecret.Resource, generationSecretArn);
assert.deepEqual(
  workerTagSecret.Condition["ForAllValues:StringEquals"]["aws:TagKeys"],
  runtimeSecretTagKeys,
);
const workerReadSecret = statementBySid(
  workerRole.Policies[0].PolicyDocument,
  "ReadAndVersionOwnedRuntimeSecrets",
);
assert.equal(workerReadSecret.Resource, generationSecretArn);
assert.equal(
  workerReadSecret.Condition.StringEquals["aws:ResourceTag/ManagedBy"],
  "techlong-deployment-worker",
);
const workerDeleteSecret = statementBySid(
  workerRole.Policies[0].PolicyDocument,
  "ScheduleOwnedRuntimeSecretDeletion",
);
assert.equal(workerDeleteSecret.Resource, generationSecretArn);
assert.equal(
  workerDeleteSecret.Condition.BoolIfExists[
    "secretsmanager:ForceDeleteWithoutRecovery"
  ],
  "false",
);
assert.equal(
  workerDeleteSecret.Condition.NumericGreaterThanEquals[
    "secretsmanager:RecoveryWindowInDays"
  ],
  7,
);
assert.equal(
  workerDeleteSecret.Condition.NumericLessThanEquals[
    "secretsmanager:RecoveryWindowInDays"
  ],
  30,
);
assert.deepEqual(
  workerStatements
    .filter((statement) => statement.Resource === "*")
    .map((statement) => statement.Sid)
    .sort(),
  ["AuthorizeExactRunTaskTags", "RecoverOnlyExactCellTasks"],
);
assert.ok(
  workerStatements.every((statement) =>
    actionList(statement).every((action) => !action.includes("*")),
  ),
);
for (const forbiddenActionPrefix of [
  "cloudformation:",
  "elasticloadbalancing:",
  "rds:",
]) {
  assert.equal(
    workerStatements
      .flatMap(actionList)
      .some((action) => action.startsWith(forbiddenActionPrefix)),
    false,
  );
}
assert.ok(
  Buffer.byteLength(
    JSON.stringify(workerRole.Policies[0].PolicyDocument),
    "utf8",
  ) <= 10_240,
);

const provisionerBoundary =
  resources.ProvisionerBoundary.Properties.PolicyDocument;
const workerAssume = statementBySid(
  provisionerBoundary,
  "AllowExactWorkerCanaryRole",
);
assert.deepEqual(actionList(workerAssume), ["sts:AssumeRole"]);
assert.equal(
  workerAssume.Resource,
  "arn:aws:iam::402010193138:role/TechlongSandboxDeploymentWorkerRole",
);
const sharedCellRead = statementBySid(
  provisionerBoundary,
  "AllowSharedCellReadOnlyPreflight",
);
assert.deepEqual(
  actionList(sharedCellRead).sort(),
  [
    "ec2:DescribeInternetGateways",
    "ec2:DescribeRouteTables",
    "ec2:DescribeSecurityGroups",
    "ec2:DescribeSubnets",
    "ec2:DescribeVpcs",
    "ecs:DescribeClusters",
    "elasticloadbalancing:DescribeListeners",
    "elasticloadbalancing:DescribeLoadBalancers",
    "elasticloadbalancing:DescribeRules",
    "elasticloadbalancing:DescribeTags",
    "elasticloadbalancing:DescribeTrustStores",
    "rds:DescribeDBClusters",
    "rds:DescribeDBInstances",
    "rds:DescribeDBSubnetGroups",
  ].sort(),
);
assert.equal(sharedCellRead.Resource, "*");
assert.deepEqual(sharedCellRead.Condition, {
  StringEquals: { "aws:RequestedRegion": "ca-central-1" },
});

assert.equal(
  template.Outputs.TenantLifecycleReceiptBucketName.Value.Ref,
  "TenantLifecycleReceiptBucket",
);
assert.deepEqual(template.Outputs.TenantLifecycleReceiptBucketArn.Value, {
  "Fn::GetAtt": ["TenantLifecycleReceiptBucket", "Arn"],
});
assert.equal(
  template.Outputs.TenantExternalEpochAuthorityTableName.Value.Ref,
  "TenantExternalEpochAuthorityTable",
);
assert.deepEqual(template.Outputs.TenantExternalEpochAuthorityTableArn.Value, {
  "Fn::GetAtt": ["TenantExternalEpochAuthorityTable", "Arn"],
});
assert.deepEqual(template.Outputs.TenantLifecycleTaskRoleArn.Value, {
  "Fn::GetAtt": ["TenantLifecycleTaskRole", "Arn"],
});
assert.deepEqual(template.Outputs.DeploymentWorkerRoleArn.Value, {
  "Fn::GetAtt": ["DeploymentWorkerRole", "Arn"],
});

assert.match(
  oneShotContract,
  /techlong-sandbox-\$\{input\.accountId\}-\$\{input\.region\}-[\s\S]*?tenant-receipts/,
);
assert.ok(Buffer.byteLength(renderedSource, "utf8") <= 51_200);
assert.ok(Buffer.byteLength(rollbackSource, "utf8") <= 51_200);
assert.equal(renderedSource.includes("__JANITOR_INLINE_SOURCE__"), false);
assert.equal(rollbackSource.includes("__JANITOR_INLINE_SOURCE__"), false);
const renderedCanonicalHash = canonicalTemplateSha256(rendered);
assert.match(renderedCanonicalHash, /^[a-f0-9]{64}$/);
assert.equal(
  assertExactChangeSetTemplate(rendered, { TemplateBody: rendered }),
  renderedCanonicalHash,
);
assert.equal(
  assertExactChangeSetTemplate(rendered, {
    TemplateBody: JSON.stringify(rendered),
  }),
  renderedCanonicalHash,
);
assert.equal(
  canonicalTemplateSha256({ B: [2, 1], A: { D: true, C: null } }),
  canonicalTemplateSha256({ A: { C: null, D: true }, B: [2, 1] }),
);
assert.throws(
  () =>
    assertExactChangeSetTemplate(rendered, {
      TemplateBody: { ...rendered, Description: "tampered" },
    }),
  /does not exactly match/,
);

assert.match(
  operationScript,
  /\[ValidateSet\([\s\S]*?'CreateChangeSet'[\s\S]*?'InspectChangeSet'[\s\S]*?'ExecuteChangeSet'[\s\S]*?'CreateRollbackChangeSet'[\s\S]*?'InspectRollbackChangeSet'[\s\S]*?'ExecuteRollbackChangeSet'/,
);
assert.match(operationScript, /\[string\]\$Mode = 'LocalValidate'/);
assert.match(operationScript, /\[string\]\$Profile = 'techlong-sandbox-user'/);
assert.match(operationScript, /\$supportInfrastructureWriteReady = \$true/);
assert.match(operationScript, /\$expectedAccountId = '402010193138'/);
assert.match(operationScript, /\$expectedRegion = 'ca-central-1'/);
assert.match(
  operationScript,
  /\$expectedPrincipalArn = 'arn:aws:iam::402010193138:user\/techlong-sandbox-dev'/,
);
assert.match(
  operationScript,
  /\$expectedMfaDeviceArn = 'arn:aws:iam::402010193138:mfa\/techlong-sandbox-dev'/,
);
assert.match(operationScript, /verify-change-set-template\.mjs/);
for (const acknowledgement of [
  "AcknowledgeAwsWrite",
  "AcknowledgeLowCostNotFree",
  "AcknowledgeSourceUserBootstrapRisk",
  "AcknowledgeMfaSession",
  "AcknowledgeChangeSetReviewed",
  "AcknowledgeDeleteAllReceipts",
  "AcknowledgeDeleteAuthorityRecords",
  "ConfirmAccountId",
  "ConfirmRegion",
  "ConfirmBootstrapStackName",
  "ConfirmExecutionPhrase",
]) {
  assert.match(operationScript, new RegExp(`\\$${acknowledgement}\\b`));
}
assert.match(
  operationScript,
  /I_ACKNOWLEDGE_B5_SUPPORT_BOOTSTRAP_AWS_CHANGES/,
);
assert.match(
  operationScript,
  /I_ACKNOWLEDGE_B5_SUPPORT_ROLLBACK_DATA_DELETION/,
);
assert.match(operationScript, /\$ChangeSet\.RoleARN/);
assert.match(operationScript, /\$Stack\.RoleARN/);
assert.match(operationScript, /\$ChangeSet\.Capabilities/);
assert.doesNotMatch(operationScript, /\$ChangeSet\.ChangeSetType/);
assert.match(operationScript, /\$ChangeSet\.IncludeNestedStacks -ne \$false/);
assert.match(operationScript, /\$ChangeSet\.ImportExistingResources -eq \$true/);
assert.match(operationScript, /\$ChangeSet\.DeploymentConfig\.Mode -ne 'STANDARD'/);
assert.match(operationScript, /\$ChangeSet\.DeploymentConfig\.DisableRollback -ne \$false/);
assert.match(operationScript, /Change Set tags do not match/);
for (const logicalId of [
  "GlobalJanitorSchedule",
  "JanitorFunction",
  "SchedulerInvokeRole",
]) {
  assert.match(
    operationScript,
    new RegExp(`${logicalId} = @\\{ Type = '[^']+'; Action = 'Modify' \\}`),
  );
}
assert.match(
  operationScript,
  /configure get login_session --profile \$Profile/,
);
assert.match(
  operationScript,
  /access_key\\s\*:\\s\*\\S\+\\s\*:\\s\*login\\s\*:/,
);
assert.match(
  operationScript,
  /secret_key\\s\*:\\s\*\\S\+\\s\*:\\s\*login\\s\*:/,
);
assert.match(operationScript, /configure list --profile \$Profile/);
for (const credentialVariable of [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
]) {
  assert.match(operationScript, new RegExp(credentialVariable));
}
assert.match(operationScript, /'iam', 'list-mfa-devices'/);
assert.match(operationScript, /\$devices\.Count -ne 1/);
assert.match(operationScript, /\$expectedMfaDeviceArn/);
assert.match(
  operationScript,
  /\$Stack\.StackStatus -notin @\(\s*'CREATE_COMPLETE',\s*'UPDATE_COMPLETE',\s*'UPDATE_ROLLBACK_COMPLETE'\s*\)/,
);
assert.doesNotMatch(operationScript, /\$Stack\.StackStatus -match '_IN_PROGRESS\$'/);
assert.match(
  operationScript,
  /\^AWS_ENDPOINT_URL\(\?:_\|\$\)/,
);
assert.match(operationScript, /AWS_CONFIG_FILE/);
assert.match(operationScript, /'\^\\s\*endpoint_url\\s\*=\'/);
assert.match(operationScript, /'\^\\s\*services\\s\*=/);
assert.match(operationScript, /'\^\\s\*source_profile\\s\*=/);
assert.match(operationScript, /AWS_IGNORE_CONFIGURED_ENDPOINT_URLS/);
assert.doesNotMatch(operationScript, /--endpoint-url\b/);
assert.match(operationScript, /'cloudformation', 'get-template'/);
assert.match(operationScript, /'--template-stage', 'Original'/);
assert.match(operationScript, /--expected-template \$ExpectedTemplatePath/);
assert.match(operationScript, /--get-template-response \$ResponsePath/);
assert.match(operationScript, /canonical-sha256=/);
assert.match(
  operationScript,
  /TenantLifecycleTaskRole = @\{ Type = 'AWS::IAM::Role'; Action = '(?:Add|Remove)' \}/,
);
assert.match(
  operationScript,
  /ServiceRoleBoundary = @\{ Type = 'AWS::IAM::ManagedPolicy'; Action = 'Modify' \}/,
);
assert.match(
  operationScript,
  /ProvisionerBoundary = @\{ Type = 'AWS::IAM::ManagedPolicy'; Action = 'Modify' \}/,
);
assert.doesNotMatch(operationScript, /cloudformation', 'deploy'/);
assert.doesNotMatch(operationScript, /cloudformation', '(?:create|update)-stack'/);
assert.ok(
  operationScript.indexOf("if ($Mode -in $writeModes)") <
    operationScript.indexOf("$awsCli = Resolve-AwsCli"),
  "write acknowledgements must be checked before the first AWS API call",
);
assert.ok(
  operationScript.indexOf("Assert-NoAwsEndpointOverrides") <
    operationScript.indexOf("$awsCli = Resolve-AwsCli") &&
    operationScript.indexOf("Assert-NoAwsEndpointOverrides") <
    operationScript.indexOf("'sts', 'get-caller-identity'"),
  "endpoint overrides must be rejected before the first AWS API call",
);
assert.ok(
  operationScript.indexOf("'cloudformation', 'create-change-set'") <
    operationScript.indexOf("'cloudformation', 'execute-change-set'"),
);
const exactTemplateAssertionIndex = operationScript.indexOf(
  "Assert-ExactChangeSetTemplate `",
  operationScript.indexOf("'cloudformation', 'describe-change-set'"),
);
const reviewedChangeSetAssertionIndex = operationScript.indexOf(
  "Assert-ReviewedChangeSet `",
  exactTemplateAssertionIndex,
);
const inspectBranchIndex = operationScript.indexOf(
  "if ($Mode -eq 'InspectChangeSet'",
);
assert.ok(
  exactTemplateAssertionIndex !== -1 &&
    exactTemplateAssertionIndex < reviewedChangeSetAssertionIndex &&
    reviewedChangeSetAssertionIndex < inspectBranchIndex,
  "Inspect and Execute must verify the exact Change Set TemplateBody and full change allowlist before proceeding",
);
assert.match(
  operationScript,
  /s3:\/\/\$receiptBucketName\/tenant-lifecycle\/v1\//,
);
assert.ok(
  operationScript.match(/--expected-bucket-owner', \$expectedAccountId/g).length >= 4,
  "every rollback inventory/deletion check must pin the expected bucket owner",
);
assert.match(operationScript, /'s3api', 'delete-objects'/);
assert.doesNotMatch(operationScript, /'s3', 'rm'/);
assert.match(
  operationScript,
  /applyRuntimeReady=false and cleanupRuntimeReady=false remain unchanged/,
);

const combinedText = `${templateSource}\n${operationScript}\n${rollbackSource}`;
for (const forbidden of [
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s/]+@/i,
  /sk_(?:live|test)_[A-Za-z0-9]{16,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
]) {
  assert.doesNotMatch(combinedText, forbidden);
}

console.log(
  "B5 low-cost receipt bucket, authority table, least-privilege roles, reviewed Change Set entry, and scoped rollback validation passed.",
);
