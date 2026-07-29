ALTER TABLE `plans` ADD `template_configuration` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
UPDATE `plans`
SET `template_configuration` = COALESCE(
  (
    SELECT `default_configuration`
    FROM `app_instance_template_versions`
    WHERE `app_instance_template_versions`.`id` = `plans`.`template_version_id`
  ),
  '{}'
);--> statement-breakpoint
CREATE TRIGGER `plans_template_configuration_valid_insert`
BEFORE INSERT ON `plans`
WHEN json_valid(NEW.`template_configuration`) <> 1
  OR json_type(NEW.`template_configuration`) <> 'object'
BEGIN
  SELECT RAISE(ABORT, 'plan template configuration must be a JSON object');
END;--> statement-breakpoint
CREATE TRIGGER `plans_template_configuration_valid_update`
BEFORE UPDATE OF `template_configuration` ON `plans`
WHEN json_valid(NEW.`template_configuration`) <> 1
  OR json_type(NEW.`template_configuration`) <> 'object'
BEGIN
  SELECT RAISE(ABORT, 'plan template configuration must be a JSON object');
END;
