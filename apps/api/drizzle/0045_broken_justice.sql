CREATE TABLE "asset_fuel_log" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"date" timestamp NOT NULL,
	"volume" integer,
	"cost" integer,
	"odometer" integer,
	"driver_id" text,
	"note" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_meter_reading" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"date" timestamp NOT NULL,
	"value" integer NOT NULL,
	"unit" text DEFAULT 'km' NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"licence_no" text,
	"licence_class" text,
	"licence_expiry" timestamp,
	"phone" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "driver_profile_workspace_user_unique" UNIQUE("workspace_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "asset_pm_schedule" ALTER COLUMN "next_due_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_pm_schedule" ADD COLUMN "last_done_meter" integer;--> statement-breakpoint
ALTER TABLE "asset_pm_schedule" ADD COLUMN "next_due_meter" integer;--> statement-breakpoint
ALTER TABLE "asset_trip" ADD COLUMN "driver_id" text;--> statement-breakpoint
ALTER TABLE "asset_fuel_log" ADD CONSTRAINT "asset_fuel_log_asset_id_registered_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."registered_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_fuel_log" ADD CONSTRAINT "asset_fuel_log_driver_id_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_fuel_log" ADD CONSTRAINT "asset_fuel_log_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_meter_reading" ADD CONSTRAINT "asset_meter_reading_asset_id_registered_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."registered_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_meter_reading" ADD CONSTRAINT "asset_meter_reading_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profile" ADD CONSTRAINT "driver_profile_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profile" ADD CONSTRAINT "driver_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_fuel_log_assetId_idx" ON "asset_fuel_log" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_meter_reading_assetId_idx" ON "asset_meter_reading" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "driver_profile_workspaceId_idx" ON "driver_profile" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "asset_trip" ADD CONSTRAINT "asset_trip_driver_id_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;