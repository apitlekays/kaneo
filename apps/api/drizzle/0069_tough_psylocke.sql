CREATE TABLE "gm_medium" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gm_medium_ws_key_unique" UNIQUE("workspace_id","key")
);
--> statement-breakpoint
ALTER TABLE "gm_medium" ADD CONSTRAINT "gm_medium_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gm_medium_workspaceId_idx" ON "gm_medium" USING btree ("workspace_id");--> statement-breakpoint
-- Seed the four mediums letters already use into every existing workspace,
-- in the order the capture form has always shown them. Keys must match the
-- values stored on letters (see DEFAULT_GM_MEDIUMS).
INSERT INTO "gm_medium" ("id", "workspace_id", "key", "label", "created_at")
SELECT md5(w."id" || 'medium-' || m.key), w."id", m.key, m.label, now() + (m.ord * interval '1 millisecond')
FROM "workspace" w
CROSS JOIN (VALUES ('email', 'Email', 0), ('physical', 'Physical', 1), ('hand', 'By hand', 2), ('portal', 'Portal', 3)) AS m(key, label, ord)
ON CONFLICT ("workspace_id", "key") DO NOTHING;
