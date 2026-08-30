import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";

import {
  decodeDeployedJanitorSource,
  normalizeJanitorSourceLineEndings,
  renderBootstrapTemplate,
} from "./render-bootstrap.mjs";
import { renderB5SupportRollbackTemplate } from "./render-b5-support-rollback.mjs";
import { parseCloudFormationTemplateDocument } from "./cloudformation-template-document.mjs";
import {
  assertExactChangeSetTemplate,
  canonicalTemplateSha256,
} from "./verify-change-set-template.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const projectRoot = path.resolve(root, "..", "..");
const execFileAsync = promisify(execFile);
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
const templateVerifierPath = path.join(
  root,
  "scripts",
  "verify-change-set-template.mjs",
);
const sandboxConfigPath = path.join(root, "sandbox.example.json");
const janitorPath = path.join(root, "lambda", "janitor.cjs");
const deployedJanitorFixturePath = path.join(
  root,
  "lambda",
  "janitor.b5i-deployed.base64",
);
const packageJsonPath = path.join(projectRoot, "package.json");
const packageLockPath = path.join(projectRoot, "package-lock.json");
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
  janitorSource,
  deployedJanitorFixtureSource,
  packageJsonSource,
  packageLockSource,
  renderedSource,
  registrationGrantSource,
  rollbackSource,
] =
  await Promise.all([
    readFile(templatePath, "utf8"),
    readFile(operationScriptPath, "utf8"),
    readFile(oneShotContractPath, "utf8"),
    readFile(sandboxConfigPath, "utf8"),
    readFile(janitorPath, "utf8"),
    readFile(deployedJanitorFixturePath, "utf8"),
    readFile(packageJsonPath, "utf8"),
    readFile(packageLockPath, "utf8"),
    renderBootstrapTemplate(),
    renderBootstrapTemplate({ lifecycleTaskRegistrationGrant: true }),
    renderB5SupportRollbackTemplate(),
  ]);

const template = JSON.parse(templateSource);
const rendered = parseCloudFormationTemplateDocument(
  renderedSource,
  "Rendered B5 support template",
);
const registrationGrant = parseCloudFormationTemplateDocument(
  registrationGrantSource,
  "Rendered lifecycle TaskDefinition registration grant template",
);
const rollback = parseCloudFormationTemplateDocument(
  rollbackSource,
  "Rendered B5 support rollback template",
);
const sandboxConfig = JSON.parse(sandboxConfigSource);
const packageJson = JSON.parse(packageJsonSource);
const packageLock = JSON.parse(packageLockSource);
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
const lifecycleTaskRoleArn =
  "arn:aws:iam::402010193138:role/TechlongSandboxTenantLifecycleTaskRole";
const lifecycleTaskArn =
  "arn:aws:ecs:ca-central-1:402010193138:task/cell-sandbox-1/*";
const generationSecretArn =
  "arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/tenant/*/runtime/g*-??????";
const cellManagedMasterSecretArn =
  "arn:aws:secretsmanager:ca-central-1:402010193138:secret:rds!cluster-*";
const cellManagedMasterSecretCondition = {
  StringEquals: {
    "aws:RequestedRegion": "ca-central-1",
    "aws:ResourceTag/aws:secretsmanager:owningService": "rds",
    "aws:ResourceTag/aws:rds:primaryDBClusterArn":
      "arn:aws:rds:ca-central-1:402010193138:cluster:techlong-sandbox-cell-sandbox-1",
  },
};
const sandboxTaskRoleArns = [
  "arn:aws:iam::402010193138:role/TechlongSandboxTaskExecutionRole",
  "arn:aws:iam::402010193138:role/TechlongSandboxTenantLifecycleTaskRole",
];
const cloudFormationTaskRoleArns = [
  "arn:aws:iam::402010193138:role/TechlongSandboxTaskExecutionRole",
  "arn:aws:iam::402010193138:role/TechlongSandboxTaskRole",
];
const codeBuildImagePullActions = [
  "ecr:BatchGetImage",
  "ecr:GetDownloadUrlForLayer",
];
const codeBuildImageRepositoryActions = [
  "ecr:BatchCheckLayerAvailability",
  "ecr:BatchGetImage",
  "ecr:CompleteLayerUpload",
  "ecr:DescribeImages",
  "ecr:GetDownloadUrlForLayer",
  "ecr:InitiateLayerUpload",
  "ecr:PutImage",
  "ecr:UploadLayerPart",
];
const historicalCodeBuildImageRepositoryActions = [
  "ecr:BatchCheckLayerAvailability",
  "ecr:CompleteLayerUpload",
  "ecr:InitiateLayerUpload",
  "ecr:PutImage",
  "ecr:DescribeImages",
  "ecr:UploadLayerPart",
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
  "AllowLifecycleTaskDefinitionReadback",
  "AllowExactCellManagedMasterSecretRead",
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

function codeBuildImageRepositoryStatement(templateDocument) {
  const policy = templateDocument.Resources.CodeBuildRole.Properties.Policies.find(
    (candidate) => candidate.PolicyName === "BuildAndPushSandboxImageOnly",
  );
  assert.ok(policy, "exact CodeBuild image policy is missing");
  const statements = policy.PolicyDocument.Statement.filter((statement) =>
    isDeepStrictEqual(statement.Resource, {
      "Fn::GetAtt": ["SandboxEcrRepository", "Arn"],
    }),
  );
  assert.equal(
    statements.length,
    1,
    "CodeBuild must have one exact ECR repository statement",
  );
  return statements[0];
}

const deployedJanitorSource = decodeDeployedJanitorSource(
  deployedJanitorFixtureSource,
  janitorSource,
);
const deployedJanitorBytes = Buffer.from(deployedJanitorSource, "utf8");
assert.equal(deployedJanitorBytes.byteLength, 8_478);
assert.equal(
  createHash("sha256").update(deployedJanitorBytes).digest("hex"),
  "a5b6d0fd40c4bede585f89316853e0e274113d07f9f11647f7a2f54bf59d22f6",
);
const normalizedJanitorSource = normalizeJanitorSourceLineEndings(janitorSource);
assert.equal(
  normalizeJanitorSourceLineEndings(deployedJanitorSource),
  normalizedJanitorSource,
  "fixture and readable Janitor source must be identical after EOL normalization",
);
assert.equal(Buffer.byteLength(normalizedJanitorSource, "utf8"), 8_270);
assert.equal(
  createHash("sha256").update(normalizedJanitorSource, "utf8").digest("hex"),
  "3174f9e9073c07455d66c295e050ddb0ef6f9b3c1382dcf9d38c997df64640d6",
  "the LF-normalized readable Janitor source must remain Git-blob stable",
);
const allCrLfJanitorSource = normalizedJanitorSource.replace(/\n/g, "\r\n");
assert.equal(
  decodeDeployedJanitorSource(
    deployedJanitorFixtureSource,
    normalizedJanitorSource,
  ),
  deployedJanitorSource,
  "LF checkout must reconstruct the deployed Janitor bytes",
);
assert.equal(
  decodeDeployedJanitorSource(
    deployedJanitorFixtureSource,
    allCrLfJanitorSource,
  ),
  deployedJanitorSource,
  "CRLF checkout must reconstruct the deployed Janitor bytes",
);
for (const executableSource of [
  deployedJanitorSource,
  normalizedJanitorSource,
  allCrLfJanitorSource,
]) {
  assert.doesNotThrow(
    () => new Function("module", "exports", "require", executableSource),
    "deployed, LF, and CRLF Janitor forms must compile equivalently",
  );
}

const expectedRendered = structuredClone(template);
expectedRendered.Resources.JanitorFunction.Properties.Code.ZipFile =
  deployedJanitorSource;
assert.deepEqual(
  rendered,
  expectedRendered,
  "YAML rendering may only replace the Janitor marker with exact source bytes",
);
assert.equal(
  rendered.Resources.JanitorFunction.Properties.Code.ZipFile,
  deployedJanitorSource,
  "rendered Janitor ZipFile must preserve the deployed B5-I source exactly",
);
assert.deepEqual(
  actionList(codeBuildImageRepositoryStatement(rendered)),
  codeBuildImageRepositoryActions,
  "CodeBuild exact repository policy must include the reviewed build/push/pull actions",
);

// The next registration window is based on the current template and may only
// add the exact lifecycle PassRole ARN.
const expectedRegistrationGrant = structuredClone(rendered);
const expectedRegistrationPassRole = statementBySid(
  expectedRegistrationGrant.Resources.ExecutionRoleBoundary.Properties
    .PolicyDocument,
  "AllowPassOnlySandboxTaskRolesToEcs",
);
expectedRegistrationPassRole.Resource.push(lifecycleTaskRoleArn);
assert.deepEqual(
  registrationGrant,
  expectedRegistrationGrant,
  "registration grant renderer may only add the exact lifecycle PassRole ARN",
);

// Reconstruct the exact deployed final revoke before the CodeBuild image-pull
// increment, then the historical one-resource registration grant before it.
const deployedLifecycleRegistrationRevoke = structuredClone(rendered);
const deployedCodeBuildRepository = codeBuildImageRepositoryStatement(
  deployedLifecycleRegistrationRevoke,
);
assert.deepEqual(
  actionList(deployedCodeBuildRepository).filter((action) =>
    codeBuildImagePullActions.includes(action),
  ),
  codeBuildImagePullActions,
);
deployedCodeBuildRepository.Action = historicalCodeBuildImageRepositoryActions;
assert.equal(
  canonicalTemplateSha256(deployedLifecycleRegistrationRevoke),
  "112d1b47807962b2ae3e3d751c2b6d2d9cb48c1660f2aa75d24991ebf9cbdf14",
  "the reconstructed final registration revoke must match the executed Change Set",
);
const deployedLifecycleTaskRegistration = structuredClone(
  deployedLifecycleRegistrationRevoke,
);
const deployedLifecycleRegistrationPassRole = statementBySid(
  deployedLifecycleTaskRegistration.Resources.ExecutionRoleBoundary.Properties
    .PolicyDocument,
  "AllowPassOnlySandboxTaskRolesToEcs",
);
deployedLifecycleRegistrationPassRole.Resource.push(lifecycleTaskRoleArn);
assert.equal(
  canonicalTemplateSha256(deployedLifecycleTaskRegistration),
  "826a968ecfdfff10d32e50a9689af079f9920892f605568e86bc80f6876ece72",
  "the reconstructed LifecycleTaskRegistration template must match the executed Change Set",
);

// Reconstruct the exact deployed B5-J2 LifecycleReadback baseline before the
// one-resource LifecycleTaskRegistration IAM increment.
const deployedLifecycleReadback = structuredClone(
  deployedLifecycleTaskRegistration,
);
delete deployedLifecycleReadback.Metadata.SafetyBoundary.RegistrationReady;
delete deployedLifecycleReadback.Metadata.SafetyBoundary.LiveReadbackReady;
const deployedExecutionPassRole = statementBySid(
  deployedLifecycleReadback.Resources.ExecutionRoleBoundary.Properties
    .PolicyDocument,
  "AllowPassOnlySandboxTaskRolesToEcs",
);
deployedExecutionPassRole.Resource = deployedExecutionPassRole.Resource.filter(
  (resource) => resource !== lifecycleTaskRoleArn,
);
const deployedExecutionCleanup = statementBySid(
  deployedLifecycleReadback.Resources.ExecutionRoleBoundary.Properties
    .PolicyDocument,
  "AllowTenantTaskDefinitionCleanup",
);
deployedExecutionCleanup.Resource =
  "arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-*:*";
delete deployedExecutionCleanup.Condition;
statementBySid(
  deployedLifecycleReadback.Resources.ExecutionRoleBoundary.Properties
    .PolicyDocument,
  "AllowTaggedTaskDefinitionRegistration",
).Resource = "*";
assert.equal(
  canonicalTemplateSha256(deployedLifecycleReadback),
  "1fe4af4b94a198437511a147fe05685eefb768304e3ab487ca06722657c2223b",
  "the reconstructed LifecycleReadback template must match the executed Change Set",
);

// The executed B5-I Change Set was produced by the former minified-JSON
// renderer with this exact raw Janitor source. Rebuilding that historical
// template protects the pre- and post-LifecycleReadback rollback baselines.
const deployedB5Initial = structuredClone(deployedLifecycleReadback);
deployedB5Initial.Resources.ServiceRoleBoundary.Properties.PolicyDocument.Statement =
  deployedB5Initial.Resources.ServiceRoleBoundary.Properties.PolicyDocument.Statement.filter(
    (statement) =>
      ![
        "AllowLifecycleTaskDefinitionReadback",
        "AllowExactCellManagedMasterSecretRead",
      ].includes(statement.Sid),
  );
deployedB5Initial.Resources.TenantLifecycleTaskRole.Properties.Policies[0].PolicyDocument.Statement =
  deployedB5Initial.Resources.TenantLifecycleTaskRole.Properties.Policies[0].PolicyDocument.Statement.filter(
    (statement) => statement.Sid !== "ReadExactCellManagedMasterSecret",
  );
statementBySid(
  deployedB5Initial.Resources.TenantLifecycleTaskRole.Properties.Policies[0]
    .PolicyDocument,
  "ReadGenerationOwnedRuntimeSecret",
).Action = [
  "secretsmanager:DescribeSecret",
  "secretsmanager:GetSecretValue",
];
deployedB5Initial.Resources.DeploymentWorkerRole.Properties.Policies[0].PolicyDocument.Statement =
  deployedB5Initial.Resources.DeploymentWorkerRole.Properties.Policies[0].PolicyDocument.Statement.filter(
    (statement) => statement.Sid !== "ReadLifecycleTaskDefinition",
  );
const deployedSharedCellRead = statementBySid(
  deployedB5Initial.Resources.ProvisionerBoundary.Properties.PolicyDocument,
  "AllowSharedCellReadOnlyPreflight",
);
deployedSharedCellRead.Action = actionList(deployedSharedCellRead).filter(
  (action) => action !== "ecs:DescribeTaskDefinition",
);
const deployedB5InitialSource = `${JSON.stringify(deployedB5Initial)}\n`;
assert.equal(Buffer.byteLength(deployedB5InitialSource, "utf8"), 49_837);
const deployedB5InitialSha256 = createHash("sha256")
  .update(deployedB5InitialSource, "utf8")
  .digest("hex");
assert.equal(
  deployedB5InitialSha256,
  "1fb78e3a91ede382702792f2521f935aa690670ead7e05dc89a57cec0d0b0145",
  "the reconstructed raw-source B5-I template must match the executed Change Set",
);
assert.equal(
  `techlong-s3-b5-support-${deployedB5InitialSha256.slice(0, 16)}`,
  "techlong-s3-b5-support-1fb78e3a91ede382",
);
function changedResourceIds(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((logicalId) => !isDeepStrictEqual(before[logicalId], after[logicalId]))
    .sort();
}

const lifecycleReadbackResourceChanges = [
  "DeploymentWorkerRole",
  "ProvisionerBoundary",
  "ServiceRoleBoundary",
  "TenantLifecycleTaskRole",
];
assert.deepEqual(
  changedResourceIds(
    deployedB5Initial.Resources,
    deployedLifecycleReadback.Resources,
  ),
  lifecycleReadbackResourceChanges,
  "LifecycleReadback must change exactly four IAM resources from deployed B5-I",
);
assert.deepEqual(
  changedResourceIds(
    deployedLifecycleReadback.Resources,
    deployedLifecycleTaskRegistration.Resources,
  ),
  ["ExecutionRoleBoundary"],
  "LifecycleTaskRegistration must change only ExecutionRoleBoundary",
);
assert.deepEqual(
  changedResourceIds(
    deployedLifecycleTaskRegistration.Resources,
    deployedLifecycleRegistrationRevoke.Resources,
  ),
  ["ExecutionRoleBoundary"],
  "LifecycleTaskRegistrationRevoke must change only ExecutionRoleBoundary",
);
assert.deepEqual(
  changedResourceIds(
    deployedLifecycleRegistrationRevoke.Resources,
    rendered.Resources,
  ),
  ["CodeBuildRole"],
  "CodeBuildImagePull must change only CodeBuildRole",
);
assert.deepEqual(
  changedResourceIds(rendered.Resources, registrationGrant.Resources),
  ["ExecutionRoleBoundary"],
  "the next registration grant must change only ExecutionRoleBoundary",
);
const expectedRevokedExecutionBoundary = structuredClone(
  deployedLifecycleTaskRegistration.Resources.ExecutionRoleBoundary,
);
statementBySid(
  expectedRevokedExecutionBoundary.Properties.PolicyDocument,
  "AllowPassOnlySandboxTaskRolesToEcs",
).Resource = cloudFormationTaskRoleArns;
assert.deepEqual(
  deployedLifecycleRegistrationRevoke.Resources.ExecutionRoleBoundary,
  expectedRevokedExecutionBoundary,
  "LifecycleTaskRegistrationRevoke may only remove the exact lifecycle PassRole ARN",
);
const rollbackResourceChanges = [
  "DeploymentWorkerRole",
  "ProvisionerBoundary",
  "ServiceRoleBoundary",
  "TenantExternalEpochAuthorityTable",
  "TenantLifecycleReceiptBucket",
  "TenantLifecycleReceiptBucketPolicy",
  "TenantLifecycleTaskRole",
];
assert.deepEqual(
  changedResourceIds(deployedB5Initial.Resources, rollback.Resources),
  ["CodeBuildRole", "ExecutionRoleBoundary", ...rollbackResourceChanges].sort(),
  "historical B5-I to rollback must retain the later execution-boundary hardening",
);
assert.deepEqual(
  changedResourceIds(deployedLifecycleReadback.Resources, rollback.Resources),
  ["CodeBuildRole", "ExecutionRoleBoundary", ...rollbackResourceChanges].sort(),
  "historical LifecycleReadback to rollback must retain the later execution-boundary hardening",
);
assert.deepEqual(
  changedResourceIds(
    deployedLifecycleTaskRegistration.Resources,
    rollback.Resources,
  ),
  ["CodeBuildRole", "ExecutionRoleBoundary", ...rollbackResourceChanges].sort(),
  "rollback from the temporary registration grant must also reflect its final revocation",
);
assert.deepEqual(
  changedResourceIds(
    deployedLifecycleRegistrationRevoke.Resources,
    rollback.Resources,
  ),
  ["CodeBuildRole", ...rollbackResourceChanges].sort(),
  "rollback from the historical final revoke must retain CodeBuild image-pull readback",
);
assert.deepEqual(
  changedResourceIds(rendered.Resources, rollback.Resources),
  rollbackResourceChanges,
  "rollback from the final revoked template must change exactly seven B5 resources",
);

assert.equal(template.Metadata.SafetyBoundary.CreatesB5SupportResources, true);
assert.equal(template.Metadata.SafetyBoundary.RegistrationReady, false);
assert.equal(template.Metadata.SafetyBoundary.LiveReadbackReady, false);
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
assert.equal(packageJson.devDependencies["js-yaml"], "4.1.1");
assert.equal(
  packageLock.packages[""].devDependencies["js-yaml"],
  "4.1.1",
);
assert.equal(packageLock.packages["node_modules/js-yaml"].version, "4.1.1");

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
assert.equal(rollback.Metadata.SafetyBoundary.RegistrationReady, false);
assert.equal(rollback.Metadata.SafetyBoundary.LiveReadbackReady, false);
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
assert.deepEqual(
  rollback.Resources.ExecutionRoleBoundary,
  rendered.Resources.ExecutionRoleBoundary,
  "rollback must retain the final revoked and hardened CloudFormation execution boundary",
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
const boundaryTaskDefinitionRead = statementBySid(
  serviceBoundary,
  "AllowLifecycleTaskDefinitionReadback",
);
assert.deepEqual(actionList(boundaryTaskDefinitionRead), [
  "ecs:DescribeTaskDefinition",
]);
assert.equal(boundaryTaskDefinitionRead.Resource, "*");
assert.deepEqual(boundaryTaskDefinitionRead.Condition, {
  StringEquals: { "aws:RequestedRegion": "ca-central-1" },
});
const boundaryCellManagedSecretRead = statementBySid(
  serviceBoundary,
  "AllowExactCellManagedMasterSecretRead",
);
assert.deepEqual(actionList(boundaryCellManagedSecretRead), [
  "secretsmanager:GetSecretValue",
]);
assert.equal(boundaryCellManagedSecretRead.Resource, cellManagedMasterSecretArn);
assert.deepEqual(
  boundaryCellManagedSecretRead.Condition,
  cellManagedMasterSecretCondition,
);
assert.equal(
  JSON.stringify(serviceBoundary).includes("arn:aws:s3:::techlong-sandbox-*"),
  false,
);
assert.ok(Buffer.byteLength(JSON.stringify(serviceBoundary), "utf8") <= 6_144);

const executionBoundary =
  resources.ExecutionRoleBoundary.Properties.PolicyDocument;
const executionTaskDefinitionRegistration = statementBySid(
  executionBoundary,
  "AllowTaggedTaskDefinitionRegistration",
);
assert.deepEqual(actionList(executionTaskDefinitionRegistration), [
  "ecs:RegisterTaskDefinition",
]);
assert.equal(
  executionTaskDefinitionRegistration.Resource,
  "arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-*:*",
);
assert.deepEqual(executionTaskDefinitionRegistration.Condition.StringEquals, {
  "aws:RequestedRegion": "ca-central-1",
  "aws:RequestTag/Environment": "aws-sandbox",
  "aws:RequestTag/ManagedBy": "techlong-provisioner",
});
const executionPassRole = statementBySid(
  executionBoundary,
  "AllowPassOnlySandboxTaskRolesToEcs",
);
assert.deepEqual(actionList(executionPassRole), ["iam:PassRole"]);
assert.deepEqual(executionPassRole.Resource, cloudFormationTaskRoleArns);
assert.deepEqual(executionPassRole.Condition, {
  StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" },
});
const executionTaskDefinitionCleanup = statementBySid(
  executionBoundary,
  "AllowTenantTaskDefinitionCleanup",
);
assert.deepEqual(actionList(executionTaskDefinitionCleanup).sort(), [
  "ecs:DeregisterTaskDefinition",
  "ecs:DescribeTaskDefinition",
]);
assert.equal(executionTaskDefinitionCleanup.Resource, "*");
assert.deepEqual(executionTaskDefinitionCleanup.Condition, {
  StringEquals: { "aws:RequestedRegion": "ca-central-1" },
});
assert.equal(
  executionBoundary.Statement.flatMap(actionList).includes("ecs:RunTask"),
  false,
  "CloudFormation execution role may register but never run lifecycle tasks",
);
const cloudFormationExecutionRole =
  resources.CloudFormationExecutionRole.Properties;
assert.deepEqual(cloudFormationExecutionRole.PermissionsBoundary, {
  Ref: "ExecutionRoleBoundary",
});
assert.deepEqual(cloudFormationExecutionRole.ManagedPolicyArns, [
  { Ref: "ExecutionRoleBoundary" },
]);

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
assert.equal(lifecycleStatements.length, 4);
assert.deepEqual(lifecycleStatements.flatMap(actionList).sort(), [
  "s3:GetObject",
  "s3:PutObject",
  "secretsmanager:GetSecretValue",
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
const lifecycleSecretRead = statementBySid(
  lifecyclePolicy.PolicyDocument,
  "ReadGenerationOwnedRuntimeSecret",
);
assert.deepEqual(actionList(lifecycleSecretRead), [
  "secretsmanager:GetSecretValue",
]);
assert.equal(lifecycleSecretRead.Resource, generationSecretArn);
assert.deepEqual(lifecycleSecretRead.Condition.StringEquals, {
  "aws:RequestedRegion": "ca-central-1",
  "aws:ResourceTag/ManagedBy": "techlong-deployment-worker",
  "aws:ResourceTag/SecretSchema": "techlong-runtime-five-key-v1",
});
const lifecycleCellManagedSecretRead = statementBySid(
  lifecyclePolicy.PolicyDocument,
  "ReadExactCellManagedMasterSecret",
);
assert.deepEqual(actionList(lifecycleCellManagedSecretRead), [
  "secretsmanager:GetSecretValue",
]);
assert.equal(
  lifecycleCellManagedSecretRead.Resource,
  cellManagedMasterSecretArn,
);
assert.deepEqual(
  lifecycleCellManagedSecretRead.Condition,
  cellManagedMasterSecretCondition,
);
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
    "ecs:DescribeTaskDefinition",
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
const workerTaskDefinitionRead = statementBySid(
  workerRole.Policies[0].PolicyDocument,
  "ReadLifecycleTaskDefinition",
);
assert.deepEqual(actionList(workerTaskDefinitionRead), [
  "ecs:DescribeTaskDefinition",
]);
assert.equal(workerTaskDefinitionRead.Resource, "*");
assert.deepEqual(workerTaskDefinitionRead.Condition, {
  StringEquals: { "aws:RequestedRegion": "ca-central-1" },
});
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
  [
    "AuthorizeExactRunTaskTags",
    "ReadLifecycleTaskDefinition",
    "RecoverOnlyExactCellTasks",
  ],
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
    "ecs:DescribeTaskDefinition",
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
const provisionerRole = resources.ProvisionerRole.Properties;
assert.deepEqual(provisionerRole.PermissionsBoundary, {
  Ref: "ProvisionerBoundary",
});
assert.deepEqual(provisionerRole.ManagedPolicyArns, [
  { Ref: "ProvisionerBoundary" },
]);
assert.ok(
  Buffer.byteLength(JSON.stringify(provisionerBoundary), "utf8") <= 6_144,
);

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
assert.ok(Buffer.byteLength(renderedSource, "utf8") <= 50_000);
assert.ok(Buffer.byteLength(registrationGrantSource, "utf8") <= 50_000);
assert.ok(Buffer.byteLength(rollbackSource, "utf8") <= 50_000);
assert.match(
  renderedSource,
  /^AWSTemplateFormatVersion: '2010-09-09'\r?\n/,
  "YAML must use a block root and quote the date-like format version",
);
assert.ok(
  renderedSource.includes(
    "'arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/tenant/*/runtime/g*-??????'",
  ),
  "CloudFormation flow scalars containing question marks must be quoted",
);
assert.equal(renderedSource.includes("__JANITOR_INLINE_SOURCE__"), false);
assert.equal(rollbackSource.includes("__JANITOR_INLINE_SOURCE__"), false);
const renderedCanonicalHash = canonicalTemplateSha256(rendered);
const registrationGrantCanonicalHash =
  canonicalTemplateSha256(registrationGrant);
const rollbackCanonicalHash = canonicalTemplateSha256(rollback);
const renderedRawHash = createHash("sha256").update(renderedSource).digest("hex");
const registrationGrantRawHash = createHash("sha256")
  .update(registrationGrantSource)
  .digest("hex");
const rollbackRawHash = createHash("sha256").update(rollbackSource).digest("hex");
assert.equal(Buffer.byteLength(renderedSource, "utf8"), 49_262);
assert.equal(
  renderedRawHash,
  "68a34349f703dd5269058a2447bd3d7b4bcc1453225c00b8aca1f8cd8a51bf69",
);
assert.equal(
  renderedCanonicalHash,
  "211e46d35a957aff766b2240284012500d5afee14cd1c4c55c9c9be3a0dcc2ee",
);
assert.equal(Buffer.byteLength(registrationGrantSource, "utf8"), 49_333);
assert.equal(
  registrationGrantRawHash,
  "a24567a02879a2be3194d6be00db8bb8627beded207553a79c245f851518bc22",
);
assert.equal(
  registrationGrantCanonicalHash,
  "a61c6c3f7b870199d4020a732c613c7c43ca72d84e3a1eec58d3194b8e6d67b8",
);
assert.equal(Buffer.byteLength(rollbackSource, "utf8"), 33_378);
assert.equal(
  rollbackRawHash,
  "b3a47f4a2a90b68e4cc5da7e7d188197ef1aeb04d877abe8a9e6a52fdd1cd8d9",
);
assert.equal(
  rollbackCanonicalHash,
  "11229dd7d17b081cdd5b2755bb86d7d7b27ba0809fe61b465ad8529718d4888b",
);
assert.equal(canonicalTemplateSha256(renderedSource), renderedCanonicalHash);
assert.equal(
  assertExactChangeSetTemplate(renderedSource, {
    TemplateBody: renderedSource,
  }),
  renderedCanonicalHash,
);
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
const cliHashDirectory = await mkdtemp(
  path.join(tmpdir(), "techlong-b5-yaml-hash-"),
);
try {
  const forwardPath = path.join(cliHashDirectory, "forward.yaml");
  const rollbackPath = path.join(cliHashDirectory, "rollback.yaml");
  const forwardResponsePath = path.join(
    cliHashDirectory,
    "forward-get-template.json",
  );
  const rollbackResponsePath = path.join(
    cliHashDirectory,
    "rollback-get-template.json",
  );
  await Promise.all([
    writeFile(forwardPath, renderedSource, "utf8"),
    writeFile(rollbackPath, rollbackSource, "utf8"),
    writeFile(
      forwardResponsePath,
      JSON.stringify({ TemplateBody: renderedSource }),
      "utf8",
    ),
    writeFile(
      rollbackResponsePath,
      JSON.stringify({ TemplateBody: rollbackSource }),
      "utf8",
    ),
  ]);
  const [
    forwardCliHash,
    rollbackCliHash,
    forwardCliVerification,
    rollbackCliVerification,
  ] = await Promise.all([
    execFileAsync(
      process.execPath,
      [templateVerifierPath, "--hash-template", forwardPath],
      { encoding: "utf8", windowsHide: true },
    ),
    execFileAsync(
      process.execPath,
      [templateVerifierPath, "--hash-template", rollbackPath],
      { encoding: "utf8", windowsHide: true },
    ),
    execFileAsync(
      process.execPath,
      [
        templateVerifierPath,
        "--expected-template",
        forwardPath,
        "--get-template-response",
        forwardResponsePath,
      ],
      { encoding: "utf8", windowsHide: true },
    ),
    execFileAsync(
      process.execPath,
      [
        templateVerifierPath,
        "--expected-template",
        rollbackPath,
        "--get-template-response",
        rollbackResponsePath,
      ],
      { encoding: "utf8", windowsHide: true },
    ),
  ]);
  assert.equal(forwardCliHash.stdout.trim(), renderedCanonicalHash);
  assert.equal(rollbackCliHash.stdout.trim(), rollbackCanonicalHash);
  assert.equal(forwardCliVerification.stdout.trim(), renderedCanonicalHash);
  assert.equal(rollbackCliVerification.stdout.trim(), rollbackCanonicalHash);
} finally {
  await rm(cliHashDirectory, { recursive: true, force: true });
}
assert.throws(
  () =>
    parseCloudFormationTemplateDocument(
      "{AWSTemplateFormatVersion: '2010-09-09', Resources: {}, Resources: {}}",
      "Duplicate-key template",
    ),
  /strict JSON-or-YAML/,
);
assert.throws(
  () =>
    parseCloudFormationTemplateDocument(
      "{Resources: &resources {}, Outputs: *resources}",
      "Aliased template",
    ),
  /anchors or aliases/,
);
assert.throws(
  () =>
    parseCloudFormationTemplateDocument(
      "{Metadata: {BuiltAt: !!timestamp 2026-08-24T00:00:00Z}, Resources: {}}",
      "Extra-type template",
    ),
  /strict JSON-or-YAML/,
);
assert.throws(
  () => parseCloudFormationTemplateDocument("[Resources, {}]", "Array template"),
  /template object/,
);

function parseReviewedChangeShape(variableName) {
  const blockMatch = operationScript.match(
    new RegExp(`\\$${variableName} = @\\{\\r?\\n([\\s\\S]*?)\\r?\\n  \\}`),
  );
  assert.ok(blockMatch, `missing reviewed Change Set shape ${variableName}`);
  const entryPattern =
    /^    ([A-Za-z][A-Za-z0-9]*) = @\{ Type = '([^']+)'; Action = '(Add|Modify|Remove)' \}\r?$/gm;
  const entries = [...blockMatch[1].matchAll(entryPattern)];
  assert.equal(
    blockMatch[1].replace(entryPattern, "").trim(),
    "",
    `${variableName} must contain only exact resource/type/action entries`,
  );
  const parsed = Object.fromEntries(
    entries.map(([, logicalId, type, action]) => [logicalId, { type, action }]),
  );
  assert.equal(
    Object.keys(parsed).length,
    entries.length,
    `${variableName} may not contain duplicate logical IDs`,
  );
  return parsed;
}

assert.deepEqual(parseReviewedChangeShape("requiredInitialB5SupportChanges"), {
  GlobalJanitorSchedule: { type: "AWS::Scheduler::Schedule", action: "Modify" },
  JanitorFunction: { type: "AWS::Lambda::Function", action: "Modify" },
  SchedulerInvokeRole: { type: "AWS::IAM::Role", action: "Modify" },
  ServiceRoleBoundary: { type: "AWS::IAM::ManagedPolicy", action: "Modify" },
  TaskRole: { type: "AWS::IAM::Role", action: "Modify" },
  ProvisionerBoundary: { type: "AWS::IAM::ManagedPolicy", action: "Modify" },
  TenantLifecycleReceiptBucket: { type: "AWS::S3::Bucket", action: "Add" },
  TenantLifecycleReceiptBucketPolicy: {
    type: "AWS::S3::BucketPolicy",
    action: "Add",
  },
  TenantExternalEpochAuthorityTable: {
    type: "AWS::DynamoDB::Table",
    action: "Add",
  },
  TenantLifecycleTaskRole: { type: "AWS::IAM::Role", action: "Add" },
  DeploymentWorkerRole: { type: "AWS::IAM::Role", action: "Add" },
});
assert.deepEqual(parseReviewedChangeShape("requiredLifecycleReadbackChanges"), {
  ServiceRoleBoundary: { type: "AWS::IAM::ManagedPolicy", action: "Modify" },
  ProvisionerBoundary: { type: "AWS::IAM::ManagedPolicy", action: "Modify" },
  TenantLifecycleTaskRole: { type: "AWS::IAM::Role", action: "Modify" },
  DeploymentWorkerRole: { type: "AWS::IAM::Role", action: "Modify" },
});
assert.deepEqual(parseReviewedChangeShape("requiredCodeBuildImagePullChanges"), {
  CodeBuildRole: { type: "AWS::IAM::Role", action: "Modify" },
});
assert.deepEqual(
  parseReviewedChangeShape("requiredLifecycleTaskRegistrationGrantChanges"),
  {
    ExecutionRoleBoundary: {
      type: "AWS::IAM::ManagedPolicy",
      action: "Modify",
    },
  },
);
assert.deepEqual(
  parseReviewedChangeShape("requiredLifecycleTaskRegistrationRevokeChanges"),
  {
    ExecutionRoleBoundary: {
      type: "AWS::IAM::ManagedPolicy",
      action: "Modify",
    },
  },
);
assert.deepEqual(parseReviewedChangeShape("requiredRollbackChanges"), {
  ServiceRoleBoundary: { type: "AWS::IAM::ManagedPolicy", action: "Modify" },
  ProvisionerBoundary: { type: "AWS::IAM::ManagedPolicy", action: "Modify" },
  TenantLifecycleReceiptBucket: { type: "AWS::S3::Bucket", action: "Remove" },
  TenantLifecycleReceiptBucketPolicy: {
    type: "AWS::S3::BucketPolicy",
    action: "Remove",
  },
  TenantExternalEpochAuthorityTable: {
    type: "AWS::DynamoDB::Table",
    action: "Remove",
  },
  TenantLifecycleTaskRole: { type: "AWS::IAM::Role", action: "Remove" },
  DeploymentWorkerRole: { type: "AWS::IAM::Role", action: "Remove" },
});

assert.match(
  operationScript,
  /\[ValidateSet\([\s\S]*?'CreateChangeSet'[\s\S]*?'InspectChangeSet'[\s\S]*?'ExecuteChangeSet'[\s\S]*?'CreateRollbackChangeSet'[\s\S]*?'InspectRollbackChangeSet'[\s\S]*?'ExecuteRollbackChangeSet'/,
);
assert.match(operationScript, /\[string\]\$Mode = 'LocalValidate'/);
assert.match(
  operationScript,
  /\[ValidateSet\([\s\S]*?'InitialB5Support'[\s\S]*?'CodeBuildImagePull'[\s\S]*?'LifecycleReadback'[\s\S]*?'LifecycleTaskRegistrationGrant'[\s\S]*?'LifecycleTaskRegistrationRevoke'[\s\S]*?\)\]\s*\[string\]\$UpdateShape = 'InitialB5Support'/,
);
assert.match(
  operationScript,
  /\$reviewedUpdateShape = if \(\$UpdateShape -ieq 'CodeBuildImagePull'\) \{\s*'CodeBuildImagePull'/,
);
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
assert.equal(
  operationScript.match(/techlong-s3-b5-support[^"\r\n]*\.yaml/g)?.length,
  2,
  "forward and rollback Change Set templates must use explicit YAML files",
);
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
assert.match(
  operationScript,
  /if \(\$Mode -in \$rollbackModes -and \$reviewedUpdateShape -ne 'InitialB5Support'\)/,
);
assert.match(
  operationScript,
  /Rollback modes only support -UpdateShape InitialB5Support; incremental IAM update shapes have no standalone rollback shape/,
);
assert.match(
  operationScript,
  /if \(\$UpdateShape -ne 'InitialB5Support'\)[\s\S]*?Rollback Change Sets are only reviewed against the InitialB5Support shape/,
);
assert.match(
  operationScript,
  /elseif \(\$UpdateShape -eq 'LifecycleTaskRegistrationGrant'\) \{\s*\$requiredLifecycleTaskRegistrationGrantChanges\s*\} elseif \(\$UpdateShape -eq 'LifecycleTaskRegistrationRevoke'\) \{\s*\$requiredLifecycleTaskRegistrationRevokeChanges\s*\} elseif \(\$UpdateShape -eq 'CodeBuildImagePull'\) \{\s*\$requiredCodeBuildImagePullChanges\s*\} elseif \(\$UpdateShape -eq 'LifecycleReadback'\) \{\s*\$requiredLifecycleReadbackChanges\s*\} else \{\s*\$requiredInitialB5SupportChanges/,
);
assert.match(
  operationScript,
  /\$resource\.Replacement -in @\('True', 'Conditional'\)/,
);
assert.match(operationScript, /Change Set contains an unapproved resource change/);
assert.match(operationScript, /Change Set contains a duplicate resource change/);
assert.match(operationScript, /Change Set is missing the required/);
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
assert.match(operationScript, /--lifecycle-task-registration-grant/);
assert.match(
  operationScript,
  /\$updateShapeToken = if \(\$reviewedUpdateShape -eq 'CodeBuildImagePull'\) \{\s*'codebuild-image-pull'\s*\} elseif \(\$reviewedUpdateShape -eq 'LifecycleReadback'\) \{\s*'lifecycle-readback'\s*\} elseif \(\$reviewedUpdateShape -eq 'LifecycleTaskRegistrationGrant'\) \{\s*'lifecycle-task-registration-grant'\s*\} elseif \(\$reviewedUpdateShape -eq 'LifecycleTaskRegistrationRevoke'\) \{\s*'lifecycle-task-registration-revoke'\s*\} else \{\s*'initial'\s*\}/,
);
assert.match(
  operationScript,
  /\$changeSetName = "techlong-s3-b5-support-\$updateShapeToken-\$\(\$templateHash\.Substring\(0, 16\)\)"/,
);
assert.match(
  operationScript,
  /\$changeSetDescription = "B5 support update; update-shape=\$reviewedUpdateShape; template-sha256=\$templateHash; canonical-sha256=\$templateCanonicalHash"/,
);
assert.match(
  operationScript,
  /\$rollbackChangeSetName = "techlong-s3-b5-support-rollback-initial-/,
);
assert.match(
  operationScript,
  /\$rollbackDescription = "B5 support rollback; update-shape=InitialB5Support;/,
);
assert.equal(
  operationScript.match(
    /\$selectedName = if \(\$isRollback\) \{ \$rollbackChangeSetName \} else \{ \$changeSetName \}/g,
  )?.length,
  2,
  "Create and Inspect/Execute must select the same shape-bound Change Set name",
);
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
const rollbackShapeGuardIndex = operationScript.indexOf(
  "if ($Mode -in $rollbackModes",
);
const localValidationIndex = operationScript.indexOf(
  "Write-Host 'Running local B5 support resource and deployment-entry validation...'",
);
assert.ok(
  rollbackShapeGuardIndex !== -1 &&
    rollbackShapeGuardIndex < localValidationIndex &&
    localValidationIndex < operationScript.indexOf("$awsCli = Resolve-AwsCli"),
  "rollback shape rejection and LocalValidate must happen before the first AWS API call",
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
assert.match(
  operationScript.slice(reviewedChangeSetAssertionIndex, inspectBranchIndex),
  /-UpdateShape \$reviewedUpdateShape/,
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
