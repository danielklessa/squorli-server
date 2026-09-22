ALTER TABLE "members" ADD COLUMN "share_avatar" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "server_settings" ADD COLUMN "status_api" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "server_settings" ADD COLUMN "status_api_key" text;