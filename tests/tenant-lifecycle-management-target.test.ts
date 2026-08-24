import assert from "node:assert/strict";
import test from "node:test";

import type { DeploymentEnvironment } from "../lib/deployments/environment.ts";
import type {
  DeploymentExecutionBinding,
  TenantResourceFence,
  TenantResourceIdentity,
} from "../lib/deployments/execution/contracts.ts";
import {
  AwsSdkSharedCellEvidenceAdapter,
  type AwsSdkSharedCellEvidenceDependencies,
} from "../lib/deployments/execution/shared-cell-evidence-adapter.ts";
import type {
  SharedCellSecurityObservation,
  VerifiedSharedCellLifecycleEvidence,
} from "../lib/deployments/execution/shared-cell-preflight.ts";
import {
  compileTenantLifecycleManagementTarget,
  projectTenantLifecycleManagementTargetForBackend,
  type TenantLifecycleManagementTargetInput,
} from "../lib/deployments/execution/tenant-lifecycle-management-target.ts";
import {
  compileOfflineTenantLifecycleTaskBinding,
  type OfflineTenantLifecycleTaskBinding,
} from "../lib/deployments/execution/tenant-lifecycle-task-binding.ts";

const now = Date.UTC(2026, 7, 24);
const accountId = "402010193138";
const region = "ca-central-1";
const cellId = "cell-sandbox-1";
const clusterArn = `arn:aws:ecs:${region}:${accountId}:cluster/${cellId}`;
const vpcId = "vpc-0123456789abcdef0";
const subnetIds = [
  "subnet-0123456789abcdef0",
  "subnet-0fedcba9876543210",
] as const;
const databaseSubnetIds = [
  "subnet-0123456789abcdef2",
  "subnet-0123456789abcdef3",
] as const;
const taskSecurityGroupId = "sg-0123456789abcdef1";
const oneShotSecurityGroupId = "sg-0123456789abcdef0";
const databaseSecurityGroupId = "sg-0123456789abcdef2";
const loadBalancerSecurityGroupId = "sg-0123456789abcdef3";
const internetGatewayId = "igw-0123456789abcdef0";
const managementEndpoint =
  "techlong-sandbox-cell-sandbox-1.cluster-abcdefghijkl." +
  "ca-central-1.rds.amazonaws.com";
const managementSecretArn =
  `arn:aws:secretsmanager:${region}:${accountId}:secret:` +
  "rds!cluster-01234567-89ab-cdef-0123-456789abcdef-ABCDEF";
const loadBalancerArn =
  `arn:aws:elasticloadbalancing:${region}:${accountId}:` +
  "loadbalancer/app/techlong-sandbox-cell/0123456789abcdef";
const httpsListenerArn =
  `arn:aws:elasticloadbalancing:${region}:${accountId}:` +
  "listener/app/techlong-sandbox-cell/0123456789abcdef/0123456789abcdef";
const controlListenerArn =
  `arn:aws:elasticloadbalancing:${region}:${accountId}:` +
  "listener/app/techlong-sandbox-cell/0123456789abcdef/fedcba9876543210";
const stableIdentityHash = "a".repeat(64);

const environment: DeploymentEnvironment = {
  id: "env_aws_sandbox_ca_central_1",
  key: "aws-sandbox-ca-central-1",
  name: "AWS Sandbox ca-central-1",
  kind: "aws_sandbox",
  driver: "aws_ecs_cell",
  expectedAccountId: accountId,
  region,
  cellKey: cellId,
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

const binding: DeploymentExecutionBinding = {
  environmentId: environment.id,
  workerRoleArn:
    `arn:aws:iam::${accountId}:role/TechlongSandboxProvisionerRole`,
  cloudFormationRoleArn:
    `arn:aws:iam::${accountId}:role/TechlongSandboxCloudFormationExecutionRole`,
  tenantStackParameters: {
    ClusterName: cellId,
    VpcId: vpcId,
    SubnetIds: subnetIds.join(","),
    TaskSecurityGroupId: taskSecurityGroupId,
    OneShotTaskSecurityGroupId: oneShotSecurityGroupId,
    HttpsListenerArn: httpsListenerArn,
    ControlListenerArn: controlListenerArn,
  },
  status: "active",
};

function ownedTags() {
  return {
    Environment: "aws-sandbox",
    ManagedBy: "techlong-cell-operator",
    CellId: cellId,
    ExpiresAt: new Date(now + 10_800_000).toISOString(),
  };
}

function sharedCellObservation(): SharedCellSecurityObservation {
  const tags = ownedTags();
  return {
    observedAt: now,
    accountId,
    callerArn:
      `arn:aws:sts::${accountId}:assumed-role/` +
      "TechlongSandboxProvisionerRole/fixture-readback",
    region,
    clusterName: cellId,
    clusterArn,
    clusterStatus: "ACTIVE",
    clusterTags: tags,
    vpcId,
    vpcState: "available",
    vpcTags: tags,
    subnetIds: [...subnetIds],
    subnets: [
      ...subnetIds.map((id, index) => ({
        id,
        vpcId,
        availabilityZone: `${region}${index === 0 ? "a" : "b"}`,
        state: "available",
        mapPublicIpOnLaunch: true,
        tags,
      })),
      ...databaseSubnetIds.map((id, index) => ({
        id,
        vpcId,
        availabilityZone: `${region}${index === 0 ? "a" : "b"}`,
        state: "available",
        mapPublicIpOnLaunch: false,
        tags,
      })),
    ],
    routeTables: [
      {
        id: "rtb-0123456789abcdef0",
        vpcId,
        associations: subnetIds.map((subnetId, index) => ({
          id: `rtbassoc-public-${index}`,
          subnetId,
          main: false,
          state: "associated",
        })),
        routes: [
          {
            destinationCidrIpv4: "10.88.0.0/16",
            state: "active",
            targetType: "local",
            targetId: "local",
          },
          {
            destinationCidrIpv4: "0.0.0.0/0",
            state: "active",
            targetType: "internet_gateway",
            targetId: internetGatewayId,
          },
        ],
        tags,
      },
      {
        id: "rtb-0123456789abcdef1",
        vpcId,
        associations: [
          {
            id: "rtbassoc-main",
            main: true,
            state: "associated",
          },
        ],
        routes: [
          {
            destinationCidrIpv4: "10.88.0.0/16",
            state: "active",
            targetType: "local",
            targetId: "local",
          },
        ],
        tags: {},
      },
    ],
    internetGateway: {
      id: internetGatewayId,
      attachments: [{ vpcId, state: "available" }],
      tags,
    },
    httpsListener: {
      arn: httpsListenerArn,
      loadBalancerArn,
      protocol: "HTTPS",
      port: 443,
      mutualAuthenticationMode: "off",
      trustStoreArn: null,
      trustStoreStatus: null,
      defaultActionType: "fixed-response",
      deniesSaasControlPaths: true,
    },
    controlListener: {
      arn: controlListenerArn,
      loadBalancerArn,
      protocol: "HTTPS",
      port: 8443,
      mutualAuthenticationMode: "verify",
      trustStoreArn:
        `arn:aws:elasticloadbalancing:${region}:${accountId}:` +
        "truststore/techlong-sandbox-control/0123456789abcdef",
      trustStoreStatus: "ACTIVE",
      defaultActionType: "fixed-response",
      deniesSaasControlPaths: false,
    },
    loadBalancer: {
      arn: loadBalancerArn,
      name: "techlong-sandbox-cell-sandbox-1",
      type: "application",
      scheme: "internet-facing",
      state: "active",
      vpcId,
      subnetIds: [...subnetIds],
      securityGroupIds: [loadBalancerSecurityGroupId],
      tags,
    },
    loadBalancerSecurityGroups: [
      {
        id: loadBalancerSecurityGroupId,
        vpcId,
        ingress: [
          {
            protocol: "tcp",
            fromPort: 443,
            toPort: 443,
            cidrIpv4: "0.0.0.0/0",
          },
          {
            protocol: "tcp",
            fromPort: 8443,
            toPort: 8443,
            cidrIpv4: "0.0.0.0/0",
          },
        ],
        egress: [],
        tags,
      },
    ],
    taskSecurityGroup: {
      id: taskSecurityGroupId,
      vpcId,
      ingress: [
        {
          protocol: "tcp",
          fromPort: 3000,
          toPort: 3000,
          sourceSecurityGroupId: loadBalancerSecurityGroupId,
        },
      ],
      egress: [],
      tags,
    },
    oneShotTaskSecurityGroup: {
      id: oneShotSecurityGroupId,
      vpcId,
      ingress: [],
      egress: [
        {
          protocol: "tcp",
          fromPort: 443,
          toPort: 443,
          cidrIpv4: "0.0.0.0/0",
        },
        {
          protocol: "tcp",
          fromPort: 5432,
          toPort: 5432,
          destinationSecurityGroupId: databaseSecurityGroupId,
        },
      ],
      tags,
    },
    databaseSecurityGroup: {
      id: databaseSecurityGroupId,
      vpcId,
      ingress: [
        {
          protocol: "tcp",
          fromPort: 5432,
          toPort: 5432,
          sourceSecurityGroupId: taskSecurityGroupId,
        },
        {
          protocol: "tcp",
          fromPort: 5432,
          toPort: 5432,
          sourceSecurityGroupId: oneShotSecurityGroupId,
        },
      ],
      egress: [],
      tags,
    },
    database: {
      arn:
        `arn:aws:rds:${region}:${accountId}:cluster:` +
        "techlong-sandbox-cell-sandbox-1",
      identifier: "techlong-sandbox-cell-sandbox-1",
      endpoint: managementEndpoint,
      masterSecretArn: managementSecretArn,
      masterSecretStatus: "active",
      masterUsername: "cell_admin",
      databaseName: "cell_admin",
      status: "available",
      engine: "aurora-postgresql",
      engineVersion: "16.14",
      engineMode: "provisioned",
      port: 5432,
      storageEncrypted: true,
      deletionProtection: false,
      serverlessMinAcu: 0,
      serverlessMaxAcu: 1,
      secondsUntilAutoPause: 300,
      vpcSecurityGroupIds: [databaseSecurityGroupId],
      subnetIds: [...databaseSubnetIds],
      tags,
      instances: [
        {
          arn:
            `arn:aws:rds:${region}:${accountId}:db:` +
            "techlong-sandbox-cell-sandbox-1-writer",
          identifier: "techlong-sandbox-cell-sandbox-1-writer",
          status: "available",
          instanceClass: "db.serverless",
          publiclyAccessible: false,
          clusterIdentifier: "techlong-sandbox-cell-sandbox-1",
        },
      ],
    },
  };
}

function command(kind: string) {
  return class {
    readonly kind = kind;
    readonly input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  };
}

function awsTags(tags: Record<string, string | undefined>) {
  return Object.entries(tags).flatMap(([Key, Value]) =>
    Value ? [{ Key, Value }] : [],
  );
}

function fixtureSdkDependencies(): AwsSdkSharedCellEvidenceDependencies {
  const observation = sharedCellObservation();
  const securityGroups = [
    ...observation.loadBalancerSecurityGroups,
    observation.taskSecurityGroup,
    observation.oneShotTaskSecurityGroup,
    observation.databaseSecurityGroup,
  ];
  const resolve = (kind: string): Record<string, unknown> => {
    switch (kind) {
      case "GetCallerIdentity":
        return {
          Account: observation.accountId,
          Arn: observation.callerArn,
        };
      case "DescribeClusters":
        return {
          clusters: [
            {
              clusterName: observation.clusterName,
              clusterArn: observation.clusterArn,
              status: observation.clusterStatus,
              tags: awsTags(observation.clusterTags),
            },
          ],
        };
      case "DescribeListeners":
        return {
          Listeners: [
            {
              ListenerArn: observation.httpsListener.arn,
              LoadBalancerArn: observation.httpsListener.loadBalancerArn,
              Protocol: observation.httpsListener.protocol,
              Port: observation.httpsListener.port,
              DefaultActions: [
                { Type: observation.httpsListener.defaultActionType },
              ],
            },
            {
              ListenerArn: observation.controlListener.arn,
              LoadBalancerArn: observation.controlListener.loadBalancerArn,
              Protocol: observation.controlListener.protocol,
              Port: observation.controlListener.port,
              MutualAuthentication: {
                Mode: observation.controlListener.mutualAuthenticationMode,
                TrustStoreArn: observation.controlListener.trustStoreArn,
              },
              DefaultActions: [
                { Type: observation.controlListener.defaultActionType },
              ],
            },
          ],
        };
      case "DescribeDBClusters":
        return {
          DBClusters: [
            {
              DBClusterIdentifier: observation.database.identifier,
              DBClusterArn: observation.database.arn,
              Endpoint: observation.database.endpoint,
              MasterUserSecret: {
                SecretArn: observation.database.masterSecretArn,
                SecretStatus: observation.database.masterSecretStatus,
              },
              MasterUsername: observation.database.masterUsername,
              DatabaseName: observation.database.databaseName,
              Status: observation.database.status,
              Engine: observation.database.engine,
              EngineVersion: observation.database.engineVersion,
              EngineMode: observation.database.engineMode,
              Port: observation.database.port,
              StorageEncrypted: observation.database.storageEncrypted,
              DeletionProtection: observation.database.deletionProtection,
              ServerlessV2ScalingConfiguration: {
                MinCapacity: observation.database.serverlessMinAcu,
                MaxCapacity: observation.database.serverlessMaxAcu,
                SecondsUntilAutoPause:
                  observation.database.secondsUntilAutoPause,
              },
              DBSubnetGroup: observation.database.identifier,
              VpcSecurityGroups: observation.database.vpcSecurityGroupIds.map(
                (VpcSecurityGroupId) => ({ VpcSecurityGroupId }),
              ),
              TagList: awsTags(observation.database.tags),
            },
          ],
        };
      case "DescribeLoadBalancers":
        return {
          LoadBalancers: [
            {
              LoadBalancerArn: observation.loadBalancer.arn,
              LoadBalancerName: observation.loadBalancer.name,
              Type: observation.loadBalancer.type,
              Scheme: observation.loadBalancer.scheme,
              State: { Code: observation.loadBalancer.state },
              VpcId: observation.loadBalancer.vpcId,
              SecurityGroups: observation.loadBalancer.securityGroupIds,
              AvailabilityZones: observation.loadBalancer.subnetIds.map(
                (SubnetId) => ({ SubnetId }),
              ),
            },
          ],
        };
      case "DescribeRules":
        return {
          Rules: [
            {
              Priority: "1",
              Conditions: [
                {
                  Field: "path-pattern",
                  PathPatternConfig: {
                    Values: ["/api/saas", "/api/saas/*"],
                  },
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
        return {
          TrustStores: [
            {
              TrustStoreArn: observation.controlListener.trustStoreArn,
              Status: observation.controlListener.trustStoreStatus,
            },
          ],
        };
      case "DescribeElbv2Tags":
        return {
          TagDescriptions: [
            {
              ResourceArn: observation.loadBalancer.arn,
              Tags: awsTags(observation.loadBalancer.tags),
            },
          ],
        };
      case "DescribeDBInstances":
        return {
          DBInstances: observation.database.instances.map((instance) => ({
            DBInstanceArn: instance.arn,
            DBInstanceIdentifier: instance.identifier,
            DBInstanceStatus: instance.status,
            DBInstanceClass: instance.instanceClass,
            PubliclyAccessible: instance.publiclyAccessible,
            DBClusterIdentifier: instance.clusterIdentifier,
          })),
        };
      case "DescribeDBSubnetGroups":
        return {
          DBSubnetGroups: [
            {
              DBSubnetGroupName: observation.database.identifier,
              VpcId: observation.vpcId,
              Subnets: observation.database.subnetIds.map(
                (SubnetIdentifier) => ({ SubnetIdentifier }),
              ),
            },
          ],
        };
      case "DescribeVpcs":
        return {
          Vpcs: [
            {
              VpcId: observation.vpcId,
              State: observation.vpcState,
              Tags: awsTags(observation.vpcTags),
            },
          ],
        };
      case "DescribeSubnets":
        return {
          Subnets: observation.subnets.map((subnet) => ({
            SubnetId: subnet.id,
            VpcId: subnet.vpcId,
            AvailabilityZone: subnet.availabilityZone,
            State: subnet.state,
            MapPublicIpOnLaunch: subnet.mapPublicIpOnLaunch,
            Tags: awsTags(subnet.tags),
          })),
        };
      case "DescribeSecurityGroups":
        return {
          SecurityGroups: securityGroups.map((group) => ({
            GroupId: group.id,
            VpcId: group.vpcId,
            Tags: awsTags(group.tags),
            IpPermissions: group.ingress.map((rule) => ({
              IpProtocol: rule.protocol,
              FromPort: rule.fromPort,
              ToPort: rule.toPort,
              ...(rule.cidrIpv4
                ? { IpRanges: [{ CidrIp: rule.cidrIpv4 }] }
                : {}),
              ...(rule.sourceSecurityGroupId
                ? {
                    UserIdGroupPairs: [
                      { GroupId: rule.sourceSecurityGroupId },
                    ],
                  }
                : {}),
            })),
            IpPermissionsEgress: group.egress.map((rule) => ({
              IpProtocol: rule.protocol,
              FromPort: rule.fromPort,
              ToPort: rule.toPort,
              ...(rule.cidrIpv4
                ? { IpRanges: [{ CidrIp: rule.cidrIpv4 }] }
                : {}),
              ...(rule.destinationSecurityGroupId
                ? {
                    UserIdGroupPairs: [
                      { GroupId: rule.destinationSecurityGroupId },
                    ],
                  }
                : {}),
            })),
          })),
        };
      case "DescribeRouteTables":
        return {
          RouteTables: observation.routeTables.map((routeTable) => ({
            RouteTableId: routeTable.id,
            VpcId: routeTable.vpcId,
            Associations: routeTable.associations.map((association) => ({
              RouteTableAssociationId: association.id,
              ...(association.subnetId
                ? { SubnetId: association.subnetId }
                : {}),
              Main: association.main,
              AssociationState: { State: association.state },
            })),
            Routes: routeTable.routes.map((route) => ({
              ...(route.destinationCidrIpv4
                ? { DestinationCidrBlock: route.destinationCidrIpv4 }
                : {}),
              State: route.state,
              GatewayId: route.targetId,
            })),
            Tags: awsTags(routeTable.tags),
          })),
        };
      case "DescribeInternetGateways":
        return {
          InternetGateways: [
            {
              InternetGatewayId: observation.internetGateway.id,
              Attachments: observation.internetGateway.attachments.map(
                (attachment) => ({
                  VpcId: attachment.vpcId,
                  State: attachment.state,
                }),
              ),
              Tags: awsTags(observation.internetGateway.tags),
            },
          ],
        };
      default:
        throw new Error(`Unexpected fixture command ${kind}.`);
    }
  };
  const client = {
    send: async (value: unknown) => resolve((value as { kind: string }).kind),
  };
  return {
    clients: {
      sts: client,
      ecs: client,
      elbv2: client,
      ec2: client,
      rds: client,
    },
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

async function adapterVerifiedEvidence(): Promise<VerifiedSharedCellLifecycleEvidence> {
  const adapter = new AwsSdkSharedCellEvidenceAdapter(
    region,
    fixtureSdkDependencies(),
  );
  return adapter.readVerifiedLifecycleEvidence({
    environment,
    binding,
    signal: new AbortController().signal,
  });
}

function taskBinding(): OfflineTenantLifecycleTaskBinding {
  return compileOfflineTenantLifecycleTaskBinding({
    expectedAccountId: accountId,
    expectedRegion: region,
    imageUri:
      `${accountId}.dkr.ecr.${region}.amazonaws.com/` +
      "techlong-sandbox-speedfeast@sha256:" +
      "0c4cb3ebfb55a944a24d548ded716d93dd00bcc4d1796c8e9eb588ce385710ae",
    taskDefinitionArn:
      `arn:aws:ecs:${region}:${accountId}:` +
      "task-definition/tenant-lifecycle:7",
    clusterArn,
    taskExecutionRoleArn:
      `arn:aws:iam::${accountId}:role/TechlongSandboxTaskExecutionRole`,
    lifecycleTaskRoleArn:
      `arn:aws:iam::${accountId}:role/TechlongSandboxTenantLifecycleTaskRole`,
    receiptBucketArn:
      `arn:aws:s3:::techlong-sandbox-${accountId}-${region}-tenant-receipts`,
    subnetIds,
    oneShotSecurityGroupId,
  });
}

function resourceFence(
  overrides: Partial<TenantResourceIdentity> = {},
): TenantResourceFence {
  const identity: TenantResourceIdentity = {
    schemaVersion: 1,
    appInstanceId: "app_tenant_one",
    workspaceId: "workspace_one",
    productId: "product_speedfeast",
    environmentId: "env_aws_sandbox_ca_central_1",
    cellKey: cellId,
    databaseName: "tenant_one_db",
    roleName: "tenant_one_role",
    secretName: "techlong/sandbox/tenant/tenant_one_0123456789/runtime",
    stableIdentityHash,
    ...overrides,
  };
  return {
    schemaVersion: 1,
    identity,
    generation: 1,
    ownerDeploymentId: "deployment_tenant_one",
    ownershipMarker: `tl_owner_${stableIdentityHash.slice(0, 32)}_g1`,
  };
}

function input(
  sharedCellEvidence: VerifiedSharedCellLifecycleEvidence,
  overrides: Partial<TenantLifecycleManagementTargetInput> = {},
): TenantLifecycleManagementTargetInput {
  return {
    taskBinding: taskBinding(),
    sharedCellEvidence,
    resourceFence: resourceFence(),
    ...overrides,
  };
}

function clockAt(value: number) {
  return { now: () => value };
}

function compileTarget(
  value: TenantLifecycleManagementTargetInput,
  currentTime = now,
) {
  return compileTenantLifecycleManagementTarget(value, clockAt(currentTime));
}

function projectTarget(
  target: Parameters<
    typeof projectTenantLifecycleManagementTargetForBackend
  >[0],
  currentTime = now,
) {
  return projectTenantLifecycleManagementTargetForBackend(
    target,
    clockAt(currentTime),
  );
}

test("compiles reviewed target and projects exact frozen backend wire keys", async () => {
  const evidence = await adapterVerifiedEvidence();
  const target = compileTarget(input(evidence));

  assert.deepEqual(Object.keys(target).sort(), [
    "cellId",
    "clusterArn",
    "databaseClusterIdentifier",
    "liveReadbackReady",
    "managementDatabase",
    "managementEndpoint",
    "managementPort",
    "managementSecretArn",
    "managementUsername",
    "registrationReady",
    "schemaVersion",
    "sharedCellEvidenceHash",
    "targetDatabaseName",
    "targetRoleName",
  ]);
  assert.equal(target.schemaVersion, 1);
  assert.equal(target.registrationReady, false);
  assert.equal(target.liveReadbackReady, false);
  assert.equal(target.targetDatabaseName, "tenant_one_db");
  assert.equal(target.targetRoleName, "tenant_one_role");
  assert.equal(target.sharedCellEvidenceHash, evidence.sharedCellEvidenceHash);
  assert.equal(Object.isFrozen(target), true);

  const wire = projectTarget(target);
  assert.deepEqual(Object.keys(wire).sort(), [
    "cellId",
    "clusterArn",
    "databaseClusterIdentifier",
    "managementDatabase",
    "managementEndpoint",
    "managementPort",
    "managementSecretArn",
    "managementUsername",
    "sharedCellEvidenceHash",
    "targetDatabaseName",
    "targetRoleName",
  ]);
  assert.equal(Object.isFrozen(wire), true);
  for (const reviewOnlyKey of [
    "schemaVersion",
    "registrationReady",
    "liveReadbackReady",
  ]) {
    assert.equal(reviewOnlyKey in wire, false);
  }
  const serialized = JSON.stringify(wire);
  for (const forbidden of [
    "secretValue",
    "password",
    "DATABASE_URL",
    "database_url",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("rejects cloned evidence and cloned or hand-built reviewed targets", async () => {
  const evidence = await adapterVerifiedEvidence();
  for (const clone of [
    structuredClone(evidence),
    JSON.parse(JSON.stringify(evidence)) as VerifiedSharedCellLifecycleEvidence,
  ]) {
    assert.throws(
      () => compileTarget(input(clone)),
      /adapter-verified Shared Cell evidence/,
    );
  }

  const target = compileTarget(input(evidence));
  for (const clone of [structuredClone(target), { ...target }]) {
    assert.throws(
      () => projectTarget(clone),
      /cannot be projected/,
    );
  }
});

test("rejects task intent, tenant name, and top-level drift", async () => {
  const evidence = await adapterVerifiedEvidence();
  const reviewedBinding = taskBinding();
  assert.throws(
    () =>
      compileTarget(
        input(evidence, {
          taskBinding: {
            ...reviewedBinding,
            networkIntent: {
              ...reviewedBinding.networkIntent,
              candidateOneShotSecurityGroupId: "sg-aaaaaaaaaaaaaaaaa",
            },
          },
        }),
      ),
    /cluster or candidate network/,
  );

  const invalidIdentities: Array<Partial<TenantResourceIdentity>> = [
    { cellKey: "another-cell" },
    { databaseName: "tenant_one_db", roleName: "tenant_two_role" },
    { databaseName: "cell_admin" },
    { roleName: "cell_admin" },
    { databaseName: "postgres" },
    { databaseName: "template0" },
    { roleName: "rdsadmin" },
    { roleName: "pg_shadow" },
    { databaseName: "tenant_abcdefghijklmnopq_db" },
  ];
  for (const identity of invalidIdentities) {
    assert.throws(
      () =>
        compileTarget(
          input(evidence, { resourceFence: resourceFence(identity) }),
        ),
      /database and role names.*reviewed Cell target/,
    );
  }

  const extra = input(evidence) as TenantLifecycleManagementTargetInput & {
    databaseUrl?: string;
  };
  extra.databaseUrl = "postgresql://forbidden";
  assert.throws(
    () => compileTarget(extra),
    /unexpected fields/,
  );
});

test("enforces the five-minute evidence window at compile and projection", async () => {
  const evidence = await adapterVerifiedEvidence();
  const windowMs = 5 * 60_000;

  assert.doesNotThrow(() => compileTarget(input(evidence), now));
  const boundaryTarget = compileTarget(input(evidence), now + windowMs);
  assert.doesNotThrow(() => projectTarget(boundaryTarget, now + windowMs));

  assert.throws(
    () => compileTarget(input(evidence), now - 1),
    /requires fresh Shared Cell evidence/,
  );
  assert.throws(
    () => compileTarget(input(evidence), now + windowMs + 1),
    /requires fresh Shared Cell evidence/,
  );

  const target = compileTarget(input(evidence), now);
  assert.throws(
    () => projectTarget(target, now - 1),
    /cannot be projected/,
  );
  assert.throws(
    () => projectTarget(target, now + windowMs + 1),
    /cannot be projected/,
  );
});
