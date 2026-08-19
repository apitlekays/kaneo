CREATE TABLE "gm_organisation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gm_organisation_ws_key_unique" UNIQUE("workspace_id","key")
);
--> statement-breakpoint
ALTER TABLE "letter" ADD COLUMN "external_ref_no" text;--> statement-breakpoint
ALTER TABLE "letter" ADD COLUMN "urgency" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "letter" ADD COLUMN "organisation_id" text;--> statement-breakpoint
ALTER TABLE "gm_organisation" ADD CONSTRAINT "gm_organisation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gm_organisation_workspaceId_idx" ON "gm_organisation" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "letter" ADD CONSTRAINT "letter_organisation_id_gm_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."gm_organisation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "letter_ws_ern_idx" ON "letter" USING btree ("workspace_id","external_ref_no");
--> statement-breakpoint
-- Seed the group's four entities into every existing workspace. New
-- workspaces start empty, like every other gm_* config table.
INSERT INTO "gm_organisation" ("id", "workspace_id", "key", "label")
SELECT
  md5(w."id" || o."key")::text,
  w."id",
  o."key",
  o."label"
FROM "workspace" w
CROSS JOIN (VALUES
  ('mapim-malaysia', 'MAPIM Malaysia'),
  ('ummahprima', 'UmmahPrima Sdn Bhd'),
  ('stagemaster', 'StageMaster Sdn Bhd'),
  ('ladangummah', 'LadangUmmah Sdn Bhd')
) AS o("key", "label")
ON CONFLICT ("workspace_id", "key") DO NOTHING;
--> statement-breakpoint
-- Every letter already in the register predates the other three companies,
-- so MAPIM Malaysia is the accurate owner rather than an invented one.
-- Deliberately scoped to NULLs so a re-run cannot overwrite a hand-set value.
-- Recorded here rather than as per-letter audit events: this is a bulk
-- classification applied by migration, not an action any user took.
UPDATE "letter" l
SET "organisation_id" = o."id"
FROM "gm_organisation" o
WHERE o."workspace_id" = l."workspace_id"
  AND o."key" = 'mapim-malaysia'
  AND l."organisation_id" IS NULL;
