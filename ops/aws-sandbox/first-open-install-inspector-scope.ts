import { sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { SANDBOX_FIRST_OPEN as s } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { verifyFirstOpenTaskRelease } from "../../lib/deployments/execution/first-onboarding-version.ts";
import { firstOpenInspectorAuthorityReadScope } from "./first-open-inspector-iam.ts";
import { firstOpenOwnerStageKey, firstOpenSharedPredecessorChangeSetName } from "./first-open-owner-stage-proof.ts";
import { firstOpenProvisionerChangeSetName } from "./first-open-provisioner-lanes.ts";
import type { FirstOpenFrozenRelease } from "./first-open-release-entry.ts";
import contract from "./first-open-fc41597f-oidc-handoffs.prepared.json" with { type: "json" };

export const firstOpenInstallInspectorSession = "first-open-fc41597f-install-readback";
export const firstOpenInstallProvisionerLane = "install" as const;
export const firstOpenInstallProvisionerObservation = "techlong/fc41597f-install-provisioner-observation/v1" as const;
export { firstOpenSharedPredecessorChangeSetName };
export type FirstOpenInstallWindow = { startAt: number; issueBefore: number; grantAt: number; grantBefore: number;
  relockAt: number; relockBefore: number; factsCutoff: number };
type Stage = "grant" | "relock" | "shared";
type StageTarget = { targetCanonicalSha256: string; targetBytes: number };
export type FirstOpenInstallStagingScope = { readBefore: number; targets: Partial<Record<Stage, StageTarget>>;
  sharedObservation?: { at: number; before: number } };
const fail = (): never => { throw Error("FIRST_OPEN_INSTALL_INSPECTOR_SCOPE"); };
const provider = contract.federatedTrust.existingProviderArn;
const iso = (at: number) => ({ "aws:CurrentTime": new Date(at).toISOString() });
const versionRead = "s3:GetObjectVersion";
const phases = { grant: "provisioner-grant", relock: "provisioner-relock", shared: "shared-predecessor" } as const;
const stages = ["grant", "relock", "shared"] as const;

function compileStagingScope(approvalSha256: string, window: FirstOpenInstallWindow, staging: FirstOpenInstallStagingScope) {
  if (!staging || typeof staging !== "object" || Array.isArray(staging) ||
    !Number.isSafeInteger(staging.readBefore) || !(window.startAt < staging.readBefore && staging.readBefore < window.grantAt) ||
    !staging.targets || typeof staging.targets !== "object" || Array.isArray(staging.targets)) return fail();
  const shared = Object.hasOwn(staging.targets, "shared"), observation = staging.sharedObservation;
  if (Object.keys(staging).sort().join(",") !== (shared ? "readBefore,sharedObservation,targets" : "readBefore,targets") ||
    (shared && (!observation || typeof observation !== "object" || Array.isArray(observation) ||
      Object.keys(observation).sort().join(",") !== "at,before" || ![observation.at, observation.before].every(Number.isSafeInteger) ||
      !(staging.readBefore < observation.at && observation.at < observation.before && observation.before < window.grantAt)))) return fail();
  const names = Object.keys(staging.targets);
  if (names.length === 0 || names.some(name => !Object.hasOwn(phases, name))) return fail();
  const targets: Partial<Record<Stage, StageTarget & { key: string }>> = {};
  for (const stage of stages) {
    if (!Object.hasOwn(staging.targets, stage)) continue;
    const target = staging.targets[stage];
    if (!target || typeof target !== "object" || Array.isArray(target) || Object.keys(target).sort().join(",") !== "targetBytes,targetCanonicalSha256" ||
      !Number.isSafeInteger(target.targetBytes) || target.targetBytes <= 51_200 || target.targetBytes > 1_048_576 ||
      typeof target.targetCanonicalSha256 !== "string" || !/^[a-f0-9]{64}$/.test(target.targetCanonicalSha256)) return fail();
    const { targetCanonicalSha256, targetBytes } = target;
    const key = firstOpenOwnerStageKey({ approvalSha256, phase: phases[stage], targetCanonicalSha256 });
    targets[stage] = { targetCanonicalSha256, targetBytes, key };
  }
  return { readBefore: staging.readBefore, targets,
    ...(shared && observation ? { sharedObservation: { at: observation.at, before: observation.before,
      changeSetName: firstOpenSharedPredecessorChangeSetName(approvalSha256) } } : {}) };
}

export function firstOpenInstallProvisionerChangeSetName(approvalSha256: string, phase: "grant" | "relock") {
  return firstOpenProvisionerChangeSetName(approvalSha256, firstOpenInstallProvisionerLane, phase);
}

export function isFirstOpenInstallProvisionerChangeSetId(changeSetId: string, exactName: string) {
  const stem = `arn:aws:cloudformation:${s.region}:${s.account}:changeSet/${exactName}/`;
  return typeof changeSetId === "string" && changeSetId.startsWith(stem) &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(changeSetId.slice(stem.length));
}

export async function firstOpenInstallInspectorScope(release: FirstOpenFrozenRelease, releaseSha256: string, window: FirstOpenInstallWindow,
  staging?: FirstOpenInstallStagingScope) {
  const { startAt, issueBefore, grantAt, grantBefore, relockAt, relockBefore, factsCutoff } = window;
  const times = [startAt, issueBefore, grantAt, grantBefore, relockAt, relockBefore, factsCutoff, release.startAt];
  if (release.schema !== "techlong/sandbox-first-open-release/v1" || release.jobId !== s.jobId || release.actorId !== "14145707" || !release.taskRelease ||
    !/^[a-f0-9]{64}$/.test(release.approvalSha256) || !/^[a-f0-9]{40}$/.test(release.inspectReusableCommit) ||
    !times.every(Number.isSafeInteger) || !(0 < startAt && startAt < issueBefore && issueBefore <= grantAt &&
      grantAt < grantBefore && grantBefore <= relockAt && relockAt < relockBefore &&
      relockBefore <= factsCutoff && relockBefore <= release.startAt && relockBefore - startAt <= 3_300_000) ||
    await sha256Hex(release) !== releaseSha256) return fail();
  await verifyFirstOpenTaskRelease(release.taskRelease);
  const original = firstOpenInspectorAuthorityReadScope(release, releaseSha256);
  return {
    schema: "techlong/fc41597f-install-inspector-scope/v2", lane: firstOpenInstallProvisionerLane,
    releaseSha256, jobId: s.jobId, window: structuredClone(window),
    roleArn: original.roleArn, roleId: original.roleId, roleSessionName: firstOpenInstallInspectorSession,
    provider, roleToRead: original.roles[0], boundaryToRead: original.boundaries[0],
    evidenceBucketArn: original.evidenceBucketArn, ownerStackArn: original.ownerStackArn,
    changeSetNames: [firstOpenInstallProvisionerChangeSetName(release.approvalSha256, "grant"),
      firstOpenInstallProvisionerChangeSetName(release.approvalSha256, "relock")],
    reusableRef: `veinyyxy/TechlongSoftware/${contract.federatedTrust.inspect.reusablePathCandidate}@${release.inspectReusableCommit}`,
    ...(staging === undefined ? {} : { staging: compileStagingScope(release.approvalSha256, window, staging) }),
  };
}

/** Intended for the separately reviewed existing Inspector owner stack. Does
 * not mutate it and does not grant any of the formal Inspector capabilities. */
export async function firstOpenInstallInspectorPolicies(release: FirstOpenFrozenRelease, releaseSha256: string,
  window: FirstOpenInstallWindow, approvedScopeSha256: string, staging?: FirstOpenInstallStagingScope) {
  const scope = await firstOpenInstallInspectorScope(release, releaseSha256, window, staging);
  if (await sha256Hex(scope) !== approvedScopeSha256) return fail();
  const user = { "aws:userid": `${scope.roleId}:${scope.roleSessionName}` };
  const allow = (Action: string[], Resource: string | string[], exact: Record<string, string | string[]> = {}, before = window.relockBefore) => ({
    Effect: "Allow" as const, Action, Resource, Condition: {
      StringEquals: { ...user, "aws:FederatedProvider": scope.provider, ...exact },
      DateGreaterThanEquals: iso(window.startAt), DateLessThan: iso(before),
    },
  });
  const regional = { "aws:RequestedRegion": s.region };
  const sharedObservation = scope.staging?.sharedObservation;
  const changeSetNames = sharedObservation ? [...scope.changeSetNames, sharedObservation.changeSetName] : scope.changeSetNames;
  const stageObjects = Object.values(scope.staging?.targets ?? {}).map(t => `${scope.evidenceBucketArn}/${t.key}`);
  const stageContext = { ...regional, "s3:ResourceAccount": s.account };
  const stageAllow = scope.staging && allow([versionRead], stageObjects, stageContext, scope.staging.readBefore);
  // The NotResource fence below already rejects every other object for this
  // session. Repeating the long exact ARNs in each conditional denial would
  // consume the existing IAM inline policy size allowance without narrowing it.
  const versionOnlyAction = { Action: versionRead, Resource: "*" };
  const allowList = [
    allow(["iam:GetRole", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:GetRolePolicy"], scope.roleToRead),
    allow(["iam:GetPolicy", "iam:GetPolicyVersion"], scope.boundaryToRead),
    allow(["s3:GetBucketPolicy"], scope.evidenceBucketArn, { "s3:ResourceAccount": s.account }),
    allow(["cloudformation:DescribeStacks", "cloudformation:GetTemplate"], scope.ownerStackArn, regional),
    allow(["cloudformation:DescribeChangeSet"], scope.ownerStackArn, { ...regional, "cloudformation:ChangeSetName": changeSetNames }),
    ...(stageAllow ? [{ ...stageAllow, Condition: { ...stageAllow.Condition, Null: { "s3:VersionId": "false" },
      StringNotEquals: { "s3:VersionId": "null" } } }] : []),
  ];
  const deny = (extra: Record<string, unknown>, condition: Record<string, unknown> = {}) => ({
    Effect: "Deny" as const, ...extra, Condition: { StringEquals: user, ...condition },
  });
  const actions = allowList.flatMap(p => p.Action);
  const ownerStackAllows = sharedObservation ? allowList.filter(p => p.Resource === scope.ownerStackArn) : [];
  const outside = allowList.flatMap(p => !ownerStackAllows.includes(p)
    ? [deny({ Action: p.Action, NotResource: p.Resource })]
    : p === ownerStackAllows[0] ? [deny({ Action: ownerStackAllows.flatMap(a => a.Action), NotResource: scope.ownerStackArn })] : []);
  const trust = { Effect: "Allow", Principal: { Federated: provider }, Action: "sts:AssumeRoleWithWebIdentity",
    Condition: { StringEquals: { ...contract.federatedTrust.commonClaims, "token.actions.githubusercontent.com:actor_id": release.actorId,
      "token.actions.githubusercontent.com:job_workflow_ref": scope.reusableRef, "sts:RoleSessionName": scope.roleSessionName },
    DateGreaterThanEquals: iso(window.startAt), DateLessThan: iso(window.issueBefore) } };
  const denies = [
    deny({ NotAction: ["sts:GetCallerIdentity", ...actions], Resource: "*" }),
    ...outside,
    deny({ Action: "cloudformation:DescribeChangeSet", Resource: scope.ownerStackArn },
      { StringNotEquals: { "cloudformation:ChangeSetName": changeSetNames } }),
    ...(sharedObservation ? [
      // The combined NotResource above already fences this action to the owner
      // stack. Match the reserved session and exact shared name for its time fence.
      deny({ Action: "cloudformation:DescribeChangeSet", Resource: "*" }, {
        StringEquals: { ...user, "cloudformation:ChangeSetName": sharedObservation.changeSetName },
        DateLessThan: iso(sharedObservation.at),
      }),
      deny({ Action: "cloudformation:DescribeChangeSet", Resource: "*" }, {
        StringEquals: { ...user, "cloudformation:ChangeSetName": sharedObservation.changeSetName },
        DateGreaterThanEquals: iso(sharedObservation.before),
      }),
    ] : []),
    ...(scope.staging ? [
      deny(versionOnlyAction, { DateGreaterThanEquals: iso(scope.staging.readBefore) }),
      deny(versionOnlyAction, { Null: { "s3:VersionId": "true" } }),
      deny(versionOnlyAction, { StringEquals: { ...user, "s3:VersionId": "null" } }),
      ...Object.entries({ ...stageContext, "aws:FederatedProvider": scope.provider }).map(([key, expected]) =>
        deny(versionOnlyAction, { StringNotEqualsIfExists: { [key]: expected } })),
    ] : []),
    deny({ Action: "*", Resource: "*" }, { DateLessThan: iso(window.startAt) }),
    deny({ Action: "*", Resource: "*" }, { DateGreaterThanEquals: iso(window.relockBefore) }),
  ];
  return { scope, trust, active: [...allowList, ...denies],
    relock: [deny({ Action: "*", Resource: "*" })], executionAuthorized: false as const };
}
