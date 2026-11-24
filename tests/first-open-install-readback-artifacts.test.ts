import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { zipSync } from "fflate";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { SANDBOX_FIRST_OPEN } from "../lib/deployments/execution/first-onboarding-run-once.ts";
import { bindFirstOpenInstallReadbackArtifacts } from "../ops/aws-sandbox/first-open-install-readback-artifacts.ts";
import { firstOpenInstallInspectorScope, firstOpenInstallProvisionerLane } from "../ops/aws-sandbox/first-open-install-inspector-scope.ts";
import type { FirstOpenInstallReadbackPlan } from "../ops/aws-sandbox/first-open-install-readback.ts";
import type { FirstOpenFrozenRelease } from "../ops/aws-sandbox/first-open-release-entry.ts";
import { firstOpenTaskReleaseFixture } from "./first-open-task-release-fixture.ts";

const epoch = Date.UTC(2027, 0, 1), runId = "100", repo = "veinyyxy/TechlongSoftware";
const api = `https://api.github.com/repos/${repo}/actions`, signed = "https://test.blob.core.windows.net/artifact/zip?signature=test";
const member = (name: string, bytes: Buffer) => zipSync({ [name]: bytes });
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const casePhases = { shared: "shared-predecessor", grant: "provisioner-grant", relock: "provisioner-relock" } as const;
type Case = "staging" | "shared" | "final";

async function fixture(options: { artifactSource?: string; planHash?: string; runAttempt?: number; reusableSha?: string;
  bucketPolicySha?: string | null } = {}) {
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  const release = { schema: "techlong/sandbox-first-open-release/v1", jobId: taskRelease.firstOpenScope.jobId,
    approvalSha256: "e".repeat(64), inspectorSeedSha256: "d".repeat(64), actorId: "14145707", workflowId: "90",
    callerCommit: "a".repeat(40), runtimeCommit: "b".repeat(40), inspectReusableCommit: "c".repeat(40),
    runOnceReusableCommit: "d".repeat(40), managementReusableCommit: "e".repeat(40), startAt: epoch + 1_200_000,
    writeBefore: epoch + 3_600_000, taskRelease } as FirstOpenFrozenRelease;
  const window = { startAt: epoch, issueBefore: epoch + 120_000, grantAt: epoch + 420_000, grantBefore: epoch + 540_000,
    relockAt: epoch + 600_000, relockBefore: epoch + 720_000, factsCutoff: epoch + 3_600_000 };
  const staging = { readBefore: epoch + 180_000, targets: { shared: { targetBytes: 58_901, targetCanonicalSha256: "5".repeat(64) },
    grant: { targetBytes: 59_901, targetCanonicalSha256: "6".repeat(64) }, relock: { targetBytes: 58_901, targetCanonicalSha256: "5".repeat(64) } },
    sharedObservation: { at: epoch + 240_000, before: epoch + 360_000 } };
  const releaseSha256 = await sha256Hex(release), scope = await firstOpenInstallInspectorScope(release, releaseSha256, window, staging),
    authorityScopeSha256 = await sha256Hex(scope);
  const target = (sha: string) => ({ templateSha256: sha.repeat(64), projection: {} as FirstOpenInstallReadbackPlan["targets"]["grant"]["projection"] });
  const uploads = { shared: { versionId: "shared-v1", acknowledgedAt: epoch + 5_000, putReceiptRawSha256: "1".repeat(64) },
    grant: { versionId: "grant-v1", acknowledgedAt: epoch + 6_000, putReceiptRawSha256: "2".repeat(64) },
    relock: { versionId: "relock-v1", acknowledgedAt: epoch + 7_000, putReceiptRawSha256: "3".repeat(64) } };
  const plan: FirstOpenInstallReadbackPlan = { schema: "techlong/fc41597f-independent-install-readback/v2", lane: firstOpenInstallProvisionerLane,
    jobId: SANDBOX_FIRST_OPEN.jobId, release, releaseSha256, window, authorityScopeSha256, factsReceiptSha256: "8".repeat(64), expectedBucketSha256: "9".repeat(64),
    targets: { grant: target("6"), relock: target("5") }, staging: { scope: staging, uploads } };
  const planSha256 = await sha256Hex(plan), source = { Account: "402010193138",
    Arn: `arn:aws:sts::402010193138:assumed-role/${scope.roleArn.split("/").at(-1)}/${scope.roleSessionName}`,
    UserId: `${scope.roleId}:${scope.roleSessionName}` };
  const common = { jobId: plan.jobId, planSha256, runId, attempt: 1, approvalSha256: release.approvalSha256 };
  const receipts = Object.fromEntries((Object.keys(casePhases) as (keyof typeof casePhases)[]).map(phase => {
    const pin = scope.staging!.targets[phase]!, upload = uploads[phase], bytes = Buffer.from(canonicalJson({
      schema: "techlong/fc41597f-owner-stage-exact-get/v1", jobId: plan.jobId, phase: casePhases[phase], approvalSha256: release.approvalSha256,
      checkedAt: upload.acknowledgedAt + 100, putReceiptRawSha256: upload.putReceiptRawSha256,
      source: { ...source, Arn: options.artifactSource ?? source.Arn },
      request: { Bucket: FIRST_OPEN_BASELINE_BINDING.bucket, Key: pin.key, ExpectedBucketOwner: source.Account,
        VersionId: upload.versionId, ChecksumMode: "ENABLED" },
      response: { ContentType: "application/json", ContentLength: pin.targetBytes,
        ChecksumSHA256: Buffer.from(pin.targetCanonicalSha256, "hex").toString("base64"), ServerSideEncryption: "AES256",
        bodyRawSha256: pin.targetCanonicalSha256, httpStatus: 200, VersionId: upload.versionId, DeleteMarker: false, ContentEncoding: null },
    }));
    return [phase, { rawSha256: hash(bytes), receiptB64: bytes.toString("base64") }];
  }));
  const cs = (name: string) => `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${name}/18da6411-332e-450e-a32a-848bfe852083`;
  const changeSetName = scope.staging!.sharedObservation!.changeSetName, sharedSchema = "techlong/fc41597f-install-shared-predecessor-observed/v1";
  const ack = { changeSetId: cs(changeSetName), executedAt: staging.readBefore + 1, targetSha256: plan.targets.relock.templateSha256 };
  const shared = { schema: sharedSchema, ...common, authorityScopeSha256, result: { schema: sharedSchema, lane: plan.lane,
    jobId: plan.jobId, releaseSha256, approvalSha256: release.approvalSha256, authorityScopeSha256,
    checkedAt: staging.sharedObservation.at + 10, exactOwnerStackArn: scope.ownerStackArn,
    changeSetName, changeSetId: ack.changeSetId, ...scope.staging!.targets.shared!, changesSha256: "b".repeat(64), executionAuthorized: false } };
  const final = { schema: "techlong/fc41597f-independent-install-observed/v2", lane: plan.lane, ...common, authorityScopeSha256,
    runtimeCommit: release.runtimeCommit, issuerSessionArnSha256: await sha256Hex(source.Arn), executionAuthorized: false,
    phases: Object.fromEntries((["grant", "relock"] as const).map((p, i) => [p, { status: "MATCHED_INSTALLED_POLICY_DOCUMENTS",
      checkedAt: (p === "grant" ? window.grantAt : window.relockAt) + 10, changeSetName: scope.changeSetNames[i],
      changeSetId: cs(scope.changeSetNames[i]), targetSha256: plan.targets[p].templateSha256, projectionSha256: "b".repeat(64) }])) };
  const bucketProof = options.bucketPolicySha === null ? {} : { evidenceBucketPolicySha256: options.bucketPolicySha ?? plan.expectedBucketSha256 };
  const archives = { staging: member("handoff.json", Buffer.from(canonicalJson({ schema: "techlong/fc41597f-install-staging-observed/v1",
    ...common, ...bucketProof, receipts }))),
    shared: member("handoff.json", Buffer.from(canonicalJson(shared))), final: member("fc41597f-install-readback.json", Buffer.from(JSON.stringify(final) + "\n")) };
  const created = { staging: epoch + 160_000, shared: staging.sharedObservation.at + 200, final: window.relockAt + 200 };
  const clocks = { staging: epoch + 190_000, shared: staging.sharedObservation.before + 1, final: window.relockBefore + 1 };
  const title = `first-open-fc41597f-install-readback-${planSha256}`;
  const names = { staging: `fc41597f-${planSha256}-install-staging-readback`, shared: `fc41597f-${planSha256}-install-shared-predecessor-observed`,
    final: `fc41597f-install-readback-${planSha256}` };
  const artifactIds = { staging: "101", shared: "102", final: "103" }, calls: string[] = [];
  let kind: Case = "staging";
  const mock: typeof fetch = async (input, init) => {
    const url = String(input), headers = new Headers(init?.headers), artifactId = artifactIds[kind], zip = archives[kind];
    calls.push(url);
    assert.equal(init?.method, "GET");
    assert.equal(init.redirect, "manual");
    assert.equal(headers.get("authorization"), url === signed ? null : "Bearer synthetic_token");
    if (url === `${api}/runs/${runId}`) return Response.json({ id: runId, workflow_id: release.workflowId, run_attempt: options.runAttempt ?? 1,
      event: "workflow_dispatch", path: ".github/workflows/sandbox-first-open-v1.yml", head_branch: "main", head_sha: release.callerCommit,
      display_title: title, actor: { id: 14145707 }, triggering_actor: { id: 14145707 }, repository: { id: 1323312747, full_name: repo,
        owner: { id: 14145707 } }, head_repository: { id: 1323312747 }, status: kind === "final" ? "completed" : "in_progress",
      conclusion: kind === "final" ? "success" : null, referenced_workflows: [{ path: scope.reusableRef, sha: options.reusableSha ?? release.inspectReusableCommit }] });
    if (url === `${api}/runs/${runId}/artifacts?name=${names[kind]}&per_page=2`) return Response.json({ total_count: 1, artifacts: [{ id: artifactId,
      name: names[kind], expired: false, created_at: new Date(created[kind]).toISOString(), expires_at: new Date(epoch + 86_400_000).toISOString(),
      digest: `sha256:${hash(zip)}`, size_in_bytes: zip.length, archive_download_url: `${api}/artifacts/${artifactId}/zip`,
      workflow_run: { id: runId, repository_id: 1323312747, head_repository_id: 1323312747, head_branch: "main", head_sha: release.callerCommit } }] });
    if (url === `${api}/artifacts/${artifactId}/zip`) return new Response(null, { status: 302, headers: { Location: signed } });
    if (url === signed) return new Response(new Uint8Array(zip));
    throw Error("UNEXPECTED_SYNTHETIC_HTTP_REQUEST");
  };
  return { calls, ack, receipts, final, shared, set(next: Case) { kind = next; }, bind: () => bindFirstOpenInstallReadbackArtifacts({
    plan, approvedPlanSha256: options.planHash ?? planSha256, runId, token: "synthetic_token", fetch: mock, now: () => clocks[kind] }) };
}

const signal = new AbortController().signal;

test("exact protected install run yields three bound stage receipts and independent shared/final observations", async () => {
  const f = await fixture(), port = await f.bind();
  await assert.rejects(port.readFinal(signal), /ARTIFACT_SEQUENCE/);
  assert.equal(f.calls.length, 0);
  const proofs = await port.readStaging(signal);
  assert.deepEqual(proofs, Object.fromEntries(Object.entries(f.receipts).map(([phase, row]) => [phase,
    { rawSha256: row.rawSha256, bytes: Buffer.from(row.receiptB64, "base64") }])));
  f.set("shared");
  const shared = await port.readSharedPredecessor(f.ack, signal);
  assert.deepEqual(shared.result, f.shared.result);
  assert.equal(shared.rawSha256, hash(Buffer.from(canonicalJson(f.shared))));
  f.set("final");
  const final = await port.readFinal(signal);
  assert.deepEqual(final.report, f.final);
  assert.equal(final.rawSha256, hash(Buffer.from(JSON.stringify(f.final) + "\n")));
  assert.equal(f.calls.length, 15);
  await assert.rejects(port.readFinal(signal), /ARTIFACT_SEQUENCE/);
  assert.equal(f.calls.length, 15);
});

test("substituted pin, GitHub run attempt or reusable source is rejected before any download", async () => {
  const badPlan = await fixture({ planHash: "0".repeat(64) });
  await assert.rejects(badPlan.bind(), /ARTIFACT_SCOPE/);
  assert.equal(badPlan.calls.length, 0);
  for (const mutated of [{ runAttempt: 2 }, { reusableSha: "0".repeat(40) }]) {
    const f = await fixture(mutated), port = await f.bind();
    await assert.rejects(port.readStaging(signal), /ARTIFACT_RUN/);
    await assert.rejects(port.readStaging(signal), /ARTIFACT_SEQUENCE/);
    assert.equal(f.calls.length, 1);
  }
});

test("transport provenance cannot substitute staging identity or operator execute ACK", async () => {
  const staged = await fixture({ artifactSource: "arn:aws:sts::402010193138:assumed-role/other-role/session" }), a = await staged.bind();
  await assert.rejects(a.readStaging(signal), /ARTIFACT_STAGING/);
  assert.equal(staged.calls.length, 5);
  const shared = await fixture(), b = await shared.bind();
  await b.readStaging(signal);
  shared.set("shared");
  await assert.rejects(b.readSharedPredecessor({ ...shared.ack, targetSha256: "0".repeat(64) }, signal), /READBACK_SHARED_EXECUTE_ACK/);
  await assert.rejects(b.readSharedPredecessor(shared.ack, signal), /ARTIFACT_SEQUENCE/);
  assert.equal(shared.calls.length, 10);
});

test("a same-run authenticated staging artifact must independently match the protected bucket policy before exposing versions", async () => {
  for (const bucketPolicySha of [null, "0".repeat(64)]) {
    const f = await fixture({ bucketPolicySha }), port = await f.bind();
    await assert.rejects(port.readStaging(signal), /ARTIFACT_STAGING/);
    await assert.rejects(port.readStaging(signal), /ARTIFACT_SEQUENCE/);
    assert.equal(f.calls.length, 5);
  }
});
