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

export function taskAssigneeAfterDecision(
  decision: "accepted" | "rejected",
  toUserId: string | null,
): string | null {
  return decision === "accepted" ? toUserId : null;
}
