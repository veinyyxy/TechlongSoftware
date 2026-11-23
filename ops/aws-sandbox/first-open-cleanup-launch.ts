import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { checkFirstOpenCleanupPermit, type FirstOpenCleanupPermit } from "./first-open-cleanup-verify.ts";
import { firstOpenSessionArn } from "./first-open-sessions.ts";

const jobId = "job_fc41597f9b5ba8e02b338ecf";
const repo = "veinyyxy/TechlongSoftware";
const callerRef = `${repo}/.github/workflows/sandbox-first-open-v1.yml@refs/heads/main`;
const sha = /^[a-f0-9]{64}$/, commit = /^[a-f0-9]{40}$/, id = /^[1-9][0-9]{0,19}$/;
const fail = (): never => { throw Error("FIRST_OPEN_CLEANUP_LAUNCH_BINDING"); };
const hasKeys = (value: unknown, keys: string) => !!value && typeof value === "object" &&
  Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).sort().join(",") === keys;

export type FirstOpenCleanupIntent = {
  schema: "techlong/fc41597f-cleanup-dispatch-intent/v1";
  jobId: typeof jobId;
  installationApprovalSha256: string;
  callerCommit: string;
  sourceCommit: string;
  startAt: number;
  issueBefore: number;
  verifyBefore: number;
};

type CleanupRunBinding = {
  schema: "techlong/fc41597f-cleanup-run-binding/v1";
  intent: FirstOpenCleanupIntent;
  runId: string;
};

function cleanupPermit(binding: CleanupRunBinding): FirstOpenCleanupPermit {
  const { sourceCommit, startAt, issueBefore, verifyBefore } = binding.intent;
  return { schema: "techlong/fc41597f-cleanup-verify/v1", jobId, sourceCommit, runId: binding.runId, startAt, issueBefore, verifyBefore };
}

/** Only render a distinct cleanup-only lane in a sealed caller candidate.
 * The fourth reusable must already exist at an exact, reviewed runtime commit. */
export function renderFirstOpenCleanupDispatcher(source: string, cleanupReusableCommit: string) {
  source = source.replaceAll("\r\n", "\n");
  const oldModes = "options: [inspect, runonce, install-readback]";
  const title = "run-name: \u0024{{ ";
  if (!commit.test(cleanupReusableCommit) || source.includes("cleanup-verify") ||
    source.split(oldModes).length !== 2 || source.split(title).length !== 2 || !source.includes("  management:\n")) return fail();
  const text = source.replace(oldModes, "options: [inspect, runonce, install-readback, cleanup-verify]")
    .replace(title, title + "inputs.mode == 'cleanup-verify' && format('first-open-fc41597f-cleanup-verify-{0}', inputs.pair_sha) || ");
  return text.trimEnd() + `
  cleanup:
    if: inputs.mode == 'cleanup-verify' && inputs.inspect_run == '0' && github.ref == 'refs/heads/main' && github.run_attempt == 1 && github.repository_id == '1323312747' && github.repository_owner_id == '14145707' && github.actor_id == '14145707'
    uses: ${repo}/.github/workflows/sandbox-first-open-cleanup-verify-v1.yml@${cleanupReusableCommit}
    with:
      intent_sha: \u0024{{ inputs.pair_sha }}
      installation_sha: \u0024{{ inputs.release_sha }}
`;
}

async function checkIntent(intent: FirstOpenCleanupIntent, approvedIntentSha256: string) {
  if (!hasKeys(intent, "callerCommit,installationApprovalSha256,issueBefore,jobId,schema,sourceCommit,startAt,verifyBefore") ||
    intent.schema !== "techlong/fc41597f-cleanup-dispatch-intent/v1" || intent.jobId !== jobId ||
    !sha.test(intent.installationApprovalSha256) || !commit.test(intent.callerCommit) || !commit.test(intent.sourceCommit) ||
    intent.callerCommit === intent.sourceCommit || ![intent.startAt, intent.issueBefore, intent.verifyBefore].every(Number.isSafeInteger) ||
    intent.startAt <= 0 || intent.startAt >= intent.issueBefore || intent.verifyBefore - intent.issueBefore < 120_000 ||
    intent.verifyBefore - intent.startAt > 600_000 || !sha.test(approvedIntentSha256) ||
    await sha256Hex(intent) !== approvedIntentSha256) return fail();
}

/** Render the inputs only. The exact GitHub run ID is deliberately unknowable here. */
export async function firstOpenCleanupDispatchInputs(intent: FirstOpenCleanupIntent, approvedIntentSha256: string) {
  const i = structuredClone(intent);
  await checkIntent(i, approvedIntentSha256);
  return { mode: "cleanup-verify", pair_sha: approvedIntentSha256, release_sha: i.installationApprovalSha256, inspect_run: "0" } as const;
}

/** After the separately authorized dispatch, use only its real ACK to bind the
 * protected record before the owner approves the environment. No GitHub I/O. */
export async function bindFirstOpenCleanupDispatchAck(intent: FirstOpenCleanupIntent, approvedIntentSha256: string, runId: string, now: number) {
  const i = structuredClone(intent);
  await checkIntent(i, approvedIntentSha256);
  if (!id.test(runId) || !Number.isSafeInteger(now) || now >= i.issueBefore) return fail();
  const binding: CleanupRunBinding = { schema: "techlong/fc41597f-cleanup-run-binding/v1", intent: i, runId };
  return { binding, bindingSha256: await sha256Hex(binding) };
}

export async function authorizeFirstOpenCleanupLaunch(input: {
  env: Readonly<Record<string, string | undefined>>;
  actualCheckout: string;
}, now: number) {
  const e = input.env, text = e.FIRST_OPEN_CLEANUP_PERMIT, expected = e.FIRST_OPEN_CLEANUP_SHA ?? "";
  if (e.GITHUB_ACTIONS !== "true" || e.GITHUB_REPOSITORY !== repo || e.GITHUB_REPOSITORY_ID !== "1323312747" ||
    e.GITHUB_REPOSITORY_OWNER_ID !== "14145707" || e.GITHUB_ACTOR_ID !== "14145707" || e.GITHUB_REF !== "refs/heads/main" ||
    e.GITHUB_RUN_ATTEMPT !== "1" || e.GITHUB_EVENT_NAME !== "workflow_dispatch" || e.GITHUB_WORKFLOW_REF !== callerRef ||
    !id.test(e.GITHUB_RUN_ID ?? "") || !text || Buffer.byteLength(text) > 4_096 || !sha.test(expected)) return fail();
  let b: CleanupRunBinding;
  try { b = JSON.parse(text); } catch { return fail(); }
  if (!hasKeys(b, "intent,runId,schema") || b.schema !== "techlong/fc41597f-cleanup-run-binding/v1" ||
    b.runId !== e.GITHUB_RUN_ID || await sha256Hex(b) !== expected) return fail();
  const { intent } = b;
  await checkIntent(intent, e.FIRST_OPEN_CLEANUP_REQUESTED_INTENT ?? "");
  if (intent.installationApprovalSha256 !== e.FIRST_OPEN_CLEANUP_REQUESTED_INSTALLATION ||
    intent.callerCommit !== e.GITHUB_SHA || intent.sourceCommit !== e.FIRST_OPEN_CLEANUP_COMMIT ||
    intent.sourceCommit !== input.actualCheckout) return fail();
  const permit = cleanupPermit(b);
  const permitSha256 = await sha256Hex(permit);
  await checkFirstOpenCleanupPermit(permit, permitSha256, now);
  return { permit, permitSha256, bindingSha256: expected, callerCommit: intent.callerCommit,
    installationApprovalSha256: intent.installationApprovalSha256 };
}

type Fields = Record<string, unknown>;
const record = (v: unknown): Fields => v && typeof v === "object" && !Array.isArray(v) ? v as Fields : {};
const numeric = (v: unknown, exact: string) => (typeof v === "string" || typeof v === "number" && Number.isSafeInteger(v)) && String(v) === exact;

/** Compare metadata and ZIP from the separately authenticated exact GitHub run.
 * This proves the narrow SQL check; it cannot authorize cleanup or stand in
 * for the independent AWS deletion-scope evidence needed by the launch gate. */
export async function verifyFirstOpenCleanupReceipt(input: {
  binding: CleanupRunBinding; bindingSha256: string; approvedIntentSha256: string;
  authenticatedRun: Fields; authenticatedArtifact: Fields; zip: Uint8Array;
}, now: number) {
  if (!(input.zip instanceof Uint8Array) || input.zip.length < 1 || input.zip.length > 32_768 || !Number.isSafeInteger(now)) return fail();
  const { binding: b, bindingSha256, approvedIntentSha256, authenticatedRun: run, authenticatedArtifact: a, zip } = structuredClone(input);
  if (!hasKeys(b, "intent,runId,schema") || b.schema !== "techlong/fc41597f-cleanup-run-binding/v1" || !id.test(b.runId) ||
    !sha.test(bindingSha256) || await sha256Hex(b) !== bindingSha256) return fail();
  await checkIntent(b.intent, approvedIntentSha256);
  const ar = record(a.workflow_run), repository = record(run.repository), shaZip = createHash("sha256").update(zip).digest("hex");
  if (!numeric(run.id, b.runId) || !numeric(run.workflow_id, "426525508") || run.run_attempt !== 1 ||
    run.event !== "workflow_dispatch" || run.path !== ".github/workflows/sandbox-first-open-v1.yml" ||
    run.head_branch !== "main" || run.head_sha !== b.intent.callerCommit || run.status !== "completed" || run.conclusion !== "success" ||
    run.display_title !== `first-open-fc41597f-cleanup-verify-${approvedIntentSha256}` || repository.full_name !== repo ||
    !numeric(repository.id, "1323312747") || !numeric(record(repository.owner).id, "14145707") ||
    !numeric(record(run.head_repository).id, "1323312747") || !numeric(record(run.actor).id, "14145707") ||
    !numeric(record(run.triggering_actor).id, "14145707") || !id.test(String(a.id ?? "")) || !numeric(a.id, String(a.id)) ||
    a.name !== `fc41597f-cleanup-verify-${approvedIntentSha256}` || a.expired !== false || !numeric(ar.id, b.runId) ||
    !numeric(ar.repository_id, "1323312747") || !numeric(ar.head_repository_id, "1323312747") ||
    ar.head_branch !== "main" || ar.head_sha !== b.intent.callerCommit || a.digest !== `sha256:${shaZip}` ||
    a.size_in_bytes !== zip.length ||
    !(now < Date.parse(typeof a.expires_at === "string" ? a.expires_at : ""))) return fail();
  let filesSeen = 0;
  const name = "fc41597f-cleanup-verify.json";
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip, { filter: file => ++filesSeen === 1 && file.name === name && file.originalSize > 0 && file.originalSize <= 4_096 });
  } catch { return fail(); }
  if (filesSeen !== 1 || !Object.hasOwn(files, name) || files[name].length > 4_096) return fail();
  let receipt: Fields;
  try { receipt = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(files[name])); } catch { return fail(); }
  if (!hasKeys(receipt, "bindingSha256,checkedAt,cleanupInvoked,firstOpenDispatched,fixedRoutineVisible,installationApprovalSha256,installationSha256,jobId,maintenanceWriter,readOnly,runId,schema,sessionArnSha256,tenantAbsent,tenantClaimed") ||
    receipt.schema !== "techlong/fc41597f-cleanup-verify-receipt/v1" || receipt.jobId !== jobId || receipt.runId !== b.runId ||
    receipt.bindingSha256 !== bindingSha256 || receipt.installationApprovalSha256 !== b.intent.installationApprovalSha256 ||
    receipt.installationSha256 !== await sha256Hex(cleanupPermit(b)) || receipt.sessionArnSha256 !== await sha256Hex(firstOpenSessionArn("cleanup")) ||
    receipt.readOnly !== true || receipt.maintenanceWriter !== true || receipt.tenantAbsent !== true || receipt.fixedRoutineVisible !== true ||
    receipt.cleanupInvoked !== false || receipt.firstOpenDispatched !== false || receipt.tenantClaimed !== false ||
    typeof receipt.checkedAt !== "number" || !Number.isSafeInteger(receipt.checkedAt) ||
    receipt.checkedAt < b.intent.startAt || receipt.checkedAt >= b.intent.verifyBefore || receipt.checkedAt > now) return fail();
  return { jobId, runId: b.runId, artifactId: String(a.id), artifactSha256: shaZip, bindingSha256,
    postgresSha256: await sha256Hex(receipt), checkedAt: receipt.checkedAt,
    cleanupPermissionsVerified: false as const, cleanupAuthorized: false as const };
}
