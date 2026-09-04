PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_printers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`name` text NOT NULL,
	`vendor` text NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 9100 NOT NULL,
	`media_id` integer,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `printer_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_id`) REFERENCES `media_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_printers`("id", "group_id", "name", "vendor", "host", "port", "media_id", "created_at", "updated_at") SELECT "id", "group_id", "name", "vendor", "host", "port", "media_id", "created_at", "updated_at" FROM `printers`;--> statement-breakpoint
DROP TABLE `printers`;--> statement-breakpoint
ALTER TABLE `__new_printers` RENAME TO `printers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;