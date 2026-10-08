-- UNREGISTERED scope candidate, NOT approved and NOT an automatic migration.
-- Exact roles begin NOLOGIN; credentials/Secrets/login activation require separate reviewed scope.
-- Never grant membership in an owner or administrative role; never use these as tenant roles.
CREATE ROLE techlong_cell_cleanup_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
ALTER ROLE techlong_cell_cleanup_reader SET default_transaction_read_only = on;
GRANT USAGE ON SCHEMA public TO techlong_cell_cleanup_reader;
GRANT SELECT ON public.deployment_environments,public.app_instance_deployments,public.app_instances,
 public.deployment_plan_only_isolations,public.deployment_plan_only_isolation_fences,
 public.deployment_environment_capacity_reservations,public.deployment_tenant_resources,public.deployment_cleanup_schedules
 TO techlong_cell_cleanup_reader;

-- Runtime loader's exact username is techlong_cell_drain (not the historical draft alias *_writer).
CREATE ROLE techlong_cell_drain NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO techlong_cell_drain;
GRANT SELECT ON public.deployment_environments,public.app_instance_deployments,public.deployment_tenant_resources,public.deployment_jobs TO techlong_cell_drain;
GRANT UPDATE(admission_state,admission_epoch,admission_fence_sha256,admission_provision_operation_hash,
 admission_stack_id,admission_cell_expires_at,admission_changed_at) ON public.deployment_environments TO techlong_cell_drain;
-- PostgreSQL SELECT ... FOR UPDATE requires an UPDATE privilege on at least one column.
-- The two reviewed SQL statements only lock these rows, never update these timestamps.
GRANT UPDATE(updated_at) ON public.app_instance_deployments,public.deployment_tenant_resources TO techlong_cell_drain;
GRANT INSERT(id,deployment_id,job_type,dedupe_key,status,payload,attempts,max_attempts,available_at,created_at,updated_at)
 ON public.deployment_jobs TO techlong_cell_drain;
-- No DELETE/TRUNCATE, DDL/schema CREATE, registry/fence mutation or function EXECUTE grants.
-- Column grants are not row filters: timestamp/queue/admission capabilities must be approved explicitly.
