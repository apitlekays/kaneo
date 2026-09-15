import { and, desc, eq, isNull } from "drizzle-orm";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import db from "../database";
import { meetingDocumentTable } from "../database/schema";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { assertCanReadMeeting, loadMeeting } from "./access";
import {
  assertCanAttachMeetingDocument,
  MEETING_DOCUMENT_MIME_TYPE,
} from "./action-updates";
import { enqueueDocumentIndexing } from "./indexing";

// Context variables populated by the auth + workspace-access middleware.
type MeetingEnv = { Variables: { userId: string; workspaceId?: string } };

/**
 * The archival document shelf of one meeting: what has been uploaded, and
 * where each file is in the indexing pipeline.
 *
 * Follows `registerActionUpdateRoutes` in `action-updates.ts` (itself
 * following `registerLetterRoutes` in `correspondence/letters.ts`): this adds
 * routes onto the `Hono` app it is passed rather than building its own, so
 * registration order at the mount site stays under `index.ts`'s control.
 */
export function registerMeetingDocumentRoutes(app: Hono<MeetingEnv>): void {
  app.get(
    "/:id/documents",
    describeRoute({
      operationId: "listMeetingDocuments",
      tags: ["Meeting"],
      description:
        "The meeting's archival documents, newest first, with their indexing state",
    }),
    validator("param", v.object({ id: v.string() })),
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    async (c) => {
      const ws = c.get("workspaceId") as string;
      const userId = c.get("userId") as string;
      const { id } = c.req.valid("param");

      const meeting = await loadMeeting(ws, id);
      if (!meeting) throw new HTTPException(404, { message: "Not found" });
      // Confidentiality first, before a single document row is read: a
      // confidential meeting's filenames are as revealing as its title, and
      // this module has leaked that title three times. Nothing below this
      // line may run for a caller who cannot read the meeting.
      await assertCanReadMeeting(userId, ws, meeting);

      const docs = await db
        .select({
          id: meetingDocumentTable.id,
          filename: meetingDocumentTable.filename,
          size: meetingDocumentTable.size,
          kind: meetingDocumentTable.kind,
          indexStatus: meetingDocumentTable.indexStatus,
          indexedAt: meetingDocumentTable.indexedAt,
          indexError: meetingDocumentTable.indexError,
          createdBy: meetingDocumentTable.createdBy,
          createdAt: meetingDocumentTable.createdAt,
          // objectKey and originalObjectKey are deliberately absent: they
          // are internal storage detail, and the download route is the only
          // way to reach the bytes.
        })
        .from(meetingDocumentTable)
        .where(
          and(
            eq(meetingDocumentTable.meetingId, id),
            // Archival documents only. Reply attachments belong to the
            // action thread and are returned by the updates route — and
            // they are never indexed, so they sit at `pending` for ever;
            // listing them here would read as "queued" indefinitely.
            isNull(meetingDocumentTable.actionUpdateId),
          ),
        )
        .orderBy(desc(meetingDocumentTable.createdAt));
      return c.json(docs);
    },
  );

  app.post(
    "/:id/documents/:docId/reindex",
    describeRoute({
      operationId: "reindexMeetingDocument",
      tags: ["Meeting"],
      description:
        "Queue a failed or stale archival document for text extraction again",
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
      // The UPLOAD gate, not the read gate: re-indexing spends OCR minutes
      // on a 2-vCPU box shared with Postgres, MinIO and the app, so it takes
      // the same authority as putting the document there in the first place.
      // `undefined` for `actionUpdateId` selects the meeting-level branch —
      // a reply attachment is never indexed, so it is never re-indexed
      // either.
      await assertCanAttachMeetingDocument(
        userId,
        ws,
        meeting,
        undefined,
        MEETING_DOCUMENT_MIME_TYPE,
      );

      // Scoped by `meetingId`, never by `docId` alone: without the meeting
      // term, a document belonging to meeting A is reachable (and burns CPU)
      // through meeting B's route. The same hole was found and closed in the
      // download gate — see `assertCanReadMeetingDocument`.
      //
      // `isNull(actionUpdateId)` for the same reason the list route has it:
      // a reply attachment has no extracted text and no index to retry.
      const [doc] = await db
        .select({ id: meetingDocumentTable.id })
        .from(meetingDocumentTable)
        .where(
          and(
            eq(meetingDocumentTable.id, docId),
            eq(meetingDocumentTable.meetingId, id),
            isNull(meetingDocumentTable.actionUpdateId),
          ),
        )
        .limit(1);
      if (!doc) throw new HTTPException(404, { message: "Not found" });

      const [updated] = await db
        .update(meetingDocumentTable)
        .set({
          indexStatus: "pending",
          // Cleared now rather than when the retry finishes: the previous
          // failure's message must not stay on screen next to a document
          // that is queued again.
          indexError: null,
          indexedAt: null,
        })
        .where(eq(meetingDocumentTable.id, doc.id))
        .returning({
          id: meetingDocumentTable.id,
          filename: meetingDocumentTable.filename,
          size: meetingDocumentTable.size,
          kind: meetingDocumentTable.kind,
          indexStatus: meetingDocumentTable.indexStatus,
          indexedAt: meetingDocumentTable.indexedAt,
          indexError: meetingDocumentTable.indexError,
          createdBy: meetingDocumentTable.createdBy,
          createdAt: meetingDocumentTable.createdAt,
        });
      if (!updated) throw new HTTPException(404, { message: "Not found" });

      // Enqueued after the row is already `pending`, so the state the caller
      // is handed back is the state the queue will find.
      enqueueDocumentIndexing(doc.id);
      return c.json(updated);
    },
  );
}
