import type { DeploymentEnvironment } from "../../lib/deployments/environment.ts";
import { renderAwsSandboxSharedCellStackV3, type CellV3Phase } from "../../lib/deployments/cloudformation/shared-cell-stack-v3.ts";
import { AwsSdkCellStackEvidenceV3, type CellV3EvidenceProfile, type CellV3ReadSdk } from "../../lib/deployments/execution/aws-sdk-cell-stack-evidence-v3.ts";

export const v3Now = Date.parse("2026-10-12T16:00:00.000Z"), v3StackId = "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/12345678-1234-1234-1234-123456789012";
export function v3Environment(): DeploymentEnvironment { return {
  id: "env_aws_sandbox_ca_central_1", key: "aws-sandbox-ca-central-1", name: "AWS Sandbox ca-central-1", kind: "aws_sandbox", driver: "aws_ecs_cell",
  expectedAccountId: "402010193138", region: "ca-central-1", cellKey: "cell-sandbox-1", baseDomain: "sandbox.techlong.cloud", applyEnabled: false, status: "active",
  policy: { budgetLimitCents: 5000, ttlSeconds: 7200, maxCells: 1, maxTenants: 1, maxTaskCount: 1, allowedProfiles: ["standard-v1"], allowNatGateway: false, allowInterfaceEndpoints: false,
    databaseEngine: "aurora-postgresql-serverless-v2", auroraPostgresMinimumVersion: "16.3", auroraPostgresEngineVersion: "16.14", auroraEngineMode: "provisioned", allowLimitlessDatabase: false,
    databaseMode: "tenant_database", auroraServerlessMinAcu: 0, auroraServerlessMaxAcu: 1, auroraSecondsUntilAutoPause: 300, allowDedicatedDatabase: false,
    allowMultiAzDatabase: false, allowRdsProxy: false, allowGlobalDatabase: false, logRetentionDays: 1 } };
}
export async function v3Fixture(phase: CellV3Phase = "PAID", status = "UPDATE_COMPLETE", profile: CellV3EvidenceProfile = "provisioner") {
  const plan = await renderAwsSandboxSharedCellStackV3({ base: { environment: v3Environment(), requestedAt: v3Now, availabilityZones: ["ca-central-1a", "ca-central-1b"],
    certificateArn: "arn:aws:acm:ca-central-1:402010193138:certificate/12345678-1234-1234-1234-123456789012", controlTrustStoreArn: "arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/fixture/abc123" },
    ownerDeploymentId: "cell_birth_fixture", generation: 1, provisionEpoch: 1, launchNonce: "a".repeat(32) });
  const physical: Record<string, string> = { CellVpc: "vpc-0123456789abcdef0", PublicSubnetA: "subnet-0123456789abcdef0", PublicSubnetB: "subnet-0123456789abcdef1",
    TaskSecurityGroup: "sg-0123456789abcdef0", OneShotTaskSecurityGroup: "sg-0123456789abcdef1", CellCluster: "cell-sandbox-1", CellDatabaseCluster: plan.stackName,
    BusinessHttpsListener: "arn:aws:elasticloadbalancing:ca-central-1:402010193138:listener/app/fixture/1234567890abcdef/1234567890abcdef",
    ControlMtlsListener: "arn:aws:elasticloadbalancing:ca-central-1:402010193138:listener/app/fixture/1234567890abcdef/1234567890abcdee" };
  const definitions = plan.template.Resources as Record<string, { Type: string }>;
  const ids = phase === "RESERVED" ? [] : phase === "ARMED" ? ["CellLifecycleScheduleV3"] : plan.resourceLogicalIds;
  const resources = ids.map(id => ({ LogicalResourceId: id, PhysicalResourceId: physical[id] ?? `fixture-${id}`, ResourceType: definitions[id].Type, ResourceStatus: "CREATE_COMPLETE" }));
  const paidOutputs = { ClusterName: "cell-sandbox-1", VpcId: physical.CellVpc, SubnetIds: `${physical.PublicSubnetA},${physical.PublicSubnetB}`,
    TaskSecurityGroupId: physical.TaskSecurityGroup, OneShotTaskSecurityGroupId: physical.OneShotTaskSecurityGroup, HttpsListenerArn: physical.BusinessHttpsListener,
    ControlListenerArn: physical.ControlMtlsListener, DatabaseClusterIdentifier: plan.stackName, DatabaseEndpoint: "techlong-sandbox-cell-sandbox-1.cluster-fixture123.ca-central-1.rds.amazonaws.com",
    DatabaseMasterSecretArn: "arn:aws:secretsmanager:ca-central-1:402010193138:secret:rds!cluster-fixture123-ABC123" };
  const stack = { StackId: v3StackId, StackName: plan.stackName, StackStatus: status, RoleARN: "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole",
    EnableTerminationProtection: false, DisableRollback: true, CreationTime: new Date(v3Now), LastUpdatedTime: new Date(v3Now + 1000),
    Tags: Object.entries(plan.tags).map(([Key, Value]) => ({ Key, Value })), Parameters: Object.entries(plan.phaseParameters[phase]).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })),
    Outputs: Object.entries({ ...(phase === "PAID" ? paidOutputs : {}), CellExpiresAt: plan.tags.ExpiresAt, BirthIntentSha256: plan.birthIntentSha256 }).map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue })) };
  const identity = { Account: "402010193138", Arn: profile === "source_inspection" ? "arn:aws:iam::402010193138:user/techlong-sandbox-dev" :
    `arn:aws:sts::402010193138:assumed-role/${profile === "provisioner" ? "TechlongSandboxProvisionerRole" : "TechlongSandboxCellLifecycleCoordinatorRoleV3"}/fixture-session`, UserId: "AIDAV3GNMXTZEO7SHLC2X" };
  const calls: string[] = []; let time = v3Now + 2000, missing = false;
  const commands: CellV3ReadSdk["commands"] = Object.fromEntries(["identity", "describe", "template", "resources", "events", "list"].map(kind => [kind, class {
    kind = kind; input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }])) as unknown as CellV3ReadSdk["commands"];
  const handler = async (c: unknown) => { const x = c as { kind: string }; calls.push(x.kind);
    if (x.kind === "identity") return structuredClone(identity);
    if (x.kind === "describe") { if (missing) { const e = new Error(`Stack ${plan.stackName} does not exist`); e.name = "ValidationError"; throw e; } return { Stacks: [structuredClone(stack)] }; }
    if (x.kind === "template") return { TemplateBody: structuredClone(plan.template) };
    if (x.kind === "resources") return { StackResourceSummaries: structuredClone(resources) };
    if (x.kind === "events") return { StackEvents: [{ PhysicalResourceId: v3StackId, LogicalResourceId: plan.stackName, ResourceType: "AWS::CloudFormation::Stack", ResourceStatus: "CREATE_IN_PROGRESS", ClientRequestToken: plan.reservationClientToken }] };
    if (x.kind === "list") return { StackSummaries: missing ? [] : [{ StackName: plan.stackName, StackStatus: status }] };
    throw Error("fixture unexpected command");
  };
  const reader = new AwsSdkCellStackEvidenceV3({ sts: { send: handler }, cfn: { send: handler }, commands }, profile, () => time);
  return { plan, stack, resources, identity, reader, calls, read: () => reader.read(plan, v3StackId, new AbortController().signal),
    setTime: (t: number) => { time = t; }, markMissing: () => { missing = true; } };
}
