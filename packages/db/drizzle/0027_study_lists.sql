CREATE TABLE `study_list_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`list_id` text NOT NULL,
	`slug` text NOT NULL,
	`leetcode_id` integer,
	`title` text NOT NULL,
	`title_zh` text,
	`difficulty` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`,`user_id`) REFERENCES `study_lists`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_list_items_list_slug_unique` ON `study_list_items` (`list_id`,`slug`);--> statement-breakpoint
CREATE INDEX `study_list_items_list_position_idx` ON `study_list_items` (`list_id`,`position`);--> statement-breakpoint
CREATE INDEX `study_list_items_user_slug_idx` ON `study_list_items` (`user_id`,`slug`);--> statement-breakpoint
CREATE TABLE `study_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`builtin_id` text,
	`name` text,
	`request_id` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`share` integer DEFAULT 1 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "study_lists_kind_shape" CHECK(("study_lists"."kind" = 'builtin' AND "study_lists"."builtin_id" IS NOT NULL AND "study_lists"."name" IS NULL) OR ("study_lists"."kind" = 'custom' AND "study_lists"."builtin_id" IS NULL AND "study_lists"."name" IS NOT NULL)),
	CONSTRAINT "study_lists_share_range" CHECK("study_lists"."share" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_lists_id_owner_unique` ON `study_lists` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `study_lists_user_request_unique` ON `study_lists` (`user_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `study_lists_user_builtin_unique` ON `study_lists` (`user_id`,`builtin_id`) WHERE "study_lists"."kind" = 'builtin';--> statement-breakpoint
CREATE INDEX `study_lists_user_position_idx` ON `study_lists` (`user_id`,`position`);