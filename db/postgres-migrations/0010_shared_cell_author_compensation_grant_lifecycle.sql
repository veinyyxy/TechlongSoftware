-- J5g-j3 durable grant/revoke lifecycle. Every external authorization change
-- is write-ahead recover-only before delegation and receives one immutable
-- completion receipt. Migration 0009 remains sealed and unchanged.

CREATE TABLE shared_cell_author_compensation_lifecycle_actions (
  operation_sha256 text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('DELETE_CHANGE_SET', 'DELETE_STACK')),
  window_number integer NOT NULL CHECK (window_number > 0),
  action_number integer NOT NULL CHECK (action_number IN (1, 2)),
  action_kind text NOT NULL CHECK (action_kind IN ('GRANT', 'REVOKE')),
  revoke_reason text
    CHECK (revoke_reason IS NULL OR revoke_reason IN ('PHASE_COMPLETED', 'WINDOW_EXPIRED')),
  status text NOT NULL DEFAULT 'recover_only'
    CHECK (status IN ('recover_only', 'completed')),
  request text NOT NULL
    CHECK (jsonb_typeof(request::jsonb) = 'object' AND octet_length(request) <= 16384),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
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
  PRIMARY KEY (operation_sha256, phase, window_number, action_number),
  CONSTRAINT scac_lifecycle_window_fkey FOREIGN KEY (
    operation_sha256, phase, window_number
  ) REFERENCES shared_cell_author_compensation_review_windows(
    operation_sha256, phase, window_number
  ) ON DELETE RESTRICT,
  CONSTRAINT scac_lifecycle_window_kind_unique UNIQUE (
    operation_sha256, phase, window_number, action_kind
  ),
  CONSTRAINT scac_lifecycle_kind_shape_check CHECK (
    (
      (action_kind = 'GRANT' AND action_number = 1 AND revoke_reason IS NULL)
      OR (
        action_kind = 'REVOKE' AND action_number = 2
        AND revoke_reason IN ('PHASE_COMPLETED', 'WINDOW_EXPIRED')
      )
    ) IS TRUE
  ),
  CONSTRAINT scac_lifecycle_request_shape_check CHECK (
    (
      (request::jsonb #>> '{schemaVersion}') = '1'
      AND (request::jsonb #>> '{operationSha256}') = operation_sha256
      AND (request::jsonb #>> '{phase}') = phase
      AND (request::jsonb #>> '{windowNumber}') = window_number::text
      AND (request::jsonb #>> '{kind}') = action_kind
      AND (request::jsonb #>> '{lifecycleContractSha256}') ~ '^[a-f0-9]{64}$'
      AND (request::jsonb #>> '{targetTemplateRawSha256}') ~ '^[a-f0-9]{64}$'
      AND (request::jsonb #>> '{targetTemplateCanonicalSha256}') ~ '^[a-f0-9]{64}$'
      AND (request::jsonb #>> '{managementStackName}') =
        'techlong-s3-b5-cell-lifecycle-management'
      AND (request::jsonb #>> '{managementStackId}') =
        'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-lifecycle-management/fb742b50-afb2-11f1-85b7-02588681429d'
      AND (request::jsonb #>> '{managementChangeSetName}') =
        'techlong-j5gj3-' || lower(action_kind) || '-' ||
        substring((request::jsonb #>> '{lifecycleContractSha256}') FROM 1 FOR 16)
      AND (
        (
          action_kind = 'GRANT'
          AND (request::jsonb #>> '{action}') =
            'shared_cell_author_compensation_grant'
          AND (request::jsonb #>> '{compensationPlanSha256}') ~ '^[a-f0-9]{64}$'
          AND (request::jsonb #>> '{phasePlanSha256}') ~ '^[a-f0-9]{64}$'
          AND (request::jsonb #>> '{controllerContractSha256}') ~ '^[a-f0-9]{64}$'
          AND (request::jsonb #>> '{targetRendererShape}') = CASE phase
            WHEN 'DELETE_CHANGE_SET' THEN 'AuthorCompensationDeleteChangeSetGrant'
            WHEN 'DELETE_STACK' THEN 'AuthorCompensationDeleteStackGrant'
          END
        )
        OR (
          action_kind = 'REVOKE'
          AND (request::jsonb #>> '{action}') =
            'shared_cell_author_compensation_revoke'
          AND (request::jsonb #>> '{reason}') = revoke_reason
          AND (request::jsonb #>> '{grantReceiptSha256}') ~ '^[a-f0-9]{64}$'
          AND (request::jsonb #>> '{targetRendererShape}') = 'Locked'
          AND (
            (revoke_reason = 'PHASE_COMPLETED'
              AND (request::jsonb #>> '{completionReceiptSha256}') ~ '^[a-f0-9]{64}$')
            OR (revoke_reason = 'WINDOW_EXPIRED'
              AND NOT (request::jsonb ? 'completionReceiptSha256'))
          )
        )
      )
    ) IS TRUE
  ),
  CONSTRAINT scac_lifecycle_receipt_shape_check CHECK (
    (
      (
        status = 'recover_only' AND completion_receipt::jsonb = '{}'::jsonb
        AND completion_receipt_sha256 IS NULL AND completed_at IS NULL
      ) OR (
        status = 'completed' AND completion_receipt::jsonb <> '{}'::jsonb
        AND completion_receipt_sha256 IS NOT NULL AND completed_at IS NOT NULL
        AND (completion_receipt::jsonb #>> '{schemaVersion}') = '1'
        AND (completion_receipt::jsonb #>> '{operationSha256}') = operation_sha256
        AND (completion_receipt::jsonb #>> '{phase}') = phase
        AND (
          (
            action_kind = 'GRANT'
            AND (completion_receipt::jsonb #>> '{action}') =
              'shared_cell_author_compensation_phase_grant_verified'
            AND (completion_receipt::jsonb #>> '{disposition}') IN (
              'PHASE_EXECUTION_ALLOWED', 'REVOKE_ONLY'
            )
            AND (completion_receipt::jsonb #>> '{compensationPlanSha256}') =
              (request::jsonb #>> '{compensationPlanSha256}')
            AND (completion_receipt::jsonb #>> '{phasePlanSha256}') =
              (request::jsonb #>> '{phasePlanSha256}')
            AND (completion_receipt::jsonb #>> '{controllerContractSha256}') =
              (request::jsonb #>> '{controllerContractSha256}')
          ) OR (
            action_kind = 'REVOKE' AND revoke_reason = 'PHASE_COMPLETED'
            AND (completion_receipt::jsonb #>> '{action}') =
              'shared_cell_author_compensation_locked_verified'
            AND (completion_receipt::jsonb #>> '{completionReceiptSha256}') =
              (request::jsonb #>> '{completionReceiptSha256}')
          ) OR (
            action_kind = 'REVOKE' AND revoke_reason = 'WINDOW_EXPIRED'
            AND (completion_receipt::jsonb #>> '{action}') =
              'shared_cell_author_compensation_window_expired_locked_verified'
            AND (completion_receipt::jsonb #>> '{grantReceiptSha256}') =
              (request::jsonb #>> '{grantReceiptSha256}')
          )
        )
      )
    ) IS TRUE
  ),
  CONSTRAINT scac_lifecycle_timestamp_check CHECK (
    updated_at >= started_at AND (completed_at IS NULL OR completed_at >= started_at)
  )
);

CREATE UNIQUE INDEX scac_lifecycle_one_recover_only_per_operation
  ON shared_cell_author_compensation_lifecycle_actions(operation_sha256)
  WHERE status = 'recover_only';
CREATE INDEX scac_lifecycle_recovery_idx
  ON shared_cell_author_compensation_lifecycle_actions(status, updated_at)
  WHERE status = 'recover_only';

ALTER TABLE shared_cell_author_compensation_operations
  ADD CONSTRAINT scac_operation_state_shape_strict_check CHECK (
    (
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
    ) IS TRUE
  );

ALTER TABLE shared_cell_author_compensation_phase_attempts
  ADD CONSTRAINT scac_attempt_request_shape_strict_check CHECK (
    (
      (phase = 'DELETE_CHANGE_SET' AND client_request_token IS NULL)
      OR (
        phase = 'DELETE_STACK'
        AND client_request_token =
          'b5-author-comp-' || substring(operation_sha256 FROM 1 FOR 32)
      )
    ) IS TRUE
  );

ALTER TABLE shared_cell_author_compensation_events
  DROP CONSTRAINT shared_cell_author_compensation_events_event_type_check;
ALTER TABLE shared_cell_author_compensation_events
  ADD CONSTRAINT shared_cell_author_compensation_events_event_type_check
  CHECK (event_type IN (
    'operation_created', 'window_reviewed', 'claim_acquired', 'claim_taken_over',
    'phase_prepared', 'submission_started', 'phase_completed',
    'locked_proven', 'claim_released', 'recovery_observed', 'error_recorded',
    'lifecycle_action_started', 'lifecycle_action_completed'
  ));

CREATE OR REPLACE FUNCTION enforce_scac_lifecycle_action_transition()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Shared Cell author compensation lifecycle actions are durable';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'recover_only'
      OR NEW.completion_receipt::jsonb <> '{}'::jsonb
      OR NEW.completion_receipt_sha256 IS NOT NULL OR NEW.completed_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'A compensation lifecycle action must start recover-only without a receipt';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(
    NEW.operation_sha256, NEW.phase, NEW.window_number, NEW.action_number,
    NEW.action_kind, NEW.revoke_reason, NEW.request, NEW.request_sha256,
    NEW.lease_attempt, NEW.prepared_revision, NEW.started_at
  ) IS DISTINCT FROM ROW(
    OLD.operation_sha256, OLD.phase, OLD.window_number, OLD.action_number,
    OLD.action_kind, OLD.revoke_reason, OLD.request, OLD.request_sha256,
    OLD.lease_attempt, OLD.prepared_revision, OLD.started_at
  ) THEN
    RAISE EXCEPTION 'Shared Cell author compensation lifecycle action identity is immutable';
  END IF;
  IF OLD.status = 'completed' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Completed Shared Cell author compensation lifecycle action is immutable';
  END IF;
  IF OLD.status <> 'recover_only' OR NEW.status <> 'completed'
    OR NEW.updated_at < OLD.updated_at
  THEN
    RAISE EXCEPTION 'Shared Cell author compensation lifecycle action transition is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shared_cell_author_compensation_lifecycle_actions_transition
BEFORE INSERT OR UPDATE OR DELETE
ON shared_cell_author_compensation_lifecycle_actions
FOR EACH ROW EXECUTE FUNCTION enforce_scac_lifecycle_action_transition();

-- Replace the 0009 transition function to fence review rollover after any
-- lifecycle intent and to add the WINDOW_EXPIRED ready -> review transition.
CREATE OR REPLACE FUNCTION enforce_scac_operation_transition()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state IS DISTINCT FROM 'awaiting_delete_change_set_review'
      OR NEW.current_phase IS DISTINCT FROM 'DELETE_CHANGE_SET'
      OR NEW.state_revision IS DISTINCT FROM 1
      OR NEW.lease_attempt IS DISTINCT FROM 0
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
      AND NOT EXISTS (
        SELECT 1
        FROM shared_cell_author_compensation_lifecycle_actions lifecycle_action
        WHERE lifecycle_action.operation_sha256 = OLD.operation_sha256
          AND lifecycle_action.phase = OLD.current_phase
          AND lifecycle_action.window_number = OLD.current_window_number
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
    OR (OLD.state = 'delete_change_set_ready' AND NEW.state = 'awaiting_delete_change_set_review')
    OR (OLD.state = 'delete_change_set_recover_only' AND NEW.state = 'delete_change_set_revoke_required')
    OR (OLD.state = 'delete_change_set_revoke_required' AND NEW.state = 'awaiting_delete_stack_review')
    OR (OLD.state = 'delete_change_set_revoke_required' AND NEW.state = 'missing_proven_locked')
    OR (OLD.state = 'awaiting_delete_stack_review' AND NEW.state = 'delete_stack_prepared')
    OR (OLD.state = 'delete_stack_prepared' AND NEW.state = 'delete_stack_ready')
    OR (OLD.state = 'delete_stack_ready' AND NEW.state = 'delete_stack_recover_only')
    OR (OLD.state = 'delete_stack_ready' AND NEW.state = 'awaiting_delete_stack_review')
    OR (OLD.state = 'delete_stack_recover_only' AND NEW.state = 'delete_stack_revoke_required')
    OR (OLD.state = 'delete_stack_revoke_required' AND NEW.state = 'missing_proven_locked')
  ) THEN
    RAISE EXCEPTION 'Shared Cell author compensation operation transition is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- This statement-end proof closes all legacy/direct-SQL bypasses. It is
-- intentionally a constraint trigger because sibling data-modifying CTEs are
-- visible only after the statement completes.
CREATE OR REPLACE FUNCTION enforce_scac_lifecycle_operation_proof()
RETURNS trigger AS $$
BEGIN
  IF OLD.state IN ('delete_change_set_prepared', 'delete_stack_prepared')
    AND NEW.state IN ('delete_change_set_ready', 'delete_stack_ready')
    AND NOT EXISTS (
      SELECT 1
      FROM shared_cell_author_compensation_lifecycle_actions action
      JOIN shared_cell_author_compensation_review_windows review_window
        ON review_window.operation_sha256 = action.operation_sha256
       AND review_window.phase = action.phase
       AND review_window.window_number = action.window_number
      WHERE action.operation_sha256 = OLD.operation_sha256
        AND action.phase = OLD.current_phase
        AND action.window_number = OLD.current_window_number
        AND action.action_number = 1 AND action.action_kind = 'GRANT'
        AND action.status = 'completed'
        AND (action.request::jsonb #>> '{compensationPlanSha256}') =
          review_window.compensation_plan_sha256
        AND (action.request::jsonb #>> '{phasePlanSha256}') =
          review_window.phase_plan_sha256
        AND (action.request::jsonb #>> '{controllerContractSha256}') =
          review_window.controller_contract_sha256
        AND action.completion_receipt_sha256 = NEW.current_grant_receipt_sha256
    )
  THEN
    RAISE EXCEPTION 'A completed durable GRANT action is required before ready';
  END IF;

  IF OLD.state IN ('delete_change_set_ready', 'delete_stack_ready')
    AND NEW.state IN (
      'awaiting_delete_change_set_review', 'awaiting_delete_stack_review'
    )
    AND NOT EXISTS (
      SELECT 1 FROM shared_cell_author_compensation_lifecycle_actions action
      WHERE action.operation_sha256 = OLD.operation_sha256
        AND action.phase = OLD.current_phase
        AND action.window_number = OLD.current_window_number
        AND action.action_number = 2 AND action.action_kind = 'REVOKE'
        AND action.revoke_reason = 'WINDOW_EXPIRED'
        AND action.status = 'completed'
        AND (action.request::jsonb #>> '{grantReceiptSha256}') =
          OLD.current_grant_receipt_sha256
        AND (action.completion_receipt::jsonb #>> '{grantReceiptSha256}') =
          OLD.current_grant_receipt_sha256
    )
  THEN
    RAISE EXCEPTION 'A completed WINDOW_EXPIRED REVOKE action is required before review reset';
  END IF;

  IF OLD.state IN (
      'delete_change_set_revoke_required', 'delete_stack_revoke_required'
    ) AND NEW.state IN ('awaiting_delete_stack_review', 'missing_proven_locked')
    AND NOT EXISTS (
      SELECT 1
      FROM shared_cell_author_compensation_lifecycle_actions action
      JOIN shared_cell_author_compensation_phase_attempts attempt
       ON attempt.operation_sha256 = action.operation_sha256
       AND attempt.phase = action.phase
       AND attempt.window_number = action.window_number
       AND attempt.attempt_number = OLD.current_attempt_number
      WHERE action.operation_sha256 = OLD.operation_sha256
        AND action.phase = OLD.current_phase
        AND action.window_number = OLD.current_window_number
        AND action.action_number = 2 AND action.action_kind = 'REVOKE'
        AND action.revoke_reason = 'PHASE_COMPLETED'
        AND action.status = 'completed'
        AND (action.request::jsonb #>> '{grantReceiptSha256}') =
          OLD.current_grant_receipt_sha256
        AND (action.request::jsonb #>> '{completionReceiptSha256}') =
          attempt.completion_receipt_sha256
        AND (action.completion_receipt::jsonb #>> '{completionReceiptSha256}') =
          attempt.completion_receipt_sha256
        AND (
          (NEW.state = 'missing_proven_locked'
            AND (attempt.completion_receipt::jsonb #>> '{observedState}') =
              'MISSING')
          OR
          (NEW.state = 'awaiting_delete_stack_review'
            AND OLD.current_phase = 'DELETE_CHANGE_SET'
            AND (attempt.completion_receipt::jsonb #>> '{observedState}') =
              'REVIEW_IN_PROGRESS')
        )
    )
  THEN
    RAISE EXCEPTION 'A completed PHASE_COMPLETED REVOKE action is required before Locked advancement';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER shared_cell_author_compensation_lifecycle_operation_proof
AFTER UPDATE ON shared_cell_author_compensation_operations
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION enforce_scac_lifecycle_operation_proof();
