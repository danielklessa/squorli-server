ALTER TABLE "server_settings" ADD COLUMN "status_api_role_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "server_settings" ADD CONSTRAINT "server_settings_status_api_role_id_roles_id_fk" FOREIGN KEY ("status_api_role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
