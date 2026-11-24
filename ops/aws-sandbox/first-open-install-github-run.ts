import { setTimeout as delay } from "node:timers/promises";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { firstOpenInstallProvisionerLane } from "./first-open-install-inspector-scope.ts";
import type { FirstOpenInstallReadbackPlan } from "./first-open-install-readback.ts";
import contract from "./first-open-fc41597f-oidc-handoffs.prepared.json" with { type: "json" };

const repository = "veinyyxy/TechlongSoftware", repositoryId = "1323312747", ownerId = "14145707";
const environment = "techlong-sandbox-deploy", exactEnvironmentId = "24613410405";
const authApi = `https://api.github.com/repos/${repository}/actions`, path = `/repos/${repository}/actions`;
const digest = /^[a-f0-9]{64}$/, commit = /^[a-f0-9]{40}$/, id = /^[1-9][0-9]{0,19}$/;
const pendingDelaysMs = [20_000, 30_000, 30_000] as const;
type Fields = Record<string, unknown>;
const fail = (code: string): never => { throw Error("FIRST_OPEN_INSTALL_GITHUB_RUN_" + code); };
const object = (value: unknown): Fields => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Fields : {};
const githubId = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : "";
type RunCoordinates = { runId: string; url: string };
type Request = (method: "GET" | "POST", path: string, signal: AbortSignal, body?: Fields) => Promise<{ status: number; value: unknown }>;

/** The caller has already reserved the durable dispatch intent and proved
 * publication and the environment policy. This helper does one fixed dispatch
 * and at most three exact gate observations, with no search, approval API,
 * failed-request retry or cleanup. Only a valid empty pending list may be re-read. */
export async function dispatchFirstOpenInstallGitHubRun(input: {
  plan: FirstOpenInstallReadbackPlan; approvedSha256: string; environmentId: string;
  request: Request; signal: AbortSignal;
  config: {
    prepare(plan: FirstOpenInstallReadbackPlan, approvedSha256: string, signal: AbortSignal): Promise<void>;
    bindRun(runId: string, signal: AbortSignal): Promise<void>;
  };
  onDispatchAcknowledged?(run: RunCoordinates, signal: AbortSignal): Promise<unknown> | unknown;
  onApprovalRequired(run: RunCoordinates, signal: AbortSignal): Promise<unknown> | unknown;
  now?: () => number; wait?: (ms: number, signal: AbortSignal) => Promise<unknown>;
}) {
  const { approvedSha256, config, request, now = Date.now, signal: upstream } = input;
  const wait = input.wait ?? ((ms: number, signal: AbortSignal) => delay(ms, undefined, { signal }));
  const plan = structuredClone(input.plan), { release, releaseSha256, staging, window } = plan;
  if (input.environmentId !== exactEnvironmentId || plan.schema !== "techlong/fc41597f-independent-install-readback/v2" ||
    plan.lane !== firstOpenInstallProvisionerLane || plan.jobId !== contract.jobId || release.jobId !== plan.jobId ||
    !digest.test(approvedSha256) || Buffer.byteLength(canonicalJson(plan)) > 32_768 || await sha256Hex(plan) !== approvedSha256 ||
    !digest.test(releaseSha256) || await sha256Hex(release) !== releaseSha256 || release.actorId !== ownerId ||
    ![release.callerCommit, release.runtimeCommit, release.inspectReusableCommit].every(x => commit.test(x)) ||
    !id.test(release.workflowId) || !staging ||
    ![window.startAt, window.issueBefore, staging.scope.readBefore, window.factsCutoff, release.startAt].every(Number.isSafeInteger) ||
    window.startAt <= 0 || !(window.startAt < window.issueBefore && window.issueBefore <= staging.scope.readBefore &&
      staging.scope.readBefore <= window.factsCutoff && staging.scope.readBefore <= release.startAt)) return fail("PLAN");
  const end = window.issueBefore, started = now();
  const open = () => {
    const at = now();
    if (upstream.aborted || !Number.isSafeInteger(at) || at < window.startAt || at >= end) return fail("WINDOW");
    return at;
  };
  open();
  if (started + pendingDelaysMs[0] >= end) return fail("WINDOW");
  const signal = AbortSignal.any([upstream, AbortSignal.timeout(Math.max(1, Math.min(end - started, 3_300_000)))]);
  const active = () => { if (signal.aborted) return fail("WINDOW"); return open(); };
  async function bounded<T>(code: string, fn: () => Promise<T> | T) {
    active();
    let result: T;
    try { result = await fn(); } catch { return fail(code); }
    active();
    return result;
  }

  await bounded("CONFIG_PREPARE_STOP_NO_RETRY", () => config.prepare(structuredClone(plan), approvedSha256, signal));
  if (active() + pendingDelaysMs[0] >= end) return fail("WINDOW");
  const dispatch = await bounded("DISPATCH_ACK_UNKNOWN", () => request("POST", `${path}/workflows/${release.workflowId}/dispatches`, signal,
    { ref: "main", return_run_details: true, inputs: { mode: "install-readback", pair_sha: approvedSha256,
      release_sha: releaseSha256, inspect_run: "0" } }));
  const ack = object(dispatch?.value), runId = githubId(ack.workflow_run_id), url = `https://github.com/${repository}/actions/runs/${runId}`;
  if (dispatch?.status !== 200 || !runId || ack.html_url !== url || ack.run_url !== `${authApi}/runs/${runId}`) return fail("DISPATCH_ACK_UNKNOWN");
  if (input.onDispatchAcknowledged) await bounded("DISPATCH_ACK_RECORD_FAILED", () => input.onDispatchAcknowledged!({ runId, url }, signal));
  await bounded("CONFIG_RUN_STOP_NO_RETRY", () => config.bindRun(runId, signal));
  const exactRun = `${path}/runs/${runId}`;
  let ready = false;
  for (const delayMs of pendingDelaysMs) {
    const checkAt = active() + delayMs;
    if (checkAt >= end) return fail("WINDOW");
    await bounded("WAIT_STOP_NO_RETRY", () => wait(delayMs, signal));
    if (active() < checkAt) return fail("WINDOW");
    const pending = await bounded("GATE_READ_STOP_NO_RETRY", () => request("GET", `${exactRun}/pending_deployments`, signal));
    const deployments = pending?.value;
    if (pending?.status !== 200 || !Array.isArray(deployments)) return fail("GATE_NOT_PROVED");
    if (deployments.length === 0) continue;
    const gated = object(deployments[0]), gate = object(gated.environment);
    if (deployments.length !== 1 || githubId(gate.id) !== exactEnvironmentId || gate.name !== environment ||
      gated.current_user_can_approve !== true) return fail("GATE_NOT_PROVED");
    ready = true;
    break;
  }
  if (!ready) return fail("GATE_NOT_READY");
  const metadata = await bounded("RUN_READ_STOP_NO_RETRY", () => request("GET", exactRun, signal));
  const r = object(metadata?.value), repo = object(r.repository);
  if (metadata?.status !== 200 || githubId(r.id) !== runId || githubId(r.workflow_id) !== release.workflowId || r.run_attempt !== 1 ||
    r.event !== "workflow_dispatch" || r.path !== contract.federatedTrust.callerPathCandidate || r.html_url !== url ||
    r.head_branch !== "main" || r.head_sha !== release.callerCommit || r.display_title !== `first-open-fc41597f-install-readback-${approvedSha256}` ||
    githubId(object(r.actor).id) !== ownerId || githubId(object(r.triggering_actor).id) !== ownerId ||
    githubId(repo.id) !== repositoryId || repo.full_name !== repository || githubId(object(repo.owner).id) !== ownerId ||
    githubId(object(r.head_repository).id) !== repositoryId ||
    !["waiting", "pending", "in_progress"].includes(r.status as string) || r.conclusion !== null) return fail("RUN_MISMATCH");

  await bounded("APPROVAL_NOTICE_FAILED", () => input.onApprovalRequired({ runId, url }, signal));
  return { runId };
}
