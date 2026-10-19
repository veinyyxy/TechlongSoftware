-- CANDIDATE ONLY. Not in automatic migrations; install requires separate approval.
-- No password, LOGIN, business mutation, AWS call or old-slot reset.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';
SELECT pg_catalog.pg_advisory_xact_lock(718061926);
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_namespace WHERE nspname='deployment_control_v6') OR
     EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname='techlong_deployment_controller_v6') THEN
    RAISE EXCEPTION 'CONTROL_INSTALL_SLOT_OCCUPIED';
  END IF;
END $$;
CREATE ROLE techlong_deployment_controller_v6 NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA deployment_control_v6;
REVOKE ALL ON SCHEMA deployment_control_v6 FROM PUBLIC;
GRANT USAGE ON SCHEMA deployment_control_v6 TO techlong_deployment_controller_v6;

CREATE TABLE deployment_control_v6.plans (
  plan_sha text PRIMARY KEY CHECK(plan_sha ~ '^[a-f0-9]{64}$'),
  action_sha text NOT NULL CHECK(action_sha ~ '^[a-f0-9]{64}$'),
  risk_sha text NOT NULL CHECK(risk_sha ~ '^[a-f0-9]{64}$'),
  job_id text NOT NULL REFERENCES public.deployment_jobs(id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK(mode IN ('Review','RunOnce','Inspect')),
  body jsonb NOT NULL CHECK(jsonb_typeof(body)='object' AND octet_length(body::text)<=16000),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(job_id <> 'job_ecbf09030d3da7286ea3ef93')
);
CREATE TABLE deployment_control_v6.approvals (
  plan_sha text PRIMARY KEY REFERENCES deployment_control_v6.plans ON DELETE RESTRICT,
  admin_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE deployment_control_v6.dispatch_attempts (
  plan_sha text PRIMARY KEY REFERENCES deployment_control_v6.approvals ON DELETE RESTRICT,
  job_id text NOT NULL,
  mode text NOT NULL CHECK(mode IN ('Review','RunOnce','Inspect')),
  state text NOT NULL CHECK(state IN ('SUBMISSION_STARTED','ACKNOWLEDGED','UNKNOWN','OBSERVED')),
  run_id text UNIQUE CHECK(run_id ~ '^[1-9][0-9]{0,15}$'),
  run_status text CHECK(run_status IN ('queued','requested','waiting','pending','in_progress','completed')),
  conclusion text CHECK(conclusion IN ('success','failure','cancelled','timed_out','action_required','neutral','skipped','stale','startup_failure')),
  proof_sha text CHECK(proof_sha ~ '^[a-f0-9]{64}$'),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  observed_at timestamptz,
  UNIQUE(job_id,mode), -- permanent across refreshed plans; no retry/reset interface
  CHECK((state IN ('ACKNOWLEDGED','OBSERVED')) = (run_id IS NOT NULL)),
  CHECK(run_status IS DISTINCT FROM 'completed' OR conclusion IS NOT NULL),
  CHECK(conclusion IS NULL OR run_status='completed')
);

-- Owner/publisher only. The platform credential is NOT granted this function.
-- The publisher must authenticate/validate the reviewed capsule and canonical
-- SHA in code before this call; SQL JSONB text is not JS canonical JSON.
CREATE FUNCTION deployment_control_v6.publish_plan(p_sha text,a_sha text,r_sha text,p_body jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF p_body->>'schema' IS DISTINCT FROM 'techlong/platform-controller-plan/v6' OR
    p_body->>'instanceId' IS DISTINCT FROM 'app_e897a4377bce498b9c5ee9e64509dcad' OR
    p_body->>'deploymentId' IS DISTINCT FROM 'dep_7c99bd249470184852f0dc74' OR
    p_body->>'riskSha256' IS DISTINCT FROM r_sha OR
    (p_body->>'expiresAt')::numeric <= extract(epoch FROM clock_timestamp())*1000 OR
    NOT EXISTS (SELECT FROM public.deployment_jobs j JOIN public.app_instance_deployments d ON d.id=j.deployment_id
      WHERE j.id=p_body->>'jobId' AND d.id=p_body->>'deploymentId' AND d.app_instance_id=p_body->>'instanceId'
        AND d.mode='aws_sandbox' AND d.status='ready' AND j.job_type='reconcile') THEN
    RAISE EXCEPTION 'CONTROL_PUBLISH_SCOPE';
  END IF;
  INSERT INTO deployment_control_v6.plans(plan_sha,action_sha,risk_sha,job_id,mode,body,expires_at)
    VALUES(p_sha,a_sha,r_sha,p_body->>'jobId',p_body->>'mode',p_body,to_timestamp((p_body->>'expiresAt')::double precision/1000));
END $$;

CREATE FUNCTION deployment_control_v6.load_plan(p_sha text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT jsonb_build_object('plan',p.body,'planSha256',p.plan_sha,'actionSha256',p.action_sha,'riskSha256',p.risk_sha,
    'attempt',CASE WHEN a.plan_sha IS NULL THEN NULL ELSE jsonb_build_object('state',a.state,'runId',a.run_id,
      'status',a.run_status,'conclusion',a.conclusion,'proofSha256',a.proof_sha) END)
  FROM deployment_control_v6.plans p LEFT JOIN deployment_control_v6.dispatch_attempts a USING(plan_sha) WHERE p.plan_sha=p_sha
$$;

CREATE FUNCTION deployment_control_v6.begin_dispatch(p_sha text,a_sha text,r_sha text,admin text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p deployment_control_v6.plans%ROWTYPE; previous deployment_control_v6.dispatch_attempts%ROWTYPE;
BEGIN
  SELECT * INTO STRICT p FROM deployment_control_v6.plans WHERE plan_sha=p_sha FOR UPDATE;
  PERFORM 1 FROM public.users WHERE id=admin AND status='active' AND is_platform_admin=1 FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTROL_ADMIN_REQUIRED'; END IF;
  IF p.action_sha IS DISTINCT FROM a_sha OR p.risk_sha IS DISTINCT FROM r_sha OR clock_timestamp()>=p.expires_at THEN
    RAISE EXCEPTION 'CONTROL_APPROVAL_EXPIRED_OR_CHANGED';
  END IF;
  PERFORM 1 FROM public.deployment_jobs j JOIN public.app_instance_deployments d ON d.id=j.deployment_id
    WHERE j.id=p.job_id AND d.id='dep_7c99bd249470184852f0dc74' AND d.app_instance_id='app_e897a4377bce498b9c5ee9e64509dcad'
      AND d.mode='aws_sandbox' AND d.status='ready' AND j.job_type='reconcile'
      AND (CASE WHEN p.mode='Inspect' THEN j.status IN ('succeeded','dead_letter','canceled')
        ELSE j.status='pending' AND j.attempts=0 AND j.max_attempts=1 AND j.lease_owner IS NULL
          AND j.available_at=9007199254740991 AND j.payload::jsonb->>'kind'='express_initialized_request_v4' END)
    FOR SHARE OF j,d;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTROL_JOB_DRIFT'; END IF;
  IF p.mode<>'Review' THEN
    SELECT * INTO STRICT previous FROM deployment_control_v6.dispatch_attempts
      WHERE plan_sha=p.body->'predecessor'->>'planSha256' FOR SHARE;
    IF previous.job_id IS DISTINCT FROM p.job_id OR previous.mode IS DISTINCT FROM (CASE WHEN p.mode='RunOnce' THEN 'Review' ELSE 'RunOnce' END) OR
      previous.state<>'OBSERVED' OR previous.run_status IS DISTINCT FROM 'completed' OR
      (p.mode='RunOnce' AND previous.conclusion IS DISTINCT FROM 'success') OR previous.proof_sha IS NULL OR
      previous.proof_sha IS DISTINCT FROM p.body->'predecessor'->>'proofSha256' OR
      previous.run_id IS DISTINCT FROM p.body->'predecessor'->>'runId' OR NOT EXISTS (
        SELECT FROM deployment_control_v6.plans prior WHERE prior.plan_sha=previous.plan_sha
          AND prior.body->>'sourceCommit'=p.body->>'sourceCommit' AND prior.body->>'releaseSha256'=p.body->>'releaseSha256')
      THEN RAISE EXCEPTION 'CONTROL_PREDECESSOR_NOT_ATTESTED'; END IF;
  END IF;
  INSERT INTO deployment_control_v6.approvals(plan_sha,admin_id) VALUES(p_sha,admin);
  INSERT INTO deployment_control_v6.dispatch_attempts(plan_sha,job_id,mode,state) VALUES(p_sha,p.job_id,p.mode,'SUBMISSION_STARTED');
END $$;

CREATE FUNCTION deployment_control_v6.assert_live(p_sha text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
  IF NOT EXISTS (SELECT FROM deployment_control_v6.plans p JOIN deployment_control_v6.dispatch_attempts a USING(plan_sha)
    JOIN deployment_control_v6.approvals approval USING(plan_sha) JOIN public.users u ON u.id=approval.admin_id
    JOIN public.deployment_jobs j ON j.id=p.job_id JOIN public.app_instance_deployments d ON d.id=j.deployment_id
    WHERE p.plan_sha=p_sha AND a.state='SUBMISSION_STARTED' AND clock_timestamp()<p.expires_at
      AND u.status='active' AND u.is_platform_admin=1 AND d.id='dep_7c99bd249470184852f0dc74'
      AND d.app_instance_id='app_e897a4377bce498b9c5ee9e64509dcad' AND d.mode='aws_sandbox' AND d.status='ready'
      AND j.job_type='reconcile' AND CASE WHEN p.mode='Inspect' THEN j.status IN ('succeeded','dead_letter','canceled')
        ELSE j.status='pending' AND j.attempts=0 AND j.max_attempts=1 AND j.lease_owner IS NULL
          AND j.available_at=9007199254740991 AND j.payload::jsonb->>'kind'='express_initialized_request_v4' END) THEN
    RAISE EXCEPTION 'CONTROL_INTENT_NOT_LIVE'; END IF;
END $$;

CREATE FUNCTION deployment_control_v6.acknowledge(p_sha text,r_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
  UPDATE deployment_control_v6.dispatch_attempts SET state='ACKNOWLEDGED',run_id=r_id WHERE plan_sha=p_sha AND state='SUBMISSION_STARTED';
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTROL_ACK_NOT_RECORDED'; END IF;
END $$;
CREATE FUNCTION deployment_control_v6.mark_unknown(p_sha text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  UPDATE deployment_control_v6.dispatch_attempts SET state='UNKNOWN' WHERE plan_sha=p_sha AND state='SUBMISSION_STARTED'
$$;
CREATE FUNCTION deployment_control_v6.observe_run(p_sha text,r_id text,r_status text,r_conclusion text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
  UPDATE deployment_control_v6.dispatch_attempts SET state='OBSERVED',run_status=r_status,conclusion=r_conclusion,observed_at=clock_timestamp()
    WHERE plan_sha=p_sha AND run_id=r_id AND state IN ('ACKNOWLEDGED','OBSERVED')
      AND (run_status IS DISTINCT FROM 'completed' OR (run_status=r_status AND conclusion IS NOT DISTINCT FROM r_conclusion));
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTROL_OBSERVATION_CONFLICT'; END IF;
END $$;

-- Only the separately reviewed trusted evidence publisher may attest a proof.
-- A success status or compromised platform DB credential cannot call this.
CREATE FUNCTION deployment_control_v6.attest_evidence(p_sha text,e_sha text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
  IF e_sha IS NULL OR e_sha !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CONTROL_PROOF_SHA_REQUIRED'; END IF;
  UPDATE deployment_control_v6.dispatch_attempts SET proof_sha=e_sha WHERE plan_sha=p_sha AND state='OBSERVED'
    AND run_status='completed' AND proof_sha IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTROL_PROOF_SLOT_OCCUPIED'; END IF;
END $$;
CREATE FUNCTION deployment_control_v6.status() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT coalesce(jsonb_agg(v ORDER BY created_at DESC),'[]'::jsonb) FROM (
    SELECT p.created_at,jsonb_build_object('planSha256',p.plan_sha,'actionSha256',p.action_sha,'riskSha256',p.risk_sha,
      'jobId',p.job_id,'mode',p.mode,'sourceCommit',p.body->>'sourceCommit','expiresAt',p.body->'expiresAt',
      'state',coalesce(a.state,CASE WHEN EXISTS(SELECT FROM deployment_control_v6.dispatch_attempts used
        WHERE used.job_id=p.job_id AND used.mode=p.mode) THEN 'SLOT_OCCUPIED'
        WHEN clock_timestamp()>=p.expires_at THEN 'EXPIRED' ELSE 'AWAITING_APPROVAL' END),
      'runId',a.run_id,'status',a.run_status,'conclusion',a.conclusion,
      'proofSha256',a.proof_sha) AS v FROM deployment_control_v6.plans p
      LEFT JOIN deployment_control_v6.dispatch_attempts a USING(plan_sha) ORDER BY p.created_at DESC LIMIT 12
  ) safe_rows
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA deployment_control_v6 FROM PUBLIC,techlong_deployment_controller_v6;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA deployment_control_v6 FROM PUBLIC,techlong_deployment_controller_v6;
GRANT EXECUTE ON FUNCTION deployment_control_v6.load_plan(text),deployment_control_v6.begin_dispatch(text,text,text,text),
  deployment_control_v6.assert_live(text),deployment_control_v6.acknowledge(text,text),deployment_control_v6.mark_unknown(text),
  deployment_control_v6.observe_run(text,text,text,text),deployment_control_v6.status() TO techlong_deployment_controller_v6;
DO $$ BEGIN
  IF has_schema_privilege('techlong_deployment_controller_v6','public','CREATE') OR
     has_database_privilege('techlong_deployment_controller_v6',current_database(),'CREATE') OR
     has_table_privilege('techlong_deployment_controller_v6','public.users','SELECT,INSERT,UPDATE,DELETE') OR
     has_table_privilege('techlong_deployment_controller_v6','public.deployment_jobs','SELECT,INSERT,UPDATE,DELETE') OR
     has_table_privilege('techlong_deployment_controller_v6','public.app_instance_deployments','SELECT,INSERT,UPDATE,DELETE') OR
     EXISTS(SELECT FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member WHERE r.rolname='techlong_deployment_controller_v6') THEN
    RAISE EXCEPTION 'CONTROL_INSTALL_PUBLIC_PRIVILEGE_REJECTED';
  END IF;
END $$;
COMMIT;
