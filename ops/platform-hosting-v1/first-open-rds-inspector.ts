import { readFileSync } from "node:fs";
import type { Service, Task as EcsTask } from "@aws-sdk/client-ecs";
import { awsSandboxTenantStackName } from "../../lib/deployments/cloudformation/tenant-stack.ts";
import type { EcsFirstOpenApproval } from "../../lib/deployments/execution/ecs-first-open.ts";
import { FIRST_OPEN_TENANT_PRIVATE_SUBNET_OUTPUT, isFirstOpenRdsPrivateSubnetIds } from "../../lib/deployments/execution/first-open-tenant-network.ts";
import type { FirstOnboardingRuntimeReader } from "../../lib/deployments/execution/first-onboarding-inspection.ts";
import { canonicalJson } from "../../lib/deployments/execution/hash.ts";
import type { InstanceBinding, SoftwareRelease } from "../../lib/deployments/releases/contract.ts";
import { sampleInstanceRelease, type ReleaseMetadataApi, type ReleaseSamplingBinding } from "../../lib/deployments/releases/sampling.ts";
import { FIRST_OPEN_TASK_ACCOUNT as account, FIRST_OPEN_TASK_REGION as region, FIRST_OPEN_TASK_ROLE,
  type attestFirstOpenTask } from "./first-open-task-identity.ts";
import { createTenantPostgresAdapter } from "./first-open-tenant-postgres.mjs";
import { createFirstOpenInspectorSdk, isFirstOpenRoute53Endpoint, readFirstOpenPrivateTechnical } from "./first-open-inspector-sdk.ts";

type Approval = Pick<EcsFirstOpenApproval, "instanceId" | "workspaceId" | "hostname" | "baselineDigest" | "databaseSchemaVersion" | "dnsTarget" | "writeBefore">;
type Task = Pick<Awaited<ReturnType<typeof attestFirstOpenTask>>, "roleArn" | "credentials">;
type Database = NonNullable<Parameters<FirstOnboardingRuntimeReader["capture"]>[0]["databaseName"]>;
type DatabaseObservation = Awaited<ReturnType<FirstOnboardingRuntimeReader["capture"]>>["database"];
export interface FirstOpenRdsInspectorMaterial {
  stackName: string;
  sampling: ReleaseSamplingBinding;
  privateSubnetIds: readonly string[];
  route53Endpoint: string;
  ingress: {
    albArn: string;
    dnsName: string;
    httpsListenerArn: string;
    controlListenerArn: string;
    vpcId: string;
    clusterArn: string;
  };
  tenant: {
    host: string;
    dbInstanceIdentifier: string;
    dbiResourceId: string;
    database: string;
    owner: string;
    username: string;
    applicationRole: string;
    databaseOid: string;
    ownershipMarker: string;
    databaseUrl: string;
    runtimeSecretArn: string;
  };
}

type Scope = { productId: string; environmentId: string };
type InspectorOptions = {
  approval: Approval; scope: Scope; release: SoftwareRelease; identity: Task;
  material(signal: AbortSignal): FirstOpenRdsInspectorMaterial | Promise<FirstOpenRdsInspectorMaterial>;
  now?: () => number;
};

const sha = /^[a-f0-9]{64}$/;
const digest = /^sha256:[a-f0-9]{64}$/;
const name = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
const cfArn = `arn:aws:cloudformation:${region}:${account}:stack/`;
const ecsArn = `arn:aws:ecs:${region}:${account}:`;
const elbArn = `arn:aws:elasticloadbalancing:${region}:${account}:`;
const secretArn = `arn:aws:secretsmanager:${region}:${account}:secret:`;
const ecrRepositoryPrefix = `${account}.dkr.ecr.${region}.amazonaws.com/`;
const taskRoleSession = `arn:aws:sts::${account}:assumed-role/TechlongSandboxFirstOpenTaskRole/`;
const tenantNetworkScope = "ECS_FIRST_OPEN_INSPECTOR_TENANT_NETWORK_SCOPE";

function requireScope(assertion: unknown, code = "ECS_FIRST_OPEN_INSPECTOR_SCOPE"): asserts assertion {
  if (!assertion) throw Error(code);
}

function same(input: unknown, expected: unknown) {
  return canonicalJson(input) === canonicalJson(expected);
}

function scopedStack(stackId: string, name: string) {
  const prefix = `${cfArn}${name}/`;
  return stackId.startsWith(prefix) && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(stackId.slice(prefix.length));
}

function bindMaterial(material: FirstOpenRdsInspectorMaterial, approval: Approval, stackId: string, databaseName: Database) {
  const { stackName, sampling, privateSubnetIds, ingress, tenant } = structuredClone(material);
  requireScope(stackName === awsSandboxTenantStackName(approval.instanceId) && scopedStack(stackId, stackName));
  requireScope(isFirstOpenRdsPrivateSubnetIds(privateSubnetIds) &&
    sampling.cellOutputParameters?.SubnetIds === FIRST_OPEN_TENANT_PRIVATE_SUBNET_OUTPUT, tenantNetworkScope);
  requireScope(scopedStack(sampling.cellStackId, "techlong-sandbox-cell-sandbox-1") &&
    scopedStack(sampling.platformStackId, "techlong-sandbox-platform-hosting-v1") &&
    sampling.apiHostname === approval.hostname && /^[A-Z0-9]{4,32}$/.test(sampling.hostedZoneId) &&
    sampling.database.kind === "instance" && sampling.database.profile === "full_password" &&
    sampling.database.schemaVersion === approval.databaseSchemaVersion && sampling.database.identifier === tenant.dbInstanceIdentifier &&
    /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(sampling.persistence.bucket) &&
    /^[A-Z_][A-Z0-9_]{1,63}$/.test(sampling.persistence.providerVariable) &&
    /^[A-Z_][A-Z0-9_]{1,63}$/.test(sampling.persistence.bucketVariable) &&
    sha.test(sampling.persistence.verificationSha256) && isFirstOpenRoute53Endpoint(material.route53Endpoint));
  requireScope(sampling.secrets.length > 0 && sampling.secrets.length <= 8 &&
    new Set(sampling.secrets.map(secret => secret.arn)).size === sampling.secrets.length &&
    sampling.secrets.every(secret => secret.arn.startsWith(secretArn) &&
      /^[A-Za-z0-9/_+=.@-]{1,512}$/.test(secret.arn.slice(secretArn.length)) && /^[A-Za-z0-9-]{32,64}$/.test(secret.versionId)) &&
    sampling.secrets.some(secret => secret.arn === tenant.runtimeSecretArn));
  const albPrefix = elbArn + "loadbalancer/";
  const albPath = ingress.albArn.slice(albPrefix.length);
  const listenerPrefix = elbArn + "listener/" + albPath + "/";
  requireScope(ingress.albArn.startsWith(albPrefix) && /^app\/[A-Za-z0-9-]{1,32}\/[a-f0-9]{16}$/.test(albPath) &&
    ingress.httpsListenerArn !== ingress.controlListenerArn &&
    [ingress.httpsListenerArn, ingress.controlListenerArn].every(arn => arn.startsWith(listenerPrefix) && /^[a-f0-9]{16}$/.test(arn.slice(listenerPrefix.length))) &&
    /^internal-[a-z0-9-]{2,128}\.ca-central-1\.elb\.amazonaws\.com$/.test(ingress.dnsName) &&
    [ingress.dnsName, "dualstack." + ingress.dnsName].includes(approval.dnsTarget) &&
    /^vpc-(?:[a-f0-9]{8}|[a-f0-9]{17})$/.test(ingress.vpcId) &&
    ingress.clusterArn.startsWith(ecsArn + "cluster/") && /^[A-Za-z0-9_-]{1,128}$/.test(ingress.clusterArn.slice((ecsArn + "cluster/").length)));
  requireScope(tenant.database === databaseName && /^tenant_[a-z0-9]{1,16}_db$/.test(tenant.database) &&
    /^[a-z][a-z0-9-]{0,62}$/.test(tenant.dbInstanceIdentifier) &&
    tenant.host.startsWith(tenant.dbInstanceIdentifier + ".") && /^[a-z0-9.-]+\.ca-central-1\.rds\.amazonaws\.com$/.test(tenant.host) &&
    /^db-[A-Z0-9]{10,64}$/.test(tenant.dbiResourceId) && /^[1-9][0-9]{0,9}$/.test(tenant.databaseOid) &&
    [tenant.owner, tenant.username, tenant.applicationRole].every(role => name.test(role)) &&
    new Set([tenant.owner, tenant.username, tenant.applicationRole]).size === 3 &&
    /^tl_owner_[a-f0-9]{32}_g1$/.test(tenant.ownershipMarker));
  return { sampling, privateSubnetIds, ingress, tenant, route53Endpoint: material.route53Endpoint };
}

type BoundMaterial = ReturnType<typeof bindMaterial>;
type Cloud = ReturnType<typeof createFirstOpenInspectorSdk>;
type Technical = typeof readFirstOpenPrivateTechnical;
type DatabaseReader = (input: { tenant: BoundMaterial["tenant"]; baselineDigest: string; signal: AbortSignal }) => Promise<DatabaseObservation>;
type ResourceRow = { LogicalResourceId?: string; PhysicalResourceId?: string; ResourceType?: string; ResourceStatus?: string };

function readTenantDatabase({ tenant, baselineDigest, signal }: Parameters<DatabaseReader>[0]) {
  const { databaseUrl, applicationRole, ...approved } = tenant;
  return createTenantPostgresAdapter({ target: { ...approved, kind: "rds", engine: "postgres", port: 5432 },
    localPassword: undefined, localSsl: undefined, databaseUrl, ca: readFileSync("/app/certs/amazon-rds.pem", "utf8") })
    .inspectFirstOpen({ applicationRole, baselineDigest, signal });
}

function makeReadBoundary(input: {
  bound: BoundMaterial; approval: Approval; stackId: string; release: SoftwareRelease; cloud: Cloud;
  technical: Technical; signal: AbortSignal; now: () => number;
}) {
  const { bound: { sampling, privateSubnetIds, ingress, tenant }, approval, stackId, release, cloud, technical, signal, now } = input;
  const cluster = ingress.clusterArn.slice((ecsArn + "cluster/").length);
  let resources: ResourceRow[] = [], taskArns: string[] = [], observedDns: string | undefined, reads = 0;
  const checkWindow = () => {
    signal.throwIfAborted();
    requireScope(now() < approval.writeBefore, "FIRST_ONBOARDING_WINDOW_CLOSED");
  };
  const resource = (id: string) => resources.find(row => row.LogicalResourceId === id)?.PhysicalResourceId;
  const ruleArns = () => resources.filter(row => row.ResourceType === "AWS::ElasticLoadBalancingV2::ListenerRule").map(row => row.PhysicalResourceId);
  const exact = (value: unknown, expected: unknown) => {
    requireScope(same(value, expected), "ECS_FIRST_OPEN_INSPECTOR_READ_SCOPE");
  };
  const api = {
    async read<T>(service: string, operation: string, args: Record<string, unknown>): Promise<T> {
      checkWindow();
      requireScope(++reads <= 28, "ECS_FIRST_OPEN_INSPECTOR_READ_BUDGET");
      const action = service + ":" + operation;
      switch (action) {
        case "cloudformation:describe-stacks":
          requireScope([stackId, sampling.cellStackId, sampling.platformStackId].some(expected => same(args, { StackName: expected })));
          break;
        case "cloudformation:get-template": exact(args, { StackName: stackId, TemplateStage: "Original" }); break;
        case "cloudformation:list-stack-resources":
        case "cloudformation:list-change-sets": exact(args, { StackName: stackId }); break;
        case "rds:describe-db-instances": exact(args, { DBInstanceIdentifier: tenant.dbInstanceIdentifier }); break;
        case "ecs:describe-services":
          requireScope(resource("TenantService"));
          exact(args, { cluster: ingress.clusterArn, services: [resource("TenantService")] }); break;
        case "ecs:describe-task-definition":
          requireScope(resource("TenantTaskDefinition"));
          exact(args, { taskDefinition: resource("TenantTaskDefinition") }); break;
        case "ecs:list-tasks":
          requireScope(resource("TenantService"));
          exact(args, { cluster: ingress.clusterArn, serviceName: resource("TenantService")?.split("/").at(-1), desiredStatus: "RUNNING" }); break;
        case "ecs:describe-tasks":
          requireScope(taskArns.length > 0);
          exact(args, { cluster: ingress.clusterArn, tasks: taskArns }); break;
        case "elbv2:describe-listeners": exact(args, { ListenerArns: [ingress.httpsListenerArn, ingress.controlListenerArn] }); break;
        case "elbv2:describe-load-balancers": exact(args, { LoadBalancerArns: [ingress.albArn] }); break;
        case "elbv2:describe-target-groups":
          requireScope(resource("TenantTargetGroup"));
          exact(args, { TargetGroupArns: [resource("TenantTargetGroup")] }); break;
        case "elbv2:describe-target-health":
          requireScope(resource("TenantTargetGroup"));
          exact(args, { TargetGroupArn: resource("TenantTargetGroup") }); break;
        case "elbv2:describe-rules":
          requireScope(ruleArns().length === 3);
          exact(args, { RuleArns: ruleArns() }); break;
        case "route53:list-resource-record-sets":
          exact(args, { HostedZoneId: sampling.hostedZoneId, StartRecordName: approval.hostname + ".", StartRecordType: "A", MaxItems: "1" }); break;
        case "secretsmanager:describe-secret":
          requireScope(sampling.secrets.some(secret => same(args, { SecretId: secret.arn }))); break;
        case "s3api:head-bucket": exact(args, { Bucket: sampling.persistence.bucket, ExpectedBucketOwner: account }); break;
        case "ecr:batch-get-image":
          exact(args, { registryId: account, repositoryName: release.image.repository.slice(ecrRepositoryPrefix.length),
            imageIds: [{ imageDigest: release.image.manifestDigest }] }); break;
        default: throw Error("ECS_FIRST_OPEN_INSPECTOR_OPERATION");
      }
      const result = await cloud.read(service, operation, args, signal);
      checkWindow();
      if (action === "cloudformation:describe-stacks" && args.StackName === sampling.cellStackId) {
        const { Stacks = [], NextToken } = result as { Stacks?: { StackId?: string; Outputs?: { OutputKey?: string; OutputValue?: string }[] }[]; NextToken?: string };
        const outputs = Stacks[0]?.Outputs?.filter(output => output.OutputKey === FIRST_OPEN_TENANT_PRIVATE_SUBNET_OUTPUT);
        requireScope(Stacks.length === 1 && Stacks[0].StackId === sampling.cellStackId && !NextToken &&
          outputs?.length === 1 && outputs[0].OutputValue === privateSubnetIds.join(","), tenantNetworkScope);
      }
      if (action === "cloudformation:list-stack-resources") {
        const page = result as { StackResourceSummaries?: ResourceRow[]; NextToken?: string };
        requireScope(Array.isArray(page.StackResourceSummaries) && !page.NextToken && page.StackResourceSummaries.length <= 60);
        resources = page.StackResourceSummaries.filter(row => row.ResourceStatus !== "DELETE_COMPLETE");
        const scopedResource = (id: string, prefix: string, end: RegExp) => {
          const arn = resource(id);
          return typeof arn === "string" && arn.startsWith(prefix) && end.test(arn.slice(prefix.length));
        };
        requireScope(new Set(resources.map(row => row.LogicalResourceId)).size === resources.length &&
          scopedResource("TenantService", `${ecsArn}service/${cluster}/`, /^[A-Za-z0-9_-]{1,128}$/) &&
          scopedResource("TenantTaskDefinition", ecsArn + "task-definition/", /^[A-Za-z0-9_-]{1,128}:[1-9][0-9]*$/) &&
          scopedResource("TenantTargetGroup", elbArn + "targetgroup/", /^[A-Za-z0-9-]{1,32}\/[a-f0-9]{16}$/) &&
          ruleArns().every(arn => [ingress.httpsListenerArn, ingress.controlListenerArn].some(listener => {
            const prefix = listener.replace(":listener/", ":listener-rule/") + "/";
            return arn?.startsWith(prefix) && /^[a-f0-9]{16}$/.test(arn.slice(prefix.length));
          })));
      }
      if (action === "ecs:list-tasks") {
        const page = result as { taskArns?: string[]; nextToken?: string };
        const prefix = `${ecsArn}task/${cluster}/`;
        requireScope(Array.isArray(page.taskArns) && !page.nextToken && page.taskArns.length > 0 && page.taskArns.length <= 2 &&
          new Set(page.taskArns).size === page.taskArns.length &&
          page.taskArns.every(arn => typeof arn === "string" && arn.startsWith(prefix) && /^[a-f0-9]{32}$/.test(arn.slice(prefix.length))), tenantNetworkScope);
        taskArns = [...page.taskArns];
      }
      if (action === "ecs:describe-services") {
        const { services = [], failures } = result as { services?: Service[]; failures?: unknown[] };
        const observed = services[0];
        const network = observed?.networkConfiguration?.awsvpcConfiguration;
        requireScope(!failures?.length && services.length === 1 && observed.serviceArn === resource("TenantService") &&
          observed.clusterArn === ingress.clusterArn && observed.taskDefinition === resource("TenantTaskDefinition") &&
          network?.assignPublicIp === "DISABLED" && isFirstOpenRdsPrivateSubnetIds(network.subnets) &&
          network.subnets.every(subnet => privateSubnetIds.includes(subnet)), tenantNetworkScope);
      }
      if (action === "ecs:describe-tasks") {
        const { tasks = [], failures } = result as { tasks?: EcsTask[]; failures?: unknown[] };
        const serviceName = resource("TenantService")?.split("/").at(-1);
        requireScope(!failures?.length && same(tasks.map(task => task.taskArn).sort(), [...taskArns].sort()), tenantNetworkScope);
        const observedEnis = new Set<string>();
        for (const task of tasks) {
          const enis = task.attachments?.filter(attachment => attachment.type === "ElasticNetworkInterface");
          const eni = enis?.[0];
          requireScope(task.clusterArn === ingress.clusterArn && task.taskDefinitionArn === resource("TenantTaskDefinition") &&
            task.group === `service:${serviceName}` && task.lastStatus === "RUNNING" && enis?.length === 1 && eni?.status === "ATTACHED", tenantNetworkScope);
          const subnets = eni.details?.filter(detail => detail.name === "subnetId");
          const interfaces = eni.details?.filter(detail => detail.name === "networkInterfaceId");
          const subnet = subnets?.[0]?.value, interfaceId = interfaces?.[0]?.value;
          requireScope(subnets?.length === 1 && typeof subnet === "string" && privateSubnetIds.includes(subnet) &&
            interfaces?.length === 1 && typeof interfaceId === "string" && /^eni-(?:[a-f0-9]{8}|[a-f0-9]{17})$/.test(interfaceId) &&
            !observedEnis.has(interfaceId), tenantNetworkScope);
          observedEnis.add(interfaceId);
        }
      }
      if (action === "rds:describe-db-instances") {
        const { DBInstances = [], Marker } = result as { DBInstances?: {
          DBInstanceArn?: string; DBInstanceIdentifier?: string; DBInstanceStatus?: string; DbiResourceId?: string;
          Engine?: string; EngineVersion?: string; PubliclyAccessible?: boolean; StorageEncrypted?: boolean;
          Endpoint?: { Address?: string; Port?: number }; DBSubnetGroup?: { VpcId?: string };
        }[]; Marker?: string };
        const db = DBInstances[0];
        requireScope(DBInstances.length === 1 && !Marker && db.DBInstanceArn === `arn:aws:rds:${region}:${account}:db:${tenant.dbInstanceIdentifier}` &&
          db.DBInstanceIdentifier === tenant.dbInstanceIdentifier && db.DbiResourceId === tenant.dbiResourceId && db.DBInstanceStatus === "available" &&
          db.Engine === "postgres" && db.EngineVersion === "16.14" && db.PubliclyAccessible === false && db.StorageEncrypted === true &&
          db.Endpoint?.Address === tenant.host && db.Endpoint.Port === 5432 && db.DBSubnetGroup?.VpcId === ingress.vpcId,
        "ECS_FIRST_OPEN_INSPECTOR_RDS_SCOPE");
      }
      if (action === "elbv2:describe-load-balancers") {
        const { LoadBalancers = [] } = result as { LoadBalancers?: { LoadBalancerArn?: string; DNSName?: string; VpcId?: string; Scheme?: string }[] };
        const alb = LoadBalancers[0];
        requireScope(LoadBalancers.length === 1 && alb.LoadBalancerArn === ingress.albArn && alb.DNSName === ingress.dnsName &&
          alb.VpcId === ingress.vpcId && alb.Scheme === "internal", "ECS_FIRST_OPEN_INSPECTOR_ALB_SCOPE");
      }
      if (action === "route53:list-resource-record-sets") {
        const records = (result as { ResourceRecordSets?: { Name?: string; Type?: string; AliasTarget?: { DNSName?: string } }[] }).ResourceRecordSets ?? [];
        observedDns = records[0]?.AliasTarget?.DNSName?.replace(/\.$/, "");
        requireScope(records.length === 1 && records[0].Name === approval.hostname + "." &&
          records[0].Type === "A" && observedDns === approval.dnsTarget, "ECS_FIRST_OPEN_INSPECTOR_DNS_SCOPE");
      }
      return result as T;
    },
    async getTechnical(path: "/health" | "/ready", origin: string) {
      checkWindow();
      requireScope(origin === "https://" + approval.hostname && (path === "/health" || path === "/ready"));
      const result = await technical({ path, hostname: approval.hostname, albDnsName: ingress.dnsName, signal, now });
      checkWindow();
      requireScope(result.status === 200 && result.tlsVerified === true, "ECS_FIRST_OPEN_INSPECTOR_HTTP_UNVERIFIED");
      return result;
    },
  };
  return { api: api satisfies ReleaseMetadataApi, checkWindow, dnsTarget: () => observedDns };
}

/** Production-shaped read-only adapter. No stack mutation, role assumption,
 * Secret value retrieval, database writes or public health fallback are exposed. */
export function createFirstOpenRdsInspector({ approval: raw, scope: rawScope, release: rawRelease, identity, material, now = Date.now }: InspectorOptions, {
  openCloud = createFirstOpenInspectorSdk, technical = readFirstOpenPrivateTechnical, database = readTenantDatabase,
}: { openCloud?: typeof createFirstOpenInspectorSdk; technical?: Technical; database?: DatabaseReader } = {}): FirstOnboardingRuntimeReader {
  const approval = structuredClone(raw), scope = structuredClone(rawScope), release = structuredClone(rawRelease);
  requireScope(identity.roleArn === FIRST_OPEN_TASK_ROLE && typeof identity.credentials === "function" &&
    typeof material === "function" && Number.isSafeInteger(approval.writeBefore) && approval.writeBefore > now() &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.sandbox\.techlong\.cloud$/.test(approval.hostname) && sha.test(approval.baselineDigest) &&
    release.status === "ecr_verified" && release.component === "tenant_api" && release.productId === scope.productId &&
    release.compatibility.applicationPort === 3000 && release.compatibility.databaseProfiles.includes("full_password") &&
    release.compatibility.schemaVersions.includes(approval.databaseSchemaVersion) && release.compatibility.clientApiVersions.length > 0 &&
    release.image.repository.startsWith(ecrRepositoryPrefix) && /^[a-z0-9/_-]{1,255}$/.test(release.image.repository.slice(ecrRepositoryPrefix.length)) &&
    digest.test(release.image.manifestDigest) && digest.test(release.image.platformDigest));
  let captured = false;
  return Object.freeze({ async capture({ stackId, hostname, databaseName, signal }: Parameters<FirstOnboardingRuntimeReader["capture"]>[0]) {
    signal.throwIfAborted();
    requireScope(!captured && hostname === approval.hostname && now() < approval.writeBefore);
    captured = true;
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(approval.writeBefore - now())]);
    const bound = bindMaterial(await material(bounded), approval, stackId, databaseName);
    const cloud = openCloud(identity.credentials, bound.route53Endpoint);
    const caller = await cloud.caller(bounded);
    requireScope(caller.Account === account && caller.Arn?.startsWith(taskRoleSession) &&
      /^[A-Za-z0-9_+=,.@-]{2,128}$/.test(caller.Arn.slice(taskRoleSession.length)), "ECS_FIRST_OPEN_INSPECTOR_ROLE_SCOPE");
    const reader = makeReadBoundary({ bound, approval, stackId, release, cloud, technical, signal: bounded, now });
    const binding: InstanceBinding & { sampling: ReleaseSamplingBinding } = {
      instanceId: approval.instanceId, workspaceId: approval.workspaceId, productId: scope.productId, environmentId: scope.environmentId,
      accountId: account, region, stackId, initialized: false, status: "pending", sourceRepository: release.source.repository,
      imageRepository: release.image.repository, runtimePlatform: "linux/amd64", applicationPort: 3000, clientApiVersion: release.compatibility.clientApiVersions[0],
      desiredCount: 1, templateSha256: "", configurationSha256: "", stateRevision: 0, currentRelease: null, sampling: bound.sampling,
    };
    const facts = await sampleInstanceRelease(binding, release, reader.api, now);
    reader.checkWindow();
    requireScope(facts.databaseAvailable && facts.albPresent && facts.persistentUploadsReady && reader.dnsTarget() === approval.dnsTarget,
      "ECS_FIRST_OPEN_INSPECTOR_PROVIDER_UNVERIFIED");
    const observation = await database({ tenant: bound.tenant, baselineDigest: approval.baselineDigest, signal: bounded });
    reader.checkWindow();
    requireScope(same(observation, { name: bound.tenant.database, roleName: bound.tenant.applicationRole,
      ownershipMarker: bound.tenant.ownershipMarker, baselineDigest: approval.baselineDigest }), "ECS_FIRST_OPEN_INSPECTOR_DATABASE_UNVERIFIED");
    for (const path of ["/health", "/ready"] as const) facts.checks.push({ path, ...await reader.api.getTechnical(path, "https://" + hostname) });
    facts.observedAt = now();
    return { facts, dns: { hostname, target: approval.dnsTarget }, database: observation };
  } });
}
