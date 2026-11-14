-- D2-5 additive DRAFT, NOT APPLIED. Only after the original schema and three operation groups exist.
-- Separate installer approval required. No passwords/LOGIN/Secret/IAM, no ordinary runtime table DML.
BEGIN;
CREATE ROLE deployment_release_publisher NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT deployment_release_owner TO SESSION_USER WITH INHERIT FALSE;
GRANT deployment_release_owner TO SESSION_USER WITH SET TRUE;
SET LOCAL ROLE deployment_release_owner;
ALTER TABLE deployment_release.releases ADD COLUMN promotion_origin jsonb;
ALTER TABLE deployment_release.requests ADD COLUMN approval_intent_sha256 text CHECK (approval_intent_sha256 ~ '^[a-f0-9]{64}$');

CREATE FUNCTION deployment_release.read_candidate(p_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT document FROM deployment_release.releases WHERE id=p_id AND status='candidate'
    AND document->>'schema'='techlong/stored-release-candidate/v1'
$$;

-- Trusted publisher is responsible for actual ECR verification; SQL hashes are not ECR authentication.
-- The pre-admitted candidate product/source/config/compatibility cannot be changed or revived.
CREATE FUNCTION deployment_release.confirm_promotion(p_candidate_sha text,p_release_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE r deployment_release.releases; d jsonb:=p_release_text::jsonb; c jsonb;
BEGIN
  SELECT * INTO STRICT r FROM deployment_release.releases WHERE id=d->>'id' FOR UPDATE;
  c:=CASE WHEN r.status='candidate' THEN r.document ELSE r.promotion_origin END;
  IF c IS NULL OR c->>'schema' IS DISTINCT FROM 'techlong/stored-release-candidate/v1' OR
    c->>'candidateSha256' IS DISTINCT FROM p_candidate_sha OR
    r.status NOT IN ('candidate','ecr_verified') OR d->>'status' IS DISTINCT FROM 'ecr_verified' OR
    d->>'productId' IS DISTINCT FROM r.product_id OR d->>'component' IS DISTINCT FROM r.component OR d->>'version' IS DISTINCT FROM r.version OR
    d->'source' IS DISTINCT FROM c#>'{build,source}' OR d->'compatibility' IS DISTINCT FROM c#>'{build,compatibility}' OR
    d#>>'{image,repository}' IS DISTINCT FROM c#>>'{build,imageRepository}' OR
    d#>>'{image,runtimePlatform}' IS DISTINCT FROM 'linux/amd64' OR
    coalesce(d#>>'{image,manifestDigest}','') !~ '^sha256:[a-f0-9]{64}$' OR
    coalesce(d#>>'{image,platformDigest}','') !~ '^sha256:[a-f0-9]{64}$' OR
    coalesce(d#>>'{image,verificationSha256}','') !~ '^[a-f0-9]{64}$' OR
    (r.status='candidate' AND (c#>>'{build,validUntil}')::numeric <= extract(epoch FROM clock_timestamp())*1000) THEN
    RAISE EXCEPTION 'RELEASE_PROMOTED_CATALOG_MISMATCH';
  END IF;
  IF r.status='ecr_verified' THEN
    IF r.document IS DISTINCT FROM d THEN RAISE EXCEPTION 'RELEASE_PROMOTED_CATALOG_IMMUTABLE'; END IF;
    RETURN r.document;
  END IF;
  UPDATE deployment_release.releases SET status='ecr_verified',document=d,promotion_origin=c WHERE id=r.id;
  RETURN d;
END $$;

-- Executor may prepare ONLY the post-promotion plan derived from this exact run's approved intent.
-- It still has no generic prepare_request grant or catalog confirmation grant.
CREATE FUNCTION deployment_release.prepare_promoted_request(p_text text,p_sha text,p_intent_text text,p_job_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE p jsonb:=p_text::jsonb; i jsonb:=p_intent_text::jsonb; j jsonb:=p_job_text::jsonb; r deployment_release.releases;
  result jsonb; intent_sha text:=encode(sha256(convert_to(p_intent_text,'UTF8')),'hex');
BEGIN
  SELECT * INTO STRICT r FROM deployment_release.releases WHERE id=p#>>'{to,releaseId}';
  IF i->>'schema' IS DISTINCT FROM 'techlong/instance-release-promotion-intent/v1' OR i->'job' IS DISTINCT FROM j OR
    j->>'runAttempt' IS DISTINCT FROM '1' OR j->>'event' IS DISTINCT FROM 'workflow_dispatch' OR j->>'ref' IS DISTINCT FROM 'refs/heads/main' OR
    i->>'requestId' IS DISTINCT FROM ('release_' || substr(encode(sha256(convert_to(p_job_text,'UTF8')),'hex'),1,32)) OR
    i->>'requestId' IS DISTINCT FROM p#>>'{selection,requestId}' OR i->>'candidateId' IS DISTINCT FROM r.id OR
    j->>'releaseId' IS DISTINCT FROM r.id OR j->>'instanceId' IS DISTINCT FROM p#>>'{selection,instanceId}' OR
    j->>'actor' IS DISTINCT FROM p#>>'{selection,requestedBy}' OR
    r.promotion_origin->>'candidateSha256' IS DISTINCT FROM i->>'candidateSha256' OR r.promotion_origin IS NULL OR
    i#>>'{target,artifactSha256}' IS DISTINCT FROM r.document#>>'{source,artifactSha256}' OR
    i#>>'{target,imageConfigDigest}' IS DISTINCT FROM r.promotion_origin#>>'{build,imageConfigDigest}' OR
    i#>>'{target,archiveSha256}' IS DISTINCT FROM r.promotion_origin#>>'{build,artifact,archiveSha256}' OR
    i#>>'{target,repository}' IS DISTINCT FROM r.document#>>'{image,repository}' OR
    i->'limits' IS DISTINCT FROM '{"images":1,"pushSubmissions":1,"createChangeSets":1,"executeChangeSets":1,"restore":false,"migration":false}'::jsonb OR
    (i->>'writeBefore')::numeric IS NULL OR (i->>'writeBefore')::numeric <= extract(epoch FROM clock_timestamp())*1000 OR
    (i->>'writeBefore')::numeric > (r.promotion_origin#>>'{build,validUntil}')::numeric OR
    (i->>'observedAt')::numeric IS NULL OR (i->>'writeBefore')::numeric > (i->>'observedAt')::numeric + 18000000 OR
    (p->>'writeBefore')::numeric > (i->>'writeBefore')::numeric THEN RAISE EXCEPTION 'RELEASE_PROMOTION_INTENT_MISMATCH';
  END IF;
  IF EXISTS (SELECT 1 FROM deployment_release.requests WHERE id=i->>'requestId') THEN RAISE EXCEPTION 'RELEASE_PROMOTION_REQUEST_ALREADY_USED'; END IF;
  result:=deployment_release.prepare_request(p_text,p_sha);
  UPDATE deployment_release.requests SET approval_intent_sha256=intent_sha WHERE id=i->>'requestId';
  RETURN result;
END $$;

GRANT USAGE ON SCHEMA deployment_release TO deployment_release_publisher;
REVOKE ALL ON FUNCTION deployment_release.read_candidate(text),deployment_release.confirm_promotion(text,text),
  deployment_release.prepare_promoted_request(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION deployment_release.read_candidate(text) TO deployment_release_planner,deployment_release_executor;
GRANT EXECUTE ON FUNCTION deployment_release.confirm_promotion(text,text) TO deployment_release_publisher;
GRANT EXECUTE ON FUNCTION deployment_release.prepare_promoted_request(text,text,text,text) TO deployment_release_executor;
SET LOCAL ROLE NONE;
GRANT deployment_release_owner TO SESSION_USER WITH SET FALSE;
COMMIT;
