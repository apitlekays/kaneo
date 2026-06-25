import { useQuery } from "@tanstack/react-query";
import getMyTasks from "@/fetchers/task/get-my-tasks";

export function useMyTasks(workspaceId: string) {
  return useQuery({
    queryKey: ["my-tasks", workspaceId],
    queryFn: () => getMyTasks(workspaceId),
    enabled: !!workspaceId,
    refetchInterval: 30000,
  });
}
