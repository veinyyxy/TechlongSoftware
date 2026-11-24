import assert from "node:assert/strict";
import test from "node:test";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { SANDBOX_FIRST_OPEN } from "../lib/deployments/execution/first-onboarding-run-once.ts";
import { hash as templateHash } from "../ops/temporary-idle/environment-cfn.mjs";
import { foundationTemplateV5, workerTrustV5 } from "../ops/cloud-worker/install/plan-v5.mjs";
import capsule from "../ops/cloud-worker/material/public-capsule-v5.json" with { type: "json" };
import identities from "../ops/aws-sandbox/cloudformation/first-open-fc41597f-identities.template.json" with { type: "json" };
import { assembleFirstOpenInstallHostPlan, firstOpenInstallHostSchedule, type FirstOpenInstallHostPlanInput } from "../ops/aws-sandbox/first-open-install-host-plan.ts";
import { firstOpenInstallStagingKeys } from "../ops/aws-sandbox/first-open-install-readback.ts";
import { firstOpenProvisionerChanges } from "../ops/aws-sandbox/first-open-provisioner-policy.ts";
import type { FirstOpenFrozenRelease } from "../ops/aws-sandbox/first-open-release-entry.ts";
import { firstOpenTaskReleaseFixture } from "./first-open-task-release-fixture.ts";

const base = Date.UTC(2030, 0, 1), at = (minute: number) => base + minute * 60_000;
const prefix = "arn:aws:cloudformation:ca-central-1:402010193138:stack/";
const sharedStack = prefix + "techlong-s3-bootstrap/8afbe1e0-9425-11f1-b06a-02ff648cb917";
const scheduleInput = { installStartAt: at(0), factsExpireAt: at(90), operatorAvailableUntil: at(90), formalStartAt: at(100), now: at(-3) };

test("publication, CFN, manual approval, observations, cleanup, and formal handoff have distinct hard windows", () => {
  const s = firstOpenInstallHostSchedule(scheduleInput);
  assert.equal(s.bucket.protect.startAt, base);
  assert.equal(s.owner["inspector-relock"].writeBefore - s.owner["inspector-grant"].startAt, 55 * 60_000);
  assert.equal(s.observer.issueBefore - s.observer.startAt, 10 * 60_000);
  assert.equal(s.observer.grantAt - s.staging.sharedObservation.before, 7 * 60_000);
  assert.equal(s.bucket.restore.startAt - s.owner["inspector-relock"].writeBefore, 4 * 60_000);
  assert.equal(s.endAt - s.bucket.restore.writeBefore, 12 * 60_000);
  for (const changed of [{ factsExpireAt: at(89) }, { operatorAvailableUntil: at(89) }, { formalStartAt: at(99) }, { now: at(-1) }]) {
    assert.throws(() => firstOpenInstallHostSchedule({ ...scheduleInput, ...changed }), /_WINDOW$/);
  }
});

function mailboxOriginal(): FirstOpenInstallHostPlanInput["mailboxOriginal"] {
  const t = foundationTemplateV5(capsule), role = t.Resources.WorkerRole.Properties;
  const trust = workerTrustV5("981c3af53a1a40999db715a10304562a69a0c4a3");
  const claim = trust.Statement[0].Condition.StringEquals;
  claim["token.actions.githubusercontent.com:job_workflow_ref"] =
    claim["token.actions.githubusercontent.com:job_workflow_ref"].replace("cloud-worker-job.yml", "cloud-worker-platform-job-v6.yml");
  Object.assign(claim, { "token.actions.githubusercontent.com:actor_id": "344813947" });
  role.AssumeRolePolicyDocument = trust;
  role.Policies[0].PolicyDocument.Statement.find((x: { Action: unknown }) => x.Action === "ecs:DescribeTaskDefinition")!.Resource = "*";
  return { stackId: prefix + "techlong-sandbox-cloud-worker-foundation-v5/308174f0-ca9e-11f1-a04d-02569e9287b5",
    template: JSON.parse(JSON.stringify(t)) as FirstOpenInstallHostPlanInput["mailboxOriginal"]["template"] };
}

async function fixture(): Promise<FirstOpenInstallHostPlanInput> {
  const { taskRelease } = await firstOpenTaskReleaseFixture(), runtime = "b".repeat(40);
  const release: FirstOpenFrozenRelease = { schema: "techlong/sandbox-first-open-release/v1", jobId: taskRelease.firstOpenScope.jobId,
    taskRelease, approvalSha256: "a".repeat(64), callerCommit: "c".repeat(40), runtimeCommit: runtime, runtimeSourceSha256: "b".repeat(64),
    inspectorSeedSha256: "c".repeat(64), runOnceReusableCommit: runtime, inspectReusableCommit: runtime, managementReusableCommit: runtime,
    actorId: "14145707", workflowId: "426525508", nonce: "d".repeat(32), startAt: at(100), claimBefore: at(116), applicationLoginBefore: at(126),
    writeBefore: at(160), completionReserveMs: 10 * 60_000, phaseCutoffs: [at(114), at(117), at(119), at(140), at(150)],
    lifecycleAuthoritySchedule: { grantNotBefore: at(134), relockNotBefore: at(147) } };
  const jobId = SANDBOX_FIRST_OPEN.jobId;
  // Simulated compiled shared output; public originals carry the real pinned hashes.
  const restore = { Metadata: { simulatedTemplateSize: "x".repeat(55_000) }, Resources: {
    ProvisionerRole: { Type: "AWS::IAM::Role", Properties: {
      RoleName: "TechlongSandboxProvisionerRole", AssumeRolePolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Deny" }] },
      ManagedPolicyArns: [{ Ref: "ProvisionerBoundary" }], PermissionsBoundary: { Ref: "ProvisionerBoundary" },
      Policies: [{ PolicyName: "FirstOpenFc41597fWriterLock", PolicyDocument: { Statement: [] } }],
    } },
    ProvisionerBoundary: { Type: "AWS::IAM::ManagedPolicy", Properties: {
      ManagedPolicyName: "TechlongSandboxProvisionerBoundary", PolicyDocument: { Statement: [] },
    } },
    TenantLifecycleTaskRole: { Type: "AWS::IAM::Role", Properties: {} },
    FirstOpenFc41597fLifecycleBoundary: { Type: "AWS::IAM::ManagedPolicy", Properties: {} },
  } };
  const grant = structuredClone(restore);
  grant.Resources.ProvisionerRole.Properties.Policies[0].PolicyName = "FirstOpenFc41597fWriterFence";
  const closed = templateHash(restore), opened = templateHash(grant), changes = firstOpenProvisionerChanges;
  const provisioner: FirstOpenInstallHostPlanInput["candidate"]["expectedTargets"]["provisioner"] = {
    grant, restore, grantSha256: await sha256Hex(grant), restoreSha256: await sha256Hex(restore),
    sizes: { boundary: 1, role: 1, trust: 1 }, changes, executionAuthorized: false,
    requiredProviderEvidence: ["TAG_ON_CREATE_WITHOUT_STANDALONE_TAG", "EXACT_ROLE_AND_BOUNDARY_READBACK"],
    policyLimits: { mailboxSlotNamesEnforcedByRunner: true, iamBoundsMailboxToApprovalAndDirection: true, iamEnforcesDynamoCasBody: false },
    grantTarget: { stackId: sharedStack, originalCanonicalSha256: closed, targetCanonicalSha256: opened, template: grant, expectedChanges: changes },
    relockTarget: { stackId: sharedStack, originalCanonicalSha256: opened, targetCanonicalSha256: closed, template: restore, expectedChanges: changes },
    relockRequiresCanonicalPreimageSha256: opened,
  };
  const staged = firstOpenInstallStagingKeys(release, provisioner, at(30), true);
  return { candidate: { jobId, installIntentSha256: release.approvalSha256, release, releaseSha256: await sha256Hex(release), expectedTargets: {
    provisioner, shared: { stackId: sharedStack, template: restore,
      originalCanonicalSha256: "5027c73de759e5ca8e753e3bc7735a46b6b77b7f4bf4358752733fee93994360", targetCanonicalSha256: closed,
      expectedChanges: [{ logicalId: "FirstOpenFc41597fLifecycleBoundary", action: "Add" },
        { logicalId: "TenantLifecycleTaskRole", action: "Modify", replacement: false }, { logicalId: "ProvisionerRole", action: "Modify", replacement: false }] },
  } }, mailboxOriginal: mailboxOriginal(), identitiesOriginal: {
    stackId: prefix + "techlong-sandbox-first-open-fc41597f-identities/483fa2e0-e42c-11f1-b49f-02ffcd94927f", template: identities,
  }, ownerReceipt: { sha256: "e".repeat(64), capturedAt: at(-9), completedAt: at(-8), expiresAt: at(90),
    stagingTargets: (["shared", "grant", "relock"] as const).map(phase => ({ phase, ...staged.targets[phase]! })) },
  installStartAt: at(0), operatorAvailableUntil: at(90), now: at(-3) };
}

test("same-task host plan derives protected bucket and five stages without claiming or inventing a VersionId", async () => {
  const input = await fixture(), p = await assembleFirstOpenInstallHostPlan(input);
  assert.equal(p.terminalReadback, "same-source-readonly-subprocess");
  assert.deepEqual(Object.keys(p.owner.phases), ["inspector-grant", "shared-predecessor", "provisioner-grant", "provisioner-relock", "inspector-relock"]);
  assert.equal(p.bucket.stagingTargets.length, 3);
  assert.ok(p.bucket.stagingTargets.every(stage => stage.key.includes(input.candidate.installIntentSha256)));
  assert.equal(p.readback.factsReceiptSha256, input.ownerReceipt.sha256);
  assert.equal(p.owner.phases["shared-predecessor"]?.deferredStagedVersion?.changeSetOriginalReadConsent, true);
  assert.ok(Object.values(p.owner.phases).every(phase => phase.stagedVersion === undefined));
  assert.equal(p.readback.stagingScope.sharedObservation?.before, p.owner.phases["provisioner-grant"].startAt);
  assert.equal(p.readback.window.grantAt - p.owner.phases["provisioner-grant"].writeBefore, 60_000);
});

test("stale, unbound, or mismatched receipts cannot produce an install contract", async () => {
  const p = await fixture();
  await assert.rejects(assembleFirstOpenInstallHostPlan({ ...p, ownerReceipt: { ...p.ownerReceipt, expiresAt: at(89) } }), /_WINDOW$/);
  await assert.rejects(assembleFirstOpenInstallHostPlan({ ...p, ownerReceipt: { ...p.ownerReceipt, capturedAt: at(-300) } }), /_FACTS$/);
  await assert.rejects(assembleFirstOpenInstallHostPlan({ ...p, ownerReceipt: { ...p.ownerReceipt, stagingTargets: [] } }), /_STAGING_FACTS$/);
  await assert.rejects(assembleFirstOpenInstallHostPlan({ ...p, candidate: { ...p.candidate, releaseSha256: "f".repeat(64) } }), /_RELEASE$/);
});
