import { and, desc, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  meetingActionTable,
  meetingAttendeeTable,
  meetingTable,
} from "../../database/schema";
import { canReadMeeting } from "../../meeting/access";
import {
  actionAfterDecision,
  assertCanDecideAction,
} from "../../meeting/action-rules";
import createNotification from "../../notification/controllers/create-notification";
import { isGlobalAdmin } from "../../utils/project-access";
import type { PendingDecisionItem, PendingDecisionProvider } from "../types";

/** Row shape produced by the `list` query — kept beside its mapper so the
 * two stay in sync without a database round-trip in tests. */
type MeetingActionRow = {
  id: string;
  meetingId: string;
  meetingTitle: string;
  description: string;
  dueAt: Date | null;
  createdAt: Date;
};

/**
 * Pure row-to-item mapper, extracted so it can be tested without a database.
 * `workspaceId` isn't a column on the action/meeting join — it's the
 * caller's context — so it's threaded through as a second argument (as
 * `taskProvider`'s mapper does), even though this item's href doesn't need
 * it: there is no meeting-detail route yet, so every action links to the
 * General Management page rather than a specific meeting.
 */
export function toPendingItem(
  row: MeetingActionRow,
  _workspaceId: string,
): PendingDecisionItem {
  return {
    source: "meeting-action",
    id: row.id,
    title: row.meetingTitle,
    subtitle: row.description,
    context: [
      row.description,
      ...(row.dueAt ? [`Due: ${row.dueAt.toISOString().slice(0, 10)}`] : []),
    ],
    // Must match the real route file:
    // apps/web/src/routes/_layout/_authenticated/dashboard/category/general-management.tsx
    href: "/dashboard/category/general-management",
    createdAt: row.createdAt,
    requiresReason: true,
  };
}

export const meetingActionProvider: PendingDecisionProvider = {
  source: "meeting-action",

  async list(userId, workspaceId): Promise<PendingDecisionItem[]> {
    const rows = await db
      .select({
        id: meetingActionTable.id,
        meetingId: meetingActionTable.meetingId,
        description: meetingActionTable.description,
        dueAt: meetingActionTable.dueAt,
        createdAt: meetingActionTable.createdAt,
        meetingTitle: meetingTable.title,
        confidential: meetingTable.confidential,
      })
      .from(meetingActionTable)
      .innerJoin(
        meetingTable,
        eq(meetingActionTable.meetingId, meetingTable.id),
      )
      .where(
        and(
          eq(meetingTable.workspaceId, workspaceId),
          eq(meetingActionTable.assigneeId, userId),
          eq(meetingActionTable.acceptance, "pending"),
        ),
      )
      .orderBy(desc(meetingActionTable.createdAt));

    if (rows.length === 0) return [];

    // Confidentiality is decided per meeting, not per action: a confidential
    // meeting's title (and everything else about it) must not reach anyone
    // who isn't an attendee or a global admin — including through this
    // provider, which is otherwise the easiest place to forget the check.
    const meetingIds = [...new Set(rows.map((r) => r.meetingId))];
    const attendeeRows = await db
      .select({
        meetingId: meetingAttendeeTable.meetingId,
        userId: meetingAttendeeTable.userId,
      })
      .from(meetingAttendeeTable)
      .where(inArray(meetingAttendeeTable.meetingId, meetingIds));
    const attendeesByMeeting = new Map<string, string[]>();
    for (const r of attendeeRows) {
      if (!r.userId) continue;
      const list = attendeesByMeeting.get(r.meetingId) ?? [];
      list.push(r.userId);
      attendeesByMeeting.set(r.meetingId, list);
    }

    const admin = await isGlobalAdmin(userId, workspaceId);

    const visible = rows.filter((row) =>
      canReadMeeting({
        confidential: row.confidential,
        attendeeUserIds: attendeesByMeeting.get(row.meetingId) ?? [],
        userId,
        isGlobalAdmin: admin,
      }),
    );

    return visible.map((row) => toPendingItem(row, workspaceId));
  },

  async decide({ userId, workspaceId, id, decision, reason }) {
    // requiresReason: true above promises the client will always be asked
    // for one on rejection; enforce it here so a client that skips the
    // prompt (or a caller other than the web client) can't slip a
    // reasonless rejection into the record.
    if (decision === "rejected" && !reason?.trim()) {
      throw new HTTPException(400, {
        message: "A rejection must carry a reason",
      });
    }

    const [action] = await db
      .select({
        id: meetingActionTable.id,
        meetingId: meetingActionTable.meetingId,
        assigneeId: meetingActionTable.assigneeId,
        fromUserId: meetingActionTable.fromUserId,
        acceptance: meetingActionTable.acceptance,
        meetingTitle: meetingTable.title,
      })
      .from(meetingActionTable)
      .innerJoin(
        meetingTable,
        eq(meetingActionTable.meetingId, meetingTable.id),
      )
      .where(
        and(
          eq(meetingActionTable.id, id),
          eq(meetingTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!action) throw new HTTPException(404, { message: "Not found" });
    assertCanDecideAction(action, userId);

    const next = actionAfterDecision(decision, action.assigneeId);

    // The `pending` predicate is the concurrency guard: the action was read
    // outside this update, so a competing decision may have landed since.
    // A caller who lost that race gets told (409), not a silent success.
    const decided = await db
      .update(meetingActionTable)
      .set({
        acceptance: next.acceptance,
        assigneeId: next.assigneeId,
        rejectionReason: decision === "rejected" ? reason : null,
      })
      .where(
        and(
          eq(meetingActionTable.id, id),
          eq(meetingActionTable.acceptance, "pending"),
        ),
      )
      .returning({ id: meetingActionTable.id });
    if (decided.length === 0)
      throw new HTTPException(409, {
        message: "This action was already decided",
      });

    // A rejected action becomes unassigned rather than deleted — minutes are
    // a historical document, so the action stays on the meeting's record.
    // Only the person who delegated it is told, and only when there is one
    // to tell: a grandfathered row with no recorded delegator notifies
    // nobody rather than inventing one.
    if (decision === "rejected" && action.fromUserId) {
      await createNotification({
        userId: action.fromUserId,
        type: "meeting_action_rejected",
        title: `Action declined — ${action.meetingTitle}`,
        content: reason,
        resourceId: action.meetingId,
        resourceType: "meeting",
      }).catch(() => {});
    }
  },
};
