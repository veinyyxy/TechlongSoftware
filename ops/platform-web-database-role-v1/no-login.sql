CREATE ROLE "techlong_platform_web_acceptance_v1" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5;
ALTER ROLE "techlong_platform_web_acceptance_v1" SET search_path TO pg_catalog, public, pg_temp;
GRANT USAGE ON SCHEMA public TO "techlong_platform_web_acceptance_v1";
GRANT SELECT ON TABLE public."users", public."workspaces", public."workspace_members", public."products", public."plans", public."subscriptions", public."app_instances", public."app_instance_templates", public."app_instance_template_versions", public."workspace_product_entitlements", public."app_instance_deployments", public."deployment_jobs", public."payment_records" TO "techlong_platform_web_acceptance_v1";
GRANT SELECT ("user_id", "password_hash", "password_salt", "password_iterations", "failed_attempts", "locked_until") ON TABLE public.user_credentials TO "techlong_platform_web_acceptance_v1";
GRANT UPDATE ("failed_attempts", "locked_until", "updated_at") ON TABLE public.user_credentials TO "techlong_platform_web_acceptance_v1";
GRANT SELECT, INSERT, DELETE ON TABLE public.auth_sessions TO "techlong_platform_web_acceptance_v1";
