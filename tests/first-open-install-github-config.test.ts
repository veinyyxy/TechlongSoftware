import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { bindFirstOpenInstallGitHubConfig, type FirstOpenInstallGitHubConfigRequest,
  type FirstOpenInstallGitHubConfigJournal } from "../ops/aws-sandbox/first-open-install-github-config.ts";
import type { FirstOpenInstallReadbackPlan } from "../ops/aws-sandbox/first-open-install-readback.ts";

const repo = "/repos/veinyyxy/TechlongSoftware", env = `${repo}/environments/techlong-sandbox-deploy`;
const id = "3783234511", run = "444444444", workflowId = "426525508", actor = 14145707;
const now = Date.parse("2026-11-24T15:00:05Z"), stamp = new Date(now).toISOString();
const checksum = "TECHLONG_FIRST_OPEN_INSTALL_READBACK_PLAN_SHA256", runtime = "TECHLONG_FIRST_OPEN_INSTALL_RUNTIME_COMMIT";
const secret = "TECHLONG_FIRST_OPEN_INSTALL_READBACK_PLAN", runId = "TECHLONG_FIRST_OPEN_INSTALL_READBACK_RUN_ID";
const secretPath = `${env}/secrets/${secret}`, runPath = `${env}/variables/${runId}`;
const signal = () => new AbortController().signal;

async function fixture(fault: "none" | "unauthorized404" | "wrongGate" | "lostSecretOwnership" | "upsert" | "wrongRun" |
  "cleanup404" | "foreignEdit" | "expired" = "none") {
  const jobId = FIRST_OPEN_BASELINE_BINDING.jobId;
  const plan = { schema: "techlong/fc41597f-independent-install-readback/v2", jobId, lane: "install", release: { jobId, actorId: String(actor),
    callerCommit: "b".repeat(40), runtimeCommit: "a".repeat(40), workflowId },
  window: { startAt: now - 60000, issueBefore: now + 60000, factsCutoff: now + 120000 } } as FirstOpenInstallReadbackPlan;
  const pin = await sha256Hex(plan);
  const items = new Map<string, { name: string; created_at: string; updated_at: string; value?: string }>();
  const calls: [Method: string, path: string][] = [], events: Parameters<FirstOpenInstallGitHubConfigJournal["record"]>[0][] = [];
  const erased: Uint8Array[] = [];
  let ticking = fault === "expired" ? plan.window.issueBefore : now;
  let afterDelete = false;
  const response = (status: number, value: unknown, authorizedNotFound?: boolean) => ({ status, value, authorizedNotFound });
  const missing = (trusted: boolean) => response(404, { message: "Not Found" }, trusted);
  const request: FirstOpenInstallGitHubConfigRequest = async (method, path, _sig, body) => {
    calls.push([method, path]);
    if (method === "GET") {
      if (path === "/user") return response(200, { id: actor, login: "veinyyxy" });
      if (path === env) return response(200, { id: Number(id), name: "techlong-sandbox-deploy", can_admins_bypass: fault === "wrongGate",
        protection_rules: [{ type: "required_reviewers", prevent_self_review: false, reviewers: [{ type: "User", reviewer: { id: actor } }] }],
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } });
      if (path.endsWith("/deployment-branch-policies?per_page=10")) return response(200, { total_count: 1, branch_policies: [{ name: "main", type: "branch" }] });
      if (path.endsWith("/secrets/public-key")) return response(200, { key_id: "0000123456", key: Buffer.alloc(32, 7).toString("base64") });
      if (path === `${repo}/actions/runs/${run}`) return response(200, { id: Number(run), workflow_id: Number(workflowId), run_attempt: 1,
        event: "workflow_dispatch", head_branch: "main", head_sha: plan.release.callerCommit, actor: { id: actor }, repository: { id: 1323312747 },
        status: "waiting", display_title: `first-open-fc41597f-install-readback-${fault === "wrongRun" ? "wrong" : pin}` });
      const item = items.get(path);
      if (!item) return missing(fault !== "unauthorized404" && !(fault === "cleanup404" && afterDelete));
      if (fault === "lostSecretOwnership" && path === secretPath) return response(200, { ...item, updated_at: new Date(now + 3000).toISOString() });
      return response(200, item);
    }
    if (method === "PUT") {
      assert.equal(path, secretPath);
      assert.deepEqual(Object.keys(body ?? {}).sort(), ["encrypted_value", "key_id"]);
      assert.equal(body?.key_id, "0000123456");
      assert.equal(body?.encrypted_value, Buffer.alloc(Buffer.byteLength(canonicalJson(plan)) + 48, 9).toString("base64"));
      items.set(path, { name: secret, created_at: stamp, updated_at: stamp });
      return response(fault === "upsert" ? 204 : 201, null);
    }
    if (method === "POST") {
      assert.equal(path, `${env}/variables`);
      const name = String(body?.name), value = String(body?.value);
      assert.ok([checksum, runtime, runId].includes(name));
      items.set(`${path}/${name}`, { name, value, created_at: stamp, updated_at: stamp });
      return response(201, null);
    }
    assert.equal(method, "DELETE");
    assert.equal(items.delete(path), true);
    afterDelete = true;
    return response(204, null);
  };
  const api = bindFirstOpenInstallGitHubConfig({ environmentId: id, request, now: () => ticking,
    async seal(plaintext, key) { assert.equal(Buffer.from(plaintext).toString(), canonicalJson(plan)); assert.equal(key.length, 32);
      const cipher = Buffer.alloc(plaintext.length + 48, 9); erased.push(plaintext, key, cipher); return cipher; },
    journal: { async record(e) { events.push(e); } } });
  const cleanup = () => {
    if (fault === "foreignEdit") items.set(runPath, { name: runId, value: "other", created_at: stamp, updated_at: stamp });
    ticking = now + 65_000;
    return api.cleanup(signal());
  };
  return { api, plan, pin, calls, items, events, erased, cleanup };
}

test("creates only the exact protected input and three vars, validates actual run, then deletes owned settings once", async () => {
  const f = await fixture();
  await f.api.prepare(f.plan, f.pin, signal());
  assert.equal(f.items.size, 3);
  assert.ok(f.erased.every(x => x.every(n => n === 0)));
  assert.doesNotMatch(JSON.stringify(f.events), /encrypted_value|key_id|callerCommit/);
  await f.api.bindRun(run, signal());
  assert.equal(f.items.get(runPath)?.value, run);
  const result = await f.cleanup();
  assert.deepEqual(result, { status: "CLEANUP_VERIFIED", residue: [] });
  assert.equal(f.items.size, 0);
  assert.equal(f.calls.filter(([method]) => method === "GET").length, 23);
  assert.equal(f.calls.filter(([method]) => method === "DELETE").length, 4);
  assert.deepEqual(f.events.filter(e => e.name === secret).map(e => e.kind),
    ["create-intent", "create-ack", "owned", "delete-intent", "delete-ack", "absence-confirmed"]);
  await assert.rejects(f.cleanup(), /CLEANUP_STATE/);
});

test("a wrong environment gate, unverified absence or expired issue time makes no writes", async () => {
  for (const [fault, reason] of [["wrongGate", /ENVIRONMENT_GATES/], ["unauthorized404", /AUTHORIZED_ABSENCE/], ["expired", /WINDOW_OR_ABORTED/]] as const) {
    const f = await fixture(fault);
    await assert.rejects(f.api.prepare(f.plan, f.pin, signal()), reason);
    assert.ok(f.calls.every(([method]) => method === "GET"));
    assert.equal(f.events.length, 0);
  }
});

test("a lost or noncreation secret ownership ACK is not eligible for cleanup", async () => {
  for (const [fault, reason] of [["lostSecretOwnership", /CREATE_OWNERSHIP/], ["upsert", /CREATE_NOT_CONFIRMED/]] as const) {
    const f = await fixture(fault);
    await assert.rejects(f.api.prepare(f.plan, f.pin, signal()), reason);
    const result = await f.cleanup();
    assert.deepEqual(result, { status: "CLEANUP_RESIDUE", residue: [secret] });
    assert.ok(!f.calls.some(([method, path]) => method === "DELETE" && path === secretPath));
    assert.equal(f.items.size, 1);
  }
});

test("wrong run binding or ownership drift cannot change the unrelated protected value", async () => {
  const r = await fixture("wrongRun"); await r.api.prepare(r.plan, r.pin, signal());
  await assert.rejects(r.api.bindRun(run, signal()), /RUN_BINDING/);
  assert.ok(!r.items.has(runPath));
  const f = await fixture("foreignEdit"); await f.api.prepare(f.plan, f.pin, signal()); await f.api.bindRun(run, signal());
  assert.deepEqual(await f.cleanup(), { status: "CLEANUP_RESIDUE", residue: [runId] });
  assert.equal(f.items.get(runPath)?.value, "other");
});

test("unattested cleanup 404 stops without treating settings as removed or continuing deletes", async () => {
  const f = await fixture("cleanup404"); await f.api.prepare(f.plan, f.pin, signal()); await f.api.bindRun(run, signal());
  const u = await f.cleanup();
  assert.equal(u.status, "CLEANUP_RESIDUE");
  assert.deepEqual(u.residue.slice().sort(), [checksum, runtime, secret, runId].sort());
  assert.equal(f.calls.filter(([method]) => method === "DELETE").length, 1);
});
