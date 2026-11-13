-- D2-2/D2-3 DRAFT_NOT_APPLIED. NOT an automatic migration; no existing schema/role is modified.
-- Installation must be reviewed separately, including role-name collisions and PG integration tests.
-- Run in one transaction as an approved installer able to SET ROLE to this dedicated NOLOGIN owner.
BEGIN;
CREATE ROLE deployment_release_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE SCHEMA deployment_release AUTHORIZATION deployment_release_owner;
SET LOCAL ROLE deployment_release_owner;
REVOKE ALL ON SCHEMA deployment_release FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA deployment_release REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE deployment_release.releases (
  id text PRIMARY KEY,
  product_id text NOT NULL,
  component text NOT NULL CHECK (component = 'tenant_api'),
  version text NOT NULL,
  status text NOT NULL CHECK (status IN ('candidate','ecr_verified','revoked')),
  document jsonb NOT NULL CHECK (
    document->>'id' IS NOT DISTINCT FROM id AND
    document->>'productId' IS NOT DISTINCT FROM product_id AND
    document->>'component' IS NOT DISTINCT FROM component AND
    document->>'version' IS NOT DISTINCT FROM version),
  UNIQUE (product_id, component, version)
);
CREATE TABLE deployment_release.instance_state (
  instance_id text PRIMARY KEY,
  component text NOT NULL DEFAULT 'tenant_api' CHECK (component = 'tenant_api'),
  binding jsonb NOT NULL CHECK (binding->>'instanceId' IS NOT DISTINCT FROM instance_id),
  current_release_id text NOT NULL REFERENCES deployment_release.releases(id),
  revision bigint NOT NULL CHECK (revision >= 0),
  active_request_id text,
  last_evidence jsonb
);
CREATE TABLE deployment_release.requests (
  id text PRIMARY KEY,
  instance_id text NOT NULL REFERENCES deployment_release.instance_state(instance_id),
  target_release_id text NOT NULL REFERENCES deployment_release.releases(id),
  plan_text text NOT NULL,
  plan_sha256 text NOT NULL CHECK (plan_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('AWAITING_APPROVAL','CLAIMED','CHANGE_SET_CREATED',
    'EXECUTING','VERIFYING','SUCCEEDED','RECONCILIATION_REQUIRED','NO_CHANGE','BLOCKED',
    'BLOCKED_RESTORE_REQUIRED','EXPIRED','REJECTED_CHANGE_SET','FAILED_ROLLED_BACK_VERIFIED','FAILED_NEEDS_INSPECTION')),
  reason text,
  claim_token text,
  run_id text,
  run_attempt integer,
  operations jsonb NOT NULL DEFAULT '{}',
  inspection jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE deployment_release.instance_state ADD CONSTRAINT active_request_fk
  FOREIGN KEY (active_request_id) REFERENCES deployment_release.requests(id);

-- No runtime catalog/binding bootstrap or arbitrary SQL/DML function. An installation/import
-- separately verifies existing initialized instances and immutable ECR provenance before seeding.
CREATE FUNCTION deployment_release.read_context(p_instance text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object('activeRequestId',s.active_request_id,'binding', s.binding || jsonb_build_object('stateRevision',s.revision,
    'currentRelease',jsonb_build_object('id',r.id,'manifestDigest',r.document#>>'{image,manifestDigest}',
      'platformDigest',r.document#>>'{image,platformDigest}')),
    'releases',(SELECT coalesce(jsonb_agg(c.document || jsonb_build_object('status',c.status)), '[]'::jsonb)
      FROM deployment_release.releases c WHERE c.product_id = r.product_id AND c.component = s.component))
  FROM deployment_release.instance_state s JOIN deployment_release.releases r ON r.id = s.current_release_id
  WHERE s.instance_id = p_instance
$$;
CREATE FUNCTION deployment_release.read_request(p_id text) RETURNS jsonb
-- VOLATILE snapshot sees writes made earlier inside the calling mutation function.
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object('requestId',id,'status',status,'planSha256',plan_sha256,
    'runId',run_id,'runAttempt',run_attempt,'reason',reason,
    'plan',CASE WHEN plan_text::jsonb->>'schema' = 'techlong/instance-image-update-plan/v1' THEN plan_text::jsonb ELSE NULL END,
    'decision',CASE WHEN plan_text::jsonb->>'schema' = 'techlong/instance-release-decision/v1' THEN plan_text::jsonb ELSE NULL END,'operations',operations,
    'inspection',inspection) FROM deployment_release.requests WHERE id = p_id
$$;

CREATE FUNCTION deployment_release.prepare_request(p_text text, p_sha text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE p jsonb := p_text::jsonb; s deployment_release.instance_state; c deployment_release.releases;
  old deployment_release.requests; request_id text := p#>>'{selection,requestId}';
BEGIN
  IF encode(sha256(convert_to(p_text,'UTF8')),'hex') IS DISTINCT FROM p_sha OR
    p->>'schema' IS DISTINCT FROM 'techlong/instance-image-update-plan/v1' THEN
    RAISE EXCEPTION 'RELEASE_PLAN_MISMATCH';
  END IF;
  SELECT * INTO STRICT s FROM deployment_release.instance_state WHERE instance_id = p#>>'{selection,instanceId}' FOR UPDATE;
  SELECT * INTO old FROM deployment_release.requests WHERE id = request_id;
  IF FOUND THEN
    IF old.plan_text IS DISTINCT FROM p_text OR old.plan_sha256 IS DISTINCT FROM p_sha THEN
      RAISE EXCEPTION 'RELEASE_REQUEST_IMMUTABLE';
    END IF;
    RETURN deployment_release.read_request(request_id);
  END IF;
  SELECT * INTO STRICT c FROM deployment_release.releases WHERE id = p#>>'{to,releaseId}';
  IF s.active_request_id IS NOT NULL OR s.binding->>'status' IS DISTINCT FROM 'active' OR
    s.binding->>'initialized' IS DISTINCT FROM 'true' OR c.status <> 'ecr_verified' OR c.component <> 'tenant_api' OR
    c.product_id IS DISTINCT FROM s.binding->>'productId' OR p->>'productId' IS DISTINCT FROM c.product_id OR
    p->>'component' IS DISTINCT FROM c.component OR p#>>'{selection,workspaceId}' IS DISTINCT FROM s.binding->>'workspaceId' OR
    p#>>'{selection,environmentId}' IS DISTINCT FROM s.binding->>'environmentId' OR
    p#>>'{selection,releaseId}' IS DISTINCT FROM c.id OR
    p#>>'{changeSet,StackName}' IS DISTINCT FROM s.binding->>'stackId' OR
    p->>'templateSha256' IS DISTINCT FROM s.binding->>'templateSha256' OR
    p->>'configurationSha256' IS DISTINCT FROM s.binding->>'configurationSha256' OR
    (p->>'expectedStateRevision')::bigint IS DISTINCT FROM s.revision OR
    p#>>'{from,releaseId}' IS DISTINCT FROM s.current_release_id OR
    p#>>'{to,imageUri}' IS DISTINCT FROM (c.document#>>'{image,repository}') || '@' || (c.document#>>'{image,manifestDigest}') OR
    p#>>'{to,platformDigest}' IS DISTINCT FROM c.document#>>'{image,platformDigest}' OR
    p#>>'{to,sourceCommit}' IS DISTINCT FROM c.document#>>'{source,commit}' OR
    p#>>'{to,artifactSha256}' IS DISTINCT FROM c.document#>>'{source,artifactSha256}' OR
    p#>>'{to,imageVerificationSha256}' IS DISTINCT FROM c.document#>>'{image,verificationSha256}' OR
    (p->>'writeBefore')::numeric IS NULL OR (p->>'writeBefore')::numeric <= extract(epoch FROM clock_timestamp())*1000 THEN
    RAISE EXCEPTION 'RELEASE_BASELINE_OR_CATALOG_CHANGED';
  END IF;
  INSERT INTO deployment_release.requests(id,instance_id,target_release_id,plan_text,plan_sha256,status)
    VALUES(request_id,s.instance_id,c.id,p_text,p_sha,'AWAITING_APPROVAL');
  RETURN deployment_release.read_request(request_id);
END $$;

-- Persist read-only planning outcomes without fabricating an executable ImageUpdatePlan.
CREATE FUNCTION deployment_release.record_decision(p_text text,p_sha text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE d jsonb := p_text::jsonb; s deployment_release.instance_state; old deployment_release.requests;
  c deployment_release.releases; request_id text := d#>>'{selection,requestId}';
BEGIN
  IF encode(sha256(convert_to(p_text,'UTF8')),'hex') IS DISTINCT FROM p_sha OR
    d->>'schema' IS DISTINCT FROM 'techlong/instance-release-decision/v1' OR
    coalesce(d->>'status','') NOT IN ('NO_CHANGE','BLOCKED','BLOCKED_RESTORE_REQUIRED') THEN
    RAISE EXCEPTION 'RELEASE_DECISION_MISMATCH';
  END IF;
  SELECT * INTO STRICT s FROM deployment_release.instance_state WHERE instance_id = d#>>'{selection,instanceId}' FOR UPDATE;
  SELECT * INTO old FROM deployment_release.requests WHERE id = request_id;
  IF FOUND THEN
    IF old.plan_text IS DISTINCT FROM p_text OR old.plan_sha256 IS DISTINCT FROM p_sha THEN RAISE EXCEPTION 'RELEASE_REQUEST_IMMUTABLE'; END IF;
    RETURN deployment_release.read_request(request_id);
  END IF;
  SELECT * INTO STRICT c FROM deployment_release.releases WHERE id = d#>>'{selection,releaseId}';
  IF s.active_request_id IS NOT NULL OR c.product_id IS DISTINCT FROM s.binding->>'productId' OR
    d#>>'{selection,workspaceId}' IS DISTINCT FROM s.binding->>'workspaceId' OR
    d#>>'{selection,environmentId}' IS DISTINCT FROM s.binding->>'environmentId' OR
    (d->>'expectedStateRevision')::bigint IS DISTINCT FROM s.revision OR d->>'currentReleaseId' IS DISTINCT FROM s.current_release_id OR
    (d->>'status' = 'NO_CHANGE' AND (c.status <> 'ecr_verified' OR NOT EXISTS (SELECT 1 FROM deployment_release.releases old_release
      WHERE old_release.id = s.current_release_id AND
        old_release.document#>>'{image,repository}' = c.document#>>'{image,repository}' AND
        old_release.document#>>'{image,manifestDigest}' = c.document#>>'{image,manifestDigest}' AND
        old_release.document#>>'{image,platformDigest}' = c.document#>>'{image,platformDigest}'))) THEN
    RAISE EXCEPTION 'RELEASE_DECISION_BASELINE_CHANGED';
  END IF;
  INSERT INTO deployment_release.requests(id,instance_id,target_release_id,plan_text,plan_sha256,status,reason)
    VALUES(request_id,s.instance_id,c.id,p_text,p_sha,d->>'status',d->>'reason');
  RETURN deployment_release.read_request(request_id);
END $$;

-- Every writer locks instance then request. Approval waiting takes NO execution lock.
CREATE FUNCTION deployment_release.claim_request(p_id text,p_sha text,p_run text,p_attempt integer,p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE s deployment_release.instance_state; r deployment_release.requests; p jsonb;
BEGIN
  SELECT * INTO STRICT s FROM deployment_release.instance_state WHERE instance_id =
    (SELECT instance_id FROM deployment_release.requests WHERE id = p_id) FOR UPDATE;
  SELECT * INTO STRICT r FROM deployment_release.requests WHERE id = p_id FOR UPDATE;
  p := r.plan_text::jsonb;
  IF r.status <> 'AWAITING_APPROVAL' OR s.active_request_id IS NOT NULL OR r.plan_sha256 IS DISTINCT FROM p_sha OR
    s.revision IS DISTINCT FROM (p->>'expectedStateRevision')::bigint OR s.current_release_id IS DISTINCT FROM p#>>'{from,releaseId}' OR
    p_token IS NULL OR length(p_token) < 16 OR p_run IS NULL OR p_run !~ '^[0-9]+$' OR p_attempt IS NULL OR p_attempt < 1 OR
    (p->>'writeBefore')::numeric <= extract(epoch FROM clock_timestamp())*1000 OR
    NOT EXISTS (SELECT 1 FROM deployment_release.releases WHERE id = r.target_release_id AND status = 'ecr_verified') THEN
    RAISE EXCEPTION 'RELEASE_CLAIM_CONFLICT';
  END IF;
  UPDATE deployment_release.instance_state SET active_request_id = p_id WHERE instance_id = s.instance_id;
  UPDATE deployment_release.requests SET status = 'CLAIMED', claim_token = p_token,run_id = p_run,run_attempt = p_attempt WHERE id = p_id;
  RETURN deployment_release.read_request(p_id);
END $$;

CREATE FUNCTION deployment_release.record_operation(p_id text,p_token text,p_kind text,p_phase text,p_sha text,p_ref text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE s deployment_release.instance_state; r deployment_release.requests; op jsonb; next_status text;
BEGIN
  SELECT * INTO STRICT s FROM deployment_release.instance_state WHERE instance_id =
    (SELECT instance_id FROM deployment_release.requests WHERE id = p_id) FOR UPDATE;
  SELECT * INTO STRICT r FROM deployment_release.requests WHERE id = p_id FOR UPDATE;
  IF s.active_request_id IS DISTINCT FROM p_id OR r.claim_token IS DISTINCT FROM p_token OR p_token IS NULL OR
    p_kind IS NULL OR p_kind NOT IN ('create','execute') OR p_phase IS NULL OR p_phase NOT IN ('INTENT','ACK','UNKNOWN') OR
    p_sha IS NULL OR p_sha !~ '^[a-f0-9]{64}$' OR r.status IN ('SUCCEEDED','RECONCILIATION_REQUIRED') THEN
    RAISE EXCEPTION 'RELEASE_OPERATION_CONFLICT';
  END IF;
  op := r.operations->p_kind;
  IF p_phase = 'INTENT' THEN
    IF op IS NOT NULL OR r.status <> (CASE WHEN p_kind = 'create' THEN 'CLAIMED' ELSE 'CHANGE_SET_CREATED' END) OR
      ((r.plan_text::jsonb)->>'writeBefore')::numeric <= extract(epoch FROM clock_timestamp())*1000 THEN
      RAISE EXCEPTION 'RELEASE_OPERATION_ALREADY_USED_OR_EXPIRED';
    END IF;
    next_status := CASE WHEN p_kind = 'create' THEN 'CLAIMED' ELSE 'EXECUTING' END;
  ELSE
    IF op->>'phase' IS DISTINCT FROM 'INTENT' OR op->>'actionSha256' IS DISTINCT FROM p_sha OR
      (p_phase = 'ACK' AND coalesce(length(p_ref),0) = 0) THEN
      RAISE EXCEPTION 'RELEASE_OPERATION_ACK_MISMATCH';
    END IF;
    next_status := CASE WHEN p_phase = 'UNKNOWN' THEN 'RECONCILIATION_REQUIRED'
      WHEN p_kind = 'create' THEN 'CHANGE_SET_CREATED' ELSE 'VERIFYING' END;
  END IF;
  UPDATE deployment_release.requests SET status = next_status,
    operations = jsonb_set(operations,ARRAY[p_kind],jsonb_build_object('phase',p_phase,'actionSha256',p_sha,'providerReference',p_ref)) WHERE id = p_id;
  RETURN deployment_release.read_request(p_id);
END $$;

CREATE FUNCTION deployment_release.record_inspection(p_id text,p_proof jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE s deployment_release.instance_state; r deployment_release.requests; p jsonb;
BEGIN
  SELECT * INTO STRICT s FROM deployment_release.instance_state WHERE instance_id =
    (SELECT instance_id FROM deployment_release.requests WHERE id = p_id) FOR UPDATE;
  SELECT * INTO STRICT r FROM deployment_release.requests WHERE id = p_id FOR UPDATE;
  p := r.plan_text::jsonb;
  IF s.active_request_id IS DISTINCT FROM p_id OR r.status <> 'VERIFYING' OR r.inspection IS NOT NULL OR
    p_proof->>'requestId' IS DISTINCT FROM p_id OR p_proof->>'planSha256' IS DISTINCT FROM r.plan_sha256 OR
    p_proof->>'runId' IS DISTINCT FROM r.run_id OR (p_proof->>'runAttempt')::integer IS DISTINCT FROM r.run_attempt OR
    p_proof->>'stackId' IS DISTINCT FROM p#>>'{changeSet,StackName}' OR
    p_proof->>'changeSetId' IS DISTINCT FROM r.operations#>>'{create,providerReference}' OR
    (p_proof->>'observedAt')::numeric IS NULL OR (p_proof->>'observedAt')::numeric < (p->>'preparedAt')::numeric OR
    coalesce(p_proof->>'runtimeSha256','') !~ '^[a-f0-9]{64}$' OR
    coalesce(p_proof->>'result','') NOT IN ('SUCCEEDED','FAILED_ROLLED_BACK_VERIFIED','FAILED_NEEDS_INSPECTION') OR
    (p_proof->>'result' <> 'FAILED_NEEDS_INSPECTION' AND (
      p_proof->>'releaseId' IS DISTINCT FROM CASE WHEN p_proof->>'result' = 'SUCCEEDED' THEN r.target_release_id ELSE p#>>'{from,releaseId}' END OR
      p_proof->>'imageUri' IS DISTINCT FROM CASE WHEN p_proof->>'result' = 'SUCCEEDED' THEN p#>>'{to,imageUri}' ELSE p#>>'{from,imageUri}' END OR
      p_proof->>'platformDigest' IS DISTINCT FROM CASE WHEN p_proof->>'result' = 'SUCCEEDED' THEN p#>>'{to,platformDigest}' ELSE p#>>'{from,platformDigest}' END OR
      p_proof->>'templateSha256' IS DISTINCT FROM p->>'templateSha256' OR
      p_proof->>'configurationSha256' IS DISTINCT FROM p->>'configurationSha256' OR
      coalesce(length(p_proof->>'serviceArn'),0) = 0 OR coalesce(length(p_proof->>'taskDefinitionArn'),0) = 0)) OR
    coalesce(p_proof#>>'{evidence,sha256}','') !~ '^[a-f0-9]{64}$' OR
    coalesce(length(p_proof#>>'{evidence,bucket}'),0) = 0 OR coalesce(length(p_proof#>>'{evidence,key}'),0) = 0 OR
    coalesce(p_proof#>>'{evidence,versionId}','') IN ('','null') THEN
    RAISE EXCEPTION 'RELEASE_INSPECTION_MISMATCH';
  END IF;
  UPDATE deployment_release.requests SET inspection = p_proof WHERE id = p_id;
  RETURN deployment_release.read_request(p_id);
END $$;

CREATE FUNCTION deployment_release.complete_request(p_id text,p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE s deployment_release.instance_state; r deployment_release.requests; p jsonb;
BEGIN
  SELECT * INTO STRICT s FROM deployment_release.instance_state WHERE instance_id =
    (SELECT instance_id FROM deployment_release.requests WHERE id = p_id) FOR UPDATE;
  SELECT * INTO STRICT r FROM deployment_release.requests WHERE id = p_id FOR UPDATE;
  p := r.plan_text::jsonb;
  IF s.active_request_id IS DISTINCT FROM p_id OR r.claim_token IS DISTINCT FROM p_token OR p_token IS NULL OR
    r.status <> 'VERIFYING' OR r.inspection IS NULL OR s.revision IS DISTINCT FROM (p->>'expectedStateRevision')::bigint OR
    s.current_release_id IS DISTINCT FROM p#>>'{from,releaseId}' THEN
    RAISE EXCEPTION 'RELEASE_COMPLETION_CAS_CONFLICT';
  END IF;
  UPDATE deployment_release.instance_state SET
    current_release_id = CASE WHEN r.inspection->>'result' = 'SUCCEEDED' THEN r.target_release_id ELSE current_release_id END,
    revision = revision + CASE WHEN r.inspection->>'result' = 'FAILED_NEEDS_INSPECTION' THEN 0 ELSE 1 END,
    active_request_id = CASE WHEN r.inspection->>'result' = 'FAILED_NEEDS_INSPECTION' THEN p_id ELSE NULL END,
    last_evidence = r.inspection->'evidence' WHERE instance_id = s.instance_id;
  UPDATE deployment_release.requests SET status = r.inspection->>'result' WHERE id = p_id;
  RETURN deployment_release.read_request(p_id);
END $$;

CREATE FUNCTION deployment_release.stop_request(p_id text,p_token text,p_status text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE s deployment_release.instance_state; r deployment_release.requests;
BEGIN
  SELECT * INTO STRICT s FROM deployment_release.instance_state WHERE instance_id =
    (SELECT instance_id FROM deployment_release.requests WHERE id = p_id) FOR UPDATE;
  SELECT * INTO STRICT r FROM deployment_release.requests WHERE id = p_id FOR UPDATE;
  IF r.status = 'AWAITING_APPROVAL' AND p_status = 'EXPIRED' AND s.active_request_id IS NULL AND
    ((r.plan_text::jsonb)->>'writeBefore')::numeric <= extract(epoch FROM clock_timestamp())*1000 THEN
    UPDATE deployment_release.requests SET status = 'EXPIRED',reason = 'ORIGINAL_WRITE_WINDOW_EXPIRED' WHERE id = p_id;
    RETURN deployment_release.read_request(p_id);
  END IF;
  IF s.active_request_id IS DISTINCT FROM p_id OR r.claim_token IS DISTINCT FROM p_token OR p_token IS NULL OR
    r.status NOT IN ('CLAIMED','CHANGE_SET_CREATED','EXECUTING','VERIFYING') OR
    coalesce(p_status,'') NOT IN ('BLOCKED','BLOCKED_RESTORE_REQUIRED','EXPIRED','REJECTED_CHANGE_SET','FAILED_NEEDS_INSPECTION','RECONCILIATION_REQUIRED') OR
    coalesce(p_reason,'') !~ '^[A-Z_]+$' OR
    (p_status NOT IN ('FAILED_NEEDS_INSPECTION','RECONCILIATION_REQUIRED') AND
      (r.operations ? 'execute' OR coalesce(r.operations#>>'{create,phase}','') IN ('INTENT','UNKNOWN'))) THEN
    RAISE EXCEPTION 'RELEASE_STOP_CONFLICT';
  END IF;
  UPDATE deployment_release.requests SET status = p_status,reason = p_reason WHERE id = p_id;
  IF p_status NOT IN ('FAILED_NEEDS_INSPECTION','RECONCILIATION_REQUIRED') THEN
    UPDATE deployment_release.instance_state SET active_request_id = NULL WHERE instance_id = s.instance_id;
  END IF;
  RETURN deployment_release.read_request(p_id);
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA deployment_release FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA deployment_release FROM PUBLIC;
COMMIT;
