import assert from "node:assert/strict";
import test from "node:test";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import type { FirstOpenFrozenRelease } from "../ops/aws-sandbox/first-open-release-entry.ts";
import type { FirstOpenInstallReadbackPlan } from "../ops/aws-sandbox/first-open-install-readback.ts";
import { bindFirstOpenInstallGitHub, firstOpenInstallGitHubTransport } from "../ops/aws-sandbox/first-open-install-github.ts";

const repo = "/repos/veinyyxy/TechlongSoftware", base = `https://api.github.com${repo}`;
const env = `${repo}/environments/techlong-sandbox-deploy`, vars = `${env}/variables`;
const secret = `${env}/secrets/TECHLONG_FIRST_OPEN_INSTALL_READBACK_PLAN`;
const names = ["TECHLONG_FIRST_OPEN_INSTALL_READBACK_PLAN_SHA256", "TECHLONG_FIRST_OPEN_INSTALL_RUNTIME_COMMIT",
  "TECHLONG_FIRST_OPEN_INSTALL_READBACK_RUN_ID"];
const planSha = "a".repeat(64), runId = 123456789, clock = Date.UTC(2030, 0, 1);
const release = { workflowId: "426525508", callerCommit: "b".repeat(40), runtimeCommit: "c".repeat(40), writeBefore: clock + 120_000 } as FirstOpenFrozenRelease;
const dispatch = `${repo}/actions/workflows/${release.workflowId}/dispatches`, signal = new AbortController().signal;

function fixture(ack = true) {
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input), headers = new Headers(init?.headers);
    assert.ok(url.startsWith(base));
    assert.equal(init?.redirect, "error");
    assert.equal(headers.get("authorization"), "Bearer synthetic_operator");
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    if (url.endsWith("/dispatches")) return ack ? Response.json({ workflow_run_id: runId,
      run_url: `${base}/actions/runs/${runId}`, html_url: `https://github.com/veinyyxy/TechlongSoftware/actions/runs/${runId}` }) :
      new Response(null, { status: 204 });
    if (method === "POST" || method === "PUT") return Response.json({}, { status: 201 });
    return Response.json({ message: "Not Found" }, { status: 404 });
  };
  const request = firstOpenInstallGitHubTransport({ token: "synthetic_operator", release, fetch, now: () => clock });
  async function prepare() {
    await request("PUT", secret, signal, { encrypted_value: "Y2lwaGVydGV4dA==", key_id: "7" });
    await request("POST", vars, signal, { name: names[0], value: planSha });
    await request("POST", vars, signal, { name: names[1], value: release.runtimeCommit });
  }
  return { calls, request, prepare };
}

const body = async () => ({ ref: "main", return_run_details: true, inputs: {
  mode: "install-readback", inspect_run: "0", pair_sha: planSha, release_sha: await sha256Hex(release),
} });

test("transport opens only the exact ACK run, after three protected creates; no approval route", async () => {
  const f = fixture(), request = await body();
  await assert.rejects(f.request("POST", dispatch, signal, request), /DISPATCH_SCOPE/);
  await assert.rejects(f.request("GET", `${repo}/actions/runs/${runId}`, signal), /READ_SCOPE/);
  await f.prepare();
  await assert.rejects(f.request("POST", dispatch, signal, { ...request, inputs: { ...request.inputs, mode: "runonce" } }), /DISPATCH_SCOPE/);
  assert.equal((await f.request("POST", dispatch, signal, request)).status, 200);
  await f.request("POST", vars, signal, { name: names[2], value: String(runId) });
  assert.equal((await f.request("GET", `${repo}/actions/runs/${runId}`, signal)).authorizedNotFound, false);
  await assert.rejects(f.request("POST", `${repo}/actions/runs/${runId}/pending_deployments`, signal, {}), /MUTATION_SCOPE/);
  await assert.rejects(f.request("POST", dispatch, signal, request), /MUTATION_SCOPE/);
  assert.equal(f.calls.length, 6);
});

test("unproved ACK does not bind a run or allow a second dispatch", async () => {
  const f = fixture(false), request = await body();
  await f.prepare();
  assert.equal((await f.request("POST", dispatch, signal, request)).status, 204);
  await assert.rejects(f.request("GET", `${repo}/actions/runs/${runId}`, signal), /READ_SCOPE/);
  await assert.rejects(f.request("POST", vars, signal, { name: names[2], value: String(runId) }), /MUTATION_SCOPE/);
  await assert.rejects(f.request("POST", dispatch, signal, request), /MUTATION_SCOPE/);
  assert.equal(f.calls.length, 4);
});

test("wired config, ACK and owner notification use the same run and clean its four owned settings", async () => {
  let now = clock, finished = false;
  const { jobId } = FIRST_OPEN_BASELINE_BINDING;
  const launch = { ...release, jobId, actorId: "14145707", startAt: clock + 240_000, writeBefore: clock + 300_000,
    inspectReusableCommit: release.runtimeCommit };
  const plan = { schema: "techlong/fc41597f-independent-install-readback/v2", lane: "install", jobId, release: launch,
    releaseSha256: await sha256Hex(launch), window: { startAt: clock - 1_000, issueBefore: clock + 100_000, factsCutoff: clock + 220_000 },
    staging: { scope: { readBefore: clock + 150_000 } },
  } as FirstOpenInstallReadbackPlan;
  const approval = await sha256Hex(plan), runPath = `${repo}/actions/runs/${runId}`, envId = 24613410405, owner = { id: 14145707, login: "veinyyxy" };
  const repository = { id: 1323312747, full_name: "veinyyxy/TechlongSoftware", owner }, stamp = new Date(clock).toISOString();
  const stored = new Map<string, Record<string, unknown>>(), writes: string[] = [], journal: string[] = [];
  const empty = (status: number) => new Response(null, { status });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)), path = url.pathname, method = init?.method ?? "GET";
    assert.equal(url.origin, "https://api.github.com");
    if (method === "GET") {
      if (path === "/user") return Response.json(owner);
      if (path === env) return Response.json({ id: envId, name: "techlong-sandbox-deploy", can_admins_bypass: false,
        protection_rules: [{ type: "required_reviewers", prevent_self_review: false, reviewers: [{ type: "User", reviewer: owner }] }],
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } });
      if (path.endsWith("/deployment-branch-policies")) return Response.json({ total_count: 1, branch_policies: [{ name: "main", type: "branch" }] });
      if (path.endsWith("/secrets/public-key")) return Response.json({ key_id: "7", key: Buffer.alloc(32, 4).toString("base64") });
      if (path === `${runPath}/pending_deployments`) return Response.json([{ environment: { id: envId, name: "techlong-sandbox-deploy" }, current_user_can_approve: true }]);
      if (path === runPath) return Response.json({ id: runId, workflow_id: Number(release.workflowId), path: ".github/workflows/sandbox-first-open-v1.yml",
        run_attempt: 1, event: "workflow_dispatch", head_branch: "main", head_sha: launch.callerCommit, actor: owner, triggering_actor: owner,
        status: finished ? "completed" : "waiting", conclusion: finished ? "success" : null, repository, head_repository: repository,
        html_url: `https://github.com/veinyyxy/TechlongSoftware/actions/runs/${runId}`,
        display_title: `first-open-fc41597f-install-readback-${approval}` });
      return stored.has(path) ? Response.json(stored.get(path)) : Response.json({ message: "Not Found" },
        { status: 404, headers: { "x-oauth-scopes": "repo, workflow" } });
    }
    if (method === "DELETE") { assert.ok(stored.delete(path)); writes.push(`DELETE ${path}`); return empty(204); }
    const data = JSON.parse(String(init?.body));
    writes.push(`${method} ${path}`);
    if (path === dispatch) return Response.json({ workflow_run_id: runId, run_url: `https://api.github.com${runPath}`,
      html_url: `https://github.com/veinyyxy/TechlongSoftware/actions/runs/${runId}` });
    const name = method === "PUT" ? secret.split("/").at(-1) : String(data.name);
    const exact = method === "PUT" ? secret : `${vars}/${name}`;
    assert.equal(stored.has(exact), false);
    stored.set(exact, { name, created_at: stamp, updated_at: stamp, ...(method === "POST" && { value: data.value }) });
    return empty(201);
  };
  const github = bindFirstOpenInstallGitHub({ release: launch, operatorToken: "synthetic_operator", artifactReadToken: "synthetic_reader", fetch,
    now: () => now, async wait(ms) { now += ms; }, async seal(bytes) { return Buffer.alloc(bytes.length + 48, 6); },
    async record(e) { journal.push(String(e.kind)); },
    async onApprovalRequired(ack) {
      assert.equal(ack.runId, String(runId));
      assert.equal(stored.get(`${vars}/${names[2]}`)?.value, String(runId));
      assert.ok(journal.includes("dispatch-ack"));
      journal.push("notify");
    } });
  assert.deepEqual(await github.dispatchInstallReadback(plan, approval, signal), { runId: String(runId) });
  assert.ok(journal.includes("notify"));
  assert.equal(writes.filter(x => x === `POST ${dispatch}`).length, 1);
  await assert.rejects(github.cleanup(signal), /RUN_STATE_UNPROVED/);
  finished = true;
  assert.deepEqual((await github.cleanup(signal)).residue, []);
  assert.equal(stored.size, 0);
  assert.equal(writes.filter(x => x.startsWith("DELETE ")).length, 4);
});
