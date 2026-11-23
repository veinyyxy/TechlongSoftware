import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { firstOpenCleanupPermitClaims, type FirstOpenCleanupPermit, checkFirstOpenCleanupPermit } from "./first-open-cleanup-verify.ts";
import { firstOpenSupervisedCleanupDraft } from "./first-open-express-cleanup-review.ts";
import { FIRST_OPEN_BASELINE_BINDING, validFirstOpenVersionId } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { SANDBOX_FIRST_OPEN as s, SANDBOX_FIRST_OPEN_STACK } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { firstOpenVersionAuthorityScope, type VersionAuthorityScope } from "./first-open-controlled-cfn.ts";

// Canonical JSON SHA for the two already sealed, independently verified
// raw template artifacts; not the outer receipt's target-projection hash.
const lockedSharedSha = "c14498d79ac2edf569ff77ef6680a09ad243711b0d7935ea2447b695cfe35a5a";
const lockedBucketSha = "abace38c84669d0a2b3de1434129eecda75dfda5b7bac1843fbf48ea6929384e";
const lifecycleId = "AROAV3GNMXTZDIWVT3BKN";
const cleanupUserId = `${lifecycleId}:first-open-fc41597f-cleanup-g1`;
const managementUserId = `${lifecycleId}:first-open-fc41597f-lifecycle-g1`;
const authorUserId = "AROAV3GNMXTZMEBX7MOF7:first-open-fc41597f-provisioner-g1";
const provider = "arn:aws:iam::402010193138:oidc-provider/token.actions.githubusercontent.com";
const cleanupResource = firstOpenSupervisedCleanupDraft().scope.postgres.dbConnectResource;
const iso = (epoch: number) => new Date(epoch).toISOString();
const fail = (): never => { throw Error("FIRST_OPEN_INSTALL_PREIMAGE_OR_INPUT_CHANGED"); };

type Statement = Record<string, unknown> & { Sid?: string };
type PolicyDocument = { Version: string; Statement: Statement[] };
type Template = { Resources: Record<string, CfnResource> };
type CfnResource = { Type: string; Condition?: string; Properties: Record<string, unknown> };
type RoleProperties = { AssumeRolePolicyDocument: PolicyDocument; PermissionsBoundary: unknown; Policies: {
  PolicyName: string; PolicyDocument: PolicyDocument;
}[] };

export const FIRST_OPEN_AUTHORITY_RESOURCES = Object.freeze({
  TenantLifecycleTaskRole: "AWS::IAM::Role",
  FirstOpenFc41597fLifecycleBoundary: "AWS::IAM::ManagedPolicy",
});

/** Only the protected operator may apply these templates. The preimage is
 * the independently reviewed, installed pre-grant owner template, not the
 * historical locked template or material received from RunOnce. */
export async function renderFirstOpenVersionGrantRelockTargets(preGrant: Template, preGrantSha256: string, scope: VersionAuthorityScope) {
  const relock = structuredClone(preGrant);
  if (await sha256Hex(relock) !== preGrantSha256 ||
    canonicalJson(firstOpenVersionAuthorityScope(scope)) !== canonicalJson(scope)) return fail();
  const grant = structuredClone(relock);
  const role = grant.Resources.TenantLifecycleTaskRole;
  const boundary = grant.Resources.FirstOpenFc41597fLifecycleBoundary;
  const props = role?.Properties as RoleProperties | undefined;
  const boundaryDoc = boundary?.Properties.PolicyDocument as PolicyDocument | undefined;
  const inline = props?.Policies;
  if (role?.Type !== FIRST_OPEN_AUTHORITY_RESOURCES.TenantLifecycleTaskRole ||
    boundary?.Type !== FIRST_OPEN_AUTHORITY_RESOURCES.FirstOpenFc41597fLifecycleBoundary ||
    role.Properties.RoleName !== s.lifecycleRole.split("/").at(-1) ||
    boundary.Properties.ManagedPolicyName !== "TechlongSandboxFirstOpenFc41597fLifecycleBoundary" ||
    canonicalJson(props?.PermissionsBoundary) !== canonicalJson({ Ref: "FirstOpenFc41597fLifecycleBoundary" }) ||
    !inline || inline.length !== 1 || inline[0].PolicyName !== "ImmutableReceiptsAndGenerationSecretRead" ||
    inline[0].PolicyDocument?.Version !== "2012-10-17" || boundaryDoc?.Version !== "2012-10-17" ||
    !Array.isArray(inline[0].PolicyDocument.Statement) || !Array.isArray(boundaryDoc.Statement)) return fail();
  const doc = inline[0].PolicyDocument;
  const object = `arn:aws:s3:::${scope.bucket}/${scope.key}`;
  const stack = `arn:aws:cloudformation:${s.region}:${s.account}:stack/${scope.stackName}/*`;
  const create = "cloudformation:CreateStack", describe = "cloudformation:DescribeStacks", pass = "iam:PassRole";
  const actions = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "rds-db:connect", "sts:GetCallerIdentity", "sts:AssumeRole"];
  const fixedVersions = Object.values(FIRST_OPEN_BASELINE_BINDING.objects).map(o => `arn:aws:s3:::${scope.bucket}/${o.key}`);
  const issuer = { "aws:FederatedProvider": provider };
  const bySession = { ...issuer, "aws:userid": managementUserId };
  const byWindow = { DateGreaterThanEquals: { "aws:CurrentTime": iso(scope.putAcknowledgedAt) },
    DateLessThan: { "aws:CurrentTime": iso(scope.submitBefore) } };
  const equal = (l: unknown, r: unknown) => canonicalJson(l) === canonicalJson(r);
  function replace(Sid: string, fields: Record<string, unknown>, replacement: Record<string, unknown>) {
    const expected = { Sid, Effect: "Deny", ...fields, Condition: { StringEquals: issuer } };
    const found = doc.Statement.filter(x => x.Sid === Sid);
    if (found.length !== 1 || !equal(found[0], expected)) return fail();
    Object.assign(found[0], replacement);
  }
  replace("FirstOpenNoFederatedLifecycleOtherActions", { NotAction: actions, Resource: "*" },
    { NotAction: [...actions, create, describe, pass] });
  replace("FirstOpenNoFederatedLifecycleOtherVersion", { Action: "s3:GetObjectVersion", NotResource: fixedVersions },
    { NotResource: [...fixedVersions, object] });
  const wrongSession = { Sid: "FirstOpenNoFederatedLifecycleWrongName", Effect: "Deny", Action: "*", Resource: "*",
    Condition: { StringEquals: issuer, StringNotEquals: { "aws:userid": managementUserId } } };
  // An older unconditional create lock is not a valid pre-grant baseline.
  if (doc.Statement.filter(x => equal(x, wrongSession)).length !== 1 ||
    doc.Statement.some(x => x.Sid?.startsWith("Fc41597fVersion") || x.Sid === "Fc41597fManagementCreateLockedUntilReviewed") ||
    boundaryDoc.Statement.some(x => x.Sid?.startsWith("Fc41597fVersion"))) return fail();
  const allowed = (Sid: string, Action: string, Resource: string, extra: Record<string, string> = {}, roleArn?: string) => ({
    Sid, Effect: "Allow", Action, Resource, Condition: { StringEquals: { ...bySession, ...extra }, ...byWindow,
      ...(roleArn && { ArnEquals: { "cloudformation:RoleArn": roleArn } }) },
  });
  const allows = [
    allowed("Fc41597fVersionRead", "s3:GetObjectVersion", object, { "s3:VersionId": scope.versionId }),
    allowed("Fc41597fVersionCreate", create, stack, { "aws:RequestedRegion": s.region, "cloudformation:TemplateUrl": scope.templateURL },
      scope.executionRoleArn),
    allowed("Fc41597fVersionDescribe", describe, stack, { "aws:RequestedRegion": s.region }),
    allowed("Fc41597fVersionPass", pass, scope.executionRoleArn, { "iam:PassedToService": "cloudformation.amazonaws.com" }),
  ];
  // Denies remain explicit for missing/wrong versions and other targets,
  // even if another identity/resource policy could otherwise allow them.
  const deny = (name: string, Action: string | string[], target: { Resource: string } | { NotResource: string },
    condition: Record<string, unknown> = {}) => ({ Sid: "Fc41597fVersion" + name, Effect: "Deny", Action, ...target,
    Condition: { StringEquals: issuer, ...condition } });
  const wrong = (key: string, value: string) => ({ StringNotEquals: { [key]: value } });
  const cfnWrites = [create, describe];
  doc.Statement.push(...allows,
    deny("NoCurrent", "s3:GetObject", { Resource: object }),
    deny("WrongVersion", "s3:GetObjectVersion", { Resource: object }, wrong("s3:VersionId", scope.versionId)),
    deny("OtherStack", cfnWrites, { NotResource: stack }),
    deny("OtherTemplate", create, { Resource: stack }, wrong("cloudformation:TemplateUrl", scope.templateURL)),
    deny("OtherExecutionRole", create, { Resource: stack }, { ArnNotEquals: { "cloudformation:RoleArn": scope.executionRoleArn } }),
    deny("OtherPassRole", pass, { NotResource: scope.executionRoleArn }),
    deny("OtherService", pass, { Resource: scope.executionRoleArn }, wrong("iam:PassedToService", "cloudformation.amazonaws.com")),
    ...Object.entries({ Early: { DateLessThan: byWindow.DateGreaterThanEquals }, Expired: { DateGreaterThanEquals: byWindow.DateLessThan } })
      .flatMap(([name, when]) => [deny(name + "Read", "s3:GetObjectVersion", { Resource: object }, when),
        deny(name + "Submit", [...cfnWrites, pass], { Resource: "*" }, when)]));
  boundaryDoc.Statement.push(...structuredClone(allows));
  if (JSON.stringify(doc).length > 10_240 || JSON.stringify(boundaryDoc).length > 6_144) return fail();
  return { grant, relock, grantSha256: await sha256Hex(grant), relockSha256: preGrantSha256,
    changedResources: FIRST_OPEN_AUTHORITY_RESOURCES, executionAuthorized: false as const };
}

/** Exact predicates for the separately approved actual first-open grant, NOT
 * an activation target. The version and its independent proof do not exist
 * during this installation; neither runtime role may install this fragment. */
export function projectFirstOpenExactVersionAuthority(input: {
  approvalSha256: string; versionId: string; independentProofSha256: string;
}) {
  const { approvalSha256, versionId, independentProofSha256 } = input;
  const hex = /^[a-f0-9]{64}$/;
  if (![approvalSha256, independentProofSha256].every(x => hex.test(x)) || !validFirstOpenVersionId(versionId)) return fail();
  const { bucket } = FIRST_OPEN_BASELINE_BINDING;
  const key = `first-open-management/${s.jobId}/${approvalSha256}/cfn-template.json`;
  const object = `arn:aws:s3:::${bucket}/${key}`;
  const url = `https://${bucket}.s3.${s.region}.amazonaws.com/${key}?versionId=${encodeURIComponent(versionId)}`;
  if (url.length > 1024) return fail();
  const stack = `arn:aws:cloudformation:${s.region}:${s.account}:stack/${SANDBOX_FIRST_OPEN_STACK}/*`;
  const as = <T extends Record<string, string>>(user: string, extra: T) => ({ StringEquals: { "aws:userid": user, ...extra } });
  return { executionAuthorized: false, independentProofSha256, authorPut: {
    Action: "s3:PutObject", Resource: object, Condition: as(authorUserId, { "s3:if-none-match": "*", "s3:x-amz-server-side-encryption": "AES256" }),
  }, managementVersionRead: { Action: "s3:GetObjectVersion", Resource: object, Condition: as(managementUserId, { "s3:VersionId": versionId }) },
  managementCreate: { Action: "cloudformation:CreateStack", Resource: stack, Condition: {
    ...as(managementUserId, { "cloudformation:TemplateUrl": url }), ArnEquals: { "cloudformation:RoleArn": s.cfnRole },
  } }, managementPassRole: { Action: "iam:PassRole", Resource: s.cfnRole,
    Condition: as(managementUserId, { "iam:PassedToService": "cloudformation.amazonaws.com" }) } };
}

/** Render exact review targets only. Installation does not create the template
 * object or activate either first-open session. The CreateStack Denies stay. */
export async function renderFirstOpenInstallPolicyTargets(input: {
  lockedShared: Template; lockedBucket: Template; permit: FirstOpenCleanupPermit; permitSha256: string;
}) {
  const { lockedShared, lockedBucket } = input;
  if (await sha256Hex(lockedShared) !== lockedSharedSha || await sha256Hex(lockedBucket) !== lockedBucketSha) return fail();
  const v = await checkFirstOpenCleanupPermit(input.permit, input.permitSha256, input.permit.startAt);
  const shared = structuredClone(lockedShared), bucket = structuredClone(lockedBucket);
  const policy = bucket.Resources.EvidencePolicy.Properties.PolicyDocument as PolicyDocument;
  const i = policy.Statement.findIndex(x => x.Sid === "Fc41597fTemplateOnlyManagementMayPut");
  if (i < 0) return fail();
  const old = policy.Statement[i];
  policy.Statement[i] = { ...old, Sid: "Fc41597fTemplateOnlyRunOnceMayPut", Condition: { StringNotEquals: { "aws:userid": authorUserId } } };
  policy.Statement.push({ Sid: "Fc41597fManagementNoCurrentTemplateRead", Effect: "Deny", Principal: "*", Action: "s3:GetObject",
    Resource: old.Resource, Condition: { StringEquals: { "aws:userid": managementUserId } } });

  const relocked = structuredClone(shared);
  const blocked = (extra: Record<string, unknown> = {}) => ({ StringEquals: { "aws:userid": cleanupUserId }, ...extra });
  const relockRole = relocked.Resources.TenantLifecycleTaskRole.Properties as RoleProperties;
  relockRole.Policies.push({ PolicyName: "FirstOpenFc41597fCleanupVerify",
    PolicyDocument: { Version: "2012-10-17", Statement: [{ Sid: "CleanupSessionRelocked", Effect: "Deny",
      Action: "*", Resource: "*", Condition: blocked() }] } });
  const role = shared.Resources.TenantLifecycleTaskRole;
  const props = role.Properties as RoleProperties;
  const start = { "aws:CurrentTime": iso(v.startAt) }, issue = { "aws:CurrentTime": iso(v.issueBefore) }, end = { "aws:CurrentTime": iso(v.verifyBefore) };
  const cleanupTrust = { Sid: "Fc41597fProtectedCleanupVerifyOnly", Effect: "Allow", Principal: { Federated: provider },
    Action: "sts:AssumeRoleWithWebIdentity", Condition: {
      StringEquals: { ...firstOpenCleanupPermitClaims(v), "sts:RoleSessionName": "first-open-fc41597f-cleanup-g1" },
      DateGreaterThanEquals: start, DateLessThan: issue,
    } };
  const allow = { Sid: "CleanupOnlyExactLogin", Effect: "Allow", Action: "rds-db:connect", Resource: cleanupResource,
    Condition: blocked({ DateGreaterThanEquals: start, DateLessThan: end }) };
  props.AssumeRolePolicyDocument.Statement.push(cleanupTrust);
  props.Policies.push({ PolicyName: "FirstOpenFc41597fCleanupVerify", PolicyDocument: { Version: "2012-10-17", Statement: [
    allow,
    { Sid: "CleanupDenyOtherAwsActions", Effect: "Deny", NotAction: "rds-db:connect", Resource: "*", Condition: blocked() },
    { Sid: "CleanupDenyOtherLogins", Effect: "Deny", Action: "rds-db:connect", NotResource: cleanupResource, Condition: blocked() },
    { Sid: "CleanupDenyBeforeWindow", Effect: "Deny", Action: "*", Resource: "*", Condition: blocked({ DateLessThan: start }) },
    { Sid: "CleanupDenyAtCutoff", Effect: "Deny", Action: "*", Resource: "*", Condition: blocked({ DateGreaterThanEquals: end }) },
  ] } });
  // Attach a copy of the full old boundary plus the one discriminated allow
  // to Lifecycle only. The shared policy resource, its C4e paths and all
  // legacy role statements remain byte-equivalent under canonical encoding.
  if (canonicalJson(props.PermissionsBoundary) !== canonicalJson({ Ref: "ServiceRoleBoundary" }) ||
    Object.hasOwn(shared.Resources, "FirstOpenFc41597fLifecycleBoundary")) return fail();
  const oldBoundary = structuredClone(shared.Resources.ServiceRoleBoundary.Properties.PolicyDocument) as PolicyDocument;
  // Compact the copy only: IAM statement names do not affect evaluation;
  // the original 6 KB shared boundary is never edited or reattached elsewhere.
  oldBoundary.Statement.forEach(statement => { delete statement.Sid; });
  oldBoundary.Statement.push(allow);
  shared.Resources.FirstOpenFc41597fLifecycleBoundary = { Type: "AWS::IAM::ManagedPolicy", ...(role.Condition ? { Condition: role.Condition } : {}),
    Properties: { ManagedPolicyName: "TechlongSandboxFirstOpenFc41597fLifecycleBoundary", PolicyDocument: oldBoundary } };
  props.PermissionsBoundary = { Ref: "FirstOpenFc41597fLifecycleBoundary" };
  if (canonicalJson(oldBoundary).replace(/\s/g, "").length > 6_144 ||
    props.Policies.reduce((sum, p) => sum + canonicalJson(p.PolicyDocument).replace(/\s/g, "").length, 0) > 10_240 ||
    canonicalJson(props.AssumeRolePolicyDocument).replace(/\s/g, "").length > 2_048) return fail();
  // The evidence-bucket guards remain installed on relock; they grant no
  // identity rights and preserve version protections for eventual audit.
  return { activeForCleanupOnly: { shared, bucket }, relock: { shared: relocked, bucket: structuredClone(bucket) },
    firstOpenGrantsActive: false, executionAuthorized: false };
}
