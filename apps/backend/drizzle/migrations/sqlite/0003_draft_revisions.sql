CREATE TABLE `draft_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`message_id` text NOT NULL,
	`status` text NOT NULL,
	`body_text` text NOT NULL,
	`fact_ids` text,
	`knowledge_base_version` text,
	`assumptions` text,
	`outbound_message_id` text,
	`quote_version_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `draft_revisions_outbound_message_unique` ON `draft_revisions` (`outbound_message_id`) WHERE outbound_message_id is not null;--> statement-breakpoint
CREATE INDEX `draft_revisions_conversation_idx` ON `draft_revisions` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `draft_revisions_organization_idx` ON `draft_revisions` (`organization_id`);