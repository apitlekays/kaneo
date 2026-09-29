CREATE TABLE "task_assignee" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"is_lead" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "task_assignee_task_user_unique" UNIQUE("task_id","user_id")
);
--> statement-breakpoint
DROP INDEX "task_assignment_one_pending_idx";--> statement-breakpoint
ALTER TABLE "task_assignment" ADD COLUMN "exclusive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task_assignee" ADD CONSTRAINT "task_assignee_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_assignee" ADD CONSTRAINT "task_assignee_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "task_assignee_one_lead_idx" ON "task_assignee" USING btree ("task_id") WHERE "task_assignee"."is_lead";--> statement-breakpoint
CREATE INDEX "task_assignee_userId_idx" ON "task_assignee" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_assignment_one_pending_per_user_idx" ON "task_assignment" USING btree ("task_id","to_user_id") WHERE "task_assignment"."status" = 'pending';--> statement-breakpoint
-- Backfill: every task that has an assignee today gets that person as its
-- lead, so task.assignee_id and the lead row agree from the first boot.
INSERT INTO "task_assignee" ("id", "task_id", "user_id", "is_lead")
SELECT md5(t."id" || 'lead'), t."id", t."assignee_id", true
FROM "task" t
WHERE t."assignee_id" IS NOT NULL;--> statement-breakpoint
-- Offers still pending were made under single-assignee semantics:
-- accepting one must still replace the incumbent, as it would have.
UPDATE "task_assignment" SET "exclusive" = true WHERE "status" = 'pending';
