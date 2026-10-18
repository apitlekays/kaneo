import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  meetingBodyTable,
  meetingDocumentTable,
  meetingTable,
  meetingTypeTable,
} from "../database/schema";
import { isGlobalAdmin } from "../utils/project-access";
import { ARCHIVED_STATUS, isArchivist } from "./archivists";
import {
  clampLimit,
  decodeCursor,
  documentMatchCondition,
  encodeCursor,
  escapeLikePattern,
  keysetCondition,
  visibilityCondition,
} from "./list-query";
import { buildSnippets } from "./snippet";

/**
 * An archival document whose extracted text matched the list's `q` term,
 * with the excerpts that explain the match.
 *
 * A snippet is CONTENT. One of these is only ever built for a meeting that
 * has already passed `visibilityCondition` inside the list query.
 */
export type MatchedDocument = {
  id: string;
  filename: string;
  kind: string;
  /** The first excerpt; kept for callers built before `snippets`. */
  snippet: string;
  /** Up to three excerpts, one per separate occurrence of the term. */
  snippets: string[];
};

/**
 * Which list: the live Meeting Minutes library (drafts and adopted
 * meetings) or Past Minutes (archived meetings). The two never overlap.
 */
export type MeetingListScope = "live" | "archive";

export type MeetingListFilters = {
  bodyId?: string;
  meetingTypeId?: string;
  /** Inclusive lower bound on the meeting date, `YYYY-MM-DD`. */
  from?: string;
  /** Inclusive upper bound on the meeting date, `YYYY-MM-DD`. */
  to?: string;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A filter date must be a real calendar day, or the request is a 400. */
function parseDay(value: string, field: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !DAY.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new HTTPException(400, { message: `Invalid ${field}` });
  return value;
}

/**
 * One page of meetings: keyset-paginated, searchable, and
 * confidentiality-filtered IN THE QUERY.
 *
 * A previous implementation fetched every meeting and filtered in
 * JavaScript. That cannot be paginated: dropping rows after the fact yields
 * a short page that is not the last page, and a cursor taken from the last
 * surviving row skips the hidden ones. `canReadMeeting` (access.ts) stays
 * the single source of truth for the RULE; `visibilityCondition` is its SQL
 * twin.
 */
export async function queryMeetingPage(args: {
  workspaceId: string;
  userId: string;
  scope: MeetingListScope;
  limit?: string;
  cursor?: string;
  q?: string;
  filters?: MeetingListFilters;
}) {
  const ws = args.workspaceId;
  const { userId, filters = {} } = args;
  const limit = clampLimit(args.limit);
  const admin = await isGlobalAdmin(userId, ws);
  // Archivists see confidential past minutes; they never widen the live
  // list, so the lookup is skipped there.
  const archivist =
    args.scope === "archive" && !admin ? await isArchivist(userId, ws) : false;

  const conditions: SQL[] = [
    eq(meetingTable.workspaceId, ws),
    args.scope === "archive"
      ? eq(meetingTable.status, ARCHIVED_STATUS)
      : ne(meetingTable.status, ARCHIVED_STATUS),
  ];

  const visibility = visibilityCondition(userId, admin, archivist);
  if (visibility) conditions.push(visibility);

  if (filters.bodyId) conditions.push(eq(meetingTable.bodyId, filters.bodyId));
  if (filters.meetingTypeId)
    conditions.push(eq(meetingTable.meetingTypeId, filters.meetingTypeId));
  if (filters.from)
    conditions.push(
      gte(
        meetingTable.scheduledAt,
        sql`${parseDay(filters.from, "from")}::date`,
      ),
    );
  if (filters.to)
    // Strictly before the next day, so the whole of `to` is included.
    conditions.push(
      lt(
        meetingTable.scheduledAt,
        sql`${parseDay(filters.to, "to")}::date + 1`,
      ),
    );

  if (args.cursor) {
    const cursor = decodeCursor(args.cursor);
    // A silent reset would re-serve page one forever and read as an
    // infinite-scroll loop; say so instead.
    if (!cursor) throw new HTTPException(400, { message: "Invalid cursor" });
    conditions.push(keysetCondition(cursor));
  }

  const term = args.q?.trim();
  // The snippet query further down must match on exactly the same pattern
  // the WHERE clause matched on.
  const pattern = term ? `%${escapeLikePattern(term)}%` : "";
  if (term) {
    conditions.push(
      or(
        ilike(meetingTable.title, pattern),
        ilike(meetingTable.location, pattern),
        ilike(meetingTable.referenceNo, pattern),
        ilike(meetingTable.chairperson, pattern),
        ilike(meetingTable.summary, pattern),
        ilike(meetingTypeTable.label, pattern),
        ilike(meetingBodyTable.name, pattern),
        // The text INSIDE the meeting's archival documents. An EXISTS
        // subquery correlated on the meeting, so it sits inside this
        // `or(...)` and is therefore ANDed with `visibilityCondition` above:
        // the document match is constrained by confidentiality in this same
        // query, never afterwards.
        documentMatchCondition(term),
      ) as SQL,
    );
  }

  // One extra row: its existence distinguishes "there is another page" from
  // "this is the last one" without a second COUNT.
  const rows = await db
    .select({
      id: meetingTable.id,
      workspaceId: meetingTable.workspaceId,
      title: meetingTable.title,
      meetingTypeId: meetingTable.meetingTypeId,
      bodyId: meetingTable.bodyId,
      scheduledAt: meetingTable.scheduledAt,
      location: meetingTable.location,
      confidential: meetingTable.confidential,
      status: meetingTable.status,
      adoptedAt: meetingTable.adoptedAt,
      adoptedByMeetingId: meetingTable.adoptedByMeetingId,
      referenceNo: meetingTable.referenceNo,
      chairperson: meetingTable.chairperson,
      summary: meetingTable.summary,
      createdBy: meetingTable.createdBy,
      createdAt: meetingTable.createdAt,
      updatedAt: meetingTable.updatedAt,
      meetingTypeLabel: meetingTypeTable.label,
      bodyName: meetingBodyTable.name,
      // Archival documents only: reply attachments belong to action threads.
      documentCount: sql<number>`(
        select count(*)::int from ${meetingDocumentTable}
        where ${meetingDocumentTable.meetingId} = ${meetingTable.id}
          and ${meetingDocumentTable.actionUpdateId} is null
      )`,
      // Cursor material ONLY, stripped from the response below. Read as
      // Postgres timestamp text so the cursor carries the column's full
      // microsecond precision (a JS `Date` holds milliseconds and silently
      // loses rows; see the invariants above `keysetCondition`). `to_char`
      // rather than `::text`, which renders per the server's `DateStyle`.
      createdAtText: sql<string>`to_char(${meetingTable.createdAt}, 'YYYY-MM-DD HH24:MI:SS.US')`,
      scheduledAtText: sql<
        string | null
      >`to_char(${meetingTable.scheduledAt}, 'YYYY-MM-DD HH24:MI:SS.US')`,
    })
    .from(meetingTable)
    .leftJoin(
      meetingTypeTable,
      eq(meetingTable.meetingTypeId, meetingTypeTable.id),
    )
    .leftJoin(meetingBodyTable, eq(meetingTable.bodyId, meetingBodyTable.id))
    .where(and(...conditions))
    .orderBy(
      sql`${meetingTable.scheduledAt} DESC NULLS LAST`,
      desc(meetingTable.createdAt),
      desc(meetingTable.id),
    )
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          scheduledAt: last.scheduledAtText,
          createdAt: last.createdAtText,
          id: last.id,
        })
      : null;

  // Snippets for the page's meetings ONLY, and only once `page` has been
  // sliced to `limit`. Every id here has already passed
  // `visibilityCondition`, so reading its documents' text discloses nothing
  // new, but the ORDER of these two steps is load-bearing: hoisting this
  // above the slice would fetch text for a row about to be discarded.
  let matched = new Map<string, MatchedDocument[]>();
  if (term && page.length > 0) {
    const documentRows = await db
      .select({
        id: meetingDocumentTable.id,
        meetingId: meetingDocumentTable.meetingId,
        filename: meetingDocumentTable.filename,
        kind: meetingDocumentTable.kind,
        extractedText: meetingDocumentTable.extractedText,
      })
      .from(meetingDocumentTable)
      .where(
        and(
          inArray(
            meetingDocumentTable.meetingId,
            page.map((r) => r.id),
          ),
          // Same three predicates as `documentMatchCondition`, so a
          // document that made the meeting a hit is the one that gets a
          // snippet.
          isNull(meetingDocumentTable.actionUpdateId),
          eq(meetingDocumentTable.indexStatus, "indexed"),
          ilike(meetingDocumentTable.extractedText, pattern),
        ),
      );
    matched = documentRows.reduce((acc, r) => {
      const snippets = buildSnippets(r.extractedText ?? "", term);
      // Empty means the term is not actually in the text. It should not
      // happen given the ilike above, but omit the document rather than
      // show an unexplained match.
      const [snippet] = snippets;
      if (!snippet) return acc;
      const list = acc.get(r.meetingId) ?? [];
      list.push({
        id: r.id,
        filename: r.filename,
        kind: r.kind,
        snippet,
        snippets,
      });
      acc.set(r.meetingId, list);
      return acc;
    }, new Map<string, MatchedDocument[]>());
  }

  const items = page.map(
    ({
      createdAtText: _createdAtText,
      scheduledAtText: _scheduledAtText,
      ...item
    }) => ({
      ...item,
      // Always present, even without a `q`: the web types are built
      // against a fixed shape.
      matchedDocuments: matched.get(item.id) ?? [],
    }),
  );

  // A document still `pending` extraction is INVISIBLE to search, so a
  // result set can be legitimately incomplete and the list has to be able
  // to say so. Visibility-filtered and scoped like the list itself: a bare
  // workspace count would tell a non-attendee that SOME confidential meeting
  // holds unindexed documents. Archival rows only, since a reply attachment
  // sits at `pending` forever by design.
  const [pendingRow] = await db
    .select({ n: count() })
    .from(meetingDocumentTable)
    .innerJoin(
      meetingTable,
      eq(meetingTable.id, meetingDocumentTable.meetingId),
    )
    .where(
      and(
        eq(meetingDocumentTable.workspaceId, ws),
        isNull(meetingDocumentTable.actionUpdateId),
        eq(meetingDocumentTable.indexStatus, "pending"),
        args.scope === "archive"
          ? eq(meetingTable.status, ARCHIVED_STATUS)
          : ne(meetingTable.status, ARCHIVED_STATUS),
        ...(visibility ? [visibility] : []),
      ),
    );

  return {
    items,
    nextCursor,
    pendingIndexCount: pendingRow?.n ?? 0,
  };
}
