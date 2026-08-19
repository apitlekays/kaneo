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
    // Three surfaces show the same fact — the dialog, the sidebar dot, and the
    // Home card. Leaving any of them stale makes them disagree out loud.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["pending-decisions", workspaceId] });
      qc.invalidateQueries({ queryKey: ["awaiting-acceptance", workspaceId] });
      qc.invalidateQueries({ queryKey: ["my-correspondence", workspaceId] });
    },
  });
}
