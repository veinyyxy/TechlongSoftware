import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { firstOpenBackendStoredReceiptSource, readFirstOpenBackendPublicationReceipt, readFirstOpenStoredBackendPublicationReceipt,
  type FirstOpenStoredBackendEvidence } from "../ops/aws-sandbox/first-open-backend-publication-receipt.ts";
import {
  firstOpenArchiveSha256, firstOpenCandidateZipSha256, firstOpenPublicationProof,
  firstOpenSandboxPublication as target, type FirstOpenPublicationJob,
} from "../ops/releases/first-open-sandbox-publication.ts";

const repository = "veinyyxy/TechlongSoftware", repositoryId = 1323312747;
const workflow = ".github/workflows/sandbox-first-open-image-publish-v1.yml";
const actor = { id: 14145707, login: "veinyyxy", type: "User" };
const environment = { id: 24613410405, name: "techlong-sandbox-deploy" };
const start = Date.parse("2026-11-22T01:30:00Z"), now = () => start + 8_000;
const iso = (ms: number) => new Date(ms).toISOString();
const shaBytes = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const scope = { reviewSha256: "a".repeat(64), sourceCommit: "b".repeat(40), workflowId: 44979999999,
  runId: 44989999999, dispatchedAt: start, writeBefore: start + 900_000 };
const runPath = `/repos/${repository}/actions/runs/${scope.runId}`;
const approvalPath = `${runPath}/approvals`, name = `sandbox-first-open-app-proof-${scope.runId}-1`;
const artifactsPath = `${runPath}/artifacts?per_page=2&name=${name}`, artifactId = 14729999999;

async function fixture() {
  const job: FirstOpenPublicationJob = { repository, repositoryId: String(repositoryId), runId: String(scope.runId), runAttempt: 1,
    sourceSha: scope.sourceCommit, ref: "refs/heads/main", event: "workflow_dispatch", actor: actor.login,
    actorId: String(actor.id), workflowRef: `${repository}/${workflow}@refs/heads/main` };
  const requestId = "release_" + (await sha256Hex({ schema: "techlong/first-open-sandbox-publication-intent/v1",
    sha: scope.reviewSha256, job })).slice(0, 32);
  const prefix = "instance-releases/promotions/";
  const publishedKey = `${prefix}${requestId}/published.json`, versionId = "ef8xjk9r3-2jO5pvtLT7Lo7qv30Vm7yd";
  const manifest = JSON.stringify({ schemaVersion: 2, config: { digest: target.imageConfigDigest }, layers: [] });
  const image = { registryId: "402010193138", repositoryName: "techlong-sandbox-speedfeast",
    imageId: { imageDigest: "sha256:" + await sha256Hex(manifest), imageTag: target.tag }, imageManifest: manifest };
  const readback = { observedAt: start + 4_500, root: { images: [image], failures: [] } };
  const proof = await firstOpenPublicationProof(readback, { imageRepository: target.registryRepository,
    imageConfigDigest: target.imageConfigDigest, validUntil: scope.writeBefore }, scope.reviewSha256, job, start + 5_250);
  const intent = { requestId, candidateSha256: firstOpenCandidateZipSha256, writeBefore: scope.writeBefore,
    target: { repository: target.registryRepository, tag: target.tag, imageConfigDigest: target.imageConfigDigest,
      archiveSha256: firstOpenArchiveSha256, artifactSha256: firstOpenCandidateZipSha256, version: target.jobId } };
  const envelope = { kind: "published", intent, payload: { proof, readback, notCataloged: true } };
  const evidence = [
    { key: `${prefix}${requestId}/intent.json`, versionId: "a".repeat(32), bodySha256: "c".repeat(64) },
    { key: `${prefix}candidate-${firstOpenCandidateZipSha256}/push.json`, versionId: "b".repeat(32), bodySha256: "d".repeat(64) },
    { key: publishedKey, versionId, bodySha256: await sha256Hex(envelope) },
  ];
  const receipt = { status: "FIRST_OPEN_APP_PUBLISHED_NOT_INSTALLED", proof, proofSha256: await sha256Hex(proof), readback, evidence,
    catalogWritten: false, installationPerformed: false, taskClaimed: false };
  const run = { id: scope.runId, workflow_id: scope.workflowId, run_attempt: 1, event: job.event,
    path: workflow, head_branch: "main", head_sha: scope.sourceCommit,
    repository: { id: repositoryId, full_name: repository, owner: { id: actor.id } }, head_repository: { id: repositoryId, full_name: repository },
    actor, triggering_actor: actor, status: "completed", conclusion: "success", created_at: iso(start + 1_000),
    run_started_at: iso(start + 2_000), updated_at: iso(start + 7_000), html_url: `https://github.com/${repository}/actions/runs/${scope.runId}` };
  const approvals = [{ state: "approved", user: actor, environments: [environment] }];
  const calls: string[] = [];
  const output = { published: strToU8(canonicalJson(envelope)), zip: new Uint8Array() as Uint8Array, artifact: {
    id: artifactId, name, size_in_bytes: 0, digest: "", expired: false, created_at: iso(start + 6_000),
    expires_at: iso(start + 7 * 86_400_000), archive_download_url: `https://api.github.com/repos/${repository}/actions/artifacts/${artifactId}/zip`,
    workflow_run: { id: scope.runId, repository_id: repositoryId, head_repository_id: repositoryId, head_branch: "main", head_sha: scope.sourceCommit },
  } };
  const setZip = (value: unknown = receipt) => {
    output.zip = zipSync({ "publication-result.json": strToU8(JSON.stringify(value, null, 2) + "\n") });
    output.artifact.digest = `sha256:${shaBytes(output.zip)}`;
    output.artifact.size_in_bytes = output.zip.length;
  };
  setZip();
  const s3Gets: { key: string; versionId: string }[] = [];
  const ports = {
    async github(path: string, signal: AbortSignal) {
      signal.throwIfAborted(); calls.push(path);
      if (path === runPath) return run;
      if (path === approvalPath) return approvals;
      if (path === artifactsPath) return { total_count: 1, artifacts: [output.artifact] };
      throw new Error("unexpected GitHub request: " + path);
    },
    async proofZip(id: number, signal: AbortSignal) {
      signal.throwIfAborted(); calls.push("artifact:" + id);
      assert.equal(id, artifactId);
      return output.zip;
    },
    async publishedEvidence(reference: { key: string; versionId: string }, signal: AbortSignal) {
      signal.throwIfAborted(); calls.push("s3"); s3Gets.push(reference);
      return output.published;
    },
  };
  return { receipt, envelope, proof, evidence, output, setZip, run, approvals, calls, s3Gets, publishedKey, versionId, ports };
}

test("hands off only the exact first-attempt proof with a matching fixed S3 version", async () => {
  const f = await fixture();
  const result = await readFirstOpenBackendPublicationReceipt(scope, f.ports, now);
  assert.deepEqual(result.proof, f.proof);
  assert.equal(result.proofSha256, f.receipt.proofSha256);
  assert.deepEqual(f.calls, [runPath, approvalPath, artifactsPath, `artifact:${artifactId}`, "s3"]);
  assert.deepEqual(f.s3Gets, [{ key: f.publishedKey, versionId: f.versionId }]);
});

test("accepts a millisecond proof when GitHub reports the same artifact second without milliseconds", async () => {
  const f = await fixture(); f.output.artifact.created_at = iso(start + 5_000).replace(".000Z", "Z");
  const result = await readFirstOpenBackendPublicationReceipt(scope, f.ports, now);
  assert.equal(result.proof.publishedAt, start + 5_250);
  const older = await fixture(); older.output.artifact.created_at = iso(start + 4_000).replace(".000Z", "Z");
  await assert.rejects(() => readFirstOpenBackendPublicationReceipt(scope, older.ports, now));
  assert.deepEqual(older.s3Gets, []);
});

test("wrong first attempt, source or user approval stops before downloading a publication archive", async () => {
  for (const patch of [{ run_attempt: 2 }, { head_sha: "e".repeat(40) }, { workflow_id: scope.workflowId + 1 }, { conclusion: "failure" }]) {
    const f = await fixture(); Object.assign(f.run, patch);
    await assert.rejects(() => readFirstOpenBackendPublicationReceipt(scope, f.ports, now));
    assert.deepEqual(f.calls, [runPath]);
  }
  const f = await fixture(); f.approvals[0].user = { ...actor, id: actor.id + 1 };
  await assert.rejects(() => readFirstOpenBackendPublicationReceipt(scope, f.ports, now));
  assert.deepEqual(f.calls, [runPath, approvalPath]);
});

test("a digest, proof or derived key mismatch never makes an S3 request", async () => {
  const badArchive = await fixture(); badArchive.output.artifact.digest = `sha256:${"0".repeat(64)}`;
  await assert.rejects(() => readFirstOpenBackendPublicationReceipt(scope, badArchive.ports, now));
  assert.equal(badArchive.s3Gets.length, 0);
  for (const change of ["wrong artifact origin", "wrong review", "wrong key", "missing version"] as const) {
    const f = await fixture();
    if (change === "wrong artifact origin") f.output.artifact.workflow_run.id++;
    if (change === "wrong review") {
      const proof = { ...f.proof, reviewSha256: "1".repeat(64) };
      f.setZip({ ...f.receipt, proof, proofSha256: await sha256Hex(proof) });
    }
    if (change === "wrong key") { f.evidence[2].key += ".other"; f.setZip(); }
    if (change === "missing version") { f.evidence[2].versionId = "null"; f.setZip(); }
    await assert.rejects(() => readFirstOpenBackendPublicationReceipt(scope, f.ports, now));
    assert.equal(f.s3Gets.length, 0, change);
  }
});

test("a changed fixed S3 body or an elapsed window yields no handoff and no retry", async () => {
  const changed = await fixture();
  const wrong = { ...changed.envelope, payload: { ...changed.envelope.payload, notCataloged: false } };
  changed.evidence[2].bodySha256 = await sha256Hex(wrong); // The digest is valid; the claimed result is not.
  changed.setZip(); changed.output.published = strToU8(canonicalJson(wrong));
  await assert.rejects(() => readFirstOpenBackendPublicationReceipt(scope, changed.ports, now));
  assert.equal(changed.s3Gets.length, 1);
  const late = await fixture();
  await assert.rejects(() => readFirstOpenBackendPublicationReceipt(scope, late.ports, () => scope.writeBefore));
  assert.deepEqual(late.calls, []);
});

function storedEvidence(f: Awaited<ReturnType<typeof fixture>>): FirstOpenStoredBackendEvidence {
  return { workflowId: scope.workflowId, runId: scope.runId, runAttempt: 1, sourceCommit: scope.sourceCommit,
    artifactId, artifactDigest: f.output.artifact.digest, proofSha256: f.receipt.proofSha256, publishedEvidence: { ...f.evidence[2] } };
}

test("stored handoff recovers the exact proof with one version GET, even after the original write window", async () => {
  const f = await fixture(), observed = storedEvidence(f);
  const resumed = await readFirstOpenStoredBackendPublicationReceipt({ ...scope, readBefore: scope.writeBefore + 60_000 },
    observed, f.ports.publishedEvidence, () => scope.writeBefore + 1);
  const { proofSha256, ...handoff } = observed;
  assert.deepEqual(resumed, { proof: f.proof, proofSha256, handoff });
  assert.deepEqual(f.calls, ["s3"]);
  assert.deepEqual(f.s3Gets, [{ key: f.publishedKey, versionId: f.versionId }]);
});

test("stored handoff rejects mismatched bindings before IO and rejects a changed proof without a second GET", async () => {
  const f = await fixture(), observed = storedEvidence(f);
  await assert.rejects(() => readFirstOpenStoredBackendPublicationReceipt(scope, { ...observed, runId: scope.runId + 1 },
    f.ports.publishedEvidence, now), /STORED_SCOPE/);
  const wrongKey = { ...observed, publishedEvidence: { ...observed.publishedEvidence, key: `${f.publishedKey}.other` } };
  await assert.rejects(() => readFirstOpenStoredBackendPublicationReceipt(scope, wrongKey, f.ports.publishedEvidence, now), /STORED_KEY/);
  const missingVersion = { ...observed, publishedEvidence: { ...observed.publishedEvidence, versionId: "null" } };
  await assert.rejects(() => readFirstOpenStoredBackendPublicationReceipt(scope, missingVersion, f.ports.publishedEvidence, now), /STORED_SCOPE/);
  assert.deepEqual(f.calls, []);

  const changed = { ...f.envelope, payload: { ...f.envelope.payload, readback: { ...f.envelope.payload.readback,
    root: { images: [], failures: [] } } } };
  f.output.published = strToU8(canonicalJson(changed));
  const invalid = { ...observed, publishedEvidence: { ...observed.publishedEvidence, bodySha256: shaBytes(f.output.published) } };
  await assert.rejects(() => readFirstOpenStoredBackendPublicationReceipt(scope, invalid, f.ports.publishedEvidence, now), /STORED_PROOF/);
  assert.deepEqual(f.calls, ["s3"]);
});

test("stored S3 adapter refuses a different version and cannot read after close", async () => {
  const source = firstOpenBackendStoredReceiptSource(), signal = new AbortController().signal;
  const key = "instance-releases/promotions/release_48138f1f97f150ed3af3d7573da1d796/published.json";
  await assert.rejects(() => source.publishedEvidence({ key, versionId: "different-version" }, signal), /S3_SCOPE/);
  source.close();
  await assert.rejects(() => source.publishedEvidence({ key, versionId: "xjhwopLeCuZ.c0FSTsNxEv00.QD6V502" }, signal), /S3_SCOPE/);
});
