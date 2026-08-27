import { getApiUrl } from "@/fetchers/get-api-url";

/**
 * Reduce a failed response's body to one short, human-readable line.
 *
 * Two shapes reach here: a hand-thrown `HTTPException(400, { message })`
 * (e.g. "Title required"), whose body is that plain string, and a Valibot
 * `validator("json"/"query", …)` middleware rejection — hit *before* the
 * route handler runs — whose body is a JSON blob like
 * `{"data":{...},"error":[{...}],"success":false}`, the entire issue tree
 * serialized. Fed straight into a toast (every mutation's `onError` in
 * `use-meeting-mutations.ts` does exactly that with `error.message`), the
 * second shape is an unreadable wall of JSON. This is the one seam every
 * caller goes through, so fixing it here fixes it for all of them at once
 * rather than each `onError` re-parsing the body itself.
 *
 * Not reachable from today's UI (it always sends well-typed payloads), but
 * a latent trap for the next field added to a form or any other caller.
 */
async function formatErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text.trim() || `Request failed (${response.status})`;
  }

  if (parsed && typeof parsed === "object") {
    const body = parsed as Record<string, unknown>;
    if (typeof body.message === "string" && body.message.trim()) {
      return body.message;
    }
    if (Array.isArray(body.error) && body.error.length > 0) {
      const [firstIssue] = body.error;
      if (
        firstIssue &&
        typeof firstIssue === "object" &&
        typeof (firstIssue as Record<string, unknown>).message === "string"
      ) {
        return (firstIssue as { message: string }).message;
      }
    }
  }

  return `Request failed (${response.status})`;
}

async function jsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await formatErrorMessage(response));
  return response.json();
}
const jsonHeaders = { "Content-Type": "application/json" };
/**
 * Hono routes strictly: `/api/meeting` and `/api/meeting/` are different
 * paths, and only the first is registered — a trailing slash 404s. The
 * collection endpoints pass either an empty path (create) or a bare query
 * string (list), so join the segment only when there actually is one.
 *
 * Every integration test calls `/api/meeting` directly, so nothing exercised
 * this construction until it 404'd in the browser.
 */
const url = (path: string) =>
  getApiUrl(
    `meeting${path === "" || path.startsWith("?") ? path : `/${path}`}`,
  );

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

// Returned as part of `GET /meeting/:id`'s `actions` array, alongside
// `attendees` and `minuteItems`. Checked field-by-field against
// `meetingActionTable` (apps/api/src/database/schema.ts) and against the
// integration-test responses in tests/api-integration/meeting-actions.test.ts
// — no field needed correcting.
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
  actions: MeetingAction[];
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

export type AddActionInput = {
  description: string;
  minuteItemId?: string;
  assigneeId?: string;
  dueAt?: string;
};

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

export const addAction = (
  workspaceId: string,
  id: string,
  body: AddActionInput,
) => post<MeetingAction>(`${id}/actions`, workspaceId, body);
