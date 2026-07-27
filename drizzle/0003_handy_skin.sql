CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_unique` ON `products` (`slug`);--> statement-breakpoint
CREATE INDEX `products_status_idx` ON `products` (`status`);--> statement-breakpoint
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
CREATE TABLE `app_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`product_id` text NOT NULL,
	`subscription_id` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`domain` text,
	`access_url` text NOT NULL,
	`tenant_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`provisioned_at` integer,
	`suspended_at` integer,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_instances_slug_unique` ON `app_instances` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `app_instances_tenant_key_unique` ON `app_instances` (`tenant_key`);--> statement-breakpoint
CREATE INDEX `app_instances_workspace_id_idx` ON `app_instances` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `app_instances_product_id_idx` ON `app_instances` (`product_id`);--> statement-breakpoint
CREATE INDEX `app_instances_subscription_id_idx` ON `app_instances` (`subscription_id`);--> statement-breakpoint
CREATE INDEX `app_instances_status_idx` ON `app_instances` (`status`);
