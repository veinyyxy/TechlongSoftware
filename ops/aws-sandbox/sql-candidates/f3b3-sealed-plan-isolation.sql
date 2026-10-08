-- UNREGISTERED candidate. Install only in a separately approved transaction.
-- No business row updates, no old trigger replacement, no registration INSERT.
-- The two internal tables are limited to the exact reviewed historical plan.
LOCK TABLE public.app_instance_deployments IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE public.deployment_plan_only_isolation_fences (
  deployment_id text PRIMARY KEY REFERENCES public.app_instance_deployments(id) ON DELETE RESTRICT,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  sealed boolean NOT NULL DEFAULT false,
  sealed_at bigint,
  CHECK (deployment_id = 'dep_d00144511731f1c20991aa56'),
  CHECK ((NOT sealed AND sealed_at IS NULL) OR (sealed AND sealed_at > 0))
);
INSERT INTO public.deployment_plan_only_isolation_fences(deployment_id)
VALUES ('dep_d00144511731f1c20991aa56');

CREATE TABLE public.deployment_plan_only_isolations (
  deployment_id text PRIMARY KEY REFERENCES public.app_instance_deployments(id) ON DELETE RESTRICT,
  environment_id text NOT NULL CHECK (environment_id = 'env_aws_sandbox_ca_central_1'),
  app_instance_id text NOT NULL CHECK (app_instance_id = 'app_fb1962e93a9a4cc2acf046170593d9e3'),
  original_row_sha256 text NOT NULL CHECK (original_row_sha256 ~ '^[a-f0-9]{64}$'),
  original_plan_bytes_sha256 text NOT NULL CHECK (original_plan_bytes_sha256 ~ '^[a-f0-9]{64}$'),
  original_plan_hash text NOT NULL CHECK (original_plan_hash ~ '^[a-f0-9]{64}$'),
  business_state_sha256 text NOT NULL CHECK (business_state_sha256 ~ '^[a-f0-9]{64}$'),
  approved_registration_sha256 text NOT NULL CHECK (approved_registration_sha256 ~ '^[a-f0-9]{64}$'),
  protection_schema_sha256 text NOT NULL CHECK (protection_schema_sha256 ~ '^[a-f0-9]{64}$'),
  sealed_at bigint NOT NULL CHECK (sealed_at > 0),
  CHECK (deployment_id = 'dep_d00144511731f1c20991aa56')
);
REVOKE ALL ON public.deployment_plan_only_isolation_fences, public.deployment_plan_only_isolations FROM PUBLIC;

-- This fingerprints installed functions/triggers and the complete FK closure.
-- A new FK to the deployment table or a disabled guard makes proof unavailable.
-- It does NOT certify caller privileges or constitute an installation approval.
CREATE FUNCTION public.sealed_plan_protection_hash_v1() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  functions_json jsonb; triggers_json jsonb; references_json jsonb; tables_json jsonb;
  expected_references jsonb := '[
    "public.deployment_cleanup_schedules.deployment_id",
    "public.deployment_environment_capacity_reservations.deployment_id",
    "public.deployment_jobs.deployment_id",
    "public.deployment_plan_only_isolation_fences.deployment_id",
    "public.deployment_plan_only_isolations.deployment_id",
    "public.deployment_step_runs.deployment_id",
    "public.deployment_tenant_cleanup_runs.owner_deployment_id",
    "public.deployment_tenant_external_operation_events.deployment_id",
    "public.deployment_tenant_external_operations.owner_deployment_id",
    "public.deployment_tenant_resource_events.deployment_id",
    "public.deployment_tenant_resources.created_by_deployment_id",
    "public.deployment_tenant_resources.owner_deployment_id"]'::jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object('name', p.proname,
    'definition', pg_get_functiondef(p.oid), 'owner', p.proowner::regrole::text)
    ORDER BY p.proname) INTO functions_json
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname = ANY(ARRAY[
    'sealed_plan_protection_hash_v1','touch_sealed_plan_fence_v1','guard_sealed_plan_fence_v1',
    'guard_sealed_plan_deployment_v1','guard_sealed_plan_reference_v1',
    'validate_sealed_plan_registration_v1','finalize_sealed_plan_registration_v1','reject_sealed_plan_mutation_v1']);
  SELECT jsonb_agg(jsonb_build_object('table', c.relname,'name',t.tgname,
    'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) ORDER BY c.relname,t.tgname)
    INTO triggers_json FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgname LIKE 'aa_sealed_plan_%_v1';
  IF jsonb_array_length(functions_json) IS DISTINCT FROM 8
    OR jsonb_array_length(triggers_json) IS DISTINCT FROM 16
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(triggers_json) x WHERE x->>'enabled'<>'A') THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='sealed plan guard catalog incomplete';
  END IF;
  SELECT jsonb_agg(n.nspname||'.'||c.relname||'.'||a.attname ORDER BY n.nspname,c.relname,a.attname)
    INTO references_json FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL unnest(f.conkey) k(attnum)
    JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=k.attnum
    WHERE f.contype='f' AND f.confrelid='public.app_instance_deployments'::regclass;
  IF references_json IS DISTINCT FROM expected_references THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='sealed plan reference closure changed';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('name',c.relname,'owner',c.relowner::regrole::text,
    'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
    'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
      'notNull',a.attnotnull,'collation',a.attcollation::regcollation::text,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT jsonb_agg(jsonb_build_object('name',k.conname,'definition',pg_get_constraintdef(k.oid)) ORDER BY k.conname)
      FROM pg_constraint k WHERE k.conrelid=c.oid),
    'indexes',(SELECT jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY pg_get_indexdef(i.indexrelid)) FROM pg_index i WHERE i.indrelid=c.oid),
    'allTriggers',(SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid),
      'enabled',t.tgenabled,'function',pg_get_functiondef(t.tgfoid)) ORDER BY t.tgname)
      FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)) ORDER BY c.relname)
    INTO tables_json FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname=ANY(ARRAY[
      'app_instance_deployments','deployment_jobs','deployment_step_runs','deployment_cleanup_schedules',
      'deployment_environment_capacity_reservations','deployment_tenant_resources','deployment_tenant_resource_events',
      'deployment_tenant_external_operations','deployment_tenant_external_operation_events','deployment_tenant_cleanup_runs',
      'deployment_plan_only_isolations','deployment_plan_only_isolation_fences']);
  IF jsonb_array_length(tables_json) IS DISTINCT FROM 12 THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='sealed plan protected table catalog incomplete';
  END IF;
  RETURN encode(sha256(convert_to(jsonb_build_object('functions',functions_json,
    'triggers',triggers_json,'references',references_json,'tables',tables_json)::text,'UTF8')),'hex');
END;
$$;

-- Updating a separate row, not just taking an advisory lock, invalidates stale
-- REPEATABLE READ/SERIALIZABLE snapshots. Every original/reference write takes
-- this fence before it can commit; registration takes the same versioned row.
CREATE FUNCTION public.touch_sealed_plan_fence_v1(require_unsealed boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE locked_fence record;
BEGIN
  SELECT * INTO locked_fence FROM public.deployment_plan_only_isolation_fences
  WHERE deployment_id='dep_d00144511731f1c20991aa56' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='sealed plan internal fence missing';
  END IF;
  IF locked_fence.sealed THEN
    IF require_unsealed THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='sealed plan cannot acquire execution references';
    END IF;
    RETURN;
  END IF;
  UPDATE public.deployment_plan_only_isolation_fences SET revision=revision+1
  WHERE deployment_id=locked_fence.deployment_id;
END;
$$;

CREATE FUNCTION public.guard_sealed_plan_fence_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP<>'UPDATE' OR OLD.sealed OR NEW.deployment_id IS DISTINCT FROM OLD.deployment_id
    OR NEW.revision IS DISTINCT FROM OLD.revision+1 THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='sealed plan fence cannot reset or disappear';
  END IF;
  IF NEW.sealed THEN
    IF NOT EXISTS (SELECT 1 FROM public.deployment_plan_only_isolations r
      WHERE r.deployment_id=NEW.deployment_id AND r.sealed_at=NEW.sealed_at) THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='sealed plan fence requires its registration';
    END IF;
  ELSIF NEW.sealed_at IS NOT NULL OR EXISTS (SELECT 1 FROM public.deployment_plan_only_isolations r WHERE r.deployment_id=NEW.deployment_id) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='sealed plan registration cannot remain unfenced';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_sealed_plan_deployment_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP<>'INSERT' AND OLD.id='dep_d00144511731f1c20991aa56' THEN
    PERFORM public.touch_sealed_plan_fence_v1(true);
  ELSIF TG_OP<>'DELETE' AND NEW.id='dep_d00144511731f1c20991aa56' THEN
    PERFORM public.touch_sealed_plan_fence_v1(true);
  ELSIF TG_OP<>'DELETE' AND NEW.app_instance_id='app_fb1962e93a9a4cc2acf046170593d9e3' THEN
    -- A future new deployment is allowed, but a racing registration must see it.
    PERFORM public.touch_sealed_plan_fence_v1(false);
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_sealed_plan_reference_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE candidate jsonb := to_jsonb(NEW); field text;
BEGIN
  FOREACH field IN ARRAY TG_ARGV LOOP
    IF candidate->>field='dep_d00144511731f1c20991aa56' THEN
      PERFORM public.touch_sealed_plan_fence_v1(true);
      RETURN NEW;
    END IF;
  END LOOP;
  -- Resources of the same instance also participate in the pre-registration
  -- emptiness check; after sealing, a new unsealed deployment stays legitimate.
  IF TG_TABLE_NAME='deployment_tenant_resources'
    AND candidate->>'app_instance_id'='app_fb1962e93a9a4cc2acf046170593d9e3' THEN
    PERFORM public.touch_sealed_plan_fence_v1(false);
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.validate_sealed_plan_registration_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE original public.app_instance_deployments%ROWTYPE; instance_row public.app_instances%ROWTYPE;
  subscription_row public.subscriptions%ROWTYPE; business_json text; safety jsonb;
BEGIN
  IF NEW.deployment_id IS DISTINCT FROM 'dep_d00144511731f1c20991aa56'
    OR NEW.environment_id IS DISTINCT FROM 'env_aws_sandbox_ca_central_1'
    OR NEW.app_instance_id IS DISTINCT FROM 'app_fb1962e93a9a4cc2acf046170593d9e3' THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='sealed plan target mismatch';
  END IF;
  PERFORM public.touch_sealed_plan_fence_v1(true);
  SELECT * INTO original FROM public.app_instance_deployments WHERE id=NEW.deployment_id FOR UPDATE;
  SELECT * INTO instance_row FROM public.app_instances WHERE id=NEW.app_instance_id FOR UPDATE;
  SELECT * INTO subscription_row FROM public.subscriptions WHERE id=original.subscription_id FOR UPDATE;
  business_json := jsonb_build_object('instanceId',instance_row.id,'instanceStatus',instance_row.status,
    'instanceUpdatedAt',instance_row.updated_at,'subscriptionId',subscription_row.id,'subscriptionStatus',subscription_row.status)::text;
  safety := original.desired_plan::jsonb->'safety';
  IF original.environment_id IS DISTINCT FROM NEW.environment_id OR original.app_instance_id IS DISTINCT FROM NEW.app_instance_id
    OR original.mode IS DISTINCT FROM 'plan_only' OR original.status IS DISTINCT FROM 'planned'
    OR original.cell_key IS DISTINCT FROM 'cell-demo-1' OR original.attempts IS DISTINCT FROM 0
    OR safety->'applyEnabled' IS DISTINCT FROM 'false'::jsonb
    OR safety->'createsAwsResources' IS DISTINCT FROM 'false'::jsonb
    OR safety->'storesSecretValues' IS DISTINCT FROM 'false'::jsonb
    OR encode(sha256(convert_to(to_jsonb(original)::text,'UTF8')),'hex') IS DISTINCT FROM NEW.original_row_sha256
    OR encode(sha256(convert_to(original.desired_plan,'UTF8')),'hex') IS DISTINCT FROM NEW.original_plan_bytes_sha256
    OR original.plan_hash IS DISTINCT FROM NEW.original_plan_hash
    OR encode(sha256(convert_to(business_json,'UTF8')),'hex') IS DISTINCT FROM NEW.business_state_sha256
    OR NEW.protection_schema_sha256 IS DISTINCT FROM public.sealed_plan_protection_hash_v1()
    OR NEW.sealed_at IS DISTINCT FROM (extract(epoch FROM transaction_timestamp())*1000)::bigint THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='sealed plan approved preimage or guard proof mismatch';
  END IF;
  IF (SELECT count(*) FROM public.app_instance_deployments WHERE app_instance_id=NEW.app_instance_id)<>1
    OR EXISTS (SELECT 1 FROM public.deployment_jobs WHERE deployment_id=NEW.deployment_id)
    OR EXISTS (SELECT 1 FROM public.deployment_step_runs WHERE deployment_id=NEW.deployment_id)
    OR EXISTS (SELECT 1 FROM public.deployment_tenant_resources WHERE owner_deployment_id=NEW.deployment_id
      OR created_by_deployment_id=NEW.deployment_id OR app_instance_id=NEW.app_instance_id)
    OR EXISTS (SELECT 1 FROM public.deployment_environment_capacity_reservations WHERE deployment_id=NEW.deployment_id)
    OR EXISTS (SELECT 1 FROM public.deployment_cleanup_schedules WHERE deployment_id=NEW.deployment_id)
    OR EXISTS (SELECT 1 FROM public.deployment_tenant_resource_events WHERE deployment_id=NEW.deployment_id)
    OR EXISTS (SELECT 1 FROM public.deployment_tenant_external_operations WHERE owner_deployment_id=NEW.deployment_id)
    OR EXISTS (SELECT 1 FROM public.deployment_tenant_external_operation_events WHERE deployment_id=NEW.deployment_id)
    OR EXISTS (SELECT 1 FROM public.deployment_tenant_cleanup_runs WHERE owner_deployment_id=NEW.deployment_id) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='sealed plan has execution references or another deployment';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.finalize_sealed_plan_registration_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  UPDATE public.deployment_plan_only_isolation_fences SET sealed=true,sealed_at=NEW.sealed_at,revision=revision+1
  WHERE deployment_id=NEW.deployment_id AND NOT sealed;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='sealed plan registration fence mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.reject_sealed_plan_mutation_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='sealed plan evidence cannot be changed or truncated';
END;
$$;

CREATE TRIGGER aa_sealed_plan_deployment_write_v1 BEFORE INSERT OR UPDATE OR DELETE ON public.app_instance_deployments
FOR EACH ROW EXECUTE FUNCTION public.guard_sealed_plan_deployment_v1();

DO $reference_guards$
DECLARE item text[]; table_name text;
BEGIN
  FOREACH item SLICE 1 IN ARRAY ARRAY[
    ARRAY['deployment_jobs','deployment_id',''],
    ARRAY['deployment_step_runs','deployment_id',''],
    ARRAY['deployment_cleanup_schedules','deployment_id',''],
    ARRAY['deployment_environment_capacity_reservations','deployment_id',''],
    ARRAY['deployment_tenant_resources','owner_deployment_id','created_by_deployment_id'],
    ARRAY['deployment_tenant_resource_events','deployment_id',''],
    ARRAY['deployment_tenant_external_operations','owner_deployment_id',''],
    ARRAY['deployment_tenant_external_operation_events','deployment_id',''],
    ARRAY['deployment_tenant_cleanup_runs','owner_deployment_id','']]
  LOOP
    table_name:=item[1];
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_sealed_plan_reference_v1(%L,%L)',
      'aa_sealed_plan_'||table_name||'_v1',table_name,item[2],item[3]);
    EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER %I',table_name,'aa_sealed_plan_'||table_name||'_v1');
  END LOOP;
END;
$reference_guards$;

CREATE TRIGGER aa_sealed_plan_registry_insert_v1 BEFORE INSERT ON public.deployment_plan_only_isolations
FOR EACH ROW EXECUTE FUNCTION public.validate_sealed_plan_registration_v1();
CREATE TRIGGER aa_sealed_plan_registry_finalize_v1 AFTER INSERT ON public.deployment_plan_only_isolations
FOR EACH ROW EXECUTE FUNCTION public.finalize_sealed_plan_registration_v1();
CREATE TRIGGER aa_sealed_plan_registry_immutable_v1 BEFORE UPDATE OR DELETE ON public.deployment_plan_only_isolations
FOR EACH ROW EXECUTE FUNCTION public.reject_sealed_plan_mutation_v1();
CREATE TRIGGER aa_sealed_plan_registry_truncate_v1 BEFORE TRUNCATE ON public.deployment_plan_only_isolations
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_sealed_plan_mutation_v1();
CREATE TRIGGER aa_sealed_plan_internal_fence_write_v1 BEFORE UPDATE OR DELETE ON public.deployment_plan_only_isolation_fences
FOR EACH ROW EXECUTE FUNCTION public.guard_sealed_plan_fence_v1();
CREATE TRIGGER aa_sealed_plan_internal_fence_truncate_v1 BEFORE TRUNCATE ON public.deployment_plan_only_isolation_fences
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_sealed_plan_mutation_v1();

ALTER TABLE public.app_instance_deployments ENABLE ALWAYS TRIGGER aa_sealed_plan_deployment_write_v1;
ALTER TABLE public.deployment_plan_only_isolations ENABLE ALWAYS TRIGGER aa_sealed_plan_registry_insert_v1;
ALTER TABLE public.deployment_plan_only_isolations ENABLE ALWAYS TRIGGER aa_sealed_plan_registry_finalize_v1;
ALTER TABLE public.deployment_plan_only_isolations ENABLE ALWAYS TRIGGER aa_sealed_plan_registry_immutable_v1;
ALTER TABLE public.deployment_plan_only_isolations ENABLE ALWAYS TRIGGER aa_sealed_plan_registry_truncate_v1;
ALTER TABLE public.deployment_plan_only_isolation_fences ENABLE ALWAYS TRIGGER aa_sealed_plan_internal_fence_write_v1;
ALTER TABLE public.deployment_plan_only_isolation_fences ENABLE ALWAYS TRIGGER aa_sealed_plan_internal_fence_truncate_v1;

REVOKE ALL ON FUNCTION public.sealed_plan_protection_hash_v1(),public.touch_sealed_plan_fence_v1(boolean),
  public.guard_sealed_plan_fence_v1(),public.guard_sealed_plan_deployment_v1(),public.guard_sealed_plan_reference_v1(),
  public.validate_sealed_plan_registration_v1(),public.finalize_sealed_plan_registration_v1(),public.reject_sealed_plan_mutation_v1() FROM PUBLIC;
