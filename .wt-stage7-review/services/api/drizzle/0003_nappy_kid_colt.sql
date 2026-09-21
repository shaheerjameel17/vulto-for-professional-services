CREATE TABLE "sync_ticket" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_ticket" ADD CONSTRAINT "sync_ticket_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_ticket" ADD CONSTRAINT "sync_ticket_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_ticket_workspace_device_idx" ON "sync_ticket" USING btree ("workspace_id","device_id");--> statement-breakpoint
CREATE INDEX "sync_ticket_expires_at_idx" ON "sync_ticket" USING btree ("expires_at");