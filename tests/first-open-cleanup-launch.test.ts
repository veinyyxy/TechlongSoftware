import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { authorizeFirstOpenCleanupLaunch, bindFirstOpenCleanupDispatchAck, firstOpenCleanupDispatchInputs,
  renderFirstOpenCleanupDispatcher, verifyFirstOpenCleanupReceipt, type FirstOpenCleanupIntent } from "../ops/aws-sandbox/first-open-cleanup-launch.ts";
import { firstOpenSessionArn } from "../ops/aws-sandbox/first-open-sessions.ts";

const { load } = createRequire(import.meta.url)("js-yaml") as { load(source: string): unknown };
const repo = "veinyyxy/TechlongSoftware", runId = "1122334455";
const startAt = Date.UTC(2026, 10, 22, 19);
const intent: FirstOpenCleanupIntent = { schema: "techlong/fc41597f-cleanup-dispatch-intent/v1", jobId: "job_fc41597f9b5ba8e02b338ecf",
  installationApprovalSha256: "c".repeat(64), callerCommit: "a".repeat(40), sourceCommit: "b".repeat(40),
  startAt, issueBefore: startAt + 180_000, verifyBefore: startAt + 420_000 };

async function fixture() {
  const approvedIntentSha256 = await sha256Hex(intent);
  const { binding, bindingSha256 } = await bindFirstOpenCleanupDispatchAck(intent, approvedIntentSha256, runId, startAt - 1);
  const env = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: repo, GITHUB_REPOSITORY_ID: "1323312747",
    GITHUB_REPOSITORY_OWNER_ID: "14145707", GITHUB_ACTOR_ID: "14145707", GITHUB_REF: "refs/heads/main", GITHUB_RUN_ID: runId,
    GITHUB_RUN_ATTEMPT: "1", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_SHA: intent.callerCommit,
    GITHUB_WORKFLOW_REF: `${repo}/.github/workflows/sandbox-first-open-v1.yml@refs/heads/main`,
    FIRST_OPEN_CLEANUP_PERMIT: JSON.stringify(binding), FIRST_OPEN_CLEANUP_SHA: bindingSha256,
    FIRST_OPEN_CLEANUP_COMMIT: intent.sourceCommit, FIRST_OPEN_CLEANUP_REQUESTED_INTENT: approvedIntentSha256,
    FIRST_OPEN_CLEANUP_REQUESTED_INSTALLATION: intent.installationApprovalSha256 };
  return { env, approvedIntentSha256, binding, bindingSha256 };
}

test("cleanup-only dispatch can be prepared before its run ID exists; the approved job requires the exact ACK", async () => {
  const { env, approvedIntentSha256 } = await fixture();
  assert.deepEqual(await firstOpenCleanupDispatchInputs(intent, approvedIntentSha256), {
    mode: "cleanup-verify", pair_sha: approvedIntentSha256, release_sha: intent.installationApprovalSha256, inspect_run: "0",
  });
  const launch = await authorizeFirstOpenCleanupLaunch({ env, actualCheckout: intent.sourceCommit }, startAt);
  assert.equal(launch.permit.runId, runId);
  assert.equal(launch.permitSha256, await sha256Hex(launch.permit));
  for (const override of [{ GITHUB_RUN_ID: "1122334456" }, { GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_SHA: "d".repeat(40) },
    { FIRST_OPEN_CLEANUP_REQUESTED_INTENT: "1".repeat(64) }, { FIRST_OPEN_CLEANUP_REQUESTED_INSTALLATION: "1".repeat(64) },
    { FIRST_OPEN_CLEANUP_PERMIT: JSON.stringify(launch.permit) }]) {
    await assert.rejects(authorizeFirstOpenCleanupLaunch({ env: { ...env, ...override }, actualCheckout: intent.sourceCommit }, startAt), /LAUNCH_BINDING/);
  }
  await assert.rejects(authorizeFirstOpenCleanupLaunch({ env, actualCheckout: intent.sourceCommit }, intent.issueBefore), /CLEANUP_VERIFY_PERMIT/);
  await assert.rejects(authorizeFirstOpenCleanupLaunch({ env, actualCheckout: intent.callerCommit }, startAt), /LAUNCH_BINDING/);
});

test("the cleanup lane calls only the exact reusable under the existing owner environment", () => {
  const src = readFileSync(new URL("../.github/workflows/sandbox-first-open-v1.yml", import.meta.url), "utf8");
  const caller = load(renderFirstOpenCleanupDispatcher(src, intent.sourceCommit)) as { jobs: Record<string, { uses: string; if: string; secrets?: string }> };
  assert.equal(caller.jobs.cleanup.uses, `${repo}/.github/workflows/sandbox-first-open-cleanup-verify-v1.yml@${intent.sourceCommit}`);
  assert.match(caller.jobs.cleanup.if, /inputs.mode == 'cleanup-verify'.*inputs.inspect_run == '0'/);
  assert.ok(Object.entries(caller.jobs).filter(([name]) => name !== "cleanup").every(([,job]) => !job.if.includes("cleanup-verify")));
  assert.equal(caller.jobs.cleanup.secrets, undefined);
  const reusable = load(readFileSync(new URL("../.github/workflows/sandbox-first-open-cleanup-verify-v1.yml", import.meta.url), "utf8")) as {
    jobs: { verify: { environment: string; steps: { run?: string; with?: { path: string } }[] } };
  };
  assert.equal(reusable.jobs.verify.environment, "techlong-sandbox-deploy");
  assert.equal(reusable.jobs.verify.steps.at(-1)?.with?.path, "\u0024{{ runner.temp }}/fc41597f-cleanup-verify.json");
});

test("only the exact first-attempt cleanup artifact proves the read-only SQL component", async () => {
  const { env, approvedIntentSha256, binding, bindingSha256 } = await fixture();
  const launch = await authorizeFirstOpenCleanupLaunch({ env, actualCheckout: intent.sourceCommit }, startAt);
  const receipt = { schema: "techlong/fc41597f-cleanup-verify-receipt/v1", jobId: intent.jobId, runId, bindingSha256,
    installationApprovalSha256: intent.installationApprovalSha256, installationSha256: launch.permitSha256,
    sessionArnSha256: await sha256Hex(firstOpenSessionArn("cleanup")), checkedAt: startAt + 1,
    maintenanceWriter: true, tenantAbsent: true, fixedRoutineVisible: true, readOnly: true,
    cleanupInvoked: false, firstOpenDispatched: false, tenantClaimed: false };
  const zip = zipSync({ "fc41597f-cleanup-verify.json": strToU8(JSON.stringify(receipt)) });
  const actor = { id: 14145707 }, repository = { id: 1323312747, full_name: repo, owner: actor };
  const authenticatedRun = { id: Number(runId), workflow_id: 426525508, run_attempt: 1, actor, triggering_actor: actor,
    repository, head_repository: repository, event: "workflow_dispatch", path: ".github/workflows/sandbox-first-open-v1.yml",
    head_branch: "main", head_sha: intent.callerCommit, status: "completed", conclusion: "success",
    display_title: `first-open-fc41597f-cleanup-verify-${approvedIntentSha256}` };
  const authenticatedArtifact = { id: 112, name: `fc41597f-cleanup-verify-${approvedIntentSha256}`, expired: false,
    expires_at: new Date(intent.verifyBefore + 3600_000).toISOString(), size_in_bytes: zip.length,
    digest: `sha256:${createHash("sha256").update(zip).digest("hex")}`,
    workflow_run: { id: Number(runId), repository_id: 1323312747, head_repository_id: 1323312747, head_branch: "main", head_sha: intent.callerCommit } };
  const input = { binding, bindingSha256, approvedIntentSha256, authenticatedRun, authenticatedArtifact, zip };
  const accepted = await verifyFirstOpenCleanupReceipt(input, startAt + 15_000);
  assert.equal(accepted.postgresSha256, await sha256Hex(receipt));
  assert.equal(accepted.cleanupPermissionsVerified, false);
  assert.equal(accepted.cleanupAuthorized, false);
  await assert.rejects(verifyFirstOpenCleanupReceipt({ ...input, authenticatedRun: { ...authenticatedRun, run_attempt: 2 } }, startAt + 15_000), /LAUNCH_BINDING/);
  await assert.rejects(verifyFirstOpenCleanupReceipt({ ...input, authenticatedArtifact: { ...authenticatedArtifact, digest: "sha256:" + "0".repeat(64) } }, startAt + 15_000), /LAUNCH_BINDING/);
  const extra = zipSync({ "fc41597f-cleanup-verify.json": strToU8(JSON.stringify(receipt)), "unexpected.txt": strToU8("ignore me") });
  await assert.rejects(verifyFirstOpenCleanupReceipt({ ...input, zip: extra, authenticatedArtifact: { ...authenticatedArtifact,
    size_in_bytes: extra.length, digest: `sha256:${createHash("sha256").update(extra).digest("hex")}` } }, startAt + 15_000), /LAUNCH_BINDING/);
});
