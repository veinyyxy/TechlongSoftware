CREATE TABLE `app_instance_templates` (
  `id` text PRIMARY KEY NOT NULL,
  `product_id` text NOT NULL,
  `name` text NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT
);--> statement-breakpoint
CREATE UNIQUE INDEX `app_instance_templates_product_name_unique`
ON `app_instance_templates` (`product_id`,`name`);--> statement-breakpoint
CREATE INDEX `app_instance_templates_product_id_idx`
ON `app_instance_templates` (`product_id`);--> statement-breakpoint
CREATE INDEX `app_instance_templates_status_idx`
ON `app_instance_templates` (`status`);--> statement-breakpoint
CREATE TABLE `app_instance_template_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `template_id` text NOT NULL,
  `version` integer NOT NULL,
  `configuration_schema` text DEFAULT '{"fields":[]}' NOT NULL,
  `default_configuration` text DEFAULT '{}' NOT NULL,
  `deployment_driver` text DEFAULT 'manual' NOT NULL,
  `deployment_workflow_version` text DEFAULT 'v1' NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`template_id`) REFERENCES `app_instance_templates`(`id`) ON DELETE RESTRICT
);--> statement-breakpoint
CREATE UNIQUE INDEX `app_instance_template_versions_template_version_unique`
ON `app_instance_template_versions` (`template_id`,`version`);--> statement-breakpoint
CREATE INDEX `app_instance_template_versions_template_id_idx`
ON `app_instance_template_versions` (`template_id`);--> statement-breakpoint
CREATE INDEX `app_instance_template_versions_status_idx`
ON `app_instance_template_versions` (`status`);--> statement-breakpoint
INSERT OR IGNORE INTO `app_instance_templates` (
  `id`, `product_id`, `name`, `description`, `status`, `created_at`, `updated_at`
) VALUES (
  'tpl_restaurant_standard',
  'prd_restaurant_order_system',
  '餐饮订单系统标准模板',
  '餐饮订单系统默认实例模板；发布版本不可修改。',
  'active',
  CAST(unixepoch() * 1000 AS INTEGER),
  CAST(unixepoch() * 1000 AS INTEGER)
);--> statement-breakpoint
INSERT OR IGNORE INTO `app_instance_template_versions` (
  `id`, `template_id`, `version`, `configuration_schema`,
  `default_configuration`, `deployment_driver`,
  `deployment_workflow_version`, `status`, `created_at`, `updated_at`
) VALUES (
  'tplver_restaurant_standard_v1',
  'tpl_restaurant_standard',
  1,
  '{"fields":[{"key":"storeName","label":"店铺名称","type":"text","source":"customer","required":true},{"key":"theme","label":"店铺主题风格","type":"select","source":"customer","required":true,"options":["classic","warm","minimal"]},{"key":"visitorLimit","label":"访问人数限制","type":"number","source":"plan_limit","required":true,"limitKey":"访问人数限制","min":1}]}',
  '{"theme":"classic"}',
  'manual',
  'v1',
  'published',
  CAST(unixepoch() * 1000 AS INTEGER),
  CAST(unixepoch() * 1000 AS INTEGER)
);--> statement-breakpoint
ALTER TABLE `plans`
ADD `template_version_id` text REFERENCES app_instance_template_versions(id) ON DELETE RESTRICT;--> statement-breakpoint
UPDATE `plans`
SET `template_version_id` = 'tplver_restaurant_standard_v1'
WHERE `template_version_id` IS NULL;--> statement-breakpoint
UPDATE `plans`
SET `limits` = json_set(
  CASE WHEN json_valid(`limits`) THEN `limits` ELSE '{}' END,
  '$."访问人数限制"',
  COALESCE(
    json_extract(
      CASE WHEN json_valid(`limits`) THEN `limits` ELSE '{}' END,
      '$."访问人数限制"'
    ),
    '100'
  )
);--> statement-breakpoint
ALTER TABLE `subscriptions`
ADD `template_version_id` text REFERENCES app_instance_template_versions(id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `subscriptions`
ADD `instance_configuration` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
UPDATE `subscriptions`
SET `template_version_id` = (
  SELECT `template_version_id`
  FROM `plans`
  WHERE `plans`.`id` = `subscriptions`.`plan_id`
)
WHERE `template_version_id` IS NULL;--> statement-breakpoint
UPDATE `subscriptions`
SET `instance_configuration` = json_object(
  'storeName',
  COALESCE(
    (SELECT `name` FROM `workspaces` WHERE `workspaces`.`id` = `subscriptions`.`workspace_id`),
    '待配置店铺'
  ),
  'theme',
  'classic',
  'visitorLimit',
  CAST(COALESCE(
    (
      SELECT json_extract(`limits`, '$."访问人数限制"')
      FROM `plans`
      WHERE `plans`.`id` = `subscriptions`.`plan_id`
    ),
    100
  ) AS INTEGER)
);--> statement-breakpoint
CREATE INDEX `subscriptions_template_version_id_idx`
ON `subscriptions` (`template_version_id`);--> statement-breakpoint
ALTER TABLE `app_instances`
ADD `template_version_id` text REFERENCES app_instance_template_versions(id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `app_instances`
ADD `configuration_snapshot` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX `app_instances_template_version_id_idx`
ON `app_instances` (`template_version_id`);--> statement-breakpoint
CREATE TRIGGER `template_versions_published_immutable_update`
BEFORE UPDATE ON `app_instance_template_versions`
WHEN OLD.`status` IN ('published', 'archived')
  AND (
    NEW.`template_id` IS NOT OLD.`template_id`
    OR NEW.`version` IS NOT OLD.`version`
    OR NEW.`configuration_schema` IS NOT OLD.`configuration_schema`
    OR NEW.`default_configuration` IS NOT OLD.`default_configuration`
    OR NEW.`deployment_driver` IS NOT OLD.`deployment_driver`
    OR NEW.`deployment_workflow_version` IS NOT OLD.`deployment_workflow_version`
    OR (OLD.`status` = 'published' AND NEW.`status` NOT IN ('published', 'archived'))
    OR (OLD.`status` = 'archived' AND NEW.`status` <> 'archived')
  )
BEGIN
  SELECT RAISE(ABORT, 'published template version is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `template_versions_published_immutable_delete`
BEFORE DELETE ON `app_instance_template_versions`
WHEN OLD.`status` IN ('published', 'archived')
BEGIN
  SELECT RAISE(ABORT, 'published template version cannot be deleted');
END;--> statement-breakpoint
CREATE TRIGGER `plans_template_required_insert`
BEFORE INSERT ON `plans`
WHEN NEW.`template_version_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'plans.template_version_id is required');
END;--> statement-breakpoint
CREATE TRIGGER `plans_template_required_update`
BEFORE UPDATE OF `template_version_id` ON `plans`
WHEN NEW.`template_version_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'plans.template_version_id is required');
END;--> statement-breakpoint
CREATE TRIGGER `plans_template_match_insert`
BEFORE INSERT ON `plans`
WHEN NOT EXISTS (
  SELECT 1
  FROM `app_instance_template_versions` `version`
  INNER JOIN `app_instance_templates` `template`
    ON `template`.`id` = `version`.`template_id`
  WHERE `version`.`id` = NEW.`template_version_id`
    AND `version`.`status` = 'published'
    AND `template`.`status` = 'active'
    AND `template`.`product_id` = NEW.`product_id`
)
BEGIN
  SELECT RAISE(ABORT, 'plan template version must be published and belong to plan product');
END;--> statement-breakpoint
CREATE TRIGGER `plans_template_change_blocked`
BEFORE UPDATE OF `template_version_id` ON `plans`
WHEN NEW.`template_version_id` <> OLD.`template_version_id`
BEGIN
  SELECT RAISE(ABORT, 'plan template version is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `subscriptions_template_required_insert`
BEFORE INSERT ON `subscriptions`
WHEN NEW.`template_version_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'subscriptions.template_version_id is required');
END;--> statement-breakpoint
CREATE TRIGGER `subscriptions_template_required_update`
BEFORE UPDATE OF `template_version_id` ON `subscriptions`
WHEN NEW.`template_version_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'subscriptions.template_version_id is required');
END;--> statement-breakpoint
CREATE TRIGGER `subscriptions_template_match_insert`
BEFORE INSERT ON `subscriptions`
WHEN NOT EXISTS (
  SELECT 1 FROM `plans`
  WHERE `plans`.`id` = NEW.`plan_id`
    AND `plans`.`product_id` = NEW.`product_id`
    AND `plans`.`template_version_id` = NEW.`template_version_id`
)
BEGIN
  SELECT RAISE(ABORT, 'subscription template must match selected plan');
END;--> statement-breakpoint
CREATE TRIGGER `subscriptions_template_match_update`
BEFORE UPDATE OF `plan_id`, `product_id`, `template_version_id` ON `subscriptions`
WHEN NOT EXISTS (
  SELECT 1 FROM `plans`
  WHERE `plans`.`id` = NEW.`plan_id`
    AND `plans`.`product_id` = NEW.`product_id`
    AND `plans`.`template_version_id` = NEW.`template_version_id`
)
BEGIN
  SELECT RAISE(ABORT, 'subscription template must match selected plan');
END;--> statement-breakpoint
CREATE TRIGGER `subscriptions_configuration_valid_insert`
BEFORE INSERT ON `subscriptions`
WHEN json_valid(NEW.`instance_configuration`) <> 1
  OR json_type(NEW.`instance_configuration`) <> 'object'
BEGIN
  SELECT RAISE(ABORT, 'subscription instance configuration must be a JSON object');
END;--> statement-breakpoint
CREATE TRIGGER `subscriptions_configuration_valid_update`
BEFORE UPDATE OF `instance_configuration` ON `subscriptions`
WHEN json_valid(NEW.`instance_configuration`) <> 1
  OR json_type(NEW.`instance_configuration`) <> 'object'
BEGIN
  SELECT RAISE(ABORT, 'subscription instance configuration must be a JSON object');
END;--> statement-breakpoint
CREATE TRIGGER `app_instances_subscription_template_match_insert`
BEFORE INSERT ON `app_instances`
WHEN NEW.`subscription_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `subscriptions`
    WHERE `subscriptions`.`id` = NEW.`subscription_id`
      AND `subscriptions`.`workspace_id` = NEW.`workspace_id`
      AND `subscriptions`.`product_id` = NEW.`product_id`
      AND `subscriptions`.`template_version_id` = NEW.`template_version_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'app instance template must match subscription');
END;--> statement-breakpoint
CREATE TRIGGER `app_instances_subscription_template_match_update`
BEFORE UPDATE OF `subscription_id`, `template_version_id` ON `app_instances`
WHEN NEW.`subscription_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `subscriptions`
    WHERE `subscriptions`.`id` = NEW.`subscription_id`
      AND `subscriptions`.`workspace_id` = NEW.`workspace_id`
      AND `subscriptions`.`product_id` = NEW.`product_id`
      AND `subscriptions`.`template_version_id` = NEW.`template_version_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'app instance template must match subscription');
END;--> statement-breakpoint
CREATE TRIGGER `app_instances_configuration_valid_insert`
BEFORE INSERT ON `app_instances`
WHEN json_valid(NEW.`configuration_snapshot`) <> 1
  OR json_type(NEW.`configuration_snapshot`) <> 'object'
BEGIN
  SELECT RAISE(ABORT, 'app instance configuration snapshot must be a JSON object');
END;--> statement-breakpoint
CREATE TRIGGER `app_instances_configuration_valid_update`
BEFORE UPDATE OF `configuration_snapshot` ON `app_instances`
WHEN json_valid(NEW.`configuration_snapshot`) <> 1
  OR json_type(NEW.`configuration_snapshot`) <> 'object'
BEGIN
  SELECT RAISE(ABORT, 'app instance configuration snapshot must be a JSON object');
END;
