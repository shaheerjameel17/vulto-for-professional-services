CREATE TABLE "graph_edges" (
	"edge_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"edge_type" text NOT NULL,
	"from_node_id" uuid NOT NULL,
	"to_node_id" uuid NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"version" bigint DEFAULT 1 NOT NULL,
	"is_soft_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"soft_deleted_at" timestamp with time zone,
	"soft_deleted_by" uuid,
	"record" jsonb NOT NULL,
	CONSTRAINT "graph_edges_record_edge_id_check" CHECK ("graph_edges"."record"->>'edge_id' = "graph_edges"."edge_id"::text)
);
--> statement-breakpoint
CREATE TABLE "graph_nodes" (
	"node_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"node_type" text NOT NULL,
	"lifecycle_status" text NOT NULL,
	"schema_version" integer NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"is_soft_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"soft_deleted_at" timestamp with time zone,
	"soft_deleted_by" uuid,
	"record" jsonb NOT NULL,
	CONSTRAINT "graph_nodes_workspace_id_node_id_pk" PRIMARY KEY("workspace_id","node_id"),
	CONSTRAINT "graph_nodes_record_node_id_check" CHECK ("graph_nodes"."record"->>'node_id' = "graph_nodes"."node_id"::text),
	CONSTRAINT "graph_nodes_record_lifecycle_check" CHECK ("graph_nodes"."record"->>'lifecycle_status' = "graph_nodes"."lifecycle_status"),
	CONSTRAINT "graph_nodes_workspace_self_check" CHECK ("graph_nodes"."node_type" <> 'Workspace' or "graph_nodes"."workspace_id" = "graph_nodes"."node_id")
);
--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_from_node_fk" FOREIGN KEY ("workspace_id","from_node_id") REFERENCES "public"."graph_nodes"("workspace_id","node_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_to_node_fk" FOREIGN KEY ("workspace_id","to_node_id") REFERENCES "public"."graph_nodes"("workspace_id","node_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "graph_edges_from_idx" ON "graph_edges" USING btree ("workspace_id","edge_type","from_node_id","effective_from","effective_to");--> statement-breakpoint
CREATE INDEX "graph_edges_to_idx" ON "graph_edges" USING btree ("workspace_id","edge_type","to_node_id","effective_from","effective_to");--> statement-breakpoint
CREATE UNIQUE INDEX "graph_edges_single_active_outgoing_uidx" ON "graph_edges" USING btree ("edge_type","from_node_id") WHERE "graph_edges"."effective_to" is null and not "graph_edges"."is_soft_deleted" and "graph_edges"."edge_type" in ('managed_by','scoped_to_entity');--> statement-breakpoint
CREATE INDEX "graph_nodes_workspace_type_lifecycle_idx" ON "graph_nodes" USING btree ("workspace_id","node_type","lifecycle_status") WHERE not "graph_nodes"."is_soft_deleted";--> statement-breakpoint
CREATE UNIQUE INDEX "graph_nodes_node_id_non_user_uidx" ON "graph_nodes" USING btree ("node_id") WHERE "graph_nodes"."node_type" <> 'User';--> statement-breakpoint
-- Hand-appended: SQL Drizzle cannot express (Stage 2, F204).
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_single_active_overlap_excl" EXCLUDE USING gist ("from_node_id" WITH =, "edge_type" WITH =, tstzrange("effective_from", "effective_to", '[)') WITH &&) WHERE (NOT "is_soft_deleted" AND "edge_type" IN ('managed_by','scoped_to_entity'));
