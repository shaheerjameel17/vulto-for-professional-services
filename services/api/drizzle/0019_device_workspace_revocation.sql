-- F210 / F212 — retire the sealed-store unlock secret without losing a revoke.
--
-- `device_unlock_secret.revoked_at` was the only record of an Owner's
-- workspace-scoped device revoke (F191), of a membership removal's effect on a
-- person's devices, and of an account suspension's. Dropping that table would
-- silently un-revoke every device it marked. So this migration creates the
-- control-plane table that replaces it, copies every revocation across, and only
-- then drops the old table, all in one transaction.
CREATE TABLE "device_workspace_revocation" (
	"workspace_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"revoked_at" timestamp DEFAULT now() NOT NULL,
	"revoked_by" uuid,
	"reason" text NOT NULL,
	CONSTRAINT "device_workspace_revocation_workspace_id_device_id_pk" PRIMARY KEY("workspace_id","device_id")
);
--> statement-breakpoint
ALTER TABLE "device_workspace_revocation" ADD CONSTRAINT "device_workspace_revocation_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_workspace_revocation_device_idx" ON "device_workspace_revocation" USING btree ("device_id");--> statement-breakpoint
-- Backfill: every revoked (workspace, device) pair. The actor and the reason are
-- read from the append-only trust log where it recorded them (the most recent
-- event for that device in that workspace); where it did not, the actor is null
-- and the reason is `unknown`. The revocation itself is what matters.
INSERT INTO "device_workspace_revocation" ("workspace_id", "device_id", "revoked_at", "revoked_by", "reason")
SELECT
	s."workspace_id",
	s."device_id",
	s."revoked_at",
	e."actor_user_id",
	CASE e."event_type"
		WHEN 'stale-flagged' THEN 'stale'
		WHEN 'revoked-explicit' THEN 'explicit'
		WHEN 'revoked-membership' THEN 'membership-revoked'
		ELSE 'unknown'
	END
FROM "device_unlock_secret" s
LEFT JOIN LATERAL (
	SELECT t."event_type", t."actor_user_id"
	FROM "device_trust_event" t
	WHERE t."device_id" = s."device_id"
		AND t."workspace_id" = s."workspace_id"
		AND t."event_type" IN ('stale-flagged', 'revoked-explicit', 'revoked-membership')
	ORDER BY t."created_at" DESC, t."id" DESC
	LIMIT 1
) e ON true
WHERE s."revoked_at" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- The retired local-first stack's tables (F199): the sealed-store unlock half, the
-- Rust relay's delta log, cursor, acknowledgement and ticket tables, and the
-- device-side projection grants.
DROP TABLE "device_unlock_secret" CASCADE;--> statement-breakpoint
DROP TABLE "sync_delta" CASCADE;--> statement-breakpoint
DROP TABLE "sync_device_ack" CASCADE;--> statement-breakpoint
DROP TABLE "sync_ticket" CASCADE;--> statement-breakpoint
DROP TABLE "sync_workspace_cursor" CASCADE;--> statement-breakpoint
DROP TABLE "workspace_projection_grant" CASCADE;
