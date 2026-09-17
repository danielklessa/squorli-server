ALTER TABLE "server_settings" ADD COLUMN "afk_channel_id" uuid;--> statement-breakpoint
ALTER TABLE "server_settings" ADD COLUMN "afk_move_minutes" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "server_settings" ADD CONSTRAINT "server_settings_afk_channel_id_channels_id_fk" FOREIGN KEY ("afk_channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
