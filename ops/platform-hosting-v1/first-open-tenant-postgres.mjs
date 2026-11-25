import { checkServerIdentity } from "node:tls";
import { isIPv4 } from "node:net";
import { Client } from "pg";
import { loadFirstOpenTenantPostgresPrograms } from "./first-open-backend.mjs";

const names = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
const oid = /^[1-9][0-9]{0,9}$/;
const ownerMarker = /^tl_owner_[a-f0-9]{32}_g[1-9][0-9]*$/;
const rdsEndpoint = /^[a-z][a-z0-9-]{0,62}\.[a-z0-9]{6,63}\.[a-z]{2}(?:-[a-z0-9]+)+-\d\.rds\.amazonaws\.com$/;
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const productionVersion = 160014;
const caPath = "/usr/local/share/ca-certificates/aws-rds-global-bundle.pem";
const identitySql = `SELECT current_database() AS database, session_user AS username, current_user AS "effectiveUsername",
  pg_catalog.pg_get_userbyid(d.datdba) AS owner, d.oid::text AS "databaseOid",
  (SELECT pg_catalog.shobj_description(d.oid, 'pg_database')) AS "databaseComment",
  current_setting('server_version_num')::integer AS "serverVersionNum",
  current_setting('server_version') AS "serverVersion",
  pg_catalog.host(pg_catalog.inet_server_addr()) AS "serverAddress", pg_catalog.inet_server_port() AS port,
  pg_catalog.pg_is_in_recovery() AS "inRecovery", current_setting('transaction_read_only') AS "readOnly",
  COALESCE((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()), false) AS tls
  FROM pg_catalog.pg_database d WHERE d.datname=current_database()`;
const firstOpenInspectionSql = `SELECT pg_catalog.shobj_description(
    (SELECT d.oid FROM pg_catalog.pg_database d WHERE d.datname=current_database()), 'pg_database') AS "databaseComment",
  pg_catalog.shobj_description(r.oid, 'pg_authid') AS "roleComment",
  pg_catalog.host(pg_catalog.inet_server_addr()) AS address,
  (r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolcreaterole AND NOT r.rolcreatedb AND NOT r.rolreplication
    AND NOT r.rolbypassrls AND NOT pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER')
    AND pg_catalog.has_database_privilege(r.oid, current_database(), 'CONNECT')) AS "applicationRoleVerified",
  (EXISTS (SELECT 1 FROM public.saas_instances WHERE singleton_key)) AS "saasMigrated"
  FROM pg_catalog.pg_roles r WHERE r.rolname=$1`;

function fail(code) {
  throw Object.assign(Error(code), { code, retryable: false });
}

function bindTarget(target) {
  if (!target || ![target.database, target.username, target.owner].every(value => typeof value === "string" && names.test(value)) ||
      !Number.isInteger(target.port) || target.port < 1 || target.port > 65535 ||
      (target.databaseOid !== undefined && (typeof target.databaseOid !== "string" || !oid.test(target.databaseOid) ||
        Number(target.databaseOid) >= 2 ** 32)) ||
      (target.ownershipMarker !== undefined && !ownerMarker.test(target.ownershipMarker))) fail("TENANT_POSTGRES_TARGET");
  if (target.kind === "local") {
    if (!localHosts.has(target.host)) fail("TENANT_POSTGRES_TARGET");
  } else if (target.kind === "rds") {
    if (target.engine !== "postgres" || target.port !== 5432 || !target.databaseOid || !target.ownershipMarker ||
        typeof target.host !== "string" || !rdsEndpoint.test(target.host) ||
        target.host.split(".")[0] !== target.dbInstanceIdentifier) fail("TENANT_POSTGRES_TARGET");
  } else {
    fail("TENANT_POSTGRES_TARGET");
  }
  return Object.freeze({ ...target });
}

function readRdsPassword(target, raw) {
  try {
    const url = new URL(raw);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== target.host ||
        (url.port || "5432") !== String(target.port) || decodeURIComponent(url.pathname) !== `/${target.database}` ||
        decodeURIComponent(url.username) !== target.username || !url.password || url.hash ||
        ![...url.searchParams].every(([key, value]) => key === "sslmode" && value === "verify-full") ||
        url.searchParams.getAll("sslmode").length > 1) fail("TENANT_POSTGRES_CREDENTIAL_TARGET");
    return decodeURIComponent(url.password);
  } catch {
    return fail("TENANT_POSTGRES_CREDENTIAL_TARGET");
  }
}

/** The tenant image already accepts full_password plus a versioned DATABASE_URL and RDS CA. */
export function tenantRdsApplicationConfiguration({ target: raw, runtimeSecretArn, versionId }) {
  const target = bindTarget(raw);
  const region = target.host.split(".")[2];
  if (target.kind !== "rds" || !new RegExp(`^arn:aws:secretsmanager:${region}:\\d{12}:secret:[A-Za-z0-9/_+=.@-]+$`).test(runtimeSecretArn) ||
      !/^[A-Za-z0-9-]{32,64}$/.test(versionId)) fail("TENANT_POSTGRES_APPLICATION_BINDING");
  return Object.freeze({
    environment: Object.freeze({
      PG_DATABASE_PROFILE: "full_password",
      PGSSLMODE: "verify-full",
      PGSSL_REJECT_UNAUTHORIZED: "true",
      PGSSLROOTCERT: caPath,
    }),
    secret: Object.freeze({ name: "DATABASE_URL", valueFrom: `${runtimeSecretArn}:database_url::${versionId}` }),
    validateDatabaseUrl(databaseUrl) { readRdsPassword(target, databaseUrl); },
  });
}

function assertSession(target, row, readOnly) {
  if (!row || row.database !== target.database || row.username !== target.username || row.effectiveUsername !== target.username ||
      row.owner !== target.owner || row.port !== target.port || !oid.test(row.databaseOid) ||
      !Number.isSafeInteger(row.serverVersionNum) || row.serverVersionNum <= 0 ||
      (target.databaseOid !== undefined && row.databaseOid !== target.databaseOid) ||
      row.readOnly !== (readOnly ? "on" : "off")) fail("TENANT_POSTGRES_OWNERSHIP");
  if (target.kind === "local" && !["127.0.0.1", "::1"].includes(row.serverAddress)) fail("TENANT_POSTGRES_TARGET");
  if (target.kind === "rds" && (row.tls !== true || row.serverVersionNum !== productionVersion || row.inRecovery !== false)) {
    fail("TENANT_POSTGRES_RDS_SESSION");
  }
  if (target.ownershipMarker !== undefined) {
    let metadata;
    try {
      if (typeof row.databaseComment !== "string" || Buffer.byteLength(row.databaseComment) > 8192) fail("TENANT_POSTGRES_OWNERSHIP");
      metadata = JSON.parse(row.databaseComment);
    } catch { fail("TENANT_POSTGRES_OWNERSHIP"); }
    if (metadata?.schemaVersion !== 1 || metadata.kind !== "techlong_tenant_database" ||
        metadata.ownershipMarker !== target.ownershipMarker || metadata.marker?.ownershipMarker !== target.ownershipMarker) {
      fail("TENANT_POSTGRES_OWNERSHIP");
    }
  }
  return {
    database: row.database, username: row.username, owner: row.owner, databaseOid: row.databaseOid,
    serverVersionNum: row.serverVersionNum, serverVersion: row.serverVersion, tls: row.tls,
  };
}

function firstOpenMetadata(comment, kind, ownershipMarker, baselineDigest) {
  try {
    if (typeof comment !== "string" || Buffer.byteLength(comment) > 8192) return false;
    const { schemaVersion, kind: observedKind, ownershipMarker: markerKey, marker } = JSON.parse(comment);
    const owned = schemaVersion === 1 && observedKind === kind && markerKey === ownershipMarker &&
      marker?.resourceGeneration === 1 && marker.ownershipMarker === ownershipMarker;
    return owned && (kind === "techlong_tenant_role" ||
      (marker.lifecycleState === "verified" && marker.baselineDigest === baselineDigest &&
        marker.migrationContract === "speedfeast-saas-control-v1"));
  } catch {
    return false;
  }
}

function privateIpv4(address) {
  if (typeof address !== "string" || !isIPv4(address)) return false;
  const [first, second] = address.split(".").map(Number);
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

async function isEmpty(client, emptySql) {
  const empty = (await client.query(emptySql)).rows[0];
  return String(empty?.objects) === "0" && String(empty?.closed_public_schema) === "1";
}

async function verifyMigrations(client) {
  const migrated = (await client.query(`SELECT
    (SELECT count(*) FROM public.saas_instances WHERE singleton_key AND external_instance_id IS NULL
      AND external_operation_epoch IS NULL AND provisioned_at IS NULL) AS "initialInstances",
    (SELECT count(*) FROM public.saas_instances) AS instances,
    (SELECT count(*) FROM public.saas_entitlements) AS entitlements`)).rows[0];
  if (String(migrated?.initialInstances) !== "1" || String(migrated?.instances) !== "1" || String(migrated?.entitlements) !== "8") {
    fail("TENANT_POSTGRES_MIGRATION_UNVERIFIED");
  }
}

/**
 * SQL adapter for an existing tenant target. Local keeps its configured PostgreSQL
 * credentials; private RDS requires the exact reviewed instance and CA.
 */
export function createTenantPostgresAdapter({ target: input, localPassword, localSsl, databaseUrl, ca,
  createClient = config => new Client(config) }) {
  const target = bindTarget(input);
  let password;
  let ssl = false;
  if (target.kind === "local") {
    if (databaseUrl !== undefined || ca !== undefined || typeof localPassword !== "string") fail("TENANT_POSTGRES_CREDENTIAL_TARGET");
    password = localPassword;
    ssl = localSsl ?? false;
  } else {
    if (localPassword !== undefined || localSsl !== undefined || typeof ca !== "string" || !ca.includes("-----BEGIN CERTIFICATE-----")) {
      fail("TENANT_POSTGRES_RDS_CA");
    }
    password = readRdsPassword(target, databaseUrl);
    ssl = { ca, rejectUnauthorized: true, servername: target.host, minVersion: "TLSv1.2",
      checkServerIdentity: (_hostname, cert) => checkServerIdentity(target.host, cert) };
  }

  async function withTarget(readOnly, run, signal) {
    signal?.throwIfAborted();
    const client = createClient({
      host: target.host, port: target.port, database: target.database, user: target.username, password, ssl,
      connectionTimeoutMillis: 5000, statement_timeout: 30000, lock_timeout: 1000, idle_in_transaction_session_timeout: 30000,
      application_name: "techlong-tenant-postgres",
    });
    const abort = () => client.connection?.stream?.destroy();
    const connectionLost = () => abort();
    signal?.addEventListener("abort", abort, { once: true });
    client.on("error", connectionLost);
    let transaction = false;
    try {
      await client.connect();
      const query = async (text, values) => {
        signal?.throwIfAborted();
        const result = await client.query(text, values);
        signal?.throwIfAborted();
        return result;
      };
      await query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
      transaction = true;
      await query("SET LOCAL search_path = pg_catalog");
      const row = (await query(identitySql)).rows[0];
      const identity = assertSession(target, row, readOnly);
      if (identity.tls !== Boolean(ssl)) fail("TENANT_POSTGRES_SESSION_TLS");
      const result = await run({ query }, identity, row.databaseComment);
      if (readOnly) {
        await query("ROLLBACK");
      } else {
        // Once COMMIT is sent, a lost acknowledgement cannot establish the outcome.
        transaction = false;
        try { await query("COMMIT"); } catch { fail("TENANT_POSTGRES_INITIALIZATION_UNCONFIRMED"); }
      }
      transaction = false;
      return result;
    } catch (error) {
      if (transaction) await client.query("ROLLBACK").catch(abort);
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      await client.end().catch(abort);
      client.removeListener("error", connectionLost);
    }
  }

  return Object.freeze({
    inspect(signal) { return withTarget(true, (_client, identity) => identity, signal); },
    async inspectFirstOpen({ applicationRole, baselineDigest, signal, backendDirectory = "/app/first-open-backend" }) {
      if (target.kind !== "rds" || ![applicationRole, target.username, target.owner].every(name => typeof name === "string" && names.test(name)) ||
          new Set([applicationRole, target.username, target.owner]).size !== 3 || !/^[a-f0-9]{64}$/.test(baselineDigest)) {
        fail("TENANT_POSTGRES_INSPECTION_SCOPE");
      }
      const { BASELINE_CATALOG_PINS } = await loadFirstOpenTenantPostgresPrograms(backendDirectory);
      if (baselineDigest !== BASELINE_CATALOG_PINS.archiveSha256) fail("TENANT_POSTGRES_BASELINE_UNAPPROVED");
      return withTarget(true, async (client) => {
        const { rows } = await client.query(firstOpenInspectionSql, [applicationRole]);
        const row = rows.length === 1 ? rows[0] : null;
        if (row?.applicationRoleVerified !== true || row.saasMigrated !== true || !privateIpv4(row.address) ||
          !firstOpenMetadata(row.databaseComment, "techlong_tenant_database", target.ownershipMarker, baselineDigest) ||
          !firstOpenMetadata(row.roleComment, "techlong_tenant_role", target.ownershipMarker, baselineDigest)) {
          fail("TENANT_POSTGRES_INSPECTION_UNVERIFIED");
        }
        return { name: target.database, roleName: applicationRole, ownershipMarker: target.ownershipMarker, baselineDigest };
      }, signal);
    },
    async inspectEmpty({ backendDirectory, signal }) {
      const programs = await loadFirstOpenTenantPostgresPrograms(backendDirectory);
      return withTarget(true, async (client, identity) => {
        return { ...identity, eligibleEmpty: await isEmpty(client, programs.EMPTY_SQL) };
      }, signal);
    },
    readSample({ schema, table, keyColumn, key, columns, signal }) {
      if (!Array.isArray(columns) || columns.length === 0 || columns.length > 24 ||
          ![schema, table, keyColumn, ...columns].every(name => typeof name === "string" && names.test(name)) ||
          /^pg_|^information_schema$/.test(schema) || typeof key !== "string" || key.length < 1 || key.length > 256) {
        fail("TENANT_POSTGRES_SAMPLE");
      }
      const quote = name => `"${name}"`;
      return withTarget(true, async ({ query }, identity) => {
        const result = await query(`SELECT ${columns.map(quote).join(", ")} FROM ${quote(schema)}.${quote(table)}
          WHERE ${quote(keyColumn)} = $1 LIMIT 2`, [key]);
        if (result.rows.length !== 1) fail("TENANT_POSTGRES_SAMPLE");
        return { identity, sample: result.rows[0] };
      }, signal);
    },
    async initialize({ backendDirectory, archiveBytes, manifestBytes, archiveSha256, manifestSha256,
      pgRestorePath, workspace, signal }) {
      if (target.isolatedEmpty !== true || !target.databaseOid || !target.ownershipMarker || target.owner !== target.username) {
        fail("TENANT_POSTGRES_INITIALIZATION_SCOPE");
      }
      const programs = await loadFirstOpenTenantPostgresPrograms(backendDirectory);
      const pins = programs.BASELINE_CATALOG_PINS;
      if (archiveSha256 !== pins.archiveSha256 || manifestSha256 !== pins.manifestSha256) fail("TENANT_POSTGRES_BASELINE_UNAPPROVED");
      const result = await withTarget(false, async (client, identity, databaseComment) => {
        if (identity.serverVersionNum !== productionVersion) fail("TENANT_POSTGRES_INITIALIZATION_VERSION");
        const key = `${target.ownershipMarker}:${identity.databaseOid}`;
        const locked = (await client.query("SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended($1::text,0)) AS locked",
          [key])).rows[0];
        if (locked?.locked !== true) fail("TENANT_POSTGRES_INITIALIZATION_LOCKED");
        if (!await isEmpty(client, programs.EMPTY_SQL)) fail("TENANT_POSTGRES_NOT_EMPTY");
        const baseline = await programs.compileTenantBaselineProgram({ archiveBytes, manifestBytes, archiveSha256, manifestSha256,
          pgRestorePath, workspace });
        await client.query(baseline.restoreSql);
        await client.query(baseline.verificationSql);
        if (await programs.baselineCatalogIdentity(client, signal) !== pins.catalogSha256) fail("TENANT_POSTGRES_BASELINE_CATALOG");
        await client.query("SET LOCAL search_path = pg_catalog, public");
        for (const migration of programs.loadSaasPrograms()) await client.query(migration.sql);
        await verifyMigrations(client);
        if (target.kind === "rds") {
          const metadata = JSON.parse(databaseComment);
          const marker = { ...metadata.marker, resourceGeneration: 1, lifecycleState: "verified",
            baselineDigest: archiveSha256, migrationContract: "speedfeast-saas-control-v1" };
          const comment = JSON.stringify({ ...metadata, marker });
          const statement = (await client.query("SELECT pg_catalog.format('COMMENT ON DATABASE %I IS %L', $1::text, $2::text) AS statement",
            [target.database, comment])).rows[0]?.statement;
          if (typeof statement !== "string" || !statement.startsWith("COMMENT ON DATABASE ")) fail("TENANT_POSTGRES_BASELINE_MARKER");
          await client.query(statement);
        }
        return { identity, archiveSha256, manifestSha256, migrationContract: "speedfeast-saas-control-v1" };
      }, signal);
      try {
        await withTarget(true, async (client, _identity, comment) => {
          await verifyMigrations(client);
          if (target.kind === "rds" && !firstOpenMetadata(comment, "techlong_tenant_database", target.ownershipMarker, archiveSha256)) {
            fail("TENANT_POSTGRES_BASELINE_MARKER");
          }
        }, signal);
      }
      catch { fail("TENANT_POSTGRES_INITIALIZATION_UNCONFIRMED"); }
      return result;
    },
  });
}
