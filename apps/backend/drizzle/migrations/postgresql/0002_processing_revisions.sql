CREATE TABLE "processing_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"message_id" text NOT NULL,
	"revision_number" integer NOT NULL,
	"status" text NOT NULL,
	"lane" text,
	"summary" text,
	"classification" jsonb,
	"error" text,
	"knowledge_base_version" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "processing_revisions" ADD CONSTRAINT "processing_revisions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "processing_revisions_message_revision_unique" ON "processing_revisions" USING btree ("message_id","revision_number");--> statement-breakpoint
CREATE INDEX "processing_revisions_message_idx" ON "processing_revisions" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "processing_revisions_organization_idx" ON "processing_revisions" USING btree ("organization_id");
