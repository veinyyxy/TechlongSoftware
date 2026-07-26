CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`price_amount` integer NOT NULL,
	`currency` text NOT NULL,
	`billing_interval` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`features` text DEFAULT '[]' NOT NULL,
	`limits` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plans_name_unique` ON `plans` (`name`);--> statement-breakpoint
CREATE INDEX `plans_status_idx` ON `plans` (`status`);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `contact_name` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `contact_email` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `plan_id` text REFERENCES plans(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `subscription_status` text DEFAULT 'not_configured' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `app_instance_status` text DEFAULT 'not_provisioned' NOT NULL;--> statement-breakpoint
CREATE INDEX `workspaces_plan_id_idx` ON `workspaces` (`plan_id`);
