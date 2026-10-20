ALTER TABLE "project" ADD COLUMN "kind" text DEFAULT 'project' NOT NULL;--> statement-breakpoint
CREATE INDEX "project_workspace_kind_idx" ON "project" USING btree ("workspace_id","kind");