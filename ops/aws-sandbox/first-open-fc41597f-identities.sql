-- First-open fc41597f identity reservation only. Roles remain NOLOGIN.
-- Must be submitted as one reviewed transaction on the pinned control DB.
BEGIN;
SET LOCAL search_path TO pg_catalog;
SET LOCAL lock_timeout TO '3s';
SET LOCAL statement_timeout TO '10s';

DO $first_open_guard$
BEGIN
  IF pg_catalog.current_database() <> 'neondb'
     OR CURRENT_USER <> 'neondb_owner' OR SESSION_USER <> 'neondb_owner'
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname = 'neondb' AND oid = 16396)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'neondb_owner' AND oid = 16392 AND (rolcreaterole OR rolsuper))
  THEN RAISE EXCEPTION 'FIRST_OPEN_IDENTITY_TARGET_OR_CREATEROLE'; END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN (
      'first_onboarding_fc41597f_claim_owner', 'first_onboarding_fc41597f_review',
      'first_onboarding_fc41597f_claim', 'first_onboarding_fc41597f_complete_owner',
      'first_onboarding_fc41597f_complete', 'first_onboarding_fc41597f_inspect'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname IN ('techlong_first_onboarding_claim','techlong_first_onboarding'))
  THEN RAISE EXCEPTION 'FIRST_OPEN_IDENTITY_NAME_CONFLICT'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.deployment_jobs j JOIN public.app_instance_deployments d ON d.id = j.deployment_id
    WHERE j.id = 'job_fc41597f9b5ba8e02b338ecf' AND d.id = 'dep_746535593025bf97a9efeccd'
      AND d.app_instance_id = 'app_bbd626d7d3806af686073211' AND d.subscription_id = 'sub_f0dea547d45bcd26ed823fd7'
      AND d.environment_id = 'env_aws_sandbox_ca_central_1' AND d.status = 'planned'
      AND d.plan_hash = 'caf7e2ba8134911dfcddf2cb0c36ee9303fd1fc992add720f83c99cac4eceee0'
      AND d.configuration_hash = 'c487421e94c331cd28139d88f4e8217d340d2207fe36db2fa3aaf35020b25534'
      AND j.status = 'pending' AND j.attempts = 0 AND j.max_attempts = 1 AND j.lease_owner IS NULL
      AND j.lease_token IS NULL AND j.lease_expires_at IS NULL AND j.completed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.deployment_tenant_resources r WHERE r.app_instance_id = d.app_instance_id)
      AND NOT EXISTS (SELECT 1 FROM public.deployment_tenant_external_operations x WHERE x.app_instance_id = d.app_instance_id)
      AND NOT EXISTS (SELECT 1 FROM deployment_release.instance_state s WHERE s.instance_id = d.app_instance_id)
  ) THEN RAISE EXCEPTION 'FIRST_OPEN_HELD_TASK_CHANGED'; END IF;
END $first_open_guard$;

CREATE ROLE first_onboarding_fc41597f_claim_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE first_onboarding_fc41597f_review NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE first_onboarding_fc41597f_claim NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE first_onboarding_fc41597f_complete_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE first_onboarding_fc41597f_complete NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE first_onboarding_fc41597f_inspect NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

COMMIT;
