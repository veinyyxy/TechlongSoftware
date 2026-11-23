import { setTimeout as delay } from "node:timers/promises";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { SANDBOX_FIRST_OPEN as s } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import type { VersionAuthorityScope } from "./first-open-controlled-cfn.ts";
import { FIRST_OPEN_AUTHORITY_RESOURCES, renderFirstOpenVersionGrantRelockTargets } from "./first-open-install-policy-delta.ts";
import { bindFirstOpenInspectorAuthorityReadback } from "./first-open-inspector-authority-readback.ts";
import { firstOpenInspectorAuthorityReadScope } from "./first-open-inspector-iam.ts";
import { firstOpenLifecycleAuthoritySchedule } from "./first-open-release-entry.ts";
import { isFirstOpenFormalProvisionerChangeSetId, type FirstOpenFormalProvisionerGrantAck,
  type FirstOpenFormalProvisionerReceipt } from "./first-open-provisioner-lanes.ts";
import { firstOpenProvisionerProjection } from "./first-open-provisioner-policy.ts";
import { verifyFirstOpenProvisionerPhase } from "./first-open-provisioner-readback.ts";
import oidcContract from "./first-open-fc41597f-oidc-handoffs.prepared.json" with { type: "json" };

type Reader = Awaited<ReturnType<typeof bindFirstOpenInspectorAuthorityReadback>>;
type Readback = Awaited<ReturnType<Reader>>;
type Target = Parameters<typeof renderFirstOpenVersionGrantRelockTargets>[0];
type Binding = Omit<Parameters<typeof bindFirstOpenInspectorAuthorityReadback>[0], "credentials" | "target">;
type Credentials = Parameters<typeof bindFirstOpenInspectorAuthorityReadback>[0]["credentials"];
type Phase = Parameters<Reader>[0];
const fail = (): never => { throw Error("FIRST_OPEN_VERSION_AUTHORITY_OBSERVATION_MISMATCH"); };
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const hex = /^[a-f0-9]{64}$/;
const boundaryArn = `arn:aws:iam::${s.account}:policy/TechlongSandboxFirstOpenFc41597fLifecycleBoundary`;
const allowedAuthorActions = new Set([
  "sts:GetCallerIdentity", "s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "dynamodb:GetItem", "dynamodb:PutItem",
  "secretsmanager:DescribeSecret", "secretsmanager:CreateSecret", "secretsmanager:TagResource", "secretsmanager:GetSecretValue",
  "cloudformation:DescribeStacks", "rds:DescribeDBClusters", "elasticloadbalancing:DescribeListeners", "elasticloadbalancing:DescribeRules",
  "elasticloadbalancing:DescribeTrustStores", "elasticloadbalancing:DescribeLoadBalancers",
]);
const changed = Object.entries(FIRST_OPEN_AUTHORITY_RESOURCES).map(([logicalId, type]) => ({
  logicalId, type, action: "Modify", replacement: "False",
})).sort((a, b) => a.logicalId.localeCompare(b.logicalId));

/** Stable projections come from the independently reviewed pre-grant source,
 * never from the intent artifact or from the same read being judged. */
export interface FirstOpenVersionAuthoritySource extends Binding {
  preGrant: Target;
  preGrantSha256: string;
  roles: Readback["roles"];
  policies: Readback["policies"];
  evidenceBucketPolicySha256: string;
  /** Source's Execute acknowledgement only; the formal Inspector observes
   * the result independently after startup, before a claim can proceed. */
  formalProvisionerGrantAck?: FirstOpenFormalProvisionerGrantAck;
}

export interface FirstOpenVersionRelockProof {
  checkedAt: number;
  scopeSha256: string;
  policySha256: string;
  relocked: true;
}

export function requireFirstOpenFormalProvisionerGrantAck(v: FirstOpenVersionAuthoritySource, now = Date.now()) {
  const { release, formalProvisionerGrantAck: ack } = v;
  const deadline = Math.min(release.phaseCutoffs[0], release.claimBefore);
  if (!release.taskRelease || !ack || Object.keys(ack).sort().join(",") !== "changeSetId,executedAt,targetSha256" ||
    ![deadline, now, release.startAt, ack.executedAt].every(Number.isSafeInteger) ||
    !isFirstOpenFormalProvisionerChangeSetId(ack.changeSetId, release.approvalSha256, "grant") ||
    ack.executedAt < release.startAt || ack.executedAt > now || now >= deadline ||
    !hex.test(ack.targetSha256) || ack.targetSha256 !== v.preGrantSha256) throw Error("FIRST_OPEN_FORMAL_PROVISIONER_ACK_UNBOUND");
  return structuredClone(ack);
}

function authorCannotChangePolicy(template: Target, authorId: string) {
  const p = template.Resources.ProvisionerRole?.Properties;
  if (p?.RoleName !== s.workerRole.split("/").at(-1) || !Array.isArray(p.Policies)) return false;
  // Match an explicit identity deny for the reserved author, including a
  // previously approved narrower NotAction fence. No reliance on implicit
  // absence of allows or on the role's legacy permissions boundary alone.
  return p.Policies.flatMap(x => x.PolicyDocument?.Statement ?? []).some(x => x.Effect === "Deny" && x.Resource === "*" &&
    same(x.Condition, { StringEquals: { "aws:userid": `${authorId}:first-open-fc41597f-provisioner-g1` } }) &&
    (x.Action === "*" || (Array.isArray(x.NotAction) && x.NotAction.length > 0 &&
      x.NotAction.every((a: unknown) => typeof a === "string" && allowedAuthorActions.has(a)))));
}

/** No provider calls. Validate the same approved preimage both before saving
 * a protected capsule and at runtime. */
export async function checkFirstOpenVersionAuthoritySource(source: FirstOpenVersionAuthoritySource, protectedSourceSha256: string) {
  const v = structuredClone(source);
  const schedule = firstOpenLifecycleAuthoritySchedule(v.release);
  const scope = firstOpenInspectorAuthorityReadScope(v.release, v.releaseSha256);
  if (Object.hasOwn(v, "target") || Object.hasOwn(v, "formalProvisionerGrant") ||
    !hex.test(protectedSourceSha256) || await sha256Hex(v) !== protectedSourceSha256 ||
    await sha256Hex(v.release) !== v.releaseSha256 || await sha256Hex(v.preGrant) !== v.preGrantSha256 ||
    !hex.test(v.evidenceBucketPolicySha256) || v.roles.length !== scope.roles.length ||
    v.roles.some((r, i) => r.arn !== scope.roles[i] || r.roleId !== scope.roleIds[i] || !scope.boundaries.includes(r.boundaryArn) ||
      !hex.test(r.trustSha256) || r.attached.some(a => !scope.boundaries.includes(a)) || r.inline.some(p => !hex.test(p.sha256))) ||
    !same(v.policies.map(p => p.policyArn), [...new Set(v.roles.flatMap(r => [r.boundaryArn, ...r.attached]))].sort()) ||
    v.policies.some(p => !hex.test(p.documentSha256)) || v.roles[1].boundaryArn !== boundaryArn ||
    v.roles.some((r, i) => i !== 1 && (r.boundaryArn === boundaryArn || r.attached.includes(boundaryArn))) ||
    !authorCannotChangePolicy(v.preGrant, scope.roleIds[0])) return fail();
  const authorPolicies = v.preGrant.Resources.ProvisionerRole.Properties.Policies as { PolicyName: string; PolicyDocument: unknown }[];
  const authorInline = await Promise.all(authorPolicies.map(async p => ({
    name: p.PolicyName, sha256: await sha256Hex(p.PolicyDocument),
  })));
  if (!same(authorInline.sort((a, b) => a.name.localeCompare(b.name)), v.roles[0].inline)) return fail();
  const lifecycle = (template: Target) => template.Resources.TenantLifecycleTaskRole.Properties.Policies as
    { PolicyName: string; PolicyDocument: unknown }[];
  const doc = (template: Target) => template.Resources.FirstOpenFc41597fLifecycleBoundary.Properties.PolicyDocument;
  const inline = async (template: Target) => Promise.all(lifecycle(template).map(async p => ({
    name: p.PolicyName, sha256: await sha256Hex(p.PolicyDocument),
  })));
  if (v.policies.find(p => p.policyArn === boundaryArn)?.documentSha256 !== await sha256Hex(doc(v.preGrant)) ||
    !same(v.roles[1].inline, await inline(v.preGrant)) ||
    v.roles[1].trustSha256 !== await sha256Hex(v.preGrant.Resources.TenantLifecycleTaskRole.Properties.AssumeRolePolicyDocument)) return fail();
  return { v, scope, inline, doc, schedule };
}

/** Reject the known locked preimage and any put policy that isn't tied to
 * the exact author, time and immutable key. This is a candidate check, not
 * verification that STS or IAM has activated the writer. */
export async function requireFirstOpenTemplateAuthor(source: FirstOpenVersionAuthoritySource) {
  const { preGrant: { Resources }, release, roles, policies } = source;
  const role = Resources.ProvisionerRole?.Properties;
  const boundary = Resources.ProvisionerBoundary?.Properties;
  const trust = role?.AssumeRolePolicyDocument as { Statement?: Record<string, unknown>[] } | undefined;
  const attached = roles[0];
  const provider = `arn:aws:iam::${s.account}:oidc-provider/token.actions.githubusercontent.com`;
  const name = "first-open-fc41597f-provisioner-g1";
  const oidc = `veinyyxy/TechlongSoftware/.github/workflows/sandbox-first-open-run-once-job-v1.yml@${release.runOnceReusableCommit}`;
  const time = (n: number) => ({ "aws:CurrentTime": new Date(n).toISOString() });
  const trustStatements = trust?.Statement ?? [];
  const [original, web] = trustStatements;
  const principal = "arn:aws:iam::402010193138:user/techlong-sandbox-dev";
  const parameter = (source.preGrant as Target & { Parameters?: Record<string, { AllowedValues?: unknown; Default?: unknown }> })
    .Parameters?.ProvisionerPrincipalArn;
  const legacy = { Effect: "Allow", Principal: { AWS: principal }, Action: "sts:AssumeRole",
    Condition: { Bool: { "aws:MultiFactorAuthPresent": "true" }, StringEquals: { "sts:RoleSessionName": "techlong-sandbox-provisioner" } } };
  // The Original can use the frozen CFN parameter; live IAM returns the
  // resolved ARN. Resolve only this known parameter with a single value.
  const resolved = same(original?.Principal, { AWS: { Ref: "ProvisionerPrincipalArn" } }) &&
    parameter?.Default === principal && same(parameter.AllowedValues, [principal]) ? { ...original, Principal: legacy.Principal } : original;
  if (release.actorId !== "14145707" || trustStatements.length !== 2 || !same(resolved, legacy) ||
    web.Effect !== "Allow" || web.Action !== "sts:AssumeRoleWithWebIdentity" ||
    !same(web.Principal, { Federated: provider }) || !same(web.Condition, {
      StringEquals: { ...oidcContract.federatedTrust.commonClaims, "token.actions.githubusercontent.com:actor_id": release.actorId,
        "token.actions.githubusercontent.com:job_workflow_ref": oidc, "sts:RoleSessionName": name },
      DateGreaterThanEquals: time(release.startAt), DateLessThan: time(release.claimBefore),
    }) || attached.trustSha256 !== await sha256Hex({ ...trust, Statement: [resolved, web] }) ||
    !same(role?.PermissionsBoundary, { Ref: "ProvisionerBoundary" }) ||
    attached.boundaryArn !== `arn:aws:iam::${s.account}:policy/TechlongSandboxProvisionerBoundary` ||
    boundary?.ManagedPolicyName !== "TechlongSandboxProvisionerBoundary" || !boundary.PolicyDocument ||
    policies.find(p => p.policyArn === attached.boundaryArn)?.documentSha256 !== await sha256Hex(boundary.PolicyDocument)) {
    throw Error("FIRST_OPEN_TEMPLATE_AUTHOR_LOCKED_OR_UNVERIFIED");
  }
  const roleDocs = (role!.Policies as { PolicyDocument: unknown }[]).map(p => p.PolicyDocument);
  const sts = (doc: unknown) => (doc as { Statement: Record<string, unknown>[] }).Statement;
  const who = `${attached.roleId}:${name}`;
  const condition = {
    StringEquals: { "aws:userid": who, "aws:FederatedProvider": provider, "s3:if-none-match": "*", "s3:x-amz-server-side-encryption": "AES256" },
    DateGreaterThanEquals: time(release.startAt), DateLessThan: time(release.phaseCutoffs[3]),
  };
  const key = `arn:aws:s3:::${FIRST_OPEN_BASELINE_BINDING.bucket}/first-open-management/${s.jobId}/${release.approvalSha256}/cfn-template.json`;
  const hasPut = (st: Record<string, unknown>) => st.Effect === "Allow" && st.Action === "s3:PutObject" &&
    st.Resource === key && same(st.Condition, condition);
  if (roleDocs.flatMap(sts).some(st => st.Effect === "Deny" && st.Action === "*" && st.Resource === "*" &&
    same(st.Condition, { StringEquals: { "aws:userid": who } })) ||
    !roleDocs.flatMap(sts).some(hasPut) || !sts(boundary.PolicyDocument).some(hasPut)) {
    throw Error("FIRST_OPEN_TEMPLATE_AUTHOR_LOCKED_OR_UNVERIFIED");
  }
  const projection = await firstOpenProvisionerProjection(source.preGrant);
  if (projection.role.inline[0]?.name !== "FirstOpenFc41597fWriterFence" || !same(projection.role, attached) ||
    !same(projection.policies, policies.filter(p => p.policyArn === projection.role.boundaryArn))) return fail();
  return projection;
}

/** Independently compare a single formal Grant sample before the first
 * phase cutoff. The sealed ACK supplies identity and timing, never proof. */
export async function bindFirstOpenFormalProvisionerGrantComparison(
  source: FirstOpenVersionAuthoritySource, protectedSourceSha256: string, read: Reader, now = Date.now,
) {
  const { v } = await checkFirstOpenVersionAuthoritySource(source, protectedSourceSha256);
  const projection = await requireFirstOpenTemplateAuthor(v);
  const { release, releaseSha256, evidenceBucketPolicySha256: expectedBucketSha256 } = v;
  let used = false;
  return async (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (used) return fail();
    used = true;
    const ack = requireFirstOpenFormalProvisionerGrantAck(v, now());
    return verifyFirstOpenProvisionerPhase({ release, releaseSha256, expectedBucketSha256, read, projection,
      phase: "grant", ack, targetSha256: v.preGrantSha256, deadline: Math.min(release.phaseCutoffs[0], release.claimBefore), signal }, now);
  };
}

/** This verifies deployed IAM documents and exact owner Change Set, not
 * simulated permissions nor a claim that AWS has accepted CreateStack. */
export async function bindFirstOpenVersionAuthorityComparison(
  source: FirstOpenVersionAuthoritySource, protectedSourceSha256: string, read: Reader, now = Date.now,
  pause: (ms: number, signal: AbortSignal) => Promise<void> = (ms, signal) => delay(ms, undefined, { signal }),
) {
  const { v, scope, inline, doc, schedule } = await checkFirstOpenVersionAuthoritySource(source, protectedSourceSha256);
  return async (phase: Phase, request: VersionAuthorityScope, signal: AbortSignal) => {
    signal.throwIfAborted();
    const cutoff = phase === "grant" ? request.submitBefore : v.release.phaseCutoffs[4];
    if (request.sourceSha256 !== protectedSourceSha256 || request.approvalSha256 !== v.release.approvalSha256 ||
      request.putAcknowledgedAt < v.release.startAt || request.submitBefore !== v.release.phaseCutoffs[3] ||
      now() < request.putAcknowledgedAt || now() >= cutoff) return fail();
    const targets = await renderFirstOpenVersionGrantRelockTargets(v.preGrant, v.preGrantSha256, request);
    const roles = structuredClone(v.roles), policies = structuredClone(v.policies);
    const boundary = policies.find(p => p.policyArn === boundaryArn);
    if (!boundary) return fail();
    if (phase === "grant") {
      roles[1].inline = await inline(targets.grant);
      boundary.documentSha256 = await sha256Hex(doc(targets.grant));
    }
    const due = phase === "grant" ? schedule?.grantNotBefore : schedule?.relockNotBefore;
    const left = cutoff - now();
    if (left <= 0) return fail();
    const bounded = due === undefined ? signal : AbortSignal.any([signal, AbortSignal.timeout(left)]);
    if (due !== undefined) {
      const wait = due - now();
      if (wait > 0) await pause(wait, bounded);
      bounded.throwIfAborted();
      if (now() < due || now() >= cutoff) return fail();
    }
    // The timer only opens a single sample. Only the actual executed Change
    // Set, owner Original and exact policy documents constitute proof.
    const observed = await read(phase, roles.map(r => r.inline.map(p => p.name)), bounded);
    bounded.throwIfAborted();
    if (observed.phase !== phase || observed.exactOwnerStackArn !== scope.ownerStackArn ||
      !observed.exactChangeSetId.startsWith(`arn:aws:cloudformation:${s.region}:${s.account}:changeSet/${scope.changeSetNames[phase === "grant" ? 0 : 1]}/`) ||
      observed.scopeSha256 !== await sha256Hex(scope) ||
      !same([...observed.changes].sort((a, b) => (a.logicalId ?? "").localeCompare(b.logicalId ?? "")), changed) ||
      observed.ownerStackOriginalSha256 !== (phase === "grant" ? targets.grantSha256 : targets.relockSha256) ||
      observed.evidenceBucketPolicySha256 !== v.evidenceBucketPolicySha256 || !same(observed.roles, roles) || !same(observed.policies, policies) ||
      !Number.isSafeInteger(observed.checkedAt) || observed.checkedAt < Math.max(request.putAcknowledgedAt, due ?? 0) ||
      observed.checkedAt > now() || now() >= cutoff) return fail();
    return { checkedAt: observed.checkedAt, scopeSha256: await sha256Hex(request), policySha256: await sha256Hex(observed) };
  };
}

export function firstOpenInspectorVersionAuthorityProof(source: FirstOpenVersionAuthoritySource, sourceSha256: string, now = Date.now) {
  const v = structuredClone(source);
  let preclaimAttempted = false;
  let verifiedCredentials: Credentials | undefined;
  const used = new Set<Phase>();
  const bind = async (credentials: Credentials) => {
    if (!verifiedCredentials || verifiedCredentials !== credentials) return fail();
    const read = await bindFirstOpenInspectorAuthorityReadback({ release: v.release, releaseSha256: v.releaseSha256,
      consent: v.consent, credentials }, now);
    return bindFirstOpenVersionAuthorityComparison(v, sourceSha256, read, now);
  };
  return { sourceSha256, verifyFormalGrantWithInspector(credentials: Credentials) {
    return async (signal: AbortSignal): Promise<FirstOpenFormalProvisionerReceipt> => {
      signal.throwIfAborted();
      if (preclaimAttempted || typeof credentials !== "function") return fail();
      preclaimAttempted = true;
      requireFirstOpenFormalProvisionerGrantAck(v, now());
      const read = await bindFirstOpenInspectorAuthorityReadback({ release: v.release, releaseSha256: v.releaseSha256,
        consent: v.consent, target: "provisioner", credentials }, now);
      const compare = await bindFirstOpenFormalProvisionerGrantComparison(v, sourceSha256, read, now);
      const receipt = await compare(signal);
      signal.throwIfAborted();
      if (now() >= Math.min(v.release.phaseCutoffs[0], v.release.claimBefore)) return fail();
      verifiedCredentials = credentials;
      return receipt;
    };
  }, verifyWithInspector(credentials: Credentials) {
    return async (request: VersionAuthorityScope, signal: AbortSignal) => {
      if (used.has("grant")) return fail();
      used.add("grant");
      const verify = await bind(credentials);
      const checked = await verify("grant", request, signal);
      return { schema: "techlong/fc41597f-exact-cfn-version-authority/v2", ...checked, expiresAt: request.submitBefore,
        evidence: "MATCHED_INSTALLED_POLICY_DOCUMENTS" };
    };
  }, verifyRelockWithInspector(credentials: Credentials) {
    return async (request: VersionAuthorityScope, signal: AbortSignal): Promise<FirstOpenVersionRelockProof> => {
      if (used.has("relock")) return fail();
      used.add("relock");
      const verify = await bind(credentials);
      return { ...await verify("relock", request, signal), relocked: true as const };
    };
  } };
}
