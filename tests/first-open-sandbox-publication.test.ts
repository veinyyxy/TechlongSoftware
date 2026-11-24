import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import configuration from "../ops/releases/d2-6-runtime.disabled.json" with { type: "json" };
import type { ReleaseEnvironmentConfig } from "../lib/deployments/releases/handoff.ts";
import { firstOpenPublicationSession } from "../ops/releases/first-open-sandbox-publication-runtime.ts";
import {
  firstOpenSandboxPublication as p, firstOpenCandidateZipSha256, firstOpenPublicationProof, assertFirstOpenBackendPublicationProof,
  assertFirstOpenPublicationJob, checkFirstOpenPublicationSources, firstOpenPublicationCodeFiles, validateFirstOpenPublicationReview,
  type FirstOpenPublicationJob, type FirstOpenPublicationReview,
} from "../ops/releases/first-open-sandbox-publication.ts";

const job: FirstOpenPublicationJob = {
  repository: "veinyyxy/TechlongSoftware", repositoryId: "1323312747", runId: "44955555123", runAttempt: 1,
  sourceSha: "2".repeat(40), ref: "refs/heads/main", event: "workflow_dispatch", actor: "veinyyxy", actorId: "14145707",
  workflowRef: "veinyyxy/TechlongSoftware/.github/workflows/sandbox-first-open-image-publish-v1.yml@refs/heads/main",
};
const environment = configuration.environments.sandbox as ReleaseEnvironmentConfig;
const now = Date.parse("2026-11-21T22:00:00Z"), end = now + 900_000;
const code = firstOpenPublicationCodeFiles.map(path => ({ path, sha256: "a".repeat(64) }));
const review: FirstOpenPublicationReview = {
  schema: "techlong/first-open-sandbox-publication-review/v1", enabled: true,
  jobId: p.jobId, instanceId: p.instanceId, candidateZipSha256: firstOpenCandidateZipSha256,
  scanZipSha256: "097d75c7ef15b8ac1817cf39bc1dd23fa2a80123a3b1585ee53708786c9a635b",
  observedAt: now - 10_000, writeBefore: end, preflightSha256: "e".repeat(64), environment, codeArtifacts: code,
};

test("both original GitHub artifacts must match the fixed first-attempt provenance, original bytes and expiry", () => {
  const source = { id: 1064124445, full_name: "veinyyxy/SpeedFeast_Backend_main" };
  const run = { id: p.candidateRunId, workflow_id: 377674976, run_attempt: 1, conclusion: "success", status: "completed",
    event: "push", head_branch: "main", head_sha: p.sourceCommit, path: ".github/workflows/backend-image-candidate.yml",
    repository: source, head_repository: source };
  const workflow_run = { id: p.candidateRunId, head_sha: p.sourceCommit, head_branch: "main",
    repository_id: 1064124445, head_repository_id: 1064124445 };
  const app = { id: p.candidateArtifactId, name: `sandbox-checked-app-${p.sourceCommit}-${p.candidateRunId}-1`, expired: false,
    expires_at: "2026-11-22T21:23:49Z", size_in_bytes: 72671316, digest: "sha256:" + firstOpenCandidateZipSha256, workflow_run };
  const scan = { id: p.scanArtifactId, name: `os-scan-app-${p.sourceCommit}-${p.candidateRunId}-1`, expired: false,
    expires_at: "2026-11-28T21:23:44Z", size_in_bytes: 18211, digest: "sha256:" + review.scanZipSha256, workflow_run };
  assert.doesNotThrow(() => checkFirstOpenPublicationSources(run, app, scan, now));
  assert.throws(() => checkFirstOpenPublicationSources({ ...run, run_attempt: 2 }, app, scan, now), /RUN_MISMATCH/);
  assert.throws(() => checkFirstOpenPublicationSources(run, { ...app, expired: true }, scan, now), /ARTIFACT_MISMATCH/);
  assert.throws(() => checkFirstOpenPublicationSources(run, app, { ...scan, digest: "sha256:" + "9".repeat(64) }, now), /ARTIFACT_MISMATCH/);
});

test("first-open publishing is disabled by default and only a fresh exact review and human-protected caller can proceed", async () => {
  const disabled = JSON.parse(readFileSync(new URL("../ops/releases/first-open-sandbox-publication.review.json", import.meta.url), "utf8"));
  assert.equal(disabled.enabled, false);
  const workflow = readFileSync(new URL("../.github/workflows/sandbox-first-open-image-publish-v1.yml", import.meta.url), "utf8");
  assert.match(workflow, /environment: techlong-sandbox-deploy/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s{2}push:/);
  await validateFirstOpenPublicationReview(review, await sha256Hex(review), code, now);
  await assert.rejects(validateFirstOpenPublicationReview(review, await sha256Hex(review), code, end), /EXPIRED/);
  await assert.rejects(validateFirstOpenPublicationReview(review, "0".repeat(64), code, now), /APPROVAL_REQUIRED/);
  const altered = { ...review, candidateZipSha256: "b".repeat(64) };
  await assert.rejects(validateFirstOpenPublicationReview(altered, await sha256Hex(altered), code, now), /APPROVAL_REQUIRED/);
  assert.doesNotThrow(() => assertFirstOpenPublicationJob(job));
  for (const change of [{ actorId: "12" }, { runAttempt: 2 }, { event: "push" }, { ref: "refs/heads/test" }, { repository: "other/project" }]) {
    assert.throws(() => assertFirstOpenPublicationJob({ ...job, ...change }), /JOB_SCOPE/);
  }
});

test("first-open session cannot read publisher DB or write unrelated evidence and uses one candidate-wide slot", () => {
  const request = "release_" + "1".repeat(32);
  const session = firstOpenPublicationSession(environment, request, firstOpenCandidateZipSha256);
  assert.equal(session.durationSeconds, 900);
  assert.ok(session.policy.length <= 2048);
  assert.doesNotMatch(session.policy, /publisher-db|cloudformation|rds-db|s3:GetObject|iam:/);
  const statements = JSON.parse(session.policy).Statement;
  const allowed = statements.find((s: { Action: string }) => s.Action === "s3:PutObject");
  assert.equal(allowed.Resource.length, 3);
  assert.match(allowed.Resource[2], new RegExp("/candidate-" + firstOpenCandidateZipSha256 + "/push.json$"));
  assert.equal(allowed.Condition.Null["s3:if-none-match"], "false");
});

test("task proof derives original ECR manifest digest and cannot substitute config, another task or a raw unbound digest", async () => {
  const manifest = JSON.stringify({ schemaVersion: 2, config: { digest: p.imageConfigDigest }, layers: [] });
  const digest = "sha256:" + await sha256Hex(manifest);
  const entry = { registryId: "402010193138", repositoryName: "techlong-sandbox-speedfeast",
    imageId: { imageDigest: digest, imageTag: p.tag }, imageManifest: manifest };
  const target = { imageConfigDigest: p.imageConfigDigest, imageRepository: p.registryRepository, validUntil: end };
  const proof = await firstOpenPublicationProof({ observedAt: now, root: { images: [entry], failures: [] } }, target,
    await sha256Hex(review), job, now);
  assert.equal(proof.registryManifestDigest, digest);
  assert.doesNotThrow(() => assertFirstOpenBackendPublicationProof(proof));
  assert.throws(() => assertFirstOpenBackendPublicationProof({ ...proof, registryManifestDigest: p.imageConfigDigest }), /PROOF_SCOPE/);
  await assert.rejects(firstOpenPublicationProof(
    { observedAt: now, root: { images: [{ ...entry, imageManifest: manifest + " " }] } },
    target, await sha256Hex(review), job, now), /REGISTRY_BYTES_MISMATCH/);
});
