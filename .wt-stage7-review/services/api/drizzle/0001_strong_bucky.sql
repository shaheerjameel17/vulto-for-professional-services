CREATE TABLE "device_unlock_secret" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"key_epoch" integer DEFAULT 1 NOT NULL,
	"server_half" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "device_unlock_secret" ADD CONSTRAINT "device_unlock_secret_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_unlock_secret" ADD CONSTRAINT "device_unlock_secret_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_unlock_secret_workspace_device_uidx" ON "device_unlock_secret" USING btree ("workspace_id","device_id");--> statement-breakpoint
CREATE INDEX "device_unlock_secret_userId_idx" ON "device_unlock_secret" USING btree ("user_id");