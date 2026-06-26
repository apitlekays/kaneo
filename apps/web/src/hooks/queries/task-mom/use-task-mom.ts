import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getTaskMom, type MomData, saveTaskMom } from "@/fetchers/task-mom";

export function useTaskMom(taskId: string) {
  return useQuery({
    queryKey: ["task-mom", taskId],
    queryFn: () => getTaskMom(taskId),
    enabled: !!taskId,
  });
}

export function useSaveTaskMom(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: MomData) => saveTaskMom(taskId, data),
    onSuccess: (saved) => {
      queryClient.setQueryData(["task-mom", taskId], saved);
    },
  });
}
