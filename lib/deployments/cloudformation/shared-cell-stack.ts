import type { DeploymentEnvironment } from "../environment.ts";
import { assertAwsSandboxPreflight } from "../preflight.ts";

export interface AwsSandboxSharedCellStackInput {
  environment: DeploymentEnvironment;
  requestedAt: number;
  availabilityZones: [string, string];
  certificateArn: string;
  controlTrustStoreArn: string;
  cellJanitorFunctionArn: string;
  cellSchedulerInvokeRoleArn: string;
  cellSchedulerGroupName: "techlong-sandbox-cell";
}

export interface CloudFormationSharedCellStackPlan {
  schemaVersion: 1;
  stackName: string;
  region: string;
  accountId: string;
  template: Record<string, unknown>;
  templateBody: string;
  parameters: Record<string, string>;
  tags: Record<string, string>;
  safety: {
    renderOnly: true;
    applyReady: false;
    callsAws: false;
    createsChargeableResources: true;
    cleanupScheduleFirst: true;
    separateCellJanitorRequired: true;
    separateCellOperatorRequired: true;
    maxCells: 1;
    maxAuroraClusters: 1;
    maxAuroraInstances: 1;
    maxAcu: 1;
    natGateways: 0;
    interfaceEndpoints: 0;
    cellTtlSeconds: 10_800;
    tenantTtlSeconds: 7_200;
    cleanupBufferSeconds: 900;
  };
}

const accountId = "402010193138";
const region = "ca-central-1";
const cellId = "cell-sandbox-1";
const cellName = `techlong-sandbox-${cellId}`;
const stackName = `techlong-sandbox-${cellId}`;
const cellTtlSeconds = 10_800;
const tenantTtlSeconds = 7_200;
const cleanupBufferSeconds = 900;

function ref(name: string): { Ref: string } {
  return { Ref: name };
}

function getAtt(resource: string, attribute: string): { "Fn::GetAtt": string[] } {
  return { "Fn::GetAtt": [resource, attribute] };
}

function assertArn(value: string, pattern: RegExp, label: string): void {
  if (!pattern.test(value)) {
    throw new Error(`${label} is outside the Shared Cell allowlist.`);
  }
}

function assertInput(input: AwsSandboxSharedCellStackInput): void {
  assertAwsSandboxPreflight({
    environment: input.environment,
    operation: "render",
    deploymentProfileKey: "standard-v1",
    observedAccountId: accountId,
    observedRegion: region,
    activeCellCount: 0,
    activeTenantCount: 0,
    cellOperation: "create",
  });
  if (
    input.environment.expectedAccountId !== accountId ||
    input.environment.region !== region ||
    input.environment.cellKey !== cellId ||
    input.environment.policy.maxCells !== 1 ||
    input.environment.policy.maxTenants !== 1 ||
    input.environment.policy.ttlSeconds !== tenantTtlSeconds ||
    input.environment.policy.auroraPostgresEngineVersion !== "16.14" ||
    input.environment.policy.auroraServerlessMinAcu !== 0 ||
    input.environment.policy.auroraServerlessMaxAcu !== 1 ||
    input.environment.policy.auroraSecondsUntilAutoPause !== 300 ||
    input.environment.policy.allowNatGateway ||
    input.environment.policy.allowInterfaceEndpoints
  ) {
    throw new Error("Shared Cell render input has drifted from the Sandbox policy.");
  }
  if (
    !Number.isSafeInteger(input.requestedAt) ||
    input.requestedAt <= 0 ||
    input.availabilityZones.length !== 2 ||
    new Set(input.availabilityZones).size !== 2 ||
    input.availabilityZones.some(
      (availabilityZone) => !/^ca-central-1[a-z]$/.test(availabilityZone),
    )
  ) {
    throw new Error("Shared Cell availability zones or render time are invalid.");
  }
  assertArn(
    input.certificateArn,
    /^arn:aws:acm:ca-central-1:402010193138:certificate\/[0-9a-f-]{36}$/,
    "Shared Cell ACM certificate ARN",
  );
  assertArn(
    input.controlTrustStoreArn,
    /^arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore\/[a-zA-Z0-9._-]+\/[a-z0-9]+$/,
    "Shared Cell trust store ARN",
  );
  if (
    input.cellJanitorFunctionArn !==
      "arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-janitor" ||
    input.cellSchedulerInvokeRoleArn !==
      "arn:aws:iam::402010193138:role/TechlongSandboxCellSchedulerInvokeRole" ||
    input.cellSchedulerGroupName !== "techlong-sandbox-cell"
  ) {
    throw new Error("Shared Cell cleanup resources are outside the allowlist.");
  }
}

function resourceTags(tags: Record<string, string>) {
  return Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));
}

export function renderAwsSandboxSharedCellStack(
  input: AwsSandboxSharedCellStackInput,
): CloudFormationSharedCellStackPlan {
  assertInput(input);
  const expiresAt = new Date(
    input.requestedAt + cellTtlSeconds * 1_000,
  ).toISOString();
  const cleanupAt = expiresAt.replace(/\.\d{3}Z$/, "");
  const tags = {
    Environment: "aws-sandbox",
    ManagedBy: "techlong-cell-operator",
    CellId: cellId,
    ExpiresAt: expiresAt,
  };
  const tagList = resourceTags(tags);
  const afterCleanup = ["CellCleanupSchedule"];
  const template: Record<string, unknown> = {
    AWSTemplateFormatVersion: "2010-09-09",
    Description:
      "Render-only S3-B Shared Cell for the Techlong AWS Sandbox; never apply without a separate approval.",
    Parameters: {
      AvailabilityZoneA: {
        Type: "String",
        AllowedPattern: "^ca-central-1[a-z]$",
      },
      AvailabilityZoneB: {
        Type: "String",
        AllowedPattern: "^ca-central-1[a-z]$",
      },
      CertificateArn: {
        Type: "String",
        AllowedPattern:
          "^arn:aws:acm:ca-central-1:402010193138:certificate/[0-9a-f-]{36}$",
      },
      ControlTrustStoreArn: {
        Type: "String",
        AllowedPattern:
          "^arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/[a-zA-Z0-9._-]+/[a-z0-9]+$",
      },
      CellJanitorFunctionArn: {
        Type: "String",
        AllowedValues: [
          "arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-janitor",
        ],
      },
      CellSchedulerInvokeRoleArn: {
        Type: "String",
        AllowedValues: [
          "arn:aws:iam::402010193138:role/TechlongSandboxCellSchedulerInvokeRole",
        ],
      },
      CellSchedulerGroupName: {
        Type: "String",
        AllowedValues: ["techlong-sandbox-cell"],
      },
      CleanupAt: {
        Type: "String",
        AllowedPattern:
          "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$",
      },
    },
    Rules: {
      DistinctAvailabilityZones: {
        Assertions: [
          {
            Assert: {
              "Fn::Not": [
                {
                  "Fn::Equals": [
                    ref("AvailabilityZoneA"),
                    ref("AvailabilityZoneB"),
                  ],
                },
              ],
            },
            AssertDescription:
              "The Shared Cell must use two distinct availability zones.",
          },
        ],
      },
    },
    Resources: {
      CellCleanupSchedule: {
        Type: "AWS::Scheduler::Schedule",
        Properties: {
          Name: "techlong-sandbox-cell-sandbox-1-ttl",
          GroupName: ref("CellSchedulerGroupName"),
          Description: "Independent TTL cleanup for the Sandbox Shared Cell.",
          ActionAfterCompletion: "DELETE",
          FlexibleTimeWindow: { Mode: "OFF" },
          ScheduleExpression: { "Fn::Sub": "at(${CleanupAt})" },
          ScheduleExpressionTimezone: "UTC",
          State: "ENABLED",
          Target: {
            Arn: ref("CellJanitorFunctionArn"),
            RoleArn: ref("CellSchedulerInvokeRoleArn"),
            RetryPolicy: {
              MaximumEventAgeInSeconds: 3_600,
              MaximumRetryAttempts: 10,
            },
            Input: JSON.stringify({
              schemaVersion: 1,
              action: "delete_shared_cell_stack",
              stackName,
              cellId,
            }),
          },
        },
      },
      CellVpc: {
        Type: "AWS::EC2::VPC",
        DependsOn: afterCleanup,
        Properties: {
          CidrBlock: "10.88.0.0/16",
          EnableDnsHostnames: true,
          EnableDnsSupport: true,
          InstanceTenancy: "default",
          Tags: [...tagList, { Key: "Name", Value: cellName }],
        },
      },
      CellInternetGateway: {
        Type: "AWS::EC2::InternetGateway",
        DependsOn: afterCleanup,
        Properties: {
          Tags: [...tagList, { Key: "Name", Value: `${cellName}-igw` }],
        },
      },
      CellGatewayAttachment: {
        Type: "AWS::EC2::VPCGatewayAttachment",
        DependsOn: afterCleanup,
        Properties: {
          VpcId: ref("CellVpc"),
          InternetGatewayId: ref("CellInternetGateway"),
        },
      },
      PublicSubnetA: {
        Type: "AWS::EC2::Subnet",
        DependsOn: afterCleanup,
        Properties: {
          VpcId: ref("CellVpc"),
          AvailabilityZone: ref("AvailabilityZoneA"),
          CidrBlock: "10.88.0.0/24",
          MapPublicIpOnLaunch: true,
          Tags: [...tagList, { Key: "Name", Value: `${cellName}-public-a` }],
        },
      },
      PublicSubnetB: {
        Type: "AWS::EC2::Subnet",
        DependsOn: afterCleanup,
        Properties: {
          VpcId: ref("CellVpc"),
          AvailabilityZone: ref("AvailabilityZoneB"),
          CidrBlock: "10.88.1.0/24",
          MapPublicIpOnLaunch: true,
          Tags: [...tagList, { Key: "Name", Value: `${cellName}-public-b` }],
        },
      },
      DatabaseSubnetA: {
        Type: "AWS::EC2::Subnet",
        DependsOn: afterCleanup,
        Properties: {
          VpcId: ref("CellVpc"),
          AvailabilityZone: ref("AvailabilityZoneA"),
          CidrBlock: "10.88.10.0/24",
          MapPublicIpOnLaunch: false,
          Tags: [...tagList, { Key: "Name", Value: `${cellName}-database-a` }],
        },
      },
      DatabaseSubnetB: {
        Type: "AWS::EC2::Subnet",
        DependsOn: afterCleanup,
        Properties: {
          VpcId: ref("CellVpc"),
          AvailabilityZone: ref("AvailabilityZoneB"),
          CidrBlock: "10.88.11.0/24",
          MapPublicIpOnLaunch: false,
          Tags: [...tagList, { Key: "Name", Value: `${cellName}-database-b` }],
        },
      },
      PublicRouteTable: {
        Type: "AWS::EC2::RouteTable",
        DependsOn: afterCleanup,
        Properties: {
          VpcId: ref("CellVpc"),
          Tags: [...tagList, { Key: "Name", Value: `${cellName}-public` }],
        },
      },
      PublicDefaultRoute: {
        Type: "AWS::EC2::Route",
        DependsOn: ["CellCleanupSchedule", "CellGatewayAttachment"],
        Properties: {
          RouteTableId: ref("PublicRouteTable"),
          DestinationCidrBlock: "0.0.0.0/0",
          GatewayId: ref("CellInternetGateway"),
        },
      },
      PublicSubnetRouteAssociationA: {
        Type: "AWS::EC2::SubnetRouteTableAssociation",
        DependsOn: afterCleanup,
        Properties: {
          SubnetId: ref("PublicSubnetA"),
          RouteTableId: ref("PublicRouteTable"),
        },
      },
      PublicSubnetRouteAssociationB: {
        Type: "AWS::EC2::SubnetRouteTableAssociation",
        DependsOn: afterCleanup,
        Properties: {
          SubnetId: ref("PublicSubnetB"),
          RouteTableId: ref("PublicRouteTable"),
        },
      },
      LoadBalancerSecurityGroup: {
        Type: "AWS::EC2::SecurityGroup",
        DependsOn: afterCleanup,
        Properties: {
          GroupDescription: "Sandbox Shared Cell ALB HTTPS ingress only",
          VpcId: ref("CellVpc"),
          SecurityGroupIngress: [
            {
              IpProtocol: "tcp",
              FromPort: 443,
              ToPort: 443,
              CidrIp: "0.0.0.0/0",
            },
            {
              IpProtocol: "tcp",
              FromPort: 8443,
              ToPort: 8443,
              CidrIp: "0.0.0.0/0",
            },
          ],
          Tags: [...tagList, { Key: "Name", Value: `${cellName}-alb` }],
        },
      },
      TaskSecurityGroup: {
        Type: "AWS::EC2::SecurityGroup",
        DependsOn: afterCleanup,
        Properties: {
          GroupDescription: "Sandbox tenant tasks accept traffic only from the Cell ALB",
          VpcId: ref("CellVpc"),
          SecurityGroupIngress: [
            {
              IpProtocol: "tcp",
              FromPort: 3000,
              ToPort: 3000,
              SourceSecurityGroupId: ref("LoadBalancerSecurityGroup"),
            },
          ],
          Tags: [...tagList, { Key: "Name", Value: `${cellName}-tasks` }],
        },
      },
      DatabaseSecurityGroup: {
        Type: "AWS::EC2::SecurityGroup",
        DependsOn: afterCleanup,
        Properties: {
          GroupDescription: "Sandbox Aurora accepts PostgreSQL only from tenant tasks",
          VpcId: ref("CellVpc"),
          SecurityGroupIngress: [
            {
              IpProtocol: "tcp",
              FromPort: 5432,
              ToPort: 5432,
              SourceSecurityGroupId: ref("TaskSecurityGroup"),
            },
          ],
          Tags: [...tagList, { Key: "Name", Value: `${cellName}-database` }],
        },
      },
      CellCluster: {
        Type: "AWS::ECS::Cluster",
        DependsOn: afterCleanup,
        Properties: {
          ClusterName: cellId,
          ClusterSettings: [{ Name: "containerInsights", Value: "disabled" }],
          CapacityProviders: ["FARGATE", "FARGATE_SPOT"],
          DefaultCapacityProviderStrategy: [
            { CapacityProvider: "FARGATE_SPOT", Weight: 1, Base: 0 },
          ],
          Tags: tagList,
        },
      },
      CellLoadBalancer: {
        Type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
        DependsOn: ["CellCleanupSchedule", "PublicDefaultRoute"],
        Properties: {
          Name: cellName,
          Type: "application",
          Scheme: "internet-facing",
          IpAddressType: "ipv4",
          SecurityGroups: [ref("LoadBalancerSecurityGroup")],
          Subnets: [ref("PublicSubnetA"), ref("PublicSubnetB")],
          LoadBalancerAttributes: [
            { Key: "deletion_protection.enabled", Value: "false" },
            { Key: "routing.http.drop_invalid_header_fields.enabled", Value: "true" },
            { Key: "idle_timeout.timeout_seconds", Value: "30" },
          ],
          Tags: tagList,
        },
      },
      BusinessHttpsListener: {
        Type: "AWS::ElasticLoadBalancingV2::Listener",
        DependsOn: afterCleanup,
        Properties: {
          LoadBalancerArn: ref("CellLoadBalancer"),
          Port: 443,
          Protocol: "HTTPS",
          SslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
          Certificates: [{ CertificateArn: ref("CertificateArn") }],
          DefaultActions: [
            {
              Type: "fixed-response",
              FixedResponseConfig: {
                StatusCode: "404",
                ContentType: "application/json",
                MessageBody: '{"success":false,"code":"NOT_FOUND"}',
              },
            },
          ],
        },
      },
      BusinessControlDenyRule: {
        Type: "AWS::ElasticLoadBalancingV2::ListenerRule",
        DependsOn: afterCleanup,
        Properties: {
          ListenerArn: ref("BusinessHttpsListener"),
          Priority: 1,
          Conditions: [
            {
              Field: "path-pattern",
              PathPatternConfig: { Values: ["/api/saas", "/api/saas/*"] },
            },
          ],
          Actions: [
            {
              Type: "fixed-response",
              FixedResponseConfig: {
                StatusCode: "404",
                ContentType: "application/json",
                MessageBody: '{"success":false,"code":"NOT_FOUND"}',
              },
            },
          ],
        },
      },
      ControlMtlsListener: {
        Type: "AWS::ElasticLoadBalancingV2::Listener",
        DependsOn: afterCleanup,
        Properties: {
          LoadBalancerArn: ref("CellLoadBalancer"),
          Port: 8443,
          Protocol: "HTTPS",
          SslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
          Certificates: [{ CertificateArn: ref("CertificateArn") }],
          MutualAuthentication: {
            Mode: "verify",
            TrustStoreArn: ref("ControlTrustStoreArn"),
            IgnoreClientCertificateExpiry: false,
          },
          DefaultActions: [
            {
              Type: "fixed-response",
              FixedResponseConfig: {
                StatusCode: "404",
                ContentType: "application/json",
                MessageBody: '{"success":false,"code":"NOT_FOUND"}',
              },
            },
          ],
        },
      },
      CellDatabaseSubnetGroup: {
        Type: "AWS::RDS::DBSubnetGroup",
        DependsOn: afterCleanup,
        Properties: {
          DBSubnetGroupName: cellName,
          DBSubnetGroupDescription: "Private subnets for the Sandbox Shared Cell Aurora cluster",
          SubnetIds: [ref("DatabaseSubnetA"), ref("DatabaseSubnetB")],
          Tags: tagList,
        },
      },
      CellDatabaseLogGroup: {
        Type: "AWS::Logs::LogGroup",
        DependsOn: afterCleanup,
        DeletionPolicy: "Delete",
        UpdateReplacePolicy: "Delete",
        Properties: {
          LogGroupName: `/aws/rds/cluster/${cellName}/postgresql`,
          RetentionInDays: 1,
          Tags: tagList,
        },
      },
      CellDatabaseCluster: {
        Type: "AWS::RDS::DBCluster",
        DependsOn: [
          "CellCleanupSchedule",
          "CellDatabaseSubnetGroup",
          "CellDatabaseLogGroup",
        ],
        DeletionPolicy: "Delete",
        UpdateReplacePolicy: "Delete",
        Properties: {
          DBClusterIdentifier: cellName,
          Engine: "aurora-postgresql",
          EngineVersion: "16.14",
          EngineMode: "provisioned",
          DatabaseName: "cell_admin",
          Port: 5432,
          MasterUsername: "cell_admin",
          ManageMasterUserPassword: true,
          DBSubnetGroupName: ref("CellDatabaseSubnetGroup"),
          VpcSecurityGroupIds: [ref("DatabaseSecurityGroup")],
          ServerlessV2ScalingConfiguration: {
            MinCapacity: 0,
            MaxCapacity: 1,
            SecondsUntilAutoPause: 300,
          },
          StorageEncrypted: true,
          DeletionProtection: false,
          BackupRetentionPeriod: 1,
          CopyTagsToSnapshot: false,
          EnableCloudwatchLogsExports: ["postgresql"],
          Tags: tagList,
        },
      },
      CellDatabaseWriter: {
        Type: "AWS::RDS::DBInstance",
        DependsOn: ["CellCleanupSchedule", "CellDatabaseCluster"],
        DeletionPolicy: "Delete",
        UpdateReplacePolicy: "Delete",
        Properties: {
          DBInstanceIdentifier: `${cellName}-writer`,
          DBClusterIdentifier: ref("CellDatabaseCluster"),
          Engine: "aurora-postgresql",
          DBInstanceClass: "db.serverless",
          PubliclyAccessible: false,
          AutoMinorVersionUpgrade: false,
          EnablePerformanceInsights: false,
          MonitoringInterval: 0,
          Tags: tagList,
        },
      },
    },
    Outputs: {
      ClusterName: { Value: ref("CellCluster") },
      VpcId: { Value: ref("CellVpc") },
      SubnetIds: {
        Value: {
          "Fn::Join": [",", [ref("PublicSubnetA"), ref("PublicSubnetB")]],
        },
      },
      TaskSecurityGroupId: { Value: ref("TaskSecurityGroup") },
      HttpsListenerArn: { Value: ref("BusinessHttpsListener") },
      ControlListenerArn: { Value: ref("ControlMtlsListener") },
      DatabaseClusterIdentifier: { Value: ref("CellDatabaseCluster") },
      DatabaseEndpoint: { Value: getAtt("CellDatabaseCluster", "Endpoint.Address") },
      DatabaseMasterSecretArn: {
        Value: getAtt("CellDatabaseCluster", "MasterUserSecret.SecretArn"),
      },
      CellExpiresAt: { Value: expiresAt },
    },
  };
  const parameters = {
    AvailabilityZoneA: input.availabilityZones[0],
    AvailabilityZoneB: input.availabilityZones[1],
    CertificateArn: input.certificateArn,
    ControlTrustStoreArn: input.controlTrustStoreArn,
    CellJanitorFunctionArn: input.cellJanitorFunctionArn,
    CellSchedulerInvokeRoleArn: input.cellSchedulerInvokeRoleArn,
    CellSchedulerGroupName: input.cellSchedulerGroupName,
    CleanupAt: cleanupAt,
  };
  return {
    schemaVersion: 1,
    stackName,
    region,
    accountId,
    template,
    templateBody: JSON.stringify(template),
    parameters,
    tags,
    safety: {
      renderOnly: true,
      applyReady: false,
      callsAws: false,
      createsChargeableResources: true,
      cleanupScheduleFirst: true,
      separateCellJanitorRequired: true,
      separateCellOperatorRequired: true,
      maxCells: 1,
      maxAuroraClusters: 1,
      maxAuroraInstances: 1,
      maxAcu: 1,
      natGateways: 0,
      interfaceEndpoints: 0,
      cellTtlSeconds,
      tenantTtlSeconds,
      cleanupBufferSeconds,
    },
  };
}
