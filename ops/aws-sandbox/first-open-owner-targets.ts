import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { SANDBOX_FIRST_OPEN as scope } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { isFirstOpenBuyerSignerPin, type FirstOpenBuyerSignerPin } from "../../lib/buyer-forward/signer-binding.ts";
import { hash as templateSha256 } from "../temporary-idle/environment-cfn.mjs";
import { firstOpenManagementIamDraft } from "./first-open-management-install.ts";
import { firstOpenInspectorReadStatements, firstOpenInspectorAuthorityReadStatements,
  type FirstOpenInspectorReadConsent, type FirstOpenInspectorAuthorityReadConsent } from "./first-open-inspector-iam.ts";
import type { FirstOpenFrozenRelease } from "./first-open-release-entry.ts";
import { renderIsolatedFirstOpenSharedIam } from "./scripts/first-open-lifecycle-iam-delta.mjs";
import { renderFirstOpenProvisionerTargets } from "./first-open-provisioner-policy.ts";
import { firstOpenInstallInspectorPolicies, type FirstOpenInstallStagingScope, type FirstOpenInstallWindow } from "./first-open-install-inspector-scope.ts";

const prefix = "arn:aws:cloudformation:ca-central-1:402010193138:stack/";
const originals = {
  shared: {
    id: prefix + "techlong-s3-bootstrap/8afbe1e0-9425-11f1-b06a-02ff648cb917",
    canonicalSha256: "5027c73de759e5ca8e753e3bc7735a46b6b77b7f4bf4358752733fee93994360",
  },
  identities: {
    id: prefix + "techlong-sandbox-first-open-fc41597f-identities/483fa2e0-e42c-11f1-b49f-02ffcd94927f",
    canonicalSha256: "6a839ad4197b009028fa00ba29c9387d68bd23c3017aeabefe242a1e46b41096",
  },
  mailbox: {
    id: prefix + "techlong-sandbox-cloud-worker-foundation-v5/308174f0-ca9e-11f1-a04d-02569e9287b5",
    canonicalSha256: "a2133a1b68792fe124bc0c816ca920baa28751f2f278057f495524d08593bcf6",
  },
} as const;
const historicalLifecycleSha256 = "a88d3046ae1ac3ff13354744c1b063d95f5c68de6a9c36b85f86a41e606876ee";
const hex64 = /^[a-f0-9]{64}$/;
const hex40 = /^[a-f0-9]{40}$/;
const id = /^[1-9][0-9]{0,19}$/;
const lock = { Effect: "Deny", Principal: { AWS: "*" }, Action: "sts:AssumeRole" };
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

type Resource = { Type: string; Properties: Record<string, unknown> };
type Template = { Resources: Record<string, Resource> } & Record<string, unknown>;
type Snapshot = { stackId: string; template: Template };
type Policy = { Version: string; Statement: Record<string, unknown>[] };
type Change = { logicalId: string; action: "Modify"; replacement: false }
  | { logicalId: string; action: "Add" };
type OwnerSnapshots = Record<keyof typeof originals, Snapshot>;
type ApplicationDelta = ReturnType<typeof firstOpenManagementIamDraft>["identities"];
type ApplicationTrustMode = "ecs-continuation";

const appRoleChange = Object.freeze({ logicalId: "ApplicationRole", action: "Modify", replacement: false } as const);
const appPermissionsChange = Object.freeze({ logicalId: "ApplicationPermissions", action: "Modify", replacement: false } as const);
const inspectorRoleChange = Object.freeze({ logicalId: "LockedInspectorRole", action: "Modify", replacement: false } as const);
const installObserverPolicyName = "FirstOpenFc41597fInstallReadOnly";

function statements(doc: unknown): Policy {
  const p = doc as Policy | undefined;
  if (!p || p.Version !== "2012-10-17" || !Array.isArray(p.Statement)) {
    throw Error("FIRST_OPEN_OWNER_TARGETS_POLICY_SHAPE");
  }
  return p;
}

function append(target: Policy, incoming: readonly unknown[], maxBytes: number) {
  if (!incoming.every((x): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x))) {
    throw Error("FIRST_OPEN_OWNER_TARGETS_POLICY_SHAPE");
  }
  const entries = [...target.Statement, ...structuredClone(incoming)];
  const sids = entries.map(x => x.Sid).filter(x => x !== undefined);
  if (new Set(sids).size !== sids.length ||
    Buffer.byteLength(JSON.stringify({ ...target, Statement: entries })) > maxBytes) {
    throw Error("FIRST_OPEN_OWNER_TARGETS_POLICY_LIMIT");
  }
  target.Statement = entries;
}

/** These five reviewed actions authorize only their service's own exact ARN
 * type (stack, DB cluster, secret, bucket, repository). With identical
 * conditions, collecting the disjoint namespaces preserves native IAM
 * action/resource pairs. Never fold wildcard, tagged or authority reads. */
export function compactFirstOpenFormalInspectorMetadata(input: readonly Record<string, unknown>[]) {
  const request = [
    ["FirstOpenReadRelatedStacks", "cloudformation:DescribeStacks", [scope.cellStack, scope.platformStack]],
    ["FirstOpenReadAuroraMetadata", "rds:DescribeDBClusters", [scope.clusterArn]],
    ["FirstOpenReadControlSecretMetadata", "secretsmanager:DescribeSecret", [scope.controlArn]],
    ["FirstOpenHeadExactPersistenceBucket", "s3:ListBucket", [`arn:aws:s3:::${scope.bucket}`]],
    ["FirstOpenReadBackendRepoManifest", "ecr:BatchGetImage", [
      `arn:aws:ecr:${scope.region}:${scope.account}:repository/${scope.imageRepository.split("amazonaws.com/")[1]}`,
    ]],
  ] as const;
  const members = request.map(([Sid, Action, Resource]) => {
    const hits = input.filter(s => s.Sid === Sid), row = hits[0];
    if (hits.length !== 1 || row.Effect !== "Allow" || row.Action !== Action || !same([row.Resource].flat(), Resource) ||
      Object.keys(row).sort().join() !== "Action,Condition,Effect,Resource,Sid" ||
      !row.Condition || typeof row.Condition !== "object" || Array.isArray(row.Condition)) {
      throw Error("FIRST_OPEN_INSPECTOR_COMPACT_SCOPE");
    }
    return row;
  });
  const Condition = members[0].Condition;
  if (!members.every(s => same(s.Condition, Condition))) throw Error("FIRST_OPEN_INSPECTOR_COMPACT_SCOPE");
  const merged = { Sid: "ReadExactRegional", Effect: "Allow", Action: request.map(([, action]) => action),
    Resource: request.flatMap(([, , resources]): readonly string[] => resources), Condition: structuredClone(Condition) };
  return input.flatMap(s => s === members[0] ? [merged] : members.includes(s) ? [] : [s]);
}

function target(source: Snapshot, template: Template, changes: readonly Change[]) {
  const original = source.template;
  const { Resources: oldResources, ...oldHeader } = original;
  const { Resources: newResources, ...newHeader } = template;
  const expected = Object.fromEntries(changes.map(x => [x.logicalId, x.action]));
  const actual = Object.fromEntries(Object.entries(newResources).flatMap(([key, current]) =>
    !Object.hasOwn(oldResources, key) ? [[key, "Add"]] : same(oldResources[key], current) ? [] : [[key, "Modify"]]));
  if (!same(oldHeader, newHeader) || !same(expected, actual) || Object.keys(oldResources).some(key =>
    !Object.hasOwn(newResources, key) || oldResources[key].Type !== newResources[key].Type)) {
    throw Error("FIRST_OPEN_OWNER_TARGETS_UNSCOPED_CHANGE");
  }
  return { stackId: source.stackId, originalCanonicalSha256: templateSha256(original),
    targetCanonicalSha256: templateSha256(template), template, expectedChanges: changes };
}

function installObserverInline(Statement: Record<string, unknown>[]) {
  const p: Policy = { Version: "2012-10-17", Statement: [] };
  append(p, Statement, 10240);
  return { PolicyName: installObserverPolicyName, PolicyDocument: p };
}

/** Independent install observer proposal, on the existing identities stack
 * only. Keep the reserved-session Deny on relock to fence unexpired STS.
 * No writer or normal Inspect trust is enabled by either target. */
export async function compileFirstOpenInstallInspectorTargets(input: {
  original: Snapshot; release: FirstOpenFrozenRelease; releaseSha256: string;
  window: FirstOpenInstallWindow; approvedScopeSha256: string; staging?: FirstOpenInstallStagingScope;
}, now = Date.now()) {
  const { original, release, releaseSha256, window, approvedScopeSha256, staging } = structuredClone(input);
  if (original.stackId !== originals.identities.id || templateSha256(original.template) !== originals.identities.canonicalSha256 ||
    !Number.isSafeInteger(now) || now >= window.startAt) throw Error("FIRST_OPEN_INSTALL_INSPECTOR_ORIGINAL_OR_WINDOW");
  const policy = await firstOpenInstallInspectorPolicies(release, releaseSha256, window, approvedScopeSha256, staging);
  const grant = structuredClone(original.template), relock = structuredClone(original.template);
  const props = grant.Resources.LockedInspectorRole.Properties, trust = statements(props.AssumeRolePolicyDocument);
  if (!same(trust.Statement, [lock]) || Object.hasOwn(props, "Policies")) throw Error("FIRST_OPEN_INSTALL_INSPECTOR_ORIGINAL_OR_WINDOW");
  append(trust, [policy.trust], 2048);
  grant.Resources.LockedInspectorRole.Properties.Policies = [installObserverInline(policy.active)];
  relock.Resources.LockedInspectorRole.Properties.Policies = [installObserverInline(policy.relock)];
  return { executionAuthorized: false as const, approvedScopeSha256,
    grant: target(original, grant, [inspectorRoleChange]),
    relock: target({ stackId: original.stackId, template: grant }, relock, [inspectorRoleChange]) };
}

/** Bind a future formal target to the actual closed Observer Original. The
 * observed digest must come from the approved operator's terminal readback;
 * this pure comparison cannot observe it or treat a draft as installed. */
export async function matchFirstOpenInstallObserverRelock(input: { original: Snapshot; release: FirstOpenFrozenRelease;
  releaseSha256: string; window: FirstOpenInstallWindow; approvedScopeSha256: string; observedOriginalSha256: string; staging?: FirstOpenInstallStagingScope }) {
  const { original, release, releaseSha256, window, approvedScopeSha256, observedOriginalSha256, staging } = structuredClone(input);
  const stop = () => { throw Error("FIRST_OPEN_INSTALL_INSPECTOR_RELOCK_PREIMAGE"); };
  if (original.stackId !== originals.identities.id || !hex64.test(observedOriginalSha256) ||
    templateSha256(original.template) !== observedOriginalSha256) return stop();
  const policy = await firstOpenInstallInspectorPolicies(release, releaseSha256, window, approvedScopeSha256, staging);
  const props = original.template.Resources.LockedInspectorRole?.Properties;
  const expected = installObserverInline(policy.relock);
  if (!props || !same(props.Policies, [expected])) return stop();
  delete props.Policies;
  if (templateSha256(original.template) !== originals.identities.canonicalSha256) return stop();
  return expected;
}

function renderApplicationIdentity(source: Snapshot, delta: ApplicationDelta, mode?: ApplicationTrustMode,
  observerRelock?: ReturnType<typeof installObserverInline>) {
  const template = structuredClone(source.template);
  const { ApplicationRole, ApplicationPermissions, LockedInspectorRole } = template.Resources;
  const appTrust = statements(ApplicationRole.Properties.AssumeRolePolicyDocument);
  const inspectorTrust = statements(LockedInspectorRole.Properties.AssumeRolePolicyDocument);
  if (!same(appTrust.Statement, [lock]) || !same(inspectorTrust.Statement, [lock]) || (observerRelock
    ? !same(LockedInspectorRole.Properties.Policies, [observerRelock])
    : Object.hasOwn(LockedInspectorRole.Properties, "Policies"))) {
    throw Error("FIRST_OPEN_OWNER_TARGETS_IDENTITY_PREIMAGE");
  }
  const relockTrust = structuredClone(appTrust);
  if (mode === "ecs-continuation") {
    // This is the trust shape already used by the sandbox ECS task roles. ECS
    // SourceArn is account/region-wide, not a cluster or task-ARN restriction.
    relockTrust.Statement = [{
      Effect: "Allow", Principal: { Service: "ecs-tasks.amazonaws.com" }, Action: "sts:AssumeRole",
      Condition: {
        StringEquals: { "aws:SourceAccount": scope.account },
        ArnLike: { "aws:SourceArn": `arn:aws:ecs:${scope.region}:${scope.account}:*` },
      },
    }];
  }
  // The original blanket Deny would override both intended Allows. Unlisted
  // principals are still implicitly denied; the Management Allow is fenced.
  appTrust.Statement = [];
  append(appTrust, [delta.applicationProbeLockedTrustReplacement,
    ...(mode === "ecs-continuation" ? relockTrust.Statement : [])], 2048);
  append(statements(ApplicationPermissions.Properties.PolicyDocument), delta.applicationProbeDenyAppend, 6144);
  return { template, inspectorTrust, applicationProbeRelock: {
    logicalId: "ApplicationRole" as const, assumeRolePolicyDocument: relockTrust,
    retainSessionDeniesUntilLastIssuedSessionExpired: true as const,
  } };
}

function ecsContinuation(active: Snapshot, trust: Policy) {
  const relocked = structuredClone(active.template);
  relocked.Resources.ApplicationRole.Properties.AssumeRolePolicyDocument = structuredClone(trust);
  return {
    // This draft neither grants nor proves PassRole. The exact effective
    // CloudFormation role, service and targets still need independent review.
    requiredCfnPassRoleReadback: { roleArn: scope.cfnRole, action: "iam:PassRole" as const,
      resourceArns: [scope.executionRole, scope.applicationRole], passedToService: "ecs-tasks.amazonaws.com" as const },
    probeRelock: target(active, relocked, [appRoleChange]),
  };
}

/** Render only this job's application activation and post-probe identity
 * targets from the sealed identities Original. No other owner or live proof
 * is consumed here; the full owner compiler still checks all of its pins. */
export function renderFirstOpenEcsApplicationIdentityDraft(source: Snapshot, release: FirstOpenFrozenRelease) {
  if (source.stackId !== originals.identities.id || templateSha256(source.template) !== originals.identities.canonicalSha256) {
    throw Error("FIRST_OPEN_OWNER_TARGETS_ORIGINAL_IDENTITIES");
  }
  const { template, applicationProbeRelock } = renderApplicationIdentity(source, firstOpenManagementIamDraft(release).identities,
    "ecs-continuation");
  return {
    executionAuthorized: false as const, executionApprovalSha256: null,
    activation: target(source, template, [appRoleChange, appPermissionsChange]),
    applicationProbeRelock,
    ...ecsContinuation({ stackId: source.stackId, template }, applicationProbeRelock.assumeRolePolicyDocument),
  };
}

/** Compile review bodies only. Caller-supplied bytes must match both the
 * sealed owner Originals and a separately approved future release. This
 * compiler does not confer authority to submit a Change Set or open a window. */
export async function compileFirstOpenOwnerTargets(input: {
  originals: OwnerSnapshots;
  historicalLifecycle: Policy;
  release: FirstOpenFrozenRelease;
  approvedReleaseSha256: string;
  signer: FirstOpenBuyerSignerPin;
  inspectorReadConsent?: FirstOpenInspectorReadConsent;
  inspectorAuthorityReadConsent?: FirstOpenInspectorAuthorityReadConsent;
  installObserverRelock?: { window: FirstOpenInstallWindow; approvedScopeSha256: string; observedOriginalSha256: string; staging?: FirstOpenInstallStagingScope };
  prepareScopedProvisioner?: true;
  applicationTrustMode?: ApplicationTrustMode;
}, now = Date.now()) {
  const { originals: source, historicalLifecycle, release, approvedReleaseSha256, signer, inspectorReadConsent, inspectorAuthorityReadConsent,
    prepareScopedProvisioner, applicationTrustMode, installObserverRelock } = structuredClone(input);
  const phaseTimes = release.phaseCutoffs;
  const check = [
    release.startAt, release.claimBefore, release.applicationLoginBefore, release.writeBefore, release.completionReserveMs,
    ...(Array.isArray(phaseTimes) ? phaseTimes : []),
  ];
  if (release.schema !== "techlong/sandbox-first-open-release/v1" || !hex64.test(approvedReleaseSha256) ||
    ![release.approvalSha256, release.runtimeSourceSha256, release.inspectorSeedSha256].every(x => hex64.test(x)) ||
    ![release.callerCommit, release.runtimeCommit, release.runOnceReusableCommit, release.inspectReusableCommit,
      release.managementReusableCommit].every(x => hex40.test(x)) ||
    !id.test(release.workflowId) || !/^[a-f0-9]{32}$/.test(release.nonce) ||
    !Number.isSafeInteger(now) || now < 0 || !Array.isArray(phaseTimes) || phaseTimes.length !== 5 ||
    !check.every(Number.isSafeInteger) || release.claimBefore <= now || release.completionReserveMs <= 0 ||
    phaseTimes.some((at, i) => at <= (i ? phaseTimes[i - 1] : release.startAt)) ||
    phaseTimes[0] > release.claimBefore || phaseTimes[2] >= release.applicationLoginBefore ||
    phaseTimes[4] > release.writeBefore - release.completionReserveMs ||
    await sha256Hex(release) !== approvedReleaseSha256 || !isFirstOpenBuyerSignerPin(signer)) {
    throw Error("FIRST_OPEN_OWNER_TARGETS_RELEASE_PIN");
  }
  if (applicationTrustMode !== undefined && applicationTrustMode !== "ecs-continuation") {
    throw Error("FIRST_OPEN_OWNER_TARGETS_APPLICATION_TRUST_MODE");
  }
  for (const name of ["shared", "identities", "mailbox"] as const) {
    if (source[name]?.stackId !== originals[name].id ||
      (name !== "identities" || !installObserverRelock) && templateSha256(source[name].template) !== originals[name].canonicalSha256) {
      throw Error("FIRST_OPEN_OWNER_TARGETS_ORIGINAL_" + name.toUpperCase());
    }
  }
  const observer = installObserverRelock && await matchFirstOpenInstallObserverRelock({ original: source.identities, release,
    releaseSha256: approvedReleaseSha256, window: installObserverRelock.window,
    approvedScopeSha256: installObserverRelock.approvedScopeSha256, observedOriginalSha256: installObserverRelock.observedOriginalSha256,
    staging: installObserverRelock.staging });
  if (templateSha256(historicalLifecycle) !== historicalLifecycleSha256) {
    throw Error("FIRST_OPEN_OWNER_TARGETS_LIFECYCLE_PREIMAGE");
  }
  const delta = firstOpenManagementIamDraft(release, signer);
  const { template: shared, bytes: sharedPolicySizes, writerFederation } =
    renderIsolatedFirstOpenSharedIam(source.shared.template, historicalLifecycle, delta) as {
      template: Template; bytes: { lifecycleBoundary: number; provisionerBoundary: number; lifecycleInline: number };
      writerFederation: ReturnType<typeof firstOpenManagementIamDraft>["writerFederation"];
    };

  const { template: identities, inspectorTrust, applicationProbeRelock } = renderApplicationIdentity(source.identities,
    delta.identities, applicationTrustMode, observer);
  const { LockedInspectorRole } = identities.Resources;
  const { status: inspectorMetadataStatus, expected: inspectorReadScope, statements: inspectorMetadataStatements } =
    await firstOpenInspectorReadStatements(release, approvedReleaseSha256, inspectorReadConsent);
  if (inspectorAuthorityReadConsent && inspectorMetadataStatus !== "EXACT_DRAFT_SCOPE_BOUND_NOT_INSTALLED") {
    throw Error("FIRST_OPEN_INSPECTOR_ORIGINAL_READ_CONSENT_REQUIRED");
  }
  if (inspectorMetadataStatus === "EXACT_DRAFT_SCOPE_BOUND_NOT_INSTALLED") {
    append(inspectorTrust, [delta.identities.inspectorTrustAppend], 2048);
    const inspectorPolicy = { Version: "2012-10-17", Statement: [structuredClone(delta.identities.inspectorTargetConnect)] } as Policy;
    append(inspectorPolicy, inspectorAuthorityReadConsent ? compactFirstOpenFormalInspectorMetadata(inspectorMetadataStatements) :
      inspectorMetadataStatements, 10240);
    if (inspectorAuthorityReadConsent) append(inspectorPolicy,
      await firstOpenInspectorAuthorityReadStatements(release, approvedReleaseSha256, inspectorAuthorityReadConsent), 10240);
    const policies = [...(observer ? [observer] : []), { PolicyName: "FirstOpenFc41597fExactInspectorReadOnly", PolicyDocument: inspectorPolicy }];
    if (policies.reduce((n, p) => n + Buffer.byteLength(JSON.stringify(p.PolicyDocument)), 0) > 10_240) {
      throw Error("FIRST_OPEN_OWNER_TARGETS_POLICY_LIMIT");
    }
    LockedInspectorRole.Properties.Policies = policies;
  }
  const inspectorAuthorityRelock = inspectorAuthorityReadConsent && structuredClone(identities);
  if (inspectorAuthorityRelock) inspectorAuthorityRelock.Resources.LockedInspectorRole =
    structuredClone(source.identities.template.Resources.LockedInspectorRole);

  const mailbox = structuredClone(source.mailbox.template);
  const bucketPolicy = mailbox.Resources.EvidencePolicy;
  if (bucketPolicy.Type !== "AWS::S3::BucketPolicy" || !same(bucketPolicy.Properties.Bucket, { Ref: "EvidenceBucket" })) {
    throw Error("FIRST_OPEN_OWNER_TARGETS_BUCKET_PREIMAGE");
  }
  const requestAlias = delta.requests[0].replace(/1\.json$/, "*.json");
  const replyAlias = delta.replies[0].replace(/0\.json$/, "*.json");
  // Use the same fixed slot keys as the two writer-specific grants rather
  // than installing a wildcard deny over other keys in this approval prefix.
  const exactSlotArns = (alias: string) => {
    if (alias === requestAlias) return delta.requests;
    if (alias === replyAlias) return delta.replies;
    throw Error("FIRST_OPEN_OWNER_TARGETS_MAILBOX_SLOT");
  };
  const mailboxDenies = delta.mailboxBucketPolicyDenyAppend.map(s => {
    if (!("Resource" in s)) throw Error("FIRST_OPEN_OWNER_TARGETS_MAILBOX_SLOT");
    return { ...s, Resource: [s.Resource].flat().flatMap(exactSlotArns) };
  });
  append(statements(bucketPolicy.Properties.PolicyDocument), mailboxDenies, 20 * 1024);

  if (prepareScopedProvisioner !== undefined && (prepareScopedProvisioner !== true || !inspectorAuthorityReadConsent)) {
    throw Error("FIRST_OPEN_PROVISIONER_INDEPENDENT_READ_SCOPE_REQUIRED");
  }
  const provisioner = prepareScopedProvisioner ? await renderFirstOpenProvisionerTargets(shared, await sha256Hex(shared), release, signer) : undefined;
  return {
    executionAuthorized: false as const,
    executionApprovalSha256: null,
    approvedReleaseSha256,
    writerFederation,
    inspectorMetadataStatus,
    inspectorReadScope,
    ...(provisioner && { provisioner: {
      ...provisioner,
      grantTarget: target({ stackId: source.shared.stackId, template: shared }, provisioner.grant, provisioner.changes),
      // The Current Original must first match this grant target again
      // after Lifecycle has independently relocked. Do not reorder.
      relockTarget: target({ stackId: source.shared.stackId, template: provisioner.grant }, provisioner.restore, provisioner.changes),
      relockRequiresCanonicalPreimageSha256: provisioner.grantSha256,
    } }),
    ...(inspectorAuthorityRelock && { inspectorAuthorityRelock: target({ stackId: source.identities.stackId, template: identities },
      inspectorAuthorityRelock, [inspectorRoleChange]) }),
    useOnlyWithThisLaunchWindow: { startAt: release.startAt, claimBefore: release.claimBefore, writeBefore: release.writeBefore },
    shared: target(source.shared, shared, [
      { logicalId: "FirstOpenFc41597fLifecycleBoundary", action: "Add" },
      { logicalId: "TenantLifecycleTaskRole", action: "Modify", replacement: false },
      { logicalId: "ProvisionerRole", action: "Modify", replacement: false },
    ]),
    identities: target(source.identities, identities, [
      appRoleChange,
      appPermissionsChange,
      ...(inspectorMetadataStatus === "EXACT_DRAFT_SCOPE_BOUND_NOT_INSTALLED" ?
        [{ logicalId: "LockedInspectorRole", action: "Modify" as const, replacement: false as const }] : []),
    ]),
    mailbox: target(source.mailbox, mailbox, [
      { logicalId: "EvidencePolicy", action: "Modify", replacement: false },
    ]),
    // Close only the probe in ECS mode; legacy callers still get the original
    // lock. In either case keep explicit denies for issued probe sessions.
    applicationProbeRelock,
    ...(applicationTrustMode === "ecs-continuation" ? {
      applicationEcsContinuation: ecsContinuation({ stackId: source.identities.stackId, template: identities },
        applicationProbeRelock.assumeRolePolicyDocument),
    } : {}),
    sharedPolicySizes,
  };
}
