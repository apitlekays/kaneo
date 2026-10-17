ALTER TABLE "task" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "task_createdBy_idx" ON "task" USING btree ("created_by");--> statement-breakpoint
-- Backfill the creator from the task's "created" activity row.
UPDATE "task" SET "created_by" = (
  SELECT a."user_id" FROM "activity" a
  WHERE a."task_id" = "task"."id" AND a."type" = 'created' AND a."user_id" IS NOT NULL
  ORDER BY a."created_at" ASC
  LIMIT 1
) WHERE "created_by" IS NULL;--> statement-breakpoint
-- Viewer is read-only from now on. Everyone who held it got it from the
-- invite default rather than a deliberate choice, so they become Members.
UPDATE "workspace_member" SET "role" = 'member' WHERE "role" = 'viewer';--> statement-breakpoint
UPDATE "workspace_member" SET "previous_role" = 'member' WHERE "previous_role" = 'viewer';--> statement-breakpoint
UPDATE "invitation" SET "role" = 'member' WHERE "role" = 'viewer' AND "status" = 'pending';
