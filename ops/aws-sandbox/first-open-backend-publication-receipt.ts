import { createHash } from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import type { RegistryReadback } from "../../lib/deployments/releases/production.ts";
import { assertFirstOpenBackendPublicationProof, firstOpenArchiveSha256, firstOpenCandidateZipSha256, firstOpenPublicationProof,
  firstOpenSandboxPublication as candidate, type FirstOpenBackendPublicationProof, type FirstOpenPublicationJob } from "../releases/first-open-sandbox-publication.ts";
import { readFirstOpenBackendPublicationZip } from "./first-open-backend-publication-zip.ts";

const repo = "veinyyxy/TechlongSoftware", repoId = 1323312747, reviewer = 14145707;
const workflow = ".github/workflows/sandbox-first-open-image-publish-v1.yml";
const api = `/repos/${repo}/actions`, bucket = "techlong-sandbox-cloud-worker-evidence-402010193138";
const prefix = "instance-releases/promotions/", account = "402010193138", region = "ca-central-1";
const hex = /^[a-f0-9]{64}$/, commit = /^[a-f0-9]{40}$/;
const rawHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const positive = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) > 0;
const validVersion = (v: unknown): v is string => typeof v === "string" && v !== "null" && /^[A-Za-z0-9+/_=.\-]{1,1024}$/.test(v);
const jsonObject = (x: unknown): Record<string, unknown> => x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {};
const exact = (actual: unknown, expected: unknown) => canonicalJson(actual) === canonicalJson(expected);
const date = (x: unknown) => typeof x === "string" ? Date.parse(x) : NaN;

export const firstOpenBackendProofLimits = Object.freeze({ githubGets: 4, officialBlobGets: 1, s3VersionGets: 1,
  maxZipBytes: 1_048_576, maxEvidenceBytes: 1_048_576 });

export interface FirstOpenBackendPublicationReceiptScope {
  reviewSha256: string;
  sourceCommit: string;
  workflowId: number;
  runId: number;
  dispatchedAt: number;
  writeBefore: number;
  readBefore?: number;
}
export interface FirstOpenBackendPublicationReceiptPorts {
  github(path: string, signal: AbortSignal): Promise<unknown>;
  proofZip(artifactId: number, signal: AbortSignal): Promise<Uint8Array>;
  publishedEvidence(input: { key: string; versionId: string }, signal: AbortSignal): Promise<Uint8Array>;
}

export type FirstOpenStoredBackendEvidence = {
  workflowId: number;
  runId: number;
  runAttempt: 1;
  sourceCommit: string;
  artifactId: number;
  artifactDigest: string;
  publishedEvidence: { key: string; versionId: string; bodySha256: string };
  proofSha256: string;
};

function need(value: unknown, code: string): asserts value {
  if (!value) throw Error(`FIRST_OPEN_BACKEND_HANDOFF_${code}`);
}

function parse(bytes: Uint8Array, limit: number) {
  need(bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= limit, "BODY_LIMIT");
  return jsonObject(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
}

function receiptWindow(scope: FirstOpenBackendPublicationReceiptScope, now: () => number) {
  const { reviewSha256, sourceCommit, workflowId, runId, dispatchedAt, writeBefore, readBefore = scope.writeBefore } = scope;
  const at = now();
  need(hex.test(reviewSha256) && commit.test(sourceCommit) && positive(workflowId) && positive(runId) &&
    runId !== candidate.candidateRunId && positive(dispatchedAt) && positive(writeBefore) && positive(readBefore) &&
    dispatchedAt <= at && dispatchedAt < writeBefore && writeBefore <= readBefore && at < readBefore, "SCOPE");
  return () => {
    const remaining = readBefore - now(); need(remaining > 0, "TIMEOUT");
    return AbortSignal.timeout(Math.min(remaining, 20_000));
  };
}

async function publicationIdentity({ runId, sourceCommit, reviewSha256, writeBefore }: FirstOpenBackendPublicationReceiptScope) {
  const job: FirstOpenPublicationJob = { repository: repo, repositoryId: String(repoId), runId: String(runId), runAttempt: 1,
    sourceSha: sourceCommit, ref: "refs/heads/main", event: "workflow_dispatch", actor: "veinyyxy", actorId: String(reviewer),
    workflowRef: `${repo}/${workflow}@refs/heads/main` };
  const requestId = "release_" + (await sha256Hex({ schema: "techlong/first-open-sandbox-publication-intent/v1", sha: reviewSha256, job })).slice(0, 32);
  const keys = [`${prefix}${requestId}/intent.json`, `${prefix}candidate-${firstOpenCandidateZipSha256}/push.json`, `${prefix}${requestId}/published.json`];
  const intent = { requestId, candidateSha256: firstOpenCandidateZipSha256, writeBefore, target: {
    repository: candidate.registryRepository, tag: candidate.tag, imageConfigDigest: candidate.imageConfigDigest,
    archiveSha256: firstOpenArchiveSha256, artifactSha256: firstOpenCandidateZipSha256, version: candidate.jobId,
  } };
  return { job, keys, intent };
}

/** Readback of one already acknowledged attempt-1 dispatch. No dispatch, polling or ambient run selection. */
export async function readFirstOpenBackendPublicationReceipt(scope: FirstOpenBackendPublicationReceiptScope,
  ports: FirstOpenBackendPublicationReceiptPorts, now = Date.now) {
  const { reviewSha256, sourceCommit, workflowId, runId, dispatchedAt, writeBefore } = scope;
  const signal = receiptWindow(scope, now);
  const runPath = `${api}/runs/${runId}`, name = `sandbox-first-open-app-proof-${runId}-1`;
  try {
    const run = jsonObject(await ports.github(runPath, signal()));
    const created = date(run.created_at), actor = jsonObject(run.actor), triggering = jsonObject(run.triggering_actor);
    need(run.id === runId && run.workflow_id === workflowId && run.run_attempt === 1 && run.head_sha === sourceCommit &&
      run.head_branch === "main" && run.path === workflow && run.event === "workflow_dispatch" &&
      run.status === "completed" && run.conclusion === "success" && jsonObject(run.repository).id === repoId &&
      jsonObject(run.repository).full_name === repo && jsonObject(run.head_repository).id === repoId &&
      actor.id === reviewer && actor.login === "veinyyxy" &&
      (run.triggering_actor == null || (triggering.id === reviewer && triggering.login === "veinyyxy")) &&
      created >= dispatchedAt - 2000 && created <= now() && created < writeBefore, "RUN_MISMATCH");
    const approvals = await ports.github(runPath + "/approvals", signal());
    need(Array.isArray(approvals), "APPROVAL_SHAPE");
    const relevant = approvals.map(jsonObject).filter(a => Array.isArray(a.environments) && a.environments.map(jsonObject)
      .some(e => e.id === 24613410405 && e.name === "techlong-sandbox-deploy"));
    need(relevant.length === 1 && relevant[0].state === "approved" && jsonObject(relevant[0].user).id === reviewer &&
      jsonObject(relevant[0].user).type === "User", "APPROVAL_MISMATCH");
    const list = jsonObject(await ports.github(`${runPath}/artifacts?per_page=2&name=${name}`, signal()));
    need(list.total_count === 1 && Array.isArray(list.artifacts) && list.artifacts.length === 1, "ARTIFACT_COUNT");
    const artifact = jsonObject(list.artifacts[0]), producer = jsonObject(artifact.workflow_run);
    const artifactId = artifact.id, size = artifact.size_in_bytes, artifactCreated = date(artifact.created_at), digest = artifact.digest;
    need(positive(artifactId) && artifact.name === name && artifact.expired === false && positive(size) &&
      size <= firstOpenBackendProofLimits.maxZipBytes && typeof digest === "string" && /^sha256:[a-f0-9]{64}$/.test(digest) &&
      producer.id === runId && producer.repository_id === repoId && producer.head_repository_id === repoId &&
      producer.head_branch === "main" && producer.head_sha === sourceCommit && artifactCreated >= created &&
      artifactCreated >= dispatchedAt && artifactCreated <= now() && now() < date(artifact.expires_at), "ARTIFACT_MISMATCH");
    const zip = await ports.proofZip(artifactId, signal());
    need(zip?.byteLength === size && `sha256:${rawHash(zip)}` === digest, "ZIP_DIGEST");
    const report = parse(readFirstOpenBackendPublicationZip(zip), firstOpenBackendProofLimits.maxZipBytes);
    need(report.status === "FIRST_OPEN_APP_PUBLISHED_NOT_INSTALLED" && report.catalogWritten === false &&
      report.installationPerformed === false && report.taskClaimed === false && Array.isArray(report.evidence) &&
      report.evidence.length === 3 && report.readback && typeof report.readback === "object", "RESULT_MISMATCH");
    const proof = report.proof as FirstOpenBackendPublicationProof;
    try { assertFirstOpenBackendPublicationProof(proof); } catch { throw Error("FIRST_OPEN_BACKEND_HANDOFF_PROOF_SCOPE"); }
    const proofSha256 = await sha256Hex(proof);
    need(report.proofSha256 === proofSha256 && proof.reviewSha256 === reviewSha256 && proof.publicationRunId === String(runId) &&
      proof.publishedAt >= Math.max(created, dispatchedAt - 2000) && proof.publishedAt < writeBefore &&
      proof.publishedAt < artifactCreated + 1000 && proof.publishedAt <= now(),
    "PROOF_MISMATCH");
    const { keys, intent } = await publicationIdentity(scope);
    const refs = report.evidence.map(jsonObject);
    need(refs.every((v, i) => v.key === keys[i] && validVersion(v.versionId) && typeof v.bodySha256 === "string" && hex.test(v.bodySha256)), "EVIDENCE_REFS");
    const published = refs[2], key = keys[2], versionId = published.versionId as string;
    const body = await ports.publishedEvidence({ key, versionId }, signal());
    const evidence = parse(body, firstOpenBackendProofLimits.maxEvidenceBytes);
    need(rawHash(body) === published.bodySha256 && exact(evidence, { kind: "published", intent,
      payload: { proof, readback: report.readback, notCataloged: true } }), "EVIDENCE_MISMATCH");
    signal();
    return { proof, proofSha256, handoff: { workflowId, runId, runAttempt: 1 as const, sourceCommit, artifactId,
      artifactDigest: digest, publishedEvidence: { key, versionId, bodySha256: published.bodySha256 as string } } };
  } catch (e) {
    if (e instanceof Error && /^FIRST_OPEN_BACKEND_HANDOFF_[A-Z_]+$/.test(e.message)) throw e;
    throw Error("FIRST_OPEN_BACKEND_HANDOFF_IO_STOP");
  }
}

/** The caller binds the previously independently validated observation's raw bytes before supplying it here. */
export async function readFirstOpenStoredBackendPublicationReceipt(scope: FirstOpenBackendPublicationReceiptScope,
  observation: FirstOpenStoredBackendEvidence, readVersioned: FirstOpenBackendPublicationReceiptPorts["publishedEvidence"], now = Date.now) {
  const original = { ...scope }, signal = receiptWindow(original, now);
  const { workflowId, runId, sourceCommit, dispatchedAt, writeBefore, reviewSha256 } = original;
  const { artifactId, artifactDigest, proofSha256, publishedEvidence } = structuredClone(observation);
  need(observation.workflowId === workflowId && observation.runId === runId && observation.runAttempt === 1 &&
    observation.sourceCommit === sourceCommit && positive(artifactId) && /^sha256:[a-f0-9]{64}$/.test(artifactDigest) &&
    hex.test(proofSha256) && publishedEvidence && validVersion(publishedEvidence.versionId) &&
    hex.test(publishedEvidence.bodySha256), "STORED_SCOPE");
  try {
    const { job, keys, intent } = await publicationIdentity(original);
    const { key, versionId, bodySha256 } = publishedEvidence;
    need(key === keys[2], "STORED_KEY");
    const body = await readVersioned({ key, versionId }, signal());
    const evidence = parse(body, firstOpenBackendProofLimits.maxEvidenceBytes), payload = jsonObject(evidence.payload);
    const proof = payload.proof as FirstOpenBackendPublicationProof;
    need(rawHash(body) === bodySha256 && exact(evidence, { kind: "published", intent,
      payload: { proof, readback: payload.readback, notCataloged: true } }), "EVIDENCE_MISMATCH");
    need(positive(proof?.publishedAt) && proof.publishedAt >= dispatchedAt - 2000 && proof.publishedAt < writeBefore &&
      proof.publishedAt <= now() && await sha256Hex(proof) === proofSha256, "STORED_PROOF");
    try {
      const verified = await firstOpenPublicationProof(payload.readback as RegistryReadback, { imageRepository: candidate.registryRepository,
        imageConfigDigest: candidate.imageConfigDigest, validUntil: writeBefore }, reviewSha256, job, proof.publishedAt);
      need(exact(verified, proof), "STORED_PROOF");
    } catch { throw Error("FIRST_OPEN_BACKEND_HANDOFF_STORED_PROOF"); }
    signal();
    return { proof, proofSha256, handoff: { workflowId, runId, runAttempt: 1 as const, sourceCommit, artifactId, artifactDigest,
      publishedEvidence: { key, versionId, bodySha256 } } };
  } catch (e) {
    if (e instanceof Error && /^FIRST_OPEN_BACKEND_HANDOFF_[A-Z_]+$/.test(e.message)) throw e;
    throw Error("FIRST_OPEN_BACKEND_HANDOFF_IO_STOP");
  }
}

async function boundedBody(body: ReadableStream<Uint8Array> | null, max: number) {
  const read = body?.getReader(); need(read, "BODY_EMPTY");
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await read.read(); if (part.done) break;
      total += part.value.length; need(total <= max, "BODY_LIMIT"); chunks.push(part.value);
    }
  } finally { await read.cancel().catch(() => {}); }
  return Buffer.concat(chunks, total);
}

function versionedEvidenceSource(pinned?: { key: string; versionId: string }) {
  const client = new S3Client({ region, endpoint: "https://s3.ca-central-1.amazonaws.com", maxAttempts: 1,
    ignoreConfiguredEndpointUrls: true, credentials: fromLoginCredentials({ profile: "techlong-sandbox-user", ignoreCache: true }) });
  let evidenceRead = false, closed = false;
  const publishedEvidence: FirstOpenBackendPublicationReceiptPorts["publishedEvidence"] = async ({ key, versionId }, abortSignal) => {
    abortSignal.throwIfAborted();
    need(!closed && !evidenceRead && /^instance-releases\/promotions\/release_[a-f0-9]{32}\/published\.json$/.test(key) &&
      validVersion(versionId) && (!pinned || (pinned.key === key && pinned.versionId === versionId)) &&
      process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0", "S3_SCOPE");
    evidenceRead = true;
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, ExpectedBucketOwner: account, Key: key, VersionId: versionId }), { abortSignal });
    need(result.VersionId === versionId && positive(result.ContentLength) &&
      result.ContentLength <= firstOpenBackendProofLimits.maxEvidenceBytes && result.Body, "S3_ACK");
    const bytes = await boundedBody(result.Body.transformToWebStream(), firstOpenBackendProofLimits.maxEvidenceBytes);
    need(bytes.length === result.ContentLength, "S3_LENGTH");
    return bytes;
  };
  return { publishedEvidence, close() { closed = true; client.destroy(); } };
}

/** Only the versioned publication body already confirmed in the v4 backend handoff. */
export function firstOpenBackendStoredReceiptSource() {
  return versionedEvidenceSource({ key: `${prefix}release_48138f1f97f150ed3af3d7573da1d796/published.json`,
    versionId: "xjhwopLeCuZ.c0FSTsNxEv00.QD6V502" });
}

/** Concrete bounded GET-only adapter. Credentials are loaded on the first allowed call, signed redirects stay in memory. */
export function firstOpenBackendPublicationReceiptSource(scope: FirstOpenBackendPublicationReceiptScope, loadGitHubToken: () => Promise<string>) {
  const runPath = `${api}/runs/${scope.runId}`;
  const listRoute = `${runPath}/artifacts?per_page=2&name=sandbox-first-open-app-proof-${scope.runId}-1`;
  const allowed = new Set([runPath, runPath + "/approvals", listRoute]);
  const evidence = versionedEvidenceSource();
  let artifactId: number | undefined, zipRead = false;
  const github = async (path: string, signal: AbortSignal) => {
    signal.throwIfAborted();
    need(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0", "TLS");
    const token = await loadGitHubToken();
    need(typeof token === "string" && token.length > 0 && token.length <= 8192 && !/[\r\n]/.test(token), "GITHUB_CREDENTIAL");
    return fetch("https://api.github.com" + path, { method: "GET", signal, redirect: "manual", cache: "no-store", headers: {
      Accept: "application/vnd.github+json", Authorization: "Bearer " + token, "X-GitHub-Api-Version": "2026-03-10",
    } });
  };
  const ports: FirstOpenBackendPublicationReceiptPorts = {
    async github(path, signal) {
      need(allowed.delete(path), "GITHUB_SCOPE");
      const result = await github(path, signal);
      need(result.status === 200 && !result.headers.get("link")?.includes('rel="next"'), "GITHUB_STATUS");
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await boundedBody(result.body, 1_048_576)));
      if (path === listRoute) {
        const a = jsonObject(value); const id = Array.isArray(a.artifacts) && a.artifacts.length === 1 && jsonObject(a.artifacts[0]).id;
        if (positive(id)) artifactId = id;
      }
      return value;
    },
    async proofZip(id, signal) {
      need(!zipRead && positive(id) && id === artifactId, "ZIP_SCOPE"); zipRead = true;
      const result = await github(`${api}/artifacts/${id}/zip`, signal);
      need(result.status === 302, "ZIP_REDIRECT");
      const url = new URL(result.headers.get("location") ?? "");
      need(url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") &&
        !url.hash && [".blob.core.windows.net", ".githubusercontent.com"].some(domain => url.hostname.endsWith(domain)), "ZIP_HOST");
      const archived = await fetch(url, { method: "GET", signal, redirect: "error", cache: "no-store" });
      need(archived.status === 200, "ZIP_STATUS");
      return boundedBody(archived.body, firstOpenBackendProofLimits.maxZipBytes);
    },
    async publishedEvidence({ key, versionId }, abortSignal) {
      need(zipRead, "S3_SCOPE");
      return evidence.publishedEvidence({ key, versionId }, abortSignal);
    },
  };
  return { ports, close: evidence.close };
}
