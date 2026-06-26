import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";

/**
 * Per-project access control.
 *
 * Visibility/access is project-scoped: only project members can access a
 * project's data. Workspace owners/admins (and instance admins) are "global
 * admins" who bypass project membership entirely.
 */

export async function isInstanceAdminUser(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: schema.userTable.role })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);
  return row?.role === "admin";
}

export async function getWorkspaceRole(
  userId: string,
  workspaceId: string,
): Promise<string | null> {
  const [member] = await db
    .select({ role: schema.workspaceUserTable.role })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.userId, userId),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return member?.role ?? null;
}

/** Workspace owner/admin (or instance admin) — sees and manages every project. */
export async function isGlobalAdmin(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const role = await getWorkspaceRole(userId, workspaceId);
  if (role === "owner" || role === "admin") return true;
  return isInstanceAdminUser(userId);
}

export async function getProjectRole(
  userId: string,
  projectId: string,
): Promise<string | null> {
  const [member] = await db
    .select({ role: schema.projectMemberTable.role })
    .from(schema.projectMemberTable)
    .where(
      and(
        eq(schema.projectMemberTable.userId, userId),
        eq(schema.projectMemberTable.projectId, projectId),
      ),
    )
    .limit(1);
  return member?.role ?? null;
}

/** Project ids the user is an explicit member of (within a workspace). */
export async function getMemberProjectIds(
  userId: string,
  workspaceId: string,
): Promise<string[]> {
  const rows = await db
    .select({ projectId: schema.projectMemberTable.projectId })
    .from(schema.projectMemberTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.projectMemberTable.projectId, schema.projectTable.id),
    )
    .where(
      and(
        eq(schema.projectMemberTable.userId, userId),
        eq(schema.projectTable.workspaceId, workspaceId),
      ),
    );
  return rows.map((r) => r.projectId);
}

export async function canAccessProject(
  userId: string,
  projectId: string,
  workspaceId: string,
): Promise<boolean> {
  if (await isGlobalAdmin(userId, workspaceId)) return true;
  return (await getProjectRole(userId, projectId)) !== null;
}

/** Creator/manager of the project, or a global admin. */
export async function canManageProjectMembers(
  userId: string,
  projectId: string,
  workspaceId: string,
): Promise<boolean> {
  if (await isGlobalAdmin(userId, workspaceId)) return true;
  return (await getProjectRole(userId, projectId)) === "manager";
}

/**
 * Middleware: require the current user to be able to access the project named
 * by `projectIdKey` (a route param). Run after `workspaceAccess.*`, which sets
 * `workspaceId` and validates workspace membership.
 */
export function requireProjectAccess(projectIdKey = "projectId") {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    const workspaceId = c.get("workspaceId");
    const projectId = c.req.param(projectIdKey);

    if (!userId || !workspaceId || !projectId) {
      throw new HTTPException(400, { message: "Missing project context" });
    }

    if (!(await canAccessProject(userId, projectId, workspaceId))) {
      throw new HTTPException(403, {
        message: "You don't have access to this project",
      });
    }

    return next();
  };
}
