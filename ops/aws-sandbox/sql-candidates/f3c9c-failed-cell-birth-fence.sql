-- F3c9c UNINSTALLED replacement candidate; exact reviewed transaction only. No business row
-- changes, legacy protection changes, certificate edits, roles or grants.
-- No IF NOT EXISTS, no permanent slot reset/replacement or automatic retry.
LOCK TABLE public.deployment_environments IN ACCESS EXCLUSIVE MODE;

CREATE TABLE public.deployment_failed_cell_birth_fences_v1 (
  environment_id text PRIMARY KEY REFERENCES public.deployment_environments(id) ON DELETE RESTRICT,
  fence_json text NOT NULL CHECK (octet_length(fence_json) <= 16384 AND jsonb_typeof(fence_json::jsonb) = 'object'),
  fence_sha256 text NOT NULL CHECK (fence_sha256 ~ '^[a-f0-9]{64}$'),
  created_at bigint NOT NULL CHECK (created_at > 0),
  CHECK (environment_id = 'env_aws_sandbox_ca_central_1'),
  CHECK (fence_sha256 = encode(sha256(convert_to(fence_json,'UTF8')),'hex'))
);
REVOKE ALL ON public.deployment_failed_cell_birth_fences_v1 FROM PUBLIC;

-- Replace only the ENVIRONMENT's transition function. No protected business
-- table trigger/function or registered sealed-plan fingerprint is replaced.
CREATE OR REPLACE FUNCTION public.enforce_deployment_environment_admission_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE database_now bigint := (extract(epoch FROM transaction_timestamp()) * 1000)::bigint;
BEGIN
  IF OLD.admission_state IN ('draining','failed_unadmitted') THEN
    IF ROW(NEW.admission_state,NEW.admission_epoch,NEW.admission_fence_sha256,NEW.admission_provision_operation_hash,
      NEW.admission_stack_id,NEW.admission_cell_expires_at,NEW.admission_changed_at) IS DISTINCT FROM
      ROW(OLD.admission_state,OLD.admission_epoch,OLD.admission_fence_sha256,OLD.admission_provision_operation_hash,
      OLD.admission_stack_id,OLD.admission_cell_expires_at,OLD.admission_changed_at) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='closed deployment environment admission fence is immutable';
    END IF;
  ELSIF NEW.admission_state='open' THEN
    IF ROW(NEW.admission_epoch,NEW.admission_fence_sha256,NEW.admission_provision_operation_hash,NEW.admission_stack_id,
      NEW.admission_cell_expires_at,NEW.admission_changed_at) IS DISTINCT FROM ROW(OLD.admission_epoch,OLD.admission_fence_sha256,
      OLD.admission_provision_operation_hash,OLD.admission_stack_id,OLD.admission_cell_expires_at,OLD.admission_changed_at) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='open deployment environment admission metadata is immutable';
    END IF;
  ELSIF NEW.admission_state='draining' THEN
    IF NEW.admission_epoch<>OLD.admission_epoch+1 OR NEW.admission_changed_at<>database_now OR NEW.admission_cell_expires_at>database_now THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='deployment environment admission drain is invalid or early';
    END IF;
  ELSIF NEW.admission_state='failed_unadmitted' THEN
    IF OLD.admission_epoch<>0 OR NEW.admission_epoch<>1 OR NEW.admission_changed_at<>database_now
      OR NEW.admission_provision_operation_hash IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM public.deployment_failed_cell_birth_fences_v1 f WHERE f.environment_id=NEW.id
        AND f.fence_sha256=NEW.admission_fence_sha256 AND f.created_at=database_now
        AND f.fence_json::jsonb->>'stackId'=NEW.admission_stack_id
        AND (f.fence_json::jsonb->>'cellExpiresAt')::bigint=NEW.admission_cell_expires_at
      ) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='failed birth transition requires exact unadmitted fence'; END IF;
  ELSE RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='deployment environment admission transition is invalid';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.deployment_environments DROP CONSTRAINT deployment_environments_admission_state_check;
ALTER TABLE public.deployment_environments ADD CONSTRAINT deployment_environments_admission_state_check
  CHECK (admission_state IN ('open','draining','failed_unadmitted'));
ALTER TABLE public.deployment_environments DROP CONSTRAINT deployment_environments_admission_consistency_check;
ALTER TABLE public.deployment_environments ADD CONSTRAINT deployment_environments_admission_consistency_check CHECK (
 (admission_state='open' AND admission_epoch>=0 AND admission_fence_sha256 IS NULL AND admission_provision_operation_hash IS NULL
  AND admission_stack_id IS NULL AND admission_cell_expires_at IS NULL)
 OR (admission_state='draining' AND admission_epoch>0 AND admission_fence_sha256 IS NOT NULL AND admission_provision_operation_hash IS NOT NULL
  AND admission_stack_id IS NOT NULL AND admission_cell_expires_at IS NOT NULL AND admission_cell_expires_at>0 AND admission_changed_at>=admission_cell_expires_at)
 OR (admission_state='failed_unadmitted' AND admission_epoch=1 AND admission_fence_sha256 IS NOT NULL AND admission_provision_operation_hash IS NULL
  AND admission_stack_id IS NOT NULL AND admission_cell_expires_at IS NOT NULL AND admission_cell_expires_at>0 AND admission_changed_at>0)
);

CREATE FUNCTION public.reject_failed_cell_birth_fence_mutation_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='failed birth permanent fence is immutable'; END;
$$;
CREATE TRIGGER failed_birth_fence_mutation_v1 BEFORE UPDATE OR DELETE ON public.deployment_failed_cell_birth_fences_v1
 FOR EACH ROW EXECUTE FUNCTION public.reject_failed_cell_birth_fence_mutation_v1();
CREATE TRIGGER failed_birth_fence_truncate_v1 BEFORE TRUNCATE ON public.deployment_failed_cell_birth_fences_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.reject_failed_cell_birth_fence_mutation_v1();
ALTER TABLE public.deployment_failed_cell_birth_fences_v1 ENABLE ALWAYS TRIGGER failed_birth_fence_mutation_v1;
ALTER TABLE public.deployment_failed_cell_birth_fences_v1 ENABLE ALWAYS TRIGGER failed_birth_fence_truncate_v1;

CREATE FUNCTION public.guard_failed_cell_birth_environment_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='TRUNCATE' THEN
    IF EXISTS(SELECT 1 FROM public.deployment_failed_cell_birth_fences_v1) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='failed birth environment cannot be truncated';
    END IF;
    RETURN NULL;
  END IF;
  IF OLD.admission_state='failed_unadmitted' THEN
    IF TG_OP='DELETE' OR NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='failed birth environment is an immutable tombstone';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.admission_state='failed_unadmitted' AND ROW(NEW.id,NEW.key,NEW.name,NEW.kind,NEW.driver,NEW.expected_account_id,NEW.region,
    NEW.cell_key,NEW.base_domain,NEW.apply_enabled,NEW.policy,NEW.status,NEW.created_at,NEW.updated_at) IS DISTINCT FROM
    ROW(OLD.id,OLD.key,OLD.name,OLD.kind,OLD.driver,OLD.expected_account_id,OLD.region,OLD.cell_key,OLD.base_domain,OLD.apply_enabled,
    OLD.policy,OLD.status,OLD.created_at,OLD.updated_at) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='failed birth environment identity cannot change';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_failed_cell_birth_environment_v1() FROM PUBLIC;
CREATE TRIGGER failed_birth_environment_mutation_v1 BEFORE UPDATE OR DELETE ON public.deployment_environments
 FOR EACH ROW EXECUTE FUNCTION public.guard_failed_cell_birth_environment_v1();
CREATE TRIGGER failed_birth_environment_truncate_v1 BEFORE TRUNCATE ON public.deployment_environments
 FOR EACH STATEMENT EXECUTE FUNCTION public.guard_failed_cell_birth_environment_v1();
ALTER TABLE public.deployment_environments ENABLE ALWAYS TRIGGER failed_birth_environment_mutation_v1;
ALTER TABLE public.deployment_environments ENABLE ALWAYS TRIGGER failed_birth_environment_truncate_v1;
-- Existing capacity/deployment/resource guards lock this same environment row
-- and accept ONLY open. Always-enable its transition gate as well.
ALTER TABLE public.deployment_environments ENABLE ALWAYS TRIGGER deployment_environments_admission_transition;

CREATE FUNCTION public.begin_failed_cell_birth_fence_v1(input_json text, input_sha256 text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  v jsonb;
  e public.deployment_environments%ROWTYPE;
  now_ms bigint := (extract(epoch FROM transaction_timestamp())*1000)::bigint;
  identity_sha text;
  sealed_id constant text := 'dep_d00144511731f1c20991aa56';
  sealed_instance constant text := 'app_fb1962e93a9a4cc2acf046170593d9e3';
BEGIN
  IF input_json IS NULL OR octet_length(input_json)>16384 OR input_sha256 IS NULL OR input_sha256 !~ '^[a-f0-9]{64}$'
    OR input_sha256<>encode(sha256(convert_to(input_json,'UTF8')),'hex') THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='failed birth intent hash mismatch';
  END IF;
  v:=input_json::jsonb;
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(v))<>19
    OR v-ARRAY['schemaVersion','protocol','accountId','region','cellId','environmentId','birthIntentSha256','planSha256','templateCanonicalSha256',
      'stackId','ownerDeploymentId','generation','provisionEpoch','failureInventorySha256','failedPhase','failedStackStatus','cellExpiresAt','expectedAdmissionEpoch','environmentIdentitySha256']<>'{}'::jsonb
    OR v->>'schemaVersion'<>'1' OR v->>'protocol'<>'failed-cell-birth-exclusion-fence-v1' OR v->>'accountId'<>'402010193138'
    OR v->>'region'<>'ca-central-1' OR v->>'cellId'<>'cell-sandbox-1' OR v->>'environmentId'<>'env_aws_sandbox_ca_central_1'
    OR v->>'expectedAdmissionEpoch'<>'0' OR v->>'stackId' !~ '^arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    OR v->>'ownerDeploymentId' !~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$' OR v->>'failedPhase' NOT IN ('RESERVED','ARMED','PAID')
    OR v->>'failedStackStatus' NOT IN ('CREATE_FAILED','UPDATE_FAILED','ROLLBACK_FAILED','ROLLBACK_COMPLETE','UPDATE_ROLLBACK_FAILED','DELETE_FAILED')
    OR (v->>'generation')::bigint<1 OR (v->>'provisionEpoch')::bigint<1 OR (v->>'cellExpiresAt')::bigint<1
    OR (v->>'generation')::bigint>9007199254740991 OR (v->>'provisionEpoch')::bigint>9007199254740991 OR (v->>'cellExpiresAt')::bigint>9007199254740991
    OR EXISTS(SELECT 1 FROM jsonb_each(v) x WHERE
      (x.key IN ('schemaVersion','generation','provisionEpoch','cellExpiresAt','expectedAdmissionEpoch') AND jsonb_typeof(x.value) IS DISTINCT FROM 'number')
      OR (x.key NOT IN ('schemaVersion','generation','provisionEpoch','cellExpiresAt','expectedAdmissionEpoch') AND jsonb_typeof(x.value) IS DISTINCT FROM 'string'))
    OR EXISTS(SELECT 1 FROM jsonb_each_text(v) x WHERE x.key IN ('birthIntentSha256','planSha256','templateCanonicalSha256','failureInventorySha256','environmentIdentitySha256') AND x.value !~ '^[a-f0-9]{64}$')
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='failed birth intent fields invalid'; END IF;
  SELECT * INTO STRICT e FROM public.deployment_environments WHERE id=v->>'environmentId' FOR UPDATE;
  identity_sha:=encode(sha256(convert_to(jsonb_build_object('id',e.id,'key',e.key,'name',e.name,'kind',e.kind,'driver',e.driver,
    'expected_account_id',e.expected_account_id,'region',e.region,'cell_key',e.cell_key,'base_domain',e.base_domain,'apply_enabled',e.apply_enabled,
    'policy',e.policy,'status',e.status,'created_at',e.created_at,'updated_at',e.updated_at)::text,'UTF8')),'hex');
  IF e.kind<>'aws_sandbox' OR e.driver<>'aws_ecs_cell' OR e.expected_account_id<>'402010193138' OR e.region<>'ca-central-1'
    OR e.cell_key<>'cell-sandbox-1' OR e.base_domain<>'sandbox.techlong.cloud' OR e.status<>'active' OR e.apply_enabled<>0
    OR e.admission_state<>'open' OR e.admission_epoch<>0 OR identity_sha<>v->>'environmentIdentitySha256'
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='failed birth environment precondition changed'; END IF;
  -- The sealed historical plan is retained, never canceled or rewritten. Its
  -- protection/live fingerprint must be independently certified before delete.
  IF (SELECT count(*) FROM public.deployment_plan_only_isolations WHERE environment_id=e.id)<>1 OR NOT EXISTS (
    SELECT 1 FROM public.deployment_plan_only_isolations r JOIN public.deployment_plan_only_isolation_fences f USING(deployment_id)
    JOIN public.app_instance_deployments d ON d.id=r.deployment_id
    WHERE r.environment_id=e.id AND r.deployment_id=sealed_id AND r.app_instance_id=sealed_instance AND f.sealed AND f.sealed_at=r.sealed_at
    AND r.original_row_sha256=encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex')
    AND r.original_plan_bytes_sha256=encode(sha256(convert_to(d.desired_plan,'UTF8')),'hex') AND r.original_plan_hash=d.plan_hash
  ) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='failed birth historical seal is not exact'; END IF;
  IF EXISTS(SELECT 1 FROM public.app_instance_deployments d WHERE d.environment_id=e.id AND d.id<>sealed_id AND d.status NOT IN ('rolled_back','canceled'))
    OR EXISTS(SELECT 1 FROM public.app_instances i JOIN public.app_instance_deployments d ON d.app_instance_id=i.id
      WHERE d.environment_id=e.id AND i.status IN ('pending','active') AND d.id<>sealed_id)
    OR EXISTS(SELECT 1 FROM public.deployment_environment_capacity_reservations WHERE environment_id=e.id)
    OR EXISTS(SELECT 1 FROM public.deployment_tenant_resources WHERE environment_id=e.id AND lifecycle_status<>'destroyed')
    OR EXISTS(SELECT 1 FROM public.deployment_cleanup_schedules WHERE environment_id=e.id AND status NOT IN ('succeeded','canceled'))
    OR EXISTS(SELECT 1 FROM public.deployment_jobs j JOIN public.app_instance_deployments d ON d.id=j.deployment_id
      WHERE d.environment_id=e.id AND j.status IN ('pending','running','retry_wait'))
    OR EXISTS(SELECT 1 FROM public.deployment_step_runs s JOIN public.app_instance_deployments d ON d.id=s.deployment_id
      WHERE d.environment_id=e.id AND s.status IN ('pending','running'))
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='failed birth is not unadmitted zero ownership'; END IF;
  INSERT INTO public.deployment_failed_cell_birth_fences_v1(environment_id,fence_json,fence_sha256,created_at) VALUES (e.id,input_json,input_sha256,now_ms);
  UPDATE public.deployment_environments SET admission_state='failed_unadmitted',admission_epoch=1,admission_fence_sha256=input_sha256,
    admission_provision_operation_hash=NULL,admission_stack_id=v->>'stackId',admission_cell_expires_at=(v->>'cellExpiresAt')::bigint,admission_changed_at=now_ms WHERE id=e.id;
  RETURN input_sha256;
END;
$$;
REVOKE ALL ON FUNCTION public.begin_failed_cell_birth_fence_v1(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_failed_cell_birth_fence_mutation_v1() FROM PUBLIC;
-- New privileges, registration and failed state are NOT installed by this file
-- automatically. The eventual reviewed installer owns its exact fresh slot.
