CREATE TABLE `printer_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hostname` text NOT NULL,
	`name` text NOT NULL,
	`active_times_mode` text DEFAULT 'inherit' NOT NULL,
	`active_times_expr` text,
	`check_enabled` integer DEFAULT true NOT NULL,
	`check_retry_ms` integer DEFAULT 30000 NOT NULL,
	`status_webhook_enabled` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `printer_groups_hostname_unique` ON `printer_groups` (`hostname`);--> statement-breakpoint
ALTER TABLE `printers` ADD `group_id` integer REFERENCES printer_groups(id);
--> statement-breakpoint
INSERT INTO `printer_groups` (`id`, `hostname`, `name`, `active_times_mode`, `active_times_expr`, `check_enabled`, `check_retry_ms`, `status_webhook_enabled`, `created_at`, `updated_at`)
SELECT `id`, `hostname`, `name`, `active_times_mode`, `active_times_expr`, `check_enabled`, `check_retry_ms`, `status_webhook_enabled`, `created_at`, `updated_at`
FROM `printers`
WHERE `id` IN (SELECT MIN(`id`) FROM `printers` GROUP BY `hostname`);
--> statement-breakpoint
UPDATE `printers`
SET `group_id` = (SELECT MIN(p2.`id`) FROM `printers` p2 WHERE p2.`hostname` = `printers`.`hostname`);