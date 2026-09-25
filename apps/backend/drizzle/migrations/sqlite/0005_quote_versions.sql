CREATE TABLE `quote_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`draft_revision_id` text,
	`status` text NOT NULL,
	`token_hash` text,
	`lines` text,
	`assumptions` text,
	`currency` text NOT NULL,
	`subtotal_minor` integer NOT NULL,
	`tax_minor` integer NOT NULL,
	`total_minor` integer NOT NULL,
	`price_list_version` text NOT NULL,
	`valid_until` text,
	`sent_at` text,
	`decided_at` text,
	`decision` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`draft_revision_id`) REFERENCES `draft_revisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quote_versions_token_hash_unique` ON `quote_versions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `quote_versions_conversation_idx` ON `quote_versions` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `quote_versions_organization_idx` ON `quote_versions` (`organization_id`);