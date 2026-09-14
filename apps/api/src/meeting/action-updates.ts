import { and, asc, eq, inArray } from "drizzle-orm";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import db from "../database";
import {
  meetingActionTable,
  meetingActionUpdateTable,
  meetingDocumentTable,
} from "../database/schema";
import {
  applyKeyPrefix,
  assertStorageConfigured,
  createMeetingFileUploadUrl,
  getPrivateObject,
  meetingFileKeyOwnerSegment,
} from "../storage/s3";
import { buildContentDisposition } from "../utils/content-disposition";
import { hasWorkspacePageAccess } from "../utils/page-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { assertCanReadMeeting, loadMeeting } from "./access";
import { canPostActionUpdate } from "./update-access";

// Context variables populated by the auth + workspace-access middleware.
type MeetingEnv = { Variables: { userId: string; workspaceId?: string } };

const PAGE_SLUG = "general-management";
const ACTION_STATUSES = ["open", "done", "cancelled"] as const;
const MEETING_DOCUMENT_MIME_TYPE = "application/pdf";
const MAX_FILENAME_LENGTH = 255;

// Rejects ASCII control characters (incl. CR/LF — response-splitting into
// the download route's Content-Disposition header), the double quote (which
// breaks out of that header's quoted-string filename parameter), and path
// separators (a filename is a display name, never a path). Unicode letters
// (Malay, Arabic-script, …) are deliberately unrestricted — this deployment
// has real filenames in those scripts a plain-ASCII filter would reject.
// Defense at the input boundary, in addition to (not instead of) safe
// encoding on the way out.
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters (incl. CR/LF) are exactly what this pattern must reject.
const SAFE_FILENAME_PATTERN = /^[^\u0000-\u001f\u007f"\\/]+$/u;

const meetingDocumentFilename = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1, "Filename required"),
  v.maxLength(MAX_FILENAME_LENGTH, "Filename is too long"),
  v.regex(SAFE_FILENAME_PATTERN, "Filename contains invalid characters"),
);
// `v.optional(v.string())` would accept `""`, which `?? null` at the
// finalize write site does NOT map to null — it would persist as a value
// that is neither a valid reply attachment (no matching update) nor a
// valid meeting-level document (not actually null), and is then invisible
// to both `eq(actionUpdateId, x)` and `isNull(actionUpdateId)` lookups.
// Reject the empty string at the door instead of only patching the write.
const optionalActionUpdateId = v.optional(
  v.pipe(v.string(), v.trim(), v.minLength(1)),
);

async function loadAction(meetingId: string, actionId: string) {
  const [row] = await db
    .select()
    .from(meetingActionTable)
    .where(
      and(
        eq(meetingActionTable.id, actionId),
        eq(meetingActionTable.meetingId, meetingId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * PDF only — the first check in `assertCanAttachMeetingDocument`, so it
 * cannot be forgotten by a future caller of the gate (Spec D adds one).
 * Kept as its own function since the read-side gate below has no MIME type
 * to check at all.
 */
function assertPdfOnly(mimeType: string): void {
  if (mimeType !== MEETING_DOCUMENT_MIME_TYPE)
    throw new HTTPException(400, {
      message: "Only PDF files may be attached",
    });
}

/**
 * Attachment gate shared by presign and finalize — the meeting-shaped twin
 * of `assertCanAttach` in `correspondence/letters.ts:205`. That module
 * learned the hard way that gating finalize alone leaves the feature
 * unreachable: the caller can never obtain an upload URL. Both routes below
 * call this one function.
 *
 * PDF-only first: cheap, and refuses the request before any DB/S3 work.
 *
 * Confidentiality next (`assertCanReadMeeting`): `canPostActionUpdate`
 * alone would let a General Management page holder who is NOT an attendee
 * attach to a confidential meeting's action, since page access alone
 * satisfies it. That would be exactly the title/data leak this module has
 * shipped three times before — see `access.ts` and the "Confidentiality
 * first" comment on the updates POST route above.
 *
 * With no `actionUpdateId` (a meeting-level document — Spec D's archival
 * PDFs, not built here), the only gate is holding the General Management
 * page, same as an ordinary attachment on the letters module. With
 * `actionUpdateId` set, the update must belong to an action on THIS
 * meeting (404 otherwise), and only that action's assignee or a page holder
 * may attach — reusing `canPostActionUpdate` rather than re-deriving it.
 */
async function assertCanAttachMeetingDocument(
  userId: string,
  workspaceId: string,
  meeting: { id: string; confidential: boolean },
  actionUpdateId: string | undefined,
  mimeType: string,
): Promise<void> {
  assertPdfOnly(mimeType);
  await assertCanReadMeeting(userId, workspaceId, meeting);
  if (!actionUpdateId) {
    if (!(await hasWorkspacePageAccess(userId, workspaceId, PAGE_SLUG)))
      throw new HTTPException(403, {
        message: "You don't have access to this page",
      });
    return;
  }
  const [row] = await db
    .select({ actionAssigneeId: meetingActionTable.assigneeId })
    .from(meetingActionUpdateTable)
    .innerJoin(
      meetingActionTable,
      eq(meetingActionTable.id, meetingActionUpdateTable.actionId),
    )
    .where(
      and(
        eq(meetingActionUpdateTable.id, actionUpdateId),
        eq(meetingActionTable.meetingId, meeting.id),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Not found" });
  const hasPage = await hasWorkspacePageAccess(userId, workspaceId, PAGE_SLUG);
  if (
    !canPostActionUpdate({
      userId,
      hasPageAccess: hasPage,
      actionAssigneeId: row.actionAssigneeId,
    })
  )
    throw new HTTPException(403, {
      message:
        "Only the action's assignee or a GM officer can attach files here",
    });
}

/**
 * Read counterpart of `assertCanAttachMeetingDocument`, applied once the
 * document row is in hand. `assertCanReadMeeting` alone is not enough: it
 * returns true unconditionally for a non-confidential meeting, but an
 * attachment is thread content — the same reason
 * `GET /:id/actions/:actionId/updates` above layers `canPostActionUpdate`
 * on top of `assertCanReadMeeting` rather than relying on it alone.
 *
 * The update lookup is scoped by the document's own `meetingId`, the same
 * way the attach gate scopes it. Without that term, a `meeting_document`
 * row whose `actionUpdateId` points at an update on a *different* meeting
 * resolves that other action's assignee and grants them this download.
 * Unreachable while finalize is the only writer of the table (it 404s on a
 * cross-meeting `actionUpdateId`), but Spec D adds a second writer, and the
 * condition costs nothing.
 *
 * No 404-on-missing-join here (unlike the attach gate): a missing join only
 * means `actionAssigneeId` falls through to `null`, which still requires
 * page access to satisfy `canPostActionUpdate`, refusing safely rather
 * than throwing.
 */
async function assertCanReadMeetingDocument(
  userId: string,
  workspaceId: string,
  doc: { meetingId: string; actionUpdateId: string | null },
): Promise<void> {
  if (!doc.actionUpdateId) {
    if (!(await hasWorkspacePageAccess(userId, workspaceId, PAGE_SLUG)))
      throw new HTTPException(403, {
        message: "You don't have access to this page",
      });
    return;
  }
  const [row] = await db
    .select({ actionAssigneeId: meetingActionTable.assigneeId })
    .from(meetingActionUpdateTable)
    .innerJoin(
      meetingActionTable,
      eq(meetingActionTable.id, meetingActionUpdateTable.actionId),
    )
    .where(
      and(
        eq(meetingActionUpdateTable.id, doc.actionUpdateId),
        eq(meetingActionTable.meetingId, doc.meetingId),
      ),
    )
    .limit(1);
  const hasPage = await hasWorkspacePageAccess(userId, workspaceId, PAGE_SLUG);
  if (
    !canPostActionUpdate({
      userId,
      hasPageAccess: hasPage,
      actionAssigneeId: row?.actionAssigneeId ?? null,
    })
  )
    throw new HTTPException(403, {
      message: "Only the action's assignee or a GM officer can download this",
    });
}

/**
 * The action's own progress thread: routes for a single action's follow-up.
 * Mounted under `/meeting` at `/:id/actions/:actionId/updates` — see the
 * comment at the mount site in `index.ts` for why registration order
 * matters here.
 *
 * Follows the house convention (`correspondence/letters.ts`'s
 * `registerLetterRoutes`): this adds routes onto the `Hono` app it is
 * passed, rather than building and returning its own. `loadMeeting` /
 * `assertCanReadMeeting` come from `./access`, which both this module and
 * `index.ts` import — no dependency injection needed once neither side is
 * private to the other.
 */
export function registerActionUpdateRoutes(app: Hono<MeetingEnv>): void {
  // Immutable, append-only thread: no PUT/PATCH/DELETE exists for an update,
  // by design — see `meetingActionUpdateTable`'s comment in schema.ts. Do
  // not add one.
  //
  // Registered here, before any future `/:id/actions/:actionId` catch-all:
  // Hono matches literal path segments against parameterised ones in
  // registration order (same trap as "/bodies" vs "/:id" and
  // "/:id/minute-items/import" vs "/:id/minute-items/:itemId" elsewhere in
  // this module). There is no `POST /:id/actions/:actionId` today, so this
  // is latent rather than live — keep it ordered correctly regardless.
  app.post(
    "/:id/actions/:actionId/updates",
    describeRoute({
      operationId: "createMeetingActionUpdate",
      tags: ["Meeting"],
      description:
        "Append an update to a meeting action's progress thread, optionally changing its status",
    }),
    validator("param", v.object({ id: v.string(), actionId: v.string() })),
    validator(
      "json",
      v.object({
        workspaceId: v.string(),
        body: v.string(),
        statusAfter: v.optional(v.picklist(ACTION_STATUSES)),
      }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    async (c) => {
      const ws = c.get("workspaceId") as string;
      const callerId = c.get("userId") as string;
      const { id, actionId } = c.req.valid("param");
      const b = c.req.valid("json");
      const body = b.body.trim();
      if (!body)
        throw new HTTPException(400, { message: "Update body required" });

      const meeting = await loadMeeting(ws, id);
      if (!meeting) throw new HTTPException(404, { message: "Not found" });
      // Confidentiality first: write authority must never exceed read
      // authority (same rule `assertMeetingWriteAccess` states in index.ts).
      await assertCanReadMeeting(callerId, ws, meeting);

      const action = await loadAction(id, actionId);
      if (!action) throw new HTTPException(404, { message: "Not found" });

      const hasPage = await hasWorkspacePageAccess(callerId, ws, PAGE_SLUG);
      if (
        !canPostActionUpdate({
          userId: callerId,
          hasPageAccess: hasPage,
          actionAssigneeId: action.assigneeId,
        })
      )
        throw new HTTPException(403, {
          message: "Only the action's assignee or a GM officer can post here",
        });

      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(meetingActionUpdateTable)
          .values({
            actionId,
            authorId: callerId,
            body,
            statusAfter: b.statusAfter ?? null,
          })
          .returning();
        // Posting an update is not completing the action: this only sets
        // the status flag the update itself asserts. `completedAt` /
        // `completedBy`, and the acceptance precondition, belong solely to
        // `POST /:id/actions/:actionId/complete`.
        //
        // Deliberately asymmetric: posting `statusAfter: "open"` on an
        // already-completed action leaves `completedAt`/`completedBy` set,
        // with `status` reverted to "open". That is honest history —
        // "completed, then reopened in discussion" — not a bug. The thread
        // is allowed to move `status` in either direction, but it must
        // never erase the record of a formal completion that already
        // happened; only `/complete`'s own guard (see index.ts) governs
        // `completedAt`. Do not add code here to null it out on reopen.
        if (b.statusAfter) {
          await tx
            .update(meetingActionTable)
            .set({ status: b.statusAfter })
            .where(eq(meetingActionTable.id, actionId));
        }
        return row;
      });
      return c.json(created, 201);
    },
  );

  app.get(
    "/:id/actions/:actionId/updates",
    describeRoute({
      operationId: "listMeetingActionUpdates",
      tags: ["Meeting"],
      description: "The action's progress thread, oldest first",
    }),
    validator("param", v.object({ id: v.string(), actionId: v.string() })),
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    async (c) => {
      const ws = c.get("workspaceId") as string;
      const userId = c.get("userId") as string;
      const { id, actionId } = c.req.valid("param");

      const meeting = await loadMeeting(ws, id);
      if (!meeting) throw new HTTPException(404, { message: "Not found" });
      await assertCanReadMeeting(userId, ws, meeting);

      const action = await loadAction(id, actionId);
      if (!action) throw new HTTPException(404, { message: "Not found" });

      // The thread is a narrower surface than the meeting: reading it also
      // requires the same authority posting to it does (page holder or the
      // action's own assignee), mirroring `/:id/actions/:actionId/complete`
      // in index.ts. Without this, any plain workspace member who can read
      // a non-confidential meeting — which is nearly everyone — could read
      // every action's progress thread, though the same person is refused
      // `GET /:id` and the meeting list without the General Management page.
      const hasPage = await hasWorkspacePageAccess(userId, ws, PAGE_SLUG);
      if (
        !canPostActionUpdate({
          userId,
          hasPageAccess: hasPage,
          actionAssigneeId: action.assigneeId,
        })
      )
        throw new HTTPException(403, {
          message: "Only the action's assignee or a GM officer can read this",
        });

      const rows = await db
        .select()
        .from(meetingActionUpdateTable)
        .where(eq(meetingActionUpdateTable.actionId, actionId))
        .orderBy(asc(meetingActionUpdateTable.createdAt));

      // Attachments are thread content: fold them into each update's row
      // rather than exposing a separate list-documents endpoint, which
      // would cost the client a second round trip for no benefit. One
      // `inArray` query keyed on `actionUpdateId` (indexed — see
      // `meeting_document_actionUpdateId_idx`) rather than N+1 per update.
      // `objectKey` is deliberately excluded: it is an internal storage
      // detail, and the download route takes the document's `id`, not it.
      const updateIds = rows.map((row) => row.id);
      const attachmentsByUpdateId = new Map<
        string,
        Array<{
          id: string;
          filename: string;
          size: number;
          createdAt: Date;
        }>
      >();
      if (updateIds.length > 0) {
        const docs = await db
          .select({
            id: meetingDocumentTable.id,
            actionUpdateId: meetingDocumentTable.actionUpdateId,
            filename: meetingDocumentTable.filename,
            size: meetingDocumentTable.size,
            createdAt: meetingDocumentTable.createdAt,
          })
          .from(meetingDocumentTable)
          .where(inArray(meetingDocumentTable.actionUpdateId, updateIds));
        for (const doc of docs) {
          // `actionUpdateId` can only be null for a meeting-level document,
          // which can never match this `inArray` (built from update ids) —
          // the guard is for the type checker, not reachability.
          if (!doc.actionUpdateId) continue;
          const list = attachmentsByUpdateId.get(doc.actionUpdateId) ?? [];
          list.push({
            id: doc.id,
            filename: doc.filename,
            size: doc.size,
            createdAt: doc.createdAt,
          });
          attachmentsByUpdateId.set(doc.actionUpdateId, list);
        }
      }

      const withAttachments = rows.map((row) => ({
        ...row,
        attachments: attachmentsByUpdateId.get(row.id) ?? [],
      }));
      return c.json(withAttachments);
    },
  );

  // ── Attachments: presign ────────────────────────────────────────────────
  app.post(
    "/:id/attachments/presign",
    describeRoute({
      operationId: "presignMeetingDocumentUpload",
      tags: ["Meeting"],
      description:
        "Presign a PDF upload for a meeting document, optionally attached to one action update",
    }),
    validator("param", v.object({ id: v.string() })),
    validator(
      "json",
      v.object({
        workspaceId: v.string(),
        filename: meetingDocumentFilename,
        mimeType: v.string(),
        size: v.number(),
        actionUpdateId: optionalActionUpdateId,
      }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    async (c) => {
      const ws = c.get("workspaceId") as string;
      const userId = c.get("userId") as string;
      const { id } = c.req.valid("param");
      const b = c.req.valid("json");

      const meeting = await loadMeeting(ws, id);
      if (!meeting) throw new HTTPException(404, { message: "Not found" });
      await assertCanAttachMeetingDocument(
        userId,
        ws,
        meeting,
        b.actionUpdateId,
        b.mimeType,
      );

      const presigned = await createMeetingFileUploadUrl({
        workspaceId: ws,
        meetingId: id,
        filename: b.filename,
        contentType: b.mimeType,
      });
      return c.json(presigned);
    },
  );

  // ── Attachments: finalize ───────────────────────────────────────────────
  app.post(
    "/:id/attachments/finalize",
    describeRoute({
      operationId: "finalizeMeetingDocument",
      tags: ["Meeting"],
      description: "Record a meeting document row for an already-uploaded PDF",
    }),
    validator("param", v.object({ id: v.string() })),
    validator(
      "json",
      v.object({
        workspaceId: v.string(),
        objectKey: v.string(),
        filename: meetingDocumentFilename,
        mimeType: v.string(),
        size: v.number(),
        actionUpdateId: optionalActionUpdateId,
      }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    async (c) => {
      const ws = c.get("workspaceId") as string;
      const userId = c.get("userId") as string;
      const { id } = c.req.valid("param");
      const b = c.req.valid("json");

      const meeting = await loadMeeting(ws, id);
      if (!meeting) throw new HTTPException(404, { message: "Not found" });
      // Same gate as presign — see the function's own comment for why
      // gating only one of the two leaves the feature unreachable.
      await assertCanAttachMeetingDocument(
        userId,
        ws,
        meeting,
        b.actionUpdateId,
        b.mimeType,
      );
      // Reject an objectKey pointed outside this meeting's owner segment —
      // otherwise finalize becomes a way to claim someone else's uploaded
      // object. The meeting-shaped twin of the same guard in
      // `correspondence/letters.ts`. `startsWith` rather than `includes`:
      // the latter would also accept a key that merely CONTAINS the owner
      // segment as a substring without being rooted under it (e.g.
      // `attacker-controlled/workspace/<ws>/meeting/<id>/evil.pdf`).
      const ownerSegmentPrefix = applyKeyPrefix(
        assertStorageConfigured().keyPrefix,
        meetingFileKeyOwnerSegment(ws, id),
      );
      if (
        b.objectKey.includes("..") ||
        !b.objectKey.startsWith(ownerSegmentPrefix)
      )
        throw new HTTPException(400, { message: "Invalid object key" });

      const [row] = await db
        .insert(meetingDocumentTable)
        .values({
          // NOT NULL even when actionUpdateId is set — see the schema
          // comment: this is what makes a single confidentiality check
          // cover every attachment path instead of two rules that drift.
          meetingId: id,
          actionUpdateId: b.actionUpdateId ?? null,
          workspaceId: ws,
          objectKey: b.objectKey,
          filename: b.filename,
          mimeType: b.mimeType,
          size: b.size,
          createdBy: userId,
        })
        .returning();
      return c.json(row, 201);
    },
  );

  // ── Attachments: download ───────────────────────────────────────────────
  app.get(
    "/:id/attachments/:docId/download",
    describeRoute({
      operationId: "downloadMeetingDocument",
      tags: ["Meeting"],
      description: "A presigned download of a meeting document",
    }),
    validator("param", v.object({ id: v.string(), docId: v.string() })),
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    async (c) => {
      const ws = c.get("workspaceId") as string;
      const userId = c.get("userId") as string;
      const { id, docId } = c.req.valid("param");

      const meeting = await loadMeeting(ws, id);
      if (!meeting) throw new HTTPException(404, { message: "Not found" });
      // Confidentiality first, same as every other read in this module —
      // but not sufficient on its own: `assertCanReadMeeting` returns true
      // unconditionally for a non-confidential meeting, and an attachment
      // is thread content, narrower than the meeting itself (see the
      // comment on `assertCanReadMeetingDocument`).
      await assertCanReadMeeting(userId, ws, meeting);

      const [doc] = await db
        .select()
        .from(meetingDocumentTable)
        .where(
          and(
            eq(meetingDocumentTable.id, docId),
            eq(meetingDocumentTable.meetingId, id),
          ),
        )
        .limit(1);
      if (!doc) throw new HTTPException(404, { message: "Not found" });
      await assertCanReadMeetingDocument(userId, ws, doc);

      try {
        const object = await getPrivateObject(doc.objectKey);
        return new Response(object.body as BodyInit, {
          headers: {
            "Cache-Control": "private, max-age=120",
            "Content-Type": object.contentType || doc.mimeType,
            "Content-Disposition": buildContentDisposition(doc.filename),
            // The stored MIME type is always "application/pdf" (enforced by
            // `assertPdfOnly`), but the bytes themselves are never verified
            // to actually be a PDF — this stops a browser from sniffing and
            // rendering/executing something else if they aren't, especially
            // given the response is served `inline`.
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch {
        throw new HTTPException(404, { message: "File not found" });
      }
    },
  );
}
