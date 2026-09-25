CREATE TABLE "operator_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "operator_credentials_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "operator_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"revoked_at" text,
	"created_at" text NOT NULL,
	CONSTRAINT "operator_sessions_token_hash_unique" UNIQUE("token_hash")
);
