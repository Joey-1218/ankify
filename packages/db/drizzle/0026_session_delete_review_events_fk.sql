PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_review_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`problem_id` text NOT NULL,
	`event_type` text NOT NULL,
	`fsrs_rating` integer,
	`request_id` text,
	`undone_at` integer,
	`card_id` text,
	`submission_id` text,
	`practice_session_id` text,
	`policy_version` text,
	`review_method` text,
	`schedule_revision` integer,
	`fsrs_stability_snap` real,
	`fsrs_difficulty_snap` real,
	`fsrs_retrievability_snap` real,
	`metadata` text,
	`occurred_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`practice_session_id`) REFERENCES `practice_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_review_events`("id", "user_id", "problem_id", "event_type", "fsrs_rating", "request_id", "undone_at", "card_id", "submission_id", "practice_session_id", "policy_version", "review_method", "schedule_revision", "fsrs_stability_snap", "fsrs_difficulty_snap", "fsrs_retrievability_snap", "metadata", "occurred_at") SELECT "id", "user_id", "problem_id", "event_type", "fsrs_rating", "request_id", "undone_at", "card_id", "submission_id", "practice_session_id", "policy_version", "review_method", "schedule_revision", "fsrs_stability_snap", "fsrs_difficulty_snap", "fsrs_retrievability_snap", "metadata", "occurred_at" FROM `review_events`;--> statement-breakpoint
DROP TABLE `review_events`;--> statement-breakpoint
ALTER TABLE `__new_review_events` RENAME TO `review_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `review_events_user_idx` ON `review_events` (`user_id`);--> statement-breakpoint
CREATE INDEX `review_events_problem_idx` ON `review_events` (`problem_id`);--> statement-breakpoint
CREATE INDEX `review_events_type_idx` ON `review_events` (`event_type`);--> statement-breakpoint
CREATE INDEX `review_events_occurred_idx` ON `review_events` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `review_events_user_type_occurred_idx` ON `review_events` (`user_id`,`event_type`,`occurred_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_events_user_request_unique` ON `review_events` (`user_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_events_session_scheduling_unique` ON `review_events` (`practice_session_id`,`event_type`) WHERE "review_events"."practice_session_id" IS NOT NULL AND "review_events"."event_type" IN ('self_recall_rated', 'fsrs_scheduled');