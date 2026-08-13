-- B5-E offline persistence foundation. This migration does not enable any
-- deployment runtime. Existing tenant resources remain deliberately
-- unadopted (external_operation_epoch IS NULL) until a fenced worker prepares and
-- externally proves a new operation epoch.

ALTER TABLE deployment_tenant_resources
  ADD COLUMN external_operation_epoch bigint
    CHECK (external_operation_epoch > 0);

CREATE TABLE deployment_tenant_external_operations (
  app_instance_id text NOT NULL
    REFERENCES deployment_tenant_resources(app_instance_id) ON DELETE RESTRICT,
  generation bigint NOT NULL CHECK (generation > 0),
  epoch bigint NOT NULL CHECK (epoch > 0),
  stable_identity_hash text NOT NULL
    CONSTRAINT deployment_tenant_external_operations_identity_hash_check
      CHECK (stable_identity_hash ~ '^[a-f0-9]{64}$'),
  owner_deployment_id text NOT NULL
    REFERENCES app_instance_deployments(id) ON DELETE RESTRICT,
  created_by_job_id text NOT NULL
    REFERENCES deployment_jobs(id) ON DELETE RESTRICT,
  created_by_attempt integer NOT NULL
    CONSTRAINT deployment_tenant_external_operations_attempt_check
      CHECK (created_by_attempt > 0),
  intent text NOT NULL CHECK (intent IN ('provision', 'cleanup')),
  operation_hash text NOT NULL CHECK (operation_hash ~ '^[a-f0-9]{64}$'),
  marker text NOT NULL,
  state text NOT NULL DEFAULT 'pending_external'
    CHECK (state IN ('pending_external', 'active', 'retired', 'failed')),
  evidence_hash text
    CHECK (evidence_hash IS NULL OR evidence_hash ~ '^[a-f0-9]{64}$'),
  evidence text NOT NULL DEFAULT '{}'
    CHECK (
      jsonb_typeof(evidence::jsonb) = 'object'
      AND octet_length(evidence) <= 16384
    ),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  activated_at bigint,
  completed_at bigint,
  PRIMARY KEY (app_instance_id, generation, epoch),
  CONSTRAINT deployment_tenant_external_operations_marker_check CHECK (
    marker = 'tl_epoch_' || substring(stable_identity_hash FROM 1 FOR 24)
      || '_g' || generation::text || '_e' || epoch::text
  ),
  CONSTRAINT deployment_tenant_external_operations_state_timestamps_check CHECK (
    (state = 'pending_external' AND activated_at IS NULL AND completed_at IS NULL)
    OR (state = 'active' AND activated_at IS NOT NULL AND completed_at IS NULL)
    OR (state = 'retired' AND activated_at IS NOT NULL AND completed_at IS NOT NULL)
    OR (state = 'failed' AND completed_at IS NOT NULL)
  ),
  CONSTRAINT deployment_tenant_external_operations_active_evidence_check CHECK (
    state <> 'active' OR (evidence_hash IS NOT NULL AND evidence::jsonb <> '{}'::jsonb)
  ),
  CONSTRAINT deployment_tenant_external_operations_timestamp_order_check CHECK (
    updated_at >= created_at
    AND (activated_at IS NULL OR activated_at >= created_at)
    AND (completed_at IS NULL OR completed_at >= created_at)
    AND (
      activated_at IS NULL OR completed_at IS NULL OR completed_at >= activated_at
    )
  )
);

CREATE UNIQUE INDEX deployment_tenant_external_operations_identity_unique
  ON deployment_tenant_external_operations (
    app_instance_id, generation, intent, operation_hash
  );
CREATE UNIQUE INDEX deployment_tenant_external_operations_current_unique
  ON deployment_tenant_external_operations (app_instance_id, generation)
  WHERE state = 'active';
CREATE UNIQUE INDEX deployment_tenant_external_operations_pending_unique
  ON deployment_tenant_external_operations (app_instance_id, generation)
  WHERE state = 'pending_external';
CREATE INDEX deployment_tenant_external_operations_owner_idx
  ON deployment_tenant_external_operations (owner_deployment_id, state, updated_at);
CREATE UNIQUE INDEX deployment_tenant_external_operations_owner_epoch_unique
  ON deployment_tenant_external_operations (
    app_instance_id, generation, epoch, owner_deployment_id
  );

ALTER TABLE deployment_tenant_resources
  ADD CONSTRAINT deployment_tenant_resources_external_operation_fkey
  FOREIGN KEY (app_instance_id, generation, external_operation_epoch)
  REFERENCES deployment_tenant_external_operations (
    app_instance_id, generation, epoch
  ) ON DELETE RESTRICT;

CREATE TABLE deployment_tenant_external_operation_events (
  id text PRIMARY KEY,
  app_instance_id text NOT NULL,
  generation bigint NOT NULL CHECK (generation > 0),
  epoch bigint NOT NULL CHECK (epoch > 0),
  deployment_id text NOT NULL
    REFERENCES app_instance_deployments(id) ON DELETE RESTRICT,
  event_type text NOT NULL
    CHECK (event_type IN ('prepared', 'activated', 'retired', 'failed')),
  from_state text
    CHECK (
      from_state IS NULL
      OR from_state IN ('pending_external', 'active', 'retired', 'failed')
    ),
  to_state text NOT NULL
    CHECK (to_state IN ('pending_external', 'active', 'retired', 'failed')),
  evidence_hash text
    CHECK (evidence_hash IS NULL OR evidence_hash ~ '^[a-f0-9]{64}$'),
  evidence text NOT NULL DEFAULT '{}'
    CHECK (
      jsonb_typeof(evidence::jsonb) = 'object'
      AND octet_length(evidence) <= 16384
    ),
  created_at bigint NOT NULL,
  CONSTRAINT deployment_tenant_external_operation_events_transition_check CHECK (
    (event_type = 'prepared' AND from_state IS NULL AND to_state = 'pending_external')
    OR (
      event_type = 'activated'
      AND from_state = 'pending_external'
      AND to_state = 'active'
    )
    OR (event_type = 'retired' AND from_state = 'active' AND to_state = 'retired')
    OR (
      event_type = 'failed'
      AND from_state IN ('pending_external', 'active')
      AND to_state = 'failed'
    )
  ),
  CONSTRAINT deployment_tenant_external_operation_events_operation_fkey
    FOREIGN KEY (app_instance_id, generation, epoch)
    REFERENCES deployment_tenant_external_operations(
      app_instance_id, generation, epoch
    ) ON DELETE RESTRICT
);

CREATE INDEX deployment_tenant_external_operation_events_epoch_idx
  ON deployment_tenant_external_operation_events (
    app_instance_id, generation, epoch, created_at
  );

CREATE TABLE deployment_tenant_cleanup_runs (
  id text PRIMARY KEY,
  app_instance_id text NOT NULL,
  generation bigint NOT NULL CHECK (generation > 0),
  external_epoch bigint NOT NULL CHECK (external_epoch > 0),
  owner_deployment_id text NOT NULL
    REFERENCES app_instance_deployments(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed')),
  next_phase text
    CHECK (next_phase IS NULL OR next_phase IN (
      'workload', 'database', 'secret', 'finalize'
    )),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  completed_at bigint,
  CONSTRAINT deployment_tenant_cleanup_runs_state_timestamps_check CHECK (
    (status = 'running' AND next_phase IS NOT NULL AND completed_at IS NULL)
    OR (status = 'completed' AND next_phase IS NULL AND completed_at IS NOT NULL)
  ),
  CONSTRAINT deployment_tenant_cleanup_runs_timestamp_order_check CHECK (
    updated_at >= created_at
    AND (completed_at IS NULL OR completed_at >= created_at)
  ),
  CONSTRAINT deployment_tenant_cleanup_runs_operation_fkey FOREIGN KEY (
    app_instance_id, generation, external_epoch, owner_deployment_id
  )
    REFERENCES deployment_tenant_external_operations(
      app_instance_id, generation, epoch, owner_deployment_id
    ) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX deployment_tenant_cleanup_runs_operation_unique
  ON deployment_tenant_cleanup_runs (
    app_instance_id, generation, external_epoch
  );
CREATE INDEX deployment_tenant_cleanup_runs_owner_idx
  ON deployment_tenant_cleanup_runs (owner_deployment_id, status, updated_at);

CREATE TABLE deployment_tenant_cleanup_phases (
  run_id text NOT NULL
    REFERENCES deployment_tenant_cleanup_runs(id) ON DELETE RESTRICT,
  phase text NOT NULL CHECK (phase IN ('workload', 'database', 'secret')),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded')),
  operation_id text NOT NULL
    CHECK (operation_id ~ '^tl_cleanup_[a-f0-9]{32}$'),
  receipt text NOT NULL DEFAULT '{}'
    CHECK (
      jsonb_typeof(receipt::jsonb) = 'object'
      AND octet_length(receipt) <= 16384
    ),
  receipt_hash text
    CHECK (receipt_hash IS NULL OR receipt_hash ~ '^[a-f0-9]{64}$'),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  started_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  completed_at bigint,
  PRIMARY KEY (run_id, phase),
  CONSTRAINT deployment_tenant_cleanup_phases_state_receipt_check CHECK (
    (status = 'running' AND receipt::jsonb = '{}'::jsonb
      AND receipt_hash IS NULL AND completed_at IS NULL)
    OR (status = 'succeeded' AND receipt::jsonb <> '{}'::jsonb
      AND receipt_hash IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CONSTRAINT deployment_tenant_cleanup_phases_timestamp_order_check CHECK (
    updated_at >= started_at
    AND (completed_at IS NULL OR completed_at >= started_at)
  )
);
CREATE UNIQUE INDEX deployment_tenant_cleanup_phases_operation_unique
  ON deployment_tenant_cleanup_phases (operation_id);

CREATE TABLE deployment_tenant_cleanup_events (
  id text PRIMARY KEY,
  run_id text NOT NULL
    REFERENCES deployment_tenant_cleanup_runs(id) ON DELETE RESTRICT,
  phase text
    CHECK (phase IS NULL OR phase IN ('workload', 'database', 'secret')),
  event_type text NOT NULL CHECK (event_type IN (
    'run_started', 'phase_started', 'phase_succeeded', 'run_completed'
  )),
  evidence_hash text
    CHECK (evidence_hash IS NULL OR evidence_hash ~ '^[a-f0-9]{64}$'),
  evidence text NOT NULL DEFAULT '{}'
    CHECK (
      jsonb_typeof(evidence::jsonb) = 'object'
      AND octet_length(evidence) <= 16384
    ),
  created_at bigint NOT NULL,
  CONSTRAINT deployment_tenant_cleanup_events_shape_check CHECK (
    (event_type IN ('phase_started', 'phase_succeeded') AND phase IS NOT NULL)
    OR (event_type IN ('run_started', 'run_completed') AND phase IS NULL)
  ),
  CONSTRAINT deployment_tenant_cleanup_events_phase_event_check CHECK (
    (event_type = 'run_started' AND phase IS NULL)
    OR (event_type = 'run_completed' AND phase IS NULL)
    OR (event_type = 'phase_started' AND phase IS NOT NULL)
    OR (
      event_type = 'phase_succeeded'
      AND phase IS NOT NULL
      AND evidence_hash IS NOT NULL
    )
  )
);

CREATE INDEX deployment_tenant_cleanup_events_run_idx
  ON deployment_tenant_cleanup_events (run_id, created_at);

CREATE OR REPLACE FUNCTION enforce_tenant_external_operation_transition()
RETURNS trigger AS $$
DECLARE
  resource_generation bigint;
  resource_owner text;
  resource_identity_hash text;
  resource_lifecycle text;
BEGIN
  SELECT generation, owner_deployment_id, stable_identity_hash, lifecycle_status
  INTO resource_generation, resource_owner, resource_identity_hash, resource_lifecycle
  FROM deployment_tenant_resources
  WHERE app_instance_id = NEW.app_instance_id;

  IF NOT FOUND
    OR NEW.generation <> resource_generation
    OR NEW.owner_deployment_id <> resource_owner
    OR NEW.stable_identity_hash <> resource_identity_hash
  THEN
    RAISE EXCEPTION 'tenant external operation resource fence mismatch';
  END IF;

  IF NEW.intent = 'provision'
    AND NEW.state IN ('pending_external', 'active')
    AND (
      resource_lifecycle IN ('destroying', 'destroyed')
      OR EXISTS (
        SELECT 1
        FROM deployment_tenant_external_operations cleanup_operation
        WHERE cleanup_operation.app_instance_id = NEW.app_instance_id
          AND cleanup_operation.generation = NEW.generation
          AND cleanup_operation.intent = 'cleanup'
      )
    )
  THEN
    RAISE EXCEPTION 'provision tenant external operation cannot overtake cleanup';
  END IF;

  IF TG_OP = 'INSERT' AND (
    NEW.state <> 'pending_external'
    OR NEW.evidence_hash IS NOT NULL
    OR NEW.evidence::jsonb <> '{}'::jsonb
    OR NEW.activated_at IS NOT NULL
    OR NEW.completed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'tenant external operation must be prepared before activation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.app_instance_id <> OLD.app_instance_id
      OR NEW.generation <> OLD.generation
      OR NEW.epoch <> OLD.epoch
      OR NEW.stable_identity_hash <> OLD.stable_identity_hash
      OR NEW.owner_deployment_id <> OLD.owner_deployment_id
      OR NEW.created_by_job_id <> OLD.created_by_job_id
      OR NEW.created_by_attempt <> OLD.created_by_attempt
      OR NEW.intent <> OLD.intent
      OR NEW.operation_hash <> OLD.operation_hash
      OR NEW.marker <> OLD.marker
      OR NEW.created_at <> OLD.created_at
    THEN
      RAISE EXCEPTION 'tenant external operation identity is immutable';
    END IF;
    IF NEW.updated_at < OLD.updated_at THEN
      RAISE EXCEPTION 'tenant external operation timestamp cannot regress';
    END IF;
    IF NOT (
      NEW.state = OLD.state
      OR (OLD.state = 'pending_external' AND NEW.state IN ('active', 'failed'))
      OR (OLD.state = 'active' AND NEW.state IN ('retired', 'failed'))
    ) THEN
      RAISE EXCEPTION 'tenant external operation state transition is invalid';
    END IF;

    IF NEW.state = OLD.state AND (
      NEW.evidence_hash IS DISTINCT FROM OLD.evidence_hash
      OR NEW.evidence::jsonb IS DISTINCT FROM OLD.evidence::jsonb
      OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
      OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
    ) THEN
      RAISE EXCEPTION 'tenant external operation proof is immutable within a state';
    END IF;

    IF OLD.state = 'active' AND NEW.state IN ('retired', 'failed') AND (
      NEW.evidence_hash IS DISTINCT FROM OLD.evidence_hash
      OR NEW.evidence::jsonb IS DISTINCT FROM OLD.evidence::jsonb
      OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
    ) THEN
      RAISE EXCEPTION 'active tenant external operation proof is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deployment_tenant_external_operations_transition
BEFORE INSERT OR UPDATE ON deployment_tenant_external_operations
FOR EACH ROW EXECUTE FUNCTION enforce_tenant_external_operation_transition();

CREATE OR REPLACE FUNCTION enforce_tenant_external_operation_pointer()
RETURNS trigger AS $$
BEGIN
  IF NEW.generation <> OLD.generation THEN
    IF NEW.external_operation_epoch IS NOT NULL THEN
      RAISE EXCEPTION 'new tenant resource generation cannot inherit an external epoch';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.external_operation_epoch IS DISTINCT FROM OLD.external_operation_epoch
    AND NEW.external_operation_epoch IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM deployment_tenant_external_operations operation
      WHERE operation.app_instance_id = NEW.app_instance_id
        AND operation.generation = NEW.generation
        AND operation.epoch = NEW.external_operation_epoch
        AND operation.owner_deployment_id = NEW.owner_deployment_id
        AND operation.stable_identity_hash = NEW.stable_identity_hash
        AND operation.state = 'active'
    )
  THEN
    RAISE EXCEPTION 'tenant resource external operation pointer is not active';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A regular BEFORE trigger cannot observe a sibling data-modifying CTE's
-- pending_external -> active transition because all CTE substatements share a
-- snapshot. The immediate constraint trigger runs at statement end and checks
-- the final active operation plus resource pointer atomically.
CREATE CONSTRAINT TRIGGER deployment_tenant_resources_external_operation_pointer
AFTER UPDATE ON deployment_tenant_resources
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION enforce_tenant_external_operation_pointer();

CREATE OR REPLACE FUNCTION enforce_tenant_cleanup_run_transition()
RETURNS trigger AS $$
DECLARE
  operation_intent text;
  operation_owner text;
  operation_state text;
  previous_phase_rank integer;
  next_phase_rank integer;
BEGIN
  SELECT operation.intent, operation.owner_deployment_id, operation.state
  INTO operation_intent, operation_owner, operation_state
  FROM deployment_tenant_external_operations operation
  INNER JOIN deployment_tenant_resources resource
    ON resource.app_instance_id = operation.app_instance_id
    AND resource.generation = operation.generation
    AND resource.external_operation_epoch = operation.epoch
    AND resource.owner_deployment_id = operation.owner_deployment_id
  WHERE operation.app_instance_id = NEW.app_instance_id
    AND operation.generation = NEW.generation
    AND operation.epoch = NEW.external_epoch;

  IF NOT FOUND
    OR operation_intent <> 'cleanup'
    OR operation_owner <> NEW.owner_deployment_id
  THEN
    RAISE EXCEPTION 'tenant cleanup run external operation mismatch';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF operation_state <> 'active'
      OR NEW.status <> 'running'
      OR NEW.next_phase <> 'workload'
    THEN
      RAISE EXCEPTION 'tenant cleanup run must start at workload';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id
    OR NEW.app_instance_id <> OLD.app_instance_id
    OR NEW.generation <> OLD.generation
    OR NEW.external_epoch <> OLD.external_epoch
    OR NEW.owner_deployment_id <> OLD.owner_deployment_id
    OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'tenant cleanup run identity is immutable';
  END IF;
  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'tenant cleanup run timestamp cannot regress';
  END IF;
  IF OLD.status = 'running' AND operation_state <> 'active' THEN
    RAISE EXCEPTION 'running tenant cleanup run requires its active external operation';
  END IF;

  IF OLD.status = 'completed' THEN
    IF NEW.status <> 'completed'
      OR NEW.next_phase IS NOT NULL
      OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
    THEN
      RAISE EXCEPTION 'completed tenant cleanup run is immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'completed' THEN
    IF OLD.next_phase <> 'finalize' OR NEW.next_phase IS NOT NULL THEN
      RAISE EXCEPTION 'tenant cleanup run cannot complete before finalize';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status <> 'running' THEN
    RAISE EXCEPTION 'tenant cleanup run state transition is invalid';
  END IF;

  previous_phase_rank := CASE OLD.next_phase
    WHEN 'workload' THEN 1 WHEN 'database' THEN 2
    WHEN 'secret' THEN 3 WHEN 'finalize' THEN 4 ELSE NULL
  END;
  next_phase_rank := CASE NEW.next_phase
    WHEN 'workload' THEN 1 WHEN 'database' THEN 2
    WHEN 'secret' THEN 3 WHEN 'finalize' THEN 4 ELSE NULL
  END;
  IF previous_phase_rank IS NULL OR next_phase_rank IS NULL
    OR next_phase_rank NOT IN (previous_phase_rank, previous_phase_rank + 1)
  THEN
    RAISE EXCEPTION 'tenant cleanup run phase cannot regress or skip';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deployment_tenant_cleanup_runs_transition
BEFORE INSERT OR UPDATE ON deployment_tenant_cleanup_runs
FOR EACH ROW EXECUTE FUNCTION enforce_tenant_cleanup_run_transition();

CREATE OR REPLACE FUNCTION enforce_tenant_cleanup_phase_transition()
RETURNS trigger AS $$
DECLARE
  run_status text;
  run_next_phase text;
BEGIN
  SELECT run.status, run.next_phase INTO run_status, run_next_phase
  FROM deployment_tenant_cleanup_runs run
  INNER JOIN deployment_tenant_external_operations operation
    ON operation.app_instance_id = run.app_instance_id
    AND operation.generation = run.generation
    AND operation.epoch = run.external_epoch
    AND operation.owner_deployment_id = run.owner_deployment_id
    AND operation.intent = 'cleanup'
    AND operation.state = 'active'
  INNER JOIN deployment_tenant_resources resource
    ON resource.app_instance_id = run.app_instance_id
    AND resource.generation = run.generation
    AND resource.external_operation_epoch = run.external_epoch
    AND resource.owner_deployment_id = run.owner_deployment_id
  WHERE run.id = NEW.run_id;

  IF NOT FOUND OR run_status <> 'running' THEN
    IF TG_OP <> 'UPDATE' THEN
      RAISE EXCEPTION 'tenant cleanup phase requires a running cleanup run';
    ELSIF OLD.status <> 'succeeded' THEN
      RAISE EXCEPTION 'tenant cleanup phase requires a running cleanup run';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'running' OR run_next_phase <> NEW.phase THEN
      RAISE EXCEPTION 'tenant cleanup phase is out of order';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.run_id <> OLD.run_id
    OR NEW.phase <> OLD.phase
    OR NEW.operation_id <> OLD.operation_id
    OR NEW.started_at <> OLD.started_at
  THEN
    RAISE EXCEPTION 'tenant cleanup phase identity is immutable';
  END IF;
  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'tenant cleanup phase timestamp cannot regress';
  END IF;

  IF OLD.status = 'succeeded' THEN
    IF NEW.status <> 'succeeded'
      OR NEW.receipt::jsonb IS DISTINCT FROM OLD.receipt::jsonb
      OR NEW.receipt_hash IS DISTINCT FROM OLD.receipt_hash
      OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
      OR NEW.attempts <> OLD.attempts
    THEN
      RAISE EXCEPTION 'succeeded tenant cleanup phase is immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF run_next_phase <> NEW.phase
    OR NEW.status NOT IN ('running', 'succeeded')
    OR (NEW.status = 'running' AND NEW.attempts <> OLD.attempts + 1)
    OR (NEW.status = 'succeeded' AND NEW.attempts <> OLD.attempts)
  THEN
    RAISE EXCEPTION 'tenant cleanup phase state transition is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deployment_tenant_cleanup_phases_transition
BEFORE INSERT OR UPDATE ON deployment_tenant_cleanup_phases
FOR EACH ROW EXECUTE FUNCTION enforce_tenant_cleanup_phase_transition();

CREATE OR REPLACE FUNCTION prevent_b5_epoch_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'B5 ownership and cleanup events are append-only';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deployment_tenant_external_operation_events_append_only
BEFORE UPDATE OR DELETE ON deployment_tenant_external_operation_events
FOR EACH ROW EXECUTE FUNCTION prevent_b5_epoch_event_mutation();

CREATE TRIGGER deployment_tenant_cleanup_events_append_only
BEFORE UPDATE OR DELETE ON deployment_tenant_cleanup_events
FOR EACH ROW EXECUTE FUNCTION prevent_b5_epoch_event_mutation();
