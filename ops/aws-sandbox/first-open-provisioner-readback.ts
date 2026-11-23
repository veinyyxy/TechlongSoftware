import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { SANDBOX_FIRST_OPEN as s } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { bindFirstOpenInspectorAuthorityReadback } from "./first-open-inspector-authority-readback.ts";
import { firstOpenInspectorAuthorityReadScope } from "./first-open-inspector-iam.ts";
import { firstOpenProvisionerChanges, firstOpenProvisionerProjection, type renderFirstOpenProvisionerTargets } from "./first-open-provisioner-policy.ts";
import type { FirstOpenFrozenRelease } from "./first-open-release-entry.ts";
import { bindFirstOpenSession, type FirstOpenCredentialSource } from "./first-open-sessions.ts";
import { isFirstOpenFormalProvisionerChangeSetId, matchFirstOpenFormalProvisionerReceipt, type FirstOpenFormalProvisionerGrantAck,
  type FirstOpenFormalProvisionerReceipt, type FirstOpenProvisionerPhase } from "./first-open-provisioner-lanes.ts";

type Binding = Omit<Parameters<typeof bindFirstOpenInspectorAuthorityReadback>[0], "target" | "credentials">;
type Read = Awaited<ReturnType<typeof bindFirstOpenInspectorAuthorityReadback>>;
type Targets = Awaited<ReturnType<typeof renderFirstOpenProvisionerTargets>>;
type Projection = Awaited<ReturnType<typeof firstOpenProvisionerProjection>>;
const fail = (): never => { throw Error("FIRST_OPEN_PROVISIONER_READBACK_UNPROVED"); };
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const expectedChanges = firstOpenProvisionerChanges.map(c => [c.logicalId,
  c.logicalId === "ProvisionerRole" ? "AWS::IAM::Role" : "AWS::IAM::ManagedPolicy", "Modify", "False"].join(":")).sort();

/** Compare a single observed phase with a reviewed target, not with the
 * permissions that a writer or Source asserted it had installed. */
export async function verifyFirstOpenProvisionerPhase(input: {
  release: FirstOpenFrozenRelease; releaseSha256: string; expectedBucketSha256: string; read: Read;
  phase: FirstOpenProvisionerPhase; ack: FirstOpenFormalProvisionerGrantAck; targetSha256: string; projection: Projection;
  deadline: number; signal: AbortSignal;
}, now = Date.now) {
  const { release, releaseSha256, expectedBucketSha256, read, phase, targetSha256, deadline, signal } = input;
  const ack = structuredClone(input.ack), projection = structuredClone(input.projection);
  const scope = firstOpenInspectorAuthorityReadScope(release, releaseSha256), scopeSha256 = await sha256Hex(scope);
  signal.throwIfAborted();
  const remaining = deadline - now();
  if (!Number.isSafeInteger(ack.executedAt) || ack.executedAt < release.startAt || ack.executedAt > now() ||
    !Number.isSafeInteger(remaining) || remaining <= 0 || remaining > 3_600_000 ||
    deadline > (phase === "grant" ? release.claimBefore : release.writeBefore) || ack.targetSha256 !== targetSha256 ||
    !isFirstOpenFormalProvisionerChangeSetId(ack.changeSetId, release.approvalSha256, phase)) return fail();
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(remaining)]);
  const verified = await read(phase, [projection.role.inline.map(x => x.name)], bounded);
  bounded.throwIfAborted();
  const changeProjection = verified.changes.map(c => [c.logicalId, c.type, c.action, c.replacement].join(":")).sort();
  if (verified.phase !== phase || !Number.isSafeInteger(verified.checkedAt) || verified.checkedAt < ack.executedAt ||
    verified.checkedAt > now() || now() >= deadline || verified.scopeSha256 !== scopeSha256 || verified.exactOwnerStackArn !== scope.ownerStackArn ||
    verified.exactChangeSetId !== ack.changeSetId || verified.ownerStackOriginalSha256 !== targetSha256 || verified.authorizationProved !== false ||
    verified.evidenceBucketPolicySha256 !== expectedBucketSha256 || !same(changeProjection, expectedChanges) ||
    !same(verified.roles, [projection.role]) || !same(verified.policies, projection.policies)) return fail();
  const receipt: FirstOpenFormalProvisionerReceipt = { schema: "techlong/fc41597f-formal-provisioner-documents/v2",
    lane: "formal-provisioner", jobId: s.jobId, approvalSha256: release.approvalSha256, releaseSha256, phase,
    scopeSha256, exactOwnerStackArn: scope.ownerStackArn, changeSetId: ack.changeSetId,
    targetSha256, executedAt: ack.executedAt, checkedAt: verified.checkedAt, executeAckSha256: await sha256Hex(ack),
    projectionSha256: await sha256Hex(verified), provisionerDocumentsSha256: await sha256Hex({ roles: verified.roles, policies: verified.policies }),
    evidenceBucketPolicySha256: expectedBucketSha256, evidence: "MATCHED_INSTALLED_POLICY_DOCUMENTS", authorizationProved: false };
  const checked = await matchFirstOpenFormalProvisionerReceipt(receipt, { release, releaseSha256, scopeSha256, phase,
    exactOwnerStackArn: scope.ownerStackArn, targetSha256, roles: [projection.role], policies: projection.policies,
    evidenceBucketPolicySha256: expectedBucketSha256 }, now());
  bounded.throwIfAborted();
  if (now() >= deadline) return fail();
  return checked;
}

export async function compareFirstOpenProvisionerReadback(input: Binding & {
  targets: Targets; expectedBucketSha256: string; read: Read;
}, now = Date.now) {
  const { targets, expectedBucketSha256, release, releaseSha256, read } = input;
  const active = structuredClone(targets.grant), restored = structuredClone(targets.restore);
  if (!/^[a-f0-9]{64}$/.test(expectedBucketSha256) || await sha256Hex(release) !== releaseSha256 ||
    await sha256Hex(active) !== targets.grantSha256 || await sha256Hex(restored) !== targets.restoreSha256) return fail();
  const planned = {
    grant: { sha: targets.grantSha256, projection: await firstOpenProvisionerProjection(active) },
    relock: { sha: targets.restoreSha256, projection: await firstOpenProvisionerProjection(restored) },
  };
  const used = new Set<string>();
  return async (phase: FirstOpenProvisionerPhase, ack: FirstOpenFormalProvisionerGrantAck, signal: AbortSignal) => {
    signal.throwIfAborted();
    const p = planned[phase];
    if (used.has(phase) || !p) return fail();
    used.add(phase);
    return verifyFirstOpenProvisionerPhase({ release, releaseSha256, expectedBucketSha256, read, phase, ack, targetSha256: p.sha,
      projection: p.projection, deadline: phase === "grant" ? release.claimBefore : release.writeBefore, signal }, now);
  };
}

/** The installer must supply the separately authorized Inspector issuer,
 * not Provisioner/Source credentials. No new handoff or issue API. */
export async function bindFirstOpenProvisionerReadback(input: Omit<Parameters<typeof compareFirstOpenProvisionerReadback>[0], "read"> & {
  inspectorCredentials: FirstOpenCredentialSource;
}, now = Date.now) {
  const { inspectorCredentials, ...v } = input;
  const inspector = bindFirstOpenSession("inspector", inspectorCredentials, input.release.writeBefore, now);
  const read = await bindFirstOpenInspectorAuthorityReadback({ ...v, target: "provisioner", credentials: inspector.credentials }, now);
  return compareFirstOpenProvisionerReadback({ ...v, read }, now);
}
