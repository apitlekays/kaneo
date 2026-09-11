CREATE TABLE "meeting_action_update" (
	"id" text PRIMARY KEY NOT NULL,
	"action_id" text NOT NULL,
	"author_id" text,
	"body" text NOT NULL,
	"status_after" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_document" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"action_update_id" text,
	"workspace_id" text NOT NULL,
	"object_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text,
	"kind" text DEFAULT 'original' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_document_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
ALTER TABLE "meeting_action_update" ADD CONSTRAINT "meeting_action_update_action_id_meeting_action_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."meeting_action"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_action_update" ADD CONSTRAINT "meeting_action_update_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_document" ADD CONSTRAINT "meeting_document_meeting_id_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_document" ADD CONSTRAINT "meeting_document_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_document" ADD CONSTRAINT "meeting_document_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_action_update_actionId_idx" ON "meeting_action_update" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "meeting_document_meetingId_idx" ON "meeting_document" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "meeting_document_actionUpdateId_idx" ON "meeting_document" USING btree ("action_update_id");