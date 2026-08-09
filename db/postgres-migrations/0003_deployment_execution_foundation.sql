CREATE TABLE deployment_environments (
  id text PRIMARY KEY,
  key text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL
    CHECK (kind IN ('aws_sandbox', 'aws_production')),
  driver text NOT NULL
    CHECK (driver = 'aws_ecs_cell'),
  expected_account_id text NOT NULL
    CHECK (expected_account_id ~ '^[0-9]{12}$'),
  region text NOT NULL,
  cell_key text NOT NULL,
  base_domain text NOT NULL,
  apply_enabled integer NOT NULL DEFAULT 0
    CHECK (apply_enabled IN (0, 1)),
  policy text NOT NULL
    CHECK (
      jsonb_typeof(policy::jsonb) = 'object'
      AND octet_length(policy) <= 16384
    ),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE UNIQUE INDEX deployment_environments_key_unique
  ON deployment_environments (key);
CREATE INDEX deployment_environments_status_idx
  ON deployment_environments (status);

INSERT INTO deployment_environments (
  id, key, name, kind, driver, expected_account_id, region, cell_key,
  base_domain, apply_enabled, policy, status, created_at, updated_at
) VALUES (
  'env_aws_sandbox_ca_central_1',
  'aws-sandbox-ca-central-1',
  'AWS Sandbox ca-central-1',
  'aws_sandbox',
  'aws_ecs_cell',
  '402010193138',
  'ca-central-1',
  'cell-sandbox-1',
  'sandbox.techlong.cloud',
  0,
  '{
    "budgetLimitCents": 1000,
    "ttlSeconds": 7200,
    "maxCells": 1,
    "maxTenants": 1,
    "maxTaskCount": 1,
    "allowedProfiles": ["standard-v1"],
    "allowNatGateway": false,
    "allowInterfaceEndpoints": false,
    "databaseEngine": "aurora-postgresql-serverless-v2",
    "auroraPostgresMinimumVersion": "16.3",
    "auroraPostgresEngineVersion": "16.14",
    "auroraEngineMode": "provisioned",
    "allowLimitlessDatabase": false,
    "databaseMode": "tenant_database",
    "auroraServerlessMinAcu": 0,
    "auroraServerlessMaxAcu": 1,
    "auroraSecondsUntilAutoPause": 300,
    "allowDedicatedDatabase": false,
    "allowMultiAzDatabase": false,
    "allowRdsProxy": false,
    "allowGlobalDatabase": false,
    "logRetentionDays": 1
  }',
  'active',
  (extract(epoch from clock_timestamp()) * 1000)::bigint,
  (extract(epoch from clock_timestamp()) * 1000)::bigint
) ON CONFLICT (key) DO NOTHING;

ALTER TABLE app_instance_deployments
  ADD COLUMN environment_id text
    REFERENCES deployment_environments(id) ON DELETE RESTRICT;
UPDATE app_instance_deployments
SET environment_id = (
  SELECT id
  FROM deployment_environments
  WHERE key = 'aws-sandbox-ca-central-1'
  LIMIT 1
)
WHERE environment_id IS NULL;
ALTER TABLE app_instance_deployments
  ALTER COLUMN environment_id SET NOT NULL;

ALTER TABLE app_instance_deployments
  DROP CONSTRAINT IF EXISTS app_instance_deployments_mode_check;
ALTER TABLE app_instance_deployments
  ADD CONSTRAINT app_instance_deployments_mode_check
  CHECK (mode IN ('plan_only', 'aws_sandbox', 'aws_production'));

ALTER TABLE app_instance_deployments
  DROP CONSTRAINT IF EXISTS app_instance_deployments_status_check;
UPDATE app_instance_deployments
SET status = 'infrastructure_provisioning'
WHERE status = 'provisioning';
ALTER TABLE app_instance_deployments
  ADD CONSTRAINT app_instance_deployments_status_check
  CHECK (status IN (
    'planned', 'queued', 'preflight', 'database_preparing', 'migrating',
    'infrastructure_provisioning', 'waiting_healthy', 'configuring',
    'verifying', 'ready', 'retry_wait', 'failed', 'cancel_requested',
    'rolling_back', 'rolled_back', 'rollback_failed', 'canceled'
  ));

ALTER TABLE app_instance_deployments
  ADD COLUMN configuration_hash text;
ALTER TABLE app_instance_deployments
  ADD CONSTRAINT app_instance_deployments_configuration_hash_check
  CHECK (
    (mode = 'plan_only' AND configuration_hash IS NULL)
    OR (
      mode <> 'plan_only'
      AND configuration_hash IS NOT NULL
      AND configuration_hash ~ '^[a-f0-9]{64}$'
    )
  );

ALTER TABLE app_instance_deployments
  ADD COLUMN artifact_ref text,
  ADD COLUMN control_payload_hash text,
  ADD COLUMN current_step text,
  ADD COLUMN outputs text NOT NULL DEFAULT '{}',
  ADD COLUMN started_at bigint,
  ADD COLUMN ready_at bigint,
  ADD COLUMN failed_at bigint,
  ADD COLUMN cancel_requested_at bigint,
  ADD COLUMN rollback_at bigint;
ALTER TABLE app_instance_deployments
  ADD CONSTRAINT app_instance_deployments_control_payload_hash_check
  CHECK (
    control_payload_hash IS NULL
    OR control_payload_hash ~ '^[a-f0-9]{64}$'
  );
ALTER TABLE app_instance_deployments
  ADD CONSTRAINT app_instance_deployments_outputs_check
  CHECK (
    jsonb_typeof(outputs::jsonb) = 'object'
    AND octet_length(outputs) <= 32768
  );
CREATE INDEX app_instance_deployments_environment_id_idx
  ON app_instance_deployments (environment_id);

CREATE TABLE deployment_jobs (
  id text PRIMARY KEY,
  deployment_id text NOT NULL
    REFERENCES app_instance_deployments(id) ON DELETE CASCADE,
  job_type text NOT NULL
    CHECK (job_type IN ('apply', 'rollback', 'reconcile')),
  dedupe_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'running', 'retry_wait', 'succeeded', 'dead_letter',
      'canceled'
    )),
  payload text NOT NULL DEFAULT '{}'
    CHECK (
      jsonb_typeof(payload::jsonb) = 'object'
      AND octet_length(payload) <= 32768
    ),
  attempts integer NOT NULL DEFAULT 0
    CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5
    CHECK (max_attempts BETWEEN 1 AND 20),
  available_at bigint NOT NULL,
  lease_owner text,
  lease_expires_at bigint,
  last_error_code text,
  last_error_message text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  completed_at bigint,
  CHECK (
    status <> 'running'
    OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX deployment_jobs_dedupe_unique
  ON deployment_jobs (dedupe_key);
CREATE INDEX deployment_jobs_claim_idx
  ON deployment_jobs (status, available_at, created_at);
CREATE INDEX deployment_jobs_deployment_id_idx
  ON deployment_jobs (deployment_id);
CREATE UNIQUE INDEX deployment_jobs_one_running_per_deployment
  ON deployment_jobs (deployment_id)
  WHERE status = 'running';
CREATE INDEX deployment_jobs_lease_expires_at_idx
  ON deployment_jobs (lease_expires_at)
  WHERE status = 'running';

CREATE TABLE deployment_step_runs (
  id text PRIMARY KEY,
  deployment_id text NOT NULL
    REFERENCES app_instance_deployments(id) ON DELETE CASCADE,
  job_id text NOT NULL
    REFERENCES deployment_jobs(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  attempt integer NOT NULL CHECK (attempt >= 1),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  input_hash text NOT NULL
    CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  output text NOT NULL DEFAULT '{}'
    CHECK (
      jsonb_typeof(output::jsonb) = 'object'
      AND octet_length(output) <= 32768
    ),
  error_code text,
  error_message text,
  started_at bigint NOT NULL,
  finished_at bigint
);
CREATE UNIQUE INDEX deployment_step_runs_attempt_unique
  ON deployment_step_runs (deployment_id, step_key, input_hash, attempt);
CREATE INDEX deployment_step_runs_deployment_id_idx
  ON deployment_step_runs (deployment_id, started_at);
CREATE INDEX deployment_step_runs_job_id_idx
  ON deployment_step_runs (job_id);
