import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import pg from "pg";

const DATABASE = "SpeedFeastMain";
const SCHEMA = "test";
const orderId = "f523599b-2abf-489f-a367-5c1e83a58d04";
const itemId = "1f38fc5c-d714-4900-9459-79ea61b3f90f";
const rolledBackId = "7d70c03b-aab6-4e98-867d-dc589700bc7d";
const archiveSha = (data) => createHash("sha256").update(data).digest("hex");

function exactTarget(env) {
  const { T41_TENANT_TEST_HOST: host, T41_TENANT_TEST_PORT: port, T41_TENANT_TEST_DATABASE: database,
    T41_TENANT_TEST_ROLE: user, T41_TENANT_TEST_PASSWORD: password, T41_TENANT_TEST_SCHEMA_OID: oid } = env;
  if (host !== "localhost" || port !== "5432" || database !== DATABASE ||
      !/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(user ?? "") || !password ||
      (oid !== undefined && !validOid(oid)) || env.PGOPTIONS || env.PGSERVICE) {
    throw Error("T41_TENANT_MIGRATION_TARGET");
  }
  return { host, port: Number(port), database, user, password, oid };
}

function validOid(oid) {
  return typeof oid === "string" && /^[1-9][0-9]{0,9}$/.test(oid) && Number(oid) <= 4_294_967_295;
}

function relations(nonce) {
  assert.match(nonce, /^[a-f0-9]{24}$/);
  const base = `"${SCHEMA}"."t41_${nonce}`;
  return { source: { orders: `${base}_source_orders"`, items: `${base}_source_items"` },
    target: { orders: `${base}_target_orders"`, items: `${base}_target_items"` } };
}

const catalogueSql = `SELECT current_database() AS database,current_user AS role,session_user AS login,
  host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('server_version') AS version,
  current_setting('transaction_read_only') AS read_only,
  n.oid::text AS oid,n.nspowner::regrole::text AS owner,
  EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
    WHERE a.grantee<>n.nspowner AND a.privilege_type='CREATE') AS non_owner_create,
  (SELECT count(*)::int FROM pg_catalog.pg_event_trigger WHERE evtenabled<>'D') AS event_triggers,
  (SELECT count(*)::int FROM pg_catalog.pg_depend d WHERE d.refclassid='pg_catalog.pg_namespace'::regclass
    AND d.refobjid=n.oid) AS objects,
  (SELECT count(*)::int FROM pg_catalog.pg_class c WHERE c.relnamespace=n.oid) AS relations
  FROM pg_catalog.pg_namespace n WHERE n.nspname=$1`;

function assertScope(row, target, readOnly) {
  if (!row || row.database !== target.database || row.role !== target.user || row.login !== target.user ||
      !["127.0.0.1", "::1"].includes(row.address) || row.port !== target.port ||
      !/^15\.3(?:\s|$)/.test(row.version) || row.read_only !== readOnly || !validOid(row.oid) ||
      (target.oid !== undefined && row.oid !== target.oid) || row.owner !== target.user ||
      row.non_owner_create !== false || row.event_triggers !== 0 || row.objects !== 0 || row.relations !== 0) {
    throw Error("T41_TENANT_MIGRATION_SCHEMA_SCOPE");
  }
}

function assertArchive(archive, digest) {
  if (typeof archive !== "string" || archive.length > 16_000 || archiveSha(archive) !== digest) {
    throw Error("T41_TENANT_MIGRATION_ARCHIVE");
  }
}

function ddl({ orders, items }) {
  return [`CREATE TABLE ${orders} (id uuid PRIMARY KEY, status text NOT NULL CHECK (status IN ('paid','pending')),
    amount_minor bigint NOT NULL CHECK (amount_minor >= 0),currency text NOT NULL CHECK (length(currency)=3))`,
  `CREATE TABLE ${items} (id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES ${orders}(id),
    quantity integer NOT NULL CHECK (quantity > 0),unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0))`];
}

async function exportArchive(client, { orders, items }) {
  const { rows: [row] } = await client.query(`SELECT jsonb_build_object(
    'orders', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'amount_minor',amount_minor::text,
      'currency',currency) ORDER BY id),'[]'::jsonb) FROM ${orders}),
    'items', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'order_id',order_id,'quantity',quantity,
      'unit_price_minor',unit_price_minor::text) ORDER BY id),'[]'::jsonb) FROM ${items}))::text AS archive`);
  return row.archive;
}

async function restoreArchive(client, { orders, items }, data, digest) {
  assertArchive(data, digest);
  await client.query(`INSERT INTO ${orders} (id,status,amount_minor,currency)
    SELECT id,status,amount_minor::bigint,currency FROM jsonb_to_recordset($1::jsonb->'orders')
      AS x(id uuid,status text,amount_minor text,currency text)`, [data]);
  await client.query(`INSERT INTO ${items} (id,order_id,quantity,unit_price_minor)
    SELECT id,order_id,quantity,unit_price_minor::bigint FROM jsonb_to_recordset($1::jsonb->'items')
      AS x(id uuid,order_id uuid,quantity integer,unit_price_minor text)`, [data]);
}

test("T4.1 tenant rehearsal rejects target, scope and archive drift before writes", () => {
  const env = { T41_TENANT_TEST_HOST: "localhost", T41_TENANT_TEST_PORT: "5432", T41_TENANT_TEST_DATABASE: DATABASE,
    T41_TENANT_TEST_ROLE: "fixture_owner", T41_TENANT_TEST_PASSWORD: "synthetic", T41_TENANT_TEST_SCHEMA_OID: "42000" };
  const target = exactTarget(env);
  for (const wrong of [{ T41_TENANT_TEST_HOST: "db.rds.example" }, { T41_TENANT_TEST_HOST: "127.0.0.1" },
    { T41_TENANT_TEST_PORT: "5433" },
    { T41_TENANT_TEST_DATABASE: "speedfeastmain" }, { T41_TENANT_TEST_ROLE: "wrong\"role" },
    { T41_TENANT_TEST_SCHEMA_OID: "0" }, { PGOPTIONS: "-c search_path=public" }]) {
    assert.throws(() => exactTarget({ ...env, ...wrong }), /T41_TENANT_MIGRATION_TARGET/);
  }
  const scope = { database: DATABASE, role: target.user, login: target.user, address: "127.0.0.1", port: 5432,
    version: "15.3", read_only: "off", oid: "42000", owner: target.user,
    non_owner_create: false, event_triggers: 0, objects: 0, relations: 0 };
  assert.doesNotThrow(() => assertScope(scope, target, "off"));
  assert.doesNotThrow(() => assertScope(scope, { ...target, oid: undefined }, "off"));
  for (const wrong of [{ owner: "other" }, { oid: "42001" }, { non_owner_create: true }, { event_triggers: 1 }, { objects: 1 },
    { relations: 1 }, { version: "16.14" }, { address: "10.0.0.1" }]) {
    assert.throws(() => assertScope({ ...scope, ...wrong }, target, "off"), /T41_TENANT_MIGRATION_SCHEMA_SCOPE/);
  }
  assert.throws(() => relations("public"));
  for (const names of Object.values(relations("a".repeat(24)))) {
    assert.match(names.orders, /^"test"\."t41_[a-f0-9]{24}_(?:source|target)_orders"$/);
    assert.match(names.items, /^"test"\."t41_[a-f0-9]{24}_(?:source|target)_items"$/);
    assert.ok(ddl(names).every((sql) => !sql.includes("public.")));
  }
  assert.throws(() => assertArchive("changed", archiveSha("synthetic")), /T41_TENANT_MIGRATION_ARCHIVE/);
});

test("T4.1 tenant isolated schema export, restore, reconciliation and rollback",
  { skip: process.env.T41_TENANT_TEST_RUN !== "1", timeout: 60_000 }, async (t) => {
    const report = { database: DATABASE, schema: SCHEMA, attempts: 0, successes: 0, version: null,
      archiveSha256: null, stage: "target", counts: null, failureSqlstate: null, outerRollback: false, cleanReadback: false,
      sql: Object.fromEntries(["catalogue", "fixtureReads", "fixtureWrites", "transaction"].map(
        (category) => [category, { attempts: 0, acknowledgements: 0 }])) };
    const clients = [];
    try {
      const target = exactTarget(process.env);
      const named = relations(randomBytes(12).toString("hex"));
      const connect = async () => {
        const { host, port, database, user, password } = target;
        const client = new pg.Client({ host, port, database, user, password, ssl: false,
          application_name: "techlong-t41-tenant-rehearsal", connectionTimeoutMillis: 5_000 });
        clients.push(client);
        report.attempts++;
        await client.connect();
        report.successes++;
        return { async query(sql, values) {
          const category = sql === catalogueSql ? "catalogue" :
            /^(?:CREATE TABLE|INSERT INTO) "test"\."t41_/.test(sql) ? "fixtureWrites" :
              /^SELECT (?:jsonb_build_object|count\(\*\)=1)/.test(sql) ? "fixtureReads" : "transaction";
          report.sql[category].attempts++;
          const result = await client.query(sql, values);
          report.sql[category].acknowledgements++;
          return result;
        } };
      };
      report.stage = "scope";
      const worker = await connect();
      await worker.query("BEGIN");
      await worker.query("SET LOCAL search_path=pg_catalog; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='10s'");
      const { rows: [before] } = await worker.query(catalogueSql, [SCHEMA]);
      assertScope(before, target, "off");
      const boundTarget = { ...target, oid: before.oid };
      report.version = before.version;
      const { rows: [{ locked }] } = await worker.query("SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended($1,0)) AS locked",
        [`t41-tenant-migration/${DATABASE}/${SCHEMA}/${boundTarget.oid}`]);
      assert.equal(locked, true);
      const { rows: [ready] } = await worker.query(catalogueSql, [SCHEMA]);
      assertScope(ready, boundTarget, "off");

      report.stage = "export";
      for (const sql of ddl(named.source)) await worker.query(sql);
      await worker.query(`INSERT INTO ${named.source.orders} VALUES ($1,'paid',$2,'CAD')`, [orderId, "9007199254740992"]);
      await worker.query(`INSERT INTO ${named.source.items} VALUES ($1,$2,2,$3)`, [itemId, orderId, "4503599627370496"]);
      const archive = await exportArchive(worker, named.source);
      report.archiveSha256 = archiveSha(archive);
      const rows = JSON.parse(archive);
      assert.deepEqual(rows.orders, [{ id: orderId, status: "paid", amount_minor: "9007199254740992", currency: "CAD" }]);
      assert.deepEqual(rows.items, [{ id: itemId, order_id: orderId, quantity: 2, unit_price_minor: "4503599627370496" }]);
      report.counts = { orders: rows.orders.length, items: rows.items.length };

      report.stage = "restore_reconcile";
      for (const sql of ddl(named.target)) await worker.query(sql);
      await restoreArchive(worker, named.target, archive, report.archiveSha256);
      assert.equal(await exportArchive(worker, named.target), archive);
      const { rows: [{ balanced }] } = await worker.query(`SELECT count(*)=1 AND bool_and(total=amount_minor) AS balanced
        FROM (SELECT o.amount_minor, sum(i.quantity*i.unit_price_minor) AS total FROM ${named.target.orders} o
          JOIN ${named.target.items} i ON i.order_id=o.id GROUP BY o.id) AS totals`);
      assert.equal(balanced, true);

      report.stage = "failed_import_rollback";
      await worker.query("SAVEPOINT import_failure");
      await worker.query(`INSERT INTO ${named.target.orders} VALUES ($1,'pending',0,'CAD')`, [rolledBackId]);
      await assert.rejects(worker.query(`INSERT INTO ${named.target.orders} VALUES ($1,'pending',0,'CAD')`, [orderId]),
        (error) => { report.failureSqlstate = error.code; return error.code === "23505"; });
      await worker.query("ROLLBACK TO SAVEPOINT import_failure");
      assert.equal(await exportArchive(worker, named.target), archive);
      assert.equal(await exportArchive(worker, named.source), archive);
      report.stage = "outer_rollback";
      await worker.query("ROLLBACK");
      report.outerRollback = true;

      report.stage = "independent_readback";
      const reader = await connect();
      await reader.query("BEGIN READ ONLY");
      await reader.query("SET LOCAL search_path=pg_catalog; SET LOCAL statement_timeout='10s'");
      const { rows: [after] } = await reader.query(catalogueSql, [SCHEMA]);
      assertScope(after, boundTarget, "on");
      await reader.query("ROLLBACK");
      report.cleanReadback = true;
      report.stage = "complete";
    } catch (error) {
      const code = typeof error?.code === "string" && /^[A-Z0-9_]{4,40}$/.test(error.code) ? error.code :
        /^T41_TENANT_MIGRATION_[A-Z_]+$/.test(error?.message ?? "") ? error.message : null;
      report.errorCode = code;
      throw Error(`T41_TENANT_MIGRATION_STOP ${report.stage}${code ? ` ${code}` : ""}`);
    } finally {
      await Promise.allSettled(clients.map((client) => client.end()));
      t.diagnostic(JSON.stringify(report));
    }
  });
