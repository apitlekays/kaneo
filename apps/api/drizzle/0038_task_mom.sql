CREATE TABLE IF NOT EXISTS "task_mom" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "task_mom_task_id_unique" UNIQUE("task_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_mom" ADD CONSTRAINT "task_mom_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_mom" ADD CONSTRAINT "task_mom_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_mom_taskId_idx" ON "task_mom" USING btree ("task_id");
