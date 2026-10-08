import assert from "node:assert/strict";
import test from "node:test";
import { compileLegacyPlanIsolationReview, LEGACY_PLAN_TARGET, LEGACY_PLAN_ENVIRONMENT, type LegacyPlanIsolationEvidence } from "../lib/deployments/execution/legacy-plan-isolation-review.ts";

function evidence(): LegacyPlanIsolationEvidence {
  return { deploymentId: LEGACY_PLAN_TARGET, environmentId: LEGACY_PLAN_ENVIRONMENT, mode: "plan_only", status: "planned", cellKey: "cell-demo-1",
    attempts: 0, updatedAt: 1786224893896, appInstanceId: "app_fb1962e93a9a4cc2acf046170593d9e3", instanceStatus: "pending", subscriptionStatus: "active",
    deploymentRowSha256: "a".repeat(64), businessStateSha256: "b".repeat(64), immutableEnvironmentTriggerSha256: "c".repeat(64), environmentReferenceImmutable: true,
    planSafety: { applyEnabled: false, createsAwsResources: false, storesSecretValues: false },
    relations: { instanceDeploymentCount: 1, jobCount: 0, resourceCount: 0, capacityCount: 0, scheduleCount: 0, stepCount: 0 },
    environmentCounts: { activeTenantCount: 1, nonterminalDeploymentCount: 1, capacityCount: 0, liveResourceCount: 0, nonterminalScheduleCount: 0 },
    databaseObservedAt: "2026-10-08T13:00:00.000Z" };
}
test("review preserves active business and original row; a candidate is never execution permission", async () => {
  const review = await compileLegacyPlanIsolationReview(evidence());
  assert.equal(review.outcome, "SEALED_PLAN_REGISTRY_CANDIDATE_REQUIRES_NEW_SCHEMA_REVIEW");
  assert.equal(review.executionAuthorized, false); assert.equal(review.customerInstanceMutationAllowed, false); assert.equal(review.subscriptionMutationAllowed, false);
  assert.equal(review.originalDeploymentDeletionAllowed, false); assert.equal(review.directEnvironmentIdMoveAllowed, false); assert.equal(review.disableExistingTriggersAllowed, false);
  assert.equal(review.recommendedDesign?.currentZeroTenantQueryUnchanged, true); assert.equal(review.evidence.environmentCounts.activeTenantCount, 1);
  assert.equal(review.evidence.subscriptionStatus, "active"); assert.match(review.reviewSha256, /^[a-f0-9]{64}$/);
});
test("any job, resource, reservation, schedule or step blocks isolation qualification", async () => {
  for (const key of ["jobCount", "resourceCount", "capacityCount", "scheduleCount", "stepCount"] as const) {
    const sample = evidence(); sample.relations[key] = 1;
    const result = await compileLegacyPlanIsolationReview(sample); assert.equal(result.outcome, "BLOCKED_NOT_AN_EMPTY_NONEXECUTING_PLAN"); assert.equal(result.recommendedDesign, null);
  }
});
test("running modes, attempts, multiple deployments or unproved immutability are not eligible", async () => {
  for (const change of [{ mode: "aws_sandbox" }, { status: "queued" }, { attempts: 1 }, { environmentReferenceImmutable: false }]) {
    assert.equal((await compileLegacyPlanIsolationReview({ ...evidence(), ...change })).recommendedDesign, null);
  }
  const sample = evidence(); sample.relations.instanceDeploymentCount = 2;
  assert.equal((await compileLegacyPlanIsolationReview(sample)).recommendedDesign, null);
});
test("unsafe original plan flags cannot be treated as nonexecuting planning metadata", async () => {
  for (const key of ["applyEnabled", "createsAwsResources", "storesSecretValues"] as const) {
    const sample = evidence(); sample.planSafety[key] = true;
    assert.equal((await compileLegacyPlanIsolationReview(sample)).recommendedDesign, null);
  }
});
test("exact old record/environment, byte pins and nonnegative counters are mandatory", async () => {
  for (const change of [{ deploymentId: "foreign" }, { environmentId: "foreign" }, { deploymentRowSha256: "x" }, { updatedAt: -1 }])
    await assert.rejects(compileLegacyPlanIsolationReview({ ...evidence(), ...change }));
  const sample = evidence(); sample.environmentCounts.activeTenantCount = -1; await assert.rejects(compileLegacyPlanIsolationReview(sample));
  await assert.rejects(compileLegacyPlanIsolationReview({ ...evidence(), deploymentRowSha256: ["a".repeat(64)] as unknown as string }));
  await assert.rejects(compileLegacyPlanIsolationReview({ ...evidence(), instanceStatus: 0 as unknown as string }));
  await assert.rejects(compileLegacyPlanIsolationReview({ ...evidence(), subscriptionStatus: {} as unknown as string }));
  await assert.rejects(compileLegacyPlanIsolationReview({ ...evidence(), relations: { ...evidence().relations, unreviewed: 0 } } as LegacyPlanIsolationEvidence));
});
test("snapshot input mutation cannot change the reviewed business state after hashing begins", async () => {
  const input = evidence(); const pending = compileLegacyPlanIsolationReview(input); input.instanceStatus = "suspended"; input.relations.jobCount = 99;
  const review = await pending; assert.equal(review.evidence.instanceStatus, "pending"); assert.equal(review.evidence.relations.jobCount, 0);
  assert.throws(() => { review.evidence.relations.jobCount = 1; }, TypeError);
  assert.throws(() => { review.requiredIndependentApprovals.push("unexpected"); }, TypeError);
});
