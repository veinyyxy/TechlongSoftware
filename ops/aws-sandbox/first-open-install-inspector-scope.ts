import { sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { SANDBOX_FIRST_OPEN as s } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { verifyFirstOpenTaskRelease } from "../../lib/deployments/execution/first-onboarding-version.ts";
import { firstOpenInspectorAuthorityReadScope } from "./first-open-inspector-iam.ts";
import { firstOpenProvisionerChangeSetName } from "./first-open-provisioner-lanes.ts";
import type { FirstOpenFrozenRelease } from "./first-open-release-entry.ts";
import contract from "./first-open-fc41597f-oidc-handoffs.prepared.json" with { type: "json" };

export const firstOpenInstallInspectorSession = "first-open-fc41597f-install-readback";
export const firstOpenInstallProvisionerLane = "install" as const;
export const firstOpenInstallProvisionerObservation = "techlong/fc41597f-install-provisioner-observation/v1" as const;
export type FirstOpenInstallWindow = { startAt: number; issueBefore: number; grantAt: number; grantBefore: number;
  relockAt: number; relockBefore: number; factsCutoff: number };
const fail = (): never => { throw Error("FIRST_OPEN_INSTALL_INSPECTOR_SCOPE"); };
const provider = contract.federatedTrust.existingProviderArn;
const iso = (at: number) => ({ "aws:CurrentTime": new Date(at).toISOString() });

export function firstOpenInstallProvisionerChangeSetName(approvalSha256: string, phase: "grant" | "relock") {
  return firstOpenProvisionerChangeSetName(approvalSha256, firstOpenInstallProvisionerLane, phase);
}

export function isFirstOpenInstallProvisionerChangeSetId(changeSetId: string, exactName: string) {
  const stem = `arn:aws:cloudformation:${s.region}:${s.account}:changeSet/${exactName}/`;
  return typeof changeSetId === "string" && changeSetId.startsWith(stem) &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(changeSetId.slice(stem.length));
}

export async function firstOpenInstallInspectorScope(release: FirstOpenFrozenRelease, releaseSha256: string, window: FirstOpenInstallWindow) {
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
  };
}

/** Intended for the separately reviewed existing Inspector owner stack. Does
 * not mutate it and does not grant any of the formal Inspector capabilities. */
export async function firstOpenInstallInspectorPolicies(release: FirstOpenFrozenRelease, releaseSha256: string,
  window: FirstOpenInstallWindow, approvedScopeSha256: string) {
  const scope = await firstOpenInstallInspectorScope(release, releaseSha256, window);
  if (await sha256Hex(scope) !== approvedScopeSha256) return fail();
  const user = { "aws:userid": `${scope.roleId}:${scope.roleSessionName}` };
  const allow = (Action: string[], Resource: string, exact: Record<string, string | string[]> = {}) => ({
    Effect: "Allow" as const, Action, Resource, Condition: {
      StringEquals: { ...user, "aws:FederatedProvider": scope.provider, ...exact },
      DateGreaterThanEquals: iso(window.startAt), DateLessThan: iso(window.relockBefore),
    },
  });
  const regional = { "aws:RequestedRegion": s.region };
  const allowList = [
    allow(["iam:GetRole", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:GetRolePolicy"], scope.roleToRead),
    allow(["iam:GetPolicy", "iam:GetPolicyVersion"], scope.boundaryToRead),
    allow(["s3:GetBucketPolicy"], scope.evidenceBucketArn, { "s3:ResourceAccount": s.account }),
    allow(["cloudformation:DescribeStacks", "cloudformation:GetTemplate"], scope.ownerStackArn, regional),
    allow(["cloudformation:DescribeChangeSet"], scope.ownerStackArn, { ...regional, "cloudformation:ChangeSetName": scope.changeSetNames }),
  ];
  const deny = (extra: Record<string, unknown>, condition: Record<string, unknown> = {}) => ({
    Effect: "Deny" as const, ...extra, Condition: { StringEquals: user, ...condition },
  });
  const actions = allowList.flatMap(p => p.Action);
  const trust = { Effect: "Allow", Principal: { Federated: provider }, Action: "sts:AssumeRoleWithWebIdentity",
    Condition: { StringEquals: { ...contract.federatedTrust.commonClaims, "token.actions.githubusercontent.com:actor_id": release.actorId,
      "token.actions.githubusercontent.com:job_workflow_ref": scope.reusableRef, "sts:RoleSessionName": scope.roleSessionName },
    DateGreaterThanEquals: iso(window.startAt), DateLessThan: iso(window.issueBefore) } };
  const denies = [
    deny({ NotAction: ["sts:GetCallerIdentity", ...actions], Resource: "*" }),
    ...allowList.map(p => deny({ Action: p.Action, NotResource: p.Resource })),
    deny({ Action: "cloudformation:DescribeChangeSet", Resource: scope.ownerStackArn },
      { StringNotEquals: { "cloudformation:ChangeSetName": scope.changeSetNames } }),
    deny({ Action: "*", Resource: "*" }, { DateLessThan: iso(window.startAt) }),
    deny({ Action: "*", Resource: "*" }, { DateGreaterThanEquals: iso(window.relockBefore) }),
  ];
  return { scope, trust, active: [...allowList, ...denies],
    relock: [deny({ Action: "*", Resource: "*" })], executionAuthorized: false as const };
}
