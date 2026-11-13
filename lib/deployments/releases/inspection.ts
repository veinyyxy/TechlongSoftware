import type { Service, Task, TaskDefinition } from "@aws-sdk/client-ecs";
import type { DescribeChangeSetOutput } from "@aws-sdk/client-cloudformation";
import { canonicalJson, sha256Hex } from "../execution/hash.ts";
import type { ImageUpdatePlan, InstanceReleaseObservation } from "./contract.ts";
import type { PostgresReleaseRepository, ReleaseEvidenceReference, ReleaseInspection } from "./repository.ts";
import type { ReleaseEvidenceAdapter } from "./adapters.ts";

/** Fresh metadata supplied by a separately authenticated, target-scoped reader. No business data.
 * This is an injection port, not a provider that loads credentials or opens network connections. */
export interface ReleaseRuntimeFacts {
  observedAt: number;
  stackId: string;
  stackStatus: string;
  stackUpdatedAt: number;
  roleArn: string | null;
  tags: Record<string, string>;
  template: { Resources: Record<string, unknown>; [key: string]: unknown };
  parameters: Record<string, string>;
  resources: Record<string, { type: string; physicalId: string }>;
  service: Service;
  taskDefinition: TaskDefinition;
  tasks: Task[];
  targets: { groupArn: string; targets: { ip: string; state: string }[] };
  relatedBindings: Record<string, string>; // Current Cell/platform/DNS/network/fixed-Secret references.
  openChangeSetIds: string[];
  albPresent: boolean;
  databaseAvailable: boolean;
  databaseProfile: InstanceReleaseObservation["databaseProfile"];
  databaseSchemaVersion: string;
  persistentUploadsReady: boolean;
  artifact: { repository: string; manifest: string };
  checks: { path: "/health" | "/ready"; status: number; tlsVerified: boolean; checkedAt: number }[];
  changeSet?: DescribeChangeSetOutput;
}

export interface ReleaseRuntimeReader {
  /** Must reread actual metadata; changeSetId, when supplied, must be read exactly too. No cached executor facts. */
  capture(plan: ImageUpdatePlan, changeSetId?: string): Promise<ReleaseRuntimeFacts>;
}

/** Stable configuration fingerprint. Runtime/task IDs, task counts, timestamps and only the API
 * container's image are excluded; its remaining environment/configuration is hashed, never emitted. */
export async function releaseRuntimeDigests(f: ReleaseRuntimeFacts) {
  const api = f.service.loadBalancers?.[0]?.containerName;
  const task = { ...f.taskDefinition };
  delete task.taskDefinitionArn; delete task.revision; delete task.status; delete task.registeredAt;
  delete task.registeredBy; delete task.deregisteredAt; delete task.requiresAttributes; delete task.compatibilities;
  task.containerDefinitions = task.containerDefinitions?.map(c => {
    const container = { ...c }; if (container.name === api) delete container.image; return container;
  });
  const s = f.service;
  const service = { arn: s.serviceArn, cluster: s.clusterArn, desired: s.desiredCount,
    network: s.networkConfiguration, loadBalancers: s.loadBalancers, capacity: s.capacityProviderStrategy,
    launchType: s.launchType, platformVersion: s.platformVersion, deployment: s.deploymentConfiguration,
    scheduling: s.schedulingStrategy, grace: s.healthCheckGracePeriodSeconds, executeCommand: s.enableExecuteCommand,
    managedTags: s.enableECSManagedTags, propagateTags: s.propagateTags, availabilityZoneRebalancing: s.availabilityZoneRebalancing };
  const retained = Object.fromEntries(Object.entries(f.resources).filter(([id]) => id !== "TenantTaskDefinition"));
  const parameters = Object.fromEntries(Object.entries(f.parameters).filter(([key]) => key !== "ImageUri"));
  return { templateSha256: await sha256Hex(f.template), configurationSha256: await sha256Hex({
    parameters, roleArn: f.roleArn, tags: f.tags, retained, service, task, relatedBindings: f.relatedBindings,
  }) };
}

export async function assertReleaseArtifact(target: Pick<ImageUpdatePlan["to"], "imageUri" | "platformDigest">, f: ReleaseRuntimeFacts) {
  if (`${f.artifact.repository}@sha256:${await sha256Hex(f.artifact.manifest)}` !== target.imageUri) {
    throw new Error("RELEASE_ARTIFACT_MISMATCH");
  }
  const manifest = JSON.parse(f.artifact.manifest) as { manifests?: { digest: string; platform?: { os: string; architecture: string } }[] };
  const amd64 = manifest.manifests?.filter(m => m.platform?.os === "linux" && m.platform.architecture === "amd64");
  if (manifest.manifests ? amd64?.length !== 1 || amd64[0].digest !== target.platformDigest :
    target.platformDigest !== `sha256:${await sha256Hex(f.artifact.manifest)}`) throw new Error("RELEASE_PLATFORM_DIGEST_MISMATCH");
}

/** Technical facts only; no login, order, payment, message or database-write checks. */
export async function assertReleaseRuntime(plan: ImageUpdatePlan, f: ReleaseRuntimeFacts,
  expected: "from" | "to", readStartedAt: number, now: number, requireHttp = false): Promise<InstanceReleaseObservation> {
  const hashes = await releaseRuntimeDigests(f), image = plan[expected];
  if (f.observedAt < readStartedAt || f.observedAt > now || !Number.isSafeInteger(f.observedAt)) throw new Error("RELEASE_STALE_RUNTIME_FACTS");
  if (!f.albPresent || !f.databaseAvailable || !f.service.serviceArn || !f.service.desiredCount) throw new Error("RELEASE_RESTORE_REQUIRED");
  if (f.stackId !== plan.changeSet.StackName || hashes.templateSha256 !== plan.templateSha256 ||
    hashes.configurationSha256 !== plan.configurationSha256 ||
    canonicalJson(Object.keys(f.resources).sort()) !== canonicalJson(Object.keys(f.template.Resources).sort()) ||
    Object.entries(f.resources).some(([id, r]) => (f.template.Resources[id] as { Type?: string })?.Type !== r.type) ||
    f.resources.TenantService?.physicalId !== f.service.serviceArn ||
    f.resources.TenantTaskDefinition?.physicalId !== f.taskDefinition.taskDefinitionArn ||
    f.resources.TenantTargetGroup?.physicalId !== f.targets.groupArn ||
    f.service.loadBalancers?.length !== 1 || f.service.loadBalancers[0].targetGroupArn !== f.targets.groupArn ||
    f.service.loadBalancers[0].containerPort !== plan.compatibility.applicationPort ||
    f.service.taskDefinition !== f.taskDefinition.taskDefinitionArn || f.service.status !== "ACTIVE") throw new Error("RELEASE_RUNTIME_BINDING_CHANGED");
  if (!["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"].includes(f.stackStatus) ||
    f.service.desiredCount !== plan.desiredCount || f.service.runningCount !== plan.desiredCount || f.service.pendingCount !== 0 ||
    f.service.deployments?.length !== 1 || f.service.deployments[0].status !== "PRIMARY" ||
    f.service.deployments[0].rolloutState !== "COMPLETED" || f.service.deployments[0].taskDefinition !== f.service.taskDefinition ||
    f.tasks.length !== plan.desiredCount) throw new Error("RELEASE_RUNTIME_NOT_STABLE");
  const name = f.service.loadBalancers[0].containerName;
  const api = f.taskDefinition.containerDefinitions?.filter(c => c.name === name);
  if (api?.length !== 1 || api[0].image !== image.imageUri || f.parameters.ImageUri !== image.imageUri ||
    f.taskDefinition.runtimePlatform?.cpuArchitecture !== "X86_64" || f.taskDefinition.runtimePlatform.operatingSystemFamily !== "LINUX" ||
    !f.persistentUploadsReady || f.databaseProfile !== plan.compatibility.databaseProfile ||
    f.databaseSchemaVersion !== plan.compatibility.databaseSchemaVersion) throw new Error("RELEASE_IMAGE_OR_COMPATIBILITY_CHANGED");
  const ips: string[] = [];
  for (const task of f.tasks) {
    const container = task.containers?.filter(c => c.name === name);
    if (!task.taskArn || task.taskDefinitionArn !== f.service.taskDefinition || task.lastStatus !== "RUNNING" || task.healthStatus === "UNHEALTHY" ||
      container?.length !== 1 || container[0].lastStatus !== "RUNNING" || container[0].healthStatus === "UNHEALTHY" ||
      container[0].image !== image.imageUri || container[0].imageDigest !== image.platformDigest ||
      !container[0].networkInterfaces?.[0]?.privateIpv4Address) throw new Error("RELEASE_RUNNING_DIGEST_MISMATCH");
    ips.push(container[0].networkInterfaces[0].privateIpv4Address);
  }
  if (new Set(f.tasks.map(t => t.taskArn)).size !== f.tasks.length || new Set(ips).size !== ips.length ||
    f.targets.targets.some(t => t.state !== "healthy") ||
    canonicalJson(ips.sort()) !== canonicalJson(f.targets.targets.map(t => t.ip).sort())) throw new Error("RELEASE_TARGETS_UNHEALTHY");
  if (requireHttp && (["/health", "/ready"] as const).some(path => {
    const checks = f.checks.filter(c => c.path === path);
    return checks.length !== 1 || checks[0].status !== 200 || !checks[0].tlsVerified ||
      checks[0].checkedAt < readStartedAt || checks[0].checkedAt > now;
  })) throw new Error("RELEASE_TECHNICAL_ENDPOINTS_NOT_VERIFIED");
  return { instanceId: plan.selection.instanceId, stackId: f.stackId, observedAt: f.observedAt, state: "RUNNING",
    ...hashes, imageUri: image.imageUri, platformDigest: image.platformDigest, parameterKeys: Object.keys(f.parameters),
    servicePresent: true, albPresent: f.albPresent, databaseAvailable: f.databaseAvailable, databaseProfile: f.databaseProfile,
    databaseSchemaVersion: f.databaseSchemaVersion, desiredCount: plan.desiredCount, runningCount: f.service.runningCount!,
    pendingCount: f.service.pendingCount!, operationInProgress: false, persistentUploadsReady: f.persistentUploadsReady };
}

export interface IndependentInspectionInput {
  requestId: string; planSha256: string; runId: string; runAttempt: number;
  changeSetId: string; notBefore: number; readBefore: number;
}
export interface IndependentReleaseInspector {
  /** D2-4 must run this in a new process with verifier/read-only-resource credentials. */
  inspect(input: IndependentInspectionInput): Promise<ReleaseEvidenceReference>;
}

/** Separately composed entry: it receives neither executor facts nor a deployment-success boolean. */
export async function inspectInstanceRelease(input: IndependentInspectionInput, dependencies: {
  repository: Pick<PostgresReleaseRepository, "request" | "recordInspection">;
  reader: ReleaseRuntimeReader;
  evidence: Pick<ReleaseEvidenceAdapter, "putInspection" | "read">;
  now: () => number;
}): Promise<ReleaseEvidenceReference> {
  const { repository, reader, evidence, now } = dependencies;
  if (now() >= input.readBefore) throw new Error("RELEASE_INSPECTION_EXPIRED");
  const request = await repository.request(input.requestId), p = request?.plan;
  if (!request || !p || request.status !== "VERIFYING" || request.planSha256 !== input.planSha256 ||
    await sha256Hex(p) !== input.planSha256 || request.runId !== input.runId || request.runAttempt !== input.runAttempt ||
    request.operations.create?.phase !== "ACK" || request.operations.execute?.phase !== "ACK" ||
    request.operations.create.providerReference !== input.changeSetId || request.operations.execute.providerReference !== input.changeSetId) {
    throw new Error("RELEASE_INSPECTION_REQUEST_MISMATCH");
  }
  if (now() >= input.readBefore) throw new Error("RELEASE_INSPECTION_EXPIRED");
  const readStartedAt = Math.max(input.notBefore, now()), f = await reader.capture(p, input.changeSetId);
  if (now() >= input.readBefore || f.observedAt < readStartedAt || f.observedAt > now()) throw new Error("RELEASE_INSPECTION_EXPIRED");
  const cs = f.changeSet;
  if (cs?.ChangeSetId !== input.changeSetId || cs.StackId !== p.changeSet.StackName || cs.NextToken) throw new Error("RELEASE_INSPECTION_CHANGE_SET_MISMATCH");
  let result: ReleaseInspection["result"] = "FAILED_NEEDS_INSPECTION", expected: "from" | "to" = "to";
  try {
    await assertReleaseArtifact(p.to, f);
    if (f.stackStatus === "UPDATE_COMPLETE" && cs.ExecutionStatus === "EXECUTE_COMPLETE") {
      await assertReleaseRuntime(p, f, "to", readStartedAt, now(), true); result = "SUCCEEDED";
    } else if (f.stackStatus === "UPDATE_ROLLBACK_COMPLETE" && ["EXECUTE_COMPLETE", "EXECUTE_FAILED"].includes(cs.ExecutionStatus ?? "")) {
      await assertReleaseRuntime(p, f, "from", readStartedAt, now(), true); expected = "from"; result = "FAILED_ROLLED_BACK_VERIFIED";
    }
  } catch { /* Keep a failed inspection; never attest an image simply because the CFN call returned. */ }
  const hashes = await releaseRuntimeDigests(f);
  const actualName = f.service.loadBalancers?.[0]?.containerName;
  const actualImage = f.taskDefinition.containerDefinitions?.find(c => c.name === actualName)?.image ?? "";
  const actualDigest = f.tasks[0]?.containers?.find(c => c.name === actualName)?.imageDigest ?? "";
  const document = { requestId: input.requestId, planSha256: input.planSha256, runId: input.runId, runAttempt: input.runAttempt,
    stackId: f.stackId, releaseId: result === "FAILED_NEEDS_INSPECTION" ? p.to.releaseId : p[expected].releaseId,
    imageUri: result === "FAILED_NEEDS_INSPECTION" ? actualImage : p[expected].imageUri,
    platformDigest: result === "FAILED_NEEDS_INSPECTION" ? actualDigest : p[expected].platformDigest, ...hashes, result,
    changeSetId: input.changeSetId, serviceArn: f.service.serviceArn ?? "", taskDefinitionArn: f.taskDefinition.taskDefinitionArn ?? "",
    observedAt: f.observedAt, runtimeSha256: await sha256Hex({ stackStatus: f.stackStatus,
      taskDefinitionArn: f.taskDefinition.taskDefinitionArn, tasks: f.tasks.map(t => ({ arn: t.taskArn, definition: t.taskDefinitionArn,
        status: t.lastStatus, containers: t.containers?.map(c => ({ name: c.name, digest: c.imageDigest, status: c.lastStatus })) })),
      targets: f.targets, checks: f.checks.map(c => ({ path: c.path, status: c.status, tlsVerified: c.tlsVerified, checkedAt: c.checkedAt })) }) };
  const reference = await evidence.putInspection(document);
  if (canonicalJson(await evidence.read(reference)) !== canonicalJson(document)) throw new Error("RELEASE_EVIDENCE_READBACK_MISMATCH");
  if (now() >= input.readBefore) throw new Error("RELEASE_INSPECTION_EXPIRED");
  await repository.recordInspection({ ...document, evidence: reference });
  return reference;
}
