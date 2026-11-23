import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { firstOpenVersion, verifyFirstOpenTaskRelease } from "../../lib/deployments/execution/first-onboarding-version.ts";
import { SANDBOX_FIRST_OPEN as s, SANDBOX_FIRST_OPEN_STACK as stackName } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import type { FirstOpenFrozenRelease } from "./first-open-release-entry.ts";
import { firstOpenProvisionerChangeSetName } from "./first-open-provisioner-lanes.ts";
import postRestore from "./first-open-fc41597f-post-restore-install.prepared.json" with { type: "json" };
import oidc from "./first-open-fc41597f-oidc-handoffs.prepared.json" with { type: "json" };
import probe from "./first-open-fc41597f-session-deltas.prepared.json" with { type: "json" };

const roleSessionName = "first-open-fc41597f-inspector-g1";
const pref = (service: string) => `arn:aws:${service}:${s.region}:${s.account}:`;
const tenantStack = `${pref("cloudformation")}stack/${stackName}/*`;
const clusterName = postRestore.boundProjection.liveCellParameterSubset.ClusterName;
const cluster = `${pref("ecs")}cluster/${clusterName}`;
const service = `${pref("ecs")}service/${clusterName}/${stackName.replace(/^techlong-sandbox-/, "")}-ecs-service`;
const zone = `arn:aws:route53:::hostedzone/${s.zone}`;
const imageRepository = `${pref("ecr")}repository/${s.imageRepository.split("amazonaws.com/")[1]}`;
const mediaBucket = `arn:aws:s3:::${s.bucket}`;
const generationSecret = `${pref("secretsmanager")}secret:${s.secretName}-??????`;
const regionalOnly = ["ecs:DescribeTaskDefinition", "elasticloadbalancing:DescribeListeners", "elasticloadbalancing:DescribeLoadBalancers",
  "elasticloadbalancing:DescribeTargetGroups", "elasticloadbalancing:DescribeTargetHealth", "elasticloadbalancing:DescribeRules"] as const;
const exactTenant = { "aws:ResourceTag/AppInstanceId": s.instanceId };
const generation = { ...exactTenant, "aws:ResourceTag/DeploymentId": s.deploymentId, "aws:ResourceTag/ResourceGeneration": "1" };
const authorityStack = pref("cloudformation") + "stack/techlong-s3-bootstrap/8afbe1e0-9425-11f1-b06a-02ff648cb917";
const authorityBucket = "arn:aws:s3:::" + FIRST_OPEN_BASELINE_BINDING.bucket;

export function firstOpenInspectorAuthorityReadScope(release: FirstOpenFrozenRelease, releaseSha256: string) {
  // Both change-set names are byte-bound to this approval, never a prefix
  // wildcard or selected from an artifact/management request.
  const stem = "fc41597f-cfn-version-" + release.approvalSha256.slice(0, 24);
  return {
    schema: "techlong/fc41597f-inspector-authority-read/v1",
    jobId: s.jobId, roleArn: s.inspectorRole, roleId: probe.inspector.awsRoleId, roleSessionName,
    releaseSha256, approvalSha256: release.approvalSha256, inspectorReusableCommit: release.inspectReusableCommit,
    roles: [s.workerRole, s.lifecycleRole, s.cfnRole],
    roleIds: ["AROAV3GNMXTZMEBX7MOF7", "AROAV3GNMXTZDIWVT3BKN", "AROAV3GNMXTZKHYBCRSOE"],
    boundaries: ["TechlongSandboxProvisionerBoundary", "TechlongSandboxFirstOpenFc41597fLifecycleBoundary",
      "TechlongSandboxServiceRoleBoundary", "TechlongSandboxCloudFormationExecutionBoundary"]
      .map(name => `arn:aws:iam::${s.account}:policy/${name}`),
    evidenceBucketArn: authorityBucket, ownerStackArn: authorityStack,
    changeSetNames: [stem + "-grant", stem + "-relock"],
    provisionerChangeSetNames: [firstOpenProvisionerChangeSetName(release.approvalSha256, "formal-provisioner", "grant"),
      firstOpenProvisionerChangeSetName(release.approvalSha256, "formal-provisioner", "relock")],
    notBefore: new Date(release.startAt).toISOString(), notAtOrAfter: new Date(release.writeBefore).toISOString(),
  };
}

export type FirstOpenInspectorAuthorityReadConsent = {
  reviewedScope: ReturnType<typeof firstOpenInspectorAuthorityReadScope>;
  approvedScopeSha256: string;
};

/** Read-only addition to the same role; no new OIDC trust, role, S3 object
 * access, pagination grant, simulator, or mutation permission. */
export async function firstOpenInspectorAuthorityReadStatements(release: FirstOpenFrozenRelease, releaseSha256: string,
  consent: FirstOpenInspectorAuthorityReadConsent) {
  const expected = firstOpenInspectorAuthorityReadScope(release, releaseSha256);
  if (!release.taskRelease || release.jobId !== s.jobId || !/^[a-f0-9]{64}$/.test(release.approvalSha256) ||
    !/^[a-f0-9]{40}$/.test(release.inspectReusableCommit) || release.startAt >= release.writeBefore ||
    await sha256Hex(release) !== releaseSha256 || canonicalJson(consent.reviewedScope) !== canonicalJson(expected) ||
    await sha256Hex(expected) !== consent.approvedScopeSha256) throw Error("FIRST_OPEN_INSPECTOR_AUTHORITY_CONSENT_SCOPE");
  await verifyFirstOpenTaskRelease(release.taskRelease);
  const allow = (Sid: string, Action: string[], Resource: string | string[], keys: Record<string, string | string[]> = {}) => ({
    Sid, Effect: "Allow" as const, Action, Resource,
    Condition: { StringEquals: { "aws:userid": `${expected.roleId}:${expected.roleSessionName}`,
      "aws:FederatedProvider": oidc.federatedTrust.existingProviderArn, ...keys } as Record<string, string | string[]>,
    DateGreaterThanEquals: { "aws:CurrentTime": expected.notBefore },
    DateLessThan: { "aws:CurrentTime": expected.notAtOrAfter } },
  });
  return [
    allow("ReadFirstOpenAuthorityRoles", ["iam:GetRole", "iam:ListAttachedRolePolicies", "iam:ListRolePolicies", "iam:GetRolePolicy"], expected.roles),
    allow("ReadFirstOpenAuthorityBoundaries", ["iam:GetPolicy", "iam:GetPolicyVersion"], expected.boundaries),
    allow("ReadFirstOpenEvidenceBucketPolicy", ["s3:GetBucketPolicy"], expected.evidenceBucketArn, { "s3:ResourceAccount": s.account }),
    allow("ReadFirstOpenAuthorityOwnerStack", ["cloudformation:DescribeStacks", "cloudformation:GetTemplate"], expected.ownerStackArn,
      { "aws:RequestedRegion": s.region }),
    allow("ReadFirstOpenAuthorityChangeSets", ["cloudformation:DescribeChangeSet"], expected.ownerStackArn,
      { "aws:RequestedRegion": s.region, "cloudformation:ChangeSetName": [...expected.changeSetNames, ...expected.provisionerChangeSetNames] }),
  ];
}

/** The only optional IAM breadth is in this reviewed object. An IAM action on
 * a zone, bucket, repo or regional resource can exceed one sampler request;
 * don't misdescribe application-level bounds as AWS IAM filters. */
export function firstOpenInspectorReadScope(release: FirstOpenFrozenRelease, releaseSha256: string) {
  const version = firstOpenVersion(release.taskRelease);
  return {
    schema: "techlong/sandbox-first-open-inspector-read-scope/v1",
    jobId: s.jobId, roleArn: s.inspectorRole, roleId: probe.inspector.awsRoleId, roleSessionName,
    region: s.region, releaseSha256, launchApprovalSha256: release.approvalSha256,
    notBefore: new Date(release.startAt).toISOString(), notAtOrAfter: new Date(release.writeBefore).toISOString(),
    regionalWildcardActionNames: [...regionalOnly],
    resourceWildcard: "*",
    clusterWildcard: { action: "ecs:ListTasks", clusterArn: cluster },
    dns: { action: "route53:ListResourceRecordSets", hostedZoneArn: zone, requestName: s.hostname, requestType: "A", requestMaxItems: 1 },
    persistence: { action: "s3:ListBucket", bucketArn: mediaBucket, request: "HeadBucket", canListKeys: true },
    manifest: { action: "ecr:BatchGetImage", repositoryArn: imageRepository, requestDigest: version.imageDigest, iamCanReadOtherDigestsInRepo: true },
    knownScope: { tenantStack, cellStack: s.cellStack, platformStack: s.platformStack, service, cluster,
      generatedTaskArn: `${pref("ecs")}task/${clusterName}/*`, aurora: s.clusterArn, controlSecret: s.controlArn, generationSecret },
  };
}

export type FirstOpenInspectorReadConsent = {
  reviewedScope: ReturnType<typeof firstOpenInspectorReadScope>;
  approvedScopeSha256: string;
};

export async function firstOpenInspectorReadStatements(release: FirstOpenFrozenRelease, releaseSha256: string,
  consent?: FirstOpenInspectorReadConsent) {
  const expected = firstOpenInspectorReadScope(release, releaseSha256);
  if (release.taskRelease) await verifyFirstOpenTaskRelease(release.taskRelease);
  if (consent === undefined) return { status: "INSPECTOR_METADATA_CONSENT_REQUIRED" as const, expected, statements: [] };
  if (release.jobId !== s.jobId || await sha256Hex(release) !== releaseSha256 ||
    canonicalJson(consent.reviewedScope) !== canonicalJson(expected) ||
    !/^[a-f0-9]{64}$/.test(consent.approvedScopeSha256) || await sha256Hex(expected) !== consent.approvedScopeSha256) {
    throw Error("FIRST_OPEN_INSPECTOR_METADATA_CONSENT_SCOPE");
  }
  const allow = (Sid: string, Action: string | readonly string[], Resource: string | string[],
    extraString: Record<string, string> = {}, arn: Record<string, string> = {}, isGlobal = false) => ({
    Sid, Effect: "Allow" as const, Action, Resource,
    Condition: {
      StringEquals: { "aws:userid": `${expected.roleId}:${expected.roleSessionName}`,
        "aws:FederatedProvider": oidc.federatedTrust.existingProviderArn,
        ...(isGlobal ? {} : { "aws:RequestedRegion": expected.region }), ...extraString },
      ...(Object.keys(arn).length ? { ArnEquals: arn } : {}),
      DateGreaterThanEquals: { "aws:CurrentTime": expected.notBefore },
      DateLessThan: { "aws:CurrentTime": expected.notAtOrAfter },
    },
  });
  // AWS service authorization treats the Fargate ListTasks call as
  // cluster-scoped, not service-scoped. Task tags fence DescribeTasks.
  // ELB Describe and ECS DescribeTaskDefinition require Resource: "*".
  const arnCluster = { "ecs:cluster": cluster };
  const statements = [
    allow("FirstOpenReadRelatedStacks", "cloudformation:DescribeStacks", [s.cellStack, s.platformStack]),
    allow("FirstOpenReadTaggedTenantStack", ["cloudformation:DescribeStacks", "cloudformation:GetTemplate",
      "cloudformation:ListStackResources", "cloudformation:ListChangeSets"], tenantStack, generation),
    allow("FirstOpenReadTenantService", "ecs:DescribeServices", service, exactTenant, arnCluster),
    allow("FirstOpenListClusterTasks", "ecs:ListTasks", "*", {}, arnCluster),
    allow("FirstOpenDescribeTaggedTasks", "ecs:DescribeTasks", expected.knownScope.generatedTaskArn, exactTenant, arnCluster),
    allow("FirstOpenRegionalMetadataOnly", [...regionalOnly], "*"),
    allow("FirstOpenReadAuroraMetadata", "rds:DescribeDBClusters", s.clusterArn),
    allow("FirstOpenReadControlSecretMetadata", "secretsmanager:DescribeSecret", s.controlArn),
    allow("FirstOpenReadTaggedG1SecretMetadata", "secretsmanager:DescribeSecret", generationSecret, generation),
    allow("FirstOpenReadExactZoneRecords", expected.dns.action, zone, {}, {}, true),
    allow("FirstOpenHeadExactPersistenceBucket", expected.persistence.action, mediaBucket),
    allow("FirstOpenReadBackendRepoManifest", expected.manifest.action, imageRepository),
  ];
  return { status: "EXACT_DRAFT_SCOPE_BOUND_NOT_INSTALLED" as const, expected, statements };
}
