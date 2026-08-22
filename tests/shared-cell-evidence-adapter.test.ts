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
const oneShotTaskSg = "sg-0123456789abcdef3";
const internetGatewayId = "igw-0123456789abcdef0";
const publicRouteTableId = "rtb-0123456789abcdef0";
const mainRouteTableId = "rtb-0123456789abcdef1";
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
    OneShotTaskSecurityGroupId: oneShotTaskSg,
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
  databaseForbiddenRouteTarget?: "default" | "igw" | "nat" | "eigw";
  internetGatewayAttachmentState?: string;
  omitPublicRouteAssociations?: boolean;
  oneShotIngress?: boolean;
  oneShotPublicEgressPort?: number;
  paginatedRouteTables?: boolean;
  publicRouteGatewayId?: string;
  publicRouteState?: string;
  publicRouteAssociationState?: string;
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
              IpPermissionsEgress: [],
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
              IpPermissionsEgress: [],
            },
            {
              GroupId: oneShotTaskSg,
              VpcId: vpcId,
              Tags: resourceTags,
              IpPermissions: input.oneShotIngress
                ? [
                    {
                      IpProtocol: "tcp",
                      FromPort: 22,
                      ToPort: 22,
                      IpRanges: [{ CidrIp: "0.0.0.0/0" }],
                    },
                  ]
                : [],
              IpPermissionsEgress: [
                {
                  IpProtocol: "tcp",
                  FromPort: input.oneShotPublicEgressPort ?? 443,
                  ToPort: input.oneShotPublicEgressPort ?? 443,
                  IpRanges: [{ CidrIp: "0.0.0.0/0" }],
                },
                {
                  IpProtocol: "tcp",
                  FromPort: 5432,
                  ToPort: 5432,
                  UserIdGroupPairs: [{ GroupId: databaseSg }],
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
                {
                  IpProtocol: "tcp",
                  FromPort: 5432,
                  ToPort: 5432,
                  UserIdGroupPairs: [{ GroupId: oneShotTaskSg }],
                },
              ],
              IpPermissionsEgress: [],
            },
          ],
        };
      case "DescribeRouteTables": {
        const forbiddenDatabaseRoute = (() => {
          switch (input.databaseForbiddenRouteTarget) {
            case "default":
              return {
                DestinationCidrBlock: "0.0.0.0/0",
                TransitGatewayId: "tgw-0123456789abcdef0",
                State: "active",
              };
            case "igw":
              return {
                DestinationCidrBlock: "10.99.0.0/16",
                GatewayId: internetGatewayId,
                State: "active",
              };
            case "nat":
              return {
                DestinationCidrBlock: "10.99.0.0/16",
                NatGatewayId: "nat-0123456789abcdef0",
                State: "active",
              };
            case "eigw":
              return {
                DestinationIpv6CidrBlock: "2001:db8::/64",
                EgressOnlyInternetGatewayId: "eigw-0123456789abcdef0",
                State: "active",
              };
            default:
              return null;
          }
        })();
        return {
          RouteTables: [
            {
              RouteTableId: publicRouteTableId,
              VpcId: vpcId,
              Associations: input.omitPublicRouteAssociations
                ? []
                : publicSubnets.map((SubnetId, index) => ({
                    RouteTableAssociationId: `rtbassoc-public-${index}`,
                    SubnetId,
                    Main: false,
                    AssociationState: {
                      State: input.publicRouteAssociationState ?? "associated",
                    },
                  })),
              Routes: [
                {
                  DestinationCidrBlock: "10.88.0.0/16",
                  GatewayId: "local",
                  State: "active",
                },
                {
                  DestinationCidrBlock: "0.0.0.0/0",
                  GatewayId: input.publicRouteGatewayId ?? internetGatewayId,
                  State: input.publicRouteState ?? "active",
                },
              ],
              Tags: resourceTags,
            },
            {
              RouteTableId: mainRouteTableId,
              VpcId: vpcId,
              Associations: [
                {
                  RouteTableAssociationId: "rtbassoc-main",
                  Main: true,
                  AssociationState: { State: "associated" },
                },
              ],
              Routes: [
                {
                  DestinationCidrBlock: "10.88.0.0/16",
                  GatewayId: "local",
                  State: "active",
                },
                ...(forbiddenDatabaseRoute ? [forbiddenDatabaseRoute] : []),
              ],
              Tags: [],
            },
          ],
          ...(input.paginatedRouteTables ? { NextToken: "page-two" } : {}),
        };
      }
      case "DescribeInternetGateways":
        return {
          InternetGateways: [
            {
              InternetGatewayId: internetGatewayId,
              Attachments: [
                {
                  VpcId: vpcId,
                  State: input.internetGatewayAttachmentState ?? "available",
                },
              ],
              Tags: resourceTags,
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
      describeRouteTables: command("DescribeRouteTables"),
      describeInternetGateways: command("DescribeInternetGateways"),
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
  assert.ok(calls.includes("DescribeRouteTables"));
  assert.ok(calls.includes("DescribeInternetGateways"));
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

test("one-shot task networking rejects inbound rules and non-HTTPS public egress", async (t) => {
  for (const [name, overrides] of [
    ["inbound", { oneShotIngress: true }],
    ["public egress", { oneShotPublicEgressPort: 80 }],
  ] as const) {
    await t.test(name, async () => {
      const adapter = new AwsSdkSharedCellEvidenceAdapter(
        region,
        dependencies({ calls: [], ...overrides }),
      );
      await assert.rejects(
        adapter.verify({
          environment,
          binding,
          signal: new AbortController().signal,
        }),
        /zero ingress.*public HTTPS.*exact database security group/,
      );
    });
  }
});

test("public task subnets require an exact active association and default route to the attached IGW", async (t) => {
  for (const [name, overrides, expected] of [
    [
      "implicit main association",
      { omitPublicRouteAssociations: true },
      /public subnet .* no active exact route table association/,
    ],
    [
      "pending association",
      { publicRouteAssociationState: "associating" },
      /does not have one active exact route table association/,
    ],
    [
      "blackhole default",
      { publicRouteState: "blackhole" },
      /active IPv4 default route.*exact attached VPC internet gateway/,
    ],
    [
      "different gateway",
      { publicRouteGatewayId: "igw-fedcba98765432100" },
      /active IPv4 default route.*exact attached VPC internet gateway/,
    ],
    [
      "detached gateway",
      { internetGatewayAttachmentState: "detached" },
      /exact available gateway attached to the reviewed VPC/,
    ],
  ] as const) {
    await t.test(name, async () => {
      const adapter = new AwsSdkSharedCellEvidenceAdapter(
        region,
        dependencies({ calls: [], ...overrides }),
      );
      await assert.rejects(
        adapter.verify({
          environment,
          binding,
          signal: new AbortController().signal,
        }),
        expected,
      );
    });
  }
});

test("database subnets reject defaults and IGW/NAT/EIGW routes", async (t) => {
  for (const target of ["default", "igw", "nat", "eigw"] as const) {
    await t.test(target, async () => {
      const adapter = new AwsSdkSharedCellEvidenceAdapter(
        region,
        dependencies({ calls: [], databaseForbiddenRouteTarget: target }),
      );
      await assert.rejects(
        adapter.verify({
          environment,
          binding,
          signal: new AbortController().signal,
        }),
        /database subnet .* must not have a public default.*NAT gateway.*egress-only internet gateway route/,
      );
    });
  }
});

test("paginated route evidence fails closed", async () => {
  const adapter = new AwsSdkSharedCellEvidenceAdapter(
    region,
    dependencies({ calls: [], paginatedRouteTables: true }),
  );
  await assert.rejects(
    adapter.verify({
      environment,
      binding,
      signal: new AbortController().signal,
    }),
    /route table or internet gateway evidence is paginated/,
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
