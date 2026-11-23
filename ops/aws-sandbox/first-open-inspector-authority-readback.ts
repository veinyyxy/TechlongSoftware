import { CloudFormationClient, DescribeChangeSetCommand, DescribeStacksCommand, GetTemplateCommand } from "@aws-sdk/client-cloudformation";
import { GetPolicyCommand, GetPolicyVersionCommand, GetRoleCommand, GetRolePolicyCommand, IAMClient,
  ListAttachedRolePoliciesCommand, ListRolePoliciesCommand } from "@aws-sdk/client-iam";
import { GetBucketPolicyCommand, S3Client } from "@aws-sdk/client-s3";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { SANDBOX_FIRST_OPEN as s } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { firstOpenInspectorAuthorityReadScope, firstOpenInspectorAuthorityReadStatements, type FirstOpenInspectorAuthorityReadConsent } from "./first-open-inspector-iam.ts";
import type { FirstOpenFrozenRelease } from "./first-open-release-entry.ts";
import { sdkConfig, type FirstOpenCredentials } from "./first-open-express-aws.ts";
import { firstOpenInstallInspectorPolicies, firstOpenInstallProvisionerLane, firstOpenInstallProvisionerObservation,
  isFirstOpenInstallProvisionerChangeSetId, type FirstOpenInstallWindow } from "./first-open-install-inspector-scope.ts";

const fail = (): never => { throw Error("FIRST_OPEN_INSPECTOR_AUTHORITY_READBACK_UNPROVED"); };
const sorted = (items: readonly string[]) => [...items].sort();
const sameNames = (a: readonly string[], b: readonly string[]) => canonicalJson(sorted(a)) === canonicalJson(sorted(b));
const provisionerBoundary = `arn:aws:iam::${s.account}:policy/TechlongSandboxProvisionerBoundary`;
const provisionerInline = { grant: "FirstOpenFc41597fWriterFence", relock: "FirstOpenFc41597fWriterLock" } as const;
type Credentials = (signal: AbortSignal) => Promise<Exclude<FirstOpenCredentials, (...args: never[]) => unknown>>;
type InstallScope = Awaited<ReturnType<typeof firstOpenInstallInspectorPolicies>>["scope"];
function iamDocument(raw?: string) {
  if (!raw) return fail();
  // IAM can return either the literal JSON or RFC3986-encoded JSON.
  return JSON.parse(raw.startsWith("{") ? raw : decodeURIComponent(raw)) as unknown;
}

/** Reads only the exact signed-off objects with the already identified
 * Inspector credentials. Output is an observation, not an allow decision. */
export async function bindFirstOpenInspectorAuthorityReadback(input: {
  release: FirstOpenFrozenRelease; releaseSha256: string; consent: FirstOpenInspectorAuthorityReadConsent;
  target?: "provisioner";
  credentials: Credentials;
}, now = Date.now) {
  const { releaseSha256, credentials, target } = input, release = structuredClone(input.release);
  await firstOpenInspectorAuthorityReadStatements(release, releaseSha256, input.consent);
  return createFirstOpenInspectorReadback(release, releaseSha256, credentials, target === "provisioner", now);
}

export async function bindFirstOpenInstallProvisionerReadback(input: {
  release: FirstOpenFrozenRelease; releaseSha256: string; window: FirstOpenInstallWindow; approvedScopeSha256: string;
  credentials: Credentials;
}, now = Date.now) {
  const { release, releaseSha256, window, approvedScopeSha256 } = structuredClone({
    release: input.release, releaseSha256: input.releaseSha256, window: input.window, approvedScopeSha256: input.approvedScopeSha256,
  });
  const { scope } = await firstOpenInstallInspectorPolicies(release, releaseSha256, window, approvedScopeSha256);
  const read = createFirstOpenInspectorReadback(release, releaseSha256, input.credentials, true, now, { scope, approvedScopeSha256 });
  return async (...args: Parameters<typeof read>) => {
    const observed = await read(...args);
    return { ...observed, schema: firstOpenInstallProvisionerObservation, lane: firstOpenInstallProvisionerLane,
      changeSetName: scope.changeSetNames[args[0] === "grant" ? 0 : 1] };
  };
}

function createFirstOpenInspectorReadback(release: FirstOpenFrozenRelease, releaseSha256: string, credentials: Credentials,
  provisionerOnly: boolean, now: () => number, installation?: { scope: InstallScope; approvedScopeSha256: string }) {
  const review = firstOpenInspectorAuthorityReadScope(release, releaseSha256);
  const roles = provisionerOnly ? review.roles.slice(0, 1) : review.roles;
  const used = new Set<"grant" | "relock">();
  return async (phase: "grant" | "relock", expectedInlineNames: readonly (readonly string[])[], signal: AbortSignal) => {
    if (!["grant", "relock"].includes(phase) || used.has(phase) || expectedInlineNames.length !== roles.length ||
      (provisionerOnly && (expectedInlineNames[0]?.length !== 1 || expectedInlineNames[0][0] !== provisionerInline[phase])) ||
      expectedInlineNames.some(names => names.length > 4 || new Set(names).size !== names.length ||
        names.some(n => !/^[A-Za-z0-9+=,.@_-]{1,128}$/.test(n)))) return fail();
    used.add(phase);
    const window = installation?.scope.window;
    const from = window ? (phase === "grant" ? window.grantAt : window.relockAt) : release.startAt;
    const before = window ? (phase === "grant" ? window.grantBefore : window.relockBefore) :
      (phase === "grant" ? (provisionerOnly ? release.claimBefore : release.phaseCutoffs[3]) : release.writeBefore);
    const remaining = before - now();
    if (remaining <= 0 || now() < from || remaining > 3_600_000) return fail();
    const checked = AbortSignal.any([signal, AbortSignal.timeout(remaining)]), names = expectedInlineNames.map(sorted);
    checked.throwIfAborted();
    const config = sdkConfig(await credentials(checked));
    const iam = new IAMClient(config), s3 = new S3Client(config), cfn = new CloudFormationClient(config);
    let metadataCalls = 0;
    const options = () => {
      if (provisionerOnly && ++metadataCalls > 10) return fail();
      return { abortSignal: checked };
    };
    const allowedPolicies = new Set(provisionerOnly ? [provisionerBoundary] : review.boundaries);
    const referenced = new Set<string>();
    try {
      const snapshots = [];
      for (const [index, arn] of roles.entries()) {
        const RoleName = arn.split("/").at(-1);
        const { Role: r } = await iam.send(new GetRoleCommand({ RoleName }), options());
        const inline = await iam.send(new ListRolePoliciesCommand({ RoleName }), options());
        const attached = await iam.send(new ListAttachedRolePoliciesCommand({ RoleName }), options());
        const boundaryArn = r?.PermissionsBoundary?.PermissionsBoundaryArn;
        const policyArns = (attached.AttachedPolicies ?? []).map(p => p.PolicyArn ?? "");
        if (r?.Arn !== arn || r.RoleId !== review.roleIds[index] || !boundaryArn || !allowedPolicies.has(boundaryArn) ||
          inline.IsTruncated !== false || attached.IsTruncated !== false || !sameNames(inline.PolicyNames ?? [], names[index]) ||
          (provisionerOnly && (policyArns.length !== 1 || policyArns[0] !== provisionerBoundary)) ||
          new Set(policyArns).size !== policyArns.length || policyArns.some(a => !allowedPolicies.has(a))) return fail();
        for (const i of [boundaryArn, ...policyArns]) referenced.add(i);
        const docs = [];
        for (const PolicyName of names[index]) {
          const p = await iam.send(new GetRolePolicyCommand({ RoleName, PolicyName }), options());
          if (p.RoleName !== RoleName || p.PolicyName !== PolicyName) return fail();
          docs.push({ name: PolicyName, sha256: await sha256Hex(iamDocument(p.PolicyDocument)) });
        }
        snapshots.push({ arn, roleId: r.RoleId, boundaryArn, attached: sorted(policyArns), inline: docs,
          trustSha256: await sha256Hex(iamDocument(r.AssumeRolePolicyDocument)) });
      }
      const policyVersions = [];
      for (const PolicyArn of sorted([...referenced])) {
        const { Policy: p } = await iam.send(new GetPolicyCommand({ PolicyArn }), options());
        if (p?.Arn !== PolicyArn || !p.PolicyId || !/^v[1-9][0-9]*$/.test(p.DefaultVersionId ?? "")) return fail();
        const version = (await iam.send(new GetPolicyVersionCommand({ PolicyArn, VersionId: p.DefaultVersionId }), options())).PolicyVersion;
        if (!version || version.VersionId !== p.DefaultVersionId || version.IsDefaultVersion !== true) return fail();
        policyVersions.push({ policyArn: PolicyArn, policyId: p.PolicyId, versionId: version.VersionId,
          documentSha256: await sha256Hex(iamDocument(version.Document)) });
      }
      const bucket = await s3.send(new GetBucketPolicyCommand({ Bucket: review.evidenceBucketArn.slice("arn:aws:s3:::".length),
        ExpectedBucketOwner: s.account }), options());
      const stack = await cfn.send(new DescribeStacksCommand({ StackName: review.ownerStackArn }), options());
      const changeNames = installation?.scope.changeSetNames ?? (provisionerOnly ? review.provisionerChangeSetNames : review.changeSetNames);
      const changeName = changeNames[phase === "grant" ? 0 : 1];
      const change = await cfn.send(new DescribeChangeSetCommand({ StackName: review.ownerStackArn, ChangeSetName: changeName }), options());
      const template = await cfn.send(new GetTemplateCommand({ StackName: review.ownerStackArn, TemplateStage: "Original" }), options());
      checked.throwIfAborted();
      if (now() >= before || !bucket.Policy || !template.TemplateBody || stack.NextToken || stack.Stacks?.length !== 1 ||
        stack.Stacks[0].StackId !== review.ownerStackArn || stack.Stacks[0].StackStatus !== "UPDATE_COMPLETE" ||
        change.StackId !== review.ownerStackArn || change.ChangeSetName !== changeName || !change.ChangeSetId || change.NextToken ||
        change.Status !== "CREATE_COMPLETE" || change.ExecutionStatus !== "EXECUTE_COMPLETE" ||
        (installation && !isFirstOpenInstallProvisionerChangeSetId(change.ChangeSetId, changeName)) ||
        (window && (!change.CreationTime || !(change.CreationTime.getTime() >= window.startAt && change.CreationTime.getTime() <= now())))) return fail();
      return { phase, checkedAt: now(), exactOwnerStackArn: review.ownerStackArn, exactChangeSetId: change.ChangeSetId,
        changesSha256: await sha256Hex(change.Changes), evidenceBucketPolicySha256: await sha256Hex(JSON.parse(bucket.Policy)),
        ownerStackOriginalSha256: await sha256Hex(JSON.parse(template.TemplateBody)),
        changes: (change.Changes ?? []).map(x => x.Type === "Resource" ? {
          logicalId: x.ResourceChange?.LogicalResourceId, action: x.ResourceChange?.Action,
          replacement: x.ResourceChange?.Replacement, type: x.ResourceChange?.ResourceType,
        } : {}),
        roles: snapshots, policies: policyVersions.map(p => ({ policyArn: p.policyArn, documentSha256: p.documentSha256 })),
        roleSnapshotSha256: await sha256Hex(snapshots), policyVersionsSha256: await sha256Hex(policyVersions),
        scopeSha256: installation?.approvedScopeSha256 ?? await sha256Hex(review), authorizationProved: false as const };
    } catch { return fail(); }
    finally { iam.destroy(); s3.destroy(); cfn.destroy(); }
  };
}
