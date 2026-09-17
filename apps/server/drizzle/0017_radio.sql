CREATE TABLE IF NOT EXISTS "radio_stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "radio_station_id" uuid;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "radio_stream_url" text;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "radio_started_by" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "channels" ADD CONSTRAINT "channels_radio_station_id_radio_stations_id_fk" FOREIGN KEY ("radio_station_id") REFERENCES "public"."radio_stations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "channels" ADD CONSTRAINT "channels_radio_started_by_users_id_fk" FOREIGN KEY ("radio_started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
