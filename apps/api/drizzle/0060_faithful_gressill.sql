CREATE TABLE "meeting_action" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"minute_item_id" text,
	"assignee_id" text,
	"from_user_id" text,
	"description" text NOT NULL,
	"due_at" timestamp,
	"acceptance" text DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"status" text DEFAULT 'open' NOT NULL,
	"completed_at" timestamp,
	"completed_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_attendee" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"user_id" text,
	"name" text,
	"attendance" text DEFAULT 'present' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_body_member" (
	"id" text PRIMARY KEY NOT NULL,
	"body_id" text NOT NULL,
	"user_id" text,
	"name" text,
	"role" text DEFAULT 'member' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_body" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"quorum_rule" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_minute_item" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"agenda" text NOT NULL,
	"discussion" text,
	"decision" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"meeting_type_id" text,
	"body_id" text,
	"scheduled_at" timestamp,
	"location" text,
	"confidential" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"adopted_at" timestamp,
	"adopted_by_meeting_id" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_type" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_type_ws_key_unique" UNIQUE("workspace_id","key")
);
--> statement-breakpoint
ALTER TABLE "meeting_action" ADD CONSTRAINT "meeting_action_meeting_id_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_action" ADD CONSTRAINT "meeting_action_minute_item_id_meeting_minute_item_id_fk" FOREIGN KEY ("minute_item_id") REFERENCES "public"."meeting_minute_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_action" ADD CONSTRAINT "meeting_action_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_action" ADD CONSTRAINT "meeting_action_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_action" ADD CONSTRAINT "meeting_action_completed_by_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendee" ADD CONSTRAINT "meeting_attendee_meeting_id_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendee" ADD CONSTRAINT "meeting_attendee_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_body_member" ADD CONSTRAINT "meeting_body_member_body_id_meeting_body_id_fk" FOREIGN KEY ("body_id") REFERENCES "public"."meeting_body"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_body_member" ADD CONSTRAINT "meeting_body_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_body" ADD CONSTRAINT "meeting_body_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_minute_item" ADD CONSTRAINT "meeting_minute_item_meeting_id_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_meeting_type_id_meeting_type_id_fk" FOREIGN KEY ("meeting_type_id") REFERENCES "public"."meeting_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_body_id_meeting_body_id_fk" FOREIGN KEY ("body_id") REFERENCES "public"."meeting_body"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_type" ADD CONSTRAINT "meeting_type_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_action_meetingId_idx" ON "meeting_action" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "meeting_action_assigneeId_idx" ON "meeting_action" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "meeting_attendee_meetingId_idx" ON "meeting_attendee" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "meeting_body_member_bodyId_idx" ON "meeting_body_member" USING btree ("body_id");--> statement-breakpoint
CREATE INDEX "meeting_body_workspaceId_idx" ON "meeting_body" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "meeting_minute_item_meetingId_idx" ON "meeting_minute_item" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "meeting_workspaceId_idx" ON "meeting" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "meeting_bodyId_idx" ON "meeting" USING btree ("body_id");--> statement-breakpoint
CREATE INDEX "meeting_type_workspaceId_idx" ON "meeting_type" USING btree ("workspace_id");