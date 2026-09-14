CREATE TABLE "meeting_action_memo" (
	"id" text PRIMARY KEY NOT NULL,
	"action_id" text NOT NULL,
	"sent_by" text,
	"recipient_name" text NOT NULL,
	"recipient_email" text NOT NULL,
	"cc" jsonb,
	"reply_to" text NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting_action_memo" ADD CONSTRAINT "meeting_action_memo_action_id_meeting_action_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."meeting_action"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_action_memo" ADD CONSTRAINT "meeting_action_memo_sent_by_user_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_action_memo_actionId_idx" ON "meeting_action_memo" USING btree ("action_id");