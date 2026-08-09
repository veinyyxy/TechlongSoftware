CREATE TABLE deployment_environment_bindings (
  environment_id text PRIMARY KEY
    REFERENCES deployment_environments(id) ON DELETE CASCADE,
  worker_role_arn text NOT NULL
    CHECK (worker_role_arn ~ '^arn:aws:iam::[0-9]{12}:role/[A-Za-z0-9+=,.@_/-]+$'),
  cloudformation_role_arn text NOT NULL
    CHECK (cloudformation_role_arn ~ '^arn:aws:iam::[0-9]{12}:role/[A-Za-z0-9+=,.@_/-]+$'),
  tenant_stack_parameters text NOT NULL DEFAULT '{}'
    CHECK (
      jsonb_typeof(tenant_stack_parameters::jsonb) = 'object'
      AND octet_length(tenant_stack_parameters) <= 32768
    ),
  status text NOT NULL DEFAULT 'inactive'
    CHECK (status IN ('active', 'inactive')),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  CHECK (worker_role_arn <> cloudformation_role_arn)
);
CREATE INDEX deployment_environment_bindings_status_idx
  ON deployment_environment_bindings (status);

CREATE TABLE deployment_cleanup_schedules (
  id text PRIMARY KEY,
  deployment_id text NOT NULL
    REFERENCES app_instance_deployments(id) ON DELETE CASCADE,
  environment_id text NOT NULL
    REFERENCES deployment_environments(id) ON DELETE RESTRICT,
  stack_name text NOT NULL
    CHECK (stack_name ~ '^techlong-sandbox-tenant-[a-z0-9]{1,16}$'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'confirmed', 'running', 'succeeded', 'failed', 'canceled'
    )),
  expires_at bigint NOT NULL,
  provider_schedule_ref text,
  confirmed_at bigint,
  last_error text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  completed_at bigint,
  CHECK (
    status NOT IN ('confirmed', 'running', 'succeeded')
    OR (provider_schedule_ref IS NOT NULL AND confirmed_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX deployment_cleanup_schedules_deployment_unique
  ON deployment_cleanup_schedules (deployment_id);
CREATE UNIQUE INDEX deployment_cleanup_schedules_stack_unique
  ON deployment_cleanup_schedules (stack_name);
CREATE INDEX deployment_cleanup_schedules_due_idx
  ON deployment_cleanup_schedules (status, expires_at);

CREATE TABLE deployment_environment_capacity_reservations (
  deployment_id text PRIMARY KEY
    REFERENCES app_instance_deployments(id) ON DELETE CASCADE,
  environment_id text NOT NULL
    REFERENCES deployment_environments(id) ON DELETE RESTRICT,
  slot integer NOT NULL CHECK (slot BETWEEN 1 AND 1000),
  reserved_at bigint NOT NULL
);
CREATE UNIQUE INDEX deployment_environment_capacity_reservations_slot_unique
  ON deployment_environment_capacity_reservations (environment_id, slot);

INSERT INTO deployment_environment_capacity_reservations (
  deployment_id, environment_id, slot, reserved_at
)
SELECT deployment.id, deployment.environment_id,
  row_number() OVER (
    PARTITION BY deployment.environment_id ORDER BY deployment.created_at, deployment.id
  )::integer,
  (extract(epoch from clock_timestamp()) * 1000)::bigint
FROM app_instance_deployments deployment
INNER JOIN deployment_environments environment
  ON environment.id = deployment.environment_id
WHERE environment.kind = 'aws_sandbox'
  AND deployment.status IN (
    'queued', 'preflight', 'database_preparing', 'migrating',
    'infrastructure_provisioning', 'waiting_healthy', 'configuring',
    'verifying', 'ready'
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM deployment_environment_capacity_reservations reservation
    INNER JOIN deployment_environments environment
      ON environment.id = reservation.environment_id
    GROUP BY environment.id, environment.policy
    HAVING max(reservation.slot) > (environment.policy::jsonb ->> 'maxTenants')::integer
  ) THEN
    RAISE EXCEPTION 'Existing AWS Sandbox deployments exceed maxTenants; capacity migration aborted';
  END IF;
END $$;

ALTER TABLE deployment_jobs
  DROP CONSTRAINT IF EXISTS deployment_jobs_job_type_check;
ALTER TABLE deployment_jobs
  DROP CONSTRAINT IF EXISTS deployment_jobs_type_check;
ALTER TABLE deployment_jobs
  ADD CONSTRAINT deployment_jobs_job_type_check
  CHECK (job_type IN ('apply', 'rollback', 'reconcile', 'cleanup'));
