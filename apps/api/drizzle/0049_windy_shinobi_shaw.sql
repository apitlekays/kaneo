CREATE TABLE "letter_assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"letter_id" text NOT NULL,
	"from_user_id" text,
	"to_user_id" text,
	"to_dept_id" text,
	"action" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"due_at" timestamp,
	"decided_at" timestamp,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "letter_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"letter_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"object_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text,
	"kind" text DEFAULT 'original' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "letter_attachment_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "letter_link" (
	"id" text PRIMARY KEY NOT NULL,
	"from_letter_id" text NOT NULL,
	"to_letter_id" text NOT NULL,
	"relation" text DEFAULT 'related' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "letter_minute" (
	"id" text PRIMARY KEY NOT NULL,
	"letter_id" text NOT NULL,
	"author_id" text,
	"body" text NOT NULL,
	"action_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "letter" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"ref_no" text,
	"file_ref" text,
	"jilid" integer,
	"direction" text NOT NULL,
	"type" text NOT NULL,
	"medium" text NOT NULL,
	"subject" text NOT NULL,
	"sender_name" text,
	"sender_org" text,
	"sender_email" text,
	"recipient_name" text,
	"recipient_org" text,
	"recipient_email" text,
	"letter_date" timestamp,
	"received_at" timestamp,
	"dispatched_at" timestamp,
	"category_id" text,
	"file_plan_node_id" text,
	"security_label_id" text,
	"number_scheme_id" text,
	"retention_class_id" text,
	"status" text DEFAULT 'captured' NOT NULL,
	"disposition_status" text,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"primary_attachment_id" text,
	"content_hash" text,
	"current_assignee_id" text,
	"created_by" text,
	"declared_at" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "letter_assignment" ADD CONSTRAINT "letter_assignment_letter_id_letter_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letter"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_assignment" ADD CONSTRAINT "letter_assignment_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_assignment" ADD CONSTRAINT "letter_assignment_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_attachment" ADD CONSTRAINT "letter_attachment_letter_id_letter_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letter"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_attachment" ADD CONSTRAINT "letter_attachment_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_attachment" ADD CONSTRAINT "letter_attachment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_link" ADD CONSTRAINT "letter_link_from_letter_id_letter_id_fk" FOREIGN KEY ("from_letter_id") REFERENCES "public"."letter"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_link" ADD CONSTRAINT "letter_link_to_letter_id_letter_id_fk" FOREIGN KEY ("to_letter_id") REFERENCES "public"."letter"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_minute" ADD CONSTRAINT "letter_minute_letter_id_letter_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letter"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_minute" ADD CONSTRAINT "letter_minute_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter" ADD CONSTRAINT "letter_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter" ADD CONSTRAINT "letter_category_id_gm_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."gm_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter" ADD CONSTRAINT "letter_file_plan_node_id_gm_file_plan_node_id_fk" FOREIGN KEY ("file_plan_node_id") REFERENCES "public"."gm_file_plan_node"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter" ADD CONSTRAINT "letter_security_label_id_gm_security_label_id_fk" FOREIGN KEY ("security_label_id") REFERENCES "public"."gm_security_label"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter" ADD CONSTRAINT "letter_number_scheme_id_gm_number_scheme_id_fk" FOREIGN KEY ("number_scheme_id") REFERENCES "public"."gm_number_scheme"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter" ADD CONSTRAINT "letter_retention_class_id_gm_retention_class_id_fk" FOREIGN KEY ("retention_class_id") REFERENCES "public"."gm_retention_class"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter" ADD CONSTRAINT "letter_current_assignee_id_user_id_fk" FOREIGN KEY ("current_assignee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter" ADD CONSTRAINT "letter_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "letter_assignment_letterId_idx" ON "letter_assignment" USING btree ("letter_id");--> statement-breakpoint
CREATE INDEX "letter_attachment_letterId_idx" ON "letter_attachment" USING btree ("letter_id");--> statement-breakpoint
CREATE INDEX "letter_link_fromLetterId_idx" ON "letter_link" USING btree ("from_letter_id");--> statement-breakpoint
CREATE INDEX "letter_minute_letterId_idx" ON "letter_minute" USING btree ("letter_id");--> statement-breakpoint
CREATE INDEX "letter_ws_status_idx" ON "letter" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "letter_ws_dir_type_idx" ON "letter" USING btree ("workspace_id","direction","type");--> statement-breakpoint
CREATE INDEX "letter_ws_refno_idx" ON "letter" USING btree ("workspace_id","ref_no");