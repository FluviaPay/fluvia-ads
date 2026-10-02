ALTER TABLE "meta_connections" ADD COLUMN "access_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD COLUMN "token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD COLUMN "oauth_nonce" text;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD COLUMN "oauth_nonce_expires_at" timestamp with time zone;