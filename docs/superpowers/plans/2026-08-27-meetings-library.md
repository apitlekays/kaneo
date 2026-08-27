# Meetings Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Meeting Minutes list into a searchable, lazily-loaded grid of document cards, with confidentiality enforced inside the SQL query rather than after it.

**Architecture:** `GET /meeting` is rewritten as a keyset-paginated, searchable query. The confidentiality rule moves into the WHERE clause (post-query filtering and pagination are incompatible — see the spec), and LEFT JOINs onto `meeting_type` and `meeting_body` provide both the search targets and the human-readable labels the cards need. The web list becomes `useInfiniteQuery` over a `{ items, nextCursor }` response.

**Tech Stack:** Hono + Drizzle 0.45 + Valibot (API), React 19 + TanStack Query + Tailwind v4 (web), Vitest everywhere.

**Spec:** `docs/superpowers/specs/2026-08-27-meetings-library-design.md`

**Requirements source:** `docs/superpowers/specs/2026-08-27-minutes-manager-refinements-REQUIREMENTS.md`

## Global Constraints

- **This is the organisation-level Meeting Minutes module** (`meeting_*` tables). Two unrelated features are also called "minutes": `task_mom` (Project Minutes) and `letter_minute` (Letter Minutes). Never rename either; never let a name here collide with them.
- **UI copy always says "Meeting Minutes", never bare "Minutes".**
- **Confidentiality must hold on every path.** A confidential meeting's title has escaped this module three times. Tests assert on the field that carries the leak (`title`), never merely around it.
- **Errors must be distinguishable from empty and loading.** A failed query rendering as "no meetings" hid a 404 in production for days.
- **Every fetcher URL must be exercised by a test.** A trailing-slash 404 shipped because integration tests called routes directly and never exercised the client's URL construction. Hono routes strictly: `/api/meeting` and `/api/meeting/` are different paths.
- **Biome:** spaces, double quotes, semicolons. Run `pnpm lint` before committing.
- **Unit tests:** `pnpm --filter @kaneo/api test`, `pnpm --filter @kaneo/web test`.
- **Integration tests:** `pnpm --filter @kaneo/api test:integration`. Do NOT use the root `pnpm test:integration` if you override `DATABASE_URL` — `turbo.json` declares no `env`/`passThroughEnv` for that task and silently drops the override, falling back to port 5432 and failing with a confusing `ECONNREFUSED`.
- **Commits** use Conventional Commits. The pre-commit hook runs `biome ci .` plus a full monorepo build and is slow; `--no-verify` is acceptable for incremental work but then `biome ci .` must be run manually before the branch is pushed.

## File Structure

**Create:**
- `apps/api/src/meeting/list-query.ts` — cursor codec, search-term escaping, and the SQL visibility/keyset predicates. One file because these four pieces are only ever used together, by one route.
- `tests/api/meeting/list-query.test.ts` — unit tests for the pure parts.
- `tests/api-integration/meeting-list.test.ts` — pagination, search and confidentiality against a real database.
- `apps/web/src/hooks/queries/meeting/use-adopt-candidates.ts` — the detail dialog's meeting picker, split off from the paginated list hook.
- `apps/web/src/components/general-management/meeting-card.tsx` — one document card.
- `apps/web/src/components/general-management/meeting-card.test.tsx`
- `apps/web/src/fetchers/meeting/list.test.ts` — the list fetcher's URL and response contract.

**Modify:**
- `apps/api/src/meeting/index.ts` — the `GET "/"` handler only (currently ~line 240).
- `apps/web/src/fetchers/meeting/index.ts` — `listMeetings` signature and new list types.
- `apps/web/src/hooks/queries/meeting/use-meetings.ts` — becomes `useInfiniteQuery`.
- `apps/web/src/components/general-management/minutes-manager.tsx` — grid, search bar, four states.
- `apps/web/src/components/general-management/minutes-manager.test.tsx` — its `useMeetings` mock returns an array today and must return the infinite shape.
- `apps/web/src/components/general-management/meeting-detail-dialog.tsx` — the adopt picker at line ~133.
- `apps/web/src/components/general-management/meeting-detail-dialog.test.tsx` — same mock problem, line ~43.

## A defect in the spec, ruled on before execution

Spec A lists "any change to the meeting detail dialog" as out of scope. **That is not achievable and the plan overrides it.**

`meeting-detail-dialog.tsx:133` calls `useMeetings(workspaceId)` to populate the adopt picker — the list of other meetings one can record as having adopted these minutes. Paginating `useMeetings` silently truncates that picker to the newest 24 meetings, with no error and no indication anything is missing: exactly the class of invisible failure this module has shipped repeatedly.

So Task 6 gives the picker its own hook and a search box. Leaving it to break was never an option; the spec simply did not know the picker existed.

---

### Task 1: Query primitives — cursor, search escaping, visibility

Four small pieces, one new module, no route changes yet. Pure enough to unit-test without a database (except `visibilityCondition`, which builds a Drizzle fragment and is proven in Task 2's integration tests).

**Files:**
- Create: `apps/api/src/meeting/list-query.ts`
- Test: `tests/api/meeting/list-query.test.ts`

**Interfaces:**
- Consumes: `meetingTable`, `meetingAttendeeTable` from `apps/api/src/database/schema`.
- Produces:
  - `type MeetingCursor = { scheduledAt: string | null; createdAt: string; id: string }`
  - `encodeCursor(c: MeetingCursor): string`
  - `decodeCursor(raw: string): MeetingCursor | null` — `null` means malformed
  - `escapeLikePattern(term: string): string`
  - `DEFAULT_LIMIT = 24`, `MAX_LIMIT = 100`, `clampLimit(raw: string | undefined): number`
  - `visibilityCondition(userId: string, isAdmin: boolean): SQL | undefined`
  - `keysetCondition(cursor: MeetingCursor): SQL`

**Ruling — a malformed cursor is a 400, not a silent reset.** Ignoring a bad cursor and serving page 1 turns an infinite scroll into a loop that re-appends the same 24 cards forever, which reads as a rendering bug and is very hard to trace. An explicit error names the problem. Cost if wrong: a cursor from a previous deploy hard-errors the grid instead of quietly restarting it — recoverable by reloading the page, and the retry affordance from Task 5 is already on screen.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/meeting/list-query.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  escapeLikePattern,
  MAX_LIMIT,
} from "../../../apps/api/src/meeting/list-query";

describe("cursor codec", () => {
  it("round-trips a cursor with a scheduled date", () => {
    const c = {
      scheduledAt: "2026-03-01T12:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "meeting-1",
    };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it("round-trips a cursor whose scheduledAt is null", () => {
    const c = {
      scheduledAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "meeting-2",
    };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it("returns null for garbage rather than throwing", () => {
    expect(decodeCursor("not-base64-at-all!!")).toBeNull();
  });

  it("returns null for valid base64 that is not a cursor", () => {
    expect(decodeCursor(Buffer.from('{"nope":1}').toString("base64url"))).toBeNull();
  });
});

describe("escapeLikePattern", () => {
  it("escapes the wildcards a user can type", () => {
    // Without this, searching "100%" matches every meeting, and "a_b"
    // matches "axb" — the search silently over-matches.
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
  });

  it("escapes the escape character first", () => {
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeLikePattern("Quarterly Committee")).toBe("Quarterly Committee");
  });
});

describe("clampLimit", () => {
  it("defaults when absent", () => {
    expect(clampLimit(undefined)).toBe(24);
  });

  it("caps a client asking for everything", () => {
    expect(clampLimit("100000")).toBe(MAX_LIMIT);
  });

  it("defaults on nonsense rather than returning NaN", () => {
    expect(clampLimit("abc")).toBe(24);
    expect(clampLimit("0")).toBe(24);
    expect(clampLimit("-5")).toBe(24);
  });

  it("honours a sensible value", () => {
    expect(clampLimit("10")).toBe(10);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kaneo/api test -- list-query`
Expected: FAIL — cannot resolve `apps/api/src/meeting/list-query`.

- [ ] **Step 3: Implement**

Create `apps/api/src/meeting/list-query.ts`:

```ts
import { and, eq, exists, or, type SQL, sql } from "drizzle-orm";
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
 */
export function keysetCondition(cursor: MeetingCursor): SQL {
  const createdAt = new Date(cursor.createdAt);
  if (cursor.scheduledAt === null) {
    return sql`(
      ${meetingTable.scheduledAt} IS NULL
      AND (
        ${meetingTable.createdAt} < ${createdAt}
        OR (${meetingTable.createdAt} = ${createdAt} AND ${meetingTable.id} < ${cursor.id})
      )
    )`;
  }
  const scheduledAt = new Date(cursor.scheduledAt);
  return sql`(
    ${meetingTable.scheduledAt} IS NULL
    OR ${meetingTable.scheduledAt} < ${scheduledAt}
    OR (
      ${meetingTable.scheduledAt} = ${scheduledAt}
      AND (
        ${meetingTable.createdAt} < ${createdAt}
        OR (${meetingTable.createdAt} = ${createdAt} AND ${meetingTable.id} < ${cursor.id})
      )
    )
  )`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @kaneo/api test -- list-query`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/meeting/list-query.ts tests/api/meeting/list-query.test.ts
git commit -m "feat(meeting): cursor, search-escaping and visibility primitives for the meetings list"
```

---

### Task 2: Rewrite `GET /meeting` — pagination, search, in-query confidentiality

**Files:**
- Modify: `apps/api/src/meeting/index.ts` (the `app.get("/", …)` handler, currently ~line 240, and the import block at line 1)
- Test: `tests/api-integration/meeting-list.test.ts` (create)

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces: `GET /meeting?workspaceId=&limit=&cursor=&q=` returning
  ```ts
  {
    items: Array<Meeting & { meetingTypeLabel: string | null; bodyName: string | null }>;
    nextCursor: string | null;
  }
  ```

**Note on the two extra fields.** The spec says a card shows the meeting's type. The list cannot show a type without its label, and the component today renders the raw CUID2 `meetingTypeId` as user-facing copy with a comment admitting it is wrong. The search join onto `meeting_type` and `meeting_body` is required by the spec anyway, so the labels come for free — take them.

**This is a breaking response-shape change.** `GET /meeting` returned a bare array. Task 3 updates the only client.

- [ ] **Step 1: Write the failing integration tests**

Create `tests/api-integration/meeting-list.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceMember,
  grantGeneralManagement,
  type SeededMemberContext,
} from "./helpers/fixtures";

type App = ReturnType<typeof createApp>["app"];

type ListResponse = {
  items: Array<{
    id: string;
    title: string;
    meetingTypeLabel: string | null;
    bodyName: string | null;
  }>;
  nextCursor: string | null;
};

/**
 * A workspace owner. `createWorkspaceMember` seeds its OWN user and
 * workspace and returns both — it does not accept ids. An owner is a global
 * admin (`GLOBAL_ADMIN_ROLES` in utils/project-access.ts), so it bypasses
 * page access and sees confidential meetings; use `seedMember` when the test
 * needs someone who does not.
 */
function seedOwner(): Promise<SeededMemberContext> {
  return createWorkspaceMember({ role: "owner" });
}

/** A plain member of an existing workspace, holding General Management. */
async function seedMember(workspaceId: string): Promise<SeededMemberContext> {
  const member = await createWorkspaceMember({ role: "member" });
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: member.user.id,
    role: "member",
    joinedAt: new Date(),
  });
  await grantGeneralManagement(workspaceId, member.user.id);
  return member;
}

/** Switch the authenticated session and get an app bound to it. */
function appAs(ctx: SeededMemberContext): App {
  mockAuthenticatedSession(ctx.user);
  return createApp().app;
}

function list(app: App, workspaceId: string, query = "") {
  return app.request(`/api/meeting?workspaceId=${workspaceId}${query}`);
}

/**
 * Walk every page and return the ids in order. This is the shape of test
 * that catches the two classic keyset bugs — a row served twice, and a row
 * skipped entirely — which a single-page assertion cannot see.
 */
async function drain(app: App, workspaceId: string, query = "") {
  const ids: string[] = [];
  let cursor: string | null = null;
  let guard = 0;
  do {
    const res = await list(
      app,
      workspaceId,
      `${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponse;
    ids.push(...body.items.map((m) => m.id));
    cursor = body.nextCursor;
    guard += 1;
    if (guard > 20) throw new Error("pagination did not terminate");
  } while (cursor);
  return ids;
}

describe("GET /meeting", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("paginates every meeting exactly once, including null and tied dates", async () => {
    const owner = await seedOwner();
    const app = appAs(owner);
    const ws = owner.workspace.id;

    const tied = new Date("2026-03-01T00:00:00.000Z");
    const rows = [
      { title: "A", scheduledAt: tied },
      { title: "B", scheduledAt: tied },
      { title: "C", scheduledAt: new Date("2026-04-01T00:00:00.000Z") },
      { title: "D", scheduledAt: null },
      { title: "E", scheduledAt: null },
    ];
    const created: string[] = [];
    for (const r of rows) {
      const [row] = await db
        .insert(schema.meetingTable)
        .values({ workspaceId: ws, title: r.title, scheduledAt: r.scheduledAt })
        .returning();
      created.push(row.id);
    }

    const ids = await drain(app, ws, "&limit=2");
    expect(ids).toHaveLength(created.length);
    expect(new Set(ids).size).toBe(created.length);
    expect([...ids].sort()).toEqual([...created].sort());
  });

  it("orders newest first, with undated meetings last", async () => {
    const owner = await seedOwner();
    const app = appAs(owner);
    const ws = owner.workspace.id;

    for (const [title, scheduledAt] of [
      ["Older", new Date("2026-01-01T00:00:00.000Z")],
      ["Newer", new Date("2026-06-01T00:00:00.000Z")],
      ["Undated", null],
    ] as const) {
      await db
        .insert(schema.meetingTable)
        .values({ workspaceId: ws, title, scheduledAt });
    }

    const body = (await (await list(app, ws)).json()) as ListResponse;
    expect(body.items.map((m) => m.title)).toEqual([
      "Newer",
      "Older",
      "Undated",
    ]);
  });

  it("returns nextCursor null only on the final page", async () => {
    const owner = await seedOwner();
    const app = appAs(owner);
    const ws = owner.workspace.id;

    for (const title of ["one", "two", "three"]) {
      await db.insert(schema.meetingTable).values({ workspaceId: ws, title });
    }

    const first = (await (
      await list(app, ws, "&limit=2")
    ).json()) as ListResponse;
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = (await (
      await list(
        app,
        ws,
        `&limit=2&cursor=${encodeURIComponent(first.nextCursor as string)}`,
      )
    ).json()) as ListResponse;
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it("keeps pages full while hiding confidential meetings from a non-attendee", async () => {
    // The regression test for filter-after-fetch: that implementation
    // returned a short page that was not the last page, so the client could
    // not tell "some were hidden" from "end of list".
    const owner = await seedOwner();
    const ws = owner.workspace.id;
    const viewer = await seedMember(ws);

    for (let i = 0; i < 3; i += 1) {
      await db.insert(schema.meetingTable).values({
        workspaceId: ws,
        title: `Secret ${i}`,
        confidential: true,
      });
    }
    for (let i = 0; i < 4; i += 1) {
      await db
        .insert(schema.meetingTable)
        .values({ workspaceId: ws, title: `Open ${i}` });
    }

    const app = appAs(viewer);
    const first = (await (
      await list(app, ws, "&limit=2")
    ).json()) as ListResponse;
    expect(first.items).toHaveLength(2);

    const ids = await drain(app, ws, "&limit=2");
    expect(ids).toHaveLength(4);
  });

  it("never leaks a confidential meeting's title on any page", async () => {
    const owner = await seedOwner();
    const ws = owner.workspace.id;
    const viewer = await seedMember(ws);

    await db.insert(schema.meetingTable).values({
      workspaceId: ws,
      title: "Disciplinary hearing for Ahmad",
      confidential: true,
    });

    const res = await list(appAs(viewer), ws);
    const raw = await res.text();
    expect(raw).not.toContain("Disciplinary hearing for Ahmad");
  });

  it("shows a confidential meeting to an attendee and to a global admin", async () => {
    const owner = await seedOwner();
    const ws = owner.workspace.id;
    const attendee = await seedMember(ws);

    const [meeting] = await db
      .insert(schema.meetingTable)
      .values({ workspaceId: ws, title: "In camera session", confidential: true })
      .returning();
    await db
      .insert(schema.meetingAttendeeTable)
      .values({ meetingId: meeting.id, userId: attendee.user.id });

    const asAttendee = (await (
      await list(appAs(attendee), ws)
    ).json()) as ListResponse;
    expect(asAttendee.items.map((m) => m.id)).toContain(meeting.id);

    const asAdmin = (await (
      await list(appAs(owner), ws)
    ).json()) as ListResponse;
    expect(asAdmin.items.map((m) => m.id)).toContain(meeting.id);
  });

  it("agrees with canReadMeeting across confidential x attendee x admin", async () => {
    // `canReadMeeting` (access.ts) is the rule; `visibilityCondition` is its
    // SQL twin. Divergence between the two is the "gate correct where
    // everyone looks, missing where nobody does" failure this module has
    // already shipped twice — so assert them against each other directly.
    const { canReadMeeting } = await import(
      "../../apps/api/src/meeting/access"
    );
    const owner = await seedOwner();
    const ws = owner.workspace.id;
    const member = await seedMember(ws);

    const [openNonAttendee] = await db
      .insert(schema.meetingTable)
      .values({ workspaceId: ws, title: "open-non-attendee" })
      .returning();
    const [openAttendee] = await db
      .insert(schema.meetingTable)
      .values({ workspaceId: ws, title: "open-attendee" })
      .returning();
    const [confNonAttendee] = await db
      .insert(schema.meetingTable)
      .values({ workspaceId: ws, title: "conf-non-attendee", confidential: true })
      .returning();
    const [confAttendee] = await db
      .insert(schema.meetingTable)
      .values({ workspaceId: ws, title: "conf-attendee", confidential: true })
      .returning();
    for (const m of [openAttendee, confAttendee]) {
      await db
        .insert(schema.meetingAttendeeTable)
        .values({ meetingId: m.id, userId: member.user.id });
    }

    const cases = [
      { meeting: openNonAttendee, attendees: [] as string[] },
      { meeting: openAttendee, attendees: [member.user.id] },
      { meeting: confNonAttendee, attendees: [] as string[] },
      { meeting: confAttendee, attendees: [member.user.id] },
    ];

    for (const [ctx, isGlobalAdmin] of [
      [member, false],
      [owner, true],
    ] as const) {
      const visible = new Set(
        ((await (await list(appAs(ctx), ws)).json()) as ListResponse).items.map(
          (m) => m.id,
        ),
      );
      for (const { meeting, attendees } of cases) {
        expect({
          id: meeting.title,
          sql: visible.has(meeting.id),
        }).toEqual({
          id: meeting.title,
          sql: canReadMeeting({
            confidential: meeting.confidential,
            attendeeUserIds: attendees,
            userId: ctx.user.id,
            isGlobalAdmin,
          }),
        });
      }
    }
  });

  it("matches q against title, location, type label and body name", async () => {
    const owner = await seedOwner();
    const app = appAs(owner);
    const ws = owner.workspace.id;

    const [type] = await db
      .insert(schema.meetingTypeTable)
      .values({ workspaceId: ws, key: "agm", label: "Annual General Meeting" })
      .returning();
    const [body] = await db
      .insert(schema.meetingBodyTable)
      .values({ workspaceId: ws, name: "Majlis Syura" })
      .returning();

    await db
      .insert(schema.meetingTable)
      .values({ workspaceId: ws, title: "Budget review" });
    await db
      .insert(schema.meetingTable)
      .values({ workspaceId: ws, title: "Site visit", location: "Wisma MAPIM" });
    await db
      .insert(schema.meetingTable)
      .values({ workspaceId: ws, title: "Typed", meetingTypeId: type.id });
    await db
      .insert(schema.meetingTable)
      .values({ workspaceId: ws, title: "Bodied", bodyId: body.id });

    for (const [q, expected] of [
      ["budget", "Budget review"],
      ["wisma", "Site visit"],
      ["annual general", "Typed"],
      ["syura", "Bodied"],
    ] as const) {
      const page = (await (
        await list(app, ws, `&q=${encodeURIComponent(q)}`)
      ).json()) as ListResponse;
      expect(page.items.map((m) => m.title)).toEqual([expected]);
    }
  });

  it("returns an empty page with a null cursor when nothing matches", async () => {
    const owner = await seedOwner();
    const app = appAs(owner);
    const ws = owner.workspace.id;
    await db
      .insert(schema.meetingTable)
      .values({ workspaceId: ws, title: "Budget review" });

    const res = await list(app, ws, "&q=zzzznothing");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponse;
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it("treats a typed % as literal text rather than a wildcard", async () => {
    const owner = await seedOwner();
    const app = appAs(owner);
    const ws = owner.workspace.id;
    await db
      .insert(schema.meetingTable)
      .values({ workspaceId: ws, title: "Budget review" });

    const body = (await (
      await list(app, ws, "&q=%25")
    ).json()) as ListResponse;
    expect(body.items).toEqual([]);
  });

  it("returns the type label and body name alongside their ids", async () => {
    const owner = await seedOwner();
    const app = appAs(owner);
    const ws = owner.workspace.id;

    const [type] = await db
      .insert(schema.meetingTypeTable)
      .values({ workspaceId: ws, key: "agm", label: "Annual General Meeting" })
      .returning();
    const [body] = await db
      .insert(schema.meetingBodyTable)
      .values({ workspaceId: ws, name: "Majlis Syura" })
      .returning();
    await db.insert(schema.meetingTable).values({
      workspaceId: ws,
      title: "AGM 2026",
      meetingTypeId: type.id,
      bodyId: body.id,
    });

    const page = (await (await list(app, ws)).json()) as ListResponse;
    expect(page.items[0].meetingTypeLabel).toBe("Annual General Meeting");
    expect(page.items[0].bodyName).toBe("Majlis Syura");
  });

  it("clamps a limit above the cap instead of honouring it", async () => {
    const owner = await seedOwner();
    const app = appAs(owner);
    const ws = owner.workspace.id;
    for (let i = 0; i < 3; i += 1) {
      await db
        .insert(schema.meetingTable)
        .values({ workspaceId: ws, title: `m${i}` });
    }

    const res = await list(app, ws, "&limit=100000");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponse;
    expect(body.items).toHaveLength(3);
  });

  it("rejects a malformed cursor with 400 rather than silently restarting", async () => {
    const owner = await seedOwner();
    const app = appAs(owner);
    const res = await list(
      app,
      owner.workspace.id,
      "&cursor=obviously-not-a-cursor",
    );
    expect(res.status).toBe(400);
  });

  it("still refuses a member without General Management", async () => {
    const owner = await seedOwner();
    const ws = owner.workspace.id;
    const outsider = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: ws,
      userId: outsider.user.id,
      role: "member",
      joinedAt: new Date(),
    });

    const res = await list(appAs(outsider), ws);
    expect(res.status).toBe(403);
  });
});
```

**Fixture conventions to follow, taken from `meeting-crud.test.ts`:**
`createWorkspaceMember` takes no ids — it seeds its own user and workspace
and returns `{ user, workspace }`. `mockAuthenticatedSession` takes the user
*object*, not an id. `createApp()` is called after the session is mocked.
A workspace owner is a global admin, so tests needing a non-admin must seed a
separate member into the owner's workspace and grant General Management
explicitly.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @kaneo/api test:integration -- meeting-list`
Expected: FAIL — the route still returns a bare array, so `body.items` is undefined.

- [ ] **Step 3: Replace the list handler**

In `apps/api/src/meeting/index.ts`, extend the Drizzle import on line 1 to:

```ts
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
```

(`inArray` and `asc` are still used by other routes in this file — do not remove them.)

Add below the existing `import { canReadMeeting } from "./access";`:

```ts
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  escapeLikePattern,
  keysetCondition,
  visibilityCondition,
} from "./list-query";
```

Replace the whole `app.get("/", …)` block with:

```ts
// ── List ─────────────────────────────────────────────────────────────────
// Keyset-paginated, searchable, and confidentiality-filtered IN THE QUERY.
//
// The previous implementation fetched every meeting and filtered the result
// in JavaScript. That cannot be paginated: dropping rows after the fact
// yields a short page that is not the last page, so the client cannot tell
// "some were hidden" from "end of list", and a cursor taken from the last
// surviving row skips the hidden ones.
//
// `canReadMeeting` (access.ts) remains the single source of truth for the
// RULE and is what the detail route and pending-decision provider use;
// `visibilityCondition` is its SQL twin, and an integration test asserts
// the two agree across confidential x attendee x admin.
app.get(
  "/",
  describeRoute({
    operationId: "listMeetings",
    tags: ["Meeting"],
    description:
      "List meetings in a workspace, newest first, cursor-paginated, searchable, confidentiality-filtered",
  }),
  validator(
    "query",
    v.object({
      workspaceId: v.string(),
      limit: optStr,
      cursor: optStr,
      q: optStr,
    }),
  ),
  workspaceAccess.fromQuery("workspaceId"),
  pageAccess,
  async (c) => {
    const ws = c.get("workspaceId") as string;
    const userId = c.get("userId") as string;
    const { limit: rawLimit, cursor: rawCursor, q } = c.req.valid("query");

    const limit = clampLimit(rawLimit);
    const admin = await isGlobalAdmin(userId, ws);

    const conditions = [eq(meetingTable.workspaceId, ws)];

    const visibility = visibilityCondition(userId, admin);
    if (visibility) conditions.push(visibility);

    if (rawCursor) {
      const cursor = decodeCursor(rawCursor);
      // A silent reset would re-serve page one forever and read as an
      // infinite-scroll loop; say so instead.
      if (!cursor)
        throw new HTTPException(400, { message: "Invalid cursor" });
      conditions.push(keysetCondition(cursor));
    }

    const term = q?.trim();
    if (term) {
      const pattern = `%${escapeLikePattern(term)}%`;
      conditions.push(
        or(
          ilike(meetingTable.title, pattern),
          ilike(meetingTable.location, pattern),
          ilike(meetingTypeTable.label, pattern),
          ilike(meetingBodyTable.name, pattern),
        ) as ReturnType<typeof or>,
      );
    }

    // Fetch one extra row: its existence is what distinguishes "there is
    // another page" from "this is the last one", without a second COUNT.
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
        createdBy: meetingTable.createdBy,
        createdAt: meetingTable.createdAt,
        updatedAt: meetingTable.updatedAt,
        meetingTypeLabel: meetingTypeTable.label,
        bodyName: meetingBodyTable.name,
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
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            scheduledAt: last.scheduledAt
              ? last.scheduledAt.toISOString()
              : null,
            createdAt: last.createdAt.toISOString(),
            id: last.id,
          })
        : null;

    return c.json({ items, nextCursor });
  },
);
```

- [ ] **Step 4: Run the integration tests**

Run: `pnpm --filter @kaneo/api test:integration -- meeting-list`
Expected: PASS, 14 tests.

- [ ] **Step 5: Run the rest of the API suite for regressions**

Run: `pnpm --filter @kaneo/api test && pnpm --filter @kaneo/api test:integration`
Expected: PASS.

**No existing integration test calls `GET /meeting` at all** — verified by
grep before this plan was written. The list route's confidentiality filter
has never had a test, which is part of how it stayed a post-query
`.filter()` this long. So nothing should break here; if something does, it
is a genuine regression, not a stale assertion to relax.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/meeting/index.ts tests/api-integration/meeting-list.test.ts
git commit -m "feat(meeting): paginate, search and filter the meetings list in the query"
```

---

### Task 3: The list fetcher

**Files:**
- Modify: `apps/web/src/fetchers/meeting/index.ts`
- Test: `apps/web/src/fetchers/meeting/list.test.ts` (create)

**Interfaces:**
- Consumes: `GET /meeting` from Task 2.
- Produces:
  - `type MeetingListItem = Meeting & { meetingTypeLabel: string | null; bodyName: string | null }`
  - `type MeetingPage = { items: MeetingListItem[]; nextCursor: string | null }`
  - `listMeetings(workspaceId: string, opts?: { cursor?: string; q?: string; limit?: number }): Promise<MeetingPage>`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/fetchers/meeting/list.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { listMeetings } from "./index";

/**
 * The URL assertions matter as much as the response ones: a trailing-slash
 * 404 shipped to production because every integration test called the route
 * directly and nothing exercised this construction.
 */
function mockFetchOnce(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listMeetings", () => {
  it("requests the collection endpoint with no trailing slash", async () => {
    const fetchMock = mockFetchOnce({ items: [], nextCursor: null });
    await listMeetings("ws-1");
    const requested = String(fetchMock.mock.calls[0][0]);
    expect(requested).toContain("/meeting?");
    expect(requested).not.toContain("/meeting/?");
    expect(requested).toContain("workspaceId=ws-1");
  });

  it("passes cursor, q and limit through, encoded", async () => {
    const fetchMock = mockFetchOnce({ items: [], nextCursor: null });
    await listMeetings("ws-1", { cursor: "abc+/=", q: "majlis syura", limit: 10 });
    const requested = String(fetchMock.mock.calls[0][0]);
    expect(requested).toContain(`cursor=${encodeURIComponent("abc+/=")}`);
    expect(requested).toContain(`q=${encodeURIComponent("majlis syura")}`);
    expect(requested).toContain("limit=10");
  });

  it("omits optional params entirely when not given", async () => {
    const fetchMock = mockFetchOnce({ items: [], nextCursor: null });
    await listMeetings("ws-1");
    const requested = String(fetchMock.mock.calls[0][0]);
    expect(requested).not.toContain("cursor=");
    expect(requested).not.toContain("q=");
  });

  it("returns the page as-is", async () => {
    mockFetchOnce({
      items: [{ id: "m1", title: "AGM", meetingTypeLabel: "AGM", bodyName: null }],
      nextCursor: "next",
    });
    const page = await listMeetings("ws-1");
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe("next");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kaneo/web test -- list.test`
Expected: FAIL — `listMeetings` takes one argument and returns an array.

- [ ] **Step 3: Implement**

In `apps/web/src/fetchers/meeting/index.ts`, add after the `Meeting` type:

```ts
/**
 * The list route joins `meeting_type` and `meeting_body` to search their
 * names, so it can return the labels too — which is what the cards display.
 * The detail route does not join, so `MeetingDetail` has no such fields.
 */
export type MeetingListItem = Meeting & {
  meetingTypeLabel: string | null;
  bodyName: string | null;
};

export type MeetingPage = {
  items: MeetingListItem[];
  nextCursor: string | null;
};
```

Replace `listMeetings` with:

```ts
export async function listMeetings(
  workspaceId: string,
  opts: { cursor?: string; q?: string; limit?: number } = {},
): Promise<MeetingPage> {
  const params = new URLSearchParams({ workspaceId });
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.q) params.set("q", opts.q);
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  return jsonOrThrow(
    await fetch(url(`?${params.toString()}`), { credentials: "include" }),
  );
}
```

- [ ] **Step 4: Run the fetcher tests**

Run: `pnpm --filter @kaneo/web test -- fetchers/meeting`
Expected: PASS. `url.test.ts` and `index.test.ts` also call `listMeetings`; they pass a single argument, which still type-checks and still hits the collection endpoint, so they should be green unchanged. If either asserted an array response, update it to `{ items, nextCursor }`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/fetchers/meeting/index.ts apps/web/src/fetchers/meeting/list.test.ts
git commit -m "feat(meeting): paginated, searchable list fetcher"
```

---

### Task 4: The hooks — infinite list, and a separate hook for the adopt picker

**Files:**
- Modify: `apps/web/src/hooks/queries/meeting/use-meetings.ts`
- Create: `apps/web/src/hooks/queries/meeting/use-adopt-candidates.ts`

**Interfaces:**
- Consumes: `listMeetings`, `MeetingPage`, `MeetingListItem` from Task 3.
- Produces:
  - `useMeetings(workspaceId: string, q?: string)` → `UseInfiniteQueryResult<InfiniteData<MeetingPage>>`
  - `useAdoptCandidates(workspaceId: string, q?: string)` → `UseQueryResult<MeetingPage>`

**Query keys.** Both keep `["meetings", workspaceId, …]` as their prefix, so the existing `invalidateQueries({ queryKey: ["meetings", workspaceId] })` in `use-meeting-mutations.ts` still refreshes both by prefix match. Do not change that invalidation, and do not change `invalidations.test.tsx`.

- [ ] **Step 1: Rewrite `use-meetings.ts`**

```ts
import { useInfiniteQuery } from "@tanstack/react-query";
import * as api from "@/fetchers/meeting";

/**
 * The Meeting Minutes library: newest first, one page at a time.
 *
 * `q` is part of the query key, so changing the search term starts a fresh
 * pagination rather than appending matches to the previous term's pages.
 */
export function useMeetings(workspaceId: string, q?: string) {
  return useInfiniteQuery({
    queryKey: ["meetings", workspaceId, { q: q ?? "" }],
    queryFn: ({ pageParam }) =>
      api.listMeetings(workspaceId, {
        q: q || undefined,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!workspaceId,
  });
}
```

- [ ] **Step 2: Create `use-adopt-candidates.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import * as api from "@/fetchers/meeting";

/**
 * Meetings offered as "the meeting at which these minutes were adopted".
 *
 * Deliberately NOT the paginated library hook. The picker needs one bounded
 * list, and silently showing only the newest page would make an older
 * meeting unselectable with nothing on screen to say why — so the picker
 * gets a search box instead, and this hook re-queries the server as the
 * user types.
 *
 * The key keeps the ["meetings", workspaceId] prefix so the existing
 * mutation invalidation refreshes it too.
 */
export function useAdoptCandidates(workspaceId: string, q?: string) {
  return useQuery({
    queryKey: ["meetings", workspaceId, "adopt-candidates", { q: q ?? "" }],
    queryFn: () =>
      api.listMeetings(workspaceId, { q: q || undefined, limit: 50 }),
    enabled: !!workspaceId,
  });
}
```

- [ ] **Step 3: Verify the invalidation test still passes**

Run: `pnpm --filter @kaneo/web test -- invalidations`
Expected: PASS unchanged — prefix matching still covers both new keys.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/queries/meeting/
git commit -m "feat(meeting): infinite list hook and a dedicated adopt-candidates hook"
```

---

### Task 5: Document cards, the search bar, and four distinguishable states

**Files:**
- Create: `apps/web/src/components/general-management/meeting-card.tsx`
- Create: `apps/web/src/components/general-management/meeting-card.test.tsx`
- Modify: `apps/web/src/components/general-management/minutes-manager.tsx`
- Modify: `apps/web/src/components/general-management/minutes-manager.test.tsx`

**Interfaces:**
- Consumes: `useMeetings` (Task 4), `MeetingListItem` (Task 3).
- Produces: `<MeetingCard meeting={…} onOpen={() => …} />`.

- [ ] **Step 1: Write the failing card test**

Create `apps/web/src/components/general-management/meeting-card.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MeetingListItem } from "@/fetchers/meeting";
import { MeetingCard } from "./meeting-card";

function makeMeeting(overrides: Partial<MeetingListItem> = {}): MeetingListItem {
  return {
    id: "meeting-1",
    workspaceId: "ws-1",
    title: "Q3 Committee Meeting",
    meetingTypeId: "type-committee",
    bodyId: null,
    scheduledAt: "2026-03-01T12:00:00.000Z",
    location: null,
    confidential: false,
    status: "draft",
    adoptedAt: null,
    adoptedByMeetingId: null,
    createdBy: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    meetingTypeLabel: "Committee Meeting",
    bodyName: null,
    ...overrides,
  };
}

describe("MeetingCard", () => {
  it("shows the title and its metadata", () => {
    render(<MeetingCard meeting={makeMeeting()} onOpen={vi.fn()} />);
    expect(screen.getByText("Q3 Committee Meeting")).toBeInTheDocument();
    expect(screen.getByText("Committee Meeting")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("shows the type label, never the raw id", () => {
    render(<MeetingCard meeting={makeMeeting()} onOpen={vi.fn()} />);
    expect(screen.queryByText("type-committee")).not.toBeInTheDocument();
  });

  it("clamps a long title instead of letting it grow the card", () => {
    const title = "A ".repeat(200).trim();
    render(<MeetingCard meeting={makeMeeting({ title })} onOpen={vi.fn()} />);
    const heading = screen.getByText(title);
    expect(heading.className).toContain("line-clamp-");
  });

  it("marks a confidential meeting", () => {
    render(<MeetingCard meeting={makeMeeting({ confidential: true })} onOpen={vi.fn()} />);
    expect(screen.getByText("Confidential")).toBeInTheDocument();
  });

  it("is a real focusable button that opens the meeting", async () => {
    const onOpen = vi.fn();
    render(<MeetingCard meeting={makeMeeting()} onOpen={onOpen} />);
    const card = screen.getByRole("button", { name: /Q3 Committee Meeting/ });
    await userEvent.click(card);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("renders an em dash rather than blank metadata when unset", () => {
    render(
      <MeetingCard
        meeting={makeMeeting({ scheduledAt: null, meetingTypeLabel: null })}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kaneo/web test -- meeting-card`
Expected: FAIL — cannot resolve `./meeting-card`.

- [ ] **Step 3: Implement the card**

Create `apps/web/src/components/general-management/meeting-card.tsx`:

```tsx
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { MeetingListItem } from "@/fetchers/meeting";
import { formatDateMedium } from "@/lib/format";

/**
 * One meeting, rendered as a document rather than a row: a portrait
 * rectangle suggesting a page, with the title inside it.
 *
 * The title is clamped to a fixed number of lines. A long title must never
 * resize its card or overflow it — the grid has to stay even, and minutes
 * titles are routinely a full sentence.
 */
export function MeetingCard({
  meeting,
  onOpen,
}: {
  meeting: MeetingListItem;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col rounded-lg border border-border bg-card p-0 text-left transition hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="relative flex aspect-[3/4] w-full flex-col justify-between overflow-hidden rounded-t-lg border-border border-b bg-muted/40 p-3">
        {meeting.confidential && (
          <Badge
            variant="destructive"
            className="flex w-fit shrink-0 items-center gap-1 text-xs"
          >
            <Lock className="h-3 w-3" />
            Confidential
          </Badge>
        )}
        <span className="line-clamp-4 font-medium text-sm leading-snug">
          {meeting.title}
        </span>
      </span>
      <span className="flex flex-col gap-1 p-3 text-muted-foreground text-xs">
        <span className="truncate">
          {meeting.scheduledAt ? formatDateMedium(meeting.scheduledAt) : "—"}
        </span>
        <span className="truncate">{meeting.meetingTypeLabel ?? "—"}</span>
        <Badge
          variant={meeting.status === "adopted" ? "success" : "outline"}
          className="w-fit text-xs"
        >
          {meeting.status === "adopted" ? "Adopted" : "Draft"}
        </Badge>
      </span>
    </button>
  );
}
```

- [ ] **Step 4: Run the card tests**

Run: `pnpm --filter @kaneo/web test -- meeting-card`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing manager tests**

Rewrite the mock block at the top of `apps/web/src/components/general-management/minutes-manager.test.tsx`. The hook now returns infinite-query state, so replace the `useMeetings` mock and the `state` object:

```tsx
const state = vi.hoisted(() => ({
  pages: [] as { items: MeetingListItem[]; nextCursor: string | null }[],
  isLoading: false,
  isError: false,
  hasNextPage: false,
  isFetchingNextPage: false,
}));

const fetchNextPage = vi.hoisted(() => vi.fn());
const refetchMeetings = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/queries/meeting/use-meetings", () => ({
  useMeetings: () => ({
    data: { pages: state.pages },
    isLoading: state.isLoading,
    isError: state.isError,
    hasNextPage: state.hasNextPage,
    isFetchingNextPage: state.isFetchingNextPage,
    fetchNextPage,
    refetch: refetchMeetings,
  }),
}));
```

Change `makeMeeting` to return a `MeetingListItem` by adding `meetingTypeLabel: "Committee Meeting"` and `bodyName: null`, and update its type annotation and import. Update `afterEach` to reset `state.pages = []`, `state.hasNextPage = false`, `state.isFetchingNextPage = false`, and to clear `fetchNextPage`.

Then update the existing cases that set `state.meetings = [...]` to set `state.pages = [{ items: [...], nextCursor: null }]`, and add these:

```tsx
it("distinguishes an empty workspace from an empty search", async () => {
  state.pages = [{ items: [], nextCursor: null }];
  render(<MinutesManager workspaceId="ws-1" />);
  expect(screen.getByText("No Meeting Minutes yet")).toBeInTheDocument();

  await userEvent.type(screen.getByRole("searchbox"), "nothing matches");
  expect(await screen.findByText("No Meeting Minutes matched")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /clear search/i })).toBeInTheDocument();
});

it("offers a way back from an empty search", async () => {
  state.pages = [{ items: [], nextCursor: null }];
  render(<MinutesManager workspaceId="ws-1" />);
  const search = screen.getByRole("searchbox");
  await userEvent.type(search, "zzz");
  await userEvent.click(await screen.findByRole("button", { name: /clear search/i }));
  expect(search).toHaveValue("");
});

it("loads the next page exactly once when asked", async () => {
  state.pages = [{ items: [makeMeeting()], nextCursor: "next" }];
  state.hasNextPage = true;
  render(<MinutesManager workspaceId="ws-1" />);
  await userEvent.click(screen.getByRole("button", { name: /load more/i }));
  expect(fetchNextPage).toHaveBeenCalledTimes(1);
});

it("hides the load-more control on the last page", () => {
  state.pages = [{ items: [makeMeeting()], nextCursor: null }];
  state.hasNextPage = false;
  render(<MinutesManager workspaceId="ws-1" />);
  expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
});

it("renders every page's meetings, not just the first", () => {
  state.pages = [
    { items: [makeMeeting({ id: "m1", title: "First page meeting" })], nextCursor: "c" },
    { items: [makeMeeting({ id: "m2", title: "Second page meeting" })], nextCursor: null },
  ];
  render(<MinutesManager workspaceId="ws-1" />);
  expect(screen.getByText("First page meeting")).toBeInTheDocument();
  expect(screen.getByText("Second page meeting")).toBeInTheDocument();
});

it("keeps showing loaded cards while the next page is fetching", () => {
  state.pages = [{ items: [makeMeeting({ title: "Already loaded" })], nextCursor: "c" }];
  state.hasNextPage = true;
  state.isFetchingNextPage = true;
  render(<MinutesManager workspaceId="ws-1" />);
  expect(screen.getByText("Already loaded")).toBeInTheDocument();
  expect(screen.getByText(/loading more/i)).toBeInTheDocument();
});
```

Keep the existing error-state and loading-state cases untouched — they are the guard against a failed query rendering as "no meetings".

- [ ] **Step 6: Run to verify they fail**

Run: `pnpm --filter @kaneo/web test -- minutes-manager`
Expected: FAIL — no searchbox, no load-more control, and the component still reads `meetings.map`.

- [ ] **Step 7: Rewrite the manager's list section**

In `apps/web/src/components/general-management/minutes-manager.tsx`:

Add imports:

```tsx
import { Loader2, Lock, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MeetingCard } from "./meeting-card";
```

Add a debounce inside the component. Replace the hook call and add search state:

```tsx
const [search, setSearch] = useState("");
const [debounced, setDebounced] = useState("");

// Debounced so typing does not fire a query per keystroke. 300ms is the
// usual "finished a word" pause; shorter feels twitchy on a slow link.
useEffect(() => {
  const t = setTimeout(() => setDebounced(search.trim()), 300);
  return () => clearTimeout(t);
}, [search]);

const {
  data,
  isLoading,
  isError,
  refetch,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
} = useMeetings(workspaceId, debounced);

const meetings = useMemo(
  () => data?.pages.flatMap((p) => p.items) ?? [],
  [data],
);

// Auto-load on scroll, with the button below as the accessible and
// testable path. jsdom has no IntersectionObserver, hence the guard.
const sentinel = useRef<HTMLDivElement | null>(null);
useEffect(() => {
  const node = sentinel.current;
  if (!node || !hasNextPage || isFetchingNextPage) return;
  if (typeof IntersectionObserver === "undefined") return;
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) fetchNextPage();
  });
  observer.observe(node);
  return () => observer.disconnect();
}, [hasNextPage, isFetchingNextPage, fetchNextPage]);
```

Add the search input directly beneath the header block:

```tsx
<div className="relative">
  <Search className="-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 text-muted-foreground" />
  <Input
    type="search"
    value={search}
    onChange={(e) => setSearch(e.target.value)}
    placeholder="Search Meeting Minutes by title, location, type or body"
    aria-label="Search Meeting Minutes"
    className="pl-9"
  />
</div>
```

Replace the `!meetings || meetings.length === 0` branch with a branch that distinguishes the two empties:

```tsx
) : meetings.length === 0 ? (
  debounced ? (
    <div className="mx-auto max-w-md space-y-3 py-12 text-center">
      <h3 className="font-medium text-sm">No Meeting Minutes matched</h3>
      <p className="text-muted-foreground text-sm">
        Nothing in this workspace matches “{debounced}”.
      </p>
      <Button variant="outline" size="sm" onClick={() => setSearch("")}>
        <X className="h-3.5 w-3.5" />
        Clear search
      </Button>
    </div>
  ) : (
    <div className="mx-auto max-w-md space-y-2 py-12 text-center">
      <h3 className="font-medium text-sm">No Meeting Minutes yet</h3>
      <p className="text-muted-foreground text-sm">
        Create a meeting to start recording its agenda, attendance and
        decisions.
      </p>
    </div>
  )
) : (
  <>
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {meetings.map((meeting) => (
        <MeetingCard
          key={meeting.id}
          meeting={meeting}
          onOpen={() => setOpenMeetingId(meeting.id)}
        />
      ))}
    </div>
    <div ref={sentinel} />
    {hasNextPage && (
      <div className="flex justify-center py-2">
        {isFetchingNextPage ? (
          <span className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading more…
          </span>
        ) : (
          <Button variant="outline" size="sm" onClick={() => fetchNextPage()}>
            Load more
          </Button>
        )}
      </div>
    )}
  </>
)}
```

Replace the first-page loading branch's spinner with skeleton cards:

```tsx
{isLoading ? (
  <div
    className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
    role="status"
    aria-label="Loading Meeting Minutes"
  >
    {Array.from({ length: 8 }, (_, i) => (
      <div
        key={`skeleton-${i}`}
        className="animate-pulse rounded-lg border border-border"
      >
        <div className="aspect-[3/4] w-full rounded-t-lg bg-muted" />
        <div className="space-y-2 p-3">
          <div className="h-2 w-2/3 rounded bg-muted" />
          <div className="h-2 w-1/2 rounded bg-muted" />
        </div>
      </div>
    ))}
  </div>
) : …
```

Widen the container from `max-w-3xl` to `max-w-5xl` — a four-column grid inside a three-column-text width would leave cards too narrow to read a clamped title.

`Lock` is no longer used in this file once the row markup is gone; remove it from the import if Biome flags it.

- [ ] **Step 8: Run the manager tests**

Run: `pnpm --filter @kaneo/web test -- minutes-manager`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/general-management/meeting-card.tsx \
        apps/web/src/components/general-management/meeting-card.test.tsx \
        apps/web/src/components/general-management/minutes-manager.tsx \
        apps/web/src/components/general-management/minutes-manager.test.tsx
git commit -m "feat(meeting): render Meeting Minutes as searchable document cards"
```

---

### Task 6: Repair the adopt picker

Pagination broke a consumer the spec did not know about. This task is not optional and not scope creep — see "A defect in the spec" above.

**Files:**
- Modify: `apps/web/src/components/general-management/meeting-detail-dialog.tsx` (line ~133 and the adopt section at ~290)
- Modify: `apps/web/src/components/general-management/meeting-detail-dialog.test.tsx` (mock at line ~43)

**Interfaces:**
- Consumes: `useAdoptCandidates` from Task 4.

- [ ] **Step 1: Write the failing test**

In `meeting-detail-dialog.test.tsx`, replace the `use-meetings` mock with an `use-adopt-candidates` mock returning the page shape:

```tsx
vi.mock("@/hooks/queries/meeting/use-adopt-candidates", () => ({
  useAdoptCandidates: () => ({
    data: { items: state.adoptCandidates, nextCursor: null },
    isError: state.isMeetingsError,
  }),
}));
```

Rename the corresponding `state` field and its `afterEach` reset to `adoptCandidates`, and add a case:

```tsx
it("lets the user search for the adopting meeting", async () => {
  state.adoptCandidates = [
    makeMeeting({ id: "other-1", title: "November committee meeting" }),
  ];
  renderOverview();
  const search = screen.getByRole("searchbox", { name: /search meetings/i });
  await userEvent.type(search, "november");
  expect(search).toHaveValue("november");
  expect(screen.getByText("November committee meeting")).toBeInTheDocument();
});
```

Keep the existing case at line ~461 that asserts the control reports an error rather than looking empty — that is the guard against the failure this whole plan is about.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kaneo/web test -- meeting-detail-dialog`
Expected: FAIL — the component still imports `useMeetings` and there is no searchbox.

- [ ] **Step 3: Implement**

In `meeting-detail-dialog.tsx`, replace the import at line 42 and the call at line 133:

```tsx
import { useAdoptCandidates } from "@/hooks/queries/meeting/use-adopt-candidates";
```

```tsx
const [adoptSearch, setAdoptSearch] = useState("");
const { data: adoptPage, isError: isMeetingsError } = useAdoptCandidates(
  workspaceId,
  adoptSearch.trim(),
);
const meetings = adoptPage?.items ?? [];
```

Add a search input above the candidate list in the adopt section (around line 299, beside the existing `candidates` filter):

```tsx
<Input
  type="search"
  value={adoptSearch}
  onChange={(e) => setAdoptSearch(e.target.value)}
  placeholder="Search meetings"
  aria-label="Search meetings to adopt from"
  className="mb-2"
/>
```

Leave the existing `candidates = meetings.filter((other) => other.id !== meeting.id)` line alone — excluding self is a client concern the server should not have to know about.

Keep the empty and error copy that already exists. Add one line to the empty case so a fruitless search is not read as "no meetings exist":

```tsx
{adoptSearch.trim()
  ? "No meetings matched that search."
  : "No other meetings yet to record as the adopting meeting."}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @kaneo/web test -- meeting-detail-dialog`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/general-management/meeting-detail-dialog.tsx \
        apps/web/src/components/general-management/meeting-detail-dialog.test.tsx
git commit -m "fix(meeting): give the adopt picker its own searchable query"
```

---

### Task 7: Full verification

**Files:** none.

- [ ] **Step 1: Whole web suite**

Run: `pnpm --filter @kaneo/web test`
Expected: PASS. Anything still mocking `useMeetings` with an array will fail here — fix it to the page shape rather than loosening the assertion.

- [ ] **Step 2: Whole API suite**

Run: `pnpm --filter @kaneo/api test && pnpm --filter @kaneo/api test:integration`
Expected: PASS.

- [ ] **Step 3: Lint the whole repo**

Run: `pnpm exec biome ci .`
Expected: exit 0. **Read the last lines of the output, not a truncated head** — a green run and a failing run both print a lot, and the verdict is at the end. `biome ci .` over the whole repo catches things `biome check <files>` on a subset does not, and CI runs the whole-repo form.

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit anything the lint fixed**

```bash
git add -A && git commit -m "chore: lint after meetings library" || true
```

---

## Self-Review

**Spec coverage.**

| Spec section | Task |
|---|---|
| Confidentiality moved into the query | 1 (`visibilityCondition`), 2 (integration proof across all four combinations) |
| Ordering newest-first with a total order | 1 (`keysetCondition`), 2 |
| Cursor pagination, limit default 24 / cap 100, `{ items, nextCursor }` | 1, 2, 3 |
| `useMeetings` becomes `useInfiniteQuery` | 4 |
| Omni search over title, location, type name, body name, single `q`, resets pagination | 2, 4, 5 |
| Document cards, clamped title, metadata beneath, focusable button | 5 |
| Four distinguishable states + end-of-list | 5 |
| Unit test of the cursor round-trip including null `scheduledAt` | 1 |
| Contract test asserting the requested URL | 3 |

Two things the spec did not cover, both added deliberately and flagged in the text above: the type/body labels on the response (a card cannot show a type without its name, and the join exists for search anyway), and the adopt picker (paginating `useMeetings` breaks it silently).

Spec D depends on the single `q` parameter designed here; nothing in this plan blocks extending it to document text.

**Placeholders:** none — every step carries the code it needs.

**Type consistency:** `MeetingCursor` / `encodeCursor` / `decodeCursor` / `clampLimit` / `escapeLikePattern` / `visibilityCondition` / `keysetCondition` are defined in Task 1 and used with those exact names in Task 2. `MeetingListItem` / `MeetingPage` / `listMeetings(workspaceId, opts)` are defined in Task 3 and consumed unchanged in Tasks 4, 5 and 6. `useMeetings(workspaceId, q)` and `useAdoptCandidates(workspaceId, q)` are defined in Task 4 and used in Tasks 5 and 6.
