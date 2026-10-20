import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/fetchers/project-finance";
import { toast } from "@/lib/toast";

export function useProjectDetails(projectId: string) {
  return useQuery({
    queryKey: ["project-details", projectId],
    queryFn: () => api.getProjectDetails(projectId),
    enabled: !!projectId,
  });
}

export function useUpdateProjectDetails(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof api.updateProjectDetails>[1]) =>
      api.updateProjectDetails(projectId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["project-details", projectId],
      });
      // The settings page and project lists show the description too.
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Couldn't save the details",
      ),
  });
}

export function useTaskCosts(taskId: string) {
  return useQuery({
    queryKey: ["task-costs", taskId],
    queryFn: () => api.listTaskCosts(taskId),
    enabled: !!taskId,
  });
}

/** Any cost change: the task's list and its project's expenditure. */
export function useTaskCostMutations(taskId: string, projectId: string) {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["task-costs", taskId] });
    queryClient.invalidateQueries({
      queryKey: ["project-details", projectId],
    });
  };
  const onError = (fallback: string) => (error: unknown) =>
    toast.error(error instanceof Error ? error.message : fallback);
  return {
    create: useMutation({
      mutationFn: (body: api.TaskCostInput) => api.createTaskCost(taskId, body),
      onSuccess: refresh,
      onError: onError("Couldn't add the cost"),
    }),
    update: useMutation({
      mutationFn: ({
        costId,
        body,
      }: {
        costId: string;
        body: Partial<api.TaskCostInput>;
      }) => api.updateTaskCost(taskId, costId, body),
      onSuccess: refresh,
      onError: onError("Couldn't update the cost"),
    }),
    remove: useMutation({
      mutationFn: (costId: string) => api.deleteTaskCost(taskId, costId),
      onSuccess: refresh,
      onError: onError("Couldn't delete the cost"),
    }),
  };
}
