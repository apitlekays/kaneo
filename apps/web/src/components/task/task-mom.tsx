import {
  CalendarDays,
  Check,
  Clock,
  CornerDownRight,
  ListTree,
  Lock,
  LockOpen,
  Plus,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ColoredAvatar } from "@/components/ui/colored-avatar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  emptyMomData,
  type MomData,
  type MomPerson,
  type MomRow,
} from "@/fetchers/task-mom";
import useCreateTask from "@/hooks/mutations/task/use-create-task";
import useCreateTaskRelation from "@/hooks/mutations/task-relation/use-create-task-relation";
import { useProjectMembers } from "@/hooks/queries/project-member/use-project-members";
import {
  useSaveTaskMom,
  useTaskMom,
} from "@/hooks/queries/task-mom/use-task-mom";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { toast } from "@/lib/toast";

type SimpleMember = { userId: string; name: string; image: string | null };

function uid() {
  return crypto.randomUUID();
}

/** Chips + add-popover for Attendees / Absentees (workspace members or free text). */
function PeopleEditor({
  label,
  people,
  members,
  onChange,
  readOnly = false,
}: {
  label: string;
  people: MomPerson[];
  members: SimpleMember[];
  onChange: (next: MomPerson[]) => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = members.filter((m) =>
    m.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const add = (person: MomPerson) => {
    onChange([...people, person]);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {readOnly && people.length === 0 && (
        <span className="text-xs text-muted-foreground/70">—</span>
      )}
      {people.map((person) => (
        <span
          key={person.id}
          className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 py-0.5 pe-1 ps-0.5 text-xs"
        >
          <ColoredAvatar
            name={person.name}
            seed={person.userId ?? person.name}
            className="h-4 w-4"
            fallbackClassName="text-[8px]"
          />
          <span className="max-w-[10rem] truncate">{person.name}</span>
          {!readOnly && (
            <button
              type="button"
              onClick={() => onChange(people.filter((p) => p.id !== person.id))}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {readOnly ? null : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 gap-1 rounded-full px-2 text-xs text-muted-foreground"
              />
            }
          >
            <Plus className="h-3 w-3" />
            {t("tasks:mom.add")}
          </PopoverTrigger>
          <PopoverContent className="w-60 p-2" align="start">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("tasks:mom.searchOrType")}
              className="mb-2 h-7 text-xs"
            />
            <div className="max-h-52 overflow-y-auto">
              {filtered.map((m) => (
                <button
                  key={m.userId}
                  type="button"
                  onClick={() =>
                    add({ id: uid(), userId: m.userId, name: m.name })
                  }
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent"
                >
                  <ColoredAvatar
                    name={m.name}
                    image={m.image}
                    seed={m.userId}
                    className="h-5 w-5"
                    fallbackClassName="text-[9px]"
                  />
                  <span className="truncate">{m.name}</span>
                </button>
              ))}
              {query.trim() && (
                <button
                  type="button"
                  onClick={() =>
                    add({ id: uid(), userId: null, name: query.trim() })
                  }
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-accent"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("tasks:mom.addFreeText", { name: query.trim() })}
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/** Popover picker to tag a single project member on an action item. */
function MemberTagPicker({
  selectedIds,
  members,
  onToggle,
}: {
  selectedIds: string[];
  members: SimpleMember[];
  onToggle: (userId: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
            title={t("tasks:mom.tagPerson")}
          />
        }
      >
        <UserPlus className="h-3 w-3" />
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="end">
        <div className="max-h-52 overflow-y-auto">
          {members.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("tasks:mom.noMembers")}
            </div>
          ) : (
            members.map((m) => {
              const checked = selectedIds.includes(m.userId);
              return (
                <button
                  key={m.userId}
                  type="button"
                  onClick={() => {
                    onToggle(m.userId);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent"
                >
                  <ColoredAvatar
                    name={m.name}
                    image={m.image}
                    seed={m.userId}
                    className="h-5 w-5"
                    fallbackClassName="text-[9px]"
                  />
                  <span className="flex-1 truncate">{m.name}</span>
                  {checked && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function TaskMom({
  taskId,
  projectId,
  workspaceId,
}: {
  taskId: string;
  projectId: string;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const { data: serverMom } = useTaskMom(taskId);
  const saveMom = useSaveTaskMom(taskId);
  const { data: projectMembers = [] } = useProjectMembers(projectId);
  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(workspaceId);
  const createTask = useCreateTask();
  const createRelation = useCreateTaskRelation();

  const [data, setData] = useState<MomData | null>(null);
  const seededRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seed local state once from the server document.
  useEffect(() => {
    if (seededRef.current || serverMom === undefined) return;
    seededRef.current = true;
    setData(serverMom?.data ?? emptyMomData());
  }, [serverMom]);

  const tagMembers: SimpleMember[] = useMemo(
    () =>
      projectMembers.map((m) => ({
        userId: m.userId,
        name: m.name,
        image: m.image,
      })),
    [projectMembers],
  );
  const tagMemberIds = useMemo(
    () => new Set(tagMembers.map((m) => m.userId)),
    [tagMembers],
  );
  const peopleMembers: SimpleMember[] = useMemo(
    () =>
      (workspaceUsers?.members ?? []).map(
        (m: { userId: string; user?: { name?: string; image?: string } }) => ({
          userId: m.userId,
          name: m.user?.name ?? m.userId,
          image: m.user?.image ?? null,
        }),
      ),
    [workspaceUsers],
  );
  const memberName = useCallback(
    (userId: string) =>
      tagMembers.find((m) => m.userId === userId)?.name ??
      peopleMembers.find((m) => m.userId === userId)?.name ??
      userId,
    [tagMembers, peopleMembers],
  );

  const commit = useCallback(
    (next: MomData) => {
      setData(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveMom.mutate(next);
      }, 800);
    },
    [saveMom],
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  if (!data) return null;

  const locked = data.locked ?? false;
  const patch = (partial: Partial<MomData>) => commit({ ...data, ...partial });
  const updateRow = (rowId: string, partial: Partial<MomRow>) =>
    patch({
      rows: data.rows.map((r) => (r.id === rowId ? { ...r, ...partial } : r)),
    });

  const addRow = () =>
    patch({
      rows: [
        ...data.rows,
        {
          id: uid(),
          agenda: "",
          discussion: "",
          action: "",
          taggedUserIds: [],
          subtaskId: null,
        },
      ],
    });

  // Only one person can be tagged per action item: selecting a member replaces
  // the current tag; selecting the already-tagged member clears it.
  const toggleTag = (row: MomRow, userId: string) =>
    updateRow(row.id, {
      taggedUserIds: row.taggedUserIds.includes(userId) ? [] : [userId],
    });

  const convertToSubtask = async (row: MomRow) => {
    if (!projectId || row.subtaskId) return;
    const title =
      row.action.trim() || row.agenda.trim() || t("tasks:mom.actionItem");
    const assigneeId = row.taggedUserIds.find((id) => tagMemberIds.has(id));
    try {
      const newTask = await createTask.mutateAsync({
        title,
        // Carry the meeting's discussion points into the sub-task description.
        description: row.discussion.trim(),
        projectId,
        status: "to-do",
        priority: "no-priority",
        userId: assigneeId,
      });
      await createRelation.mutateAsync({
        sourceTaskId: taskId,
        targetTaskId: newTask.id,
        relationType: "subtask",
      });
      updateRow(row.id, { subtaskId: newTask.id });
      toast.success(t("tasks:mom.convertedToast"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("tasks:mom.convertError"),
      );
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-foreground/90">
        {t("tasks:mom.title")}
      </h2>

      <div className="rounded-lg border border-border/60">
        {/* Header fields */}
        <div className="flex flex-col gap-3 border-b border-border/60 p-3">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" />
              {t("tasks:mom.date")}
              {locked ? (
                <span className="text-foreground">{data.date || "—"}</span>
              ) : (
                <Input
                  type="date"
                  value={data.date ?? ""}
                  onChange={(e) => patch({ date: e.target.value || null })}
                  className="h-7 w-auto text-xs"
                />
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {t("tasks:mom.time")}
              {locked ? (
                <span className="text-foreground">{data.time || "—"}</span>
              ) : (
                <Input
                  type="time"
                  value={data.time ?? ""}
                  onChange={(e) => patch({ time: e.target.value || null })}
                  className="h-7 w-auto text-xs"
                />
              )}
            </div>
            <Button
              type="button"
              variant={locked ? "secondary" : "outline"}
              size="sm"
              className="ms-auto h-7 gap-1 text-xs"
              onClick={() => patch({ locked: !locked })}
              title={locked ? t("tasks:mom.unlock") : t("tasks:mom.lock")}
            >
              {locked ? (
                <Lock className="h-3.5 w-3.5" />
              ) : (
                <LockOpen className="h-3.5 w-3.5" />
              )}
              {locked ? t("tasks:mom.locked") : t("tasks:mom.lock")}
            </Button>
          </div>
          <PeopleEditor
            label={t("tasks:mom.attendees")}
            people={data.attendees}
            members={peopleMembers}
            onChange={(attendees) => patch({ attendees })}
            readOnly={locked}
          />
          <PeopleEditor
            label={t("tasks:mom.absentees")}
            people={data.absentees}
            members={peopleMembers}
            onChange={(absentees) => patch({ absentees })}
            readOnly={locked}
          />
        </div>

        {/* Agenda / Discussion / Action items table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="w-1/4 border-b border-border/60 p-2 font-medium">
                  {t("tasks:mom.agenda")}
                </th>
                <th className="border-b border-border/60 p-2 font-medium">
                  {t("tasks:mom.discussion")}
                </th>
                <th className="w-1/3 border-b border-border/60 p-2 font-medium">
                  {t("tasks:mom.actionItems")}
                </th>
                {!locked && (
                  <th className="w-8 border-b border-border/60 p-2" />
                )}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="border-b border-border/40 p-1.5">
                    {locked ? (
                      <p className="whitespace-pre-wrap p-1 text-foreground">
                        {row.agenda || "—"}
                      </p>
                    ) : (
                      <Textarea
                        value={row.agenda}
                        onChange={(e) =>
                          updateRow(row.id, { agenda: e.target.value })
                        }
                        placeholder={t("tasks:mom.agendaPlaceholder")}
                        className="min-h-[2.25rem] resize-y text-xs"
                      />
                    )}
                  </td>
                  <td className="border-b border-border/40 p-1.5">
                    {locked ? (
                      <p className="whitespace-pre-wrap p-1 text-foreground">
                        {row.discussion || "—"}
                      </p>
                    ) : (
                      <Textarea
                        value={row.discussion}
                        onChange={(e) =>
                          updateRow(row.id, { discussion: e.target.value })
                        }
                        placeholder={t("tasks:mom.discussionPlaceholder")}
                        className="min-h-[2.25rem] resize-y text-xs"
                      />
                    )}
                  </td>
                  <td className="border-b border-border/40 p-1.5">
                    {locked ? (
                      <p className="whitespace-pre-wrap p-1 text-foreground">
                        {row.action || "—"}
                      </p>
                    ) : (
                      <Textarea
                        value={row.action}
                        onChange={(e) =>
                          updateRow(row.id, { action: e.target.value })
                        }
                        placeholder={t("tasks:mom.actionPlaceholder")}
                        className="min-h-[2.25rem] resize-y text-xs"
                      />
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {row.taggedUserIds.map((userId) => (
                        <span
                          key={userId}
                          className="inline-flex items-center gap-1 rounded-full bg-muted/60 py-0.5 pe-1.5 ps-0.5 text-[11px]"
                        >
                          <ColoredAvatar
                            name={memberName(userId)}
                            seed={userId}
                            className="h-4 w-4"
                            fallbackClassName="text-[8px]"
                          />
                          {memberName(userId)}
                        </span>
                      ))}
                      {!locked && (
                        <MemberTagPicker
                          selectedIds={row.taggedUserIds}
                          members={tagMembers}
                          onToggle={(userId) => toggleTag(row, userId)}
                        />
                      )}
                      {row.subtaskId ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <CornerDownRight className="h-3 w-3" />
                          {t("tasks:mom.linkedSubtask")}
                        </span>
                      ) : (
                        !locked && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                            onClick={() => convertToSubtask(row)}
                            title={t("tasks:mom.convertToSubtask")}
                          >
                            <ListTree className="h-3 w-3" />
                            {t("tasks:mom.convertToSubtask")}
                          </Button>
                        )
                      )}
                    </div>
                  </td>
                  {!locked && (
                    <td className="border-b border-border/40 p-1.5 text-center">
                      <button
                        type="button"
                        onClick={() =>
                          patch({
                            rows: data.rows.filter((r) => r.id !== row.id),
                          })
                        }
                        className="text-muted-foreground hover:text-destructive"
                        title={t("tasks:mom.removeRow")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {locked && data.rows.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    className="p-3 text-center text-xs text-muted-foreground"
                  >
                    {t("tasks:mom.noRows")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {!locked && (
          <div className="p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground"
              onClick={addRow}
            >
              <Plus className="h-3.5 w-3.5" />
              {t("tasks:mom.addRow")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
