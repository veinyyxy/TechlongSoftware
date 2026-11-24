-- The approval row is the durable start intent. Registration leaves the held job untouched.
CREATE TABLE first_open_executions (
  id text PRIMARY KEY CHECK (id ~ '^exec_[a-f0-9]{32}$'),
  instance_id text NOT NULL UNIQUE REFERENCES app_instances(id) ON DELETE RESTRICT,
  job_id text NOT NULL UNIQUE REFERENCES deployment_jobs(id) ON DELETE RESTRICT,
  deployment_id text NOT NULL UNIQUE REFERENCES app_instance_deployments(id) ON DELETE RESTRICT,
  purchase_order_id text NOT NULL REFERENCES subscription_purchase_orders(id) ON DELETE RESTRICT,
  release_id text NOT NULL CHECK (release_id ~ '^release_[a-f0-9]{32}$'),
  artifact_ref text NOT NULL CHECK (artifact_ref ~ '@sha256:[a-f0-9]{64}$'),
  review_sha256 text NOT NULL CHECK (review_sha256 ~ '^[a-f0-9]{64}$'),
  approved_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_at bigint NOT NULL CHECK (approved_at > 0)
);

-- Only execution-correlated, safe metadata belongs in this log.
CREATE TABLE first_open_execution_events (
  execution_id text NOT NULL REFERENCES first_open_executions(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence > 0),
  step text NOT NULL CHECK (step IN ('approval', 'task_start', 'database_initialization', 'api_deployment', 'self_check', 'activation')),
  status text NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'unknown')),
  at bigint NOT NULL CHECK (at > 0),
  error_code text CHECK (error_code IN ('AccessDenied', 'DATABASE_INITIALIZATION_FAILED', 'API_DEPLOYMENT_FAILED', 'SELF_CHECK_FAILED', 'ACTIVATION_FAILED', 'RESULT_UNCONFIRMED')),
  PRIMARY KEY (execution_id, sequence),
  UNIQUE (execution_id, step, status),
  CHECK ((sequence = 1) = (step = 'approval') AND (step <> 'approval' OR status = 'completed')),
  CHECK (error_code IS NULL OR status IN ('failed', 'unknown'))
);
