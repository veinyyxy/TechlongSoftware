import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { canonicalJson } from "../lib/deployments/execution/hash.ts";
import { PostgresReleaseRepository, ReleasePersistenceUnknown, ReleaseRequestRejected,
  type ReleaseInspection } from "../lib/deployments/releases/repository.ts";
import { releaseFixture, h } from "./instance-release-fixture.ts";

import { MemoryReleaseSql } from "./instance-release-memory.ts";
async function prepared(instance = "one") {
  const f = await releaseFixture(instance), sql = new MemoryReleaseSql(), repo = new PostgresReleaseRepository(sql);
  sql.states.set(f.plan.selection.instanceId, { revision: 3, current: "release_v1", active: null });
  await repo.prepare(f.plan, f.sha);
  return { ...f, sql, repo, claim: { requestId: f.plan.selection.requestId, token: f.token } };
}
async function verifying() {
  const f = await prepared(); await f.repo.claim(f.plan, f.sha, "123", 1, f.token);
  await f.repo.operation(f.claim, "create", "INTENT", h("a"));
  await f.repo.operation(f.claim, "create", "ACK", h("a"), f.changeSetId);
  await f.repo.operation(f.claim, "execute", "INTENT", h("b"));
  await f.repo.operation(f.claim, "execute", "ACK", h("b"), f.changeSetId);
  const proof: ReleaseInspection = { requestId: f.claim.requestId, planSha256: f.sha, runId: "123", runAttempt: 1,
    stackId: f.plan.changeSet.StackName, releaseId: f.plan.to.releaseId, imageUri: f.plan.to.imageUri,
    platformDigest: f.plan.to.platformDigest, templateSha256: f.plan.templateSha256,
    configurationSha256: f.plan.configurationSha256, result: "SUCCEEDED", changeSetId: f.changeSetId,
    serviceArn: "synthetic-service", taskDefinitionArn: "synthetic-definition", observedAt: 2000, runtimeSha256: h("d"),
    evidence: { bucket: "private-test", key: "releases/proof", versionId: "fixed-version", sha256: h("c") } };
  return { ...f, proof };
}

test("release SQL port: preparation is immutable and approval waiting does not lock an instance", async () => {
  const f = await prepared(); assert.equal(f.sql.states.get("app_one")?.active, null);
  assert.equal((await f.repo.prepare(f.plan, f.sha)).status, "AWAITING_APPROVAL");
  const changed = structuredClone(f.plan); changed.to.version = "other";
  await assert.rejects(f.repo.prepare(changed, f.sha), /PLAN_HASH_MISMATCH/);
  assert.equal(f.sql.calls.length, 2);
});

test("release SQL contract model: concurrent same-instance claims have one winner, different instances do not interfere", async () => {
  const f = await prepared(), other = await releaseFixture("one", "another_request");
  await f.repo.prepare(other.plan, other.sha);
  const results = await Promise.allSettled([f.repo.claim(f.plan, f.sha, "123", 1, f.token),
    f.repo.claim(other.plan, other.sha, "124", 1, "other-claim-token")]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const independent = await releaseFixture("two");
  f.sql.states.set("app_two", { revision: 3, current: "release_v1", active: null });
  await f.repo.prepare(independent.plan, independent.sha);
  assert.equal((await f.repo.claim(independent.plan, independent.sha, "125", 1, independent.token)).status, "CLAIMED");
});

test("release SQL contract model: expired claims reject, existing claims never become stealable", async () => {
  const f = await prepared(); await f.repo.claim(f.plan, f.sha, "123", 1, f.token);
  f.sql.now = f.plan.writeBefore + 1;
  await assert.rejects(f.repo.claim(f.plan, f.sha, "124", 2, "new-claim-token"), ReleasePersistenceUnknown);
  await assert.rejects(f.repo.operation(f.claim, "create", "INTENT", h("a")), ReleasePersistenceUnknown);
  assert.equal(f.sql.states.get("app_one")?.active, f.claim.requestId);
  const expired = await prepared(); expired.sql.now = expired.plan.writeBefore;
  await assert.rejects(expired.repo.claim(expired.plan, expired.sha, "123", 1, expired.token), ReleasePersistenceUnknown);
});

test("release SQL contract model: one intent, matching ACK only, unknown blocks further writes and keeps lock", async () => {
  const f = await prepared(); await f.repo.claim(f.plan, f.sha, "123", 1, f.token);
  await f.repo.operation(f.claim, "create", "INTENT", h("a"));
  await assert.rejects(f.repo.operation(f.claim, "create", "INTENT", h("a")), ReleasePersistenceUnknown);
  await assert.rejects(f.repo.operation(f.claim, "create", "ACK", h("b"), f.changeSetId), ReleasePersistenceUnknown);
  assert.equal((await f.repo.operation(f.claim, "create", "UNKNOWN", h("a"))).status, "RECONCILIATION_REQUIRED");
  await assert.rejects(f.repo.operation(f.claim, "execute", "INTENT", h("b")), ReleasePersistenceUnknown);
  assert.equal(f.sql.states.get("app_one")?.current, "release_v1");
  assert.equal(f.sql.states.get("app_one")?.active, f.claim.requestId);
});

test("release SQL port: commit response loss causes no automatic retry or false success", async () => {
  const f = await prepared(), before = f.sql.calls.length; f.sql.loseNextResponse = true;
  await assert.rejects(f.repo.claim(f.plan, f.sha, "123", 1, f.token), e => {
    assert.ok(e instanceof ReleasePersistenceUnknown); assert.doesNotMatch(String(e), /secret-canary/); return true;
  });
  assert.equal(f.sql.calls.length, before + 1);
  assert.equal((await f.repo.request(f.claim.requestId))?.status, "CLAIMED");
  await assert.rejects(f.repo.claim(f.plan, f.sha, "123", 1, f.token), ReleasePersistenceUnknown);
});

test("release SQL port: authored PG rejection stays distinguishable from lost ACK without leaking diagnostics", async () => {
  let calls = 0;
  const repo = new PostgresReleaseRepository({ query: async () => {
    calls++; throw { code: "P0001", message: "RELEASE_CLAIM_CONFLICT", detail: "secret-canary" };
  } });
  const f = await releaseFixture();
  await assert.rejects(repo.claim(f.plan, f.sha, "123", 1, f.token), e => {
    assert.ok(e instanceof ReleaseRequestRejected); assert.equal(e.message, "RELEASE_CLAIM_CONFLICT"); return true;
  });
  assert.equal(calls, 1);
});

test("release SQL contract model: success needs separately stored exact inspection, never just execute ACK", async () => {
  const f = await verifying(); await assert.rejects(f.repo.complete(f.claim), ReleasePersistenceUnknown);
  for (const patch of [{ runAttempt: 2 }, { runId: "foreign" }, { planSha256: h("0") }, { stackId: "foreign" },
    { imageUri: f.plan.from.imageUri }, { platformDigest: f.plan.from.platformDigest }, { configurationSha256: h("0") }]) {
    await assert.rejects(f.repo.recordInspection({ ...f.proof, ...patch }), ReleasePersistenceUnknown);
  }
  await f.repo.recordInspection(f.proof);
  assert.equal((await f.repo.complete(f.claim)).status, "SUCCEEDED");
  assert.deepEqual(f.sql.states.get("app_one"), { revision: 4, current: "release_v2", active: null });
  await assert.rejects(f.repo.complete(f.claim), ReleasePersistenceUnknown);
});

test("release SQL contract model: stale token and revision cannot advance current release", async () => {
  const f = await verifying(); await f.repo.recordInspection(f.proof);
  await assert.rejects(f.repo.complete({ ...f.claim, token: "stale-token" }), ReleasePersistenceUnknown);
  f.sql.states.get("app_one")!.revision++;
  await assert.rejects(f.repo.complete(f.claim), ReleasePersistenceUnknown);
  assert.equal(f.sql.states.get("app_one")?.current, "release_v1");
});

test("release SQL port: lost completion response is reconciled by readback, never a second release/CAS", async () => {
  const f = await verifying(); await f.repo.recordInspection(f.proof);
  const before = f.sql.calls.length; f.sql.loseNextResponse = true;
  await assert.rejects(f.repo.complete(f.claim), ReleasePersistenceUnknown);
  assert.equal(f.sql.calls.length, before + 1);
  assert.equal((await f.repo.request(f.claim.requestId))?.status, "SUCCEEDED");
  assert.equal(f.sql.states.get("app_one")?.revision, 4);
  await assert.rejects(f.repo.complete(f.claim), ReleasePersistenceUnknown);
  assert.equal(f.sql.states.get("app_one")?.revision, 4);
});

test("release SQL draft: three isolated tables, fixed search_path and no runtime table DML/owner memberships", async () => {
  const schema = await readFile(new URL("../ops/releases/schema.draft.sql", import.meta.url), "utf8");
  const grants = await readFile(new URL("../ops/releases/grants.draft.sql", import.meta.url), "utf8");
  assert.equal(schema.match(/CREATE TABLE deployment_release\./g)?.length, 3);
  assert.equal(schema.match(/CREATE FUNCTION deployment_release\./g)?.length, 9);
  assert.equal(schema.match(/CREATE FUNCTION deployment_release\./g)?.length,
    schema.match(/SECURITY DEFINER SET search_path = pg_catalog/g)?.length);
  assert.match(schema, /REVOKE ALL ON ALL FUNCTIONS IN SCHEMA deployment_release FROM PUBLIC/);
  assert.doesNotMatch(schema, /CREATE OR REPLACE|\bpublic\.|deployment_jobs|plan_only|CREATE EXTENSION|\bEXECUTE\s+format/i);
  assert.doesNotMatch(grants, /GRANT\s+(?:SELECT|UPDATE|INSERT|DELETE|ALL)\b|GRANT\s+deployment_release_owner|\bPASSWORD\b/i);
  assert.match(grants, /record_inspection\(text,jsonb\) TO deployment_release_verifier/);
  assert.match(schema, /sha256\(convert_to\(p_text,'UTF8'\)\)/);
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
});
