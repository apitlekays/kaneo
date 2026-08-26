import { Loader2, Lock, Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CreateMeetingInput } from "@/fetchers/meeting";
import { useMeetingMutations } from "@/hooks/queries/meeting/use-meeting-mutations";
import { useMeetings } from "@/hooks/queries/meeting/use-meetings";
import { formatDateMedium } from "@/lib/format";
import { MeetingDetailDialog } from "./meeting-detail-dialog";

/**
 * Meeting Minutes — organisation-level meetings, distinct from a letter's
 * `letter_minute` annotations and a project's `task_mom`. Always spelled out
 * as "Meeting Minutes" here, never bare "Minutes": two of those three
 * features are visible to the same users, and a bare "Minutes" heading or
 * empty state would leave them guessing which one they're looking at.
 *
 * Takes `workspaceId` from the shell, like its sibling panels.
 */
export function MinutesManager({ workspaceId }: { workspaceId: string }) {
  const { data: meetings, isLoading } = useMeetings(workspaceId);
  const [openMeetingId, setOpenMeetingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-lg">Meeting Minutes</h2>
          <p className="text-muted-foreground text-sm">
            Agendas, attendance, decisions and follow-up actions for
            organisation meetings.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" />
          New meeting
        </Button>
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !meetings || meetings.length === 0 ? (
        <div className="mx-auto max-w-md space-y-2 py-12 text-center">
          <h3 className="font-medium text-sm">No Meeting Minutes yet</h3>
          <p className="text-muted-foreground text-sm">
            Create a meeting to start recording its agenda, attendance and
            decisions.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {meetings.map((meeting) => (
            <button
              key={meeting.id}
              type="button"
              onClick={() => setOpenMeetingId(meeting.id)}
              className="flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{meeting.title}</span>
                {meeting.confidential && (
                  <Badge
                    variant="destructive"
                    className="flex shrink-0 items-center gap-1 text-xs"
                  >
                    <Lock className="h-3 w-3" />
                    Confidential
                  </Badge>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-3 text-muted-foreground text-xs">
                {/* No meeting-type labels are exposed to the web layer yet
                    (there is no meeting-type listing route or fetcher) —
                    render the raw id rather than inventing a lookup here. */}
                <span>{meeting.meetingTypeId ?? "—"}</span>
                <span>
                  {meeting.scheduledAt
                    ? formatDateMedium(meeting.scheduledAt)
                    : "—"}
                </span>
                <Badge
                  variant={meeting.status === "adopted" ? "success" : "outline"}
                  className="text-xs"
                >
                  {meeting.status === "adopted" ? "Adopted" : "Draft"}
                </Badge>
              </span>
            </button>
          ))}
        </div>
      )}

      <CreateMeetingDialog
        workspaceId={workspaceId}
        open={creating}
        onClose={() => setCreating(false)}
      />
      <MeetingDetailDialog
        workspaceId={workspaceId}
        meetingId={openMeetingId}
        onClose={() => setOpenMeetingId(null)}
      />
    </div>
  );
}

function CreateMeetingDialog({
  workspaceId,
  open,
  onClose,
}: {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { create } = useMeetingMutations(workspaceId);
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [location, setLocation] = useState("");
  const [confidential, setConfidential] = useState(false);

  const reset = () => {
    setTitle("");
    setScheduledAt("");
    setLocation("");
    setConfidential(false);
  };

  const submit = () => {
    const body: CreateMeetingInput = {
      title: title.trim(),
      scheduledAt: scheduledAt || undefined,
      location: location.trim() || undefined,
      confidential,
    };
    create.mutate(body, {
      onSuccess: () => {
        reset();
        onClose();
      },
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
          reset();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New meeting</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 px-6">
          <div className="space-y-1">
            <Label className="text-xs">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Q3 Committee Meeting"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Scheduled date</Label>
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Location</Label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <label
            className="flex items-center gap-2 text-sm"
            htmlFor="new-meeting-confidential"
          >
            <Checkbox
              id="new-meeting-confidential"
              checked={confidential}
              onCheckedChange={(v) => setConfidential(Boolean(v))}
            />
            <span>Confidential — restrict to attendees and admins</span>
          </label>
        </div>
        <DialogFooter variant="bare">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!title.trim() || create.isPending}
            onClick={submit}
          >
            {create.isPending && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
