import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { SANDBOX_FIRST_OPEN as s, SANDBOX_FIRST_OPEN_STACK } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { isFirstOpenBuyerSignerPin, type FirstOpenBuyerSignerPin } from "../../lib/buyer-forward/signer-binding.ts";
import { firstOpenManagementKeys } from "./first-open-management-bridge.ts";
import type { FirstOpenFrozenRelease } from "./first-open-release-entry.ts";
import { renderFirstOpenLockedProvisioner, projectFirstOpenWriterWriteAuthority } from "./scripts/first-open-lifecycle-iam-delta.mjs";
import oidc from "./first-open-fc41597f-oidc-handoffs.prepared.json" with { type: "json" };

type Policy = { Version: string; Statement: Record<string, unknown>[] };
type Resource = { Type: string; Properties: Record<string, unknown> };
type Template = { Resources: Record<string, Resource> };
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const fail = (): never => { throw Error("FIRST_OPEN_PROVISIONER_TARGET_SCOPE"); };
const time = (n: number) => ({ "aws:CurrentTime": new Date(n).toISOString() });
const provider = oidc.federatedTrust.existingProviderArn;
const author = oidc.federatedTrust.runOnce.targets[0];
const name = "first-open-fc41597f-provisioner-g1";
const scope = { "aws:userid": `${author.roleId}:${name}` };
const session = { ...scope, "aws:FederatedProvider": provider };
const stack = `arn:aws:cloudformation:${s.region}:${s.account}:stack/${SANDBOX_FIRST_OPEN_STACK}/*`;
const prefix = `arn:aws:s3:::${FIRST_OPEN_BASELINE_BINDING.bucket}/`;
export const firstOpenProvisionerChanges = ["ProvisionerRole", "ProvisionerBoundary"].map(logicalId => ({
  logicalId, action: "Modify" as const, replacement: false as const,
}));

export function firstOpenProvisionerTrust(release: FirstOpenFrozenRelease) {
  return { Effect: "Allow", Principal: { Federated: provider }, Action: "sts:AssumeRoleWithWebIdentity", Condition: {
    StringEquals: { ...oidc.federatedTrust.commonClaims, "token.actions.githubusercontent.com:actor_id": release.actorId,
      "token.actions.githubusercontent.com:job_workflow_ref": `veinyyxy/TechlongSoftware/${oidc.federatedTrust.runOnce.reusablePathCandidate}@${release.runOnceReusableCommit}`,
      "sts:RoleSessionName": name },
    DateGreaterThanEquals: time(release.startAt), DateLessThan: time(release.claimBefore),
  } };
}

export function firstOpenProvisionerTemplatePut(release: FirstOpenFrozenRelease) {
  return { Effect: "Allow", Action: "s3:PutObject",
    Resource: prefix + `first-open-management/${s.jobId}/${release.approvalSha256}/cfn-template.json`,
    Condition: { StringEquals: { ...session, "s3:if-none-match": "*", "s3:x-amz-server-side-encryption": "AES256" },
      DateGreaterThanEquals: time(release.startAt), DateLessThan: time(release.phaseCutoffs[3]) },
  };
}

export async function firstOpenProvisionerProjection(template: Template) {
  const role = template.Resources.ProvisionerRole?.Properties;
  const managed = template.Resources.ProvisionerBoundary?.Properties;
  const trust = structuredClone(role?.AssumeRolePolicyDocument) as Policy | undefined;
  const policy = role?.Policies as { PolicyName: string; PolicyDocument: unknown }[] | undefined;
  const boundaryArn = `arn:aws:iam::${s.account}:policy/TechlongSandboxProvisionerBoundary`;
  if (!trust?.Statement?.length || trust.Version !== "2012-10-17" || policy?.length !== 1 ||
    role?.RoleName !== s.workerRole.split("/").at(-1) || !same(role.PermissionsBoundary, { Ref: "ProvisionerBoundary" }) ||
    !same(role.ManagedPolicyArns, [{ Ref: "ProvisionerBoundary" }]) ||
    managed?.ManagedPolicyName !== "TechlongSandboxProvisionerBoundary" || !managed.PolicyDocument) return fail();
  const first = trust.Statement[0];
  if (same(first.Principal, { AWS: { Ref: "ProvisionerPrincipalArn" } })) {
    const principal = "arn:aws:iam::402010193138:user/techlong-sandbox-dev";
    const param = (template as Template & { Parameters?: Record<string, { Default: string; AllowedValues: string[] }> })
      .Parameters?.ProvisionerPrincipalArn;
    if (param?.Default !== principal || !same(param.AllowedValues, [principal])) return fail();
    first.Principal = { AWS: principal };
  }
  return { role: { arn: s.workerRole, roleId: author.roleId, boundaryArn, attached: [boundaryArn],
    inline: [{ name: policy[0].PolicyName, sha256: await sha256Hex(policy[0].PolicyDocument) }], trustSha256: await sha256Hex(trust) },
  policies: [{ policyArn: boundaryArn, documentSha256: await sha256Hex(managed.PolicyDocument) }] };
}

/** Only targets on the existing owner stack. Other first-open and legacy MFA
 * permissions remain unchanged; direct CFN writes and role chaining stay denied.
 * It does not purport to prove STS, tagged CreateSecret or AWS effective access. */
export async function renderFirstOpenProvisionerTargets<T extends Template>(
  locked: T, lockedSha256: string, release: FirstOpenFrozenRelease, signer: FirstOpenBuyerSignerPin,
) {
  const restore = structuredClone(locked);
  const dates = [release.startAt, release.claimBefore, release.phaseCutoffs[3], release.writeBefore];
  if (await sha256Hex(restore) !== lockedSha256 || !release.taskRelease || release.jobId !== s.jobId || release.actorId !== "14145707" ||
    !/^[a-f0-9]{64}$/.test(release.approvalSha256) || !/^[a-f0-9]{40}$/.test(release.runOnceReusableCommit) ||
    !dates.every(Number.isSafeInteger) || dates[0] <= 0 || dates.some((t, i) => i > 0 && t <= dates[i - 1]) ||
    release.writeBefore - release.startAt > 3_600_000 || !isFirstOpenBuyerSignerPin(signer)) return fail();
  const grant = structuredClone(restore);
  const { ProvisionerRole: role, ProvisionerBoundary: boundary } = grant.Resources;
  const version = "2012-10-17";
  const boundaryPolicy = boundary?.Properties.PolicyDocument as Policy | undefined;
  if (!role || boundary?.Type !== "AWS::IAM::ManagedPolicy" ||
    boundary.Properties.ManagedPolicyName !== "TechlongSandboxProvisionerBoundary" || boundaryPolicy?.Version !== version ||
    !Array.isArray(boundaryPolicy.Statement) || author.roleArn !== s.workerRole) return fail();
  const fence = { status: "BLOCKED_NO_PROVED_EFFECTIVE_WRITER_SCOPE", roleArn: author.roleArn, roleId: author.roleId,
    roleSessionName: name, writeBefore: release.writeBefore };
  const legacy = structuredClone(role);
  delete legacy.Properties.Policies;
  if (!same(role, renderFirstOpenLockedProvisioner(legacy, fence))) return fail();
  const proposed = projectFirstOpenWriterWriteAuthority(fence, release.startAt);
  const managed = boundaryPolicy.Statement;
  const trust = role.Properties.AssumeRolePolicyDocument as Policy;
  trust.Statement.push(firstOpenProvisionerTrust(release));

  const { request, reply } = firstOpenManagementKeys(release.approvalSha256, true);
  const requests = prefix + request[0].replace(/request-1\.json$/, "request-*.json");
  const replies = prefix + reply[0].replace(/reply-0\.json$/, "reply-*.json");
  const template = firstOpenProvisionerTemplatePut(release);
  const allow = (Action: string | string[], Resource: string | string[], eq: Record<string, unknown> = {},
    rest: Record<string, unknown> = {}) => ({ Effect: "Allow", Action, Resource, Condition: { StringEquals: { ...scope, ...eq }, ...rest } });
  const tagged = proposed.generationSecret.Condition;
  const tags = Object.fromEntries(Object.entries(tagged.StringEquals).filter(([k]) => k.startsWith("aws:RequestTag/")));
  const generation = proposed.generationSecret.Resource;
  const ddb = proposed.dynamoDb.Resource, key = "tenant:" + s.stableIdentity;
  // This managed policy is also attached to the role. Every new Allow has the
  // reserved userId, so the unchanged MFA entry does not gain any permissions.
  // IAM keeps the two directions in this approval namespace. The existing
  // mailbox adapter checks the exact 12/13 slots; IAM does not count requests
  // or restrict the numeric suffix. Do not present that as an AWS guarantee.
  managed.push(template, allow(["s3:GetObject", "s3:PutObject", "dynamodb:PutItem", "secretsmanager:DescribeSecret", "secretsmanager:GetSecretValue"],
    [prefix + request[0].replace(/request-1\.json$/, "*"), ddb, generation, signer.arn]),
    // Standalone TagResource with SecretId is denied even if a later resource
    // policy allows it. The dependent authorization's context still requires
    // provider proof; failing closed is preferable to retagging an existing secret.
    allow(["secretsmanager:CreateSecret", "secretsmanager:TagResource"], generation, tags));

  const elb = ["elasticloadbalancing:DescribeListeners", "elasticloadbalancing:DescribeRules",
    "elasticloadbalancing:DescribeTrustStores", "elasticloadbalancing:DescribeLoadBalancers"];
  const dbActions = ["dynamodb:GetItem", "dynamodb:PutItem"];
  const secretChanges = ["secretsmanager:CreateSecret", "secretsmanager:TagResource"];
  const allowed = ["sts:GetCallerIdentity", "s3:GetObject", "s3:PutObject", "cloudformation:DescribeStacks", "rds:DescribeDBClusters",
    ...elb, ...dbActions, "secretsmanager:DescribeSecret", "secretsmanager:GetSecretValue", ...secretChanges];
  const deny = (fields: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    ({ Effect: "Deny", ...fields, Condition: { StringEquals: scope, ...extra } });
  const all = { Action: "*", Resource: "*" };
  const on = (Action: string | string[], Resource = "*") => ({ Action, Resource });
  const off = (Action: string | string[], NotResource: string | string[]) => deny({ Action, NotResource });
  const mismatch = (k: string, v: unknown) => ({ StringNotEquals: { [k]: v } });
  const inline = { Version: version, Statement: [
    template,
    deny({ NotAction: allowed, Resource: "*" }),
    deny(all, { DateLessThan: time(release.startAt) }), deny(all, { DateGreaterThanEquals: time(release.writeBefore) }),
    deny(all, mismatch("aws:FederatedProvider", provider)),
    deny(on(["cloudformation:*", "elasticloadbalancing:*", "rds:*", "dynamodb:*", "secretsmanager:*"]), mismatch("aws:RequestedRegion", s.region)),
    off("s3:GetObject", replies), off("s3:PutObject", [requests, template.Resource]),
    deny(on("s3:PutObject"), mismatch("s3:if-none-match", "*")),
    deny(on("s3:PutObject"), mismatch("s3:x-amz-server-side-encryption", "AES256")),
    deny(on("s3:PutObject", template.Resource), { DateGreaterThanEquals: time(release.phaseCutoffs[3]) }),
    off("cloudformation:DescribeStacks", [s.cellStack, stack]), off("rds:DescribeDBClusters", s.clusterArn),
    off(dbActions, ddb), deny(on(dbActions, ddb), { "ForAnyValue:StringNotEquals": { "dynamodb:LeadingKeys": [key] } }),
    deny(on(dbActions, ddb), { Null: { "dynamodb:LeadingKeys": "true" } }),
    off(["secretsmanager:DescribeSecret", ...secretChanges], generation), off("secretsmanager:GetSecretValue", signer.arn),
    deny(on("secretsmanager:GetSecretValue", signer.arn), mismatch("secretsmanager:VersionId", signer.versionId)),
    deny(on("secretsmanager:GetSecretValue", signer.arn), { DateGreaterThanEquals: time(release.claimBefore) }),
    deny(on(secretChanges, generation), { "ForAnyValue:StringNotEquals": tagged["ForAllValues:StringEquals"] }),
    deny(on("secretsmanager:CreateSecret", generation), mismatch("secretsmanager:Name", s.secretName)),
    ...["AddReplicaRegions", "ForceOverwriteReplicaSecret", "KmsKeyId", "KmsKeyArn"].map(k =>
      deny(on("secretsmanager:CreateSecret", generation), { Null: { [`secretsmanager:${k}`]: "false" } })),
    deny(on("secretsmanager:TagResource", generation), { Null: { "secretsmanager:SecretId": "false" } }),
  ] };
  role.Properties.Policies = [{ PolicyName: "FirstOpenFc41597fWriterFence", PolicyDocument: inline }];
  const sizes = { boundary: JSON.stringify(boundaryPolicy).length, role: JSON.stringify(inline).length, trust: JSON.stringify(trust).length };
  if (sizes.boundary > 6_144) throw Error("FIRST_OPEN_PROVISIONER_BOUNDARY_SIZE");
  if (sizes.role > 10_240 || sizes.trust > 2_048) throw Error("FIRST_OPEN_PROVISIONER_ROLE_SIZE");
  return { grant, restore, grantSha256: await sha256Hex(grant), restoreSha256: lockedSha256, sizes, changes: firstOpenProvisionerChanges,
    executionAuthorized: false as const,
    requiredProviderEvidence: ["TAG_ON_CREATE_WITHOUT_STANDALONE_TAG", "EXACT_ROLE_AND_BOUNDARY_READBACK"] as const,
    policyLimits: { mailboxSlotNamesEnforcedByRunner: true, iamBoundsMailboxToApprovalAndDirection: true, iamEnforcesDynamoCasBody: false } };
}
