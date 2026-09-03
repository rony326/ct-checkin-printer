CREATE TABLE `admin_user` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `churchtools_connection` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`base_url` text NOT NULL,
	`username` text NOT NULL,
	`password_enc` text NOT NULL,
	`login_token_enc` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `document_printers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 631 NOT NULL,
	`ipp_queue` text DEFAULT 'print' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fonts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`file_path` text NOT NULL,
	`uploaded_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `label_layout_also` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`layout_id` integer NOT NULL,
	`also_layout_id` integer NOT NULL,
	FOREIGN KEY (`layout_id`) REFERENCES `label_layouts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`also_layout_id`) REFERENCES `label_layouts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `label_layouts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`ct_type_key` text NOT NULL,
	`printer_id` integer,
	`media_id` integer,
	`elements_json` text DEFAULT '[]' NOT NULL,
	`copies` integer DEFAULT 1 NOT NULL,
	`rotate` text DEFAULT '0' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_id`) REFERENCES `media_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `logos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`file_path` text NOT NULL,
	`uploaded_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vendor` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`width_mm` integer NOT NULL,
	`height_mm` integer,
	`printable_width_mm` integer NOT NULL,
	`printable_height_mm` integer,
	`die_cut` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `print_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`printer_id` integer NOT NULL,
	`ct_job_id` text,
	`label_type` text NOT NULL,
	`printed_at` text DEFAULT (current_timestamp) NOT NULL,
	`qr_hash` text,
	`group_name` text,
	`status` text NOT NULL,
	`error_message` text,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `print_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`printer_id` integer NOT NULL,
	`layout_id` integer,
	`job_payload_json` text NOT NULL,
	`reason` text NOT NULL,
	`print_error` integer DEFAULT false NOT NULL,
	`enqueued_at` text DEFAULT (current_timestamp) NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`layout_id`) REFERENCES `label_layouts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `printers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`hostname` text NOT NULL,
	`vendor` text NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 9100 NOT NULL,
	`active_times_mode` text DEFAULT 'inherit' NOT NULL,
	`active_times_expr` text,
	`check_enabled` integer DEFAULT true NOT NULL,
	`check_retry_ms` integer DEFAULT 30000 NOT NULL,
	`status_webhook_enabled` integer DEFAULT false NOT NULL,
	`media_id` integer,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `media_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `printers_hostname_unique` ON `printers` (`hostname`);--> statement-breakpoint
CREATE TABLE `summary_layouts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`group_by_field` text DEFAULT 'checkin.group' NOT NULL,
	`printer_id` integer,
	`document_printer_id` integer,
	`columns_json` text DEFAULT '["name","code","checkinTime"]' NOT NULL,
	`title_template` text DEFAULT 'Sammelausdruck {{checkin.group}}' NOT NULL,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`verify_against_ct` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_printer_id`) REFERENCES `document_printers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `webhooks_incoming` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path_token` text NOT NULL,
	`secret_enc` text,
	`enabled` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhooks_incoming_path_token_unique` ON `webhooks_incoming` (`path_token`);--> statement-breakpoint
CREATE TABLE `webhooks_outgoing` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`method` text DEFAULT 'POST' NOT NULL,
	`secret_enc` text,
	`retry` integer DEFAULT 3 NOT NULL,
	`retry_ms` integer DEFAULT 2000 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`event_scope` text DEFAULT 'both' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
