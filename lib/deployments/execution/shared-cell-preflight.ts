import type {
  DeploymentExecutionBinding,
  SharedCellSecurityPreflightPort,
} from "./contracts.ts";
import type { DeploymentEnvironment } from "../environment.ts";

export interface SharedCellResourceTags {
  Environment?: string;
  ManagedBy?: string;
  CellId?: string;
  ExpiresAt?: string;
  [key: string]: string | undefined;
}

export interface SharedCellIngressObservation {
  protocol: "tcp" | string;
  fromPort: number;
  toPort: number;
  sourceSecurityGroupId?: string;
  cidrIpv4?: string;
  cidrIpv6?: string;
  prefixListId?: string;
}

export interface SharedCellEgressObservation {
  protocol: "tcp" | string;
  fromPort: number;
  toPort: number;
  destinationSecurityGroupId?: string;
  cidrIpv4?: string;
  cidrIpv6?: string;
  prefixListId?: string;
}

export interface SharedCellListenerObservation {
  arn: string;
  loadBalancerArn: string;
  protocol: "HTTPS";
  port: number;
  mutualAuthenticationMode: "off" | "passthrough" | "verify";
  trustStoreArn: string | null;
  trustStoreStatus: string | null;
  defaultActionType: string;
  deniesSaasControlPaths: boolean;
}

export interface SharedCellSecurityGroupObservation {
  id: string;
  vpcId: string;
  ingress: SharedCellIngressObservation[];
  egress: SharedCellEgressObservation[];
  tags: SharedCellResourceTags;
}

export interface SharedCellSubnetObservation {
  id: string;
  vpcId: string;
  availabilityZone: string;
  state: string;
  mapPublicIpOnLaunch: boolean;
  tags: SharedCellResourceTags;
}

export interface SharedCellRouteObservation {
  destinationCidrIpv4?: string;
  destinationCidrIpv6?: string;
  destinationPrefixListId?: string;
  state: string;
  targetType: string;
  targetId: string;
}

export interface SharedCellRouteTableAssociationObservation {
  id: string;
  subnetId?: string;
  main: boolean;
  state: string;
}

export interface SharedCellRouteTableObservation {
  id: string;
  vpcId: string;
  associations: SharedCellRouteTableAssociationObservation[];
  routes: SharedCellRouteObservation[];
  tags: SharedCellResourceTags;
}

export interface SharedCellInternetGatewayObservation {
  id: string;
  attachments: Array<{
    vpcId: string;
    state: string;
  }>;
  tags: SharedCellResourceTags;
}

export interface SharedCellDatabaseObservation {
  arn: string;
  identifier: string;
  status: string;
  engine: string;
  engineVersion: string;
  engineMode: string;
  port: number;
  storageEncrypted: boolean;
  deletionProtection: boolean;
  serverlessMinAcu: number | null;
  serverlessMaxAcu: number | null;
  secondsUntilAutoPause: number | null;
  vpcSecurityGroupIds: string[];
  subnetIds: string[];
  tags: SharedCellResourceTags;
  instances: Array<{
    arn: string;
    identifier: string;
    status: string;
    instanceClass: string;
    publiclyAccessible: boolean;
    clusterIdentifier: string;
  }>;
}

export interface SharedCellSecurityObservation {
  observedAt: number;
  accountId: string;
  callerArn: string;
  region: string;
  clusterName: string;
  clusterArn: string;
  clusterStatus: string;
  clusterTags: SharedCellResourceTags;
  vpcId: string;
  vpcState: string;
  vpcTags: SharedCellResourceTags;
  subnetIds: string[];
  subnets: SharedCellSubnetObservation[];
  routeTables: SharedCellRouteTableObservation[];
  internetGateway: SharedCellInternetGatewayObservation;
  httpsListener: SharedCellListenerObservation;
  controlListener: SharedCellListenerObservation;
  loadBalancer: {
    arn: string;
    name: string;
    type: string;
    scheme: string;
    state: string;
    vpcId: string;
    subnetIds: string[];
    securityGroupIds: string[];
    tags: SharedCellResourceTags;
  };
  loadBalancerSecurityGroups: SharedCellSecurityGroupObservation[];
  taskSecurityGroup: SharedCellSecurityGroupObservation;
  oneShotTaskSecurityGroup: SharedCellSecurityGroupObservation;
  databaseSecurityGroup: SharedCellSecurityGroupObservation;
  database: SharedCellDatabaseObservation;
}

function sorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function sameSet(left: string[], right: string[]): boolean {
  return sorted(left).join(",") === sorted(right).join(",");
}

function effectiveRouteTableForSubnet(input: {
  routeTables: SharedCellRouteTableObservation[];
  subnetId: string;
  requireExplicitAssociation: boolean;
}): SharedCellRouteTableObservation {
  const explicit = input.routeTables.flatMap((routeTable) =>
    routeTable.associations
      .filter((association) => association.subnetId === input.subnetId)
      .map((association) => ({ association, routeTable })),
  );
  if (explicit.length > 0) {
    const match = explicit[0];
    if (
      explicit.length !== 1 ||
      !match.association.id ||
      match.association.main ||
      match.association.state !== "associated"
    ) {
      throw new Error(
        `Shared Cell subnet ${input.subnetId} does not have one active exact route table association.`,
      );
    }
    return match.routeTable;
  }
  if (input.requireExplicitAssociation) {
    throw new Error(
      `Shared Cell public subnet ${input.subnetId} has no active exact route table association.`,
    );
  }
  const main = input.routeTables.flatMap((routeTable) =>
    routeTable.associations
      .filter((association) => association.main)
      .map((association) => ({ association, routeTable })),
  );
  const match = main[0];
  if (
    main.length !== 1 ||
    !match.association.id ||
    match.association.subnetId ||
    match.association.state !== "associated"
  ) {
    throw new Error(
      `Shared Cell subnet ${input.subnetId} has no unambiguous active effective route table.`,
    );
  }
  return match.routeTable;
}

function assertArnScope(
  value: string,
  service: string,
  environment: DeploymentEnvironment,
  label: string,
): void {
  const prefix = `arn:aws:${service}:${environment.region}:${environment.expectedAccountId}:`;
  if (!value.startsWith(prefix)) {
    throw new Error(`${label} is outside the expected AWS account or region.`);
  }
}

function assertOwnedResource(input: {
  tags: SharedCellResourceTags;
  environment: DeploymentEnvironment;
  observedAt: number;
  label: string;
}): void {
  const { tags, environment, observedAt, label } = input;
  if (
    tags.Environment !== "aws-sandbox" ||
    tags.ManagedBy !== "techlong-cell-operator" ||
    tags.CellId !== environment.cellKey
  ) {
    throw new Error(`${label} does not have the required Shared Cell ownership tags.`);
  }
  const expiresAtValue = tags.ExpiresAt ?? "";
  const expiresAt = Date.parse(expiresAtValue);
  const minimumTenantWindow =
    environment.policy.ttlSeconds * 1_000 + 15 * 60_000;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expiresAtValue) ||
    !Number.isFinite(expiresAt) ||
    new Date(expiresAt).toISOString() !== expiresAtValue ||
    expiresAt < observedAt + minimumTenantWindow
  ) {
    throw new Error(
      `${label} does not retain the full tenant TTL plus cleanup buffer.`,
    );
  }
}

function assertOnlyIngress(input: {
  rules: SharedCellIngressObservation[];
  allowedPorts: number[];
  label: string;
}): void {
  if (
    input.rules.length < input.allowedPorts.length ||
    input.rules.some(
      (rule) =>
        rule.protocol !== "tcp" ||
        rule.fromPort !== rule.toPort ||
        !input.allowedPorts.includes(rule.fromPort) ||
        Boolean(rule.sourceSecurityGroupId || rule.prefixListId) ||
        !Boolean(rule.cidrIpv4 || rule.cidrIpv6),
    ) ||
    input.allowedPorts.some(
      (port) => !input.rules.some((rule) => rule.fromPort === port),
    )
  ) {
    throw new Error(`${input.label} has ingress outside the reviewed port allowlist.`);
  }
}

export function assertSharedCellSecurityObservation(input: {
  environment: DeploymentEnvironment;
  binding: DeploymentExecutionBinding;
  observation: SharedCellSecurityObservation;
}): void {
  const { environment, binding, observation } = input;
  const parameters = binding.tenantStackParameters;
  if (
    observation.accountId !== environment.expectedAccountId ||
    observation.region !== environment.region ||
    observation.clusterName !== parameters.ClusterName ||
    observation.vpcId !== parameters.VpcId ||
    observation.taskSecurityGroup.id !== parameters.TaskSecurityGroupId ||
    observation.taskSecurityGroup.vpcId !== parameters.VpcId ||
    observation.oneShotTaskSecurityGroup.id !==
      parameters.OneShotTaskSecurityGroupId ||
    observation.oneShotTaskSecurityGroup.vpcId !== parameters.VpcId ||
    !Number.isSafeInteger(observation.observedAt) ||
    observation.observedAt <= 0
  ) {
    throw new Error("Shared Cell security observation does not match the deployment binding.");
  }
  if (
    !observation.callerArn.startsWith(
      `arn:aws:sts::${environment.expectedAccountId}:assumed-role/TechlongSandboxProvisionerRole/`,
    )
  ) {
    throw new Error("STS caller ARN is not the reviewed Sandbox provisioner role.");
  }
  assertArnScope(observation.clusterArn, "ecs", environment, "ECS cluster ARN");
  if (observation.clusterStatus !== "ACTIVE") {
    throw new Error("Shared Cell ECS cluster must be ACTIVE.");
  }
  if (
    !sameSet(
      observation.subnetIds,
      parameters.SubnetIds.split(",").map((value) => value.trim()),
    ) ||
    !sameSet(observation.loadBalancer.subnetIds, observation.subnetIds)
  ) {
    throw new Error("Shared Cell subnet observation does not match the deployment binding.");
  }
  if (
    observation.subnets.length < 4 ||
    observation.subnets.some(
      (subnet) =>
        subnet.vpcId !== observation.vpcId || subnet.state !== "available",
    )
  ) {
    throw new Error("Shared Cell subnets must be available in the reviewed VPC.");
  }
  const observedSubnets = new Set(observation.subnets.map((subnet) => subnet.id));
  if (
    observation.subnetIds.some((subnetId) => !observedSubnets.has(subnetId)) ||
    observation.database.subnetIds.some(
      (subnetId) => !observedSubnets.has(subnetId),
    )
  ) {
    throw new Error("Shared Cell ALB or database references an unobserved subnet.");
  }
  const taskSubnets = observation.subnets.filter((subnet) =>
    observation.subnetIds.includes(subnet.id),
  );
  if (
    taskSubnets.length !== observation.subnetIds.length ||
    taskSubnets.some((subnet) => !subnet.mapPublicIpOnLaunch)
  ) {
    throw new Error(
      "Shared Cell Sandbox task subnets must be public for assigned public IPs.",
    );
  }
  const databaseSubnets = observation.subnets.filter((subnet) =>
    observation.database.subnetIds.includes(subnet.id),
  );
  if (
    databaseSubnets.length < 2 ||
    databaseSubnets.some((subnet) => subnet.mapPublicIpOnLaunch) ||
    new Set(databaseSubnets.map((subnet) => subnet.availabilityZone)).size < 2
  ) {
    throw new Error("Shared Cell database subnets must be private and span two availability zones.");
  }
  const internetGateway = observation.internetGateway;
  if (
    !/^igw-[0-9a-f]{8,17}$/.test(internetGateway.id) ||
    internetGateway.attachments.length !== 1 ||
    internetGateway.attachments[0].vpcId !== observation.vpcId ||
    internetGateway.attachments[0].state !== "available"
  ) {
    throw new Error(
      "Shared Cell internet gateway must be the exact available gateway attached to the reviewed VPC.",
    );
  }
  if (
    observation.routeTables.length < 1 ||
    observation.routeTables.some(
      (routeTable) =>
        !/^rtb-[0-9a-f]{8,17}$/.test(routeTable.id) ||
        routeTable.vpcId !== observation.vpcId,
    ) ||
    new Set(observation.routeTables.map((routeTable) => routeTable.id)).size !==
      observation.routeTables.length
  ) {
    throw new Error(
      "Shared Cell route table evidence is incomplete or belongs to another VPC.",
    );
  }
  const reviewedRouteTargetTypes = new Set([
    "local",
    "internet_gateway",
    "virtual_private_gateway",
    "nat_gateway",
    "egress_only_internet_gateway",
    "transit_gateway",
    "vpc_peering_connection",
    "network_interface",
    "instance",
    "carrier_gateway",
    "local_gateway",
    "core_network",
  ]);
  if (
    observation.routeTables.some((routeTable) =>
      routeTable.routes.some(
        (route) => {
          const destinationCount = [
            route.destinationCidrIpv4,
            route.destinationCidrIpv6,
            route.destinationPrefixListId,
          ].filter(Boolean).length;
          return (
            !route.state ||
            !route.targetId ||
            !reviewedRouteTargetTypes.has(route.targetType) ||
            destinationCount !== 1
          );
        },
      ),
    )
  ) {
    throw new Error("Shared Cell route table contains incomplete route evidence.");
  }
  const publicRouteTableIds = new Set<string>();
  for (const subnet of taskSubnets) {
    const routeTable = effectiveRouteTableForSubnet({
      routeTables: observation.routeTables,
      subnetId: subnet.id,
      requireExplicitAssociation: true,
    });
    const ipv4Defaults = routeTable.routes.filter(
      (route) => route.destinationCidrIpv4 === "0.0.0.0/0",
    );
    if (
      ipv4Defaults.length !== 1 ||
      ipv4Defaults[0].state !== "active" ||
      ipv4Defaults[0].targetType !== "internet_gateway" ||
      ipv4Defaults[0].targetId !== internetGateway.id
    ) {
      throw new Error(
        `Shared Cell public subnet ${subnet.id} must use one active IPv4 default route to the exact attached VPC internet gateway.`,
      );
    }
    publicRouteTableIds.add(routeTable.id);
  }
  const forbiddenDatabaseTargets = new Set([
    "internet_gateway",
    "nat_gateway",
    "egress_only_internet_gateway",
  ]);
  for (const subnet of databaseSubnets) {
    const routeTable = effectiveRouteTableForSubnet({
      routeTables: observation.routeTables,
      subnetId: subnet.id,
      requireExplicitAssociation: false,
    });
    if (
      routeTable.routes.some(
        (route) =>
          route.destinationCidrIpv4 === "0.0.0.0/0" ||
          route.destinationCidrIpv6 === "::/0" ||
          forbiddenDatabaseTargets.has(route.targetType),
      )
    ) {
      throw new Error(
        `Shared Cell database subnet ${subnet.id} must not have a public default, internet gateway, NAT gateway, or egress-only internet gateway route.`,
      );
    }
  }
  if (
    observation.httpsListener.arn !== parameters.HttpsListenerArn ||
    observation.httpsListener.protocol !== "HTTPS" ||
    observation.httpsListener.port !== 443 ||
    observation.httpsListener.loadBalancerArn !== observation.loadBalancer.arn ||
    observation.httpsListener.defaultActionType !== "fixed-response" ||
    !observation.httpsListener.deniesSaasControlPaths
  ) {
    throw new Error(
      "Shared Cell business listener must reject /api/saas on the reviewed HTTPS 443 listener.",
    );
  }
  if (
    observation.controlListener.arn !== parameters.ControlListenerArn ||
    observation.controlListener.protocol !== "HTTPS" ||
    observation.controlListener.port !== 8443 ||
    observation.controlListener.loadBalancerArn !== observation.loadBalancer.arn ||
    observation.controlListener.mutualAuthenticationMode !== "verify" ||
    !observation.controlListener.trustStoreArn ||
    observation.controlListener.trustStoreStatus !== "ACTIVE"
  ) {
    throw new Error(
      "Shared Cell control listener must use HTTPS 8443 with mTLS verify mode and an ACTIVE trust store.",
    );
  }
  assertArnScope(
    observation.controlListener.trustStoreArn,
    "elasticloadbalancing",
    environment,
    "ALB trust store ARN",
  );
  if (
    observation.loadBalancer.name !== `techlong-sandbox-${environment.cellKey}` ||
    observation.loadBalancer.type !== "application" ||
    observation.loadBalancer.scheme !== "internet-facing" ||
    observation.loadBalancer.state !== "active" ||
    observation.loadBalancer.vpcId !== observation.vpcId ||
    observation.vpcState !== "available"
  ) {
    throw new Error("Shared Cell load balancer or VPC is not in the reviewed active shape.");
  }
  assertArnScope(
    observation.loadBalancer.arn,
    "elasticloadbalancing",
    environment,
    "ALB ARN",
  );
  const albSecurityGroups = new Set(
    observation.loadBalancerSecurityGroups.map((group) => group.id),
  );
  if (
    albSecurityGroups.size < 1 ||
    !sameSet(
      observation.loadBalancer.securityGroupIds,
      [...albSecurityGroups],
    )
  ) {
    throw new Error("Shared Cell load balancer has no fully observed security group.");
  }
  for (const group of observation.loadBalancerSecurityGroups) {
    if (group.vpcId !== observation.vpcId) {
      throw new Error("Shared Cell load balancer security group belongs to another VPC.");
    }
    assertOnlyIngress({
      rules: group.ingress,
      allowedPorts: [443, 8443],
      label: "Shared Cell load balancer security group",
    });
  }
  if (
    observation.taskSecurityGroup.ingress.length < 1 ||
    observation.taskSecurityGroup.ingress.some(
      (rule) =>
        rule.protocol !== "tcp" ||
        rule.fromPort !== 3000 ||
        rule.toPort !== 3000 ||
        !rule.sourceSecurityGroupId ||
        !albSecurityGroups.has(rule.sourceSecurityGroupId) ||
        Boolean(rule.cidrIpv4 || rule.cidrIpv6 || rule.prefixListId),
    )
  ) {
    throw new Error(
      "Shared Cell task security group must allow port 3000 only from an observed ALB security group.",
    );
  }
  const oneShotSecurityGroup = observation.oneShotTaskSecurityGroup;
  const publicHttpsEgress = oneShotSecurityGroup.egress.filter(
    (rule) =>
      rule.protocol === "tcp" &&
      rule.fromPort === 443 &&
      rule.toPort === 443 &&
      rule.cidrIpv4 === "0.0.0.0/0" &&
      !rule.cidrIpv6 &&
      !rule.prefixListId &&
      !rule.destinationSecurityGroupId,
  );
  const databaseEgress = oneShotSecurityGroup.egress.filter(
    (rule) =>
      rule.protocol === "tcp" &&
      rule.fromPort === 5432 &&
      rule.toPort === 5432 &&
      rule.destinationSecurityGroupId === observation.databaseSecurityGroup.id &&
      !rule.cidrIpv4 &&
      !rule.cidrIpv6 &&
      !rule.prefixListId,
  );
  if (
    oneShotSecurityGroup.ingress.length !== 0 ||
    oneShotSecurityGroup.egress.length !== 2 ||
    publicHttpsEgress.length !== 1 ||
    databaseEgress.length !== 1
  ) {
    throw new Error(
      "Shared Cell one-shot task security group must have zero ingress and allow only public HTTPS plus PostgreSQL to the exact database security group.",
    );
  }
  const allowedDatabaseSources = new Set([
    observation.taskSecurityGroup.id,
    oneShotSecurityGroup.id,
  ]);
  if (
    observation.databaseSecurityGroup.vpcId !== observation.vpcId ||
    observation.databaseSecurityGroup.ingress.length !==
      allowedDatabaseSources.size ||
    observation.databaseSecurityGroup.ingress.some(
      (rule) =>
        rule.protocol !== "tcp" ||
        rule.fromPort !== 5432 ||
        rule.toPort !== 5432 ||
        !rule.sourceSecurityGroupId ||
        !allowedDatabaseSources.has(rule.sourceSecurityGroupId) ||
        Boolean(rule.cidrIpv4 || rule.cidrIpv6 || rule.prefixListId),
    ) ||
    new Set(
      observation.databaseSecurityGroup.ingress.map(
        (rule) => rule.sourceSecurityGroupId,
      ),
    ).size !== allowedDatabaseSources.size ||
    !sameSet(observation.database.vpcSecurityGroupIds, [observation.databaseSecurityGroup.id])
  ) {
    throw new Error(
      "Shared Cell database security group must allow PostgreSQL only from the tenant and one-shot task security groups.",
    );
  }
  const database = observation.database;
  if (
    database.identifier !== `techlong-sandbox-${environment.cellKey}` ||
    database.status !== "available" ||
    database.engine !== "aurora-postgresql" ||
    database.engineVersion !== environment.policy.auroraPostgresEngineVersion ||
    database.engineMode !== "provisioned" ||
    database.port !== 5432 ||
    !database.storageEncrypted ||
    database.deletionProtection ||
    database.serverlessMinAcu !== environment.policy.auroraServerlessMinAcu ||
    database.serverlessMaxAcu !== environment.policy.auroraServerlessMaxAcu ||
    database.secondsUntilAutoPause !==
      environment.policy.auroraSecondsUntilAutoPause ||
    database.instances.length !== 1 ||
    database.instances.some(
      (instance) =>
        instance.status !== "available" ||
        instance.instanceClass !== "db.serverless" ||
        instance.publiclyAccessible ||
        instance.clusterIdentifier !== database.identifier,
    )
  ) {
    throw new Error(
      "Shared Cell database must be an available, private, encrypted Aurora PostgreSQL Serverless v2 cluster with one writer.",
    );
  }
  assertArnScope(database.arn, "rds", environment, "Aurora cluster ARN");
  for (const instance of database.instances) {
    assertArnScope(instance.arn, "rds", environment, "Aurora instance ARN");
  }
  const ownedResources: Array<[string, SharedCellResourceTags]> = [
    ["ECS cluster", observation.clusterTags],
    ["VPC", observation.vpcTags],
    ["internet gateway", observation.internetGateway.tags],
    ["load balancer", observation.loadBalancer.tags],
    ["task security group", observation.taskSecurityGroup.tags],
    ["one-shot task security group", observation.oneShotTaskSecurityGroup.tags],
    ["database security group", observation.databaseSecurityGroup.tags],
    ["Aurora cluster", observation.database.tags],
    ...observation.subnets.map(
      (subnet): [string, SharedCellResourceTags] => [
        `subnet ${subnet.id}`,
        subnet.tags,
      ],
    ),
    ...observation.loadBalancerSecurityGroups.map(
      (group): [string, SharedCellResourceTags] => [
        `load balancer security group ${group.id}`,
        group.tags,
      ],
    ),
    ...[...publicRouteTableIds].map(
      (routeTableId): [string, SharedCellResourceTags] => [
        `public route table ${routeTableId}`,
        observation.routeTables.find(
          (routeTable) => routeTable.id === routeTableId,
        )!.tags,
      ],
    ),
  ];
  for (const [label, tags] of ownedResources) {
    assertOwnedResource({
      tags,
      environment,
      observedAt: observation.observedAt,
      label,
    });
  }
}

export class DisabledSharedCellSecurityPreflight
  implements SharedCellSecurityPreflightPort
{
  async verify(): Promise<never> {
    const error = new Error(
      "ELBv2, EC2, ECS, RDS and STS Shared Cell security preflight adapters are not configured.",
    );
    Object.assign(error, {
      code: "SHARED_CELL_SECURITY_PREFLIGHT_DISABLED",
      retryable: false,
    });
    throw error;
  }
}
