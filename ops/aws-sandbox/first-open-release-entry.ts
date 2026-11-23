import { sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { firstOpenVersion, verifyFirstOpenTaskRelease, type FirstOpenTaskRelease } from "../../lib/deployments/execution/first-onboarding-version.ts";
import type { FirstOpenHandoffPair } from "./first-open-oidc-offline.ts";
import { firstOpenGitHubHandoff } from "./first-open-github-handoff.ts";
import contract from "./first-open-fc41597f-oidc-handoffs.prepared.json" with { type: "json" };

const repo = "veinyyxy/TechlongSoftware";
const runOncePath = contract.federatedTrust.runOnce.reusablePathCandidate;
const inspectPath = contract.federatedTrust.inspect.reusablePathCandidate;
export const firstOpenManagementReusablePath = ".github/workflows/sandbox-first-open-management-job-v1.yml";
const digest = /^[a-f0-9]{64}$/, commit = /^[a-f0-9]{40}$/, id = /^[1-9][0-9]{0,19}$/;
const fail = (code: string): never => { throw Error("FIRST_OPEN_RELEASE_" + code); };
type Role = "inspect" | "runonce" | "management";
export interface FirstOpenFrozenRelease {
  schema: "techlong/sandbox-first-open-release/v1";
  jobId: typeof contract.jobId;
  approvalSha256: string;
  callerCommit: string;
  runtimeCommit: string;
  runtimeSourceSha256: string;
  inspectorSeedSha256: string;
  /** Omitted only by the historical A/synthetic path. The real launcher requires it. */
  taskRelease?: FirstOpenTaskRelease;
  runOnceReusableCommit: string;
  inspectReusableCommit: string;
  managementReusableCommit: string;
  workflowId: string;
  actorId: string;
  nonce: string;
  startAt: number;
  claimBefore: number;
  applicationLoginBefore: number;
  writeBefore: number;
  completionReserveMs: number;
  phaseCutoffs: [number, number, number, number, number];
  /** Absolute UTC milliseconds. Real task releases only; never dispatch input. */
  lifecycleAuthoritySchedule?: { grantNotBefore: number; relockNotBefore: number };
}

export function firstOpenLifecycleAuthoritySchedule(release: FirstOpenFrozenRelease) {
  const schedule = release.lifecycleAuthoritySchedule;
  if (!release.taskRelease) {
    if (schedule !== undefined) return fail("LIFECYCLE_AUTHORITY_WINDOW");
    return undefined;
  }
  const t = release.phaseCutoffs;
  if (!schedule || Object.keys(schedule).sort().join(",") !== "grantNotBefore,relockNotBefore" ||
    !Array.isArray(t) || t.length !== 5 ||
    ![schedule.grantNotBefore, schedule.relockNotBefore, release.startAt, t[2], t[3], t[4], release.writeBefore,
      release.completionReserveMs].every(Number.isSafeInteger) || release.completionReserveMs <= 0 ||
    !(release.startAt < t[2] && t[2] < schedule.grantNotBefore && schedule.grantNotBefore < t[3] &&
      t[3] < schedule.relockNotBefore && schedule.relockNotBefore < t[4] && t[4] <= release.writeBefore - release.completionReserveMs)) {
    return fail("LIFECYCLE_AUTHORITY_WINDOW");
  }
  return Object.freeze({ grantNotBefore: schedule.grantNotBefore, relockNotBefore: schedule.relockNotBefore });
}

/** The expected outer digest must come from the separately reviewed protected
 * entry, never from the same dispatcher input as the untrusted document. */
export async function bindFirstOpenReleaseEntry(source: FirstOpenFrozenRelease, trustedSha: string, actual: {
  role: Role; ownRunId: string; inspectId: string; runOnceId: string;
  attempt: number; repository: string; ref: string; workflowId: string; actorId: string;
  callerCommit: string; runtimeCommit: string; runtimeSourceSha256: string; reusableRef: string; pairSha256: string;
  inspectorSessionArnSha256: string;
}) {
  const p = structuredClone(source), t = p.phaseCutoffs;
  if (p.schema !== "techlong/sandbox-first-open-release/v1" || p.jobId !== contract.jobId || !digest.test(trustedSha) ||
    await sha256Hex(p) !== trustedSha || ![p.approvalSha256, p.runtimeSourceSha256, p.inspectorSeedSha256, actual.inspectorSessionArnSha256].every(x => digest.test(x)) ||
    ![p.callerCommit, p.runtimeCommit, p.runOnceReusableCommit, p.inspectReusableCommit, p.managementReusableCommit].every(x => commit.test(x)) ||
    !id.test(p.workflowId) || p.actorId !== "14145707" || !/^[a-f0-9]{32}$/.test(p.nonce) ||
    !Array.isArray(t) || t.length !== 5 || ![p.startAt, p.claimBefore, p.applicationLoginBefore, p.writeBefore, p.completionReserveMs, ...t].every(Number.isSafeInteger) ||
    p.startAt <= 0 || p.claimBefore <= p.startAt || p.claimBefore >= p.applicationLoginBefore || p.applicationLoginBefore > p.writeBefore ||
    p.completionReserveMs < 1 || t.some((x, i) => x <= (i ? t[i - 1] : p.startAt)) ||
    t[0] > p.claimBefore || t[2] >= p.applicationLoginBefore || t[4] > p.writeBefore - p.completionReserveMs) return fail("SEAL_OR_WINDOW");
  const version = firstOpenVersion(p.taskRelease);
  if (p.taskRelease && (p.taskRelease.firstOpenScope.jobId !== p.jobId || version.releaseId === contract.releaseId)) {
    return fail("TASK_RELEASE");
  }
  if (p.taskRelease) await verifyFirstOpenTaskRelease(p.taskRelease);
  firstOpenLifecycleAuthoritySchedule(p);
  const runOnceRef = `${repo}/${runOncePath}@${p.runOnceReusableCommit}`, inspectRef = `${repo}/${inspectPath}@${p.inspectReusableCommit}`;
  const managementRef = `${repo}/${firstOpenManagementReusablePath}@${p.managementReusableCommit}`;
  const pairSha256 = await sha256Hex({ domain: contract.pairing.pairDomain, jobId: p.jobId, approvalSha256: p.approvalSha256,
    callerCommitSha: p.callerCommit, runtimeCommitSha: p.runtimeCommit,
    runOnceReusableRef: runOnceRef, inspectReusableRef: inspectRef, managementReusableRef: managementRef,
    pairNonce: p.nonce, approvedWindowSha256: trustedSha });
  if (!["inspect", "runonce", "management"].includes(actual.role) || actual.repository !== repo || actual.ref !== "refs/heads/main" ||
    actual.attempt !== 1 || actual.workflowId !== p.workflowId || actual.actorId !== p.actorId ||
    actual.callerCommit !== p.callerCommit || actual.runtimeCommit !== p.runtimeCommit || actual.runtimeSourceSha256 !== p.runtimeSourceSha256 ||
    actual.reusableRef !== ({ inspect: inspectRef, runonce: runOnceRef, management: managementRef })[actual.role] || actual.pairSha256 !== pairSha256 ||
    ![actual.inspectId, actual.runOnceId].every(x => id.test(x)) || actual.inspectId === actual.runOnceId ||
    actual.ownRunId !== (actual.role === "inspect" ? actual.inspectId : actual.runOnceId)) return fail("RUN_COORDINATES");
  const pair: FirstOpenHandoffPair = { pairSha256, approvalSha256: p.approvalSha256, runtimeSourceSha256: p.runtimeSourceSha256,
    callerCommit: p.callerCommit, workflowId: p.workflowId, actorId: p.actorId, runOnceId: actual.runOnceId, inspectId: actual.inspectId,
    startAt: p.startAt, writeBefore: p.writeBefore, phaseCutoffs: Object.freeze([...t]),
    inspectorSessionArnSha256: actual.inspectorSessionArnSha256,
    ...(p.taskRelease && { taskRelease: p.taskRelease }) };
  return Object.freeze({ pair: Object.freeze(pair), inspectorSeedSha256: p.inspectorSeedSha256,
    claimBefore: p.claimBefore, applicationLoginBefore: p.applicationLoginBefore });
}

/** Future protected root calls this only after authenticating its run and
 * loading the approved outer record. Transport consumes its frozen cutoffs. */
export async function firstOpenReleaseTransport(source: FirstOpenFrozenRelease, trustedSha: string,
  actual: Parameters<typeof bindFirstOpenReleaseEntry>[2] & { role: "runonce" | "inspect" },
  transport: Omit<Parameters<typeof firstOpenGitHubHandoff>[0], "pair" | "role" | "ownRunId" | "runtimeObservedNotBefore">) {
  const release = structuredClone(source);
  const frozen = await bindFirstOpenReleaseEntry(release, trustedSha, actual);
  return { ...frozen, wire: firstOpenGitHubHandoff({ ...transport, pair: frozen.pair, role: actual.role, ownRunId: actual.ownRunId,
    runtimeObservedNotBefore: firstOpenLifecycleAuthoritySchedule(release)?.relockNotBefore }) };
}

/** Render only. Reusable bytes can be prepared before the caller pins the
 * commit(s) that contain them. No refs or files are written. */
export function renderLockedFirstOpenJob(source: string, role: Role, runtimeCommit: string) {
  if (!["inspect", "runonce", "management"].includes(role) || !commit.test(runtimeCommit)) return fail("REUSABLE_SOURCE");
  return { path: ({ inspect: inspectPath, runonce: runOncePath, management: firstOpenManagementReusablePath })[role],
    text: source.replaceAll("__ROLE__", role).replaceAll("__RUNTIME_COMMIT__", runtimeCommit) };
}
export function renderLockedFirstOpenCaller(source: string, refs: { inspect: string; runonce: string; management: string }) {
  if (Object.hasOwn(refs, "evidence") || /evidence_sha|FIRST_OPEN_EVIDENCE_ONLY|__EVIDENCE/.test(source) ||
    ![refs.inspect, refs.runonce, refs.management].every(x => commit.test(x))) {
    return fail("CALLER_SOURCE");
  }
  return { path: contract.federatedTrust.callerPathCandidate,
    text: source.replaceAll("__INSPECT_REUSABLE_COMMIT__", refs.inspect).replaceAll("__RUNONCE_REUSABLE_COMMIT__", refs.runonce)
      .replaceAll("__MANAGEMENT_REUSABLE_COMMIT__", refs.management) };
}
