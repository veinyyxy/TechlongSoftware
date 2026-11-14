-- PREPARATION ONLY. NOT APPLIED. Do not replay schema.draft.sql or grants.draft.sql.
-- Transaction fragment, not a standalone installer. After separate approval the caller must:
-- BEGIN; set_config('techlong_release.<purpose>_password', $1, true) for each fixed purpose;
-- submit this whole fragment once; verify metadata; COMMIT; independently inspect/login.
-- Use three distinct 64-hex-character passwords from the exact reviewed Secret versions.
-- Never put real values into this file, argv, a parameter file, logs or a receipt.
SET LOCAL search_path = pg_catalog;
SET LOCAL password_encryption = 'scram-sha-256';
DO $release_passwords$
DECLARE
  p text := current_setting('techlong_release.planner_password', true);
  e text := current_setting('techlong_release.executor_password', true);
  v text := current_setting('techlong_release.verifier_password', true);
BEGIN
  IF p IS NULL OR e IS NULL OR v IS NULL
     OR p !~ '^[a-f0-9]{64}$' OR e !~ '^[a-f0-9]{64}$' OR v !~ '^[a-f0-9]{64}$'
     OR p=e OR p=v OR e=v THEN
    RAISE EXCEPTION 'RELEASE_THREE_DISTINCT_PASSWORDS_REQUIRED' USING ERRCODE='22023';
  END IF;
END
$release_passwords$;

CREATE ROLE deployment_release_planner_login NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE deployment_release_executor_login NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE deployment_release_verifier_login NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT deployment_release_planner TO deployment_release_planner_login WITH INHERIT TRUE;
GRANT deployment_release_planner TO deployment_release_planner_login WITH SET FALSE;
GRANT deployment_release_planner TO deployment_release_planner_login WITH ADMIN FALSE;
GRANT deployment_release_executor TO deployment_release_executor_login WITH INHERIT TRUE;
GRANT deployment_release_executor TO deployment_release_executor_login WITH SET FALSE;
GRANT deployment_release_executor TO deployment_release_executor_login WITH ADMIN FALSE;
GRANT deployment_release_verifier TO deployment_release_verifier_login WITH INHERIT TRUE;
GRANT deployment_release_verifier TO deployment_release_verifier_login WITH SET FALSE;
GRANT deployment_release_verifier TO deployment_release_verifier_login WITH ADMIN FALSE;
-- Close installer SET/INHERIT to the new login roles too; retain creator ADMIN explicitly.
GRANT deployment_release_planner_login, deployment_release_executor_login, deployment_release_verifier_login TO SESSION_USER WITH INHERIT FALSE;
GRANT deployment_release_planner_login, deployment_release_executor_login, deployment_release_verifier_login TO SESSION_USER WITH SET FALSE;
ALTER ROLE deployment_release_planner_login SET search_path = pg_catalog;
ALTER ROLE deployment_release_executor_login SET search_path = pg_catalog;
ALTER ROLE deployment_release_verifier_login SET search_path = pg_catalog;

DO $release_login$
BEGIN
  IF NOT has_database_privilege('deployment_release_planner_login', current_database(), 'CONNECT')
     OR NOT has_database_privilege('deployment_release_executor_login', current_database(), 'CONNECT')
     OR NOT has_database_privilege('deployment_release_verifier_login', current_database(), 'CONNECT') THEN
    RAISE EXCEPTION 'RELEASE_EXISTING_DATABASE_CONNECT_REQUIRED' USING ERRCODE='42501';
  END IF;
  EXECUTE format('ALTER ROLE deployment_release_planner_login LOGIN PASSWORD %L', current_setting('techlong_release.planner_password'));
  EXECUTE format('ALTER ROLE deployment_release_executor_login LOGIN PASSWORD %L', current_setting('techlong_release.executor_password'));
  EXECUTE format('ALTER ROLE deployment_release_verifier_login LOGIN PASSWORD %L', current_setting('techlong_release.verifier_password'));
END
$release_login$;
-- Only new roles/memberships change. No business/table DML, owner SET, LOGIN ALTER on
-- an old role, database ACL/PUBLIC changes, IF NOT EXISTS, compensation or automatic retry.
