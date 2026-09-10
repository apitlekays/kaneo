import {
  CheckCircle2,
  ClipboardList,
  Info,
  Loader2,
  Lock,
  Pencil,
  Trash2,
  Users,
  UserX,
} from "lucide-react";
import { useRef, useState } from "react";
import { DateField } from "@/components/assets/date-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DialogSidebar,
  DialogSidebarPanel,
} from "@/components/ui/dialog-sidebar";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  AddAttendeeInput,
  Meeting,
  MeetingAction,
  MeetingDetail,
  MeetingMinuteItem,
} from "@/fetchers/meeting";
import { useAdoptCandidates } from "@/hooks/queries/meeting/use-adopt-candidates";
import { useMeeting } from "@/hooks/queries/meeting/use-meeting";
import { useMeetingMutations } from "@/hooks/queries/meeting/use-meeting-mutations";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { cn } from "@/lib/cn";
import { formatDateMedium } from "@/lib/format";
import { onSelectValueChange } from "@/lib/select-value";
import { MinuteItemImport } from "./minute-item-import";

type Mutations = ReturnType<typeof useMeetingMutations>;
type WorkspaceUser = { userId: string; user?: { name?: string } };

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-sm">{value || "—"}</div>
    </div>
  );
}

export function MeetingDetailDialog({
  workspaceId,
  meetingId,
  onClose,
}: {
  workspaceId: string;
  meetingId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError, refetch } = useMeeting(
    workspaceId,
    meetingId,
  );
  const [section, setSection] = useState("overview");

  return (
    <Dialog
      open={Boolean(meetingId)}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setSection("overview");
        }
      }}
    >
      <DialogContent className="flex h-[85dvh] max-w-4xl flex-col overflow-hidden">
        {isError ? (
          <div
            className="flex h-40 flex-col items-center justify-center gap-3 text-center"
            role="alert"
          >
            <p className="text-sm">Couldn't load this meeting</p>
            <p className="text-muted-foreground text-xs">
              Something went wrong fetching its details.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        ) : isLoading || !data ? (
          <div
            className="flex h-40 items-center justify-center"
            role="status"
            aria-label="Loading meeting"
          >
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Body
            workspaceId={workspaceId}
            meeting={data}
            section={section}
            setSection={setSection}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  workspaceId,
  meeting,
  section,
  setSection,
}: {
  workspaceId: string;
  meeting: MeetingDetail;
  section: string;
  setSection: (v: string) => void;
}) {
  const m = useMeetingMutations(workspaceId, meeting.id);
  const { data: usersData } = useGetActiveWorkspaceUsers(workspaceId);
  const users = usersData?.members ?? [];
  const [adoptSearch, setAdoptSearch] = useState("");
  const { data: adoptPage, isError: isMeetingsError } = useAdoptCandidates(
    workspaceId,
    adoptSearch.trim(),
  );
  const meetings = adoptPage?.items ?? [];
  // The picker deliberately shows one bounded page. A non-null cursor means
  // the server had more to give, so an older meeting really is unselectable
  // — say so rather than leaving the user hunting for it.
  const isTruncated = Boolean(adoptPage?.nextCursor);

  return (
    <>
      <DialogHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 pr-10">
          <div className="min-w-0">
            <DialogTitle className="truncate">{meeting.title}</DialogTitle>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
              <Badge className="border text-xs">
                {meeting.status === "adopted" ? "Adopted" : "Draft"}
              </Badge>
              {meeting.confidential && (
                <Badge
                  variant="destructive"
                  className="flex items-center gap-1 text-xs"
                >
                  <Lock className="h-3 w-3" />
                  Confidential
                </Badge>
              )}
              {meeting.scheduledAt && (
                <span>{formatDateMedium(meeting.scheduledAt)}</span>
              )}
              {meeting.location && <span>{meeting.location}</span>}
            </div>
          </div>
        </div>
      </DialogHeader>

      <DialogSidebar
        value={section}
        onValueChange={setSection}
        items={[
          { value: "overview", label: "Overview", icon: Info },
          {
            value: "attendees",
            label: "Attendees",
            icon: Users,
            badge: meeting.attendees.length || "",
          },
          {
            value: "minutes",
            label: "Minute Items",
            icon: ClipboardList,
            badge: meeting.minuteItems.length || "",
          },
          {
            value: "actions",
            label: "Actions",
            icon: CheckCircle2,
            badge: meeting.actions.length || "",
          },
        ]}
      >
        <DialogSidebarPanel value="overview">
          <OverviewSection
            meeting={meeting}
            m={m}
            meetings={meetings}
            isMeetingsError={isMeetingsError}
            isTruncated={isTruncated}
            adoptSearch={adoptSearch}
            setAdoptSearch={setAdoptSearch}
          />
        </DialogSidebarPanel>
        <DialogSidebarPanel value="attendees">
          <AttendeesSection meeting={meeting} m={m} users={users} />
        </DialogSidebarPanel>
        <DialogSidebarPanel value="minutes">
          <MinuteItemsSection
            workspaceId={workspaceId}
            meeting={meeting}
            m={m}
          />
        </DialogSidebarPanel>
        <DialogSidebarPanel value="actions">
          <ActionsSection meeting={meeting} m={m} users={users} />
        </DialogSidebarPanel>
      </DialogSidebar>
    </>
  );
}

function OverviewSection({
  meeting,
  m,
  meetings,
  isMeetingsError,
  isTruncated,
  adoptSearch,
  setAdoptSearch,
}: {
  meeting: MeetingDetail;
  m: Mutations;
  meetings: Meeting[];
  isMeetingsError: boolean;
  isTruncated: boolean;
  adoptSearch: string;
  setAdoptSearch: (v: string) => void;
}) {
  return (
    <div className="space-y-5">
      {meeting.confidential && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          <Lock className="h-4 w-4 text-destructive" />
          <span>
            This meeting is confidential. Its Meeting Minutes are restricted to
            attendees and administrators — check before sharing them further.
          </span>
        </div>
      )}

      <div className="rounded-xl border border-border p-4 text-sm">
        {meeting.status === "adopted" ? (
          <div className="space-y-1">
            <div>
              <span className="text-muted-foreground">Adopted: </span>
              <span className="font-medium">
                {meeting.adoptedAt ? formatDateMedium(meeting.adoptedAt) : "—"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Adopted by: </span>
              <span className="font-medium">
                {meeting.adoptedByMeeting
                  ? meeting.adoptedByMeeting.title
                  : meeting.adoptedByMeetingId
                    ? // Adopted, but the adopting meeting was since deleted —
                      // `adoptedByMeetingId` carries no FK, so this lookup can
                      // legitimately come back empty.
                      "A meeting that has since been deleted"
                    : "—"}
              </span>
            </div>
          </div>
        ) : (
          <p>
            <span className="text-muted-foreground">Status: </span>
            <span className="font-medium">Draft — not yet adopted</span>
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Scheduled"
          value={
            meeting.scheduledAt ? formatDateMedium(meeting.scheduledAt) : "—"
          }
        />
        <Field label="Location" value={meeting.location} />
      </div>

      {meeting.status === "draft" && (
        <AdoptControl
          meeting={meeting}
          m={m}
          meetings={meetings}
          isMeetingsError={isMeetingsError}
          isTruncated={isTruncated}
          adoptSearch={adoptSearch}
          setAdoptSearch={setAdoptSearch}
        />
      )}
    </div>
  );
}

function AdoptControl({
  meeting,
  m,
  meetings,
  isMeetingsError,
  isTruncated,
  adoptSearch,
  setAdoptSearch,
}: {
  meeting: MeetingDetail;
  m: Mutations;
  meetings: Meeting[];
  isMeetingsError: boolean;
  isTruncated: boolean;
  adoptSearch: string;
  setAdoptSearch: (v: string) => void;
}) {
  const [adoptedByMeetingId, setAdoptedByMeetingId] = useState("");
  const candidates = meetings.filter((other) => other.id !== meeting.id);

  return (
    <div className="space-y-2 rounded-xl border border-border p-4">
      <h4 className="font-medium text-sm">Adopt these Meeting Minutes</h4>
      <p className="text-muted-foreground text-xs">
        Record which later meeting confirmed and adopted this meeting's Meeting
        Minutes. Once adopted, its attendees and minute items become read-only.
      </p>
      <Input
        type="search"
        value={adoptSearch}
        onChange={(e) => setAdoptSearch(e.target.value)}
        placeholder="Search meetings"
        aria-label="Search meetings to adopt from"
        className="mb-2"
      />
      <div className="flex flex-wrap items-end gap-2">
        <Select
          value={adoptedByMeetingId}
          onValueChange={onSelectValueChange(setAdoptedByMeetingId)}
        >
          <SelectTrigger className="w-64">
            <SelectValue>
              {adoptedByMeetingId
                ? (candidates.find((c) => c.id === adoptedByMeetingId)?.title ??
                  adoptedByMeetingId)
                : "Select adopting meeting"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {candidates.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={!adoptedByMeetingId || m.adopt.isPending}
          onClick={() =>
            m.adopt.mutate(adoptedByMeetingId, {
              onSuccess: () => setAdoptedByMeetingId(""),
            })
          }
        >
          {m.adopt.isPending && (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          )}
          Adopt
        </Button>
      </div>
      {!isMeetingsError && isTruncated && (
        <p className="text-muted-foreground text-xs">
          Showing the most recent meetings only — search to find an older one.
        </p>
      )}
      {isMeetingsError ? (
        <p className="text-destructive text-xs" role="alert">
          Couldn't load other meetings to adopt from — try reopening this
          dialog.
        </p>
      ) : (
        candidates.length === 0 && (
          <p className="text-muted-foreground text-xs">
            {adoptSearch.trim()
              ? "No meetings matched that search."
              : "No other meetings yet to record as the adopting meeting."}
          </p>
        )
      )}
    </div>
  );
}

type AttendeeMode = "user" | "outside";

function AttendeesSection({
  meeting,
  m,
  users,
}: {
  meeting: MeetingDetail;
  m: Mutations;
  users: WorkspaceUser[];
}) {
  const isAdopted = meeting.status === "adopted";
  const userName = (id: string | null) =>
    id ? (users.find((u) => u.userId === id)?.user?.name ?? id) : null;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {meeting.attendees.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No attendees recorded.
          </p>
        )}
        {meeting.attendees.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
          >
            <span>{a.name ?? userName(a.userId) ?? a.userId}</span>
            <span className="flex items-center gap-2">
              <Badge className="border text-xs">{a.attendance}</Badge>
              {!isAdopted && (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remove ${a.name ?? userName(a.userId) ?? a.userId}`}
                  disabled={m.removeAttendee.isPending}
                  onClick={() => m.removeAttendee.mutate(a.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </span>
          </div>
        ))}
      </div>
      {!isAdopted && <AddAttendeeForm m={m} users={users} />}
    </div>
  );
}

function AddAttendeeForm({
  m,
  users,
}: {
  m: Mutations;
  users: WorkspaceUser[];
}) {
  const [mode, setMode] = useState<AttendeeMode>("user");
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [attendance, setAttendance] = useState<
    "present" | "apology" | "absent"
  >("present");

  // Switching mode clears whichever field the other mode owns, so the two
  // are structurally exclusive — the user can never have both filled in at
  // once, rather than merely being discouraged from it.
  const changeMode = (next: AttendeeMode) => {
    setMode(next);
    setUserId("");
    setName("");
  };

  const canSubmit = mode === "user" ? Boolean(userId) : Boolean(name.trim());

  const submit = () => {
    const body: AddAttendeeInput =
      mode === "user"
        ? { userId, attendance }
        : { name: name.trim(), attendance };
    m.addAttendee.mutate(body, {
      onSuccess: () => {
        setUserId("");
        setName("");
        setAttendance("present");
      },
    });
  };

  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <h4 className="font-medium text-sm">Add attendee</h4>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => changeMode("user")}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs",
            mode === "user"
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:bg-muted",
          )}
        >
          Workspace user
        </button>
        <button
          type="button"
          onClick={() => changeMode("outside")}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs",
            mode === "outside"
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:bg-muted",
          )}
        >
          Outside guest
        </button>
      </div>
      {mode === "user" ? (
        <Select value={userId} onValueChange={onSelectValueChange(setUserId)}>
          <SelectTrigger>
            <SelectValue>
              {userId
                ? (users.find((u) => u.userId === userId)?.user?.name ?? userId)
                : "Select workspace user"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {users.map((u) => (
              <SelectItem key={u.userId} value={u.userId}>
                {u.user?.name ?? u.userId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          value={name}
          placeholder="Guest's name"
          onChange={(e) => setName(e.target.value)}
        />
      )}
      <div className="flex items-center justify-between gap-2">
        <Select
          value={attendance}
          onValueChange={(v) => setAttendance(v as typeof attendance)}
        >
          <SelectTrigger className="w-40">
            <SelectValue>{attendance}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="present">present</SelectItem>
            <SelectItem value="apology">apology</SelectItem>
            <SelectItem value="absent">absent</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={!canSubmit || m.addAttendee.isPending}
          onClick={submit}
        >
          {m.addAttendee.isPending && (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          )}
          Add attendee
        </Button>
      </div>
    </div>
  );
}

function MinuteItemsSection({
  workspaceId,
  meeting,
  m,
}: {
  workspaceId: string;
  meeting: MeetingDetail;
  m: Mutations;
}) {
  const isAdopted = meeting.status === "adopted";
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {meeting.minuteItems.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No minute items recorded.
          </p>
        )}
        {meeting.minuteItems.map((item) => (
          <MinuteItemRow
            key={item.id}
            item={item}
            m={m}
            editable={!isAdopted}
          />
        ))}
      </div>
      {!isAdopted && (
        <>
          <MinuteItemImport workspaceId={workspaceId} meetingId={meeting.id} />
          <AddMinuteItemForm m={m} />
        </>
      )}
    </div>
  );
}

function MinuteItemRow({
  item,
  m,
  editable,
}: {
  item: MeetingMinuteItem;
  m: Mutations;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [topic, setTopic] = useState(item.topic);
  const [discussion, setDiscussion] = useState(item.discussion ?? "");
  const [decision, setDecision] = useState(item.decision ?? "");

  const cancel = () => {
    setTopic(item.topic);
    setDiscussion(item.discussion ?? "");
    setDecision(item.decision ?? "");
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="space-y-1 rounded-md border border-border px-3 py-2 text-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 font-medium">
            {item.numbering && (
              <span className="text-muted-foreground">{item.numbering} </span>
            )}
            {item.topic}
          </div>
          {editable && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          )}
        </div>
        {item.status && (
          <Badge
            variant="outline"
            className="h-auto max-w-full whitespace-normal break-words py-1 text-left sm:h-auto"
          >
            {item.status}
          </Badge>
        )}
        {item.discussion && (
          <p className="whitespace-pre-wrap text-muted-foreground text-xs">
            {item.discussion}
          </p>
        )}
        {item.decision && (
          <p className="text-xs">
            <span className="text-muted-foreground">Decision: </span>
            {item.decision}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border px-3 py-2 text-sm">
      <Input
        value={topic}
        placeholder="Topic"
        onChange={(e) => setTopic(e.target.value)}
      />
      <Textarea
        value={discussion}
        placeholder="Discussion (optional)"
        onChange={(e) => setDiscussion(e.target.value)}
      />
      <Input
        value={decision}
        placeholder="Decision (optional)"
        onChange={(e) => setDecision(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={cancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!topic.trim() || m.updateMinuteItem.isPending}
          onClick={() =>
            m.updateMinuteItem.mutate(
              {
                itemId: item.id,
                body: {
                  topic: topic.trim(),
                  discussion: discussion.trim() || undefined,
                  decision: decision.trim() || undefined,
                },
              },
              { onSuccess: () => setEditing(false) },
            )
          }
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function AddMinuteItemForm({ m }: { m: Mutations }) {
  const [topic, setTopic] = useState("");
  const [discussion, setDiscussion] = useState("");
  const [decision, setDecision] = useState("");

  const reset = () => {
    setTopic("");
    setDiscussion("");
    setDecision("");
  };

  const submit = () => {
    m.addMinuteItem.mutate(
      {
        topic: topic.trim(),
        discussion: discussion.trim() || undefined,
        decision: decision.trim() || undefined,
      },
      { onSuccess: reset },
    );
  };

  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <h4 className="font-medium text-sm">Add minute item</h4>
      <Input
        value={topic}
        placeholder="Topic"
        onChange={(e) => setTopic(e.target.value)}
      />
      <Textarea
        value={discussion}
        placeholder="Discussion (optional)"
        onChange={(e) => setDiscussion(e.target.value)}
      />
      <Input
        value={decision}
        placeholder="Decision (optional)"
        onChange={(e) => setDecision(e.target.value)}
      />
      <Button
        size="sm"
        disabled={!topic.trim() || m.addMinuteItem.isPending}
        onClick={submit}
      >
        {m.addMinuteItem.isPending && (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        )}
        Add item
      </Button>
    </div>
  );
}

function ActionsSection({
  meeting,
  m,
  users,
}: {
  meeting: MeetingDetail;
  m: Mutations;
  users: WorkspaceUser[];
}) {
  const userName = (id: string | null) =>
    id ? (users.find((u) => u.userId === id)?.user?.name ?? id) : null;
  // A bulk-imported action carries no assignee (the CSV has no assignee
  // column) — it reaches nobody until someone delegates it. There is no
  // route to set assigneeId on an existing action (see the server's
  // comment in apps/api/src/meeting/index.ts), so "delegating" it means
  // recording a new, assigned action against the same minute item (and with
  // the same description, so it doesn't have to be retyped) via the form
  // below. `prefill` pre-fills that form and remounts it (via `seq`) so its
  // internal state actually picks the values up, then scrolls it into view —
  // making the existing assign control reachable for this specific
  // unassigned action rather than merely present somewhere on the page.
  const [prefill, setPrefill] = useState<{
    minuteItemId: string;
    description: string;
    seq: number;
  } | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const delegate = (action: MeetingAction) => {
    setPrefill({
      minuteItemId: action.minuteItemId ?? "",
      description: action.description,
      seq: Date.now(),
    });
    // Optional-called, not just optional-accessed: jsdom's HTMLElement has
    // no scrollIntoView at all (unlike a real browser), so this would throw
    // in every test that exercises Delegate otherwise.
    formRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {meeting.actions.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No follow-up actions recorded.
          </p>
        )}
        {meeting.actions.map((action) => {
          const isUnassigned = !action.assigneeId;
          const isDone = action.status === "done";
          // The complete route 409s on anything that isn't an open,
          // accepted action (still-pending acceptance, a rejected/cancelled
          // action) — offering the control before that just invites the
          // error, so it must not render until it can actually succeed.
          const canComplete =
            action.status === "open" && action.acceptance === "accepted";
          return (
            <div
              key={action.id}
              className="space-y-1.5 rounded-md border border-border px-3 py-2 text-sm"
            >
              {/* Clamped: an imported action's description can be
                  `topic — details`, and `details` may be a whole paragraph —
                  without a clamp that paragraph becomes the entire card. */}
              <p className="line-clamp-3 whitespace-pre-wrap">
                {action.description}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                {action.assigneeId ? (
                  <span>Assigned to {userName(action.assigneeId)}</span>
                ) : (
                  // Once done, there's nothing left needing delegation — the
                  // marker and its Delegate button would be a stale prompt
                  // for work that's already closed out.
                  !isDone && (
                    <>
                      <Badge
                        variant="warning"
                        className="flex items-center gap-1 text-xs"
                      >
                        <UserX className="h-3 w-3" />
                        Unassigned — needs delegating
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-1.5"
                        onClick={() => delegate(action)}
                      >
                        Delegate
                      </Button>
                    </>
                  )
                )}
                {action.dueAt && (
                  <span>Due {formatDateMedium(action.dueAt)}</span>
                )}
                <Badge
                  variant={isDone ? "success" : "outline"}
                  className="text-xs"
                >
                  {action.status}
                </Badge>
                {/* An unassigned action is created with acceptance
                    "accepted" by convention (there's no assignee to accept
                    anything), so this must only ever render for an assigned
                    action — showing it here would misleadingly read as
                    "awaiting someone" when nothing is. */}
                {action.assigneeId && action.acceptance !== "accepted" && (
                  <Badge variant="outline" className="text-xs">
                    {action.acceptance}
                  </Badge>
                )}
                {/* There was previously no way at all, anywhere in the web
                    app, to complete a meeting action — the API route has
                    always existed and is integration-tested, but had zero
                    web callers. Without this, a delegated unassigned action
                    is a permanent card: Delegate mints a new one every click
                    and nothing ever closes the original out. */}
                {canComplete && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto h-6 px-1.5"
                    disabled={m.completeAction.isPending}
                    onClick={() => m.completeAction.mutate(action.id)}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Mark done
                  </Button>
                )}
              </div>
              {isUnassigned && !isDone && (
                <p className="text-muted-foreground text-xs">
                  Delegate records a new, assigned action for this item — once
                  that's recorded, mark this placeholder done.
                </p>
              )}
            </div>
          );
        })}
      </div>
      {/* Actions stay editable even on an adopted meeting — accepting and
          completing delegated actions is the work adoption sets in motion,
          so this form is never gated on meeting.status. */}
      <div ref={formRef}>
        <AddActionForm
          key={prefill?.seq ?? "default"}
          meeting={meeting}
          m={m}
          users={users}
          initialMinuteItemId={prefill?.minuteItemId}
          initialDescription={prefill?.description}
        />
      </div>
    </div>
  );
}

function AddActionForm({
  meeting,
  m,
  users,
  initialMinuteItemId,
  initialDescription,
}: {
  meeting: MeetingDetail;
  m: Mutations;
  users: WorkspaceUser[];
  /**
   * Set when "Delegate" was clicked on an unassigned action — the parent
   * remounts this form (via a changing `key`) whenever it changes, so this
   * only needs to seed initial state, not react to later prop updates.
   */
  initialMinuteItemId?: string;
  /**
   * Also seeded from Delegate, so the imported text doesn't have to be
   * retyped verbatim — submit is disabled while `description` is empty, so
   * without this the user's first step would always be typing it back in.
   */
  initialDescription?: string;
}) {
  const [description, setDescription] = useState(initialDescription ?? "");
  const [minuteItemId, setMinuteItemId] = useState(initialMinuteItemId ?? "");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueAt, setDueAt] = useState<Date | null>(null);

  const reset = () => {
    setDescription("");
    setMinuteItemId("");
    setAssigneeId("");
    setDueAt(null);
  };

  const submit = () => {
    m.addAction.mutate(
      {
        description: description.trim(),
        minuteItemId: minuteItemId || undefined,
        assigneeId: assigneeId || undefined,
        dueAt: dueAt ? dueAt.toISOString() : undefined,
      },
      { onSuccess: reset },
    );
  };

  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <h4 className="font-medium text-sm">Record a follow-up action</h4>
      <Textarea
        value={description}
        placeholder="What needs to be done…"
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          value={minuteItemId}
          onValueChange={onSelectValueChange(setMinuteItemId)}
        >
          <SelectTrigger>
            <SelectValue>
              {minuteItemId
                ? (meeting.minuteItems.find((i) => i.id === minuteItemId)
                    ?.topic ?? minuteItemId)
                : "No minute item (optional)"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {meeting.minuteItems.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.topic}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={assigneeId}
          onValueChange={onSelectValueChange(setAssigneeId)}
        >
          <SelectTrigger>
            <SelectValue>
              {assigneeId
                ? (users.find((u) => u.userId === assigneeId)?.user?.name ??
                  assigneeId)
                : "No assignee (note only)"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {users.map((u) => (
              <SelectItem key={u.userId} value={u.userId}>
                {u.user?.name ?? u.userId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DateField
        value={dueAt}
        onChange={setDueAt}
        placeholder="Due date (optional)"
      />
      {meeting.confidential && assigneeId && (
        <p className="text-muted-foreground text-xs">
          This meeting is confidential — assigning to someone who cannot read it
          will be refused.
        </p>
      )}
      <Button
        size="sm"
        disabled={!description.trim() || m.addAction.isPending}
        onClick={submit}
      >
        {m.addAction.isPending && (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        )}
        Record action
      </Button>
    </div>
  );
}
