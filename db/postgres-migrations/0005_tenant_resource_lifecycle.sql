CREATE TABLE deployment_tenant_resources (
  app_instance_id text PRIMARY KEY
    REFERENCES app_instances(id) ON DELETE RESTRICT,
  created_by_deployment_id text NOT NULL
    REFERENCES app_instance_deployments(id) ON DELETE RESTRICT,
  owner_deployment_id text NOT NULL
    REFERENCES app_instance_deployments(id) ON DELETE RESTRICT,
  generation bigint NOT NULL DEFAULT 1
    CHECK (generation > 0),
  stable_identity_hash text NOT NULL
    CHECK (stable_identity_hash ~ '^[a-f0-9]{64}$'),
  environment_id text NOT NULL
    REFERENCES deployment_environments(id) ON DELETE RESTRICT,
  workspace_id text NOT NULL
    REFERENCES workspaces(id) ON DELETE RESTRICT,
  product_id text NOT NULL
    REFERENCES products(id) ON DELETE RESTRICT,
  cell_key text NOT NULL,
  database_name text NOT NULL
    CHECK (database_name ~ '^[a-z][a-z0-9_]{2,62}$'),
  role_name text NOT NULL
    CHECK (role_name ~ '^[a-z][a-z0-9_]{2,62}$'),
  secret_name text NOT NULL
    CHECK (
      secret_name ~ '^techlong/sandbox/tenant/[a-z0-9][a-z0-9_-]{2,63}/runtime$'
    ),
  runtime_secret_ref text
    CHECK (
      runtime_secret_ref IS NULL
      OR runtime_secret_ref ~ '^arn:aws:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:techlong/sandbox/tenant/[A-Za-z0-9_/-]+-[A-Za-z0-9]{6}$'
    ),
  ownership_marker text NOT NULL
    CHECK (
      ownership_marker =
        'tl_owner_' || substring(stable_identity_hash FROM 1 FOR 32)
        || '_g' || generation::text
    ),
  lifecycle_status text NOT NULL DEFAULT 'planned'
    CHECK (lifecycle_status IN (
      'planned', 'reopening', 'secret_ready', 'database_empty', 'baseline_restored',
      'saas_migrated', 'verified', 'destroying', 'destroyed', 'failed'
    )),
  baseline_digest text
    CHECK (baseline_digest IS NULL OR baseline_digest ~ '^[a-f0-9]{64}$'),
  migration_contract text
    CHECK (
      migration_contract IS NULL
      OR migration_contract = 'speedfeast-saas-control-v1'
    ),
  evidence_hash text
    CHECK (evidence_hash IS NULL OR evidence_hash ~ '^[a-f0-9]{64}$'),
  evidence text NOT NULL DEFAULT '{}'
    CHECK (
      jsonb_typeof(evidence::jsonb) = 'object'
      AND octet_length(evidence) <= 16384
    ),
  last_error text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  destroyed_at bigint,
  CHECK (
    lifecycle_status NOT IN (
      'secret_ready', 'database_empty', 'baseline_restored',
      'saas_migrated', 'verified'
    )
    OR runtime_secret_ref IS NOT NULL
  ),
  CHECK (
    lifecycle_status NOT IN ('baseline_restored', 'saas_migrated', 'verified')
    OR baseline_digest IS NOT NULL
  ),
  CHECK (
    lifecycle_status NOT IN ('saas_migrated', 'verified')
    OR migration_contract = 'speedfeast-saas-control-v1'
  ),
  CHECK (
    lifecycle_status NOT IN (
      'secret_ready', 'database_empty', 'baseline_restored',
      'saas_migrated', 'verified', 'destroyed'
    )
    OR evidence_hash IS NOT NULL
  ),
  CHECK (
    (lifecycle_status = 'destroyed' AND destroyed_at IS NOT NULL)
    OR (lifecycle_status <> 'destroyed' AND destroyed_at IS NULL)
  )
);

CREATE UNIQUE INDEX deployment_tenant_resources_database_unique
  ON deployment_tenant_resources (environment_id, database_name);
CREATE UNIQUE INDEX deployment_tenant_resources_role_unique
  ON deployment_tenant_resources (environment_id, role_name);
CREATE UNIQUE INDEX deployment_tenant_resources_secret_name_unique
  ON deployment_tenant_resources (secret_name);
CREATE UNIQUE INDEX deployment_tenant_resources_secret_ref_unique
  ON deployment_tenant_resources (runtime_secret_ref)
  WHERE runtime_secret_ref IS NOT NULL;
CREATE INDEX deployment_tenant_resources_status_idx
  ON deployment_tenant_resources (lifecycle_status, updated_at);
CREATE INDEX deployment_tenant_resources_created_deployment_idx
  ON deployment_tenant_resources (created_by_deployment_id);
CREATE INDEX deployment_tenant_resources_owner_deployment_idx
  ON deployment_tenant_resources (owner_deployment_id);

CREATE TABLE deployment_tenant_resource_events (
  id text PRIMARY KEY,
  app_instance_id text NOT NULL
    REFERENCES deployment_tenant_resources(app_instance_id) ON DELETE RESTRICT,
  generation bigint NOT NULL CHECK (generation > 0),
  deployment_id text NOT NULL
    REFERENCES app_instance_deployments(id) ON DELETE RESTRICT,
  event_type text NOT NULL
    CHECK (event_type IN (
      'claimed', 'handed_off', 'reopened', 'lifecycle_recorded',
      'cleanup_started', 'workload_destroyed', 'database_destroyed',
      'secret_destroyed', 'destroyed', 'failed'
    )),
  from_status text
    CHECK (
      from_status IS NULL OR from_status IN (
        'planned', 'reopening', 'secret_ready', 'database_empty', 'baseline_restored',
        'saas_migrated', 'verified', 'destroying', 'destroyed', 'failed'
      )
    ),
  to_status text NOT NULL
    CHECK (to_status IN (
      'planned', 'reopening', 'secret_ready', 'database_empty', 'baseline_restored',
      'saas_migrated', 'verified', 'destroying', 'destroyed', 'failed'
    )),
  evidence_hash text
    CHECK (evidence_hash IS NULL OR evidence_hash ~ '^[a-f0-9]{64}$'),
  evidence text NOT NULL DEFAULT '{}'
    CHECK (
      jsonb_typeof(evidence::jsonb) = 'object'
      AND octet_length(evidence) <= 16384
    ),
  created_at bigint NOT NULL,
  CHECK (
    event_type NOT IN (
      'lifecycle_recorded', 'workload_destroyed', 'database_destroyed',
      'secret_destroyed', 'destroyed', 'failed'
    )
    OR evidence_hash IS NOT NULL
  )
);

CREATE INDEX deployment_tenant_resource_events_instance_generation_idx
  ON deployment_tenant_resource_events (
    app_instance_id, generation, created_at
  );
CREATE INDEX deployment_tenant_resource_events_deployment_idx
  ON deployment_tenant_resource_events (deployment_id, created_at);

CREATE OR REPLACE FUNCTION enforce_deployment_tenant_resource_relationships()
RETURNS trigger AS $$
DECLARE
  expected_app_instance_id text;
  expected_environment_id text;
  expected_workspace_id text;
  expected_product_id text;
  expected_cell_key text;
  previous_owner_created_at bigint;
  candidate_owner_created_at bigint;
  previous_lifecycle_rank integer;
  next_lifecycle_rank integer;
BEGIN
  SELECT deployment.app_instance_id, deployment.environment_id,
    instance.workspace_id, instance.product_id, environment.cell_key
  INTO expected_app_instance_id, expected_environment_id,
    expected_workspace_id, expected_product_id, expected_cell_key
  FROM app_instance_deployments deployment
  INNER JOIN app_instances instance ON instance.id = deployment.app_instance_id
  INNER JOIN deployment_environments environment
    ON environment.id = deployment.environment_id
  WHERE deployment.id = NEW.owner_deployment_id;

  IF NOT FOUND
    OR NEW.app_instance_id <> expected_app_instance_id
    OR NEW.environment_id <> expected_environment_id
    OR NEW.workspace_id <> expected_workspace_id
    OR NEW.product_id <> expected_product_id
    OR NEW.cell_key <> expected_cell_key
  THEN
    RAISE EXCEPTION 'deployment tenant resource ownership mismatch';
  END IF;

  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1
    FROM app_instance_deployments creator
    WHERE creator.id = NEW.created_by_deployment_id
      AND creator.app_instance_id = NEW.app_instance_id
      AND creator.environment_id = NEW.environment_id
  ) THEN
    RAISE EXCEPTION 'deployment tenant resource creator mismatch';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.app_instance_id <> OLD.app_instance_id
    OR NEW.created_by_deployment_id <> OLD.created_by_deployment_id
    OR NEW.stable_identity_hash <> OLD.stable_identity_hash
    OR NEW.environment_id <> OLD.environment_id
    OR NEW.workspace_id <> OLD.workspace_id
    OR NEW.product_id <> OLD.product_id
    OR NEW.cell_key <> OLD.cell_key
    OR NEW.database_name <> OLD.database_name
    OR NEW.role_name <> OLD.role_name
    OR NEW.secret_name <> OLD.secret_name
  ) THEN
    RAISE EXCEPTION 'deployment tenant resource stable identity is immutable';
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.owner_deployment_id <> OLD.owner_deployment_id
  THEN
    IF NOT (
      OLD.lifecycle_status = 'destroyed'
      AND NEW.lifecycle_status = 'reopening'
      AND NEW.generation = OLD.generation + 1
    ) THEN
      RAISE EXCEPTION 'non-destroyed tenant resource owner handoff is disabled';
    END IF;

    SELECT created_at INTO previous_owner_created_at
    FROM app_instance_deployments
    WHERE id = OLD.owner_deployment_id;
    SELECT created_at INTO candidate_owner_created_at
    FROM app_instance_deployments
    WHERE id = NEW.owner_deployment_id;

    IF candidate_owner_created_at < previous_owner_created_at
      OR (
        candidate_owner_created_at = previous_owner_created_at
        AND NEW.owner_deployment_id <= OLD.owner_deployment_id
      )
    THEN
      RAISE EXCEPTION 'deployment tenant resource owner cannot move backward';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM deployment_jobs previous_job
      WHERE previous_job.deployment_id = OLD.owner_deployment_id
        AND previous_job.status = 'running'
        AND previous_job.lease_expires_at >
          (extract(epoch FROM clock_timestamp()) * 1000)::bigint
    ) THEN
      RAISE EXCEPTION 'deployment tenant resource owner still has a live lease';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.generation = OLD.generation THEN
    IF NEW.ownership_marker <> OLD.ownership_marker THEN
      RAISE EXCEPTION 'deployment tenant resource generation marker is immutable';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NOT (
    OLD.lifecycle_status = 'destroyed'
    AND NEW.lifecycle_status = 'reopening'
    AND NEW.generation = OLD.generation + 1
    AND NEW.owner_deployment_id <> OLD.owner_deployment_id
    AND NEW.runtime_secret_ref IS NULL
    AND NEW.baseline_digest IS NULL
    AND NEW.migration_contract IS NULL
    AND NEW.evidence_hash IS NULL
    AND NEW.evidence::jsonb = '{}'::jsonb
    AND NEW.destroyed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'deployment tenant resource generation transition is invalid';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.generation = OLD.generation THEN
    previous_lifecycle_rank := CASE OLD.lifecycle_status
      WHEN 'planned' THEN 0
      WHEN 'reopening' THEN 0
      WHEN 'secret_ready' THEN 1
      WHEN 'database_empty' THEN 2
      WHEN 'baseline_restored' THEN 3
      WHEN 'saas_migrated' THEN 4
      WHEN 'verified' THEN 5
      ELSE NULL
    END;
    next_lifecycle_rank := CASE NEW.lifecycle_status
      WHEN 'planned' THEN 0
      WHEN 'reopening' THEN 0
      WHEN 'secret_ready' THEN 1
      WHEN 'database_empty' THEN 2
      WHEN 'baseline_restored' THEN 3
      WHEN 'saas_migrated' THEN 4
      WHEN 'verified' THEN 5
      ELSE NULL
    END;

    IF OLD.lifecycle_status IN (
      'planned', 'reopening', 'secret_ready', 'database_empty',
      'baseline_restored', 'saas_migrated', 'verified'
    ) AND NOT (
      NEW.lifecycle_status = OLD.lifecycle_status
      OR NEW.lifecycle_status IN ('failed', 'destroying')
      OR (
        next_lifecycle_rank IS NOT NULL
        AND next_lifecycle_rank > previous_lifecycle_rank
      )
    ) THEN
      RAISE EXCEPTION 'deployment tenant resource lifecycle cannot regress';
    ELSIF OLD.lifecycle_status = 'failed'
      AND NEW.lifecycle_status NOT IN ('failed', 'destroying')
    THEN
      RAISE EXCEPTION 'deployment tenant resource lifecycle cannot regress';
    ELSIF OLD.lifecycle_status = 'destroying'
      AND NEW.lifecycle_status NOT IN ('destroying', 'failed', 'destroyed')
    THEN
      RAISE EXCEPTION 'deployment tenant resource lifecycle cannot regress';
    ELSIF OLD.lifecycle_status = 'destroyed'
      AND NEW.lifecycle_status <> 'destroyed'
    THEN
      RAISE EXCEPTION 'deployment tenant resource lifecycle cannot regress';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.lifecycle_status = 'destroying'
    AND (
      NEW.lifecycle_status NOT IN ('destroying', 'destroyed', 'failed')
      OR NEW.owner_deployment_id <> OLD.owner_deployment_id
      OR NEW.generation <> OLD.generation
    )
  THEN
    RAISE EXCEPTION 'deployment tenant resource cleanup fence cannot regress';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.lifecycle_status = 'destroyed'
    AND NEW.generation = OLD.generation
    AND NEW.lifecycle_status <> 'destroyed'
  THEN
    RAISE EXCEPTION 'destroyed tenant resource requires a new generation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deployment_tenant_resources_relationships
BEFORE INSERT OR UPDATE ON deployment_tenant_resources
FOR EACH ROW EXECUTE FUNCTION enforce_deployment_tenant_resource_relationships();

CREATE OR REPLACE FUNCTION prevent_deployment_tenant_resource_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'deployment tenant resource events are append-only';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deployment_tenant_resource_events_append_only
BEFORE UPDATE OR DELETE ON deployment_tenant_resource_events
FOR EACH ROW EXECUTE FUNCTION prevent_deployment_tenant_resource_event_mutation();

DROP INDEX deployment_step_runs_attempt_unique;
CREATE UNIQUE INDEX deployment_step_runs_attempt_unique
  ON deployment_step_runs (job_id, step_key, input_hash, attempt);
