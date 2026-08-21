import { HTTPException } from "hono/http-exception";

/** Only the person the task was offered to may decide it, and only once. */
export function assertCanDecideTask(
  assignment: { toUserId: string | null; status: string },
  userId: string,
): void {
  if (!assignment.toUserId || assignment.toUserId !== userId)
    throw new HTTPException(403, {
      message: "Only the assignee can decide this task",
    });
  if (assignment.status !== "pending")
    throw new HTTPException(409, {
      message: "This assignment was already decided",
    });
}

/**
 * Computes the assignee a task should have once a pending offer is decided.
 *
 * - Accepting transfers the task to the recipient outright, regardless of
 *   who (if anyone) held it while the offer was pending.
 * - Rejecting leaves the task exactly as it was before the offer: an
 *   incumbent who already held the task keeps it (they declined nothing),
 *   and a task that was unassigned while the offer was pending stays
 *   unassigned. `currentAssigneeId` must be task.userId as it stood
 *   immediately before this decision -- an offer never writes task.userId
 *   (see assignment-write.ts), so that value is always the correct one to
 *   preserve on reject.
 */
export function taskAssigneeAfterDecision(
  decision: "accepted" | "rejected",
  toUserId: string | null,
  currentAssigneeId: string | null,
): string | null {
  return decision === "accepted" ? toUserId : currentAssigneeId;
}
