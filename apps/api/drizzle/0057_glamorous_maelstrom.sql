CREATE TABLE "task_assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"from_user_id" text,
	"to_user_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "task_assignment" ADD CONSTRAINT "task_assignment_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignment" ADD CONSTRAINT "task_assignment_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignment" ADD CONSTRAINT "task_assignment_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_assignment_taskId_idx" ON "task_assignment" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_assignment_toUserId_idx" ON "task_assignment" USING btree ("to_user_id");--> statement-breakpoint
-- Every task already assigned when this shipped is treated as accepted.
-- Turning acceptance on retroactively would drop hundreds of prompts for
-- work already underway into people's queues. from_user_id is NULL because
-- nothing recorded who assigned these; the rejection path tolerates that.
INSERT INTO "task_assignment" ("id", "task_id", "from_user_id", "to_user_id", "status", "decided_at")
SELECT
  md5(t."id" || 'grandfathered')::text,
  t."id",
  NULL,
  t."assignee_id",
  'accepted',
  now()
FROM "task" t
WHERE t."assignee_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "task_assignment" a WHERE a."task_id" = t."id"
  );
