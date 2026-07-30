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
