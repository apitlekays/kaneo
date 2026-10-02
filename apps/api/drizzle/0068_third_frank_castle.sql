CREATE TABLE "asset_disposal_request" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"reason_category" text NOT NULL,
	"proposed_by" text,
	"previous_asset_status" text NOT NULL,
	"pending_decider_id" text,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_disposal_setting" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"committee_body_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "asset_disposal_setting_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "asset_disposal_step" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"stage" text NOT NULL,
	"outcome" text NOT NULL,
	"actor_user_id" text,
	"acted_as" text NOT NULL,
	"justification" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_position" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"holder_user_id" text,
	"acting_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_position_ws_key_unique" UNIQUE("workspace_id","key")
);
--> statement-breakpoint
ALTER TABLE "asset_disposal_request" ADD CONSTRAINT "asset_disposal_request_asset_id_registered_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."registered_asset"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "asset_disposal_request" ADD CONSTRAINT "asset_disposal_request_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "asset_disposal_request" ADD CONSTRAINT "asset_disposal_request_proposed_by_user_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "asset_disposal_request" ADD CONSTRAINT "asset_disposal_request_pending_decider_id_user_id_fk" FOREIGN KEY ("pending_decider_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "asset_disposal_setting" ADD CONSTRAINT "asset_disposal_setting_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "asset_disposal_setting" ADD CONSTRAINT "asset_disposal_setting_committee_body_id_meeting_body_id_fk" FOREIGN KEY ("committee_body_id") REFERENCES "public"."meeting_body"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "asset_disposal_step" ADD CONSTRAINT "asset_disposal_step_request_id_asset_disposal_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."asset_disposal_request"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "asset_disposal_step" ADD CONSTRAINT "asset_disposal_step_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workspace_position" ADD CONSTRAINT "workspace_position_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workspace_position" ADD CONSTRAINT "workspace_position_holder_user_id_user_id_fk" FOREIGN KEY ("holder_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workspace_position" ADD CONSTRAINT "workspace_position_acting_user_id_user_id_fk" FOREIGN KEY ("acting_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "asset_disposal_request_assetId_idx" ON "asset_disposal_request" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_disposal_request_workspaceId_idx" ON "asset_disposal_request" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "asset_disposal_request_decider_idx" ON "asset_disposal_request" USING btree ("pending_decider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_disposal_request_one_open_idx" ON "asset_disposal_request" USING btree ("asset_id") WHERE "asset_disposal_request"."status" in ('proposed', 'awaiting_ceo', 'approved');--> statement-breakpoint
CREATE INDEX "asset_disposal_step_requestId_idx" ON "asset_disposal_step" USING btree ("request_id");