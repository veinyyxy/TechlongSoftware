import assert from "node:assert/strict";
import test from "node:test";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { SANDBOX_FIRST_OPEN as s } from "../lib/deployments/execution/first-onboarding-run-once.ts";
import { assertFirstOpenCleanupOidc, bindFirstOpenCleanupVerify, checkFirstOpenCleanupPermit,
  firstOpenCleanupPermitClaims, type FirstOpenCleanupPermit } from "../ops/aws-sandbox/first-open-cleanup-verify.ts";
import { firstOpenSessionArn } from "../ops/aws-sandbox/first-open-sessions.ts";
import { projectFirstOpenExactVersionAuthority } from "../ops/aws-sandbox/first-open-install-policy-delta.ts";

test("cleanup-only permit binds exact reusable, run, actor and independent window before any credential request", async () => {
  const epoch = Date.UTC(2026, 10, 22, 19);
  const p: FirstOpenCleanupPermit = { schema: "techlong/fc41597f-cleanup-verify/v1", jobId: s.jobId, sourceCommit: "a".repeat(40),
    runId: "123456", startAt: epoch, issueBefore: epoch + 120_000, verifyBefore: epoch + 300_000 };
  const sha = await sha256Hex(p);
  assert.deepEqual(await checkFirstOpenCleanupPermit(p, sha, epoch), p);
  const trust = Object.fromEntries(Object.entries(firstOpenCleanupPermitClaims(p)).map(([k, v]) => [k.split(":")[1], v]));
  const claims = { ...trust, iss: "https://token.actions.githubusercontent.com", repository: "veinyyxy/TechlongSoftware",
    run_id: p.runId, run_attempt: "1", event_name: "workflow_dispatch" };
  assert.doesNotThrow(() => assertFirstOpenCleanupOidc(claims, p));
  for (const bad of [{ run_id: "123457" }, { run_attempt: "2" }, { actor_id: "999" }, { job_workflow_ref: "unsealed" }]) {
    assert.throws(() => assertFirstOpenCleanupOidc({ ...claims, ...bad }, p), /OIDC_SCOPE/);
  }
  assert.notEqual(firstOpenSessionArn("cleanup"), firstOpenSessionArn("lifecycle"));
  let oidc = 0;
  const stop = bindFirstOpenCleanupVerify({ permit: p, permitSha256: sha, async getToken() { oidc++; throw Error(); }, backendDirectory: "." }, () => p.issueBefore);
  await assert.rejects(stop(), /PERMIT/);
  await assert.rejects(stop(), /SLOT_USED/);
  assert.equal(oidc, 0);
});

test("exact CloudFormation authority has no current-version or wildcard-URL substitute", () => {
  const base = { approvalSha256: "a".repeat(64), independentProofSha256: "b".repeat(64) };
  const x = projectFirstOpenExactVersionAuthority({ ...base, versionId: "v+id/==" });
  assert.equal(x.executionAuthorized, false);
  assert.equal(x.managementVersionRead.Condition.StringEquals["s3:VersionId"], "v+id/==");
  assert.match(x.managementCreate.Condition.StringEquals["cloudformation:TemplateUrl"], /\?versionId=v%2Bid%2F%3D%3D$/);
  assert.ok(!x.managementCreate.Condition.StringEquals["cloudformation:TemplateUrl"].includes("*"));
  assert.notEqual(x.authorPut.Condition.StringEquals["aws:userid"], x.managementCreate.Condition.StringEquals["aws:userid"]);
  assert.throws(() => projectFirstOpenExactVersionAuthority({ ...base, versionId: "null" }));
  assert.throws(() => projectFirstOpenExactVersionAuthority({ ...base, versionId: "ok?versionId=fake" }));
});
