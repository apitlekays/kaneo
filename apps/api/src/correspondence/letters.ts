import { createHash } from "node:crypto";
import { and, asc, desc, eq, lt } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono-openapi";
import * as v from "valibot";
import db from "../database";
import {
  gmCategoryTable,
  gmFilePlanNodeTable,
  gmNumberSchemeTable,
  gmSecurityLabelTable,
  letterAssignmentTable,
  letterAttachmentTable,
  letterLinkTable,
  letterMinuteTable,
  letterTable,
} from "../database/schema";
import {
  createLetterFileUploadUrl,
  getPrivateObject,
  letterFileKeyOwnerSegment,
} from "../storage/s3";
import { requireWorkspacePageAccess } from "../utils/page-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { recordAuditEvent } from "./audit";
import { allocateNumber } from "./numbering";

type GmEnv = { Variables: { userId: string; workspaceId?: string } };
type Tx = Pick<typeof db, "select" | "insert" | "update" | "delete">;
type Row = Record<string, unknown>;

const PAGE_SLUG = "general-management";
const pageAccess = requireWorkspacePageAccess(PAGE_SLUG);

const DIRECTIONS = ["in", "out"] as const;
const TYPES = ["external", "memo", "circular"] as const;
const MEDIUMS = ["email", "physical", "hand", "portal"] as const;
const STATUSES = [
  "captured",
  "registered",
  "classified",
  "assigned",
  "in-action",
  "awaiting-response",
  "closed",
  "archived",
] as const;

const optStr = v.optional(v.string());
const optDate = v.optional(v.string());

function getIp(c: Context) {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    null
  );
}

function toDate(value: unknown) {
  if (!value || typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function loadLetter(workspaceId: string, id: string) {
  const [letter] = await db
    .select()
    .from(letterTable)
    .where(
      and(eq(letterTable.id, id), eq(letterTable.workspaceId, workspaceId)),
    )
    .limit(1);
  return letter ?? null;
}

/** Verify a config id belongs to the workspace (or is null). */
async function inWorkspace(
  table:
    | typeof gmCategoryTable
    | typeof gmFilePlanNodeTable
    | typeof gmSecurityLabelTable,
  id: string | null | undefined,
  workspaceId: string,
) {
  if (!id) return true;
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.workspaceId, workspaceId)))
    .limit(1);
  return Boolean(row);
}

async function sha256OfObject(objectKey: string) {
  const object = await getPrivateObject(objectKey);
  const hash = createHash("sha256");
  const body = object.body as AsyncIterable<Uint8Array>;
  for await (const chunk of body) hash.update(chunk);
  return hash.digest("hex");
}

export function registerLetterRoutes(app: Hono<GmEnv>) {
  app
    // ── List (faceted) ──────────────────────────────────────────────────────
    .get(
      "/letters",
      validator(
        "query",
        v.object({
          workspaceId: v.string(),
          direction: v.optional(v.picklist(DIRECTIONS)),
          type: v.optional(v.picklist(TYPES)),
          status: optStr,
          q: optStr,
        }),
      ),
      workspaceAccess.fromQuery("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const { direction, type, status, q } = c.req.valid("query");
        const filters = [eq(letterTable.workspaceId, ws)];
        if (direction) filters.push(eq(letterTable.direction, direction));
        if (type) filters.push(eq(letterTable.type, type));
        if (status) filters.push(eq(letterTable.status, status));
        const rows = await db
          .select()
          .from(letterTable)
          .where(and(...filters))
          .orderBy(desc(letterTable.createdAt));
        const term = q?.trim().toLowerCase();
        const filtered = term
          ? rows.filter(
              (r) =>
                r.subject?.toLowerCase().includes(term) ||
                r.refNo?.toLowerCase().includes(term) ||
                r.senderName?.toLowerCase().includes(term) ||
                r.senderOrg?.toLowerCase().includes(term),
            )
          : rows;
        return c.json(filtered);
      },
    )
    // ── Dashboard summary ─────────────────────────────────────────────────────
    .get(
      "/summary",
      validator("query", v.object({ workspaceId: v.string() })),
      workspaceAccess.fromQuery("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const rows = await db
          .select({
            id: letterTable.id,
            direction: letterTable.direction,
            status: letterTable.status,
            currentAssigneeId: letterTable.currentAssigneeId,
          })
          .from(letterTable)
          .where(eq(letterTable.workspaceId, ws));

        const byStatus: Record<string, number> = {};
        let incoming = 0;
        let outgoing = 0;
        let pendingRegistration = 0;
        let unassigned = 0;
        for (const r of rows) {
          byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
          if (r.direction === "in") incoming++;
          else outgoing++;
          if (r.status === "captured") pendingRegistration++;
          if (
            !r.currentAssigneeId &&
            ["registered", "classified"].includes(r.status)
          )
            unassigned++;
        }

        const overdueRows = await db
          .select({ id: letterAssignmentTable.id })
          .from(letterAssignmentTable)
          .innerJoin(
            letterTable,
            eq(letterAssignmentTable.letterId, letterTable.id),
          )
          .where(
            and(
              eq(letterTable.workspaceId, ws),
              eq(letterAssignmentTable.status, "pending"),
              lt(letterAssignmentTable.dueAt, new Date()),
            ),
          );

        return c.json({
          total: rows.length,
          incoming,
          outgoing,
          pendingRegistration,
          unassigned,
          overdue: overdueRows.length,
          byStatus,
        });
      },
    )
    // ── Detail ────────────────────────────────────────────────────────────────
    .get(
      "/letters/:id",
      validator("param", v.object({ id: v.string() })),
      validator("query", v.object({ workspaceId: v.string() })),
      workspaceAccess.fromQuery("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const { id } = c.req.valid("param");
        const letter = await loadLetter(ws, id);
        if (!letter) throw new HTTPException(404, { message: "Not found" });
        const [attachments, minutes, assignments, links] = await Promise.all([
          db
            .select()
            .from(letterAttachmentTable)
            .where(eq(letterAttachmentTable.letterId, id))
            .orderBy(asc(letterAttachmentTable.createdAt)),
          db
            .select()
            .from(letterMinuteTable)
            .where(eq(letterMinuteTable.letterId, id))
            .orderBy(asc(letterMinuteTable.createdAt)),
          db
            .select()
            .from(letterAssignmentTable)
            .where(eq(letterAssignmentTable.letterId, id))
            .orderBy(desc(letterAssignmentTable.createdAt)),
          db
            .select()
            .from(letterLinkTable)
            .where(eq(letterLinkTable.fromLetterId, id)),
        ]);
        return c.json({ ...letter, attachments, minutes, assignments, links });
      },
    )
    // ── Capture / create ────────────────────────────────────────────────────
    .post(
      "/letters",
      validator(
        "json",
        v.object({
          workspaceId: v.string(),
          direction: v.picklist(DIRECTIONS),
          type: v.picklist(TYPES),
          medium: v.picklist(MEDIUMS),
          subject: v.string(),
          senderName: optStr,
          senderOrg: optStr,
          senderEmail: optStr,
          recipientName: optStr,
          recipientOrg: optStr,
          recipientEmail: optStr,
          letterDate: optDate,
          receivedAt: optDate,
          categoryId: optStr,
          filePlanNodeId: optStr,
          securityLabelId: optStr,
          fileRef: optStr,
        }),
      ),
      workspaceAccess.fromBody("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const b = c.req.valid("json");
        const subject = b.subject.trim();
        if (!subject)
          throw new HTTPException(400, { message: "Subject required" });
        for (const [table, id] of [
          [gmCategoryTable, b.categoryId],
          [gmFilePlanNodeTable, b.filePlanNodeId],
          [gmSecurityLabelTable, b.securityLabelId],
        ] as const) {
          if (!(await inWorkspace(table, id, ws)))
            throw new HTTPException(400, { message: "Invalid reference" });
        }
        const created = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(letterTable)
            .values({
              workspaceId: ws,
              direction: b.direction,
              type: b.type,
              medium: b.medium,
              subject,
              senderName: b.senderName ?? null,
              senderOrg: b.senderOrg ?? null,
              senderEmail: b.senderEmail ?? null,
              recipientName: b.recipientName ?? null,
              recipientOrg: b.recipientOrg ?? null,
              recipientEmail: b.recipientEmail ?? null,
              letterDate: toDate(b.letterDate),
              receivedAt: toDate(b.receivedAt),
              categoryId: b.categoryId ?? null,
              filePlanNodeId: b.filePlanNodeId ?? null,
              securityLabelId: b.securityLabelId ?? null,
              fileRef: b.fileRef ?? null,
              status: "captured",
              createdBy: userId,
            })
            .returning();
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: (row as Row).id as string,
            action: "capture",
            actorId: userId,
            after: row,
            ip: getIp(c),
          });
          return row as Row;
        });
        return c.json(created, 201);
      },
    )
    // ── Edit (pre-registration only) ──────────────────────────────────────────
    .put(
      "/letters/:id",
      validator("param", v.object({ id: v.string() })),
      validator(
        "json",
        v.object({
          workspaceId: v.string(),
          subject: optStr,
          senderName: optStr,
          senderOrg: optStr,
          senderEmail: optStr,
          recipientName: optStr,
          recipientOrg: optStr,
          recipientEmail: optStr,
          letterDate: optDate,
          receivedAt: optDate,
          fileRef: optStr,
          medium: v.optional(v.picklist(MEDIUMS)),
        }),
      ),
      workspaceAccess.fromBody("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const { id } = c.req.valid("param");
        const b = c.req.valid("json");
        const before = await loadLetter(ws, id);
        if (!before) throw new HTTPException(404, { message: "Not found" });
        if (before.declaredAt)
          throw new HTTPException(409, {
            message: "Letter is a declared record; content is immutable",
          });
        const patch: Row = { updatedAt: new Date() };
        if (b.subject !== undefined) patch.subject = b.subject.trim();
        for (const k of [
          "senderName",
          "senderOrg",
          "senderEmail",
          "recipientName",
          "recipientOrg",
          "recipientEmail",
          "fileRef",
          "medium",
        ] as const) {
          if (b[k] !== undefined) patch[k] = b[k];
        }
        if (b.letterDate !== undefined) patch.letterDate = toDate(b.letterDate);
        if (b.receivedAt !== undefined) patch.receivedAt = toDate(b.receivedAt);
        const after = await db.transaction(async (tx) => {
          const [row] = await tx
            .update(letterTable)
            .set(patch)
            .where(and(eq(letterTable.id, id), eq(letterTable.workspaceId, ws)))
            .returning();
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: "update",
            actorId: userId,
            before,
            after: row,
            ip: getIp(c),
          });
          return row as Row;
        });
        return c.json(after);
      },
    )
    // ── Register (assign ref no + declare/freeze + fixity) ────────────────────
    .post(
      "/letters/:id/register",
      validator("param", v.object({ id: v.string() })),
      validator(
        "json",
        v.object({ workspaceId: v.string(), numberSchemeId: optStr }),
      ),
      workspaceAccess.fromBody("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const { id } = c.req.valid("param");
        const { numberSchemeId } = c.req.valid("json");
        const letter = await loadLetter(ws, id);
        if (!letter) throw new HTTPException(404, { message: "Not found" });
        if (letter.declaredAt)
          throw new HTTPException(409, { message: "Already registered" });

        // Resolve the numbering scheme (explicit or by direction+type).
        const schemeFilters = [
          eq(gmNumberSchemeTable.workspaceId, ws),
          eq(gmNumberSchemeTable.active, true),
        ];
        if (numberSchemeId)
          schemeFilters.push(eq(gmNumberSchemeTable.id, numberSchemeId));
        else {
          schemeFilters.push(
            eq(gmNumberSchemeTable.direction, letter.direction),
          );
          schemeFilters.push(eq(gmNumberSchemeTable.letterType, letter.type));
        }
        const [scheme] = await db
          .select()
          .from(gmNumberSchemeTable)
          .where(and(...schemeFilters))
          .limit(1);
        if (!scheme)
          throw new HTTPException(400, {
            message:
              "No active numbering scheme matches this letter's direction/type",
          });

        // Fixity: hash the primary attachment if present.
        let contentHash: string | null = null;
        if (letter.primaryAttachmentId) {
          const [att] = await db
            .select()
            .from(letterAttachmentTable)
            .where(eq(letterAttachmentTable.id, letter.primaryAttachmentId))
            .limit(1);
          if (att) contentHash = await sha256OfObject(att.objectKey);
        }

        const now = new Date();
        const result = await db.transaction(async (tx) => {
          const refNo = await allocateNumber(tx, scheme, now);
          const [row] = await tx
            .update(letterTable)
            .set({
              refNo,
              numberSchemeId: scheme.id,
              contentHash,
              declaredAt: now,
              status: "registered",
              updatedAt: now,
            })
            .where(and(eq(letterTable.id, id), eq(letterTable.workspaceId, ws)))
            .returning();
          if (contentHash && letter.primaryAttachmentId) {
            await tx
              .update(letterAttachmentTable)
              .set({ sha256: contentHash })
              .where(eq(letterAttachmentTable.id, letter.primaryAttachmentId));
          }
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: "register",
            actorId: userId,
            before: letter,
            after: row,
            ip: getIp(c),
          });
          return row as Row;
        });
        return c.json(result);
      },
    )
    // ── Classify ──────────────────────────────────────────────────────────────
    .post(
      "/letters/:id/classify",
      validator("param", v.object({ id: v.string() })),
      validator(
        "json",
        v.object({
          workspaceId: v.string(),
          categoryId: optStr,
          filePlanNodeId: optStr,
          securityLabelId: optStr,
        }),
      ),
      workspaceAccess.fromBody("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const { id } = c.req.valid("param");
        const b = c.req.valid("json");
        const before = await loadLetter(ws, id);
        if (!before) throw new HTTPException(404, { message: "Not found" });
        for (const [table, cid] of [
          [gmCategoryTable, b.categoryId],
          [gmFilePlanNodeTable, b.filePlanNodeId],
          [gmSecurityLabelTable, b.securityLabelId],
        ] as const) {
          if (!(await inWorkspace(table, cid, ws)))
            throw new HTTPException(400, { message: "Invalid reference" });
        }
        const after = await db.transaction(async (tx) => {
          const [row] = await tx
            .update(letterTable)
            .set({
              categoryId: b.categoryId ?? null,
              filePlanNodeId: b.filePlanNodeId ?? null,
              securityLabelId: b.securityLabelId ?? null,
              status:
                before.status === "registered" ? "classified" : before.status,
              updatedAt: new Date(),
            })
            .where(and(eq(letterTable.id, id), eq(letterTable.workspaceId, ws)))
            .returning();
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: "classify",
            actorId: userId,
            before,
            after: row,
            ip: getIp(c),
          });
          return row as Row;
        });
        return c.json(after);
      },
    )
    // ── Route / assign ────────────────────────────────────────────────────────
    .post(
      "/letters/:id/route",
      validator("param", v.object({ id: v.string() })),
      validator(
        "json",
        v.object({
          workspaceId: v.string(),
          toUserId: optStr,
          toDeptId: optStr,
          action: optStr,
          note: optStr,
          dueAt: optDate,
        }),
      ),
      workspaceAccess.fromBody("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const { id } = c.req.valid("param");
        const b = c.req.valid("json");
        const letter = await loadLetter(ws, id);
        if (!letter) throw new HTTPException(404, { message: "Not found" });
        const result = await db.transaction(async (tx) => {
          const [assignment] = await tx
            .insert(letterAssignmentTable)
            .values({
              letterId: id,
              fromUserId: userId,
              toUserId: b.toUserId ?? null,
              toDeptId: b.toDeptId ?? null,
              action: b.action ?? null,
              note: b.note ?? null,
              dueAt: toDate(b.dueAt),
              status: "pending",
            })
            .returning();
          const [row] = await tx
            .update(letterTable)
            .set({
              currentAssigneeId: b.toUserId ?? null,
              status: "assigned",
              updatedAt: new Date(),
            })
            .where(and(eq(letterTable.id, id), eq(letterTable.workspaceId, ws)))
            .returning();
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: "route",
            actorId: userId,
            after: { assignment, letter: row },
            ip: getIp(c),
          });
          return row as Row;
        });
        return c.json(result);
      },
    )
    // ── Minute ──────────────────────────────────────────────────────────────
    .post(
      "/letters/:id/minutes",
      validator("param", v.object({ id: v.string() })),
      validator(
        "json",
        v.object({
          workspaceId: v.string(),
          body: v.string(),
          actionType: optStr,
        }),
      ),
      workspaceAccess.fromBody("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const { id } = c.req.valid("param");
        const b = c.req.valid("json");
        const letter = await loadLetter(ws, id);
        if (!letter) throw new HTTPException(404, { message: "Not found" });
        if (!b.body.trim())
          throw new HTTPException(400, { message: "Minute body required" });
        const minute = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(letterMinuteTable)
            .values({
              letterId: id,
              authorId: userId,
              body: b.body.trim(),
              actionType: b.actionType ?? null,
            })
            .returning();
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: "minute",
            actorId: userId,
            after: row,
            ip: getIp(c),
          });
          return row as Row;
        });
        return c.json(minute, 201);
      },
    )
    // ── Status transition ─────────────────────────────────────────────────────
    .post(
      "/letters/:id/status",
      validator("param", v.object({ id: v.string() })),
      validator(
        "json",
        v.object({ workspaceId: v.string(), status: v.picklist(STATUSES) }),
      ),
      workspaceAccess.fromBody("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const { id } = c.req.valid("param");
        const { status } = c.req.valid("json");
        const before = await loadLetter(ws, id);
        if (!before) throw new HTTPException(404, { message: "Not found" });
        const after = await db.transaction(async (tx) => {
          const [row] = await tx
            .update(letterTable)
            .set({
              status,
              closedAt: status === "closed" ? new Date() : before.closedAt,
              updatedAt: new Date(),
            })
            .where(and(eq(letterTable.id, id), eq(letterTable.workspaceId, ws)))
            .returning();
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: "status",
            actorId: userId,
            before,
            after: row,
            ip: getIp(c),
          });
          return row as Row;
        });
        return c.json(after);
      },
    )
    // ── Link ──────────────────────────────────────────────────────────────────
    .post(
      "/letters/:id/links",
      validator("param", v.object({ id: v.string() })),
      validator(
        "json",
        v.object({
          workspaceId: v.string(),
          toLetterId: v.string(),
          relation: v.optional(v.picklist(["reply", "related", "supersedes"])),
        }),
      ),
      workspaceAccess.fromBody("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const { id } = c.req.valid("param");
        const b = c.req.valid("json");
        const [letter, target] = await Promise.all([
          loadLetter(ws, id),
          loadLetter(ws, b.toLetterId),
        ]);
        if (!letter || !target)
          throw new HTTPException(404, { message: "Not found" });
        const link = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(letterLinkTable)
            .values({
              fromLetterId: id,
              toLetterId: b.toLetterId,
              relation: b.relation ?? "related",
            })
            .returning();
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: "link",
            actorId: userId,
            after: row,
            ip: getIp(c),
          });
          return row as Row;
        });
        return c.json(link, 201);
      },
    )
    // ── Attachments: presign ──────────────────────────────────────────────────
    .post(
      "/letters/:id/attachments/presign",
      validator("param", v.object({ id: v.string() })),
      validator(
        "json",
        v.object({
          workspaceId: v.string(),
          filename: v.string(),
          contentType: v.string(),
          kind: v.optional(v.string()),
        }),
      ),
      workspaceAccess.fromBody("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const { id } = c.req.valid("param");
        const b = c.req.valid("json");
        const letter = await loadLetter(ws, id);
        if (!letter) throw new HTTPException(404, { message: "Not found" });
        const presigned = await createLetterFileUploadUrl({
          workspaceId: ws,
          letterId: id,
          kind: b.kind ?? "original",
          filename: b.filename,
          contentType: b.contentType,
        });
        return c.json(presigned);
      },
    )
    // ── Attachments: finalize ─────────────────────────────────────────────────
    .post(
      "/letters/:id/attachments/finalize",
      validator("param", v.object({ id: v.string() })),
      validator(
        "json",
        v.object({
          workspaceId: v.string(),
          objectKey: v.string(),
          filename: v.string(),
          mimeType: v.string(),
          size: v.number(),
          kind: v.optional(v.string()),
        }),
      ),
      workspaceAccess.fromBody("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const { id } = c.req.valid("param");
        const b = c.req.valid("json");
        const letter = await loadLetter(ws, id);
        if (!letter) throw new HTTPException(404, { message: "Not found" });
        if (
          b.objectKey.includes("..") ||
          !b.objectKey.includes(letterFileKeyOwnerSegment(ws, id))
        )
          throw new HTTPException(400, { message: "Invalid object key" });
        const created = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(letterAttachmentTable)
            .values({
              letterId: id,
              workspaceId: ws,
              objectKey: b.objectKey,
              filename: b.filename,
              mimeType: b.mimeType,
              size: b.size,
              kind: b.kind ?? "original",
              createdBy: userId,
            })
            .returning();
          // First attachment becomes the primary (drives fixity at register).
          if (!letter.primaryAttachmentId) {
            await tx
              .update(letterTable)
              .set({ primaryAttachmentId: (row as Row).id as string })
              .where(eq(letterTable.id, id));
          }
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: "attach",
            actorId: userId,
            after: row,
            ip: getIp(c),
          });
          return row as Row;
        });
        return c.json(created, 201);
      },
    )
    // ── Attachments: download (audited) ───────────────────────────────────────
    .get(
      "/letters/:id/attachments/:aid/download",
      validator("param", v.object({ id: v.string(), aid: v.string() })),
      validator("query", v.object({ workspaceId: v.string() })),
      workspaceAccess.fromQuery("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const { id, aid } = c.req.valid("param");
        const [att] = await db
          .select()
          .from(letterAttachmentTable)
          .where(
            and(
              eq(letterAttachmentTable.id, aid),
              eq(letterAttachmentTable.letterId, id),
              eq(letterAttachmentTable.workspaceId, ws),
            ),
          )
          .limit(1);
        if (!att) throw new HTTPException(404, { message: "Not found" });
        await db.transaction(async (tx) => {
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: "download",
            actorId: userId,
            after: { attachmentId: aid, filename: att.filename },
            ip: getIp(c),
          });
        });
        try {
          const object = await getPrivateObject(att.objectKey);
          return new Response(object.body as BodyInit, {
            headers: {
              "Cache-Control": "private, max-age=120",
              "Content-Type": object.contentType || att.mimeType,
              "Content-Disposition": `inline; filename="${att.filename}"`,
            },
          });
        } catch {
          throw new HTTPException(404, { message: "File not found" });
        }
      },
    );
}
