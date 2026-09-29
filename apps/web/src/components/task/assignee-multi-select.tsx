import { Check, Crown, Minus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ColoredAvatar } from "@/components/ui/colored-avatar";
import { PendingAssigneeBadge } from "@/components/ui/pending-assignee-badge";
import { ShortcutNumber } from "@/components/ui/shortcut-number";
import {
  useAddTaskAssignee,
  useRemoveTaskAssignee,
  useSetTaskLead,
} from "@/hooks/mutations/task/use-task-assignees";
import { useUpdateTaskAssignee } from "@/hooks/mutations/task/use-update-task-assignee";
import { useProjectMembers } from "@/hooks/queries/project-member/use-project-members";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useNumberedShortcuts } from "@/hooks/use-numbered-shortcuts";
import { cn } from "@/lib/cn";
import { taskPeople } from "@/lib/task-assignees";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

const INITIAL_VISIBLE_USERS = 40;
const VISIBLE_USERS_STEP = 40;

/** Where one person stands across the task(s) being edited. */
type PersonState = {
  /** On every task. */
  all: boolean;
  /** On some but not all (only possible when editing several tasks). */
  some: boolean;
  /** Offered every task and still deciding. */
  pending: boolean;
  isLead: boolean;
};

type AssigneeMultiSelectProps = {
  /** One task, or several selected subtasks edited together. */
  tasks: Task[];
  workspaceId: string;
  open: boolean;
};

/**
 * The assignee list inside the task and subtask popovers. Clicking a
 * person toggles them: adding offers the task (or applies at once for
 * yourself), clicking someone already on it or already offered it takes
 * them off. The list stays open so several people can be picked in a row.
 * "Make lead" is offered for accepted people when one task is edited.
 */
export function AssigneeMultiSelect({
  tasks,
  workspaceId,
  open,
}: AssigneeMultiSelectProps) {
  const { t } = useTranslation();
  const [visibleUsersCount, setVisibleUsersCount] = useState(
    INITIAL_VISIBLE_USERS,
  );
  const { mutateAsync: addAssignee } = useAddTaskAssignee();
  const { mutateAsync: removeAssignee } = useRemoveTaskAssignee();
  const { mutateAsync: setLead } = useSetTaskLead();
  const { mutateAsync: updateTaskAssignee } = useUpdateTaskAssignee();
  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(workspaceId);
  const { data: projectMembers = [] } = useProjectMembers(
    tasks[0]?.projectId ?? "",
  );

  // Only project members can be assigned (the API enforces this too).
  const projectMemberIds = useMemo(
    () => new Set(projectMembers.map((member) => member.userId)),
    [projectMembers],
  );

  const usersOptions = useMemo(
    () =>
      workspaceUsers?.members
        ?.filter((member) => projectMemberIds.has(member.userId))
        .map((member) => ({
          value: member.userId,
          name: member?.user?.name ?? member.userId,
          image: member?.user?.image ?? "",
        })) ?? [],
    [workspaceUsers, projectMemberIds],
  );

  const peoplePerTask = useMemo(() => tasks.map(taskPeople), [tasks]);

  const stateOf = useCallback(
    (userId: string): PersonState => {
      const onCount = peoplePerTask.filter((p) =>
        p.assignees.some((a) => a.userId === userId),
      ).length;
      const pendingCount = peoplePerTask.filter((p) =>
        p.pending.some((o) => o.userId === userId),
      ).length;
      return {
        all: onCount > 0 && onCount === tasks.length,
        some: onCount > 0 && onCount < tasks.length,
        pending: pendingCount > 0 && pendingCount === tasks.length,
        isLead:
          tasks.length === 1 &&
          !!peoplePerTask[0]?.assignees.some(
            (a) => a.userId === userId && a.isLead,
          ),
      };
    },
    [peoplePerTask, tasks.length],
  );

  const nobodyAnywhere = peoplePerTask.every(
    (p) => p.assignees.length === 0 && p.pending.length === 0,
  );

  const run = useCallback(
    async (work: () => Promise<unknown>, errorKey: string) => {
      try {
        await work();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t(errorKey));
      }
    },
    [t],
  );

  const toggle = useCallback(
    (userId: string) => {
      const state = stateOf(userId);
      const takeOff = state.all || state.pending;
      return run(
        () =>
          Promise.all(
            tasks.map((task) => {
              const vars = {
                taskId: task.id,
                projectId: task.projectId,
                userId,
              };
              return takeOff ? removeAssignee(vars) : addAssignee(vars);
            }),
          ),
        takeOff ? "tasks:assignee.removeError" : "tasks:assignee.addError",
      );
    },
    [addAssignee, removeAssignee, run, stateOf, tasks],
  );

  const clearAll = useCallback(
    () =>
      run(
        () =>
          Promise.all(
            tasks.map((task) => updateTaskAssignee({ ...task, userId: "" })),
          ),
        "tasks:popover.assignee.updateError",
      ),
    [run, tasks, updateTaskAssignee],
  );

  const makeLead = useCallback(
    (userId: string) => {
      const task = tasks[0];
      if (!task) return;
      return run(
        () => setLead({ taskId: task.id, projectId: task.projectId, userId }),
        "tasks:assignee.leadError",
      );
    },
    [run, setLead, tasks],
  );

  const shortcutOptions = useMemo(
    () => [
      { onSelect: () => void clearAll() },
      ...usersOptions.slice(0, 8).map((user) => ({
        onSelect: () => void toggle(user.value),
      })),
    ],
    [usersOptions, clearAll, toggle],
  );
  useNumberedShortcuts(open, shortcutOptions);

  const handleListScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      const nearBottom =
        target.scrollHeight - target.scrollTop - target.clientHeight < 48;
      if (!nearBottom) return;
      setVisibleUsersCount((current) =>
        Math.min(current + VISIBLE_USERS_STEP, usersOptions.length),
      );
    },
    [usersOptions.length],
  );

  return (
    <div
      className="max-h-80 space-y-1 overflow-y-auto p-1"
      onScroll={handleListScroll}
    >
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-full justify-start gap-2 px-2"
        onClick={() => void clearAll()}
      >
        <div
          className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-muted"
          title={t("tasks:popover.assignee.unassigned")}
        >
          <span className="font-medium text-[10px] text-muted-foreground">
            ?
          </span>
        </div>
        <span className="text-sm">
          {t("tasks:popover.assignee.unassigned")}
        </span>
        {nobodyAnywhere ? (
          <Check className="ml-auto h-4 w-4" />
        ) : (
          <ShortcutNumber number={1} />
        )}
      </Button>

      {usersOptions.slice(0, visibleUsersCount).map((user, index) => {
        const state = stateOf(user.value);
        const canMakeLead = tasks.length === 1 && state.all && !state.isLead;
        return (
          <div key={user.value} className="group flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 min-w-0 flex-1 justify-start gap-2 px-2"
              onClick={() => void toggle(user.value)}
              aria-pressed={state.all || state.pending}
              title={
                state.all
                  ? t("tasks:assignee.remove")
                  : state.pending
                    ? t("tasks:assignee.withdraw")
                    : undefined
              }
            >
              {state.pending ? (
                <PendingAssigneeBadge
                  name={user.name}
                  className="h-6 w-6"
                  iconClassName="h-3 w-3"
                />
              ) : (
                <ColoredAvatar
                  name={user.name}
                  image={user.image}
                  seed={user.value}
                  className={cn(
                    "h-6 w-6 border border-border/30",
                    state.isLead && "ring-2 ring-primary/60",
                  )}
                  fallbackClassName="text-xs"
                />
              )}
              <span className="truncate text-sm">{user.name}</span>
              {state.isLead && (
                <span className="rounded bg-primary/10 px-1 text-[10px] font-medium text-primary">
                  {t("tasks:assignee.leadBadge")}
                </span>
              )}
              {state.all ? (
                <Check className="ml-auto h-4 w-4 shrink-0" />
              ) : state.some ? (
                <Minus className="ml-auto h-4 w-4 shrink-0" />
              ) : state.pending ? null : index < 8 ? (
                <ShortcutNumber number={index + 2} />
              ) : null}
            </Button>
            {canMakeLead && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 shrink-0 p-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                onClick={() => void makeLead(user.value)}
                title={t("tasks:assignee.makeLead")}
                aria-label={`${t("tasks:assignee.makeLead")}: ${user.name}`}
              >
                <Crown className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default AssigneeMultiSelect;
