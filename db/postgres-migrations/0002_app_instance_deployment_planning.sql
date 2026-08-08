ALTER TABLE plans
  ADD COLUMN deployment_profile_key text NOT NULL DEFAULT 'standard-v1'
  CHECK (deployment_profile_key IN (
    'standard-v1', 'large-v1', 'large-dedicated-db-v1'
  ));

ALTER TABLE subscriptions
  ADD COLUMN deployment_profile_key text NOT NULL DEFAULT 'standard-v1'
  CHECK (deployment_profile_key IN (
    'standard-v1', 'large-v1', 'large-dedicated-db-v1'
  ));

ALTER TABLE subscription_purchase_orders
  ADD COLUMN deployment_profile_key text NOT NULL DEFAULT 'standard-v1'
  CHECK (deployment_profile_key IN (
    'standard-v1', 'large-v1', 'large-dedicated-db-v1'
  ));

CREATE TABLE app_instance_deployments (
  id text PRIMARY KEY,
  app_instance_id text NOT NULL
    REFERENCES app_instances(id) ON DELETE CASCADE,
  subscription_id text REFERENCES subscriptions(id) ON DELETE SET NULL,
  purchase_order_id text
    REFERENCES subscription_purchase_orders(id) ON DELETE SET NULL,
  driver text NOT NULL,
  workflow_version text NOT NULL,
  cell_key text NOT NULL,
  deployment_profile_key text NOT NULL
    CHECK (deployment_profile_key IN (
      'standard-v1', 'large-v1', 'large-dedicated-db-v1'
    )),
  mode text NOT NULL DEFAULT 'plan_only'
    CHECK (mode = 'plan_only'),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN (
      'planned', 'queued', 'provisioning', 'ready', 'failed', 'canceled'
    )),
  desired_plan text NOT NULL
    CHECK (jsonb_typeof(desired_plan::jsonb) = 'object'),
  plan_hash text NOT NULL,
  idempotency_key text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
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
