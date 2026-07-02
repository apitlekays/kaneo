CREATE TABLE "letter_approval_instance" (
	"id" text PRIMARY KEY NOT NULL,
	"letter_id" text NOT NULL,
	"chain_id" text,
	"chain_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "letter_approval_step_instance" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"step_order" integer NOT NULL,
	"mode" text DEFAULT 'sequential' NOT NULL,
	"approver_type" text NOT NULL,
	"approver_refs" jsonb NOT NULL,
	"quorum" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decisions" jsonb,
	"due_at" timestamp,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "letter_dispatch" (
	"id" text PRIMARY KEY NOT NULL,
	"letter_id" text NOT NULL,
	"method" text NOT NULL,
	"distribution_list_ids" jsonb,
	"recipients" jsonb,
	"dispatched_by" text,
	"dispatched_at" timestamp DEFAULT now() NOT NULL,
	"provider_message_id" text,
	"delivery_status" text,
	"tracking_no" text
);
--> statement-breakpoint
CREATE TABLE "letter_draft_version" (
	"id" text PRIMARY KEY NOT NULL,
	"letter_id" text NOT NULL,
	"version" integer NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"object_key" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "letter_signature" (
	"id" text PRIMARY KEY NOT NULL,
	"letter_id" text NOT NULL,
	"signer_id" text,
	"method" text DEFAULT 'org-cert' NOT NULL,
	"signature_image_key" text,
	"signed_object_key" text,
	"signed_hash" text,
	"manifest" jsonb,
	"signed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "letter_approval_instance" ADD CONSTRAINT "letter_approval_instance_letter_id_letter_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letter"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_approval_instance" ADD CONSTRAINT "letter_approval_instance_chain_id_gm_approval_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."gm_approval_chain"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_approval_step_instance" ADD CONSTRAINT "letter_approval_step_instance_instance_id_letter_approval_instance_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."letter_approval_instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_dispatch" ADD CONSTRAINT "letter_dispatch_letter_id_letter_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letter"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_dispatch" ADD CONSTRAINT "letter_dispatch_dispatched_by_user_id_fk" FOREIGN KEY ("dispatched_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_draft_version" ADD CONSTRAINT "letter_draft_version_letter_id_letter_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letter"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_draft_version" ADD CONSTRAINT "letter_draft_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_signature" ADD CONSTRAINT "letter_signature_letter_id_letter_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letter"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_signature" ADD CONSTRAINT "letter_signature_signer_id_user_id_fk" FOREIGN KEY ("signer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "letter_approval_instance_letterId_idx" ON "letter_approval_instance" USING btree ("letter_id");--> statement-breakpoint
CREATE INDEX "letter_approval_step_instance_instanceId_idx" ON "letter_approval_step_instance" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "letter_dispatch_letterId_idx" ON "letter_dispatch" USING btree ("letter_id");--> statement-breakpoint
CREATE INDEX "letter_draft_version_letterId_idx" ON "letter_draft_version" USING btree ("letter_id");--> statement-breakpoint
CREATE INDEX "letter_signature_letterId_idx" ON "letter_signature" USING btree ("letter_id");