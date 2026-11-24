import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { SANDBOX_FIRST_OPEN as fixed } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { hash as templateHash } from "../temporary-idle/environment-cfn.mjs";
import { firstOpenInstallBucketStack, firstOpenInstallBucketTargets } from "./first-open-install-bucket-executor.ts";
import { firstOpenInstallInspectorScope, type FirstOpenInstallStagingScope, type FirstOpenInstallWindow } from "./first-open-install-inspector-scope.ts";
import { bindFirstOpenInstallOwnerExecutor, type FirstOpenInstallOwnerExecutorPlan } from "./first-open-install-owner-executor.ts";
import { buildFirstOpenInstallReadbackPlan, firstOpenInstallStagingKeys } from "./first-open-install-readback.ts";
import { firstOpenInstallSourceSessionPolicy, type FirstOpenInstallSequencePlan } from "./first-open-install-sequence.ts";
import { compileFirstOpenInstallInspectorTargets, type compileFirstOpenOwnerTargets } from "./first-open-owner-targets.ts";
import { firstOpenLifecycleAuthoritySchedule, type FirstOpenFrozenRelease } from "./first-open-release-entry.ts";

const minute = 60_000;
const phases = { shared: "shared-predecessor", grant: "provisioner-grant", relock: "provisioner-relock" } as const;
const digest = /^[0-9a-f]{64}$/, commit = /^[0-9a-f]{40}$/;
const time = (x: number) => Number.isSafeInteger(x) && x > 0;
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function need(value: unknown, part: string): asserts value {
  if (!value) throw Error("FIRST_OPEN_INSTALL_HOST_PLAN_" + part);
}
type Window = { startAt: number; writeBefore: number };
type Rendered = Awaited<ReturnType<typeof compileFirstOpenOwnerTargets>>;
type Phase = NonNullable<FirstOpenInstallOwnerExecutorPlan["phases"]["shared-predecessor"]>;
type Provisioner = NonNullable<Rendered["provisioner"]>;
type Original = Parameters<typeof compileFirstOpenInstallInspectorTargets>[0]["original"];
export type FirstOpenInstallHostCandidate = {
  jobId: typeof fixed.jobId;
  installIntentSha256: string;
  release: FirstOpenFrozenRelease;
  releaseSha256: string;
  expectedTargets: { shared: Rendered["shared"]; provisioner: Provisioner };
};
export type FirstOpenInstallHostOwnerReceipt = {
  /** Raw SHA of the separately authenticated exact owner observation. */
  sha256: string;
  capturedAt: number;
  completedAt: number;
  expiresAt: number;
  /** Exact canonical staging coordinates pinned by the separately verified read gate. */
  stagingTargets: readonly { phase: keyof typeof phases; key: string; targetCanonicalSha256: string; targetBytes: number }[];
};
export type FirstOpenInstallHostScheduleInput = {
  installStartAt: number;
  operatorAvailableUntil: number;
  factsExpireAt: number;
  formalStartAt: number;
  now?: number;
};
export type FirstOpenInstallHostPlanInput = {
  candidate: FirstOpenInstallHostCandidate;
  mailboxOriginal: Original;
  identitiesOriginal: Original;
  ownerReceipt: FirstOpenInstallHostOwnerReceipt;
  installStartAt: number;
  operatorAvailableUntil: number;
  now?: number;
};

/**
 * Calendar fences, not estimates of CloudFormation or Actions latency. Never
 * spend the approval/artifact interval as the Source Grant interval. Terminal
 * observations and known-owned GitHub cleanup each get their own reserve.
 */
export function firstOpenInstallHostSchedule(input: FirstOpenInstallHostScheduleInput) {
  const { installStartAt, operatorAvailableUntil, factsExpireAt, formalStartAt, now = Date.now() } = input;
  const at = (m: number) => installStartAt + m * minute;
  const window = (start: number, end: number): Window => ({ startAt: at(start), writeBefore: at(end) });
  const endAt = at(90);
  need([installStartAt, operatorAvailableUntil, factsExpireAt, formalStartAt, now, endAt].every(time) &&
    now + 2 * minute <= installStartAt && endAt <= operatorAvailableUntil && endAt <= factsExpireAt &&
    at(100) <= formalStartAt, "WINDOW");
  const bucket = { protect: window(0, 8), restore: window(69, 78) };
  const owner = { "inspector-grant": window(10, 17), "shared-predecessor": window(30, 36), "provisioner-grant": window(39, 45),
    "provisioner-relock": window(48, 54), "inspector-relock": window(58, 65) };
  const observer: FirstOpenInstallWindow = { startAt: at(17), issueBefore: at(27), grantAt: at(46), grantBefore: at(48),
    relockAt: at(55), relockBefore: at(57), factsCutoff: endAt };
  return { endAt, bucket, owner, observer, staging: { readBefore: at(30), sharedObservation: { at: at(37), before: at(39) } } };
}

/** Bind the exact candidate and already-verified owner facts; no API, files, or execution authorization. */
export async function assembleFirstOpenInstallHostPlan(input: FirstOpenInstallHostPlanInput): Promise<FirstOpenInstallSequencePlan> {
  const { candidate, mailboxOriginal, identitiesOriginal, ownerReceipt, installStartAt, operatorAvailableUntil,
    now = Date.now() } = structuredClone(input);
  const { jobId, release, installIntentSha256, releaseSha256, expectedTargets: { shared, provisioner } } = candidate;
  need(jobId === fixed.jobId && release.jobId === jobId && release.schema === "techlong/sandbox-first-open-release/v1" &&
    release.actorId === "14145707" && release.workflowId === "426525508" &&
    [installIntentSha256, release.runtimeSourceSha256, release.inspectorSeedSha256, releaseSha256].every(x => digest.test(x)) &&
    release.approvalSha256 === installIntentSha256 && await sha256Hex(release) === releaseSha256 &&
    [release.callerCommit, release.runtimeCommit].every(x => commit.test(x)) &&
    [release.inspectReusableCommit, release.managementReusableCommit, release.runOnceReusableCommit].every(x => x === release.runtimeCommit) &&
    release.taskRelease?.firstOpenScope.jobId === jobId && release.writeBefore - release.startAt === 60 * minute &&
    release.completionReserveMs >= 10 * minute, "RELEASE");
  firstOpenLifecycleAuthoritySchedule(release);
  need(digest.test(ownerReceipt.sha256) && [ownerReceipt.capturedAt, ownerReceipt.completedAt, ownerReceipt.expiresAt].every(time) &&
    ownerReceipt.capturedAt <= ownerReceipt.completedAt && ownerReceipt.completedAt <= now &&
    ownerReceipt.expiresAt <= ownerReceipt.capturedAt + 5 * 60 * minute, "FACTS");
  const timing = firstOpenInstallHostSchedule({ installStartAt, operatorAvailableUntil, now,
    formalStartAt: release.startAt, factsExpireAt: ownerReceipt.expiresAt });
  const stage = firstOpenInstallStagingKeys(release, provisioner, timing.staging.readBefore, true);
  const stages = (Object.keys(phases) as (keyof typeof phases)[]).map(phase => {
    const target = stage.targets[phase];
    need(target, "STAGING_TARGETS");
    return { phase, ...target };
  });
  need(Array.isArray(ownerReceipt.stagingTargets) && ownerReceipt.stagingTargets.length === stages.length &&
    stages.every(s => ownerReceipt.stagingTargets.some(p => same(p, s))), "STAGING_FACTS");
  const stagingScope: FirstOpenInstallStagingScope = {
    ...timing.staging, targets: Object.fromEntries(stages.map(({ phase, targetBytes, targetCanonicalSha256 }) =>
      [phase, { targetBytes, targetCanonicalSha256 }])),
  };
  const { grantTarget, relockTarget } = provisioner;
  need(mailboxOriginal.stackId === firstOpenInstallBucketStack && provisioner.executionAuthorized === false &&
    shared.stackId === grantTarget.stackId && shared.stackId === relockTarget.stackId &&
    templateHash(shared.template) === shared.targetCanonicalSha256 && templateHash(provisioner.restore) === shared.targetCanonicalSha256 &&
    templateHash(provisioner.grant) === grantTarget.targetCanonicalSha256 &&
    same(grantTarget.template, provisioner.grant) && same(relockTarget.template, provisioner.restore), "TARGET_CHAIN");
  const bucket: FirstOpenInstallSequencePlan["bucket"] = { schema: "techlong/fc41597f-install-bucket-retention/v1",
    jobId, installIntentSha256, ownerReadReceiptSha256: ownerReceipt.sha256, factsExpireAt: timing.endAt,
    original: mailboxOriginal.template, stagingTargets: stages.map(s => ({ ...s, phase: phases[s.phase] })), phases: timing.bucket };
  const bucketTargets = firstOpenInstallBucketTargets(bucket);
  const expectedBucketSha256 = await sha256Hex(bucketTargets.protected.template.Resources.EvidencePolicy.Properties.PolicyDocument);
  const scope = await firstOpenInstallInspectorScope(release, releaseSha256, timing.observer, stagingScope);
  const authorityScopeSha256 = await sha256Hex(scope);
  const inspector = await compileFirstOpenInstallInspectorTargets({ original: identitiesOriginal, release, releaseSha256,
    window: timing.observer, approvedScopeSha256: authorityScopeSha256, staging: stagingScope }, now);
  const phased = (key: keyof typeof timing.owner, transition: Phase["transition"],
    sourceStackStatus: Phase["sourceStackStatus"], stage = false): Phase => ({
    ...timing.owner[key],
    // Match the sealed JSON representation, not JS alias identity reused by the pure renderers.
    transition: { ...transition, template: JSON.parse(canonicalJson(transition.template)) as Phase["transition"]["template"] },
    sourceStackStatus, ...(stage && { deferredStagedVersion: { changeSetOriginalReadConsent: true } }),
  });
  const owner: FirstOpenInstallOwnerExecutorPlan = { schema: "techlong/fc41597f-install-owner-transitions/v2",
    jobId, approvalSha256: installIntentSha256, factsExpireAt: timing.endAt, phases: {
      "inspector-grant": phased("inspector-grant", inspector.grant, "CREATE_COMPLETE"),
      "shared-predecessor": phased("shared-predecessor", shared, "UPDATE_COMPLETE", true),
      "provisioner-grant": phased("provisioner-grant", grantTarget, "UPDATE_COMPLETE", true),
      "provisioner-relock": phased("provisioner-relock", relockTarget, "UPDATE_COMPLETE", true),
      "inspector-relock": phased("inspector-relock", inspector.relock, "UPDATE_COMPLETE"),
    },
  };
  const readback = { release, releaseSha256, authorityScopeSha256, factsReceiptSha256: ownerReceipt.sha256,
    window: timing.observer, expectedBucketSha256, targets: provisioner };
  // The observer plan's final scope and version ACKs are derived by sequence at
  // runtime; validate the template projections now but do not invent version IDs.
  await buildFirstOpenInstallReadbackPlan({ ...readback,
    authorityScopeSha256: await sha256Hex(await firstOpenInstallInspectorScope(release, releaseSha256, timing.observer)) });
  const noIo = async () => { throw Error("FIRST_OPEN_INSTALL_HOST_PLAN_OFFLINE_ONLY"); };
  await bindFirstOpenInstallOwnerExecutor({ plan: owner, approvedPlanSha256: await sha256Hex(owner),
    ports: { identify: noIo, describeStack: noIo, getOriginal: noIo, getChangeSetOriginal: noIo,
      create: noIo, describeChange: noIo, execute: noIo },
    journal: { consume: noIo, record: noIo, requirePrerequisite: noIo } });
  return { schema: "techlong/fc41597f-install-sequence/v1", terminalReadback: "same-source-readonly-subprocess", sourceSessionPolicy: firstOpenInstallSourceSessionPolicy,
    bucket, owner, readback: { ...readback, stagingScope } };
}
