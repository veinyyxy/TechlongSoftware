import assert from "node:assert/strict";
import test from "node:test";
import {
  FIRST_ONBOARDING_HOLD_AT, FIRST_ONBOARDING_PREFIX, buildFirstOnboardingJob, isFirstOnboardingScope,
  loadFirstOnboardingReview, reviewFirstOnboarding, SELECT_FIRST_ONBOARDING, type FirstOnboardingReviewFacts,
} from "../lib/deployments/first-onboarding.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { buildDeploymentClaimStatement } from "../lib/deployments/lease.ts";

const accountId = "111111111111", productId = "prd_restaurant_order_system";
const repository = `${accountId}.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast`;
const manifestDigest = `sha256:${"a".repeat(64)}`;
const environment = { key: "aws-sandbox-ca-central-1", kind: "aws_sandbox", region: "ca-central-1", cellKey: "cell-sandbox-1" } as const;
const configuration = { property: "synthetic" }, desiredPlan = { mode: "aws_sandbox" };

async function fixture() {
  const scope = { appInstanceId: "app_test", workspaceId: "workspace_test", tenantKey: "tenant_test", subscriptionId: "sub_test",
    environmentId: "env_test", accountId, planId: "plan_test", templateVersionId: "version_test", releaseId: "release_" + "a".repeat(32),
    artifactRef: `${repository}@${manifestDigest}`, configurationHash: await sha256Hex(configuration), planHash: await sha256Hex(desiredPlan) };
  const held = await buildFirstOnboardingJob(scope);
  assert.ok(held);
  const facts: FirstOnboardingReviewFacts = { scope, instancePendingFirstOpen: true, subscriptionActiveAndCurrent: true,
    scopeStillEligible: true, noOtherDeploymentOrTenantGeneration: true,
    deployment: { id: held.deploymentId, status: "planned", planHash: scope.planHash, configurationHash: scope.configurationHash, artifactRef: scope.artifactRef },
    job: { id: held.jobId, deploymentId: held.deploymentId, dedupeKey: held.dedupeKey, jobType: "apply", status: "pending", payload: held.payload,
      attempts: 0, maxAttempts: 1, availableAt: held.availableAt, leaseOwner: null, leaseToken: null, leaseExpiresAt: null, completedAt: null },
    release: { id: scope.releaseId, productId, component: "tenant_api", version: "test-v1", status: "ecr_verified",
      source: { repository: "synthetic", commit: "b".repeat(40), buildRunId: "1", buildAttempt: 1, artifactSha256: "c".repeat(64) },
      image: { repository, manifestDigest, platformDigest: manifestDigest, verificationSha256: "d".repeat(64), runtimePlatform: "linux/amd64" },
      compatibility: { databaseProfiles: ["express_iam"], schemaVersions: ["synthetic"], clientApiVersions: [], applicationPort: 3000, requiresMigration: false, startupWrites: false } } };
  return { scope, held, facts };
}

test("only sandbox standard restaurant is eligible and only exact ECR digests can enter a held request", async () => {
  const { scope } = await fixture();
  assert.ok(isFirstOnboardingScope(environment, productId, "standard-v1"));
  for (const other of [{ ...environment, kind: "aws_production" as const }, { ...environment, cellKey: "other-cell" }])
    assert.equal(isFirstOnboardingScope(other, productId, "standard-v1"), false);
  assert.equal(isFirstOnboardingScope(environment, productId, "large-v1"), false);
  assert.equal(isFirstOnboardingScope(environment, "other-product", "standard-v1"), false);
  for (const artifactRef of [null, `${repository}:latest`, scope.artifactRef.replace(accountId, "222222222222")])
    assert.equal(await buildFirstOnboardingJob({ ...scope, artifactRef }), null);
});

test("repeated payment, changed configuration or changed subscription cannot mint a second first-generation slot", async () => {
  const { scope, held } = await fixture();
  assert.deepEqual(await buildFirstOnboardingJob(scope), held);
  for (const source of [{ ...scope, configurationHash: "f".repeat(64) }, { ...scope, subscriptionId: "sub_next" }]) {
    const again = await buildFirstOnboardingJob(source);
    assert.ok(again);
    assert.equal(again.jobId, held.jobId);
    assert.equal(again.deploymentId, held.deploymentId);
    assert.notDeepEqual(again.payload, held.payload);
  }
  assert.equal(held.payload.scope.generation, 1);
  assert.equal(held.availableAt, FIRST_ONBOARDING_HOLD_AT);
  assert.equal(held.payload.cloudExecutionAuthorized, false);
});

test("read-only review binds the actual verified catalog entry and keeps execution closed", async () => {
  const { facts, held, scope } = await fixture();
  const review = await reviewFirstOnboarding(facts);
  assert.ok(review);
  assert.equal(review.jobId, held.jobId);
  assert.equal(review.catalogSha256, await sha256Hex(facts.release));
  assert.equal(review.cloudExecutionAuthorized, false);
  const row = { ...scope, ...facts, configuration, desiredPlan, slug: "tenant-test", subscriptionEnd: Number.MAX_SAFE_INTEGER };
  let reads = 0;
  const readOne = async (sql: string, params: [string]) => { assert.equal(sql, SELECT_FIRST_ONBOARDING); assert.deepEqual(params, [held.jobId]); return row; };
  const readRelease = async (id: string) => { assert.equal(id, scope.releaseId); reads++; return facts.release; };
  assert.deepEqual(await loadFirstOnboardingReview(held.jobId, { readOne, readRelease }), review);
  for (const changed of [
    { subscriptionActiveAndCurrent: false }, { configuration: { property: "changed" } },
    { desiredPlan: { mode: "plan_only" } }, { job: { ...row.job, attempts: 1 } },
  ]) assert.equal(await loadFirstOnboardingReview(held.jobId, { readOne: async () => ({ ...row, ...changed }), readRelease }), null);
  assert.equal(reads, 1);
});

test("active, stale, historical, initialized, and previously leased work cannot become first-open material", async () => {
  const { facts } = await fixture();
  for (const changed of [
    { instancePendingFirstOpen: false }, { subscriptionActiveAndCurrent: false }, { noOtherDeploymentOrTenantGeneration: false },
    { deployment: { ...facts.deployment, status: "ready" } },
    { job: { ...facts.job, payload: { schemaVersion: 1, deploymentId: facts.deployment.id } } },
    { job: { ...facts.job, payload: { kind: "express_initialized_request_v4" } } },
    { job: { ...facts.job, status: "running", attempts: 1, leaseOwner: "another-worker" } },
    { job: { ...facts.job, status: "pending", attempts: 1 } },
  ]) assert.equal(await reviewFirstOnboarding({ ...facts, ...changed }), null);
});

test("an unverified, revoked, swapped, or incompatible release is never ready to review", async () => {
  const { facts } = await fixture();
  const r = facts.release!;
  for (const release of [null, { ...r, status: "candidate" as const }, { ...r, status: "revoked" as const },
    { ...r, image: { ...r.image, manifestDigest: `sha256:${"f".repeat(64)}` } },
    { ...r, compatibility: { ...r.compatibility, databaseProfiles: [] } },
  ]) assert.equal(await reviewFirstOnboarding({ ...facts, release }), null);
});

test("ordinary claims explicitly exclude held jobs independently of their availability timestamp", () => {
  const args = { workerId: "worker:test", now: 1000, leaseDurationMs: 5000, leaseToken: `lease_${"a".repeat(32)}` };
  const sql = buildDeploymentClaimStatement({ ...args, jobType: "apply" }).sql;
  assert.ok(sql.includes(`left(candidate_job.dedupe_key, ${FIRST_ONBOARDING_PREFIX.length}) <> '${FIRST_ONBOARDING_PREFIX}'`));
  assert.ok(sql.includes(`left(deployment_jobs.dedupe_key, ${FIRST_ONBOARDING_PREFIX.length}) <> '${FIRST_ONBOARDING_PREFIX}'`));
});
