import { getApiUrl } from "@/fetchers/get-api-url";

/** A single spreadsheet row's validation problem, as `POST
 * /:id/minute-items/import`'s 400 body carries it: `{ errors: [{ row,
 * message }] }`, already sorted by row (the row being the spreadsheet's,
 * not the array's — row 1 is the header, so the first data row is 2). */
export type MinuteItemImportRowError = { row: number; message: string };

/** An Error thrown for a failed import 400 additionally carries every row's
 * problem, not just the first — `formatErrorMessage`'s one-line summary
 * stays the throw's `.message` (for a toast), but a caller that wants to
 * show the whole list (this route's importer does) can read `.rowErrors`. */
export type MeetingFetchError = Error & {
  rowErrors?: MinuteItemImportRowError[];
};

/**
 * Reduce a failed response's body to one short, human-readable line, and —
 * when the body is `POST /:id/minute-items/import`'s row-error shape —
 * also surface the full row list for a caller that wants more than the
 * first.
 *
 * Three shapes reach here: a hand-thrown `HTTPException(400, { message })`
 * (e.g. "Title required"), whose body is that plain string; a Valibot
 * `validator("json"/"query", …)` middleware rejection — hit *before* the
 * route handler runs — whose body is a JSON blob like
 * `{"data":{...},"error":[{...}],"success":false}`, the entire issue tree
 * serialized; and the import route's `{ errors: [{ row, message }] }`. Fed
 * straight into a toast (every mutation's `onError` in
 * `use-meeting-mutations.ts` does exactly that with `error.message`), the
 * second shape is an unreadable wall of JSON. This is the one seam every
 * caller goes through, so fixing it here fixes it for all of them at once
 * rather than each `onError` re-parsing the body itself.
 *
 * The Valibot shape is not reachable from today's UI (it always sends
 * well-typed payloads), but is a latent trap for the next field added to a
 * form or any other caller.
 */
async function parseErrorBody(
  response: Response,
): Promise<{ message: string; rowErrors?: MinuteItemImportRowError[] }> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { message: text.trim() || `Request failed (${response.status})` };
  }

  if (parsed && typeof parsed === "object") {
    const body = parsed as Record<string, unknown>;
    if (typeof body.message === "string" && body.message.trim()) {
      return { message: body.message };
    }
    if (Array.isArray(body.errors) && body.errors.length > 0) {
      const rowErrors = body.errors.filter(
        (e): e is MinuteItemImportRowError =>
          Boolean(e) &&
          typeof e === "object" &&
          typeof (e as Record<string, unknown>).row === "number" &&
          typeof (e as Record<string, unknown>).message === "string",
      );
      if (rowErrors.length > 0) {
        // Render the first issue with its row number, since that's what
        // makes it actionable in Excel, and note how many more there were
        // rather than drowning a toast in every row's message — the full
        // list still travels on `.rowErrors` for a caller that wants it.
        const [first, ...rest] = rowErrors;
        return {
          message: `Row ${first.row}: ${first.message}${
            rest.length > 0 ? ` (and ${rest.length} more)` : ""
          }`,
          rowErrors,
        };
      }
    }
    if (Array.isArray(body.error) && body.error.length > 0) {
      const [firstIssue] = body.error;
      if (
        firstIssue &&
        typeof firstIssue === "object" &&
        typeof (firstIssue as Record<string, unknown>).message === "string"
      ) {
        return { message: (firstIssue as { message: string }).message };
      }
    }
  }

  return { message: `Request failed (${response.status})` };
}

async function jsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const { message, rowErrors } = await parseErrorBody(response);
    throw rowErrors
      ? Object.assign(new Error(message), { rowErrors })
      : new Error(message);
  }
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
  numbering: string | null;
  topic: string;
  discussion: string | null;
  status: string | null;
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

/**
 * The list route joins `meeting_type` and `meeting_body` to search their
 * names, so it can return the labels too — which is what the cards display.
 * The detail route does not join, so `MeetingDetail` has no such fields.
 */
export type MeetingListItem = Meeting & {
  meetingTypeLabel: string | null;
  bodyName: string | null;
};

export type MeetingPage = {
  items: MeetingListItem[];
  nextCursor: string | null;
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
  topic: string;
  numbering?: string;
  status?: string;
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

export async function listMeetings(
  workspaceId: string,
  opts: { cursor?: string; q?: string; limit?: number } = {},
): Promise<MeetingPage> {
  const params = new URLSearchParams({ workspaceId });
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.q) params.set("q", opts.q);
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  return jsonOrThrow(
    await fetch(url(`?${params.toString()}`), { credentials: "include" }),
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

/**
 * The API's `POST /:id/actions/:actionId/complete` route has existed since
 * before this bulk-import feature and is integration-tested, but had no web
 * caller at all — an imported action with no assignee had no way to ever be
 * marked done from the UI, making its "needs delegating" state permanent.
 */
export const completeMeetingAction = (
  workspaceId: string,
  id: string,
  actionId: string,
) => post<MeetingAction>(`${id}/actions/${actionId}/complete`, workspaceId, {});

export type MinuteItemImportRow = {
  numbering?: string;
  topic?: string;
  details?: string;
  status?: string;
  action?: string;
};

export type MinuteItemImportResult = {
  itemsCreated: number;
  actionsCreated: number;
};

export const importMinuteItems = (
  workspaceId: string,
  id: string,
  rows: MinuteItemImportRow[],
) =>
  post<MinuteItemImportResult>(`${id}/minute-items/import`, workspaceId, {
    rows,
  });
