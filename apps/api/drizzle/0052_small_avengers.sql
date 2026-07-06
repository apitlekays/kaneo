ALTER TABLE "letter_minute" ADD COLUMN "assignee_id" text;--> statement-breakpoint
ALTER TABLE "letter_minute" ADD COLUMN "due_at" timestamp;--> statement-breakpoint
ALTER TABLE "letter_minute" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "letter_minute" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "letter_minute" ADD COLUMN "completed_by" text;--> statement-breakpoint
ALTER TABLE "letter_minute" ADD CONSTRAINT "letter_minute_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_minute" ADD CONSTRAINT "letter_minute_completed_by_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "letter_minute_assigneeId_idx" ON "letter_minute" USING btree ("assignee_id");