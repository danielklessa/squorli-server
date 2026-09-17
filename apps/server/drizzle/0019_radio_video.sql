ALTER TABLE "channels" ADD COLUMN "radio_playback" jsonb;--> statement-breakpoint
ALTER TABLE "server_settings" ADD COLUMN "radio_auto_stop" boolean DEFAULT true NOT NULL;