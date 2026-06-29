CREATE TABLE "asset_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"type" text NOT NULL,
	"user_id" text,
	"content" text,
	"event_data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_custody" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"user_id" text,
	"assigned_by" text,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"released_at" timestamp,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "registered_asset" ADD COLUMN "current_custodian_id" text;--> statement-breakpoint
ALTER TABLE "asset_activity" ADD CONSTRAINT "asset_activity_asset_id_registered_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."registered_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_activity" ADD CONSTRAINT "asset_activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_custody" ADD CONSTRAINT "asset_custody_asset_id_registered_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."registered_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_custody" ADD CONSTRAINT "asset_custody_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_custody" ADD CONSTRAINT "asset_custody_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_activity_assetId_idx" ON "asset_activity" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_custody_assetId_idx" ON "asset_custody" USING btree ("asset_id");--> statement-breakpoint
ALTER TABLE "registered_asset" ADD CONSTRAINT "registered_asset_current_custodian_id_user_id_fk" FOREIGN KEY ("current_custodian_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;