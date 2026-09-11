/**
 * Who may post a progress update on a meeting action.
 *
 * Mirrors `canPostMinuteUpdate` (correspondence/minute-access.ts): holding
 * the General Management page is enough, because the secretariat chases
 * actions it does not own; otherwise only the assignee may speak for their
 * own work.
 *
 * Deliberately pure — the route composes it with the real lookups, so the
 * rule can be tested without a database and cannot drift between callers.
 */
export function canPostActionUpdate(args: {
  userId: string;
  hasPageAccess: boolean;
  actionAssigneeId: string | null;
}): boolean {
  if (args.hasPageAccess) return true;
  return (
    args.actionAssigneeId !== null && args.actionAssigneeId === args.userId
  );
}
