ALTER TABLE "audit_journal" ALTER COLUMN "actor_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_journal" ADD COLUMN "actor_kind" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_journal" ADD COLUMN "actor_grant_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_journal" ADD COLUMN "actor_system_name" text;--> statement-breakpoint
CREATE INDEX "audit_journal_workspace_actor_kind_idx" ON "audit_journal" USING btree ("workspace_id","actor_kind","actor_grant_id","actor_system_name","occurred_at");--> statement-breakpoint
ALTER TABLE "audit_journal" ADD CONSTRAINT "audit_journal_actor_kind_check" CHECK ("audit_journal"."actor_kind" in ('member', 'support', 'system'));--> statement-breakpoint
ALTER TABLE "audit_journal" ADD CONSTRAINT "audit_journal_actor_identity_check" CHECK (("audit_journal"."actor_kind" = 'member' and "audit_journal"."actor_user_id" is not null and "audit_journal"."actor_grant_id" is null and "audit_journal"."actor_system_name" is null)
        or ("audit_journal"."actor_kind" = 'support' and "audit_journal"."actor_grant_id" is not null and "audit_journal"."actor_user_id" is null and "audit_journal"."actor_system_name" is null)
        or ("audit_journal"."actor_kind" = 'system' and "audit_journal"."actor_system_name" is not null and "audit_journal"."actor_user_id" is null and "audit_journal"."actor_grant_id" is null));