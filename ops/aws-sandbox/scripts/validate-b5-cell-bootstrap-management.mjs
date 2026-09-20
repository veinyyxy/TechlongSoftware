import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  managementShapes,
  renderB5CellBootstrapManagementTemplate,
} from "./render-b5-cell-bootstrap-management.mjs";
import {
  legacyJ4bLockedCanonicalSha256,
  legacyJ4bLockedRawSha256,
  renderLegacyJ4bLockedManagementTemplate,
} from "./render-b5-cell-bootstrap-management-j4b-legacy.mjs";
import { createHash } from "node:crypto";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const templatePath = path.join(
  root,
  "cloudformation",
  "s3-b5-cell-bootstrap-management.template.json",
);
const operationScriptPath = path.join(
  root,
  "scripts",
  "s3-b5-cell-bootstrap-management.ps1",
);
const exampleTemplateSha256 = "0123456789abcdef".repeat(4);
const exampleChangeSetName =
  `techlong-s3-b5-cell-bootstrap-${exampleTemplateSha256.slice(0, 16)}`;
const exampleReverseChangeSetName =
  `techlong-s3-b5-cell-bootstrap-rollback-${exampleTemplateSha256.slice(0, 16)}`;
const exampleExpiry = "2026-08-25T23:59:59.000Z";
const exampleTemplateUrl =
  `https://techlong-sandbox-build-source-402010193138-ca-central-1.s3.ca-central-1.amazonaws.com/b5-cell-bootstrap/templates/sha256/${exampleTemplateSha256}.json`;
const exampleTemplateObjectArn =
  `arn:aws:s3:::techlong-sandbox-build-source-402010193138-ca-central-1/b5-cell-bootstrap/templates/sha256/${exampleTemplateSha256}.json`;
const approvedBootstrapResourceTypes = [
  "AWS::Logs::LogGroup",
  "AWS::Lambda::Function",
  "AWS::Scheduler::ScheduleGroup",
  "AWS::Scheduler::Schedule",
];

const [source, operationScript, lockedSource, authorSource, executeSource, rollbackSource, legacySource] =
  await Promise.all([
    readFile(templatePath, "utf8"),
    readFile(operationScriptPath, "utf8"),
    renderB5CellBootstrapManagementTemplate({ shape: "Locked" }),
    renderB5CellBootstrapManagementTemplate({
      shape: "AuthorGrant",
      approvedChangeSetName: exampleChangeSetName,
      approvedTemplateSha256: exampleTemplateSha256,
      grantExpiresAt: exampleExpiry,
    }),
    renderB5CellBootstrapManagementTemplate({
      shape: "ExecuteGrant",
      approvedChangeSetName: exampleChangeSetName,
      approvedTemplateSha256: exampleTemplateSha256,
      grantExpiresAt: exampleExpiry,
    }),
    renderB5CellBootstrapManagementTemplate({
      shape: "RollbackGrant",
      grantExpiresAt: exampleExpiry,
    }),
    renderLegacyJ4bLockedManagementTemplate(),
  ]);
const base = JSON.parse(source);
const locked = JSON.parse(lockedSource);
const author = JSON.parse(authorSource);
const execute = JSON.parse(executeSource);
const rollback = JSON.parse(rollbackSource);
const legacy = JSON.parse(legacySource);
const reverseAuthor = JSON.parse(
  await renderB5CellBootstrapManagementTemplate({
    shape: "AuthorGrant",
    approvedChangeSetName: exampleReverseChangeSetName,
    approvedTemplateSha256: exampleTemplateSha256,
    grantExpiresAt: exampleExpiry,
  }),
);

assert.deepEqual(managementShapes, [
  "Locked",
  "AuthorGrant",
  "ExecuteGrant",
  "RollbackGrant",
]);
assert.equal(
  reverseAuthor.Metadata.SafetyBoundary.ApprovedChangeSetName,
  exampleReverseChangeSetName,
);
assert.equal(
  reverseAuthor.Resources.CellBootstrapManagerBoundary.Properties.PolicyDocument.Statement
    .some((statement) =>
      JSON.stringify(statement).includes(exampleReverseChangeSetName)),
  true,
  "the dormant reverse Change Set name must be bound exactly into the temporary author grant",
);
assert.deepEqual(locked, {
  ...base,
  Description:
    "B5-J4c IAM-only plan-only Cell cleanup management root (Locked); it cannot create or delete a Shared Cell.",
});
assert.equal(createHash("sha256").update(legacySource, "utf8").digest("hex"), legacyJ4bLockedRawSha256);
assert.equal(
  createHash("sha256").update(canonicalJson(JSON.parse(legacySource)), "utf8").digest("hex"),
  legacyJ4bLockedCanonicalSha256,
);
const lockedPolicyRefreshResources = Object.keys(locked.Resources)
  .filter(
    (name) =>
      JSON.stringify(legacy.Resources[name]) !== JSON.stringify(locked.Resources[name]),
  )
  .sort();
assert.deepEqual(lockedPolicyRefreshResources, [
  "CellBootstrapExecutionBoundary",
  "CellJanitorBoundary",
]);
for (const logicalId of lockedPolicyRefreshResources) {
  assert.deepEqual(
    exactChangedPropertyNames(
      legacy.Resources[logicalId].Properties,
      locked.Resources[logicalId].Properties,
    ),
    ["PolicyDocument"],
    `${logicalId} must remain an in-place policy-only refresh`,
  );
}
assert.ok(Buffer.byteLength(lockedSource, "utf8") <= 51_200);
assert.equal(base.Metadata.SafetyBoundary.CloudApplyEnabled, true);
assert.equal(base.Metadata.SafetyBoundary.CreatesIamOnly, true);
assert.equal(base.Metadata.SafetyBoundary.CreatesSharedCell, false);
assert.equal(base.Metadata.SafetyBoundary.CreatesPaidCellResources, false);
assert.equal(base.Metadata.SafetyBoundary.CoordinatorMode, "PLAN_ONLY");
assert.equal(base.Metadata.SafetyBoundary.AuthorityReadOnly, true);
assert.equal(base.Metadata.SafetyBoundary.ManagerGrantState, "LOCKED");
assert.equal(base.Metadata.SafetyBoundary.TemporaryAuthorGrantRequired, true);
assert.equal(
  base.Metadata.SafetyBoundary.ApprovedManagedStackName,
  "techlong-s3-b5-cell-bootstrap",
);
assert.deepEqual(base.Parameters.ExpectedAccountId.AllowedValues, ["402010193138"]);
assert.deepEqual(base.Parameters.ExpectedRegion.AllowedValues, ["ca-central-1"]);
assert.deepEqual(base.Parameters.ManagementPrincipalArn.AllowedValues, [
  "arn:aws:iam::402010193138:user/techlong-sandbox-dev",
]);

const expectedResources = {
  CellJanitorBoundary: "AWS::IAM::ManagedPolicy",
  CellSchedulerInvokeBoundary: "AWS::IAM::ManagedPolicy",
  CellJanitorExecutionRole: "AWS::IAM::Role",
  CellSchedulerInvokeRole: "AWS::IAM::Role",
  CellBootstrapManagerBoundary: "AWS::IAM::ManagedPolicy",
  CellBootstrapManagerRole: "AWS::IAM::Role",
  CellBootstrapExecutionBoundary: "AWS::IAM::ManagedPolicy",
  CellBootstrapExecutionRole: "AWS::IAM::Role",
};
assert.deepEqual(
  Object.fromEntries(
    Object.entries(base.Resources).map(([name, resource]) => [name, resource.Type]),
  ),
  expectedResources,
);
for (const resource of Object.values(base.Resources)) {
  assert.equal(resource.Condition, "IsExpectedTarget");
}

function actions(statement) {
  if (statement.Action === undefined) return [];
  return Array.isArray(statement.Action) ? statement.Action : [statement.Action];
}

function canonicalJson(value) {
  if (value === null || ["boolean", "number", "string"].includes(typeof value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function exactChangedPropertyNames(previous, target) {
  return [...new Set([...Object.keys(previous), ...Object.keys(target)])]
    .filter((name) => JSON.stringify(previous[name]) !== JSON.stringify(target[name]))
    .sort();
}

function allows(template, logicalId) {
  return template.Resources[logicalId].Properties.PolicyDocument.Statement.filter(
    (statement) => statement.Effect === "Allow",
  );
}

function allowedActions(template, logicalId) {
  return new Set(allows(template, logicalId).flatMap(actions));
}

function statementBySid(template, logicalId, sid) {
  const matches = template.Resources[logicalId].Properties.PolicyDocument.Statement.filter(
    (statement) => statement.Sid === sid,
  );
  assert.equal(matches.length, 1, `expected exactly one ${sid} statement`);
  return matches[0];
}

const lockedManagerActions = allowedActions(locked, "CellBootstrapManagerBoundary");
for (const forbidden of [
  "cloudformation:CreateChangeSet",
  "cloudformation:DeleteStack",
  "cloudformation:ExecuteChangeSet",
  "iam:PassRole",
  "lambda:InvokeFunction",
  "s3:GetObject",
  "s3:ListBucket",
  "s3:PutObject",
]) {
  assert.equal(lockedManagerActions.has(forbidden), false, `locked manager allows ${forbidden}`);
}
assert.equal(
  Object.hasOwn(locked.Metadata.SafetyBoundary, "ApprovedTemplateSha256"),
  false,
);
assert.equal(
  Object.hasOwn(locked.Metadata.SafetyBoundary, "ApprovedTemplateUrl"),
  false,
);
for (const allowed of [
  "cloudformation:DescribeStacks",
  "cloudformation:GetTemplate",
  "iam:SimulatePrincipalPolicy",
  "sts:GetCallerIdentity",
]) {
  assert.ok(lockedManagerActions.has(allowed), `locked manager lacks ${allowed}`);
}

const managerRole = base.Resources.CellBootstrapManagerRole.Properties;
assert.equal(managerRole.RoleName, "TechlongSandboxCellBootstrapManagerRole");
assert.deepEqual(managerRole.PermissionsBoundary, {
  Ref: "CellBootstrapManagerBoundary",
});
assert.deepEqual(managerRole.ManagedPolicyArns, [
  { Ref: "CellBootstrapManagerBoundary" },
]);
const managerTrust = managerRole.AssumeRolePolicyDocument.Statement[0];
assert.deepEqual(managerTrust.Principal, {
  AWS: { Ref: "ManagementPrincipalArn" },
});
assert.equal(managerTrust.Condition.Bool["aws:MultiFactorAuthPresent"], "true");
assert.equal(
  managerTrust.Condition.StringEquals["sts:RoleSessionName"],
  "techlong-sandbox-cell-bootstrap-manager",
);

const executionRole = base.Resources.CellBootstrapExecutionRole.Properties;
assert.equal(
  executionRole.RoleName,
  "TechlongSandboxCellBootstrapCloudFormationExecutionRole",
);
assert.deepEqual(executionRole.PermissionsBoundary, {
  Ref: "CellBootstrapExecutionBoundary",
});
assert.deepEqual(executionRole.ManagedPolicyArns, [
  { Ref: "CellBootstrapExecutionBoundary" },
]);
assert.equal(
  executionRole.AssumeRolePolicyDocument.Statement[0].Principal.Service,
  "cloudformation.amazonaws.com",
);

for (const logicalId of [
  "CellJanitorBoundary",
  "CellSchedulerInvokeBoundary",
  "CellBootstrapManagerBoundary",
  "CellBootstrapExecutionBoundary",
]) {
  const policy = base.Resources[logicalId].Properties.PolicyDocument;
  assert.ok(Buffer.byteLength(JSON.stringify(policy), "utf8") <= 6_144);
  for (const statement of policy.Statement) {
    if (statement.Effect !== "Allow") continue;
    for (const action of actions(statement)) {
      assert.notEqual(action, "*");
      assert.equal(action.endsWith(":*"), false);
    }
  }
}

const janitorBoundaryArn =
  "arn:aws:iam::402010193138:policy/TechlongSandboxCellJanitorBoundary";
const schedulerBoundaryArn =
  "arn:aws:iam::402010193138:policy/TechlongSandboxCellSchedulerInvokeBoundary";
const janitorRoleArn =
  "arn:aws:iam::402010193138:role/TechlongSandboxCellJanitorExecutionRole";
const schedulerRoleArn =
  "arn:aws:iam::402010193138:role/TechlongSandboxCellSchedulerInvokeRole";

assert.deepEqual(
  [...allowedActions(base, "CellJanitorBoundary")].sort(),
  [
    "cloudformation:DescribeStacks",
    "cloudformation:GetTemplate",
    "cloudformation:ListStackResources",
    "cloudformation:ListStacks",
    "dynamodb:GetItem",
    "logs:CreateLogStream",
    "logs:PutLogEvents",
  ],
);
assert.deepEqual(statementBySid(base, "CellJanitorBoundary", "AllowExactCellCleanupAuthorityRead"), {
  Sid: "AllowExactCellCleanupAuthorityRead",
  Effect: "Allow",
  Action: "dynamodb:GetItem",
  Resource:
    "arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority",
  Condition: {
    StringEquals: { "aws:RequestedRegion": "ca-central-1" },
    "ForAllValues:StringEquals": {
      "dynamodb:LeadingKeys": ["cell:cell-sandbox-1"],
    },
    Null: { "dynamodb:LeadingKeys": "false" },
  },
});
const janitorDenied = new Set(
  base.Resources.CellJanitorBoundary.Properties.PolicyDocument.Statement
    .filter((statement) => statement.Effect === "Deny")
    .flatMap(actions),
);
for (const action of [
  "cloudformation:DeleteStack",
  "cloudformation:UpdateStack",
  "dynamodb:PutItem",
  "dynamodb:UpdateItem",
  "ecs:RunTask",
  "iam:PassRole",
]) assert.ok(janitorDenied.has(action), `plan-only Janitor lacks explicit deny ${action}`);
assert.deepEqual(
  [...allowedActions(base, "CellSchedulerInvokeBoundary")],
  ["lambda:InvokeFunction"],
);
const janitorRole = base.Resources.CellJanitorExecutionRole.Properties;
assert.equal(janitorRole.RoleName, "TechlongSandboxCellJanitorExecutionRole");
assert.deepEqual(janitorRole.PermissionsBoundary, { Ref: "CellJanitorBoundary" });
assert.deepEqual(janitorRole.ManagedPolicyArns, [{ Ref: "CellJanitorBoundary" }]);
assert.equal(
  janitorRole.AssumeRolePolicyDocument.Statement[0].Principal.Service,
  "lambda.amazonaws.com",
);
const schedulerRole = base.Resources.CellSchedulerInvokeRole.Properties;
assert.equal(schedulerRole.RoleName, "TechlongSandboxCellSchedulerInvokeRole");
assert.deepEqual(schedulerRole.PermissionsBoundary, {
  Ref: "CellSchedulerInvokeBoundary",
});
assert.deepEqual(schedulerRole.ManagedPolicyArns, [
  { Ref: "CellSchedulerInvokeBoundary" },
]);
assert.equal(
  schedulerRole.AssumeRolePolicyDocument.Statement[0].Principal.Service,
  "scheduler.amazonaws.com",
);
assert.deepEqual(schedulerRole.AssumeRolePolicyDocument.Statement[0], {
  Effect: "Allow",
  Principal: { Service: "scheduler.amazonaws.com" },
  Action: "sts:AssumeRole",
  Condition: {
    StringEquals: {
      "aws:SourceAccount": "402010193138",
      "aws:SourceArn":
        "arn:aws:scheduler:ca-central-1:402010193138:schedule-group/techlong-sandbox-cell",
    },
  },
});

const executionAllows = allowedActions(base, "CellBootstrapExecutionBoundary");
for (const forbidden of [
  "cloudformation:CreateChangeSet",
  "ec2:CreateVpc",
  "ecs:CreateCluster",
  "ecs:RunTask",
  "elasticloadbalancing:CreateLoadBalancer",
  "rds:CreateDBCluster",
  "rds:CreateDBInstance",
  "secretsmanager:CreateSecret",
  "iam:CreatePolicy",
  "iam:CreatePolicyVersion",
  "iam:CreateRole",
  "iam:DeletePolicy",
  "iam:DeleteRole",
  "iam:PutRolePermissionsBoundary",
  "iam:PutRolePolicy",
  "iam:UpdateAssumeRolePolicy",
  "lambda:PutFunctionRecursionConfig",
  "lambda:PutRuntimeManagementConfig",
  "lambda:PutFunctionConcurrency",
  "lambda:DeleteFunctionConcurrency",
  "lambda:UntagResource",
  "logs:UntagResource",
  "scheduler:UntagResource",
]) {
  assert.equal(executionAllows.has(forbidden), false, `execution role allows ${forbidden}`);
}
for (const required of [
  "lambda:GetFunctionConcurrency",
  "lambda:UpdateFunctionCode",
  "lambda:UpdateFunctionConfiguration",
  "scheduler:UpdateSchedule",
]) {
  assert.ok(executionAllows.has(required), `execution role lacks ${required}`);
}
const exactScheduleLifecycle = statementBySid(
  base,
  "CellBootstrapExecutionBoundary",
  "AllowExactBootstrapScheduleLifecycle",
);
assert.deepEqual(exactScheduleLifecycle, {
  Sid: "AllowExactBootstrapScheduleLifecycle",
  Effect: "Allow",
  Action: ["scheduler:CreateSchedule", "scheduler:GetSchedule", "scheduler:UpdateSchedule"],
  Resource:
    "arn:aws:scheduler:ca-central-1:402010193138:schedule/techlong-sandbox-cell/techlong-sandbox-cell-global-janitor",
});
const scheduleGroupCleanup = statementBySid(
  base,
  "CellBootstrapExecutionBoundary",
  "AllowBootstrapScheduleGroupCleanup",
);
assert.deepEqual(scheduleGroupCleanup, {
  Sid: "AllowBootstrapScheduleGroupCleanup",
  Effect: "Allow",
  Action: "scheduler:DeleteSchedule",
  Resource:
    "arn:aws:scheduler:ca-central-1:402010193138:schedule/techlong-sandbox-cell/*",
});
const denied = new Set(
  base.Resources.CellBootstrapExecutionBoundary.Properties.PolicyDocument.Statement
    .filter((statement) => statement.Effect === "Deny")
    .flatMap(actions),
);
for (const action of [
  "ec2:CreateVpc",
  "ecs:CreateCluster",
  "ecs:RunTask",
  "elasticloadbalancing:CreateLoadBalancer",
  "rds:CreateDBCluster",
]) {
  assert.ok(denied.has(action), `missing explicit paid-resource deny ${action}`);
}
for (const action of [
  "iam:AttachRolePolicy",
  "iam:CreatePolicy",
  "iam:CreatePolicyVersion",
  "iam:CreateRole",
  "iam:DeletePolicy",
  "iam:DeletePolicyVersion",
  "iam:DeleteRole",
  "iam:DeleteRolePermissionsBoundary",
  "iam:DeleteRolePolicy",
  "iam:DetachRolePolicy",
  "iam:PutRolePermissionsBoundary",
  "iam:PutRolePolicy",
  "iam:SetDefaultPolicyVersion",
  "iam:TagRole",
  "iam:UntagRole",
  "iam:UpdateAssumeRolePolicy",
  "iam:UpdateRole",
  "iam:UpdateRoleDescription",
]) {
  assert.ok(denied.has(action), `missing immutable-runtime-identity deny ${action}`);
}
const immutableIdentityDeny =
  base.Resources.CellBootstrapExecutionBoundary.Properties.PolicyDocument.Statement.find(
    (statement) => statement.Sid === "DenyMutatingExternalRuntimeIdentities",
  );
assert.deepEqual(new Set(immutableIdentityDeny.Resource), new Set([
  janitorBoundaryArn,
  schedulerBoundaryArn,
  janitorRoleArn,
  schedulerRoleArn,
]));
const passStatements =
  base.Resources.CellBootstrapExecutionBoundary.Properties.PolicyDocument.Statement.filter(
    (statement) => statement.Effect === "Allow" && actions(statement).includes("iam:PassRole"),
  );
assert.deepEqual(
  passStatements.map((statement) => statement.Resource).sort(),
  [janitorRoleArn, schedulerRoleArn].sort(),
);
assert.deepEqual(
  passStatements.map((statement) => statement.Condition.StringEquals["iam:PassedToService"]).sort(),
  ["lambda.amazonaws.com", "scheduler.amazonaws.com"].sort(),
);
const executionText = JSON.stringify(
  base.Resources.CellBootstrapExecutionBoundary.Properties.PolicyDocument,
);
for (const forbiddenName of [
  "TechlongSandboxCellOperatorRole",
  "TechlongSandboxCellCloudFormationExecutionRole",
  "TechlongSandboxCellOperatorBoundary",
  "TechlongSandboxCellCloudFormationExecutionBoundary",
]) {
  assert.equal(executionText.includes(forbiddenName), false);
}

const authorActions = allowedActions(author, "CellBootstrapManagerBoundary");
assert.deepEqual(
  [...authorActions].filter((action) => action.startsWith("s3:")).sort(),
  ["s3:GetObject"],
);
assert.ok(authorActions.has("cloudformation:CreateChangeSet"));
assert.ok(authorActions.has("iam:PassRole"));
assert.ok(authorActions.has("s3:GetObject"));
assert.equal(authorActions.has("cloudformation:ExecuteChangeSet"), false);
assert.equal(authorActions.has("s3:ListBucket"), false);
assert.equal(authorActions.has("s3:PutObject"), false);
assert.equal(author.Metadata.SafetyBoundary.ManagerGrantState, "AUTHORGRANT");
assert.equal(author.Metadata.SafetyBoundary.ApprovedChangeSetName, exampleChangeSetName);
assert.equal(author.Metadata.SafetyBoundary.ApprovedTemplateSha256, exampleTemplateSha256);
assert.equal(author.Metadata.SafetyBoundary.ApprovedTemplateUrl, exampleTemplateUrl);
assert.equal(author.Metadata.SafetyBoundary.GrantExpiresAt, exampleExpiry);
const authorCreate = statementBySid(
  author,
  "CellBootstrapManagerBoundary",
  "TemporaryAllowAuthorExactBootstrapChangeSet",
);
assert.deepEqual(authorCreate.Resource, [
  "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-bootstrap/*",
  `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${exampleChangeSetName}/*`,
]);
assert.deepEqual(authorCreate.Condition, {
  StringEquals: {
    "aws:RequestedRegion": "ca-central-1",
    "aws:RequestTag/Environment": "aws-sandbox",
    "aws:RequestTag/ManagedBy": "techlong-cell-bootstrap-manager",
    "aws:RequestTag/Component": "b5-cell-bootstrap",
    "cloudformation:TemplateUrl": exampleTemplateUrl,
    "cloudformation:RoleARN":
      "arn:aws:iam::402010193138:role/TechlongSandboxCellBootstrapCloudFormationExecutionRole",
    "cloudformation:ChangeSetName": exampleChangeSetName,
  },
  "ForAllValues:StringEquals": {
    "aws:TagKeys": ["Environment", "ManagedBy", "Component"],
    "cloudformation:ResourceTypes": approvedBootstrapResourceTypes,
  },
  Null: { "cloudformation:ResourceTypes": "false" },
  DateLessThan: { "aws:CurrentTime": exampleExpiry },
});
const authorTemplateRead = statementBySid(
  author,
  "CellBootstrapManagerBoundary",
  "TemporaryAllowReadExactApprovedBootstrapTemplate",
);
assert.deepEqual(authorTemplateRead, {
  Sid: "TemporaryAllowReadExactApprovedBootstrapTemplate",
  Effect: "Allow",
  Action: "s3:GetObject",
  Resource: exampleTemplateObjectArn,
  Condition: { DateLessThan: { "aws:CurrentTime": exampleExpiry } },
});

const executeActions = allowedActions(execute, "CellBootstrapManagerBoundary");
assert.deepEqual(
  [...executeActions].filter((action) => action.startsWith("s3:")),
  [],
);
assert.ok(executeActions.has("cloudformation:ExecuteChangeSet"));
assert.equal(executeActions.has("cloudformation:CreateChangeSet"), false);
assert.equal(executeActions.has("iam:PassRole"), false);
assert.equal(executeActions.has("s3:GetObject"), false);
assert.equal(executeActions.has("s3:ListBucket"), false);
assert.equal(executeActions.has("s3:PutObject"), false);
const executeExactChangeSet = statementBySid(
  execute,
  "CellBootstrapManagerBoundary",
  "TemporaryAllowExecuteExactBootstrapChangeSet",
);
assert.deepEqual(executeExactChangeSet, {
  Sid: "TemporaryAllowExecuteExactBootstrapChangeSet",
  Effect: "Allow",
  Action: "cloudformation:ExecuteChangeSet",
  Resource:
    "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-bootstrap/*",
  Condition: {
    StringEquals: {
      "aws:RequestedRegion": "ca-central-1",
      "cloudformation:ChangeSetName": exampleChangeSetName,
    },
    DateLessThan: { "aws:CurrentTime": exampleExpiry },
  },
});
assert.equal(execute.Metadata.SafetyBoundary.ManagerGrantState, "EXECUTEGRANT");
assert.equal(execute.Metadata.SafetyBoundary.ApprovedChangeSetName, exampleChangeSetName);
assert.equal(execute.Metadata.SafetyBoundary.ApprovedTemplateSha256, exampleTemplateSha256);
assert.equal(execute.Metadata.SafetyBoundary.ApprovedTemplateUrl, exampleTemplateUrl);
assert.equal(execute.Metadata.SafetyBoundary.GrantExpiresAt, exampleExpiry);

const rollbackActions = allowedActions(rollback, "CellBootstrapManagerBoundary");
assert.deepEqual(
  [...rollbackActions].filter((action) => action.startsWith("s3:")),
  [],
);
assert.ok(rollbackActions.has("cloudformation:DeleteStack"));
assert.ok(rollbackActions.has("iam:PassRole"));
assert.equal(rollbackActions.has("cloudformation:CreateChangeSet"), false);
assert.equal(rollbackActions.has("cloudformation:ExecuteChangeSet"), false);
assert.equal(rollbackActions.has("s3:GetObject"), false);
assert.equal(rollbackActions.has("s3:ListBucket"), false);
assert.equal(rollbackActions.has("s3:PutObject"), false);
assert.equal(rollback.Metadata.SafetyBoundary.ManagerGrantState, "ROLLBACKGRANT");
assert.equal(
  Object.hasOwn(rollback.Metadata.SafetyBoundary, "ApprovedTemplateSha256"),
  false,
);
assert.equal(
  Object.hasOwn(rollback.Metadata.SafetyBoundary, "ApprovedTemplateUrl"),
  false,
);
assert.equal(
  JSON.stringify(locked).includes("techlong-sandbox-build-source-402010193138-ca-central-1"),
  false,
);
assert.equal(
  JSON.stringify(rollback).includes("techlong-sandbox-build-source-402010193138-ca-central-1"),
  false,
);

await assert.rejects(
  renderB5CellBootstrapManagementTemplate({
    shape: "AuthorGrant",
    approvedChangeSetName: "techlong-s3-b5-cell-bootstrap-not-a-digest",
    approvedTemplateSha256: exampleTemplateSha256,
    grantExpiresAt: exampleExpiry,
  }),
  /digest-bound Change Set name/,
);
await assert.rejects(
  renderB5CellBootstrapManagementTemplate({
    shape: "AuthorGrant",
    approvedChangeSetName:
      "techlong-s3-b5-cell-bootstrap-rollback-ffffffffffffffff",
    approvedTemplateSha256: exampleTemplateSha256,
    grantExpiresAt: exampleExpiry,
  }),
  /must match the approved raw template SHA-256/,
);
await assert.rejects(
  renderB5CellBootstrapManagementTemplate({
    shape: "ExecuteGrant",
    approvedChangeSetName: exampleChangeSetName,
    approvedTemplateSha256: exampleTemplateSha256,
    grantExpiresAt: "2026-08-25T23:59:59Z",
  }),
  /canonical GrantExpiresAt/,
);
await assert.rejects(
  renderB5CellBootstrapManagementTemplate({
    shape: "AuthorGrant",
    approvedChangeSetName: exampleChangeSetName,
    grantExpiresAt: exampleExpiry,
  }),
  /raw template SHA-256/,
);
await assert.rejects(
  renderB5CellBootstrapManagementTemplate({
    shape: "ExecuteGrant",
    approvedChangeSetName: exampleChangeSetName,
    approvedTemplateSha256: exampleTemplateSha256.toUpperCase(),
    grantExpiresAt: exampleExpiry,
  }),
  /raw template SHA-256/,
);
await assert.rejects(
  renderB5CellBootstrapManagementTemplate({
    shape: "AuthorGrant",
    approvedChangeSetName: "techlong-s3-b5-cell-bootstrap-ffffffffffffffff",
    approvedTemplateSha256: exampleTemplateSha256,
    grantExpiresAt: exampleExpiry,
  }),
  /must match the approved raw template SHA-256/,
);
await assert.rejects(
  renderB5CellBootstrapManagementTemplate({
    shape: "Locked",
    approvedTemplateSha256: exampleTemplateSha256,
    grantExpiresAt: exampleExpiry,
  }),
  /accepts no grant inputs/,
);
await assert.rejects(
  renderB5CellBootstrapManagementTemplate({
    shape: "RollbackGrant",
    approvedTemplateSha256: exampleTemplateSha256,
    grantExpiresAt: exampleExpiry,
  }),
  /does not accept a Change Set name or template SHA-256/,
);

assert.match(
  operationScript,
  /\[ValidateSet\('LocalValidate', 'OnlineValidate', 'CreateChangeSet', 'InspectChangeSet', 'ExecuteChangeSet', 'Readback', 'Delete'\)\]/,
);
assert.match(operationScript, /InitialLocked/);
assert.match(
  operationScript,
  /\[ValidateSet\('AuthorityV2ConsumerUpdate', 'AuthorityV2ConsumerRollback'\)\]/,
);
assert.match(operationScript, /\[string\]\$ChildDeploymentShape = 'AuthorityV2ConsumerUpdate'/);
assert.match(operationScript, /render-b5-cell-bootstrap-j4c-deployed\.mjs/);
assert.match(
  operationScript,
  /\$ChildDeploymentShape -eq 'AuthorityV2ConsumerRollback'[\s\S]*techlong-s3-b5-cell-bootstrap-rollback-/,
);
assert.match(
  operationScript,
  /\$selectedChildRenderer = if \(\$ChildDeploymentShape -eq 'AuthorityV2ConsumerRollback'\)[\s\S]*\$deployedJ4cChildRenderer/,
);
assert.match(operationScript, /LockedPolicyRefresh/);
assert.match(operationScript, /BootstrapAuthorGrant/);
assert.match(operationScript, /BootstrapAuthorRevoke/);
assert.match(operationScript, /BootstrapExecuteGrant/);
assert.match(operationScript, /BootstrapExecuteRevoke/);
assert.match(operationScript, /BootstrapRollbackGrant/);
assert.match(operationScript, /BootstrapRollbackRevoke/);
assert.match(operationScript, /login_session/);
assert.match(operationScript, /list-mfa-devices/);
assert.match(operationScript, /New-ReadOnlyTemplateSnapshot/);
assert.match(operationScript, /ConfirmTemplateSha256/);
assert.match(operationScript, /ConfirmTemplateCanonicalSha256/);
assert.match(operationScript, /get-template/);
assert.match(operationScript, /template-stage', 'Original'/);
assert.match(operationScript, /simulate-principal-policy/);
assert.match(operationScript, /stack-delete-complete/);
assert.doesNotMatch(operationScript, /cloudformation', 'deploy'/);
assert.match(
  operationScript,
  /\$null -ne \$changeSet\.Capabilities -and @\(\$changeSet\.Capabilities\)\.Count -ne 0/,
  "management preflight must treat an omitted or null non-IAM child Capabilities field as empty",
);
assert.match(operationScript, /B5-J4c plan-only cleanup planner raw=/);
assert.match(operationScript, /B5-J5g-g plan-only authority-v2 consumer rollback raw=/);
assert.match(operationScript, /\$isInitialCreate = \[string\]\$changeSet\.OnStackFailure -ceq 'DELETE'/);
assert.match(operationScript, /\$expectedStackStatus = if \(\$isInitialCreate\) \{ 'REVIEW_IN_PROGRESS' \} else \{ 'UPDATE_COMPLETE' \}/);
assert.match(
  operationScript,
  /\$expectedResources = if \(\$isInitialCreate\) \{[\s\S]*CellJanitorLogGroup = 'AWS::Logs::LogGroup'[\s\S]*CellJanitorFunction = 'AWS::Lambda::Function'[\s\S]*CellSchedulerGroup = 'AWS::Scheduler::ScheduleGroup'[\s\S]*CellGlobalJanitorSchedule = 'AWS::Scheduler::Schedule'[\s\S]*\} else \{\s*@\{\s*CellJanitorFunction = 'AWS::Lambda::Function'\s*\}\s*\}/,
  "approved child CREATE must retain four resources while UPDATE permits only the Janitor Lambda",
);
assert.match(operationScript, /Approved child PlannerUpdate resource shape drifted/);
assert.match(operationScript, /\[string\]\$resource\.Action -cne 'Modify'/);
assert.match(operationScript, /\[string\]\$resource\.Replacement -cne 'False'/);
assert.match(operationScript, /\[string\]\$resource\.Scope\[0\] -cne 'Properties'/);
assert.match(
  operationScript,
  /-not \[string\]::IsNullOrEmpty\(\[string\]\$resource\.PolicyAction\)/,
);
assert.match(operationScript, /PlannerUpdate Lambda physical ID drifted/);
assert.doesNotMatch(operationScript, /PlannerUpdate Schedule physical ID drifted/);
assert.match(operationScript, /\$details = @\(\$resource\.Details\)/);
assert.match(operationScript, /\$details\.Count -lt 1/);
assert.match(operationScript, /\[string\]\$detail\.ChangeSource -cne 'DirectModification'/);
assert.match(operationScript, /\[string\]\$detail\.Evaluation -cne 'Static'/);
assert.match(operationScript, /\[string\]\$target\.Attribute -cne 'Properties'/);
assert.match(operationScript, /\[string\]\$target\.Name -cne 'Code'/);
assert.match(operationScript, /\[string\]\$target\.RequiresRecreation -cne 'Never'/);
assert.match(operationScript, /\[string\]\$target\.AttributeChangeType -cne 'Modify'/);
assert.match(operationScript, /\[string\]\$target\.Path -cnotmatch '\^\/Properties\/Code\(\?:\/ZipFile\)\?\$'/);
assert.doesNotMatch(operationScript, /ecs', 'run-task'/);
assert.match(
  operationScript,
  /\$versioningText = \(\(\$versioningOutput \| Out-String\)\.Trim\(\)\)[\s\S]*\[string\]::IsNullOrWhiteSpace\(\$versioningText\)[\s\S]*\[PSCustomObject\]@\{\}/,
  "an empty successful GetBucketVersioning response must mean exact unconfigured versioning",
);
for (const immutableBucketToken of [
  "DenyMutableSharedCellTemplateOperation",
  "DenySharedCellTemplateDeletion",
  "DenyBuildSourceLifecycleMutation",
  "$sharedCellTemplateObjectKeyPrefix/*",
  "$childTemplateObjectKeyPrefix/*",
  "s3:DeleteObjectVersion",
  "s3:PutLifecycleConfiguration",
  "get-bucket-lifecycle-configuration",
  "ExpireBuildSourcesAfterOneDay",
  "all_storage_classes_128K",
]) {
  assert.ok(
    operationScript.includes(immutableBucketToken),
    `source-bucket immutability readback is missing ${immutableBucketToken}`,
  );
}
assert.doesNotMatch(operationScript, /'s3api', 'delete-object'/);
assert.doesNotMatch(operationScript, /function Remove-ExactChildTemplateObject/);
assert.match(
  operationScript,
  /preserved the exact digest-addressed child template object as immutable evidence/,
);
assert.match(
  operationScript,
  /\$managerSimulationContext = \$requestedTags \+ @\([\s\S]*iam:PassedToService,ContextKeyValues=cloudformation\.amazonaws\.com/,
  "temporary-grant IAM simulations must provide the complete condition-key context",
);
assert.match(
  operationScript,
  /-Action 'cloudformation:CreateChangeSet' -ResourceArns @\(\$childStackArn\)/,
  "CreateChangeSet simulation must use its supported stack resource while the Change Set name remains condition-bound",
);
assert.doesNotMatch(
  operationScript,
  /-Action 'cloudformation:CreateChangeSet' -ResourceArns @\(\$childStackArn, \$changeSetArn\)/,
  "IAM Simulator cannot evaluate the not-yet-created Change Set ARN as a CreateChangeSet resource",
);
assert.match(
  operationScript,
  /-Action 'cloudformation:ExecuteChangeSet' -ResourceArns @\(\$childStackArn\)/,
  "ExecuteChangeSet simulation must use the target Stack resource while the exact Change Set name remains condition-bound",
);
assert.doesNotMatch(
  operationScript,
  /-Action 'cloudformation:ExecuteChangeSet' -ResourceArns @\(\$changeSetArn\)/,
  "ExecuteChangeSet is authorized against the target Stack resource, not the Change Set ARN",
);
assert.doesNotMatch(
  operationScript,
  /\$changeSet\.ChangeSetType|\$ChangeSet\.ChangeSetType/,
  "DescribeChangeSet does not return ChangeSetType; child CREATE or UPDATE is fenced by metadata and exact resource changes",
);
assert.match(
  operationScript,
  /-not \$AllowHistoricalVersions -and\s*\$versions\.Count -ne 1/,
  "immutable policies must retain exactly one current default version after CloudFormation updates",
);
assert.doesNotMatch(
  operationScript,
  /only default version v1/,
  "the sole default IAM policy version may legitimately advance beyond v1",
);

const executeGrantPreflightBlocks = [
  ...operationScript.matchAll(
    /if \(\$UpdateShape -eq 'BootstrapExecuteGrant'\) \{/g,
  ),
];
assert.equal(
  executeGrantPreflightBlocks.length,
  2,
  "ExecuteGrant must exact-check the child at both management Change Set authoring and execution",
);
const executeGrantFinalPreflight = executeGrantPreflightBlocks[1].index;
const executeManagementChangeSet = operationScript.indexOf(
  "'cloudformation', 'execute-change-set'",
);
assert.ok(
  executeGrantFinalPreflight < executeManagementChangeSet,
  "the final child preflight must run before the management Change Set is executed",
);
assert.match(
  operationScript.slice(executeGrantFinalPreflight, executeManagementChangeSet),
  /Assert-ExactBootstrapSourceBucket[\s\S]*Assert-ExactChildTemplateObject[\s\S]*Assert-ExactApprovedChildChangeSet[\s\S]*Assert-ChildSnapshotUnchanged[\s\S]*Assert-SnapshotUnchanged/,
  "the execution-time preflight must recheck the source bucket, immutable object, approved child Change Set and both snapshots",
);

console.log(
  "B5-J4c locked plan-only management root, fixed J4b predecessor, split temporary grants and paid-resource deny validation passed.",
);
