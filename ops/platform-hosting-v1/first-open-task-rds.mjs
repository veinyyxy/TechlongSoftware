import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { createRdsPostgresDatabase, readRdsControlDatabaseEnvironment, rdsControlPoolOptions } from "../../db/postgres-rds.ts";

const sessionIdentity = `SELECT current_database() AS database, current_user AS username, session_user AS login,
  current_setting('server_version_num')::integer AS "serverVersionNum",
  current_setting('transaction_read_only') AS "readOnly",
  pg_catalog.pg_is_in_recovery() AS "inRecovery",
  pg_catalog.inet_server_port() AS port, COALESCE((SELECT ssl FROM pg_catalog.pg_stat_ssl
    WHERE pid=pg_catalog.pg_backend_pid()), false) AS tls`;

const defaultCa = () => readFileSync("/app/certs/amazon-rds.pem", "utf8");
const defaultPool = (options) => {
  const pool = new Pool(options);
  pool.on("error", () => {});
  return pool;
};

function requireRdsConnection(env, binding, expectedRole) {
  const config = readRdsControlDatabaseEnvironment(env);
  if (!config || config.host !== binding.controlHost || config.database !== binding.controlDatabase ||
    config.user !== expectedRole) throw Error("ECS_FIRST_OPEN_CONTROL_RDS_SCOPE");
  return config;
}

async function verifySession(client, connection, readOnly) {
  const { rows } = await client.query(sessionIdentity);
  const row = rows.length === 1 ? rows[0] : null;
  if (row?.database !== connection.database || row.username !== connection.user || row.login !== connection.user ||
    row.port !== connection.port || row.serverVersionNum !== 160014 || row.inRecovery !== false ||
    row.readOnly !== (readOnly ? "on" : "off") || row.tls !== true) throw Error("ECS_FIRST_OPEN_CONTROL_RDS_SESSION");
}

/** The ACK and completion are read using a distinct login and a new read-only
 * connection for each statement. Runtime validation never sets a fallback DSN. */
export function createFirstOpenTaskRds(env, binding, { readCa = defaultCa, openPool = defaultPool } = {}) {
  const writeConnection = requireRdsConnection(env, binding, binding.writeDbRole);
  const readConnection = requireRdsConnection({ ...env, TECHLONG_SAAS_CONTROL_RDS_URL: env.TECHLONG_FIRST_OPEN_CONTROL_READ_RDS_URL },
    binding, binding.readDbRole);
  const ca = readCa();
  const options = (connection, purpose) => ({ ...rdsControlPoolOptions(connection, ca), max: 1,
    application_name: `techlong-first-open-${purpose}`, statement_timeout: 7000, query_timeout: 8000, lock_timeout: 2500 });
  const writer = openPool(options(writeConnection, "write"));
  const reader = openPool(options(readConnection, "read"));
  const withVerifiedSession = async (pool, connection, readOnly, operation, commit = false) => {
    const client = await pool.connect();
    let rollback = false;
    try {
      await client.query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
      rollback = true;
      await client.query("SET LOCAL search_path = pg_catalog, public");
      await verifySession(client, connection, readOnly);
      const result = await operation(client);
      rollback = false;
      if (commit) {
        try {
          const result = await client.query("COMMIT");
          if (result.command !== "COMMIT") throw Error();
        }
        catch { throw Error("ECS_FIRST_OPEN_CONTROL_SQL_COMMIT_UNCONFIRMED"); }
      } else {
        await client.query("ROLLBACK");
      }
      return result;
    } catch (error) {
      if (rollback) await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      // Broken/missing rollback acknowledgements never return a client to use.
      client.release(true);
    }
  };
  const db = createRdsPostgresDatabase(writer);
  const readDb = createRdsPostgresDatabase({
    query: (text, values) => withVerifiedSession(reader, readConnection, true, client => client.query(text, values)),
    connect() { throw Error("ECS_FIRST_OPEN_CONTROL_READER_BATCH_DISABLED"); },
  });
  // The existing deployment repository binds PostgreSQL arrays directly. It
  // gets the original wire result, while application statements keep the
  // existing ApplicationDatabase mapping.
  const repositorySql = Object.freeze({
    query: (text, values) => withVerifiedSession(writer, writeConnection, false, client => client.query(text, values), true),
  });
  return Object.freeze({
    db, readDb, repositorySql,
    verifyWriter: () => withVerifiedSession(writer, writeConnection, false, async () => undefined),
    close: async () => { await Promise.allSettled([writer.end(), reader.end()]); },
  });
}
