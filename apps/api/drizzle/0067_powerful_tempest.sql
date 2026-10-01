CREATE TABLE "asset_rental" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"renter_name" text NOT NULL,
	"renter_organisation" text,
	"renter_phone" text,
	"renter_email" text,
	"renter_id_number" text,
	"purpose" text,
	"start_at" timestamp NOT NULL,
	"due_at" timestamp,
	"returned_at" timestamp,
	"rate" integer,
	"rate_period" text,
	"deposit" integer,
	"deposit_returned" boolean DEFAULT false NOT NULL,
	"currency" text DEFAULT 'MYR' NOT NULL,
	"condition_out" text,
	"condition_in" text,
	"notes" text,
	"created_by" text,
	"returned_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_rental" ADD CONSTRAINT "asset_rental_asset_id_registered_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."registered_asset"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "asset_rental" ADD CONSTRAINT "asset_rental_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "asset_rental" ADD CONSTRAINT "asset_rental_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "asset_rental" ADD CONSTRAINT "asset_rental_returned_by_user_id_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "asset_rental_assetId_idx" ON "asset_rental" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_rental_workspaceId_idx" ON "asset_rental" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "asset_rental_dueAt_idx" ON "asset_rental" USING btree ("due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_rental_one_open_idx" ON "asset_rental" USING btree ("asset_id") WHERE "asset_rental"."returned_at" is null;