import { renderAwsSandboxSharedCellStackV3 } from "../../lib/deployments/cloudformation/shared-cell-stack-v3.ts";
import { RESERVED_RETIREMENT_RECOVERY_V7 as t } from "../../lib/deployments/execution/cell-reserved-retirement-recovery-v7.ts";
import type { DeploymentEnvironment } from "../../lib/deployments/environment.ts";

// Non-secret historical proposal input and synthetic provider rows. This file
// neither reads private local artifacts nor represents live cloud evidence.
export async function deletedIdentityFixtureV8() {
  const environment: DeploymentEnvironment = { id: "env_aws_sandbox_ca_central_1", key: "aws-sandbox-ca-central-1", name: "AWS Sandbox ca-central-1", kind: "aws_sandbox", driver: "aws_ecs_cell",
    expectedAccountId: "402010193138", region: "ca-central-1", cellKey: "cell-sandbox-1", baseDomain: "sandbox.techlong.cloud", applyEnabled: false, status: "active",
    policy: { budgetLimitCents: 5000, ttlSeconds: 7200, maxCells: 1, maxTenants: 1, maxTaskCount: 1, allowedProfiles: ["standard-v1"], allowNatGateway: false, allowInterfaceEndpoints: false,
      databaseEngine: "aurora-postgresql-serverless-v2", auroraPostgresMinimumVersion: "16.3", auroraPostgresEngineVersion: "16.14", auroraEngineMode: "provisioned", allowLimitlessDatabase: false,
      databaseMode: "tenant_database", auroraServerlessMinAcu: 0, auroraServerlessMaxAcu: 1, auroraSecondsUntilAutoPause: 300, allowDedicatedDatabase: false,
      allowMultiAzDatabase: false, allowRdsProxy: false, allowGlobalDatabase: false, logRetentionDays: 1 } };
  const plan = await renderAwsSandboxSharedCellStackV3({ base: { environment, requestedAt: 1791864155244, availabilityZones: ["ca-central-1a", "ca-central-1b"],
    certificateArn: "arn:aws:acm:ca-central-1:402010193138:certificate/6d1f2880-9f83-449c-930a-6b17516ef49d",
    controlTrustStoreArn: "arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/techlong-sandbox-control-v1/aa1771fd0469cc44" },
    ownerDeploymentId: "cell_birth_6747b981e3fc3e03a482f33b9b32a432", generation: 1, provisionEpoch: 1, launchNonce: "6747b981e3fc3e03a482f33b9b32a432" });
  const before = { StackId: t.stackId, StackName: t.stackName, StackStatus: "CREATE_COMPLETE", RoleARN: t.roleArn, DisableRollback: true, EnableTerminationProtection: false,
    CreationTime: "2026-10-13T04:31:49.431Z", Parameters: Object.entries(plan.phaseParameters.RESERVED).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })),
    Tags: Object.entries(plan.tags).map(([Key, Value]) => ({ Key, Value })), Outputs: [{ OutputKey: "BirthIntentSha256", OutputValue: plan.birthIntentSha256 }, { OutputKey: "CellExpiresAt", OutputValue: plan.intent.cellExpiresAt }] };
  const { EnableTerminationProtection: omitted, ...afterBase } = before; void omitted;
  const after = { ...afterBase, StackStatus: "DELETE_COMPLETE", DeletionTime: "2026-10-13T13:29:51.013Z" }, token = `cell-v7-retire-${"a".repeat(64)}`;
  const events = ["CREATE_IN_PROGRESS", "CREATE_COMPLETE", "DELETE_IN_PROGRESS", "DELETE_COMPLETE"].map((ResourceStatus, n) => ({ EventId: `fixture-${n}`, StackId: t.stackId, StackName: t.stackName,
    PhysicalResourceId: t.stackId, LogicalResourceId: t.stackName, ResourceType: "AWS::CloudFormation::Stack", ResourceStatus,
    ClientRequestToken: n < 2 ? plan.reservationClientToken : token, Timestamp: n < 2 ? "2026-10-13T04:31:49.431Z" : "2026-10-13T13:29:51.013Z" }));
  return { plan, before, after, events, token, attemptedAt: Date.parse("2026-10-13T13:29:50.058Z"), now: Date.parse("2026-10-13T13:31:00.000Z") };
}
