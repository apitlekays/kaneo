import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CalendarDays,
  Clock,
  CornerDownRight,
  FileText,
  ListTree,
  Lock,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ColoredAvatar } from "@/components/ui/colored-avatar";
import { Input } from "@/components/ui/input";
import { type ProjectMomItem, saveTaskMom } from "@/fetchers/task-mom";
import useCreateTask from "@/hooks/mutations/task/use-create-task";
import useCreateTaskRelation from "@/hooks/mutations/task-relation/use-create-task-relation";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { useProjectMoms } from "@/hooks/queries/task-mom/use-task-mom";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";

type MinutesProps = {
  projectId: string;
  workspaceId: string;
};

type MemberInfo = { name: string; image: string | null };

export default function ProjectMinutes({
  projectId,
  workspaceId,
}: MinutesProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: moms = [], isLoading } = useProjectMoms(projectId);
  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(workspaceId);
  const { canManageCurrentProject } = useWorkspacePermission();
  const canManage = canManageCurrentProject();
  const createTask = useCreateTask();
  const createRelation = useCreateTaskRelation();
  const [query, setQuery] = useState("");
  const [converting, setConverting] = useState<string | null>(null);

  const memberById = useMemo(() => {
    const map = new Map<string, MemberInfo>();
    for (const m of workspaceUsers?.members ?? []) {
      map.set(m.userId, {
        name: m.user?.name ?? m.userId,
        image: m.user?.image ?? null,
      });
    }
    return map;
  }, [workspaceUsers]);

  // Ids of tasks sitting in a final ("done") column, so converted action
  // items that are complete can be struck through.
  const { data: projectData } = useGetTasks(projectId);
  const doneTaskIds = useMemo(() => {
    const done = new Set<string>();
    const columns =
      projectData && "columns" in projectData
        ? (projectData.columns as Array<{
            isFinal?: boolean;
            tasks?: { id: string }[];
          }>)
        : [];
    for (const col of columns) {
      if (col.isFinal) {
        for (const task of col.tasks ?? []) done.add(task.id);
      }
    }
    return done;
  }, [projectData]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return moms;
    return moms.filter((m) => m.taskTitle.toLowerCase().includes(q));
  }, [moms, query]);

  // Roll-up counts across every meeting in the project.
  const stats = useMemo(() => {
    let actions = 0;
    let linked = 0;
    for (const m of moms) {
      for (const row of m.data.rows ?? []) {
        if (!row.action.trim() && !row.agenda.trim()) continue;
        actions += 1;
        if (row.subtaskId) linked += 1;
      }
    }
    return { meetings: moms.length, actions, linked, open: actions - linked };
  }, [moms]);

  const handleConvert = async (item: ProjectMomItem, rowId: string) => {
    if (item.data.locked) return;
    const row = item.data.rows.find((r) => r.id === rowId);
    if (!row || row.subtaskId) return;
    setConverting(rowId);
    try {
      const title =
        row.action.trim() || row.agenda.trim() || t("tasks:mom.actionItem");
      const newTask = await createTask.mutateAsync({
        title,
        description: row.discussion.trim(),
        projectId,
        status: "to-do",
        priority: "no-priority",
        userId: row.taggedUserIds[0],
      });
      await createRelation.mutateAsync({
        sourceTaskId: item.taskId,
        targetTaskId: newTask.id,
        relationType: "subtask",
      });
      await saveTaskMom(item.taskId, {
        ...item.data,
        rows: item.data.rows.map((r) =>
          r.id === rowId ? { ...r, subtaskId: newTask.id } : r,
        ),
      });
      await queryClient.invalidateQueries({
        queryKey: ["project-moms", projectId],
      });
      toast.success(t("tasks:mom.convertedToast"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("tasks:mom.convertError"),
      );
    } finally {
      setConverting(null);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {t("common:loading", { defaultValue: "Loading…" })}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-6">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: t("minutes:stats.meetings"), value: stats.meetings },
          { label: t("minutes:stats.actionItems"), value: stats.actions },
          { label: t("minutes:stats.open"), value: stats.open },
          { label: t("minutes:stats.linked"), value: stats.linked },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border p-3">
            <div className="text-2xl font-semibold">{s.value}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("minutes:searchPlaceholder")}
          className="h-8 ps-8 text-sm"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <FileText className="mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{t("minutes:empty")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const actionRows = (item.data.rows ?? []).filter(
              (r) => r.action.trim() || r.agenda.trim(),
            );
            return (
              <div key={item.taskId} className="rounded-lg border">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b p-3">
                  <Link
                    to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
                    params={{ workspaceId, projectId, taskId: item.taskId }}
                    className="text-sm font-medium text-foreground hover:underline"
                  >
                    {item.taskNumber != null && (
                      <span className="me-1.5 font-mono text-xs text-muted-foreground">
                        #{item.taskNumber}
                      </span>
                    )}
                    {item.taskTitle}
                  </Link>
                  {item.data.locked && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                      title={t("tasks:mom.locked")}
                    >
                      <Lock className="h-3 w-3" />
                      {t("tasks:mom.locked")}
                    </span>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {item.data.date && (
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="h-3 w-3" />
                        {item.data.date}
                      </span>
                    )}
                    {item.data.time && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {item.data.time}
                      </span>
                    )}
                  </div>
                  {item.data.attendees.length > 0 && (
                    <div className="ms-auto flex items-center -space-x-1.5">
                      {item.data.attendees.slice(0, 6).map((p) => (
                        <ColoredAvatar
                          key={p.id}
                          name={p.name}
                          image={
                            p.userId ? memberById.get(p.userId)?.image : null
                          }
                          seed={p.userId ?? p.name}
                          className="h-5 w-5 border border-background"
                          fallbackClassName="text-[8px]"
                        />
                      ))}
                      {item.data.attendees.length > 6 && (
                        <span className="ps-2 text-[11px] text-muted-foreground">
                          +{item.data.attendees.length - 6}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {actionRows.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground">
                    {t("minutes:noActionItems")}
                  </div>
                ) : (
                  <ul className="divide-y divide-border/40">
                    {actionRows.map((row) => {
                      const tagged = row.taggedUserIds[0];
                      const taggedInfo = tagged
                        ? memberById.get(tagged)
                        : undefined;
                      const subtaskDone = row.subtaskId
                        ? doneTaskIds.has(row.subtaskId)
                        : false;
                      const label = row.action.trim() || row.agenda.trim();
                      return (
                        <li
                          key={row.id}
                          className="flex items-start gap-3 px-3 py-2 text-xs"
                        >
                          <span className="min-w-0 flex-1">
                            {row.subtaskId ? (
                              <Link
                                to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
                                params={{
                                  workspaceId,
                                  projectId,
                                  taskId: row.subtaskId,
                                }}
                                className={cn(
                                  "text-foreground hover:underline",
                                  subtaskDone &&
                                    "text-muted-foreground line-through",
                                )}
                              >
                                {label}
                              </Link>
                            ) : (
                              <span className="text-foreground">{label}</span>
                            )}
                          </span>
                          {tagged && (
                            <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
                              <ColoredAvatar
                                name={taggedInfo?.name ?? tagged}
                                image={taggedInfo?.image}
                                seed={tagged}
                                className="h-4 w-4"
                                fallbackClassName="text-[8px]"
                              />
                              {taggedInfo?.name ?? ""}
                            </span>
                          )}
                          {row.subtaskId ? (
                            <Link
                              to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
                              params={{
                                workspaceId,
                                projectId,
                                taskId: row.subtaskId,
                              }}
                              className="inline-flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground"
                            >
                              <CornerDownRight className="h-3 w-3" />
                              {subtaskDone
                                ? t("minutes:doneStatus")
                                : t("tasks:mom.linkedSubtask")}
                            </Link>
                          ) : canManage && !item.data.locked ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 shrink-0 gap-1 px-1.5 text-[11px] text-muted-foreground"
                              disabled={converting === row.id}
                              onClick={() => handleConvert(item, row.id)}
                            >
                              <ListTree className="h-3 w-3" />
                              {t("tasks:mom.convertToSubtask")}
                            </Button>
                          ) : (
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {t("minutes:openStatus")}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
