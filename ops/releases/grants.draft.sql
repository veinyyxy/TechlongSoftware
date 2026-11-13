-- D2-2 DRAFT_NOT_APPLIED. Separate approval required; no passwords, LOGIN, Secrets or IAM.
-- Apply only after schema.draft.sql is independently installed and verified.
BEGIN;
CREATE ROLE deployment_release_planner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE deployment_release_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE deployment_release_verifier NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT USAGE ON SCHEMA deployment_release TO deployment_release_planner,deployment_release_executor,deployment_release_verifier;
GRANT EXECUTE ON FUNCTION deployment_release.read_context(text),deployment_release.read_request(text)
  TO deployment_release_planner,deployment_release_executor,deployment_release_verifier;
GRANT EXECUTE ON FUNCTION deployment_release.prepare_request(text,text),deployment_release.record_decision(text,text) TO deployment_release_planner;
GRANT EXECUTE ON FUNCTION deployment_release.claim_request(text,text,text,integer,text),
  deployment_release.record_operation(text,text,text,text,text,text),deployment_release.complete_request(text,text),
  deployment_release.stop_request(text,text,text,text)
  TO deployment_release_executor;
GRANT EXECUTE ON FUNCTION deployment_release.record_inspection(text,jsonb) TO deployment_release_verifier;
-- No table DML, role memberships, owner grants or DEFAULT PRIVILEGES for runtime identities.
-- These are per-environment operators, NOT row-level customer isolation. Future LOGIN bindings
-- must keep planner/executor/verifier credentials independent; the executor cannot attest its own result.
COMMIT;
