import type {
  DeploymentExecutionBinding,
  SharedCellSecurityPreflightPort,
} from "./contracts.ts";
import type { DeploymentEnvironment } from "../environment.ts";
import { sha256Hex } from "./hash.ts";
import {
  assertSharedCellSecurityObservation,
  DisabledSharedCellSecurityPreflight,
  type SharedCellIngressObservation,
  type SharedCellListenerObservation,
  type SharedCellResourceTags,
  type SharedCellSecurityGroupObservation,
  type SharedCellSecurityObservation,
} from "./shared-cell-preflight.ts";

interface AwsReadOnlySdkClient {
  send(command: unknown): Promise<Record<string, unknown>>;
}

type AwsReadOnlyCommandConstructor = new (
  input: Record<string, unknown>,
) => unknown;

export interface AwsSdkSharedCellEvidenceDependencies {
  clients: {
    sts: AwsReadOnlySdkClient;
    ecs: AwsReadOnlySdkClient;
    elbv2: AwsReadOnlySdkClient;
    ec2: AwsReadOnlySdkClient;
    rds: AwsReadOnlySdkClient;
  };
  commands: {
    getCallerIdentity: AwsReadOnlyCommandConstructor;
    describeClusters: AwsReadOnlyCommandConstructor;
    describeListeners: AwsReadOnlyCommandConstructor;
    describeLoadBalancers: AwsReadOnlyCommandConstructor;
    describeRules: AwsReadOnlyCommandConstructor;
    describeTrustStores: AwsReadOnlyCommandConstructor;
    describeElbv2Tags: AwsReadOnlyCommandConstructor;
    describeVpcs: AwsReadOnlyCommandConstructor;
    describeSubnets: AwsReadOnlyCommandConstructor;
    describeSecurityGroups: AwsReadOnlyCommandConstructor;
    describeDBClusters: AwsReadOnlyCommandConstructor;
    describeDBInstances: AwsReadOnlyCommandConstructor;
    describeDBSubnetGroups: AwsReadOnlyCommandConstructor;
  };
  now?: () => number;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => text(item))
        .filter((item): item is string => Boolean(item))
    : [];
}

function tags(value: unknown): SharedCellResourceTags {
  return Object.fromEntries(
    records(value)
      .map((item) => [text(item.Key ?? item.key), text(item.Value ?? item.value)])
      .filter((item): item is [string, string] => Boolean(item[0] && item[1])),
  );
}

function one(
  values: unknown,
  predicate: (item: Record<string, unknown>) => boolean,
  label: string,
): Record<string, unknown> {
  const matches = records(values).filter(predicate);
  if (matches.length !== 1) {
    throw new SharedCellEvidenceError(
      "SHARED_CELL_EVIDENCE_INCOMPLETE",
      `Expected exactly one ${label}; observed ${matches.length}.`,
      false,
    );
  }
  return matches[0];
}

function flattenIngress(value: unknown): SharedCellIngressObservation[] {
  const result: SharedCellIngressObservation[] = [];
  for (const permission of records(value)) {
    const protocol = text(permission.IpProtocol) ?? "";
    const fromPort = numberValue(permission.FromPort) ?? -1;
    const toPort = numberValue(permission.ToPort) ?? -1;
    const base = { protocol, fromPort, toPort };
    for (const range of records(permission.IpRanges)) {
      const cidrIpv4 = text(range.CidrIp);
      result.push({ ...base, ...(cidrIpv4 ? { cidrIpv4 } : {}) });
    }
    for (const range of records(permission.Ipv6Ranges)) {
      const cidrIpv6 = text(range.CidrIpv6);
      result.push({ ...base, ...(cidrIpv6 ? { cidrIpv6 } : {}) });
    }
    for (const pair of records(permission.UserIdGroupPairs)) {
      const sourceSecurityGroupId = text(pair.GroupId);
      result.push({
        ...base,
        ...(sourceSecurityGroupId ? { sourceSecurityGroupId } : {}),
      });
    }
    for (const prefix of records(permission.PrefixListIds)) {
      const prefixListId = text(prefix.PrefixListId);
      result.push({ ...base, ...(prefixListId ? { prefixListId } : {}) });
    }
    if (
      !permission.IpRanges &&
      !permission.Ipv6Ranges &&
      !permission.UserIdGroupPairs &&
      !permission.PrefixListIds
    ) {
      result.push(base);
    }
  }
  return result;
}

function securityGroup(item: Record<string, unknown>): SharedCellSecurityGroupObservation {
  const id = text(item.GroupId);
  const vpcId = text(item.VpcId);
  if (!id || !vpcId) {
    throw new SharedCellEvidenceError(
      "SHARED_CELL_EVIDENCE_INCOMPLETE",
      "EC2 returned an incomplete security group.",
      false,
    );
  }
  return {
    id,
    vpcId,
    ingress: flattenIngress(item.IpPermissions),
    tags: tags(item.Tags),
  };
}

function listener(input: {
  item: Record<string, unknown>;
  trustStoreStatus: string | null;
  deniesSaasControlPaths: boolean;
}): SharedCellListenerObservation {
  const arn = text(input.item.ListenerArn);
  const loadBalancerArn = text(input.item.LoadBalancerArn);
  const protocol = text(input.item.Protocol);
  const port = numberValue(input.item.Port);
  if (!arn || !loadBalancerArn || protocol !== "HTTPS" || port === null) {
    throw new SharedCellEvidenceError(
      "SHARED_CELL_EVIDENCE_INCOMPLETE",
      "ELBv2 returned an incomplete HTTPS listener.",
      false,
    );
  }
  const mutualAuthentication = record(input.item.MutualAuthentication);
  const defaultActions = records(input.item.DefaultActions);
  const mode = text(mutualAuthentication.Mode) ?? "off";
  if (mode !== "off" && mode !== "passthrough" && mode !== "verify") {
    throw new SharedCellEvidenceError(
      "SHARED_CELL_EVIDENCE_INCOMPLETE",
      "ELBv2 returned an unknown mutual authentication mode.",
      false,
    );
  }
  return {
    arn,
    loadBalancerArn,
    protocol: "HTTPS",
    port,
    mutualAuthenticationMode: mode,
    trustStoreArn: text(mutualAuthentication.TrustStoreArn),
    trustStoreStatus: input.trustStoreStatus,
    defaultActionType:
      defaultActions.length === 1 ? text(defaultActions[0]?.Type) ?? "" : "",
    deniesSaasControlPaths: input.deniesSaasControlPaths,
  };
}

function hasSaasControlDenyRule(value: unknown): boolean {
  return records(value).some((rule) => {
    const conditions = records(rule.Conditions);
    const paths = conditions
      .filter((condition) => text(condition.Field) === "path-pattern")
      .flatMap((condition) => [
        ...stringValues(condition.Values),
        ...stringValues(record(condition.PathPatternConfig).Values),
      ]);
    const rejects = records(rule.Actions).some(
      (action) =>
        text(action.Type) === "fixed-response" &&
        text(record(action.FixedResponseConfig).StatusCode) === "404",
    );
    return (
      text(rule.Priority) === "1" &&
      conditions.length === 1 &&
      text(conditions[0]?.Field) === "path-pattern" &&
      rejects &&
      paths.includes("/api/saas") &&
      paths.includes("/api/saas/*")
    );
  });
}

export class SharedCellEvidenceError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function normalizeError(error: unknown): SharedCellEvidenceError {
  if (error instanceof SharedCellEvidenceError) return error;
  const item = record(error);
  const metadata = record(item.$metadata);
  const statusCode = numberValue(metadata.httpStatusCode) ?? 0;
  const name = text(item.name) ?? "SHARED_CELL_EVIDENCE_READ_FAILED";
  return new SharedCellEvidenceError(
    name.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100),
    (error instanceof Error ? error.message : String(error)).slice(0, 500),
    statusCode === 408 ||
      statusCode === 429 ||
      statusCode >= 500 ||
      /Throttl|Timeout|Unavailable|Internal|RequestLimit/i.test(name),
  );
}

export class AwsSdkSharedCellEvidenceAdapter
  implements SharedCellSecurityPreflightPort
{
  readonly region: string;
  private readonly sdk: AwsSdkSharedCellEvidenceDependencies;
  private readonly now: () => number;

  constructor(region: string, sdk: AwsSdkSharedCellEvidenceDependencies) {
    if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)) {
      throw new Error("Shared Cell evidence adapter region is invalid.");
    }
    this.region = region;
    this.sdk = sdk;
    this.now = sdk.now ?? (() => Date.now());
  }

  async verify(input: {
    environment: DeploymentEnvironment;
    binding: DeploymentExecutionBinding;
  }): Promise<{ verified: true; evidenceHash: string }> {
    try {
      const observation = await this.collect(input);
      assertSharedCellSecurityObservation({ ...input, observation });
      return { verified: true, evidenceHash: await sha256Hex(observation) };
    } catch (error) {
      throw normalizeError(error);
    }
  }

  private async collect(input: {
    environment: DeploymentEnvironment;
    binding: DeploymentExecutionBinding;
  }): Promise<SharedCellSecurityObservation> {
    if (this.region !== input.environment.region) {
      throw new SharedCellEvidenceError(
        "SHARED_CELL_REGION_MISMATCH",
        "The SDK client region does not match the deployment environment.",
        false,
      );
    }
    const identity = await this.sdk.clients.sts.send(
      new this.sdk.commands.getCallerIdentity({}),
    );
    const accountId = text(identity.Account);
    const callerArn = text(identity.Arn);
    if (
      accountId !== input.environment.expectedAccountId ||
      !callerArn ||
      !callerArn.startsWith(
        `arn:aws:sts::${input.environment.expectedAccountId}:assumed-role/TechlongSandboxProvisionerRole/`,
      )
    ) {
      throw new SharedCellEvidenceError(
        "SHARED_CELL_CALLER_MISMATCH",
        "STS caller identity is outside the reviewed Sandbox role.",
        false,
      );
    }
    const parameters = input.binding.tenantStackParameters;
    const clusterName = parameters.ClusterName;
    const httpsListenerArn = parameters.HttpsListenerArn;
    const controlListenerArn = parameters.ControlListenerArn;
    if (!clusterName || !httpsListenerArn || !controlListenerArn) {
      throw new SharedCellEvidenceError(
        "SHARED_CELL_BINDING_INCOMPLETE",
        "The deployment binding is missing Shared Cell identifiers.",
        false,
      );
    }
    const [clusterResponse, listenersResponse, databaseResponse] =
      await Promise.all([
        this.sdk.clients.ecs.send(
          new this.sdk.commands.describeClusters({
            clusters: [clusterName],
            include: ["TAGS"],
          }),
        ),
        this.sdk.clients.elbv2.send(
          new this.sdk.commands.describeListeners({
            ListenerArns: [httpsListenerArn, controlListenerArn],
          }),
        ),
        this.sdk.clients.rds.send(
          new this.sdk.commands.describeDBClusters({
            DBClusterIdentifier: `techlong-sandbox-${input.environment.cellKey}`,
          }),
        ),
      ]);
    const cluster = one(
      clusterResponse.clusters,
      (item) => text(item.clusterName) === clusterName,
      "ECS cluster",
    );
    const httpsListenerItem = one(
      listenersResponse.Listeners,
      (item) => text(item.ListenerArn) === httpsListenerArn,
      "business listener",
    );
    const controlListenerItem = one(
      listenersResponse.Listeners,
      (item) => text(item.ListenerArn) === controlListenerArn,
      "control listener",
    );
    const loadBalancerArn = text(httpsListenerItem.LoadBalancerArn);
    if (
      !loadBalancerArn ||
      loadBalancerArn !== text(controlListenerItem.LoadBalancerArn)
    ) {
      throw new SharedCellEvidenceError(
        "SHARED_CELL_LISTENER_MISMATCH",
        "The business and control listeners do not belong to one load balancer.",
        false,
      );
    }
    const trustStoreArn = text(
      record(controlListenerItem.MutualAuthentication).TrustStoreArn,
    );
    if (!trustStoreArn) {
      throw new SharedCellEvidenceError(
        "SHARED_CELL_TRUST_STORE_MISSING",
        "The control listener has no trust store.",
        false,
      );
    }
    const database = one(
      databaseResponse.DBClusters,
      (item) =>
        text(item.DBClusterIdentifier) ===
        `techlong-sandbox-${input.environment.cellKey}`,
      "Aurora DB cluster",
    );
    const databaseSubnetGroupName = text(database.DBSubnetGroup);
    const databaseSecurityGroupIds = records(database.VpcSecurityGroups)
      .map((item) => text(item.VpcSecurityGroupId))
      .filter((item): item is string => Boolean(item));
    if (!databaseSubnetGroupName) {
      throw new SharedCellEvidenceError(
        "SHARED_CELL_EVIDENCE_INCOMPLETE",
        "The Aurora cluster has no database subnet group.",
        false,
      );
    }
    const [
      loadBalancerResponse,
      businessRulesResponse,
      trustStoreResponse,
      loadBalancerTagsResponse,
      databaseInstancesResponse,
      databaseSubnetGroupsResponse,
    ] = await Promise.all([
      this.sdk.clients.elbv2.send(
        new this.sdk.commands.describeLoadBalancers({
          LoadBalancerArns: [loadBalancerArn],
        }),
      ),
      this.sdk.clients.elbv2.send(
        new this.sdk.commands.describeRules({ ListenerArn: httpsListenerArn }),
      ),
      this.sdk.clients.elbv2.send(
        new this.sdk.commands.describeTrustStores({
          TrustStoreArns: [trustStoreArn],
        }),
      ),
      this.sdk.clients.elbv2.send(
        new this.sdk.commands.describeElbv2Tags({
          ResourceArns: [loadBalancerArn],
        }),
      ),
      this.sdk.clients.rds.send(
        new this.sdk.commands.describeDBInstances({
          Filters: [
            {
              Name: "db-cluster-id",
              Values: [`techlong-sandbox-${input.environment.cellKey}`],
            },
          ],
        }),
      ),
      this.sdk.clients.rds.send(
        new this.sdk.commands.describeDBSubnetGroups({
          DBSubnetGroupName: databaseSubnetGroupName,
        }),
      ),
    ]);
    const databaseSubnetGroup = one(
      databaseSubnetGroupsResponse.DBSubnetGroups,
      (item) => text(item.DBSubnetGroupName) === databaseSubnetGroupName,
      "Aurora database subnet group",
    );
    const databaseSubnetIds = records(databaseSubnetGroup.Subnets)
      .map((item) => text(item.SubnetIdentifier))
      .filter((item): item is string => Boolean(item));
    const loadBalancer = one(
      loadBalancerResponse.LoadBalancers,
      (item) => text(item.LoadBalancerArn) === loadBalancerArn,
      "application load balancer",
    );
    const loadBalancerSecurityGroupIds = stringValues(
      loadBalancer.SecurityGroups,
    );
    const vpcId = text(loadBalancer.VpcId);
    const taskSubnetIds = stringValues(parameters.SubnetIds?.split(","));
    if (
      !vpcId ||
      text(databaseSubnetGroup.VpcId) !== vpcId ||
      taskSubnetIds.length < 2 ||
      loadBalancerSecurityGroupIds.length < 1 ||
      databaseSubnetIds.length < 2 ||
      databaseSecurityGroupIds.length !== 1
    ) {
      throw new SharedCellEvidenceError(
        "SHARED_CELL_EVIDENCE_INCOMPLETE",
        "The Shared Cell network or database evidence is incomplete.",
        false,
      );
    }
    const allSubnetIds = [...new Set([...taskSubnetIds, ...databaseSubnetIds])];
    const allSecurityGroupIds = [
      ...new Set([
        ...loadBalancerSecurityGroupIds,
        parameters.TaskSecurityGroupId,
        ...databaseSecurityGroupIds,
      ]),
    ].filter(Boolean);
    const [vpcsResponse, subnetsResponse, securityGroupsResponse] =
      await Promise.all([
        this.sdk.clients.ec2.send(
          new this.sdk.commands.describeVpcs({ VpcIds: [vpcId] }),
        ),
        this.sdk.clients.ec2.send(
          new this.sdk.commands.describeSubnets({ SubnetIds: allSubnetIds }),
        ),
        this.sdk.clients.ec2.send(
          new this.sdk.commands.describeSecurityGroups({
            GroupIds: allSecurityGroupIds,
          }),
        ),
      ]);
    const vpc = one(
      vpcsResponse.Vpcs,
      (item) => text(item.VpcId) === vpcId,
      "VPC",
    );
    const securityGroups = records(securityGroupsResponse.SecurityGroups).map(
      securityGroup,
    );
    const findSecurityGroup = (id: string, label: string) => {
      const matches = securityGroups.filter((group) => group.id === id);
      if (matches.length !== 1) {
        throw new SharedCellEvidenceError(
          "SHARED_CELL_EVIDENCE_INCOMPLETE",
          `Expected exactly one ${label}; observed ${matches.length}.`,
          false,
        );
      }
      return matches[0];
    };
    const trustStore = one(
      trustStoreResponse.TrustStores,
      (item) => text(item.TrustStoreArn) === trustStoreArn,
      "ALB trust store",
    );
    const loadBalancerTagDescription = one(
      loadBalancerTagsResponse.TagDescriptions,
      (item) => text(item.ResourceArn) === loadBalancerArn,
      "load balancer tag description",
    );
    const scaling = record(database.ServerlessV2ScalingConfiguration);
    return {
      observedAt: this.now(),
      accountId,
      callerArn,
      region: this.region,
      clusterName,
      clusterArn: text(cluster.clusterArn) ?? "",
      clusterStatus: text(cluster.status) ?? "",
      clusterTags: tags(cluster.tags),
      vpcId,
      vpcState: text(vpc.State) ?? "",
      vpcTags: tags(vpc.Tags),
      subnetIds: taskSubnetIds,
      subnets: records(subnetsResponse.Subnets).map((subnet) => ({
        id: text(subnet.SubnetId) ?? "",
        vpcId: text(subnet.VpcId) ?? "",
        availabilityZone: text(subnet.AvailabilityZone) ?? "",
        state: text(subnet.State) ?? "",
        mapPublicIpOnLaunch: subnet.MapPublicIpOnLaunch === true,
        tags: tags(subnet.Tags),
      })),
      httpsListener: listener({
        item: httpsListenerItem,
        trustStoreStatus: null,
        deniesSaasControlPaths: hasSaasControlDenyRule(
          businessRulesResponse.Rules,
        ),
      }),
      controlListener: listener({
        item: controlListenerItem,
        trustStoreStatus: text(trustStore.Status),
        deniesSaasControlPaths: false,
      }),
      loadBalancer: {
        arn: loadBalancerArn,
        name: text(loadBalancer.LoadBalancerName) ?? "",
        type: text(loadBalancer.Type) ?? "",
        scheme: text(loadBalancer.Scheme) ?? "",
        state: text(record(loadBalancer.State).Code) ?? "",
        vpcId,
        subnetIds: records(loadBalancer.AvailabilityZones)
          .map((item) => text(item.SubnetId))
          .filter((item): item is string => Boolean(item)),
        securityGroupIds: loadBalancerSecurityGroupIds,
        tags: tags(loadBalancerTagDescription.Tags),
      },
      loadBalancerSecurityGroups: loadBalancerSecurityGroupIds.map((id) =>
        findSecurityGroup(id, `load balancer security group ${id}`),
      ),
      taskSecurityGroup: findSecurityGroup(
        parameters.TaskSecurityGroupId,
        "task security group",
      ),
      databaseSecurityGroup: findSecurityGroup(
        databaseSecurityGroupIds[0],
        "database security group",
      ),
      database: {
        arn: text(database.DBClusterArn) ?? "",
        identifier: text(database.DBClusterIdentifier) ?? "",
        status: text(database.Status) ?? "",
        engine: text(database.Engine) ?? "",
        engineVersion: text(database.EngineVersion) ?? "",
        engineMode: text(database.EngineMode) ?? "",
        port: numberValue(database.Port) ?? -1,
        storageEncrypted: database.StorageEncrypted === true,
        deletionProtection: database.DeletionProtection === true,
        serverlessMinAcu: numberValue(scaling.MinCapacity),
        serverlessMaxAcu: numberValue(scaling.MaxCapacity),
        secondsUntilAutoPause: numberValue(scaling.SecondsUntilAutoPause),
        vpcSecurityGroupIds: databaseSecurityGroupIds,
        subnetIds: databaseSubnetIds,
        tags: tags(database.TagList),
        instances: records(databaseInstancesResponse.DBInstances).map(
          (instance) => ({
            arn: text(instance.DBInstanceArn) ?? "",
            identifier: text(instance.DBInstanceIdentifier) ?? "",
            status: text(instance.DBInstanceStatus) ?? "",
            instanceClass: text(instance.DBInstanceClass) ?? "",
            publiclyAccessible: instance.PubliclyAccessible === true,
            clusterIdentifier: text(instance.DBClusterIdentifier) ?? "",
          }),
        ),
      },
    };
  }
}

export function createInjectedSharedCellSecurityPreflight(
  region: string,
  dependencies?: AwsSdkSharedCellEvidenceDependencies,
): SharedCellSecurityPreflightPort {
  if (!dependencies) return new DisabledSharedCellSecurityPreflight();
  return new AwsSdkSharedCellEvidenceAdapter(region, dependencies);
}
