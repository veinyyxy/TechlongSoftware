ALTER TABLE deployment_environments
  ADD COLUMN admission_state text NOT NULL DEFAULT 'open',
  ADD COLUMN admission_epoch bigint NOT NULL DEFAULT 0,
  ADD COLUMN admission_fence_sha256 text,
  ADD COLUMN admission_provision_operation_hash text,
  ADD COLUMN admission_stack_id text,
  ADD COLUMN admission_cell_expires_at bigint,
  ADD COLUMN admission_changed_at bigint;

UPDATE deployment_environments
SET admission_changed_at =
  (extract(epoch FROM clock_timestamp()) * 1000)::bigint
WHERE admission_changed_at IS NULL;

ALTER TABLE deployment_environments
  ALTER COLUMN admission_changed_at SET NOT NULL,
  ADD CONSTRAINT deployment_environments_admission_state_check
    CHECK (admission_state IN ('open', 'draining')),
  ADD CONSTRAINT deployment_environments_admission_epoch_check
    CHECK (admission_epoch >= 0),
  ADD CONSTRAINT deployment_environments_admission_fence_sha256_check
    CHECK (
      admission_fence_sha256 IS NULL
      OR admission_fence_sha256 ~ '^[a-f0-9]{64}$'
    ),
  ADD CONSTRAINT deployment_environments_admission_provision_hash_check
    CHECK (
      admission_provision_operation_hash IS NULL
      OR admission_provision_operation_hash ~ '^[a-f0-9]{64}$'
    ),
  ADD CONSTRAINT deployment_environments_admission_consistency_check
    CHECK (
      (
        admission_state = 'open'
        AND admission_epoch >= 0
        AND admission_fence_sha256 IS NULL
        AND admission_provision_operation_hash IS NULL
        AND admission_stack_id IS NULL
        AND admission_cell_expires_at IS NULL
      )
      OR
      (
        admission_state = 'draining'
        AND admission_epoch > 0
        AND admission_fence_sha256 IS NOT NULL
        AND admission_provision_operation_hash IS NOT NULL
        AND admission_stack_id IS NOT NULL
        AND admission_cell_expires_at IS NOT NULL
        AND admission_cell_expires_at > 0
        AND admission_changed_at >= admission_cell_expires_at
      )
    );

LOCK TABLE
  app_instance_deployments,
  deployment_tenant_resources,
  deployment_environment_capacity_reservations,
  deployment_cleanup_schedules
IN SHARE ROW EXCLUSIVE MODE;

DO $admission_relationships$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM deployment_environment_capacity_reservations AS reservation
    INNER JOIN app_instance_deployments AS deployment
      ON deployment.id = reservation.deployment_id
    WHERE reservation.environment_id IS DISTINCT FROM deployment.environment_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'existing capacity reservation environment does not match its deployment';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM deployment_tenant_resources AS resource
    INNER JOIN app_instance_deployments AS deployment
      ON deployment.id = resource.owner_deployment_id
    WHERE resource.environment_id IS DISTINCT FROM deployment.environment_id
      OR resource.app_instance_id IS DISTINCT FROM deployment.app_instance_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'existing tenant resource ownership does not match its deployment';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM deployment_cleanup_schedules AS schedule
    INNER JOIN app_instance_deployments AS deployment
      ON deployment.id = schedule.deployment_id
    WHERE schedule.environment_id IS DISTINCT FROM deployment.environment_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'existing cleanup schedule environment does not match its deployment';
  END IF;
END;
$admission_relationships$;

CREATE OR REPLACE FUNCTION enforce_deployment_environment_admission_initial_state()
RETURNS trigger AS $$
BEGIN
  IF NEW.admission_state IS DISTINCT FROM 'open'
    OR NEW.admission_epoch IS DISTINCT FROM 0
    OR NEW.admission_fence_sha256 IS NOT NULL
    OR NEW.admission_provision_operation_hash IS NOT NULL
    OR NEW.admission_stack_id IS NOT NULL
    OR NEW.admission_cell_expires_at IS NOT NULL
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'new deployment environment admission must start open';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deployment_environments_admission_initial_state
BEFORE INSERT ON deployment_environments
FOR EACH ROW
EXECUTE FUNCTION enforce_deployment_environment_admission_initial_state();

CREATE OR REPLACE FUNCTION enforce_deployment_environment_admission_transition()
RETURNS trigger AS $$
DECLARE
  database_now bigint :=
    (extract(epoch FROM transaction_timestamp()) * 1000)::bigint;
BEGIN
  IF OLD.admission_state = 'draining' THEN
    IF ROW(
      NEW.admission_state,
      NEW.admission_epoch,
      NEW.admission_fence_sha256,
      NEW.admission_provision_operation_hash,
      NEW.admission_stack_id,
      NEW.admission_cell_expires_at,
      NEW.admission_changed_at
    ) IS DISTINCT FROM ROW(
      OLD.admission_state,
      OLD.admission_epoch,
      OLD.admission_fence_sha256,
      OLD.admission_provision_operation_hash,
      OLD.admission_stack_id,
      OLD.admission_cell_expires_at,
      OLD.admission_changed_at
    ) THEN
      RAISE EXCEPTION 'draining deployment environment admission fence is immutable';
    END IF;
  ELSIF NEW.admission_state = 'open' THEN
    IF ROW(
      NEW.admission_epoch,
      NEW.admission_fence_sha256,
      NEW.admission_provision_operation_hash,
      NEW.admission_stack_id,
      NEW.admission_cell_expires_at,
      NEW.admission_changed_at
    ) IS DISTINCT FROM ROW(
      OLD.admission_epoch,
      OLD.admission_fence_sha256,
      OLD.admission_provision_operation_hash,
      OLD.admission_stack_id,
      OLD.admission_cell_expires_at,
      OLD.admission_changed_at
    ) THEN
      RAISE EXCEPTION 'open deployment environment admission metadata is immutable';
    END IF;
  ELSIF NEW.admission_state = 'draining' THEN
    IF NEW.admission_epoch <> OLD.admission_epoch + 1
      OR NEW.admission_changed_at <> database_now
      OR NEW.admission_cell_expires_at > database_now
    THEN
      RAISE EXCEPTION 'deployment environment admission drain is invalid or early';
    END IF;
  ELSE
    RAISE EXCEPTION 'deployment environment admission transition is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deployment_environments_admission_transition
BEFORE UPDATE OF
  admission_state,
  admission_epoch,
  admission_fence_sha256,
  admission_provision_operation_hash,
  admission_stack_id,
  admission_cell_expires_at,
  admission_changed_at
ON deployment_environments
FOR EACH ROW
EXECUTE FUNCTION enforce_deployment_environment_admission_transition();

CREATE OR REPLACE FUNCTION enforce_draining_deployment_environment_tombstone()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.admission_state = 'draining' THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'draining deployment environment tombstone cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.admission_state = 'draining' AND ROW(
    NEW.id,
    NEW.key,
    NEW.name,
    NEW.kind,
    NEW.driver,
    NEW.expected_account_id,
    NEW.region,
    NEW.cell_key,
    NEW.base_domain,
    NEW.apply_enabled,
    NEW.policy,
    NEW.status,
    NEW.created_at,
    NEW.updated_at
  ) IS DISTINCT FROM ROW(
    OLD.id,
    OLD.key,
    OLD.name,
    OLD.kind,
    OLD.driver,
    OLD.expected_account_id,
    OLD.region,
    OLD.cell_key,
    OLD.base_domain,
    OLD.apply_enabled,
    OLD.policy,
    OLD.status,
    OLD.created_at,
    OLD.updated_at
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'deployment environment identity cannot change while entering drain';
  END IF;

  IF OLD.admission_state = 'draining' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'draining deployment environment tombstone is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deployment_environments_draining_tombstone
BEFORE UPDATE OR DELETE ON deployment_environments
FOR EACH ROW
EXECUTE FUNCTION enforce_draining_deployment_environment_tombstone();

CREATE OR REPLACE FUNCTION enforce_draining_environment_ownership_tombstone()
RETURNS trigger AS $$
DECLARE
  current_admission_state text;
BEGIN
  SELECT environment.admission_state
  INTO current_admission_state
  FROM deployment_environments AS environment
  WHERE environment.id = OLD.environment_id
  FOR UPDATE;

  IF current_admission_state IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'deployment ownership cannot be deleted unless environment admission is open';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- A drain reaches zero through terminal status transitions and explicit
-- reservation release, never by erasing durable ownership evidence. These
-- row locks serialize DELETE with the environment's open -> draining fence.
CREATE TRIGGER app_instance_deployments_draining_tombstone
BEFORE DELETE ON app_instance_deployments
FOR EACH ROW
EXECUTE FUNCTION enforce_draining_environment_ownership_tombstone();

CREATE TRIGGER deployment_tenant_resources_draining_tombstone
BEFORE DELETE ON deployment_tenant_resources
FOR EACH ROW
EXECUTE FUNCTION enforce_draining_environment_ownership_tombstone();

CREATE TRIGGER deployment_cleanup_schedules_draining_tombstone
BEFORE DELETE ON deployment_cleanup_schedules
FOR EACH ROW
EXECUTE FUNCTION enforce_draining_environment_ownership_tombstone();

CREATE OR REPLACE FUNCTION enforce_deployment_environment_admission_fence()
RETURNS trigger AS $$
DECLARE
  current_admission_state text;
  owning_deployment_environment_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(
      NEW.deployment_id,
      NEW.environment_id,
      NEW.slot,
      NEW.reserved_at
    ) IS DISTINCT FROM ROW(
      OLD.deployment_id,
      OLD.environment_id,
      OLD.slot,
      OLD.reserved_at
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'deployment environment capacity reservation is immutable';
    END IF;
    RETURN NEW;
  END IF;

  SELECT deployment.environment_id
  INTO owning_deployment_environment_id
  FROM app_instance_deployments AS deployment
  WHERE deployment.id = NEW.deployment_id
  FOR UPDATE;

  IF owning_deployment_environment_id IS DISTINCT FROM NEW.environment_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'capacity reservation environment does not match its deployment';
  END IF;

  SELECT environment.admission_state
  INTO current_admission_state
  FROM deployment_environments AS environment
  WHERE environment.id = NEW.environment_id
  FOR UPDATE;

  IF current_admission_state IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'deployment environment admission is not open';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deployment_environment_capacity_admission_fence
BEFORE INSERT OR UPDATE
ON deployment_environment_capacity_reservations
FOR EACH ROW
EXECUTE FUNCTION enforce_deployment_environment_admission_fence();

CREATE OR REPLACE FUNCTION enforce_app_instance_deployment_admission()
RETURNS trigger AS $$
DECLARE
  locked_environment record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.app_instance_id IS DISTINCT FROM OLD.app_instance_id
      OR NEW.environment_id IS DISTINCT FROM OLD.environment_id
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'deployment application instance and environment are immutable';
    END IF;
    IF NOT (
      OLD.status IN ('rolled_back', 'canceled')
      AND NEW.status NOT IN ('rolled_back', 'canceled')
    ) THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT environment.id, environment.admission_state
  INTO locked_environment
  FROM deployment_environments AS environment
  WHERE environment.id = NEW.environment_id
  FOR UPDATE;

  IF locked_environment.admission_state IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'new or reopened deployment ownership is not admitted by the environment';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- AFTER INSERT fires only for a row that was actually inserted, so an
-- ON CONFLICT idempotency retry of an existing deployment remains a no-op.
CREATE TRIGGER app_instance_deployments_admission_insert_fence
AFTER INSERT ON app_instance_deployments
FOR EACH ROW
EXECUTE FUNCTION enforce_app_instance_deployment_admission();

CREATE TRIGGER app_instance_deployments_admission_reopen_fence
AFTER UPDATE OF app_instance_id, environment_id, status
ON app_instance_deployments
FOR EACH ROW
EXECUTE FUNCTION enforce_app_instance_deployment_admission();

CREATE OR REPLACE FUNCTION enforce_deployment_tenant_resource_admission()
RETURNS trigger AS $$
DECLARE
  current_admission_state text;
  owning_deployment_environment_id text;
  owning_deployment_app_instance_id text;
  admitted_deployment_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.app_instance_id IS DISTINCT FROM OLD.app_instance_id
      OR NEW.environment_id IS DISTINCT FROM OLD.environment_id
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'tenant resource application instance and environment are immutable';
    END IF;
    IF NEW.environment_id IS NOT DISTINCT FROM OLD.environment_id
      AND NEW.owner_deployment_id IS NOT DISTINCT FROM OLD.owner_deployment_id
      AND NEW.generation IS NOT DISTINCT FROM OLD.generation
      AND NOT (
        OLD.lifecycle_status = 'destroyed'
        AND NEW.lifecycle_status <> 'destroyed'
      )
    THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT deployment.environment_id, deployment.app_instance_id
  INTO owning_deployment_environment_id, owning_deployment_app_instance_id
  FROM app_instance_deployments AS deployment
  WHERE deployment.id = NEW.owner_deployment_id
  FOR UPDATE;

  IF owning_deployment_environment_id IS DISTINCT FROM NEW.environment_id
    OR owning_deployment_app_instance_id IS DISTINCT FROM NEW.app_instance_id
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'tenant resource ownership does not match its deployment';
  END IF;

  SELECT environment.admission_state
  INTO current_admission_state
  FROM deployment_environments AS environment
  WHERE environment.id = NEW.environment_id
  FOR UPDATE;

  IF current_admission_state = 'open' THEN
    RETURN NEW;
  END IF;
  IF current_admission_state IS DISTINCT FROM 'draining' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'tenant resource ownership environment admission state is invalid';
  END IF;

  SELECT reservation.deployment_id
  INTO admitted_deployment_id
  FROM deployment_environment_capacity_reservations AS reservation
  WHERE reservation.deployment_id = NEW.owner_deployment_id
    AND reservation.environment_id = NEW.environment_id
  FOR UPDATE;

  IF admitted_deployment_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'a draining environment only admits tenant resource ownership backed by an existing capacity reservation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Cleanup may continue changing lifecycle_status toward destroyed. A
-- pre-drain reservation may finish its in-flight ownership write, but after a
-- zero snapshot no reservation remains and no new one can cross the fence.
CREATE TRIGGER deployment_tenant_resources_admission_insert_fence
AFTER INSERT ON deployment_tenant_resources
FOR EACH ROW
EXECUTE FUNCTION enforce_deployment_tenant_resource_admission();

CREATE TRIGGER deployment_tenant_resources_admission_reopen_fence
AFTER UPDATE OF
  app_instance_id,
  environment_id,
  owner_deployment_id,
  generation,
  lifecycle_status
ON deployment_tenant_resources
FOR EACH ROW
EXECUTE FUNCTION enforce_deployment_tenant_resource_admission();

CREATE OR REPLACE FUNCTION enforce_deployment_cleanup_schedule_admission()
RETURNS trigger AS $$
DECLARE
  current_admission_state text;
  owning_deployment_environment_id text;
  owning_deployment_status text;
  admitted_deployment_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.environment_id IS DISTINCT FROM OLD.environment_id
      OR NEW.deployment_id IS DISTINCT FROM OLD.deployment_id
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'cleanup schedule deployment and environment are immutable';
    END IF;
    RETURN NEW;
  END IF;

  SELECT deployment.environment_id, deployment.status
  INTO owning_deployment_environment_id, owning_deployment_status
  FROM app_instance_deployments AS deployment
  WHERE deployment.id = NEW.deployment_id
  FOR UPDATE;

  IF owning_deployment_environment_id IS DISTINCT FROM NEW.environment_id
    OR owning_deployment_status IS NULL
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'cleanup schedule environment does not match its deployment';
  END IF;

  SELECT environment.admission_state
  INTO current_admission_state
  FROM deployment_environments AS environment
  WHERE environment.id = NEW.environment_id
  FOR UPDATE;

  IF current_admission_state = 'open' THEN
    RETURN NEW;
  END IF;
  IF current_admission_state IS DISTINCT FROM 'draining' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'cleanup schedule environment admission state is invalid';
  END IF;

  IF owning_deployment_status IN ('rolled_back', 'canceled') THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'a draining environment only admits cleanup schedules for an existing nonterminal deployment';
  END IF;

  SELECT reservation.deployment_id
  INTO admitted_deployment_id
  FROM deployment_environment_capacity_reservations AS reservation
  WHERE reservation.deployment_id = NEW.deployment_id
    AND reservation.environment_id = NEW.environment_id
  FOR UPDATE;

  IF admitted_deployment_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'a draining environment only admits cleanup schedules backed by an existing capacity reservation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- AFTER INSERT preserves ON CONFLICT retry behavior while still rolling back
-- every genuinely new schedule that is not cleanup-safe. Schedule ownership
-- coordinates are immutable; status-only retries do not recreate ownership.
CREATE TRIGGER deployment_cleanup_schedules_admission_insert_fence
AFTER INSERT ON deployment_cleanup_schedules
FOR EACH ROW
EXECUTE FUNCTION enforce_deployment_cleanup_schedule_admission();

CREATE TRIGGER deployment_cleanup_schedules_admission_move_fence
AFTER UPDATE OF environment_id, deployment_id ON deployment_cleanup_schedules
FOR EACH ROW
EXECUTE FUNCTION enforce_deployment_cleanup_schedule_admission();

CREATE OR REPLACE FUNCTION enforce_deployment_cleanup_schedule_terminal_status()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('succeeded', 'canceled')
    AND NEW.status IS DISTINCT FROM OLD.status
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'terminal cleanup schedule status is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deployment_cleanup_schedules_terminal_status_fence
BEFORE UPDATE OF status ON deployment_cleanup_schedules
FOR EACH ROW
EXECUTE FUNCTION enforce_deployment_cleanup_schedule_terminal_status();

CREATE OR REPLACE FUNCTION enforce_app_instance_activation_admission()
RETURNS trigger AS $$
DECLARE
  locked_environment record;
BEGIN
  IF OLD.status IN ('pending', 'active')
    OR NEW.status NOT IN ('pending', 'active')
  THEN
    RETURN NEW;
  END IF;

  FOR locked_environment IN
    SELECT environment.id, environment.admission_state
    FROM deployment_environments AS environment
    WHERE environment.id IN (
      SELECT deployment.environment_id
      FROM app_instance_deployments AS deployment
      WHERE deployment.app_instance_id = NEW.id
    )
    ORDER BY environment.id
    FOR UPDATE OF environment
  LOOP
    IF locked_environment.admission_state IS DISTINCT FROM 'open' THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'application instance cannot become active in a draining environment';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER app_instances_activation_admission_fence
AFTER UPDATE OF status ON app_instances
FOR EACH ROW
EXECUTE FUNCTION enforce_app_instance_activation_admission();
