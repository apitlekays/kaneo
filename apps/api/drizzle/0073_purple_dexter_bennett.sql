CREATE TABLE "task_cost" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"description" text NOT NULL,
	"amount" bigint NOT NULL,
	"incurred_on" timestamp NOT NULL,
	"receipt_key" text,
	"receipt_filename" text,
	"receipt_mime_type" text,
	"receipt_size" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "budget" bigint;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "revenue" bigint;--> statement-breakpoint
ALTER TABLE "task_cost" ADD CONSTRAINT "task_cost_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_cost" ADD CONSTRAINT "task_cost_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "task_cost_taskId_idx" ON "task_cost" USING btree ("task_id");