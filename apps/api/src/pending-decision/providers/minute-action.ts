import { and, desc, eq, notInArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { recordAuditEvent } from "../../correspondence/audit";
import { SEALED_LETTER_STATUSES } from "../../correspondence/letter-list-filter";
import {
  assertCanDecideMinute,
  minuteAfterDecision,
} from "../../correspondence/minute-decision";
import db from "../../database";
import { letterMinuteTable, letterTable } from "../../database/schema";
import createNotification from "../../notification/controllers/create-notification";
import type { PendingDecisionItem, PendingDecisionProvider } from "../types";

/** Row shape produced by the `list` query — kept beside its mapper so the
 * two stay in sync without a database round-trip in tests. */
type MinuteActionRow = {
  id: string;
  letterId: string;
  body: string;
  actionType: string | null;
  dueAt: Date | null;
  createdAt: Date;
  refNo: string | null;
  subject: string;
};

/** Pure row-to-item mapper, extracted so it can be tested without a database. */
export function toPendingItem(row: MinuteActionRow): PendingDecisionItem {
  return {
    source: "minute-action",
    id: row.id,
    title: row.refNo ?? row.subject,
    subtitle: row.subject,
    context: [
      row.actionType ? `${row.actionType}: ${row.body}` : row.body,
      ...(row.dueAt ? [`Due: ${row.dueAt.toISOString().slice(0, 10)}`] : []),
    ],
    // Must match the real route file:
    // apps/web/src/routes/.../dashboard/correspondence.$letterId.tsx
    href: `/dashboard/correspondence/${row.letterId}`,
    createdAt: row.createdAt,
    requiresReason: true,
  };
}

export const minuteActionProvider: PendingDecisionProvider = {
  source: "minute-action",

  async list(userId, workspaceId): Promise<PendingDecisionItem[]> {
    const rows = await db
      .select({
        id: letterMinuteTable.id,
        letterId: letterMinuteTable.letterId,
        body: letterMinuteTable.body,
        actionType: letterMinuteTable.actionType,
        dueAt: letterMinuteTable.dueAt,
        createdAt: letterMinuteTable.createdAt,
        refNo: letterTable.refNo,
        subject: letterTable.subject,
      })
      .from(letterMinuteTable)
      .innerJoin(letterTable, eq(letterMinuteTable.letterId, letterTable.id))
      .where(
        and(
          eq(letterTable.workspaceId, workspaceId),
          eq(letterMinuteTable.assigneeId, userId),
          eq(letterMinuteTable.acceptance, "pending"),
          // A sealed record cannot be accepted or rejected, so offering the
          // decision would present an item the user can never clear.
          notInArray(letterTable.status, [...SEALED_LETTER_STATUSES]),
        ),
      )
      .orderBy(desc(letterMinuteTable.createdAt));

    return rows.map(toPendingItem);
  },

  async decide({ userId, workspaceId, id, decision, reason, ip }) {
    // requiresReason: true above promises the client will always be asked
    // for one on rejection; enforce it here so a client that skips the
    // prompt (or a caller other than the web client) can't slip a
    // reasonless rejection into the audit log.
    if (decision === "rejected" && !reason?.trim()) {
      throw new HTTPException(400, {
        message: "A rejection must carry a reason",
      });
    }

    const [minute] = await db
      .select({
        id: letterMinuteTable.id,
        letterId: letterMinuteTable.letterId,
        authorId: letterMinuteTable.authorId,
        assigneeId: letterMinuteTable.assigneeId,
        acceptance: letterMinuteTable.acceptance,
        refNo: letterTable.refNo,
        subject: letterTable.subject,
      })
      .from(letterMinuteTable)
      .innerJoin(letterTable, eq(letterMinuteTable.letterId, letterTable.id))
      .where(
        and(
          eq(letterMinuteTable.id, id),
          eq(letterTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!minute) throw new HTTPException(404, { message: "Not found" });
    assertCanDecideMinute(minute, userId);

    const next = minuteAfterDecision(decision);

    await db.transaction(async (tx) => {
      // The `pending` predicate is the concurrency guard: the minute was read
      // outside this transaction, so a competing decision may have landed
      // since. Nothing else in here runs unless this update actually claims
      // the row.
      const decided = await tx
        .update(letterMinuteTable)
        .set({
          acceptance: next.acceptance,
          // "keep" means acceptance leaves the assignee where it is — only a
          // rejection (which resolves to null) actually rewrites the column.
          ...(next.assigneeId === "keep"
            ? {}
            : { assigneeId: next.assigneeId }),
          rejectionReason: decision === "rejected" ? reason : null,
        })
        .where(
          and(
            eq(letterMinuteTable.id, id),
            eq(letterMinuteTable.acceptance, "pending"),
          ),
        )
        .returning({ id: letterMinuteTable.id });
      if (decided.length === 0)
        throw new HTTPException(409, {
          message: "This action was already decided",
        });

      await recordAuditEvent(tx, {
        workspaceId,
        entityType: "letter",
        entityId: minute.letterId,
        action: decision === "accepted" ? "minute-accept" : "minute-reject",
        actorId: userId,
        before: {
          acceptance: minute.acceptance,
          assigneeId: minute.assigneeId,
        },
        after: {
          minuteId: id,
          acceptance: next.acceptance,
          assigneeId:
            next.assigneeId === "keep" ? minute.assigneeId : next.assigneeId,
          reason: decision === "rejected" ? reason : null,
        },
        ip,
      });
    });

    // A rejected action becomes unassigned rather than deleted — the officer
    // who delegated it is the one who needs to know it bounced back.
    if (decision === "rejected" && minute.authorId) {
      await createNotification({
        userId: minute.authorId,
        type: "letter_action_rejected",
        title: `Action declined — ${minute.refNo ?? minute.subject}`,
        content: reason,
        resourceId: minute.letterId,
        resourceType: "letter",
      }).catch(() => {});
    }
  },
};
