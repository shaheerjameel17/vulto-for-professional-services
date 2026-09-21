CREATE TABLE "graph_protected_fragments" (
	"fragment_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"schema_partition" text NOT NULL,
	"tier" smallint NOT NULL,
	"erasure_domain_id" uuid NOT NULL,
	"data_key_id" uuid NOT NULL,
	"nonce" "bytea" NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"header" jsonb NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "graph_protected_fragments_owner_kind_check" CHECK ("graph_protected_fragments"."owner_kind" in ('node', 'edge')),
	CONSTRAINT "graph_protected_fragments_tier_check" CHECK ("graph_protected_fragments"."tier" in (1, 2))
);
--> statement-breakpoint
CREATE TABLE "protected_data_keys" (
	"key_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"tier" smallint,
	"erasure_domain_id" uuid,
	"parent_key_id" uuid,
	"root_key_ref" text,
	"wrapped_key" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"destroyed_at" timestamp with time zone,
	CONSTRAINT "protected_data_keys_kind_check" CHECK ("protected_data_keys"."kind" in ('kek', 'dek')),
	CONSTRAINT "protected_data_keys_tier_check" CHECK ("protected_data_keys"."tier" is null or "protected_data_keys"."tier" in (1, 2)),
	CONSTRAINT "protected_data_keys_kek_shape_check" CHECK ("protected_data_keys"."kind" <> 'kek' or ("protected_data_keys"."parent_key_id" is null and "protected_data_keys"."root_key_ref" is not null and "protected_data_keys"."tier" is null)),
	CONSTRAINT "protected_data_keys_dek_shape_check" CHECK ("protected_data_keys"."kind" <> 'dek' or ("protected_data_keys"."parent_key_id" is not null and "protected_data_keys"."tier" is not null)),
	CONSTRAINT "protected_data_keys_tier1_domain_check" CHECK (not ("protected_data_keys"."kind" = 'dek' and "protected_data_keys"."tier" = 1) or "protected_data_keys"."erasure_domain_id" is not null),
	CONSTRAINT "protected_data_keys_destroyed_check" CHECK (("protected_data_keys"."destroyed_at" is null) = ("protected_data_keys"."wrapped_key" is not null))
);
--> statement-breakpoint
ALTER TABLE "graph_protected_fragments" ADD CONSTRAINT "graph_protected_fragments_data_key_id_protected_data_keys_key_id_fk" FOREIGN KEY ("data_key_id") REFERENCES "public"."protected_data_keys"("key_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protected_data_keys" ADD CONSTRAINT "protected_data_keys_parent_key_id_protected_data_keys_key_id_fk" FOREIGN KEY ("parent_key_id") REFERENCES "public"."protected_data_keys"("key_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "graph_protected_fragments_owner_partition_uidx" ON "graph_protected_fragments" USING btree ("owner_kind","owner_id","schema_partition");--> statement-breakpoint
CREATE INDEX "graph_protected_fragments_workspace_owner_idx" ON "graph_protected_fragments" USING btree ("workspace_id","owner_id");--> statement-breakpoint
CREATE INDEX "graph_protected_fragments_key_idx" ON "graph_protected_fragments" USING btree ("data_key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "protected_data_keys_live_kek_uidx" ON "protected_data_keys" USING btree ("workspace_id") WHERE "protected_data_keys"."kind" = 'kek' and "protected_data_keys"."destroyed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "protected_data_keys_live_tier2_dek_uidx" ON "protected_data_keys" USING btree ("workspace_id") WHERE "protected_data_keys"."kind" = 'dek' and "protected_data_keys"."tier" = 2 and "protected_data_keys"."destroyed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "protected_data_keys_live_tier1_dek_uidx" ON "protected_data_keys" USING btree ("workspace_id","erasure_domain_id") WHERE "protected_data_keys"."kind" = 'dek' and "protected_data_keys"."tier" = 1 and "protected_data_keys"."destroyed_at" is null;--> statement-breakpoint
CREATE INDEX "protected_data_keys_workspace_idx" ON "protected_data_keys" USING btree ("workspace_id","kind");