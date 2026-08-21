import { HTTPException } from "hono/http-exception";

/**
 * Only the person holding the action may decide it, and only once. A second
 * decision is a 409 rather than a silent overwrite: two people racing the
 * dialog must not both believe they settled it.
 */
export function assertCanDecideMinute(
  minute: { assigneeId: string | null; acceptance: string },
  userId: string,
): void {
  if (!minute.assigneeId || minute.assigneeId !== userId)
    throw new HTTPException(403, {
      message: "Only the action's assignee can decide it",
    });
  if (minute.acceptance !== "pending")
    throw new HTTPException(409, {
      message: "This action was already decided",
    });
}

export function minuteAfterDecision(decision: "accepted" | "rejected"): {
  assigneeId: null | "keep";
  acceptance: string;
} {
  return decision === "accepted"
    ? { assigneeId: "keep", acceptance: "accepted" }
    : { assigneeId: null, acceptance: "rejected" };
}
