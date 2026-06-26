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
  // Proxy a Drive file's thumbnail. The browser can't fetch Google's
  // thumbnailLink directly (those hosts don't send CORS headers for a
  // credentialed cross-origin request), so the client hands us its short-lived
  // Drive token and we fetch the image server-side, where CORS doesn't apply,
  // and stream it back. The token is used transiently and never stored.
  .get(
    "/thumbnail/:fileId",
    validator("param", v.object({ fileId: v.string() })),
    async (c) => {
      const { fileId } = c.req.valid("param");
      const token = c.req.header("x-drive-token");
      if (!token) {
        throw new HTTPException(400, { message: "Missing Drive token" });
      }
      const size = Number.parseInt(c.req.query("size") ?? "400", 10) || 400;

      const metaResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          fileId,
        )}?fields=thumbnailLink&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!metaResponse.ok) {
        throw new HTTPException(404, { message: "Thumbnail unavailable" });
      }

      const meta = (await metaResponse.json()) as { thumbnailLink?: string };
      if (!meta.thumbnailLink) {
        throw new HTTPException(404, { message: "No thumbnail" });
      }

      // thumbnailLinks end with a size token like `=s220`; bump it for clarity.
      const link = meta.thumbnailLink.replace(/=s\d+$/, `=s${size}`);
      const imageResponse = await fetch(link, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const contentType = imageResponse.headers.get("content-type") ?? "";
      if (!imageResponse.ok || !contentType.startsWith("image/")) {
        throw new HTTPException(404, { message: "Thumbnail unavailable" });
      }

      const buffer = await imageResponse.arrayBuffer();
      return new Response(buffer, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "private, max-age=3600",
        },
      });
    },
  )
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
