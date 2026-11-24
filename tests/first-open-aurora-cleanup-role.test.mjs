import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const production = readFileSync(new URL("../ops/aws-sandbox/first-open-fc41597f-aurora-cleanup-role.sql", import.meta.url), "utf8");
const readback = readFileSync(new URL("../ops/aws-sandbox/first-open-fc41597f-aurora-cleanup-readback.sql", import.meta.url), "utf8");
const creation = readFileSync(new URL("../ops/aws-sandbox/first-open-fc41597f-aurora-install.sql", import.meta.url), "utf8");
const app = "tenant_e9fdccd5d8c7685c_role", dbName = "tenant_e9fdccd5d8c7685c_db";
const manager = "sf_fc41597f_lifecycle", definer = "sf_fc41597f_lifecycle_definer";
const marker = '{"kind":"role","nonce":"1234567890abcdef1234567890abcdef","resourceGeneration":1,"schema":"techlong/express-bootstrap-owner/v3","stableIdentity":"e9fdccd5d8c7685cb005f423e7a87fc5849163882f4e2f3ca066f2c51cd9e74a","targetSha256":"2d8d208761607774922a06ce2949e96efecec9d8fc2f442203eea82526c682a4"}';
const rpc = "first_open_fc41597f_cleanup.cleanup_role";
const sourceModule = process.env.FIRST_OPEN_PGLITE_MODULE;

test("cleanup installs a distinct, non-invoked maintenance RPC with one fixed destructive statement", () => {
  const [, body, rest] = production.split("$cleanup_role$");
  const statementsWithoutComments = production.replace(/^--.*$/gm, "");
  assert.match(body, /session_user <> 'sf_fc41597f_lifecycle'/);
  assert.match(body, /current_setting\('server_version_num'\)::integer <> 170009/);
  assert.match(body, /oid = target_role_oid AND rolname = 'tenant_e9fdccd5d8c7685c_role'/);
  assert.match(body, /shobj_description\(oid, 'pg_authid'\) = role_marker/);
  assert.match(body, /pg_try_advisory_xact_lock\(hashtextextended/);
  assert.match(body, /CASE WHEN app_can_login THEN 1 ELSE 0 END/);
  assert.deepEqual(statementsWithoutComments.match(/^\s*DROP .+$/gm)?.map(s => s.trim()), [`DROP ROLE ${app};`]);
  assert.doesNotMatch(statementsWithoutComments, /DROP DATABASE|DROP OWNED|REASSIGN OWNED|pg_terminate_backend|DROP ROLE IF EXISTS|CASCADE/i);
  assert.doesNotMatch(rest, /SELECT\s+first_open_fc41597f_cleanup\.cleanup_role\s*\(/i);
  assert.match(rest, /REVOKE ALL ON FUNCTION first_open_fc41597f_cleanup.cleanup_role\(text, oid\) FROM PUBLIC/);
});

test("isolated PostgreSQL exercises the maintenance guard, fixed owners, and both application-role states", {
  skip: !sourceModule && "set FIRST_OPEN_PGLITE_MODULE to an explicit local PGlite module",
}, async t => {
  if (!isAbsolute(sourceModule)) throw Error("PGlite module path must be absolute and local");
  const { PGlite } = await import(pathToFileURL(sourceModule).href);
  const db = await PGlite.create(); // independent in-memory database; no TCP, credentials, or filesystem data dir
  t.after(() => db.close());
  await assert.rejects(db.exec(production), /FC41597F_CLEANUP_INSTALL_SCOPE_CHANGED/);
  await db.exec("ROLLBACK");
  assert.equal((await db.query("SELECT to_regnamespace('first_open_fc41597f_cleanup') IS NULL AS absent")).rows[0].absent, true);
  const originalBodyStart = creation.indexOf("CREATE FUNCTION first_open_fc41597f.reserve_role");
  const originalBodyEnd = creation.indexOf("REVOKE ALL ON FUNCTION first_open_fc41597f.reserve_role");
  await db.exec(`
    CREATE ROLE rds_iam NOLOGIN;
    CREATE ROLE ${manager} LOGIN NOINHERIT CREATEDB CONNECTION LIMIT 2;
    CREATE ROLE ${definer} NOLOGIN NOINHERIT CREATEROLE;
    CREATE ROLE tenant_e9fdccd5d8c7685c_inspect LOGIN;
    GRANT rds_iam TO ${manager} WITH ADMIN FALSE, INHERIT FALSE, SET FALSE;
    GRANT rds_iam TO ${definer} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
    GRANT ${definer} TO postgres WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
    REVOKE CONNECT ON DATABASE postgres, template1 FROM PUBLIC;
    GRANT CONNECT ON DATABASE postgres TO ${manager};
    CREATE SCHEMA first_open_fc41597f;
    REVOKE ALL ON SCHEMA first_open_fc41597f FROM PUBLIC;
    GRANT USAGE ON SCHEMA first_open_fc41597f TO ${manager};
    GRANT USAGE, CREATE ON SCHEMA first_open_fc41597f TO ${definer};
    SET ROLE ${definer};
    ${creation.slice(originalBodyStart, originalBodyEnd)}
    RESET ROLE;
    REVOKE CREATE ON SCHEMA first_open_fc41597f FROM ${definer};
  `);
  // Adapt only fake platform IDs, version, and bootstrap-role name. The
  // rejected unmodified install above and the production bytes stay intact.
  const observed = (await db.query(`SELECT current_setting('server_version_num')::integer AS version,
    datdba AS owner, (SELECT oid FROM pg_roles WHERE rolname = 'rds_iam') AS iam FROM pg_database WHERE datname = 'postgres'`)).rows[0];
  const local = production.replaceAll("170009", String(observed.version)).replaceAll("16410", String(observed.owner))
    .replaceAll("16389", String(observed.iam)).replace("= 'rdsadmin'", "= 'postgres'");
  await t.test("installer preserves the observed non-self DBA edge with no options", async () => {
    const conn = await PGlite.create({ loadDataDir: await db.dumpDataDir("none") });
    try {
      // The fixture bootstrap role is postgres; manufacture the observed
      // provider-supplied edge in this disposable catalog only.
      await conn.exec(`CREATE ROLE fixture_provider NOLOGIN;
        UPDATE pg_auth_members SET grantor = 'fixture_provider'::regrole, admin_option = false
        WHERE roleid = '${definer}'::regrole AND member = 'postgres'::regrole;`);
      const edges = () => conn.query(`SELECT * FROM pg_auth_members WHERE roleid = '${definer}'::regrole ORDER BY oid`);
      const preimage = await edges();
      await conn.exec(local);
      assert.deepEqual(await edges(), preimage);
    } finally {
      await conn.close();
    }
  });
  await db.exec(local).catch(error => {
    throw Error(`isolated fixture install: ${error.message} at ${error.position ?? error.internalPosition ?? "unknown"} ${error.where ?? ""}`, { cause: error });
  });
  await t.test("independent installation readback is read-only and detects a wider ACL", async () => {
    const bodySha = sql => createHash("sha256").update(sql.split("$cleanup_role$")[1].replace(/\r\n/g, "\n")).digest("hex");
    assert.ok(readback.includes(bodySha(production)));
    const isolatedReadback = readback.replace(bodySha(production), bodySha(local));
    const observe = async () => (await db.exec(isolatedReadback)).flatMap(x => x.rows)[0].cleanup_install_readback;
    const expected = { jobId: "job_fc41597f9b5ba8e02b338ecf", maintenanceWriter: false, targetAbsent: true,
      schemaAcl: true, fixedRoutineAcl: true, temporarySetClosed: true };
    assert.deepEqual(await observe(), expected); // PGlite is not the Aurora 17.9 TLS writer.
    try {
      await db.exec(`GRANT EXECUTE ON FUNCTION ${rpc}(text,oid) TO PUBLIC`);
      assert.deepEqual(await observe(), { ...expected, fixedRoutineAcl: false });
    } finally { await db.exec(`REVOKE EXECUTE ON FUNCTION ${rpc}(text,oid) FROM PUBLIC`); }
  });
  await assert.rejects(db.exec(local), /FC41597F_CLEANUP_INSTALL_SCOPE_CHANGED/);
  await db.exec("ROLLBACK");

  // Manufacture a reserved role in memory using the same literal ACL/flags;
  // this fixture intentionally has no deployed tenant workload or data.
  await db.exec(`SET ROLE ${definer}; SET createrole_self_grant = '';
    CREATE ROLE ${app} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD NULL;
    COMMENT ON ROLE ${app} IS '${marker}'; RESET ROLE;`);
  const reservedOid = (await db.query("SELECT oid FROM pg_roles WHERE rolname = $1", [app])).rows[0].oid;
  const snapshot = await db.dumpDataDir("none");
  const call = (conn, roleOid, comment = marker) => conn.query(`SELECT ${rpc}($1::text,$2::oid)`, [comment, roleOid]);
  const count = async conn => (await conn.query("SELECT count(*)::integer AS n FROM pg_roles WHERE rolname = $1", [app])).rows[0].n;
  const withFixture = async (prepare, check) => {
    // PGlite does not reliably RESET SESSION AUTHORIZATION; isolate each case.
    const conn = await PGlite.create({ loadDataDir: snapshot });
    try {
      if (prepare) await conn.exec(prepare);
      await conn.exec(`SET SESSION AUTHORIZATION ${manager}`);
      await check(conn);
    } finally {
      await conn.close();
    }
  };

  await t.test("wrong caller, wrong marker and wrong OID fail closed", async () => {
    const privileges = (await db.query(`SELECT
      has_schema_privilege('tenant_e9fdccd5d8c7685c_inspect', 'first_open_fc41597f_cleanup', 'USAGE') AS usage,
      has_function_privilege('tenant_e9fdccd5d8c7685c_inspect', '${rpc}(text,oid)', 'EXECUTE') AS execute`)).rows[0];
    assert.deepEqual(privileges, { usage: false, execute: false });
    await assert.rejects(call(db, reservedOid), /FC41597F_CLEANUP_ROLE_SCOPE_CHANGED/);
    await withFixture(null, async conn => {
      await assert.rejects(call(conn, reservedOid, marker.replace("1234", "aaaa")), /FC41597F_CLEANUP_ROLE_SCOPE_CHANGED/);
      await assert.rejects(call(conn, reservedOid + 1), /FC41597F_CLEANUP_ROLE_SCOPE_CHANGED/);
      assert.equal(await count(conn), 1);
      await call(conn, reservedOid);
      assert.equal(await count(conn), 0);
      await assert.rejects(call(conn, reservedOid), /FC41597F_CLEANUP_ROLE_SCOPE_CHANGED/);
    });
  });
  await t.test("other database access, configuration, membership, or a shared dependency prevents cleanup", async () => {
    for (const prepare of [
      `GRANT CONNECT ON DATABASE template1 TO ${app}`,
      `ALTER ROLE ${app} IN DATABASE postgres SET statement_timeout = '1234'`,
      `GRANT ${app} TO tenant_e9fdccd5d8c7685c_inspect WITH ADMIN FALSE, INHERIT FALSE, SET FALSE`,
      `GRANT TEMPORARY ON DATABASE postgres TO ${app}`,
    ]) {
      await withFixture(prepare, async conn => {
        await assert.rejects(call(conn, reservedOid), /FC41597F_CLEANUP_ROLE_SCOPE_CHANGED/);
        assert.equal(await count(conn), 1);
      });
    }
  });
  await t.test("remaining target database blocks role cleanup", async () => {
    await withFixture(`CREATE DATABASE ${dbName} OWNER ${manager} ALLOW_CONNECTIONS false`, async conn => {
      await assert.rejects(call(conn, reservedOid), /FC41597F_CLEANUP_ROLE_SCOPE_CHANGED/);
      assert.equal(await count(conn), 1);
    });
  });
  await t.test("reserved and active roles are eligible only with the expected distinct memberships", async () => {
    await withFixture(`SET ROLE ${definer}; ALTER ROLE ${app} LOGIN; RESET ROLE;`, async conn => {
      await assert.rejects(call(conn, reservedOid), /FC41597F_CLEANUP_ROLE_SCOPE_CHANGED/);
      assert.equal(await count(conn), 1);
    });
    await withFixture(`SET ROLE ${definer}; ALTER ROLE ${app} LOGIN;
      GRANT rds_iam TO ${app} WITH ADMIN FALSE, INHERIT FALSE, SET FALSE; RESET ROLE;`, async conn => {
      await call(conn, reservedOid);
      assert.equal(await count(conn), 0);
    });
  });
});
