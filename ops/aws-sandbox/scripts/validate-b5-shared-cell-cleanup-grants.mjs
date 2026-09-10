import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  renderB5SharedCellCleanupGrantsTemplate,
  sharedCellCleanupGrantShapes,
} from "./render-b5-shared-cell-cleanup-grants.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const templatePath = path.join(
  root,
  "cloudformation",
  "s3-b5-shared-cell-cleanup-grants.template.json",
);
const operationPath = path.join(
  scriptDirectory,
  "s3-b5-shared-cell-cleanup-grants.ps1",
);

const authorityTableArn =
  "arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority";
const cellStackId =
  "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/12345678-1234-1234-1234-123456789012";
const cellCloudFormationRoleArn =
  "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole";
const writerRoleArn =
  "arn:aws:iam::402010193138:role/TechlongSandboxProvisionerRole";
const janitorRoleArn =
  "arn:aws:iam::402010193138:role/TechlongSandboxCellJanitorExecutionRole";
const writerLogicalId = "CleanupAuthorityWriterBoundaryCandidate";
const janitorLogicalId = "CellJanitorMutationBoundaryCandidate";
const predecessorSha256 = "01".repeat(32);
const candidateSha256 = "23".repeat(32);
const deletionPlanSha256 = "45".repeat(32);
const cellExpiresAt = "2026-09-07T11:59:59.000Z";
const reviewedAt = "2026-09-07T12:00:00.000Z";
const grantExpiresAt = "2026-09-07T12:10:00.000Z";
const cleanupAuthorityExpiresAt = "2026-09-07T12:30:00.000Z";

function actions(statement) {
  return Array.isArray(statement.Action)
    ? statement.Action
    : statement.Action
      ? [statement.Action]
      : [];
}

function allowedActions(template, logicalId) {
  return new Set(
    template.Resources[logicalId].Properties.PolicyDocument.Statement
      .filter((statement) => statement.Effect === "Allow")
      .flatMap(actions),
  );
}

function statementsByAction(template, logicalId, action) {
  return template.Resources[logicalId].Properties.PolicyDocument.Statement
    .filter(
      (statement) =>
        statement.Effect === "Allow" && actions(statement).includes(action),
    );
}

function policyCharacters(document) {
  return JSON.stringify(document).replace(/\s/g, "").length;
}

const writerGrantInput = {
  shape: "AuthorityWriterGrant",
  expectedPredecessorItemSha256: predecessorSha256,
  approvedCandidateItemSha256: candidateSha256,
  cleanupAuthorityExpiresAt,
  reviewedAt,
  grantExpiresAt,
};
const janitorGrantInput = {
  shape: "JanitorDeleteGrant",
  approvedDeletionPlanSha256: deletionPlanSha256,
  approvedCellExpiresAt: cellExpiresAt,
  approvedCellStackId: cellStackId,
  cleanupAuthorityExpiresAt,
  reviewedAt,
  grantExpiresAt,
};

const [templateSource, operationSource, ...renderedSources] = await Promise.all([
  readFile(templatePath, "utf8"),
  readFile(operationPath, "utf8"),
  renderB5SharedCellCleanupGrantsTemplate({ shape: "Locked" }),
  renderB5SharedCellCleanupGrantsTemplate(writerGrantInput),
  renderB5SharedCellCleanupGrantsTemplate({ shape: "AuthorityWriterRevoke" }),
  renderB5SharedCellCleanupGrantsTemplate(janitorGrantInput),
  renderB5SharedCellCleanupGrantsTemplate({ shape: "JanitorDeleteRevoke" }),
]);
const base = JSON.parse(templateSource);
const [locked, writerGrant, writerRevoke, janitorGrant, janitorRevoke] =
  renderedSources.map((source) => JSON.parse(source));

assert.deepEqual(sharedCellCleanupGrantShapes, [
  "Locked",
  "AuthorityWriterGrant",
  "AuthorityWriterRevoke",
  "JanitorDeleteGrant",
  "JanitorDeleteRevoke",
]);

const safety = base.Metadata.SafetyBoundary;
for (const key of [
  "CloudApplyEnabled",
  "ApplyReady",
  "CleanupReady",
  "CreatesSharedCell",
  "CreatesPaidCellResources",
  "ExistingRolesModified",
  "ExistingLambdaModified",
  "ExistingScheduleModified",
  "CurrentJanitorBoundaryReplacementReady",
  "AuthorityWriterRuntimeWiringReady",
  "JanitorMutationRuntimeWiringReady",
]) {
  assert.equal(safety[key], false, `${key} must stay false`);
}
for (const key of [
  "LocalValidateOnly",
  "CreatesIamOnly",
  "CandidatePoliciesUnattached",
  "PreOnlineReviewRequired",
  "WriterAndDeleterSeparated",
  "GrantsMutuallyExclusive",
  "StrongCleanupAuthorityReadRequired",
  "ZeroTenantEvidenceRequired",
  "StandardDeletionModeRequired",
  "StableClientRequestTokenRequired",
  "ExactStackIdRequired",
  "DeleteRoleArnConditionRequired",
  "NoReturnedAuthorityValuesRequired",
]) {
  assert.equal(safety[key], true, `${key} must stay true`);
}
assert.equal(safety.CurrentJanitorMode, "PLAN_ONLY");
assert.equal(safety.GrantState, "LOCKED");
assert.equal(safety.AuthorityWriterTargetRoleArn, writerRoleArn);
assert.equal(safety.JanitorTargetRoleArn, janitorRoleArn);
assert.notEqual(writerRoleArn, janitorRoleArn);
assert.equal(safety.CellCloudFormationExecutionRoleArn, cellCloudFormationRoleArn);
assert.equal(safety.AuthorityTableArn, authorityTableArn);
assert.equal(safety.AuthorityKey, "cell:cell-sandbox-1");
assert.equal(safety.MaximumGrantSeconds, 900);

assert.deepEqual(
  Object.fromEntries(
    Object.entries(base.Resources).map(([logicalId, resource]) => [
      logicalId,
      resource.Type,
    ]),
  ),
  {
    CleanupAuthorityWriterBoundaryCandidate: "AWS::IAM::ManagedPolicy",
    CellJanitorMutationBoundaryCandidate: "AWS::IAM::ManagedPolicy",
  },
);
for (const template of [base, locked, writerGrant, writerRevoke, janitorGrant, janitorRevoke]) {
  assert.ok(Buffer.byteLength(JSON.stringify(template), "utf8") <= 51_200);
  assert.equal(template.Metadata.SafetyBoundary.CloudApplyEnabled, false);
  assert.equal(template.Metadata.SafetyBoundary.CandidatePoliciesUnattached, true);
  for (const logicalId of [writerLogicalId, janitorLogicalId]) {
    const properties = template.Resources[logicalId].Properties;
    assert.equal(Object.hasOwn(properties, "Roles"), false);
    assert.equal(Object.hasOwn(properties, "Users"), false);
    assert.equal(Object.hasOwn(properties, "Groups"), false);
    assert.ok(policyCharacters(properties.PolicyDocument) <= 6_144);
  }
  const source = JSON.stringify(template);
  assert.equal(source.includes("AWS::IAM::Role"), false);
  assert.equal(source.includes("AWS::Lambda::Function"), false);
  assert.equal(source.includes("AWS::Scheduler::Schedule"), false);
}

assert.deepEqual(
  [...allowedActions(locked, writerLogicalId)].sort(),
  ["dynamodb:GetItem", "sts:GetCallerIdentity"],
);
for (const template of [base, locked, writerGrant, writerRevoke, janitorGrant, janitorRevoke]) {
  assert.deepEqual(
    statementsByAction(template, writerLogicalId, "dynamodb:GetItem"),
    [
      {
        Sid: "AllowExactCleanupAuthorityStrongRead",
        Effect: "Allow",
        Action: "dynamodb:GetItem",
        Resource: authorityTableArn,
        Condition: {
          StringEquals: { "aws:RequestedRegion": "ca-central-1" },
          "ForAllValues:StringEquals": {
            "dynamodb:LeadingKeys": ["cell:cell-sandbox-1"],
          },
          Null: { "dynamodb:LeadingKeys": "false" },
        },
      },
    ],
  );
}
assert.deepEqual(
  [...allowedActions(locked, janitorLogicalId)].sort(),
  [
    "cloudformation:DescribeStacks",
    "cloudformation:GetTemplate",
    "cloudformation:ListStackResources",
    "cloudformation:ListStacks",
    "dynamodb:GetItem",
    "sts:GetCallerIdentity",
  ],
);
for (const template of [locked, writerRevoke, janitorRevoke]) {
  assert.equal(allowedActions(template, writerLogicalId).has("dynamodb:PutItem"), false);
  assert.equal(
    allowedActions(template, janitorLogicalId).has("cloudformation:DeleteStack"),
    false,
  );
  assert.equal(allowedActions(template, janitorLogicalId).has("iam:PassRole"), false);
  assert.equal(JSON.stringify(template).includes("TemporaryAllow"), false);
}
assert.equal(writerRevoke.Metadata.SafetyBoundary.GrantState, "AUTHORITY_WRITER_REVOKE");
assert.equal(janitorRevoke.Metadata.SafetyBoundary.GrantState, "JANITOR_DELETE_REVOKE");
assert.deepEqual(
  writerRevoke.Resources[writerLogicalId].Properties.PolicyDocument,
  locked.Resources[writerLogicalId].Properties.PolicyDocument,
);
assert.deepEqual(
  janitorRevoke.Resources[janitorLogicalId].Properties.PolicyDocument,
  locked.Resources[janitorLogicalId].Properties.PolicyDocument,
);

assert.equal(writerGrant.Metadata.SafetyBoundary.GrantState, "AUTHORITY_WRITER_GRANT");
assert.equal(
  writerGrant.Metadata.SafetyBoundary.ExpectedPredecessorItemSha256,
  predecessorSha256,
);
assert.equal(
  writerGrant.Metadata.SafetyBoundary.ApprovedCandidateItemSha256,
  candidateSha256,
);
assert.equal(writerGrant.Metadata.SafetyBoundary.ReviewedAt, reviewedAt);
assert.equal(writerGrant.Metadata.SafetyBoundary.GrantExpiresAt, grantExpiresAt);
assert.equal(
  writerGrant.Metadata.SafetyBoundary.CleanupAuthorityExpiresAt,
  cleanupAuthorityExpiresAt,
);
assert.equal(writerGrant.Metadata.SafetyBoundary.ApplicationDigestFenceRequired, true);
assert.equal(
  writerGrant.Metadata.SafetyBoundary.IamCannotBindRecordBodyOrClientRequestToken,
  true,
);
assert.deepEqual(
  statementsByAction(writerGrant, writerLogicalId, "dynamodb:PutItem"),
  [
    {
      Sid: "TemporaryAllowExactCleanupAuthorityCasPut",
      Effect: "Allow",
      Action: "dynamodb:PutItem",
      Resource: authorityTableArn,
      Condition: {
        StringEquals: {
          "aws:RequestedRegion": "ca-central-1",
          "dynamodb:ReturnValues": "NONE",
        },
        "ForAllValues:StringEquals": {
          "dynamodb:LeadingKeys": ["cell:cell-sandbox-1"],
          "dynamodb:Attributes": [
            "authority_key",
            "schema_version",
            "revision",
            "record_json",
          ],
        },
        Null: {
          "dynamodb:LeadingKeys": "false",
          "dynamodb:Attributes": "false",
        },
        DateGreaterThanEquals: { "aws:CurrentTime": reviewedAt },
        DateLessThan: { "aws:CurrentTime": grantExpiresAt },
      },
    },
  ],
);
assert.equal(
  allowedActions(writerGrant, janitorLogicalId).has("cloudformation:DeleteStack"),
  false,
);
assert.equal(allowedActions(writerGrant, janitorLogicalId).has("iam:PassRole"), false);
assert.equal(
  statementsByAction(writerGrant, janitorLogicalId, "dynamodb:PutItem").length,
  0,
);

assert.equal(janitorGrant.Metadata.SafetyBoundary.GrantState, "JANITOR_DELETE_GRANT");
assert.equal(
  janitorGrant.Metadata.SafetyBoundary.ApprovedDeletionPlanSha256,
  deletionPlanSha256,
);
assert.equal(
  janitorGrant.Metadata.SafetyBoundary.ApprovedCellExpiresAt,
  cellExpiresAt,
);
assert.equal(
  janitorGrant.Metadata.SafetyBoundary.ApprovedCellStackId,
  cellStackId,
);
assert.deepEqual(
  statementsByAction(janitorGrant, janitorLogicalId, "cloudformation:DeleteStack"),
  [
    {
      Sid: "TemporaryAllowDeleteExactExpiredCellStack",
      Effect: "Allow",
      Action: "cloudformation:DeleteStack",
      Resource: cellStackId,
      Condition: {
        StringEquals: {
          "aws:RequestedRegion": "ca-central-1",
          "aws:ResourceTag/Environment": "aws-sandbox",
          "aws:ResourceTag/ManagedBy": "techlong-cell-operator",
          "aws:ResourceTag/CellId": "cell-sandbox-1",
          "aws:ResourceTag/ExpiresAt": cellExpiresAt,
        },
        ArnEquals: {
          "cloudformation:RoleArn": cellCloudFormationRoleArn,
        },
        DateGreaterThanEquals: { "aws:CurrentTime": reviewedAt },
        DateLessThan: { "aws:CurrentTime": grantExpiresAt },
      },
    },
  ],
);
assert.deepEqual(
  statementsByAction(janitorGrant, janitorLogicalId, "iam:PassRole"),
  [
    {
      Sid: "TemporaryAllowPassOnlyDedicatedCellCloudFormationRole",
      Effect: "Allow",
      Action: "iam:PassRole",
      Resource: cellCloudFormationRoleArn,
      Condition: {
        StringEquals: { "iam:PassedToService": "cloudformation.amazonaws.com" },
        DateGreaterThanEquals: { "aws:CurrentTime": reviewedAt },
        DateLessThan: { "aws:CurrentTime": grantExpiresAt },
      },
    },
  ],
);
assert.equal(allowedActions(janitorGrant, writerLogicalId).has("dynamodb:PutItem"), false);
assert.equal(
  statementsByAction(janitorGrant, janitorLogicalId, "dynamodb:PutItem").length,
  0,
);

for (const template of [locked, writerGrant, writerRevoke, janitorGrant, janitorRevoke]) {
  const writerAllows = allowedActions(template, writerLogicalId);
  const janitorAllows = allowedActions(template, janitorLogicalId);
  for (const forbidden of [
    "cloudformation:CreateChangeSet",
    "cloudformation:CreateStack",
    "cloudformation:ExecuteChangeSet",
    "cloudformation:UpdateStack",
    "ec2:CreateVpc",
    "ecs:CreateCluster",
    "ecs:CreateService",
    "ecs:RunTask",
    "elasticloadbalancing:CreateLoadBalancer",
    "lambda:UpdateFunctionCode",
    "lambda:UpdateFunctionConfiguration",
    "rds:CreateDBCluster",
    "rds:CreateDBInstance",
    "scheduler:CreateSchedule",
    "scheduler:UpdateSchedule",
  ]) {
    assert.equal(writerAllows.has(forbidden), false, `writer allows ${forbidden}`);
    assert.equal(janitorAllows.has(forbidden), false, `Janitor allows ${forbidden}`);
  }
}

await assert.rejects(
  renderB5SharedCellCleanupGrantsTemplate({ shape: "Unknown" }),
  /unsupported J5g-c cleanup grant shape/,
);
await assert.rejects(
  renderB5SharedCellCleanupGrantsTemplate({
    shape: "Locked",
    grantExpiresAt,
  }),
  /accepts no grant inputs/,
);
await assert.rejects(
  renderB5SharedCellCleanupGrantsTemplate({
    ...writerGrantInput,
    approvedCandidateItemSha256: predecessorSha256,
  }),
  /predecessor and candidate must differ/,
);
await assert.rejects(
  renderB5SharedCellCleanupGrantsTemplate({
    ...writerGrantInput,
    approvedDeletionPlanSha256: deletionPlanSha256,
  }),
  /not accepted by this grant shape/,
);
await assert.rejects(
  renderB5SharedCellCleanupGrantsTemplate({
    ...writerGrantInput,
    grantExpiresAt: "2026-09-07T12:15:00.001Z",
  }),
  /within 15 minutes/,
);
await assert.rejects(
  renderB5SharedCellCleanupGrantsTemplate({
    ...janitorGrantInput,
    approvedCellExpiresAt: "2026-09-07T12:00:00.001Z",
  }),
  /already expired Shared Cell/,
);
await assert.rejects(
  renderB5SharedCellCleanupGrantsTemplate({
    ...janitorGrantInput,
    cleanupAuthorityExpiresAt: "2026-09-07T12:09:59.999Z",
  }),
  /must not outlive the cleanup-authority record/,
);
await assert.rejects(
  renderB5SharedCellCleanupGrantsTemplate({
    ...janitorGrantInput,
    reviewedAt: "2026-09-07T12:00:00Z",
  }),
  /canonical UTC with milliseconds/,
);
await assert.rejects(
  renderB5SharedCellCleanupGrantsTemplate({
    ...janitorGrantInput,
    approvedCellStackId:
      "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/*",
  }),
  /must be the exact Shared Cell Stack ARN/,
);
await assert.rejects(
  renderB5SharedCellCleanupGrantsTemplate({
    ...janitorGrantInput,
    approvedCellStackId:
      "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/22345678-1234-1234-1234-12345678901Z",
  }),
  /must be the exact Shared Cell Stack ARN/,
);
await assert.rejects(
  renderB5SharedCellCleanupGrantsTemplate({
    ...janitorGrantInput,
    expectedPredecessorItemSha256: predecessorSha256,
  }),
  /not accepted by this grant shape/,
);

assert.match(operationSource, /\[ValidateSet\('LocalValidate'\)\]/);
assert.match(operationSource, /\[string\]\$Mode = 'LocalValidate'/);
assert.match(operationSource, /validate-b5-shared-cell-cleanup-grants\.mjs/);
assert.match(operationSource, /LOCAL_ONLY_UNATTACHED_GRANTS_CURRENT_JANITOR_PLAN_ONLY/);
assert.doesNotMatch(operationSource, /\baws(?:\.exe)?\b/i);
assert.doesNotMatch(
  operationSource,
  /CreateChangeSet|ExecuteChangeSet|DeleteStack|PutItem|UpdateSchedule|UpdateFunctionCode/,
);

console.log(
  "B5-J5g-c local cleanup grant contract validated (unattached, two identities, five exclusive shapes, 15-minute maximum, no AWS apply).",
);
