CREATE TABLE "asset_audit_scan" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"asset_id" text,
	"scanned_serial" text NOT NULL,
	"status" text DEFAULT 'found' NOT NULL,
	"location_id" text,
	"scanned_by" text,
	"scanned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_audit_session" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"started_by" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "asset_location" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"type" text DEFAULT 'room' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "registered_asset" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "asset_audit_scan" ADD CONSTRAINT "asset_audit_scan_session_id_asset_audit_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."asset_audit_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_audit_scan" ADD CONSTRAINT "asset_audit_scan_asset_id_registered_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."registered_asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_audit_scan" ADD CONSTRAINT "asset_audit_scan_scanned_by_user_id_fk" FOREIGN KEY ("scanned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_audit_session" ADD CONSTRAINT "asset_audit_session_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_audit_session" ADD CONSTRAINT "asset_audit_session_started_by_user_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_location" ADD CONSTRAINT "asset_location_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_audit_scan_sessionId_idx" ON "asset_audit_scan" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "asset_audit_session_workspaceId_idx" ON "asset_audit_session" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "asset_location_workspaceId_idx" ON "asset_location" USING btree ("workspace_id");