import { SANDBOX_REGISTRATION_WORKSPACE } from "../../lib/auth/sandbox-registration.ts";
import { PASSWORD_ITERATIONS } from "../../lib/auth/security.ts";

// Render for offline review only. The privately approved normalized-email digest
// is supplied outside source control; this module does not connect or install.
export function sandboxRegistrationDdl(approvedEmailSha256: string): string {
  if (typeof approvedEmailSha256 !== "string" || approvedEmailSha256.length !== 64 ||
      !/^[0-9a-f]{64}$/.test(approvedEmailSha256)) {
    throw new Error("Expected a privately approved normalized-email SHA-256");
  }
  return `BEGIN;
CREATE ROLE techlong_sandbox_registration_definer NOLOGIN NOINHERIT NOSUPERUSER
  NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA sandbox_registration AUTHORIZATION techlong_sandbox_registration_definer;
REVOKE ALL ON SCHEMA sandbox_registration FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO techlong_sandbox_registration_definer;
GRANT INSERT (id, email, name, status, is_platform_admin, created_at, updated_at)
  ON public.users TO techlong_sandbox_registration_definer;
GRANT INSERT (id, name, owner_id, status, contact_name, contact_email,
  subscription_status, app_instance_status, created_at, updated_at)
  ON public.workspaces TO techlong_sandbox_registration_definer;
GRANT INSERT (id, workspace_id, user_id, role, joined_at)
  ON public.workspace_members TO techlong_sandbox_registration_definer;
GRANT INSERT (user_id, password_hash, password_salt, password_iterations,
  password_changed_at, created_at, updated_at)
  ON public.user_credentials TO techlong_sandbox_registration_definer;

CREATE FUNCTION sandbox_registration.register_account(
  p_email text, p_name text, p_hash text, p_salt text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, pg_temp
AS $register$
DECLARE
  new_user_id text;
  new_workspace_id text;
  new_membership_id text;
  created_ms bigint;
BEGIN
  IF p_email IS NULL OR p_name IS NULL OR p_hash IS NULL OR p_salt IS NULL
     OR char_length(p_email) > 320 OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
     OR encode(sha256(convert_to(p_email, 'UTF8')), 'hex') COLLATE "C"
        <> '${approvedEmailSha256}'
     OR char_length(btrim(p_name)) NOT BETWEEN 2 AND 100
     OR char_length(p_hash) <> 64 OR p_hash COLLATE "C" !~ '^[0-9a-f]{64}$'
     OR char_length(p_salt) <> 32 OR p_salt COLLATE "C" !~ '^[0-9a-f]{32}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Registration input outside approved scope';
  END IF;

  new_user_id := 'usr_' || left(encode(sha256(convert_to('usr:' || p_email, 'UTF8')), 'hex'), 24);
  new_workspace_id := 'wsp_' || left(encode(sha256(convert_to('wsp:' || new_user_id, 'UTF8')), 'hex'), 24);
  new_membership_id := 'wsm_' || left(encode(sha256(convert_to('wsm:' || new_workspace_id || ':' || new_user_id, 'UTF8')), 'hex'), 24);
  created_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;

  INSERT INTO public.users (id, email, name, status, is_platform_admin, created_at, updated_at)
    VALUES (new_user_id, p_email, btrim(p_name), 'active', 0, created_ms, created_ms);
  INSERT INTO public.workspaces (id, name, owner_id, status, contact_name, contact_email,
    subscription_status, app_instance_status, created_at, updated_at)
    VALUES (new_workspace_id, '${SANDBOX_REGISTRATION_WORKSPACE}', new_user_id,
      'active', btrim(p_name), p_email, 'not_configured', 'not_provisioned', created_ms, created_ms);
  INSERT INTO public.workspace_members (id, workspace_id, user_id, role, joined_at)
    VALUES (new_membership_id, new_workspace_id, new_user_id, 'owner', created_ms);
  INSERT INTO public.user_credentials (user_id, password_hash, password_salt, password_iterations,
    password_changed_at, created_at, updated_at)
    VALUES (new_user_id, p_hash, p_salt, ${PASSWORD_ITERATIONS}, created_ms, created_ms, created_ms);
  RETURN new_user_id;
END;
$register$;
ALTER FUNCTION sandbox_registration.register_account(text, text, text, text)
  OWNER TO techlong_sandbox_registration_definer;
REVOKE ALL ON FUNCTION sandbox_registration.register_account(text, text, text, text) FROM PUBLIC;
GRANT USAGE ON SCHEMA sandbox_registration TO techlong_platform_web_acceptance_v1;
GRANT EXECUTE ON FUNCTION sandbox_registration.register_account(text, text, text, text)
  TO techlong_platform_web_acceptance_v1;
COMMIT;`;
}
