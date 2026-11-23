import tls from "node:tls";
import {
  FIRST_OPEN_MANAGEMENT_SCHEMA as sqlSchema, FIRST_OPEN_MANAGEMENT_SQL_USER as sqlUser,
  type ExpressManagementTargetV3,
} from "../../lib/deployments/execution/aurora-express-bootstrap-v3.ts";
import { SANDBOX_FIRST_OPEN as s } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import type { Sql } from "./first-open-express-database.ts";
import { stopFirstOpen, validOid } from "./first-open-express-scope.ts";
import type { FirstOpenCredentialSource } from "./first-open-sessions.ts";

export const FIRST_OPEN_SQL_DEFINER = "sf_fc41597f_lifecycle_definer";
export const FIRST_OPEN_INSPECTOR_SQL_USER = "tenant_e9fdccd5d8c7685c_inspect";
export type FirstOpenPg = {
  query(input: string | { text: string; values: unknown[] }): ReturnType<Sql>;
  connect(): Promise<void>; end(): Promise<void>; password: unknown;
  connectionParameters?: { password: unknown };
  connection?: { stream?: tls.TLSSocket & { servername?: string } };
  on(event: "error" | "end", handler: () => void): void;
};
export type FirstOpenSigner = new (input: { region: string; hostname: string; port: number; username: string;
  credentials: Awaited<ReturnType<FirstOpenCredentialSource>> }) => { getAuthToken(): Promise<string> };

export const FIRST_OPEN_MANAGER_IDENTITY_SQL = `SELECT current_database() AS database, current_user AS username,
 session_user AS session_username, current_setting('server_version_num')::integer AS version,
 current_setting('transaction_read_only') AS read_only, current_setting('client_encoding') AS encoding,
 COALESCE((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid()),false) AS tls,
 d.oid::text AS database_oid, d.datdba::text AS owner_oid, r.oid::text AS role_oid,
 r.rolcanlogin AND r.rolcreatedb AND NOT (r.rolsuper OR r.rolcreaterole OR r.rolinherit OR r.rolreplication OR r.rolbypassrls)
  AND r.rolconnlimit=2 AND r.rolvaliduntil IS NULL AND r.rolconfig IS NULL
  AND (SELECT count(*) FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles p ON p.oid=m.roleid
    WHERE m.member=r.oid AND p.rolname='rds_iam' AND NOT (m.admin_option OR m.inherit_option OR m.set_option))=1
  AND (SELECT count(*) FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid)=1
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting WHERE setrole=r.oid) AS limited_role,
 NOT EXISTS (SELECT 1 FROM pg_catalog.pg_database other WHERE other.datallowconn AND other.datname NOT IN ('postgres',$1)
   AND pg_catalog.has_database_privilege(r.oid,other.oid,'CONNECT')) AS no_other_databases
 FROM pg_catalog.pg_roles r CROSS JOIN pg_catalog.pg_database d WHERE r.rolname=current_user AND d.datname=current_database()`;

const CLEANUP_VERIFY_SQL = `SELECT NOT pg_is_in_recovery() AS writer,
  NOT EXISTS (SELECT 1 FROM pg_database WHERE datname=$1)
  AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=$2) AS vacant,
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
   WHERE p.oid=to_regprocedure('first_open_fc41597f_cleanup.cleanup_role(text,oid)')
    AND pg_get_userbyid(p.proowner)=$3 AND p.prosecdef
    AND has_schema_privilege(current_user,n.oid,'USAGE')
    AND has_function_privilege(current_user,p.oid,'EXECUTE')
    AND encode(sha256(convert_to(replace(p.prosrc,chr(13)||chr(10),chr(10)),'UTF8')),'hex')
          = 'c2e08c26098f9fc5688177c84185fb95d6a3dd4efff2ae66804b0386263bcd4e') AS installed`;

const INSTALL_SQL = `WITH checked_roles AS (
 SELECT r.rolname, r.rolcanlogin, r.rolcreaterole, r.rolconnlimit,
  NOT (r.rolcreatedb OR r.rolsuper OR r.rolinherit OR r.rolreplication OR r.rolbypassrls)
  AND r.rolvaliduntil IS NULL AND r.rolconfig IS NULL
  AND NOT EXISTS (SELECT 1 FROM pg_db_role_setting WHERE setrole=r.oid)
  AND (SELECT count(*) FROM pg_auth_members m WHERE m.member=r.oid)=1
  AND EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles c ON c.oid=m.roleid
   WHERE m.member=r.oid AND c.rolname='rds_iam' AND m.admin_option=(r.rolname=$1) AND NOT (m.set_option OR m.inherit_option))
  AND NOT EXISTS (SELECT 1 FROM pg_database d WHERE d.datallowconn AND has_database_privilege(r.oid,d.oid,'CONNECT')) AS restricted
 FROM pg_roles r WHERE r.rolname IN ($1,$5)
)
 SELECT count(*)::integer=2 AND bool_and(p.prosecdef AND p.prorettype='pg_catalog.void'::regtype
 AND p.proconfig=(CASE WHEN p.proname='reserve_role' THEN ARRAY['search_path=pg_catalog, pg_temp','createrole_self_grant=']::text[]
                       ELSE ARRAY['search_path=pg_catalog, pg_temp']::text[] END) AND pg_get_userbyid(p.proowner)=$1
 AND has_function_privilege(current_user,p.oid,'EXECUTE')
 AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
  WHERE a.grantee=0 OR a.grantee NOT IN (p.proowner,(SELECT oid FROM pg_roles WHERE rolname=current_user))
  OR a.grantor<>p.proowner OR (a.grantee<>p.proowner AND a.is_grantable))) AS installed,
 (SELECT count(*)=2 FROM pg_proc q JOIN pg_namespace n ON n.oid=q.pronamespace WHERE n.nspname=$2) AS schema_exact,
 ((SELECT count(*)=1 AND bool_and(has_schema_privilege(current_user,n.oid,'USAGE')) FROM pg_namespace n WHERE n.nspname=$2)
  AND NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE has_schema_privilege(current_user,n.oid,'CREATE'))
  AND NOT has_database_privilege(current_user,current_database(),'CREATE')) AS schema_restricted,
 (SELECT count(*)=2 AND bool_and(restricted AND (CASE WHEN rolname=$1 THEN NOT rolcanlogin AND rolcreaterole
  ELSE rolcanlogin AND NOT rolcreaterole AND rolconnlimit=1 END)) FROM checked_roles) AS roles_restricted,
 EXISTS (SELECT 1 FROM pg_available_extension_versions WHERE name='uuid-ossp' AND version='1.1' AND trusted) AS trusted_extension
 FROM pg_proc p WHERE p.oid IN (to_regprocedure($3)::oid,to_regprocedure($4)::oid)`;

/** Signed, pinned, owned sessions; no fallback credentials, administrator or
 * caller-supplied username. Only the protected Management job builds this. */
export function firstOpenManagerSessions(input: {
  target: ExpressManagementTargetV3;
  credentials: FirstOpenCredentialSource;
  Client: new (config: Record<string, unknown>) => FirstOpenPg;
  Signer: FirstOpenSigner;
  ca: readonly string[];
}) {
  const { target, credentials, Client, Signer, ca } = input;
  if (target.managementDatabase !== "postgres" || target.managementUsername !== sqlUser || target.tenantDatabase !== s.tenantDatabase) {
    return stopFirstOpen("RESTRICTED_MANAGEMENT_IDENTITY_REQUIRED");
  }
  let managerRoleOid: string | undefined;
  const bounded = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
  async function owned<T>(database: string, databaseOid: string, signal: AbortSignal,
    group: Set<FirstOpenPg>, run: (sql: Sql, roleOid: string) => Promise<T>, readOnly = false) {
    signal.throwIfAborted();
    if (!validOid(databaseOid)) return stopFirstOpen("MANAGEMENT_DATABASE_OID_REQUIRED");
    let signed = false, lost = false, active = true;
    const client = new Client({ host: target.endpoint, port: target.port, database, user: sqlUser,
      password: async () => {
        signal.throwIfAborted();
        if (signed) return stopFirstOpen("MANAGEMENT_IAM_SIGN_ALREADY_USED");
        signed = true;
        const snapshot = await credentials(signal);
        signal.throwIfAborted();
        return new Signer({ region: s.region, hostname: target.endpoint, port: target.port, username: sqlUser, credentials: snapshot }).getAuthToken();
      },
      ssl: { ca, rejectUnauthorized: true, servername: target.endpoint, checkServerIdentity: tls.checkServerIdentity, minVersion: "TLSv1.2" },
      connectionTimeoutMillis: 25_000, query_timeout: 25_000, keepAlive: true,
      application_name: "techlong-sandbox-first-open-management",
    });
    group.add(client);
    const terminate = () => { for (const c of group) c.connection?.stream?.destroy(); };
    const failure = () => { if (active) { lost = true; terminate(); } };
    client.on("error", failure); client.on("end", failure);
    signal.addEventListener("abort", terminate, { once: true });
    try {
      await client.connect();
      signal.throwIfAborted();
      const stream = client.connection?.stream;
      if (lost || !signed || !stream?.encrypted || stream.authorized !== true || stream.servername !== target.endpoint) {
        return stopFirstOpen("MANAGEMENT_TLS_OR_IAM_UNPROVED");
      }
      const query: Sql = async (text, values) => {
        signal.throwIfAborted();
        if (lost) return stopFirstOpen("MANAGEMENT_SESSION_LOST");
        const result = await client.query(values ? { text, values } : text);
        signal.throwIfAborted();
        if (lost) return stopFirstOpen("MANAGEMENT_SESSION_LOST");
        return result;
      };
      await query("SET search_path = pg_catalog; SET statement_timeout = '20s'; SET lock_timeout = '5s'; SET idle_in_transaction_session_timeout = '20s'");
      if (readOnly) await query("BEGIN READ ONLY");
      const identity = await query(FIRST_OPEN_MANAGER_IDENTITY_SQL, [target.tenantDatabase]);
      const row = identity.rows[0];
      if (identity.rowCount !== 1 || identity.rows.length !== 1 || row.database !== database || row.database_oid !== databaseOid ||
        row.username !== sqlUser || row.session_username !== sqlUser || !validOid(row.role_oid) || (managerRoleOid && row.role_oid !== managerRoleOid) ||
        (database === target.tenantDatabase ? row.owner_oid !== row.role_oid : row.owner_oid === row.role_oid) ||
        row.version !== 170009 || row.read_only !== (readOnly ? "on" : "off") || row.encoding !== "UTF8" || row.tls !== true || row.limited_role !== true ||
        row.no_other_databases !== true) return stopFirstOpen("MANAGEMENT_SQL_IDENTITY_UNPROVED");
      managerRoleOid ??= row.role_oid;
      const result = await run(query, row.role_oid);
      if (readOnly) await query("COMMIT");
      signal.throwIfAborted();
      if (lost) return stopFirstOpen("MANAGEMENT_SESSION_LOST");
      return result;
    } catch (error) {
      terminate();
      if (error instanceof Error && error.message === "FIRST_OPEN_EXPRESS_DATABASE_NAMESPACE_OCCUPIED") throw error;
      return stopFirstOpen("MANAGEMENT_SQL_STOPPED_NO_RETRY");
    } finally {
      active = false;
      group.delete(client);
      client.connection?.stream?.destroy();
      client.password = null;
      if (client.connectionParameters) client.connectionParameters.password = null;
      await client.end().catch(() => {});
      signal.removeEventListener("abort", terminate);
    }
  }
  return Object.freeze({
    management<T>(signal: AbortSignal, run: (sql: Sql, roleOid: string) => Promise<T>) {
      return owned("postgres", "5", bounded(signal), new Set(), run);
    },
    verifyCleanup(signal: AbortSignal) {
      return owned("postgres", "5", bounded(signal), new Set(), async sql => {
        const r = await sql(CLEANUP_VERIFY_SQL, [s.tenantDatabase, s.tenantRole, FIRST_OPEN_SQL_DEFINER]);
        if (r.rowCount !== 1 || r.rows.length !== 1 || r.rows[0].writer !== true || r.rows[0].vacant !== true || r.rows[0].installed !== true) {
          return stopFirstOpen("CLEANUP_READ_ONLY_UNPROVED");
        }
        return { maintenanceWriter: true, tenantAbsent: true, fixedRoutineVisible: true } as const;
      }, true);
    },
    pair<T>(targetOid: string, signal: AbortSignal, run: (management: Sql, tenant: Sql) => Promise<T>) {
      if (!managerRoleOid || !validOid(targetOid) || targetOid === "5") return stopFirstOpen("MANAGEMENT_TARGET_OID_CHANGED");
      const shared = bounded(signal), group = new Set<FirstOpenPg>();
      return owned("postgres", "5", shared, group, management =>
        owned(target.tenantDatabase, targetOid, shared, group, tenant => run(management, tenant)));
    },
  });
}

export async function assertFirstOpenManagementInstall(sql: Sql) {
  const observed = await sql(INSTALL_SQL, [FIRST_OPEN_SQL_DEFINER, sqlSchema,
    `${sqlSchema}.reserve_role(text)`, `${sqlSchema}.activate_role(text,oid)`, FIRST_OPEN_INSPECTOR_SQL_USER]);
  const row = observed.rows[0];
  if (observed.rowCount !== 1 || observed.rows.length !== 1 || row.installed !== true || row.schema_exact !== true ||
    row.schema_restricted !== true || row.roles_restricted !== true || row.trusted_extension !== true) return stopFirstOpen("MANAGEMENT_INSTALL_UNPROVED");
}
