CREATE TABLE "draft_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text NOT NULL,
	"status" text NOT NULL,
	"body_text" text NOT NULL,
	"fact_ids" jsonb,
	"knowledge_base_version" text,
	"assumptions" jsonb,
	"outbound_message_id" text,
	"quote_version_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "draft_revisions" ADD CONSTRAINT "draft_revisions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_revisions" ADD CONSTRAINT "draft_revisions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draft_revisions_outbound_message_unique" ON "draft_revisions" USING btree ("outbound_message_id") WHERE outbound_message_id is not null;--> statement-breakpoint
CREATE INDEX "draft_revisions_conversation_idx" ON "draft_revisions" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "draft_revisions_organization_idx" ON "draft_revisions" USING btree ("organization_id");