CREATE TABLE "asset_cost" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"date" timestamp NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"amount" integer NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_file" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"object_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"kind" text DEFAULT 'document' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "asset_file_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "asset_maintenance" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"date" timestamp NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"cost" integer,
	"vendor" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_renewal" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"type" text DEFAULT 'other' NOT NULL,
	"label" text,
	"due_date" timestamp NOT NULL,
	"last_renewed_date" timestamp,
	"cost" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_trip" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"date" timestamp NOT NULL,
	"origin" text,
	"destination" text,
	"distance_km" integer,
	"purpose" text,
	"driver" text,
	"cost" integer,
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registered_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"serial_number" text NOT NULL,
	"asset_tag" text,
	"name" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"manufacturer" text,
	"model" text,
	"status" text DEFAULT 'active' NOT NULL,
	"location" text,
	"assigned_to" text,
	"registration_number" text,
	"purchase_date" timestamp,
	"purchase_cost" integer,
	"currency" text DEFAULT 'MYR' NOT NULL,
	"vendor" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "registered_asset_serial_unique" UNIQUE("workspace_id","serial_number")
);
--> statement-breakpoint
ALTER TABLE "asset_cost" ADD CONSTRAINT "asset_cost_asset_id_registered_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."registered_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_cost" ADD CONSTRAINT "asset_cost_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_file" ADD CONSTRAINT "asset_file_asset_id_registered_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."registered_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_file" ADD CONSTRAINT "asset_file_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_file" ADD CONSTRAINT "asset_file_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_maintenance" ADD CONSTRAINT "asset_maintenance_asset_id_registered_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."registered_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_maintenance" ADD CONSTRAINT "asset_maintenance_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_renewal" ADD CONSTRAINT "asset_renewal_asset_id_registered_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."registered_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_trip" ADD CONSTRAINT "asset_trip_asset_id_registered_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."registered_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_trip" ADD CONSTRAINT "asset_trip_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registered_asset" ADD CONSTRAINT "registered_asset_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registered_asset" ADD CONSTRAINT "registered_asset_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_cost_assetId_idx" ON "asset_cost" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_file_assetId_idx" ON "asset_file" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_maintenance_assetId_idx" ON "asset_maintenance" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_renewal_assetId_idx" ON "asset_renewal" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_renewal_dueDate_idx" ON "asset_renewal" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "asset_trip_assetId_idx" ON "asset_trip" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "registered_asset_workspaceId_idx" ON "registered_asset" USING btree ("workspace_id");