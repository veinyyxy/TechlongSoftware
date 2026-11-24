-- REVIEW/INSTALL TEMPLATE ONLY. Not approval and no cleanup is invoked here.
-- A separately approved DBA installation must use verified TLS to the exact
-- sandbox Express writer and maintenance database postgres. SQL alone cannot
-- authenticate the AWS cluster/endpoint or distinguish IAM session names for
-- the same SQL LOGIN. The supervised caller must verify those boundaries and
-- authenticated g1/e1 lineage/approval before any separate cleanup call.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL standard_conforming_strings = on;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $install_guard$
DECLARE manager oid; definer oid; dba oid; preimage jsonb;
BEGIN
  SELECT oid INTO dba FROM pg_roles WHERE rolname = 'postgres';
  SELECT oid INTO manager FROM pg_roles WHERE rolname = 'sf_fc41597f_lifecycle'
    AND rolcanlogin AND rolcreatedb AND NOT (rolsuper OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls)
    AND rolconnlimit = 2 AND rolconfig IS NULL AND rolvaliduntil IS NULL;
  SELECT oid INTO definer FROM pg_roles WHERE rolname = 'sf_fc41597f_lifecycle_definer'
    AND rolcreaterole AND NOT (rolcanlogin OR rolcreatedb OR rolsuper OR rolinherit OR rolreplication OR rolbypassrls)
    AND rolconnlimit = -1 AND rolconfig IS NULL AND rolvaliduntil IS NULL;
  IF current_database() <> 'postgres' OR session_user <> 'postgres' OR current_user <> session_user
     OR current_setting('server_version_num')::integer <> 170009 OR pg_is_in_recovery()
     OR NOT EXISTS (SELECT 1 FROM pg_database WHERE oid = 5 AND datname = 'postgres' AND datdba = 16410 AND datallowconn)
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE oid = 16389 AND rolname = 'rds_iam')
     OR manager IS NULL OR definer IS NULL
     OR (SELECT count(*) FROM pg_auth_members WHERE member = manager) <> 1
     OR (SELECT count(*) FROM pg_auth_members WHERE member = definer) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = manager AND roleid = 16389
                    AND NOT (admin_option OR inherit_option OR set_option))
     OR NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = definer AND roleid = 16389
                    AND admin_option AND NOT (inherit_option OR set_option))
     OR EXISTS (SELECT 1 FROM pg_db_role_setting WHERE setrole IN (manager, definer))
     OR (SELECT count(*) FROM pg_auth_members WHERE roleid = definer) > 1
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = definer AND
                (member <> dba OR inherit_option OR set_option OR (NOT admin_option AND grantor = dba)))
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'first_open_fc41597f') <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('first_open_fc41597f.reserve_role(text)')
                    AND proowner = definer AND prosecdef
                    AND encode(sha256(convert_to(replace(prosrc, chr(13) || chr(10), chr(10)), 'UTF8')), 'hex') =
                        'f0797e80eb82c893a16f862e0dca5f8e95eb538aaa4530b72cd73030050a20a7')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('first_open_fc41597f.activate_role(text,oid)')
                    AND proowner = definer AND prosecdef
                    AND encode(sha256(convert_to(replace(prosrc, chr(13) || chr(10), chr(10)), 'UTF8')), 'hex') =
                        '1c0a81ea642c6ce80b469bfe6f5f167388cc8d0dd927b7d25aa930a04f9bd615')
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'first_open_fc41597f_cleanup')
     OR EXISTS (SELECT 1 FROM pg_database WHERE datname = 'tenant_e9fdccd5d8c7685c_db')
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_e9fdccd5d8c7685c_role')
  THEN
    RAISE EXCEPTION 'FC41597F_CLEANUP_INSTALL_SCOPE_CHANGED';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.oid), '[]'::jsonb) INTO preimage
    FROM pg_auth_members m WHERE roleid = definer;
  PERFORM set_config('techlong.fc41597f_cleanup_definer_preimage', preimage::text, true);
END;
$install_guard$;

CREATE SCHEMA first_open_fc41597f_cleanup;
REVOKE ALL ON SCHEMA first_open_fc41597f_cleanup FROM PUBLIC;
GRANT USAGE ON SCHEMA first_open_fc41597f_cleanup TO sf_fc41597f_lifecycle;
GRANT USAGE, CREATE ON SCHEMA first_open_fc41597f_cleanup TO sf_fc41597f_lifecycle_definer;
GRANT sf_fc41597f_lifecycle_definer TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
SET LOCAL ROLE sf_fc41597f_lifecycle_definer;

CREATE FUNCTION first_open_fc41597f_cleanup.cleanup_role(role_marker text, target_role_oid oid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $cleanup_role$
DECLARE app_can_login boolean;
BEGIN
  IF session_user <> 'sf_fc41597f_lifecycle' OR current_user <> 'sf_fc41597f_lifecycle_definer'
     OR current_database() <> 'postgres' OR current_setting('server_version_num')::integer <> 170009 OR pg_is_in_recovery()
     OR NOT EXISTS (SELECT 1 FROM pg_database WHERE oid = 5 AND datname = 'postgres' AND datdba = 16410 AND datallowconn)
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE oid = 16389 AND rolname = 'rds_iam')
     OR target_role_oid IS NULL OR target_role_oid = 0 OR role_marker IS NULL
     OR role_marker !~ '^\{"kind":"role","nonce":"[a-f0-9]{32}","resourceGeneration":1,"schema":"techlong/express-bootstrap-owner/v3","stableIdentity":"e9fdccd5d8c7685cb005f423e7a87fc5849163882f4e2f3ca066f2c51cd9e74a","targetSha256":"2d8d208761607774922a06ce2949e96efecec9d8fc2f442203eea82526c682a4"\}$'
  THEN
    RAISE EXCEPTION 'FC41597F_CLEANUP_ROLE_SCOPE_CHANGED';
  END IF;
  -- Coordinates the fixed repository writers only; an independent DBA must
  -- not mutate these objects concurrently. No privileges on system tables.
  IF NOT pg_try_advisory_xact_lock(hashtextextended(
    '{"generation":1,"schema":"techlong/express-bootstrap-lock/v3","stableIdentity":"e9fdccd5d8c7685cb005f423e7a87fc5849163882f4e2f3ca066f2c51cd9e74a"}', 0)) THEN
    RAISE EXCEPTION 'FC41597F_CLEANUP_ROLE_LOCK_BUSY';
  END IF;

  SELECT rolcanlogin INTO app_can_login FROM pg_roles
    WHERE oid = target_role_oid AND rolname = 'tenant_e9fdccd5d8c7685c_role'
      AND NOT (rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
      AND rolconnlimit = -1 AND rolvaliduntil IS NULL AND rolconfig IS NULL
      AND shobj_description(oid, 'pg_authid') = role_marker;
  IF app_can_login IS NULL
     OR EXISTS (SELECT 1 FROM pg_database WHERE datname = 'tenant_e9fdccd5d8c7685c_db')
     OR EXISTS (SELECT 1 FROM pg_database d WHERE d.datallowconn AND has_database_privilege(target_role_oid, d.oid, 'CONNECT'))
     OR EXISTS (SELECT 1 FROM pg_stat_activity WHERE usesysid = target_role_oid OR usename = 'tenant_e9fdccd5d8c7685c_role')
     OR EXISTS (SELECT 1 FROM pg_db_role_setting WHERE setrole = target_role_oid)
     OR EXISTS (SELECT 1 FROM pg_shdepend WHERE refclassid = 'pg_catalog.pg_authid'::regclass AND refobjid = target_role_oid)
     OR (SELECT count(*) FROM pg_auth_members WHERE roleid = target_role_oid) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = target_role_oid
                    AND pg_get_userbyid(m.member) = current_user AND pg_get_userbyid(m.grantor) = 'rdsadmin'
                    AND m.admin_option AND NOT (m.inherit_option OR m.set_option))
     OR (SELECT count(*) FROM pg_auth_members WHERE member = target_role_oid) <> (CASE WHEN app_can_login THEN 1 ELSE 0 END)
     OR (app_can_login AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = target_role_oid AND m.roleid = 16389
                                     AND pg_get_userbyid(m.grantor) = current_user
                                     AND NOT (m.admin_option OR m.inherit_option OR m.set_option)))
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE grantor = target_role_oid)
  THEN
    RAISE EXCEPTION 'FC41597F_CLEANUP_ROLE_SCOPE_CHANGED';
  END IF;

  -- The only retirement operation in this RPC: no dynamic identifiers,
  -- cascading, privilege stripping, backend termination, or database drop.
  DROP ROLE tenant_e9fdccd5d8c7685c_role;
END;
$cleanup_role$;

REVOKE ALL ON FUNCTION first_open_fc41597f_cleanup.cleanup_role(text, oid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION first_open_fc41597f_cleanup.cleanup_role(text, oid) TO sf_fc41597f_lifecycle;
RESET ROLE;
REVOKE CREATE ON SCHEMA first_open_fc41597f_cleanup FROM sf_fc41597f_lifecycle_definer;
REVOKE SET OPTION FOR sf_fc41597f_lifecycle_definer FROM CURRENT_USER;

DO $install_check$
DECLARE postimage jsonb; dba oid := 'postgres'::regrole;
        preimage jsonb := current_setting('techlong.fc41597f_cleanup_definer_preimage')::jsonb;
BEGIN
  -- PostgreSQL may add a separate edge for this grantor even if the DBA was
  -- already a member via the provider. Remove only the new, now inert self
  -- edge; never revoke or modify a provider grant as a fallback.
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(preimage) m WHERE (m->>'grantor')::oid = dba)
     AND EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = 'sf_fc41597f_lifecycle_definer'::regrole
                 AND member = dba AND grantor = dba AND NOT (admin_option OR inherit_option OR set_option))
  THEN
    REVOKE sf_fc41597f_lifecycle_definer FROM CURRENT_USER GRANTED BY CURRENT_USER;
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.oid), '[]'::jsonb) INTO postimage
    FROM pg_auth_members m WHERE roleid = 'sf_fc41597f_lifecycle_definer'::regrole;
  IF postimage IS DISTINCT FROM preimage
     OR has_schema_privilege('sf_fc41597f_lifecycle_definer', 'first_open_fc41597f_cleanup', 'CREATE')
     OR has_schema_privilege('sf_fc41597f_lifecycle', 'first_open_fc41597f_cleanup', 'CREATE')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('first_open_fc41597f_cleanup.cleanup_role(text,oid)')
                    AND p.prosecdef AND p.proowner = 'sf_fc41597f_lifecycle_definer'::regrole
                    AND has_function_privilege('sf_fc41597f_lifecycle', p.oid, 'EXECUTE')
                    AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                    WHERE a.grantee <> p.proowner AND
                                    (a.grantee <> 'sf_fc41597f_lifecycle'::regrole OR a.grantor <> p.proowner OR a.is_grantable)))
  THEN
    RAISE EXCEPTION 'FC41597F_CLEANUP_INSTALL_UNEXPECTED_ACCESS';
  END IF;
END;
$install_check$;
COMMIT;
