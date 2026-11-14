-- PREPARATION ONLY, not applied. Fragment after separately approved promotion.draft.sql.
-- Caller BEGINs, binds the approved fixed-Secret password with set_config(...,$1,true),
-- submits this fragment exactly once, inspects and COMMITs; no retry/compensation.
SET LOCAL search_path = pg_catalog;
SET LOCAL password_encryption = 'scram-sha-256';
DO $publisher_password$
BEGIN
  IF current_setting('techlong_release.publisher_password',true) IS NULL OR
    current_setting('techlong_release.publisher_password',true) !~ '^[a-f0-9]{64}$' OR
    current_setting('techlong_release.publisher_password',true) = ANY(ARRAY[
      current_setting('techlong_release.planner_password',true),current_setting('techlong_release.executor_password',true),
      current_setting('techlong_release.verifier_password',true)]) THEN
    RAISE EXCEPTION 'RELEASE_PUBLISHER_PASSWORD_REQUIRED' USING ERRCODE='22023';
  END IF;
END
$publisher_password$;
CREATE ROLE deployment_release_publisher_login NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT deployment_release_publisher TO deployment_release_publisher_login WITH INHERIT TRUE;
GRANT deployment_release_publisher TO deployment_release_publisher_login WITH SET FALSE;
GRANT deployment_release_publisher TO deployment_release_publisher_login WITH ADMIN FALSE;
GRANT deployment_release_publisher_login TO SESSION_USER WITH INHERIT FALSE;
GRANT deployment_release_publisher_login TO SESSION_USER WITH SET FALSE;
ALTER ROLE deployment_release_publisher_login SET search_path = pg_catalog;
DO $publisher_login$
BEGIN
  IF NOT has_database_privilege('deployment_release_publisher_login',current_database(),'CONNECT') THEN
    RAISE EXCEPTION 'RELEASE_EXISTING_DATABASE_CONNECT_REQUIRED' USING ERRCODE='42501';
  END IF;
  EXECUTE format('ALTER ROLE deployment_release_publisher_login LOGIN PASSWORD %L',current_setting('techlong_release.publisher_password'));
END
$publisher_login$;
-- No owner membership, table DML, other LOGIN alteration, PUBLIC ACL change or credential generation.
