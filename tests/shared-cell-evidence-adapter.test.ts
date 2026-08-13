import assert from "node:assert/strict";
import test from "node:test";
import type { DeploymentEnvironment } from "../lib/deployments/environment.ts";
import {
  AwsSdkSharedCellEvidenceAdapter,
  createInjectedSharedCellSecurityPreflight,
} from "../lib/deployments/execution/shared-cell-evidence-adapter.ts";

const now = Date.UTC(2026, 7, 9);
const account = "402010193138";
const region = "ca-central-1";
const vpcId = "vpc-0123456789abcdef0";
const publicSubnets = ["subnet-0123456789abcdef0", "subnet-0123456789abcdef1"];
const databaseSubnets = ["subnet-0123456789abcdef2", "subnet-0123456789abcdef3"];
const albSg = "sg-0123456789abcdef1";
const taskSg = "sg-0123456789abcdef0";
const databaseSg = "sg-0123456789abcdef2";
const loadBalancerArn = `arn:aws:elasticloadbalancing:${region}:${account}:loadbalancer/app/techlong-sandbox-cell/0123456789abcdef`;
const httpsListenerArn = `arn:aws:elasticloadbalancing:${region}:${account}:listener/app/techlong-sandbox-cell/0123456789abcdef/0123456789abcdef`;
const controlListenerArn = `arn:aws:elasticloadbalancing:${region}:${account}:listener/app/techlong-sandbox-cell/0123456789abcdef/fedcba9876543210`;
const trustStoreArn = `arn:aws:elasticloadbalancing:${region}:${account}:truststore/techlong-sandbox-control/0123456789abcdef`;
const resourceTags = [
  { Key: "Environment", Value: "aws-sandbox" },
  { Key: "ManagedBy", Value: "techlong-cell-operator" },
  { Key: "CellId", Value: "cell-sandbox-1" },
  { Key: "ExpiresAt", Value: new Date(now + 10_800_000).toISOString() },
];

const environment: DeploymentEnvironment = {
  id: "env_aws_sandbox_ca_central_1",
  key: "aws-sandbox-ca-central-1",
  name: "AWS Sandbox ca-central-1",
  kind: "aws_sandbox",
  driver: "aws_ecs_cell",
  expectedAccountId: account,
  region,
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

const binding = {
  environmentId: environment.id,
  workerRoleArn: `arn:aws:iam::${account}:role/TechlongSandboxProvisionerRole`,
  cloudFormationRoleArn:
    `arn:aws:iam::${account}:role/TechlongSandboxCloudFormationExecutionRole`,
  tenantStackParameters: {
    ClusterName: "cell-sandbox-1",
    VpcId: vpcId,
    SubnetIds: publicSubnets.join(","),
    TaskSecurityGroupId: taskSg,
    HttpsListenerArn: httpsListenerArn,
    ControlListenerArn: controlListenerArn,
  },
  status: "active" as const,
};

function command(kind: string) {
  return class {
    readonly kind = kind;
    readonly input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  };
}

function dependencies(input: {
  accountId?: string;
  businessRulePriority?: string;
  calls: string[];
  signals?: AbortSignal[];
}) {
  const resolve = (kind: string): Record<string, unknown> => {
    input.calls.push(kind);
    switch (kind) {
      case "GetCallerIdentity":
        return {
          Account: input.accountId ?? account,
          Arn: `arn:aws:sts::${input.accountId ?? account}:assumed-role/TechlongSandboxProvisionerRole/techlong-sandbox-provisioner`,
        };
      case "DescribeClusters":
        return {
          clusters: [
            {
              clusterName: "cell-sandbox-1",
              clusterArn: `arn:aws:ecs:${region}:${account}:cluster/cell-sandbox-1`,
              status: "ACTIVE",
              tags: resourceTags,
            },
          ],
        };
      case "DescribeListeners":
        return {
          Listeners: [
            {
              ListenerArn: httpsListenerArn,
              LoadBalancerArn: loadBalancerArn,
              Protocol: "HTTPS",
              Port: 443,
              DefaultActions: [{ Type: "fixed-response" }],
            },
            {
              ListenerArn: controlListenerArn,
              LoadBalancerArn: loadBalancerArn,
              Protocol: "HTTPS",
              Port: 8443,
              MutualAuthentication: {
                Mode: "verify",
                TrustStoreArn: trustStoreArn,
              },
              DefaultActions: [{ Type: "fixed-response" }],
            },
          ],
        };
      case "DescribeDBClusters":
        return {
          DBClusters: [
            {
              DBClusterIdentifier: "techlong-sandbox-cell-sandbox-1",
              DBClusterArn: `arn:aws:rds:${region}:${account}:cluster:techlong-sandbox-cell-sandbox-1`,
              Status: "available",
              Engine: "aurora-postgresql",
              EngineVersion: "16.14",
              EngineMode: "provisioned",
              Port: 5432,
              StorageEncrypted: true,
              DeletionProtection: false,
              ServerlessV2ScalingConfiguration: {
                MinCapacity: 0,
                MaxCapacity: 1,
                SecondsUntilAutoPause: 300,
              },
              DBSubnetGroup: "techlong-sandbox-cell-sandbox-1",
              VpcSecurityGroups: [{ VpcSecurityGroupId: databaseSg }],
              TagList: resourceTags,
            },
          ],
        };
      case "DescribeLoadBalancers":
        return {
          LoadBalancers: [
            {
              LoadBalancerArn: loadBalancerArn,
              LoadBalancerName: "techlong-sandbox-cell-sandbox-1",
              Type: "application",
              Scheme: "internet-facing",
              State: { Code: "active" },
              VpcId: vpcId,
              SecurityGroups: [albSg],
              AvailabilityZones: publicSubnets.map((SubnetId) => ({ SubnetId })),
            },
          ],
        };
      case "DescribeRules":
        return {
          Rules: [
            {
              Priority: input.businessRulePriority ?? "1",
              Conditions: [
                {
                  Field: "path-pattern",
                  PathPatternConfig: { Values: ["/api/saas", "/api/saas/*"] },
                },
              ],
              Actions: [
                {
                  Type: "fixed-response",
                  FixedResponseConfig: { StatusCode: "404" },
                },
              ],
            },
          ],
        };
      case "DescribeTrustStores":
        return { TrustStores: [{ TrustStoreArn: trustStoreArn, Status: "ACTIVE" }] };
      case "DescribeElbv2Tags":
        return {
          TagDescriptions: [{ ResourceArn: loadBalancerArn, Tags: resourceTags }],
        };
      case "DescribeDBInstances":
        return {
          DBInstances: [
            {
              DBInstanceArn: `arn:aws:rds:${region}:${account}:db:techlong-sandbox-cell-sandbox-1-writer`,
              DBInstanceIdentifier: "techlong-sandbox-cell-sandbox-1-writer",
              DBInstanceStatus: "available",
              DBInstanceClass: "db.serverless",
              PubliclyAccessible: false,
              DBClusterIdentifier: "techlong-sandbox-cell-sandbox-1",
            },
          ],
        };
      case "DescribeDBSubnetGroups":
        return {
          DBSubnetGroups: [
            {
              DBSubnetGroupName: "techlong-sandbox-cell-sandbox-1",
              VpcId: vpcId,
              Subnets: databaseSubnets.map((SubnetIdentifier) => ({
                SubnetIdentifier,
              })),
            },
          ],
        };
      case "DescribeVpcs":
        return { Vpcs: [{ VpcId: vpcId, State: "available", Tags: resourceTags }] };
      case "DescribeSubnets":
        return {
          Subnets: [...publicSubnets, ...databaseSubnets].map((SubnetId, index) => ({
            SubnetId,
            VpcId: vpcId,
            AvailabilityZone: index % 2 === 0 ? "ca-central-1a" : "ca-central-1b",
            State: "available",
            MapPublicIpOnLaunch: index < 2,
            Tags: resourceTags,
          })),
        };
      case "DescribeSecurityGroups":
        return {
          SecurityGroups: [
            {
              GroupId: albSg,
              VpcId: vpcId,
              Tags: resourceTags,
              IpPermissions: [443, 8443].map((port) => ({
                IpProtocol: "tcp",
                FromPort: port,
                ToPort: port,
                IpRanges: [{ CidrIp: "0.0.0.0/0" }],
              })),
            },
            {
              GroupId: taskSg,
              VpcId: vpcId,
              Tags: resourceTags,
              IpPermissions: [
                {
                  IpProtocol: "tcp",
                  FromPort: 3000,
                  ToPort: 3000,
                  UserIdGroupPairs: [{ GroupId: albSg }],
                },
              ],
            },
            {
              GroupId: databaseSg,
              VpcId: vpcId,
              Tags: resourceTags,
              IpPermissions: [
                {
                  IpProtocol: "tcp",
                  FromPort: 5432,
                  ToPort: 5432,
                  UserIdGroupPairs: [{ GroupId: taskSg }],
                },
              ],
            },
          ],
        };
      default:
        throw new Error(`unexpected read command ${kind}`);
    }
  };
  const client = {
    send: async (
      value: unknown,
      options?: { abortSignal?: AbortSignal },
    ) => {
      if (options?.abortSignal) input.signals?.push(options.abortSignal);
      return resolve((value as { kind: string }).kind);
    },
  };
  return {
    clients: { sts: client, ecs: client, elbv2: client, ec2: client, rds: client },
    commands: {
      getCallerIdentity: command("GetCallerIdentity"),
      describeClusters: command("DescribeClusters"),
      describeListeners: command("DescribeListeners"),
      describeLoadBalancers: command("DescribeLoadBalancers"),
      describeRules: command("DescribeRules"),
      describeTrustStores: command("DescribeTrustStores"),
      describeElbv2Tags: command("DescribeElbv2Tags"),
      describeVpcs: command("DescribeVpcs"),
      describeSubnets: command("DescribeSubnets"),
      describeSecurityGroups: command("DescribeSecurityGroups"),
      describeDBClusters: command("DescribeDBClusters"),
      describeDBInstances: command("DescribeDBInstances"),
      describeDBSubnetGroups: command("DescribeDBSubnetGroups"),
    },
    now: () => now,
  };
}

test("injected Shared Cell adapter collects only read evidence and hashes it", async () => {
  const calls: string[] = [];
  const signals: AbortSignal[] = [];
  const adapter = new AwsSdkSharedCellEvidenceAdapter(
    region,
    dependencies({ calls, signals }),
  );
  const controller = new AbortController();
  const result = await adapter.verify({
    environment,
    binding,
    signal: controller.signal,
  });
  assert.equal(result.verified, true);
  assert.match(result.evidenceHash, /^[a-f0-9]{64}$/);
  assert.ok(calls.includes("DescribeDBClusters"));
  assert.ok(calls.includes("DescribeSecurityGroups"));
  assert.equal(calls.every((name) => /^(?:Get|Describe)/.test(name)), true);
  assert.equal(signals.length, calls.length);
  assert.equal(signals.every((item) => item === controller.signal), true);
});

test("wrong STS account stops before any resource read", async () => {
  const calls: string[] = [];
  const adapter = new AwsSdkSharedCellEvidenceAdapter(
    region,
    dependencies({ calls, accountId: "111111111111" }),
  );
  await assert.rejects(
    adapter.verify({ environment, binding, signal: new AbortController().signal }),
    /outside the reviewed Sandbox role/,
  );
  assert.deepEqual(calls, ["GetCallerIdentity"]);
});

test("an already-aborted security proof makes zero AWS SDK calls", async () => {
  const calls: string[] = [];
  const adapter = new AwsSdkSharedCellEvidenceAdapter(region, dependencies({ calls }));
  const controller = new AbortController();
  controller.abort(new Error("lease lost"));
  await assert.rejects(
    adapter.verify({ environment, binding, signal: controller.signal }),
    /lease lost/,
  );
  assert.deepEqual(calls, []);
});

test("a lower-priority business control deny rule is rejected", async () => {
  const calls: string[] = [];
  const adapter = new AwsSdkSharedCellEvidenceAdapter(
    region,
    dependencies({ calls, businessRulePriority: "2" }),
  );
  await assert.rejects(
    adapter.verify({ environment, binding, signal: new AbortController().signal }),
    /must reject \/api\/saas/,
  );
});

test("a Cell without the full tenant TTL plus cleanup buffer is rejected", async () => {
  const calls: string[] = [];
  const originalExpiry = resourceTags[3].Value;
  resourceTags[3].Value = new Date(now + 7_200_000).toISOString();
  try {
    const adapter = new AwsSdkSharedCellEvidenceAdapter(
      region,
      dependencies({ calls }),
    );
    await assert.rejects(
      adapter.verify({ environment, binding, signal: new AbortController().signal }),
      /full tenant TTL plus cleanup buffer/,
    );
  } finally {
    resourceTags[3].Value = originalExpiry;
  }
});

test("missing adapter is fail-closed without making a client", async () => {
  const adapter = createInjectedSharedCellSecurityPreflight(region);
  await assert.rejects(
    adapter.verify({ environment, binding, signal: new AbortController().signal }),
    /not configured/,
  );
});
