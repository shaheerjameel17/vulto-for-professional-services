CREATE TABLE "device" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_name" text NOT NULL,
	"platform" text NOT NULL,
	"application" text DEFAULT 'VultoRoster' NOT NULL,
	"push_token" text,
	"registered_at" timestamp DEFAULT now() NOT NULL,
	"last_active_at" timestamp DEFAULT now() NOT NULL,
	"is_revoked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "device_id_format_check" CHECK ("device"."id" ~ '^[A-Za-z0-9_-]{16,128}$'),
	CONSTRAINT "device_platform_check" CHECK ("device"."platform" in ('web', 'ios', 'android', 'macos', 'windows')),
	CONSTRAINT "device_application_check" CHECK ("device"."application" in ('VultoRoster', 'VultoAccounts', 'VultoProjects', 'VultoLegal'))
);
--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_userId_idx" ON "device" USING btree ("user_id");