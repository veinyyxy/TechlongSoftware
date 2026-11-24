import assert from "node:assert/strict";
import test from "node:test";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { FIRST_OPEN_STATIC_NEON_HOST_SHA256, FIRST_OPEN_STATIC_NEON_LIMITS, FirstOpenStaticNeonStopped,
  firstOpenStaticNeonCommitBarrier, runFirstOpenStaticNeon, type FirstOpenStaticNeonReceipt,
  type FirstOpenStaticNeonReview } from "../ops/aws-sandbox/first-open-static-neon.ts";
import { firstOpenTaskReleaseFixture } from "./first-open-task-release-fixture.ts";

const now = Date.parse("2026-11-21T23:44:00Z");
const jobId = "job_fc41597f9b5ba8e02b338ecf";

async function fixture() {
  const { proof, trusted } = await firstOpenTaskReleaseFixture();
  const review: FirstOpenStaticNeonReview = { schema: "techlong/first-open-static-neon/v1", jobId,
    hostSha256: FIRST_OPEN_STATIC_NEON_HOST_SHA256, oldReviewSha256: "2b3f4adeb2d7ec50028b7da8c6b04e870ae99cd689974ab6e7309592f4c14691",
    publicationReviewSha256: trusted.reviewSha256, writeBefore: now + 10 * 60_000 };
  return { review, approvedReviewSha256: await sha256Hex(review), publication: { proof, proofSha256: trusted.proofSha256 } };
}

test("approval, fixed job and already-verified publication are checked before arming a slot or opening .env", async () => {
  const input = await fixture();
  const journal = { consume: async () => assert.fail("no slot"), record: async () => assert.fail("no writes") };
  for (const bad of [
    { ...input, approvedReviewSha256: "0".repeat(64) },
    { ...input, publication: { ...input.publication, proofSha256: "0".repeat(64) } },
    { ...input, review: { ...input.review, jobId: "job_" + "b".repeat(24) } },
    { ...input, review: { ...input.review, hostSha256: "0".repeat(64) } },
  ]) {
    await assert.rejects(runFirstOpenStaticNeon({ ...bad, journal }, {
      connections: async () => assert.fail("no config read or connection"),
    }, () => now), /FIRST_OPEN_/);
  }
  await assert.rejects(runFirstOpenStaticNeon({ ...input, journal }, undefined, () => input.review.writeBefore), /APPROVAL/);
});

test("changed held row closes the writer without role or rebinding writes, and a consumed slot cannot be replayed", async () => {
  const input = await fixture();
  const calls: string[] = [];
  let occupied = false;
  const journal = {
    async consume(slot: string) {
      assert.equal(slot, "fc41597f-neon-static-v1");
      if (occupied) throw Error("SLOT_OCCUPIED");
      occupied = true; calls.push("slot");
    },
    async record() { assert.fail("no commit attempts"); },
  };
  const ports = { async connections(host: string) {
    assert.equal(host, FIRST_OPEN_STATIC_NEON_HOST_SHA256);
    calls.push("read-config");
    return async (role: string) => {
      assert.equal(role, "writer");
      return {
        async query(text: string, bindings: readonly unknown[]) {
          if (text.startsWith("SELECT")) {
            assert.equal(bindings[0], jobId);
            assert.match(text, /FROM public\.deployment_jobs/);
            assert.match(text, /x\.instance_id=a\.id/);
            calls.push("held");
          } else {
            assert.ok(text === "BEGIN" || text === "SET LOCAL search_path TO pg_catalog");
            calls.push(text);
          }
          return { command: "SELECT", rows: [] };
        },
        async close() { calls.push("close"); },
      };
    };
  } };
  await assert.rejects(runFirstOpenStaticNeon({ ...input, journal }, ports, () => now), (err: unknown) => {
    assert.ok(err instanceof FirstOpenStaticNeonStopped);
    assert.equal(err.receipt.status, "STOPPED_BEFORE_COMMIT");
    assert.equal(err.receipt.sql, 3);
    assert.equal(err.receipt.connections, 1);
    assert.equal(err.receipt.commitsAttempted, 0);
    assert.equal(err.receipt.inspectionGrantsAttempted, 0);
    return true;
  });
  assert.deepEqual(calls, ["slot", "read-config", "BEGIN", "SET LOCAL search_path TO pg_catalog", "held", "close"]);
  await assert.rejects(runFirstOpenStaticNeon({ ...input, journal }, ports, () => now), /SLOT_OCCUPIED/);
  assert.equal(calls.length, 6);
});

test("one durable COMMIT is marked UNKNOWN before submission, never replayed, and needs an exact ACK", async () => {
  const receipt: FirstOpenStaticNeonReceipt = { status: "STOPPED_BEFORE_COMMIT", jobId, sql: 20,
    connections: 1, commitsAttempted: 0, inspectionGrantsAttempted: 0, releaseSha256: "a".repeat(64) };
  for (const result of ["lost", "ROLLBACK", "COMMIT"]) {
    const x = { ...receipt };
    const log: string[] = [];
    const ports = {
      guard: () => {},
      record: async (stage: string) => {
        assert.equal(x.status, stage === "commit-attempt" ? "COMMIT_UNKNOWN_STOP" : "COMMITTED_INSPECTION_REQUIRED");
        log.push(stage);
      },
      submitCommitOnce: async () => {
        assert.equal(x.status, "COMMIT_UNKNOWN_STOP");
        log.push("submit");
        if (result === "lost") throw Error("fake disconnect");
        return { command: result };
      },
    };
    if (result === "COMMIT") {
      await firstOpenStaticNeonCommitBarrier(x, ports);
      assert.equal(x.status, "COMMITTED_INSPECTION_REQUIRED");
      assert.deepEqual(log, ["commit-attempt", "submit", "commit-ack"]);
    } else {
      await assert.rejects(firstOpenStaticNeonCommitBarrier(x, ports));
      assert.equal(x.status, "COMMIT_UNKNOWN_STOP");
      assert.deepEqual(log, ["commit-attempt", "submit"]);
    }
    assert.equal(x.commitsAttempted, 1);
    await assert.rejects(firstOpenStaticNeonCommitBarrier(x, ports), /COMMIT_REPLAY/);
  }
  assert.deepEqual(FIRST_OPEN_STATIC_NEON_LIMITS, { configurationReads: 1, connections: 2, sql: 32, writerSql: 21, inspectorSql: 11,
    durableCommit: 1, temporaryInspectorGrant: 1, lockTimeoutSeconds: 3, statementTimeoutSeconds: 20 });
});
