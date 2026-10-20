import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Pencil, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ColoredAvatar } from "@/components/ui/colored-avatar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Progress,
  ProgressIndicator,
  ProgressTrack,
} from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  addProjectMember,
  type ProjectMember,
  removeProjectMember,
} from "@/fetchers/project-member";
import {
  useProjectDetails,
  useUpdateProjectDetails,
} from "@/hooks/queries/project/use-project-details";
import { useProjectMembers } from "@/hooks/queries/project-member/use-project-members";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { cn } from "@/lib/cn";
import { formatRM, fromMinorUnits, toMinorUnits } from "@/lib/format-currency";
import { type ProjectKind, useProjectKind } from "@/lib/project-kind";
import { toast } from "@/lib/toast";

const COLLAPSED_KEY = "kaneo:project-ribbon:collapsed";

/** The ribbon's words for each kind of project. */
export const RIBBON_LABELS = {
  project: {
    managers: "Project Managers",
    manager: "Project Manager",
    members: "Project Members",
    member: "Project Member",
    noun: "project",
  },
  consultation: {
    managers: "Lead Consultants",
    manager: "Lead Consultant",
    members: "Consultants",
    member: "Consultant",
    noun: "consultation",
  },
} as const;

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * A project's people, description and money, between the toolbar and the
 * tasks on the Board, Backlog and Gantt views. Every figure comes from the
 * server, which tallies Actual Expenditure from the tasks' cost entries, and
 * refreshes live (see use-project-websocket).
 */
export function ProjectDetailsRibbon({
  projectId,
  workspaceId,
}: {
  projectId: string;
  workspaceId: string;
}) {
  // Set by ProjectLayout from the project itself.
  const labels = RIBBON_LABELS[useProjectKind()];
  const { data: details } = useProjectDetails(projectId);
  const { data: members = [] } = useProjectMembers(projectId);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [editing, setEditing] = useState(false);
  const [managingPeople, setManagingPeople] = useState(false);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // Remembering is a convenience only.
    }
  };

  if (!details) return null;

  const managers = members.filter((m) => m.role === "manager");
  const people = members.filter((m) => m.role !== "manager");
  const { budget, revenue, expenditure } = details;
  const margin = revenue === null ? null : revenue - expenditure;
  const spentShare =
    budget && budget > 0 ? Math.round((expenditure / budget) * 100) : null;
  const overBudget = budget !== null && expenditure > budget;

  return (
    <section
      aria-label={`${labels.noun} details`}
      className="shrink-0 border-border/80 border-b bg-card/60 px-3 py-2 text-sm"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          className="flex items-center gap-1 font-medium text-foreground/90 text-xs hover:text-foreground"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          Details
        </button>
        {collapsed && (
          <span className="truncate text-muted-foreground text-xs">
            {managers.length > 0 &&
              `${labels.managers}: ${managers.map((m) => m.name).join(", ")} · `}
            Budget {formatRM(budget)} · Spent {formatRM(expenditure)}
            {spentShare !== null && ` (${spentShare}%)`} · Revenue{" "}
            {formatRM(revenue)}
          </span>
        )}
        {details.canEdit && !collapsed && (
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setManagingPeople(true)}
            >
              <Users className="h-3.5 w-3.5" />
              Manage people
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
              Edit details
            </Button>
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="mt-2 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.6fr)]">
          <div className="space-y-2">
            <PeopleRow label={labels.managers} people={managers} />
            <PeopleRow label={labels.members} people={people} />
          </div>

          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">
              Description
            </p>
            <p
              className={cn(
                "mt-0.5 line-clamp-3 whitespace-pre-line text-xs",
                !details.description && "text-muted-foreground italic",
              )}
              title={details.description ?? undefined}
            >
              {details.description || "No description yet."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 md:grid-cols-2 lg:grid-cols-4">
            <Figure label="Budget allocation" value={formatRM(budget)} />
            <div className="min-w-0">
              <Figure
                label="Actual expenditure"
                value={formatRM(expenditure)}
                tone={overBudget ? "bad" : undefined}
              />
              {spentShare !== null && (
                <div className="mt-1">
                  <Progress
                    value={Math.min(spentShare, 100)}
                    aria-label="Budget spent"
                  >
                    <ProgressTrack>
                      <ProgressIndicator
                        className={cn(
                          "transition-[width] duration-500",
                          overBudget
                            ? "bg-destructive"
                            : spentShare >= 80
                              ? "bg-amber-500"
                              : "bg-primary",
                        )}
                      />
                    </ProgressTrack>
                  </Progress>
                  <p
                    className={cn(
                      "mt-0.5 text-[11px]",
                      overBudget ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {overBudget && budget !== null
                      ? `Over by ${formatRM(expenditure - budget)}`
                      : `${spentShare}% of budget`}
                  </p>
                </div>
              )}
            </div>
            <Figure label="Revenue" value={formatRM(revenue)} />
            <Figure
              label="Margin"
              value={margin === null ? "Not set" : formatRM(margin)}
              tone={margin === null ? undefined : margin < 0 ? "bad" : "good"}
              hint="Revenue minus actual expenditure"
            />
          </div>
        </div>
      )}

      {details.canEdit && (
        <>
          {editing && (
            <EditDetailsDialog
              open
              onClose={() => setEditing(false)}
              projectId={projectId}
              noun={labels.noun}
              initial={details}
            />
          )}
          <ManagePeopleDialog
            open={managingPeople}
            onClose={() => setManagingPeople(false)}
            projectId={projectId}
            workspaceId={workspaceId}
            members={members}
            labels={labels}
          />
        </>
      )}
    </section>
  );
}

function PeopleRow({
  label,
  people,
}: {
  label: string;
  people: ProjectMember[];
}) {
  const shown = people.slice(0, 6);
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">
        {label}
      </p>
      {people.length === 0 ? (
        <p className="mt-0.5 text-muted-foreground text-xs italic">None yet</p>
      ) : (
        <TooltipProvider>
          <div className="mt-0.5 flex items-center gap-1.5">
            <div className="-space-x-1.5 flex">
              {shown.map((person) => (
                <Tooltip key={person.userId}>
                  <TooltipTrigger
                    render={<span className="rounded-full ring-2 ring-card" />}
                  >
                    <ColoredAvatar
                      name={person.name}
                      image={person.image}
                      seed={person.userId}
                      className="h-6 w-6"
                      fallbackClassName="text-[10px]"
                    />
                  </TooltipTrigger>
                  <TooltipContent>{person.name}</TooltipContent>
                </Tooltip>
              ))}
            </div>
            <span className="truncate text-xs">
              {people.length <= 2
                ? people.map((p) => p.name).join(", ")
                : `${people[0]?.name} and ${people.length - 1} others`}
            </span>
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
  hint?: string;
}) {
  return (
    <div className="min-w-0" title={hint}>
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 truncate font-medium tabular-nums",
          tone === "bad" && "text-destructive",
          tone === "good" && "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function EditDetailsDialog({
  open,
  onClose,
  projectId,
  noun,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  noun: string;
  initial: {
    description: string | null;
    budget: number | null;
    revenue: number | null;
  };
}) {
  // Mounted only while open, so it always starts from the saved values.
  const update = useUpdateProjectDetails(projectId);
  const [description, setDescription] = useState(initial.description ?? "");
  const [budget, setBudget] = useState(fromMinorUnits(initial.budget));
  const [revenue, setRevenue] = useState(fromMinorUnits(initial.revenue));
  const [error, setError] = useState<string | null>(null);

  const parse = (text: string) => {
    if (!text.trim()) return { value: null, ok: true };
    const value = toMinorUnits(text.replace(/,/g, ""));
    return { value, ok: value !== null && value >= 0 };
  };

  const save = () => {
    const b = parse(budget);
    const r = parse(revenue);
    if (!b.ok || !r.ok) {
      setError("Amounts must be numbers in RM, for example 12500.50");
      return;
    }
    update.mutate(
      { description, budget: b.value, revenue: r.value },
      {
        onSuccess: () => {
          toast.success("Details saved");
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="capitalize">{noun} details</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-6">
          <div className="space-y-1">
            <Label htmlFor="ribbon-description" className="text-xs">
              Description
            </Label>
            <Textarea
              id="ribbon-description"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={`What this ${noun} is about`}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MoneyField
              id="ribbon-budget"
              label="Budget allocation (RM)"
              value={budget}
              onChange={setBudget}
            />
            <MoneyField
              id="ribbon-revenue"
              label="Revenue (RM)"
              value={revenue}
              onChange={setRevenue}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            Actual expenditure is not entered here: it is the total of the costs
            recorded on this {noun}'s tasks and subtasks.
          </p>
          {error && (
            <p className="text-destructive text-xs" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={update.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MoneyField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        inputMode="decimal"
        placeholder="0.00"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

const NONE = "none";

function ManagePeopleDialog({
  open,
  onClose,
  projectId,
  workspaceId,
  members,
  labels,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  workspaceId: string;
  members: ProjectMember[];
  labels: (typeof RIBBON_LABELS)[ProjectKind];
}) {
  const queryClient = useQueryClient();
  const { data: usersData } = useGetActiveWorkspaceUsers(workspaceId);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const roleOf = new Map(members.map((m) => [m.userId, m.role]));
  const needle = filter.trim().toLowerCase();
  const everyone = (usersData?.members ?? [])
    .filter(
      (m) =>
        !needle ||
        [m.user?.name, m.user?.email].some((f) =>
          f?.toLowerCase().includes(needle),
        ),
    )
    .sort(
      (a, b) =>
        Number(roleOf.has(b.userId)) - Number(roleOf.has(a.userId)) ||
        (a.user?.name ?? "").localeCompare(b.user?.name ?? ""),
    );

  const change = async (userId: string, next: string) => {
    setBusy(userId);
    try {
      if (next === NONE) await removeProjectMember(projectId, userId);
      else
        await addProjectMember(projectId, userId, next as "manager" | "member");
      await queryClient.invalidateQueries({
        queryKey: ["project-members", projectId],
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't change that person",
      );
    } finally {
      setBusy(null);
    }
  };

  const options = [
    { value: NONE, label: "Not in it" },
    { value: "member", label: labels.member },
    { value: "manager", label: labels.manager },
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {labels.managers} and {labels.members}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 px-6 pb-6">
          <Input
            type="search"
            aria-label="Filter people"
            placeholder="Filter by name or email"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {everyone.map((m) => {
              const role = roleOf.get(m.userId) ?? NONE;
              const name = m.user?.name ?? m.userId;
              return (
                <li
                  key={m.userId}
                  className="flex items-center justify-between gap-2 rounded-md px-1 py-1"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <ColoredAvatar
                      name={name}
                      image={m.user?.image}
                      seed={m.userId}
                      className="h-6 w-6"
                      fallbackClassName="text-[10px]"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{name}</span>
                      <span className="block truncate text-muted-foreground text-xs">
                        {m.user?.email}
                      </span>
                    </span>
                  </span>
                  <Select
                    value={role}
                    onValueChange={(v) =>
                      v && v !== role && change(m.userId, v)
                    }
                    disabled={busy === m.userId}
                  >
                    <SelectTrigger
                      className="w-40 shrink-0"
                      size="sm"
                      aria-label={`${name}'s role`}
                    >
                      <SelectValue>
                        {options.find((o) => o.value === role)?.label}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              );
            })}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
