import { useQuery } from "@tanstack/react-query";
import { getPendingDecisions } from "@/fetchers/pending-decision";

export function usePendingDecisions(workspaceId: string) {
  return useQuery({
    queryKey: ["pending-decisions", workspaceId],
    queryFn: () => getPendingDecisions(workspaceId),
    enabled: Boolean(workspaceId),
  });
}
