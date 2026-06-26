-- The legacy workspace "admin" role becomes the dedicated "global-admin" role.
-- Existing admin members are migrated; the global-admin workspace_role rows are
-- (re)created by seedDefaultWorkspaceRoles on boot (runs after this migration).
UPDATE "workspace_member" SET "role" = 'global-admin' WHERE "role" = 'admin';
