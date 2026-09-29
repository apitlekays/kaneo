import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { taskTable } from "../database/schema";
import { type DbOrTx, replaceAssignees } from "./assignees-write";

export type AssignmentWriteStatus = "no-op" | "offered" | "applied";

export type AssignmentWriteResult = {
  status: AssignmentWriteStatus;
  // The task row with the new userId, present only when status is
  // "applied" (the lead changed or was re-confirmed). Callers keep using
  // their own existing task reference for "no-op" and "offered".
  task: typeof taskTable.$inferSelect | null;
};

/**
 * Applies a single-value assignment ("make this person the assignee")
 * inside the caller's transaction. This is what the assignee PUT, the full
 * task PUT, bulk clear and import mean; see `replaceAssignees` in
 * assignees-write.ts for the exact rules.
 *
 * - Assigning to someone other than the caller only *offers* the task:
 *   a `pending` exclusive assignment row is inserted and the people on the
 *   task stay until it is accepted.
 * - Self-assignment and clearing take effect immediately.
 * - Every other offer still awaiting a decision is superseded.
 *
 * `existingAssigneeId` is accepted for the callers' convenience but no
 * longer decides anything: the task's people are read inside the
 * transaction, which is the only source that cannot be stale.
 */
export async function writeTaskAssignment(
  tx: DbOrTx,
  {
    taskId,
    nextAssigneeId,
    currentUserId,
  }: {
    taskId: string;
    existingAssigneeId: string | null;
    nextAssigneeId: string | null;
    currentUserId: string;
  },
): Promise<AssignmentWriteResult> {
  const status = await replaceAssignees(tx, {
    taskId,
    nextAssigneeId,
    currentUserId,
  });

  if (status !== "applied") return { status, task: null };

  const [task] = await tx
    .select()
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .limit(1);
  if (!task) {
    throw new HTTPException(500, {
      message: "Failed to update task assignee",
    });
  }
  return { status, task };
}
