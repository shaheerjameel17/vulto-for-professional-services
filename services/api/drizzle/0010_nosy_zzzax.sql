CREATE TABLE "audit_journal" (
	"workspace_id" uuid NOT NULL,
	"audit_entry_id" uuid NOT NULL,
	"content_digest" text NOT NULL,
	"entry" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"operation" text NOT NULL,
	"outcome" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_node_type" text,
	"target_tier" smallint,
	"appended_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "audit_journal_workspace_id_audit_entry_id_pk" PRIMARY KEY("workspace_id","audit_entry_id"),
	CONSTRAINT "audit_journal_event_type_check" CHECK ("audit_journal"."event_type" in ('PermissionDenied', 'SensitiveAccessGranted', 'AuthorizedOperationFailed')),
	CONSTRAINT "audit_journal_outcome_check" CHECK ("audit_journal"."outcome" in ('Granted', 'Denied', 'Failed')),
	CONSTRAINT "audit_journal_target_kind_check" CHECK ("audit_journal"."target_kind" in ('NodeTarget', 'EdgeTarget', 'QueryTarget')),
	CONSTRAINT "audit_journal_target_tier_check" CHECK ("audit_journal"."target_tier" is null or "audit_journal"."target_tier" between 0 and 3)
);
--> statement-breakpoint
ALTER TABLE "audit_journal" ADD CONSTRAINT "audit_journal_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_journal_workspace_occurred_idx" ON "audit_journal" USING btree ("workspace_id","occurred_at","audit_entry_id");--> statement-breakpoint
CREATE INDEX "audit_journal_workspace_actor_idx" ON "audit_journal" USING btree ("workspace_id","actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_journal_workspace_event_idx" ON "audit_journal" USING btree ("workspace_id","event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_journal_workspace_operation_idx" ON "audit_journal" USING btree ("workspace_id","operation","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_journal_workspace_outcome_idx" ON "audit_journal" USING btree ("workspace_id","outcome","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_journal_workspace_target_idx" ON "audit_journal" USING btree ("workspace_id","target_kind","target_node_type","target_tier","occurred_at");
