export const GLOBAL_ADMIN_ROLE = "global-admin";

/**
 * What a member's role and remembered-role become when the Global Admin
 * toggle is flipped, or `null` when the request changes nothing.
 *
 * The no-op case is load-bearing: promoting an already-promoted member
 * would otherwise record "global-admin" as their previous role, and the
 * demotion that followed would hand it straight back.
 */
export function nextRoleForGlobalAdmin(args: {
  currentRole: string;
  previousRole: string | null;
  enabled: boolean;
}): { role: string; previousRole: string | null } | null {
  const isGlobalAdmin = args.currentRole === GLOBAL_ADMIN_ROLE;
  if (args.enabled === isGlobalAdmin) return null;
  return args.enabled
    ? { role: GLOBAL_ADMIN_ROLE, previousRole: args.currentRole }
    : { role: args.previousRole ?? "member", previousRole: null };
}
