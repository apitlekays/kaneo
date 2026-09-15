import { getApiUrl } from "@/fetchers/get-api-url";
import {
  type CompressionResult,
  compressPdfIfScanned,
  type PdfEngine,
} from "@/lib/compress-pdf";
import { isPdfUpload } from "@/lib/is-pdf-upload";

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

// ── Action progress thread ──────────────────────────────────────────────

/**
 * An update's attachment, as `GET /:id/actions/:actionId/updates` embeds it
 * per update — a narrower view of `MeetingDocument` than the create/finalize
 * response: no `objectKey` (internal storage detail; the download route
 * takes the document's `id`, not it), no `meetingId`/`actionUpdateId`/
 * `workspaceId`/`mimeType`/`sha256`/`kind`/`createdBy` (redundant once the
 * document is already grouped under its update).
 */
export type MeetingActionUpdateAttachment = Pick<
  MeetingDocument,
  "id" | "filename" | "size" | "createdAt"
>;

/**
 * A row in one action's append-only progress thread. There is no PUT/PATCH/
 * DELETE for this row anywhere in the API, by design — do not add UI that
 * implies one exists.
 */
export type MeetingActionUpdate = {
  id: string;
  actionId: string;
  authorId: string | null;
  body: string;
  statusAfter: MeetingAction["status"] | null;
  createdAt: string;
  attachments: MeetingActionUpdateAttachment[];
};

export type AddActionUpdateInput = {
  body: string;
  statusAfter?: MeetingAction["status"];
};

export async function listActionUpdates(
  workspaceId: string,
  id: string,
  actionId: string,
): Promise<MeetingActionUpdate[]> {
  return jsonOrThrow(
    await fetch(
      url(
        `${id}/actions/${actionId}/updates?workspaceId=${encodeURIComponent(workspaceId)}`,
      ),
      { credentials: "include" },
    ),
  );
}

export const postActionUpdate = (
  workspaceId: string,
  id: string,
  actionId: string,
  body: AddActionUpdateInput,
) =>
  post<MeetingActionUpdate>(
    `${id}/actions/${actionId}/updates`,
    workspaceId,
    body,
  );

// ── Meeting documents (attachments) ─────────────────────────────────────

/**
 * A PDF attached either at the meeting level (archival, not built yet) or to
 * one action update (`actionUpdateId` set) — mirrors `meetingDocumentTable`.
 */
export type MeetingDocument = {
  id: string;
  meetingId: string;
  actionUpdateId: string | null;
  workspaceId: string;
  objectKey: string;
  filename: string;
  mimeType: string;
  size: number;
  sha256: string | null;
  kind: string;
  createdBy: string | null;
  createdAt: string;
};

export type MeetingDocumentPresignResult = {
  key: string;
  uploadUrl: string;
  headers: Record<string, string>;
};

export type PresignMeetingDocumentInput = {
  filename: string;
  mimeType: string;
  size: number;
  actionUpdateId?: string;
};

/** The three archival kinds the finalize route's `v.picklist` accepts. A
 * reply attachment sends none of them and keeps the server's "original"
 * default. */
export type MeetingDocumentKind = "transcript" | "minutes" | "other";

export type FinalizeMeetingDocumentInput = {
  objectKey: string;
  filename: string;
  mimeType: string;
  size: number;
  actionUpdateId?: string;
  kind?: MeetingDocumentKind;
  /** The uncompressed copy, when the client actually compressed. Left out
   * means `objectKey` IS the original — see `uploadArchivalMeetingDocument`. */
  originalObjectKey?: string;
};

export const presignMeetingDocument = (
  workspaceId: string,
  id: string,
  body: PresignMeetingDocumentInput,
) =>
  post<MeetingDocumentPresignResult>(
    `${id}/attachments/presign`,
    workspaceId,
    body,
  );

export const finalizeMeetingDocument = (
  workspaceId: string,
  id: string,
  body: FinalizeMeetingDocumentInput,
) => post<MeetingDocument>(`${id}/attachments/finalize`, workspaceId, body);

export const meetingDocumentDownloadUrl = (
  workspaceId: string,
  id: string,
  docId: string,
) =>
  url(
    `${id}/attachments/${docId}/download?workspaceId=${encodeURIComponent(workspaceId)}`,
  );

// ── Configure -> send memorandum ────────────────────────────────────────
// `GET`/`POST /:id/actions/:actionId/memo` — see the server's
// `apps/api/src/meeting/memo-routes.ts` for the full contract. Both routes
// gate on General Management page access AND `assertCanReadMeeting`, so a
// confidential meeting stays closed to a non-attendee even here.

/**
 * The shortcode values `GET .../memo` resolves for one action — from the
 * meeting (`meeting_name`/`meeting_date`), the action or its linked minute
 * item (`numbering`/`topic`/`status` — the server, not this app, decides
 * which source wins; see `resolveBaseValues` in memo-routes.ts), and the
 * two the user fills in (`recipient_name`/`notes`, always empty on GET).
 */
export type MeetingActionMemoValues = {
  meeting_name: string;
  meeting_date: string;
  numbering: string;
  topic: string;
  status: string;
  recipient_name: string;
  notes: string;
};

/** One past send of the memorandum for an action, as embedded in the GET's
 * `lastSend` and returned whole by the POST — surfaced so the Configure
 * popup can show "already sent" instead of inviting a duplicate. */
export type MeetingActionMemoSend = {
  id: string;
  recipientName: string;
  recipientEmail: string;
  cc: string[] | null;
  replyTo: string;
  subject: string;
  bodyHtml: string;
  sentAt: string;
};

export type MeetingActionMemoContext = {
  /** The default body, as Markdown, with `{{shortcode}}` tokens in it —
   * never HTML. See `apps/api/src/meeting/memorandum.ts`'s `MEMO_SHORTCODES`
   * for the vocabulary (mirrored, not imported, in
   * `action-configure-dialog.tsx` — that module is the API's internals). */
  defaultTemplate: string;
  values: MeetingActionMemoValues;
  lastSend: MeetingActionMemoSend | null;
};

export type SendMeetingActionMemoInput = {
  recipientName: string;
  recipientEmail: string;
  notes?: string;
  replyTo?: string;
  cc?: string[];
  /** Markdown ONLY — the route rejects (or worse, mis-renders) HTML. See
   * `buildMemorandumHtml`'s docstring in the API for why. */
  bodyMarkdown: string;
};

export async function getActionMemoContext(
  workspaceId: string,
  id: string,
  actionId: string,
): Promise<MeetingActionMemoContext> {
  return jsonOrThrow(
    await fetch(
      url(
        `${id}/actions/${actionId}/memo?workspaceId=${encodeURIComponent(workspaceId)}`,
      ),
      { credentials: "include" },
    ),
  );
}

export const sendActionMemo = (
  workspaceId: string,
  id: string,
  actionId: string,
  body: SendMeetingActionMemoInput,
) =>
  post<MeetingActionMemoSend>(
    `${id}/actions/${actionId}/memo`,
    workspaceId,
    body,
  );

/**
 * Presign -> direct PUT to storage -> finalize, mirroring
 * `uploadLetterAttachment` in `correspondence/letters.ts`.
 *
 * Both server routes reject a `mimeType` other than `application/pdf`.
 *
 * Be clear about what that check is worth here: `isPdfUpload` below admits
 * only `application/pdf`, or an empty type with a `.pdf` name. So the value
 * this client can possibly send is `application/pdf` either way, and the
 * server is validating a claim the client is structurally certain to make
 * — NOT the file. Nothing anywhere reads the bytes, so payload.exe renamed
 * to payload.pdf is accepted.
 *
 * Real enforcement is a magic-byte check at finalize, tracked separately
 * and deliberately not done here. Until then the blast radius is bounded by
 * two things, both verified: the presigned PUT binds Content-Type into its
 * signature, and the download route sends `X-Content-Type-Options: nosniff`.
 * A mislabelled file is stored wrongly and renders as a broken PDF; it is
 * not executed.
 */
export async function uploadMeetingDocument(
  workspaceId: string,
  id: string,
  file: File,
  actionUpdateId?: string,
): Promise<MeetingDocument> {
  if (!isPdfUpload(file)) {
    throw new Error("Only PDF files can be attached");
  }
  const served = await putOne(workspaceId, id, file, actionUpdateId);
  return finalizeMeetingDocument(workspaceId, id, {
    objectKey: served.key,
    filename: file.name,
    mimeType: served.contentType,
    size: file.size,
    actionUpdateId,
  });
}

/**
 * One presign + one direct PUT: the byte-moving half of an upload, with no
 * opinion about the row that records it. Extracted because an archival
 * document uploads the same bytes twice — compressed and original — and
 * finalizes once with both keys.
 */
async function putOne(
  workspaceId: string,
  id: string,
  file: File,
  actionUpdateId?: string,
): Promise<{ key: string; contentType: string }> {
  // Given `isPdfUpload` upstream this resolves to "application/pdf" for
  // every file that reaches it: `file.type` is either that already, or empty
  // for the typeless `.pdf` case (how several Android file providers report
  // a perfectly good PDF), where sending "" would have the server 400 a file
  // the client had just accepted.
  //
  // Written as the expression rather than the literal on purpose: it is
  // `isPdfUpload`, not this line, that decides what may be uploaded, so if
  // that gate is ever widened the file's real type flows through instead of
  // a fabricated one. It is NOT a claim that the real type is sent today.
  const contentType = file.type || "application/pdf";
  const presign = await presignMeetingDocument(workspaceId, id, {
    filename: file.name,
    mimeType: contentType,
    size: file.size,
    actionUpdateId,
  });
  const put = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: presign.headers,
    body: file,
  });
  if (!put.ok) throw new Error("Upload to storage failed");
  return { key: presign.key, contentType };
}

// ── Archival documents (Spec D) ─────────────────────────────────────────
// Meeting-level PDFs, indexed for search. `GET /:id/documents` and
// `POST /:id/documents/:docId/reindex` — see the server's
// `apps/api/src/meeting/documents.ts`. Reply attachments are excluded from
// both by an `actionUpdateId IS NULL` term, so nothing here ever sees one.

export type MeetingDocumentIndexStatus = "pending" | "indexed" | "failed";

/**
 * One row of the archival shelf, exactly as the list route narrows it. No
 * `objectKey`/`originalObjectKey`: they are internal storage detail and the
 * download route is the only way to the bytes.
 */
export type MeetingArchivalDocument = {
  id: string;
  filename: string;
  size: number;
  kind: string;
  indexStatus: MeetingDocumentIndexStatus;
  indexedAt: string | null;
  indexError: string | null;
  createdBy: string | null;
  createdAt: string;
};

export async function listMeetingDocuments(
  workspaceId: string,
  id: string,
): Promise<MeetingArchivalDocument[]> {
  return jsonOrThrow(
    await fetch(
      url(`${id}/documents?workspaceId=${encodeURIComponent(workspaceId)}`),
      { credentials: "include" },
    ),
  );
}

/**
 * Queue a document for extraction again. `workspaceId` travels in the QUERY
 * STRING, not the body: the route is `workspaceAccess.fromQuery`, so a body
 * is rejected by the query validator before the handler runs.
 */
export async function reindexMeetingDocument(
  workspaceId: string,
  id: string,
  docId: string,
): Promise<MeetingArchivalDocument> {
  return jsonOrThrow(
    await fetch(
      url(
        `${id}/documents/${docId}/reindex?workspaceId=${encodeURIComponent(workspaceId)}`,
      ),
      { method: "POST", credentials: "include" },
    ),
  );
}

/**
 * Compress, then upload one or two copies.
 *
 * `compressPdfIfScanned` SKIPS a PDF that already has a text layer, so a
 * digital PDF yields ONE copy and `originalObjectKey` stays undefined; only
 * a true scan, actually rasterised, produces two. That is why the server
 * treats a null original as "objectKey is the original" rather than
 * requiring both — and why this must not upload twice unconditionally,
 * which would double storage for every digital PDF for no benefit.
 *
 * `opts.compression` lets a caller that already ran the compression pass
 * its result in. The uploader component does exactly that: it drives
 * `usePdfCompression` itself for the per-page progress it shows, and
 * compressing the same file a second time here would be pure waste.
 */
export async function uploadArchivalMeetingDocument(
  workspaceId: string,
  id: string,
  file: File,
  kind: MeetingDocumentKind,
  opts: { compression?: CompressionResult; engine?: PdfEngine } = {},
): Promise<MeetingDocument> {
  if (!isPdfUpload(file)) {
    throw new Error("Only PDF files can be attached");
  }
  const result =
    opts.compression ??
    (await compressPdfIfScanned(file, { engine: opts.engine }));
  const served = await putOne(workspaceId, id, result.file);
  // Only upload a second copy when compression actually changed the bytes.
  const original =
    result.skipped === null ? await putOne(workspaceId, id, file) : null;
  return finalizeMeetingDocument(workspaceId, id, {
    objectKey: served.key,
    originalObjectKey: original?.key,
    filename: file.name,
    mimeType: served.contentType,
    size: result.file.size,
    kind,
  });
}
