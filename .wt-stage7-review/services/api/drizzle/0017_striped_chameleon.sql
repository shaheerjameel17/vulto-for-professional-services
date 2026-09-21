CREATE TABLE "sync_edge_audience" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"edge_id" uuid NOT NULL,
	CONSTRAINT "sync_edge_audience_workspace_id_user_id_edge_id_pk" PRIMARY KEY("workspace_id","user_id","edge_id")
);
--> statement-breakpoint
CREATE TABLE "sync_node_audience" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	CONSTRAINT "sync_node_audience_workspace_id_user_id_node_id_pk" PRIMARY KEY("workspace_id","user_id","node_id")
);
--> statement-breakpoint
CREATE INDEX "sync_edge_audience_edge_idx" ON "sync_edge_audience" USING btree ("workspace_id","edge_id");--> statement-breakpoint
CREATE INDEX "sync_node_audience_node_idx" ON "sync_node_audience" USING btree ("workspace_id","node_id");