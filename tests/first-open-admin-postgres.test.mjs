import assert from "node:assert/strict";
import test from "node:test";
import { FIRST_ONBOARDING_HOLD_AT } from "../lib/deployments/first-onboarding.ts";
import { adminA, adminB, ownerA, configuredReleaseId, origin, withDisposablePostgres, applicationDb,
  seedDatabase, endpoint, params, approveRequest, bodyOf, snapshot } from "./first-open-postgres-fixture.mjs";

const pgBin = process.env.FIRST_OPEN_T2_PG_BIN;

test("T2 PostgreSQL and admin HTTP: instance-scoped concurrent approval, original progress, and read-only failure logs", {
  skip: !pgBin && "set FIRST_OPEN_T2_PG_BIN to local PostgreSQL tools for a fresh loopback fixture", timeout: 90000,
}, async () => withDisposablePostgres(pgBin, async (connect) => {
  const { createFirstOpenAdminStore } = await import("../lib/deployments/first-open-admin-store.ts");
  const { createFirstOpenAdminHandlers } = await import("../lib/deployments/first-open-admin-http.ts");
  const db = await connect();
  const [a, b] = await seedDatabase(db);
  const secondDb = await connect();
  const firstStore = createFirstOpenAdminStore(applicationDb(db));
  const secondStore = createFirstOpenAdminStore(applicationDb(secondDb));
  const as = (user, store = firstStore) => createFirstOpenAdminHandlers({
    authorize: async () => ({ account: { user }, response: null }), store: () => store,
  });
  const approverA = as(adminA);
  const approverB = as(adminB, secondStore);
  const get = (handler, instance) => handler.GET(new Request(endpoint(instance.id)), params(instance.id));
  const approve = (handler, instance) => handler.POST(approveRequest(instance.id), params(instance.id));
  const original = await snapshot(db);
  assert.deepEqual(original.executions, []);
  assert.deepEqual(original.events, []);
  for (const instance of [a, b]) {
    const data = await bodyOf(await get(approverA, instance));
    assert.equal(data.instanceId, instance.id);
    assert.equal(data.eligible, true);
    assert.equal(data.execution, null);
    assert.deepEqual(data.events, []);
  }

  let blockedStoreCalls = 0;
  const blockedAs = (user) => createFirstOpenAdminHandlers({
    authorize: async () => ({ account: { user }, response: null }), store: () => { blockedStoreCalls++; return firstStore; },
  });
  for (const user of [ownerA, { ...adminB, status: "disabled" }]) {
    const client = blockedAs(user);
    for (const instance of [a, b]) {
      assert.equal((await approve(client, instance)).status, 403);
      assert.equal((await get(client, instance)).status, 403);
    }
  }
  assert.equal(blockedStoreCalls, 0);
  assert.equal(await firstStore.read(a.id, ownerA.id), null);
  assert.equal(await firstStore.approve(a.id, ownerA.id), null);
  assert.equal((await approverA.POST(approveRequest(a.id, "https://different.fixture.invalid"), params(a.id))).status, 403);
  assert.equal((await approverA.POST(approveRequest(a.id, origin, JSON.stringify({ instanceId: b.id })), params(a.id))).ok, false);
  assert.deepEqual(await snapshot(db), original);

  await db.query("UPDATE payment_records SET status='pending' WHERE id=$1", [a.paymentId]);
  assert.equal((await approve(approverA, a)).ok, false);
  await db.query("UPDATE payment_records SET status='paid' WHERE id=$1", [a.paymentId]);
  await db.query("UPDATE deployment_release.releases SET status='revoked' WHERE id=$1", [configuredReleaseId]);
  assert.equal((await approve(approverA, a)).ok, false);
  await db.query("UPDATE deployment_release.releases SET status='ecr_verified' WHERE id=$1", [configuredReleaseId]);
  assert.deepEqual(await snapshot(db), original);

  // If storing the first log fails, the same statement or transaction must
  // roll back the start intent. Test this before any approval is committed.
  await db.query(`CREATE FUNCTION t2_fixture_event_reject() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic approval log storage failure'; END $$;
    CREATE TRIGGER t2_fixture_approval_rollback BEFORE INSERT ON first_open_execution_events
      FOR EACH ROW EXECUTE FUNCTION t2_fixture_event_reject();`);
  assert.equal((await approve(approverA, a)).ok, false);
  assert.deepEqual(await snapshot(db), original);
  await db.query("DROP TRIGGER t2_fixture_approval_rollback ON first_open_execution_events");

  // Keep the first insertion in progress while the second request overlaps.
  await db.query(`CREATE FUNCTION t2_fixture_slow_approval() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_sleep(0.15); RETURN NEW; END $$;
    CREATE TRIGGER t2_fixture_concurrent_approval BEFORE INSERT ON first_open_executions
      FOR EACH ROW EXECUTE FUNCTION t2_fixture_slow_approval();`);
  const [one, two] = await Promise.all([approve(approverA, a), approve(approverB, a)]).then(responses => Promise.all(responses.map(bodyOf)));
  assert.deepEqual(one, two);
  assert.match(one.id, /^exec_[a-f0-9]{32}$/);
  assert.equal(one.status, "waiting");
  assert.equal(one.step, "approval");
  assert.equal((await bodyOf(await approve(approverB, a))).id, one.id);
  const approved = await snapshot(db);
  assert.equal(approved.executions.length, 1);
  assert.deepEqual(approved.executions.map(entry => [entry.id, entry.instance_id, entry.job_id, entry.deployment_id,
    entry.purchase_order_id, entry.release_id]), [[one.id, a.id, a.jobId, a.deploymentId, a.purchaseOrderId, configuredReleaseId]]);
  assert.ok([adminA.id, adminB.id].includes(approved.executions[0].approved_by));
  assert.equal(Number(approved.executions[0].approved_at), one.approvedAt);
  assert.deepEqual(approved.events.map(entry => [entry.execution_id, entry.sequence, entry.step, entry.status]), [
    [one.id, 1, "approval", "completed"],
  ]);
  assert.deepEqual(approved.jobs, original.jobs);
  assert.ok(approved.jobs.every(job => job.status === "pending" && job.attempts === 0 && job.available_at === FIRST_ONBOARDING_HOLD_AT));
  assert.deepEqual(approved.deployments, original.deployments);
  assert.deepEqual(approved.instances, original.instances);

  // Subsequent stage records are written only into this disposable fixture.
  await db.query(`INSERT INTO first_open_execution_events(execution_id,sequence,step,status,at,error_code)
    VALUES ($1,2,'database_initialization','completed',$2,NULL),($1,3,'api_deployment','started',$3,NULL)`,
  [one.id, one.approvedAt + 1, one.approvedAt + 2]);
  const running = await bodyOf(await approve(approverB, a));
  assert.deepEqual(running, { ...one, status: "running", step: "api_deployment" });
  assert.equal((await snapshot(db)).executions.length, 1);
  const canary = "synthetic-private-provider-payload postgres://fixture.invalid SECRET_TEST_ONLY";
  await db.query(`UPDATE deployment_jobs SET last_error_message=$2, last_error_code=$2 WHERE id=$1`, [a.jobId, canary]);
  await assert.rejects(db.query(`INSERT INTO first_open_execution_events(execution_id,sequence,step,status,at,error_code)
    VALUES ($1,4,'api_deployment','failed',$2,$3)`, [one.id, one.approvedAt + 3, canary]), { code: "23514" });
  await db.query(`INSERT INTO first_open_execution_events(execution_id,sequence,step,status,at,error_code)
    VALUES ($1,4,'api_deployment','failed',$2,'AccessDenied')`, [one.id, one.approvedAt + 3]);
  const failed = await snapshot(db);

  await db.query("BEGIN READ ONLY");
  try {
    const response = await get(approverA, a);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    const logs = await bodyOf(response);
    assert.deepEqual(logs.execution, { ...one, status: "failed", step: "api_deployment" });
    assert.deepEqual(logs.events.map(({ step, status, at }) => [step, status, at]), [
      ["approval", "completed", one.approvedAt], ["database_initialization", "completed", one.approvedAt + 1],
      ["api_deployment", "started", one.approvedAt + 2], ["api_deployment", "failed", one.approvedAt + 3],
    ]);
    assert.equal(logs.events[3].errorCode, "AccessDenied");
    assert.equal(logs.events[3].reason, "执行身份无权操作目标资源。");
    assert.doesNotMatch(JSON.stringify(logs), /SECRET_TEST_ONLY|synthetic-private-provider-payload|postgres:\/\//);
    const other = await bodyOf(await get(approverA, b));
    assert.equal(other.eligible, true);
    assert.equal(other.execution, null);
    assert.deepEqual(other.events, []);
    const summaries = await firstStore.listSummaries([a.id, b.id], adminA.id);
    assert.deepEqual(summaries.find(data => data.instanceId === a.id).execution, logs.execution);
    assert.equal(summaries.find(data => data.instanceId === b.id).execution, null);
  } finally {
    await db.query("ROLLBACK");
  }
  assert.deepEqual(await bodyOf(await approve(approverB, a)), { ...one, status: "failed", step: "api_deployment" });
  assert.deepEqual(await snapshot(db), failed);
  assert.deepEqual(failed.jobs.find(job => job.id === b.jobId), original.jobs.find(job => job.id === b.jobId));
}));
