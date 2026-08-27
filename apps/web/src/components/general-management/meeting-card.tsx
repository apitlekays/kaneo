import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { MeetingListItem } from "@/fetchers/meeting";
import { formatDateMedium } from "@/lib/format";

/**
 * One meeting, rendered as a document rather than a row: a portrait
 * rectangle suggesting a page, with the title inside it.
 *
 * The title is clamped to a fixed number of lines. A long title must never
 * resize its card or overflow it — the grid has to stay even, and minutes
 * titles are routinely a full sentence.
 */
export function MeetingCard({
  meeting,
  onOpen,
}: {
  meeting: MeetingListItem;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col rounded-lg border border-border bg-card p-0 text-left transition hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="relative flex aspect-[3/4] w-full flex-col justify-between overflow-hidden rounded-t-lg border-border border-b bg-muted/40 p-3">
        {meeting.confidential && (
          <Badge
            variant="destructive"
            className="flex w-fit shrink-0 items-center gap-1 text-xs"
          >
            <Lock className="h-3 w-3" />
            Confidential
          </Badge>
        )}
        <span className="line-clamp-4 font-medium text-sm leading-snug">
          {meeting.title}
        </span>
      </span>
      <span className="flex flex-col gap-1 p-3 text-muted-foreground text-xs">
        <span className="truncate">
          {meeting.scheduledAt ? formatDateMedium(meeting.scheduledAt) : "—"}
        </span>
        <span className="truncate">{meeting.meetingTypeLabel ?? "—"}</span>
        <Badge
          variant={meeting.status === "adopted" ? "success" : "outline"}
          className="w-fit text-xs"
        >
          {meeting.status === "adopted" ? "Adopted" : "Draft"}
        </Badge>
      </span>
    </button>
  );
}
