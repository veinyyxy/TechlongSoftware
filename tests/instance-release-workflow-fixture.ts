import type { InstanceBinding } from "../lib/deployments/releases/contract.ts";
import type { ReleaseEnvironmentConfig, ReleaseJobContext } from "../lib/deployments/releases/handoff.ts";
import { sampleInstanceRelease, type ReleaseSamplingBinding, type ReleaseMetadataApi } from "../lib/deployments/releases/sampling.ts";
import { releaseRuntimeDigests } from "../lib/deployments/releases/inspection.ts";
import { cycleFixture } from "./instance-release-cycle-fixture.ts";

export const workflowJob = (): ReleaseJobContext => ({ repository: "veinyyxy/TechlongSoftware", repositoryId: "1234", runId: "5678", runAttempt: 1,
  workflowRef: "veinyyxy/TechlongSoftware/.github/workflows/instance-release.yml@refs/heads/main",
  sourceSha: "1".repeat(40), ref: "refs/heads/main", event: "workflow_dispatch", actor: "operator", instanceId: "app_one", releaseId: "release_v2", environment: "sandbox" });
export function workflowEnvironment(): ReleaseEnvironmentConfig {
  return { accountId: "111111111111", region: "ca-central-1", repositoryId: "1234", controlEnvironmentId: "sandbox",
    environmentName: "techlong-sandbox-deploy", environmentId: 42, reviewerId: 100, prepareRoleArn: "arn:aws:iam::111111111111:role/release-planner",
    executionRoleArn: "arn:aws:iam::111111111111:role/release-executor", inspectionRoleArn: "arn:aws:iam::111111111111:role/release-verifier",
    prepareSubject: "repo:veinyyxy/TechlongSoftware:ref:refs/heads/main", deploySubject: "repo:veinyyxy/TechlongSoftware:environment:techlong-sandbox-deploy",
    database: Object.fromEntries(["planner", "executor", "verifier"].map(role => [role, { arn: `arn:aws:secretsmanager:ca-central-1:111111111111:secret/release-${role}-test`,
      versionId: "00000000-0000-4000-8000-000000000001", username: `deployment_release_${role}_login` }])) as ReleaseEnvironmentConfig["database"],
    evidence: { bucket: "synthetic-private", owner: "111111111111", prefix: "releases" }, maxMetadataCallsPerSnapshot: 40 };
}

export async function workflowFixture() {
  const cycle = await cycleFixture(), job = workflowJob(), config = workflowEnvironment();
  const binding = cycle.sql.contexts.get(job.instanceId)!.binding as InstanceBinding & { sampling: ReleaseSamplingBinding };
  const listener = "arn:aws:elasticloadbalancing:ca-central-1:111111111111:listener/app/shared/lb-id/https-id";
  const control = listener.replace("https-id", "control-id");
  const secret = { arn: "arn:aws:secretsmanager:ca-central-1:111111111111:secret/runtime-test", versionId: "fixed-runtime-version" };
  binding.sampling = { cellStackId: binding.stackId.replace("tenant-one", "shared-cell"), platformStackId: binding.stackId.replace("tenant-one", "platform"),
    hostedZoneId: "ZTEST", apiHostname: "api.sandbox.techlong.cloud", cellOutputParameters: {
      ClusterName: "ClusterName", HttpsListenerArn: "HttpsListenerArn", ControlListenerArn: "ControlListenerArn" },
    database: { kind: "cluster", identifier: "synthetic-db", profile: "express_iam", schemaVersion: "schema-v1" }, secrets: [secret],
    persistence: { bucket: "synthetic-images", providerVariable: "IMAGE_PROVIDER", bucketVariable: "IMAGE_BUCKET", verificationSha256: "a".repeat(64) } };
  const calls: { service: string; operation: string; input: Record<string, unknown> }[] = [];
  const controls = { stopped: false, missingSecret: false, unpinned: false, foreignDns: false, wrongRoute: false, paginate: false };
  const raw = () => {
    const f = structuredClone(cycle.facts());
    Object.assign(f.parameters, { HttpsListenerArn: listener, ControlListenerArn: control });
    for (const [i, key] of ["TenantHttpsRule", "TenantMtlsRule", "TenantDenyRule"].entries()) {
      f.resources[key].physicalId = (i === 0 ? listener : control).replace(":listener/", ":listener-rule/") + "/rule-" + i;
    }
    const api = f.taskDefinition.containerDefinitions![0];
    api.environment!.push({ name: "IMAGE_PROVIDER", value: "s3" }, { name: "IMAGE_BUCKET", value: "synthetic-images" });
    api.secrets = [{ name: "JWT_SECRET", valueFrom: controls.unpinned ? secret.arn : `${secret.arn}:jwt::${secret.versionId}` }];
    return f;
  };
  const api: ReleaseMetadataApi = { read: async <T>(service: string, operation: string, input: Record<string, unknown>) => {
    calls.push({ service, operation, input }); const f = raw(); let result: unknown;
    switch (operation) {
      case "describe-stacks": result = { Stacks: [{ StackId: input.StackName, StackStatus: "UPDATE_COMPLETE", CreationTime: "1970-01-01T00:00:01Z",
        LastUpdatedTime: new Date(input.StackName === binding.stackId ? f.stackUpdatedAt : 1000).toISOString(), RoleARN: f.roleArn, Tags: Object.entries(f.tags).map(([Key, Value]) => ({ Key, Value })),
        Parameters: Object.entries(f.parameters).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })),
        Outputs: Object.entries({ ClusterName: "cluster", HttpsListenerArn: listener, ControlListenerArn: control, VpcId: "vpc-test" }).map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue })) }] }; break;
      case "get-template": result = { TemplateBody: JSON.stringify(f.template) }; break;
      case "list-stack-resources": result = { StackResourceSummaries: Object.entries(f.resources).map(([LogicalResourceId, r]) => ({ LogicalResourceId,
        ResourceType: r.type, PhysicalResourceId: r.physicalId, ResourceStatus: "CREATE_COMPLETE" })), ...(controls.paginate ? { NextToken: "more" } : {}) }; break;
      case "list-change-sets": result = { Summaries: f.openChangeSetIds.map(ChangeSetId => ({ ChangeSetId, ExecutionStatus: "AVAILABLE" })) }; break;
      case "describe-change-set": result = f.changeSet; break;
      case "describe-db-clusters": result = { DBClusters: [{ DBClusterIdentifier: "synthetic-db", Status: controls.stopped ? "stopped" : "available", Engine: "aurora-postgresql", IAMDatabaseAuthenticationEnabled: true }] }; break;
      case "describe-services": result = { services: [f.service], failures: [] }; break;
      case "describe-task-definition": result = { taskDefinition: f.taskDefinition }; break;
      case "list-tasks": result = { taskArns: f.tasks.map(t => t.taskArn) }; break;
      case "describe-tasks": result = { tasks: f.tasks, failures: [] }; break;
      case "describe-listeners": result = { Listeners: [{ ListenerArn: listener, LoadBalancerArn: "synthetic-alb", Port: 443, Protocol: "HTTPS" },
        { ListenerArn: control, LoadBalancerArn: "synthetic-alb", Port: 8443, Protocol: "HTTPS", MutualAuthentication: { Mode: "verify" } }] }; break;
      case "describe-load-balancers": result = { LoadBalancers: [{ LoadBalancerArn: "synthetic-alb", DNSName: "shared.elb.amazonaws.com", State: { Code: "active" } }] }; break;
      case "describe-target-groups": result = { TargetGroups: [{ TargetGroupArn: f.targets.groupArn, VpcId: "vpc-test", Port: 3000 }] }; break;
      case "describe-target-health": result = { TargetHealthDescriptions: f.targets.targets.map(t => ({ Target: { Id: t.ip }, TargetHealth: { State: t.state } })) }; break;
      case "describe-rules": result = { Rules: Object.entries(f.resources).filter(([,r]) => r.type.endsWith("ListenerRule")).map(([,r]) => ({ RuleArn: r.physicalId,
        Conditions: [{ Field: "host-header", HostHeaderConfig: { Values: [controls.wrongRoute ? "foreign.sandbox.techlong.cloud" : binding.sampling.apiHostname] } }],
        Actions: [{ Type: "forward", TargetGroupArn: f.targets.groupArn }] })) }; break;
      case "list-resource-record-sets": result = { IsTruncated: true, ResourceRecordSets: [{ Name: binding.sampling.apiHostname + ".", Type: "A",
        AliasTarget: { DNSName: controls.foreignDns ? "foreign.elb.amazonaws.com." : "dualstack.shared.elb.amazonaws.com." } }] }; break;
      case "describe-secret": result = { ARN: secret.arn, VersionIdsToStages: controls.missingSecret ? {} : { [secret.versionId]: ["AWSCURRENT"] } }; break;
      case "head-bucket": result = {}; break;
      case "batch-get-image": result = { images: [{ imageId: { imageDigest: cycle.planningInput.release.image.manifestDigest }, imageManifest: f.artifact.manifest }] }; break;
      default: throw new Error("unexpected fixture operation");
    }
    return result as T;
  }, getTechnical: async () => ({ status: 200, tlsVerified: true, checkedAt: cycle.sql.now }) };
  const sampled = await sampleInstanceRelease(binding, cycle.planningInput.release, api, () => cycle.sql.now);
  Object.assign(binding, await releaseRuntimeDigests(sampled)); calls.length = 0;
  return { cycle, job, config, binding, api, calls, controls, raw };
}
