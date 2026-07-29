DROP INDEX `plans_name_unique`;--> statement-breakpoint
ALTER TABLE `plans` ADD `product_id` text REFERENCES products(id) ON DELETE RESTRICT;--> statement-breakpoint
INSERT OR IGNORE INTO `products` (
  `id`, `name`, `slug`, `description`, `status`, `created_at`, `updated_at`
) VALUES (
  'prd_restaurant_order_system',
  '餐饮订单系统',
  'restaurant-order-system',
  '面向餐饮企业的订单管理系统。',
  'active',
  CAST(unixepoch() * 1000 AS INTEGER),
  CAST(unixepoch() * 1000 AS INTEGER)
);--> statement-breakpoint
UPDATE `plans`
SET `product_id` = (
  SELECT `id` FROM `products`
  WHERE `slug` = 'restaurant-order-system'
  LIMIT 1
)
WHERE `product_id` IS NULL;--> statement-breakpoint
DROP TABLE IF EXISTS `__plan_product_migration_guard`;--> statement-breakpoint
CREATE TABLE `__plan_product_migration_guard` (
  `product_id` text NOT NULL,
  `product_exists` integer NOT NULL CHECK (`product_exists` = 1)
);--> statement-breakpoint
INSERT INTO `__plan_product_migration_guard` (`product_id`, `product_exists`)
SELECT
  `plan`.`product_id`,
  CASE WHEN EXISTS (
    SELECT 1 FROM `products` `product`
    WHERE `product`.`id` = `plan`.`product_id`
  ) THEN 1 ELSE 0 END
FROM `plans` `plan`;--> statement-breakpoint
DROP TABLE `__plan_product_migration_guard`;--> statement-breakpoint
DROP TABLE IF EXISTS `__subscription_plan_product_guard`;--> statement-breakpoint
CREATE TABLE `__subscription_plan_product_guard` (
  `relationships_match` integer NOT NULL CHECK (`relationships_match` = 1)
);--> statement-breakpoint
INSERT INTO `__subscription_plan_product_guard` (`relationships_match`)
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM `subscriptions` `subscription`
  LEFT JOIN `plans` `plan` ON `plan`.`id` = `subscription`.`plan_id`
  WHERE `plan`.`id` IS NULL
     OR `plan`.`product_id` IS NULL
     OR `plan`.`product_id` <> `subscription`.`product_id`
) THEN 0 ELSE 1 END;--> statement-breakpoint
DROP TABLE `__subscription_plan_product_guard`;--> statement-breakpoint
CREATE UNIQUE INDEX `plans_product_name_unique`
ON `plans` (`product_id`,`name`);--> statement-breakpoint
CREATE INDEX `plans_product_id_idx` ON `plans` (`product_id`);--> statement-breakpoint
CREATE TRIGGER `plans_product_required_insert`
BEFORE INSERT ON `plans`
WHEN NEW.`product_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'plans.product_id is required');
END;--> statement-breakpoint
CREATE TRIGGER `plans_product_required_update`
BEFORE UPDATE OF `product_id` ON `plans`
WHEN NEW.`product_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'plans.product_id is required');
END;--> statement-breakpoint
CREATE TRIGGER `plans_product_change_referenced`
BEFORE UPDATE OF `product_id` ON `plans`
WHEN NEW.`product_id` <> OLD.`product_id`
  AND EXISTS (
    SELECT 1 FROM `subscriptions`
    WHERE `plan_id` = OLD.`id`
  )
BEGIN
  SELECT RAISE(ABORT, 'referenced plan product cannot be changed');
END;--> statement-breakpoint
CREATE TRIGGER `subscriptions_plan_product_match_insert`
BEFORE INSERT ON `subscriptions`
WHEN NOT EXISTS (
  SELECT 1 FROM `plans`
  WHERE `id` = NEW.`plan_id`
    AND `product_id` = NEW.`product_id`
)
BEGIN
  SELECT RAISE(ABORT, 'subscription plan must belong to subscription product');
END;--> statement-breakpoint
CREATE TRIGGER `subscriptions_plan_product_match_update`
BEFORE UPDATE OF `plan_id`, `product_id` ON `subscriptions`
WHEN NOT EXISTS (
  SELECT 1 FROM `plans`
  WHERE `id` = NEW.`plan_id`
    AND `product_id` = NEW.`product_id`
)
BEGIN
  SELECT RAISE(ABORT, 'subscription plan must belong to subscription product');
END;
