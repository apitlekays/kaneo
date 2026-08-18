import { useEffect, useRef } from "react";
import type { PendingAssignment } from "@/fetchers/correspondence/letters";

export function newAssignmentIds(
  seen: Set<string>,
  pending: { id: string }[],
): string[] {
  return pending.filter((p) => !seen.has(p.id)).map((p) => p.id);
}

/**
 * Announces assignments the user has not seen. The seen set is seeded from the
 * first list received, so a page load or socket reconnect stays silent and only
 * genuinely new work interrupts anyone.
 */
export function useAssignmentAlerts(
  pending: PendingAssignment[] | undefined,
  onNew: (assignment: PendingAssignment) => void,
) {
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!pending) return;
    if (seen.current === null) {
      seen.current = new Set(pending.map((p) => p.id));
      return;
    }
    for (const id of newAssignmentIds(seen.current, pending)) {
      const item = pending.find((p) => p.id === id);
      seen.current.add(id);
      if (item) onNew(item);
    }
  }, [pending, onNew]);
}
