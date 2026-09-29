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
  admission_state text NOT NULL DEFAULT 'open'
    CHECK (admission_state IN ('open', 'draining')),
  admission_epoch bigint NOT NULL DEFAULT 0
    CHECK (admission_epoch >= 0),
  admission_fence_sha256 text
    CHECK (
      admission_fence_sha256 IS NULL
      OR admission_fence_sha256 ~ '^[a-f0-9]{64}$'
    ),
  admission_provision_operation_hash text
    CONSTRAINT deployment_environments_admission_provision_hash_check CHECK (
      admission_provision_operation_hash IS NULL
      OR admission_provision_operation_hash ~ '^[a-f0-9]{64}$'
    ),
  admission_stack_id text,
  admission_cell_expires_at bigint,
  admission_changed_at bigint NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  CONSTRAINT deployment_environments_admission_consistency_check CHECK (
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
  )
);
CREATE UNIQUE INDEX deployment_environments_key_unique
  ON deployment_environments (key);
CREATE INDEX deployment_environments_status_idx
  ON deployment_environments (status);

INSERT INTO deployment_environments (
  id, key, name, kind, driver, expected_account_id, region, cell_key,
  base_domain, apply_enabled, policy, status, admission_changed_at,
  created_at, updated_at
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
  external_operation_epoch bigint
    CHECK (external_operation_epoch > 0),
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
  lease_token text,
  last_error_code text,
  last_error_message text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  completed_at bigint,
  CONSTRAINT deployment_jobs_lease_token_check CHECK (
    lease_token IS NULL OR lease_token ~ '^lease_[a-f0-9]{32}$'
  ),
  CONSTRAINT deployment_jobs_lease_check CHECK (
    (
      status = 'running' AND lease_owner IS NOT NULL
      AND lease_expires_at IS NOT NULL AND lease_token IS NOT NULL
    ) OR (
      status <> 'running' AND lease_owner IS NULL
      AND lease_expires_at IS NULL AND lease_token IS NULL
    )
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
  ON deployment_step_runs (job_id, step_key, input_hash, attempt);
CREATE INDEX deployment_step_runs_deployment_id_idx
  ON deployment_step_runs (deployment_id, started_at);
CREATE INDEX deployment_step_runs_job_id_idx
  ON deployment_step_runs (job_id);

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
    state <> 'active'
    OR (evidence_hash IS NOT NULL AND evidence::jsonb <> '{}'::jsonb)
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
    REFERENCES deployment_tenant_external_operations (
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
    CHECK (
      next_phase IS NULL
      OR next_phase IN ('workload', 'database', 'secret', 'finalize')
    ),
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
    REFERENCES deployment_tenant_external_operations (
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

-- J5g-j2 durable Shared Cell author compensation persistence.
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

COMMIT;
