import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { verifyFirstOpenInstallPublication } from "../ops/aws-sandbox/first-open-install-github-publication.ts";

const repo = "veinyyxy/TechlongSoftware", base = "/repos/" + repo, env = "techlong-sandbox-deploy";
const callerCommit = "a".repeat(40), runtimeCommit = "b".repeat(40);
const path = ".github/workflows/sandbox-first-open-v1.yml";
const inspect = ".github/workflows/sandbox-first-open-inspect-job-v1.yml";
const caller = [
  "on: { workflow_dispatch: { inputs: { mode: { options: [inspect, runonce, install-readback] } } } }",
  "jobs:",
  "  inspect:",
  "    uses: " + repo + "/" + inspect + "@" + runtimeCommit,
  "    with:",
  "      inspect_run: ${{ inputs.mode == 'install-readback' && 'install-readback' || inputs.inspect_run }}",
  "  runonce:",
  "    uses: " + repo + "/.github/workflows/sandbox-first-open-run-once-job-v1.yml@" + runtimeCommit,
  "  management:",
  "    uses: " + repo + "/.github/workflows/sandbox-first-open-management-job-v1.yml@" + runtimeCommit,
].join("\n");
const reusable = [
  "on: { workflow_call: {} }",
  "jobs:",
  "  bound-install-readback:",
  "    environment: " + env,
  "    steps:",
  "      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
  "        with:",
  "          ref: ${{ vars.TECHLONG_FIRST_OPEN_INSTALL_RUNTIME_COMMIT }}",
  "          persist-credentials: false",
  "      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
  "        with:",
  "          repository: actions/upload-artifact",
  "      - uses: ./.github/actions/first-open-launch",
  "        with:",
  "          role: install-readback",
  "        env:",
  "          FIRST_OPEN_INSTALL_RUNTIME_COMMIT: ${{ vars.TECHLONG_FIRST_OPEN_INSTALL_RUNTIME_COMMIT }}",
].join("\n");
const gate = { id: 24613410405, name: env, can_admins_bypass: false,
  deployment_branch_policy: { custom_branch_policies: true, protected_branches: false },
  protection_rules: [{ type: "required_reviewers", prevent_self_review: false, reviewers: [{ type: "User", reviewer: { id: 14145707 } }] },
    { type: "branch_policy" }] };
const content = (path: string, text: string) => {
  const bytes = Buffer.from(text);
  return { type: "file", path, encoding: "base64", size: bytes.length, content: bytes.toString("base64"),
    sha: createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex") };
};
const callerRoute = "/contents/" + path + "?ref=" + callerCommit;
const reusableRoute = "/contents/" + inspect + "?ref=" + runtimeCommit;
const branchesRoute = "/environments/" + env + "/deployment-branch-policies?per_page=10";
function fixture(overrides: [string, unknown][] = []) {
  const rows = new Map<string, unknown>([
    ["", { id: 1323312747, full_name: repo, owner: { id: 14145707, login: "veinyyxy" }, default_branch: "main" }],
    ["/git/ref/heads/main", { ref: "refs/heads/main", object: { type: "commit", sha: callerCommit } }],
    ["/actions/workflows/426525508", { id: 426525508, state: "active", path }],
    ["/environments/" + env, gate],
    [branchesRoute, { total_count: 1, branch_policies: [{ name: "main", type: "branch" }] }],
    [callerRoute, content(path, caller)],
    [reusableRoute, content(inspect, reusable)],
    ...overrides,
  ]);
  const calls: string[] = [];
  const signal = new AbortController().signal;
  const input: Parameters<typeof verifyFirstOpenInstallPublication>[0] = {
    release: { callerCommit, runtimeCommit, workflowId: "426525508", actorId: "14145707", inspectReusableCommit: runtimeCommit,
      runOnceReusableCommit: runtimeCommit, managementReusableCommit: runtimeCommit },
    environmentId: "24613410405",
    signal,
    async request(method, url, awaitedSignal, body) {
      assert.equal(method, "GET"); assert.equal(awaitedSignal, signal); assert.equal(body, undefined);
      assert(url.startsWith(base));
      const route = url.slice(base.length);
      assert(rows.has(route));
      calls.push(route);
      return { status: 200, value: rows.get(route) };
    },
  };
  return { input, calls };
}

test("exact current publication, active dispatcher, sole owner gate, and sealed reusable checkout", async () => {
  const { input, calls } = fixture();
  assert.deepEqual(await verifyFirstOpenInstallPublication(input), { mainSha: callerCommit, runtime: runtimeCommit,
    workflowId: "426525508", environment: env, ownerReviewRequired: true, adminBypass: false });
  assert.deepEqual(calls, ["", "/git/ref/heads/main", "/actions/workflows/426525508", "/environments/" + env,
    branchesRoute, callerRoute, reusableRoute]);
});

test("wrong current head or reviewer restrictions stop before later GETs", async () => {
  const stale = fixture([["/git/ref/heads/main", { ref: "refs/heads/main", object: { type: "commit", sha: runtimeCommit } }]]);
  await assert.rejects(verifyFirstOpenInstallPublication(stale.input), /_MAIN$/);
  assert.equal(stale.calls.length, 2);
  const bypass = fixture([["/environments/" + env, { ...gate, can_admins_bypass: true }]]);
  await assert.rejects(verifyFirstOpenInstallPublication(bypass.input), /_ENVIRONMENT$/);
  assert.equal(bypass.calls.length, 4);
  const broad = fixture([[branchesRoute, { total_count: 1, branch_policies: [{ name: "main", type: "tag" }] }]]);
  await assert.rejects(verifyFirstOpenInstallPublication(broad.input), /_BRANCH_POLICY$/);
  assert.equal(broad.calls.length, 5);
});

test("mismatched caller pin, GitHub contents blob, or reusable checkout cannot be called published", async () => {
  const rewritten = fixture([[callerRoute, content(path, caller.replace(runtimeCommit, callerCommit))]]);
  await assert.rejects(verifyFirstOpenInstallPublication(rewritten.input), /_CALLER_REUSABLE$/);
  assert.equal(rewritten.calls.length, 6);
  const blob = fixture([[reusableRoute, { ...content(inspect, reusable), sha: callerCommit }]]);
  await assert.rejects(verifyFirstOpenInstallPublication(blob.input), /_WORKFLOW_CONTENTS$/);
  const checkout = fixture([[reusableRoute, content(inspect, reusable.replace("ref: ${{ vars.TECHLONG_FIRST_OPEN_INSTALL_RUNTIME_COMMIT }}", "ref: main"))]]);
  await assert.rejects(verifyFirstOpenInstallPublication(checkout.input), /_REUSABLE_CHECKOUT$/);
});
