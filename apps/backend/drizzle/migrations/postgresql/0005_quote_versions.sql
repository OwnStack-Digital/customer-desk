CREATE TABLE "quote_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"draft_revision_id" text,
	"status" text NOT NULL,
	"token_hash" text,
	"lines" jsonb,
	"assumptions" jsonb,
	"currency" text NOT NULL,
	"subtotal_minor" integer NOT NULL,
	"tax_minor" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"price_list_version" text NOT NULL,
	"valid_until" text,
	"sent_at" text,
	"decided_at" text,
	"decision" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_draft_revision_id_draft_revisions_id_fk" FOREIGN KEY ("draft_revision_id") REFERENCES "public"."draft_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_versions_token_hash_unique" ON "quote_versions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "quote_versions_conversation_idx" ON "quote_versions" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "quote_versions_organization_idx" ON "quote_versions" USING btree ("organization_id");