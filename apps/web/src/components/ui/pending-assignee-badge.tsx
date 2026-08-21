import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

type PendingAssigneeBadgeProps = {
  /** Name of the person who was asked to accept the task. */
  name: string;
  /** Sizing/extra classes applied to the badge root (e.g. "h-5 w-5"). */
  className?: string;
  /** Extra classes for the Clock icon (e.g. size). */
  iconClassName?: string;
};

/**
 * Marker for a task awaiting acceptance: `task.userId` is still null and a
 * `pending` row exists in `task_assignment`, so someone was asked but hasn't
 * accepted yet. Deliberately NOT a ColoredAvatar — the task isn't theirs
 * until they accept, so this must never look like a real assignee. The
 * dashed border + warning tint + Clock icon distinguish it from both the
 * accepted-assignee avatar and the plain "unassigned" state.
 */
export function PendingAssigneeBadge({
  name,
  className,
  iconClassName,
}: PendingAssigneeBadgeProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full border border-dashed border-warning-foreground/50 bg-warning/10",
        className,
      )}
      title={t("tasks:assignee.awaiting", { name })}
    >
      <Clock className={cn("text-warning-foreground", iconClassName)} />
    </div>
  );
}

export default PendingAssigneeBadge;
