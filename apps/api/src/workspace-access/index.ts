import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono-openapi";
import * as v from "valibot";
import db from "../database";
import {
  workspacePageAccessTable,
  workspaceUserTable,
} from "../database/schema";
import { isGlobalAdmin } from "../utils/project-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";

/**
 * Canonical list of gateable "page" slugs (the business-domain sub-categories
 * in the sidebar). MUST stay in sync with the slugs in
 * apps/web/src/lib/sidebar-categories.ts. Home and Projects are always
 * available and are intentionally NOT gateable.
 */
export const ACCESS_PAGE_SLUGS = [
  "general-management",
  "human-resources",
  "legal-compliances",
  "information-technology",
  "assets-management",
  "marketing",
  "sales",
  "customer-service",
  "finance-accounting",
] as const;

const pageSlugSchema = v.picklist(ACCESS_PAGE_SLUGS);

const workspaceAccessApi = new Hono<{
  Variables: { userId: string; workspaceId?: string };
}>()
  // The current user's accessible page slugs. Any workspace member may call
  // this (it only reveals their own access). Owner/global-admins get every
  // page since they bypass the matrix.
  .get(
    "/:workspaceId/me",
    validator("param", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromParam("workspaceId"),
    async (c) => {
      const workspaceId = c.get("workspaceId");
      const userId = c.get("userId");
      if (!workspaceId) {
        throw new HTTPException(400, { message: "workspaceId required" });
      }

      if (await isGlobalAdmin(userId, workspaceId)) {
        return c.json({ pages: [...ACCESS_PAGE_SLUGS], isAdmin: true });
      }

      const rows = await db
        .select({ pageSlug: workspacePageAccessTable.pageSlug })
        .from(workspacePageAccessTable)
        .where(
          and(
            eq(workspacePageAccessTable.workspaceId, workspaceId),
            eq(workspacePageAccessTable.userId, userId),
          ),
        );

      return c.json({ pages: rows.map((row) => row.pageSlug), isAdmin: false });
    },
  )
  // The full access matrix (every member's granted slugs). Owner/global-admins
  // only — this is what powers the settings table.
  .get(
    "/:workspaceId",
    validator("param", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromParam("workspaceId"),
    async (c) => {
      const workspaceId = c.get("workspaceId");
      const userId = c.get("userId");
      if (!workspaceId) {
        throw new HTTPException(400, { message: "workspaceId required" });
      }
      if (!(await isGlobalAdmin(userId, workspaceId))) {
        throw new HTTPException(403, {
          message: "Only workspace admins can view access settings",
        });
      }

      const grants = await db
        .select({
          userId: workspacePageAccessTable.userId,
          pageSlug: workspacePageAccessTable.pageSlug,
        })
        .from(workspacePageAccessTable)
        .where(eq(workspacePageAccessTable.workspaceId, workspaceId));

      return c.json({ grants });
    },
  )
  // Toggle a single matrix cell. Owner/global-admins only.
  .put(
    "/:workspaceId",
    validator("param", v.object({ workspaceId: v.string() })),
    validator(
      "json",
      v.object({
        userId: v.string(),
        pageSlug: pageSlugSchema,
        allowed: v.boolean(),
      }),
    ),
    workspaceAccess.fromParam("workspaceId"),
    async (c) => {
      const workspaceId = c.get("workspaceId");
      const actorId = c.get("userId");
      if (!workspaceId) {
        throw new HTTPException(400, { message: "workspaceId required" });
      }
      if (!(await isGlobalAdmin(actorId, workspaceId))) {
        throw new HTTPException(403, {
          message: "Only workspace admins can edit access",
        });
      }

      const { userId: targetUserId, pageSlug, allowed } = c.req.valid("json");

      const [member] = await db
        .select({ id: workspaceUserTable.id })
        .from(workspaceUserTable)
        .where(
          and(
            eq(workspaceUserTable.workspaceId, workspaceId),
            eq(workspaceUserTable.userId, targetUserId),
          ),
        )
        .limit(1);
      if (!member) {
        throw new HTTPException(404, {
          message: "User is not a member of this workspace",
        });
      }

      if (allowed) {
        await db
          .insert(workspacePageAccessTable)
          .values({ workspaceId, userId: targetUserId, pageSlug })
          .onConflictDoNothing();
      } else {
        await db
          .delete(workspacePageAccessTable)
          .where(
            and(
              eq(workspacePageAccessTable.workspaceId, workspaceId),
              eq(workspacePageAccessTable.userId, targetUserId),
              eq(workspacePageAccessTable.pageSlug, pageSlug),
            ),
          );
      }

      return c.json({ success: true });
    },
  );

export default workspaceAccessApi;
