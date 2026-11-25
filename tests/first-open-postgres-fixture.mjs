import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { createNeonPostgresDatabase } from "../db/postgres-neon.ts";
import {
  buildFirstOnboardingJob, firstOnboardingInsertBindings, INSERT_FIRST_ONBOARDING,
} from "../lib/deployments/first-onboarding.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const loopback = "127.0.0.1";
const role = "first_open_fixture";

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

async function withDisposablePostgres(pgBin, check) {
  assert.ok(path.isAbsolute(pgBin));
  const binaries = await realpath(pgBin);
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(parent, "techlong-first-open-pg-"));
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
        host: loopback, port, user: role, database: "postgres", password: "synthetic-fixture-only", ssl: false,
        connectionTimeoutMillis: 5000, statement_timeout: 7000, application_name: "techlong-first-open-fixture",
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
    assert.match(path.basename(resolved), /^techlong-first-open-pg-/);
    await rm(resolved, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
  }
}

function postgresTransport(client) {
  const query = (text, parameters) => client.query(text, parameters);
  return {
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
  };
}

function applicationDb(client) {
  return createNeonPostgresDatabase("local-fixture-transport", () => postgresTransport(client));
}

const productId = "prd_restaurant_order_system";
const configuredReleaseId = `release_${"a".repeat(32)}`;
const adminA = { id: "usr_t2_admin_a", status: "active", isPlatformAdmin: true };
const adminB = { id: "usr_t2_admin_b", status: "active", isPlatformAdmin: true };
const ownerA = { id: "usr_t2_owner_a", status: "active", isPlatformAdmin: false };
const ownerB = { id: "usr_t2_owner_b", status: "active", isPlatformAdmin: false };

async function seedDatabase(db, target) {
  let schema = read("../db/postgres-schema.sql").replaceAll("\r\n", "\n");
  const migrations = readdirSync(new URL("../db/postgres-migrations/", import.meta.url))
    .filter(name => /^001[1-3]_/.test(name)).sort()
    .map(file => read(`../db/postgres-migrations/${file}`).replaceAll("\r\n", "\n").trim());
  for (const sql of migrations) {
    assert.equal(schema.split(sql).length, 2, "baseline contains the exact first-open migration");
    schema = schema.replace(sql, "");
  }
  await db.query(schema);
  // Use the release table definitions on this disposable server. The draft role and installer statements remain separate.
  const releaseDdl = read("../ops/releases/schema.draft.sql");
  const catalog = releaseDdl.slice(releaseDdl.indexOf("CREATE TABLE deployment_release.releases ("),
    releaseDdl.indexOf("CREATE TABLE deployment_release.requests ("));
  assert.ok(catalog.startsWith("CREATE TABLE deployment_release.releases ("));
  assert.match(catalog, /CREATE TABLE deployment_release\.instance_state/);
  await db.query("CREATE SCHEMA deployment_release;" + catalog);
  const now = Date.now();
  for (const user of [adminA, adminB, ownerA, ownerB]) {
    await db.query(`INSERT INTO users(id,email,name,status,is_platform_admin,created_at,updated_at)
      VALUES ($1,$2,$1,'active',$3,$4,$4)`, [user.id, `${user.id}@fixture.invalid`, Number(user.isPlatformAdmin), now]);
  }
  const templateVersionId = "tplver_restaurant_standard_v1";
  const planId = target?.row.planId ?? "plan_t2_fixture";
  const environmentId = "env_aws_sandbox_ca_central_1";
  const { rows: [{ expected_account_id: accountId }] } = await db.query(
    "SELECT expected_account_id FROM deployment_environments WHERE id=$1", [environmentId],
  );
  await db.query(`INSERT INTO plans(id,product_id,template_version_id,name,price_amount,currency,billing_interval,created_at,updated_at)
    VALUES ($1,$2,$3,'T2 fixture',1800,'CAD','month',$4,$4)`, [planId, productId, templateVersionId, now]);
  const repository = `${accountId}.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast`;
  const manifestDigest = `sha256:${"b".repeat(64)}`;
  const release = target?.release ?? {
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
    const exact = label === "a" ? target?.row : undefined;
    const appInstanceId = exact?.appInstanceId ?? `app_t2_${label}`;
    const workspaceId = exact?.workspaceId ?? `wsp_t2_${label}`;
    const subscriptionId = exact?.subscriptionId ?? `sub_t2_${label}`;
    const purchaseOrderId = `ord_t2_${label}`, paymentId = `pay_t2_${label}`, providerPaymentId = `pi_t2_fixture_${label}`;
    const tenantKey = exact?.tenantKey ?? `tenant_t2_${label}`;
    const configuration = exact?.configuration ?? { storeName: `Fixture ${label}` };
    const desiredPlan = exact?.desiredPlan ?? { mode: "aws_sandbox" };
    const paidAt = now - 2000;
    await db.query(`INSERT INTO workspaces(id,name,owner_id,created_at,updated_at) VALUES ($1,$1,$2,$3,$3)`, [workspaceId, actor.id, now]);
    await db.query(`INSERT INTO subscriptions(id,workspace_id,product_id,plan_id,template_version_id,status,
      current_period_start,current_period_end,instance_configuration,creation_source,created_by_user_id,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8,'payment_success',$9,$6,$6)`, [subscriptionId, workspaceId, productId,
      planId, templateVersionId, paidAt, now + 3600_000, JSON.stringify(configuration), actor.id]);
    await db.query(`INSERT INTO app_instances(id,workspace_id,product_id,subscription_id,template_version_id,configuration_snapshot,
      name,slug,access_url,tenant_key,provisioning_source,status,created_by_user_id,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$1,$7,'',$8,'payment_success','pending',$9,$10,$10)`, [appInstanceId, workspaceId, productId,
      subscriptionId, templateVersionId, JSON.stringify(configuration), exact?.slug ?? `t2-instance-${label}`, tenantKey, actor.id, now]);
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
      releaseId: release.id, artifactRef: `${release.image.repository}@${release.image.manifestDigest}`, accountId });
    assert.ok(job);
    assert.equal((await db.query(INSERT_FIRST_ONBOARDING, firstOnboardingInsertBindings(job, {
      configuration: JSON.stringify(configuration), desiredPlan: JSON.stringify(desiredPlan), purchaseOrderId,
    }))).rows[0].id, job.jobId);
    instances.push({ id: appInstanceId, purchaseOrderId, paymentId, ...job });
  }
  for (const sql of migrations) await db.query(sql);
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


export { adminA, adminB, ownerA, configuredReleaseId, origin, withDisposablePostgres, applicationDb,
  postgresTransport, seedDatabase, endpoint, params, approveRequest, bodyOf, snapshot };
