/**
 * The "Configure -> send memorandum" routes: `GET`/`POST
 * /:id/actions/:actionId/memo`. Mounted from `index.ts` — see the comment
 * at the mount site there for why registration order matters — following
 * the same `registerActionUpdateRoutes` split convention as
 * `action-updates.ts`.
 *
 * CONFIDENTIALITY. A confidential meeting's title has escaped this module
 * three times in production, most recently through a notification subject
 * line, and `buildMemorandumHtml` puts the meeting's name in the outbound
 * subject BY DESIGN — making this the highest-risk path in the module.
 * Both routes below load the meeting and call `assertCanReadMeeting`
 * BEFORE touching the action, resolving values, or building anything —
 * never after, and never skipped because the caller "obviously" holds the
 * General Management page. Holding that page is necessary but not
 * sufficient: `pageAccess` and `assertCanReadMeeting` are two independent
 * gates, and a page holder who is not an attendee of a confidential
 * meeting must fail the second one.
 *
 * The route accepts Markdown and field values ONLY, never finished HTML —
 * see `buildMemorandumHtml`'s own docstring in `./memorandum.ts` for why
 * accepting HTML here would let a caller smuggle arbitrary markup into an
 * outbound MAPIM email.
 */
import { sendCorrespondenceEmail } from "@kaneo/email";
import { and, desc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import db from "../database";
import {
  meetingActionMemoTable,
  meetingActionTable,
  meetingMinuteItemTable,
} from "../database/schema";
import { requireWorkspacePageAccess } from "../utils/page-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { assertCanReadMeeting, loadMeeting } from "./access";
import { buildMemorandumHtml, type ShortcodeValues } from "./memorandum";

// Context variables populated by the auth + workspace-access middleware.
type MeetingEnv = { Variables: { userId: string; workspaceId?: string } };

const PAGE_SLUG = "general-management";
const pageAccess = requireWorkspacePageAccess(PAGE_SLUG);

const DEFAULT_REPLY_TO = "governance@mapim.org";

/**
 * Verbatim from
 * `docs/superpowers/specs/2026-08-27-minutes-manager-refinements-REQUIREMENTS.md`,
 * section "Exact email content required" -> "Email body" — the dictated
 * Malay greeting. DO NOT retype, "fix", or reflow this by hand: it is
 * long verbatim Malay prose, and any hand copy risks a typo that then
 * drifts from the source of truth. `tests/api-integration/meeting-memorandum.test.ts`
 * reads that file directly and asserts byte-for-byte equality (modulo the
 * placeholder -> shortcode substitution below), so a mismatch here fails
 * loudly rather than shipping a silently-wrong copy.
 *
 * The three bracketed placeholders in the source doc
 * (`[name of receipient]`, `[name of meeting]`, `[date]`) are expressed as
 * the shortcode vocabulary `./memorandum.ts` already defines, so the popup
 * shows `{{recipient_name}}` etc and the user can move them around before
 * sending.
 */
const DEFAULT_TEMPLATE =
  "Dengan hormatnya, sekretariat pengurusan mesyuarat Wisma MAPIM Malaysia menjemput {{recipient_name}} untuk memberikan maklumbalas berkaitan cabutan minit {{meeting_name}} yang diadakan pada {{meeting_date}} yang lalu.";

const optStr = v.optional(v.string());
const email = v.pipe(v.string(), v.trim(), v.email());

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

/** `YYYY-MM-DD`, or empty when the meeting has no scheduled date. */
function formatMeetingDate(scheduledAt: Date | null): string {
  if (!scheduledAt) return "";
  return scheduledAt.toISOString().slice(0, 10);
}

/**
 * The shortcode values that come from the meeting and the action alone —
 * shared by the GET (which leaves `recipient_name`/`notes` empty for the
 * user to fill) and the POST (which fills them from the request body).
 *
 * `numbering`/`topic`/`status` describe the action itself (see
 * `MEMO_SHORTCODES` in `./memorandum.ts`), but `meeting_action` has no
 * columns of its own for numbering or topic — only a free-text
 * `description` and its own open/done/cancelled `status`. When the action
 * was raised from a minute item, that item's numbering/topic/status (the
 * richer governance-status free text, e.g. "Selesai") is the more
 * meaningful answer and is used instead; otherwise the action's own
 * description/status stand in.
 */
async function resolveBaseValues(
  meeting: { title: string; scheduledAt: Date | null },
  action: { minuteItemId: string | null; description: string; status: string },
): Promise<
  Pick<
    ShortcodeValues,
    "meeting_name" | "meeting_date" | "numbering" | "topic" | "status"
  >
> {
  let numbering = "";
  let topic = action.description;
  let status = action.status;

  if (action.minuteItemId) {
    const [item] = await db
      .select({
        numbering: meetingMinuteItemTable.numbering,
        topic: meetingMinuteItemTable.topic,
        status: meetingMinuteItemTable.status,
      })
      .from(meetingMinuteItemTable)
      .where(eq(meetingMinuteItemTable.id, action.minuteItemId))
      .limit(1);
    if (item) {
      numbering = item.numbering ?? "";
      topic = item.topic;
      status = item.status ?? action.status;
    }
  }

  return {
    meeting_name: meeting.title,
    meeting_date: formatMeetingDate(meeting.scheduledAt),
    numbering,
    topic,
    status,
  };
}

async function loadLastSend(actionId: string) {
  const [row] = await db
    .select()
    .from(meetingActionMemoTable)
    .where(eq(meetingActionMemoTable.actionId, actionId))
    .orderBy(desc(meetingActionMemoTable.sentAt))
    .limit(1);
  return row ?? null;
}

export function registerMemoRoutes(app: Hono<MeetingEnv>): void {
  app.get(
    "/:id/actions/:actionId/memo",
    describeRoute({
      operationId: "getMeetingActionMemoContext",
      tags: ["Meeting"],
      description:
        "The default memorandum template, resolved shortcode values, and the last send (if any) for one action — everything the Configure popup needs from a single source of truth",
    }),
    validator("param", v.object({ id: v.string(), actionId: v.string() })),
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    pageAccess,
    async (c) => {
      const ws = c.get("workspaceId") as string;
      const userId = c.get("userId") as string;
      const { id, actionId } = c.req.valid("param");

      const meeting = await loadMeeting(ws, id);
      if (!meeting) throw new HTTPException(404, { message: "Not found" });
      // Confidentiality FIRST — before the action is even loaded. See the
      // module docstring above.
      await assertCanReadMeeting(userId, ws, meeting);

      const action = await loadAction(id, actionId);
      if (!action) throw new HTTPException(404, { message: "Not found" });

      const base = await resolveBaseValues(meeting, action);
      const values: ShortcodeValues = {
        ...base,
        recipient_name: "",
        notes: "",
      };

      const lastSend = await loadLastSend(actionId);

      return c.json({
        defaultTemplate: DEFAULT_TEMPLATE,
        values,
        lastSend: lastSend
          ? {
              id: lastSend.id,
              recipientName: lastSend.recipientName,
              recipientEmail: lastSend.recipientEmail,
              cc: lastSend.cc,
              replyTo: lastSend.replyTo,
              subject: lastSend.subject,
              bodyHtml: lastSend.bodyHtml,
              sentAt: lastSend.sentAt,
            }
          : null,
      });
    },
  );

  app.post(
    "/:id/actions/:actionId/memo",
    describeRoute({
      operationId: "sendMeetingActionMemo",
      tags: ["Meeting"],
      description:
        "Render and send the memorandum email for an action, recording an auditable send record",
    }),
    validator("param", v.object({ id: v.string(), actionId: v.string() })),
    validator(
      "json",
      v.object({
        workspaceId: v.string(),
        recipientName: v.string(),
        recipientEmail: email,
        notes: optStr,
        replyTo: v.optional(email),
        cc: v.optional(v.array(email)),
        // Markdown ONLY — never HTML. See the module docstring above and
        // `buildMemorandumHtml`'s own docstring in ./memorandum.ts.
        bodyMarkdown: v.string(),
      }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    pageAccess,
    async (c) => {
      const ws = c.get("workspaceId") as string;
      const userId = c.get("userId") as string;
      const { id, actionId } = c.req.valid("param");
      const b = c.req.valid("json");

      const meeting = await loadMeeting(ws, id);
      if (!meeting) throw new HTTPException(404, { message: "Not found" });
      // Confidentiality FIRST — before the action is loaded, before any
      // value is resolved, before the memo is rendered. See the module
      // docstring above: this is the check a page holder who is not an
      // attendee of a confidential meeting must fail.
      await assertCanReadMeeting(userId, ws, meeting);

      const action = await loadAction(id, actionId);
      if (!action) throw new HTTPException(404, { message: "Not found" });

      const recipientName = b.recipientName.trim();
      if (!recipientName)
        throw new HTTPException(400, { message: "Recipient name required" });

      const base = await resolveBaseValues(meeting, action);
      const values: ShortcodeValues = {
        ...base,
        recipient_name: recipientName,
        notes: b.notes ?? "",
      };

      const { subject, html } = await buildMemorandumHtml({
        values,
        bodyMarkdown: b.bodyMarkdown,
      });

      const replyTo = b.replyTo ?? DEFAULT_REPLY_TO;
      const cc = b.cc && b.cc.length > 0 ? b.cc : undefined;

      // Send BEFORE writing the record: an SMTP failure (most notably
      // SMTP_NOT_CONFIGURED, thrown by `sendCorrespondenceEmail` itself)
      // must surface as a clear failure and leave no record behind — a
      // record for a memo that was never actually sent would falsely tell
      // the popup a memorandum already went out.
      try {
        await sendCorrespondenceEmail(
          b.recipientEmail,
          subject,
          html,
          undefined,
          {
            replyTo,
            cc,
          },
        );
      } catch (error) {
        throw new HTTPException(502, {
          message: `Send memorandum failed: ${
            error instanceof Error ? error.message : "unknown"
          }`,
        });
      }

      const [row] = await db
        .insert(meetingActionMemoTable)
        .values({
          actionId,
          sentBy: userId,
          recipientName,
          recipientEmail: b.recipientEmail,
          cc: cc ?? null,
          replyTo,
          subject,
          bodyHtml: html,
        })
        .returning();
      if (!row)
        throw new HTTPException(500, {
          message: "Failed to record the memorandum send",
        });

      return c.json(row, 201);
    },
  );
}
