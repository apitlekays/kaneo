import { useMyCorrespondence } from "@/hooks/queries/correspondence/use-letters";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

/** Add a module here when it has work that awaits a user's decision. */
export type PendingActionSource = "correspondence";

export function pendingSources(
  counts: Record<PendingActionSource, number>,
): PendingActionSource[] {
  return (Object.keys(counts) as PendingActionSource[]).filter(
    (key) => counts[key] > 0,
  );
}

/**
 * "Something awaits your decision" — distinct from the notification bell,
 * which says "something happened". This clears when the user acts, not when
 * they read.
 */
export function usePendingActions() {
  const { data: workspace } = useActiveWorkspace();
  const { data: mine } = useMyCorrespondence(workspace?.id ?? "");

  const sources = pendingSources({
    correspondence: mine?.pendingAssignments?.length ?? 0,
  });
  return { sources, hasAny: sources.length > 0 };
}
