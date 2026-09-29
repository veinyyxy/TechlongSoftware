-- J5g-j2 offline persistence foundation. This migration is intentionally
-- separate from the sealed J5g-e2 0001-0008 receipt and does not enable any
-- CloudFormation mutation or runtime wiring.

CREATE TABLE shared_cell_author_compensation_operations (
  operation_sha256 text PRIMARY KEY
    CHECK (operation_sha256 ~ '^[a-f0-9]{64}$'),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  environment_id text NOT NULL
    REFERENCES deployment_environments(id) ON DELETE RESTRICT,
  account_id text NOT NULL CHECK (account_id ~ '^[0-9]{12}$'),
  region text NOT NULL CHECK (region ~ '^[a-z]{2}-[a-z]+-[0-9]+$'),
  stack_name text NOT NULL,
  stack_id text NOT NULL UNIQUE
    CHECK (stack_id ~ '^arn:aws:cloudformation:[a-z0-9-]+:[0-9]{12}:stack/.+$'),
  change_set_arn text NOT NULL UNIQUE
    CHECK (change_set_arn ~ '^arn:aws:cloudformation:[a-z0-9-]+:[0-9]{12}:changeSet/.+$'),
  operation_intent text NOT NULL
    CHECK (
      jsonb_typeof(operation_intent::jsonb) = 'object'
      AND octet_length(operation_intent) <= 65536
    ),
  delete_stack_client_request_token text NOT NULL
    CHECK (
      delete_stack_client_request_token =
        'b5-author-comp-' || substring(operation_sha256 FROM 1 FOR 32)
    ),
  state text NOT NULL DEFAULT 'awaiting_delete_change_set_review'
    CHECK (state IN (
      'awaiting_delete_change_set_review',
      'delete_change_set_prepared',
      'delete_change_set_ready',
      'delete_change_set_recover_only',
      'delete_change_set_revoke_required',
      'awaiting_delete_stack_review',
      'delete_stack_prepared',
      'delete_stack_ready',
      'delete_stack_recover_only',
      'delete_stack_revoke_required',
      'missing_proven_locked'
    )),
  current_phase text
    CHECK (current_phase IS NULL OR current_phase IN ('DELETE_CHANGE_SET', 'DELETE_STACK')),
  current_window_number integer CHECK (current_window_number > 0),
  current_attempt_number integer CHECK (current_attempt_number > 0),
  current_grant_receipt_sha256 text
    CHECK (
      current_grant_receipt_sha256 IS NULL
      OR current_grant_receipt_sha256 ~ '^[a-f0-9]{64}$'
    ),
  state_revision bigint NOT NULL DEFAULT 1 CHECK (state_revision > 0),
  lease_owner text,
  claim_token text CHECK (claim_token IS NULL OR claim_token ~ '^scac_[a-f0-9]{32}$'),
  lease_attempt integer NOT NULL DEFAULT 0 CHECK (lease_attempt >= 0),
  lease_expires_at bigint,
  last_error_code text CHECK (last_error_code IS NULL OR octet_length(last_error_code) <= 200),
  last_error_sha256 text
    CHECK (last_error_sha256 IS NULL OR last_error_sha256 ~ '^[a-f0-9]{64}$'),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  completed_at bigint,
  CONSTRAINT scac_operation_state_shape_check CHECK (
    (
      state = 'awaiting_delete_change_set_review'
      AND current_phase = 'DELETE_CHANGE_SET'
      AND current_window_number IS NULL AND current_attempt_number IS NULL
      AND current_grant_receipt_sha256 IS NULL
    ) OR (
      state = 'delete_change_set_prepared'
      AND current_phase = 'DELETE_CHANGE_SET'
      AND current_window_number IS NOT NULL AND current_attempt_number IS NULL
      AND current_grant_receipt_sha256 IS NULL
    ) OR (
      state = 'delete_change_set_ready'
      AND current_phase = 'DELETE_CHANGE_SET'
      AND current_window_number IS NOT NULL AND current_attempt_number IS NULL
      AND current_grant_receipt_sha256 IS NOT NULL
    ) OR (
      state IN ('delete_change_set_recover_only', 'delete_change_set_revoke_required')
      AND current_phase = 'DELETE_CHANGE_SET'
      AND current_window_number IS NOT NULL AND current_attempt_number IS NOT NULL
      AND current_grant_receipt_sha256 IS NOT NULL
    ) OR (
      state = 'awaiting_delete_stack_review'
      AND current_phase = 'DELETE_STACK'
      AND current_window_number IS NULL AND current_attempt_number IS NULL
      AND current_grant_receipt_sha256 IS NULL
    ) OR (
      state = 'delete_stack_prepared'
      AND current_phase = 'DELETE_STACK'
      AND current_window_number IS NOT NULL AND current_attempt_number IS NULL
      AND current_grant_receipt_sha256 IS NULL
    ) OR (
      state = 'delete_stack_ready'
      AND current_phase = 'DELETE_STACK'
      AND current_window_number IS NOT NULL AND current_attempt_number IS NULL
      AND current_grant_receipt_sha256 IS NOT NULL
    ) OR (
      state IN ('delete_stack_recover_only', 'delete_stack_revoke_required')
      AND current_phase = 'DELETE_STACK'
      AND current_window_number IS NOT NULL AND current_attempt_number IS NOT NULL
      AND current_grant_receipt_sha256 IS NOT NULL
    ) OR (
      state = 'missing_proven_locked'
      AND current_phase IS NULL AND current_window_number IS NULL
      AND current_attempt_number IS NULL AND current_grant_receipt_sha256 IS NULL
    )
  ),
  CONSTRAINT scac_operation_lease_shape_check CHECK (
    (
      lease_owner IS NULL AND claim_token IS NULL AND lease_expires_at IS NULL
    ) OR (
      lease_owner IS NOT NULL AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL
      AND state IN (
        'delete_change_set_prepared', 'delete_change_set_ready',
        'delete_change_set_recover_only', 'delete_change_set_revoke_required',
        'delete_stack_prepared', 'delete_stack_ready',
        'delete_stack_recover_only', 'delete_stack_revoke_required'
      )
    )
  ),
  CONSTRAINT scac_operation_error_shape_check CHECK (
    (last_error_code IS NULL) = (last_error_sha256 IS NULL)
  ),
  CONSTRAINT scac_operation_timestamp_check CHECK (
    updated_at >= created_at
    AND (
      (state = 'missing_proven_locked' AND completed_at IS NOT NULL AND completed_at >= created_at)
      OR (state <> 'missing_proven_locked' AND completed_at IS NULL)
    )
  )
);

CREATE UNIQUE INDEX scac_operations_active_environment_unique
  ON shared_cell_author_compensation_operations(environment_id)
  WHERE state <> 'missing_proven_locked';
CREATE INDEX scac_operations_claim_idx
  ON shared_cell_author_compensation_operations(state, lease_expires_at, updated_at);

CREATE TABLE shared_cell_author_compensation_review_windows (
  operation_sha256 text NOT NULL
    REFERENCES shared_cell_author_compensation_operations(operation_sha256)
    ON DELETE RESTRICT,
  phase text NOT NULL CHECK (phase IN ('DELETE_CHANGE_SET', 'DELETE_STACK')),
  window_number integer NOT NULL CHECK (window_number > 0),
  candidate text NOT NULL
    CHECK (jsonb_typeof(candidate::jsonb) = 'object' AND octet_length(candidate) <= 65536),
  compensation_plan_sha256 text NOT NULL
    CHECK (compensation_plan_sha256 ~ '^[a-f0-9]{64}$'),
  phase_plan_sha256 text NOT NULL CHECK (phase_plan_sha256 ~ '^[a-f0-9]{64}$'),
  controller_contract_sha256 text NOT NULL
    CHECK (controller_contract_sha256 ~ '^[a-f0-9]{64}$'),
  reviewed_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  created_at bigint NOT NULL,
  PRIMARY KEY (operation_sha256, phase, window_number),
  CONSTRAINT scac_review_window_time_check CHECK (
    expires_at > reviewed_at AND expires_at - reviewed_at <= 3600000
  )
);
CREATE UNIQUE INDEX scac_review_windows_plan_unique
  ON shared_cell_author_compensation_review_windows(
    operation_sha256, phase, compensation_plan_sha256,
    phase_plan_sha256, controller_contract_sha256
  );

CREATE TABLE shared_cell_author_compensation_phase_attempts (
  operation_sha256 text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('DELETE_CHANGE_SET', 'DELETE_STACK')),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  window_number integer NOT NULL CHECK (window_number > 0),
  status text NOT NULL DEFAULT 'recover_only'
    CHECK (status IN ('recover_only', 'completed')),
  request text NOT NULL
    CHECK (jsonb_typeof(request::jsonb) = 'object' AND octet_length(request) <= 4096),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  client_request_token text,
  lease_attempt integer NOT NULL CHECK (lease_attempt > 0),
  prepared_revision bigint NOT NULL CHECK (prepared_revision > 0),
  completion_receipt text NOT NULL DEFAULT '{}'
    CHECK (
      jsonb_typeof(completion_receipt::jsonb) = 'object'
      AND octet_length(completion_receipt) <= 16384
    ),
  completion_receipt_sha256 text
    CHECK (
      completion_receipt_sha256 IS NULL
      OR completion_receipt_sha256 ~ '^[a-f0-9]{64}$'
    ),
  started_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  completed_at bigint,
  PRIMARY KEY (operation_sha256, phase, attempt_number),
  CONSTRAINT scac_attempt_window_fkey FOREIGN KEY (
    operation_sha256, phase, window_number
  ) REFERENCES shared_cell_author_compensation_review_windows(
    operation_sha256, phase, window_number
  ) ON DELETE RESTRICT,
  CONSTRAINT scac_attempt_window_unique UNIQUE (
    operation_sha256, phase, window_number
  ),
  CONSTRAINT scac_attempt_request_shape_check CHECK (
    (phase = 'DELETE_CHANGE_SET' AND client_request_token IS NULL)
    OR (
      phase = 'DELETE_STACK'
      AND client_request_token = 'b5-author-comp-' || substring(operation_sha256 FROM 1 FOR 32)
    )
  ),
  CONSTRAINT scac_attempt_receipt_shape_check CHECK (
    (
      status = 'recover_only' AND completion_receipt::jsonb = '{}'::jsonb
      AND completion_receipt_sha256 IS NULL AND completed_at IS NULL
    ) OR (
      status = 'completed' AND completion_receipt::jsonb <> '{}'::jsonb
      AND completion_receipt_sha256 IS NOT NULL AND completed_at IS NOT NULL
    )
  ),
  CONSTRAINT scac_attempt_timestamp_check CHECK (
    updated_at >= started_at AND (completed_at IS NULL OR completed_at >= started_at)
  )
);

CREATE TABLE shared_cell_author_compensation_events (
  operation_sha256 text NOT NULL
    REFERENCES shared_cell_author_compensation_operations(operation_sha256)
    ON DELETE RESTRICT,
  state_revision bigint NOT NULL CHECK (state_revision > 0),
  phase text CHECK (phase IS NULL OR phase IN ('DELETE_CHANGE_SET', 'DELETE_STACK')),
  window_number integer CHECK (window_number > 0),
  attempt_number integer CHECK (attempt_number > 0),
  event_type text NOT NULL CHECK (event_type IN (
    'operation_created', 'window_reviewed', 'claim_acquired', 'claim_taken_over',
    'phase_prepared', 'submission_started', 'phase_completed',
    'locked_proven', 'claim_released', 'recovery_observed', 'error_recorded'
  )),
  from_state text,
  to_state text NOT NULL,
  evidence_sha256 text
    CHECK (evidence_sha256 IS NULL OR evidence_sha256 ~ '^[a-f0-9]{64}$'),
  evidence text NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(evidence::jsonb) = 'object' AND octet_length(evidence) <= 16384),
  created_at bigint NOT NULL,
  PRIMARY KEY (operation_sha256, state_revision),
  CONSTRAINT scac_event_initial_shape_check CHECK (
    (event_type = 'operation_created' AND from_state IS NULL AND state_revision = 1)
    OR (event_type <> 'operation_created' AND from_state IS NOT NULL)
  )
);
CREATE INDEX scac_events_operation_time_idx
  ON shared_cell_author_compensation_events(operation_sha256, created_at);

CREATE OR REPLACE FUNCTION enforce_scac_operation_transition()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'awaiting_delete_change_set_review'
      OR NEW.current_phase <> 'DELETE_CHANGE_SET'
      OR NEW.state_revision <> 1
      OR NEW.lease_attempt <> 0
      OR NEW.lease_owner IS NOT NULL OR NEW.claim_token IS NOT NULL
      OR NEW.lease_expires_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'Shared Cell author compensation operation must start unclaimed and awaiting review';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(
    NEW.operation_sha256, NEW.schema_version, NEW.environment_id, NEW.account_id,
    NEW.region, NEW.stack_name, NEW.stack_id, NEW.change_set_arn,
    NEW.operation_intent, NEW.delete_stack_client_request_token, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.operation_sha256, OLD.schema_version, OLD.environment_id, OLD.account_id,
    OLD.region, OLD.stack_name, OLD.stack_id, OLD.change_set_arn,
    OLD.operation_intent, OLD.delete_stack_client_request_token, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Shared Cell author compensation operation identity is immutable';
  END IF;
  IF OLD.state = 'missing_proven_locked' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Completed Shared Cell author compensation operation is immutable';
  END IF;
  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Shared Cell author compensation operation timestamp cannot regress';
  END IF;

  IF NEW.state_revision = OLD.state_revision THEN
    IF OLD.lease_owner IS NULL OR OLD.claim_token IS NULL
      OR OLD.lease_expires_at IS NULL OR NEW.lease_expires_at IS NULL
      OR NEW.lease_expires_at <= OLD.lease_expires_at
      OR NEW.updated_at <= OLD.updated_at
      OR ROW(
      NEW.state, NEW.current_phase, NEW.current_window_number,
      NEW.current_attempt_number, NEW.current_grant_receipt_sha256,
      NEW.lease_owner, NEW.claim_token, NEW.lease_attempt,
      NEW.last_error_code, NEW.last_error_sha256, NEW.completed_at
    ) IS DISTINCT FROM ROW(
      OLD.state, OLD.current_phase, OLD.current_window_number,
      OLD.current_attempt_number, OLD.current_grant_receipt_sha256,
      OLD.lease_owner, OLD.claim_token, OLD.lease_attempt,
      OLD.last_error_code, OLD.last_error_sha256, OLD.completed_at
    )
    THEN
      RAISE EXCEPTION 'Only a live claim heartbeat may retain the operation revision';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.state_revision <> OLD.state_revision + 1 THEN
    RAISE EXCEPTION 'Shared Cell author compensation operation revision must advance by one';
  END IF;
  IF NEW.state = OLD.state THEN
    IF NEW.state IN ('delete_change_set_prepared', 'delete_stack_prepared')
      AND NEW.current_phase = OLD.current_phase
      AND OLD.current_window_number IS NOT NULL
      AND NEW.current_window_number = OLD.current_window_number + 1
      AND OLD.current_attempt_number IS NULL AND NEW.current_attempt_number IS NULL
      AND OLD.current_grant_receipt_sha256 IS NULL
      AND NEW.current_grant_receipt_sha256 IS NULL
      AND OLD.lease_owner IS NULL AND NEW.lease_owner IS NULL
      AND OLD.claim_token IS NULL AND NEW.claim_token IS NULL
      AND OLD.lease_expires_at IS NULL AND NEW.lease_expires_at IS NULL
      AND NEW.lease_attempt = OLD.lease_attempt
      AND NEW.last_error_code IS NOT DISTINCT FROM OLD.last_error_code
      AND NEW.last_error_sha256 IS NOT DISTINCT FROM OLD.last_error_sha256
      AND NEW.completed_at IS NOT DISTINCT FROM OLD.completed_at
      AND EXISTS (
        SELECT 1
        FROM shared_cell_author_compensation_review_windows prior_window
        WHERE prior_window.operation_sha256 = OLD.operation_sha256
          AND prior_window.phase = OLD.current_phase
          AND prior_window.window_number = OLD.current_window_number
          AND prior_window.expires_at
            - floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
            <= CASE OLD.current_phase
              WHEN 'DELETE_CHANGE_SET' THEN 600000
              WHEN 'DELETE_STACK' THEN 300000
            END
      )
    THEN
      RETURN NEW;
    END IF;
    IF ROW(
      NEW.current_phase, NEW.current_window_number, NEW.current_attempt_number,
      NEW.current_grant_receipt_sha256, NEW.completed_at
    ) IS DISTINCT FROM ROW(
      OLD.current_phase, OLD.current_window_number, OLD.current_attempt_number,
      OLD.current_grant_receipt_sha256, OLD.completed_at
    ) THEN
      RAISE EXCEPTION 'Same-state compensation CAS may only change claim or error metadata';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.state = 'awaiting_delete_change_set_review' AND NEW.state = 'delete_change_set_prepared')
    OR (OLD.state = 'delete_change_set_prepared' AND NEW.state = 'delete_change_set_ready')
    OR (OLD.state = 'delete_change_set_ready' AND NEW.state = 'delete_change_set_recover_only')
    OR (OLD.state = 'delete_change_set_recover_only' AND NEW.state = 'delete_change_set_revoke_required')
    OR (OLD.state = 'delete_change_set_revoke_required' AND NEW.state = 'awaiting_delete_stack_review')
    OR (OLD.state = 'delete_change_set_revoke_required' AND NEW.state = 'missing_proven_locked')
    OR (OLD.state = 'awaiting_delete_stack_review' AND NEW.state = 'delete_stack_prepared')
    OR (OLD.state = 'delete_stack_prepared' AND NEW.state = 'delete_stack_ready')
    OR (OLD.state = 'delete_stack_ready' AND NEW.state = 'delete_stack_recover_only')
    OR (OLD.state = 'delete_stack_recover_only' AND NEW.state = 'delete_stack_revoke_required')
    OR (OLD.state = 'delete_stack_revoke_required' AND NEW.state = 'missing_proven_locked')
  ) THEN
    RAISE EXCEPTION 'Shared Cell author compensation operation transition is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shared_cell_author_compensation_operations_transition
BEFORE INSERT OR UPDATE ON shared_cell_author_compensation_operations
FOR EACH ROW EXECUTE FUNCTION enforce_scac_operation_transition();

CREATE OR REPLACE FUNCTION enforce_scac_attempt_transition()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Shared Cell author compensation attempts are durable';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'recover_only' OR NEW.completion_receipt::jsonb <> '{}'::jsonb
      OR NEW.completion_receipt_sha256 IS NOT NULL OR NEW.completed_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'A compensation attempt must start recover-only without a receipt';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(
    NEW.operation_sha256, NEW.phase, NEW.attempt_number, NEW.window_number,
    NEW.request, NEW.request_sha256, NEW.client_request_token,
    NEW.lease_attempt, NEW.prepared_revision, NEW.started_at
  ) IS DISTINCT FROM ROW(
    OLD.operation_sha256, OLD.phase, OLD.attempt_number, OLD.window_number,
    OLD.request, OLD.request_sha256, OLD.client_request_token,
    OLD.lease_attempt, OLD.prepared_revision, OLD.started_at
  ) THEN
    RAISE EXCEPTION 'Shared Cell author compensation attempt identity is immutable';
  END IF;
  IF OLD.status = 'completed' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Completed Shared Cell author compensation attempt is immutable';
  END IF;
  IF OLD.status <> 'recover_only' OR NEW.status <> 'completed'
    OR NEW.updated_at < OLD.updated_at
  THEN
    RAISE EXCEPTION 'Shared Cell author compensation attempt transition is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shared_cell_author_compensation_attempts_transition
BEFORE INSERT OR UPDATE OR DELETE ON shared_cell_author_compensation_phase_attempts
FOR EACH ROW EXECUTE FUNCTION enforce_scac_attempt_transition();

CREATE OR REPLACE FUNCTION prevent_scac_append_only_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Shared Cell author compensation windows and events are append-only';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shared_cell_author_compensation_windows_append_only
BEFORE UPDATE OR DELETE ON shared_cell_author_compensation_review_windows
FOR EACH ROW EXECUTE FUNCTION prevent_scac_append_only_mutation();

CREATE TRIGGER shared_cell_author_compensation_events_append_only
BEFORE UPDATE OR DELETE ON shared_cell_author_compensation_events
FOR EACH ROW EXECUTE FUNCTION prevent_scac_append_only_mutation();

CREATE OR REPLACE FUNCTION enforce_scac_operation_event()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.state_revision <> OLD.state_revision THEN
    IF NOT EXISTS (
      SELECT 1 FROM shared_cell_author_compensation_events event
      WHERE event.operation_sha256 = NEW.operation_sha256
        AND event.state_revision = NEW.state_revision
        AND event.to_state = NEW.state
    ) THEN
      RAISE EXCEPTION 'Shared Cell author compensation transition requires an append-only event';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER shared_cell_author_compensation_operation_event
AFTER INSERT OR UPDATE ON shared_cell_author_compensation_operations
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION enforce_scac_operation_event();
