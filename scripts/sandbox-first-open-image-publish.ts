import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { assumeReleaseIdentity, assertReleaseIdentity, requireHumanReview } from "../ops/releases/aws-runtime.ts";
import { firstOpenSandboxArchivePublisher, releasePromotionServices } from "../ops/releases/promotion-runtime.ts";
import { firstOpenPublicationSession, readFirstOpenSandboxCandidate } from "../ops/releases/first-open-sandbox-publication-runtime.ts";
import {
  firstOpenSandboxPublication, firstOpenPublicationCodeFiles, firstOpenCandidateZipSha256, firstOpenArchiveSha256,
  validateFirstOpenPublicationReview, assertFirstOpenPublicationJob, firstOpenPublicationProof,
  type FirstOpenPublicationReview, type FirstOpenPublicationJob,
} from "../ops/releases/first-open-sandbox-publication.ts";

const code = (e: unknown) => e instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(e.message) ? e.message : "FIRST_OPEN_PUBLICATION_STOPPED_NO_RETRY";
async function main() {
  const mode = process.argv[2] ?? "check";
  if (!["check", "publish"].includes(mode) || process.argv.length > 3) throw new Error("FIRST_OPEN_PUBLICATION_MODE");
  const review = JSON.parse(await readFile(new URL("../ops/releases/first-open-sandbox-publication.review.json", import.meta.url), "utf8"));
  if (review.enabled === false) {
    console.log(JSON.stringify({ status: "FIRST_OPEN_PUBLICATION_DISABLED", credentialsUsed: false, awsCalls: 0 })); return;
  }
  const r = review as FirstOpenPublicationReview, sha = process.env.FIRST_OPEN_PUBLICATION_REVIEW_SHA ?? "";
  const source = await Promise.all(firstOpenPublicationCodeFiles.map(async file => ({ path: file,
    sha256: await sha256Hex((await readFile(file, "utf8")).replaceAll("\r\n", "\n")) })));
  await validateFirstOpenPublicationReview(r, sha, source, Date.now());
  if (mode === "check") { console.log(JSON.stringify({ status: "FIRST_OPEN_PUBLICATION_REVIEW_MATCHED", awsCalls: 0 })); return; }
  const env = process.env;
  const job: FirstOpenPublicationJob = { repository: env.GITHUB_REPOSITORY ?? "", repositoryId: env.GITHUB_REPOSITORY_ID ?? "",
    runId: env.GITHUB_RUN_ID ?? "", runAttempt: Number(env.GITHUB_RUN_ATTEMPT), sourceSha: env.GITHUB_SHA ?? "",
    ref: env.GITHUB_REF ?? "", event: env.GITHUB_EVENT_NAME ?? "", actor: env.GITHUB_ACTOR ?? "", actorId: env.GITHUB_ACTOR_ID ?? "",
    workflowRef: env.GITHUB_WORKFLOW_REF ?? "" };
  assertFirstOpenPublicationJob(job);
  const checkout = await promisify(execFile)("git", ["rev-parse", "HEAD"], { windowsHide: true, timeout: 10000 });
  if (env.GITHUB_ACTIONS !== "true" || checkout.stdout.trim() !== job.sourceSha || !env.RUNNER_TEMP ||
    !path.isAbsolute(env.RUNNER_TEMP) || env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("FIRST_OPEN_PUBLICATION_RUNNER");
  const p = firstOpenSandboxPublication;
  const requestId = "release_" + (await sha256Hex({ schema: "techlong/first-open-sandbox-publication-intent/v1", sha, job })).slice(0, 32);
  const session = firstOpenPublicationSession(r.environment, requestId, firstOpenCandidateZipSha256);
  await requireHumanReview(job, r.environment, env.FIRST_OPEN_PUBLICATION_GITHUB_REVIEW_TOKEN ?? "");
  if (Date.now() >= r.writeBefore) throw new Error("FIRST_OPEN_PUBLICATION_EXPIRED");
  const credentials = await assumeReleaseIdentity(job, r.environment, "publisher", env, undefined, undefined, session);
  const sts = new STSClient({ region: "ca-central-1", credentials, maxAttempts: 1, endpoint: "https://sts.ca-central-1.amazonaws.com" });
  try { assertReleaseIdentity(await sts.send(new GetCallerIdentityCommand({})), r.environment, "publisher"); }
  finally { sts.destroy(); }
  const root = path.join(env.RUNNER_TEMP, "first-open-publish-" + job.runId), archive = path.join(root, "image");
  const services = releasePromotionServices(r.environment, credentials);
  const resultFile = path.join(root, "publication-result.json");
  let created = false;
  try {
    await mkdir(root, { mode: 0o700 }); created = true;
    let checked: Awaited<ReturnType<typeof readFirstOpenSandboxCandidate>> | undefined;
    const intent = { requestId, candidateSha256: firstOpenCandidateZipSha256, writeBefore: r.writeBefore,
      target: { repository: p.registryRepository, tag: p.tag, imageConfigDigest: p.imageConfigDigest, archiveSha256: firstOpenArchiveSha256,
        artifactSha256: firstOpenCandidateZipSha256, version: p.jobId } };
    const publisher = firstOpenSandboxArchivePublisher(r.environment, credentials, archive, services, async () => {
      checked = await readFirstOpenSandboxCandidate(archive, r.writeBefore, services.token);
      if (r.writeBefore > checked.validUntil || Date.now() >= r.writeBefore) throw new Error("FIRST_OPEN_PUBLICATION_SCAN_AGE");
      await publisher.audit("intent", intent, { schema: r.schema, jobId: p.jobId, instanceId: p.instanceId, reviewSha256: sha, job });
      return checked;
    });
    const readback = await publisher.publish(intent);
    if (!checked || Date.now() >= r.writeBefore) throw new Error("FIRST_OPEN_PUBLICATION_EXPIRED");
    const proof = await firstOpenPublicationProof(readback, checked, sha, job, Date.now());
    await publisher.audit("published", intent, { proof, readback, notCataloged: true });
    await writeFile(resultFile, JSON.stringify({
      status: "FIRST_OPEN_APP_PUBLISHED_NOT_INSTALLED", proof, proofSha256: await sha256Hex(proof),
      readback, evidence: services.receipts, catalogWritten: false, installationPerformed: false, taskClaimed: false,
    }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: "FIRST_OPEN_APP_PUBLISHED_NOT_INSTALLED", requestId, registryManifestDigest: proof.registryManifestDigest }));
  } catch (e) {
    if (created) await writeFile(resultFile, JSON.stringify({ status: "STOPPED_REQUIRES_INSPECTION", reviewSha256: sha,
      job, code: code(e), evidence: services.receipts, automaticRetry: false }, null, 2) + "\n", { flag: "wx", mode: 0o600 }).catch(() => {});
    throw e;
  } finally { services.destroy(); }
}
main().catch(e => { console.error(JSON.stringify({ status: "FIRST_OPEN_PUBLICATION_STOPPED", code: code(e), retry: false })); process.exitCode = 1; });
