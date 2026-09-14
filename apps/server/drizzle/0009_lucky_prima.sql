ALTER TABLE "members" ADD COLUMN "is_owner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "server_settings" ADD COLUMN "icon_mime" text;--> statement-breakpoint
ALTER TABLE "server_settings" ADD COLUMN "icon_updated_at" timestamp with time zone;