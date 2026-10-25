CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`player_one_token` text NOT NULL,
	`player_two_token` text,
	`current_round` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rounds` (
	`room_code` text NOT NULL,
	`number` integer NOT NULL,
	`started_at` text NOT NULL,
	`player_one_word` text,
	`player_two_word` text,
	`player_one_submitted_at` text,
	`player_two_submitted_at` text,
	`player_one_ready` integer DEFAULT false NOT NULL,
	`player_two_ready` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`room_code`, `number`),
	FOREIGN KEY (`room_code`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
