ALTER TABLE "channels" ADD COLUMN "audio_bitrate" integer DEFAULT 64 NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "audio_stereo" boolean DEFAULT false NOT NULL;