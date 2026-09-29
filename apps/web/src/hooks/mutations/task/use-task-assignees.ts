import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addTaskAssignee,
  removeTaskAssignee,
  setTaskLead,
} from "@/fetchers/task/task-assignees";

type Variables = { taskId: string; projectId: string; userId: string };

/**
 * Everything an assignee change can move: the task and its board, subtask
 * rows, My tasks, and — for an offer — the offeree's pending decisions.
 */
function useInvalidateAssignees() {
  const queryClient = useQueryClient();
  return ({ taskId, projectId }: Variables) => {
    for (const queryKey of [
      ["task", taskId],
      ["tasks", projectId],
      ["task-relations"],
      ["my-tasks"],
      ["pending-decisions"],
      ["activities", taskId],
      ["notifications"],
    ]) {
      queryClient.invalidateQueries({ queryKey });
    }
  };
}

export function useAddTaskAssignee() {
  const invalidate = useInvalidateAssignees();
  return useMutation({
    mutationFn: ({ taskId, userId }: Variables) =>
      addTaskAssignee(taskId, userId),
    onSuccess: (_, variables) => invalidate(variables),
  });
}

export function useRemoveTaskAssignee() {
  const invalidate = useInvalidateAssignees();
  return useMutation({
    mutationFn: ({ taskId, userId }: Variables) =>
      removeTaskAssignee(taskId, userId),
    onSuccess: (_, variables) => invalidate(variables),
  });
}

export function useSetTaskLead() {
  const invalidate = useInvalidateAssignees();
  return useMutation({
    mutationFn: ({ taskId, userId }: Variables) => setTaskLead(taskId, userId),
    onSuccess: (_, variables) => invalidate(variables),
  });
}
