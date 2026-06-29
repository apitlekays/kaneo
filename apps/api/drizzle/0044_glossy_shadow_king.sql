CREATE TABLE "asset_pm_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"title" text NOT NULL,
	"interval_type" text DEFAULT 'months' NOT NULL,
	"interval_value" integer NOT NULL,
	"last_done_date" timestamp,
	"next_due_date" timestamp NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"pm_schedule_id" text,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'requested' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"assignee_id" text,
	"due_date" timestamp,
	"completed_at" timestamp,
	"cost" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_pm_schedule" ADD CONSTRAINT "asset_pm_schedule_asset_id_registered_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."registered_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_pm_schedule" ADD CONSTRAINT "asset_pm_schedule_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_asset_id_registered_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."registered_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_pm_schedule_id_asset_pm_schedule_id_fk" FOREIGN KEY ("pm_schedule_id") REFERENCES "public"."asset_pm_schedule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_pm_schedule_assetId_idx" ON "asset_pm_schedule" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "work_order_workspaceId_idx" ON "work_order" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "work_order_assigneeId_idx" ON "work_order" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "work_order_assetId_idx" ON "work_order" USING btree ("asset_id");