import { HTTPException } from "hono/http-exception";

export type AssignmentDecision = "accepted" | "rejected";

/** A handover is two-sided: only the named recipient may answer, and only once. */
export function assertCanDecide(
  assignment: { toUserId: string | null; status: string },
  userId: string,
): void {
  if (assignment.toUserId !== userId) {
    throw new HTTPException(403, {
      message: "Only the assigned recipient can accept or reject this letter",
    });
  }
  if (assignment.status !== "pending") {
    throw new HTTPException(409, {
      message: `This assignment was already ${assignment.status}`,
    });
  }
}

/** Accept moves the letter to the recipient; reject returns it to the sender. */
export function ownerAfterDecision(
  assignment: { toUserId: string | null; fromUserId: string | null },
  decision: AssignmentDecision,
): string | null {
  return decision === "accepted" ? assignment.toUserId : assignment.fromUserId;
}
