import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getProjectMoms,
  getTaskMom,
  type MomData,
  saveTaskMom,
} from "@/fetchers/task-mom";

export function useTaskMom(taskId: string) {
  return useQuery({
    queryKey: ["task-mom", taskId],
    queryFn: () => getTaskMom(taskId),
    enabled: !!taskId,
  });
}

export function useProjectMoms(projectId: string) {
  return useQuery({
    queryKey: ["project-moms", projectId],
    queryFn: () => getProjectMoms(projectId),
    enabled: !!projectId,
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
