import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import { assertGmAdmin } from "../correspondence/roles";
import db from "../database";
import {
  meetingActionTable,
  meetingAttendeeTable,
  meetingBodyMemberTable,
  meetingBodyTable,
  meetingMinuteItemTable,
  meetingTable,
  meetingTypeTable,
  workspaceUserTable,
} from "../database/schema";
import createNotification from "../notification/controllers/create-notification";
import {
  hasWorkspacePageAccess,
  requireWorkspacePageAccess,
} from "../utils/page-access";
import { isGlobalAdmin } from "../utils/project-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { canReadMeeting } from "./access";
import { canAdoptMeeting } from "./action-rules";

// Context variables populated by the auth + workspace-access middleware.
type MeetingEnv = { Variables: { userId: string; workspaceId?: string } };
type Row = Record<string, unknown>;

const PAGE_SLUG = "general-management";
const pageAccess = requireWorkspacePageAccess(PAGE_SLUG);

const ATTENDANCE = ["present", "apology", "absent"] as const;

const optStr = v.optional(v.string());
const optBool = v.optional(v.boolean());
const optDate = v.optional(v.string());
const optNum = v.optional(v.number());

function toDate(value: unknown) {
  if (!value || typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Copy only the defined keys from a request body into a typed update patch. */
function patch<T extends Row>(
  body: Row,
  keys: (keyof T & string)[],
): Partial<T> {
  const out: Partial<T> = {};
  for (const key of keys) {
    if (body[key] !== undefined) out[key] = body[key] as T[keyof T & string];
  }
  return out;
}

async function loadMeeting(workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(meetingTable)
    .where(
      and(eq(meetingTable.id, id), eq(meetingTable.workspaceId, workspaceId)),
    )
    .limit(1);
  return row ?? null;
}

async function loadAttendeeUserIds(meetingId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: meetingAttendeeTable.userId })
    .from(meetingAttendeeTable)
    .where(eq(meetingAttendeeTable.meetingId, meetingId));
  return rows.map((r) => r.userId).filter((id): id is string => Boolean(id));
}

/**
 * The caller's role on a meeting's body — null both when the meeting is
 * standalone (no bodyId) and when the caller simply isn't a member of that
 * body. `canAdoptMeeting` treats both cases identically.
 */
async function bodyRoleFor(
  bodyId: string | null | undefined,
  userId: string,
): Promise<string | null> {
  if (!bodyId) return null;
  const [row] = await db
    .select({ role: meetingBodyMemberTable.role })
    .from(meetingBodyMemberTable)
    .where(
      and(
        eq(meetingBodyMemberTable.bodyId, bodyId),
        eq(meetingBodyMemberTable.userId, userId),
        eq(meetingBodyMemberTable.active, true),
      ),
    )
    .limit(1);
  return row?.role ?? null;
}

/** Verify a config id belongs to the workspace (or is null/undefined). */
async function idInWorkspace(
  table:
    | typeof meetingTypeTable
    | typeof meetingBodyTable
    | typeof meetingTable,
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

/**
 * Every read route composes this: a refusal throws 403. Callers must have
 * already resolved the meeting from the caller's own workspace (a mismatch
 * is a 404, not a 403 — see `loadMeeting`).
 */
async function assertCanReadMeeting(
  userId: string,
  workspaceId: string,
  meeting: { confidential: boolean; id: string },
): Promise<void> {
  const attendeeUserIds = await loadAttendeeUserIds(meeting.id);
  const admin = await isGlobalAdmin(userId, workspaceId);
  if (
    !canReadMeeting({
      confidential: meeting.confidential,
      attendeeUserIds,
      userId,
      isGlobalAdmin: admin,
    })
  )
    throw new HTTPException(403, {
      message: "You don't have access to this meeting",
    });
}

/**
 * Write authority for an existing meeting: a GM admin, or the person who
 * created it. There is no `createdBy` to check at creation time, so `POST
 * /meeting` itself is gated on holding the General Management page instead
 * (see the route below) — this helper only applies once a meeting exists.
 */
async function assertMeetingWriteAccess(
  userId: string,
  workspaceId: string,
  meeting: { createdBy: string | null },
): Promise<void> {
  if (meeting.createdBy === userId) return;
  await assertGmAdmin(userId, workspaceId);
}

/** Adopted minutes are read-only: editing attendees or minute items is 409. */
function assertMeetingEditable(meeting: { status: string }): void {
  if (meeting.status === "adopted")
    throw new HTTPException(409, {
      message: "This meeting has been adopted; its minutes are read-only",
    });
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

/** Exactly one of userId / name must be set — the schema cannot express this. */
function assertExactlyOneOfUserIdOrName(
  userId: string | null | undefined,
  name: string | null | undefined,
): void {
  const hasUserId = Boolean(userId?.trim());
  const hasName = Boolean(name?.trim());
  if (hasUserId === hasName)
    throw new HTTPException(400, {
      message: "Provide exactly one of userId or name",
    });
}

const app = new Hono<MeetingEnv>();

// ── List ─────────────────────────────────────────────────────────────────
app.get(
  "/",
  describeRoute({
    operationId: "listMeetings",
    tags: ["Meeting"],
    description: "List meetings in a workspace, confidentiality-filtered",
  }),
  validator("query", v.object({ workspaceId: v.string() })),
  workspaceAccess.fromQuery("workspaceId"),
  pageAccess,
  async (c) => {
    const ws = c.get("workspaceId") as string;
    const userId = c.get("userId") as string;
    const rows = await db
      .select()
      .from(meetingTable)
      .where(eq(meetingTable.workspaceId, ws))
      .orderBy(asc(meetingTable.scheduledAt));
    const admin = await isGlobalAdmin(userId, ws);
    const meetingIds = rows.map((m) => m.id);
    const attendeeRows = meetingIds.length
      ? await db
          .select({
            meetingId: meetingAttendeeTable.meetingId,
            userId: meetingAttendeeTable.userId,
          })
          .from(meetingAttendeeTable)
          .where(inArray(meetingAttendeeTable.meetingId, meetingIds))
      : [];
    const attendeesByMeeting = new Map<string, string[]>();
    for (const r of attendeeRows) {
      if (!r.userId) continue;
      const list = attendeesByMeeting.get(r.meetingId) ?? [];
      list.push(r.userId);
      attendeesByMeeting.set(r.meetingId, list);
    }
    const visible = rows.filter((m) =>
      canReadMeeting({
        confidential: m.confidential,
        attendeeUserIds: attendeesByMeeting.get(m.id) ?? [],
        userId,
        isGlobalAdmin: admin,
      }),
    );
    return c.json(visible);
  },
);

// ── Detail ───────────────────────────────────────────────────────────────
app.get(
  "/:id",
  describeRoute({
    operationId: "getMeeting",
    tags: ["Meeting"],
    description: "Meeting detail with attendees and minute items",
  }),
  validator("param", v.object({ id: v.string() })),
  validator("query", v.object({ workspaceId: v.string() })),
  workspaceAccess.fromQuery("workspaceId"),
  pageAccess,
  async (c) => {
    const ws = c.get("workspaceId") as string;
    const userId = c.get("userId") as string;
    const { id } = c.req.valid("param");
    const meeting = await loadMeeting(ws, id);
    if (!meeting) throw new HTTPException(404, { message: "Not found" });
    await assertCanReadMeeting(userId, ws, meeting);
    const [attendees, minuteItems, actions] = await Promise.all([
      db
        .select()
        .from(meetingAttendeeTable)
        .where(eq(meetingAttendeeTable.meetingId, id))
        .orderBy(asc(meetingAttendeeTable.createdAt)),
      db
        .select()
        .from(meetingMinuteItemTable)
        .where(eq(meetingMinuteItemTable.meetingId, id))
        .orderBy(asc(meetingMinuteItemTable.position)),
      db
        .select()
        .from(meetingActionTable)
        .where(eq(meetingActionTable.meetingId, id))
        .orderBy(asc(meetingActionTable.createdAt)),
    ]);
    // `adoptedByMeetingId` carries no FK: the meeting it points at may since
    // have been deleted. Tolerate that lookup coming back empty.
    let adoptedByMeeting: { id: string; title: string } | null = null;
    if (meeting.adoptedByMeetingId) {
      const [row] = await db
        .select({ id: meetingTable.id, title: meetingTable.title })
        .from(meetingTable)
        .where(
          and(
            eq(meetingTable.id, meeting.adoptedByMeetingId),
            eq(meetingTable.workspaceId, ws),
          ),
        )
        .limit(1);
      adoptedByMeeting = row ?? null;
    }
    return c.json({
      ...meeting,
      attendees,
      minuteItems,
      actions,
      adoptedByMeeting,
    });
  },
);

// ── Create ───────────────────────────────────────────────────────────────
app.post(
  "/",
  describeRoute({
    operationId: "createMeeting",
    tags: ["Meeting"],
    description: "Create a meeting (standalone, i.e. no bodyId, is allowed)",
  }),
  validator(
    "json",
    v.object({
      workspaceId: v.string(),
      title: v.string(),
      meetingTypeId: optStr,
      bodyId: optStr,
      scheduledAt: optDate,
      location: optStr,
      confidential: optBool,
    }),
  ),
  workspaceAccess.fromBody("workspaceId"),
  pageAccess,
  async (c) => {
    const ws = c.get("workspaceId") as string;
    const userId = c.get("userId") as string;
    const b = c.req.valid("json");
    const title = b.title.trim();
    if (!title) throw new HTTPException(400, { message: "Title required" });
    if (!(await idInWorkspace(meetingTypeTable, b.meetingTypeId, ws)))
      throw new HTTPException(400, { message: "Invalid meetingTypeId" });
    if (!(await idInWorkspace(meetingBodyTable, b.bodyId, ws)))
      throw new HTTPException(400, { message: "Invalid bodyId" });
    const [row] = await db
      .insert(meetingTable)
      .values({
        workspaceId: ws,
        title,
        meetingTypeId: b.meetingTypeId ?? null,
        bodyId: b.bodyId ?? null,
        scheduledAt: toDate(b.scheduledAt),
        location: b.location ?? null,
        confidential: b.confidential ?? false,
        status: "draft",
        createdBy: userId,
      })
      .returning();
    return c.json(row, 201);
  },
);

// ── Update ───────────────────────────────────────────────────────────────
app.put(
  "/:id",
  describeRoute({
    operationId: "updateMeeting",
    tags: ["Meeting"],
    description: "Update a meeting's own fields (not adoptable minutes)",
  }),
  validator("param", v.object({ id: v.string() })),
  validator(
    "json",
    v.object({
      workspaceId: v.string(),
      title: optStr,
      meetingTypeId: optStr,
      bodyId: optStr,
      scheduledAt: optDate,
      location: optStr,
      confidential: optBool,
    }),
  ),
  workspaceAccess.fromBody("workspaceId"),
  pageAccess,
  async (c) => {
    const ws = c.get("workspaceId") as string;
    const userId = c.get("userId") as string;
    const { id } = c.req.valid("param");
    const b = c.req.valid("json");
    const meeting = await loadMeeting(ws, id);
    if (!meeting) throw new HTTPException(404, { message: "Not found" });
    assertMeetingEditable(meeting);
    await assertMeetingWriteAccess(userId, ws, meeting);
    if (!(await idInWorkspace(meetingTypeTable, b.meetingTypeId, ws)))
      throw new HTTPException(400, { message: "Invalid meetingTypeId" });
    if (!(await idInWorkspace(meetingBodyTable, b.bodyId, ws)))
      throw new HTTPException(400, { message: "Invalid bodyId" });
    const p = patch<typeof meetingTable.$inferInsert>(b, [
      "title",
      "meetingTypeId",
      "bodyId",
      "location",
      "confidential",
    ]);
    if (b.title !== undefined) p.title = b.title.trim();
    if (b.scheduledAt !== undefined) p.scheduledAt = toDate(b.scheduledAt);
    const [row] = await db
      .update(meetingTable)
      .set({ ...p, updatedAt: new Date() })
      .where(and(eq(meetingTable.id, id), eq(meetingTable.workspaceId, ws)))
      .returning();
    return c.json(row);
  },
);

// ── Attendees ────────────────────────────────────────────────────────────
app.post(
  "/:id/attendees",
  describeRoute({
    operationId: "addMeetingAttendee",
    tags: ["Meeting"],
    description: "Add an attendee — exactly one of userId or name",
  }),
  validator("param", v.object({ id: v.string() })),
  validator(
    "json",
    v.object({
      workspaceId: v.string(),
      userId: optStr,
      name: optStr,
      attendance: v.optional(v.picklist(ATTENDANCE)),
    }),
  ),
  workspaceAccess.fromBody("workspaceId"),
  pageAccess,
  async (c) => {
    const ws = c.get("workspaceId") as string;
    const callerId = c.get("userId") as string;
    const { id } = c.req.valid("param");
    const b = c.req.valid("json");
    const meeting = await loadMeeting(ws, id);
    if (!meeting) throw new HTTPException(404, { message: "Not found" });
    assertMeetingEditable(meeting);
    await assertMeetingWriteAccess(callerId, ws, meeting);
    assertExactlyOneOfUserIdOrName(b.userId, b.name);
    const [row] = await db
      .insert(meetingAttendeeTable)
      .values({
        meetingId: id,
        userId: b.userId?.trim() || null,
        name: b.name?.trim() || null,
        attendance: b.attendance ?? "present",
      })
      .returning();
    return c.json(row, 201);
  },
);

app.delete(
  "/:id/attendees/:attendeeId",
  describeRoute({
    operationId: "removeMeetingAttendee",
    tags: ["Meeting"],
    description: "Remove an attendee",
  }),
  validator("param", v.object({ id: v.string(), attendeeId: v.string() })),
  validator("query", v.object({ workspaceId: v.string() })),
  workspaceAccess.fromQuery("workspaceId"),
  pageAccess,
  async (c) => {
    const ws = c.get("workspaceId") as string;
    const callerId = c.get("userId") as string;
    const { id, attendeeId } = c.req.valid("param");
    const meeting = await loadMeeting(ws, id);
    if (!meeting) throw new HTTPException(404, { message: "Not found" });
    assertMeetingEditable(meeting);
    await assertMeetingWriteAccess(callerId, ws, meeting);
    await db
      .delete(meetingAttendeeTable)
      .where(
        and(
          eq(meetingAttendeeTable.id, attendeeId),
          eq(meetingAttendeeTable.meetingId, id),
        ),
      );
    return c.json({ success: true });
  },
);

// ── Minute items ─────────────────────────────────────────────────────────
app.post(
  "/:id/minute-items",
  describeRoute({
    operationId: "addMeetingMinuteItem",
    tags: ["Meeting"],
    description: "Add an agenda/minute item",
  }),
  validator("param", v.object({ id: v.string() })),
  validator(
    "json",
    v.object({
      workspaceId: v.string(),
      agenda: v.string(),
      discussion: optStr,
      decision: optStr,
      position: optNum,
    }),
  ),
  workspaceAccess.fromBody("workspaceId"),
  pageAccess,
  async (c) => {
    const ws = c.get("workspaceId") as string;
    const callerId = c.get("userId") as string;
    const { id } = c.req.valid("param");
    const b = c.req.valid("json");
    const meeting = await loadMeeting(ws, id);
    if (!meeting) throw new HTTPException(404, { message: "Not found" });
    assertMeetingEditable(meeting);
    await assertMeetingWriteAccess(callerId, ws, meeting);
    const agenda = b.agenda.trim();
    if (!agenda) throw new HTTPException(400, { message: "Agenda required" });
    const [row] = await db
      .insert(meetingMinuteItemTable)
      .values({
        meetingId: id,
        agenda,
        discussion: b.discussion ?? null,
        decision: b.decision ?? null,
        position: b.position ?? 0,
      })
      .returning();
    return c.json(row, 201);
  },
);

app.put(
  "/:id/minute-items/:itemId",
  describeRoute({
    operationId: "updateMeetingMinuteItem",
    tags: ["Meeting"],
    description: "Edit an agenda/minute item (refused once adopted)",
  }),
  validator("param", v.object({ id: v.string(), itemId: v.string() })),
  validator(
    "json",
    v.object({
      workspaceId: v.string(),
      agenda: optStr,
      discussion: optStr,
      decision: optStr,
      position: optNum,
    }),
  ),
  workspaceAccess.fromBody("workspaceId"),
  pageAccess,
  async (c) => {
    const ws = c.get("workspaceId") as string;
    const callerId = c.get("userId") as string;
    const { id, itemId } = c.req.valid("param");
    const b = c.req.valid("json");
    const meeting = await loadMeeting(ws, id);
    if (!meeting) throw new HTTPException(404, { message: "Not found" });
    assertMeetingEditable(meeting);
    await assertMeetingWriteAccess(callerId, ws, meeting);
    const [existing] = await db
      .select({ id: meetingMinuteItemTable.id })
      .from(meetingMinuteItemTable)
      .where(
        and(
          eq(meetingMinuteItemTable.id, itemId),
          eq(meetingMinuteItemTable.meetingId, id),
        ),
      )
      .limit(1);
    if (!existing) throw new HTTPException(404, { message: "Not found" });
    const p = patch<typeof meetingMinuteItemTable.$inferInsert>(b, [
      "discussion",
      "decision",
      "position",
    ]);
    if (b.agenda !== undefined) p.agenda = b.agenda.trim();
    const [row] = await db
      .update(meetingMinuteItemTable)
      .set(p)
      .where(eq(meetingMinuteItemTable.id, itemId))
      .returning();
    return c.json(row);
  },
);

// ── Adopt ────────────────────────────────────────────────────────────────
app.post(
  "/:id/adopt",
  describeRoute({
    operationId: "adoptMeeting",
    tags: ["Meeting"],
    description:
      "Adopt this meeting's minutes at a later meeting; refuses a second adoption",
  }),
  validator("param", v.object({ id: v.string() })),
  validator(
    "json",
    v.object({ workspaceId: v.string(), adoptedByMeetingId: v.string() }),
  ),
  workspaceAccess.fromBody("workspaceId"),
  pageAccess,
  async (c) => {
    const ws = c.get("workspaceId") as string;
    const userId = c.get("userId") as string;
    const { id } = c.req.valid("param");
    const { adoptedByMeetingId } = c.req.valid("json");
    const meeting = await loadMeeting(ws, id);
    if (!meeting) throw new HTTPException(404, { message: "Not found" });
    if (!(await idInWorkspace(meetingTable, adoptedByMeetingId, ws)))
      throw new HTTPException(400, { message: "Invalid adoptedByMeetingId" });
    const admin = await isGlobalAdmin(userId, ws);
    const bodyRole = await bodyRoleFor(meeting.bodyId, userId);
    if (!canAdoptMeeting({ isGlobalAdmin: admin, bodyRole }))
      throw new HTTPException(403, {
        message: "Only the chair, secretary, or a global admin may adopt",
      });
    const now = new Date();
    // Guard the UPDATE on the current status so a concurrent second adopt
    // (or a retry after a lost race) claims no rows rather than silently
    // overwriting the first adoption.
    const [row] = await db
      .update(meetingTable)
      .set({
        status: "adopted",
        adoptedAt: now,
        adoptedByMeetingId,
        updatedAt: now,
      })
      .where(
        and(
          eq(meetingTable.id, id),
          eq(meetingTable.workspaceId, ws),
          eq(meetingTable.status, "draft"),
        ),
      )
      .returning();
    if (!row)
      throw new HTTPException(409, {
        message: "This meeting was already adopted",
      });
    return c.json(row);
  },
);

// ── Actions ──────────────────────────────────────────────────────────────
// Accept/reject of an existing action runs through the generic
// pending-decision endpoint (see
// ../pending-decision/providers/meeting-action.ts), not a route here.
app.post(
  "/:id/actions",
  describeRoute({
    operationId: "createMeetingAction",
    tags: ["Meeting"],
    description:
      "Record a follow-up action from this meeting, optionally delegated to one attendee",
  }),
  validator("param", v.object({ id: v.string() })),
  validator(
    "json",
    v.object({
      workspaceId: v.string(),
      description: v.string(),
      minuteItemId: optStr,
      assigneeId: optStr,
      dueAt: optDate,
    }),
  ),
  workspaceAccess.fromBody("workspaceId"),
  pageAccess,
  async (c) => {
    const ws = c.get("workspaceId") as string;
    const callerId = c.get("userId") as string;
    const { id } = c.req.valid("param");
    const b = c.req.valid("json");
    const meeting = await loadMeeting(ws, id);
    if (!meeting) throw new HTTPException(404, { message: "Not found" });
    assertMeetingEditable(meeting);
    await assertMeetingWriteAccess(callerId, ws, meeting);
    const description = b.description.trim();
    if (!description)
      throw new HTTPException(400, { message: "Description required" });
    const assigneeId = b.assigneeId?.trim() || null;
    if (assigneeId) {
      if (!(await isWorkspaceMember(assigneeId, ws)))
        throw new HTTPException(400, { message: "Invalid assignee" });
      // Assigning an action on a confidential meeting to someone who cannot
      // read that meeting is not a valid assignment — refuse it here, before
      // any write, rather than gating only the notification. Composed
      // against the assignee (the target of the assignment), not the
      // caller.
      const attendeeUserIds = await loadAttendeeUserIds(id);
      const assigneeIsGlobalAdmin = await isGlobalAdmin(assigneeId, ws);
      if (
        !canReadMeeting({
          confidential: meeting.confidential,
          attendeeUserIds,
          userId: assigneeId,
          isGlobalAdmin: assigneeIsGlobalAdmin,
        })
      )
        throw new HTTPException(403, {
          message:
            "Cannot assign an action on a confidential meeting to someone who cannot read it",
        });
    }
    if (b.minuteItemId) {
      const [item] = await db
        .select({ id: meetingMinuteItemTable.id })
        .from(meetingMinuteItemTable)
        .where(
          and(
            eq(meetingMinuteItemTable.id, b.minuteItemId),
            eq(meetingMinuteItemTable.meetingId, id),
          ),
        )
        .limit(1);
      if (!item)
        throw new HTTPException(400, { message: "Invalid minuteItemId" });
    }
    const [row] = await db
      .insert(meetingActionTable)
      .values({
        meetingId: id,
        minuteItemId: b.minuteItemId ?? null,
        assigneeId,
        fromUserId: callerId,
        description,
        dueAt: toDate(b.dueAt),
        // Self-delegation is auto-accepted — asking someone to accept work
        // they just gave themselves is ceremony with no reader.
        acceptance:
          assigneeId && assigneeId !== callerId ? "pending" : "accepted",
      })
      .returning();
    if (assigneeId && assigneeId !== callerId)
      await createNotification({
        userId: assigneeId,
        type: "meeting_action_assigned",
        title: `Action required — ${meeting.title}`,
        content: description,
        resourceId: id,
        resourceType: "meeting",
      }).catch(() => {});
    return c.json(row, 201);
  },
);

// ── Complete a delegated action (its assignee, or a GM officer) ───────────
// Deliberately not gated by `pageAccess`: the assignee of a follow-up action
// is often a plain workspace member who was never granted the General
// Management page, and requiring that grant just to close out their own
// accepted work would lock them out of it.
app.post(
  "/:id/actions/:actionId/complete",
  describeRoute({
    operationId: "completeMeetingAction",
    tags: ["Meeting"],
    description:
      "Mark a delegated action done; refuses one that hasn't been accepted",
  }),
  validator("param", v.object({ id: v.string(), actionId: v.string() })),
  validator("json", v.object({ workspaceId: v.string() })),
  workspaceAccess.fromBody("workspaceId"),
  async (c) => {
    const ws = c.get("workspaceId") as string;
    const callerId = c.get("userId") as string;
    const { id, actionId } = c.req.valid("param");
    const meeting = await loadMeeting(ws, id);
    if (!meeting) throw new HTTPException(404, { message: "Not found" });
    const [action] = await db
      .select()
      .from(meetingActionTable)
      .where(
        and(
          eq(meetingActionTable.id, actionId),
          eq(meetingActionTable.meetingId, id),
        ),
      )
      .limit(1);
    if (!action) throw new HTTPException(404, { message: "Not found" });
    const hasPage = await hasWorkspacePageAccess(callerId, ws, PAGE_SLUG);
    if (action.assigneeId !== callerId) {
      if (!hasPage)
        throw new HTTPException(403, {
          message: "Only the action's assignee can complete it",
        });
      // A GM page holder is not automatically an attendee: a confidential
      // meeting's action stays closed to them unless they can also read the
      // meeting itself. The assignee's own branch above is deliberately not
      // gated this way — see the route-level comment.
      await assertCanReadMeeting(callerId, ws, meeting);
    }
    // Accepting is not doing: an action that was never agreed to isn't yet
    // anyone's work, so it cannot be marked done.
    if (action.acceptance !== "accepted")
      throw new HTTPException(409, {
        message: "This action must be accepted before it can be completed",
      });
    const now = new Date();
    // Guard the UPDATE on the current status so a concurrent second
    // completion claims no rows rather than silently overwriting.
    const [row] = await db
      .update(meetingActionTable)
      .set({ status: "done", completedAt: now, completedBy: callerId })
      .where(
        and(
          eq(meetingActionTable.id, actionId),
          eq(meetingActionTable.status, "open"),
        ),
      )
      .returning();
    if (!row)
      throw new HTTPException(409, { message: "Action already completed" });
    return c.json(row);
  },
);

export default app;
