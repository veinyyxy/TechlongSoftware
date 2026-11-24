import { SANDBOX_FIRST_OPEN as s } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { sandboxFirstOpenClaimDdl } from "../../lib/deployments/execution/first-onboarding-claim-entry.ts";
import { firstOnboardingCompletionDdl } from "../../lib/deployments/execution/first-onboarding-completion-entry.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { FIRST_OPEN_MIDDLE_ROLES, firstOpenMiddleOperationHash } from "../../lib/deployments/execution/first-onboarding-middle.ts";
import { verifyFirstOpenTaskRelease } from "../../lib/deployments/execution/first-onboarding-version.ts";
import { FIRST_OPEN_MANAGEMENT_SQL_USER } from "../../lib/deployments/execution/aurora-express-bootstrap-v3.ts";
import { firstOpenBuyerBinding } from "../../lib/deployments/execution/first-open-buyer-binding.ts";
import { isFirstOpenBuyerSignerPin, type FirstOpenBuyerSignerPin } from "../../lib/buyer-forward/signer-binding.ts";
import { sandboxFirstOpenMiddleDdl } from "./first-onboarding-middle-ddl.ts";
import { firstOpenManagementBucket, firstOpenManagementKeys } from "./first-open-management-bridge.ts";
import { firstOpenManagementReusablePath, type FirstOpenFrozenRelease } from "./first-open-release-entry.ts";
import { firstOpenProvisionerFederationStatus, firstOpenProvisionerSessionName,
  projectFirstOpenWriterWriteAuthority } from "./scripts/first-open-lifecycle-iam-delta.mjs";
import oidc from "./first-open-fc41597f-oidc-handoffs.prepared.json" with { type: "json" };
import probe from "./first-open-fc41597f-session-deltas.prepared.json" with { type: "json" };
import locked from "./first-open-fc41597f-lifecycle-iam-alignment.prepared.json" with { type: "json" };
import prepared from "./first-open-fc41597f-remaining-install.prepared.json" with { type: "json" };

const repo = "veinyyxy/TechlongSoftware", provider = oidc.federatedTrust.existingProviderArn;
const managerRole = oidc.federatedTrust.runOnce.targets[1], writerRole = oidc.federatedTrust.runOnce.targets[0];
const managerName = locked.isolation.sessionName;
const oidcKey = "token.actions.githubusercontent.com:job_workflow_ref";
const managementConnect = `arn:aws:rds-db:${s.region}:${s.account}:dbuser:${s.clusterId}/${FIRST_OPEN_MANAGEMENT_SQL_USER}`;
const iso = (n: number) => new Date(n).toISOString();
const scoped = (roleId: string, name: string) => ({ "aws:userid": `${roleId}:${name}`, "aws:FederatedProvider": provider });
const managerSession = scoped(managerRole.roleId, managerName), writerSession = scoped(writerRole.roleId, firstOpenProvisionerSessionName);
const boundTo = (session: Record<string, string>, deadline: number) =>
  ({ StringEquals: session, DateLessThan: { "aws:CurrentTime": iso(deadline) } });

/** Returns deltas, never Change Sets or executable approval. Do not mount the
 * previously proposed RunOnce-to-Lifecycle trust alongside this management trust. */
export function firstOpenManagementIamDraft(release: FirstOpenFrozenRelease, buyerSigner?: FirstOpenBuyerSignerPin) {
  const { approvalSha256, startAt, claimBefore, applicationLoginBefore, writeBefore } = release;
  if (release.jobId !== s.jobId || release.actorId !== "14145707" || !/^[a-f0-9]{64}$/.test(approvalSha256) ||
    ![release.managementReusableCommit, release.runOnceReusableCommit, release.inspectReusableCommit].every(c => /^[a-f0-9]{40}$/.test(c)) ||
    ![startAt, claimBefore, applicationLoginBefore, writeBefore].every(Number.isSafeInteger) ||
    !(0 < startAt && startAt < claimBefore && claimBefore < applicationLoginBefore && applicationLoginBefore <= writeBefore &&
      writeBefore - startAt <= 3_600_000)) throw Error("FIRST_OPEN_MANAGEMENT_INSTALL_SCOPE");
  if (buyerSigner !== undefined && !isFirstOpenBuyerSignerPin(buyerSigner)) throw Error("FIRST_OPEN_MANAGEMENT_BUYER_SIGNER_PIN");

  const trust = (path: string, commit: string, name: string, Sid: string) => ({
    Sid, Effect: "Allow", Principal: { Federated: provider }, Action: "sts:AssumeRoleWithWebIdentity",
    Condition: {
      StringEquals: { ...oidc.federatedTrust.commonClaims, "token.actions.githubusercontent.com:actor_id": release.actorId,
        [oidcKey]: `${repo}/${path}@${commit}`, "sts:RoleSessionName": name },
      DateGreaterThanEquals: { "aws:CurrentTime": iso(startAt) }, DateLessThan: { "aws:CurrentTime": iso(claimBefore) },
    },
  });
  const scope = firstOpenManagementKeys(approvalSha256, release.taskRelease !== undefined);
  const resource = (key: string) => `arn:aws:s3:::${firstOpenManagementBucket}/${key}`;
  const requests = scope.request.map(resource), replies = scope.reply.map(resource);
  const first = resource(scope.request[0].replace(/1\.json$/, "*.json")), second = resource(scope.reply[0].replace(/0\.json$/, "*.json"));
  const paths = [first, second];
  const allow = (Sid: string, Action: string, Resource: string | string[], Condition: object) => ({ Sid, Effect: "Allow", Action, Resource, Condition });
  const directions = (id: string, writes: string[], reads: string[], session: Record<string, string>) => [
    allow(`FirstOpen${id}Write`, "s3:PutObject", writes, {
      ...boundTo(session, writeBefore),
      StringEquals: { ...session, "s3:if-none-match": "*", "s3:x-amz-server-side-encryption": "AES256" },
    }),
    allow(`FirstOpen${id}Read`, "s3:GetObject", reads, boundTo(session, writeBefore)),
  ];
  const pinVersions = Object.values(FIRST_OPEN_BASELINE_BINDING.objects).map(({ key, versionId }, i) =>
    allow("FirstOpenBaselineVersion" + i, "s3:GetObjectVersion", resource(key), {
      ...boundTo(managerSession, writeBefore), StringEquals: { ...managerSession, "s3:VersionId": versionId },
    }));
  const grantManager = [
    ...directions("Manager", [second], [first], managerSession),
    ...pinVersions,
    allow("FirstOpenManagerDbConnect", "rds-db:connect", managementConnect, boundTo(managerSession, writeBefore)),
    allow("FirstOpenManagerProbe", "sts:AssumeRole", s.applicationRole, {
      StringEquals: { ...managerSession, "sts:RoleSessionName": probe.applicationProbe.sessionName },
      DateLessThan: { "aws:CurrentTime": iso(claimBefore) },
    }),
  ];
  const reservedWriter = {
    status: firstOpenProvisionerFederationStatus,
    roleArn: writerRole.roleArn, roleId: writerRole.roleId, roleSessionName: firstOpenProvisionerSessionName, writeBefore,
  } as const;
  const writerFederation = {
    ...reservedWriter,
    writeAuthorityProposal: projectFirstOpenWriterWriteAuthority(reservedWriter, startAt),
    // Inventory only. These are the protected writer's calls, not policy allows;
    // the baseline, Aurora connection and post-create sampling use other roles.
    requiredAws: {
      identity: ["sts:GetCallerIdentity"],
      mailbox: ["s3:GetObject", "s3:PutObject"],
      cellReadback: ["cloudformation:DescribeStacks", "elasticloadbalancing:DescribeListeners", "elasticloadbalancing:DescribeRules",
        "elasticloadbalancing:DescribeTrustStores", "elasticloadbalancing:DescribeLoadBalancers", "rds:DescribeDBClusters"],
      authority: ["dynamodb:GetItem", "dynamodb:PutItem"],
      generationSecret: ["secretsmanager:DescribeSecret", "secretsmanager:CreateSecret", "secretsmanager:TagResource"],
      buyerSigner: ["secretsmanager:GetSecretValue"],
      tenantStack: ["cloudformation:DescribeStacks"],
      templateWrite: ["s3:PutObject"],
    },
    blockers: [
      "EXACT_AUTHORITY_STACK_SECRET_AND_MAILBOX_ENFORCEMENT_NOT_PROVED",
      "CELL_DESCRIBE_IAM_RESOURCE_SCOPE_OR_NARROW_EXCEPTION_NOT_APPROVED",
      "CURRENT_WRITER_SESSION_CONTEXT_EFFECTIVE_POLICY_AND_REVOCATION_NOT_PROVED",
    ],
    // A fixed version is necessary, but supplies no effective read grant.
    buyerSigner: buyerSigner === undefined ? null : { arn: buyerSigner.arn, versionId: buyerSigner.versionId, readBefore: claimBefore },
  } as const;
  // These denials are applied to the shared lifecycle role only. Federation
  // issuer is carried in the downstream context; the reusable ref is not.
  const managerFederated = { "aws:FederatedProvider": provider };
  const deny = (Sid: string, fields: object, Condition: object) => ({ Sid, Effect: "Deny", ...fields, Condition });
  const restrictManager = [
    deny("FirstOpenNoFederatedLifecycleOtherActions", { NotAction: ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "rds-db:connect", "sts:GetCallerIdentity", "sts:AssumeRole"], Resource: "*" },
      { StringEquals: managerFederated }),
    deny("FirstOpenNoFederatedLifecycleOtherDb", { Action: "rds-db:connect", NotResource: managementConnect }, { StringEquals: managerFederated }),
    deny("FirstOpenNoFederatedLifecycleOtherProbe", { Action: "sts:AssumeRole", NotResource: s.applicationRole }, { StringEquals: managerFederated }),
    deny("FirstOpenNoFederatedLifecycleOtherPut", { Action: "s3:PutObject", NotResource: second }, { StringEquals: managerFederated }),
    deny("FirstOpenNoFederatedLifecycleOtherRead", { Action: "s3:GetObject", NotResource: first }, { StringEquals: managerFederated }),
    deny("FirstOpenNoFederatedLifecycleOtherVersion", { Action: "s3:GetObjectVersion", NotResource: Object.values(FIRST_OPEN_BASELINE_BINDING.objects).map(o => resource(o.key)) },
      { StringEquals: managerFederated }),
    deny("FirstOpenNoFederatedLifecycleWrongName", { Action: "*", Resource: "*" },
      { StringEquals: managerFederated, StringNotEquals: { "aws:userid": managerSession["aws:userid"] } }),
    deny("FirstOpenNoFederatedLifecycleAfterWindow", { Action: "*", Resource: "*" },
      { StringEquals: managerFederated, DateGreaterThanEquals: { "aws:CurrentTime": iso(writeBefore) } }),
  ];
  const objectPolicy = [
    ...([["Request", first, writerSession], ["Reply", second, managerSession]] as const).flatMap(([name, path, session]) =>
      Object.entries(session).map(([key, value], index) =>
        deny(`FirstOpen${name}WrongWriter${index}`, { Principal: "*", Action: "s3:PutObject", Resource: path }, {
          StringNotEquals: { [key]: value },
        }))),
    deny("FirstOpenMailboxNoOverwrite", { Principal: "*", Action: "s3:PutObject", Resource: paths }, { StringNotEquals: { "s3:if-none-match": "*" } }),
    { Sid: "FirstOpenMailboxNoDelete", Effect: "Deny", Principal: "*", Action: ["s3:DeleteObject", "s3:DeleteObjectVersion"], Resource: paths },
  ];
  return {
    status: "LOCKED_DRAFT_NOT_AN_EXECUTION_APPROVAL",
    writerFederation,
    shared: {
      lifecycleTrustAppend: trust(firstOpenManagementReusablePath, release.managementReusableCommit, managerName, "FirstOpenManagementOnlyOidc"),
      // Only when activating this package, replace the two provisional DB locks
      // with the narrower fenced grant/denials above. Retain both C4e and both Secret denials.
      draftLifecycleDbLocksToReplace: ["FirstOpenLockDatabaseBySessionId", "FirstOpenLockDatabaseByOidcSubject"],
      lifecyclePolicyAppend: [...grantManager, ...restrictManager],
      // Shared ServiceRoleBoundary is already too large to hold these grants.
      // Project its legacy behavior into a boundary for this existing role.
      dedicatedLifecycleBoundaryAllowAppend: grantManager,
    },
    mailboxBucketPolicyDenyAppend: objectPolicy,
    identities: {
      inspectorTrustAppend: trust(oidc.federatedTrust.inspect.reusablePathCandidate, release.inspectReusableCommit, "first-open-fc41597f-inspector-g1", "FirstOpenInspectorOnlyOidc"),
      // Application starts with an explicit Deny on sts:AssumeRole; appending
      // an Allow would have no effect. The exact compiled replacement must
      // revert to that sentinel when the temporary probe path closes.
      applicationProbeLockedTrustReplacement: {
        Sid: "FirstOpenProbeFromIsolatedManager", Effect: "Allow", Principal: { AWS: s.lifecycleRole }, Action: "sts:AssumeRole",
        Condition: grantManager.at(-1)!.Condition,
      },
      inspectorTargetConnect: allow("FirstOpenInspectorDbConnect", "rds-db:connect", probe.inspector.awsConnectResource,
        boundTo(scoped(probe.inspector.awsRoleId, "first-open-fc41597f-inspector-g1"), writeBefore)),
      // Keeps the old target-side no-S3, wrong-DB and cutoff protections.
      applicationProbeDenyAppend: probe.applicationProbe.targetSessionDenyDeltas.map(statement =>
        JSON.parse(JSON.stringify(statement).replaceAll("BIND_FROM_APPROVED_SESSION_ACCESS_CUTOFF", iso(applicationLoginBefore))) as unknown),
    },
    requests, replies, maxUploads: requests.length + replies.length,
  };
}

/** Compile the existing three transactions around the same approval SHA. The
 * manager's boolean read is part of the claim schema, not a new privileged login. */
export async function firstOpenManagementNeonDraft(
  input: Parameters<typeof sandboxFirstOpenClaimDdl>[0], repositorySource: string,
) {
  const { planSha256, configurationSha256 } = prepared.scope;
  if (input.taskRelease !== undefined) await verifyFirstOpenTaskRelease(input.taskRelease);
  const expectedProvisionOperationSha256 = input.taskRelease === undefined ? prepared.scope.expectedProvisionOperationSha256 :
    await firstOpenMiddleOperationHash(input);
  if (input.planHash !== planSha256 || input.configurationHash !== configurationSha256 ||
    (input.managementOperationSha256 !== undefined && input.managementOperationSha256 !== expectedProvisionOperationSha256)) {
    throw Error("FIRST_OPEN_MANAGEMENT_NEON_SCOPE");
  }
  const roles = prepared.portBinding.neon;
  return {
    roles: { existingNoLogin: 6, new: FIRST_OPEN_MIDDLE_ROLES, runtimeLogins: roles.runtimeLogins },
    claim: sandboxFirstOpenClaimDdl({ ...input, managementOperationSha256: expectedProvisionOperationSha256 }),
    middle: await sandboxFirstOpenMiddleDdl(input, repositorySource),
    completion: firstOnboardingCompletionDdl({ jobId: s.jobId, deploymentId: s.deploymentId, instanceId: s.instanceId,
      approvalSha256: input.approvalSha256, writeBefore: input.writeBefore, buyerOrigin: firstOpenBuyerBinding.buyerOrigin,
      taskRelease: input.taskRelease }, {
      definer: roles.definerRoles[2], writer: roles.runtimeLogins.completion, reader: roles.runtimeLogins.inspection,
    }),
  };
}
