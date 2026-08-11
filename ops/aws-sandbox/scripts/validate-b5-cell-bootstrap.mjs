import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderB5CellBootstrapTemplate } from "./render-b5-cell-bootstrap.mjs";

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
const operatorPolicyPath = path.join(
  root,
  "policies",
  "cell-operator-permissions-boundary.example.json",
);

const [templateSource, operationScript, operatorPolicySource, renderedSource] =
  await Promise.all([
    readFile(templatePath, "utf8"),
    readFile(operationScriptPath, "utf8"),
    readFile(operatorPolicyPath, "utf8"),
    renderB5CellBootstrapTemplate(),
  ]);
const template = JSON.parse(templateSource);
const operatorPolicy = JSON.parse(operatorPolicySource);
const rendered = JSON.parse(renderedSource);
const resources = template.Resources ?? {};

assert.equal(template.Metadata.SafetyBoundary.CloudApplyEnabled, false);
assert.equal(template.Metadata.SafetyBoundary.CreatesSharedCell, false);
assert.equal(template.Metadata.SafetyBoundary.CreatesPaidCellResources, false);
assert.equal(
  template.Metadata.SafetyBoundary.CreatesBootstrapRuntimeResources,
  true,
);
assert.equal(template.Metadata.SafetyBoundary.MayIncurAwsCharges, true);
assert.equal(
  template.Metadata.SafetyBoundary.ApprovedCellStackName,
  "techlong-sandbox-cell-sandbox-1",
);
assert.deepEqual(template.Parameters.ExpectedAccountId.AllowedValues, [
  "402010193138",
]);
assert.deepEqual(template.Parameters.ExpectedRegion.AllowedValues, [
  "ca-central-1",
]);
assert.deepEqual(template.Parameters.CellOperatorPrincipalArn.AllowedValues, [
  "arn:aws:iam::402010193138:user/techlong-sandbox-dev",
]);
assert.ok(template.Conditions.IsExpectedAccount);
assert.ok(template.Conditions.IsExpectedRegion);
assert.ok(template.Conditions.IsExpectedTarget);
assert.match(operationScript, /\$cloudWriteReady\s*=\s*\$false/);
assert.match(
  operationScript,
  /if \(-not \$cloudWriteReady\)[\s\S]*?hard-disabled before any AWS API call/,
);

for (const [name, resource] of Object.entries(resources)) {
  assert.equal(
    resource.Condition,
    "IsExpectedTarget",
    `${name} must be protected by the exact account and region condition`,
  );
}

const forbiddenResourceTypes = new Set([
  "AWS::EC2::EIP",
  "AWS::EC2::Instance",
  "AWS::EC2::NatGateway",
  "AWS::EC2::VPC",
  "AWS::EC2::VPCEndpoint",
  "AWS::ECS::Cluster",
  "AWS::ECS::Service",
  "AWS::ElasticLoadBalancingV2::LoadBalancer",
  "AWS::RDS::DBCluster",
  "AWS::RDS::DBInstance",
  "AWS::Route53::HostedZone",
]);
for (const resource of Object.values(resources)) {
  assert.equal(
    forbiddenResourceTypes.has(resource.Type),
    false,
    `B5 bootstrap must not create paid Cell resource ${resource.Type}`,
  );
}
assert.equal(
  Object.values(resources).some((resource) =>
    ["AWS::IAM::User", "AWS::IAM::Group"].includes(resource.Type),
  ),
  false,
  "B5 bootstrap must not create or mutate IAM users/groups",
);

function statements(name) {
  return resources[name].Properties.PolicyDocument.Statement;
}

function actionList(statement) {
  if (!statement.Action) return [];
  return Array.isArray(statement.Action)
    ? statement.Action
    : [statement.Action];
}

for (const name of [
  "CellOperatorBoundary",
  "CellExecutionBoundary",
  "CellJanitorBoundary",
  "CellSchedulerInvokeBoundary",
]) {
  const policy = resources[name].Properties.PolicyDocument;
  assert.equal(policy.Version, "2012-10-17");
  assert.ok(
    Buffer.byteLength(JSON.stringify(policy), "utf8") <= 6_144,
    `${name} exceeds the IAM managed-policy document limit`,
  );
  for (const statement of policy.Statement) {
    if (statement.Effect !== "Allow") continue;
    for (const action of actionList(statement)) {
      assert.notEqual(action, "*", `${name} must not allow every action`);
      assert.equal(
        action.endsWith(":*"),
        false,
        `${name} must not allow a service-wide wildcard`,
      );
    }
  }
}

const deniedCostActions = new Set(
  statements("CellExecutionBoundary")
    .filter((statement) => statement.Effect === "Deny")
    .flatMap(actionList),
);
for (const action of [
  "aws-marketplace:Subscribe",
  "ec2:AllocateAddress",
  "ec2:CreateFleet",
  "ec2:CreateNatGateway",
  "ec2:CreateTransitGateway",
  "ec2:CreateVpcEndpoint",
  "ec2:PurchaseReservedInstancesOffering",
  "ec2:RequestSpotFleet",
  "ec2:RunInstances",
  "rds:CreateDBProxy",
  "rds:CreateGlobalCluster",
  "rds:PurchaseReservedDBInstancesOffering",
  "rds:RestoreDBClusterFromSnapshot",
  "rds:RestoreDBClusterToPointInTime",
]) {
  assert.ok(deniedCostActions.has(action), `missing cost deny ${action}`);
}
const auroraCreate = statements("CellExecutionBoundary").find(
  (statement) => statement.Sid === "AllowTaggedCellAuroraCreate",
);
assert.equal(
  auroraCreate.Condition.StringEquals["rds:DatabaseEngine"],
  "aurora-postgresql",
);
assert.equal(
  auroraCreate.Condition.StringEqualsIfExists["rds:DatabaseClass"],
  "db.serverless",
);
assert.equal(
  auroraCreate.Condition.StringEquals["aws:RequestTag/CellId"],
  "cell-sandbox-1",
);
const auroraLifecycle = statements("CellExecutionBoundary").find(
  (statement) => statement.Sid === "AllowExactCellAuroraLifecycle",
);
assert.deepEqual(auroraLifecycle.Resource, [
  "arn:aws:rds:ca-central-1:402010193138:cluster:techlong-sandbox-cell-sandbox-1",
  "arn:aws:rds:ca-central-1:402010193138:db:techlong-sandbox-cell-sandbox-1-writer",
  "arn:aws:rds:ca-central-1:402010193138:subgrp:techlong-sandbox-cell-sandbox-1",
]);

const operatorRole = resources.CellOperatorRole.Properties;
assert.deepEqual(
  operatorPolicy,
  resources.CellOperatorBoundary.Properties.PolicyDocument,
  "the reviewable Cell Operator policy must match the deployed boundary exactly",
);
assert.equal(operatorRole.RoleName, "TechlongSandboxCellOperatorRole");
assert.deepEqual(operatorRole.ManagedPolicyArns, [
  { Ref: "CellOperatorBoundary" },
]);
assert.deepEqual(operatorRole.PermissionsBoundary, {
  Ref: "CellOperatorBoundary",
});
const operatorTrust = operatorRole.AssumeRolePolicyDocument.Statement[0];
assert.deepEqual(operatorTrust.Principal, {
  AWS: { Ref: "CellOperatorPrincipalArn" },
});
assert.equal(
  operatorTrust.Condition.Bool["aws:MultiFactorAuthPresent"],
  "true",
);
assert.equal(
  operatorTrust.Condition.StringEquals["sts:RoleSessionName"],
  "techlong-sandbox-cell-operator",
);

const operatorAllows = new Set(
  statements("CellOperatorBoundary")
    .filter((statement) => statement.Effect === "Allow")
    .flatMap(actionList),
);
assert.ok(operatorAllows.has("cloudformation:CreateChangeSet"));
assert.ok(operatorAllows.has("cloudformation:DescribeChangeSet"));
assert.ok(operatorAllows.has("cloudformation:ExecuteChangeSet"));
assert.equal(operatorAllows.has("cloudformation:CreateStack"), false);
assert.equal(operatorAllows.has("cloudformation:UpdateStack"), false);
const operatorCreate = statements("CellOperatorBoundary").find(
  (statement) => statement.Sid === "AllowCreateOnlyReviewedCellChangeSet",
);
assert.deepEqual(operatorCreate.Resource, [
  "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/*",
  "arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-sandbox-cell-sandbox-1-*/*",
]);
assert.equal(
  operatorCreate.Condition.StringEquals["aws:RequestTag/CellId"],
  "cell-sandbox-1",
);
assert.equal(
  operatorCreate.Condition.Null["aws:RequestTag/ExpiresAt"],
  "false",
);

const executionRole = resources.CellCloudFormationExecutionRole.Properties;
assert.equal(
  executionRole.RoleName,
  "TechlongSandboxCellCloudFormationExecutionRole",
);
assert.deepEqual(executionRole.PermissionsBoundary, {
  Ref: "CellExecutionBoundary",
});
assert.deepEqual(executionRole.ManagedPolicyArns, [
  { Ref: "CellExecutionBoundary" },
]);
assert.equal(
  executionRole.AssumeRolePolicyDocument.Statement[0].Principal.Service,
  "cloudformation.amazonaws.com",
);
assert.equal(
  executionRole.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals[
    "aws:SourceAccount"
  ],
  "402010193138",
);

const janitorRole = resources.CellJanitorExecutionRole.Properties;
assert.equal(janitorRole.RoleName, "TechlongSandboxCellJanitorExecutionRole");
assert.deepEqual(janitorRole.PermissionsBoundary, {
  Ref: "CellJanitorBoundary",
});
assert.equal(
  resources.CellJanitorFunction.Properties.FunctionName,
  "techlong-sandbox-cell-janitor",
);
assert.equal(resources.CellJanitorFunction.Properties.Runtime, "nodejs22.x");
assert.equal(resources.CellJanitorFunction.Properties.Timeout, 60);
assert.equal(
  resources.CellJanitorLogGroup.Properties.RetentionInDays,
  1,
);
assert.equal(
  rendered.Resources.CellJanitorFunction.Properties.Code.ZipFile.includes(
    'exports.handler = async (event) =>',
  ),
  true,
);
assert.equal(renderedSource.includes("__CELL_JANITOR_INLINE_SOURCE__"), false);
assert.ok(Buffer.byteLength(renderedSource, "utf8") <= 51_200);

assert.equal(
  resources.CellSchedulerInvokeRole.Properties.RoleName,
  "TechlongSandboxCellSchedulerInvokeRole",
);
assert.deepEqual(
  resources.CellSchedulerInvokeRole.Properties.PermissionsBoundary,
  { Ref: "CellSchedulerInvokeBoundary" },
);
assert.deepEqual(
  resources.CellSchedulerInvokeRole.Properties.ManagedPolicyArns,
  [{ Ref: "CellSchedulerInvokeBoundary" }],
);
assert.equal(resources.CellSchedulerGroup.Properties.Name, "techlong-sandbox-cell");
const globalSchedule = resources.CellGlobalJanitorSchedule.Properties;
assert.equal(globalSchedule.GroupName.Ref, "CellSchedulerGroup");
assert.equal(globalSchedule.ScheduleExpression, "rate(15 minutes)");
assert.equal(globalSchedule.State, "ENABLED");
assert.equal(globalSchedule.Target.RetryPolicy.MaximumRetryAttempts, 10);
assert.deepEqual(JSON.parse(globalSchedule.Target.Input), {
  schemaVersion: 1,
  action: "scan_expired_shared_cell_stacks",
});

assert.match(
  operationScript,
  /\[ValidateSet\('LocalValidate', 'OnlineValidate', 'CreateChangeSet', 'ExecuteChangeSet'\)\]/,
);
assert.match(operationScript, /\[string\]\$Mode = 'LocalValidate'/);
assert.match(
  operationScript,
  /\^techlong-s3-b5-cell-bootstrap-/,
);
assert.doesNotMatch(operationScript, /cloudformation', 'deploy'/);
assert.doesNotMatch(operationScript, /cloudformation', '(?:create|update)-stack'/);
for (const acknowledgement of [
  "AcknowledgeAwsWrite",
  "AcknowledgeCreatesIamAndSchedulerResources",
  "AcknowledgeAdministratorBreakGlassRisk",
  "AcknowledgeChangeSetReviewed",
  "ConfirmAccountId",
  "ConfirmRegion",
  "ConfirmBootstrapStackName",
  "ConfirmExecutionPhrase",
]) {
  assert.match(operationScript, new RegExp(`\\$${acknowledgement}\\b`));
}
const createIndex = operationScript.indexOf(
  "'cloudformation', 'create-change-set'",
);
const executeIndex = operationScript.indexOf(
  "'cloudformation', 'execute-change-set'",
);
const identityIndex = operationScript.indexOf("sts get-caller-identity");
const earlyWriteGateIndex = operationScript.indexOf(
  "if ($Mode -eq 'CreateChangeSet' -or $Mode -eq 'ExecuteChangeSet')",
);
assert.ok(createIndex > operationScript.indexOf("Assert-WriteAcknowledgements"));
assert.ok(executeIndex > operationScript.indexOf("AcknowledgeChangeSetReviewed"));
assert.ok(executeIndex > operationScript.indexOf("ConfirmExecutionPhrase"));
assert.ok(earlyWriteGateIndex > 0 && earlyWriteGateIndex < identityIndex);
assert.match(
  operationScript,
  /I_ACKNOWLEDGE_B5_CELL_BOOTSTRAP_AWS_CHANGES/,
);
assert.match(
  operationScript,
  /The existing IAM user Administrator access remains a break-glass bypass/,
);

const combinedText = `${templateSource}\n${operationScript}\n${operatorPolicySource}\n${renderedSource}`;
for (const forbidden of [
  /AKIA[0-9A-Z]{16}/,
  /postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/i,
  /sk_(?:live|test)_[A-Za-z0-9]{16,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
]) {
  assert.doesNotMatch(combinedText, forbidden);
}

console.log(
  "B5 Cell Bootstrap render, exact-role IAM boundaries, Janitor fallback and two-step Change Set validation passed.",
);
