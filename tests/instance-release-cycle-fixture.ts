import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { CloudFormationClient, type DescribeChangeSetOutput } from "@aws-sdk/client-cloudformation";
import { S3Client } from "@aws-sdk/client-s3";
import { ECSClient, DescribeServicesCommand, DescribeTaskDefinitionCommand, DescribeTasksCommand } from "@aws-sdk/client-ecs";
import type { HttpRequest } from "@smithy/types";
import { ReleaseCloudFormationAdapter, ReleaseEvidenceAdapter, createReleaseChangeSetInput, executeReleaseChangeSetInput } from "../lib/deployments/releases/adapters.ts";
import { inspectInstanceRelease, assertReleaseRuntime, releaseRuntimeDigests, type ReleaseRuntimeFacts } from "../lib/deployments/releases/inspection.ts";
import { PostgresReleaseRepository } from "../lib/deployments/releases/repository.ts";
import type { InstanceBinding, SoftwareRelease } from "../lib/deployments/releases/contract.ts";
import { prepareInstanceRelease, type ApprovedReleaseRun } from "../lib/deployments/releases/update.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { MemoryReleaseSql } from "./instance-release-memory.ts";
import { releaseFixture } from "./instance-release-fixture.ts";

const credentials = { accessKeyId: "synthetic", secretAccessKey: "synthetic" };
const xml = (v: string) => v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const response = (body: string, headers: Record<string, string> = {}, statusCode = 200) => ({
  response: { statusCode, headers, body: Readable.from([Buffer.from(body)]) },
});

export async function cycleFixture(instance = "one", targetId = "release_v2") {
  const base = await releaseFixture(instance), plan = base.plan;
  const sql = new MemoryReleaseSql(), executorRepo = new PostgresReleaseRepository(sql.client("executor")),
    verifierRepo = new PostgresReleaseRepository(sql.client("verifier")), plannerRepo = new PostgresReleaseRepository(sql.client("planner"));
  if (targetId === "release_v3") {
    plan.to.platformDigest = "sha256:" + "8".repeat(64); plan.to.version = "3.0.0";
    plan.to.sourceCommit = "2".repeat(40); plan.to.buildRunId = "10003";
  }
  const manifest = JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [{ digest: plan.to.platformDigest, platform: { os: "linux", architecture: "amd64" } }] });
  plan.selection.releaseId = targetId; plan.to.releaseId = targetId;
  plan.to.imageUri = plan.to.imageUri.split("@")[0] + "@sha256:" + await sha256Hex(manifest);
  plan.changeSet.Parameters = plan.changeSet.Parameters.map(p => p.ParameterKey === "ImageUri" ? { ParameterKey: "ImageUri", ParameterValue: plan.to.imageUri } : p);
  const arnPrefix = "arn:aws:ecs:ca-central-1:111111111111:", serviceArn = `${arnPrefix}service/cluster/tenant-${instance}`,
    definition = (revision: number) => `${arnPrefix}task-definition/tenant-${instance}:${revision}`,
    groupArn = `arn:aws:elasticloadbalancing:ca-central-1:111111111111:targetgroup/tenant-${instance}/synthetic`;
  const template = { Resources: Object.fromEntries([
    ["TenantService", "AWS::ECS::Service"], ["TenantTaskDefinition", "AWS::ECS::TaskDefinition"],
    ["TenantTargetGroup", "AWS::ElasticLoadBalancingV2::TargetGroup"], ["TenantHttpsRule", "AWS::ElasticLoadBalancingV2::ListenerRule"],
    ["TenantMtlsRule", "AWS::ElasticLoadBalancingV2::ListenerRule"], ["TenantDenyRule", "AWS::ElasticLoadBalancingV2::ListenerRule"],
    ["TenantLogGroup", "AWS::Logs::LogGroup"],
  ].map(([id, Type]) => [id, { Type }])) };
  const controls = { createUnknown: false, executeUnknown: false, stuck: false, rollback: false,
    createPendingReads: 0, staleCompleteReads: 0, evidenceFailure: false, mutateCandidate: false,
    executorPatch: undefined as ((facts: ReleaseRuntimeFacts, read: number) => void) | undefined,
    inspectorPatch: undefined as ((facts: ReleaseRuntimeFacts) => void) | undefined,
    changeSetPatch: undefined as ((cs: DescribeChangeSetOutput) => void) | undefined };
  const events: string[] = [], documents = new Map<string, string>();
  let created = false, executed = false, changeSetId = "", executorReads = 0, inspectorReads = 0, stackReads = 0;
  const changes = (): DescribeChangeSetOutput => {
    const cs: DescribeChangeSetOutput = { StackId: plan.changeSet.StackName, ChangeSetId: changeSetId,
      Status: controls.createPendingReads-- > 0 ? "CREATE_IN_PROGRESS" : "CREATE_COMPLETE",
      ExecutionStatus: executed ? controls.rollback ? "EXECUTE_FAILED" : "EXECUTE_COMPLETE" : "AVAILABLE",
      Parameters: plan.changeSet.Parameters.map(p => ({ ...p, ParameterValue: p.ParameterKey === "ImageUri" ? plan.to.imageUri : "cluster" })),
      Changes: plan.expectedChanges.map(c => ({ Type: "Resource", ResourceChange: { LogicalResourceId: c.logicalId,
        Action: c.action, Replacement: c.replacement, ResourceType: c.logicalId === "TenantService" ? "AWS::ECS::Service" : "AWS::ECS::TaskDefinition" } })) };
    controls.changeSetPatch?.(cs); return cs;
  };
  const facts = (): ReleaseRuntimeFacts => {
    const target = executed && !controls.rollback, image = target ? plan.to : plan.from, td = definition(target ? 2 : 1);
    return { observedAt: sql.now, stackId: plan.changeSet.StackName,
      stackStatus: executed ? controls.rollback ? "UPDATE_ROLLBACK_COMPLETE" : "UPDATE_COMPLETE" : "UPDATE_COMPLETE",
      stackUpdatedAt: executed ? 1500 : 1000, roleArn: "arn:aws:iam::111111111111:role/synthetic-cfn", tags: { Product: "example-api" }, template,
      parameters: { ClusterName: "cluster", ImageUri: image.imageUri },
      resources: Object.fromEntries(Object.entries(template.Resources).map(([id, r]) => [id, { type: r.Type, physicalId:
        id === "TenantTaskDefinition" ? td : id === "TenantService" ? serviceArn : id === "TenantTargetGroup" ? groupArn : `retained-${id}-${instance}` }])),
      service: { serviceArn, clusterArn: arnPrefix + "cluster/cluster", status: "ACTIVE", taskDefinition: td, desiredCount: 1,
        runningCount: 1, pendingCount: 0, deployments: [{ status: "PRIMARY", rolloutState: "COMPLETED", taskDefinition: td }],
        loadBalancers: [{ targetGroupArn: groupArn, containerName: "api", containerPort: 3000 }],
        networkConfiguration: { awsvpcConfiguration: { subnets: ["synthetic-subnet"], securityGroups: ["synthetic-sg"], assignPublicIp: "ENABLED" } } },
      taskDefinition: { taskDefinitionArn: td, family: `tenant-${instance}`, revision: target ? 2 : 1,
        runtimePlatform: { cpuArchitecture: "X86_64", operatingSystemFamily: "LINUX" },
        containerDefinitions: [{ name: "api", image: image.imageUri, environment: [{ name: "SYNTHETIC_SECRET", value: "secret-canary-must-not-enter-evidence" }] }] },
      tasks: [{ taskArn: arnPrefix + "task/cluster/00000000000000000000000000000001", taskDefinitionArn: td, lastStatus: "RUNNING",
        containers: [{ name: "api", image: image.imageUri, imageDigest: image.platformDigest, lastStatus: "RUNNING",
          networkInterfaces: [{ privateIpv4Address: "10.0.0.20" }] }] }],
      targets: { groupArn, targets: [{ ip: "10.0.0.20", state: "healthy" }] },
      relatedBindings: { cell: "synthetic-cell-output-hash", platform: "synthetic-platform-hash", dns: "api.sandbox.example.invalid",
        secretVersion: "fixed-synthetic-version", databaseId: "synthetic-db" }, openChangeSetIds: created && !executed ? [changeSetId] : [],
      albPresent: true, databaseAvailable: true, databaseProfile: "express_iam", databaseSchemaVersion: "schema-v1", persistentUploadsReady: true,
      artifact: { repository: plan.to.imageUri.split("@")[0], manifest },
      checks: [{ path: "/health", status: 200, tlsVerified: true, checkedAt: sql.now }, { path: "/ready", status: 200, tlsVerified: true, checkedAt: sql.now }],
      ...(executed ? { changeSet: changes() } : {}) };
  };
  Object.assign(plan, await releaseRuntimeDigests(facts()));
  const sha = await sha256Hex(plan);
  const release: SoftwareRelease = { id: targetId, productId: plan.productId, component: "tenant_api", version: plan.to.version,
    status: "ecr_verified", source: { repository: plan.to.sourceRepository, commit: plan.to.sourceCommit, buildRunId: plan.to.buildRunId,
      buildAttempt: 1, artifactSha256: plan.to.artifactSha256 }, image: { repository: plan.to.imageUri.split("@")[0],
      manifestDigest: plan.to.imageUri.split("@")[1], platformDigest: plan.to.platformDigest, verificationSha256: plan.to.imageVerificationSha256,
      runtimePlatform: "linux/amd64" }, compatibility: { databaseProfiles: ["express_iam", "full_password"], schemaVersions: ["schema-v1"],
      clientApiVersions: ["v1"], applicationPort: 3000, requiresMigration: false, startupWrites: false } };
  const previous: SoftwareRelease = { ...structuredClone(release), id: plan.from.releaseId, version: "1.0.0",
    image: { ...release.image, manifestDigest: plan.from.imageUri.split("@")[1], platformDigest: plan.from.platformDigest } };
  const binding: InstanceBinding = { instanceId: plan.selection.instanceId, workspaceId: plan.selection.workspaceId,
    environmentId: plan.selection.environmentId, productId: plan.productId, accountId: plan.accountId, region: plan.region,
    stackId: plan.changeSet.StackName, initialized: true, status: "active", sourceRepository: plan.to.sourceRepository,
    imageRepository: release.image.repository, runtimePlatform: "linux/amd64", applicationPort: 3000, clientApiVersion: "v1", desiredCount: 1,
    templateSha256: plan.templateSha256, configurationSha256: plan.configurationSha256, stateRevision: 3,
    currentRelease: { id: previous.id, manifestDigest: previous.image.manifestDigest, platformDigest: previous.image.platformDigest } };
  sql.states.set(plan.selection.instanceId, { revision: 3, current: previous.id, active: null });
  sql.contexts.set(plan.selection.instanceId, { binding, releases: [previous, release] });
  await plannerRepo.prepare(plan, sha);
  const input: ApprovedReleaseRun = { requestId: plan.selection.requestId, approvedPlanSha256: sha, runId: "12345", runAttempt: 1,
    claimToken: base.token, readBefore: 100_000, maxChangeSetReads: 3, maxStackReads: 4, pollIntervalMs: 1 };
  const cfn = new CloudFormationClient({ region: plan.region, credentials, maxAttempts: 1, requestHandler: { handle: async (request: HttpRequest) => {
    const form = new URLSearchParams(String(request.body)), action = form.get("Action")!; events.push(action);
    let result = "";
    if (action === "CreateChangeSet") {
      assert.equal(created, false); created = true;
      const stored = sql.requests.get(input.requestId)!;
      assert.equal(stored.row.operations.create?.phase, "INTENT");
      assert.equal(stored.row.operations.create?.actionSha256, await sha256Hex(createReleaseChangeSetInput(plan, form.get("ChangeSetName")!, form.get("ClientToken")!)));
      changeSetId = `arn:aws:cloudformation:${plan.region}:${plan.accountId}:changeSet/${form.get("ChangeSetName")}/00000000-0000-4000-8000-000000000002`;
      if (controls.createUnknown) throw new Error("secret-canary-create-response-lost");
      result = `<Id>${changeSetId}</Id><StackId>${plan.changeSet.StackName}</StackId>`;
    } else if (action === "ExecuteChangeSet") {
      assert.equal(executed, false); executed = true;
      assert.equal(sql.requests.get(input.requestId)!.row.operations.execute?.actionSha256, await sha256Hex(executeReleaseChangeSetInput(
        { stackId: plan.changeSet.StackName, changeSetId, planSha256: sha }, form.get("ClientRequestToken")!)));
      if (controls.executeUnknown) throw new Error("secret-canary-execute-response-lost");
    } else if (action === "DescribeChangeSet") {
      const c = changes();
      result = `<StackId>${c.StackId}</StackId><ChangeSetId>${c.ChangeSetId}</ChangeSetId><Status>${c.Status}</Status><ExecutionStatus>${c.ExecutionStatus}</ExecutionStatus>` +
        `<Parameters>${c.Parameters?.map(p => `<member><ParameterKey>${p.ParameterKey}</ParameterKey><ParameterValue>${xml(p.ParameterValue!)}</ParameterValue>` +
          (p.UsePreviousValue ? "<UsePreviousValue>true</UsePreviousValue>" : "") + "</member>").join("")}</Parameters>` +
        `<Changes>${c.Changes?.map(({ ResourceChange: r }) => `<member><Type>Resource</Type><ResourceChange><LogicalResourceId>${r?.LogicalResourceId}</LogicalResourceId>` +
          `<ResourceType>${r?.ResourceType}</ResourceType><Action>${r?.Action}</Action><Replacement>${r?.Replacement}</Replacement></ResourceChange></member>`).join("")}</Changes>`;
    } else if (action === "GetTemplate") {
      assert.equal(form.get("TemplateStage"), "Original");
      result = `<TemplateBody>${xml(JSON.stringify(controls.mutateCandidate ? { ...template, Changed: true } : template))}</TemplateBody>`;
    } else if (action === "DescribeStacks") {
      stackReads++; const stale = controls.staleCompleteReads-- > 0, progress = controls.stuck;
      result = `<Stacks><member><StackId>${plan.changeSet.StackName}</StackId><StackName>synthetic</StackName><CreationTime>1970-01-01T00:00:01Z</CreationTime>` +
        `<LastUpdatedTime>${stale ? "1970-01-01T00:00:01Z" : "1970-01-01T00:00:01.500Z"}</LastUpdatedTime>` +
        `<StackStatus>${progress ? "UPDATE_IN_PROGRESS" : controls.rollback ? "UPDATE_ROLLBACK_COMPLETE" : "UPDATE_COMPLETE"}</StackStatus></member></Stacks>`;
    } else throw new Error("unexpected SDK request");
    return response(`<${action}Response xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/"><${action}Result>${result}</${action}Result>` +
      `<ResponseMetadata><RequestId>synthetic</RequestId></ResponseMetadata></${action}Response>`, { "content-type": "text/xml" });
  } } });
  const s3 = new S3Client({ region: plan.region, credentials, maxAttempts: 1, requestHandler: { handle: async (request: HttpRequest) => {
    events.push(`Evidence${request.method}`);
    const key = request.path;
    if (request.method === "PUT") {
      assert.equal(request.headers["if-none-match"], "*"); assert.equal(documents.has(key), false);
      if (controls.evidenceFailure) throw new Error("secret-canary-evidence-response-lost");
      documents.set(key, String(request.body)); return response("", { "x-amz-version-id": "fixed-evidence-version" });
    }
    const body = documents.get(key)!; return response(body, { "x-amz-version-id": "fixed-evidence-version", "content-length": String(Buffer.byteLength(body)) });
  } } });
  const evidence = new ReleaseEvidenceAdapter(s3, { bucket: "synthetic-private", owner: plan.accountId, prefix: "releases" });
  const ecs = new ECSClient({ region: plan.region, credentials, maxAttempts: 1, requestHandler: { handle: async (request: HttpRequest) => {
    const action = request.headers["x-amz-target"].split(".").at(-1)!; events.push(action);
    const f = facts();
    const body = action === "DescribeServices" ? { services: [f.service], failures: [] } :
      action === "DescribeTaskDefinition" ? { taskDefinition: f.taskDefinition } :
      action === "DescribeTasks" ? { tasks: f.tasks, failures: [] } : null;
    assert.ok(body, "unexpected ECS SDK action");
    return response(JSON.stringify(body), { "content-type": "application/x-amz-json-1.1" });
  } } });
  const sdkFacts = async () => {
    const f = facts();
    const service = await ecs.send(new DescribeServicesCommand({ cluster: f.service.clusterArn, services: [serviceArn] }));
    const taskDefinition = await ecs.send(new DescribeTaskDefinitionCommand({ taskDefinition: f.service.taskDefinition }));
    const tasks = await ecs.send(new DescribeTasksCommand({ cluster: f.service.clusterArn, tasks: f.tasks.map(t => t.taskArn!) }));
    return { ...f, service: service.services![0], taskDefinition: taskDefinition.taskDefinition!, tasks: tasks.tasks! };
  };
  const cloud = new ReleaseCloudFormationAdapter(cfn), reader = { capture: async () => {
    events.push("ExecutorSnapshot"); executorReads++; const f = await sdkFacts(); controls.executorPatch?.(f, executorReads); return f;
  } };
  const inspectorReader = { capture: async () => {
    events.push("IndependentSnapshot"); inspectorReads++; const f = await sdkFacts(); controls.inspectorPatch?.(f); return f;
  } };
  const deps = { repository: executorRepo, cloud, reader, inspector: { inspect: (arg: Parameters<typeof inspectInstanceRelease>[0]) =>
    inspectInstanceRelease(arg, { repository: verifierRepo, reader: inspectorReader, evidence, now: () => sql.now }) },
    now: () => sql.now, pause: async (ms: number) => { sql.now += ms; } };
  const planningInput = { selection: plan.selection, binding, release, now: sql.now,
    observation: await assertReleaseRuntime(plan, facts(), "from", sql.now, sql.now) };
  return { plan, sha, input, sql, deps, controls, events, documents, facts, planningInput, plannerRepo, executorRepo, verifierRepo, evidence,
    stats: () => ({ created, executed, executorReads, inspectorReads, stackReads }),
    prepare: (i: typeof planningInput) => prepareInstanceRelease(i, plannerRepo), destroy: () => { cfn.destroy(); s3.destroy(); ecs.destroy(); } };
}
