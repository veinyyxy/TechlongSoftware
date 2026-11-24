-- After the separately approved installation COMMIT, use a new verified-TLS
-- DBA connection to the exact Express 17.9 writer, maintenance DB postgres.
-- Readback only: never connects as Lifecycle or invokes the cleanup function.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '10s';
WITH ids AS (
  SELECT (SELECT oid FROM pg_roles WHERE rolname = 'postgres') AS dba,
         (SELECT oid FROM pg_roles WHERE rolname = 'sf_fc41597f_lifecycle' AND rolcanlogin) AS lifecycle,
         (SELECT oid FROM pg_roles WHERE rolname = 'sf_fc41597f_lifecycle_definer' AND NOT rolcanlogin) AS definer,
         (SELECT oid FROM pg_roles WHERE rolname = 'tenant_e9fdccd5d8c7685c_inspect') AS inspector
), ns AS (
  SELECT oid, nspowner, nspacl FROM pg_namespace WHERE nspname = 'first_open_fc41597f_cleanup'
), routine AS (
  SELECT p.* FROM pg_proc p JOIN ns ON p.pronamespace = ns.oid
)
SELECT json_build_object('jobId', 'job_fc41597f9b5ba8e02b338ecf',
  'maintenanceWriter', coalesce(current_database() = 'postgres' AND current_user = 'postgres' AND session_user = 'postgres'
    AND current_setting('transaction_read_only') = 'on' AND current_setting('server_version_num')::integer = 170009
    AND NOT pg_is_in_recovery()
    AND EXISTS (SELECT 1 FROM pg_stat_ssl WHERE pid = pg_backend_pid() AND ssl)
    AND EXISTS (SELECT 1 FROM pg_database WHERE oid = 5 AND datname = 'postgres' AND datdba = 16410 AND datallowconn), false),
  'targetAbsent', NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'tenant_e9fdccd5d8c7685c_db')
    AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_e9fdccd5d8c7685c_role'),
  'schemaAcl', EXISTS (SELECT 1 FROM ns n WHERE n.nspowner = dba AND lifecycle IS NOT NULL AND definer IS NOT NULL AND inspector IS NOT NULL
    AND has_schema_privilege(lifecycle,n.oid,'USAGE') AND has_schema_privilege(definer,n.oid,'USAGE')
    AND NOT has_schema_privilege(inspector,n.oid,'USAGE')
    AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
      WHERE a.grantee <> dba AND (a.grantee NOT IN (lifecycle,definer) OR a.privilege_type <> 'USAGE' OR a.is_grantable))),
  'fixedRoutineAcl', (SELECT count(*) = 1 AND coalesce(bool_and(p.proname = 'cleanup_role' AND p.proargtypes = '25 26'::oidvector
    AND p.proowner = definer AND p.prokind = 'f' AND p.prorettype = 'void'::regtype AND p.prosecdef
    AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp','lock_timeout=5s'] AND cardinality(p.proconfig) = 2
    AND encode(sha256(convert_to(replace(p.prosrc,chr(13)||chr(10),chr(10)),'UTF8')),'hex') = 'c2e08c26098f9fc5688177c84185fb95d6a3dd4efff2ae66804b0386263bcd4e'
    AND has_function_privilege(lifecycle,p.oid,'EXECUTE') AND NOT has_function_privilege(inspector,p.oid,'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee <> definer AND (a.grantee <> lifecycle OR a.grantor <> definer OR a.is_grantable))), false) FROM routine p),
  'temporarySetClosed', definer IS NOT NULL AND (SELECT count(*) <= 1 AND count(*) = count(*) FILTER (
      WHERE m.member = dba AND NOT (m.inherit_option OR m.set_option) AND (m.admin_option OR m.grantor <> dba))
    FROM pg_auth_members m WHERE m.roleid = definer)
) AS cleanup_install_readback FROM ids;
COMMIT;
