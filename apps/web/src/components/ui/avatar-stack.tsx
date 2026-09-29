import { useTranslation } from "react-i18next";
import { ColoredAvatar } from "@/components/ui/colored-avatar";
import { PendingAssigneeBadge } from "@/components/ui/pending-assignee-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import type { TaskAssignee, TaskPendingAssignee } from "@/types/task";

const SIZES = {
  "2xs": { box: "h-4 w-4", text: "text-[8px]", icon: "h-[9px] w-[9px]" },
  xs: { box: "h-5 w-5", text: "text-[9px]", icon: "h-2.5 w-2.5" },
  sm: { box: "h-6 w-6", text: "text-[10px]", icon: "h-3 w-3" },
} as const;

type AvatarStackProps = {
  /** Everyone on the task, lead first (as the API returns them). */
  assignees: TaskAssignee[];
  /** People the task is still offered to; drawn after the assignees. */
  pending?: TaskPendingAssignee[];
  /** How many circles to draw before collapsing the rest into "+N". */
  max?: number;
  size?: keyof typeof SIZES;
  className?: string;
};

/**
 * Overlapping avatars for everyone on a task. The lead comes first and
 * carries a ring; people still deciding on an offer follow as dashed
 * pending badges, never as avatars, because the task isn't theirs yet.
 * Renders nothing when there is nobody — callers own the empty state.
 */
export function AvatarStack({
  assignees,
  pending = [],
  max = 3,
  size = "xs",
  className,
}: AvatarStackProps) {
  const { t } = useTranslation();
  const dims = SIZES[size];

  const entries = [
    ...assignees.map((a) => ({ kind: "assignee" as const, person: a })),
    ...pending.map((p) => ({ kind: "pending" as const, person: p })),
  ];
  if (entries.length === 0) return null;

  // Keep a slot for the "+N" chip rather than drawing max circles and a
  // chip beside them.
  const visible =
    entries.length > max ? entries.slice(0, Math.max(1, max - 1)) : entries;
  const overflow = entries.length - visible.length;
  const hidden = entries.slice(visible.length);

  return (
    <TooltipProvider>
      <div
        className={cn("flex items-center -space-x-1.5", className)}
        data-testid="avatar-stack"
      >
        {visible.map((entry, index) => {
          const name = entry.person.name ?? "";
          if (entry.kind === "pending") {
            return (
              <PendingAssigneeBadge
                key={`pending-${entry.person.userId || index}`}
                name={name}
                className={cn(dims.box, "border-background bg-background")}
                iconClassName={dims.icon}
              />
            );
          }
          const isLead = entry.person.isLead;
          const label = isLead ? t("tasks:assignee.lead", { name }) : name;
          return (
            <Tooltip key={entry.person.userId}>
              <TooltipTrigger
                render={
                  <span
                    className="inline-flex rounded-full"
                    role="img"
                    aria-label={label}
                    data-lead={isLead ? "true" : undefined}
                  />
                }
              >
                <ColoredAvatar
                  name={entry.person.name}
                  image={entry.person.image}
                  seed={entry.person.userId}
                  className={cn(
                    dims.box,
                    "border border-background",
                    isLead && "ring-2 ring-primary/60",
                  )}
                  fallbackClassName={dims.text}
                />
              </TooltipTrigger>
              <TooltipContent side="bottom">{label}</TooltipContent>
            </Tooltip>
          );
        })}
        {overflow > 0 && (
          <span
            className={cn(
              dims.box,
              dims.text,
              "flex items-center justify-center rounded-full border border-background bg-muted font-medium text-muted-foreground",
            )}
            title={hidden.map((e) => e.person.name ?? "").join(", ")}
            role="img"
            aria-label={t("tasks:assignee.more", { count: overflow })}
          >
            +{overflow}
          </span>
        )}
      </div>
    </TooltipProvider>
  );
}

export default AvatarStack;
