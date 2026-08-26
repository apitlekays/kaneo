import { getApiUrl } from "@/fetchers/get-api-url";

async function jsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
const jsonHeaders = { "Content-Type": "application/json" };
const url = (path: string) => getApiUrl(`meeting/${path}`);

// Naming: this is the organisation-level meeting-minutes module
// (`meeting_*` tables). Two other unrelated features are also colloquially
// "minutes" in this codebase — project minutes-of-meeting (`task_mom`) and
// correspondence minuting (`letter_minute`). Everything here is named after
// "meeting", never bare "minutes", so a grep for one module doesn't surface
// the others.

export type Meeting = {
  id: string;
  workspaceId: string;
  title: string;
  meetingTypeId: string | null;
  bodyId: string | null;
  scheduledAt: string | null;
  location: string | null;
  confidential: boolean;
  status: "draft" | "adopted";
  adoptedAt: string | null;
  adoptedByMeetingId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MeetingAttendee = {
  id: string;
  meetingId: string;
  userId: string | null;
  name: string | null;
  attendance: "present" | "apology" | "absent";
  createdAt: string;
};

export type MeetingMinuteItem = {
  id: string;
  meetingId: string;
  position: number;
  agenda: string;
  discussion: string | null;
  decision: string | null;
  createdAt: string;
};

// Not yet exposed by a route (a later task appends the ACTION routes), but
// shaped from `meetingActionTable` in apps/api/src/database/schema.ts so the
// UI layer can be typed ahead of it.
export type MeetingAction = {
  id: string;
  meetingId: string;
  minuteItemId: string | null;
  assigneeId: string | null;
  fromUserId: string | null;
  description: string;
  dueAt: string | null;
  acceptance: "pending" | "accepted" | "rejected";
  rejectionReason: string | null;
  status: "open" | "done" | "cancelled";
  completedAt: string | null;
  completedBy: string | null;
  createdAt: string;
};

export type MeetingDetail = Meeting & {
  attendees: MeetingAttendee[];
  minuteItems: MeetingMinuteItem[];
  adoptedByMeeting: { id: string; title: string } | null;
};

export type CreateMeetingInput = {
  title: string;
  meetingTypeId?: string;
  bodyId?: string;
  scheduledAt?: string;
  location?: string;
  confidential?: boolean;
};

export type UpdateMeetingInput = Partial<CreateMeetingInput>;

export type AddAttendeeInput = {
  userId?: string;
  name?: string;
  attendance?: "present" | "apology" | "absent";
};

export type AddMinuteItemInput = {
  agenda: string;
  discussion?: string;
  decision?: string;
  position?: number;
};

export type UpdateMinuteItemInput = Partial<AddMinuteItemInput>;

function post<T>(path: string, workspaceId: string, body: object): Promise<T> {
  return fetch(url(path), {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ workspaceId, ...body }),
  }).then(jsonOrThrow<T>);
}

function put<T>(path: string, workspaceId: string, body: object): Promise<T> {
  return fetch(url(path), {
    method: "PUT",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ workspaceId, ...body }),
  }).then(jsonOrThrow<T>);
}

export async function listMeetings(workspaceId: string): Promise<Meeting[]> {
  return jsonOrThrow(
    await fetch(url(`?workspaceId=${encodeURIComponent(workspaceId)}`), {
      credentials: "include",
    }),
  );
}

export async function getMeeting(
  workspaceId: string,
  id: string,
): Promise<MeetingDetail> {
  return jsonOrThrow(
    await fetch(url(`${id}?workspaceId=${encodeURIComponent(workspaceId)}`), {
      credentials: "include",
    }),
  );
}

export const createMeeting = (workspaceId: string, body: CreateMeetingInput) =>
  post<Meeting>("", workspaceId, body);

export const updateMeeting = (
  workspaceId: string,
  id: string,
  body: UpdateMeetingInput,
) => put<Meeting>(`${id}`, workspaceId, body);

export const addAttendee = (
  workspaceId: string,
  id: string,
  body: AddAttendeeInput,
) => post<MeetingAttendee>(`${id}/attendees`, workspaceId, body);

export const removeAttendee = (
  workspaceId: string,
  id: string,
  attendeeId: string,
) =>
  fetch(
    url(
      `${id}/attendees/${attendeeId}?workspaceId=${encodeURIComponent(workspaceId)}`,
    ),
    { method: "DELETE", credentials: "include" },
  ).then(jsonOrThrow<{ success: boolean }>);

export const addMinuteItem = (
  workspaceId: string,
  id: string,
  body: AddMinuteItemInput,
) => post<MeetingMinuteItem>(`${id}/minute-items`, workspaceId, body);

export const updateMinuteItem = (
  workspaceId: string,
  id: string,
  itemId: string,
  body: UpdateMinuteItemInput,
) => put<MeetingMinuteItem>(`${id}/minute-items/${itemId}`, workspaceId, body);

export const adoptMeeting = (
  workspaceId: string,
  id: string,
  adoptedByMeetingId: string,
) => post<Meeting>(`${id}/adopt`, workspaceId, { adoptedByMeetingId });
