PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_print_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`printer_id` integer NOT NULL,
	`ct_job_id` text,
	`label_type` text NOT NULL,
	`printed_at` text DEFAULT (current_timestamp) NOT NULL,
	`qr_hash` text,
	`group_name` text,
	`status` text NOT NULL,
	`error_message` text,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_print_log`("id", "printer_id", "ct_job_id", "label_type", "printed_at", "qr_hash", "group_name", "status", "error_message") SELECT "id", "printer_id", "ct_job_id", "label_type", "printed_at", "qr_hash", "group_name", "status", "error_message" FROM `print_log`;--> statement-breakpoint
DROP TABLE `print_log`;--> statement-breakpoint
ALTER TABLE `__new_print_log` RENAME TO `print_log`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_print_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`printer_id` integer NOT NULL,
	`layout_id` integer,
	`job_payload_json` text NOT NULL,
	`reason` text NOT NULL,
	`print_error` integer DEFAULT false NOT NULL,
	`enqueued_at` text DEFAULT (current_timestamp) NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`layout_id`) REFERENCES `label_layouts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_print_queue`("id", "printer_id", "layout_id", "job_payload_json", "reason", "print_error", "enqueued_at", "attempts", "status") SELECT "id", "printer_id", "layout_id", "job_payload_json", "reason", "print_error", "enqueued_at", "attempts", "status" FROM `print_queue`;--> statement-breakpoint
DROP TABLE `print_queue`;--> statement-breakpoint
ALTER TABLE `__new_print_queue` RENAME TO `print_queue`;