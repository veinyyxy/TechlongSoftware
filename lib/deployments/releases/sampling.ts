import type { Service, Task, TaskDefinition } from "@aws-sdk/client-ecs";
import type { DescribeChangeSetOutput } from "@aws-sdk/client-cloudformation";
import type { InstanceBinding, SoftwareRelease, ImageUpdatePlan, InstanceReleaseObservation } from "./contract.ts";
import type { ReleaseRuntimeFacts, ReleaseRuntimeReader } from "./inspection.ts";
import { releaseRuntimeDigests } from "./inspection.ts";
import { canonicalJson, sha256Hex } from "../execution/hash.ts";

/** Imported once into the authoritative instance binding, not workflow inputs or fixed job files. */
export interface ReleaseSamplingBinding {
  cellStackId: string; platformStackId: string; hostedZoneId: string; apiHostname: string;
  cellOutputParameters: Record<string, string>;
  database: { kind: "cluster" | "instance"; identifier: string; profile: InstanceReleaseObservation["databaseProfile"]; schemaVersion: string };
  secrets: { arn: string; versionId: string }[];
  persistence: { bucket: string; providerVariable: string; bucketVariable: string; verificationSha256: string };
}
export interface ReleaseMetadataApi {
  read<T>(service: string, operation: string, input: Record<string, unknown>): Promise<T>;
  getTechnical(path: "/health" | "/ready", origin: string): Promise<{ status: number; tlsVerified: boolean; checkedAt: number }>;
}
interface Stack { StackId: string; StackStatus: string; LastUpdatedTime?: string; CreationTime: string;
  RoleARN?: string; Tags?: { Key: string; Value: string }[]; Parameters?: { ParameterKey: string; ParameterValue: string }[];
  Outputs?: { OutputKey: string; OutputValue: string }[] }
const map = (values: { key: string; value: string }[]) => Object.fromEntries(values.map(v => [v.key, v.value]));

export function samplingBinding(binding: InstanceBinding): ReleaseSamplingBinding {
  const s = (binding as InstanceBinding & { sampling?: ReleaseSamplingBinding }).sampling;
  const arnPrefix = `arn:aws:cloudformation:${binding.region}:${binding.accountId}:stack/`;
  if (!s || ![s.cellStackId, s.platformStackId].every(v => v.startsWith(arnPrefix)) ||
    !s.hostedZoneId || !/^[a-z0-9.-]+$/.test(s.apiHostname) || !s.apiHostname.endsWith(".sandbox.techlong.cloud") ||
    !s.database.identifier || !s.database.schemaVersion || !["cluster", "instance"].includes(s.database.kind) ||
    !s.persistence.bucket || !s.persistence.providerVariable || !s.persistence.bucketVariable || !/^[a-f0-9]{64}$/.test(s.persistence.verificationSha256) ||
    !["HttpsListenerArn", "ControlListenerArn", "ClusterName"].every(k => Object.values(s.cellOutputParameters).includes(k)) ||
    !s.secrets.length || s.secrets.some(r => !r.arn.startsWith(`arn:aws:secretsmanager:${binding.region}:${binding.accountId}:secret:`) || !r.versionId)) {
    throw new Error("RELEASE_SAMPLING_BINDING_REQUIRED");
  }
  return s;
}

/** Fixed read operations only. Pagination/incomplete service lists never become positive evidence. */
export async function sampleInstanceRelease(binding: InstanceBinding, release: SoftwareRelease, api: ReleaseMetadataApi,
  now: () => number, changeSetId?: string): Promise<ReleaseRuntimeFacts> {
  const s = samplingBinding(binding), read = api.read.bind(api);
  if (release.productId !== binding.productId || release.component !== "tenant_api" || release.image.repository !== binding.imageRepository) throw new Error("RELEASE_SAMPLING_PRODUCT_MISMATCH");
  const ownStack = async (id: string) => {
    const result = await read<{ Stacks: Stack[] }>("cloudformation", "describe-stacks", { StackName: id });
    if (result.Stacks.length !== 1 || result.Stacks[0].StackId !== id) throw new Error("RELEASE_SAMPLING_STACK_MISMATCH");
    return result.Stacks[0];
  };
  const stack = await ownStack(binding.stackId), cell = await ownStack(s.cellStackId), platform = await ownStack(s.platformStackId);
  if ([cell, platform].some(v => !["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"].includes(v.StackStatus))) throw new Error("RELEASE_RELATED_STACK_NOT_STABLE");
  const templateResult = await read<{ TemplateBody: string | ReleaseRuntimeFacts["template"] }>("cloudformation", "get-template", { StackName: binding.stackId, TemplateStage: "Original" });
  const template = typeof templateResult.TemplateBody === "string" ? JSON.parse(templateResult.TemplateBody) : templateResult.TemplateBody;
  const resourceResult = await read<{ StackResourceSummaries: { LogicalResourceId: string; ResourceType: string; PhysicalResourceId: string; ResourceStatus: string }[]; NextToken?: string }>(
    "cloudformation", "list-stack-resources", { StackName: binding.stackId });
  const csResult = await read<{ Summaries: { ChangeSetId: string; ExecutionStatus: string; Status?: string }[]; NextToken?: string }>("cloudformation", "list-change-sets", { StackName: binding.stackId });
  if (resourceResult.NextToken || csResult.NextToken) throw new Error("RELEASE_METADATA_PAGE_INCOMPLETE");
  const parameters = map((stack.Parameters ?? []).map(p => ({ key: p.ParameterKey, value: p.ParameterValue })));
  const outputs = map((cell.Outputs ?? []).map(o => ({ key: o.OutputKey, value: o.OutputValue })));
  const resources = Object.fromEntries(resourceResult.StackResourceSummaries.filter(r => r.ResourceStatus !== "DELETE_COMPLETE").map(r =>
    [r.LogicalResourceId, { type: r.ResourceType, physicalId: r.PhysicalResourceId }]));
  const f: ReleaseRuntimeFacts = { observedAt: now(), stackId: stack.StackId, stackStatus: stack.StackStatus,
    stackUpdatedAt: Date.parse(stack.LastUpdatedTime ?? stack.CreationTime), roleArn: stack.RoleARN ?? null,
    tags: map((stack.Tags ?? []).map(t => ({ key: t.Key, value: t.Value }))), template, parameters, resources,
    service: {}, taskDefinition: {}, tasks: [], targets: { groupArn: resources.TenantTargetGroup?.physicalId ?? "", targets: [] },
    relatedBindings: { cell: await sha256Hex({ id: cell.StackId, outputs: [...cell.Outputs ?? []].sort((a,b) => a.OutputKey.localeCompare(b.OutputKey)), role: cell.RoleARN }),
      platform: await sha256Hex({ id: platform.StackId, outputs: [...platform.Outputs ?? []].sort((a,b) => a.OutputKey.localeCompare(b.OutputKey)), role: platform.RoleARN }),
      schemaVersion: s.database.schemaVersion, database: s.database.identifier, persistenceEvidence: s.persistence.verificationSha256 },
    openChangeSetIds: csResult.Summaries.filter(c => ["AVAILABLE", "EXECUTE_IN_PROGRESS"].includes(c.ExecutionStatus) || ["CREATE_PENDING", "CREATE_IN_PROGRESS"].includes(c.Status ?? "")).map(c => c.ChangeSetId),
    albPresent: false, databaseAvailable: false, databaseProfile: s.database.profile, databaseSchemaVersion: s.database.schemaVersion,
    persistentUploadsReady: false, artifact: { repository: release.image.repository, manifest: "" }, checks: [] };
  const database = await read<{ DBClusters?: { DBClusterIdentifier: string; Status: string; Engine: string; IAMDatabaseAuthenticationEnabled?: boolean }[];
    DBInstances?: { DBInstanceIdentifier: string; DBInstanceStatus: string; Engine: string }[] }>("rds",
    s.database.kind === "cluster" ? "describe-db-clusters" : "describe-db-instances",
    s.database.kind === "cluster" ? { DBClusterIdentifier: s.database.identifier } : { DBInstanceIdentifier: s.database.identifier });
  f.databaseAvailable = s.database.kind === "cluster" ? database.DBClusters?.length === 1 &&
    database.DBClusters[0].DBClusterIdentifier === s.database.identifier && database.DBClusters[0].Status === "available" &&
    database.DBClusters[0].Engine === "aurora-postgresql" && (s.database.profile !== "express_iam" || database.DBClusters[0].IAMDatabaseAuthenticationEnabled === true) :
    database.DBInstances?.length === 1 && database.DBInstances[0].DBInstanceIdentifier === s.database.identifier &&
    database.DBInstances[0].DBInstanceStatus === "available" && database.DBInstances[0].Engine === "postgres";
  if (!resources.TenantService || !resources.TenantTaskDefinition || !outputs.HttpsListenerArn || !outputs.ControlListenerArn || !f.databaseAvailable) {
    f.observedAt = now(); return f; // STOPPED is a refusal, never an implicit restore or missing-positive default.
  }
  for (const [parameter, output] of Object.entries(s.cellOutputParameters)) {
    const a = parameters[parameter], b = outputs[output];
    if (!a || !b || (output === "SubnetIds" ? canonicalJson(a.split(",").map(v => v.trim()).sort()) !== canonicalJson(b.split(",").map(v => v.trim()).sort()) : a !== b)) {
      throw new Error("RELEASE_CELL_REFERENCE_CHANGED");
    }
  }
  const clusterPrefix = `arn:aws:ecs:${binding.region}:${binding.accountId}:cluster/`;
  const cluster = outputs.ClusterName.startsWith("arn:") ? outputs.ClusterName : clusterPrefix + outputs.ClusterName;
  if (!cluster.startsWith(clusterPrefix)) throw new Error("RELEASE_CLUSTER_BINDING_CHANGED");
  const serviceResult = await read<{ services: Service[]; failures?: unknown[] }>("ecs", "describe-services", { cluster, services: [resources.TenantService.physicalId] });
  if (serviceResult.failures?.length || serviceResult.services.length !== 1 || serviceResult.services[0].serviceArn !== resources.TenantService.physicalId ||
    serviceResult.services[0].clusterArn !== cluster) throw new Error("RELEASE_SERVICE_READ_INCOMPLETE");
  f.service = serviceResult.services[0];
  const definition = await read<{ taskDefinition: TaskDefinition }>("ecs", "describe-task-definition", { taskDefinition: resources.TenantTaskDefinition.physicalId });
  f.taskDefinition = definition.taskDefinition;
  if (f.taskDefinition.taskDefinitionArn !== resources.TenantTaskDefinition.physicalId) throw new Error("RELEASE_TASK_DEFINITION_CHANGED");
  const taskList = await read<{ taskArns: string[]; nextToken?: string }>("ecs", "list-tasks", { cluster, serviceName: resources.TenantService.physicalId.split("/").at(-1), desiredStatus: "RUNNING" });
  if (taskList.nextToken || taskList.taskArns.length > 100) throw new Error("RELEASE_TASK_PAGE_INCOMPLETE");
  if (taskList.taskArns.length) {
    const tasks = await read<{ tasks: Task[]; failures?: unknown[] }>("ecs", "describe-tasks", { cluster, tasks: taskList.taskArns });
    if (tasks.failures?.length || canonicalJson(tasks.tasks.map(t => t.taskArn).sort()) !== canonicalJson([...taskList.taskArns].sort())) throw new Error("RELEASE_TASK_READ_INCOMPLETE");
    f.tasks = tasks.tasks;
  }
  const listeners = await read<{ Listeners: { ListenerArn: string; LoadBalancerArn: string; Port: number; Protocol: string; MutualAuthentication?: { Mode: string } }[] }>(
    "elbv2", "describe-listeners", { ListenerArns: [outputs.HttpsListenerArn, outputs.ControlListenerArn] });
  const https = listeners.Listeners.find(l => l.ListenerArn === outputs.HttpsListenerArn), control = listeners.Listeners.find(l => l.ListenerArn === outputs.ControlListenerArn);
  if (!https || !control || listeners.Listeners.length !== 2 || https.Port !== 443 || control.Port !== 8443 ||
    https.Protocol !== "HTTPS" || control.Protocol !== "HTTPS" || control.MutualAuthentication?.Mode !== "verify" || https.LoadBalancerArn !== control.LoadBalancerArn) throw new Error("RELEASE_LISTENER_BINDING_CHANGED");
  const alb = await read<{ LoadBalancers: { LoadBalancerArn: string; DNSName: string; State: { Code: string } }[] }>("elbv2", "describe-load-balancers", { LoadBalancerArns: [https.LoadBalancerArn] });
  f.albPresent = alb.LoadBalancers.length === 1 && alb.LoadBalancers[0].LoadBalancerArn === https.LoadBalancerArn && alb.LoadBalancers[0].State.Code === "active";
  const groups = await read<{ TargetGroups: { TargetGroupArn: string; VpcId: string; Port: number }[] }>("elbv2", "describe-target-groups", { TargetGroupArns: [f.targets.groupArn] });
  if (groups.TargetGroups.length !== 1 || groups.TargetGroups[0].TargetGroupArn !== f.targets.groupArn || groups.TargetGroups[0].VpcId !== outputs.VpcId || groups.TargetGroups[0].Port !== binding.applicationPort) throw new Error("RELEASE_TARGET_GROUP_CHANGED");
  const health = await read<{ TargetHealthDescriptions: { Target: { Id: string }; TargetHealth: { State: string } }[] }>("elbv2", "describe-target-health", { TargetGroupArn: f.targets.groupArn });
  f.targets.targets = health.TargetHealthDescriptions.map(t => ({ ip: t.Target.Id, state: t.TargetHealth.State }));
  const ruleArns = Object.values(resources).filter(r => r.type === "AWS::ElasticLoadBalancingV2::ListenerRule").map(r => r.physicalId);
  if (ruleArns.length !== 3) throw new Error("RELEASE_RULE_BINDING_CHANGED");
  const rules = await read<{ Rules: { RuleArn: string; Conditions?: { Field: string; HostHeaderConfig?: { Values: string[] }; Values?: string[] }[];
    Actions?: { Type: string; TargetGroupArn?: string; ForwardConfig?: { TargetGroups?: { TargetGroupArn: string }[] } }[] }[] }>("elbv2", "describe-rules", { RuleArns: ruleArns });
  if (canonicalJson(rules.Rules.map(r => r.RuleArn).sort()) !== canonicalJson(ruleArns.sort()) || ruleArns.some(r =>
    ![https.ListenerArn, control.ListenerArn].includes(r.replace(":listener-rule/", ":listener/").split("/").slice(0, -1).join("/")))) throw new Error("RELEASE_RULE_BINDING_CHANGED");
  if (!rules.Rules.some(r => r.RuleArn.startsWith(https.ListenerArn.replace(":listener/", ":listener-rule/") + "/") &&
    r.Conditions?.some(c => c.Field === "host-header" && (c.HostHeaderConfig?.Values ?? c.Values)?.includes(s.apiHostname)) &&
    r.Actions?.some(a => a.Type === "forward" && (a.TargetGroupArn === f.targets.groupArn || a.ForwardConfig?.TargetGroups?.some(g => g.TargetGroupArn === f.targets.groupArn))))) throw new Error("RELEASE_API_ROUTE_NOT_BOUND");
  if (rules.Rules.some(r => r.Actions?.some(a => a.Type === "forward" &&
    (a.TargetGroupArn && a.TargetGroupArn !== f.targets.groupArn || a.ForwardConfig?.TargetGroups?.some(g => g.TargetGroupArn !== f.targets.groupArn))))) throw new Error("RELEASE_API_ROUTE_NOT_BOUND");
  const dns = await read<{ ResourceRecordSets: { Name: string; Type: string; AliasTarget?: { DNSName: string } }[] }>("route53", "list-resource-record-sets",
    { HostedZoneId: s.hostedZoneId, StartRecordName: s.apiHostname + ".", StartRecordType: "A", MaxItems: "1" });
  const record = dns.ResourceRecordSets[0], lbDns = alb.LoadBalancers[0]?.DNSName;
  if (dns.ResourceRecordSets.length !== 1 || record.Name !== s.apiHostname + "." || record.Type !== "A" ||
    ![lbDns + ".", "dualstack." + lbDns + "."].includes(record.AliasTarget?.DNSName ?? "")) throw new Error("RELEASE_API_DNS_CHANGED");
  Object.assign(f.relatedBindings, { listeners: await sha256Hex(listeners), targetGroup: await sha256Hex(groups), rules: await sha256Hex(rules), dns: await sha256Hex(record) });
  if (f.taskDefinition.containerDefinitions?.flatMap(c => c.secrets ?? []).some(v => !s.secrets.some(r =>
    v.valueFrom?.startsWith(r.arn + ":") && v.valueFrom.endsWith(":" + r.versionId)))) throw new Error("RELEASE_UNPINNED_SECRET_REFERENCE");
  for (const secret of s.secrets) {
    const metadata = await read<{ ARN: string; DeletedDate?: string; VersionIdsToStages: Record<string, string[]> }>("secretsmanager", "describe-secret", { SecretId: secret.arn });
    if (metadata.ARN !== secret.arn || metadata.DeletedDate || !metadata.VersionIdsToStages[secret.versionId] ||
      !f.taskDefinition.containerDefinitions?.some(c => c.secrets?.some(v => v.valueFrom?.startsWith(secret.arn + ":") && v.valueFrom.endsWith(":" + secret.versionId)))) throw new Error("RELEASE_FIXED_SECRET_VERSION_CHANGED");
    f.relatedBindings[secret.arn] = secret.versionId;
  }
  const apiContainer = f.taskDefinition.containerDefinitions?.find(c => c.name === f.service.loadBalancers?.[0]?.containerName);
  const environment = map((apiContainer?.environment ?? []).map(e => ({ key: e.name ?? "", value: e.value ?? "" })));
  if (environment[s.persistence.providerVariable] === "s3" && environment[s.persistence.bucketVariable] === s.persistence.bucket) {
    await read("s3api", "head-bucket", { Bucket: s.persistence.bucket, ExpectedBucketOwner: binding.accountId }); f.persistentUploadsReady = true;
  }
  const image = await read<{ images: { imageManifest: string; imageId: { imageDigest: string } }[]; failures?: unknown[] }>("ecr", "batch-get-image",
    { registryId: binding.accountId, repositoryName: release.image.repository.split("amazonaws.com/")[1], imageIds: [{ imageDigest: release.image.manifestDigest }] });
  if (image.failures?.length || image.images.length !== 1 || image.images[0].imageId.imageDigest !== release.image.manifestDigest) throw new Error("RELEASE_ECR_MANIFEST_UNAVAILABLE");
  f.artifact.manifest = image.images[0].imageManifest;
  if (changeSetId) {
    f.changeSet = await read<DescribeChangeSetOutput>("cloudformation", "describe-change-set", { StackName: binding.stackId, ChangeSetName: changeSetId });
    for (const path of ["/health", "/ready"] as const) f.checks.push({ path, ...await api.getTechnical(path, "https://" + s.apiHostname) });
  }
  f.observedAt = now(); return f;
}

export async function sampledObservation(binding: InstanceBinding, facts: ReleaseRuntimeFacts): Promise<InstanceReleaseObservation> {
  const name = facts.service.loadBalancers?.[0]?.containerName;
  return { instanceId: binding.instanceId, stackId: facts.stackId, observedAt: facts.observedAt, ...await releaseRuntimeDigests(facts),
    state: !facts.service.serviceArn || !facts.service.desiredCount ? "STOPPED" : !facts.albPresent || !facts.databaseAvailable ? "PARTIAL" : "RUNNING",
    imageUri: facts.taskDefinition.containerDefinitions?.find(c => c.name === name)?.image ?? "",
    platformDigest: facts.tasks[0]?.containers?.find(c => c.name === name)?.imageDigest ?? "", parameterKeys: Object.keys(facts.parameters),
    servicePresent: !!facts.service.serviceArn, albPresent: facts.albPresent, databaseAvailable: facts.databaseAvailable,
    databaseProfile: facts.databaseProfile, databaseSchemaVersion: facts.databaseSchemaVersion, desiredCount: facts.service.desiredCount ?? 0,
    runningCount: facts.service.runningCount ?? 0, pendingCount: facts.service.pendingCount ?? 0,
    operationInProgress: facts.stackStatus.endsWith("_IN_PROGRESS") || facts.openChangeSetIds.length > 0,
    persistentUploadsReady: facts.persistentUploadsReady };
}

export function releaseReader(resolve: (plan: ImageUpdatePlan) => Promise<{ binding: InstanceBinding; release: SoftwareRelease }>,
  apiFactory: () => ReleaseMetadataApi, now: () => number): ReleaseRuntimeReader {
  return { capture: async (plan, changeSetId) => {
    const { binding, release } = await resolve(plan);
    if (binding.stackId !== plan.changeSet.StackName || binding.instanceId !== plan.selection.instanceId || release.id !== plan.to.releaseId) throw new Error("RELEASE_READER_TARGET_CHANGED");
    return sampleInstanceRelease(binding, release, apiFactory(), now, changeSetId);
  } };
}
