CREATE TABLE "sync_delta" (
	"workspace_id" uuid NOT NULL,
	"cursor" bigint NOT NULL,
	"document_id" text NOT NULL,
	"tier_tag" smallint NOT NULL,
	"payload_kind" smallint NOT NULL,
	"origin_device_id" text NOT NULL,
	"committed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"payload" "bytea" NOT NULL,
	CONSTRAINT "sync_delta_workspace_id_cursor_pk" PRIMARY KEY("workspace_id","cursor"),
	CONSTRAINT "sync_delta_cursor_positive" CHECK ("sync_delta"."cursor" > 0),
	CONSTRAINT "sync_delta_tier_tag_check" CHECK ("sync_delta"."tier_tag" in (0, 1)),
	CONSTRAINT "sync_delta_payload_kind_check" CHECK ("sync_delta"."payload_kind" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE "sync_device_ack" (
	"workspace_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"acked_cursor" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_device_ack_workspace_id_device_id_pk" PRIMARY KEY("workspace_id","device_id"),
	CONSTRAINT "sync_device_ack_acked_cursor_non_negative" CHECK ("sync_device_ack"."acked_cursor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sync_workspace_cursor" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"last_cursor" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "sync_workspace_cursor_last_cursor_non_negative" CHECK ("sync_workspace_cursor"."last_cursor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sync_delta" ADD CONSTRAINT "sync_delta_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_device_ack" ADD CONSTRAINT "sync_device_ack_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_workspace_cursor" ADD CONSTRAINT "sync_workspace_cursor_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_delta_workspace_document_cursor_idx" ON "sync_delta" USING btree ("workspace_id","document_id","cursor");