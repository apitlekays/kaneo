import { HTTPException } from "hono/http-exception";

/**
 * Only the person holding the action may decide it, and only once. A second
 * decision is a 409 rather than a silent overwrite.
 */
export function assertCanDecideAction(
  action: { assigneeId: string | null; acceptance: string },
  userId: string,
): void {
  if (!action.assigneeId || action.assigneeId !== userId)
    throw new HTTPException(403, {
      message: "Only the action's assignee can decide it",
    });
  if (action.acceptance !== "pending")
    throw new HTTPException(409, {
      message: "This action was already decided",
    });
}

export function actionAfterDecision(
  decision: "accepted" | "rejected",
  assigneeId: string | null,
): { assigneeId: string | null; acceptance: string } {
  return decision === "accepted"
    ? { assigneeId, acceptance: "accepted" }
    : { assigneeId: null, acceptance: "rejected" };
}

/**
 * Adoption authority. A standalone meeting has no body, so nobody holds a
 * body role on it and only a global admin can adopt.
 */
export function canAdoptMeeting(args: {
  isGlobalAdmin: boolean;
  bodyRole: string | null;
}): boolean {
  if (args.isGlobalAdmin) return true;
  return args.bodyRole === "chair" || args.bodyRole === "secretary";
}
