CREATE TABLE `subscription_purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`product_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`template_version_id` text NOT NULL,
	`subscription_id` text,
	`renewal_subscription_id` text,
	`payment_record_id` text,
	`order_type` text DEFAULT 'new_subscription' NOT NULL,
	`configuration_snapshot` text DEFAULT '{}' NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`billing_interval` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`provider` text DEFAULT 'stripe' NOT NULL,
	`provider_session_id` text,
	`provider_payment_id` text,
	`checkout_url` text,
	`failure_reason` text,
	`created_by_user_id` text NOT NULL,
	`expires_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`template_version_id`) REFERENCES `app_instance_template_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`renewal_subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payment_record_id`) REFERENCES `payment_records`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_purchase_orders_provider_session_unique` ON `subscription_purchase_orders` (`provider`,`provider_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_purchase_orders_subscription_unique` ON `subscription_purchase_orders` (`subscription_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_purchase_orders_workspace_product_inflight_unique` ON `subscription_purchase_orders` (`workspace_id`,`product_id`) WHERE "subscription_purchase_orders"."status" in ('draft', 'checkout_pending');--> statement-breakpoint
CREATE INDEX `subscription_purchase_orders_workspace_id_idx` ON `subscription_purchase_orders` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `subscription_purchase_orders_product_id_idx` ON `subscription_purchase_orders` (`product_id`);--> statement-breakpoint
CREATE INDEX `subscription_purchase_orders_plan_id_idx` ON `subscription_purchase_orders` (`plan_id`);--> statement-breakpoint
CREATE INDEX `subscription_purchase_orders_status_idx` ON `subscription_purchase_orders` (`status`);--> statement-breakpoint
CREATE INDEX `subscription_purchase_orders_created_at_idx` ON `subscription_purchase_orders` (`created_at`);--> statement-breakpoint
CREATE TABLE `workspace_product_entitlements` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`product_id` text NOT NULL,
	`current_subscription_id` text,
	`app_instance_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`current_subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`app_instance_id`) REFERENCES `app_instances`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_product_entitlements_workspace_product_unique` ON `workspace_product_entitlements` (`workspace_id`,`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_product_entitlements_app_instance_unique` ON `workspace_product_entitlements` (`app_instance_id`);--> statement-breakpoint
CREATE INDEX `workspace_product_entitlements_current_subscription_idx` ON `workspace_product_entitlements` (`current_subscription_id`);--> statement-breakpoint
CREATE INDEX `workspace_product_entitlements_status_idx` ON `workspace_product_entitlements` (`status`);--> statement-breakpoint
INSERT INTO `workspace_product_entitlements` (
	`id`, `workspace_id`, `product_id`, `current_subscription_id`,
	`app_instance_id`, `status`, `created_at`, `updated_at`
)
SELECT
	'ent_' || combos.workspace_id || '_' || combos.product_id,
	combos.workspace_id,
	combos.product_id,
	(
		SELECT subscription.id
		FROM subscriptions subscription
		WHERE subscription.workspace_id = combos.workspace_id
			AND subscription.product_id = combos.product_id
			AND subscription.status IN ('manual_pending', 'active', 'past_due', 'paused')
		ORDER BY subscription.updated_at DESC
		LIMIT 1
	),
	(
		SELECT instance.id
		FROM app_instances instance
		WHERE instance.workspace_id = combos.workspace_id
			AND instance.product_id = combos.product_id
		ORDER BY instance.updated_at DESC
		LIMIT 1
	),
	CASE
		WHEN EXISTS (
			SELECT 1 FROM app_instances instance
			WHERE instance.workspace_id = combos.workspace_id
				AND instance.product_id = combos.product_id
				AND instance.status = 'active'
		) THEN 'active'
		WHEN EXISTS (
			SELECT 1 FROM app_instances instance
			WHERE instance.workspace_id = combos.workspace_id
				AND instance.product_id = combos.product_id
				AND instance.status = 'suspended'
		) THEN 'suspended'
		WHEN EXISTS (
			SELECT 1 FROM subscriptions subscription
			WHERE subscription.workspace_id = combos.workspace_id
				AND subscription.product_id = combos.product_id
				AND subscription.status IN ('manual_pending', 'active', 'past_due', 'paused')
		) THEN 'pending'
		ELSE 'ended'
	END,
	combos.created_at,
	combos.updated_at
FROM (
	SELECT workspace_id, product_id, MIN(created_at) AS created_at, MAX(updated_at) AS updated_at
	FROM (
		SELECT workspace_id, product_id, created_at, updated_at FROM subscriptions
		UNION ALL
		SELECT workspace_id, product_id, created_at, updated_at FROM app_instances
	)
	GROUP BY workspace_id, product_id
) combos;--> statement-breakpoint
ALTER TABLE `payment_webhook_events` ADD `purchase_order_id` text REFERENCES subscription_purchase_orders(id);--> statement-breakpoint
CREATE INDEX `payment_webhook_events_purchase_order_id_idx` ON `payment_webhook_events` (`purchase_order_id`);--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `creation_source` text DEFAULT 'admin_manual' NOT NULL;
