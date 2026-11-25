import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import pg from "pg";

const sourceNonce = "b7400f56b97e406b85f0af60791a09b6";
const sourceSchema = "t41_neon_" + sourceNonce;
const sourceIdentifier = '"' + sourceSchema + '"';
const targetSha256 = "1c6495766571bf1dc65a47ccab7ec6006ed7c74c59a2966de58699d0f601c4d2";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function reviewedTarget(env, expectedSha256 = targetSha256) {
  try {
    const { T41_NEON_TEST_DATABASE_URL: raw, T41_NEON_TEST_HOST: host,
      T41_NEON_TEST_DATABASE: database, T41_NEON_TEST_ROLE: user } = env;
    const url = new URL(raw);
    const target = sha256([host, database, user].join("\0"));
    const token = decodeURIComponent(url.password);
    if (target !== expectedSha256 || env.PGOPTIONS || env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
        url.protocol !== "postgresql:" || raw.trim() !== raw || url.hash || (url.port && url.port !== "5432") ||
        !/^ep-[a-z0-9-]+(?:\.[a-z0-9-]+){1,4}\.(?:aws|azure)\.neon\.tech$/.test(host) ||
        !/^[a-zA-Z0-9_-]{1,63}$/.test(database) || !/^[a-zA-Z0-9_-]{1,63}$/.test(user) ||
        url.hostname !== host || decodeURIComponent(url.pathname) !== "/" + database ||
        decodeURIComponent(url.username) !== user || !token ||
        !["require", "verify-full"].includes(url.searchParams.get("sslmode")) ||
        [...url.searchParams].some(([key, value]) => (key !== "sslmode" && (key !== "channel_binding" || value !== "require")) ||
          url.searchParams.getAll(key).length !== 1)) throw Error();
    return { target, host, database, user, password: token };
  } catch {
    throw Error("T41_CONTROL_MIGRATION_TARGET");
  }
}

const tables = [
  ["webhook", "payment_webhook_events", "id", "id, provider, provider_event_id, purchase_order_id, processing_status"],
  ["order", "subscription_purchase_orders", "id", "id, workspace_id, subscription_id, payment_record_id, amount, currency, status"],
  ["payment", "payment_records", "id", "id, workspace_id, subscription_id, amount, currency, status"],
  ["instance", "app_instances", "id", "id, workspace_id, subscription_id, status"],
  ["deployment", "app_instance_deployments", "id", "id, app_instance_id, subscription_id, purchase_order_id, status"],
  ["job", "deployment_jobs", "id",
    "id, deployment_id, status, attempts, max_attempts, available_at::text, lease_owner, lease_expires_at::text"],
  ["execution", "first_open_executions", "id",
    "id, instance_id, job_id, deployment_id, purchase_order_id, release_id, approved_at::text, dispatch_token, dispatch_started_at::text, dispatch_outcome, dispatch_task_arn"],
  ["event", "first_open_execution_events", "sequence::text", "execution_id, sequence, step, status, at::text"],
];

const sourceProofSql = `SELECT n.nspowner=current_user::regrole AS owned,
  NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner)))
    WHERE grantee = 0) AS private,
  (SELECT count(*)::int FROM pg_catalog.pg_class WHERE relnamespace=n.oid AND relname=ANY($2::text[])
    AND relkind='r' AND relowner=n.nspowner) AS ordinary_relations,
  (SELECT count(*)::int FROM (SELECT nonce FROM ${sourceIdentifier}.fixture_identity LIMIT 2) AS claims WHERE nonce=$1) AS nonce_matches,
  (SELECT count(*)::int FROM (SELECT nonce FROM ${sourceIdentifier}.fixture_identity LIMIT 2) AS identities) AS identities
  FROM pg_catalog.pg_namespace n WHERE n.nspname=$3`;

// Fixed source relations and projected columns. Query caps detect fixture drift
// without ever exporting provider payloads, checkout URLs, or credentials.
const exportSql = tables.map(([kind, table, key, fields]) =>
  `SELECT '${kind}' AS kind, ${key} AS key, to_jsonb(record) AS value FROM
    (SELECT ${fields} FROM ${sourceIdentifier}.${table} ORDER BY ${kind === "event" ? "sequence" : "id"}
      LIMIT ${kind === "event" ? 4 : 2}) AS record`).join("\nUNION ALL\n") + "\nORDER BY kind, key";
const sourceRelations = ["fixture_identity", ...tables.map(([, table]) => table)];

function serialize(rows) {
  return JSON.stringify(rows, (_, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
}

function validateSnapshot(rows) {
  assert.equal(rows.length, 10);
  const records = Object.groupBy(rows, (record) => record.kind);
  const kinds = tables.map(([kind]) => kind);
  assert.deepEqual(Object.keys(records).sort(), kinds.sort());
  for (const kind of kinds) {
    assert.equal(records[kind].length, kind === "event" ? 3 : 1);
    for (const { key, value } of records[kind]) {
      assert.equal(key, kind === "event" ? String(value.sequence) : value.id);
    }
  }
  const { webhook: [webhook], order: [order], payment: [payment], instance: [instance],
    deployment: [deployment], job: [job], execution: [execution], event: events } = Object.fromEntries(
    Object.entries(records).map(([kind, group]) => [kind, group.map(row => row.value)]));
  assert.equal(webhook.provider_event_id, "evt_T41" + sourceNonce);
  assert.equal(webhook.purchase_order_id, order.id);
  assert.equal(order.workspace_id, "wsp_" + sourceNonce.slice(0, 24));
  assert.equal(order.status, "paid");
  assert.equal(order.payment_record_id, payment.id);
  assert.equal(order.workspace_id, payment.workspace_id);
  assert.equal(order.workspace_id, instance.workspace_id);
  assert.ok(order.subscription_id);
  assert.equal(order.subscription_id, instance.subscription_id);
  assert.equal(order.subscription_id, payment.subscription_id);
  assert.equal(order.subscription_id, deployment.subscription_id);
  assert.equal(order.amount, payment.amount);
  assert.equal(order.currency, payment.currency);
  assert.equal(deployment.purchase_order_id, order.id);
  assert.equal(deployment.app_instance_id, instance.id);
  assert.equal(job.deployment_id, deployment.id);
  assert.deepEqual([job.status, job.attempts, job.max_attempts, job.lease_owner, job.lease_expires_at], ["pending", 0, 1, null, null]);
  assert.equal(execution.purchase_order_id, order.id);
  assert.equal(execution.instance_id, instance.id);
  assert.equal(execution.deployment_id, deployment.id);
  assert.equal(execution.job_id, job.id);
  assert.equal(execution.release_id, "release_" + sourceNonce);
  assert.equal(execution.dispatch_token, execution.id);
  assert.equal(execution.dispatch_outcome, "acknowledged");
  assert.match(execution.dispatch_task_arn, new RegExp("^arn:aws:ecs:ca-central-1:123456789012:task/t41-fixture/" + sourceNonce + "$"));
  assert.equal(events.every(event => event.execution_id === execution.id), true);
  assert.deepEqual(events.map(event => [event.sequence, event.step, event.status]), [
    [1, "approval", "completed"], [2, "task_start", "started"], [3, "task_start", "completed"],
  ]);
}

function restoreIdentifier(nonce) {
  assert.match(nonce, /^[a-f0-9]{32}$/);
  return 'pg_temp."t41_control_' + nonce + '"';
}

test("T4.1 Neon migration guard pins the source scope and temp-table destination", () => {
  const host = "ep-fixture-pooler.us-east-2.aws.neon.tech";
  const env = { T41_NEON_TEST_HOST: host, T41_NEON_TEST_DATABASE: "fixture", T41_NEON_TEST_ROLE: "tester",
    T41_NEON_TEST_DATABASE_URL: "postgresql://tester:not-real@" + host + "/fixture?sslmode=require" };
  const hash = sha256([host, "fixture", "tester"].join("\0"));
  assert.throws(() => reviewedTarget(env), /T41_CONTROL_MIGRATION_TARGET/);
  assert.equal(reviewedTarget(env, hash).target, hash);
  for (const input of [{ T41_NEON_TEST_DATABASE: "other" }, { PGOPTIONS: "-c search_path=public" },
    { T41_NEON_TEST_DATABASE_URL: env.T41_NEON_TEST_DATABASE_URL + "&hostaddr=127.0.0.1" }]) {
    assert.throws(() => reviewedTarget({ ...env, ...input }, hash), /T41_CONTROL_MIGRATION_TARGET/);
  }
  assert.match(exportSql, /^SELECT/);
  assert.doesNotMatch(exportSql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP|CREATE|COPY)\b|\bpublic\.|checkout_url|payload|lease_token/);
  assert.equal(exportSql.split(sourceIdentifier).length - 1, tables.length);
  assert.equal(restoreIdentifier("f".repeat(32)), 'pg_temp."t41_control_' + "f".repeat(32) + '"');
  assert.throws(() => restoreIdentifier('public."orders"'));
  assert.equal(serialize([{ z: { b: 2, a: 1 }, a: null }]), '[{"a":null,"z":{"a":1,"b":2}}]');
});

test("T4.1 existing Neon control test database: export, transactional restore, reconciliation and rollback",
  { skip: process.env.T41_NEON_MIGRATION_RUN !== "1", timeout: 70000 }, async (t) => {
    const report = { target: null, sourceSchema, version: null, versionNum: null, attempts: 0, connected: 0,
      catalogSelects: 0, sourceProjectionSelects: 0, tempTableCreates: 0, tempInserts: 0,
      tempRestoreSelects: 0, deliberateFailure: null, partialWriteRolledBack: false, tempCleanup: false,
      sourceUnchanged: false, persistentWrites: 0, exportRows: 0, exportBytes: 0, exportSha256: null,
      stage: "target" };
    const clients = [];
    let reader, restorer;
    try {
      const target = reviewedTarget(process.env);
      report.target = target.target;
      const connect = async () => {
        const client = new pg.Client({ host: target.host, port: 5432, user: target.user, database: target.database,
          password: target.password, ssl: { rejectUnauthorized: true, servername: target.host },
          enableChannelBinding: true, connectionTimeoutMillis: 8000, query_timeout: 22000,
          application_name: "techlong-t41-control-migration" });
        clients.push(client);
        report.attempts++;
        await client.connect();
        report.connected++;
        assert.equal(client.connection.stream.authorized, true);
        return client;
      };
      const begin = async (client, flags, readOnly) => {
        await client.query("BEGIN " + flags);
        await client.query("SET LOCAL search_path=pg_catalog; SET LOCAL statement_timeout='12s'; SET LOCAL lock_timeout='3s'");
        report.catalogSelects++;
        const { rows: [row] } = await client.query(`SELECT current_database() AS database, current_user AS user,
          session_user AS login, current_setting('server_version') AS version,
          current_setting('server_version_num')::integer AS version_num,
          current_setting('transaction_read_only') AS read_only, pg_catalog.pg_is_in_recovery() AS in_recovery`);
        assert.equal(row.database, target.database);
        assert.equal(row.user, target.user);
        assert.equal(row.login, target.user);
        assert.equal(row.version_num, 180007);
        assert.equal(row.read_only, readOnly ? "on" : "off");
        assert.equal(row.in_recovery, false);
        report.version = row.version;
        report.versionNum = row.version_num;
      };
      const read = async (client) => {
        report.catalogSelects++;
        const { rows } = await client.query(sourceProofSql, [sourceNonce, sourceRelations, sourceSchema]);
        assert.deepEqual(rows, [{ owned: true, private: true, ordinary_relations: sourceRelations.length, nonce_matches: 1, identities: 1 }]);
        report.sourceProjectionSelects++;
        const { rows: records } = await client.query(exportSql);
        validateSnapshot(records);
        return serialize(records);
      };

      report.stage = "source_export";
      reader = await connect();
      await begin(reader, "ISOLATION LEVEL REPEATABLE READ READ ONLY", true);
      const exportData = await read(reader);
      report.exportBytes = Buffer.byteLength(exportData);
      assert.ok(report.exportBytes > 0 && report.exportBytes <= 16384);
      report.exportRows = JSON.parse(exportData).length;
      report.exportSha256 = sha256(exportData);
      await reader.query("COMMIT");

      report.stage = "restore_target";
      restorer = await connect();
      await begin(restorer, "READ WRITE", false);
      report.catalogSelects++;
      const { rows: [{ can_temp: canTemp, event_triggers: eventTriggers }] } = await restorer.query(`SELECT
        pg_catalog.has_database_privilege(current_user, current_database(), 'TEMP') AS can_temp,
        (SELECT count(*)::int FROM pg_catalog.pg_event_trigger WHERE evtenabled<>'D') AS event_triggers`);
      assert.equal(canTemp, true);
      assert.equal(eventTriggers, 0);
      const destination = restoreIdentifier(randomBytes(16).toString("hex"));
      report.tempTableCreates++;
      await restorer.query(`CREATE TEMP TABLE ${destination} (
        kind text NOT NULL, key text NOT NULL, value jsonb NOT NULL CHECK (jsonb_typeof(value)='object'),
        PRIMARY KEY (kind,key)) ON COMMIT DROP`);
      const insert = async (data) => {
        report.tempInserts++;
        return restorer.query(`INSERT INTO ${destination}(kind,key,value)
          SELECT kind,key,value FROM pg_catalog.jsonb_to_recordset($1::jsonb) AS item(kind text,key text,value jsonb)`, [data]);
      };
      report.stage = "failed_restore";
      await restorer.query("SAVEPOINT t41_partial_restore");
      const singleRecord = JSON.stringify(JSON.parse(exportData).slice(0, 1));
      assert.equal((await insert(singleRecord)).rowCount, 1);
      await assert.rejects(insert(singleRecord), { code: "23505" });
      report.deliberateFailure = "23505";
      await restorer.query("ROLLBACK TO SAVEPOINT t41_partial_restore");
      report.tempRestoreSelects++;
      assert.equal((await restorer.query("SELECT count(*)::int AS count FROM " + destination)).rows[0].count, 0);
      report.partialWriteRolledBack = true;
      await restorer.query("RELEASE SAVEPOINT t41_partial_restore");

      report.stage = "restore_reconciliation";
      assert.equal((await insert(exportData)).rowCount, report.exportRows);
      report.tempRestoreSelects++;
      const { rows: restored } = await restorer.query("SELECT kind,key,value FROM " + destination + " ORDER BY kind,key");
      validateSnapshot(restored);
      assert.equal(serialize(restored), exportData);
      assert.equal(sha256(serialize(restored)), report.exportSha256);
      await restorer.query("ROLLBACK");
      report.catalogSelects++;
      assert.equal((await restorer.query("SELECT pg_catalog.to_regclass($1) IS NULL AS absent", [destination])).rows[0].absent, true);
      report.tempCleanup = true;

      report.stage = "source_readback";
      await begin(reader, "ISOLATION LEVEL REPEATABLE READ READ ONLY", true);
      assert.equal(await read(reader), exportData);
      await reader.query("COMMIT");
      report.sourceUnchanged = true;
      report.stage = "completed";
    } catch (error) {
      report.errorCode = typeof error?.code === "string" && /^[A-Z0-9_]{4,40}$/.test(error.code) ? error.code : null;
      throw Error("T41_CONTROL_MIGRATION_STOP " + report.stage + (report.errorCode ? " " + report.errorCode : ""));
    } finally {
      await Promise.allSettled(clients.map(client => client.end()));
      t.diagnostic(JSON.stringify(report));
    }
  });
