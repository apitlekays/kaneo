import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { workspacePageAccessTable } from "../database/schema";
import { isGlobalAdmin } from "./project-access";

/**
 * Whether a user may access a gateable workspace "page". Owner/global-admins
 * (and instance admins) bypass; everyone else needs an explicit grant row.
 */
export async function hasWorkspacePageAccess(
  userId: string,
  workspaceId: string,
  pageSlug: string,
): Promise<boolean> {
  if (await isGlobalAdmin(userId, workspaceId)) return true;
  const [row] = await db
    .select({ id: workspacePageAccessTable.id })
    .from(workspacePageAccessTable)
    .where(
      and(
        eq(workspacePageAccessTable.workspaceId, workspaceId),
        eq(workspacePageAccessTable.userId, userId),
        eq(workspacePageAccessTable.pageSlug, pageSlug),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Middleware that enforces page access. Must run AFTER a `workspaceAccess.*`
 * middleware (which validates membership and sets `workspaceId`).
 */
export function requireWorkspacePageAccess(pageSlug: string) {
  return async (c: Context, next: Next) => {
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");
    if (!workspaceId) {
      throw new HTTPException(400, { message: "workspaceId required" });
    }
    if (!(await hasWorkspacePageAccess(userId, workspaceId, pageSlug))) {
      throw new HTTPException(403, {
        message: "You don't have access to this page",
      });
    }
    return next();
  };
}
