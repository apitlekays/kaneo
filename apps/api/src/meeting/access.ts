import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { meetingAttendeeTable, meetingTable } from "../database/schema";
import { isGlobalAdmin } from "../utils/project-access";

/**
 * Who may read a meeting's minutes. A normal meeting is readable by anyone
 * who already holds the General Management page; a confidential one is
 * readable only by the people who were there, plus global admins.
 *
 * Deliberately pure: the routes compose it with the real lookups, and the
 * pending-decision provider applies the same rule so a confidential
 * meeting's title cannot leak through an action card.
 */
export function canReadMeeting(args: {
  confidential: boolean;
  attendeeUserIds: string[];
  userId: string;
  isGlobalAdmin: boolean;
}): boolean {
  if (!args.confidential) return true;
  if (args.isGlobalAdmin) return true;
  return args.attendeeUserIds.includes(args.userId);
}

/**
 * Moved out of `meeting/index.ts` (which does not export its internals) so
 * that other route modules in this package — e.g. `action-updates.ts` — can
 * compose the same read-access rule without a dependency-injection layer.
 * `index.ts` re-uses these via import rather than redefining them.
 */
export async function loadMeeting(workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(meetingTable)
    .where(
      and(eq(meetingTable.id, id), eq(meetingTable.workspaceId, workspaceId)),
    )
    .limit(1);
  return row ?? null;
}

export async function loadAttendeeUserIds(
  meetingId: string,
): Promise<string[]> {
  const rows = await db
    .select({ userId: meetingAttendeeTable.userId })
    .from(meetingAttendeeTable)
    .where(eq(meetingAttendeeTable.meetingId, meetingId));
  return rows.map((r) => r.userId).filter((id): id is string => Boolean(id));
}

/**
 * Every read route composes this: a refusal throws 403. Callers must have
 * already resolved the meeting from the caller's own workspace (a mismatch
 * is a 404, not a 403 — see `loadMeeting`).
 */
export async function assertCanReadMeeting(
  userId: string,
  workspaceId: string,
  meeting: { confidential: boolean; id: string },
): Promise<void> {
  const attendeeUserIds = await loadAttendeeUserIds(meeting.id);
  const admin = await isGlobalAdmin(userId, workspaceId);
  if (
    !canReadMeeting({
      confidential: meeting.confidential,
      attendeeUserIds,
      userId,
      isGlobalAdmin: admin,
    })
  )
    throw new HTTPException(403, {
      message: "You don't have access to this meeting",
    });
}
