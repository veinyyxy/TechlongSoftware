import assert from "node:assert/strict";
import test from "node:test";
import { createFirstOpenAdminStore } from "../lib/deployments/first-open-admin-store.ts";
import { dispatchEcsFirstOpen } from "../lib/deployments/execution/ecs-first-open-dispatch.ts";
import { createFirstOpenDispatchStore } from "../lib/deployments/execution/ecs-first-open-dispatch-store.ts";
import {
  firstOpenVisibilityJoins, visibleFirstOpenAccessUrl, visibleFirstOpenProvisionedAt, visibleFirstOpenStatus, withFirstOpenVisibility,
} from "../lib/instances/first-open-visibility.ts";
import { adminA, applicationDb, seedDatabase, snapshot, withDisposablePostgres } from "./first-open-postgres-fixture.mjs";

const pgBin = process.env.FIRST_OPEN_T4_PG_BIN;
const fixtureOptions = {
  skip: !pgBin && "set FIRST_OPEN_T4_PG_BIN to the local PostgreSQL 16.14 binaries",
  timeout: 90_000,
};

async function assertPostgres16_14(client) {
  const { rows: [version] } = await client.query("SHOW server_version");
  assert.match(version.server_version, /^16\.14(?:\s|$)/);
}

test("T4 PostgreSQL: an expired approval cannot reserve or launch an ECS task", fixtureOptions,
  async () => withDisposablePostgres(pgBin, async connect => {
    const client = await connect();
    await assertPostgres16_14(client);
    const [a, b] = await seedDatabase(client);
    const db = applicationDb(client);
    const admin = createFirstOpenAdminStore(db);
    const store = createFirstOpenDispatchStore(db);
    const expired = await admin.approve(a.id, adminA.id);
    const fresh = await admin.approve(b.id, adminA.id);
    assert.ok(expired && fresh);

    // Age the approval and its matching audit row together on the disposable DB.
    const aged = await client.query(`WITH expired AS (
      UPDATE first_open_executions SET approved_at = approved_at - $2::bigint WHERE id = $1 RETURNING id, approved_at
    ) UPDATE first_open_execution_events event SET at = expired.approved_at
      FROM expired WHERE event.execution_id = expired.id AND event.sequence = 1`, [expired.id, 3_600_001]);
    assert.equal(aged.rowCount, 1);

    const clusterArn = "arn:aws:ecs:ca-central-1:123456789012:cluster/t4-fixture";
    const taskDefinitionArn = "arn:aws:ecs:ca-central-1:123456789012:task-definition/t4-fixture:1";
    const taskArn = `arn:aws:ecs:ca-central-1:123456789012:task/t4-fixture/${"a".repeat(32)}`;
    const placement = {
      clusterArn, taskDefinitionArn, containerName: "platform",
      subnetIds: ["subnet-12345678"], securityGroupIds: ["sg-12345678"],
    };
    const calls = [];
    const ecs = { async runTask(request) {
      calls.push(request);
      return { tasks: [{ clusterArn, taskDefinitionArn, taskArn }], failures: [] };
    } };
    const dispatch = id => dispatchEcsFirstOpen(id, placement, { store, ecs });
    const before = await snapshot(client);
    const result = await dispatch(expired.id);
    assert.equal(result.executionId, expired.id);
    assert.equal(result.taskArn, null);
    assert.deepEqual(calls, []);
    assert.deepEqual(await snapshot(client), before);

    assert.deepEqual(await dispatch(fresh.id), { executionId: fresh.id, status: "acknowledged", taskArn });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].clientToken, fresh.id);
    assert.equal(calls[0].count, 1);
  }));

test("T4 PostgreSQL: Web and launcher locking writes need grants beyond the read paths", fixtureOptions,
  async () => withDisposablePostgres(pgBin, async connect => {
    const owner = await connect();
    const web = await connect();
    const launcher = await connect();
    await assertPostgres16_14(owner);
    const [a, b] = await seedDatabase(owner);
    await owner.query(`CREATE ROLE t4_web_fixture NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      CREATE ROLE t4_launcher_fixture NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      GRANT SELECT ON app_instances,app_instance_deployments,deployment_jobs,subscriptions,workspaces,users,deployment_environments,
        subscription_purchase_orders,payment_records,deployment_tenant_resources,first_open_executions,first_open_execution_events
        TO t4_web_fixture,t4_launcher_fixture;
      GRANT USAGE ON SCHEMA deployment_release TO t4_web_fixture;
      GRANT SELECT ON deployment_release.releases TO t4_web_fixture;
      GRANT INSERT (id,instance_id,job_id,deployment_id,purchase_order_id,release_id,artifact_ref,review_sha256,approved_by,approved_at)
        ON first_open_executions TO t4_web_fixture;
      GRANT INSERT (execution_id,sequence,step,status,at) ON first_open_execution_events TO t4_web_fixture;
      GRANT UPDATE (dispatch_token,dispatch_started_at,dispatch_task_arn,dispatch_outcome) ON first_open_executions TO t4_launcher_fixture;
      GRANT INSERT (execution_id,sequence,step,status,at,error_code) ON first_open_execution_events TO t4_launcher_fixture`);
    for (const [client, role] of [[web, "t4_web_fixture"], [launcher, "t4_launcher_fixture"]]) {
      await client.query(`SET ROLE ${role}`);
      const { rows: [identity] } = await client.query(
        "SELECT current_user AS role, rolsuper, rolcreaterole FROM pg_roles WHERE rolname = current_user",
      );
      assert.deepEqual(identity, { role, rolsuper: false, rolcreaterole: false });
    }

    const webStore = createFirstOpenAdminStore(applicationDb(web));
    const dispatchStore = createFirstOpenDispatchStore(applicationDb(launcher));
    assert.deepEqual(await webStore.read(a.id, adminA.id), { instanceId: a.id, eligible: true, execution: null, events: [] });
    const beforeApproval = await snapshot(owner);
    await assert.rejects(webStore.approve(a.id, adminA.id), { code: "42501", message: /permission denied for table subscription_purchase_orders/ });
    assert.deepEqual(await snapshot(owner), beforeApproval);

    const { id } = await createFirstOpenAdminStore(applicationDb(owner)).approve(a.id, adminA.id);
    const waiting = { status: "waiting", taskArn: null };
    assert.deepEqual(await dispatchStore.read(id), waiting);
    const beforeDispatch = await snapshot(owner);
    await assert.rejects(dispatchStore.begin(id), { code: "42501", message: /permission denied for table app_instances/ });
    assert.deepEqual(await snapshot(owner), beforeDispatch);

    const visible = instanceId => withFirstOpenVisibility(async enabled => {
      const { rows: [row] } = await web.query(`SELECT ${enabled ? visibleFirstOpenStatus : "ai.status"} AS status,
        ${enabled ? visibleFirstOpenAccessUrl : "ai.access_url"} AS access_url,
        ${enabled ? visibleFirstOpenProvisionedAt : "ai.provisioned_at"} AS provisioned_at
        FROM public.app_instances ai ${enabled ? firstOpenVisibilityJoins : ""} WHERE ai.id = $1`, [instanceId]);
      return row;
    });
    await owner.query("UPDATE app_instances SET status='active',access_url='https://uncertain.fixture.invalid',provisioned_at=$2 WHERE id=$1",
      [a.id, Date.now()]);
    const pending = { status: "pending", access_url: "", provisioned_at: null };
    assert.deepEqual(await visible(a.id), pending);
    assert.deepEqual(await visible(b.id), pending);
    await owner.query("REVOKE SELECT ON first_open_execution_events FROM t4_web_fixture");
    await assert.rejects(visible(a.id), { code: "42501", message: /permission denied for table first_open_execution_events/ });
  }));
