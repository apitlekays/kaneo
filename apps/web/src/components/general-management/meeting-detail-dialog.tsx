import {
  CheckCircle2,
  ClipboardList,
  Info,
  Loader2,
  Lock,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import type { MeetingDetail } from "@/fetchers/meeting";
import { useMeeting } from "@/hooks/queries/meeting/use-meeting";
import { formatDateMedium } from "@/lib/format";

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
  const { data, isLoading } = useMeeting(workspaceId, meetingId);
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
        {isLoading || !data ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Body meeting={data} section={section} setSection={setSection} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  meeting,
  section,
  setSection,
}: {
  meeting: MeetingDetail;
  section: string;
  setSection: (v: string) => void;
}) {
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
          <OverviewSection meeting={meeting} />
        </DialogSidebarPanel>
        <DialogSidebarPanel value="attendees">
          <AttendeesSection meeting={meeting} />
        </DialogSidebarPanel>
        <DialogSidebarPanel value="minutes">
          <MinuteItemsSection meeting={meeting} />
        </DialogSidebarPanel>
        <DialogSidebarPanel value="actions">
          <ActionsSection meeting={meeting} />
        </DialogSidebarPanel>
      </DialogSidebar>
    </>
  );
}

function OverviewSection({ meeting }: { meeting: MeetingDetail }) {
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
    </div>
  );
}

function AttendeesSection({ meeting }: { meeting: MeetingDetail }) {
  return (
    <div className="space-y-2">
      {meeting.attendees.length === 0 && (
        <p className="text-muted-foreground text-sm">No attendees recorded.</p>
      )}
      {meeting.attendees.map((a) => (
        <div
          key={a.id}
          className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
        >
          <span>{a.name ?? a.userId}</span>
          <Badge className="border text-xs">{a.attendance}</Badge>
        </div>
      ))}
    </div>
  );
}

function MinuteItemsSection({ meeting }: { meeting: MeetingDetail }) {
  return (
    <div className="space-y-2">
      {meeting.minuteItems.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No minute items recorded.
        </p>
      )}
      {meeting.minuteItems.map((item) => (
        <div
          key={item.id}
          className="space-y-1 rounded-md border border-border px-3 py-2 text-sm"
        >
          <div className="font-medium">{item.agenda}</div>
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
      ))}
    </div>
  );
}

function ActionsSection({ meeting }: { meeting: MeetingDetail }) {
  return (
    <div className="space-y-2">
      {meeting.actions.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No follow-up actions recorded.
        </p>
      )}
      {meeting.actions.map((action) => (
        <div
          key={action.id}
          className="space-y-1.5 rounded-md border border-border px-3 py-2 text-sm"
        >
          <p>{action.description}</p>
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
            {action.assigneeId && <span>Assigned to {action.assigneeId}</span>}
            {action.dueAt && <span>Due {formatDateMedium(action.dueAt)}</span>}
            <Badge
              variant={action.status === "done" ? "success" : "outline"}
              className="text-xs"
            >
              {action.status}
            </Badge>
            {action.acceptance !== "accepted" && (
              <Badge variant="outline" className="text-xs">
                {action.acceptance}
              </Badge>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
