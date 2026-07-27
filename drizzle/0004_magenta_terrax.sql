CREATE TABLE `payment_checkout_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`payment_record_id` text NOT NULL,
	`initiated_by_user_id` text NOT NULL,
	`provider` text DEFAULT 'stripe' NOT NULL,
	`provider_session_id` text,
	`provider_payment_id` text,
	`checkout_url` text,
	`status` text DEFAULT 'creating' NOT NULL,
	`expires_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`payment_record_id`) REFERENCES `payment_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`initiated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_checkout_sessions_provider_session_unique` ON `payment_checkout_sessions` (`provider`,`provider_session_id`);--> statement-breakpoint
CREATE INDEX `payment_checkout_sessions_workspace_id_idx` ON `payment_checkout_sessions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `payment_checkout_sessions_payment_record_id_idx` ON `payment_checkout_sessions` (`payment_record_id`);--> statement-breakpoint
CREATE INDEX `payment_checkout_sessions_status_idx` ON `payment_checkout_sessions` (`status`);--> statement-breakpoint
CREATE TABLE `payment_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`checkout_session_id` text,
	`payload_hash` text NOT NULL,
	`processing_status` text DEFAULT 'pending' NOT NULL,
	`last_error` text,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`checkout_session_id`) REFERENCES `payment_checkout_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_webhook_events_provider_event_unique` ON `payment_webhook_events` (`provider`,`provider_event_id`);--> statement-breakpoint
CREATE INDEX `payment_webhook_events_checkout_session_id_idx` ON `payment_webhook_events` (`checkout_session_id`);--> statement-breakpoint
CREATE INDEX `payment_webhook_events_processing_status_idx` ON `payment_webhook_events` (`processing_status`);--> statement-breakpoint
ALTER TABLE `payment_records` ADD `provider` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_records` ADD `provider_payment_id` text;--> statement-breakpoint
ALTER TABLE `payment_records` ADD `provider_event_id` text;--> statement-breakpoint
ALTER TABLE `payment_records` ADD `failure_reason` text;--> statement-breakpoint
CREATE UNIQUE INDEX `payment_records_provider_payment_id_unique` ON `payment_records` (`provider`,`provider_payment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_records_provider_event_id_unique` ON `payment_records` (`provider`,`provider_event_id`);