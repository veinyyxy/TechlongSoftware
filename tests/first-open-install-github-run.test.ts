import assert from "node:assert/strict";
import test from "node:test";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { SANDBOX_FIRST_OPEN } from "../lib/deployments/execution/first-onboarding-run-once.ts";
import { dispatchFirstOpenInstallGitHubRun } from "../ops/aws-sandbox/first-open-install-github-run.ts";
import type { FirstOpenInstallReadbackPlan } from "../ops/aws-sandbox/first-open-install-readback.ts";

const time = Date.UTC(2027, 0, 1), jobId = SANDBOX_FIRST_OPEN.jobId, base = "/repos/veinyyxy/TechlongSoftware/actions";
const runId = "123", url = "https://github.com/veinyyxy/TechlongSoftware/actions/runs/123", workflowId = "456";
const env = { id: 24613410405, name: "techlong-sandbox-deploy" }, who = { id: 14145707 };

async function fixture(options: { badSha?: boolean; dispatchStatus?: number; wrongUrl?: boolean; bindFails?: boolean;
  runPatch?: Record<string, unknown>; differentGate?: boolean; denyGate?: boolean; clockAtBind?: number;
  emptyGateCount?: number; gateStatus?: number } = {}) {
  const readback = { schema: "techlong/fc41597f-independent-install-readback/v2", lane: "install", jobId,
    release: { jobId, workflowId, actorId: "14145707", startAt: time + 500_000, callerCommit: "a".repeat(40),
      runtimeCommit: "b".repeat(40), inspectReusableCommit: "b".repeat(40) },
    window: { startAt: time, issueBefore: time + 100_000, factsCutoff: time + 500_000 },
    staging: { scope: { readBefore: time + 120_000 } },
  } as FirstOpenInstallReadbackPlan;
  readback.releaseSha256 = await sha256Hex(readback.release);
  const sha = await sha256Hex(readback), events: unknown[] = [];
  let clock = time + 10, pendingChecks = 0;
  const start = () => dispatchFirstOpenInstallGitHubRun({ plan: readback, approvedSha256: options.badSha ? "0".repeat(64) : sha,
    signal: new AbortController().signal, environmentId: String(env.id), now: () => clock,
    wait: async ms => { events.push(["wait", ms]); clock += ms; },
    config: {
      async prepare(draft, approved) {
        assert.deepEqual(draft, readback);
        assert.notEqual(draft, readback);
        assert.equal(approved, sha);
        events.push("prepare");
      },
      async bindRun(id) {
        events.push(["bind", id]);
        if (options.clockAtBind) clock = options.clockAtBind;
        if (options.bindFails) throw Error("SYNTHETIC_PROVIDER_FAILURE");
      },
    },
    onDispatchAcknowledged: receipt => { events.push(["ack", receipt]); },
    onApprovalRequired: receipt => { events.push(["human", receipt]); },
    async request(method, path, signal, body) {
      assert.equal(signal.aborted, false);
      events.push([method, path, ...(body ? [body] : [])]);
      if (path === `${base}/workflows/${workflowId}/dispatches`) return { status: options.dispatchStatus ?? 200,
        value: { workflow_run_id: Number(runId), html_url: options.wrongUrl ? `${url}0` : url, run_url: `https://api.github.com${base}/runs/${runId}` } };
      if (path === `${base}/runs/${runId}`) return { status: 200, value: { workflow_id: Number(workflowId), id: Number(runId), run_attempt: 1,
        event: "workflow_dispatch", path: ".github/workflows/sandbox-first-open-v1.yml", html_url: url, head_branch: "main",
        head_sha: readback.release.callerCommit, display_title: `first-open-fc41597f-install-readback-${sha}`,
        actor: who, triggering_actor: who, repository: { id: 1323312747, full_name: "veinyyxy/TechlongSoftware", owner: who },
        head_repository: { id: 1323312747 }, status: "waiting", conclusion: null, ...options.runPatch } };
      if (path === `${base}/runs/${runId}/pending_deployments`) return { status: options.gateStatus ?? 200,
        value: ++pendingChecks <= (options.emptyGateCount ?? 0) ? [] : [{
          environment: options.differentGate ? { ...env, id: 55 } : env, current_user_can_approve: !options.denyGate,
        }] };
      throw Error("UNEXPECTED_SYNTHETIC_GITHUB_REQUEST");
    },
  });
  const post = ["POST", `${base}/workflows/${workflowId}/dispatches`, { ref: "main", return_run_details: true,
    inputs: { mode: "install-readback", pair_sha: sha, release_sha: readback.releaseSha256, inspect_run: "0" } }];
  const ack = ["ack", { runId, url }], bind = ["bind", runId], run = ["GET", `${base}/runs/${runId}`],
    pending = ["GET", `${base}/runs/${runId}/pending_deployments`];
  return { start, events, post, ack, bind, run, pending, initialWait: ["wait", 20_000], gap: ["wait", 30_000] };
}

test("one dispatch binds its acknowledged run before a single exact human-gate notification", async () => {
  const f = await fixture();
  assert.deepEqual(await f.start(), { runId });
  assert.deepEqual(f.events, ["prepare", f.post, f.ack, f.bind, f.initialWait, f.pending, f.run, ["human", { runId, url }]]);
});

test("an unapproved plan or ambiguous dispatch never binds, searches, asks approval, or dispatches twice", async () => {
  const wrongPlan = await fixture({ badSha: true });
  await assert.rejects(wrongPlan.start(), /GITHUB_RUN_PLAN/);
  assert.deepEqual(wrongPlan.events, []);
  for (const options of [{ dispatchStatus: 204 }, { wrongUrl: true }]) {
    const f = await fixture(options);
    await assert.rejects(f.start(), /DISPATCH_ACK_UNKNOWN/);
    assert.deepEqual(f.events, ["prepare", f.post]);
  }
});

test("pinned run mismatch, missing gate, bind failure or too-short window stops without approval or cleanup", async () => {
  const wrongRun = await fixture({ runPatch: { run_attempt: 2 } });
  await assert.rejects(wrongRun.start(), /RUN_MISMATCH/);
  assert.deepEqual(wrongRun.events, ["prepare", wrongRun.post, wrongRun.ack, wrongRun.bind, wrongRun.initialWait, wrongRun.pending, wrongRun.run]);
  for (const options of [{ differentGate: true }, { denyGate: true }, { gateStatus: 502 }]) {
    const f = await fixture(options);
    await assert.rejects(f.start(), /GATE_NOT_PROVED/);
    assert.deepEqual(f.events, ["prepare", f.post, f.ack, f.bind, f.initialWait, f.pending]);
  }
  for (const [opts, want] of [[{ bindFails: true }, /CONFIG_RUN_STOP_NO_RETRY/], [{ clockAtBind: time + 85_000 }, /WINDOW/]] as const) {
    const f = await fixture(opts);
    await assert.rejects(f.start(), want);
    assert.deepEqual(f.events, ["prepare", f.post, f.ack, f.bind]);
  }
});

test("only valid empty pending state earns another bounded observation, at most three", async () => {
  const f = await fixture({ emptyGateCount: 2 });
  assert.deepEqual(await f.start(), { runId });
  assert.deepEqual(f.events, ["prepare", f.post, f.ack, f.bind, f.initialWait, f.pending, f.gap, f.pending,
    f.gap, f.pending, f.run, ["human", { runId, url }]]);
  const never = await fixture({ emptyGateCount: 3 });
  await assert.rejects(never.start(), /GATE_NOT_READY/);
  assert.deepEqual(never.events, ["prepare", never.post, never.ack, never.bind, never.initialWait, never.pending,
    never.gap, never.pending, never.gap, never.pending]);
});
