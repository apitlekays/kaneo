import { and, eq, exists, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import db from "../database";
import { meetingAttendeeTable, meetingTable } from "../database/schema";

/**
 * The sort tuple identifying the last row of a page. Opaque to the client:
 * it is base64url JSON precisely so nobody builds one by hand and depends
 * on its shape.
 *
 * The two timestamps are Postgres timestamp TEXT — `2026-01-01 00:00:00` or
 * `2026-01-01 00:00:00.123456` — rendered with `to_char(col, 'YYYY-MM-DD
 * HH24:MI:SS.US')` (not `::text`, which renders per the server's `DateStyle`
 * setting) and bound straight back with `::timestamp`. They are deliberately
 * NOT ISO strings produced from a JS `Date`: a `Date` holds milliseconds, the
 * column holds microseconds, and a cursor coarser than the ORDER BY loses
 * rows (see `keysetCondition`). Nothing on this path may construct a `Date`.
 */
export type MeetingCursor = {
  scheduledAt: string | null;
  createdAt: string;
  id: string;
};

/**
 * `YYYY-MM-DD`, a space or `T`, `HH:MM:SS`, and an optional fractional part
 * of one to six digits — exactly what Postgres renders for a `timestamp`
 * and exactly what it will accept back. A shape check rather than
 * `Date.parse`, which both rejects nothing useful (it accepts "2026" and
 * much else) and would read these local-timezone-less values as LOCAL time
 * in V8.
 *
 * Shape-only, though: it checks digit grouping, not calendar validity, so a
 * hand-crafted cursor carrying e.g. "9999-13-45 99:99:99" still matches. See
 * `isValidCalendarTimestamp` for the check that rejects it.
 */
const PG_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;

/** Field capture for `isValidCalendarTimestamp` — matched only after `PG_TIMESTAMP` already passed. */
const PG_TIMESTAMP_FIELDS =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?$/;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
}

/**
 * Rejects a calendar-impossible value that nonetheless matches
 * `PG_TIMESTAMP`'s shape — an impossible month, day, hour, minute or second
 * (e.g. "9999-13-45 99:99:99"). Without this, such a value passed straight
 * to `keysetCondition`'s `::timestamp` cast, and Postgres raised a
 * date/time-out-of-range error the route has no try/catch for: an
 * unhandled 500 where the route promises 400 for any bad cursor.
 *
 * Deliberately NOT `Date.parse` / `new Date(string)`: V8 parses a
 * space-separated (or fractional-seconds) timestamp as LOCAL time, so
 * whether a borderline value looked valid would depend on the process's
 * timezone — exactly the class of bug this module is trying to eliminate.
 * This checks each field's numeric range directly against the matched
 * digits; no `Date` is constructed at all, so the value bound to SQL stays
 * the original text and this function influences nothing but true/false.
 */
function isValidCalendarTimestamp(value: string): boolean {
  const m = value.match(PG_TIMESTAMP_FIELDS);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  // Postgres's `timestamp` has no year 0 (year 1 BC is out of range too, but
  // the regex's `\d{4}` can never capture a sign): `select '0000-01-01
  // 00:00:00'::timestamp` raises date/time-out-of-range, while year 1
  // succeeds. Same failure mode as an out-of-range month/day/etc below.
  if (year < 1) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23) return false;
  if (minute > 59) return false;
  if (second > 59) return false;
  return true;
}

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
    // A structurally valid but non-timestamp string (e.g. a hand-crafted
    // cursor) must not reach keysetCondition, where it is cast with
    // `::timestamp` — Postgres would raise a syntax error and the route
    // would answer 500 rather than the 400 it promises for a bad cursor.
    // Shape AND calendar validity both matter: a shape-only check still lets
    // an impossible value like "9999-13-45 99:99:99" through to the same
    // `::timestamp` cast, and Postgres rejects that with the same
    // unhandled-500 failure mode.
    if (!PG_TIMESTAMP.test(createdAt)) return null;
    if (!isValidCalendarTimestamp(createdAt)) return null;
    if (scheduledAt !== null) {
      if (!PG_TIMESTAMP.test(scheduledAt)) return null;
      if (!isValidCalendarTimestamp(scheduledAt)) return null;
    }
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
 * TWO invariants govern the comparison values, and both were bugs here
 * once:
 *
 * 1. PRECISION. The cursor must carry each sort key at exactly the
 *    precision the ORDER BY compares at. Both columns are
 *    `timestamp` — MICROSECONDS — and `created_at` defaults to `now()`,
 *    which really does populate them. A JS `Date` holds only milliseconds,
 *    so a cursor built from one truncates the boundary key DOWNWARDS, and
 *    every row in `[T.mmm000, T.mmmXYZ)` then satisfies neither `< T` nor
 *    `= T`. Those rows sorted *after* the boundary, so they were not on an
 *    earlier page either: they become unreachable through pagination
 *    entirely — gone from the grid, still live behind a direct link, with
 *    nothing on screen to say so. Hence the cursor carries Postgres
 *    timestamp TEXT (rendered with `to_char(col, 'YYYY-MM-DD
 *    HH24:MI:SS.US')`, not `::text` — see the route for why) and binds it
 *    back with `::timestamp`.
 *
 * 2. TIMEZONE. No `Date` may reach the binding path. Interpolating one
 *    hands it to the driver, which (for a `timestamp without time zone`
 *    column) serializes it in the *client process's* local timezone rather
 *    than UTC — so the same cursor produces a different, wrong comparison
 *    value depending on what timezone the API happens to be running in,
 *    while the column's own genuinely-UTC `now()` values never move.
 *
 * Binding the text with an explicit `::timestamp` cast satisfies both: the
 * value never round-trips through a `Date`, so it can neither lose
 * microseconds nor acquire an ambient offset. Drizzle's `lt`/`eq` take an
 * SQL right-hand side, so the logical structure below is unchanged.
 */
export function keysetCondition(cursor: MeetingCursor): SQL {
  const createdAt = sql`${cursor.createdAt}::timestamp`;
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

  const scheduledAt = sql`${cursor.scheduledAt}::timestamp`;
  return or(
    isNull(meetingTable.scheduledAt),
    lt(meetingTable.scheduledAt, scheduledAt),
    and(eq(meetingTable.scheduledAt, scheduledAt), beforeCreatedAt),
  ) as SQL;
}
