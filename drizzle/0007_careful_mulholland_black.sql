DROP INDEX `subscriptions_workspace_unique`;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `product_id` text REFERENCES products(id) ON DELETE RESTRICT;--> statement-breakpoint
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
UPDATE `subscriptions`
SET `product_id` = (
  SELECT `id` FROM `products`
  WHERE `slug` = 'restaurant-order-system'
  LIMIT 1
)
WHERE `product_id` IS NULL;--> statement-breakpoint
DROP TABLE IF EXISTS `__subscription_product_migration_guard`;--> statement-breakpoint
CREATE TABLE `__subscription_product_migration_guard` (
  `product_id` text NOT NULL
);--> statement-breakpoint
INSERT INTO `__subscription_product_migration_guard` (`product_id`)
SELECT `product_id` FROM `subscriptions`;--> statement-breakpoint
DROP TABLE `__subscription_product_migration_guard`;--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_workspace_product_current_unique` ON `subscriptions` (`workspace_id`,`product_id`) WHERE "subscriptions"."status" in ('manual_pending', 'active', 'past_due', 'paused');--> statement-breakpoint
CREATE INDEX `subscriptions_workspace_id_idx` ON `subscriptions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_product_id_idx` ON `subscriptions` (`product_id`);--> statement-breakpoint
CREATE TRIGGER `subscriptions_product_required_insert`
BEFORE INSERT ON `subscriptions`
WHEN NEW.`product_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'subscriptions.product_id is required');
END;--> statement-breakpoint
CREATE TRIGGER `subscriptions_product_required_update`
BEFORE UPDATE OF `product_id` ON `subscriptions`
WHEN NEW.`product_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'subscriptions.product_id is required');
END;
