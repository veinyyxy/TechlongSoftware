import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import pg from "pg";
import ts from "typescript";
import {
  buildFirstOnboardingJob, firstOnboardingInsertBindings, FIRST_ONBOARDING_HOLD_AT, INSERT_FIRST_ONBOARDING,
} from "../lib/deployments/first-onboarding.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";

const pgBin = process.env.FIRST_OPEN_T2_PG_BIN;
const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const loopback = "127.0.0.1";
const role = "first_open_t2_fixture";

async function freePort() {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, loopback, resolve);
    });
    return server.address().port;
  } finally {
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function waitForPostgres(server) {
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Fixture PostgreSQL startup timed out:\n" + output)), 18_000);
    server.stderr.setEncoding("utf8").on("data", (chunk) => {
      output = (output + chunk).slice(-6000);
      if (output.includes("database system is ready to accept connections")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once("error", (error) => { clearTimeout(timer); reject(error); });
    server.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Fixture PostgreSQL stopped during startup:\n" + output));
    });
  });
}

async function withDisposablePostgres(check) {
  assert.ok(path.isAbsolute(pgBin));
  const binaries = await realpath(pgBin);
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(parent, "techlong-t2-pg-"));
  const dataDirectory = path.join(root, "data");
  const clients = [];
  const executable = (name) => path.join(binaries, name + (process.platform === "win32" ? ".exe" : ""));
  const tool = (name, args) => execFileSync(executable(name), args, {
    encoding: "utf8", windowsHide: true, timeout: 25_000, stdio: ["ignore", "pipe", "pipe"],
  });
  let postmaster;
  try {
    const port = await freePort();
    assert.match(tool("initdb", ["--version"]), /PostgreSQL\) \d+/);
    tool("initdb", ["-D", dataDirectory, "--auth=trust", "--username=" + role, "--locale=C", "--encoding=UTF8", "--no-sync"]);
    postmaster = spawn(executable("postgres"), ["-D", dataDirectory, "-h", loopback, "-p", String(port), "-c", "fsync=off"], {
      windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
    });
    await waitForPostgres(postmaster);
    const connect = async () => {
      const client = new pg.Client({
        host: loopback, port, user: role, database: "postgres", password: "synthetic-t2-only", ssl: false,
        connectionTimeoutMillis: 5000, statement_timeout: 7000, application_name: "techlong-first-open-t2-fixture",
      });
      clients.push(client);
      await client.connect();
      const { rows: [server] } = await client.query(`SELECT current_user AS role, host(inet_server_addr()) AS address,
        inet_server_port() AS port, current_setting('data_directory') AS directory`);
      assert.equal(server.role, role);
      assert.equal(server.address, loopback);
      assert.equal(server.port, port);
      assert.equal(await realpath(server.directory), await realpath(dataDirectory));
      return client;
    };
    await check(connect);
  } finally {
    await Promise.allSettled(clients.map(client => client.end()));
    if (existsSync(path.join(dataDirectory, "postmaster.pid"))) {
      tool("pg_ctl", ["-D", dataDirectory, "-m", "fast", "-w", "-t", "15", "stop"]);
    } else if (postmaster?.pid && postmaster.exitCode === null) {
      postmaster.kill();
    }
    const resolved = await realpath(root);
    assert.equal(path.dirname(resolved), parent);
    assert.match(path.basename(resolved), /^techlong-t2-pg-/);
    await rm(resolved, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
  }
}

// Use the real placeholder and result handling from the application's PostgreSQL
// adapter. The only substituted transport forwards its statements to this test DB.
const pgAdapterJs = ts.transpileModule(read("../db/postgres.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const requireModule = createRequire(import.meta.url);

function applicationDb(client) {
  const compiled = { exports: {} };
  const query = (text, parameters) => client.query(text, parameters);
  const neon = () => ({
    query,
    async transaction(build) {
      const queries = build({ query: (text, parameters) => [text, parameters] });
      await client.query("BEGIN");
      try {
        const results = [];
        for (const [text, parameters] of queries) results.push(await query(text, parameters));
        await client.query("COMMIT");
        return results;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    },
  });
  new Function("require", "exports", "module", pgAdapterJs)((name) => {
    if (name === "cloudflare:workers") return { env: { DATABASE_URL: "local-fixture-transport" } };
    if (name === "@neondatabase/serverless") return { neon };
    return requireModule(name);
  }, compiled.exports, compiled);
  return compiled.exports.getPostgresDatabase();
}

const productId = "prd_restaurant_order_system";
const configuredReleaseId = `release_${"a".repeat(32)}`;
const adminA = { id: "usr_t2_admin_a", status: "active", isPlatformAdmin: true };
const adminB = { id: "usr_t2_admin_b", status: "active", isPlatformAdmin: true };
const ownerA = { id: "usr_t2_owner_a", status: "active", isPlatformAdmin: false };
const ownerB = { id: "usr_t2_owner_b", status: "active", isPlatformAdmin: false };

async function seedDatabase(db) {
  const schema = read("../db/postgres-schema.sql").replaceAll("\r\n", "\n");
  const migration = read("../db/postgres-migrations/0011_first_open_execution_approval.sql").replaceAll("\r\n", "\n").trim();
  assert.equal(schema.split(migration).length, 2, "baseline contains the exact T2 migration");
  await db.query(schema.replace(migration, ""));
  // The fixture uses the same catalog projection with no provider or installation calls.
  await db.query(`CREATE SCHEMA deployment_release;
    CREATE TABLE deployment_release.releases (
      id text PRIMARY KEY, product_id text, component text, version text, status text, document jsonb
    );`);
  const now = Date.now();
  for (const user of [adminA, adminB, ownerA, ownerB]) {
    await db.query(`INSERT INTO users(id,email,name,status,is_platform_admin,created_at,updated_at)
      VALUES ($1,$2,$1,'active',$3,$4,$4)`, [user.id, `${user.id}@fixture.invalid`, Number(user.isPlatformAdmin), now]);
  }
  const templateVersionId = "tplver_restaurant_standard_v1";
  const planId = "plan_t2_fixture";
  const environmentId = "env_aws_sandbox_ca_central_1";
  const { rows: [{ expected_account_id: accountId }] } = await db.query(
    "SELECT expected_account_id FROM deployment_environments WHERE id=$1", [environmentId],
  );
  await db.query(`INSERT INTO plans(id,product_id,template_version_id,name,price_amount,currency,billing_interval,created_at,updated_at)
    VALUES ($1,$2,$3,'T2 fixture',1800,'CAD','month',$4,$4)`, [planId, productId, templateVersionId, now]);
  const repository = `${accountId}.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast`;
  const manifestDigest = `sha256:${"b".repeat(64)}`;
  const release = {
    id: configuredReleaseId, productId, component: "tenant_api", version: "test-t2-1", status: "ecr_verified",
    source: { repository: "fixture.invalid", commit: "c".repeat(40), buildRunId: "1", buildAttempt: 1, artifactSha256: "d".repeat(64) },
    image: { repository, manifestDigest, platformDigest: manifestDigest, verificationSha256: "e".repeat(64), runtimePlatform: "linux/amd64" },
    compatibility: { databaseProfiles: ["express_iam"], schemaVersions: ["fixture-v1"], clientApiVersions: ["fixture-v1"],
      applicationPort: 3000, requiresMigration: false, startupWrites: false },
  };
  await db.query(`INSERT INTO deployment_release.releases(id,product_id,component,version,status,document)
    VALUES ($1,$2,'tenant_api',$3,'ecr_verified',$4)`, [release.id, productId, release.version, release]);
  const instances = [];
  for (const [label, actor] of [["a", ownerA], ["b", ownerB]]) {
    const appInstanceId = `app_t2_${label}`, workspaceId = `wsp_t2_${label}`, subscriptionId = `sub_t2_${label}`;
    const purchaseOrderId = `ord_t2_${label}`, paymentId = `pay_t2_${label}`, providerPaymentId = `pi_t2_fixture_${label}`;
    const tenantKey = `tenant_t2_${label}`, configuration = { storeName: `Fixture ${label}` }, desiredPlan = { mode: "aws_sandbox" };
    const paidAt = now - 2000;
    await db.query(`INSERT INTO workspaces(id,name,owner_id,created_at,updated_at) VALUES ($1,$1,$2,$3,$3)`, [workspaceId, actor.id, now]);
    await db.query(`INSERT INTO subscriptions(id,workspace_id,product_id,plan_id,template_version_id,status,
      current_period_start,current_period_end,instance_configuration,creation_source,created_by_user_id,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8,'payment_success',$9,$6,$6)`, [subscriptionId, workspaceId, productId,
      planId, templateVersionId, paidAt, now + 3600_000, JSON.stringify(configuration), actor.id]);
    await db.query(`INSERT INTO app_instances(id,workspace_id,product_id,subscription_id,template_version_id,configuration_snapshot,
      name,slug,access_url,tenant_key,provisioning_source,status,created_by_user_id,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$1,$7,'',$8,'payment_success','pending',$9,$10,$10)`, [appInstanceId, workspaceId, productId,
      subscriptionId, templateVersionId, JSON.stringify(configuration), `t2-instance-${label}`, tenantKey, actor.id, now]);
    await db.query(`INSERT INTO payment_records(id,workspace_id,subscription_id,amount,currency,status,paid_at,payment_method,
      provider,provider_payment_id,recorded_by_user_id,created_at,updated_at)
      VALUES ($1,$2,$3,1800,'CAD','paid',$4,'card','stripe',$5,$6,$4,$4)`, [paymentId, workspaceId, subscriptionId, paidAt, providerPaymentId, actor.id]);
    await db.query(`INSERT INTO subscription_purchase_orders(id,workspace_id,product_id,plan_id,template_version_id,subscription_id,
      payment_record_id,configuration_snapshot,amount,currency,billing_interval,status,provider,provider_session_id,provider_payment_id,
      created_by_user_id,completed_at,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1800,'CAD','month','paid','stripe',$9,$10,$11,$12,$12,$12)`, [purchaseOrderId, workspaceId,
      productId, planId, templateVersionId, subscriptionId, paymentId, JSON.stringify(configuration), `cs_test_t2_${label}`,
      providerPaymentId, actor.id, paidAt]);
    const job = await buildFirstOnboardingJob({ appInstanceId, workspaceId, subscriptionId, environmentId, planId,
      templateVersionId, tenantKey, planHash: await sha256Hex(desiredPlan), configurationHash: await sha256Hex(configuration),
      releaseId: release.id, artifactRef: `${repository}@${manifestDigest}`, accountId });
    assert.ok(job);
    assert.equal((await db.query(INSERT_FIRST_ONBOARDING, firstOnboardingInsertBindings(job, {
      configuration: JSON.stringify(configuration), desiredPlan: JSON.stringify(desiredPlan), purchaseOrderId,
    }))).rows[0].id, job.jobId);
    instances.push({ id: appInstanceId, purchaseOrderId, paymentId, ...job });
  }
  await db.query(migration);
  return instances;
}

const origin = "https://admin.fixture.invalid";
const endpoint = (instanceId) => `${origin}/api/admin/instances/${instanceId}/first-open`;
const params = instanceId => ({ params: Promise.resolve({ instanceId }) });
const approveRequest = (instanceId, requestOrigin = origin, body) => new Request(endpoint(instanceId), {
  method: "POST", headers: { origin: requestOrigin }, body,
});

async function bodyOf(response) {
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  assert.equal(body.success, true);
  return body.data;
}

async function snapshot(db) {
  const { rows: [row] } = await db.query(`SELECT
    (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM first_open_executions e) AS executions,
    (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY execution_id, sequence),'[]') FROM first_open_execution_events l) AS events,
    (SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM deployment_jobs j) AS jobs,
    (SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM app_instance_deployments d) AS deployments,
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM app_instances i) AS instances`);
  return row;
}

test("T2 PostgreSQL and admin HTTP: instance-scoped concurrent approval, original progress, and read-only failure logs", {
  skip: !pgBin && "set FIRST_OPEN_T2_PG_BIN to local PostgreSQL tools for a fresh loopback fixture", timeout: 90000,
}, async () => withDisposablePostgres(async (connect) => {
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
