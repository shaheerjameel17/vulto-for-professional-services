CREATE TABLE "device_trust_event" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"device_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"event_type" text NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_trust_event_type_check" CHECK ("device_trust_event"."event_type" in ('registered', 'activity-refreshed', 'revoked-explicit', 'revoked-membership', 'stale-flagged', 're-approved'))
);
--> statement-breakpoint
ALTER TABLE "device_trust_event" ADD CONSTRAINT "device_trust_event_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_trust_event" ADD CONSTRAINT "device_trust_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_trust_event" ADD CONSTRAINT "device_trust_event_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_trust_event" ADD CONSTRAINT "device_trust_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_trust_event_device_created_idx" ON "device_trust_event" USING btree ("device_id","created_at");