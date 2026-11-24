import assert from "node:assert/strict";
import test from "node:test";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { firstOpenInstallInspectorPolicies, firstOpenInstallInspectorScope, type FirstOpenInstallStagingScope } from "../ops/aws-sandbox/first-open-install-inspector-scope.ts";
import { compileFirstOpenInstallInspectorTargets } from "../ops/aws-sandbox/first-open-owner-targets.ts";
import { firstOpenOwnerStageKey, firstOpenSharedPredecessorChangeSetName } from "../ops/aws-sandbox/first-open-owner-stage-proof.ts";
import type { FirstOpenFrozenRelease } from "../ops/aws-sandbox/first-open-release-entry.ts";
import identities from "../ops/aws-sandbox/cloudformation/first-open-fc41597f-identities.template.json" with { type: "json" };
import { firstOpenTaskReleaseFixture } from "./first-open-task-release-fixture.ts";

const epoch = Date.UTC(2027, 0, 1), approvalSha256 = "e".repeat(64);
const window = { startAt: epoch, issueBefore: epoch + 120_000, grantAt: epoch + 420_000, grantBefore: epoch + 540_000,
  relockAt: epoch + 600_000, relockBefore: epoch + 720_000, factsCutoff: epoch + 3_600_000 };
const target = (byte: string) => ({ targetBytes: 58_901, targetCanonicalSha256: byte.repeat(64) });
const stage = { readBefore: epoch + 180_000, targets: { grant: target("a"), relock: target("b") } };
const sharedStage = { ...stage, targets: { ...stage.targets, shared: target("c") },
  sharedObservation: { at: epoch + 240_000, before: epoch + 360_000 } };

async function fixture() {
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  const release = { schema: "techlong/sandbox-first-open-release/v1", jobId: taskRelease.firstOpenScope.jobId,
    approvalSha256, inspectorSeedSha256: "d".repeat(64), actorId: "14145707", inspectReusableCommit: "c".repeat(40),
    startAt: epoch + 1_200_000, writeBefore: epoch + 3_600_000, taskRelease } as FirstOpenFrozenRelease;
  return { release, releaseSha256: await sha256Hex(release) };
}

test("one sealed shared-predecessor key and time-bound change set augment the existing install Inspector only", async () => {
  const { release, releaseSha256 } = await fixture();
  const base = await firstOpenInstallInspectorScope(release, releaseSha256, window, stage);
  const scope = await firstOpenInstallInspectorScope(release, releaseSha256, window, sharedStage);
  const sharedName = `fc41597f-install-shared-${approvalSha256.slice(0, 24)}-prepare`;
  const sharedKey = `first-open-management/${release.jobId}/${approvalSha256}/install-owner/install/shared-predecessor/${sharedStage.targets.shared.targetCanonicalSha256}.json`;
  assert.equal(firstOpenSharedPredecessorChangeSetName(approvalSha256), sharedName);
  assert.equal(firstOpenOwnerStageKey({ approvalSha256, phase: "shared-predecessor", ...sharedStage.targets.shared }), sharedKey);
  assert.throws(() => firstOpenSharedPredecessorChangeSetName("*"), /KEY_SCOPE/);
  assert.deepEqual(scope.changeSetNames, base.changeSetNames);
  assert.equal(scope.staging?.targets.shared?.key, sharedKey);
  assert.deepEqual(scope.staging?.sharedObservation, { ...sharedStage.sharedObservation, changeSetName: sharedName });
  assert.notEqual(await sha256Hex(base), await sha256Hex(scope));
  assert.equal(Object.hasOwn(base.staging!, "sharedObservation"), false);

  const approvedScopeSha256 = await sha256Hex(scope);
  const policy = await firstOpenInstallInspectorPolicies(release, releaseSha256, window, approvedScopeSha256, sharedStage);
  const basePolicy = await firstOpenInstallInspectorPolicies(release, releaseSha256, window, await sha256Hex(base), stage);
  assert.deepEqual(policy.trust, basePolicy.trust);
  assert.deepEqual(policy.relock, basePolicy.relock);
  const rows = policy.active as Record<string, unknown>[];
  const describes = rows.filter(p => p.Action === "cloudformation:DescribeChangeSet" ||
    Array.isArray(p.Action) && p.Action.includes("cloudformation:DescribeChangeSet"));
  const t = (n: number) => ({ "aws:CurrentTime": new Date(n).toISOString() });
  const user = { "aws:userid": `${scope.roleId}:${scope.roleSessionName}` };
  const exact = "cloudformation:ChangeSetName";
  assert.deepEqual(describes.find(p => p.Effect === "Allow")?.Resource, scope.ownerStackArn);
  assert.deepEqual(describes.find(p => p.Effect === "Allow")?.Condition, {
    StringEquals: { ...user, "aws:FederatedProvider": scope.provider, "aws:RequestedRegion": "ca-central-1", [exact]: [...scope.changeSetNames, sharedName] },
    DateGreaterThanEquals: t(window.startAt), DateLessThan: t(window.relockBefore),
  });
  assert.ok(describes.some(p => p.Effect === "Deny" && p.NotResource === scope.ownerStackArn));
  const denies = describes.filter(p => p.Effect === "Deny" && (p.Resource === scope.ownerStackArn || p.Resource === "*")).map(p => p.Condition);
  assert.deepEqual(denies, [
    { StringEquals: user, StringNotEquals: { [exact]: [...scope.changeSetNames, sharedName] } },
    { StringEquals: { ...user, [exact]: sharedName }, DateLessThan: t(sharedStage.sharedObservation.at) },
    { StringEquals: { ...user, [exact]: sharedName }, DateGreaterThanEquals: t(sharedStage.sharedObservation.before) },
  ]);
  const stageObjects = rows.find(p => p.Effect === "Allow" && JSON.stringify(p.Action) === '["s3:GetObjectVersion"]')?.Resource;
  assert.deepEqual(stageObjects, Object.values(scope.staging!.targets).map(p => `${scope.evidenceBucketArn}/${p.key}`));
  assert.doesNotMatch(JSON.stringify(basePolicy.active), /shared-predecessor|install-shared/);
  const original = { stackId: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-first-open-fc41597f-identities/483fa2e0-e42c-11f1-b49f-02ffcd94927f", template: identities };
  const rendered = await compileFirstOpenInstallInspectorTargets({ original, release, releaseSha256, window,
    approvedScopeSha256, staging: sharedStage }, epoch - 1);
  assert.deepEqual(rendered.grant.expectedChanges, [{ logicalId: "LockedInspectorRole", action: "Modify", replacement: false }]);
  assert.equal(rendered.executionAuthorized, false);
});

test("missing, malformed, late or unpinned shared installation observations fail closed", async () => {
  const { release, releaseSha256 } = await fixture();
  const o = sharedStage.sharedObservation;
  const invalid: FirstOpenInstallStagingScope[] = [
    { ...stage, sharedObservation: o }, { ...stage, targets: sharedStage.targets },
    { ...sharedStage, sharedObservation: { ...o, at: stage.readBefore } },
    { ...sharedStage, sharedObservation: { ...o, at: o.before } },
    { ...sharedStage, sharedObservation: { ...o, before: window.grantAt } },
    { ...sharedStage, sharedObservation: { ...o, before: Number.NaN } },
    { ...sharedStage, sharedObservation: { ...o, changeSetName: "untrusted" } as typeof o },
    { ...sharedStage, targets: { shared: { ...target("c"), targetBytes: 51_200 } } },
  ];
  for (const staging of invalid) await assert.rejects(firstOpenInstallInspectorScope(release, releaseSha256, window, staging), /SCOPE/);
  const scope = await firstOpenInstallInspectorScope(release, releaseSha256, window, sharedStage);
  await assert.rejects(firstOpenInstallInspectorPolicies(release, releaseSha256, window, await sha256Hex(scope),
    { ...sharedStage, sharedObservation: { ...o, at: o.at + 1 } }), /SCOPE/);
});
