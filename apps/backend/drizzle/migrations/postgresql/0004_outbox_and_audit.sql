ALTER TABLE "draft_revisions" ADD "origin" text NOT NULL DEFAULT 'processing';--> statement-breakpoint
CREATE TABLE "outbox_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"message_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"recipient" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer NOT NULL DEFAULT 0,
	"last_error" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbox_entries" ADD CONSTRAINT "outbox_entries_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_entries" ADD CONSTRAINT "outbox_entries_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_entries_message_id_unique" ON "outbox_entries" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "outbox_entries_organization_idx" ON "outbox_entries" USING btree ("organization_id");--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"revision_id" text,
	"correlation_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_events_organization_idx" ON "audit_events" USING btree ("organization_id");