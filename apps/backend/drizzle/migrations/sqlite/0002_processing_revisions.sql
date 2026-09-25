CREATE TABLE `processing_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`message_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`status` text NOT NULL,
	`lane` text,
	`summary` text,
	`classification` text,
	`error` text,
	`knowledge_base_version` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `processing_revisions_message_revision_unique` ON `processing_revisions` (`message_id`,`revision_number`);--> statement-breakpoint
CREATE INDEX `processing_revisions_message_idx` ON `processing_revisions` (`message_id`);--> statement-breakpoint
CREATE INDEX `processing_revisions_organization_idx` ON `processing_revisions` (`organization_id`);
