import { useQuery } from "@tanstack/react-query";
import getTasks from "@/fetchers/task/get-tasks";

export function useGetTasks(projectId: string) {
  return useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => getTasks(projectId),
    refetchInterval: 30000,
    enabled: !!projectId,
    // Don't retry (with backoff) when the project is locked — surface the
    // "no access" state immediately instead of after several retries.
    retry: (failureCount, error) => {
      if (
        error instanceof Error &&
        /access to this project/i.test(error.message)
      ) {
        return false;
      }
      return failureCount < 2;
    },
  });
}
