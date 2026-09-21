CREATE TABLE "graph_mutations" (
	"mutation_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"name" text NOT NULL,
	"args_sha256" text NOT NULL,
	"outcome" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "graph_mutations_workspace_created_idx" ON "graph_mutations" USING btree ("workspace_id","created_at");