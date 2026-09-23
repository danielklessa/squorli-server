CREATE TABLE IF NOT EXISTS "category_overwrites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"role_id" uuid,
	"user_id" uuid,
	"allow" integer DEFAULT 0 NOT NULL,
	"deny" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "category_overwrites_one_target" CHECK (("category_overwrites"."role_id" IS NULL) <> ("category_overwrites"."user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_overwrites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"role_id" uuid,
	"user_id" uuid,
	"allow" integer DEFAULT 0 NOT NULL,
	"deny" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "channel_overwrites_one_target" CHECK (("channel_overwrites"."role_id" IS NULL) <> ("channel_overwrites"."user_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "sticky" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "sticky_persist" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "sticky_hide_voice" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "user_limit" integer;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "slowmode_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "default_notification" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "allow_radio" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "allow_video" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "confined_channel_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "category_overwrites" ADD CONSTRAINT "category_overwrites_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "category_overwrites" ADD CONSTRAINT "category_overwrites_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "category_overwrites" ADD CONSTRAINT "category_overwrites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "channel_overwrites" ADD CONSTRAINT "channel_overwrites_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "channel_overwrites" ADD CONSTRAINT "channel_overwrites_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "channel_overwrites" ADD CONSTRAINT "channel_overwrites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "category_overwrites_category_idx" ON "category_overwrites" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "category_overwrites_role_uq" ON "category_overwrites" USING btree ("category_id","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "category_overwrites_user_uq" ON "category_overwrites" USING btree ("category_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_overwrites_channel_idx" ON "channel_overwrites" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_overwrites_role_uq" ON "channel_overwrites" USING btree ("channel_id","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_overwrites_user_uq" ON "channel_overwrites" USING btree ("channel_id","user_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "members" ADD CONSTRAINT "members_confined_channel_id_channels_id_fk" FOREIGN KEY ("confined_channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
