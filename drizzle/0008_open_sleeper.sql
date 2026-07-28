ALTER TABLE `payment_checkout_sessions` ADD `subscription_id` text REFERENCES subscriptions(id) ON DELETE CASCADE;--> statement-breakpoint
UPDATE `payment_checkout_sessions`
SET `subscription_id` = (
  SELECT `subscription_id`
  FROM `payment_records`
  WHERE `payment_records`.`id` = `payment_checkout_sessions`.`payment_record_id`
)
WHERE `subscription_id` IS NULL;--> statement-breakpoint
DROP TABLE IF EXISTS `__checkout_subscription_migration_guard`;--> statement-breakpoint
CREATE TABLE `__checkout_subscription_migration_guard` (
  `subscription_id` text NOT NULL
);--> statement-breakpoint
INSERT INTO `__checkout_subscription_migration_guard` (`subscription_id`)
SELECT `subscription_id` FROM `payment_checkout_sessions`;--> statement-breakpoint
DROP TABLE `__checkout_subscription_migration_guard`;--> statement-breakpoint
UPDATE `payment_checkout_sessions`
SET `expires_at` = `created_at` + 600000
WHERE `status` = 'creating' AND `expires_at` IS NULL;--> statement-breakpoint
UPDATE `payment_checkout_sessions`
SET
  `status` = 'expired',
  `updated_at` = CAST(unixepoch() * 1000 AS INTEGER)
WHERE `status` = 'creating'
  AND `expires_at` <= CAST(unixepoch() * 1000 AS INTEGER);--> statement-breakpoint
UPDATE `payment_checkout_sessions`
SET
  `status` = 'expired',
  `updated_at` = CAST(unixepoch() * 1000 AS INTEGER)
WHERE `status` IN ('creating', 'open')
  AND EXISTS (
    SELECT 1
    FROM `payment_checkout_sessions` newer
    WHERE newer.`subscription_id` = `payment_checkout_sessions`.`subscription_id`
      AND newer.`status` IN ('creating', 'open')
      AND (
        (
          CASE
            WHEN newer.`status` = 'open'
              AND COALESCE(newer.`checkout_url`, '') <> ''
            THEN 1 ELSE 0
          END
        ) > (
          CASE
            WHEN `payment_checkout_sessions`.`status` = 'open'
              AND COALESCE(`payment_checkout_sessions`.`checkout_url`, '') <> ''
            THEN 1 ELSE 0
          END
        )
        OR (
          (
            CASE
              WHEN newer.`status` = 'open'
                AND COALESCE(newer.`checkout_url`, '') <> ''
              THEN 1 ELSE 0
            END
          ) = (
            CASE
              WHEN `payment_checkout_sessions`.`status` = 'open'
                AND COALESCE(`payment_checkout_sessions`.`checkout_url`, '') <> ''
              THEN 1 ELSE 0
            END
          )
          AND (
            newer.`created_at` > `payment_checkout_sessions`.`created_at`
            OR (
              newer.`created_at` = `payment_checkout_sessions`.`created_at`
              AND newer.`id` > `payment_checkout_sessions`.`id`
            )
          )
        )
      )
  );--> statement-breakpoint
UPDATE `payment_records`
SET
  `status` = 'canceled',
  `failure_reason` = '升级订阅模型时关闭了已过期或重复的 Stripe Checkout。',
  `updated_at` = CAST(unixepoch() * 1000 AS INTEGER)
WHERE `status` = 'pending'
  AND `id` IN (
    SELECT `payment_record_id`
    FROM `payment_checkout_sessions`
    WHERE `status` = 'expired'
  );--> statement-breakpoint
CREATE UNIQUE INDEX `payment_checkout_sessions_subscription_inflight_unique` ON `payment_checkout_sessions` (`subscription_id`) WHERE "payment_checkout_sessions"."status" in ('creating', 'open');--> statement-breakpoint
CREATE INDEX `payment_checkout_sessions_subscription_id_idx` ON `payment_checkout_sessions` (`subscription_id`);--> statement-breakpoint
CREATE TRIGGER `payment_checkout_sessions_subscription_required_insert`
BEFORE INSERT ON `payment_checkout_sessions`
WHEN NEW.`subscription_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'payment_checkout_sessions.subscription_id is required');
END;--> statement-breakpoint
CREATE TRIGGER `payment_checkout_sessions_subscription_required_update`
BEFORE UPDATE OF `subscription_id` ON `payment_checkout_sessions`
WHEN NEW.`subscription_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'payment_checkout_sessions.subscription_id is required');
END;
