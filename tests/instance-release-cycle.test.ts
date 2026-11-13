import assert from "node:assert/strict";
import test from "node:test";
import { executeInstanceRelease } from "../lib/deployments/releases/update.ts";
import { cycleFixture } from "./instance-release-cycle-fixture.ts";

const run = (f: Awaited<ReturnType<typeof cycleFixture>>) => executeInstanceRelease(f.input, f.deps);
const count = (f: Awaited<ReturnType<typeof cycleFixture>>, action: string) => f.events.filter(e => e === action).length;
const state = (f: Awaited<ReturnType<typeof cycleFixture>>) => f.sql.states.get(f.plan.selection.instanceId)!;

test("release cycle: same code deploys two instances/registered ECR versions; independent evidence precedes CAS", async () => {
  const images: string[] = [];
  for (const [instance, release] of [["one", "release_v2"], ["two", "release_v3"]]) {
    const f = await cycleFixture(instance, release);
    try {
      assert.equal((await run(f)).status, "SUCCEEDED");
      images.push(f.plan.to.imageUri);
      assert.deepEqual(state(f), { revision: 4, current: release, active: null });
      assert.deepEqual(f.stats(), { created: true, executed: true, executorReads: 2, inspectorReads: 1, stackReads: 1 });
      assert.equal(count(f, "CreateChangeSet"), 1); assert.equal(count(f, "ExecuteChangeSet"), 1);
      assert.ok(f.events.indexOf("IndependentSnapshot") > f.events.indexOf("ExecuteChangeSet"));
      assert.equal(f.events.at(-1), "EvidenceGET");
      assert.equal((await f.executorRepo.request(f.input.requestId))?.inspection?.evidence.versionId, "fixed-evidence-version");
      for (const document of f.documents.values()) assert.doesNotMatch(document, /secret-canary|SYNTHETIC_SECRET|environment|password|privateKey/);
      const writesBefore = f.events.length;
      assert.equal((await run(f)).code, "REQUEST_ALREADY_STARTED"); assert.equal(f.events.length, writesBefore);
    } finally { f.destroy(); }
  }
  assert.equal(new Set(images).size, 2);
});

test("release cycle: concurrent executions of one approved request submit one Create and one Execute", async () => {
  const f = await cycleFixture();
  try {
    const results = await Promise.all([run(f), run(f)]);
    assert.equal(results.filter(r => r.status === "SUCCEEDED").length, 1);
    assert.equal(count(f, "CreateChangeSet"), 1); assert.equal(count(f, "ExecuteChangeSet"), 1);
    assert.equal(state(f).revision, 4);
  } finally { f.destroy(); }
});

test("release preparation: NO_CHANGE has a durable non-executable receipt, no cloud calls or pointer advance", async () => {
  const f = await cycleFixture();
  try {
    const i = structuredClone(f.planningInput);
    i.selection.requestId = "request_no_change"; i.release = f.sql.contexts.get(i.selection.instanceId)!.releases[0];
    i.selection.releaseId = i.release.id;
    const result = await f.prepare(i);
    assert.equal(result.request.status, "NO_CHANGE"); assert.equal(result.request.plan, null);
    assert.equal(result.request.decision?.selection.requestId, i.selection.requestId);
    assert.equal((await executeInstanceRelease({ ...f.input, requestId: i.selection.requestId,
      approvedPlanSha256: result.request.planSha256 }, f.deps)).status, "NO_CHANGE");
    assert.deepEqual(state(f), { revision: 3, current: f.plan.from.releaseId, active: null });
    assert.equal(f.events.length, 0);
  } finally { f.destroy(); }
});

test("release cycle: stopped dependencies block with no CFN writes and no implicit restore", async () => {
  const f = await cycleFixture();
  try {
    f.controls.executorPatch = facts => { facts.databaseAvailable = false; };
    assert.equal((await run(f)).status, "BLOCKED_RESTORE_REQUIRED");
    assert.equal(count(f, "CreateChangeSet"), 0); assert.equal(count(f, "ExecuteChangeSet"), 0);
    assert.equal(state(f).current, f.plan.from.releaseId); assert.equal(state(f).active, null);
  } finally { f.destroy(); }
});

test("release cycle: revoked catalog and unexpected pre-existing Change Set reject before Create", async () => {
  for (const mode of ["revoked", "foreign-change-set"]) {
    const f = await cycleFixture();
    try {
      if (mode === "revoked") f.sql.contexts.get(f.plan.selection.instanceId)!.releases[1].status = "revoked";
      else f.controls.executorPatch = facts => { facts.openChangeSetIds.push("foreign-change-set"); };
      assert.equal((await run(f)).status, "BLOCKED"); assert.equal(count(f, "CreateChangeSet"), 0);
    } finally { f.destroy(); }
  }
});

test("release cycle: candidate template, parameter and resource scope mismatches reject without Execute or cleanup", async () => {
  for (const mode of ["template", "parameter", "resource"]) {
    const f = await cycleFixture();
    try {
      if (mode === "template") f.controls.mutateCandidate = true;
      else f.controls.changeSetPatch = cs => {
        if (mode === "parameter") cs.Parameters![0].ParameterValue = "foreign-cluster";
        else cs.Changes!.push({ Type: "Resource", ResourceChange: { LogicalResourceId: "InjectedNetwork", Action: "Add" } });
      };
      assert.equal((await run(f)).status, "REJECTED_CHANGE_SET");
      assert.equal(count(f, "CreateChangeSet"), 1); assert.equal(count(f, "ExecuteChangeSet"), 0);
      assert.equal(f.events.some(e => e.startsWith("Delete")), false);
    } finally { f.destroy(); }
  }
});

test("release cycle: failed candidate read is unknown, not fabricated rejection or a second Create", async () => {
  const f = await cycleFixture();
  try {
    f.deps.cloud.template = async () => { throw new Error("secret-canary-provider-read-failed"); };
    const result = await run(f);
    assert.equal(result.status, "RECONCILIATION_REQUIRED"); assert.doesNotMatch(JSON.stringify(result), /secret-canary/);
    assert.equal(count(f, "CreateChangeSet"), 1); assert.equal(count(f, "ExecuteChangeSet"), 0);
    assert.equal(state(f).active, f.input.requestId);
    assert.equal((await f.executorRepo.request(f.input.requestId))?.status, "CHANGE_SET_CREATED");
  } finally { f.destroy(); }
});

test("release cycle: role, retained route or source update-time changes between Create and Execute reject", async () => {
  for (const mode of ["role", "route", "time"]) {
    const f = await cycleFixture();
    try {
      f.controls.executorPatch = (facts, read) => {
        if (read !== 2) return;
        if (mode === "role") facts.roleArn = "foreign-role";
        if (mode === "route") facts.resources.TenantHttpsRule.physicalId = "foreign-route";
        if (mode === "time") facts.stackUpdatedAt++;
      };
      assert.equal((await run(f)).status, "REJECTED_CHANGE_SET"); assert.equal(count(f, "ExecuteChangeSet"), 0);
    } finally { f.destroy(); }
  }
});

test("release cycle: unknown Create/Execute acknowledgement never replays, inspects or advances version", async () => {
  for (const operation of ["create", "execute"]) {
    const f = await cycleFixture();
    try {
      if (operation === "create") f.controls.createUnknown = true; else f.controls.executeUnknown = true;
      assert.equal((await run(f)).status, "RECONCILIATION_REQUIRED");
      assert.equal(count(f, "CreateChangeSet"), 1); assert.equal(count(f, "ExecuteChangeSet"), operation === "execute" ? 1 : 0);
      assert.equal(f.stats().inspectorReads, 0); assert.equal(state(f).current, f.plan.from.releaseId);
      assert.equal(state(f).active, f.input.requestId);
      const events = f.events.length; await run(f); assert.equal(f.events.length, events);
    } finally { f.destroy(); }
  }
});

test("release cycle: independently verified managed rollback leaves old version, invalidates stale revision, no new update", async () => {
  const f = await cycleFixture();
  try {
    f.controls.rollback = true;
    assert.equal((await run(f)).status, "FAILED_ROLLED_BACK_VERIFIED");
    assert.deepEqual(state(f), { revision: 4, current: f.plan.from.releaseId, active: null });
    assert.equal(count(f, "ExecuteChangeSet"), 1); assert.equal(f.stats().inspectorReads, 1);
  } finally { f.destroy(); }
});

test("release cycle: rollback failure, old runtime digest, unhealthy/unchecked HTTP or changed ownership never attest success", async () => {
  for (const mode of ["rollback-failed", "old-digest", "ready-failed", "http-unchecked", "ownership"]) {
    const f = await cycleFixture();
    try {
      f.controls.inspectorPatch = facts => {
        if (mode === "rollback-failed") facts.stackStatus = "UPDATE_ROLLBACK_FAILED";
        if (mode === "old-digest") facts.tasks[0].containers![0].imageDigest = f.plan.from.platformDigest;
        if (mode === "ready-failed") facts.checks[1].status = 503;
        if (mode === "http-unchecked") facts.checks = [];
        if (mode === "ownership") facts.resources.TenantHttpsRule.physicalId = "foreign-route";
      };
      assert.equal((await run(f)).status, "FAILED_NEEDS_INSPECTION");
      assert.deepEqual(state(f), { revision: 3, current: f.plan.from.releaseId, active: f.input.requestId });
      assert.equal(count(f, "ExecuteChangeSet"), 1);
    } finally { f.destroy(); }
  }
});

test("release cycle: a success-looking inspector return without persisted independent proof cannot complete", async () => {
  const f = await cycleFixture();
  try {
    f.deps.inspector.inspect = async () => ({ bucket: "forged", key: "forged", versionId: "forged", sha256: f.sha });
    assert.equal((await run(f)).status, "FAILED_NEEDS_INSPECTION"); assert.equal(state(f).current, f.plan.from.releaseId);
    assert.equal(f.sql.calls.some(c => c.includes("complete_request")), false);
  } finally { f.destroy(); }
});

test("release cycle: bounded reads tolerate pending CS and stale pre-update COMPLETE without premature inspection", async () => {
  const f = await cycleFixture();
  try {
    f.controls.createPendingReads = 2; f.controls.staleCompleteReads = 2;
    assert.equal((await run(f)).status, "SUCCEEDED");
    assert.equal(count(f, "DescribeChangeSet"), 3); assert.equal(f.stats().stackReads, 3);
    assert.equal(f.stats().inspectorReads, 1); assert.equal(count(f, "ExecuteChangeSet"), 1);
  } finally { f.destroy(); }
});

test("release cycle: exhausted stack-read budget preserves unknown operation and does not inspect/retry", async () => {
  const f = await cycleFixture();
  try {
    f.controls.stuck = true;
    assert.equal((await run(f)).status, "RECONCILIATION_REQUIRED");
    assert.equal(f.stats().stackReads, f.input.maxStackReads); assert.equal(f.stats().inspectorReads, 0);
    assert.equal(state(f).active, f.input.requestId); assert.equal(count(f, "ExecuteChangeSet"), 1);
  } finally { f.destroy(); }
});

test("release cycle: original write deadline is never extended at claim, before Execute or after durable intent", async () => {
  for (const stage of ["claim", "execute", "intent"]) {
    const f = await cycleFixture();
    try {
      f.input.readBefore = f.plan.writeBefore + 1000;
      if (stage === "claim") f.sql.now = f.plan.writeBefore;
      else if (stage === "execute") f.controls.executorPatch = (_, read) => { if (read === 2) f.sql.now = f.plan.writeBefore; };
      else {
        const original = f.executorRepo.operation.bind(f.executorRepo);
        f.executorRepo.operation = async (...args) => {
          const row = await original(...args);
          if (args[1] === "create" && args[2] === "INTENT") f.sql.now = f.plan.writeBefore;
          return row;
        };
      }
      assert.equal((await run(f)).status, stage === "intent" ? "RECONCILIATION_REQUIRED" : "EXPIRED");
      assert.equal(count(f, "ExecuteChangeSet"), 0); assert.equal(count(f, "CreateChangeSet"), stage === "execute" ? 1 : 0);
    } finally { f.destroy(); }
  }
});

test("release cycle: lost database intent response prevents cloud call; lost completion response does not repeat CAS", async () => {
  for (const phase of ["record_operation", "complete_request"]) {
    const f = await cycleFixture();
    try {
      f.sql.loseOn = phase;
      const result = await run(f);
      assert.equal(result.status, "RECONCILIATION_REQUIRED"); assert.equal(result.code, "DATABASE_READBACK_REQUIRED");
      if (phase === "record_operation") { assert.equal(count(f, "CreateChangeSet"), 0); assert.equal(state(f).active, f.input.requestId); }
      else { assert.equal(state(f).current, f.plan.to.releaseId); assert.equal(f.sql.calls.filter(c => c.includes("complete_request")).length, 1); }
      const events = f.events.length; await run(f); assert.equal(f.events.length, events);
    } finally { f.destroy(); }
  }
});

test("release cycle: evidence failure or verifier commit error stops without result overwrite or a second deployment", async () => {
  for (const phase of ["evidence", "verifier"]) {
    const f = await cycleFixture();
    try {
      if (phase === "evidence") f.controls.evidenceFailure = true; else f.sql.failBefore = "record_inspection";
      const result = await run(f);
      assert.equal(result.status, "RECONCILIATION_REQUIRED"); assert.doesNotMatch(JSON.stringify(result), /secret-canary/);
      assert.equal(state(f).current, f.plan.from.releaseId); assert.equal(count(f, "ExecuteChangeSet"), 1);
      assert.equal(f.sql.calls.some(c => c.includes("complete_request")), false); assert.equal(count(f, "EvidencePUT"), 1);
    } finally { f.destroy(); }
  }
});

test("release roles: executor cannot self-attest and verifier cannot claim or complete", async () => {
  const f = await cycleFixture();
  try {
    const raw = "select deployment_release.record_inspection($1::text,$2::jsonb) as result";
    await assert.rejects(async () => f.sql.client("executor").query(raw, [f.input.requestId, "{}"]), /role denied/);
    for (const fn of ["claim_request", "complete_request"]) {
      await assert.rejects(async () => f.sql.client("verifier").query(`select deployment_release.${fn}($1::text) as result`, [f.input.requestId]), /role denied/);
    }
  } finally { f.destroy(); }
});
