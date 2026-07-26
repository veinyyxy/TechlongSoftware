CREATE TABLE `payment_records` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`subscription_id` text,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`paid_at` integer,
	`payment_method` text NOT NULL,
	`reference` text,
	`note` text,
	`recorded_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `payment_records_workspace_id_idx` ON `payment_records` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `payment_records_subscription_id_idx` ON `payment_records` (`subscription_id`);--> statement-breakpoint
CREATE INDEX `payment_records_status_idx` ON `payment_records` (`status`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`status` text DEFAULT 'manual_pending' NOT NULL,
	`current_period_start` integer NOT NULL,
	`current_period_end` integer NOT NULL,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_workspace_unique` ON `subscriptions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_plan_id_idx` ON `subscriptions` (`plan_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_status_idx` ON `subscriptions` (`status`);