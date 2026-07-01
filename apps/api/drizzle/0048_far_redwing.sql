CREATE TABLE "gm_approval_chain" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"applies_to" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gm_approval_step" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" text NOT NULL,
	"step_order" integer NOT NULL,
	"mode" text DEFAULT 'sequential' NOT NULL,
	"approver_type" text NOT NULL,
	"approver_refs" jsonb NOT NULL,
	"quorum" integer DEFAULT 1 NOT NULL,
	"sla_hours" integer,
	"condition" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gm_audit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"workspace_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_id" text,
	"at" timestamp DEFAULT now() NOT NULL,
	"ip" text,
	"device_info" text,
	"before" jsonb,
	"after" jsonb,
	"prev_hash" text,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gm_category" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gm_category_ws_key_unique" UNIQUE("workspace_id","key")
);
--> statement-breakpoint
CREATE TABLE "gm_department" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" text,
	"head_user_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gm_distribution_list" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"group_email" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gm_file_plan_node" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"parent_id" text,
	"code" text,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gm_number_scheme" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"direction" text NOT NULL,
	"letter_type" text NOT NULL,
	"format" jsonb NOT NULL,
	"reset_policy" text DEFAULT 'yearly' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gm_number_scheme_ws_key_unique" UNIQUE("workspace_id","key")
);
--> statement-breakpoint
CREATE TABLE "gm_number_sequence" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"scheme_id" text NOT NULL,
	"period_key" text NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gm_number_sequence_scheme_period_unique" UNIQUE("scheme_id","period_key")
);
--> statement-breakpoint
CREATE TABLE "gm_retention_class" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"retention_months" integer NOT NULL,
	"trigger" text DEFAULT 'close' NOT NULL,
	"disposition_action" text DEFAULT 'review' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gm_security_label" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gm_security_label_ws_key_unique" UNIQUE("workspace_id","key")
);
--> statement-breakpoint
CREATE TABLE "gm_sender_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"display_name" text NOT NULL,
	"reply_to" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gm_signatory" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"applies_to_type" jsonb,
	"signature_image_key" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gm_signatory_ws_user_unique" UNIQUE("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "gm_sla_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"applies_to" jsonb,
	"ack_hours" integer,
	"action_hours" integer,
	"approval_hours" integer,
	"escalate_to_role" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gm_template" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"letter_type" text NOT NULL,
	"name" text NOT NULL,
	"lang" text DEFAULT 'en' NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"letterhead_object_key" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gm_approval_chain" ADD CONSTRAINT "gm_approval_chain_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gm_approval_step" ADD CONSTRAINT "gm_approval_step_chain_id_gm_approval_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."gm_approval_chain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gm_audit_event" ADD CONSTRAINT "gm_audit_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gm_audit_event" ADD CONSTRAINT "gm_audit_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gm_category" ADD CONSTRAINT "gm_category_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gm_department" ADD CONSTRAINT "gm_department_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gm_department" ADD CONSTRAINT "gm_department_head_user_id_user_id_fk" FOREIGN KEY ("head_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gm_distribution_list" ADD CONSTRAINT "gm_distribution_list_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gm_file_plan_node" ADD CONSTRAINT "gm_file_plan_node_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gm_number_scheme" ADD CONSTRAINT "gm_number_scheme_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gm_number_sequence" ADD CONSTRAINT "gm_number_sequence_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gm_number_sequence" ADD CONSTRAINT "gm_number_sequence_scheme_id_gm_number_scheme_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."gm_number_scheme"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gm_retention_class" ADD CONSTRAINT "gm_retention_class_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gm_security_label" ADD CONSTRAINT "gm_security_label_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gm_sender_profile" ADD CONSTRAINT "gm_sender_profile_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gm_signatory" ADD CONSTRAINT "gm_signatory_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gm_signatory" ADD CONSTRAINT "gm_signatory_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gm_sla_policy" ADD CONSTRAINT "gm_sla_policy_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gm_template" ADD CONSTRAINT "gm_template_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gm_approval_chain_workspaceId_idx" ON "gm_approval_chain" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "gm_approval_step_chainId_idx" ON "gm_approval_step" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "gm_audit_event_ws_at_idx" ON "gm_audit_event" USING btree ("workspace_id","at");--> statement-breakpoint
CREATE INDEX "gm_audit_event_entity_idx" ON "gm_audit_event" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "gm_category_workspaceId_idx" ON "gm_category" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "gm_department_workspaceId_idx" ON "gm_department" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "gm_distribution_list_workspaceId_idx" ON "gm_distribution_list" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "gm_file_plan_node_workspaceId_idx" ON "gm_file_plan_node" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "gm_number_scheme_workspaceId_idx" ON "gm_number_scheme" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "gm_retention_class_workspaceId_idx" ON "gm_retention_class" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "gm_security_label_workspaceId_idx" ON "gm_security_label" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "gm_sender_profile_workspaceId_idx" ON "gm_sender_profile" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "gm_signatory_workspaceId_idx" ON "gm_signatory" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "gm_sla_policy_workspaceId_idx" ON "gm_sla_policy" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "gm_template_workspaceId_idx" ON "gm_template" USING btree ("workspace_id");