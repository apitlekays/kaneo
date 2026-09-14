import { and, asc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import db from "../database";
import {
  meetingActionTable,
  meetingActionUpdateTable,
} from "../database/schema";
import { hasWorkspacePageAccess } from "../utils/page-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { assertCanReadMeeting, loadMeeting } from "./access";
import { canPostActionUpdate } from "./update-access";

// Context variables populated by the auth + workspace-access middleware.
type MeetingEnv = { Variables: { userId: string; workspaceId?: string } };

const PAGE_SLUG = "general-management";
const ACTION_STATUSES = ["open", "done", "cancelled"] as const;

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
      return c.json(rows);
    },
  );
}
