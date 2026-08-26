/**
 * Who may read a meeting's minutes. A normal meeting is readable by anyone
 * who already holds the General Management page; a confidential one is
 * readable only by the people who were there, plus global admins.
 *
 * Deliberately pure: the routes compose it with the real lookups, and the
 * pending-decision provider applies the same rule so a confidential
 * meeting's title cannot leak through an action card.
 */
export function canReadMeeting(args: {
  confidential: boolean;
  attendeeUserIds: string[];
  userId: string;
  isGlobalAdmin: boolean;
}): boolean {
  if (!args.confidential) return true;
  if (args.isGlobalAdmin) return true;
  return args.attendeeUserIds.includes(args.userId);
}
