CREATE TABLE IF NOT EXISTS "project_member" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_member_project_user_unique" UNIQUE("project_id","user_id"),
	CONSTRAINT "project_member_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "project_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_member_projectId_idx" ON "project_member" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_member_userId_idx" ON "project_member" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "created_by" text;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'project_created_by_user_id_fk'
	) THEN
		ALTER TABLE "project" ADD CONSTRAINT "project_created_by_user_id_fk"
			FOREIGN KEY ("created_by") REFERENCES "public"."user"("id")
			ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
-- Backfill: every current workspace member becomes a member of every project in
-- their workspace (owners/admins as managers) so existing projects keep working.
INSERT INTO "project_member" ("id", "project_id", "user_id", "role")
SELECT gen_random_uuid()::text, p.id, wm.user_id,
	CASE WHEN wm.role IN ('owner', 'admin') THEN 'manager' ELSE 'member' END
FROM "project" p
JOIN "workspace_member" wm ON wm.workspace_id = p.workspace_id
ON CONFLICT ("project_id", "user_id") DO NOTHING;
