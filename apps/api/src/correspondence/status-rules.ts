import { HTTPException } from "hono/http-exception";

/**
 * Handling statuses the current assignee (Main User) may set on their own
 * letter. Everything else in the lifecycle — registration, classification,
 * archival — is a records-custodian act and stays with GM officers.
 */
export const ASSIGNEE_STATUSES = [
  "in-action",
  "awaiting-response",
  "closed",
] as const;

export type AssigneeStatus = (typeof ASSIGNEE_STATUSES)[number];

/**
 * Split authority over `POST /letters/:id/status`: GM page-holders drive the
 * whole lifecycle; the Main User drives only the handling of their own letter.
 */
export function assertStatusChangeAllowed({
  status,
  hasPageAccess,
  isCurrentAssignee,
}: {
  status: string;
  hasPageAccess: boolean;
  isCurrentAssignee: boolean;
}) {
  if (hasPageAccess) return;
  if (!isCurrentAssignee) {
    throw new HTTPException(403, {
      message:
        "Only a GM officer or the letter's Main User can change its status",
    });
  }
  if (!ASSIGNEE_STATUSES.includes(status as AssigneeStatus)) {
    throw new HTTPException(403, {
      message:
        "The Main User may only set in-action, awaiting-response or closed",
    });
  }
}

/**
 * Records integrity: a letter cannot be closed while delegated actions are
 * still outstanding, or the file would close over unfinished work.
 */
export function assertNoOpenActions(openActionCount: number) {
  if (openActionCount > 0) {
    throw new HTTPException(409, {
      message: `Cannot close: ${openActionCount} delegated action(s) still open`,
    });
  }
}

/**
 * The `closedAt` to persist for a status change. Stamped on the first close and
 * preserved if closed is re-applied (the retention clock runs from this date,
 * so it must not restart); cleared when a closed letter is reopened.
 */
export function resolveClosedAt({
  status,
  previousStatus,
  previousClosedAt,
  now,
}: {
  status: string;
  previousStatus: string;
  previousClosedAt: Date | null;
  now: Date;
}): Date | null {
  if (status === "closed") return previousClosedAt ?? now;
  if (previousStatus === "closed") return null;
  return previousClosedAt;
}
