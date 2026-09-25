CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"from_address" text NOT NULL,
	"from_name" text,
	"subject" text,
	"automation_paused" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"direction" text NOT NULL,
	"source_message_id" text NOT NULL,
	"message_id" text,
	"in_reply_to" text,
	"references" jsonb,
	"from_address" text NOT NULL,
	"from_name" text,
	"to" jsonb,
	"cc" jsonb,
	"reply_to" text,
	"subject" text,
	"text" text,
	"html" text,
	"attachments" jsonb,
	"received_at" text NOT NULL,
	"sent_at" text
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_organization_idx" ON "conversations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_inbound_source_unique" ON "messages" USING btree ("mailbox_id","source_message_id") WHERE direction = 'inbound';