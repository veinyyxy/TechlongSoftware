import { Buffer } from "node:buffer";
import { sha256Hex } from "../../lib/deployments/execution/hash.ts";
import type { FirstOpenFrozenRelease } from "./first-open-release-entry.ts";
import type { FirstOpenInstallReadbackPlan } from "./first-open-install-readback.ts";
import { firstOpenArtifactIo } from "./first-open-github-handoff.ts";
import { verifyFirstOpenInstallPublication } from "./first-open-install-github-publication.ts";
import { bindFirstOpenInstallGitHubConfig } from "./first-open-install-github-config.ts";
import { dispatchFirstOpenInstallGitHubRun } from "./first-open-install-github-run.ts";

const repo = "/repos/veinyyxy/TechlongSoftware", envId = "24613410405", environment = "techlong-sandbox-deploy";
const envPath = `${repo}/environments/${environment}`, workflowPath = ".github/workflows/sandbox-first-open-v1.yml";
const hex = /^[a-f0-9]{64}$/, commit = /^[a-f0-9]{40}$/, id = /^[1-9][0-9]{0,19}$/;
const planSecret = "TECHLONG_FIRST_OPEN_INSTALL_READBACK_PLAN";
const varNames = ["TECHLONG_FIRST_OPEN_INSTALL_READBACK_PLAN_SHA256", "TECHLONG_FIRST_OPEN_INSTALL_RUNTIME_COMMIT",
  "TECHLONG_FIRST_OPEN_INSTALL_READBACK_RUN_ID"] as const;
const variables = `${envPath}/variables`, secret = `${envPath}/secrets/${planSecret}`;
const fail = (code: string): never => { throw Error("FIRST_OPEN_INSTALL_GITHUB_" + code); };
type Method = "GET" | "POST" | "PUT" | "DELETE";
type Json = Record<string, unknown>;

async function readJson(res: Response): Promise<unknown> {
  if (!res.body) return null;
  const stream = res.body.getReader(), chunks: Uint8Array[] = [];
  let count = 0;
  try {
    for (;;) {
      const r = await stream.read();
      if (r.done) break;
      if ((count += r.value.length) > 512 * 1024) return fail("RESPONSE_LIMIT");
      chunks.push(r.value);
    }
  } finally { await stream.cancel().catch(() => {}); }
  if (!count) return null;
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, count))); }
  catch { return fail("RESPONSE_SHAPE"); }
}

/** Single-repo authenticated transport. All mutable endpoints are exact and
 * listed here. The run ID becomes usable only from this response's own ACK. */
export function firstOpenInstallGitHubTransport(input: { token: string; release: FirstOpenFrozenRelease;
  fetch?: typeof fetch; now?: () => number }) {
  const { token, fetch: send = fetch, now = Date.now } = input, r = structuredClone(input.release);
  if (!/^[A-Za-z0-9_]+$/.test(token) || !id.test(r.workflowId) || !commit.test(r.callerCommit) || !commit.test(r.runtimeCommit) ||
    !Number.isSafeInteger(r.writeBefore)) return fail("TRANSPORT_PIN");
  const dispatch = `${repo}/actions/workflows/${r.workflowId}/dispatches`;
  const reads = new Set(["/user", repo, `${repo}/git/ref/heads/main`, `${repo}/actions/workflows/${r.workflowId}`, envPath,
    `${envPath}/deployment-branch-policies?per_page=10`,
    `${envPath}/secrets/public-key`, `${repo}/contents/${workflowPath}?ref=${r.callerCommit}`,
    `${repo}/contents/.github/workflows/sandbox-first-open-inspect-job-v1.yml?ref=${r.runtimeCommit}`,
    secret, ...varNames.map(n => `${variables}/${n}`)]);
  let runId: string | undefined, preparedPlanSha: string | undefined, attempts = 0, dispatched = false;
  const changed = new Set<string>();
  const created = new Set<string>();
  return async (method: Method, path: string, upstream: AbortSignal, body?: Json) => {
    upstream.throwIfAborted();
    const remaining = r.writeBefore - now();
    if (remaining <= 0 || ++attempts > 64) return fail("TRANSPORT_LIMIT");
    const boundRun = runId ? `${repo}/actions/runs/${runId}` : undefined;
    let mutation: string | undefined;
    if (method === "GET") {
      if (body || !(reads.has(path) || (boundRun && (path === boundRun || path === `${boundRun}/pending_deployments`)))) return fail("READ_SCOPE");
    } else if (method === "PUT" && path === secret && body && typeof body.key_id === "string" &&
      typeof body.encrypted_value === "string" && /^[A-Za-z0-9+/]+=*$/.test(body.encrypted_value) && Object.keys(body).length === 2) {
      mutation = `create:${secret}`;
    } else if (method === "POST" && path === variables && body && Object.keys(body).length === 2 &&
      varNames.some(n => body.name === n) && typeof body.value === "string" &&
      (body.name === varNames[0] ? hex.test(body.value) : body.name === varNames[1] ? body.value === r.runtimeCommit : body.value === runId)) {
      mutation = `create:${String(body.name)}`;
    } else if (method === "POST" && path === dispatch && body && !dispatched && body.ref === "main" && body.return_run_details === true &&
      Object.keys(body).length === 3 && typeof body.inputs === "object" && body.inputs !== null) {
      const values = body.inputs as Json;
      if (Object.keys(values).length !== 4 || values.mode !== "install-readback" || values.inspect_run !== "0" ||
        !preparedPlanSha || values.pair_sha !== preparedPlanSha || values.release_sha !== await sha256Hex(r) ||
        ![secret, `${variables}/${varNames[0]}`, `${variables}/${varNames[1]}`].every(p => created.has(p))) {
        return fail("DISPATCH_SCOPE");
      }
      dispatched = true;
      mutation = "dispatch";
    } else if (method === "DELETE" && !body && created.has(path)) {
      mutation = `delete:${path}`;
    } else return fail("MUTATION_SCOPE");
    if (mutation) {
      if (changed.has(mutation)) return fail("MUTATION_ALREADY_USED");
      changed.add(mutation);
    }
    const signal = AbortSignal.any([upstream, AbortSignal.timeout(Math.max(1, Math.min(8_000, remaining)))]);
    let response: Response;
    try {
      response = await send(`https://api.github.com${path}`, { method, signal, redirect: "error", headers: {
        Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28",
        ...(body && { "Content-Type": "application/json" }),
      }, ...(body && { body: JSON.stringify(body) }) });
    } catch { return fail("REQUEST_STOP_NO_RETRY"); }
    const value = await readJson(response);
    signal.throwIfAborted();
    if (now() >= r.writeBefore) return fail("TRANSPORT_LIMIT");
    if (response.status === 201 && method === "PUT" && path === secret) created.add(secret);
    if (response.status === 201 && method === "POST" && path === variables && body) {
      created.add(`${variables}/${String(body.name)}`);
      if (body.name === varNames[0]) preparedPlanSha = String(body.value);
    }
    if (mutation === "dispatch" && response.status === 200 && typeof value === "object" && value !== null) {
      const ack = value as Json, candidate = String(ack.workflow_run_id);
      if (typeof ack.workflow_run_id === "number" && Number.isSafeInteger(ack.workflow_run_id) && id.test(candidate) &&
        ack.run_url === `https://api.github.com${repo}/actions/runs/${candidate}` &&
        ack.html_url === `https://github.com/veinyyxy/TechlongSoftware/actions/runs/${candidate}`) runId = candidate;
    }
    const scopes = (response.headers.get("x-oauth-scopes") ?? "").toLowerCase().split(",").map(s => s.trim());
    const authorizedNotFound = response.status === 404 && scopes.includes("repo") && scopes.includes("workflow") &&
      (value as Json | null)?.message === "Not Found";
    const paginated = /rel=["']next["']/i.test(response.headers.get("link") ?? "");
    return { status: response.status, value, authorizedNotFound, paginated };
  };
}

/** Uses only injected approved credentials and existing sealed-box provider.
 * Constructing this port does not read credentials, push, dispatch or approve. */
export function bindFirstOpenInstallGitHub(input: { release: FirstOpenFrozenRelease; operatorToken: string; artifactReadToken: string;
  seal(plaintext: Uint8Array, publicKey: Uint8Array): Promise<Uint8Array>;
  record(event: Json): Promise<void>;
  onApprovalRequired(value: { runId: string; url: string }, signal: AbortSignal): Promise<void>;
  fetch?: typeof fetch; now?: () => number; wait?: (ms: number, signal: AbortSignal) => Promise<void> }) {
  const { operatorToken, artifactReadToken, seal, record, onApprovalRequired, fetch: send, now = Date.now, wait } = input;
  const release = structuredClone(input.release);
  const request = firstOpenInstallGitHubTransport({ token: operatorToken, release, fetch: send, now });
  const artifacts = firstOpenArtifactIo({ token: artifactReadToken, fetch: send, now, pause: wait });
  const configuration = bindFirstOpenInstallGitHubConfig({ request, environmentId: envId, seal, journal: { record }, now });
  let active: { runId: string; planSha256: string } | undefined, launchAttempted = false;
  return {
    artifactReadToken, fetch: send,
    verifyPublication(candidate: FirstOpenFrozenRelease, signal: AbortSignal) {
      if (candidate.callerCommit !== release.callerCommit || candidate.runtimeCommit !== release.runtimeCommit ||
        candidate.workflowId !== release.workflowId) return fail("RELEASE_CHANGED");
      return verifyFirstOpenInstallPublication({ release: candidate, environmentId: envId, request, signal });
    },
    async dispatchInstallReadback(plan: FirstOpenInstallReadbackPlan, approvedSha256: string, signal: AbortSignal) {
      if (launchAttempted || plan.release.callerCommit !== release.callerCommit || plan.release.runtimeCommit !== release.runtimeCommit) return fail("RELEASE_CHANGED");
      launchAttempted = true;
      const result = await dispatchFirstOpenInstallGitHubRun({ plan, approvedSha256, request, config: configuration, onApprovalRequired,
        onDispatchAcknowledged: async ({ runId }) => record({ kind: "dispatch-ack", runId, planSha256: approvedSha256 }),
        environmentId: envId, signal, now, wait });
      active = { runId: result.runId, planSha256: approvedSha256 };
      return result;
    },
    async awaitArtifact(binding: { runId: string; planSha256: string; phase: "staging" | "shared" | "final" }, signal: AbortSignal) {
      if (!active || binding.runId !== active.runId || binding.planSha256 !== active.planSha256) return fail("ARTIFACT_BINDING");
      const { phase, runId, planSha256 } = binding, name = phase === "final" ? `fc41597f-install-readback-${planSha256}` :
        `fc41597f-${planSha256}-install-${phase === "staging" ? "staging-readback" : "shared-predecessor-observed"}`;
      await artifacts.readListed(`https://api.github.com${repo}/actions/runs/${runId}/artifacts?name=${name}&per_page=2`, name, release.writeBefore, signal);
    },
    async cleanup(signal: AbortSignal) {
      if (launchAttempted && !active) return fail("RUN_STATE_UNPROVED");
      if (active) {
        const run = await request("GET", `${repo}/actions/runs/${active.runId}`, signal);
        const value = run.value as Json | null;
        if (run.status !== 200 || String(value?.id) !== active.runId || value?.status !== "completed" ||
          value.head_sha !== release.callerCommit || value.run_attempt !== 1) return fail("RUN_STATE_UNPROVED");
      }
      return configuration.cleanup(signal);
    },
  };
}
