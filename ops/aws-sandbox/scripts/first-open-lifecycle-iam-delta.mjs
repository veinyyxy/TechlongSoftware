import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

const ROLE = "TenantLifecycleTaskRole";
const POLICY = "ImmutableReceiptsAndGenerationSecretRead";
const roleId = "AROAV3GNMXTZDIWVT3BKN";
export const firstOpenLifecycleSessionName = "first-open-fc41597f-lifecycle-g1";
export const firstOpenProvisionerSessionName = "first-open-fc41597f-provisioner-g1";
export const firstOpenProvisionerFederationStatus = "BLOCKED_NO_PROVED_EFFECTIVE_WRITER_SCOPE";
const provisionerRoleName = "TechlongSandboxProvisionerRole";
const provisionerRoleArn = "arn:aws:iam::402010193138:role/" + provisionerRoleName;
const provisionerRoleId = "AROAV3GNMXTZMEBX7MOF7";
const legacyProvisionerSessionName = "techlong-sandbox-provisioner";
const provisionerUserId = `${provisionerRoleId}:${firstOpenProvisionerSessionName}`;
const writerRegion = "ca-central-1", writerAccount = "402010193138";
const tenant = Object.freeze({
  appInstanceId: "app_bbd626d7d3806af686073211", deploymentId: "dep_746535593025bf97a9efeccd",
  stableIdentity: "e9fdccd5d8c7685cb005f423e7a87fc5849163882f4e2f3ca066f2c51cd9e74a",
  stackName: "techlong-sandbox-tenant-d3806af686073211",
  secretName: "techlong/sandbox/tenant/appbbd626d7d3806af686073211_e9fdccd5d8/runtime/g1",
});
const subject = "repo:veinyyxy@14145707/TechlongSoftware@1323312747:environment:techlong-sandbox-deploy";
const priorTemplateSha256 = "5027c73de759e5ca8e753e3bc7735a46b6b77b7f4bf4358752733fee93994360";
const declaredPolicySha256 = "a49a6343396c4c7ebe465a8bec2a9f3d7e8e5981049d6cc93c049a2e8d47148b";
const observedPolicySha256 = "a88d3046ae1ac3ff13354744c1b063d95f5c68de6a9c36b85f86a41e606876ee";
const assert = (ok, code) => { if (!ok) throw Error("FIRST_OPEN_LIFECYCLE_" + code); };
const sorted = v => Array.isArray(v) ? v.map(sorted) : v !== null && typeof v === "object"
  ? Object.fromEntries(Object.keys(v).sort().map(key => [key, sorted(v[key])])) : v;
const digest = v => createHash("sha256").update(JSON.stringify(sorted(v))).digest("hex");
const property = "/Resources/" + ROLE + "/Properties/Policies/0/PolicyDocument";
const writerDeadline = fence => {
  assert(fence?.status === firstOpenProvisionerFederationStatus && fence.roleArn === provisionerRoleArn &&
    fence.roleId === provisionerRoleId && fence.roleSessionName === firstOpenProvisionerSessionName &&
    Number.isSafeInteger(fence.writeBefore) && fence.writeBefore > 0 && fence.writeBefore < 253402300800000, "WRITER_FENCE_SCOPE");
  return fence.writeBefore;
};

/** Lock only the future first-open context. No trust or new Allow.
 * Neither selector is assumed proven live; approval must first prove them
 * and tie the authenticated issuer to the exact reserved session name. */
export function firstOpenLifecycleLockedDenies() {
  const deny = (Sid, Action, key, value) => ({
    Sid, Effect: "Deny", Action, Resource: "*", Condition: { StringEquals: { [key]: value } },
  });
  const uid = roleId + ":" + firstOpenLifecycleSessionName;
  const subKey = "token.actions.githubusercontent.com:sub";
  const secretActions = ["secretsmanager:GetSecretValue", "secretsmanager:BatchGetSecretValue"];
  return [
    deny("FirstOpenDenySecretBySessionId", [...secretActions], "aws:userid", uid),
    deny("FirstOpenDenySecretByOidcSubject", [...secretActions], subKey, subject),
    deny("FirstOpenLockDatabaseBySessionId", "rds-db:connect", "aws:userid", uid),
    deny("FirstOpenLockDatabaseByOidcSubject", "rds-db:connect", subKey, subject),
  ];
}

/** Same role and boundary, preserving all six effective statements exactly.
 * Inputs are the sealed Current Original and historic independently observed
 * Lifecycle document, not reconstructed action/ARN snippets. */
export function renderFirstOpenLifecycleLockedAlignment(original, historicalLifecycle) {
  assert(digest(original) === priorTemplateSha256, "ORIGINAL");
  assert(digest(historicalLifecycle) === observedPolicySha256, "HISTORICAL_POLICY");
  const oldRole = original.Resources?.[ROLE], oldInline = oldRole?.Properties?.Policies?.[0];
  assert(oldRole?.Type === "AWS::IAM::Role" && oldRole.Properties.Policies.length === 1 && oldInline?.PolicyName === POLICY &&
    oldRole.Properties.PermissionsBoundary?.Ref === "ServiceRoleBoundary" &&
    digest(oldInline.PolicyDocument) === declaredPolicySha256, "DECLARATION");
  const declared = oldInline.PolicyDocument;
  const { Statement: old, ...header } = declared;
  const { Statement: historical, ...historicalHeader } = historicalLifecycle;
  assert(old.length === 4 && historical.length === 6 && isDeepStrictEqual(header, historicalHeader) &&
    isDeepStrictEqual(old, historical.slice(0, 4)), "OLD_STATEMENTS");
  const move = historical.slice(4), deny = firstOpenLifecycleLockedDenies();
  assert(isDeepStrictEqual(move.map(s => [s.Sid, s.Effect, s.Action]),
    [["C4eMgmtConnect", "Allow", "rds-db:connect"], ["C4eSecretRead", "Allow", "secretsmanager:GetSecretValue"]]), "C4E_SCOPE");
  const template = structuredClone(original), role = template.Resources[ROLE];
  const compiled = role.Properties.Policies[0].PolicyDocument;
  compiled.Statement.push(...structuredClone([...move, ...deny]));
  const sids = compiled.Statement.map(s => s.Sid).filter(Boolean);
  assert(new Set(sids).size === sids.length, "SID_COLLISION");
  assert(digest({ ...compiled, Statement: compiled.Statement.slice(0, 6) }) === observedPolicySha256, "LIVE_ALLOW_DRIFT");
  const inlineBytes = Buffer.byteLength(JSON.stringify(compiled));
  assert(inlineBytes <= 10240, "INLINE_SIZE");
  const restored = structuredClone(template);
  restored.Resources[ROLE].Properties.Policies[0].PolicyDocument = structuredClone(declared);
  assert(isDeepStrictEqual(restored, original), "UNSCOPED_CHANGE");
  return {
    template,
    patch: [
      { op: "test", path: property, value: structuredClone(declared) },
      ...structuredClone([...move, ...deny]).map(value => ({ op: "add", path: property + "/Statement/-", value })),
    ],
    review: {
      expectedStackDiff: [{ logicalId: ROLE, action: "Modify", replacement: false }],
      inlinePolicy: POLICY, inlineBytes, observedPolicySha256, candidateInlineSha256: digest(compiled),
      candidateTemplateSha256: digest(template), c4ePreserved: move.map(s => s.Sid),
      newDenies: deny.map(s => s.Sid), trustChanged: false, boundaryChanged: false,
      opensFirstOpenDatabaseLogin: false, permitsNewAssumption: false, executionApprovalSha256: null,
    },
  };
}

/** Only the reserved future AWS userId can match, even if the provider/subject
 * context keys are absent on a service call. The legacy identity can assume
 * the role only with its original, different MFA session name. This candidate
 * deliberately does not add federated trust or any writer permissions. */
export function renderFirstOpenLockedProvisioner(originalRole, fence) {
  const props = originalRole?.Properties, trust = props?.AssumeRolePolicyDocument;
  const [legacy] = Array.isArray(trust?.Statement) ? trust.Statement : [];
  assert(originalRole?.Type === "AWS::IAM::Role" && props?.RoleName === provisionerRoleName &&
    isDeepStrictEqual(props.PermissionsBoundary, { Ref: "ProvisionerBoundary" }) &&
    isDeepStrictEqual(props.ManagedPolicyArns, [{ Ref: "ProvisionerBoundary" }]) && !Object.hasOwn(props, "Policies") &&
    trust?.Version === "2012-10-17" && trust.Statement?.length === 1 && legacy?.Effect === "Allow" && legacy.Action === "sts:AssumeRole" &&
    (isDeepStrictEqual(legacy.Principal, { AWS: { Ref: "ProvisionerPrincipalArn" } }) ||
      isDeepStrictEqual(legacy.Principal, { AWS: "arn:aws:iam::402010193138:user/techlong-sandbox-dev" })) &&
    isDeepStrictEqual(legacy.Condition, { Bool: { "aws:MultiFactorAuthPresent": "true" },
      StringEquals: { "sts:RoleSessionName": legacyProvisionerSessionName } }), "WRITER_ORIGINAL_TRUST");
  const writeBefore = writerDeadline(fence);

  const deny = (Sid, extra = {}) => ({ Sid, Effect: "Deny", Action: "*", Resource: "*", Condition: {
    StringEquals: { "aws:userid": provisionerUserId }, ...extra,
  } });
  const PolicyDocument = { Version: "2012-10-17", Statement: [
    // The write cutoff is an independent guard for the reserved session. A
    // later scoped install would have to retain it; no such install is emitted.
    deny("FirstOpenFc41597fWriterAfterWindow", { DateGreaterThanEquals: { "aws:CurrentTime": new Date(writeBefore).toISOString() } }),
    deny("FirstOpenFc41597fWriterLocked"),
  ] };
  const role = structuredClone(originalRole);
  role.Properties.Policies = [{ PolicyName: "FirstOpenFc41597fWriterLock", PolicyDocument }];
  return role;
}

/** Review only: exact IAM-addressable write coordinates. These predicates
 * are not a policy document or a permission to activate the writer. In
 * particular they can't assert DynamoDB's CAS expression or the actual
 * request body accepted by Secrets Manager or CloudFormation. */
export function projectFirstOpenWriterWriteAuthority(fence, startAt) {
  const writeBefore = writerDeadline(fence);
  assert(Number.isSafeInteger(startAt) && 0 < startAt && startAt < writeBefore && writeBefore - startAt <= 3_600_000,
    "WRITER_AUTHORITY_WINDOW");
  const scope = { "aws:userid": provisionerUserId, "aws:RequestedRegion": writerRegion };
  const dates = {
    DateGreaterThanEquals: { "aws:CurrentTime": new Date(startAt).toISOString() },
    DateLessThan: { "aws:CurrentTime": new Date(writeBefore).toISOString() },
  };
  const arn = service => `arn:aws:${service}:${writerRegion}:${writerAccount}:`;
  const attributes = ["authority_key", "schema_version", "revision", "record_json"];
  const tags = { ManagedBy: "techlong-sandbox", SecretSchema: "techlong-runtime-four-key-v2", DatabaseProfile: "express_iam",
    ResourceGeneration: "1", StableIdentity: tenant.stableIdentity, AppInstanceId: tenant.appInstanceId, DeploymentId: tenant.deploymentId,
    OwnershipMarker: `tl_owner_${tenant.stableIdentity.slice(0, 32)}_g1` };
  const tagConditions = {
    StringEquals: { ...scope, ...Object.fromEntries(Object.entries(tags).map(([key, value]) => [`aws:RequestTag/${key}`, value])) },
    "ForAllValues:StringEquals": { "aws:TagKeys": Object.keys(tags) }, Null: { "aws:TagKeys": "false" }, ...dates,
  };
  return {
    status: firstOpenProvisionerFederationStatus, executableApprovalSha256: null,
    dynamoDb: {
      Action: "dynamodb:PutItem", Resource: arn("dynamodb") + "table/techlong-sandbox-tenant-external-epoch-authority",
      Condition: { StringEquals: scope, "ForAllValues:StringEquals": {
        "dynamodb:LeadingKeys": ["tenant:" + tenant.stableIdentity], "dynamodb:Attributes": attributes,
      }, Null: { "dynamodb:LeadingKeys": "false", "dynamodb:Attributes": "false" }, ...dates },
      // IAM does not require the caller to supply attribute_not_exists or
      // validate the JSON record; keep the reviewed CAS code as another gate.
      cannotEnforceCompareAndSwapBody: true,
    },
    generationSecret: {
      status: "BLOCKED_TAG_ON_CREATE_AUTH_AND_REQUEST_LIMITS_NOT_PROVED",
      Action: "secretsmanager:CreateSecret", Resource: arn("secretsmanager") + `secret:${tenant.secretName}-??????`,
      Condition: { ...tagConditions, StringEquals: { ...tagConditions.StringEquals, "secretsmanager:Name": tenant.secretName },
        Null: { ...tagConditions.Null, "secretsmanager:AddReplicaRegions": "true", "secretsmanager:KmsKeyId": "true" } },
      // Existing tagged-create precedent includes a separate TagResource
      // decision. Until reviewed, don't emit a direct retagging permission.
      dependentAction: "secretsmanager:TagResource", cannotEnforceInitialTokenOrPayload: true,
    },
    cloudFormation: {
      status: "BLOCKED_NO_IMMUTABLE_TEMPLATE_AND_DELEGATED_ROLE_PROOF",
      createAction: "cloudformation:CreateStack", passRoleAction: "iam:PassRole", passedToService: "cloudformation.amazonaws.com",
      stackArnPattern: arn("cloudformation") + `stack/${tenant.stackName}/*`,
      executionRoleArn: `arn:aws:iam::${writerAccount}:role/TechlongSandboxCloudFormationExecutionRole`,
      // TemplateBody and caller-supplied Parameters cannot be pinned with
      // this key. The concrete g1 ARN does not exist at pre-launch seal time.
      templateUrlConditionKey: "cloudformation:TemplateUrl", immutableTemplateUrl: null,
      requiresProvedParameterAndServiceRoleEnforcement: true,
    },
  };
}

/** Once an actual activation exists, a separate review can verify its live
 * preimage and use these exact replacement resources. No activation/revoke
 * submission or claim of effective withdrawal is part of this renderer. */
export function renderFirstOpenWriterRevokeTargets(original, fence) {
  assert(digest(original) === priorTemplateSha256, "ORIGINAL");
  const resources = original.Resources;
  return {
    status: "DRAFT_RESTORE_ORIGINAL_WRITER_AUTHORITY_NOT_APPLIED", executableApprovalSha256: null,
    requiresIndependentlyMatchedActivePreimage: true,
    retainReservedSessionDeniesUntilLastIssuedSessionExpires: true,
    resources: {
      ProvisionerRole: renderFirstOpenLockedProvisioner(resources.ProvisionerRole, fence),
      ProvisionerBoundary: structuredClone(resources.ProvisionerBoundary),
    },
  };
}

/** Construct the shared-IAM candidate from the same sealed originals. The
 * global boundary remains unchanged; only this role is attached to a bounded
 * projection that preserves all old effective actions/denies. Never applies. */
export function renderIsolatedFirstOpenSharedIam(original, historicalLifecycle, draft) {
  const { template } = renderFirstOpenLifecycleLockedAlignment(original, historicalLifecycle);
  const append = draft.shared, role = template.Resources[ROLE], props = role.Properties;
  assert(draft.status === "LOCKED_DRAFT_NOT_AN_EXECUTION_APPROVAL" && !props.ManagedPolicyArns?.length &&
    props.AssumeRolePolicyDocument.Statement.length === 1 &&
    props.AssumeRolePolicyDocument.Statement[0].Principal.Service === "ecs-tasks.amazonaws.com", "MANAGEMENT_ORIGINAL_TRUST");
  const legacy = historicalLifecycle.Statement.flatMap(s => [s.Action].flat());
  assert(legacy.every(a => typeof a === "string" && !/[*?]/.test(a)), "MANAGEMENT_LEGACY_ACTION");
  const legacySet = new Set(legacy);
  const oldBoundary = original.Resources.ServiceRoleBoundary.Properties.PolicyDocument;
  const legacyBoundary = oldBoundary.Statement.flatMap(s => {
    if (s.Effect === "Deny") return [structuredClone(s)];
    assert(s.Effect === "Allow" && s.Action && !s.NotAction, "MANAGEMENT_BOUNDARY_UNSUPPORTED");
    const types = [s.Action].flat();
    assert(types.every(a => typeof a === "string" && !/[*?]/.test(a)), "MANAGEMENT_BOUNDARY_WILDCARD");
    const actions = types.filter(a => legacySet.has(a));
    return actions.length ? [{ ...structuredClone(s), Action: actions }] : [];
  });
  const boundaryId = "FirstOpenFc41597fLifecycleBoundary";
  const size = p => Buffer.byteLength(JSON.stringify(p));
  assert(!template.Resources[boundaryId], "MANAGEMENT_BOUNDARY_COLLISION");
  const lifecycleBoundary = { ...oldBoundary, Statement: [...legacyBoundary, ...structuredClone(append.dedicatedLifecycleBoundaryAllowAppend)] };
  const inline = props.Policies[0].PolicyDocument;
  const removed = append.draftLifecycleDbLocksToReplace;
  assert(isDeepStrictEqual(removed, ["FirstOpenLockDatabaseBySessionId", "FirstOpenLockDatabaseByOidcSubject"]), "MANAGEMENT_LOCKS_CHANGED");
  inline.Statement = [...inline.Statement.filter(s => !removed.includes(s.Sid)), ...structuredClone(append.lifecyclePolicyAppend)];
  assert(digest({ ...inline, Statement: inline.Statement.slice(0, 6) }) === observedPolicySha256, "MANAGEMENT_LEGACY_DRIFT");
  assert(isDeepStrictEqual(inline.Statement.slice(6, 8), firstOpenLifecycleLockedDenies().slice(0, 2)), "MANAGEMENT_SECRET_DENIAL_DRIFT");
  template.Resources[boundaryId] = { Type: "AWS::IAM::ManagedPolicy", Condition: role.Condition,
    Properties: { ManagedPolicyName: "TechlongSandboxFirstOpenFc41597fLifecycleBoundary", PolicyDocument: lifecycleBoundary } };
  props.PermissionsBoundary = { Ref: boundaryId };
  props.AssumeRolePolicyDocument.Statement.push(structuredClone(append.lifecycleTrustAppend));
  const writerFederation = structuredClone(draft.writerFederation);
  const provisioner = renderFirstOpenLockedProvisioner(template.Resources.ProvisionerRole, writerFederation);
  template.Resources.ProvisionerRole = provisioner;
  const provisionerBoundary = template.Resources.ProvisionerBoundary.Properties.PolicyDocument;
  const bytes = { lifecycleBoundary: size(lifecycleBoundary), provisionerBoundary: size(provisionerBoundary), lifecycleInline: size(inline),
    provisionerInline: size(provisioner.Properties.Policies[0].PolicyDocument) };
  assert(bytes.lifecycleBoundary <= 6144 && bytes.provisionerBoundary <= 6144 &&
    bytes.lifecycleInline <= 10240 && bytes.provisionerInline <= 10240, "MANAGEMENT_POLICY_SIZE");
  return { template, bytes, writerFederation, executableApprovalSha256: null };
}
