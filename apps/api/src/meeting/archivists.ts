import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { meetingArchivistTable } from "../database/schema";
import { isGlobalAdmin } from "../utils/project-access";

export const ARCHIVED_STATUS = "archived";

export async function isArchivist(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: meetingArchivistTable.id })
    .from(meetingArchivistTable)
    .where(
      and(
        eq(meetingArchivistTable.workspaceId, workspaceId),
        eq(meetingArchivistTable.userId, userId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Who may upload, edit and remove Past Minutes: archivists and global admins. */
export async function canManageArchive(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  if (await isGlobalAdmin(userId, workspaceId)) return true;
  return isArchivist(userId, workspaceId);
}

export async function assertCanManageArchive(
  userId: string,
  workspaceId: string,
): Promise<void> {
  if (!(await canManageArchive(userId, workspaceId)))
    throw new HTTPException(403, {
      message:
        "Only minutes archivists and global admins can manage Past Minutes",
    });
}
