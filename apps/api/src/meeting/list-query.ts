import { and, eq, exists, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import db from "../database";
import { meetingAttendeeTable, meetingTable } from "../database/schema";

/**
 * The sort tuple identifying the last row of a page. Opaque to the client:
 * it is base64url JSON precisely so nobody builds one by hand and depends
 * on its shape.
 */
export type MeetingCursor = {
  scheduledAt: string | null;
  createdAt: string;
  id: string;
};

export function encodeCursor(c: MeetingCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

/** Returns null for anything that is not a well-formed cursor. */
export function decodeCursor(raw: string): MeetingCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const { scheduledAt, createdAt, id } = parsed as Record<string, unknown>;
    if (typeof createdAt !== "string" || typeof id !== "string") return null;
    if (scheduledAt !== null && typeof scheduledAt !== "string") return null;
    return { scheduledAt, createdAt, id };
  } catch {
    return null;
  }
}

/**
 * ILIKE treats `%` and `_` as wildcards, so a user typing "100%" would
 * otherwise match every meeting. Escape the escape character first, or the
 * backslashes this adds get escaped again.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export const DEFAULT_LIMIT = 24;
export const MAX_LIMIT = 100;

/** A cap is a server concern: a client asking for everything must not get it. */
export function clampLimit(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/**
 * The confidentiality rule, expressed in SQL so it can be applied BEFORE
 * pagination. It must agree with `canReadMeeting` in access.ts, which stays
 * the single source of truth for the rule itself and is what the detail
 * route and the pending-decision provider use. An integration test asserts
 * the two agree across every combination.
 *
 * Returns undefined for a global admin — no restriction at all — rather
 * than a tautology, so the query planner sees a simpler WHERE.
 */
export function visibilityCondition(
  userId: string,
  isAdmin: boolean,
): SQL | undefined {
  if (isAdmin) return undefined;
  return or(
    eq(meetingTable.confidential, false),
    exists(
      db
        .select({ one: sql`1` })
        .from(meetingAttendeeTable)
        .where(
          and(
            eq(meetingAttendeeTable.meetingId, meetingTable.id),
            eq(meetingAttendeeTable.userId, userId),
          ),
        ),
    ),
  );
}

/**
 * "Strictly after this row" under `ORDER BY scheduled_at DESC NULLS LAST,
 * created_at DESC, id DESC`.
 *
 * The nullable sort column is why this is not a one-liner: every row with a
 * date sorts before every row without one, so a cursor sitting in the dated
 * block must still admit the whole undated block, while a cursor already in
 * the undated block must admit only undated rows.
 *
 * Built from Drizzle's typed column operators (`lt`/`eq`/`and`/`or`/
 * `isNull`) rather than a raw `sql` template with interpolated `Date`
 * objects. A raw template hands the `Date` straight to the driver, which
 * (for a `timestamp without time zone` column) serializes it using the
 * *client process's* local timezone rather than UTC — so the same cursor
 * produces a different, wrong comparison value depending on what timezone
 * the API happens to be running in, while the column's own genuinely-UTC
 * `now()`-generated values never move. Going through the typed operators
 * routes the value through the column's `mapToDriverValue`, which formats
 * it explicitly rather than deferring to the driver's ambient-timezone
 * default, so the predicate is correct regardless of the process timezone.
 */
export function keysetCondition(cursor: MeetingCursor): SQL {
  const createdAt = new Date(cursor.createdAt);
  // Tie-break by id whenever createdAt doesn't distinguish the rows —
  // needed both for the undated branch below and nested inside the dated
  // branch's own equality case.
  const beforeCreatedAt = or(
    lt(meetingTable.createdAt, createdAt),
    and(eq(meetingTable.createdAt, createdAt), lt(meetingTable.id, cursor.id)),
  );

  if (cursor.scheduledAt === null) {
    return and(isNull(meetingTable.scheduledAt), beforeCreatedAt) as SQL;
  }

  const scheduledAt = new Date(cursor.scheduledAt);
  return or(
    isNull(meetingTable.scheduledAt),
    lt(meetingTable.scheduledAt, scheduledAt),
    and(eq(meetingTable.scheduledAt, scheduledAt), beforeCreatedAt),
  ) as SQL;
}
