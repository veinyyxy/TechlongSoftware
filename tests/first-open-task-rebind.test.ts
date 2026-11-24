import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildFirstOnboardingJob } from "../lib/deployments/first-onboarding.ts";
import { firstOpenMiddleOperationHash } from "../lib/deployments/execution/first-onboarding-middle.ts";
import { firstOpenSqlJson } from "../lib/deployments/execution/first-onboarding-sql-value.ts";
import { firstOpenVersion } from "../lib/deployments/execution/first-onboarding-version.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { firstOpenManagementNeonDraft } from "../ops/aws-sandbox/first-open-management-install.ts";
import prepared from "../ops/aws-sandbox/first-open-fc41597f-remaining-install.prepared.json" with { type: "json" };
import { firstOpenNeonReserveStatements } from "../ops/aws-sandbox/first-open-neon-install.ts";
import { firstOpenTaskRebindStatements, verifyFirstOpenTaskRebindReadback } from "../ops/aws-sandbox/first-open-task-rebind.ts";
import { firstOpenTaskReleaseFixture } from "./first-open-task-release-fixture.ts";

test("only the original held-task preimage can render the one-transaction, case-only rebind", async () => {
  const { originalA, trusted, taskRelease } = await firstOpenTaskReleaseFixture();
  const { scope } = prepared;
  const h = await buildFirstOnboardingJob({ appInstanceId: scope.instanceId, workspaceId: "wsp_beb2aa5868a9d1c10c257348",
    subscriptionId: scope.subscriptionId, environmentId: scope.environmentId, planId: "pln_offline_fixture",
    templateVersionId: "tplver_offline_fixture", tenantKey: "pending_" + scope.instanceId, planHash: scope.planSha256,
    configurationHash: scope.configurationSha256, releaseId: scope.releaseId, artifactRef: scope.artifactRef, accountId: scope.accountId });
  assert.ok(h);
  const material = { payload: h.payload, jobId: h.jobId, catalogSha256: await sha256Hex(originalA), platformDigest: originalA.image.platformDigest };
  const oldReview = { ...material, reviewSha256: await sha256Hex(material), cloudExecutionAuthorized: false as const };
  const now = Date.parse("2026-11-21T21:35:00Z");
  const input = { oldReview, originalRelease: originalA, taskRelease, trustedPublication: trusted,
    approvedTaskReleaseSha256: await sha256Hex(taskRelease), writeBefore: now + 20 * 60_000 };
  const result = await firstOpenTaskRebindStatements(input, now);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.standaloneTransactions, 1);
  assert.equal(result.jobId, h.jobId);
  const projected = { ...h.payload, scope: { ...h.payload.scope, artifactRef: result.artifactRef, releaseId: result.releaseId } };
  const sql = result.statements.join("\n");
  assert.ok(sql.includes("j.payload::jsonb=" + firstOpenSqlJson(h.payload)));
  assert.ok(sql.includes("SET payload=" + firstOpenSqlJson(projected) + "::text"));
  assert.ok(sql.includes("'tenant_api','" + taskRelease.version + "','candidate'," + firstOpenSqlJson(taskRelease)));
  assert.match(sql, /FOR UPDATE OF j,d,a,w,sub,e;/);
  assert.match(sql, /j\.status='pending' AND j\.attempts=0 AND j\.max_attempts=1/);
  assert.match(sql, /j\.lease_token IS NULL AND j\.lease_expires_at IS NULL/);
  assert.match(sql, /SET LOCAL ROLE NONE[\s\S]+SET FALSE[\s\S]+UPDATE public.app_instance_deployments SET artifact_ref=/);
  assert.doesNotMatch(sql, /UPDATE deployment_release|^(?:COMMIT|ROLLBACK)\b|\bCREATE TABLE\b/m);
  assert.equal((sql.match(/^  UPDATE public\./gm) ?? []).length, 2);
  assert.equal((sql.match(/^  INSERT INTO /gm) ?? []).length, 1);
  assert.match(result.independentReadback.held, /j.status='pending'/);
  assert.match(result.independentReadback.catalog, /l.status='candidate'/);
  assert.match(result.independentReadback.review, /FROM public.deployment_jobs j/);
  assert.ok(result.independentReadback.review.includes(firstOpenSqlJson(projected)));
  assert.doesNotMatch(result.independentReadback.review, /\$1|FOR UPDATE/);
  await assert.rejects(verifyFirstOpenTaskRebindReadback(result, null, taskRelease), /INDEPENDENT_READBACK/);
  await assert.rejects(firstOpenTaskRebindStatements({ ...input, writeBefore: now }, now), /HELD_PREIMAGE/);
  await assert.rejects(firstOpenTaskRebindStatements({ ...input, oldReview: { ...oldReview, jobId: "job_" + "4".repeat(24) } }, now), /HELD_PREIMAGE/);
  await assert.rejects(firstOpenTaskRebindStatements({ ...input, approvedTaskReleaseSha256: "0".repeat(64) }, now), /RELEASE_SEAL/);
  await assert.rejects(firstOpenTaskRebindStatements({ ...input, trustedPublication: { ...trusted, proofSha256: "0".repeat(64) } }, now));
});

test("protected SQL binds claim, middle, completion and independent revision 0 readback to the same case-only catalog row", async () => {
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  const next = firstOpenVersion(taskRelease);
  const startAt = Date.parse("2026-11-21T22:00:00Z"), writeBefore = startAt + 30 * 60_000;
  const input = { approvalSha256: "c".repeat(64), planHash: prepared.scope.planSha256,
    configurationHash: prepared.scope.configurationSha256, taskRelease, writeBefore,
    window: { startAt, claimBefore: startAt + 60_000, workloadExpiresAt: startAt + 7_200_000, factsExpireAt: writeBefore,
      cleanupReviewSha256: "d".repeat(64), cleanupPermissionsEvidenceSha256: "f".repeat(64) } };
  const c = await firstOpenManagementNeonDraft(input,
    readFileSync(new URL("../lib/deployments/execution/neon-repository.ts", import.meta.url), "utf8"));
  for (const sql of [c.claim, c.middle, c.completion, firstOpenNeonReserveStatements(taskRelease).join("\n")]) {
    assert.ok(sql.includes(next.artifactRef));
    assert.ok(sql.includes(next.releaseId));
    assert.ok(!sql.includes(prepared.scope.artifactRef));
  }
  assert.ok(c.claim.includes("l.status='candidate'") && c.claim.includes(firstOpenSqlJson(taskRelease)));
  assert.ok(c.claim.includes(await firstOpenMiddleOperationHash(input)));
  assert.ok(c.middle.includes(await firstOpenMiddleOperationHash(input)));
  assert.ok(c.completion.includes("s.current_release_id='" + next.releaseId + "'"));
  assert.ok(c.completion.includes("i.binding_text::jsonb#>>'{currentRelease,platformDigest}'='" + next.imageDigest + "'"));
  assert.ok(c.completion.includes(firstOpenSqlJson(taskRelease)) && !c.completion.includes("l.status='ecr_verified'"));
  assert.notEqual(await firstOpenMiddleOperationHash(input), await firstOpenMiddleOperationHash({ ...input, taskRelease: undefined }));
});
