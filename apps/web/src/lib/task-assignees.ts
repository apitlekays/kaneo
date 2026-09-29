import type { TaskAssignee, TaskPendingAssignee } from "@/types/task";

type TaskLike = {
  userId: string | null;
  assigneeName?: string | null;
  assigneeImage?: string | null;
  pendingAssigneeName?: string | null;
  assignees?: TaskAssignee[];
  pendingAssignees?: TaskPendingAssignee[];
};

/**
 * Everyone on a task (lead first) and everyone it is offered to.
 *
 * Tasks from the API carry `assignees` / `pendingAssignees`. A task built
 * locally or cached from before multi-assignee only has the single-value
 * fields, so fall back to those rather than rendering it as unassigned.
 */
export function taskPeople(task: TaskLike): {
  assignees: TaskAssignee[];
  pending: TaskPendingAssignee[];
} {
  const assignees =
    task.assignees ??
    (task.userId
      ? [
          {
            userId: task.userId,
            name: task.assigneeName ?? null,
            image: task.assigneeImage ?? null,
            isLead: true,
          },
        ]
      : []);
  const pending =
    task.pendingAssignees ??
    (task.pendingAssigneeName
      ? [{ userId: "", name: task.pendingAssigneeName }]
      : []);
  return { assignees, pending };
}

/** True when the user is on the task, as lead or alongside others. */
export function isTaskAssignee(task: TaskLike, userId: string): boolean {
  return taskPeople(task).assignees.some((a) => a.userId === userId);
}

/**
 * One-line text for an assignee button: the lead (or first person offered
 * it) plus how many others, e.g. "Aisyah +2".
 */
export function assigneeSummary(
  people: ReturnType<typeof taskPeople>,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const [first, ...rest] = people.assignees;
  if (first) {
    const others = rest.length + people.pending.length;
    return others > 0 ? `${first.name ?? ""} +${others}` : (first.name ?? "");
  }
  const [firstPending, ...restPending] = people.pending;
  if (firstPending) {
    const awaiting = t("tasks:popover.assignee.awaiting", {
      name: firstPending.name ?? "",
    });
    return restPending.length > 0
      ? `${awaiting} +${restPending.length}`
      : awaiting;
  }
  return t("tasks:popover.assignee.unassigned");
}

/**
 * Whether a task passes an assignee filter: it does when anyone on it is
 * one of the chosen people. An empty id stands for "Unassigned" and
 * matches a task nobody has accepted.
 */
export function matchesAssigneeFilter(
  task: TaskLike,
  selectedIds: string[],
): boolean {
  const { assignees } = taskPeople(task);
  if (assignees.length === 0) return selectedIds.includes("");
  return assignees.some((a) => selectedIds.includes(a.userId));
}
