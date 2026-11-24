ALTER TABLE `summary_layouts` ADD `trigger_token` text;--> statement-breakpoint
ALTER TABLE `summary_layouts` ADD `trigger_secret_enc` text;--> statement-breakpoint
ALTER TABLE `summary_layouts` ADD `trigger_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `summary_layouts_trigger_token_unique` ON `summary_layouts` (`trigger_token`);