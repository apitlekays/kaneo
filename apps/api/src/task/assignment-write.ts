import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type db from "../database";
import { taskAssignmentTable, taskTable } from "../database/schema";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AssignmentWriteStatus = "no-op" | "offered" | "applied";

export type AssignmentWriteResult = {
  status: AssignmentWriteStatus;
  // The task row with the new userId, present only when status is
  // "applied" (this function wrote taskTable.userId). Callers keep using
  // their own existing task reference for "no-op" and "offered".
  task: typeof taskTable.$inferSelect | null;
};

/**
 * Applies an assignment change to a task inside the caller's transaction.
 *
 * - Assigning to someone other than the caller only *offers* the task:
 *   a `pending` assignment row is inserted and task.userId is left alone.
 * - Self-assignment and clearing take effect immediately: task.userId is
 *   written, and self-assignment also inserts an `accepted` row.
 * - Any assignment still awaiting a decision for this task is superseded
 *   before the new one takes effect, so there is always at most one live
 *   `pending` row per task.
 *
 * A change is only a true no-op (nothing written, nothing superseded) when
 * the assignee value would not change AND there is no live `pending`
 * assignment for the task. A same-value "reassignment" while a pending
 * offer exists to someone else is NOT a no-op: the offer must still be
 * superseded, because the task is effectively being reclaimed/reconfirmed
 * by its current owner (or re-cleared) out from under that offer.
 */
export async function writeTaskAssignment(
  tx: DbOrTx,
  {
    taskId,
    existingAssigneeId,
    nextAssigneeId,
    currentUserId,
  }: {
    taskId: string;
    existingAssigneeId: string | null;
    nextAssigneeId: string | null;
    currentUserId: string;
  },
): Promise<AssignmentWriteResult> {
  const isSameAssignee = existingAssigneeId === nextAssigneeId;

  if (isSameAssignee) {
    const [livePending] = await tx
      .select({ id: taskAssignmentTable.id })
      .from(taskAssignmentTable)
      .where(
        and(
          eq(taskAssignmentTable.taskId, taskId),
          eq(taskAssignmentTable.status, "pending"),
        ),
      )
      .limit(1);

    if (!livePending) {
      return { status: "no-op", task: null };
    }
    // Fall through: nothing changes about task.userId's target value, but a
    // live offer to someone else must still be retired below.
  }

  // Exactly one live prompt per task: retire any assignment still awaiting
  // a decision before this change takes effect.
  await tx
    .update(taskAssignmentTable)
    .set({ status: "superseded", decidedAt: new Date() })
    .where(
      and(
        eq(taskAssignmentTable.taskId, taskId),
        eq(taskAssignmentTable.status, "pending"),
      ),
    );

  const isSelfAssignment = nextAssigneeId === currentUserId;
  const isOffer = nextAssigneeId !== null && !isSelfAssignment;

  if (isOffer) {
    await tx.insert(taskAssignmentTable).values({
      taskId,
      fromUserId: currentUserId,
      toUserId: nextAssigneeId,
      status: "pending",
    });

    // The task is not theirs yet - that is the whole feature.
    return { status: "offered", task: null };
  }

  const [updatedTask] = await tx
    .update(taskTable)
    .set({ userId: nextAssigneeId })
    .where(eq(taskTable.id, taskId))
    .returning();

  if (!updatedTask) {
    throw new HTTPException(500, {
      message: "Failed to update task assignee",
    });
  }

  if (isSelfAssignment) {
    await tx.insert(taskAssignmentTable).values({
      taskId,
      fromUserId: currentUserId,
      toUserId: nextAssigneeId,
      status: "accepted",
      decidedAt: new Date(),
    });
  }

  return { status: "applied", task: updatedTask };
}
