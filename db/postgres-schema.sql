BEGIN;

CREATE TABLE users (
  id text PRIMARY KEY,
  email text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  is_platform_admin integer NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE UNIQUE INDEX users_email_unique ON users (email);
CREATE INDEX users_status_idx ON users (status);

CREATE TABLE user_credentials (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  password_iterations integer NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until bigint,
  password_changed_at bigint NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX user_credentials_locked_until_idx
  ON user_credentials (locked_until);

CREATE TABLE auth_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at bigint NOT NULL,
  last_seen_at bigint NOT NULL,
  created_at bigint NOT NULL
);
CREATE UNIQUE INDEX auth_sessions_token_hash_unique
  ON auth_sessions (token_hash);
CREATE INDEX auth_sessions_user_id_idx ON auth_sessions (user_id);
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions (expires_at);

CREATE TABLE auth_invitations (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at bigint NOT NULL,
  accepted_at bigint,
  created_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at bigint NOT NULL
);
CREATE UNIQUE INDEX auth_invitations_token_hash_unique
  ON auth_invitations (token_hash);
CREATE INDEX auth_invitations_user_id_idx ON auth_invitations (user_id);
CREATE INDEX auth_invitations_expires_at_idx ON auth_invitations (expires_at);

CREATE TABLE products (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE UNIQUE INDEX products_slug_unique ON products (slug);
CREATE INDEX products_status_idx ON products (status);

CREATE TABLE app_instance_templates (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE UNIQUE INDEX app_instance_templates_product_name_unique
  ON app_instance_templates (product_id, name);
CREATE INDEX app_instance_templates_product_id_idx
  ON app_instance_templates (product_id);
CREATE INDEX app_instance_templates_status_idx
  ON app_instance_templates (status);

CREATE TABLE app_instance_template_versions (
  id text PRIMARY KEY,
  template_id text NOT NULL
    REFERENCES app_instance_templates(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  configuration_schema text NOT NULL DEFAULT '{"fields":[]}'
    CHECK (jsonb_typeof(configuration_schema::jsonb) = 'object'),
  default_configuration text NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(default_configuration::jsonb) = 'object'),
  deployment_driver text NOT NULL DEFAULT 'manual',
  deployment_workflow_version text NOT NULL DEFAULT 'v1',
  status text NOT NULL DEFAULT 'draft',
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE UNIQUE INDEX app_instance_template_versions_template_version_unique
  ON app_instance_template_versions (template_id, version);
CREATE INDEX app_instance_template_versions_template_id_idx
  ON app_instance_template_versions (template_id);
CREATE INDEX app_instance_template_versions_status_idx
  ON app_instance_template_versions (status);

CREATE TABLE plans (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  template_version_id text NOT NULL
    REFERENCES app_instance_template_versions(id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_amount integer NOT NULL,
  currency text NOT NULL,
  billing_interval text NOT NULL,
  deployment_profile_key text NOT NULL DEFAULT 'standard-v1'
    CHECK (deployment_profile_key IN (
      'standard-v1', 'large-v1', 'large-dedicated-db-v1'
    )),
  status text NOT NULL DEFAULT 'active',
  features text NOT NULL DEFAULT '[]',
  limits text NOT NULL DEFAULT '{}',
  template_configuration text NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(template_configuration::jsonb) = 'object'),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE UNIQUE INDEX plans_product_name_unique ON plans (product_id, name);
CREATE INDEX plans_product_id_idx ON plans (product_id);
CREATE INDEX plans_status_idx ON plans (status);

CREATE TABLE workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active',
  contact_name text,
  contact_email text,
  plan_id text REFERENCES plans(id) ON DELETE SET NULL,
  subscription_status text NOT NULL DEFAULT 'not_configured',
  app_instance_status text NOT NULL DEFAULT 'not_provisioned',
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX workspaces_owner_id_idx ON workspaces (owner_id);
CREATE INDEX workspaces_plan_id_idx ON workspaces (plan_id);
CREATE INDEX workspaces_status_idx ON workspaces (status);

CREATE TABLE subscriptions (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  plan_id text NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  template_version_id text NOT NULL
    REFERENCES app_instance_template_versions(id) ON DELETE RESTRICT,
  instance_configuration text NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(instance_configuration::jsonb) = 'object'),
  status text NOT NULL DEFAULT 'manual_pending',
  current_period_start bigint NOT NULL,
  current_period_end bigint NOT NULL,
  cancel_at_period_end integer NOT NULL DEFAULT 0,
  creation_source text NOT NULL DEFAULT 'admin_manual',
  deployment_profile_key text NOT NULL DEFAULT 'standard-v1'
    CHECK (deployment_profile_key IN (
      'standard-v1', 'large-v1', 'large-dedicated-db-v1'
    )),
  created_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE UNIQUE INDEX subscriptions_workspace_product_current_unique
  ON subscriptions (workspace_id, product_id)
  WHERE status IN ('manual_pending', 'active', 'past_due', 'paused');
CREATE INDEX subscriptions_workspace_id_idx ON subscriptions (workspace_id);
CREATE INDEX subscriptions_product_id_idx ON subscriptions (product_id);
CREATE INDEX subscriptions_plan_id_idx ON subscriptions (plan_id);
CREATE INDEX subscriptions_template_version_id_idx
  ON subscriptions (template_version_id);
CREATE INDEX subscriptions_status_idx ON subscriptions (status);

CREATE TABLE payment_records (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subscription_id text REFERENCES subscriptions(id) ON DELETE SET NULL,
  amount integer NOT NULL,
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  paid_at bigint,
  payment_method text NOT NULL,
  provider text NOT NULL DEFAULT 'manual',
  provider_payment_id text,
  provider_event_id text,
  reference text,
  note text,
  failure_reason text,
  recorded_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX payment_records_workspace_id_idx
  ON payment_records (workspace_id);
CREATE INDEX payment_records_subscription_id_idx
  ON payment_records (subscription_id);
CREATE INDEX payment_records_status_idx ON payment_records (status);
CREATE UNIQUE INDEX payment_records_provider_payment_id_unique
  ON payment_records (provider, provider_payment_id);
CREATE UNIQUE INDEX payment_records_provider_event_id_unique
  ON payment_records (provider, provider_event_id);

CREATE TABLE payment_checkout_sessions (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subscription_id text NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  payment_record_id text NOT NULL
    REFERENCES payment_records(id) ON DELETE CASCADE,
  initiated_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'stripe',
  provider_session_id text,
  provider_payment_id text,
  checkout_url text,
  status text NOT NULL DEFAULT 'creating',
  expires_at bigint,
  completed_at bigint,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE UNIQUE INDEX payment_checkout_sessions_provider_session_unique
  ON payment_checkout_sessions (provider, provider_session_id);
CREATE UNIQUE INDEX payment_checkout_sessions_subscription_inflight_unique
  ON payment_checkout_sessions (subscription_id)
  WHERE status IN ('creating', 'open');
CREATE INDEX payment_checkout_sessions_workspace_id_idx
  ON payment_checkout_sessions (workspace_id);
CREATE INDEX payment_checkout_sessions_subscription_id_idx
  ON payment_checkout_sessions (subscription_id);
CREATE INDEX payment_checkout_sessions_payment_record_id_idx
  ON payment_checkout_sessions (payment_record_id);
CREATE INDEX payment_checkout_sessions_status_idx
  ON payment_checkout_sessions (status);

CREATE TABLE app_instances (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  subscription_id text REFERENCES subscriptions(id) ON DELETE SET NULL,
  template_version_id text
    REFERENCES app_instance_template_versions(id) ON DELETE RESTRICT,
  configuration_snapshot text NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(configuration_snapshot::jsonb) = 'object'),
  name text NOT NULL,
  slug text NOT NULL,
  domain text,
  access_url text NOT NULL,
  seller_apk_url text NOT NULL DEFAULT '',
  tenant_key text NOT NULL,
  provisioning_source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'pending',
  provisioned_at bigint,
  suspended_at bigint,
  created_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE UNIQUE INDEX app_instances_slug_unique ON app_instances (slug);
CREATE UNIQUE INDEX app_instances_tenant_key_unique
  ON app_instances (tenant_key);
CREATE UNIQUE INDEX app_instances_workspace_product_unique
  ON app_instances (workspace_id, product_id);
CREATE INDEX app_instances_workspace_id_idx ON app_instances (workspace_id);
CREATE INDEX app_instances_product_id_idx ON app_instances (product_id);
CREATE INDEX app_instances_subscription_id_idx
  ON app_instances (subscription_id);
CREATE INDEX app_instances_template_version_id_idx
  ON app_instances (template_version_id);
CREATE INDEX app_instances_status_idx ON app_instances (status);

CREATE TABLE subscription_purchase_orders (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  plan_id text NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  template_version_id text NOT NULL
    REFERENCES app_instance_template_versions(id) ON DELETE RESTRICT,
  subscription_id text REFERENCES subscriptions(id) ON DELETE SET NULL,
  renewal_subscription_id text REFERENCES subscriptions(id) ON DELETE SET NULL,
  payment_record_id text REFERENCES payment_records(id) ON DELETE SET NULL,
  order_type text NOT NULL DEFAULT 'new_subscription',
  configuration_snapshot text NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(configuration_snapshot::jsonb) = 'object'),
  amount integer NOT NULL,
  currency text NOT NULL,
  billing_interval text NOT NULL,
  deployment_profile_key text NOT NULL DEFAULT 'standard-v1'
    CHECK (deployment_profile_key IN (
      'standard-v1', 'large-v1', 'large-dedicated-db-v1'
    )),
  status text NOT NULL DEFAULT 'draft',
  provider text NOT NULL DEFAULT 'stripe',
  provider_session_id text,
  provider_payment_id text,
  checkout_url text,
  failure_reason text,
  created_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at bigint,
  completed_at bigint,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE UNIQUE INDEX subscription_purchase_orders_provider_session_unique
  ON subscription_purchase_orders (provider, provider_session_id);
CREATE UNIQUE INDEX subscription_purchase_orders_subscription_unique
  ON subscription_purchase_orders (subscription_id);
CREATE UNIQUE INDEX subscription_purchase_orders_workspace_product_inflight_unique
  ON subscription_purchase_orders (workspace_id, product_id)
  WHERE status IN ('draft', 'checkout_pending');
CREATE INDEX subscription_purchase_orders_workspace_id_idx
  ON subscription_purchase_orders (workspace_id);
CREATE INDEX subscription_purchase_orders_product_id_idx
  ON subscription_purchase_orders (product_id);
CREATE INDEX subscription_purchase_orders_plan_id_idx
  ON subscription_purchase_orders (plan_id);
CREATE INDEX subscription_purchase_orders_status_idx
  ON subscription_purchase_orders (status);
CREATE INDEX subscription_purchase_orders_created_at_idx
  ON subscription_purchase_orders (created_at);

CREATE TABLE deployment_environments (
  id text PRIMARY KEY,
  key text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL
    CHECK (kind IN ('aws_sandbox', 'aws_production')),
  driver text NOT NULL CHECK (driver = 'aws_ecs_cell'),
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
);

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

CREATE TABLE app_instance_deployments (
  id text PRIMARY KEY,
  app_instance_id text NOT NULL
    REFERENCES app_instances(id) ON DELETE CASCADE,
  subscription_id text REFERENCES subscriptions(id) ON DELETE SET NULL,
  purchase_order_id text
    REFERENCES subscription_purchase_orders(id) ON DELETE SET NULL,
  environment_id text NOT NULL
    REFERENCES deployment_environments(id) ON DELETE RESTRICT,
  driver text NOT NULL,
  workflow_version text NOT NULL,
  cell_key text NOT NULL,
  deployment_profile_key text NOT NULL
    CHECK (deployment_profile_key IN (
      'standard-v1', 'large-v1', 'large-dedicated-db-v1'
    )),
  mode text NOT NULL DEFAULT 'plan_only'
    CHECK (mode IN ('plan_only', 'aws_sandbox', 'aws_production')),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN (
      'planned', 'queued', 'preflight', 'database_preparing', 'migrating',
      'infrastructure_provisioning', 'waiting_healthy', 'configuring',
      'verifying', 'ready', 'retry_wait', 'failed', 'cancel_requested',
      'rolling_back', 'rolled_back', 'rollback_failed', 'canceled'
    )),
  desired_plan text NOT NULL
    CHECK (jsonb_typeof(desired_plan::jsonb) = 'object'),
  plan_hash text NOT NULL,
  configuration_hash text
    CHECK (
      (mode = 'plan_only' AND configuration_hash IS NULL)
      OR (
        mode <> 'plan_only'
        AND configuration_hash IS NOT NULL
        AND configuration_hash ~ '^[a-f0-9]{64}$'
      )
    ),
  idempotency_key text NOT NULL,
  artifact_ref text,
  control_payload_hash text
    CHECK (
      control_payload_hash IS NULL
      OR control_payload_hash ~ '^[a-f0-9]{64}$'
    ),
  current_step text,
  outputs text NOT NULL DEFAULT '{}'
    CHECK (
      jsonb_typeof(outputs::jsonb) = 'object'
      AND octet_length(outputs) <= 32768
    ),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  started_at bigint,
  ready_at bigint,
  failed_at bigint,
  cancel_requested_at bigint,
  rollback_at bigint,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE UNIQUE INDEX app_instance_deployments_idempotency_unique
  ON app_instance_deployments (idempotency_key);
CREATE INDEX app_instance_deployments_app_instance_id_idx
  ON app_instance_deployments (app_instance_id);
CREATE INDEX app_instance_deployments_subscription_id_idx
  ON app_instance_deployments (subscription_id);
CREATE INDEX app_instance_deployments_status_idx
  ON app_instance_deployments (status);
CREATE INDEX app_instance_deployments_environment_id_idx
  ON app_instance_deployments (environment_id);

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

CREATE TABLE deployment_jobs (
  id text PRIMARY KEY,
  deployment_id text NOT NULL
    REFERENCES app_instance_deployments(id) ON DELETE CASCADE,
  job_type text NOT NULL
    CHECK (job_type IN ('apply', 'rollback', 'reconcile', 'cleanup')),
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
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
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

CREATE TABLE payment_webhook_events (
  id text PRIMARY KEY,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  checkout_session_id text
    REFERENCES payment_checkout_sessions(id) ON DELETE SET NULL,
  purchase_order_id text
    REFERENCES subscription_purchase_orders(id) ON DELETE SET NULL,
  payload_hash text NOT NULL,
  processing_status text NOT NULL DEFAULT 'pending',
  last_error text,
  received_at bigint NOT NULL,
  processed_at bigint
);
CREATE UNIQUE INDEX payment_webhook_events_provider_event_unique
  ON payment_webhook_events (provider, provider_event_id);
CREATE INDEX payment_webhook_events_checkout_session_id_idx
  ON payment_webhook_events (checkout_session_id);
CREATE INDEX payment_webhook_events_purchase_order_id_idx
  ON payment_webhook_events (purchase_order_id);
CREATE INDEX payment_webhook_events_processing_status_idx
  ON payment_webhook_events (processing_status);

CREATE TABLE workspace_members (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  joined_at bigint NOT NULL
);
CREATE UNIQUE INDEX workspace_members_workspace_user_unique
  ON workspace_members (workspace_id, user_id);
CREATE INDEX workspace_members_user_id_idx ON workspace_members (user_id);
CREATE INDEX workspace_members_workspace_id_idx
  ON workspace_members (workspace_id);

CREATE TABLE workspace_product_entitlements (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  current_subscription_id text
    REFERENCES subscriptions(id) ON DELETE SET NULL,
  app_instance_id text REFERENCES app_instances(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE UNIQUE INDEX workspace_product_entitlements_workspace_product_unique
  ON workspace_product_entitlements (workspace_id, product_id);
CREATE UNIQUE INDEX workspace_product_entitlements_app_instance_unique
  ON workspace_product_entitlements (app_instance_id);
CREATE INDEX workspace_product_entitlements_current_subscription_idx
  ON workspace_product_entitlements (current_subscription_id);
CREATE INDEX workspace_product_entitlements_status_idx
  ON workspace_product_entitlements (status);

CREATE OR REPLACE FUNCTION enforce_template_version_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('published', 'archived') THEN
      RAISE EXCEPTION 'published template version cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status IN ('published', 'archived') AND (
    NEW.template_id IS DISTINCT FROM OLD.template_id
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.configuration_schema IS DISTINCT FROM OLD.configuration_schema
    OR NEW.default_configuration IS DISTINCT FROM OLD.default_configuration
    OR NEW.deployment_driver IS DISTINCT FROM OLD.deployment_driver
    OR NEW.deployment_workflow_version IS DISTINCT FROM OLD.deployment_workflow_version
    OR (OLD.status = 'published' AND NEW.status NOT IN ('published', 'archived'))
    OR (OLD.status = 'archived' AND NEW.status <> 'archived')
  ) THEN
    RAISE EXCEPTION 'published template version is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER template_versions_published_immutable_update
BEFORE UPDATE ON app_instance_template_versions
FOR EACH ROW EXECUTE FUNCTION enforce_template_version_immutability();

CREATE TRIGGER template_versions_published_immutable_delete
BEFORE DELETE ON app_instance_template_versions
FOR EACH ROW EXECUTE FUNCTION enforce_template_version_immutability();

CREATE OR REPLACE FUNCTION enforce_plan_relationships()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.template_version_id IS DISTINCT FROM OLD.template_version_id THEN
    RAISE EXCEPTION 'plan template version is immutable';
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.product_id IS DISTINCT FROM OLD.product_id
    AND EXISTS (SELECT 1 FROM subscriptions WHERE plan_id = OLD.id) THEN
    RAISE EXCEPTION 'referenced plan product cannot be changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app_instance_template_versions version
    INNER JOIN app_instance_templates template
      ON template.id = version.template_id
    WHERE version.id = NEW.template_version_id
      AND version.status = 'published'
      AND template.status = 'active'
      AND template.product_id = NEW.product_id
  ) THEN
    RAISE EXCEPTION
      'plan template version must be published and belong to plan product';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER plans_relationships_insert
BEFORE INSERT ON plans
FOR EACH ROW EXECUTE FUNCTION enforce_plan_relationships();

CREATE TRIGGER plans_relationships_update
BEFORE UPDATE OF product_id, template_version_id ON plans
FOR EACH ROW EXECUTE FUNCTION enforce_plan_relationships();

CREATE OR REPLACE FUNCTION enforce_subscription_relationships()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM plans
    WHERE plans.id = NEW.plan_id
      AND plans.product_id = NEW.product_id
      AND plans.template_version_id = NEW.template_version_id
  ) THEN
    RAISE EXCEPTION
      'subscription product and template must match the selected plan';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER subscriptions_relationships_insert
BEFORE INSERT ON subscriptions
FOR EACH ROW EXECUTE FUNCTION enforce_subscription_relationships();

CREATE TRIGGER subscriptions_relationships_update
BEFORE UPDATE OF plan_id, product_id, template_version_id ON subscriptions
FOR EACH ROW EXECUTE FUNCTION enforce_subscription_relationships();

CREATE OR REPLACE FUNCTION enforce_app_instance_subscription()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.subscription_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM subscriptions
    WHERE subscriptions.id = NEW.subscription_id
      AND subscriptions.workspace_id = NEW.workspace_id
      AND subscriptions.product_id = NEW.product_id
      AND subscriptions.template_version_id = NEW.template_version_id
  ) THEN
    RAISE EXCEPTION 'app instance template must match subscription';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER app_instances_subscription_match_insert
BEFORE INSERT ON app_instances
FOR EACH ROW EXECUTE FUNCTION enforce_app_instance_subscription();

CREATE TRIGGER app_instances_subscription_match_update
BEFORE UPDATE OF subscription_id, template_version_id, workspace_id, product_id
ON app_instances
FOR EACH ROW EXECUTE FUNCTION enforce_app_instance_subscription();

INSERT INTO products (
  id, name, slug, description, status, created_at, updated_at
) VALUES (
  'prd_restaurant_order_system',
  '餐饮订单系统',
  'restaurant-order-system',
  '面向餐饮企业的订单管理系统。',
  'active',
  floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint,
  floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
) ON CONFLICT (id) DO NOTHING;

INSERT INTO app_instance_templates (
  id, product_id, name, description, status, created_at, updated_at
) VALUES (
  'tpl_restaurant_standard',
  'prd_restaurant_order_system',
  '餐饮订单系统标准模板',
  '餐饮订单系统默认实例模板；发布版本不可修改。',
  'active',
  floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint,
  floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
) ON CONFLICT (id) DO NOTHING;

INSERT INTO app_instance_template_versions (
  id, template_id, version, configuration_schema,
  default_configuration, deployment_driver,
  deployment_workflow_version, status, created_at, updated_at
) VALUES (
  'tplver_restaurant_standard_v1',
  'tpl_restaurant_standard',
  1,
  '{"fields":[{"key":"storeName","label":"店铺名称","type":"text","source":"customer","required":true},{"key":"theme","label":"店铺主题风格","type":"select","source":"customer","required":true,"options":["classic","warm","minimal"]},{"key":"visitorLimit","label":"访问人数限制","type":"number","source":"plan_limit","required":true,"limitKey":"访问人数限制","min":1}]}',
  '{"theme":"classic"}',
  'manual',
  'v1',
  'published',
  floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint,
  floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
) ON CONFLICT (id) DO NOTHING;

COMMIT;
