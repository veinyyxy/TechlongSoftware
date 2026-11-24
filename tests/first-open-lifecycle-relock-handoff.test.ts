import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { zipSync } from "fflate";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { firstOpenVersionAuthorityScope } from "../ops/aws-sandbox/first-open-controlled-cfn.ts";
import { firstOpenGitHubAuthorityArtifacts } from "../ops/aws-sandbox/first-open-github-handoff.ts";
import { offlineHandoffArtifactName, offlineHandoffTitle, type FirstOpenHandoffPair } from "../ops/aws-sandbox/first-open-oidc-offline.ts";
import { firstOpenTaskReleaseFixture } from "./first-open-task-release-fixture.ts";

test("Lifecycle relock handoff requires the same already observed grant and stops at the runtime observation cutoff", async () => {
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  const startAt = Date.UTC(2030, 0, 1), times = [30, 70, 200, 700, 800].map(x => startAt + x * 1_000);
  const pair: FirstOpenHandoffPair = { pairSha256: "a".repeat(64), approvalSha256: "b".repeat(64), runtimeSourceSha256: "c".repeat(64),
    callerCommit: "a".repeat(40), workflowId: "808", actorId: "14145707", runOnceId: "102", inspectId: "101", startAt,
    writeBefore: startAt + 900_000, phaseCutoffs: times, inspectorSessionArnSha256: "d".repeat(64), taskRelease };
  const repo = "veinyyxy/TechlongSoftware", inspectReusableCommit = "c".repeat(40), runOnceReusableCommit = "d".repeat(40);
  const sourceSha256 = "e".repeat(64), at = startAt + 350_000, submitBefore = times[3], relockBefore = times[4];
  const scope = firstOpenVersionAuthorityScope({ approvalSha256: pair.approvalSha256, sourceSha256, runId: pair.runOnceId,
    operationSha256: "b".repeat(64), requestSha256: "c".repeat(64), putAcknowledgedAt: at - 10,
    versionId: "fixed+existing/=", templateSha256: "d".repeat(64), submitBefore });
  const scopeSha256 = await sha256Hex(scope);
  const grant = { schema: "techlong/fc41597f-exact-cfn-version-authority/v2", scopeSha256,
    policySha256: "f".repeat(64), checkedAt: at, expiresAt: submitBefore, evidence: "MATCHED_INSTALLED_POLICY_DOCUMENTS" };
  const run = { id: pair.inspectId, workflow_id: pair.workflowId, run_attempt: 1, event: "workflow_dispatch",
    path: ".github/workflows/sandbox-first-open-v1.yml", head_branch: "main", head_sha: pair.callerCommit,
    repository: { full_name: repo, id: "1323312747", owner: { id: pair.actorId } }, head_repository: { id: "1323312747" },
    actor: { id: pair.actorId }, triggering_actor: { id: pair.actorId }, display_title: offlineHandoffTitle(pair, false),
    status: "in_progress", conclusion: null, referenced_workflows: [{
      path: `${repo}/.github/workflows/sandbox-first-open-inspect-job-v1.yml@${inspectReusableCommit}`, sha: inspectReusableCommit,
    }] };
  function make(variant?: "wrongScope" | "stale") {
    let clock = at, fetches = 0;
    const fetcher: typeof fetch = async (input, init) => {
      fetches++;
      const url = new URL(String(input)), later = clock > at, id = later ? "302" : "301";
      const kind = later ? "cfn-version-relocked" : "cfn-version-observed";
      const payload = later ? { relocked: true, scopeSha256: variant === "wrongScope" ? "0".repeat(64) : scopeSha256,
        checkedAt: variant === "stale" ? at : clock, policySha256: "d".repeat(64) } : grant;
      const body = { schema: "techlong/fc41597f-authority-artifact/v1", kind, jobId: taskRelease.firstOpenScope.jobId,
        pairSha256: pair.pairSha256, approvalSha256: pair.approvalSha256, runOnceId: pair.runOnceId, inspectId: pair.inspectId,
        sourceSha256, producerAttempt: 1, producerSourceSha256: pair.runtimeSourceSha256, producedAt: clock, payload };
      const zip = zipSync({ "handoff.json": Buffer.from(canonicalJson(body)) });
      if (url.hostname === "fixture.blob.core.windows.net") {
        assert.equal(new Headers(init?.headers).has("Authorization"), false);
        return new Response(Buffer.from(zip));
      }
      assert.equal(url.hostname, "api.github.com");
      if (url.pathname.endsWith("/zip")) return new Response(null, { status: 302, headers: { location: "https://fixture.blob.core.windows.net/once" } });
      if (url.pathname.endsWith("/artifacts")) return Response.json({ total_count: 1, artifacts: [{
        id, name: offlineHandoffArtifactName(pair.pairSha256, kind), expired: false,
        created_at: new Date(clock).toISOString(), expires_at: new Date(clock + 10_000).toISOString(), size_in_bytes: zip.length,
        digest: "sha256:" + createHash("sha256").update(zip).digest("hex"),
        archive_download_url: `https://api.github.com/repos/${repo}/actions/artifacts/${id}/zip`,
        workflow_run: { id: pair.inspectId, repository_id: "1323312747", head_repository_id: "1323312747", head_sha: pair.callerCommit, head_branch: "main" },
      }] });
      return Response.json(run);
    };
    return { handoff: firstOpenGitHubAuthorityArtifacts({ pair, role: "management", ownRunId: pair.runOnceId,
      sourceSha256, submitBefore, inspectReusableCommit, runOnceReusableCommit, token: "synthetic_only", fetch: fetcher, now: () => clock }),
      advance(to: number) { clock = to; }, get fetches() { return fetches; } };
  }
  const signal = new AbortController().signal, ok = make();
  await assert.rejects(ok.handoff.readRelocked(scope, signal), /SEQUENCE/);
  assert.equal(ok.fetches, 0);
  await ok.handoff.readVerified(scope, signal);
  ok.advance(submitBefore + 1);
  assert.equal((await ok.handoff.readRelocked(scope, signal)).payload.relocked, true);
  await assert.rejects(ok.handoff.readRelocked(scope, signal), /SEQUENCE/);
  for (const variant of ["wrongScope", "stale"] as const) {
    const other = make(variant);
    await other.handoff.readVerified(scope, signal);
    other.advance(submitBefore + 1);
    await assert.rejects(other.handoff.readRelocked(scope, signal), /BINDING/);
  }
  const late = make();
  await late.handoff.readVerified(scope, signal);
  const before = late.fetches;
  late.advance(relockBefore);
  await assert.rejects(late.handoff.readRelocked(scope, signal), /WINDOW/);
  assert.equal(late.fetches, before);
});
