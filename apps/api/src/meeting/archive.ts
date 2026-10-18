import { and, asc, eq, isNull } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import { recordAuditEvent } from "../correspondence/audit";
import db from "../database";
import {
  meetingArchivistTable,
  meetingBodyTable,
  meetingDocumentTable,
  meetingTable,
  meetingTypeTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";
import { deleteS3Object } from "../storage/s3";
import { requireWorkspacePageAccess } from "../utils/page-access";
import { isGlobalAdmin } from "../utils/project-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { assertCanReadMeeting, loadMeeting } from "./access";
import {
  ARCHIVED_STATUS,
  assertCanManageArchive,
  canManageArchive,
} from "./archivists";
import { queryMeetingPage } from "./list-page";

type MeetingEnv = { Variables: { userId: string; workspaceId?: string } };

const pageAccess = requireWorkspacePageAccess("general-management");

const text = (max: number) =>
  v.optional(v.pipe(v.string(), v.trim(), v.maxLength(max)));

const archiveFields = {
  title: text(300),
  // `YYYY-MM-DD` or a full ISO timestamp. Required on create: the meeting
  // date is what Past Minutes sorts and filters on.
  scheduledAt: v.optional(v.string()),
  meetingTypeId: v.optional(v.string()),
  bodyId: v.optional(v.string()),
  location: text(300),
  confidential: v.optional(v.boolean()),
  referenceNo: text(120),
  chairperson: text(200),
  summary: text(5000),
};

function getIp(c: Context): string | null {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    null
  );
}

function parseMeetingDate(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime()))
    throw new HTTPException(400, { message: "Invalid meeting date" });
  return d;
}

/** "" from a cleared field means none; anything else is kept, trimmed. */
function orNull(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value === "" ? null : value;
}

async function assertConfigInWorkspace(
  workspaceId: string,
  meetingTypeId: string | null | undefined,
  bodyId: string | null | undefined,
) {
  if (meetingTypeId) {
    const [row] = await db
      .select({ id: meetingTypeTable.id })
      .from(meetingTypeTable)
      .where(
        and(
          eq(meetingTypeTable.id, meetingTypeId),
          eq(meetingTypeTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!row)
      throw new HTTPException(400, { message: "Invalid meetingTypeId" });
  }
  if (bodyId) {
    const [row] = await db
      .select({ id: meetingBodyTable.id })
      .from(meetingBodyTable)
      .where(
        and(
          eq(meetingBodyTable.id, bodyId),
          eq(meetingBodyTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!row) throw new HTTPException(400, { message: "Invalid bodyId" });
  }
}

/**
 * Load a past minute the caller may manage: it must exist in this
 * workspace, be archived (a live meeting is never edited from here), be
 * readable by the caller, and the caller must keep the archive. Read access
 * comes first, so a refusal never confirms a confidential record exists.
 */
async function loadManagedArchive(
  userId: string,
  workspaceId: string,
  id: string,
) {
  const meeting = await loadMeeting(workspaceId, id);
  if (!meeting || meeting.status !== ARCHIVED_STATUS)
    throw new HTTPException(404, { message: "Not found" });
  await assertCanReadMeeting(userId, workspaceId, meeting);
  await assertCanManageArchive(userId, workspaceId);
  return meeting;
}

/**
 * Remove stored objects after their rows are gone. Best effort: a storage
 * hiccup must not resurrect a record the user just deleted, and an orphaned
 * object is invisible (no row points at it). Failures are logged for the
 * operator.
 */
async function deleteObjects(keys: (string | null)[]) {
  for (const key of keys) {
    if (!key) continue;
    try {
      await deleteS3Object(key);
    } catch (error) {
      console.error(`[meeting-archive] could not delete object ${key}:`, error);
    }
  }
}

/**
 * Past Minutes: meetings held before this system, uploaded for the record.
 * They are ordinary `meeting` rows with status `archived`, so their
 * documents reuse the upload, indexing, search and confidentiality paths of
 * every other meeting; what differs is who may write them (archivists and
 * global admins) and that they skip the draft-to-adoption flow entirely.
 *
 * Every path here starts with "/archive" and is registered before the
 * module's "/:id" routes; see the mount site in `index.ts`.
 */
export function registerArchiveRoutes(app: Hono<MeetingEnv>): void {
  // ── Archivists ─────────────────────────────────────────────────────────
  // Literal "/archive/archivists" before "/archive/:id".
  app.get(
    "/archive/archivists",
    describeRoute({
      operationId: "listMeetingArchivists",
      tags: ["Meeting"],
      description: "The people allowed to manage Past Minutes",
    }),
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    pageAccess,
    async (c) => {
      const ws = c.get("workspaceId") as string;
      const rows = await db
        .select({
          userId: meetingArchivistTable.userId,
          name: userTable.name,
          email: userTable.email,
          createdAt: meetingArchivistTable.createdAt,
        })
        .from(meetingArchivistTable)
        .innerJoin(userTable, eq(userTable.id, meetingArchivistTable.userId))
        .where(eq(meetingArchivistTable.workspaceId, ws))
        .orderBy(asc(userTable.name));
      return c.json(rows);
    },
  );

  app.post(
    "/archive/archivists",
    describeRoute({
      operationId: "addMeetingArchivist",
      tags: ["Meeting"],
      description: "Allow a workspace member to manage Past Minutes",
    }),
    validator(
      "json",
      v.object({ workspaceId: v.string(), userId: v.string() }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    async (c) => {
      const ws = c.get("workspaceId") as string;
      const callerId = c.get("userId") as string;
      const { userId } = c.req.valid("json");
      if (!(await isGlobalAdmin(callerId, ws)))
        throw new HTTPException(403, {
          message: "Only global admins can choose minutes archivists",
        });
      const [member] = await db
        .select({ id: workspaceUserTable.id })
        .from(workspaceUserTable)
        .where(
          and(
            eq(workspaceUserTable.workspaceId, ws),
            eq(workspaceUserTable.userId, userId),
          ),
        )
        .limit(1);
      if (!member)
        throw new HTTPException(400, {
          message: "That person is not a member of this workspace",
        });
      await db
        .insert(meetingArchivistTable)
        .values({ workspaceId: ws, userId, createdBy: callerId })
        .onConflictDoNothing();
      return c.json({ userId }, 201);
    },
  );

  app.delete(
    "/archive/archivists/:userId",
    describeRoute({
      operationId: "removeMeetingArchivist",
      tags: ["Meeting"],
      description: "Stop a member managing Past Minutes",
    }),
    validator("param", v.object({ userId: v.string() })),
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    async (c) => {
      const ws = c.get("workspaceId") as string;
      const callerId = c.get("userId") as string;
      const { userId } = c.req.valid("param");
      if (!(await isGlobalAdmin(callerId, ws)))
        throw new HTTPException(403, {
          message: "Only global admins can choose minutes archivists",
        });
      await db
        .delete(meetingArchivistTable)
        .where(
          and(
            eq(meetingArchivistTable.workspaceId, ws),
            eq(meetingArchivistTable.userId, userId),
          ),
        );
      return c.json({ userId });
    },
  );

  // ── List ───────────────────────────────────────────────────────────────
  app.get(
    "/archive",
    describeRoute({
      operationId: "listPastMinutes",
      tags: ["Meeting"],
      description:
        "Past Minutes, by meeting date, cursor-paginated, searchable across their documents' text, filterable, confidentiality-filtered",
    }),
    validator(
      "query",
      v.object({
        workspaceId: v.string(),
        limit: v.optional(v.string()),
        cursor: v.optional(v.string()),
        q: v.optional(v.string()),
        bodyId: v.optional(v.string()),
        meetingTypeId: v.optional(v.string()),
        from: v.optional(v.string()),
        to: v.optional(v.string()),
      }),
    ),
    workspaceAccess.fromQuery("workspaceId"),
    pageAccess,
    async (c) => {
      const ws = c.get("workspaceId") as string;
      const userId = c.get("userId") as string;
      const query = c.req.valid("query");
      const [page, canManage] = await Promise.all([
        queryMeetingPage({
          workspaceId: ws,
          userId,
          scope: "archive",
          limit: query.limit,
          cursor: query.cursor,
          q: query.q,
          filters: {
            bodyId: query.bodyId || undefined,
            meetingTypeId: query.meetingTypeId || undefined,
            from: query.from || undefined,
            to: query.to || undefined,
          },
        }),
        canManageArchive(userId, ws),
      ]);
      // `canManage` decides whether the upload and edit controls show. The
      // routes below enforce it regardless.
      return c.json({ ...page, canManage });
    },
  );

  // ── Create ─────────────────────────────────────────────────────────────
  app.post(
    "/archive",
    describeRoute({
      operationId: "createPastMinute",
      tags: ["Meeting"],
      description:
        "Record a past meeting for the archive; its documents are uploaded after",
    }),
    validator("json", v.object({ workspaceId: v.string(), ...archiveFields })),
    workspaceAccess.fromBody("workspaceId"),
    pageAccess,
    async (c) => {
      const ws = c.get("workspaceId") as string;
      const userId = c.get("userId") as string;
      const b = c.req.valid("json");
      await assertCanManageArchive(userId, ws);
      if (!b.title) throw new HTTPException(400, { message: "Title required" });
      if (!b.scheduledAt)
        throw new HTTPException(400, { message: "Meeting date required" });
      const meetingTypeId = orNull(b.meetingTypeId?.trim()) ?? null;
      const bodyId = orNull(b.bodyId?.trim()) ?? null;
      await assertConfigInWorkspace(ws, meetingTypeId, bodyId);

      const row = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(meetingTable)
          .values({
            workspaceId: ws,
            title: b.title as string,
            scheduledAt: parseMeetingDate(b.scheduledAt as string),
            meetingTypeId,
            bodyId,
            location: orNull(b.location) ?? null,
            confidential: b.confidential ?? false,
            referenceNo: orNull(b.referenceNo) ?? null,
            chairperson: orNull(b.chairperson) ?? null,
            summary: orNull(b.summary) ?? null,
            status: ARCHIVED_STATUS,
            createdBy: userId,
          })
          .returning();
        if (!created)
          throw new HTTPException(500, { message: "Failed to save" });
        await recordAuditEvent(tx, {
          workspaceId: ws,
          entityType: "meeting",
          entityId: created.id,
          action: "archive",
          actorId: userId,
          before: null,
          after: created,
          ip: getIp(c),
        });
        return created;
      });
      return c.json(row, 201);
    },
  );

  // ── Update ─────────────────────────────────────────────────────────────
  app.put(
    "/archive/:id",
    describeRoute({
      operationId: "updatePastMinute",
      tags: ["Meeting"],
      description: "Edit a past minute's details",
    }),
    validator("param", v.object({ id: v.string() })),
    validator("json", v.object({ workspaceId: v.string(), ...archiveFields })),
    workspaceAccess.fromBody("workspaceId"),
    pageAccess,
    async (c) => {
      const ws = c.get("workspaceId") as string;
      const userId = c.get("userId") as string;
      const { id } = c.req.valid("param");
      const b = c.req.valid("json");
      const meeting = await loadManagedArchive(userId, ws, id);

      if (b.title !== undefined && !b.title)
        throw new HTTPException(400, { message: "Title required" });
      if (b.scheduledAt !== undefined && !b.scheduledAt)
        throw new HTTPException(400, { message: "Meeting date required" });
      const meetingTypeId = orNull(b.meetingTypeId?.trim());
      const bodyId = orNull(b.bodyId?.trim());
      await assertConfigInWorkspace(ws, meetingTypeId, bodyId);

      const p: Partial<typeof meetingTable.$inferInsert> = {};
      if (b.title !== undefined) p.title = b.title;
      if (b.scheduledAt !== undefined)
        p.scheduledAt = parseMeetingDate(b.scheduledAt);
      if (meetingTypeId !== undefined) p.meetingTypeId = meetingTypeId;
      if (bodyId !== undefined) p.bodyId = bodyId;
      if (b.location !== undefined) p.location = orNull(b.location);
      if (b.confidential !== undefined) p.confidential = b.confidential;
      if (b.referenceNo !== undefined) p.referenceNo = orNull(b.referenceNo);
      if (b.chairperson !== undefined) p.chairperson = orNull(b.chairperson);
      if (b.summary !== undefined) p.summary = orNull(b.summary);

      const row = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(meetingTable)
          .set({ ...p, updatedAt: new Date() })
          .where(
            and(
              eq(meetingTable.id, id),
              eq(meetingTable.workspaceId, ws),
              eq(meetingTable.status, ARCHIVED_STATUS),
            ),
          )
          .returning();
        if (!updated) throw new HTTPException(404, { message: "Not found" });
        await recordAuditEvent(tx, {
          workspaceId: ws,
          entityType: "meeting",
          entityId: id,
          action: "update",
          actorId: userId,
          before: meeting,
          after: updated,
          ip: getIp(c),
        });
        return updated;
      });
      return c.json(row);
    },
  );

  // ── Delete ─────────────────────────────────────────────────────────────
  app.delete(
    "/archive/:id",
    describeRoute({
      operationId: "deletePastMinute",
      tags: ["Meeting"],
      description: "Remove a past minute and its documents",
    }),
    validator("param", v.object({ id: v.string() })),
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    pageAccess,
    async (c) => {
      const ws = c.get("workspaceId") as string;
      const userId = c.get("userId") as string;
      const { id } = c.req.valid("param");
      const meeting = await loadManagedArchive(userId, ws, id);

      const docs = await db
        .select({
          objectKey: meetingDocumentTable.objectKey,
          originalObjectKey: meetingDocumentTable.originalObjectKey,
        })
        .from(meetingDocumentTable)
        .where(eq(meetingDocumentTable.meetingId, id));

      await db.transaction(async (tx) => {
        // Documents go with the meeting through the foreign key's cascade.
        await tx
          .delete(meetingTable)
          .where(
            and(
              eq(meetingTable.id, id),
              eq(meetingTable.workspaceId, ws),
              eq(meetingTable.status, ARCHIVED_STATUS),
            ),
          );
        await recordAuditEvent(tx, {
          workspaceId: ws,
          entityType: "meeting",
          entityId: id,
          action: "delete",
          actorId: userId,
          before: meeting,
          after: null,
          ip: getIp(c),
        });
      });
      await deleteObjects(
        docs.flatMap((d) => [d.objectKey, d.originalObjectKey]),
      );
      return c.json({ id });
    },
  );

  app.delete(
    "/archive/:id/documents/:docId",
    describeRoute({
      operationId: "deletePastMinuteDocument",
      tags: ["Meeting"],
      description: "Remove one document from a past minute",
    }),
    validator("param", v.object({ id: v.string(), docId: v.string() })),
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    pageAccess,
    async (c) => {
      const ws = c.get("workspaceId") as string;
      const userId = c.get("userId") as string;
      const { id, docId } = c.req.valid("param");
      await loadManagedArchive(userId, ws, id);

      // Scoped by meeting as well as id, so a document on some other meeting
      // is never reachable through this one's route.
      const [doc] = await db
        .delete(meetingDocumentTable)
        .where(
          and(
            eq(meetingDocumentTable.id, docId),
            eq(meetingDocumentTable.meetingId, id),
            isNull(meetingDocumentTable.actionUpdateId),
          ),
        )
        .returning({
          id: meetingDocumentTable.id,
          filename: meetingDocumentTable.filename,
          objectKey: meetingDocumentTable.objectKey,
          originalObjectKey: meetingDocumentTable.originalObjectKey,
        });
      if (!doc) throw new HTTPException(404, { message: "Not found" });
      await db.transaction((tx) =>
        recordAuditEvent(tx, {
          workspaceId: ws,
          entityType: "meeting",
          entityId: id,
          action: "delete-document",
          actorId: userId,
          before: { documentId: doc.id, filename: doc.filename },
          after: null,
          ip: getIp(c),
        }),
      );
      await deleteObjects([doc.objectKey, doc.originalObjectKey]);
      return c.json({ id: doc.id });
    },
  );
}
