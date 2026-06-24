CREATE TABLE IF NOT EXISTS "task_drive_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"file_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"icon_url" text,
	"mime_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "task_drive_attachment_task_file_unique" UNIQUE("task_id","file_id"),
	CONSTRAINT "task_drive_attachment_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "task_drive_attachment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_drive_attachment_taskId_idx" ON "task_drive_attachment" USING btree ("task_id");
