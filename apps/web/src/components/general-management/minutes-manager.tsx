import { Loader2, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { MeetingCard } from "./meeting-card";
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
  const [openMeetingId, setOpenMeetingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  // Debounced so typing does not fire a query per keystroke. 300ms is the
  // usual "finished a word" pause; shorter feels twitchy on a slow link.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const {
    data,
    isLoading,
    isError,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useMeetings(workspaceId, debounced);

  const meetings = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  );

  // Auto-load on scroll, with the button below as the accessible and
  // testable path. jsdom has no IntersectionObserver, hence the guard.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage || isFetchingNextPage) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) fetchNextPage();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
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

      <div className="relative">
        <Search className="-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search Meeting Minutes by title, location, type or body"
          aria-label="Search Meeting Minutes"
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
          role="status"
          aria-label="Loading Meeting Minutes"
        >
          {Array.from({ length: 8 }, (_, i) => (
            <div
              key={`skeleton-${
                // biome-ignore lint/suspicious/noArrayIndexKey: It's a skeleton
                i
              }`}
              className="animate-pulse rounded-lg border border-border"
            >
              <div className="aspect-[3/4] w-full rounded-t-lg bg-muted" />
              <div className="space-y-2 p-3">
                <div className="h-2 w-2/3 rounded bg-muted" />
                <div className="h-2 w-1/2 rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <div
          className="mx-auto max-w-md space-y-3 py-12 text-center"
          role="alert"
        >
          <h3 className="font-medium text-sm">Couldn't load Meeting Minutes</h3>
          <p className="text-muted-foreground text-sm">
            Something went wrong fetching this workspace's meetings.
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : meetings.length === 0 ? (
        debounced ? (
          <div className="mx-auto max-w-md space-y-3 py-12 text-center">
            <h3 className="font-medium text-sm">No Meeting Minutes matched</h3>
            <p className="text-muted-foreground text-sm">
              Nothing in this workspace matches “{debounced}”.
            </p>
            <Button variant="outline" size="sm" onClick={() => setSearch("")}>
              <X className="h-3.5 w-3.5" />
              Clear search
            </Button>
          </div>
        ) : (
          <div className="mx-auto max-w-md space-y-2 py-12 text-center">
            <h3 className="font-medium text-sm">No Meeting Minutes yet</h3>
            <p className="text-muted-foreground text-sm">
              Create a meeting to start recording its agenda, attendance and
              decisions.
            </p>
          </div>
        )
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {meetings.map((meeting) => (
              <MeetingCard
                key={meeting.id}
                meeting={meeting}
                onOpen={() => setOpenMeetingId(meeting.id)}
              />
            ))}
          </div>
          <div ref={sentinel} />
          {hasNextPage && (
            <div className="flex justify-center py-2">
              {isFetchingNextPage ? (
                <span className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading more…
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchNextPage()}
                >
                  Load more
                </Button>
              )}
            </div>
          )}
        </>
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
            <Label className="text-xs" htmlFor="new-meeting-title">
              Title
            </Label>
            <Input
              id="new-meeting-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Q3 Committee Meeting"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="new-meeting-scheduled-at">
              Scheduled date
            </Label>
            <Input
              id="new-meeting-scheduled-at"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="new-meeting-location">
              Location
            </Label>
            <Input
              id="new-meeting-location"
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
