import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono-openapi";
import * as v from "valibot";
import db from "../database";
import {
  projectTable,
  taskDriveAttachmentTable,
  taskTable,
} from "../database/schema";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";

const driveAttachment = new Hono<{
  Variables: { userId: string; workspaceId?: string };
}>()
  .get(
    "/:taskId",
    validator("param", v.object({ taskId: v.string() })),
    workspaceAccess.fromTaskId("taskId"),
    async (c) => {
      const { taskId } = c.req.valid("param");
      const rows = await db
        .select()
        .from(taskDriveAttachmentTable)
        .where(eq(taskDriveAttachmentTable.taskId, taskId))
        .orderBy(asc(taskDriveAttachmentTable.createdAt));
      return c.json(rows);
    },
  )
  .post(
    "/:taskId",
    validator("param", v.object({ taskId: v.string() })),
    validator(
      "json",
      v.object({
        fileId: v.string(),
        name: v.string(),
        url: v.string(),
        iconUrl: v.optional(v.nullable(v.string())),
        mimeType: v.optional(v.nullable(v.string())),
      }),
    ),
    workspaceAccess.fromTaskId("taskId"),
    requireWorkspacePermission({ task: ["update"] }),
    async (c) => {
      const { taskId } = c.req.valid("param");
      const body = c.req.valid("json");
      const userId = c.get("userId");

      const [row] = await db
        .insert(taskDriveAttachmentTable)
        .values({
          taskId,
          userId,
          fileId: body.fileId,
          name: body.name,
          url: body.url,
          iconUrl: body.iconUrl ?? null,
          mimeType: body.mimeType ?? null,
        })
        .onConflictDoNothing()
        .returning();

      if (row) return c.json(row);

      // Already attached — return the existing row.
      const [existing] = await db
        .select()
        .from(taskDriveAttachmentTable)
        .where(
          and(
            eq(taskDriveAttachmentTable.taskId, taskId),
            eq(taskDriveAttachmentTable.fileId, body.fileId),
          ),
        )
        .limit(1);
      return c.json(existing);
    },
  )
  .delete(
    "/:id",
    validator("param", v.object({ id: v.string() })),
    async (c) => {
      const { id } = c.req.valid("param");
      const userId = c.get("userId");

      const [attachment] = await db
        .select({
          id: taskDriveAttachmentTable.id,
          workspaceId: projectTable.workspaceId,
        })
        .from(taskDriveAttachmentTable)
        .innerJoin(taskTable, eq(taskDriveAttachmentTable.taskId, taskTable.id))
        .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
        .where(eq(taskDriveAttachmentTable.id, id))
        .limit(1);

      if (!attachment) {
        throw new HTTPException(404, { message: "Attachment not found" });
      }

      await validateWorkspaceAccess(userId, attachment.workspaceId);
      // Surface the workspace for the post-mutation realtime broadcast.
      c.set("workspaceId", attachment.workspaceId);

      await db
        .delete(taskDriveAttachmentTable)
        .where(eq(taskDriveAttachmentTable.id, id));

      return c.json({ success: true });
    },
  );

export default driveAttachment;
