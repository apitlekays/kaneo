import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono-openapi";
import * as v from "valibot";
import db from "../database";
import {
  projectMemberTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";
import {
  canAccessProject,
  canManageProjectMembers,
} from "../utils/project-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";

const projectMember = new Hono<{
  Variables: { userId: string; workspaceId?: string };
}>()
  // List a project's members. Visible to anyone who can access the project.
  .get(
    "/:projectId",
    validator("param", v.object({ projectId: v.string() })),
    workspaceAccess.fromProject("projectId"),
    async (c) => {
      const { projectId } = c.req.valid("param");
      const userId = c.get("userId");
      const workspaceId = c.get("workspaceId");

      if (
        !workspaceId ||
        !(await canAccessProject(userId, projectId, workspaceId))
      ) {
        throw new HTTPException(403, {
          message: "You don't have access to this project",
        });
      }

      const members = await db
        .select({
          userId: projectMemberTable.userId,
          role: projectMemberTable.role,
          name: userTable.name,
          email: userTable.email,
          image: userTable.image,
        })
        .from(projectMemberTable)
        .innerJoin(userTable, eq(projectMemberTable.userId, userTable.id))
        .where(eq(projectMemberTable.projectId, projectId));

      return c.json(members);
    },
  )
  // Add (or update the role of) a project member. Managers + global admins.
  .post(
    "/:projectId",
    validator("param", v.object({ projectId: v.string() })),
    validator(
      "json",
      v.object({
        userId: v.string(),
        role: v.optional(v.picklist(["manager", "member"])),
      }),
    ),
    workspaceAccess.fromProject("projectId"),
    async (c) => {
      const { projectId } = c.req.valid("param");
      const { userId: targetUserId, role } = c.req.valid("json");
      const userId = c.get("userId");
      const workspaceId = c.get("workspaceId");

      if (
        !workspaceId ||
        !(await canManageProjectMembers(userId, projectId, workspaceId))
      ) {
        throw new HTTPException(403, {
          message: "You can't manage this project's members",
        });
      }

      // Only workspace members can be added to a project.
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
        throw new HTTPException(400, {
          message: "User is not a member of this workspace",
        });
      }

      await db
        .insert(projectMemberTable)
        .values({ projectId, userId: targetUserId, role: role ?? "member" })
        .onConflictDoUpdate({
          target: [projectMemberTable.projectId, projectMemberTable.userId],
          set: { role: role ?? "member" },
        });

      return c.json({ success: true });
    },
  )
  // Remove a project member. Managers + global admins.
  .delete(
    "/:projectId/:userId",
    validator("param", v.object({ projectId: v.string(), userId: v.string() })),
    workspaceAccess.fromProject("projectId"),
    async (c) => {
      const { projectId, userId: targetUserId } = c.req.valid("param");
      const userId = c.get("userId");
      const workspaceId = c.get("workspaceId");

      if (
        !workspaceId ||
        !(await canManageProjectMembers(userId, projectId, workspaceId))
      ) {
        throw new HTTPException(403, {
          message: "You can't manage this project's members",
        });
      }

      await db
        .delete(projectMemberTable)
        .where(
          and(
            eq(projectMemberTable.projectId, projectId),
            eq(projectMemberTable.userId, targetUserId),
          ),
        );

      return c.json({ success: true });
    },
  );

export default projectMember;
