const account = "402010193138";
const region = "ca-central-1";
const id = kind => new RegExp(`^${kind}-(?:[a-f0-9]{8}|[a-f0-9]{17})$`);
const availabilityZone = /^ca-central-1[a-z]$/;
const kmsKey = new RegExp(`^arn:aws:kms:${region}:${account}:key/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$`);

const scopes = {
  control: { ownerStack: "techlong-sandbox-platform-hosting-v1", vpcId: "vpc-011dab69fff93972b",
    instanceId: "techlong-sandbox-control-pg16", database: /^techlong_control$/,
    sources: ["Web", "Launcher", "FirstOpenTask"] },
  tenant: { ownerStack: "techlong-sandbox-cell-sandbox-1", vpcId: "vpc-0136b6ba92a72cbf9",
    instanceId: "techlong-sandbox-tenant-pg16", database: /^tenant_[a-z0-9]{1,16}_db$/,
    sources: ["TenantApi", "FirstOpenTask"] },
};

function checkedSubnets(items, expectedVpc) {
  if (!Array.isArray(items) || items.length < 2 ||
      new Set(items.map(item => item?.id)).size !== items.length ||
      new Set(items.map(item => item?.availabilityZone)).size !== items.length ||
      items.some(item => !item || !id("subnet").test(item.id) || !id("rtb").test(item.routeTableId) ||
        item.vpcId !== expectedVpc || !availabilityZone.test(item.availabilityZone) ||
        item.mapPublicIpOnLaunch !== false || item.ipv4DefaultRoutePresent !== false || item.ipv6DefaultRoutePresent !== false)) {
    throw Error("FIRST_OPEN_RDS_PRIVATE_SUBNET_SCOPE");
  }
  return items.map(item => item.id);
}

function render(scope, target) {
  if (!target || !/^db\.[a-z][a-z0-9]*\.[a-z0-9]+$/.test(target.instanceClass) ||
      !scope.database.test(target.databaseName) ||
      !Number.isSafeInteger(target.storageGiB) || target.storageGiB < 20 || target.storageGiB > 65_536 ||
      !Number.isSafeInteger(target.backupRetentionDays) || target.backupRetentionDays < 1 || target.backupRetentionDays > 35 ||
      typeof target.multiAz !== "boolean" || !kmsKey.test(target.kmsKeyArn)) throw Error("FIRST_OPEN_RDS_INSTANCE_SCOPE");
  const SubnetIds = checkedSubnets(target.subnets, scope.vpcId);
  const sources = target.applicationSecurityGroups;
  if (!sources || Object.keys(sources).length !== scope.sources.length ||
      !scope.sources.every(name => id("sg").test(sources[name])) || new Set(Object.values(sources)).size !== scope.sources.length) {
    throw Error("FIRST_OPEN_RDS_SECURITY_GROUP_SCOPE");
  }
  const ingress = Object.fromEntries(scope.sources.map(name => [`FirstOpenPostgresIngress${name}`, {
    Type: "AWS::EC2::SecurityGroupIngress",
    Properties: { GroupId: { "Fn::GetAtt": ["FirstOpenPostgresSecurityGroup", "GroupId"] },
      IpProtocol: "tcp", FromPort: 5432, ToPort: 5432, SourceSecurityGroupId: sources[name] },
  }]));
  return {
    ownerStack: scope.ownerStack,
    Resources: {
      FirstOpenPostgresSubnetGroup: { Type: "AWS::RDS::DBSubnetGroup",
        Properties: { DBSubnetGroupDescription: "First-open private PostgreSQL target", SubnetIds } },
      FirstOpenPostgresSecurityGroup: { Type: "AWS::EC2::SecurityGroup",
        Properties: { GroupDescription: "PostgreSQL from the reviewed first-open callers", VpcId: scope.vpcId } },
      ...ingress,
      FirstOpenPostgresParameters: { Type: "AWS::RDS::DBParameterGroup",
        Properties: { Description: "Require TLS for the PostgreSQL 16 first-open target", Family: "postgres16",
          Parameters: { "rds.force_ssl": "1" } } },
      FirstOpenPostgresDatabase: {
        Type: "AWS::RDS::DBInstance", DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain",
        Properties: { DBInstanceIdentifier: scope.instanceId, DBName: target.databaseName, Engine: "postgres", EngineVersion: "16.14",
          AutoMinorVersionUpgrade: false, DBInstanceClass: target.instanceClass, Port: 5432, NetworkType: "IPV4",
          PubliclyAccessible: false, DeletionProtection: true, StorageEncrypted: true, KmsKeyId: target.kmsKeyArn,
          StorageType: "gp3", AllocatedStorage: String(target.storageGiB), BackupRetentionPeriod: target.backupRetentionDays,
          MultiAZ: target.multiAz, DBSubnetGroupName: { Ref: "FirstOpenPostgresSubnetGroup" },
          DBParameterGroupName: { Ref: "FirstOpenPostgresParameters" },
          VPCSecurityGroups: [{ "Fn::GetAtt": ["FirstOpenPostgresSecurityGroup", "GroupId"] }],
          MasterUsername: "techlongadmin", ManageMasterUserPassword: true, EnableIAMDatabaseAuthentication: false },
      },
    },
    Outputs: {
      FirstOpenPostgresHost: { Value: { "Fn::GetAtt": ["FirstOpenPostgresDatabase", "Endpoint.Address"] } },
      FirstOpenPostgresResourceId: { Value: { "Fn::GetAtt": ["FirstOpenPostgresDatabase", "DbiResourceId"] } },
    },
  };
}

/** Render only additive fragments. Callers supply reviewed network facts and compare each to the fresh Original before installation. */
export function renderFirstOpenRdsCandidate({ control, tenant } = {}) {
  const controlFragment = render(scopes.control, control);
  const tenantFragment = render(scopes.tenant, tenant);
  if (control.applicationSecurityGroups.FirstOpenTask !== tenant.applicationSecurityGroups.FirstOpenTask ||
      tenant.subnets.some(subnet => control.subnets.some(other => other.id === subnet.id))) {
    throw Error("FIRST_OPEN_RDS_SPLIT_SCOPE");
  }
  return { installationAuthorized: false, control: controlFragment, tenant: tenantFragment };
}
