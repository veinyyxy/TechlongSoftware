import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { neon, neonConfig } from "@neondatabase/serverless";
import pg from "pg";
import { createNeonPostgresDatabase } from "../db/postgres-neon.ts";
import { firstOnboardingClaimBindings, CLAIM_FIRST_ONBOARDING, SELECT_FIRST_ONBOARDING,
  FIRST_ONBOARDING_HOLD_AT, loadFirstOnboardingReview } from "../lib/deployments/first-onboarding.ts";
import { createFirstOpenAdminHandlers } from "../lib/deployments/first-open-admin-http.ts";
import { createFirstOpenAdminStore } from "../lib/deployments/first-open-admin-store.ts";
import { createEcsFirstOpenTaskPorts } from "../lib/deployments/execution/ecs-first-open-runtime.ts";
import { createFirstOpenDispatchStore } from "../lib/deployments/execution/ecs-first-open-dispatch-store.ts";
import { dispatchEcsFirstOpen } from "../lib/deployments/execution/ecs-first-open-dispatch.ts";
import { finishSandboxFirstCheckout, sandboxPurchaseOrderId, SANDBOX_PURCHASE_SQL } from "../lib/purchases/sandbox-first-purchase.ts";
import { SANDBOX_PURCHASE_PRODUCT } from "../lib/purchases/sandbox-first-purchase-config.ts";
import { sandboxFirstPurchaseInstallStatements } from "../ops/platform-web-database-role-v1/sandbox-first-purchase-ddl.ts";

const source = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const templateId = "tplver_restaurant_standard_v1";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const publicNamespaces = /\b(?:deployment_release|sandbox_first_purchase|public)\./g;

function reviewedNeonTarget(env) {
  const fail = () => { throw Error("T41_NEON_TEST_TARGET_SCOPE"); };
  const { T41_NEON_TEST_DATABASE_URL: raw, T41_NEON_TEST_HOST: host,
    T41_NEON_TEST_DATABASE: database, T41_NEON_TEST_ROLE: user } = env;
  let url, role, db, password;
  try {
    url = new URL(raw);
    role = decodeURIComponent(url.username);
    db = decodeURIComponent(url.pathname.slice(1));
    password = decodeURIComponent(url.password);
  } catch { return fail(); }
  if (url.protocol !== "postgresql:" || raw !== raw.trim() || url.hash || (url.port && url.port !== "5432") ||
      !/^ep-[a-z0-9-]+(?:\.[a-z0-9-]+){1,4}\.(?:aws|azure)\.neon\.tech$/.test(host) || !/^[a-zA-Z0-9_-]{1,63}$/.test(database) ||
      !/^[a-zA-Z0-9_-]{1,63}$/.test(user) || !password || url.hostname !== host || role !== user || db !== database ||
      !["require", "verify-full"].includes(url.searchParams.get("sslmode")) ||
      [...url.searchParams].some(([k, v]) => (k !== "sslmode" && (k !== "channel_binding" || v !== "require")) ||
        url.searchParams.getAll(k).length !== 1)) return fail();
  return { raw, host, database, user, password, target: sha256([host, database, user].join("\0")),
    httpsSql: `https://api.${host.slice(host.indexOf(".") + 1)}/sql` };
}

function fixtureNamespace(schema) {
  assert.match(schema, /^t41_neon_[a-f0-9]{32}$/);
  const identifier = `"${schema}"`;
  const scopeSql = (sql) => sql.replace(publicNamespaces, identifier + ".");
  const schemaSource = source("../db/postgres-schema.sql");
  assert.match(schemaSource, /^BEGIN;\n[\s\S]+\nCOMMIT;\s*$/);
  assert.doesNotMatch(schemaSource, /\b(?:deployment_release|sandbox_first_purchase|public)\.|\bSECURITY DEFINER\b|\b(?:CREATE|DROP|ALTER)\s+(?:DATABASE|SCHEMA|ROLE|EXTENSION)\b/i);
  const releases = source("../ops/releases/schema.draft.sql");
  const releasesDdl = releases.slice(releases.indexOf("CREATE TABLE deployment_release.releases ("),
    releases.indexOf("CREATE TABLE deployment_release.instance_state ("));
  assert.ok(releasesDdl.startsWith("CREATE TABLE deployment_release.releases ("));
  return { identifier, scopeSql, releasesDdl: scopeSql(releasesDdl),
    schemaDdl: schemaSource.replace(/^BEGIN;\n/, "").replace(/\nCOMMIT;\s*$/, "") };
}

function purchaseFixtureSql(scope, { identifier, scopeSql }) {
  // Reuse the five application routines while leaving the approved-cloud
  // installer, role writes, permissions and definer identity unexecuted.
  const routines = sandboxFirstPurchaseInstallStatements(scope, "x".repeat(64))
    .filter((sql) => sql.startsWith("CREATE FUNCTION sandbox_first_purchase."));
  assert.equal(routines.length, 5);
  return routines.map((sql) => scopeSql(sql).replace(
    "SECURITY DEFINER SET search_path TO pg_catalog, public, pg_temp",
    `SECURITY INVOKER SET search_path TO pg_catalog, ${identifier}, pg_temp`,
  ));
}

function controlDatabase(target, { identifier, scopeSql }) {
  return createNeonPostgresDatabase(target.raw, (connectionString) => {
    const client = neon(connectionString, { fullResults: true });
    // Neon SQL HTTP requests can use different server sessions. Establish the
    // private path in each transaction rather than inheriting a pooled setting.
    const run = async (build, options) => {
      const results = await client.transaction((tx) => [
        tx.query("SELECT pg_catalog.set_config('search_path',$1,true)", [identifier + ", pg_catalog"]),
        ...build({ query: (sql, values) => tx.query(scopeSql(sql), values) }),
      ], options);
      return results.slice(1);
    };
    return {
      query: async (sql, values) => (await run((tx) => [tx.query(sql, values)]))[0],
      transaction: run,
    };
  });
}

function safeErrorCode(error) {
  if (typeof error?.code === "string" && /^[A-Z0-9_]{4,40}$/.test(error.code)) return error.code;
  return error?.message === "T41_NEON_TEST_TARGET_SCOPE" ? error.message : null;
}

test("T4.1 Neon test target and namespace are exact before any network access", () => {
  const host = "ep-fixture-pooler.us-east-2.aws.neon.tech";
  const env = { T41_NEON_TEST_DATABASE_URL: `postgresql://fixture:synthetic-only@${host}/fixture_db?sslmode=verify-full`,
    T41_NEON_TEST_HOST: host, T41_NEON_TEST_DATABASE: "fixture_db", T41_NEON_TEST_ROLE: "fixture" };
  assert.equal(reviewedNeonTarget(env).httpsSql, "https://api.us-east-2.aws.neon.tech/sql");
  for (const change of [{ T41_NEON_TEST_HOST: "ep-other.us-east-2.aws.neon.tech" },
    { T41_NEON_TEST_DATABASE: "other_db" }, { T41_NEON_TEST_ROLE: "other_user" },
    { T41_NEON_TEST_DATABASE_URL: env.T41_NEON_TEST_DATABASE_URL + "&options=abc" },
    { T41_NEON_TEST_DATABASE_URL: env.T41_NEON_TEST_DATABASE_URL.replace("verify-full", "disable") },
    { T41_NEON_TEST_DATABASE_URL: env.T41_NEON_TEST_DATABASE_URL.replace(host, host + ".example.org") }]) {
    assert.throws(() => reviewedNeonTarget({ ...env, ...change }), /T41_NEON_TEST_TARGET_SCOPE/);
  }
  assert.throws(() => fixtureNamespace("public"));
  const namespace = fixtureNamespace("t41_neon_" + "0".repeat(32));
  const scope = { workspaceId: "wsp_" + "a".repeat(24), planId: "pln_" + "a".repeat(32),
    releaseId: "release_" + "a".repeat(32), imageUri: "402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:" + "a".repeat(64) };
  const routines = purchaseFixtureSql(scope, namespace);
  assert.equal(routines.length, 5);
  for (const sql of routines) {
    assert.ok(sql.startsWith("CREATE FUNCTION " + namespace.identifier + "."));
    assert.doesNotMatch(sql, /\b(?:public|sandbox_first_purchase|deployment_release)\.|SECURITY DEFINER/);
    assert.ok(sql.includes("SECURITY INVOKER SET search_path TO pg_catalog, " + namespace.identifier + ", pg_temp"));
  }
});

test("T4.1 Neon adapter puts the fixture path in every HTTP statement and strips the control result", async () => {
  const target = { raw: "postgresql://fixture:synthetic-only@ep-fixture.us-east-2.aws.neon.tech/neondb?sslmode=require" };
  const namespace = fixtureNamespace("t41_neon_" + "1".repeat(32));
  const previous = neonConfig.fetchFunction;
  const sent = [];
  const sqlRow = { fields: [{ name: "n", dataTypeID: 20 }], rows: [["7"]], rowCount: 1, command: "SELECT" };
  try {
    neonConfig.fetchFunction = async (url, init) => {
      assert.equal(url, "https://api.us-east-2.aws.neon.tech/sql");
      const request = JSON.parse(init.body).queries;
      sent.push(request);
      return Response.json({ results: request.map(() => sqlRow) });
    };
    const db = controlDatabase(target, namespace);
    assert.deepEqual(await db.prepare("SELECT id FROM deployment_release.releases WHERE id=?").bind("nested").first(), { n: 7 });
    const results = await db.batch([db.prepare("SELECT x FROM public.workspaces"), db.prepare("SELECT sandbox_first_purchase.read_order($1,$2)").bind("a", "b")]);
    assert.deepEqual(results.map(value => value.results), [[{ n: 7 }], [{ n: 7 }]]);
    assert.deepEqual(sent.map(queries => queries[0]), [
      { query: "SELECT pg_catalog.set_config('search_path',$1,true)", params: [namespace.identifier + ", pg_catalog"] },
      { query: "SELECT pg_catalog.set_config('search_path',$1,true)", params: [namespace.identifier + ", pg_catalog"] },
    ]);
    assert.deepEqual(sent.flatMap(queries => queries.slice(1)), [
      { query: `SELECT id FROM ${namespace.identifier}.releases WHERE id=$1`, params: ["nested"] },
      { query: `SELECT x FROM ${namespace.identifier}.workspaces`, params: [] },
      { query: `SELECT ${namespace.identifier}.read_order($1,$2)`, params: ["a", "b"] },
    ]);
  } finally {
    neonConfig.fetchFunction = previous;
  }
});

test("T4.1 existing Neon control test database: rollback, payment replay, approval, one claim and independent readback",
  { skip: process.env.T41_NEON_TEST_RUN !== "1", timeout: 180_000 }, async (t) => {
    const nonce = randomBytes(16).toString("hex");
    const schema = "t41_neon_" + nonce;
    const report = { target: null, serverVersion: null, nativeAttempts: 0, nativeSuccess: 0,
      httpsRequests: 0, httpsOk: 0, httpsRejected: 0, schema, confirmed: [],
      schemaWrite: "not_attempted", cleanup: "not_attempted", stage: "target" };
    const native = [];
    const previousFetch = neonConfig.fetchFunction;
    try {
      const target = reviewedNeonTarget(process.env);
      report.target = target.target;
      assert.ok(!process.env.PGOPTIONS && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0");
      const namespace = fixtureNamespace(schema);
      const { identifier } = namespace;
      const identify = async (client) => {
        const { rows } = await client.query(`SELECT current_database() AS database, current_user AS role,
          session_user AS login, current_setting('server_version_num') AS version`);
        const [row] = rows;
        assert.equal(rows.length, 1);
        assert.equal(row.database, target.database);
        assert.equal(row.role, target.user);
        assert.equal(row.login, target.user);
        assert.match(row.version, /^[0-9]{6}$/);
        return row.version;
      };
      const connect = async () => {
        const pgClient = new pg.Client({ host: target.host, port: 5432, database: target.database, user: target.user,
          password: target.password, ssl: { rejectUnauthorized: true, servername: target.host },
          enableChannelBinding: true, connectionTimeoutMillis: 8_000, query_timeout: 18_000,
          application_name: "techlong-t41-neon-fixture" });
        native.push(pgClient);
        ++report.nativeAttempts;
        await pgClient.connect();
        ++report.nativeSuccess;
        assert.equal(pgClient.connection.stream.authorized, true);
        return pgClient;
      };
      report.stage = "native_identity";
      const fixture = await connect();
      const version = await identify(fixture);
      report.serverVersion = `${Number(version.slice(0, 2))}.${Number(version.slice(2))}`;

      report.stage = "schema_preflight";
      const { rows: [{ can_create: canCreate, existing }] } = await fixture.query(`SELECT
        pg_catalog.has_database_privilege(current_user,current_database(),'CREATE') AS can_create,
        EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=$1) AS existing`, [schema]);
      assert.equal(canCreate, true);
      assert.equal(existing, false);
      const sourceId = nonce.slice(0, 24);
      const owner = `usr_${sourceId}`, adminA = `usr_a${sourceId}`, adminB = `usr_b${sourceId}`;
      const scope = { workspaceId: `wsp_${sourceId}`, planId: `pln_${nonce}`, releaseId: `release_${nonce}`,
        imageUri: "402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:" + "7".repeat(64) };
      const orderId = await sandboxPurchaseOrderId(scope.workspaceId);
      const routines = purchaseFixtureSql(scope, namespace);
      const [repository, manifestDigest] = scope.imageUri.split("@");
      const release = { id: scope.releaseId, productId: SANDBOX_PURCHASE_PRODUCT, component: "tenant_api", version: "t41-neon",
        status: "ecr_verified", source: { repository: "fixture.invalid", commit: "1".repeat(40), buildRunId: "1",
          buildAttempt: 1, artifactSha256: "2".repeat(64) },
        image: { repository, manifestDigest, platformDigest: manifestDigest, verificationSha256: "3".repeat(64), runtimePlatform: "linux/amd64" },
        compatibility: { databaseProfiles: ["express_iam"], schemaVersions: ["fixture-v1"], clientApiVersions: ["fixture-v1"],
          applicationPort: 3000, requiresMigration: false, startupWrites: false } };

      report.stage = "sample_setup";
      await fixture.query("BEGIN");
      report.schemaWrite = "attempted";
      await fixture.query(`CREATE SCHEMA ${identifier}`);
      await fixture.query(`REVOKE ALL ON SCHEMA ${identifier} FROM PUBLIC`);
      await fixture.query(`SET LOCAL search_path TO ${identifier}, pg_catalog`);
      await fixture.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='12s'");
      await fixture.query(namespace.schemaDdl);
      await fixture.query(namespace.releasesDdl);
      await fixture.query("CREATE TABLE fixture_identity(nonce text PRIMARY KEY)");
      await fixture.query("INSERT INTO fixture_identity VALUES ($1)", [nonce]);
      for (const [actor, role] of [[owner, 0], [adminA, 1], [adminB, 1]]) {
        await fixture.query(`INSERT INTO users(id,email,name,status,is_platform_admin,created_at,updated_at)
          VALUES ($1,$2,$1,'active',$3,1,1)`, [actor, actor + "@fixture.invalid", role]);
      }
      await fixture.query("INSERT INTO workspaces(id,name,owner_id,created_at,updated_at) VALUES ($1,'T4.1 synthetic',$2,1,1)",
        [scope.workspaceId, owner]);
      await fixture.query("INSERT INTO workspace_members(id,workspace_id,user_id,role,joined_at) VALUES ($1,$2,$3,'owner',1)",
        [`member_${nonce}`, scope.workspaceId, owner]);
      await fixture.query(`INSERT INTO plans(id,product_id,template_version_id,name,price_amount,currency,billing_interval,created_at,updated_at)
        VALUES ($1,$2,$3,'T4.1 synthetic',1500,'CAD','month',1,1)`, [scope.planId, release.productId, templateId]);
      await fixture.query(`INSERT INTO releases(id,product_id,component,version,status,document)
        VALUES ($1,$2,$3,$4,$5,$6)`, [release.id, release.productId, release.component, release.version, release.status, release]);
      for (const sql of routines) await fixture.query(sql);
      await fixture.query("COMMIT");
      report.schemaWrite = "committed";

      neonConfig.fetchFunction = async (url, init) => {
        assert.equal(String(url), target.httpsSql);
        assert.equal(init.method, "POST");
        assert.equal(new Headers(init.headers).get("Neon-Connection-String"), target.raw);
        assert.ok(report.httpsRequests < 56);
        ++report.httpsRequests;
        try {
          const answer = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(10_000) });
          if (answer.ok) ++report.httpsOk;
          else ++report.httpsRejected;
          return answer;
        } catch (error) {
          ++report.httpsRejected;
          throw error;
        }
      };
      const db = controlDatabase(target, namespace);
      const concurrent = controlDatabase(target, namespace);
      const first = async (connection, sql, args = []) => connection.prepare(sql).bind(...args).first();
      report.stage = "neon_http_identity";
      assert.deepEqual(await first(db, `SELECT nonce,current_database() AS database,current_user AS role,
        current_setting('server_version_num') AS version FROM fixture_identity WHERE nonce=$1`, [nonce]),
      { nonce, database: target.database, role: target.user, version });
      report.confirmed.push("native_and_https_share_fixture");

      report.stage = "checkout_and_batch_rollback";
      const purchaseSql = (connection) => async (sql, args) => (await first(connection, sql, args))?.value ?? null;
      const shopper = purchaseSql(db);
      const session = `cs_test_T41${nonce}`;
      const amount = 1500, currency = "CAD";
      assert.deepEqual(await shopper(SANDBOX_PURCHASE_SQL.reserve,
        [owner, scope.workspaceId, scope.planId, scope.releaseId, scope.imageUri, templateId, "{}", amount, currency]),
      { orderId, created: true });
      assert.equal(await shopper(SANDBOX_PURCHASE_SQL.attach,
        [owner, orderId, session, "https://checkout.stripe.com/sandbox/checkout/" + session, Date.now() + 3_600_000]), true);
      await assert.rejects(db.batch([
        db.prepare("UPDATE workspaces SET name=? WHERE id=?").bind("must roll back", scope.workspaceId),
        db.prepare("SELECT 1/0"),
      ]), { code: "22012" });
      assert.equal((await first(concurrent, "SELECT name FROM workspaces WHERE id=?", [scope.workspaceId])).name, "T4.1 synthetic");
      report.confirmed.push("transaction_batch_rollback");

      report.stage = "payment_rollback";
      const deliver = (connection, eventId) => {
        const payload = JSON.stringify({ id: eventId, type: "checkout.session.completed", livemode: false, data: { object: {
          id: session, livemode: false, mode: "payment", status: "complete", payment_status: "paid", payment_intent: `pi_T41${nonce}`,
          client_reference_id: orderId, metadata: { subscription_purchase_order_id: orderId }, amount_total: amount, currency: currency.toLowerCase(),
        } } });
        const signingSecret = "whsec_isolated_t41_fixture";
        const now = Math.floor(Date.now() / 1000);
        const signature = `t=${now},v1=${createHmac("sha256", signingSecret).update(`${now}.${payload}`).digest("hex")}`;
        return finishSandboxFirstCheckout({ scope, payload, signature, signingSecret, webhook: purchaseSql(connection) });
      };
      const eventId = `evt_T41${nonce}`;
      await fixture.query(`ALTER TABLE ${identifier}.deployment_jobs ADD CONSTRAINT force_fixture_payment_failure CHECK (false)`);
      await assert.rejects(deliver(db, eventId), { code: "23514", constraint: "force_fixture_payment_failure" });
      assert.deepEqual(await first(concurrent, `SELECT
        (SELECT status FROM subscription_purchase_orders WHERE id=$1) AS status,
        (SELECT count(*)::int FROM subscriptions) AS subscriptions,
        (SELECT count(*)::int FROM app_instances) AS instances,
        (SELECT count(*)::int FROM deployment_jobs) AS jobs,
        (SELECT count(*)::int FROM payment_webhook_events) AS events`, [orderId]),
      { status: "checkout_pending", subscriptions: 0, instances: 0, jobs: 0, events: 0 });
      await fixture.query(`ALTER TABLE ${identifier}.deployment_jobs DROP CONSTRAINT force_fixture_payment_failure`);
      report.confirmed.push("payment_transaction_rollback");

      report.stage = "payment_replay";
      const replay = await Promise.all([deliver(db, eventId), deliver(concurrent, eventId)]);
      assert.deepEqual(replay.sort(), ["accepted", "duplicate"]);
      assert.equal(await deliver(concurrent, `evt_T41other${nonce}`), "duplicate");
      const sample = await first(concurrent, `SELECT a.id AS "instanceId",j.id AS "jobId",j.attempts,j.available_at AS "availableAt"
        FROM app_instances a JOIN app_instance_deployments d ON d.app_instance_id=a.id
        JOIN deployment_jobs j ON j.deployment_id=d.id WHERE d.purchase_order_id=$1`, [orderId]);
      assert.equal(sample.attempts, 0);
      assert.equal(sample.availableAt, FIRST_ONBOARDING_HOLD_AT);
      report.confirmed.push("duplicate_payment_one_held_job");

      report.stage = "approval_deduplication";
      const requestOrigin = "https://admin.t41.fixture.invalid";
      const params = { params: Promise.resolve({ instanceId: sample.instanceId }) };
      const request = () => new Request(requestOrigin + "/api/admin/instances/" + sample.instanceId + "/first-open",
        { method: "POST", headers: { origin: requestOrigin } });
      const handlers = (connection, id, isPlatformAdmin) => createFirstOpenAdminHandlers({
        authorize: async () => ({ account: { user: { id, status: "active", isPlatformAdmin } }, response: null }),
        store: () => createFirstOpenAdminStore(connection),
      });
      const click = async (handler) => {
        const response = await handler.POST(request(), params);
        assert.equal(response.status, 200);
        assert.equal(response.ok, true);
        return (await response.json()).data;
      };
      const handlerA = handlers(db, adminA, true), handlerB = handlers(concurrent, adminB, true);
      assert.equal((await handlers(db, owner, false).POST(request(), params)).status, 403);
      const [a, b] = await Promise.all([click(handlerA), click(handlerB)]);
      assert.match(a.id, /^exec_[a-f0-9]{32}$/);
      assert.equal(b.id, a.id);
      assert.equal((await click(handlerA)).id, a.id);
      report.confirmed.push("instance_approval_deduplication");

      report.stage = "dispatch_race";
      const clusterArn = "arn:aws:ecs:ca-central-1:123456789012:cluster/t41-fixture";
      const taskDefinitionArn = "arn:aws:ecs:ca-central-1:123456789012:task-definition/t41-fixture:1";
      const taskArn = "arn:aws:ecs:ca-central-1:123456789012:task/t41-fixture/" + nonce;
      const placement = { clusterArn, taskDefinitionArn, containerName: "platform",
        subnetIds: ["subnet-0123456789abcdef0"], securityGroupIds: ["sg-0123456789abcdef0"] };
      let launches = 0;
      const ecs = { async runTask(input) {
        ++launches;
        assert.equal(input.count, 1);
        assert.equal(input.clientToken, a.id);
        return { tasks: [{ taskArn, clusterArn, taskDefinitionArn }], failures: [] };
      } };
      const dispatch = (connection) => dispatchEcsFirstOpen(a.id, placement, { ecs, store: createFirstOpenDispatchStore(connection) });
      const launchRace = await Promise.all([dispatch(db), dispatch(concurrent)]);
      report.launches = launches;
      report.dispatchRace = launchRace.map(result => result.status);
      assert.equal(launches, 1);
      report.stage = "dispatch_persisted_acknowledgement";
      report.repeatedDispatch = (await dispatch(concurrent)).status;
      assert.equal(report.repeatedDispatch, "acknowledged");
      assert.equal(launches, 1);
      report.confirmed.push("one_mock_launch");
      report.stage = "claim_load_approval";
      const writeBefore = Date.now() + 120_000;
      const ports = (connection) => createEcsFirstOpenTaskPorts({ db: connection, readDb: controlDatabase(target, namespace), taskArn, taskDefinitionArn, writeBefore,
        baselineDigest: "4".repeat(64), databaseSchemaVersion: "fixture-v1", dnsTarget: "test.fixture.invalid",
        management: {}, reader: {} });
      const firstTask = ports(db), secondTask = ports(concurrent);
      const approval = await firstTask.readApproval(a.id);
      assert.ok(approval);
      assert.equal(approval.executionId, a.id);
      report.stage = "claim_load_review";
      const [row, review] = await Promise.all([firstTask.readOne(SELECT_FIRST_ONBOARDING, [sample.jobId]),
        loadFirstOnboardingReview(sample.jobId, firstTask)]);
      assert.ok(row && review);
      assert.equal(review.reviewSha256, approval.reviewSha256);
      const claim = (task, digit) => task.claimApproved(approval, CLAIM_FIRST_ONBOARDING,
        firstOnboardingClaimBindings(review, row, a.id, "lease_" + digit.repeat(32), writeBefore));
      report.stage = "claim_race";
      const claimed = (await Promise.all([claim(firstTask, "a"), claim(secondTask, "b")])).filter(Boolean);
      assert.deepEqual(claimed, [{ executionId: a.id, jobId: sample.jobId }]);
      report.stage = "claim_replay";
      assert.equal(await claim(secondTask, "c"), null);
      report.confirmed.push("one_mock_launch_one_claim");

      report.stage = "fresh_readback";
      const reader = await connect();
      assert.equal(await identify(reader), version);
      await reader.query("BEGIN READ ONLY");
      await reader.query(`SET LOCAL search_path TO ${identifier}, pg_catalog`);
      const { rows } = await reader.query(`SELECT o.status AS payment,j.status AS claim,j.attempts,j.max_attempts,
        j.lease_owner,e.dispatch_task_arn,
        (SELECT count(*)::int FROM payment_webhook_events) AS webhooks,
        (SELECT count(*)::int FROM subscription_purchase_orders) AS orders,
        (SELECT count(*)::int FROM deployment_jobs) AS jobs,
        (SELECT count(*)::int FROM first_open_executions) AS executions,
        (SELECT count(*)::int FROM first_open_execution_events WHERE step='approval') AS approvals,
        (SELECT count(*)::int FROM first_open_execution_events WHERE step='task_start') AS launches,
        (SELECT count(*)::int FROM fixture_identity WHERE nonce=$2) AS nonce_matches,
        current_setting('transaction_read_only') AS readonly
        FROM subscription_purchase_orders o
        JOIN app_instance_deployments d ON d.purchase_order_id=o.id
        JOIN deployment_jobs j ON j.deployment_id=d.id
        JOIN first_open_executions e ON e.job_id=j.id WHERE o.id=$1`, [orderId, nonce]);
      assert.deepEqual(rows, [{ payment: "paid", claim: "running", attempts: 1, max_attempts: 1, lease_owner: a.id,
        dispatch_task_arn: taskArn, webhooks: 1, orders: 1, jobs: 1, executions: 1, approvals: 1, launches: 2, nonce_matches: 1, readonly: "on" }]);
      await reader.query("COMMIT");
      report.confirmed.push("fresh_tls_connection_readback");

      report.stage = "cleanup";
      const { rows: [marker] } = await fixture.query(`SELECT n.nspowner=CAST(current_user AS regrole) AS owned,
        (SELECT count(*)::int FROM ${identifier}.fixture_identity WHERE nonce=$2) AS proof
        FROM pg_catalog.pg_namespace n WHERE n.nspname=$1`, [schema, nonce]);
      assert.deepEqual(marker, { owned: true, proof: 1 });
      report.cleanup = "attempted";
      await fixture.query(`DROP SCHEMA ${identifier} CASCADE`);
      const { rows: [cleanup] } = await fixture.query(
        "SELECT NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=$1) AS absent", [schema]);
      assert.equal(cleanup.absent, true);
      report.cleanup = "confirmed";
      report.stage = "completed";
    } catch (error) {
      report.errorCode = safeErrorCode(error);
      // Failed and ambiguous attempts retain the isolated schema if it committed.
      // The report excludes provider text and assertion values, including DSNs.
      throw Error(`T41_NEON_TEST_STOP ${report.stage}${report.errorCode ? " " + report.errorCode : ""}`);
    } finally {
      neonConfig.fetchFunction = previousFetch;
      await Promise.allSettled(native.map(client => client.end()));
      t.diagnostic(JSON.stringify(report));
    }
  });
