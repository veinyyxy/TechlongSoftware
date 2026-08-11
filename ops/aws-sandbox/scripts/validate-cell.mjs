import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderAwsSandboxSharedCellStack } from "../../../lib/deployments/cloudformation/shared-cell-stack.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const policy = JSON.parse(
  fs.readFileSync(
    path.join(root, "policies", "cell-operator-permissions-boundary.example.json"),
    "utf8",
  ),
);
const janitorSource = fs.readFileSync(
  path.join(root, "lambda", "cell-janitor.cjs"),
  "utf8",
);

const environment = {
  id: "env_aws_sandbox_ca_central_1",
  key: "aws-sandbox-ca-central-1",
  name: "AWS Sandbox ca-central-1",
  kind: "aws_sandbox",
  driver: "aws_ecs_cell",
  expectedAccountId: "402010193138",
  region: "ca-central-1",
  cellKey: "cell-sandbox-1",
  baseDomain: "sandbox.techlong.cloud",
  applyEnabled: false,
  status: "active",
  policy: {
    budgetLimitCents: 1_000,
    ttlSeconds: 7_200,
    maxCells: 1,
    maxTenants: 1,
    maxTaskCount: 1,
    allowedProfiles: ["standard-v1"],
    allowNatGateway: false,
    allowInterfaceEndpoints: false,
    databaseEngine: "aurora-postgresql-serverless-v2",
    auroraPostgresMinimumVersion: "16.3",
    auroraPostgresEngineVersion: "16.14",
    auroraEngineMode: "provisioned",
    allowLimitlessDatabase: false,
    databaseMode: "tenant_database",
    auroraServerlessMinAcu: 0,
    auroraServerlessMaxAcu: 1,
    auroraSecondsUntilAutoPause: 300,
    allowDedicatedDatabase: false,
    allowMultiAzDatabase: false,
    allowRdsProxy: false,
    allowGlobalDatabase: false,
    logRetentionDays: 1,
  },
};

const plan = renderAwsSandboxSharedCellStack({
  environment,
  requestedAt: Date.UTC(2026, 7, 9),
  availabilityZones: ["ca-central-1a", "ca-central-1b"],
  certificateArn:
    "arn:aws:acm:ca-central-1:402010193138:certificate/12345678-1234-1234-1234-123456789abc",
  controlTrustStoreArn:
    "arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/techlong-sandbox-control/0123456789abcdef",
  cellJanitorFunctionArn:
    "arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-janitor",
  cellSchedulerInvokeRoleArn:
    "arn:aws:iam::402010193138:role/TechlongSandboxCellSchedulerInvokeRole",
  cellSchedulerGroupName: "techlong-sandbox-cell",
});

assert.equal(plan.stackName, "techlong-sandbox-cell-sandbox-1");
assert.equal(plan.safety.renderOnly, true);
assert.equal(plan.safety.applyReady, false);
assert.equal(plan.safety.callsAws, false);
assert.equal(plan.safety.cleanupScheduleFirst, true);
assert.equal(plan.safety.maxCells, 1);
assert.equal(plan.safety.maxAcu, 1);
assert.equal(plan.safety.natGateways, 0);
assert.equal(plan.safety.interfaceEndpoints, 0);
assert.equal(plan.safety.cellTtlSeconds, 10_800);
assert.equal(plan.safety.tenantTtlSeconds, 7_200);
assert.equal(plan.safety.cleanupBufferSeconds, 900);
assert.equal(
  Date.parse(plan.tags.ExpiresAt) - Date.UTC(2026, 7, 9),
  10_800_000,
);
const resources = plan.template.Resources;
assert.equal(
  resources.CellCleanupSchedule.Properties.Target.RetryPolicy.MaximumRetryAttempts,
  10,
);
assert.equal(Object.keys(resources)[0], "CellCleanupSchedule");
const resourceTypes = Object.values(resources).map((resource) => resource.Type);
assert.equal(resourceTypes.includes("AWS::EC2::NatGateway"), false);
assert.equal(resourceTypes.includes("AWS::EC2::VPCEndpoint"), false);
assert.equal(
  resourceTypes.filter((type) => type === "AWS::RDS::DBCluster").length,
  1,
);
assert.equal(
  resourceTypes.filter((type) => type === "AWS::RDS::DBInstance").length,
  1,
);
for (const [name, resource] of Object.entries(resources)) {
  if (name === "CellCleanupSchedule") continue;
  const dependencies = Array.isArray(resource.DependsOn)
    ? resource.DependsOn
    : [resource.DependsOn].filter(Boolean);
  assert.ok(
    dependencies.includes("CellCleanupSchedule"),
    `${name} must depend directly on CellCleanupSchedule`,
  );
}
assert.deepEqual(
  resources.BusinessControlDenyRule.Properties.Conditions[0].PathPatternConfig.Values,
  ["/api/saas", "/api/saas/*"],
);
assert.equal(
  resources.ControlMtlsListener.Properties.MutualAuthentication.Mode,
  "verify",
);
assert.equal(
  resources.ControlMtlsListener.Properties.MutualAuthentication.IgnoreClientCertificateExpiry,
  false,
);
assert.equal(
  resources.CellDatabaseCluster.Properties.ServerlessV2ScalingConfiguration.MinCapacity,
  0,
);
assert.equal(
  resources.CellDatabaseCluster.Properties.ServerlessV2ScalingConfiguration.MaxCapacity,
  1,
);
assert.equal(resources.CellDatabaseWriter.Properties.AutoMinorVersionUpgrade, false);
assert.equal(
  resources.CellDatabaseWriter.Properties.PubliclyAccessible,
  false,
);
assert.equal(resources.CellDatabaseCluster.DeletionPolicy, "Delete");
assert.equal(resources.CellDatabaseLogGroup.Properties.RetentionInDays, 1);
assert.equal(resources.CellDatabaseLogGroup.DeletionPolicy, "Delete");

const policyText = JSON.stringify(policy);
assert.match(
  policyText,
  /stack\/techlong-sandbox-cell-sandbox-1\/\*/,
);
assert.doesNotMatch(policyText, /stack\/techlong-sandbox-cell-\*\/\*/);
assert.doesNotMatch(policyText, /stack\/techlong-sandbox-tenant-/);
assert.doesNotMatch(policyText, /"Action":"\*"/);
assert.doesNotMatch(policyText, /cloudformation:CreateStack/);
assert.doesNotMatch(policyText, /cloudformation:UpdateStack/);
assert.match(policyText, /cloudformation:CreateChangeSet/);
assert.match(policyText, /cloudformation:ExecuteChangeSet/);
assert.match(
  policyText,
  /TechlongSandboxCellCloudFormationExecutionRole/,
);
assert.match(policyText, /aws:ResourceTag\/Environment/);
assert.match(policyText, /aws:RequestTag\/ExpiresAt/);
assert.match(policyText, /AllowCreateOnlyReviewedCellChangeSet/);
assert.match(janitorSource, /listTenantStacks/);
assert.match(janitorSource, /CELL_TENANT_DRAIN_IN_PROGRESS/);
assert.match(janitorSource, /isOwnedTenantStackForCell/);

console.log("Shared Cell render, TTL ordering and operator boundary validation passed.");
