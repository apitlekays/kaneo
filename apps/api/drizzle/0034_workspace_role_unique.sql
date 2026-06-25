-- Remove duplicate workspace_role rows (two writers — Kaneo's seed and
-- Better Auth's dynamic access control — created divergent rows for the same
-- (workspace, role)). Keep the most-recently-updated row per group.
DELETE FROM "workspace_role" wr
WHERE wr.id NOT IN (
	SELECT DISTINCT ON (workspace_id, role) id
	FROM "workspace_role"
	ORDER BY workspace_id, role, updated_at DESC, id DESC
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'workspace_role_workspace_id_role_unique'
	) THEN
		ALTER TABLE "workspace_role"
			ADD CONSTRAINT "workspace_role_workspace_id_role_unique"
			UNIQUE ("workspace_id", "role");
	END IF;
END $$;
