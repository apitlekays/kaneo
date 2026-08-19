import { useMutation, useQueryClient } from "@tanstack/react-query";
import { decidePending } from "@/fetchers/pending-decision";

export function useDecidePending(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      source: string;
      id: string;
      decision: "accepted" | "rejected";
      reason: string | null;
    }) => decidePending({ workspaceId, ...args }),
    // Several surfaces show the same fact — the dialog, the sidebar dot, the
    // Home card, and (for correspondence) the letters list/summary/detail the
    // old accept/reject path also refreshes. Leaving any of them stale makes
    // them disagree out loud — e.g. a letter page still rendering a live
    // Accept button after the dialog already resolved the decision.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["pending-decisions", workspaceId] });
      qc.invalidateQueries({ queryKey: ["awaiting-acceptance", workspaceId] });
      qc.invalidateQueries({ queryKey: ["my-correspondence", workspaceId] });
      qc.invalidateQueries({ queryKey: ["letters", workspaceId] });
      qc.invalidateQueries({
        queryKey: ["correspondence-summary", workspaceId],
      });
      // The item id doesn't decode to a letter id here, so invalidate the
      // whole ["letter", workspaceId] prefix rather than a specific letter —
      // TanStack Query matches by prefix, and this still catches any open
      // letter detail page.
      qc.invalidateQueries({ queryKey: ["letter", workspaceId] });
    },
  });
}
