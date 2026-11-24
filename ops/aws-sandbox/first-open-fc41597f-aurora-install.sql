-- Installation artifact, not approval. Run once as the approved Aurora DBA on
-- the exact sandbox Express writer in maintenance database postgres. Never run
-- from the workflow: its IAM login cannot install or assume the definer.
-- No tenant DB, application login, business data, or shared ACL is changed here.
-- Any occupied name/errors roll back this installation; do not auto-replay.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL standard_conforming_strings = on;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
  IF current_database() <> 'postgres' OR session_user <> 'postgres' OR current_user <> session_user
     OR current_setting('server_version_num')::integer <> 170009
     OR NOT EXISTS (SELECT 1 FROM pg_database WHERE oid = 5 AND datname = 'postgres' AND datdba = 16410 AND datallowconn)
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE oid = 16389 AND rolname = 'rds_iam')
     OR EXISTS (SELECT 1 FROM pg_database WHERE datname = 'tenant_e9fdccd5d8c7685c_db')
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'first_open_fc41597f')
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('sf_fc41597f_lifecycle', 'sf_fc41597f_lifecycle_definer',
                                                       'tenant_e9fdccd5d8c7685c_role', 'tenant_e9fdccd5d8c7685c_inspect'))
  THEN
    RAISE EXCEPTION 'FC41597F_AURORA_INSTALL_SCOPE_CHANGED';
  END IF;
END;
$guard$;

-- CREATEDB is inherently cluster-wide in PostgreSQL; the protected workflow's
-- fixed target, write-once claim, and SQL are what restrict its use to this name.
-- CREATEROLE and rds_iam ADMIN are not held by the IAM login.
CREATE ROLE sf_fc41597f_lifecycle LOGIN NOINHERIT NOSUPERUSER CREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD NULL;
CREATE ROLE sf_fc41597f_lifecycle_definer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB CREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD NULL;
CREATE ROLE tenant_e9fdccd5d8c7685c_inspect LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1 PASSWORD NULL;
GRANT rds_iam TO sf_fc41597f_lifecycle, tenant_e9fdccd5d8c7685c_inspect WITH ADMIN FALSE, INHERIT FALSE, SET FALSE;
GRANT rds_iam TO sf_fc41597f_lifecycle_definer WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
GRANT CONNECT ON DATABASE postgres TO sf_fc41597f_lifecycle;

CREATE SCHEMA first_open_fc41597f;
REVOKE ALL ON SCHEMA first_open_fc41597f FROM PUBLIC;
GRANT USAGE ON SCHEMA first_open_fc41597f TO sf_fc41597f_lifecycle;
GRANT USAGE, CREATE ON SCHEMA first_open_fc41597f TO sf_fc41597f_lifecycle_definer;

-- Temporary SET for the installing DBA only, to create both functions directly
-- as the non-login owner. The transaction removes SET and schema CREATE below.
GRANT sf_fc41597f_lifecycle_definer TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
SET LOCAL ROLE sf_fc41597f_lifecycle_definer;

CREATE FUNCTION first_open_fc41597f.reserve_role(role_marker text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET createrole_self_grant = ''
AS $reserve$
BEGIN
  IF session_user <> 'sf_fc41597f_lifecycle' OR role_marker IS NULL OR
     role_marker !~ '^\{"kind":"role","nonce":"[a-f0-9]{32}","resourceGeneration":1,"schema":"techlong/express-bootstrap-owner/v3","stableIdentity":"e9fdccd5d8c7685cb005f423e7a87fc5849163882f4e2f3ca066f2c51cd9e74a","targetSha256":"2d8d208761607774922a06ce2949e96efecec9d8fc2f442203eea82526c682a4"\}$'
     OR EXISTS (SELECT 1 FROM pg_database WHERE datname = 'tenant_e9fdccd5d8c7685c_db')
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_e9fdccd5d8c7685c_role')
  THEN
    RAISE EXCEPTION 'FC41597F_ROLE_RESERVE_SCOPE_CHANGED';
  END IF;
  CREATE ROLE tenant_e9fdccd5d8c7685c_role NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
    NOREPLICATION NOBYPASSRLS PASSWORD NULL;
  -- The marker is data. The identifier is a literal in the reviewed function.
  EXECUTE format('COMMENT ON ROLE tenant_e9fdccd5d8c7685c_role IS %L', role_marker);
END;
$reserve$;

CREATE FUNCTION first_open_fc41597f.activate_role(role_marker text, target_oid oid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $activate$
DECLARE app_oid oid;
BEGIN
  IF session_user <> 'sf_fc41597f_lifecycle' OR role_marker IS NULL OR target_oid IS NULL OR
     role_marker !~ '^\{"kind":"role","nonce":"[a-f0-9]{32}","resourceGeneration":1,"schema":"techlong/express-bootstrap-owner/v3","stableIdentity":"e9fdccd5d8c7685cb005f423e7a87fc5849163882f4e2f3ca066f2c51cd9e74a","targetSha256":"2d8d208761607774922a06ce2949e96efecec9d8fc2f442203eea82526c682a4"\}$' THEN
    RAISE EXCEPTION 'FC41597F_ROLE_ACTIVATION_SCOPE_CHANGED';
  END IF;
  SELECT oid INTO app_oid FROM pg_roles WHERE rolname = 'tenant_e9fdccd5d8c7685c_role'
    AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
    AND rolconnlimit = -1 AND rolvaliduntil IS NULL AND rolconfig IS NULL
    AND shobj_description(oid, 'pg_authid') = role_marker;
  IF app_oid IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_database d WHERE d.oid = target_oid AND d.datname = 'tenant_e9fdccd5d8c7685c_db'
                    AND pg_get_userbyid(d.datdba) = session_user AND d.datallowconn AND NOT d.datistemplate
                    AND has_database_privilege(app_oid, d.oid, 'CONNECT'))
     OR EXISTS (SELECT 1 FROM pg_database d WHERE d.oid <> target_oid AND d.datallowconn
                AND has_database_privilege(app_oid, d.oid, 'CONNECT'))
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = app_oid)
     OR NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = app_oid AND pg_get_userbyid(member) = current_user
                    AND admin_option AND NOT inherit_option AND NOT set_option)
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = app_oid
                AND (pg_get_userbyid(member) <> current_user OR NOT admin_option OR inherit_option OR set_option))
  THEN
    RAISE EXCEPTION 'FC41597F_ROLE_ACTIVATION_SCOPE_CHANGED';
  END IF;
  GRANT rds_iam TO tenant_e9fdccd5d8c7685c_role WITH ADMIN FALSE, INHERIT FALSE, SET FALSE;
  ALTER ROLE tenant_e9fdccd5d8c7685c_role LOGIN;
END;
$activate$;

REVOKE ALL ON FUNCTION first_open_fc41597f.reserve_role(text), first_open_fc41597f.activate_role(text, oid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION first_open_fc41597f.reserve_role(text), first_open_fc41597f.activate_role(text, oid) TO sf_fc41597f_lifecycle;
RESET ROLE;
REVOKE CREATE ON SCHEMA first_open_fc41597f FROM sf_fc41597f_lifecycle_definer;
REVOKE SET OPTION FOR sf_fc41597f_lifecycle_definer FROM CURRENT_USER;

DO $isolation$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_database d WHERE d.datallowconn AND
             ((d.datname <> 'postgres' AND has_database_privilege('sf_fc41597f_lifecycle', d.oid, 'CONNECT')) OR
              has_database_privilege('tenant_e9fdccd5d8c7685c_inspect', d.oid, 'CONNECT')))
     OR NOT has_database_privilege('sf_fc41597f_lifecycle', 'postgres', 'CONNECT')
     OR has_database_privilege('sf_fc41597f_lifecycle', 'postgres', 'CREATE')
     OR EXISTS (SELECT 1 FROM pg_namespace n WHERE has_schema_privilege('sf_fc41597f_lifecycle', n.oid, 'CREATE'))
     OR pg_has_role('sf_fc41597f_lifecycle', 'sf_fc41597f_lifecycle_definer', 'MEMBER')
     OR pg_has_role('tenant_e9fdccd5d8c7685c_inspect', 'sf_fc41597f_lifecycle_definer', 'MEMBER')
     OR NOT has_function_privilege('sf_fc41597f_lifecycle', 'first_open_fc41597f.reserve_role(text)', 'EXECUTE')
     OR NOT has_function_privilege('sf_fc41597f_lifecycle', 'first_open_fc41597f.activate_role(text,oid)', 'EXECUTE')
     OR has_function_privilege('tenant_e9fdccd5d8c7685c_inspect', 'first_open_fc41597f.reserve_role(text)', 'EXECUTE')
     OR has_function_privilege('tenant_e9fdccd5d8c7685c_inspect', 'first_open_fc41597f.activate_role(text,oid)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'FC41597F_AURORA_INSTALL_UNEXPECTED_ACCESS';
  END IF;
END;
$isolation$;
COMMIT;
