import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { canonicalJson } from "../lib/deployments/execution/hash.ts";
import { firstOpenHandoffSchema, offlineFirstOpenHandoffVerifier, offlineHandoffArtifactName,
  offlineHandoffTitle } from "../ops/aws-sandbox/first-open-oidc-offline.ts";
import { firstOpenGitHubHandoff } from "../ops/aws-sandbox/first-open-github-handoff.ts";
import { firstOpenRunOnceHandoff } from "../ops/aws-sandbox/first-open-paired-runtime.ts";
import contract from "../ops/aws-sandbox/first-open-fc41597f-oidc-handoffs.prepared.json" with { type: "json" };
import { firstOpenTaskReleaseFixture } from "./first-open-task-release-fixture.ts";

const startAt = Date.UTC(2030, 0, 1);
const pair = {
  pairSha256: "a".repeat(64), approvalSha256: "b".repeat(64), runtimeSourceSha256: "c".repeat(64), callerCommit: "d".repeat(40),
  workflowId: "44444444", actorId: "55555555", runOnceId: "70001", inspectId: "70000",
  startAt, writeBefore: startAt + 120_000, phaseCutoffs: [30, 40, 50, 65, 95].map(s => startAt + s * 1_000),
  inspectorSessionArnSha256: "e".repeat(64),
};
const iso = (n: number) => new Date(n).toISOString();
const hash = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
const secret = { secretReferenceSha256: "1".repeat(64), versionIdSha256: "2".repeat(64), g1e1FenceSha256: "3".repeat(64) };
const runtime = { stackIdSha256: "4".repeat(64), expectedRuntimeScopeSha256: "5".repeat(64), samplingSha256: "6".repeat(64),
  g1e1FenceSha256: secret.g1e1FenceSha256, databaseIdentitySha256: "7".repeat(64) };
const formalGrant = { formalProvisionerGrantAckSha256: "f".repeat(64), formalProvisionerGrantReceiptSha256: "0".repeat(64) };
function fixture(releaseId = contract.releaseId, taggedG1 = false, formalReady = taggedG1) {
  const rows = [] as ReturnType<typeof make>[];
  for (const [index, kind] of contract.artifactContract.chain.entries()) {
    rows.push(make(kind, index, index ? rows[index - 1].bodySha256 : null, releaseId, taggedG1, undefined, formalReady));
  }
  return rows;
}
function make(kind: string, index: number, previousBodySha256: string | null, releaseId: string, taggedG1 = false,
  occurred = startAt + (index + 1) * 1_000, formalReady = taggedG1) {
  const writer = index === 1 || index === 3;
  const payload = [
    { inspectorRoleId: "AROAV3GNMXTZONT55QARZ", inspectorSessionArnSha256: pair.inspectorSessionArnSha256,
      verifiedAtUtc: iso(startAt), credentialExpiresAtUtc: iso(pair.writeBefore + 1_000), ...(formalReady && formalGrant) },
    taggedG1 ? { ...secret, g1ArnSuffix: "xY1234" } : secret,
    { ...secret, requestBodySha256: previousBodySha256, onlyCurrentVersionVerified: true, notDeletingOrRotatingVerified: true, observedAtUtc: iso(occurred - 100) },
    { ...runtime, configurationAckSha256: "8".repeat(64) },
    { ...runtime, requestBodySha256: previousBodySha256, runtimeConfigurationSha256: "8".repeat(64), runtimeTemplateSha256: "9".repeat(64),
      runtimeObservationSha256: "a".repeat(64), initialBindingSha256: "b".repeat(64), releaseId, observedAtUtc: iso(occurred - 100) },
  ][index];
  const body = { schema: firstOpenHandoffSchema, kind, pairSha256: pair.pairSha256, jobId: contract.jobId, approvalSha256: pair.approvalSha256,
    runOnceId: pair.runOnceId, inspectId: pair.inspectId, producerAttempt: 1, producerSourceSha256: pair.runtimeSourceSha256,
    producedAtUtc: iso(occurred), previousBodySha256, payload };
  const zip = zipSync({ "handoff.json": strToU8(canonicalJson(body)) });
  const head = { head_sha: pair.callerCommit, head_branch: "main" }, runId = Number(writer ? pair.runOnceId : pair.inspectId);
  const artifactId = 80000 + index;
  const run = { id: runId, workflow_id: Number(pair.workflowId), run_attempt: 1, event: "workflow_dispatch",
    path: contract.federatedTrust.callerPathCandidate, ...head,
    repository: { full_name: "veinyyxy/TechlongSoftware", id: 1323312747, owner: { id: 14145707 } },
    head_repository: { id: 1323312747 },
    actor: { id: Number(pair.actorId) }, triggering_actor: { id: Number(pair.actorId) },
    display_title: offlineHandoffTitle(pair, writer), status: "in_progress", conclusion: null };
  const artifact = { id: artifactId, name: offlineHandoffArtifactName(pair.pairSha256, kind), expired: false,
    created_at: iso(occurred), expires_at: iso(pair.writeBefore + 1_000), digest: "sha256:" + hash(zip), size_in_bytes: zip.length,
    archive_download_url: `https://api.github.com/repos/veinyyxy/TechlongSoftware/actions/artifacts/${artifactId}/zip`,
    workflow_run: { id: runId, repository_id: 1323312747, head_repository_id: 1323312747, ...head } };
  return { body, bodySha256: hash(canonicalJson(body)), input: { run, listed: { total_count: 1, artifacts: [artifact] }, zip, now: occurred + 700 } };
}
function changeZip(row: ReturnType<typeof make>, zip: Uint8Array) {
  row.input.zip = zip;
  Object.assign(row.input.listed.artifacts[0], { digest: "sha256:" + hash(zip), size_in_bytes: zip.length });
}

test("the exact in-progress producer's five artifacts are accepted only in chain order", () => {
  const accept = offlineFirstOpenHandoffVerifier(pair), rows = fixture();
  for (const f of rows) assert.equal(accept(f.input).bodySha256, f.bodySha256);
  assert.throws(() => accept(rows[4].input), /SEQUENCE_CLOSED/);
  assert.throws(() => offlineFirstOpenHandoffVerifier(pair)(rows[2].input), /ARTIFACT_PROVENANCE/);
});

test("only real readiness requires Inspector's two formal grant digests and RunOnce matches its protected ACK before claim", async () => {
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  const [ready] = fixture(taskRelease.id, true), [historical] = fixture();
  const formalPair = { ...pair, taskRelease };
  assert.throws(() => offlineFirstOpenHandoffVerifier(formalPair)(historical.input), /RECEIPT_BINDING/);
  assert.throws(() => offlineFirstOpenHandoffVerifier(pair)(ready.input), /RECEIPT_BINDING/);
  const junk = structuredClone(ready);
  changeZip(junk, zipSync({ "handoff.json": strToU8(canonicalJson({ ...junk.body,
    payload: { ...junk.body.payload, formalProvisionerGrantReceiptSha256: "not-a-digest" },
  })) }));
  assert.throws(() => offlineFirstOpenHandoffVerifier(formalPair)(junk.input), /RECEIPT_BINDING/);
  const receipt = offlineFirstOpenHandoffVerifier(formalPair)(ready.input);
  let takes = 0;
  const wire: ReturnType<typeof firstOpenGitHubHandoff> = {
    async take(name) { takes++; assert.equal(name, "01-inspector-ready"); return receipt; },
    async emit() { return assert.fail("preclaim receipt check never emits"); },
    requireApproval() { return assert.fail("preclaim receipt check has no writable approval"); },
    async keepInspectorAvailable() { return assert.fail("RunOnce never keeps Inspector available"); },
  };
  assert.throws(() => firstOpenRunOnceHandoff(wire, taskRelease), /FORMAL_GRANT_BINDING/);
  assert.equal(takes, 0);
  const signal = new AbortController().signal;
  await assert.rejects(firstOpenRunOnceHandoff(wire, taskRelease, "b".repeat(64)).checkIdentity(signal), /FORMAL_GRANT_RECEIPT/);
  await firstOpenRunOnceHandoff(wire, taskRelease, formalGrant.formalProvisionerGrantAckSha256).checkIdentity(signal);
  assert.equal(takes, 2);
});

test("a replacement-run Inspector must report the sealed version, not original A", async () => {
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  const approvedPair = { ...pair, taskRelease };
  const old = fixture(contract.releaseId, true), accept = offlineFirstOpenHandoffVerifier(approvedPair);
  for (const row of old.slice(0, -1)) assert.equal(accept(row.input).bodySha256, row.bodySha256);
  assert.throws(() => accept(old[4].input), /RECEIPT_OUTCOME/);
  const retryOnlyInFixture = offlineFirstOpenHandoffVerifier(approvedPair);
  for (const row of fixture(taskRelease.id, true)) assert.equal(retryOnlyInFixture(row.input).bodySha256, row.bodySha256);
});

test("real RunOnce waits for the approved relock observation before starting its existing final receipt lookups", async () => {
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  const due = startAt + 80_000, chain = contract.artifactContract.chain;
  for (const early of [false, true]) {
    const level = fixture(taskRelease.id, true);
    level[4] = make(chain[4], 4, level[3].bodySha256, taskRelease.id, true, due - (early ? 1 : 0));
    let stage = 0, now = startAt + 1_000, pauses = 0, finalReads = 0;
    const wired = firstOpenGitHubHandoff({ pair: { ...pair, taskRelease }, role: "runonce", ownRunId: pair.runOnceId,
      token: "offline_fixture", now: () => now, runtimeObservedNotBefore: due,
      async pause(ms) { pauses++; now += ms; },
      async uploadOwn(u) { assert.equal(hash(u.bytes), level[stage].bodySha256); return { artifactId: String(80_000 + stage) }; },
      async fetch(input) {
        const url = new URL(String(input)), row = level[stage].input;
        if (stage === 4) { assert.ok(now >= due); finalReads++; }
        if (url.hostname === "example.githubusercontent.com") return new Response(row.zip as BodyInit);
        assert.equal(url.hostname, "api.github.com");
        if (url.pathname.endsWith("/artifacts")) return Response.json(row.listed);
        if (url.pathname.endsWith("/zip")) return new Response(null, { status: 302,
          headers: { location: "https://example.githubusercontent.com/exact-artifact" } });
        assert.ok(url.pathname.endsWith(`/runs/${row.run.id}`));
        return Response.json(row.run);
      },
    });
    const signal = new AbortController().signal;
    for (; stage < 4; stage++) {
      now = Date.parse(level[stage].body.producedAtUtc);
      if (stage % 2 === 0) await wired.take(chain[stage], signal);
      else await wired.emit(chain[stage], level[stage].body.payload, signal);
    }
    const received = wired.take(chain[4], signal);
    if (early) await assert.rejects(received, /PHASE_SCOPE/);
    else assert.equal((await received).bodySha256, level[4].bodySha256);
    assert.equal(pauses, 1);
    assert.equal(finalReads, 5);
  }
});

test("real task G1 intent requires one six-character suffix and the historical intent does not allow it", async () => {
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  for (const [approvedPair, taggedG1, suffix] of [
    [{ ...pair, taskRelease }, false, undefined],
    [{ ...pair, taskRelease }, true, "other/path"],
    [{ ...pair, taskRelease }, true, 123456],
    [pair, true, "xY1234"],
  ] as const) {
    const accept = offlineFirstOpenHandoffVerifier(approvedPair), [ready, request] = fixture(taskRelease.id, taggedG1, "taskRelease" in approvedPair);
    accept(ready.input);
    if (suffix !== undefined) {
      const changed = { ...request.body, payload: { ...request.body.payload, g1ArnSuffix: suffix } };
      changeZip(request, zipSync({ "handoff.json": strToU8(canonicalJson(changed)) }));
    }
    assert.throws(() => accept(request.input), /RECEIPT_BINDING/);
  }
});

test("a final receipt is not accepted from a completed producer", () => {
  const accept = offlineFirstOpenHandoffVerifier(pair), rows = fixture();
  for (const row of rows.slice(0, -1)) accept(row.input);
  const last = rows[4].input;
  last.run.status = "completed";
  Object.assign(last.run, { conclusion: "success" });
  assert.throws(() => accept(last), /PRODUCER_RUN/);
});

test("same-name artifacts, reruns and foreign origin remain rejected with intact ZIP bytes", () => {
  for (const misuse of ["run", "rerun", "head", "actor", "fork", "artifactOrigin", "duplicates", "noDigest", "badUrl", "deadline"]) {
    const { input } = fixture()[0], { run, listed } = input, [artifact] = listed.artifacts;
    switch (misuse) {
      case "run": run.id = Number(pair.runOnceId); break;
      case "rerun": run.run_attempt = 2; break;
      case "head": run.head_sha = "e".repeat(40); break;
      case "actor": run.triggering_actor.id++; break;
      case "fork": artifact.workflow_run.head_repository_id++; break;
      case "artifactOrigin": artifact.workflow_run.id = Number(pair.runOnceId); break;
      case "duplicates": listed.total_count = 2; listed.artifacts.push(artifact); break;
      case "noDigest": artifact.digest = ""; break;
      case "badUrl": artifact.archive_download_url += "?changed"; break;
      case "deadline": input.now = pair.phaseCutoffs[0]; break;
    }
    const accept = offlineFirstOpenHandoffVerifier(pair);
    assert.throws(() => accept(input), /PRODUCER_RUN|ARTIFACT_PROVENANCE|ARTIFACT_COUNT|WINDOW/, misuse);
    assert.throws(() => accept(fixture()[0].input), /SEQUENCE_CLOSED/);
  }
});

test("rejects changed bytes, extra ZIP members and extra payload fields even with a matching archive digest", () => {
  const first = fixture()[0];
  first.input.zip = first.input.zip.slice();
  first.input.zip[12] ^= 1;
  assert.throws(() => offlineFirstOpenHandoffVerifier(pair)(first.input), /ZIP_DIGEST/);
  const extra = fixture()[0];
  changeZip(extra, zipSync({ "handoff.json": strToU8(canonicalJson(extra.body)), "other.json": strToU8("{}") }));
  assert.throws(() => offlineFirstOpenHandoffVerifier(pair)(extra.input), /ARTIFACT_BODY/);
  const oversized = fixture()[0];
  changeZip(oversized, zipSync({ "handoff.json": strToU8("x".repeat(contract.artifactContract.maxJsonBytes + 1)) }));
  assert.throws(() => offlineFirstOpenHandoffVerifier(pair)(oversized.input), /ARTIFACT_BODY/);
  const raw = fixture()[0];
  changeZip(raw, zipSync({ "handoff.json": strToU8(canonicalJson({ ...raw.body, payload: { ...raw.body.payload, extraField: "not allowed" } })) }));
  assert.throws(() => offlineFirstOpenHandoffVerifier(pair)(raw.input), /RECEIPT_BINDING/);
});

test("a valid producer cannot advance with a different g1 coordinate or a stale observation", () => {
  for (const drift of [{ versionIdSha256: "0".repeat(64) }, { observedAtUtc: iso(startAt) }, { requestBodySha256: "0".repeat(64) }]) {
    const rows = fixture(), accept = offlineFirstOpenHandoffVerifier(pair), g1 = rows[2];
    accept(rows[0].input); accept(rows[1].input);
    changeZip(g1, zipSync({ "handoff.json": strToU8(canonicalJson({ ...g1.body, payload: { ...g1.body.payload, ...drift } })) }));
    assert.throws(() => accept(g1.input), /OBSERVATION_ORDER|RECEIPT_OUTCOME/);
  }
});

test("a short Inspector session, swapped epoch or different final stack does not reach the next gate", () => {
  for (const [index, drift] of [
    [0, { credentialExpiresAtUtc: iso(pair.writeBefore) }],
    [3, { g1e1FenceSha256: "0".repeat(64) }],
    [4, { stackIdSha256: "0".repeat(64) }],
  ] as const) {
    const rows = fixture(), accept = offlineFirstOpenHandoffVerifier(pair), affected = rows[index];
    for (const entry of rows.slice(0, index)) accept(entry.input);
    changeZip(affected, zipSync({
      "handoff.json": strToU8(canonicalJson({ ...affected.body, payload: { ...affected.body.payload, ...drift } })),
    }));
    assert.throws(() => accept(affected.input), /INSPECTOR_SESSION|RECEIPT_OUTCOME/);
  }
});
