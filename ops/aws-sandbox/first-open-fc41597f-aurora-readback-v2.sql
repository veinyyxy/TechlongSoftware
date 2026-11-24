-- After the approved install COMMIT, run once in a new validated TLS DBA
-- connection to the exact Sandbox Express writer / maintenance database postgres.
-- No temporary role or target database connection. Do not output password,
-- function bodies, ACL rows, or user data; compare function hashes in SQL.
-- Accept only one row with all flags true and an acknowledged read-only COMMIT.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '10s';

WITH ids AS (
  SELECT (SELECT oid FROM pg_roles WHERE rolname = 'postgres') AS dba,
         (SELECT oid FROM pg_roles WHERE rolname = 'rds_iam') AS iam,
         (SELECT oid FROM pg_roles WHERE rolname = 'sf_fc41597f_lifecycle') AS lifecycle,
         (SELECT oid FROM pg_roles WHERE rolname = 'sf_fc41597f_lifecycle_definer') AS definer,
         (SELECT oid FROM pg_roles WHERE rolname = 'tenant_e9fdccd5d8c7685c_inspect') AS inspector
), installed_schema AS (
  SELECT oid, nspowner, nspacl FROM pg_namespace WHERE nspname = 'first_open_fc41597f'
), installed_functions AS (
  SELECT p.oid, p.proname, p.proargtypes, p.prokind, p.prorettype, p.proowner, p.prosecdef, p.proconfig, p.proacl, l.lanname,
         encode(sha256(convert_to(replace(p.prosrc, chr(13) || chr(10), chr(10)), 'UTF8')), 'hex') AS body_sha256
    FROM pg_proc p JOIN installed_schema n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
), result AS (
  SELECT current_database() = 'postgres' AND current_user = 'postgres' AND session_user = 'postgres'
         AND current_setting('transaction_read_only') = 'on' AND current_setting('server_version_num')::integer = 170009
         AND NOT pg_is_in_recovery() AND iam = 16389
         AND EXISTS (SELECT 1 FROM pg_database WHERE oid = 5 AND datname = 'postgres' AND datdba = 16410 AND datallowconn)
           AS maintenance_writer,
         NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'tenant_e9fdccd5d8c7685c_db')
         AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_e9fdccd5d8c7685c_role')
           AS tenant_absent,
         (SELECT count(*) = 3 FROM pg_roles r WHERE r.oid IN (lifecycle, definer, inspector)
             AND r.rolcanlogin = (r.oid <> definer) AND r.rolcreatedb = (r.oid = lifecycle)
             AND r.rolcreaterole = (r.oid = definer) AND r.rolconnlimit = CASE r.oid WHEN lifecycle THEN 2 WHEN inspector THEN 1 ELSE -1 END
             AND NOT (r.rolinherit OR r.rolsuper OR r.rolreplication OR r.rolbypassrls)
             AND r.rolconfig IS NULL AND r.rolvaliduntil IS NULL)
           AS role_flags,
         (SELECT count(*) = 3 AND count(DISTINCT m.member) = 3 AND bool_and(m.roleid = iam
                 AND m.admin_option = (m.member = definer) AND NOT m.inherit_option AND NOT m.set_option)
            FROM pg_auth_members m WHERE m.member IN (lifecycle, definer, inspector))
         -- The exact writer returned one non-self DBA membership with no admin, inherit, or set option.
         -- Keep the no-incoming-edge and single DBA admin-only cases; reject extra rows and any SET/INHERIT.
         AND (SELECT count(*) <= 1 AND count(*) = count(*) FILTER (
                 WHERE m.member = dba AND NOT m.inherit_option AND NOT m.set_option
                   AND (m.admin_option OR m.grantor <> dba))
              FROM pg_auth_members m WHERE m.roleid = definer)
           AS memberships,
         EXISTS (SELECT 1 FROM installed_schema n WHERE n.nspowner = dba
                   AND has_schema_privilege(lifecycle, n.oid, 'USAGE') AND has_schema_privilege(definer, n.oid, 'USAGE')
                   AND NOT has_schema_privilege(definer, n.oid, 'CREATE')
                   AND NOT has_schema_privilege(inspector, n.oid, 'USAGE')
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
                                    WHERE a.grantee <> dba AND (a.grantee NOT IN (lifecycle, definer)
                                           OR a.privilege_type <> 'USAGE' OR a.is_grantable)))
           AS schema_acl,
         (SELECT count(*) = 2 AND count(DISTINCT f.proname) = 2 AND bool_and(coalesce(f.prokind = 'f'
                    AND f.prorettype = 'void'::regtype AND f.proowner = definer AND f.prosecdef AND f.lanname = 'plpgsql'
                    AND ((f.proname = 'reserve_role' AND f.proargtypes = '25'::oidvector
                          AND f.proconfig @> ARRAY['search_path=pg_catalog, pg_temp','createrole_self_grant=']
                          AND cardinality(f.proconfig) = 2
                          AND f.body_sha256 = 'f0797e80eb82c893a16f862e0dca5f8e95eb538aaa4530b72cd73030050a20a7')
                      OR (f.proname = 'activate_role' AND f.proargtypes = '25 26'::oidvector
                          AND f.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
                          AND f.body_sha256 = '1c0a81ea642c6ce80b469bfe6f5f167388cc8d0dd927b7d25aa930a04f9bd615'))
                    AND has_function_privilege(lifecycle, f.oid, 'EXECUTE')
                    AND NOT has_function_privilege(inspector, f.oid, 'EXECUTE')
                    AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
                                    WHERE a.grantee <> definer AND (a.grantee <> lifecycle OR a.is_grantable)), false))
            FROM installed_functions f)
           AS functions_acl,
         has_database_privilege(lifecycle, 'postgres', 'CONNECT') AND NOT has_database_privilege(lifecycle, 'postgres', 'CREATE')
         AND NOT EXISTS (SELECT 1 FROM pg_database d WHERE d.datallowconn AND
            ((d.datname <> 'postgres' AND has_database_privilege(lifecycle, d.oid, 'CONNECT'))
              OR has_database_privilege(inspector, d.oid, 'CONNECT')))
         AND NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE has_schema_privilege(lifecycle, n.oid, 'CREATE'))
           AS isolation
    FROM ids
)
SELECT json_build_object('jobId', 'job_fc41597f9b5ba8e02b338ecf',
    'maintenanceWriter', coalesce(maintenance_writer, false), 'tenantAbsent', coalesce(tenant_absent, false),
    'roleFlags', coalesce(role_flags, false), 'memberships', coalesce(memberships, false),
    'schemaAcl', coalesce(schema_acl, false), 'functionsAcl', coalesce(functions_acl, false),
    'isolation', coalesce(isolation, false)) AS first_open_aurora_readback
  FROM result;
COMMIT;
