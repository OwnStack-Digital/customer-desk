CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`from_address` text NOT NULL,
	`from_name` text,
	`subject` text,
	`automation_paused` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `conversations_organization_idx` ON `conversations` (`organization_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`direction` text NOT NULL,
	`source_message_id` text NOT NULL,
	`message_id` text,
	`in_reply_to` text,
	`references` text,
	`from_address` text NOT NULL,
	`from_name` text,
	`to` text,
	`cc` text,
	`reply_to` text,
	`subject` text,
	`text` text,
	`html` text,
	`attachments` text,
	`received_at` text NOT NULL,
	`sent_at` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `messages_conversation_idx` ON `messages` (`conversation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_inbound_source_unique` ON `messages` (`mailbox_id`,`source_message_id`) WHERE direction = 'inbound';