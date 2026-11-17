import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { bootstrapCodeFiles, validateBootstrapReview, assertBootstrapJob, publishInitialA, type BootstrapReview, type BootstrapJob } from "../ops/releases/bootstrap.ts";
import { assumeReleaseIdentity, assertReleaseIdentity, requireHumanReview } from "../ops/releases/aws-runtime.ts";
import { releasePromotionPublisher, releasePromotionServices } from "../ops/releases/promotion-runtime.ts";

const errorCode = (e: unknown) => e instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(e.message) ? e.message : "RELEASE_BOOTSTRAP_STOPPED_NO_RETRY";
async function main() {
  const mode = process.argv[2] ?? "check";
  if (!["check", "publish"].includes(mode)) throw new Error("RELEASE_BOOTSTRAP_MODE_REJECTED");
  const review = JSON.parse(await readFile(new URL("../ops/releases/bootstrap.review.json", import.meta.url), "utf8"));
  if (mode === "check" || review.enabled === false) {
    console.log(JSON.stringify({ status: "BOOTSTRAP_PUBLICATION_NOT_EXECUTED", enabled: review.enabled === true, credentialsUsed: false, productionCalls: 0 })); return;
  }
  const r = review as BootstrapReview, sha = process.env.RELEASE_BOOTSTRAP_REVIEW_SHA ?? "";
  const code = await Promise.all(bootstrapCodeFiles.map(async file => ({ path: file,
    sha256: await sha256Hex((await readFile(file, "utf8")).replaceAll("\r\n", "\n")) })));
  await validateBootstrapReview(r, sha, code, Date.now());
  const env = process.env;
  const job: BootstrapJob = { repository: env.GITHUB_REPOSITORY ?? "", repositoryId: env.GITHUB_REPOSITORY_ID ?? "", runId: env.GITHUB_RUN_ID ?? "",
    runAttempt: Number(env.GITHUB_RUN_ATTEMPT), sourceSha: env.GITHUB_SHA ?? "", ref: env.GITHUB_REF ?? "", event: env.GITHUB_EVENT_NAME ?? "",
    actor: env.GITHUB_ACTOR ?? "", actorId: env.GITHUB_ACTOR_ID ?? "", workflowRef: env.GITHUB_WORKFLOW_REF ?? "" };
  assertBootstrapJob(job, r);
  const checkout = await promisify(execFile)("git", ["rev-parse", "HEAD"], { windowsHide: true, timeout: 10000 });
  if (checkout.stdout.trim() !== job.sourceSha || !env.RUNNER_TEMP || !path.isAbsolute(env.RUNNER_TEMP)) throw new Error("RELEASE_BOOTSTRAP_CHECKOUT_OR_RUNNER_REJECTED");
  await requireHumanReview(job, r.environment, env.RELEASE_GITHUB_READ_TOKEN ?? "");
  const credentials = await assumeReleaseIdentity(job, r.environment, "publisher", env);
  const sts = new STSClient({ region: r.environment.region, credentials, maxAttempts: 1, endpoint: `https://sts.${r.environment.region}.amazonaws.com` });
  try { assertReleaseIdentity(await sts.send(new GetCallerIdentityCommand({})), r.environment, "publisher"); } finally { sts.destroy(); }
  const root = path.join(env.RUNNER_TEMP, "initial-app-" + job.runId), services = releasePromotionServices(r.environment, credentials);
  let puts = 0, created = false;
  try {
    // Existing transport re-downloads/verifies only A and rejects an occupied tag.
    const publisher = releasePromotionPublisher(r.environment, credentials, path.join(root, "image"), {
      token: services.token, put: async (key, body) => {
        if (++puts > 3) throw new Error("RELEASE_BOOTSTRAP_AUDIT_BUDGET"); await services.put(key, body);
      },
    }, undefined, undefined, undefined, undefined, true);
    await mkdir(root, { mode: 0o700 }); created = true;
    const result = await publishInitialA(r, sha, job, publisher, Date.now);
    await writeFile(path.join(root, "publication-result.json"), JSON.stringify({ ...result, evidence: services.receipts }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: result.status, requestId: result.requestId, evidence: services.receipts,
      catalogWritten: false, runtimeEnabled: false, workloadRestored: false }));
  } catch (e) {
    if (created) await writeFile(path.join(root, "publication-result.json"), JSON.stringify({ schema: "techlong/initial-app-publication-stopped/v1",
      status: "STOPPED_REQUIRES_INSPECTION", reviewSha256: sha, job, code: errorCode(e), evidence: services.receipts,
      automaticRetry: false, catalogWritten: false, runtimeEnabled: false }, null, 2) + "\n", { flag: "wx", mode: 0o600 }).catch(() => {});
    throw e;
  } finally { services.destroy(); }
}
main().catch(e => { console.error(JSON.stringify({ status: "BOOTSTRAP_PUBLICATION_STOPPED", code: errorCode(e), retry: false })); process.exitCode = 1; });
