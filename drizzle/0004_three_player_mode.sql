ALTER TABLE `rooms` ADD `player_three_token` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `player_count` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `rounds` ADD `player_three_word` text;--> statement-breakpoint
ALTER TABLE `rounds` ADD `player_three_submitted_at` text;--> statement-breakpoint
ALTER TABLE `rounds` ADD `player_three_ready` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `rounds` ADD `player_three_match` integer DEFAULT false NOT NULL;