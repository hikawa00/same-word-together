ALTER TABLE `rooms` ADD `is_public` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `description` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `last_seen_at` text;