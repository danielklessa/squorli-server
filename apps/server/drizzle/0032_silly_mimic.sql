CREATE TABLE IF NOT EXISTS "local_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"backup_params" jsonb NOT NULL,
	"ciphertext" text NOT NULL,
	"auth_hash" text NOT NULL,
	"avatar_mime" text,
	"avatar_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "local_accounts_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
ALTER TABLE "server_settings" ADD COLUMN "local_accounts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "local_accounts" ADD CONSTRAINT "local_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
