CREATE TABLE "asset_disposal" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"date" timestamp NOT NULL,
	"method" text DEFAULT 'sold' NOT NULL,
	"proceeds" integer,
	"reason" text,
	"approved_by" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "asset_disposal_asset_id_unique" UNIQUE("asset_id")
);
--> statement-breakpoint
ALTER TABLE "registered_asset" ADD COLUMN "depreciation_method" text DEFAULT 'straight-line' NOT NULL;--> statement-breakpoint
ALTER TABLE "registered_asset" ADD COLUMN "useful_life_months" integer;--> statement-breakpoint
ALTER TABLE "registered_asset" ADD COLUMN "salvage_value" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "registered_asset" ADD COLUMN "in_service_date" timestamp;--> statement-breakpoint
ALTER TABLE "asset_disposal" ADD CONSTRAINT "asset_disposal_asset_id_registered_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."registered_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_disposal" ADD CONSTRAINT "asset_disposal_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_disposal" ADD CONSTRAINT "asset_disposal_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_disposal_assetId_idx" ON "asset_disposal" USING btree ("asset_id");