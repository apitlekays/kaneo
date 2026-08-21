/**
 * Who may add to a minute's update thread: the person the action belongs to,
 * or a general-management officer. A minute with no assignee is a plain note
 * rather than delegated work, so only an officer may add to it.
 */
export function canPostMinuteUpdate(args: {
  userId: string;
  hasPageAccess: boolean;
  minuteAssigneeId: string | null;
}): boolean {
  if (args.hasPageAccess) return true;
  return (
    args.minuteAssigneeId !== null && args.minuteAssigneeId === args.userId
  );
}
