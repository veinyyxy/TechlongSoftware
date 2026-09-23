import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  approvedSharedCellResourceTypes,
  lifecycleManagementShapes,
  renderB5CellLifecycleManagementTemplate,
} from "./render-b5-cell-lifecycle-management.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const templatePath = path.join(
  root,
  "cloudformation",
  "s3-b5-cell-lifecycle-management.template.json",
);
const operationPath = path.join(
  scriptDirectory,
  "s3-b5-cell-lifecycle-management.ps1",
);
const sha256 = "0123456789abcdef".repeat(4);
const canonicalSha256 = "fedcba9876543210".repeat(4);
const changeSetName = `techlong-sandbox-cell-sandbox-1-${sha256.slice(0, 16)}`;
const cellExpiresAt = "2026-09-08T12:00:00.000Z";
const grantReviewedAt = "2026-09-07T11:30:00.000Z";
const grantExpiresAt = "2026-09-07T12:00:00.000Z";
const approvedStackId =
  "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/12345678-1234-1234-1234-123456789abc";
const approvedChangeSetArn =
  `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${changeSetName}/87654321-4321-4321-4321-cba987654321`;
const approvedCompensationPlanSha256 = "b".repeat(64);
const compensationReviewedAt = "2026-09-07T13:00:00.000Z";
const compensationExpiresAt = "2026-09-07T13:30:00.000Z";
const compensationDeleteChangeSetCutoff = "2026-09-07T13:20:00.000Z";
const compensationDeleteStackCutoff = "2026-09-07T13:25:00.000Z";
const templateUrl =
  `https://techlong-sandbox-build-source-402010193138-ca-central-1.s3.ca-central-1.amazonaws.com/b5-shared-cell/templates/sha256/${sha256}.json`;
const templateObjectArn =
  `arn:aws:s3:::techlong-sandbox-build-source-402010193138-ca-central-1/b5-shared-cell/templates/sha256/${sha256}.json`;

function actions(statement) {
  return Array.isArray(statement.Action) ? statement.Action : [statement.Action];
}

function allowedActions(template, logicalId) {
  return new Set(
    template.Resources[logicalId].Properties.PolicyDocument.Statement
      .filter((statement) => statement.Effect === "Allow")
      .flatMap(actions),
  );
}

function statementBySid(template, logicalId, sid) {
  const statement = template.Resources[logicalId].Properties.PolicyDocument.Statement
    .find((candidate) => candidate.Sid === sid);
  assert.ok(statement, `${logicalId} lacks ${sid}`);
  return statement;
}

function policyCharacters(document) {
  return JSON.stringify(document).replace(/\s/g, "").length;
}

function assertTemporaryStatementsExpire(
  statements,
  label,
  expiresAt = grantExpiresAt,
) {
  for (const statement of statements) {
    assert.deepEqual(
      statement.Condition?.DateLessThan,
      { "aws:CurrentTime": expiresAt },
      `${label} ${statement.Sid} lacks the exact temporary expiry`,
    );
  }
}

const grantInput = {
  approvedChangeSetName: changeSetName,
  approvedTemplateSha256: sha256,
  approvedTemplateCanonicalSha256: canonicalSha256,
  approvedCellExpiresAt: cellExpiresAt,
  grantReviewedAt,
  grantExpiresAt,
};
const compensationInput = {
  ...grantInput,
  approvedStackId,
  approvedChangeSetArn,
  approvedCompensationPlanSha256,
  compensationReviewedAt,
  compensationExpiresAt,
};
const [
  source,
  operation,
  lockedSource,
  authorSource,
  compensationSource,
  executeSource,
  rollbackSource,
] =
  await Promise.all([
    readFile(templatePath, "utf8"),
    readFile(operationPath, "utf8"),
    renderB5CellLifecycleManagementTemplate({ shape: "Locked" }),
    renderB5CellLifecycleManagementTemplate({ shape: "AuthorGrant", ...grantInput }),
    renderB5CellLifecycleManagementTemplate({
      shape: "AuthorCompensationGrant",
      ...compensationInput,
    }),
    renderB5CellLifecycleManagementTemplate({ shape: "ExecuteGrant", ...grantInput }),
    renderB5CellLifecycleManagementTemplate({ shape: "RollbackGrant", ...grantInput }),
  ]);
const base = JSON.parse(source);
const locked = JSON.parse(lockedSource);
const author = JSON.parse(authorSource);
const compensation = JSON.parse(compensationSource);
const execute = JSON.parse(executeSource);
const rollback = JSON.parse(rollbackSource);

assert.deepEqual(lifecycleManagementShapes, [
  "Locked",
  "AuthorGrant",
  "AuthorCompensationGrant",
  "ExecuteGrant",
  "RollbackGrant",
]);
assert.equal(approvedSharedCellResourceTypes.length, 18);
assert.deepEqual(
  base.Metadata.SafetyBoundary.ApprovedResourceTypes,
  approvedSharedCellResourceTypes,
);
assert.equal(new Set(approvedSharedCellResourceTypes).size, 18);

const safety = base.Metadata.SafetyBoundary;
for (const key of [
  "ManagementRootExecutionApproved",
  "TemporaryGrantApplyEnabled",
  "PaidCellApplyReady",
  "ApplyReady",
  "CleanupReady",
  "PaidCellExecutionApproved",
  "CreatesSharedCell",
  "CreatesPaidCellResources",
  "CurrentTtlDeleteEventCompatible",
  "CreateFailureRollbackOperatorPresent",
  "RdsManagedSecretPermissionsReady",
  "ExecutionBoundaryExactResourceMaximumReady",
  "GrantWindowRuntimeValidationReady",
  "ImmutableTemplatePublicationReady",
]) assert.equal(safety[key], false, `${key} must stay false`);
for (const key of [
  "CloudApplyEnabled",
  "ManagementRootApplyEnabled",
  "CreatesIamOnly",
  "JanitorPlanOnly",
  "PreOnlineReviewRequired",
  "SourceArnUnverified",
  "ServiceLinkedRolesPreexistingRequired",
]) assert.equal(safety[key], true, `${key} must stay true`);
assert.equal(safety.LocalValidateOnly, false);
assert.equal(safety.OperatorGrantState, "LOCKED");
assert.equal(
  safety.ApprovedManagementStackName,
  "techlong-s3-b5-cell-lifecycle-management",
);
assert.equal(safety.ApprovedCellStackName, "techlong-sandbox-cell-sandbox-1");
assert.equal(safety.ApprovedCellId, "cell-sandbox-1");
assert.equal(safety.CloudFormationServiceRoleTrust, "SERVICE_PRINCIPAL_ONLY");
assert.equal(
  safety.RollbackGrantPurpose,
  "MANUAL_FAILED_CREATE_RECOVERY_ONLY_NOT_TTL",
);

assert.deepEqual(
  Object.fromEntries(
    Object.entries(base.Resources).map(([key, resource]) => [key, resource.Type]),
  ),
  {
    CellOperatorBoundary: "AWS::IAM::ManagedPolicy",
    CellOperatorRole: "AWS::IAM::Role",
    CellCloudFormationExecutionBoundary: "AWS::IAM::ManagedPolicy",
    CellCloudFormationExecutionRole: "AWS::IAM::Role",
  },
);
assert.equal(base.Resources.CellOperatorBoundary.Properties.ManagedPolicyName,
  "TechlongSandboxCellOperatorBoundary");
assert.equal(base.Resources.CellOperatorRole.Properties.RoleName,
  "TechlongSandboxCellOperatorRole");
assert.equal(
  base.Resources.CellCloudFormationExecutionBoundary.Properties.ManagedPolicyName,
  "TechlongSandboxCellCloudFormationExecutionBoundary",
);
assert.equal(base.Resources.CellCloudFormationExecutionRole.Properties.RoleName,
  "TechlongSandboxCellCloudFormationExecutionRole");
assert.deepEqual(locked.Resources, base.Resources);
assert.equal(
  locked.Outputs.ApprovedManagementStackName.Value,
  "techlong-s3-b5-cell-lifecycle-management",
);
assert.equal(
  locked.Outputs.ApprovedCellStackName.Value,
  "techlong-sandbox-cell-sandbox-1",
);
assert.equal(
  locked.Outputs.SafetyState.Value,
  "LOCKED_IAM_MANAGEMENT_ROOT_APPLY_ENABLED_EXECUTION_NOT_APPROVED_NO_PAID_CELL",
);

const operatorRole = base.Resources.CellOperatorRole.Properties;
assert.deepEqual(operatorRole.PermissionsBoundary, { Ref: "CellOperatorBoundary" });
assert.deepEqual(operatorRole.ManagedPolicyArns, [{ Ref: "CellOperatorBoundary" }]);
assert.equal(
  operatorRole.AssumeRolePolicyDocument.Statement[0].Condition.Bool[
    "aws:MultiFactorAuthPresent"
  ],
  "true",
);
assert.equal(
  operatorRole.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals[
    "sts:RoleSessionName"
  ],
  "techlong-sandbox-cell-operator",
);

const executionRole = base.Resources.CellCloudFormationExecutionRole.Properties;
assert.deepEqual(executionRole.PermissionsBoundary, {
  Ref: "CellCloudFormationExecutionBoundary",
});
assert.equal(executionRole.ManagedPolicyArns, undefined);
assert.equal(executionRole.Policies, undefined);
assert.deepEqual(executionRole.AssumeRolePolicyDocument.Statement, [
  {
    Effect: "Allow",
    Principal: { Service: "cloudformation.amazonaws.com" },
    Action: "sts:AssumeRole",
  },
]);
assert.equal(JSON.stringify(executionRole.AssumeRolePolicyDocument).includes("aws:SourceArn"), false);
assert.equal(JSON.stringify(executionRole.AssumeRolePolicyDocument).includes("aws:SourceAccount"), false);

assert.deepEqual(
  statementBySid(base, "CellOperatorBoundary", "AllowReadReviewedCellChangeSets"),
  {
    Sid: "AllowReadReviewedCellChangeSets",
    Effect: "Allow",
    Action: "cloudformation:DescribeChangeSet",
    Resource:
      "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/*",
    Condition: {
      StringEquals: { "aws:RequestedRegion": "ca-central-1" },
      StringLike: {
        "cloudformation:ChangeSetName": "techlong-sandbox-cell-sandbox-1-*",
      },
    },
  },
);

assert.equal(locked.Resources.CellCloudFormationExecutionRole.Properties.Policies, undefined);
for (const action of [
  "cloudformation:CreateChangeSet",
  "cloudformation:ExecuteChangeSet",
  "cloudformation:DeleteStack",
  "ec2:CreateVpc",
  "ecs:CreateCluster",
  "elasticloadbalancing:CreateLoadBalancer",
  "rds:CreateDBCluster",
]) {
  assert.equal(allowedActions(locked, "CellOperatorBoundary").has(action), false);
  assert.equal(
    allowedActions(locked, "CellCloudFormationExecutionBoundary").has(action),
    false,
  );
}

for (const template of [locked, author, compensation, execute, rollback]) {
  assert.ok(Buffer.byteLength(JSON.stringify(template), "utf8") <= 51_200);
  for (const logicalId of [
    "CellOperatorBoundary",
    "CellCloudFormationExecutionBoundary",
  ]) {
    assert.ok(
      policyCharacters(template.Resources[logicalId].Properties.PolicyDocument) <= 6_144,
      `${logicalId} exceeds the managed-policy quota`,
    );
  }
  const inlinePolicies =
    template.Resources.CellCloudFormationExecutionRole.Properties.Policies ?? [];
  assert.ok(
    inlinePolicies.reduce(
      (total, policy) => total + policyCharacters(policy.PolicyDocument),
      0,
    ) <= 10_240,
    "execution role exceeds its aggregate inline-policy quota",
  );
}

for (const template of [author, compensation, execute, rollback]) {
  assert.equal(template.Metadata.SafetyBoundary.ApprovedChangeSetName, changeSetName);
  assert.equal(template.Metadata.SafetyBoundary.ApprovedTemplateSha256, sha256);
  assert.equal(
    template.Metadata.SafetyBoundary.ApprovedTemplateCanonicalSha256,
    canonicalSha256,
  );
  assert.equal(template.Metadata.SafetyBoundary.ApprovedTemplateUrl, templateUrl);
  assert.equal(template.Metadata.SafetyBoundary.ApprovedCellExpiresAt, cellExpiresAt);
  assert.equal(template.Metadata.SafetyBoundary.GrantReviewedAt, grantReviewedAt);
  assert.equal(template.Metadata.SafetyBoundary.GrantExpiresAt, grantExpiresAt);
  assert.equal(template.Metadata.SafetyBoundary.ApplyReady, false);
  assert.equal(template.Metadata.SafetyBoundary.PaidCellExecutionApproved, false);
  assert.equal(template.Metadata.SafetyBoundary.ManagementRootExecutionApproved, false);
  assert.equal(template.Metadata.SafetyBoundary.PaidCellApplyReady, false);
  assert.equal(
    template.Metadata.SafetyBoundary.ApprovedManagementStackName,
    "techlong-s3-b5-cell-lifecycle-management",
  );
  assert.equal(
    template.Metadata.SafetyBoundary.ApprovedCellStackName,
    "techlong-sandbox-cell-sandbox-1",
  );
}

assert.equal(author.Metadata.SafetyBoundary.CloudApplyEnabled, true);
assert.equal(author.Metadata.SafetyBoundary.LocalValidateOnly, false);
assert.equal(author.Metadata.SafetyBoundary.ManagementRootApplyEnabled, true);
assert.equal(author.Metadata.SafetyBoundary.TemporaryGrantApplyEnabled, true);
assert.equal(
  author.Outputs.SafetyState.Value,
  "AUTHOR_GRANT_MANAGEMENT_ROOT_APPLY_ENABLED_CHILD_EXECUTION_NOT_APPROVED_NO_PAID_CELL",
);
for (const template of [execute, rollback]) {
  assert.equal(template.Metadata.SafetyBoundary.CloudApplyEnabled, false);
  assert.equal(template.Metadata.SafetyBoundary.LocalValidateOnly, true);
  assert.equal(template.Metadata.SafetyBoundary.ManagementRootApplyEnabled, false);
  assert.equal(template.Metadata.SafetyBoundary.TemporaryGrantApplyEnabled, false);
  assert.equal(
    template.Outputs.SafetyState.Value,
    `OFFLINE_ONLY_${template.Metadata.SafetyBoundary.OperatorGrantState}_NOT_APPLY_ENABLED_NO_PAID_CELL_APPROVAL`,
  );
}

assert.equal(compensation.Metadata.SafetyBoundary.CloudApplyEnabled, false);
assert.equal(compensation.Metadata.SafetyBoundary.LocalValidateOnly, true);
assert.equal(compensation.Metadata.SafetyBoundary.ManagementRootApplyEnabled, false);
assert.equal(compensation.Metadata.SafetyBoundary.TemporaryGrantApplyEnabled, false);
assert.equal(compensation.Metadata.SafetyBoundary.ApprovedStackId, approvedStackId);
assert.equal(
  compensation.Metadata.SafetyBoundary.ApprovedChangeSetArn,
  approvedChangeSetArn,
);
assert.equal(
  compensation.Metadata.SafetyBoundary.ApprovedCompensationPlanSha256,
  approvedCompensationPlanSha256,
);
assert.equal(
  compensation.Metadata.SafetyBoundary.CompensationReviewedAt,
  compensationReviewedAt,
);
assert.equal(
  compensation.Metadata.SafetyBoundary.CompensationExpiresAt,
  compensationExpiresAt,
);
assert.equal(
  compensation.Metadata.SafetyBoundary.CompensationPlanDigestRecorded,
  true,
);
assert.equal(
  compensation.Metadata.SafetyBoundary.CompensationPlanDigestVerified,
  false,
);
assert.equal(
  compensation.Metadata.SafetyBoundary.CompensationUsesExactStackId,
  true,
);
assert.equal(
  compensation.Metadata.SafetyBoundary.CompensationControllerRequiresEmptyReviewStack,
  true,
);
assert.equal(
  Object.hasOwn(
    compensation.Metadata.SafetyBoundary,
    "CompensationRequiresEmptyReviewStack",
  ),
  false,
);
assert.equal(
  Object.hasOwn(
    compensation.Metadata.SafetyBoundary,
    "CompensationPlanDigestBound",
  ),
  false,
);
assert.equal(
  compensation.Metadata.SafetyBoundary.CompensationStateAndOrderIamEnforced,
  false,
);
assert.equal(
  compensation.Metadata.SafetyBoundary.CompensationGrantSplitRequired,
  true,
);
assert.equal(
  compensation.Metadata.SafetyBoundary.CompensationSafeToAuthorRevoke,
  false,
);
assert.equal(
  compensation.Outputs.SafetyState.Value,
  "OFFLINE_ONLY_AUTHORCOMPENSATIONGRANT_NOT_APPLY_ENABLED_NO_PAID_CELL_APPROVAL",
);

const compensationActions = allowedActions(
  compensation,
  "CellOperatorBoundary",
);
for (const required of [
  "cloudformation:DeleteChangeSet",
  "cloudformation:DeleteStack",
]) assert.ok(compensationActions.has(required), `compensation lacks ${required}`);
for (const forbidden of [
  "cloudformation:CreateChangeSet",
  "cloudformation:ExecuteChangeSet",
  "iam:PassRole",
  "s3:GetObject",
]) assert.equal(
  compensationActions.has(forbidden),
  false,
  `compensation allows ${forbidden}`,
);
assert.equal(
  compensation.Resources.CellCloudFormationExecutionRole.Properties.Policies,
  undefined,
);
assert.deepEqual(
  compensation.Resources.CellCloudFormationExecutionBoundary,
  locked.Resources.CellCloudFormationExecutionBoundary,
);
const compensationDeleteChangeSet = statementBySid(
  compensation,
  "CellOperatorBoundary",
  "TemporaryAllowDiscardExactReviewedAuthorChangeSet",
);
assert.equal(compensationDeleteChangeSet.Resource, approvedStackId);
assert.equal(compensationDeleteChangeSet.Effect, "Allow");
assert.equal(compensationDeleteChangeSet.Action, "cloudformation:DeleteChangeSet");
assert.deepEqual(compensationDeleteChangeSet.Condition.StringEquals, {
  "aws:RequestedRegion": "ca-central-1",
  "cloudformation:ChangeSetName": changeSetName,
});
assert.deepEqual(compensationDeleteChangeSet.Condition.DateGreaterThanEquals, {
  "aws:CurrentTime": compensationReviewedAt,
});
assert.deepEqual(compensationDeleteChangeSet.Condition.DateLessThan, {
  "aws:CurrentTime": compensationDeleteChangeSetCutoff,
});
const compensationDeleteStack = statementBySid(
  compensation,
  "CellOperatorBoundary",
  "TemporaryAllowDeleteExactControllerReviewedStack",
);
assert.equal(compensationDeleteStack.Resource, approvedStackId);
assert.equal(compensationDeleteStack.Effect, "Allow");
assert.equal(compensationDeleteStack.Action, "cloudformation:DeleteStack");
assert.deepEqual(compensationDeleteStack.Condition.StringEquals, {
  "aws:RequestedRegion": "ca-central-1",
  "aws:ResourceTag/Environment": "aws-sandbox",
  "aws:ResourceTag/ManagedBy": "techlong-cell-operator",
  "aws:ResourceTag/CellId": "cell-sandbox-1",
  "aws:ResourceTag/ExpiresAt": cellExpiresAt,
});
assert.deepEqual(compensationDeleteStack.Condition.Null, {
  "cloudformation:RoleArn": "true",
});
assert.deepEqual(compensationDeleteStack.Condition.DateGreaterThanEquals, {
  "aws:CurrentTime": compensationReviewedAt,
});
assert.deepEqual(compensationDeleteStack.Condition.DateLessThan, {
  "aws:CurrentTime": compensationDeleteStackCutoff,
});
const lockedOperatorStatements =
  locked.Resources.CellOperatorBoundary.Properties.PolicyDocument.Statement;
const compensationOperatorStatements =
  compensation.Resources.CellOperatorBoundary.Properties.PolicyDocument.Statement;
assert.equal(
  compensationOperatorStatements.length,
  lockedOperatorStatements.length + 2,
);
assert.deepEqual(
  compensationOperatorStatements.slice(0, lockedOperatorStatements.length),
  lockedOperatorStatements,
);
assert.deepEqual(
  compensationOperatorStatements.slice(lockedOperatorStatements.length),
  [compensationDeleteChangeSet, compensationDeleteStack],
);

const authorActions = allowedActions(author, "CellOperatorBoundary");
assert.ok(authorActions.has("cloudformation:CreateChangeSet"));
assert.ok(authorActions.has("iam:PassRole"));
assert.ok(authorActions.has("s3:GetObject"));
assert.equal(authorActions.has("cloudformation:ExecuteChangeSet"), false);
assert.equal(authorActions.has("cloudformation:DeleteStack"), false);
assert.equal(author.Resources.CellCloudFormationExecutionRole.Properties.Policies, undefined);
const authorCreate = statementBySid(
  author,
  "CellOperatorBoundary",
  "TemporaryAllowAuthorExactCellChangeSet",
);
assert.deepEqual(authorCreate.Condition.StringEquals, {
  "aws:RequestedRegion": "ca-central-1",
  "aws:RequestTag/Environment": "aws-sandbox",
  "aws:RequestTag/ManagedBy": "techlong-cell-operator",
  "aws:RequestTag/CellId": "cell-sandbox-1",
  "aws:RequestTag/ExpiresAt": cellExpiresAt,
  "cloudformation:TemplateUrl": templateUrl,
  "cloudformation:RoleARN":
    "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole",
  "cloudformation:ChangeSetName": changeSetName,
});
assert.deepEqual(
  authorCreate.Condition["ForAllValues:StringEquals"]["cloudformation:ResourceTypes"],
  approvedSharedCellResourceTypes,
);
assert.deepEqual(
  authorCreate.Condition["ForAllValues:StringEquals"]["aws:TagKeys"],
  ["Environment", "ManagedBy", "CellId", "ExpiresAt"],
);
assert.deepEqual(authorCreate.Condition.Null, { "cloudformation:ResourceTypes": "false" });
assert.equal(
  statementBySid(author, "CellOperatorBoundary", "TemporaryAllowReadExactApprovedCellTemplate").Resource,
  templateObjectArn,
);
assert.deepEqual(
  statementBySid(
    author,
    "CellOperatorBoundary",
    "TemporaryAllowReadOrDiscardExactCellChangeSet",
  ),
  {
    Sid: "TemporaryAllowReadOrDiscardExactCellChangeSet",
    Effect: "Allow",
    Action: ["cloudformation:DeleteChangeSet", "cloudformation:DescribeChangeSet"],
    Resource:
      "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/*",
    Condition: {
      StringEquals: {
        "aws:RequestedRegion": "ca-central-1",
        "cloudformation:ChangeSetName": changeSetName,
      },
      DateLessThan: { "aws:CurrentTime": grantExpiresAt },
    },
  },
);
assertTemporaryStatementsExpire(
  author.Resources.CellOperatorBoundary.Properties.PolicyDocument.Statement
    .filter((statement) => statement.Sid.startsWith("Temporary")),
  "author",
);

const executeOperatorActions = allowedActions(execute, "CellOperatorBoundary");
assert.ok(executeOperatorActions.has("cloudformation:ExecuteChangeSet"));
assert.equal(executeOperatorActions.has("cloudformation:CreateChangeSet"), false);
assert.equal(executeOperatorActions.has("cloudformation:DeleteStack"), false);
assert.equal(executeOperatorActions.has("iam:PassRole"), false);
assert.equal(executeOperatorActions.has("s3:GetObject"), false);
assert.equal(
  execute.Resources.CellCloudFormationExecutionRole.Properties.Policies[0].PolicyName,
  "TechlongSandboxCellTemporaryExecuteGrant",
);
const executeInline =
  execute.Resources.CellCloudFormationExecutionRole.Properties.Policies[0]
    .PolicyDocument.Statement;
assertTemporaryStatementsExpire(executeInline, "execute inline");
const executeInlineActions = new Set(executeInline.flatMap(actions));
for (const required of [
  "ec2:CreateVpc",
  "ecs:CreateCluster",
  "elasticloadbalancing:CreateLoadBalancer",
  "rds:CreateDBCluster",
  "logs:CreateLogGroup",
  "scheduler:CreateSchedule",
  "iam:PassRole",
]) assert.ok(executeInlineActions.has(required), `execute lacks ${required}`);
const executeNamedBoundary = statementBySid(
  execute,
  "CellCloudFormationExecutionBoundary",
  "TemporaryCellExecutionNamedBoundaryMaximum",
);
assert.equal(
  (Array.isArray(executeNamedBoundary.Resource)
    ? executeNamedBoundary.Resource
    : [executeNamedBoundary.Resource]
  ).includes("*"),
  false,
  "named-service boundary resources must remain exact",
);
assertTemporaryStatementsExpire([executeNamedBoundary], "execute named boundary");

const rollbackOperatorActions = allowedActions(rollback, "CellOperatorBoundary");
assert.ok(rollbackOperatorActions.has("cloudformation:DeleteStack"));
assert.ok(rollbackOperatorActions.has("iam:PassRole"));
assert.equal(rollbackOperatorActions.has("cloudformation:CreateChangeSet"), false);
assert.equal(rollbackOperatorActions.has("cloudformation:ExecuteChangeSet"), false);
const rollbackInline =
  rollback.Resources.CellCloudFormationExecutionRole.Properties.Policies[0]
    .PolicyDocument.Statement;
assertTemporaryStatementsExpire(rollbackInline, "rollback inline");
const rollbackInlineActions = new Set(rollbackInline.flatMap(actions));
for (const forbidden of [
  "ec2:CreateVpc",
  "ecs:CreateCluster",
  "elasticloadbalancing:CreateLoadBalancer",
  "rds:CreateDBCluster",
  "logs:CreateLogGroup",
  "scheduler:CreateSchedule",
  "iam:PassRole",
]) assert.equal(rollbackInlineActions.has(forbidden), false, `rollback allows ${forbidden}`);
const rollbackNamedBoundary = statementBySid(
  rollback,
  "CellCloudFormationExecutionBoundary",
  "TemporaryCellRollbackNamedBoundaryMaximum",
);
assert.equal(
  (Array.isArray(rollbackNamedBoundary.Resource)
    ? rollbackNamedBoundary.Resource
    : [rollbackNamedBoundary.Resource]
  ).includes("*"),
  false,
  "rollback named-service boundary resources must remain exact",
);

for (const template of [locked, author, compensation, execute, rollback]) {
  const denied = new Set(
    template.Resources.CellCloudFormationExecutionBoundary.Properties.PolicyDocument.Statement
      .filter((statement) => statement.Effect === "Deny")
      .flatMap(actions),
  );
  for (const action of [
    "ec2:CreateNatGateway",
    "ec2:CreateVpcEndpoint",
    "ecs:CreateService",
    "ecs:RunTask",
    "route53:ChangeResourceRecordSets",
    "secretsmanager:CreateSecret",
    "iam:CreateRole",
    "iam:PutRolePolicy",
  ]) assert.ok(denied.has(action), `missing explicit deny ${action}`);
}

await assert.rejects(
  renderB5CellLifecycleManagementTemplate({ shape: "Locked", ...grantInput }),
  /accepts no grant inputs/,
);
await assert.rejects(
  renderB5CellLifecycleManagementTemplate({
    shape: "AuthorCompensationGrant",
    ...compensationInput,
    approvedStackId:
      "arn:aws:cloudformation:ca-central-1:402010193138:stack/other/12345678-1234-1234-1234-123456789abc",
  }),
  /exact REVIEW_IN_PROGRESS StackId/,
);
await assert.rejects(
  renderB5CellLifecycleManagementTemplate({
    shape: "AuthorCompensationGrant",
    ...compensationInput,
    approvedChangeSetArn: approvedChangeSetArn.replace(changeSetName, `${changeSetName}0`),
  }),
  /exact approved Change Set ARN/,
);
await assert.rejects(
  renderB5CellLifecycleManagementTemplate({
    shape: "AuthorCompensationGrant",
    ...compensationInput,
    approvedCompensationPlanSha256: "",
  }),
  /exact approved compensation plan SHA-256/,
);
await assert.rejects(
  renderB5CellLifecycleManagementTemplate({
    shape: "AuthorCompensationGrant",
    ...compensationInput,
    compensationReviewedAt: "2026-09-07T11:29:59.999Z",
  }),
  /must not predate the original author review/,
);
await assert.rejects(
  renderB5CellLifecycleManagementTemplate({
    shape: "AuthorCompensationGrant",
    ...compensationInput,
    compensationExpiresAt: "2026-09-07T14:00:00.001Z",
  }),
  /must not exceed 60 minutes/,
);
await assert.rejects(
  renderB5CellLifecycleManagementTemplate({
    shape: "AuthorCompensationGrant",
    ...compensationInput,
    compensationExpiresAt: "2026-09-07T13:10:00.000Z",
  }),
  /must exceed the 10-minute DeleteChangeSet safety margin/,
);
await assert.rejects(
  renderB5CellLifecycleManagementTemplate({
    shape: "AuthorGrant",
    ...grantInput,
    approvedStackId,
  }),
  /accepts no compensation inputs/,
);
await assert.rejects(
  renderB5CellLifecycleManagementTemplate({
    shape: "AuthorGrant",
    ...grantInput,
    approvedCompensationPlanSha256,
  }),
  /accepts no compensation inputs/,
);
await assert.rejects(
  renderB5CellLifecycleManagementTemplate({
    shape: "AuthorGrant",
    ...grantInput,
    approvedChangeSetName: "techlong-sandbox-cell-sandbox-1-ffffffffffffffff",
  }),
  /must match the approved raw template SHA-256/,
);
await assert.rejects(
  renderB5CellLifecycleManagementTemplate({
    shape: "ExecuteGrant",
    ...grantInput,
    grantReviewedAt: "2026-09-08T11:30:00.000Z",
    grantExpiresAt: cellExpiresAt,
  }),
  /must expire at least 15 minutes before the Shared Cell TTL/,
);
await assert.rejects(
  renderB5CellLifecycleManagementTemplate({
    shape: "AuthorGrant",
    ...grantInput,
    grantReviewedAt: "2026-09-07T10:59:59.999Z",
  }),
  /must not exceed 60 minutes/,
);
await assert.rejects(
  renderB5CellLifecycleManagementTemplate({
    shape: "AuthorGrant",
    ...grantInput,
    approvedTemplateCanonicalSha256: "",
  }),
  /canonical template SHA-256/,
);
await assert.rejects(
  renderB5CellLifecycleManagementTemplate({
    shape: "RollbackGrant",
    ...grantInput,
    grantExpiresAt: "2026-09-07T12:00:00Z",
  }),
  /canonical UTC with milliseconds/,
);

assert.match(
  operation,
  /\[ValidateSet\('LocalValidate', 'OnlineValidate', 'CreateChangeSet', 'InspectChangeSet', 'ExecuteChangeSet', 'Readback'\)\]/,
);
assert.match(operation, /\[string\]\$Mode = 'LocalValidate'/);
assert.match(
  operation,
  /\[ValidateSet\('InitialLocked', 'AuthorGrant', 'AuthorRevoke'\)\]/,
);
assert.match(operation, /\[string\]\$UpdateShape = 'InitialLocked'/);
assert.match(operation, /validate-b5-cell-lifecycle-management\.mjs/);
assert.match(
  operation,
  /\$managementStackName = 'techlong-s3-b5-cell-lifecycle-management'/,
);
assert.match(operation, /\$cellStackName = 'techlong-sandbox-cell-sandbox-1'/);
assert.match(operation, /\$expectedProfile = 'techlong-sandbox-user'/);
assert.match(operation, /arn:aws:iam::402010193138:user\/techlong-sandbox-dev/);
assert.match(operation, /arn:aws:iam::402010193138:mfa\/techlong-sandbox-dev/);
assert.match(operation, /Assert-ExactSourceLoginSession/);
for (const override of [
  "AWS_ROLE_ARN",
  "AWS_ROLE_SESSION_NAME",
  "AWS_CONTAINER_AUTHORIZATION_TOKEN",
  "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
  "AWS_SHARED_CREDENTIALS_FILE",
  "AWS_PROFILE",
  "AWS_DEFAULT_PROFILE",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
]) assert.match(operation, new RegExp(`'${override}'`));
assert.match(operation, /Assert-NoAwsEndpointOverrides/);
assert.match(operation, /Assert-ExactSourceIdentity/);
assert.match(operation, /when calling the DescribeStacks operation/);
assert.match(operation, /'GetTemplate'/);
assert.match(operation, /'ListStackResources'/);
assert.match(operation, /denial is never accepted as MISSING/);
assert.match(operation, /--consistent-read/);
assert.match(operation, /'--query', '\{Item:Item\}'/);
assert.match(operation, /Assert-AuthorityAbsent/);
assert.match(operation, /Assert-ManagementIamNamesMissing/);
assert.match(
  operation,
  /@\(\$renderer, '--shape', \$RendererShape, '--output', \$path\)/,
);
assert.match(operation, /\$binding = @\(/);
for (const bindingField of [
  "$UpdateShape",
  "$expectedManagementStackId",
  "$ApprovedChangeSetName",
  "$ApprovedTemplateSha256",
  "$ApprovedTemplateCanonicalSha256",
  "$ApprovedCellExpiresAt",
  "$GrantReviewedAt",
  "$GrantExpiresAt",
  "$Snapshot.RawSha256",
  "$Snapshot.CanonicalSha256",
]) assert.ok(operation.includes(bindingField), `missing binding field ${bindingField}`);
assert.match(
  operation,
  /\$expectedManagementStackId = 'arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-s3-b5-cell-lifecycle-management\/fb742b50-afb2-11f1-85b7-02588681429d'/,
);
for (const phrase of [
  "I_ACKNOWLEDGE_J5GA_INITIAL_LOCKED_CHANGE_SET_CREATE",
  "I_ACKNOWLEDGE_J5GA_INITIAL_LOCKED_IAM_ROOT_EXECUTE",
  "I_ACKNOWLEDGE_J5GA_AUTHOR_GRANT_CHANGE_SET_CREATE",
  "I_ACKNOWLEDGE_J5GA_AUTHOR_GRANT_EXECUTE",
  "I_ACKNOWLEDGE_J5GA_AUTHOR_REVOKE_CHANGE_SET_CREATE",
  "I_ACKNOWLEDGE_J5GA_AUTHOR_REVOKE_EXECUTE",
]) assert.ok(operation.includes(phrase), `missing transition phrase ${phrase}`);
for (const acknowledgement of [
  "AcknowledgeAwsWrite",
  "AcknowledgeCreatesNamedIam",
  "AcknowledgeSourceUserBootstrapRisk",
  "AcknowledgeMfaSession",
  "AcknowledgeLockedIamOnly",
  "AcknowledgeTemporaryAuthorGrant",
  "AcknowledgeChangeSetReviewed",
]) assert.match(operation, new RegExp(`\\[switch\\]\\$${acknowledgement}`));
for (const confirmation of [
  "ConfirmAccountId",
  "ConfirmRegion",
  "ConfirmManagementStackName",
  "ConfirmTemplateSha256",
  "ConfirmTemplateCanonicalSha256",
  "ConfirmChangeSetName",
  "ConfirmChangeSetArn",
  "ConfirmStackId",
  "ApprovedChangeSetName",
  "ApprovedTemplateSha256",
  "ApprovedTemplateCanonicalSha256",
  "ApprovedCellExpiresAt",
  "GrantReviewedAt",
  "GrantExpiresAt",
]) assert.match(operation, new RegExp(`\\[string\\]\\$${confirmation}`));
assert.match(operation, /'cloudformation', 'create-change-set'/);
assert.match(operation, /'cloudformation', 'describe-change-set'/);
assert.match(operation, /'cloudformation', 'execute-change-set'/);
assert.match(
  operation,
  /'--change-set-name', \(\[string\]\$changeSet\.ChangeSetId\)/,
);
assert.match(operation, /\$ConfirmChangeSetArn -cne \[string\]\$ChangeSet\.ChangeSetId/);
assert.match(operation, /\$ConfirmStackId -cne \[string\]\$ChangeSet\.StackId/);
assert.match(operation, /'CAPABILITY_NAMED_IAM'/);
assert.match(operation, /'--on-stack-failure', 'DELETE'/);
assert.match(operation, /Assert-ReviewedChangeSet/);
assert.match(operation, /\$ChangeSet\.PSObject\.Properties/);
assert.match(operation, /RollbackConfiguration must be present as the exact empty object/);
assert.match(operation, /Expected \(\[PSCustomObject\]@\{\}\)/);
assert.match(operation, /Assert-ExactGetTemplateResponse/);
assert.match(operation, /Assert-ExactManagementIamReadback/);
assert.match(operation, /Assert-ExactIamSimulation/);
assert.match(operation, /EvalResourceName -cne \$ResourceArn/);
assert.match(operation, /EvalDecision -cne 'implicitDeny'/);
assert.match(operation, /MissingContextValues\)\.Count -ne 0/);
assert.match(operation, /PermissionsBoundaryDecisionDetail\.AllowedByPermissionsBoundary -ne \$false/);
assert.match(operation, /ContextKeyName=cloudformation:ChangeSetName/);
assert.match(operation, /ContextKeyValues=\$\{cellStackName\}-simulation/);
assert.match(operation, /cluster\/\$cellId/);
assert.match(operation, /techlong-sandbox-cell\/\$\{cellStackName\}-ttl/);
assert.match(operation, /log-group:\/aws\/rds\/cluster\/\$cellStackName\/postgresql/);
assert.match(operation, /ExpectedAction = 'Modify'/);
assert.match(operation, /UPDATE Change Set must contain only the exact CellOperatorBoundary Properties modification/);
assert.match(operation, /Assert-GrantWindow -MinimumRemainingMinutes 15/);
assert.match(operation, /Assert-GrantWindow -MinimumRemainingMinutes 10/);
assert.match(operation, /Assert-GrantWindow -MinimumRemainingMinutes 5/);
assert.doesNotMatch(operation, /ValidateSet\([^)]*Delete/);
assert.doesNotMatch(
  operation,
  /\[ValidateSet\([^)]*(?:ExecuteGrant|RollbackGrant)/,
);
assert.doesNotMatch(operation, /'cloudformation',\s*'delete-stack'/i);

console.log(
  "B5-J5g-a Shared Cell lifecycle IAM contract validated (Locked plus Author-only management gates; exact-StackId AuthorCompensation and Execute/Rollback remain offline-only; 4 resources, 18 resource types, policy quotas enforced; validator made no AWS call).",
);
