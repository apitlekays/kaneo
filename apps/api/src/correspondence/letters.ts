import { createHash } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import db from "../database";
import {
  gmCategoryTable,
  gmFilePlanNodeTable,
  gmNumberSchemeTable,
  gmOrganisationTable,
  gmRetentionClassTable,
  gmSecurityLabelTable,
  letterAssignmentTable,
  letterAttachmentTable,
  letterLinkTable,
  letterMinuteTable,
  letterTable,
  workspaceUserTable,
} from "../database/schema";
import createNotification from "../notification/controllers/create-notification";
import {
  createLetterFileUploadUrl,
  getObjectBytes,
  getPrivateObject,
  letterFileKeyOwnerSegment,
} from "../storage/s3";
import {
  hasWorkspacePageAccess,
  requireWorkspacePageAccess,
} from "../utils/page-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { broadcastToUser } from "../ws";
import {
  type AssignmentDecision,
  assertCanDecide,
  ownerAfterDecision,
} from "./assignment-rules";
import { attachmentAuditAction } from "./attachment-access";
import { recordAuditEvent } from "./audit";
import {
  INACTIVE_LETTER_STATUSES,
  letterStatusFilter,
  SEALED_LETTER_STATUSES,
} from "./letter-list-filter";
import { walkThread } from "./letter-thread";
import { allocateNumber } from "./numbering";
import { loadOutgoingDetail } from "./outgoing";
import { letterUrgencySchema } from "./register-fields";
import { loadLifecycleDetail, retentionDueDate } from "./retention";
import {
  assertNoOpenActions,
  assertStatusChangeAllowed,
  resolveClosedAt,
} from "./status-rules";

type GmEnv = { Variables: { userId: string; workspaceId?: string } };
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
    | typeof gmOrganisationTable
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
  const bytes = await getObjectBytes(objectKey);
  return createHash("sha256").update(bytes).digest("hex");
}

async function isWorkspaceMember(userId: string, workspaceId: string) {
  const [row] = await db
    .select({ id: workspaceUserTable.id })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Per-letter access. GM page-holders see and manage everything; a routed
 * participant (Main User / route recipient / delegated action assignee) may
 * view the letter and — if they are the current assignee — minute actions,
 * even without general-management page access.
 */
async function resolveLetterAccess(
  userId: string,
  workspaceId: string,
  letter: { id: string; currentAssigneeId: string | null },
): Promise<{ hasPage: boolean; canView: boolean; canMinute: boolean }> {
  if (await hasWorkspacePageAccess(userId, workspaceId, PAGE_SLUG))
    return { hasPage: true, canView: true, canMinute: true };
  const isAssignee = letter.currentAssigneeId === userId;
  let participant = isAssignee;
  if (!participant) {
    const [asn] = await db
      .select({ id: letterAssignmentTable.id })
      .from(letterAssignmentTable)
      .where(
        and(
          eq(letterAssignmentTable.letterId, letter.id),
          eq(letterAssignmentTable.toUserId, userId),
        ),
      )
      .limit(1);
    participant = Boolean(asn);
  }
  if (!participant) {
    const [mn] = await db
      .select({ id: letterMinuteTable.id })
      .from(letterMinuteTable)
      .where(
        and(
          eq(letterMinuteTable.letterId, letter.id),
          eq(letterMinuteTable.assigneeId, userId),
        ),
      )
      .limit(1);
    participant = Boolean(mn);
  }
  return { hasPage: false, canView: participant, canMinute: isAssignee };
}

/** Notify a user that a letter is awaiting their inspection (Main User). */
async function notifyAssigned(
  toUserId: string,
  letter: {
    id: string;
    refNo: string | null;
    subject: string;
    urgency: string;
  },
) {
  await createNotification({
    userId: toUserId,
    type: "letter_assigned",
    title: `Correspondence to inspect — ${letter.refNo ?? letter.subject}`,
    content: letter.subject,
    eventData: { letterId: letter.id, urgency: letter.urgency },
    resourceId: letter.id,
    resourceType: "letter",
  }).catch(() => {});
}

export async function decideLetterAssignment(args: {
  workspaceId: string;
  userId: string;
  letterId: string;
  assignmentId: string;
  decision: AssignmentDecision;
  reason: string | null;
  ip: string | null;
}) {
  const { workspaceId: ws, userId, letterId: id, assignmentId: aid } = args;
  const { decision, reason: note } = args;

  const [assignment] = await db
    .select({
      id: letterAssignmentTable.id,
      letterId: letterAssignmentTable.letterId,
      fromUserId: letterAssignmentTable.fromUserId,
      toUserId: letterAssignmentTable.toUserId,
      toDeptId: letterAssignmentTable.toDeptId,
      action: letterAssignmentTable.action,
      status: letterAssignmentTable.status,
      note: letterAssignmentTable.note,
      letterStatus: letterTable.status,
      letterAssigneeId: letterTable.currentAssigneeId,
      letterClosedAt: letterTable.closedAt,
    })
    .from(letterAssignmentTable)
    .innerJoin(letterTable, eq(letterAssignmentTable.letterId, letterTable.id))
    .where(
      and(
        eq(letterAssignmentTable.id, aid),
        eq(letterAssignmentTable.letterId, id),
        eq(letterTable.workspaceId, ws),
      ),
    )
    .limit(1);
  if (!assignment) throw new HTTPException(404, { message: "Not found" });
  assertCanDecide(assignment, userId);
  // A decision rewrites ownership, so it must respect the lifecycle: an
  // archived record is kept permanently and a disposed one has had its
  // destruction certificate issued. A closed record is NOT sealed — a
  // follow-up reply reopens it. A legal hold is a preservation order, not a
  // freeze on handling: it blocks disposal (see retention.ts), not custody.
  if (
    SEALED_LETTER_STATUSES.includes(
      assignment.letterStatus as (typeof SEALED_LETTER_STATUSES)[number],
    )
  )
    throw new HTTPException(409, {
      message: `Cannot accept or reject a ${assignment.letterStatus} record`,
    });

  const owner = ownerAfterDecision(assignment, decision);
  const decidedAt = new Date();
  // A captured letter has no reference number yet: it must stay on the
  // "pending registration" tile until it is registered, however it is owned.
  const nextStatus =
    assignment.letterStatus === "captured" ? "captured" : "assigned";
  // Accepting a closed letter reopens it; leave the close date behind, or the
  // retention clock keeps running against a record that is active again.
  const nextClosedAt = resolveClosedAt({
    status: nextStatus,
    previousStatus: assignment.letterStatus,
    previousClosedAt: assignment.letterClosedAt,
    now: decidedAt,
  });

  const updated = await db.transaction(async (tx) => {
    // The `pending` predicate is the concurrency guard: the assignment was read
    // outside this transaction, so a competing decision may have landed since.
    // Nothing else in here runs unless this update actually claims the row.
    const decided = await tx
      .update(letterAssignmentTable)
      // The sender's routing instruction stays put — in a register both it and
      // the rejection reason are record, and the reason goes to the audit trail.
      .set({ status: decision, decidedAt })
      .where(
        and(
          eq(letterAssignmentTable.id, aid),
          eq(letterAssignmentTable.status, "pending"),
        ),
      )
      .returning({ id: letterAssignmentTable.id });
    if (decided.length === 0)
      throw new HTTPException(409, {
        message: "This assignment was already decided",
      });
    // The sealed predicate closes the window between the guard above and this
    // write: a disposal committing in between makes this match nothing rather
    // than reopening a destroyed record.
    const [row] = await tx
      .update(letterTable)
      .set({
        currentAssigneeId: owner,
        status: nextStatus,
        closedAt: nextClosedAt,
        updatedAt: decidedAt,
      })
      .where(
        and(
          eq(letterTable.id, id),
          eq(letterTable.workspaceId, ws),
          notInArray(letterTable.status, [...SEALED_LETTER_STATUSES]),
        ),
      )
      .returning();
    if (!row)
      throw new HTTPException(409, {
        message: "This record was sealed before the decision was recorded",
      });
    await recordAuditEvent(tx, {
      workspaceId: ws,
      entityType: "letter",
      entityId: id,
      action: decision === "accepted" ? "accept" : "reject",
      actorId: userId,
      before: {
        currentAssigneeId: assignment.letterAssigneeId,
        status: assignment.letterStatus,
      },
      after: {
        assignmentId: aid,
        currentAssigneeId: row.currentAssigneeId,
        status: row.status,
        reason: note,
      },
      ip: args.ip,
    });
    return row;
  });
  if (assignment.toUserId)
    broadcastToUser(assignment.toUserId, { entity: "letter-assignment" });
  if (decision === "rejected" && assignment.fromUserId)
    broadcastToUser(assignment.fromUserId, { entity: "letter-assignment" });
  return updated;
}

async function decideAssignment(
  c: Context,
  decision: AssignmentDecision,
  note: string | null,
) {
  const { id, aid } = c.req.param();
  const updated = await decideLetterAssignment({
    workspaceId: c.get("workspaceId") as string,
    userId: c.get("userId") as string,
    letterId: id,
    assignmentId: aid,
    decision,
    reason: note,
    ip: getIp(c),
  });
  return c.json(updated);
}

export function registerLetterRoutes(app: Hono<GmEnv>) {
  app
    // ── My correspondence (Home feed — any member, own items only) ────────────
    .get(
      "/my-correspondence",
      validator("query", v.object({ workspaceId: v.string() })),
      workspaceAccess.fromQuery("workspaceId"),
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        // Letters I lead (Main User) that are still active.
        const letters = await db
          .select({
            id: letterTable.id,
            refNo: letterTable.refNo,
            subject: letterTable.subject,
            direction: letterTable.direction,
            status: letterTable.status,
            urgency: letterTable.urgency,
            receivedAt: letterTable.receivedAt,
            createdAt: letterTable.createdAt,
          })
          .from(letterTable)
          .where(
            and(
              eq(letterTable.workspaceId, ws),
              eq(letterTable.currentAssigneeId, userId),
              notInArray(letterTable.status, [...INACTIVE_LETTER_STATUSES]),
            ),
          )
          .orderBy(desc(letterTable.createdAt));
        // Open actions delegated to me via a minute.
        const actions = await db
          .select({
            id: letterMinuteTable.id,
            letterId: letterMinuteTable.letterId,
            body: letterMinuteTable.body,
            actionType: letterMinuteTable.actionType,
            dueAt: letterMinuteTable.dueAt,
            createdAt: letterMinuteTable.createdAt,
            refNo: letterTable.refNo,
            subject: letterTable.subject,
          })
          .from(letterMinuteTable)
          .innerJoin(
            letterTable,
            eq(letterMinuteTable.letterId, letterTable.id),
          )
          .where(
            and(
              eq(letterTable.workspaceId, ws),
              eq(letterMinuteTable.assigneeId, userId),
              eq(letterMinuteTable.status, "open"),
            ),
          )
          .orderBy(
            asc(letterMinuteTable.dueAt),
            desc(letterMinuteTable.createdAt),
          );
        // Assignments awaiting my accept/reject decision.
        const pendingAssignments = await db
          .select({
            id: letterAssignmentTable.id,
            letterId: letterAssignmentTable.letterId,
            action: letterAssignmentTable.action,
            note: letterAssignmentTable.note,
            createdAt: letterAssignmentTable.createdAt,
            refNo: letterTable.refNo,
            subject: letterTable.subject,
          })
          .from(letterAssignmentTable)
          .innerJoin(
            letterTable,
            eq(letterAssignmentTable.letterId, letterTable.id),
          )
          .where(
            and(
              eq(letterTable.workspaceId, ws),
              eq(letterAssignmentTable.toUserId, userId),
              eq(letterAssignmentTable.status, "pending"),
              // Rows written before routing was guarded can point at a sealed
              // letter; showing them would be an item the user cannot clear.
              notInArray(letterTable.status, [...SEALED_LETTER_STATUSES]),
            ),
          )
          .orderBy(desc(letterAssignmentTable.createdAt));
        return c.json({ letters, actions, pendingAssignments });
      },
    )
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
          disposed: v.optional(v.picklist(["true", "false"])),
        }),
      ),
      workspaceAccess.fromQuery("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const { direction, type, status, q, disposed } = c.req.valid("query");
        const filters = [eq(letterTable.workspaceId, ws)];
        if (direction) filters.push(eq(letterTable.direction, direction));
        if (type) filters.push(eq(letterTable.type, type));
        const statusFilter = letterStatusFilter({
          status,
          disposed: disposed === "true",
        });
        filters.push(
          statusFilter.kind === "equals"
            ? eq(letterTable.status, statusFilter.status)
            : ne(letterTable.status, statusFilter.status),
        );
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
                r.senderOrg?.toLowerCase().includes(term) ||
                r.externalRefNo?.toLowerCase().includes(term),
            )
          : rows;
        // Delegated-action progress per letter (minutes with an assignee).
        const counts = await db
          .select({
            letterId: letterMinuteTable.letterId,
            total: sql<number>`count(*)::int`,
            done: sql<number>`count(*) filter (where ${letterMinuteTable.status} = 'done')::int`,
          })
          .from(letterMinuteTable)
          .innerJoin(
            letterTable,
            eq(letterMinuteTable.letterId, letterTable.id),
          )
          .where(
            and(
              eq(letterTable.workspaceId, ws),
              isNotNull(letterMinuteTable.assigneeId),
            ),
          )
          .groupBy(letterMinuteTable.letterId);
        const countMap = new Map(
          counts.map((r) => [r.letterId, { total: r.total, done: r.done }]),
        );
        // Links in both directions, merged into one per-letter count: a
        // letter linked only as a target still has a link.
        const linkRows = await db
          .select({
            letterId: letterLinkTable.fromLetterId,
            n: sql<number>`count(*)::int`,
          })
          .from(letterLinkTable)
          .innerJoin(
            letterTable,
            eq(letterLinkTable.fromLetterId, letterTable.id),
          )
          .where(eq(letterTable.workspaceId, ws))
          .groupBy(letterLinkTable.fromLetterId);
        const inboundLinkRows = await db
          .select({
            letterId: letterLinkTable.toLetterId,
            n: sql<number>`count(*)::int`,
          })
          .from(letterLinkTable)
          .innerJoin(
            letterTable,
            eq(letterLinkTable.toLetterId, letterTable.id),
          )
          .where(eq(letterTable.workspaceId, ws))
          .groupBy(letterLinkTable.toLetterId);
        const linkMap = new Map<string, number>();
        for (const r of [...linkRows, ...inboundLinkRows])
          linkMap.set(r.letterId, (linkMap.get(r.letterId) ?? 0) + r.n);
        const withCounts = filtered.map((r) => ({
          ...r,
          actionsTotal: countMap.get(r.id)?.total ?? 0,
          actionsDone: countMap.get(r.id)?.done ?? 0,
          linkCount: linkMap.get(r.id) ?? 0,
        }));
        return c.json(withCounts);
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
            legalHold: letterTable.legalHold,
            closedAt: letterTable.closedAt,
            retentionClassId: letterTable.retentionClassId,
            dispositionStatus: letterTable.dispositionStatus,
          })
          .from(letterTable)
          .where(eq(letterTable.workspaceId, ws));
        const classes = await db
          .select()
          .from(gmRetentionClassTable)
          .where(eq(gmRetentionClassTable.workspaceId, ws));
        const classMap = new Map(classes.map((r) => [r.id, r]));

        const byStatus: Record<string, number> = {};
        const now = new Date();
        let incoming = 0;
        let outgoing = 0;
        let pendingRegistration = 0;
        let unassigned = 0;
        let onHold = 0;
        let dueForDisposition = 0;
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
          if (r.legalHold) onHold++;
          if (
            !r.legalHold &&
            !r.dispositionStatus &&
            r.closedAt &&
            r.retentionClassId
          ) {
            const cls = classMap.get(r.retentionClassId);
            if (
              cls &&
              retentionDueDate(r.closedAt, cls.retentionMonths, cls.trigger) <=
                now
            )
              dueForDisposition++;
          }
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
          onHold,
          dueForDisposition,
          byStatus,
        });
      },
    )
    // ── GM watchlist: pending assignments nobody has accepted yet ───────────────
    // Registered before "/letters/:id" so "awaiting-acceptance" is not
    // captured as an :id param.
    .get(
      "/letters/awaiting-acceptance",
      validator("query", v.object({ workspaceId: v.string() })),
      workspaceAccess.fromQuery("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const rows = await db
          .select({
            id: letterAssignmentTable.id,
            letterId: letterAssignmentTable.letterId,
            toUserId: letterAssignmentTable.toUserId,
            action: letterAssignmentTable.action,
            note: letterAssignmentTable.note,
            status: letterAssignmentTable.status,
            decidedAt: letterAssignmentTable.decidedAt,
            createdAt: letterAssignmentTable.createdAt,
            refNo: letterTable.refNo,
            externalRefNo: letterTable.externalRefNo,
            direction: letterTable.direction,
            subject: letterTable.subject,
            currentAssigneeId: letterTable.currentAssigneeId,
          })
          .from(letterAssignmentTable)
          .innerJoin(
            letterTable,
            eq(letterAssignmentTable.letterId, letterTable.id),
          )
          .where(
            and(
              eq(letterTable.workspaceId, ws),
              or(
                eq(letterAssignmentTable.status, "pending"),
                // A rejection leaves the letter with whoever sent it and
                // creates no new pending row, so it would otherwise vanish
                // from every queue. Keep it visible until someone acts:
                // routing the letter again, or the letter reaching a
                // terminal state, clears it without a dismiss button.
                and(
                  eq(letterAssignmentTable.status, "rejected"),
                  notInArray(letterTable.status, [...INACTIVE_LETTER_STATUSES]),
                  sql`NOT EXISTS (
                    SELECT 1 FROM letter_assignment AS newer
                    WHERE newer.letter_id = ${letterAssignmentTable.letterId}
                      AND newer.created_at > ${letterAssignmentTable.createdAt}
                  )`,
                ),
              ),
            ),
          )
          .orderBy(asc(letterAssignmentTable.createdAt));
        return c.json(rows);
      },
    )
    // ── Thread: every letter linked to this one, in either direction ──────────
    // Registered before "/letters/:id" so "thread" is not captured as an
    // :id param, the same way "/letters/awaiting-acceptance" is placed above.
    .get(
      "/letters/:id/thread",
      describeRoute({
        operationId: "getLetterThread",
        tags: ["Correspondence"],
        description: "Every letter linked to this one, newest first",
      }),
      validator("param", v.object({ id: v.string() })),
      validator("query", v.object({ workspaceId: v.string() })),
      workspaceAccess.fromQuery("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const { id } = c.req.valid("param");
        // Only edges whose BOTH ends live in this workspace. A link pointing
        // outside it must never surface a letter the reader cannot see, and
        // must not even enter the walk — a foreign id consuming a slot of
        // walkThread's cap would let data the caller can never see decide
        // whether they're told the thread was truncated.
        const toLetterTable = alias(letterTable, "toLetterTable");
        const edges = await db
          .select({
            fromLetterId: letterLinkTable.fromLetterId,
            toLetterId: letterLinkTable.toLetterId,
          })
          .from(letterLinkTable)
          .innerJoin(
            letterTable,
            eq(letterLinkTable.fromLetterId, letterTable.id),
          )
          .innerJoin(
            toLetterTable,
            eq(letterLinkTable.toLetterId, toLetterTable.id),
          )
          .where(
            and(
              eq(letterTable.workspaceId, ws),
              eq(toLetterTable.workspaceId, ws),
            ),
          );
        const { ids, truncated } = walkThread(id, edges);
        const rows = await db
          .select({
            id: letterTable.id,
            refNo: letterTable.refNo,
            externalRefNo: letterTable.externalRefNo,
            subject: letterTable.subject,
            direction: letterTable.direction,
            receivedAt: letterTable.receivedAt,
            letterDate: letterTable.letterDate,
            createdAt: letterTable.createdAt,
          })
          .from(letterTable)
          .where(
            and(inArray(letterTable.id, ids), eq(letterTable.workspaceId, ws)),
          );
        const letters = rows
          .map((r) => ({
            ...r,
            date: r.receivedAt ?? r.letterDate ?? r.createdAt,
            isSeed: r.id === id,
          }))
          .sort((a, b) => b.date.getTime() - a.date.getTime());
        return c.json({ letters, truncated });
      },
    )
    // ── Detail ────────────────────────────────────────────────────────────────
    .get(
      "/letters/:id",
      validator("param", v.object({ id: v.string() })),
      validator("query", v.object({ workspaceId: v.string() })),
      workspaceAccess.fromQuery("workspaceId"),
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const { id } = c.req.valid("param");
        const letter = await loadLetter(ws, id);
        if (!letter) throw new HTTPException(404, { message: "Not found" });
        const access = await resolveLetterAccess(userId, ws, letter);
        if (!access.canView)
          throw new HTTPException(403, {
            message: "You don't have access to this correspondence",
          });
        const [attachments, minutes, assignments, outboundLinks, inboundLinks] =
          await Promise.all([
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
            db
              .select()
              .from(letterLinkTable)
              .where(eq(letterLinkTable.toLetterId, id)),
          ]);
        const links = [
          ...outboundLinks.map((l) => ({ ...l, outbound: true })),
          ...inboundLinks.map((l) => ({ ...l, outbound: false })),
        ];
        const outgoing = await loadOutgoingDetail(id);
        const lifecycle = await loadLifecycleDetail(id);
        return c.json({
          ...letter,
          attachments,
          minutes,
          assignments,
          links,
          ...outgoing,
          ...lifecycle,
        });
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
          externalRefNo: optStr,
          urgency: v.optional(letterUrgencySchema),
          organisationId: optStr,
          assigneeId: optStr,
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
          [gmOrganisationTable, b.organisationId],
        ] as const) {
          if (!(await inWorkspace(table, id, ws)))
            throw new HTTPException(400, { message: "Invalid reference" });
        }
        // Optional Main User assigned at registration (must be a member).
        const assigneeId = b.assigneeId?.trim() || null;
        if (assigneeId && !(await isWorkspaceMember(assigneeId, ws)))
          throw new HTTPException(400, { message: "Invalid assignee" });
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
              externalRefNo: b.externalRefNo ?? null,
              urgency: b.urgency ?? "normal",
              organisationId: b.organisationId ?? null,
              status: "captured",
              // Ownership transfers only when the assignee accepts.
              currentAssigneeId: null,
              createdBy: userId,
            })
            .returning();
          const letterId = (row as Row).id as string;
          if (assigneeId) {
            await tx.insert(letterAssignmentTable).values({
              letterId,
              fromUserId: userId,
              toUserId: assigneeId,
              action: "inspect",
              note: "Assigned as Main User at registration",
              status: "pending",
            });
          }
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: letterId,
            action: "capture",
            actorId: userId,
            after: row,
            ip: getIp(c),
          });
          return row as Row;
        });
        // Notify the Main User (best-effort; never blocks capture).
        if (assigneeId)
          await notifyAssigned(assigneeId, {
            id: created.id as string,
            refNo: (created.refNo as string | null) ?? null,
            subject,
            urgency: created.urgency as string,
          });
        if (assigneeId)
          broadcastToUser(assigneeId, { entity: "letter-assignment" });
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
          externalRefNo: optStr,
          urgency: v.optional(letterUrgencySchema),
          organisationId: optStr,
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
        if (!(await inWorkspace(gmOrganisationTable, b.organisationId, ws)))
          throw new HTTPException(400, { message: "Invalid reference" });
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
          "externalRefNo",
          "urgency",
          "organisationId",
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
        // Routing a sealed record would create a pending row its recipient
        // could never clear: both Accept and Reject refuse one.
        if (
          SEALED_LETTER_STATUSES.includes(
            letter.status as (typeof SEALED_LETTER_STATUSES)[number],
          )
        )
          throw new HTTPException(409, {
            message: `Cannot route a ${letter.status} record`,
          });
        const { result, bypassed } = await db.transaction(async (tx) => {
          // A recipient who is bypassed must not keep a stale pending item.
          const superseded = await tx
            .update(letterAssignmentTable)
            .set({ status: "superseded", decidedAt: new Date() })
            .where(
              and(
                eq(letterAssignmentTable.letterId, id),
                eq(letterAssignmentTable.status, "pending"),
              ),
            )
            .returning({
              id: letterAssignmentTable.id,
              toUserId: letterAssignmentTable.toUserId,
            });
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
              // currentAssigneeId is unchanged: the handover is not complete
              // until the recipient accepts.
              updatedAt: new Date(),
            })
            .where(and(eq(letterTable.id, id), eq(letterTable.workspaceId, ws)))
            .returning();
          // Cancelling someone's pending work is a change of record in its own
          // right: it is recorded before the route event that caused it.
          if (superseded.length > 0)
            await recordAuditEvent(tx, {
              workspaceId: ws,
              entityType: "letter",
              entityId: id,
              action: "supersede",
              actorId: userId,
              after: { assignmentIds: superseded.map((a) => a.id) },
              ip: getIp(c),
            });
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: "route",
            actorId: userId,
            after: { assignment, letter: row },
            ip: getIp(c),
          });
          return { result: row as Row, bypassed: superseded };
        });
        // Notify the assignee (best-effort; never blocks the routing).
        if (b.toUserId)
          await notifyAssigned(b.toUserId, {
            id,
            refNo: letter.refNo,
            subject: letter.subject,
            urgency: letter.urgency,
          });
        if (b.toUserId)
          broadcastToUser(b.toUserId, { entity: "letter-assignment" });
        // Without this the bypassed recipient keeps a lit dot on a letter they
        // can no longer act on, and Accept later fails with a 409.
        for (const userIdToNotify of new Set(
          bypassed
            .map((a) => a.toUserId)
            .filter((u): u is string => !!u && u !== b.toUserId),
        ))
          broadcastToUser(userIdToNotify, { entity: "letter-assignment" });
        return c.json(result);
      },
    )
    // ── Minute (optionally a delegated action to one user) ────────────────────
    .post(
      "/letters/:id/minutes",
      validator("param", v.object({ id: v.string() })),
      validator(
        "json",
        v.object({
          workspaceId: v.string(),
          body: v.string(),
          actionType: optStr,
          assigneeId: optStr,
          dueAt: optDate,
        }),
      ),
      workspaceAccess.fromBody("workspaceId"),
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const { id } = c.req.valid("param");
        const b = c.req.valid("json");
        const letter = await loadLetter(ws, id);
        if (!letter) throw new HTTPException(404, { message: "Not found" });
        const access = await resolveLetterAccess(userId, ws, letter);
        if (!access.canMinute)
          throw new HTTPException(403, {
            message: "Only the current assignee or a GM officer can minute",
          });
        if (!b.body.trim())
          throw new HTTPException(400, { message: "Minute body required" });
        const assigneeId = b.assigneeId?.trim() || null;
        if (assigneeId && !(await isWorkspaceMember(assigneeId, ws)))
          throw new HTTPException(400, { message: "Invalid assignee" });
        const minute = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(letterMinuteTable)
            .values({
              letterId: id,
              authorId: userId,
              body: b.body.trim(),
              actionType: b.actionType ?? null,
              assigneeId,
              dueAt: assigneeId ? toDate(b.dueAt) : null,
              status: "open",
            })
            .returning();
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: assigneeId ? "minute-action" : "minute",
            actorId: userId,
            after: row,
            ip: getIp(c),
          });
          return row as Row;
        });
        // Delegate an action → notify the assignee (best-effort).
        if (assigneeId)
          await createNotification({
            userId: assigneeId,
            type: "letter_action_assigned",
            title: `Action required — ${letter.refNo ?? letter.subject}`,
            content: b.body.trim(),
            resourceId: id,
            resourceType: "letter",
          }).catch(() => {});
        return c.json(minute, 201);
      },
    )
    // ── Complete a delegated action (its assignee, or a GM officer) ───────────
    .post(
      "/letters/:id/minutes/:mid/complete",
      validator("param", v.object({ id: v.string(), mid: v.string() })),
      validator("json", v.object({ workspaceId: v.string() })),
      workspaceAccess.fromBody("workspaceId"),
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const { id, mid } = c.req.valid("param");
        const letter = await loadLetter(ws, id);
        if (!letter) throw new HTTPException(404, { message: "Not found" });
        const [minute] = await db
          .select()
          .from(letterMinuteTable)
          .where(
            and(
              eq(letterMinuteTable.id, mid),
              eq(letterMinuteTable.letterId, id),
            ),
          )
          .limit(1);
        if (!minute || !minute.assigneeId)
          throw new HTTPException(404, { message: "Action not found" });
        const hasPage = await hasWorkspacePageAccess(userId, ws, PAGE_SLUG);
        if (minute.assigneeId !== userId && !hasPage)
          throw new HTTPException(403, {
            message: "Only the action's assignee can complete it",
          });
        if (minute.status === "done")
          throw new HTTPException(409, { message: "Action already completed" });
        const now = new Date();
        const updated = await db.transaction(async (tx) => {
          const [row] = await tx
            .update(letterMinuteTable)
            .set({ status: "done", completedAt: now, completedBy: userId })
            .where(eq(letterMinuteTable.id, mid))
            .returning();
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: "action-complete",
            actorId: userId,
            before: minute,
            after: row,
            ip: getIp(c),
          });
          return row as Row;
        });
        // Notify the Main User — and, if this was the last open action, nudge
        // that the correspondence is ready to close.
        if (letter.currentAssigneeId && letter.currentAssigneeId !== userId) {
          const [openRow] = await db
            .select({ n: sql<number>`count(*)::int` })
            .from(letterMinuteTable)
            .where(
              and(
                eq(letterMinuteTable.letterId, id),
                isNotNull(letterMinuteTable.assigneeId),
                notInArray(letterMinuteTable.status, ["done", "cancelled"]),
              ),
            );
          const allDone = (openRow?.n ?? 0) === 0;
          await createNotification({
            userId: letter.currentAssigneeId,
            type: "letter_action_completed",
            title: allDone
              ? `All actions complete — ready to close — ${letter.refNo ?? letter.subject}`
              : `Action completed — ${letter.refNo ?? letter.subject}`,
            content: allDone
              ? "All delegated actions are complete. You can now close this correspondence."
              : minute.body,
            resourceId: id,
            resourceType: "letter",
          }).catch(() => {});
        }
        return c.json(updated);
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
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const { id } = c.req.valid("param");
        const { status } = c.req.valid("json");
        const before = await loadLetter(ws, id);
        if (!before) throw new HTTPException(404, { message: "Not found" });
        assertStatusChangeAllowed({
          status,
          hasPageAccess: await hasWorkspacePageAccess(userId, ws, PAGE_SLUG),
          isCurrentAssignee: before.currentAssigneeId === userId,
        });
        if (status === "closed") {
          const [openRow] = await db
            .select({ n: sql<number>`count(*)::int` })
            .from(letterMinuteTable)
            .where(
              and(
                eq(letterMinuteTable.letterId, id),
                isNotNull(letterMinuteTable.assigneeId),
                notInArray(letterMinuteTable.status, ["done", "cancelled"]),
              ),
            );
          assertNoOpenActions(openRow?.n ?? 0);
        }
        const after = await db.transaction(async (tx) => {
          const [row] = await tx
            .update(letterTable)
            .set({
              status,
              closedAt: resolveClosedAt({
                status,
                previousStatus: before.status,
                previousClosedAt: before.closedAt,
                now: new Date(),
              }),
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
        // A letter linking to itself would show up in BOTH halves of its
        // own detail query (outbound and inbound), duplicating the row
        // under one React key and doubling linkCount — and there is no
        // delete route to undo it once written.
        if (b.toLetterId === id)
          throw new HTTPException(400, {
            message: "A letter cannot be linked to itself",
          });
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
      validator(
        "query",
        v.object({
          workspaceId: v.string(),
          preview: v.optional(v.picklist(["true", "false"])),
        }),
      ),
      workspaceAccess.fromQuery("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const { id, aid } = c.req.valid("param");
        const { preview } = c.req.valid("query");
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
            action: attachmentAuditAction({ preview }),
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
    )
    // ── Accept / reject a pending assignment ─────────────────────────────────
    .post(
      "/letters/:id/assignments/:aid/accept",
      validator("param", v.object({ id: v.string(), aid: v.string() })),
      validator("json", v.object({ workspaceId: v.string() })),
      workspaceAccess.fromBody("workspaceId"),
      async (c) => decideAssignment(c, "accepted", null),
    )
    .post(
      "/letters/:id/assignments/:aid/reject",
      validator("param", v.object({ id: v.string(), aid: v.string() })),
      validator("json", v.object({ workspaceId: v.string(), note: optStr })),
      workspaceAccess.fromBody("workspaceId"),
      async (c) =>
        decideAssignment(
          c,
          "rejected",
          c.req.valid("json").note?.trim() || null,
        ),
    );
}
