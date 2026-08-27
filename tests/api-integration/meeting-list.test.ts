import { sql } from "drizzle-orm";
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

/**
 * Seed a meeting with an EXPLICIT `created_at`, written as SQL text so the
 * value lands in the column at full microsecond precision — a JS `Date`
 * cannot carry one, which is the whole point of the tests below. Insert
 * first, then stamp the column: drizzle's insert path would coerce a Date
 * and truncate.
 */
async function seedAt(
  workspaceId: string,
  title: string,
  createdAt: string,
  scheduledAt: Date | null = null,
): Promise<string> {
  const [row] = await db
    .insert(schema.meetingTable)
    .values({ workspaceId, title, scheduledAt })
    .returning();
  await db.execute(
    sql`update "meeting" set "created_at" = ${createdAt}::timestamp where "id" = ${row.id}`,
  );
  return row.id;
}

describe("GET /meeting", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("paginates every meeting exactly once, including null and tied dates", async () => {
    const owner = await seedOwner();
    const app = appAs(owner);
    const ws = owner.workspace.id;

    // `created_at` is seeded EXPLICITLY rather than left to insert order.
    // Back-to-back inserts land in the same millisecond often enough that a
    // cursor carrying only millisecond precision made this test fail perhaps
    // one run in five — which reads as random CI noise rather than the real
    // bug. Pinning the values makes the outcome a property of the code.
    const tied = new Date("2026-03-01T00:00:00.000Z");
    const rows = [
      { title: "A", scheduledAt: tied, createdAt: "2026-01-01 00:00:01" },
      { title: "B", scheduledAt: tied, createdAt: "2026-01-01 00:00:02" },
      {
        title: "C",
        scheduledAt: new Date("2026-04-01T00:00:00.000Z"),
        createdAt: "2026-01-01 00:00:03",
      },
      { title: "D", scheduledAt: null, createdAt: "2026-01-01 00:00:04" },
      { title: "E", scheduledAt: null, createdAt: "2026-01-01 00:00:05" },
    ];
    const created: string[] = [];
    for (const r of rows) {
      created.push(await seedAt(ws, r.title, r.createdAt, r.scheduledAt));
    }

    const ids = await drain(app, ws, "&limit=2");
    expect(ids).toHaveLength(created.length);
    expect(new Set(ids).size).toBe(created.length);
    expect([...ids].sort()).toEqual([...created].sort());
  });

  it("does not lose a row whose created_at differs from the page boundary only in microseconds", async () => {
    // `created_at` is `timestamp default now()`, and Postgres `now()` has
    // MICROSECOND precision. A cursor that carries only milliseconds
    // truncates the boundary row's key downwards, so the keyset predicate
    // `created_at < T OR (created_at = T AND id < cursorId)` excludes every
    // row in [T.mmm000, T.mmmXYZ) — rows that sorted *after* the boundary
    // and so never appeared on an earlier page either. They become
    // unreachable through pagination entirely: absent from the grid, still
    // live behind a direct link, with nothing on screen to say so.
    //
    // Seeded with explicit values so the boundary falls in a fixed place;
    // nothing here depends on insert timing.
    const owner = await seedOwner();
    const app = appAs(owner);
    const ws = owner.workspace.id;

    const created = [
      await seedAt(ws, "newest", "2026-01-01 00:00:02"),
      // Ends page two, so its key becomes the cursor.
      await seedAt(ws, "boundary", "2026-01-01 00:00:00.123456"),
      // Strictly between the boundary's truncated key (.123000) and its
      // true key (.123456) — satisfies neither branch of a truncated
      // predicate.
      await seedAt(ws, "microsecond-sibling", "2026-01-01 00:00:00.123400"),
      await seedAt(ws, "oldest", "2026-01-01 00:00:00.000001"),
    ];

    const ids = await drain(app, ws, "&limit=1");
    expect([...ids].sort()).toEqual([...created].sort());
    expect(new Set(ids).size).toBe(created.length);
  });

  it("does not lose a row whose scheduled_at differs from the page boundary only in microseconds", async () => {
    // `scheduled_at` is only written from JS Dates today, so it carries no
    // sub-millisecond tail — but that is a property of the current write
    // path, not of the column. A bulk import or a direct insert reintroduces
    // the same silent disappearance, so the cursor must carry this key at
    // full precision too.
    const owner = await seedOwner();
    const app = appAs(owner);
    const ws = owner.workspace.id;

    const created: string[] = [];
    for (const [title, scheduledAt] of [
      ["newest", "2026-05-01 09:00:02"],
      ["boundary", "2026-05-01 09:00:00.123456"],
      ["microsecond-sibling", "2026-05-01 09:00:00.123400"],
      ["oldest", "2026-05-01 09:00:00.000001"],
    ] as const) {
      const [row] = await db
        .insert(schema.meetingTable)
        .values({ workspaceId: ws, title })
        .returning();
      await db.execute(
        sql`update "meeting" set "scheduled_at" = ${scheduledAt}::timestamp where "id" = ${row.id}`,
      );
      created.push(row.id);
    }

    const ids = await drain(app, ws, "&limit=1");
    expect([...ids].sort()).toEqual([...created].sort());
    expect(new Set(ids).size).toBe(created.length);
  });

  it("pins the exact cursor text format rendered by to_char", async () => {
    // The cursor is rendered with `to_char(col, 'YYYY-MM-DD
    // HH24:MI:SS.US')` rather than `::text`, specifically so its shape does
    // not depend on the server's `DateStyle` setting. `to_char` always
    // emits a fixed six-digit fraction (unlike `::text`, which strips
    // trailing zeros), so pin that here — a future edit back to `::text`,
    // or to a different format string, should fail a test rather than only
    // break pagination on an instance with a non-default `DateStyle`.
    const owner = await seedOwner();
    const app = appAs(owner);
    const ws = owner.workspace.id;

    await seedAt(ws, "newer", "2026-01-01 00:00:00.500000");
    await seedAt(ws, "older", "2026-01-01 00:00:00.123456");

    const first = (await (
      await list(app, ws, "&limit=1")
    ).json()) as ListResponse;
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();

    const decoded = JSON.parse(
      Buffer.from(first.nextCursor as string, "base64url").toString("utf8"),
    ) as { scheduledAt: string | null; createdAt: string; id: string };

    expect(decoded.createdAt).toBe("2026-01-01 00:00:00.500000");
    // scheduled_at is unset for both seeded rows, so `to_char` on NULL must
    // still come through as `null`, not the string "null" or an empty
    // string.
    expect(decoded.scheduledAt).toBeNull();
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

    // Confidential rows are seeded AFTER the open ones (and thus sort
    // first, newest-created-first) so they occupy the head of page one.
    // Seeding them first (as an earlier version of this test did) put them
    // at the TAIL of the order instead, where a filter-after-fetch
    // implementation would still return a full, correct-looking first page
    // — the very bug this test exists to catch would have gone undetected.
    for (let i = 0; i < 4; i += 1) {
      await db
        .insert(schema.meetingTable)
        .values({ workspaceId: ws, title: `Open ${i}` });
    }
    for (let i = 0; i < 3; i += 1) {
      await db.insert(schema.meetingTable).values({
        workspaceId: ws,
        title: `Secret ${i}`,
        confidential: true,
      });
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
      .values({
        workspaceId: ws,
        title: "In camera session",
        confidential: true,
      })
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
      .values({
        workspaceId: ws,
        title: "conf-non-attendee",
        confidential: true,
      })
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
    await db.insert(schema.meetingTable).values({
      workspaceId: ws,
      title: "Site visit",
      location: "Wisma MAPIM",
    });
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

  it("never surfaces a confidential meeting's title through q", async () => {
    // The search predicate is ANDed with the visibility clause today, so
    // this passes — it exists to catch a future edit that moves the search
    // `or(...)` to the wrong side of that `and`. A confidential meeting's
    // title has escaped this module three times in production, each
    // through a path nobody had thought to guard; assert on the field that
    // actually carries the leak (the raw response text), the way the
    // existing leak test does, not just on the parsed item list.
    const owner = await seedOwner();
    const ws = owner.workspace.id;
    const viewer = await seedMember(ws);

    await db.insert(schema.meetingTable).values({
      workspaceId: ws,
      title: "Disciplinary hearing for Ahmad",
      confidential: true,
    });

    const res = await list(
      appAs(viewer),
      ws,
      `&q=${encodeURIComponent("disciplinary")}`,
    );
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("Disciplinary hearing for Ahmad");
    const body = JSON.parse(raw) as ListResponse;
    expect(body.items).toEqual([]);
  });

  it("combines cursor and q", async () => {
    const owner = await seedOwner();
    const app = appAs(owner);
    const ws = owner.workspace.id;

    for (const title of [
      "Budget review 1",
      "Budget review 2",
      "Budget review 3",
      "Site visit",
    ]) {
      await db.insert(schema.meetingTable).values({ workspaceId: ws, title });
    }

    const first = (await (
      await list(app, ws, `&q=${encodeURIComponent("budget")}&limit=2`)
    ).json()) as ListResponse;
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = (await (
      await list(
        app,
        ws,
        `&q=${encodeURIComponent("budget")}&limit=2&cursor=${encodeURIComponent(
          first.nextCursor as string,
        )}`,
      )
    ).json()) as ListResponse;
    expect(second.items).toHaveLength(1);
    expect(second.items[0].title).toBe("Budget review 1");
    expect(second.nextCursor).toBeNull();
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

    const body = (await (await list(app, ws, "&q=%25")).json()) as ListResponse;
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

  it("accepts an absurd limit rather than erroring on it", async () => {
    // Renamed from "clamps a limit above the cap": with only 3 rows seeded,
    // asserting 3 items back passes with no cap at all, so the old name
    // promised a guarantee the body never checked. The cap itself has real
    // coverage in the unit tests (`clampLimit("100000") === MAX_LIMIT`);
    // what this case is actually worth is that the route answers 200 to a
    // limit no client should send, instead of a validation error or an
    // out-of-memory query.
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

  it("rejects a structurally valid cursor with a non-timestamp value with 400, not 500", async () => {
    // Without decodeCursor's shape check, a string like "nonsense" reaches
    // keysetCondition, which binds it with an explicit `::timestamp` cast —
    // Postgres raises, and the route answers an unhandled 500 rather than
    // the 400 it promises for any bad cursor.
    const owner = await seedOwner();
    const app = appAs(owner);
    const cursor = Buffer.from(
      JSON.stringify({
        scheduledAt: null,
        createdAt: "nonsense",
        id: "does-not-matter",
      }),
    ).toString("base64url");
    const res = await list(
      app,
      owner.workspace.id,
      `&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a calendar-invalid but shape-valid cursor with 400, not 500", async () => {
    // "9999-13-45 99:99:99" matches decodeCursor's shape regex (digit
    // grouping only) but is calendar-impossible. Without calendar
    // validation, this reaches keysetCondition's `::timestamp` cast, and
    // Postgres raises a date/time-out-of-range error the route has no
    // try/catch for — an unhandled 500 where the route promises 400 for any
    // bad cursor.
    const owner = await seedOwner();
    const app = appAs(owner);
    const cursor = Buffer.from(
      JSON.stringify({
        scheduledAt: null,
        createdAt: "9999-13-45 99:99:99",
        id: "does-not-matter",
      }),
    ).toString("base64url");
    const res = await list(
      app,
      owner.workspace.id,
      `&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a year-zero cursor with 400, not 500", async () => {
    // "0000-01-01 00:00:00" matches decodeCursor's shape regex (month 1,
    // day 1, zeros elsewhere) but year 0 does not exist as a Postgres
    // timestamp: `select '0000-01-01 00:00:00'::timestamp` raises
    // date/time-out-of-range, while year 1 succeeds. Same unhandled-500
    // failure mode as the "9999-13-45 99:99:99" case above, reached through
    // the identical hand-crafted-cursor path.
    const owner = await seedOwner();
    const app = appAs(owner);
    const cursor = Buffer.from(
      JSON.stringify({
        scheduledAt: null,
        createdAt: "0000-01-01 00:00:00",
        id: "does-not-matter",
      }),
    ).toString("base64url");
    const res = await list(
      app,
      owner.workspace.id,
      `&cursor=${encodeURIComponent(cursor)}`,
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
